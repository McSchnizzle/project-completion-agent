/**
 * Checkpoint Manager - Stage State Persistence
 * Task 1.3: Stage Communication Protocol
 * Task 6.3: Checkpoint Schema Alignment
 *
 * Handles saving and restoring audit state for resumability.
 * Each stage writes its state on completion, allowing audits
 * to be resumed from any checkpoint.
 */

import * as fs from 'fs';
import * as path from 'path';

// Using snake_case to match stage-state.schema.json
export interface StageOutput {
  status: 'complete' | 'partial' | 'failed';
  paths: string[];
  metrics: Record<string, number | string>;
}

export interface ResumePoint {
  stage: string;
  progress: Record<string, unknown>;
  last_url: string | null;
  queue_position: number;
}

export interface SessionState {
  cookies: Array<{
    name: string;
    value: string;
    path: string;
    httpOnly: boolean;
  }>;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  captured_at: string;
}

export interface CheckpointError {
  stage: string;
  error: string;
  timestamp: string;
  recoverable: boolean;
}

export interface Checkpoint {
  schema_version: string;
  audit_id: string;
  current_stage: string | null;
  completed_stages: string[];
  status: 'running' | 'paused' | 'stopped' | 'complete' | 'failed';
  stage_outputs: Record<string, StageOutput>;
  resume_point: ResumePoint | null;
  session_state: SessionState | null;
  errors: CheckpointError[];
  started_at: string;
  updated_at: string;
  can_resume: boolean;
}

// Legacy interface for backwards compatibility
export interface StageState {
  schema_version: string;
  stage: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  started_at: string | null;
  completed_at: string | null;
  error?: string | null;
  input_files: string[];
  output_files: string[];
  session_state?: SessionState;
  metrics?: Record<string, number | string>;
}

const SCHEMA_VERSION = '1.0.0';
const STAGE_ORDER = [
  'preflight',
  'code-scan',
  'explore',
  'test',
  'responsive',
  'aggregate',
  'verify',
  'compare',
  'report'
];

/**
 * Get the audit directory path
 */
export function getAuditPath(projectRoot: string, auditId: string): string {
  return path.join(projectRoot, '.complete-agent', 'audits', auditId);
}

/**
 * Get the stage state directory path
 */
export function getStageStatePath(auditPath: string): string {
  return path.join(auditPath, 'stage-state');
}

/**
 * Initialize checkpoint for a new audit
 */
export function initializeCheckpoint(auditPath: string, auditId: string): Checkpoint {
  const stageStatePath = getStageStatePath(auditPath);

  // Ensure directories exist
  fs.mkdirSync(stageStatePath, { recursive: true });

  const now = new Date().toISOString();

  const checkpoint: Checkpoint = {
    schema_version: SCHEMA_VERSION,
    audit_id: auditId,
    current_stage: null,
    completed_stages: [],
    status: 'running',
    stage_outputs: {},
    resume_point: {
      stage: 'preflight',
      progress: {},
      last_url: null,
      queue_position: 0
    },
    session_state: null,
    errors: [],
    started_at: now,
    updated_at: now,
    can_resume: true
  };

  saveCheckpoint(auditPath, checkpoint);
  return checkpoint;
}

/**
 * Load existing checkpoint from disk
 */
export function loadCheckpoint(auditPath: string): Checkpoint | null {
  const checkpointPath = path.join(auditPath, 'checkpoint.json');

  if (!fs.existsSync(checkpointPath)) {
    return null;
  }

  try {
    const data = fs.readFileSync(checkpointPath, 'utf-8');
    return JSON.parse(data) as Checkpoint;
  } catch (error) {
    console.error('Failed to load checkpoint:', error);
    return null;
  }
}

/**
 * Save checkpoint to disk
 */
export function saveCheckpoint(auditPath: string, checkpoint: Checkpoint): void {
  checkpoint.updated_at = new Date().toISOString();
  const checkpointPath = path.join(auditPath, 'checkpoint.json');
  fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
}

/**
 * Mark a stage as started
 */
export function startStage(
  auditPath: string,
  stageName: string,
  inputFiles: string[] = []
): StageState {
  const checkpoint = loadCheckpoint(auditPath);
  if (!checkpoint) {
    throw new Error('No checkpoint found. Initialize audit first.');
  }

  // Update checkpoint
  checkpoint.current_stage = stageName;
  checkpoint.status = 'running';
  checkpoint.resume_point = {
    stage: stageName,
    progress: {},
    last_url: null,
    queue_position: 0
  };

  saveCheckpoint(auditPath, checkpoint);

  // Create stage state file
  const state: StageState = {
    schema_version: SCHEMA_VERSION,
    stage: stageName,
    status: 'running',
    started_at: new Date().toISOString(),
    completed_at: null,
    input_files: inputFiles,
    output_files: []
  };

  saveStageState(auditPath, stageName, state);

  return state;
}

/**
 * Mark a stage as completed
 */
export function completeStage(
  auditPath: string,
  stageName: string,
  outputFiles: string[],
  sessionState?: SessionState,
  metrics?: Record<string, number | string>
): StageState {
  const checkpoint = loadCheckpoint(auditPath);
  if (!checkpoint) {
    throw new Error('No checkpoint found.');
  }

  // Update checkpoint
  if (!checkpoint.completed_stages.includes(stageName)) {
    checkpoint.completed_stages.push(stageName);
  }

  checkpoint.stage_outputs[stageName] = {
    status: 'complete',
    paths: outputFiles,
    metrics: metrics || {}
  };

  checkpoint.current_stage = null;

  // Update resume point to next stage
  const nextStage = getNextStage(stageName);
  if (nextStage) {
    checkpoint.resume_point = {
      stage: nextStage,
      progress: {},
      last_url: null,
      queue_position: 0
    };
    checkpoint.can_resume = true;
  } else {
    checkpoint.resume_point = null;
    checkpoint.status = 'complete';
    checkpoint.can_resume = false;
  }

  // Update session state if provided
  if (sessionState) {
    checkpoint.session_state = sessionState;
  }

  saveCheckpoint(auditPath, checkpoint);

  // Update stage state file
  const state: StageState = {
    schema_version: SCHEMA_VERSION,
    stage: stageName,
    status: 'completed',
    started_at: checkpoint.started_at,
    completed_at: new Date().toISOString(),
    input_files: [],
    output_files: outputFiles,
    session_state: sessionState,
    metrics
  };

  saveStageState(auditPath, stageName, state);

  return state;
}

