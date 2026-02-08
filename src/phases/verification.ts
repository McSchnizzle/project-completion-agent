/**
 * Verification Phase - Reproduces findings in browser to confirm validity.
 *
 * Each finding is tested 3 times to detect flakiness. Results are
 * VERIFIED, NOT_REPRODUCED, or FLAKY.
 *
 * @module phases/verification
 */

import fs from 'node:fs';
import path from 'node:path';
import { getFindingDir } from '../artifact-paths';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VerificationConfig {
  auditDir: string;
  promptPath: string;
  specificFinding?: string; // verify just one finding by ID
}

export interface VerificationResult {
  totalVerified: number;
  verified: number;
  notReproduced: number;
  flaky: number;
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
 * Run the verification phase.
 *
 * @param config - Verification configuration.
 * @param runClaudePhase - SDK bridge function.
 * @returns Verification results.
 */
export async function runVerification(
  config: VerificationConfig,
  runClaudePhase: SDKBridge,
): Promise<VerificationResult> {
  const result: VerificationResult = {
    totalVerified: 0,
    verified: 0,
    notReproduced: 0,
    flaky: 0,
    errors: [],
  };

  // Load findings to verify
  const findings = config.specificFinding
    ? loadSpecificFinding(config.auditDir, config.specificFinding)
    : loadAllFindings(config.auditDir);

  if (findings.length === 0) {
    console.log('[Verification] No findings to verify.');
    return result;
  }

  console.log(`[Verification] Verifying ${findings.length} finding(s)...`);

  // Call Claude agent with verification prompt
  const phaseResult = await runClaudePhase({
    phaseName: 'verification',
    promptPath: config.promptPath,
    inputContext: {
      findings,
      auditDir: config.auditDir,
      attemptsPerFinding: 3,
    },
    requiresBrowser: true,
    maxRetries: 1,
    budgetUsd: 1.0,
  });

  if (!phaseResult.success) {
    result.errors.push(phaseResult.error ?? 'Verification failed');
    return result;
  }

  // Parse verification results
  if (phaseResult.output) {
    const output = phaseResult.output as Record<string, unknown>;
    if (Array.isArray(output.results)) {
      for (const r of output.results) {
        const rec = r as Record<string, unknown>;
        result.totalVerified++;
        if (rec.status === 'verified') result.verified++;
        else if (rec.status === 'not_reproduced') result.notReproduced++;
        else if (rec.status === 'flaky') result.flaky++;

        // Update finding file with verification status
        if (rec.findingId) {
          updateFindingVerification(
            config.auditDir,
            rec.findingId as string,
            rec.status as string,
            rec,
          );
        }
      }
    }
  }

  console.log(
    `[Verification] Complete: ${result.verified} verified, ` +
    `${result.notReproduced} not reproduced, ${result.flaky} flaky.`,
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

function loadSpecificFinding(auditDir: string, findingId: string): Record<string, unknown>[] {
  const findingPath = path.join(getFindingDir(auditDir), `${findingId}.json`);
  if (!fs.existsSync(findingPath)) return [];

  try {
    return [JSON.parse(fs.readFileSync(findingPath, 'utf-8'))];
  } catch {
    return [];
  }
}

function updateFindingVerification(
  auditDir: string,
  findingId: string,
  status: string,
  details: Record<string, unknown>,
): void {
  const findingPath = path.join(getFindingDir(auditDir), `${findingId}.json`);
  if (!fs.existsSync(findingPath)) return;

  try {
    const data = JSON.parse(fs.readFileSync(findingPath, 'utf-8'));
    data.verification = {
      status,
      verifiedAt: new Date().toISOString(),
      attempts: details.attempts ?? 3,
      details: details.details ?? null,
    };

    // Atomic write
    const tmpPath = findingPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, findingPath);
  } catch {
    // Non-critical failure
  }
}
