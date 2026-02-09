/**
 * Progress Initialization - Create initial progress tracking state.
 *
 * Initializes the progress.json file and progress.md markdown summary at
 * the start of an audit run. These files are updated throughout the pipeline
 * to provide real-time visibility into audit progress.
 *
 * @module phases/progress-init
 */

import fs from 'node:fs';
import path from 'node:path';
import type { AuditConfig } from '../config.js';
import { getProgressPath } from '../artifact-paths.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Status of an individual stage in the pipeline.
 */
export interface StageStatus {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  started_at: string | null;
  completed_at: string | null;
  progress_percent: number;
  current_action: string | null;
  items_processed: number;
  items_total: number;
  findings_count: number;
}

/**
 * Progress metrics aggregated across all stages.
 */
export interface ProgressMetrics {
  pages_visited: number;
  pages_total: number;
  routes_covered: number;
  routes_total: number;
  findings_total: number;
  findings_by_severity: {
    P0: number;
    P1: number;
    P2: number;
    P3: number;
    P4: number;
  };
  verified_count: number;
  flaky_count: number;
  unverified_count: number;
}

/**
 * Complete progress state for an audit run.
 */
export interface ProgressState {
  schema_version: string;
  audit_id: string;
  started_at: string;
  updated_at?: string;
  status: 'initializing' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped';
  current_stage: string | null;
  stages: Record<string, StageStatus>;
  metrics: ProgressMetrics;
  /** Number of phases that have completed so far. */
  phases_completed: number;
  /** Total number of phases in the pipeline. */
  total_phases: number;
  /** Estimated milliseconds remaining based on average phase duration. Null if no phases completed yet. */
  estimated_remaining_ms: number | null;
  focus_areas: string[] | null;
  stop_flag: boolean;
  checkpoint: {
    stage: string;
    state_file: string;
    created_at: string;
  } | null;
  errors: Array<{
    stage: string;
    error: string;
    timestamp: string;
    recoverable: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Initialize progress tracking for a new audit run.
 *
 * Creates both progress.json (machine-readable) and progress.md (human-readable)
 * files with initial state. All stages start in 'pending' status and metrics
 * are initialized to zero.
 *
 * @param auditDir - The audit output directory.
 * @param config - The audit configuration.
 * @returns Initial progress state.
 */
export function initProgress(auditDir: string, config: AuditConfig): ProgressState {
  const now = new Date().toISOString();
  const progressPath = getProgressPath(auditDir);

  // If progress already exists (created by orchestrator), merge into it
  // rather than overwriting with hardcoded stage names
  if (fs.existsSync(progressPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(progressPath, 'utf-8')) as ProgressState & { target_url?: string; coverage?: Record<string, unknown> };
      existing.updated_at = now;
      // Add coverage tracking metadata if not present
      if (!existing.coverage) {
        (existing as any).coverage = {
          pages_visited: 0,
          forms_tested: 0,
          features_checked: 0,
        };
      }
      fs.writeFileSync(progressPath, JSON.stringify(existing, null, 2), 'utf-8');

      // Write progress.md
      const progressMdPath = path.join(auditDir, 'progress.md');
      const markdown = generateProgressMarkdown(existing, config);
      fs.writeFileSync(progressMdPath, markdown, 'utf-8');

      console.log(`\n📊 Progress tracking merged: ${progressPath}`);
      console.log(`📝 Progress summary: ${progressMdPath}\n`);

      return existing;
    } catch {
      // Fall through to fresh creation if parse fails
    }
  }

  // Fallback: create fresh (shouldn't happen in normal flow since
  // orchestrator creates progress first, but needed for standalone runs)
  const stageNames = [
    'progress-init',
    'prd-parsing',
    'code-analysis',
    'exploration',
    'form-testing',
    'responsive',
    'finding-quality',
    'verification',
    'report-generation',
  ];

  // Initialize all stages to pending
  const stages: Record<string, StageStatus> = {};
  for (const stageName of stageNames) {
    stages[stageName] = {
      status: 'pending',
      started_at: null,
      completed_at: null,
      progress_percent: 0,
      current_action: null,
      items_processed: 0,
      items_total: 0,
      findings_count: 0,
    };
  }

  // Create initial state
  const state: ProgressState & { target_url?: string } = {
    schema_version: '1.0.0',
    audit_id: config.auditId,
    started_at: now,
    updated_at: now,
    target_url: config.url,
    status: 'running',
    current_stage: null,
    stages,
    metrics: {
      pages_visited: 0,
      pages_total: config.maxPages,
      routes_covered: 0,
      routes_total: 0,
      findings_total: 0,
      findings_by_severity: {
        P0: 0,
        P1: 0,
        P2: 0,
        P3: 0,
        P4: 0,
      },
      verified_count: 0,
      flaky_count: 0,
      unverified_count: 0,
    },
    phases_completed: 0,
    total_phases: stageNames.length,
    estimated_remaining_ms: null,
    focus_areas: config.focusPatterns || null,
    stop_flag: false,
    checkpoint: null,
    errors: [],
  };

  // Write progress.json
  fs.writeFileSync(progressPath, JSON.stringify(state, null, 2), 'utf-8');

  // Write progress.md
  const progressMdPath = path.join(auditDir, 'progress.md');
  const markdown = generateProgressMarkdown(state, config);
  fs.writeFileSync(progressMdPath, markdown, 'utf-8');

  console.log(`\n📊 Progress tracking initialized: ${progressPath}`);
  console.log(`📝 Progress summary: ${progressMdPath}\n`);

  return state;
}

// ---------------------------------------------------------------------------
// Progress update helpers
// ---------------------------------------------------------------------------

/**
 * Update progress after a phase completes or fails.
 *
 * Recalculates phases_completed, estimated_remaining_ms (ETA based on
 * average completed phase duration), and per-phase timing.
 *
 * @param auditDir - The audit output directory.
 * @param phaseName - The phase that just completed/failed.
 * @param status - New status for the phase.
 */
export function updateProgressPhase(
  auditDir: string,
  phaseName: string,
  status: StageStatus['status'],
): void {
  const progressPath = getProgressPath(auditDir);

  if (!fs.existsSync(progressPath)) return;

  try {
    const state: ProgressState = JSON.parse(fs.readFileSync(progressPath, 'utf-8'));
    const now = new Date().toISOString();

    // Ensure stage entry exists
    if (!state.stages[phaseName]) {
      state.stages[phaseName] = {
        status: 'pending',
        started_at: null,
        completed_at: null,
        progress_percent: 0,
        current_action: null,
        items_processed: 0,
        items_total: 0,
        findings_count: 0,
      };
    }

    const stage = state.stages[phaseName];
    stage.status = status;

    if (status === 'running' && !stage.started_at) {
      stage.started_at = now;
    }

    if (status === 'completed' || status === 'failed') {
      stage.completed_at = now;
      stage.progress_percent = 100;
    }

    // Recalculate aggregate fields
    const allStages = Object.values(state.stages);
    const completed = allStages.filter((s) => s.status === 'completed');
    state.phases_completed = completed.length;
    state.total_phases = allStages.length;
    state.current_stage = status === 'running' ? phaseName : null;

    // Calculate ETA from average completed phase duration
    if (completed.length > 0) {
      const durations = completed
        .filter((s) => s.started_at && s.completed_at)
        .map((s) => new Date(s.completed_at!).getTime() - new Date(s.started_at!).getTime());

      if (durations.length > 0) {
        const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
        const remaining = state.total_phases - state.phases_completed;
        state.estimated_remaining_ms = Math.round(avgDuration * remaining);
      }
    }

    state.updated_at = now;
    fs.writeFileSync(progressPath, JSON.stringify(state, null, 2), 'utf-8');
  } catch (error) {
    console.warn(`[ProgressInit] Failed to update progress for ${phaseName}: ${error}`);
  }
}

/**
 * Read the current progress state from disk.
 */
export function readProgress(auditDir: string): ProgressState | null {
  const progressPath = getProgressPath(auditDir);

  if (!fs.existsSync(progressPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(progressPath, 'utf-8')) as ProgressState;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Markdown generation
// ---------------------------------------------------------------------------

/**
 * Generate a human-readable markdown summary of progress.
 */
function generateProgressMarkdown(state: ProgressState, config: AuditConfig): string {
  const lines: string[] = [];

  lines.push(`# Audit Progress: ${state.audit_id}`);
  lines.push('');
  lines.push(`**Started:** ${new Date(state.started_at).toLocaleString()}`);
  lines.push(`**Status:** ${state.status}`);
  lines.push(`**Current Stage:** ${state.current_stage || 'Not started'}`);
  lines.push('');

  // Configuration summary
  lines.push('## Configuration');
  lines.push('');
  lines.push(`- **URL:** ${config.url}`);
  lines.push(`- **Mode:** ${config.mode}`);
  lines.push(`- **Browser:** ${config.browser}`);
  lines.push(`- **Max Pages:** ${config.maxPages}`);
  lines.push(`- **Max Forms:** ${config.maxForms}`);
  if (config.focusPatterns && config.focusPatterns.length > 0) {
    lines.push(`- **Focus Areas:** ${config.focusPatterns.join(', ')}`);
  }
  lines.push('');

  // Stage status table
  lines.push('## Pipeline Stages');
  lines.push('');
  lines.push('| Stage | Status | Progress | Findings |');
  lines.push('|-------|--------|----------|----------|');

  for (const [stageName, stageStatus] of Object.entries(state.stages)) {
    const status = stageStatus.status;
    const progress = `${stageStatus.progress_percent}%`;
    const findings = stageStatus.findings_count > 0 ? String(stageStatus.findings_count) : '-';

    const statusIcon = getStatusIcon(status);
    lines.push(`| ${stageName} | ${statusIcon} ${status} | ${progress} | ${findings} |`);
  }

  lines.push('');

  // Metrics summary
  lines.push('## Metrics');
  lines.push('');
  lines.push(`- **Pages Visited:** ${state.metrics.pages_visited} / ${state.metrics.pages_total}`);
  lines.push(`- **Routes Covered:** ${state.metrics.routes_covered} / ${state.metrics.routes_total}`);
  lines.push(`- **Findings:** ${state.metrics.findings_total}`);
  lines.push('');

  if (state.metrics.findings_total > 0) {
    lines.push('### Findings by Severity');
    lines.push('');
    lines.push('| Severity | Count |');
    lines.push('|----------|-------|');
    lines.push(`| P0 (Critical) | ${state.metrics.findings_by_severity.P0} |`);
    lines.push(`| P1 (High) | ${state.metrics.findings_by_severity.P1} |`);
    lines.push(`| P2 (Medium) | ${state.metrics.findings_by_severity.P2} |`);
    lines.push(`| P3 (Low) | ${state.metrics.findings_by_severity.P3} |`);
    lines.push(`| P4 (Info) | ${state.metrics.findings_by_severity.P4} |`);
    lines.push('');
  }

  // Errors if any
  if (state.errors.length > 0) {
    lines.push('## Errors');
    lines.push('');
    for (const error of state.errors) {
      lines.push(`- **[${error.stage}]** ${error.error} (${new Date(error.timestamp).toLocaleString()})`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Last updated: ${new Date().toLocaleString()}*`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Get an icon for a stage status.
 */
function getStatusIcon(status: StageStatus['status']): string {
  switch (status) {
    case 'pending':
      return '⏸️';
    case 'running':
      return '▶️';
    case 'completed':
      return '✅';
    case 'failed':
      return '❌';
    case 'skipped':
      return '⊗';
    default:
      return '❓';
  }
}
