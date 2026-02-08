/**
 * Interactive Review Phase - User reviews and triages findings.
 *
 * In interactive mode, presents each finding for Accept/Reject/Skip.
 * In non-interactive mode, auto-accepts all findings.
 *
 * @module phases/interactive-review
 */

import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import {
  getFindingDir,
  getReviewDecisionsPath,
} from '../artifact-paths';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReviewDecision = 'accepted' | 'rejected' | 'skipped';

export interface ReviewEntry {
  findingId: string;
  title: string;
  severity: string;
  decision: ReviewDecision;
  reason?: string;
  reviewedAt: string;
}

export interface ReviewResult {
  decisions: ReviewEntry[];
  accepted: number;
  rejected: number;
  skipped: number;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Run the interactive review phase.
 *
 * @param auditDir - The audit output directory.
 * @param nonInteractive - If true, auto-accept all findings.
 * @returns Review decisions.
 */
export async function runInteractiveReview(
  auditDir: string,
  nonInteractive: boolean,
): Promise<ReviewResult> {
  const findings = loadFindings(auditDir);

  if (findings.length === 0) {
    console.log('[Review] No findings to review.');
    const result: ReviewResult = { decisions: [], accepted: 0, rejected: 0, skipped: 0 };
    writeDecisions(auditDir, result);
    return result;
  }

  console.log(`\n[Review] ${findings.length} finding(s) to review.\n`);

  const decisions: ReviewEntry[] = [];

  if (nonInteractive) {
    for (const finding of findings) {
      decisions.push({
        findingId: finding.id,
        title: finding.title,
        severity: finding.severity,
        decision: 'accepted',
        reason: 'Auto-accepted (non-interactive mode)',
        reviewedAt: new Date().toISOString(),
      });
    }
    console.log(`[Review] Auto-accepted all ${findings.length} findings (non-interactive mode).`);
  } else {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string): Promise<string> =>
      new Promise(resolve => rl.question(q, resolve));

    for (let i = 0; i < findings.length; i++) {
      const f = findings[i];
      console.log(`--- Finding ${i + 1}/${findings.length} ---`);
      console.log(`  ID:       ${f.id}`);
      console.log(`  Title:    ${f.title}`);
      console.log(`  Severity: ${f.severity}`);
      console.log(`  Category: ${f.category}`);
      if (f.description) console.log(`  Desc:     ${f.description}`);
      console.log('');

      const answer = await ask('  [A]ccept / [R]eject / [S]kip? ');
      const choice = answer.trim().toLowerCase();

      let decision: ReviewDecision = 'skipped';
      if (choice === 'a' || choice === 'accept') decision = 'accepted';
      else if (choice === 'r' || choice === 'reject') decision = 'rejected';

      decisions.push({
        findingId: f.id,
        title: f.title,
        severity: f.severity,
        decision,
        reviewedAt: new Date().toISOString(),
      });
    }

    rl.close();
  }

  const result: ReviewResult = {
    decisions,
    accepted: decisions.filter(d => d.decision === 'accepted').length,
    rejected: decisions.filter(d => d.decision === 'rejected').length,
    skipped: decisions.filter(d => d.decision === 'skipped').length,
  };

  writeDecisions(auditDir, result);

  console.log(
    `\n[Review] Complete: ${result.accepted} accepted, ${result.rejected} rejected, ${result.skipped} skipped.`,
  );

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FindingSummary {
  id: string;
  title: string;
  severity: string;
  category: string;
  description?: string;
}

function loadFindings(auditDir: string): FindingSummary[] {
  const findingDir = getFindingDir(auditDir);
  if (!fs.existsSync(findingDir)) return [];

  const files = fs.readdirSync(findingDir).filter(f => f.endsWith('.json')).sort();
  const findings: FindingSummary[] = [];

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(findingDir, file), 'utf-8'));
      findings.push({
        id: data.id ?? path.basename(file, '.json'),
        title: data.title ?? 'Untitled',
        severity: data.severity ?? 'unknown',
        category: data.category ?? 'uncategorized',
        description: data.description,
      });
    } catch {
      // Skip malformed finding files
    }
  }

  return findings;
}

function writeDecisions(auditDir: string, result: ReviewResult): void {
  const outPath = getReviewDecisionsPath(auditDir);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
}
