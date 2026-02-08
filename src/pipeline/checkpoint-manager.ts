/**
 * Checkpoint Manager - Atomic checkpoint save/restore for audit resume.
 *
 * Provides reliable checkpoint persistence using atomic writes (write to
 * .tmp then rename) so that a crash mid-write never corrupts the
 * checkpoint file. The orchestrator calls `saveCheckpoint` after every
 * phase completion and `loadCheckpoint` / `shouldResume` on startup.
 *
 * @module pipeline/checkpoint-manager
 */

import * as fs from 'node:fs';
import { getCheckpointPath } from '../artifact-paths.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckpointState {
  /** The phase currently executing (null if between phases). */
  currentPhase: string | null;
  /** Phases that completed successfully. */
  completedPhases: string[];
  /** URLs already visited by browser phases. */
  visitedUrls: string[];
  /** URLs still queued for exploration. */
  explorationQueue: string[];
  /** Total findings discovered so far. */
  findingsCount: number;
  /** Wall-clock time elapsed before this checkpoint (ms). */
  elapsedMs: number;
  /** ISO timestamp of when this checkpoint was saved. */
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Save a checkpoint atomically.
 *
 * Writes to a temporary file first, then renames. This guarantees that
 * the checkpoint file is always complete and parseable even if the
 * process is killed mid-write.
 */
export function saveCheckpoint(auditDir: string, state: CheckpointState): void {
  const target = getCheckpointPath(auditDir);
  const tmp = target + '.tmp';

  const data = JSON.stringify(state, null, 2);
  fs.writeFileSync(tmp, data, 'utf-8');
  fs.renameSync(tmp, target);
}

/**
 * Load and validate a checkpoint from disk.
 *
 * Returns `null` if the file does not exist or is malformed.
 */
export function loadCheckpoint(auditDir: string): CheckpointState | null {
  const target = getCheckpointPath(auditDir);

  if (!fs.existsSync(target)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(target, 'utf-8');
    const data = JSON.parse(raw);

    if (!isValidCheckpoint(data)) {
      return null;
    }

    return data as CheckpointState;
  } catch {
    return null;
  }
}

/**
 * Check whether a valid, resumable checkpoint exists.
 */
export function shouldResume(auditDir: string): boolean {
  const cp = loadCheckpoint(auditDir);
  if (!cp) return false;
  return cp.completedPhases.length > 0;
}

/**
 * Build a CheckpointState from orchestrator data.
 *
 * Convenience helper so callers don't have to construct the object
 * manually each time.
 */
export function buildCheckpointState(params: {
  currentPhase?: string | null;
  completedPhases: string[];
  visitedUrls?: string[];
  explorationQueue?: string[];
  findingsCount?: number;
  elapsedMs?: number;
}): CheckpointState {
  return {
    currentPhase: params.currentPhase ?? null,
    completedPhases: params.completedPhases,
    visitedUrls: params.visitedUrls ?? [],
    explorationQueue: params.explorationQueue ?? [],
    findingsCount: params.findingsCount ?? 0,
    elapsedMs: params.elapsedMs ?? 0,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isValidCheckpoint(data: unknown): data is CheckpointState {
  if (typeof data !== 'object' || data === null) return false;

  const obj = data as Record<string, unknown>;

  if (!Array.isArray(obj.completedPhases)) return false;
  if (typeof obj.timestamp !== 'string') return false;
  if (typeof obj.elapsedMs !== 'number') return false;
  if (typeof obj.findingsCount !== 'number') return false;

  return true;
}
