/**
 * Resume Support - Restore audit state from checkpoint.
 *
 * Reads checkpoint.json to determine the last completed phase
 * and restores the orchestrator to resume from the next phase.
 *
 * @module phases/resume
 */

import fs from 'node:fs';
import {
  getCheckpointPath,
  getProgressPath,
} from '../artifact-paths';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckpointData {
  auditId: string;
  lastCompletedPhase: string;
  completedPhases: string[];
  timestamp: string;
  resumable: boolean;
  stateSnapshot?: Record<string, unknown>;
}

export interface ResumeResult {
  canResume: boolean;
  checkpoint?: CheckpointData;
  nextPhase?: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Pipeline phase order (must match phase-registry.ts)
// ---------------------------------------------------------------------------

const PHASE_ORDER = [
  'preflight',
  'prd-parsing',
  'code-analysis',
  'progress-init',
  'safety',
  'exploration',
  'form-testing',
  'responsive-testing',
  'finding-quality',
  'reporting',
  'interactive-review',
  'github-issues',
  'verification',
  'polish',
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Check if the audit can be resumed and determine the next phase.
 *
 * @param auditDir - The audit output directory.
 * @returns Resume result with checkpoint data and next phase.
 */
export function checkResume(auditDir: string): ResumeResult {
  const checkpointPath = getCheckpointPath(auditDir);

  if (!fs.existsSync(checkpointPath)) {
    return { canResume: false, reason: 'No checkpoint file found' };
  }

  let checkpoint: CheckpointData;
  try {
    checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'));
  } catch (e) {
    return { canResume: false, reason: `Invalid checkpoint file: ${e}` };
  }

  if (!checkpoint.resumable) {
    return {
      canResume: false,
      checkpoint,
      reason: 'Checkpoint marked as non-resumable',
    };
  }

  // Determine next phase
  const lastPhaseIndex = PHASE_ORDER.indexOf(checkpoint.lastCompletedPhase);
  if (lastPhaseIndex === -1) {
    return {
      canResume: false,
      checkpoint,
      reason: `Unknown phase: ${checkpoint.lastCompletedPhase}`,
    };
  }

  if (lastPhaseIndex >= PHASE_ORDER.length - 1) {
    return {
      canResume: false,
      checkpoint,
      reason: 'All phases already completed',
    };
  }

  const nextPhase = PHASE_ORDER[lastPhaseIndex + 1];

  return {
    canResume: true,
    checkpoint,
    nextPhase,
  };
}

/**
 * Save a checkpoint after completing a phase.
 *
 * @param auditDir - The audit output directory.
 * @param phaseName - The phase that just completed.
 * @param completedPhases - All completed phases so far.
 * @param stateSnapshot - Optional state to preserve.
 */
export function saveCheckpoint(
  auditDir: string,
  phaseName: string,
  completedPhases: string[],
  stateSnapshot?: Record<string, unknown>,
): void {
  const checkpoint: CheckpointData = {
    auditId: readAuditId(auditDir),
    lastCompletedPhase: phaseName,
    completedPhases,
    timestamp: new Date().toISOString(),
    resumable: true,
    stateSnapshot,
  };

  const tmpPath = getCheckpointPath(auditDir) + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(checkpoint, null, 2), 'utf-8');
  fs.renameSync(tmpPath, getCheckpointPath(auditDir));
}

/**
 * Get the list of phases to run, skipping already-completed ones.
 *
 * @param resumeResult - Result from checkResume().
 * @returns Ordered list of phase names to execute.
 */
export function getPhasesToRun(resumeResult: ResumeResult): string[] {
  if (!resumeResult.canResume || !resumeResult.nextPhase) {
    return [...PHASE_ORDER];
  }

  const startIndex = PHASE_ORDER.indexOf(resumeResult.nextPhase);
  return PHASE_ORDER.slice(startIndex);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readAuditId(auditDir: string): string {
  const progressPath = getProgressPath(auditDir);
  if (fs.existsSync(progressPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(progressPath, 'utf-8'));
      return data.audit_id ?? 'unknown';
    } catch {
      // fall through
    }
  }
  return 'unknown';
}
