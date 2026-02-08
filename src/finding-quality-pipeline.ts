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
