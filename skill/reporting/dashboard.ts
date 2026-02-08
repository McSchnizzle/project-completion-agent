/**
 * Dashboard Generator
 * Task 5.2: Dashboard HTML Generation
 * Task 6.1: Schema Naming Alignment (snake_case)
 *
 * Generates an interactive HTML dashboard for
 * real-time audit progress monitoring.
 */

// Using snake_case to match JSON Schema requirements
export interface DashboardData {
  audit_id: string;
  status: string;
  started_at: string;
  current_stage: string | null;
  stages: Record<string, {
    status: string;
    progress: number;
    findings: number;
  }>;
  metrics: {
    pages_visited: number;
    pages_total: number;
    routes_covered: number;
    routes_total: number;
    findings_total: number;
    findings_by_severity: Record<string, number>;
  };
  recent_findings: Array<{
    id: string;
    severity: string;
    title: string;
    location: string;
  }>;
}

/**
 * Generate dashboard HTML
 */
export function generateDashboardHtml(data: DashboardData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="5">
  <title>Audit Dashboard - ${data.audit_id}</title>
  <style>
    :root {
      --bg: #0f172a;
      --card: #1e293b;
      --text: #e2e8f0;
      --text-muted: #94a3b8;
      --accent: #3b82f6;
      --success: #22c55e;
      --warning: #f59e0b;
      --error: #ef4444;
      --p0: #ef4444;
      --p1: #f97316;
      --p2: #eab308;
      --p3: #3b82f6;
      --p4: #6b7280;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding: 2rem;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
    }

    h1 {
      font-size: 1.5rem;
      font-weight: 600;
    }

    .status-badge {
      padding: 0.5rem 1rem;
      border-radius: 9999px;
      font-size: 0.875rem;
      font-weight: 500;
      text-transform: uppercase;
    }

    .status-running { background: var(--accent); }
    .status-completed { background: var(--success); }
    .status-failed { background: var(--error); }
    .status-paused { background: var(--warning); }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1.5rem;
      margin-bottom: 2rem;
    }

    .card {
      background: var(--card);
      border-radius: 0.75rem;
      padding: 1.5rem;
    }

    .card-title {
      font-size: 0.875rem;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .card-value {
      font-size: 2rem;
      font-weight: 700;
    }

    .card-subtitle {
      font-size: 0.875rem;
      color: var(--text-muted);
      margin-top: 0.25rem;
    }

    .progress-container {
      margin-top: 1rem;
    }

    .progress-bar {
      height: 8px;
      background: rgba(255,255,255,0.1);
      border-radius: 4px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background: var(--accent);
      transition: width 0.3s ease;
    }

    .stages-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1rem;
    }

    .stage-card {
      background: rgba(255,255,255,0.05);
      border-radius: 0.5rem;
      padding: 1rem;
      text-align: center;
    }

    .stage-card.active {
      border: 2px solid var(--accent);
    }

    .stage-card.completed {
      border: 2px solid var(--success);
    }

    .stage-card.failed {
      border: 2px solid var(--error);
    }

    .stage-name {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
    }

    .stage-progress {
      font-size: 1.25rem;
      font-weight: 600;
    }

    .findings-list {
      list-style: none;
    }

    .finding-item {
      display: flex;
      align-items: center;
      padding: 0.75rem;
      background: rgba(255,255,255,0.05);
      border-radius: 0.5rem;
      margin-bottom: 0.5rem;
    }

    .finding-severity {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
      font-weight: 700;
      margin-right: 1rem;
    }

    .severity-P0 { background: var(--p0); }
    .severity-P1 { background: var(--p1); }
    .severity-P2 { background: var(--p2); color: #000; }
    .severity-P3 { background: var(--p3); }
    .severity-P4 { background: var(--p4); }

    .finding-content {
      flex: 1;
    }

    .finding-title {
      font-weight: 500;
      margin-bottom: 0.25rem;
    }

    .finding-location {
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .severity-chart {
      display: flex;
      gap: 0.5rem;
      margin-top: 1rem;
    }

    .severity-bar {
      flex: 1;
      text-align: center;
      padding: 0.5rem;
      border-radius: 0.5rem;
    }

    .severity-bar .count {
      font-size: 1.25rem;
      font-weight: 700;
    }

    .severity-bar .label {
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    footer {
      text-align: center;
      color: var(--text-muted);
      font-size: 0.875rem;
      margin-top: 2rem;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .pulse {
      animation: pulse 2s infinite;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>Audit Dashboard</h1>
        <p style="color: var(--text-muted); margin-top: 0.25rem;">
          ${data.audit_id} • Started ${new Date(data.started_at).toLocaleString()}
        </p>
      </div>
      <span class="status-badge status-${data.status.toLowerCase()}">${data.status}</span>
    </header>

    <div class="grid">
      <div class="card">
        <div class="card-title">Route Coverage</div>
        <div class="card-value">${Math.round((data.metrics.routes_covered / Math.max(data.metrics.routes_total, 1)) * 100)}%</div>
        <div class="card-subtitle">${data.metrics.routes_covered} of ${data.metrics.routes_total} routes</div>
        <div class="progress-container">
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${Math.round((data.metrics.routes_covered / Math.max(data.metrics.routes_total, 1)) * 100)}%"></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Pages Visited</div>
        <div class="card-value">${data.metrics.pages_visited}</div>
        <div class="card-subtitle">of ${data.metrics.pages_total || '?'} total</div>
        <div class="progress-container">
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${Math.round((data.metrics.pages_visited / Math.max(data.metrics.pages_total, 1)) * 100)}%"></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Findings</div>
        <div class="card-value">${data.metrics.findings_total}</div>
        <div class="severity-chart">
          ${['P0', 'P1', 'P2', 'P3', 'P4'].map(sev => `
            <div class="severity-bar severity-${sev}" style="background: var(--${sev.toLowerCase()})">
              <div class="count">${data.metrics.findings_by_severity[sev] || 0}</div>
              <div class="label">${sev}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom: 2rem;">
      <div class="card-title">Stage Progress</div>
      <div class="stages-grid" style="margin-top: 1rem;">
        ${Object.entries(data.stages).map(([name, stage]) => `
          <div class="stage-card ${stage.status === 'running' ? 'active pulse' : ''} ${stage.status === 'completed' ? 'completed' : ''} ${stage.status === 'failed' ? 'failed' : ''}">
            <div class="stage-name">${formatStageName(name)}</div>
            <div class="stage-progress">
              ${stage.status === 'running' ? `${stage.progress}%` :
                stage.status === 'completed' ? '✓' :
                stage.status === 'failed' ? '✗' :
                stage.status === 'skipped' ? '—' : '○'}
            </div>
            ${stage.findings > 0 ? `<div class="card-subtitle">${stage.findings} findings</div>` : ''}
          </div>
        `).join('')}
      </div>
    </div>

    ${data.recent_findings.length > 0 ? `
    <div class="card">
      <div class="card-title">Recent Findings</div>
      <ul class="findings-list" style="margin-top: 1rem;">
        ${data.recent_findings.slice(0, 10).map(finding => `
          <li class="finding-item">
            <div class="finding-severity severity-${finding.severity}">${finding.severity}</div>
            <div class="finding-content">
              <div class="finding-title">${escapeHtml(finding.title)}</div>
              <div class="finding-location">${escapeHtml(finding.location)}</div>
            </div>
          </li>
        `).join('')}
      </ul>
    </div>
    ` : ''}

    <footer>
      <p>Auto-refreshes every 5 seconds • Complete Audit Agent</p>
    </footer>
  </div>
</body>
</html>`;
}

function formatStageName(name: string): string {
  const names: Record<string, string> = {
    'preflight': 'Preflight',
    'code-scan': 'Code Scan',
    'explore': 'Explore',
    'test': 'Test',
    'responsive': 'Responsive',
    'aggregate': 'Aggregate',
    'verify': 'Verify',
    'compare': 'Compare',
    'report': 'Report'
  };
  return names[name] || name;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Generate dashboard JSON for API consumption
 */
export function generateDashboardJson(data: DashboardData): string {
  return JSON.stringify(data, null, 2);
}
