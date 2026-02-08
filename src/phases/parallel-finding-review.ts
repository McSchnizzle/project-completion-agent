/**
 * Parallel Finding Review - Adversarial multi-lens review team.
 *
 * Spawns 3 parallel reviewer jobs (security, UX, devil's advocate)
 * that do NOT need browser access, then synthesizes their results.
 *
 * @module phases/parallel-finding-review
 */

import fs from 'node:fs';
import path from 'node:path';
import { getFindingDir } from '../artifact-paths';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParallelReviewConfig {
  auditDir: string;
  securityPromptPath: string;
  uxPromptPath: string;
  adversarialPromptPath: string;
}

export interface ReviewLensResult {
  lens: string;
  findingsReviewed: number;
  flagged: number;
  approved: number;
}

export interface ParallelReviewResult {
  lenses: ReviewLensResult[];
  findingsUpdated: number;
  disagreements: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Run parallel finding review with 3 lenses.
 */
export async function runParallelFindingReview(
  config: ParallelReviewConfig,
  jobRunner: (
    jobs: Array<{ id: string; name: string; execute: () => Promise<unknown>; requiresBrowser: boolean }>,
    options: { concurrency: number; timeout: number; maxRetries: number; retryBackoff: 'exponential' | 'linear' },
  ) => Promise<Array<{ jobId: string; status: string; output?: unknown; error?: string }>>,
  createReviewJob: (lens: string, promptPath: string) => () => Promise<unknown>,
): Promise<ParallelReviewResult> {
  const result: ParallelReviewResult = {
    lenses: [],
    findingsUpdated: 0,
    disagreements: 0,
    errors: [],
  };

  const lenses = [
    { id: 'security', name: 'Security Review', promptPath: config.securityPromptPath },
    { id: 'ux', name: 'UX Review', promptPath: config.uxPromptPath },
    { id: 'adversarial', name: 'Adversarial Review', promptPath: config.adversarialPromptPath },
  ];

  console.log('[ParallelReview] Launching 3 review lenses in parallel...');

  // Create jobs - these do NOT require browser
  const jobs = lenses.map(lens => ({
    id: `review-${lens.id}`,
    name: lens.name,
    execute: createReviewJob(lens.id, lens.promptPath),
    requiresBrowser: false,
  }));

  // Run all 3 in true parallel (no browser constraint)
  const jobResults = await jobRunner(jobs, {
    concurrency: 3, // All 3 at once
    timeout: 120_000, // 2 min each
    maxRetries: 1,
    retryBackoff: 'linear',
  });

  // Process results
  for (const jr of jobResults) {
    if (jr.status === 'completed' && jr.output) {
      const output = jr.output as Record<string, unknown>;
      result.lenses.push({
        lens: jr.jobId.replace('review-', ''),
        findingsReviewed: (output.reviewed as number) ?? 0,
        flagged: (output.flagged as number) ?? 0,
        approved: (output.approved as number) ?? 0,
      });
    } else if (jr.error) {
      result.errors.push(`${jr.jobId}: ${jr.error}`);
    }
  }

  // Write individual review files
  for (const lens of result.lenses) {
    const reviewPath = path.join(
      getFindingDir(config.auditDir),
      '..',
      `review-${lens.lens}.json`,
    );
    fs.writeFileSync(reviewPath, JSON.stringify(lens, null, 2), 'utf-8');
  }

  // Synthesize: apply disagreement policy
  result.disagreements = synthesizeReviews(config.auditDir, result.lenses);
  result.findingsUpdated = countFindings(config.auditDir);

  console.log(
    `[ParallelReview] Complete: ${result.lenses.length} lenses, ${result.disagreements} disagreements.`,
  );

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function synthesizeReviews(
  auditDir: string,
  lenses: ReviewLensResult[],
): number {
  // Count disagreements between lenses
  let disagreements = 0;

  // If one lens flags and another approves, that's a disagreement
  // In a full implementation, this would cross-reference per-finding
  for (let i = 0; i < lenses.length; i++) {
    for (let j = i + 1; j < lenses.length; j++) {
      if (lenses[i].flagged > 0 && lenses[j].approved > lenses[j].flagged) {
        disagreements++;
      }
    }
  }

  return disagreements;
}

function countFindings(auditDir: string): number {
  const findingDir = getFindingDir(auditDir);
  if (!fs.existsSync(findingDir)) return 0;
  return fs.readdirSync(findingDir).filter(f => f.endsWith('.json')).length;
}
