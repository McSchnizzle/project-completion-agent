/**
 * Finding Critique - Evidence-based confidence scoring and false positive detection.
 *
 * Pure-TypeScript phase that scores each finding's evidence strength,
 * detects likely false positives from category/title signals, and flags
 * findings below a configurable confidence threshold.
 *
 * @module phases/finding-critique
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CritiqueScore {
  findingId: string;
  confidence: number;
  breakdown: ScoreBreakdown;
  falsePositiveSignals: string[];
  flagged: boolean;
  flagReason: string | null;
}

export interface ScoreBreakdown {
  hasScreenshot: number;
  hasCodeFileRef: number;
  hasLineNumbers: number;
  hasReproductionSteps: number;
  hasExpectedVsActual: number;
  hasPrdSectionRef: number;
  deviationPenalty: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCORE_WEIGHTS = {
  hasScreenshot: 15,
  hasCodeFileRef: 15,
  hasLineNumbers: 10,
  hasReproductionSteps: 20,
  hasExpectedVsActual: 15,
  hasPrdSectionRef: 15,
  deviationPenalty: -30,
} as const;

/** Category values that suggest intentional design deviation, not a bug. */
const DEVIATION_CATEGORIES = [
  'prd deviation',
  'intentional',
  'design deviation',
  'intentional design',
];

/** Title/description phrases that suggest a design choice rather than a bug. */
const DEVIATION_PHRASES = [
  'instead of',
  'deviation from',
  'differs from prd',
  'not matching prd',
  'design choice',
  'intentional',
  'uses .* instead',
];

// Pre-compile regex patterns
const DEVIATION_REGEXES = DEVIATION_PHRASES.map(
  (p) => new RegExp(p, 'i'),
);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Score a single finding's evidence strength and detect false positive signals.
 *
 * @param finding - A finding JSON object (schema-free Record).
 * @param confidenceThreshold - Minimum score to avoid being flagged (default 50).
 * @returns CritiqueScore with breakdown, signals, and flag status.
 */
export function critiqueFinding(
  finding: Record<string, unknown>,
  confidenceThreshold = 50,
): CritiqueScore {
  const id = String(finding.id || finding.finding_id || finding.findingId || 'unknown');
  const breakdown = scoreEvidence(finding);
  const confidence = clampScore(sumBreakdown(breakdown));
  const falsePositiveSignals = detectFalsePositiveSignals(finding);

  let flagged = false;
  let flagReason: string | null = null;

  if (confidence < confidenceThreshold) {
    flagged = true;
    flagReason = `Confidence ${confidence} below threshold ${confidenceThreshold}`;
  }

  if (falsePositiveSignals.length > 0 && !flagged) {
    flagged = true;
    flagReason = `False positive signals: ${falsePositiveSignals.join('; ')}`;
  }

  return {
    findingId: id,
    confidence,
    breakdown,
    falsePositiveSignals,
    flagged,
    flagReason,
  };
}

/**
 * Critique an array of findings and return all scores.
 */
export function critiqueAllFindings(
  findings: Record<string, unknown>[],
  confidenceThreshold = 50,
): CritiqueScore[] {
  return findings.map((f) => critiqueFinding(f, confidenceThreshold));
}

// ---------------------------------------------------------------------------
// Evidence scoring
// ---------------------------------------------------------------------------

function scoreEvidence(finding: Record<string, unknown>): ScoreBreakdown {
  return {
    hasScreenshot: checkScreenshot(finding) ? SCORE_WEIGHTS.hasScreenshot : 0,
    hasCodeFileRef: checkCodeFileRef(finding) ? SCORE_WEIGHTS.hasCodeFileRef : 0,
    hasLineNumbers: checkLineNumbers(finding) ? SCORE_WEIGHTS.hasLineNumbers : 0,
    hasReproductionSteps: checkReproductionSteps(finding) ? SCORE_WEIGHTS.hasReproductionSteps : 0,
    hasExpectedVsActual: checkExpectedVsActual(finding) ? SCORE_WEIGHTS.hasExpectedVsActual : 0,
    hasPrdSectionRef: checkPrdSectionRef(finding) ? SCORE_WEIGHTS.hasPrdSectionRef : 0,
    deviationPenalty: checkDeviationCategory(finding) ? SCORE_WEIGHTS.deviationPenalty : 0,
  };
}

