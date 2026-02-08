/**
 * Progress Writer - Real-time Audit Progress
 * Task 1.6: Progress File Writer
 * Task 6.1: Schema Naming Alignment (snake_case)
 *
 * Maintains both JSON and Markdown progress files that are
 * updated in real-time as the audit progresses.
 */

import * as fs from 'fs';
import * as path from 'path';

// Using snake_case to match JSON Schema requirements
export interface StageProgress {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  started_at: string | null;
  completed_at: string | null;
  progress_percent: number;
  current_action: string | null;
  items_processed: number;
  items_total: number;
  findings_count: number;
}

export interface AuditProgress {
  schema_version: string;
  audit_id: string;
  started_at: string;
  updated_at: string;
  status: 'initializing' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped';
  current_stage: string | null;
  stages: Record<string, StageProgress>;
  metrics: {
    pages_visited: number;
    pages_total: number;
    routes_covered: number;
    routes_total: number;
    findings_total: number;
    findings_by_severity: Record<string, number>;
    verified_count: number;
    flaky_count: number;
    unverified_count: number;
  };
  focus_areas: string[] | null;
  stop_flag: boolean;
  checkpoint?: {
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

const STAGE_DISPLAY_NAMES: Record<string, string> = {
  'preflight': 'Preflight Checks',
  'code-scan': 'Code Analysis',
  'explore': 'Page Exploration',
  'test': 'Form & Action Testing',
  'responsive': 'Responsive Testing',
  'aggregate': 'Finding Aggregation',
  'verify': 'Verification',
  'compare': 'PRD Comparison',
  'report': 'Report Generation'
};

/**
 * Initialize progress tracking for a new audit
 */
export function initializeProgress(auditPath: string, auditId: string): AuditProgress {
  const progress: AuditProgress = {
    schema_version: SCHEMA_VERSION,
    audit_id: auditId,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: 'initializing',
    current_stage: null,
    stages: {},
    metrics: {
      pages_visited: 0,
      pages_total: 0,
      routes_covered: 0,
      routes_total: 0,
      findings_total: 0,
      findings_by_severity: { P0: 0, P1: 0, P2: 0, P3: 0, P4: 0 },
      verified_count: 0,
      flaky_count: 0,
      unverified_count: 0
    },
    focus_areas: null,
    stop_flag: false,
    errors: []
  };

  // Initialize all stages
  for (const stage of STAGE_ORDER) {
    progress.stages[stage] = {
      status: 'pending',
      started_at: null,
      completed_at: null,
      progress_percent: 0,
      current_action: null,
      items_processed: 0,
      items_total: 0,
      findings_count: 0
    };
  }

  writeProgress(auditPath, progress);
  return progress;
}

/**
 * Load existing progress
 */
export function loadProgress(auditPath: string): AuditProgress | null {
  const jsonPath = path.join(auditPath, 'progress.json');

  if (!fs.existsSync(jsonPath)) {
    return null;
  }

  try {
    const data = fs.readFileSync(jsonPath, 'utf-8');
    return JSON.parse(data) as AuditProgress;
  } catch {
    return null;
  }
}

/**
 * Write progress to both JSON and Markdown files
 */
export function writeProgress(auditPath: string, progress: AuditProgress): void {
  progress.updated_at = new Date().toISOString();

  // Write JSON
  const jsonPath = path.join(auditPath, 'progress.json');
  fs.writeFileSync(jsonPath, JSON.stringify(progress, null, 2));

  // Write Markdown
  const mdPath = path.join(auditPath, 'progress.md');
  fs.writeFileSync(mdPath, generateMarkdown(progress));
}

/**
 * Update overall audit status
 */
export function updateStatus(
  auditPath: string,
  status: AuditProgress['status'],
  currentStage?: string
): void {
  const progress = loadProgress(auditPath);
  if (!progress) return;

  progress.status = status;
  if (currentStage !== undefined) {
    progress.current_stage = currentStage;
  }

  writeProgress(auditPath, progress);
}

/**
 * Start a stage
 */
export function startStageProgress(
  auditPath: string,
  stageName: string,
  itemsTotal: number = 0
): void {
  const progress = loadProgress(auditPath);
  if (!progress) return;

  progress.status = 'running';
  progress.current_stage = stageName;
  progress.stages[stageName] = {
    ...progress.stages[stageName],
    status: 'running',
    started_at: new Date().toISOString(),
    progress_percent: 0,
    items_total: itemsTotal,
    items_processed: 0
  };

  writeProgress(auditPath, progress);
}

/**
 * Update stage progress
 */
export function updateStageProgress(
  auditPath: string,
  stageName: string,
  update: Partial<StageProgress>
): void {
  const progress = loadProgress(auditPath);
  if (!progress) return;

  progress.stages[stageName] = {
    ...progress.stages[stageName],
    ...update
  };

  // Calculate progress percent if items are tracked
  const stage = progress.stages[stageName];
  if (stage.items_total > 0) {
    stage.progress_percent = Math.round((stage.items_processed / stage.items_total) * 100);
  }

  writeProgress(auditPath, progress);
}

/**
 * Complete a stage
 */
export function completeStageProgress(
  auditPath: string,
  stageName: string,
  findingsCount: number = 0
): void {
  const progress = loadProgress(auditPath);
  if (!progress) return;

  progress.stages[stageName] = {
    ...progress.stages[stageName],
    status: 'completed',
    completed_at: new Date().toISOString(),
    progress_percent: 100,
    current_action: null,
    findings_count: findingsCount
  };

  writeProgress(auditPath, progress);
}

/**
 * Fail a stage
 */
export function failStageProgress(
  auditPath: string,
  stageName: string,
  error: string,
  recoverable: boolean = false
): void {
  const progress = loadProgress(auditPath);
  if (!progress) return;

  progress.stages[stageName] = {
    ...progress.stages[stageName],
    status: 'failed',
    completed_at: new Date().toISOString(),
    current_action: null
  };

  progress.errors.push({
    stage: stageName,
    error,
    timestamp: new Date().toISOString(),
    recoverable
  });

  if (!recoverable) {
    progress.status = 'failed';
  }

  writeProgress(auditPath, progress);
}

/**
 * Skip a stage
 */
export function skipStageProgress(auditPath: string, stageName: string, reason?: string): void {
  const progress = loadProgress(auditPath);
  if (!progress) return;

  progress.stages[stageName] = {
    ...progress.stages[stageName],
    status: 'skipped',
    completed_at: new Date().toISOString(),
    current_action: reason || 'Skipped'
  };

  writeProgress(auditPath, progress);
}

/**
 * Update metrics
 */
export function updateMetrics(
  auditPath: string,
  metrics: Partial<AuditProgress['metrics']>
): void {
  const progress = loadProgress(auditPath);
  if (!progress) return;

  progress.metrics = {
    ...progress.metrics,
    ...metrics
  };

  writeProgress(auditPath, progress);
}

/**
 * Increment finding count
 */
export function incrementFindings(
  auditPath: string,
  severity: string,
  stage: string
): void {
  const progress = loadProgress(auditPath);
  if (!progress) return;

  progress.metrics.findings_total++;
  if (severity in progress.metrics.findings_by_severity) {
    progress.metrics.findings_by_severity[severity]++;
  }

  if (stage in progress.stages) {
    progress.stages[stage].findings_count++;
  }

  writeProgress(auditPath, progress);
}

/**
 * Set stop flag
 */
export function setStopFlag(auditPath: string): void {
  const progress = loadProgress(auditPath);
  if (!progress) return;

  progress.stop_flag = true;
  progress.status = 'stopped';

  writeProgress(auditPath, progress);
}

/**
 * Update checkpoint reference
 */
export function setCheckpoint(
  auditPath: string,
  stage: string,
  stateFile: string
): void {
  const progress = loadProgress(auditPath);
  if (!progress) return;

  progress.checkpoint = {
    stage,
    state_file: stateFile,
    created_at: new Date().toISOString()
  };

  writeProgress(auditPath, progress);
}

/**
 * Generate Markdown progress report
 */
function generateMarkdown(progress: AuditProgress): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Audit Progress`);
  lines.push('');
  lines.push(`**Audit ID:** ${progress.audit_id}`);
  lines.push(`**Status:** ${getStatusEmoji(progress.status)} ${progress.status.toUpperCase()}`);
  lines.push(`**Started:** ${formatTime(progress.started_at)}`);
  lines.push(`**Last Updated:** ${formatTime(progress.updated_at)}`);

  if (progress.focus_areas && progress.focus_areas.length > 0) {
    lines.push(`**Focus Areas:** ${progress.focus_areas.join(', ')}`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  // Stage Progress
  lines.push('## Stage Progress');
  lines.push('');
  lines.push('| Stage | Status | Progress | Findings |');
  lines.push('|-------|--------|----------|----------|');

  for (const stage of STAGE_ORDER) {
    const s = progress.stages[stage];
    const displayName = STAGE_DISPLAY_NAMES[stage] || stage;
    const statusIcon = getStatusEmoji(s.status);
    const progressBar = getProgressBar(s.progress_percent);
    const findings = s.findings_count > 0 ? `${s.findings_count}` : '-';

    lines.push(`| ${displayName} | ${statusIcon} ${s.status} | ${progressBar} ${s.progress_percent}% | ${findings} |`);
  }

  lines.push('');

  // Current Action
  if (progress.current_stage) {
    const currentStageProgress = progress.stages[progress.current_stage];
    if (currentStageProgress.current_action) {
      lines.push(`**Current Action:** ${currentStageProgress.current_action}`);
      lines.push('');
    }
  }

  // Metrics
  lines.push('## Metrics');
  lines.push('');
  lines.push(`- **Pages Visited:** ${progress.metrics.pages_visited}/${progress.metrics.pages_total || '?'}`);
  lines.push(`- **Route Coverage:** ${progress.metrics.routes_covered}/${progress.metrics.routes_total || '?'}`);
  lines.push(`- **Total Findings:** ${progress.metrics.findings_total}`);

  if (progress.metrics.findings_total > 0) {
    lines.push('');
    lines.push('### Findings by Severity');
    lines.push('');
    for (const [sev, count] of Object.entries(progress.metrics.findings_by_severity)) {
      if (count > 0) {
        lines.push(`- **${sev}:** ${count}`);
      }
    }
  }

  if (progress.metrics.verified_count > 0 || progress.metrics.flaky_count > 0) {
    lines.push('');
    lines.push('### Verification Status');
    lines.push('');
    lines.push(`- Verified: ${progress.metrics.verified_count}`);
    lines.push(`- Flaky: ${progress.metrics.flaky_count}`);
    lines.push(`- Unverified: ${progress.metrics.unverified_count}`);
  }

  // Errors
  if (progress.errors.length > 0) {
    lines.push('');
    lines.push('## Errors');
    lines.push('');
    for (const err of progress.errors) {
      lines.push(`- **${err.stage}** (${formatTime(err.timestamp)}): ${err.error}`);
    }
  }

  return lines.join('\n');
}

function getStatusEmoji(status: string): string {
  const emojis: Record<string, string> = {
    pending: '⏳',
    running: '🔄',
    completed: '✅',
    failed: '❌',
    skipped: '⏭️',
    initializing: '🚀',
    paused: '⏸️',
    stopped: '🛑'
  };
  return emojis[status] || '❓';
}

function getProgressBar(percent: number): string {
  const filled = Math.round(percent / 10);
  const empty = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleString();
}

/**
 * Export the markdown generator for external use
 */
export function generateProgressMarkdown(progress: AuditProgress): string {
  return generateMarkdown(progress);
}

/**
 * Generate self-contained dashboard HTML
 */
export function generateDashboardHtml(progress: AuditProgress): string {
  const stagesJson = JSON.stringify(progress.stages);
  const metricsJson = JSON.stringify(progress.metrics);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="5">
  <title>Audit Progress - ${progress.audit_id}</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --success: #3fb950;
      --warning: #d29922;
      --error: #f85149;
      --info: #58a6ff;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 24px;
      min-height: 100vh;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { margin-bottom: 8px; }
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 24px;
    }
    .status-running { background: var(--info); color: white; }
    .status-completed { background: var(--success); color: white; }
    .status-failed { background: var(--error); color: white; }
    .status-stopped { background: var(--warning); color: black; }
    .status-paused { background: var(--text-muted); color: white; }
    .status-initializing { background: var(--info); color: white; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .card h2 { font-size: 16px; margin-bottom: 12px; color: var(--text); }
    .stages-grid { display: grid; gap: 8px; }
    .stage-row {
      display: grid;
      grid-template-columns: 200px 100px 1fr 80px;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid var(--border);
    }
    .stage-row:last-child { border-bottom: none; }
    .stage-name { font-weight: 500; }
    .stage-status { font-size: 13px; }
    .progress-bar {
      height: 8px;
      background: var(--border);
      border-radius: 4px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: var(--info);
      transition: width 0.3s ease;
    }
    .progress-fill.complete { background: var(--success); }
    .progress-fill.failed { background: var(--error); }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
    }
    .metric { text-align: center; }
    .metric-value { font-size: 32px; font-weight: 700; color: var(--info); }
    .metric-label { font-size: 13px; color: var(--text-muted); }
    .findings-grid { display: flex; gap: 16px; flex-wrap: wrap; }
    .finding-badge {
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 13px;
      font-weight: 600;
    }
    .finding-p0 { background: #f85149; color: white; }
    .finding-p1 { background: #d29922; color: black; }
    .finding-p2 { background: #58a6ff; color: white; }
    .finding-p3 { background: #8b949e; color: white; }
    .finding-p4 { background: #30363d; color: var(--text); }
    .updated { font-size: 12px; color: var(--text-muted); margin-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Audit Progress</h1>
    <span class="status-badge status-${progress.status}">${progress.status.toUpperCase()}</span>

    <div class="card">
      <h2>Stages</h2>
      <div class="stages-grid">
        ${STAGE_ORDER.map(stage => {
          const s = progress.stages[stage];
          const displayName = STAGE_DISPLAY_NAMES[stage] || stage;
          const statusClass = s.status === 'completed' ? 'complete' : s.status === 'failed' ? 'failed' : '';
          return `
            <div class="stage-row">
              <span class="stage-name">${displayName}</span>
              <span class="stage-status">${s.status}</span>
              <div class="progress-bar">
                <div class="progress-fill ${statusClass}" style="width: ${s.progress_percent}%"></div>
              </div>
              <span>${s.findings_count > 0 ? s.findings_count + ' findings' : ''}</span>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <div class="card">
      <h2>Metrics</h2>
      <div class="metrics-grid">
        <div class="metric">
          <div class="metric-value">${progress.metrics.pages_visited}</div>
          <div class="metric-label">Pages Visited</div>
        </div>
        <div class="metric">
          <div class="metric-value">${progress.metrics.routes_covered}/${progress.metrics.routes_total || '?'}</div>
          <div class="metric-label">Routes Covered</div>
        </div>
        <div class="metric">
          <div class="metric-value">${progress.metrics.findings_total}</div>
          <div class="metric-label">Total Findings</div>
        </div>
        <div class="metric">
          <div class="metric-value">${progress.metrics.verified_count}</div>
          <div class="metric-label">Verified</div>
        </div>
      </div>
    </div>

    ${progress.metrics.findings_total > 0 ? `
    <div class="card">
      <h2>Findings by Severity</h2>
      <div class="findings-grid">
        ${Object.entries(progress.metrics.findings_by_severity)
          .filter(([, count]) => count > 0)
          .map(([sev, count]) => `<span class="finding-badge finding-${sev.toLowerCase()}">${sev}: ${count}</span>`)
          .join('')}
      </div>
    </div>
    ` : ''}

    <p class="updated">Last updated: ${formatTime(progress.updated_at)} (auto-refreshes every 5 seconds)</p>
  </div>
</body>
</html>`;
}

/**
 * Write dashboard HTML file
 */
export function writeDashboard(auditPath: string, progress: AuditProgress): void {
  const dashboardPath = path.join(auditPath, 'dashboard.html');
  fs.writeFileSync(dashboardPath, generateDashboardHtml(progress));
}

/**
 * Check for stop flag file
 */
export function checkStopFlagFile(auditPath: string): boolean {
  const flagPath = path.join(auditPath, 'stop.flag');
  return fs.existsSync(flagPath);
}

/**
 * Check for continue flag file
 */
export function checkContinueFlagFile(auditPath: string): boolean {
  const flagPath = path.join(auditPath, 'continue.flag');
  return fs.existsSync(flagPath);
}

/**
 * Clear the continue flag after processing
 */
export function clearContinueFlag(auditPath: string): void {
  const flagPath = path.join(auditPath, 'continue.flag');
  if (fs.existsSync(flagPath)) {
    fs.unlinkSync(flagPath);
  }
}

/**
 * Set paused status
 */
export function setPaused(auditPath: string): void {
  const progress = loadProgress(auditPath);
  if (!progress) return;

  progress.status = 'paused';
  writeProgress(auditPath, progress);
}

/**
 * Resume from paused state
 */
export function resumeProgress(auditPath: string): void {
  const progress = loadProgress(auditPath);
  if (!progress) return;

  progress.status = 'running';
  progress.stop_flag = false;
  writeProgress(auditPath, progress);

  // Clear continue flag if it exists
  clearContinueFlag(auditPath);
}
