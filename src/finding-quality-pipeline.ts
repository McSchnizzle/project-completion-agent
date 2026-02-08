/**
 * Finding Quality Pipeline - Pure-TypeScript pipeline that processes raw
 * findings through critique, dedup, and confidence filtering.
 *
 * Pipeline stages:
 *   raw findings -> critique -> dedup -> confidence filter -> final findings
 *
 * Generates a quality-report.json summarizing the pipeline results.
 *
 * @module finding-quality-pipeline
 */

import fs from 'node:fs';
import path from 'node:path';
import { getFindingDir } from './artifact-paths.js';
import { critiqueFinding, type CritiqueScore } from './phases/finding-critique.js';
import { deduplicateFindings, type DeduplicationResult } from './phases/finding-dedup.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QualityPipelineConfig {
  /** Path to the audit output directory containing findings/. */
  auditDir: string;
  /** Minimum confidence score to keep a finding (default: 25). */
  confidenceThreshold?: number;
}

export interface QualityPipelineResult {
  /** Findings that passed all pipeline stages. */
  finalFindings: Record<string, unknown>[];
  /** Full quality report data. */
  report: QualityReport;
}

export interface QualityReport {
  total_raw: number;
  after_critique: number;
  after_dedup: number;
  after_filter: number;
  false_positive_rate_estimate: number;
  filtered_findings: FilteredFinding[];
  critique_scores: CritiqueScore[];
  dedup_stats: {
    duplicates_removed: number;
  };
}

export interface FilteredFinding {
  id: string;
  reason: string;
  confidence: number;
  falsePositiveSignals: string[];
}

// ---------------------------------------------------------------------------
// Quality gate filter types
// ---------------------------------------------------------------------------

export interface FilterResult {
  accepted: Record<string, unknown>[];
  rejected: Array<{
    finding: Record<string, unknown>;
    reason: string;
    filter: string;
  }>;
}

// ---------------------------------------------------------------------------
// Quality gate filters
// ---------------------------------------------------------------------------

const POSITIVE_LANGUAGE = [
  'good', 'consistent', 'suggests good', 'adequate', 'meets expectations',
  'well-implemented', 'properly configured', 'no issues', 'working correctly',
  'functions as expected', 'performs well',
];

const SELF_REFERENTIAL_PATTERNS = [
  'not tested', 'not performed', 'no testing', 'not verified by tool',
  'no accessibility testing', 'not checked', 'was not assessed',
  'tool did not', 'audit did not', 'could not be tested',
  'testing was not', 'not covered by',
];

const UNVERIFIED_ROUTE_PATTERNS = [
  'unvisited', 'not accessible', 'not visited', 'could not reach',
  'route not found', 'page not loaded', 'unable to access',
];

/**
 * Extract the URL from a raw finding. Handles both flat `url` field
 * (from LLM output) and nested `location.url` (from Finding schema).
 */
function getFindingUrl(finding: Record<string, unknown>): string {
  if (typeof finding.url === 'string') return finding.url;
  const loc = finding.location as Record<string, unknown> | undefined;
  if (loc && typeof loc.url === 'string') return loc.url;
  return '';
}

/**
 * Get the finding's text fields concatenated for pattern matching.
 */
function getFindingText(finding: Record<string, unknown>): string {
  const parts = [
    finding.title,
    finding.description,
    finding.actual_behavior,
    finding.expected_behavior,
    finding.evidence,
  ].filter((v) => typeof v === 'string');
  return parts.join(' ').toLowerCase();
}

/**
 * Filter: Reject P4 findings that are positive observations, not defects.
 */
function positiveObservationFilter(
  finding: Record<string, unknown>,
): string | null {
  if (finding.severity !== 'P4') return null;
  const text = getFindingText(finding);
  for (const phrase of POSITIVE_LANGUAGE) {
    if (text.includes(phrase)) {
      return `P4 finding with positive language ("${phrase}") is an observation, not a defect`;
    }
  }
  return null;
}

/**
 * Filter: Reject findings that describe tool limitations rather than app bugs.
 */
function selfReferentialFilter(
  finding: Record<string, unknown>,
): string | null {
  const text = getFindingText(finding);
  for (const pattern of SELF_REFERENTIAL_PATTERNS) {
    if (text.includes(pattern)) {
      return `Finding describes tool limitation ("${pattern}"), not an app defect`;
    }
  }
  return null;
}

/**
 * Filter: Reject findings whose only evidence is unvisited routes.
 */