function sumBreakdown(b: ScoreBreakdown): number {
  return (
    b.hasScreenshot +
    b.hasCodeFileRef +
    b.hasLineNumbers +
    b.hasReproductionSteps +
    b.hasExpectedVsActual +
    b.hasPrdSectionRef +
    b.deviationPenalty
  );
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// Evidence checks
// ---------------------------------------------------------------------------

function checkScreenshot(finding: Record<string, unknown>): boolean {
  // Check top-level screenshot_id (Zod schema format)
  if (finding.screenshot_id) return true;

  const evidence = finding.evidence;
  if (evidence && typeof evidence === 'object' && !Array.isArray(evidence)) {
    const ev = evidence as Record<string, unknown>;
    if (ev.screenshot || ev.screenshot_id) return true;
    // Zod schema: evidence.screenshots is string[] - check non-empty
    if (Array.isArray(ev.screenshots) && ev.screenshots.length > 0) return true;
    if (typeof ev.browser === 'string') return false; // browser observation, not screenshot
  }
  if (Array.isArray(evidence)) {
    return evidence.some((e) => {
      if (typeof e === 'object' && e !== null) {
        const rec = e as Record<string, unknown>;
        return rec.type === 'screenshot' || rec.screenshot_id != null;
      }
      return false;
    });
  }
  return false;
}

function checkCodeFileRef(finding: Record<string, unknown>): boolean {
  // Check evidence.code array (calendar finding format)
  const evidence = finding.evidence;
  if (evidence && typeof evidence === 'object' && !Array.isArray(evidence)) {
    const ev = evidence as Record<string, unknown>;
    if (Array.isArray(ev.code) && ev.code.length > 0) return true;
    if (ev.code_snippet) return true;
  }
  if (Array.isArray(evidence)) {
    if (evidence.some((e) => {
      if (typeof e === 'object' && e !== null) {
        return (e as Record<string, unknown>).type === 'code-snippet';
      }
      return false;
    })) return true;
  }
  // Check top-level file_path
  if (finding.file_path) return true;
  // Check location.file
  const location = finding.location as Record<string, unknown> | undefined;
  if (location?.file) return true;
  return false;
}

function checkLineNumbers(finding: Record<string, unknown>): boolean {
  // Check evidence.code entries for line number patterns like "file.jsx:325-483"
  const evidence = finding.evidence;
  if (evidence && typeof evidence === 'object' && !Array.isArray(evidence)) {
    const ev = evidence as Record<string, unknown>;
    if (Array.isArray(ev.code)) {
      return ev.code.some((ref) => typeof ref === 'string' && /:\d+/.test(ref));
    }
  }
  // Check top-level line_number
  if (finding.line_number != null) return true;
  // Check location.line
  const location = finding.location as Record<string, unknown> | undefined;
  if (location?.line != null) return true;
  return false;
}

function checkReproductionSteps(finding: Record<string, unknown>): boolean {
  const steps = finding.reproduction_steps || finding.steps_to_reproduce;
  if (Array.isArray(steps) && steps.length > 0) return true;
  // Check if fix field implies actionable repro context
  if (typeof finding.fix === 'string' && finding.fix.length > 20) return false;
  return false;
}

function checkExpectedVsActual(finding: Record<string, unknown>): boolean {
  // Zod schema: top-level expected_behavior and actual_behavior fields
  if (finding.expected_behavior && finding.actual_behavior) return true;

  const evidence = finding.evidence;
  if (evidence && typeof evidence === 'object' && !Array.isArray(evidence)) {
    const ev = evidence as Record<string, unknown>;
    if (ev.expected && ev.actual) return true;
  }
  // Check description for expected/actual contrast patterns
  const desc = String(finding.description || '');
  // "PRD requires X. Implementation does Y" or "requires X. Shows Y"
  const expectWord = /\brequires?\b|\bshould\b|\bexpects?\b|\bspecifies?\b/i;
  const actualWord = /\bshows?\b|\brenders?\b|\bdisplays?\b|\bslices?\b|\buses?\b|\bimplementation\b|\bbut\b|\bhowever\b|\binstead\b/i;
  if (expectWord.test(desc) && actualWord.test(desc)) return true;
  return false;
}

function checkPrdSectionRef(finding: Record<string, unknown>): boolean {
  if (finding.prd_section) return true;
  if (finding.prd_requirement) return true;
  if (finding.prd_feature_id) return true;
  // Check in description
  const desc = String(finding.description || '');
  if (/prd\s+(section|feature|requirement)/i.test(desc)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// False positive detection
// ---------------------------------------------------------------------------

function checkDeviationCategory(finding: Record<string, unknown>): boolean {
  const category = String(finding.category || '').toLowerCase();
  return DEVIATION_CATEGORIES.some((dc) => category.includes(dc));
}

function detectFalsePositiveSignals(finding: Record<string, unknown>): string[] {
  const signals: string[] = [];

  // Signal 1: Category is "PRD Deviation" or "Intentional"
  const category = String(finding.category || '').toLowerCase();
  if (DEVIATION_CATEGORIES.some((dc) => category.includes(dc))) {
    signals.push(`Category "${finding.category}" suggests intentional design deviation`);
  }

  // Signal 2: Title or description contains deviation phrases
  const title = String(finding.title || '').toLowerCase();
  const description = String(finding.description || '').toLowerCase();
  const combined = title + ' ' + description;

  for (const regex of DEVIATION_REGEXES) {
    if (regex.test(combined)) {
      signals.push(`Text matches deviation pattern: ${regex.source}`);
      break; // One match is enough
    }
  }

  // Signal 3: Fix suggests updating PRD rather than fixing code
  // Check both legacy "fix" field and Zod schema "fix_suggestion" field
  const fix = String(finding.fix || finding.fix_suggestion || '').toLowerCase();
  if (fix.includes('update prd') || fix.includes('update the prd') || fix.includes('revise prd')) {
    signals.push('Fix suggests updating PRD rather than fixing implementation');
  }

  return signals;
}
