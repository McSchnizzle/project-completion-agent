/**
 * Finding Quality Phase - Verification, critique, and deduplication.
 *
 * Orchestrates the finding quality pipeline:
 * 1. Deduplication (code)
 * 2. Verification (Claude agent)
 * 3. Critique (Claude agent)
 * 4. Disagreement resolution (code)
 *
 * @module phases/finding-quality
 */

import fs from 'node:fs';
import path from 'node:path';
import { getFindingDir, getReviewDecisionsPath } from '../artifact-paths';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QualityConfig {
  auditDir: string;
  verificationPromptPath: string;
  critiquePromptPath: string;
}

export interface QualityResult {
  totalFindings: number;
  uniqueFindings: number;
  duplicatesRemoved: number;
  verified: number;
  notReproduced: number;
  flaky: number;
  critiqued: number;
  needsHumanReview: number;
  errors: string[];
}

type SDKBridge = (phaseConfig: {
  phaseName: string;
  promptPath: string;
  inputContext: Record<string, unknown>;
  requiresBrowser: boolean;
  maxRetries: number;
  budgetUsd: number;
}) => Promise<{ success: boolean; output: unknown; error?: string }>;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Run the finding quality pipeline.
 *
 * @param config - Quality phase configuration.
 * @param runClaudePhase - SDK bridge function.
 * @param deduplicateFindings - Dedup function from finding-dedup.ts.
 * @returns Quality results.
 */
export async function runFindingQuality(
  config: QualityConfig,
  runClaudePhase: SDKBridge,
  deduplicateFindings?: (findings: Record<string, unknown>[]) => {
    unique: Record<string, unknown>[];
    duplicates: Array<{ original: Record<string, unknown>; duplicate: Record<string, unknown> }>;
  },
): Promise<QualityResult> {
  const result: QualityResult = {
    totalFindings: 0,
    uniqueFindings: 0,
    duplicatesRemoved: 0,
    verified: 0,
    notReproduced: 0,
    flaky: 0,
    critiqued: 0,
    needsHumanReview: 0,
    errors: [],
  };

  // Load all findings
  const findings = loadAllFindings(config.auditDir);
  result.totalFindings = findings.length;

  if (findings.length === 0) {
    console.log('[Quality] No findings to process.');
    return result;
  }

  console.log(`[Quality] Processing ${findings.length} finding(s)...`);

  // Step 1: Deduplication
  let uniqueFindings = findings;
  if (deduplicateFindings) {
    const dedupResult = deduplicateFindings(findings);
    uniqueFindings = dedupResult.unique;
    result.duplicatesRemoved = dedupResult.duplicates.length;
    result.uniqueFindings = uniqueFindings.length;
    console.log(`[Quality] Dedup: ${result.duplicatesRemoved} duplicates removed.`);
  } else {
    result.uniqueFindings = findings.length;
  }

  // Step 2: Verification (Claude agent with browser)
  try {
    const verResult = await runClaudePhase({
      phaseName: 'finding-quality-verification',
      promptPath: config.verificationPromptPath,
      inputContext: {
        findings: uniqueFindings,
        auditDir: config.auditDir,
      },
      requiresBrowser: true,
      maxRetries: 1,
      budgetUsd: 1.0,
    });

    if (verResult.success && verResult.output) {
      const verOutput = verResult.output as Record<string, unknown>;
      if (Array.isArray(verOutput.results)) {
        for (const r of verOutput.results) {
          const rec = r as Record<string, unknown>;
          if (rec.status === 'verified') result.verified++;
          else if (rec.status === 'not_reproduced') result.notReproduced++;
          else if (rec.status === 'flaky') result.flaky++;
        }
      }
    }
  } catch (e) {
    result.errors.push(`Verification failed: ${e}`);
  }

  // Step 3: Critique (Claude agent, no browser)
  try {
    const critiqueResult = await runClaudePhase({
      phaseName: 'finding-quality-critique',
      promptPath: config.critiquePromptPath,
      inputContext: {
        findings: uniqueFindings,
      },
      requiresBrowser: false,
      maxRetries: 1,
      budgetUsd: 0.5,
    });

    if (critiqueResult.success && critiqueResult.output) {
      result.critiqued = uniqueFindings.length;
      const critOutput = critiqueResult.output as Record<string, unknown>;
      if (Array.isArray(critOutput.results)) {
        for (const r of critOutput.results) {
          const rec = r as Record<string, unknown>;
          if (typeof rec.confidence === 'number' && rec.confidence < 50) {
            result.needsHumanReview++;
          }
        }
      }
    }
  } catch (e) {
    result.errors.push(`Critique failed: ${e}`);
  }

  // Step 4: Apply disagreement policy
  applyDisagreementPolicy(config.auditDir, result);

  console.log(
    `[Quality] Complete: ${result.verified} verified, ${result.notReproduced} not reproduced, ` +
    `${result.flaky} flaky, ${result.needsHumanReview} need human review.`,
  );

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadAllFindings(auditDir: string): Record<string, unknown>[] {
  const findingDir = getFindingDir(auditDir);
  if (!fs.existsSync(findingDir)) return [];

  const findings: Record<string, unknown>[] = [];
  const files = fs.readdirSync(findingDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(findingDir, file), 'utf-8'));
      findings.push(data);
    } catch {
      // skip
    }
  }

  return findings;
}

function applyDisagreementPolicy(auditDir: string, result: QualityResult): void {
  // Disagreement policy:
  // - Verification fail + high critique confidence → mark as needs human review
  // - Security finding + dispute → security wins (keep finding)
  // - All disagreements logged to review-decisions.json
  const disagreements: Array<{
    findingId: string;
    type: string;
    resolution: string;
  }> = [];

  // For now, log the policy application
  if (result.notReproduced > 0 && result.critiqued > 0) {
    console.log('[Quality] Applying disagreement policy...');
    // In a full implementation, this would cross-reference verification
    // and critique results per finding and apply the resolution rules
  }

  if (disagreements.length > 0) {
    const logPath = path.join(
      getFindingDir(auditDir),
      '..',
      'quality-disagreements.json',
    );
    fs.writeFileSync(logPath, JSON.stringify(disagreements, null, 2), 'utf-8');
  }
}