function unverifiedRouteFilter(
  finding: Record<string, unknown>,
  visitedPages: string[],
): string | null {
  const url = getFindingUrl(finding);
  const urlIsNA = !url || url === 'N/A';
  const urlNotVisited = !urlIsNA && !visitedPages.some((v) => v === url || url.startsWith(v) || v.startsWith(url));

  if (!urlIsNA && !urlNotVisited) return null; // URL was visited

  const text = getFindingText(finding);
  const hasUnverifiedLanguage = UNVERIFIED_ROUTE_PATTERNS.some((p) => text.includes(p));

  if (!hasUnverifiedLanguage) return null; // Has other evidence beyond route claims

  // Check if there's concrete evidence beyond route claims
  const evidence = finding.evidence;
  const hasConcreteEvidence =
    (typeof evidence === 'object' && evidence !== null && !Array.isArray(evidence) &&
      (((evidence as Record<string, unknown>).screenshots as unknown[])?.length > 0 ||
        ((evidence as Record<string, unknown>).console_errors as unknown[])?.length > 0)) ||
    (Array.isArray(finding.steps_to_reproduce) && finding.steps_to_reproduce.length > 2);

  if (hasConcreteEvidence) return null;

  return `Finding relies on unvisited/unverified route with no concrete evidence`;
}

/**
 * Filter: Reject vague "minimal functionality" observations lacking PRD context.
 */
function vagueObservationFilter(
  finding: Record<string, unknown>,
): string | null {
  const text = getFindingText(finding);
  const vagueTerms = ['minimal functionality', 'minimal interactivity', 'limited functionality', 'basic functionality'];
  const hasVagueTerm = vagueTerms.some((t) => text.includes(t));
  if (!hasVagueTerm) return null;

  // Accept if it references specific PRD requirements
  const hasPrdRef = finding.prd_feature || finding.prd_section || finding.prd_requirement;
  if (hasPrdRef) return null;

  // Accept if it has concrete expected vs actual comparison
  const hasExpected = typeof finding.expected_behavior === 'string' && finding.expected_behavior.length > 20;
  const hasActual = typeof finding.actual_behavior === 'string' && finding.actual_behavior.length > 20;
  if (hasExpected && hasActual) return null;

  return `Vague observation about "minimal" functionality without PRD reference or concrete evidence`;
}

/**
 * URL Resolver: Attempt to map findings with url="N/A" to the closest visited page.
 * Returns the matched URL or null if no match found.
 */
export function resolveUrl(
  finding: Record<string, unknown>,
  visitedPages: string[],
): string | null {
  if (visitedPages.length === 0) return null;

  const text = getFindingText(finding);
  const title = (typeof finding.title === 'string' ? finding.title : '').toLowerCase();

  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const page of visitedPages) {
    let score = 0;
    // Extract path segments and meaningful words from the URL
    try {
      const urlObj = new URL(page);
      const segments = urlObj.pathname
        .split('/')
        .filter((s) => s.length > 1)
        .map((s) => s.toLowerCase());

      for (const seg of segments) {
        if (title.includes(seg)) score += 3;
        if (text.includes(seg)) score += 1;
      }
    } catch {
      // If URL can't be parsed, do simple substring matching
      const simplified = page.toLowerCase().replace(/[^a-z0-9]/g, ' ');
      const words = simplified.split(/\s+/).filter((w) => w.length > 2);
      for (const word of words) {
        if (title.includes(word)) score += 2;
        if (text.includes(word)) score += 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = page;
    }
  }

  // Require at least a moderate confidence match
  const confidence = Math.min(bestScore / 6, 1);
  return confidence > 0.5 ? bestMatch : null;
}

/**
 * Run all quality gate filters on a set of findings extracted from LLM output.
 *
 * Filters run in order: positive observation, self-referential, unverified route, vague observation.
 * The URL resolver attempts to fix N/A urls before the unverified route filter runs.
 *
 * @param findings - Raw findings extracted from LLM response.
 * @param visitedPages - List of URLs that were actually visited during the audit.
 * @returns Accepted and rejected findings with rejection reasons.
 */