/**
 * Mark a stage as failed
 */
export function failStage(
  auditPath: string,
  stageName: string,
  error: string,
  recoverable: boolean = true
): StageState {
  const checkpoint = loadCheckpoint(auditPath);
  if (!checkpoint) {
    throw new Error('No checkpoint found.');
  }

  // Add error to checkpoint
  checkpoint.errors.push({
    stage: stageName,
    error,
    timestamp: new Date().toISOString(),
    recoverable
  });

  // Update stage output
  checkpoint.stage_outputs[stageName] = {
    status: 'failed',
    paths: [],
    metrics: {}
  };

  // Can resume from the failed stage if recoverable
  if (recoverable) {
    checkpoint.resume_point = {
      stage: stageName,
      progress: {},
      last_url: null,
      queue_position: 0
    };
    checkpoint.can_resume = true;
    checkpoint.status = 'paused';
  } else {
    checkpoint.status = 'failed';
    checkpoint.can_resume = false;
  }

  checkpoint.current_stage = null;

  saveCheckpoint(auditPath, checkpoint);

  // Update stage state file
  const state: StageState = {
    schema_version: SCHEMA_VERSION,
    stage: stageName,
    status: 'failed',
    started_at: checkpoint.started_at,
    completed_at: new Date().toISOString(),
    error,
    input_files: [],
    output_files: []
  };

  saveStageState(auditPath, stageName, state);

  return state;
}

/**
 * Update resume point progress
 */
export function updateResumePoint(
  auditPath: string,
  progress: Partial<ResumePoint>
): void {
  const checkpoint = loadCheckpoint(auditPath);
  if (!checkpoint) return;

  checkpoint.resume_point = {
    ...checkpoint.resume_point!,
    ...progress
  };

  saveCheckpoint(auditPath, checkpoint);
}

/**
 * Save session state
 */
export function saveSessionState(
  auditPath: string,
  sessionState: SessionState
): void {
  const checkpoint = loadCheckpoint(auditPath);
  if (!checkpoint) return;

  checkpoint.session_state = {
    ...sessionState,
    captured_at: new Date().toISOString()
  };

  saveCheckpoint(auditPath, checkpoint);
}

/**
 * Save individual stage state file
 */
function saveStageState(auditPath: string, stageName: string, state: StageState): void {
  const stageStatePath = getStageStatePath(auditPath);
  const filePath = path.join(stageStatePath, `${stageName}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

/**
 * Load individual stage state file
 */
export function loadStageState(auditPath: string, stageName: string): StageState | null {
  const stageStatePath = getStageStatePath(auditPath);
  const filePath = path.join(stageStatePath, `${stageName}.json`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as StageState;
  } catch {
    return null;
  }
}

/**
 * Get the next stage in the pipeline
 */
function getNextStage(currentStage: string): string | null {
  const currentIndex = STAGE_ORDER.indexOf(currentStage);
  if (currentIndex === -1 || currentIndex === STAGE_ORDER.length - 1) {
    return null;
  }
  return STAGE_ORDER[currentIndex + 1];
}

/**
 * Get stages that can be skipped (already completed)
 */
export function getSkippableStages(checkpoint: Checkpoint): string[] {
  return checkpoint.completed_stages;
}

/**
 * Check if stop flag exists
 */
export function checkStopFlag(auditPath: string): boolean {
  const stopFlagPath = path.join(auditPath, 'stop.flag');
  return fs.existsSync(stopFlagPath);
}

/**
 * Check if continue flag exists (for paused audits)
 */
export function checkContinueFlag(auditPath: string): boolean {
  const continueFlagPath = path.join(auditPath, 'continue.flag');
  if (fs.existsSync(continueFlagPath)) {
    // Remove the flag after reading
    fs.unlinkSync(continueFlagPath);
    return true;
  }
  return false;
}

/**
 * Determine which stage to resume from
 */
export function determineResumePoint(auditPath: string, checkpoint?: Checkpoint | null): ResumePoint | null {
  const cp = checkpoint || loadCheckpoint(auditPath);
  if (!cp || !cp.can_resume) {
    return null;
  }
  return cp.resume_point;
}

/**
 * Get completed stages from checkpoint
 */
export function getCompletedStages(auditPath: string): string[] {
  const checkpoint = loadCheckpoint(auditPath);
  return checkpoint?.completed_stages || [];
}

/**
 * Mark checkpoint as stopped
 */
export function stopCheckpoint(auditPath: string): void {
  const checkpoint = loadCheckpoint(auditPath);
  if (!checkpoint) return;

  checkpoint.status = 'stopped';
  checkpoint.current_stage = null;

  saveCheckpoint(auditPath, checkpoint);
}

/**
 * Mark checkpoint as paused
 */
export function pauseCheckpoint(auditPath: string): void {
  const checkpoint = loadCheckpoint(auditPath);
  if (!checkpoint) return;

  checkpoint.status = 'paused';

  saveCheckpoint(auditPath, checkpoint);
}