export function filterFindings(
  findings: Record<string, unknown>[],
  visitedPages: string[],
): FilterResult {
  const accepted: Record<string, unknown>[] = [];
  const rejected: FilterResult['rejected'] = [];

  const filters: Array<{
    name: string;
    fn: (f: Record<string, unknown>) => string | null;
  }> = [
    { name: 'positive-observation', fn: positiveObservationFilter },
    { name: 'self-referential', fn: selfReferentialFilter },
    { name: 'unverified-route', fn: (f) => unverifiedRouteFilter(f, visitedPages) },
    { name: 'vague-observation', fn: vagueObservationFilter },
  ];

  for (const finding of findings) {
    // Step 1: Attempt URL resolution for N/A urls
    const url = getFindingUrl(finding);
    if (!url || url === 'N/A') {
      const resolved = resolveUrl(finding, visitedPages);
      if (resolved) {
        // Update the finding's url field (flat format from LLM)
        if (typeof finding.url === 'string' || finding.url === undefined) {
          finding.url = resolved;
        }
      }
    }

    // Step 2: Run filters in order; first match rejects
    let wasRejected = false;
    for (const filter of filters) {
      const reason = filter.fn(finding);
      if (reason) {
        rejected.push({ finding, reason, filter: filter.name });
        wasRejected = true;
        break;
      }
    }

    if (!wasRejected) {
      accepted.push(finding);
    }
  }

  return { accepted, rejected };
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full quality pipeline on findings loaded from disk.
 *
 * @param config - Pipeline configuration.
 * @returns Pipeline result with final findings and quality report.
 */
export function runQualityPipeline(
  config: QualityPipelineConfig,
): QualityPipelineResult {
  const threshold = config.confidenceThreshold ?? 25;

  // Step 0: Load raw findings
  const rawFindings = loadFindings(config.auditDir);
  const totalRaw = rawFindings.length;

  if (totalRaw === 0) {
    return {
      finalFindings: [],
      report: emptyReport(),
    };
  }

  // Step 1: Critique all findings (score evidence, detect FP signals)
  const critiqueScores = rawFindings.map((f) => critiqueFinding(f, threshold));

  // Step 2: Filter out flagged findings from critique
  const afterCritique: Record<string, unknown>[] = [];
  const filteredByCritique: FilteredFinding[] = [];

  for (let i = 0; i < rawFindings.length; i++) {
    const score = critiqueScores[i];
    if (score.flagged) {
      filteredByCritique.push({
        id: score.findingId,
        reason: score.flagReason || 'Flagged by critique',
        confidence: score.confidence,
        falsePositiveSignals: score.falsePositiveSignals,
      });
    } else {
      afterCritique.push(rawFindings[i]);
    }
  }

  // Step 3: Dedup
  let dedupResult: DeduplicationResult;
  try {
    dedupResult = deduplicateFindings(afterCritique);
  } catch {
    // If dedup fails (e.g., missing signature module), pass through
    dedupResult = {
      unique: afterCritique,
      duplicates: [],
      stats: {
        totalInput: afterCritique.length,
        uniqueOutput: afterCritique.length,
        duplicatesRemoved: 0,
      },
    };
  }
  const afterDedup = dedupResult.unique;

  // Step 4: Final confidence filter on remaining findings
  // (Findings that passed critique may still have borderline scores.)
  const finalFindings: Record<string, unknown>[] = [];
  const filteredByConfidence: FilteredFinding[] = [];

  for (const finding of afterDedup) {
    const score = critiqueFinding(finding, threshold);
    if (score.confidence >= threshold) {
      finalFindings.push(finding);
    } else {
      filteredByConfidence.push({
        id: score.findingId,
        reason: `Confidence ${score.confidence} below threshold ${threshold}`,
        confidence: score.confidence,
        falsePositiveSignals: score.falsePositiveSignals,
      });
    }
  }

  const allFiltered = [...filteredByCritique, ...filteredByConfidence];
  const fpEstimate = totalRaw > 0
    ? Math.round((allFiltered.length / totalRaw) * 100) / 100
    : 0;

  const report: QualityReport = {
    total_raw: totalRaw,
    after_critique: afterCritique.length,
    after_dedup: afterDedup.length,
    after_filter: finalFindings.length,
    false_positive_rate_estimate: fpEstimate,
    filtered_findings: allFiltered,
    critique_scores: critiqueScores,
    dedup_stats: {
      duplicates_removed: dedupResult.stats.duplicatesRemoved,
    },
  };

  return { finalFindings, report };
}

/**
 * Run the pipeline and write quality-report.json to the audit directory.
 */
export function runQualityPipelineAndSave(
  config: QualityPipelineConfig,
): QualityPipelineResult {
  const result = runQualityPipeline(config);

  const reportPath = path.join(config.auditDir, 'quality-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(result.report, null, 2), 'utf-8');

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadFindings(auditDir: string): Record<string, unknown>[] {
  const findingDir = getFindingDir(auditDir);
  if (!fs.existsSync(findingDir)) return [];

  const findings: Record<string, unknown>[] = [];
  const files = fs.readdirSync(findingDir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    try {
      const data = JSON.parse(
        fs.readFileSync(path.join(findingDir, file), 'utf-8'),
      );
      findings.push(data);
    } catch {
      // Skip unparseable files
    }
  }

  return findings;
}

function emptyReport(): QualityReport {
  return {
    total_raw: 0,
    after_critique: 0,
    after_dedup: 0,
    after_filter: 0,
    false_positive_rate_estimate: 0,
    filtered_findings: [],
    critique_scores: [],
    dedup_stats: { duplicates_removed: 0 },
  };
}
