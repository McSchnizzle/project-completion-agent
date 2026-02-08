/**
 * Dashboard Server - Live HTTP server for real-time audit monitoring.
 *
 * Serves a single-page HTML dashboard that polls `/api/progress` every
 * 2 seconds. Displays current phase, findings table, coverage bar,
 * elapsed time, and the last 20 action log entries.
 *
 * Uses only Node's built-in `http` module (no external dependencies).
 * Auto-selects an available port starting at 3847.
 *
 * @module reporting/dashboard-server
 */

import * as http from 'node:http';
import * as fs from 'node:fs';
import {
  getProgressPath,
  getAuditLogPath,
  getFindingDir,
} from '../artifact-paths.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardServerOptions {
  /** Audit output directory to read state from. */
  auditDir: string;
  /** Starting port to try (default: 3847). */
  startPort?: number;
}

export interface DashboardServer {
  /** The URL the dashboard is available at. */
  url: string;
  /** The port the server is listening on. */
  port: number;
  /** Gracefully shut down the server. */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------

function readProgress(auditDir: string): Record<string, unknown> {
  const progressPath = getProgressPath(auditDir);

  if (!fs.existsSync(progressPath)) {
    return { status: 'initializing', stages: {}, metrics: {} };
  }

  try {
    return JSON.parse(fs.readFileSync(progressPath, 'utf-8'));
  } catch {
    return { status: 'error', error: 'Failed to parse progress.json' };
  }
}

function readActionLog(auditDir: string, limit: number = 20): unknown[] {
  const logPath = getAuditLogPath(auditDir);

  if (!fs.existsSync(logPath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(logPath, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim());
    const entries: unknown[] = [];

    for (const line of lines.slice(-limit)) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // skip
      }
    }

    return entries.reverse();
  } catch {
    return [];
  }
}

function readFindings(auditDir: string): unknown[] {
  const findingDir = getFindingDir(auditDir);

  if (!fs.existsSync(findingDir)) {
    return [];
  }

  try {
    const files = fs.readdirSync(findingDir).filter((f) => f.endsWith('.json'));
    const findings: unknown[] = [];

    for (const file of files) {
      try {
        const data = JSON.parse(
          fs.readFileSync(`${findingDir}/${file}`, 'utf-8'),
        );
        findings.push({
          id: data.id || file.replace('.json', ''),
          severity: data.severity || 'P3',
          title: data.title || data.description || 'Untitled',
          location: data.location || data.url || '',
          status: data.status || 'open',
        });
      } catch {
        // skip
      }
    }

    return findings;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// HTML template
// ---------------------------------------------------------------------------

function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Audit Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d1117; color: #c9d1d9; padding: 20px; }
  h1 { color: #58a6ff; margin-bottom: 4px; }
  .subtitle { color: #8b949e; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 16px; }
  .card h2 { color: #58a6ff; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
  .metric { font-size: 32px; font-weight: 700; color: #f0f6fc; }
  .metric-label { font-size: 12px; color: #8b949e; }
  .phase-list { list-style: none; }
  .phase-list li { padding: 6px 0; border-bottom: 1px solid #21262d; display: flex; justify-content: space-between; }
  .phase-list li:last-child { border-bottom: none; }
  .status-pending { color: #8b949e; }
  .status-running { color: #d29922; }
  .status-completed { color: #3fb950; }
  .status-failed { color: #f85149; }
  .progress-bar { width: 100%; height: 8px; background: #21262d; border-radius: 4px; overflow: hidden; margin: 8px 0; }
  .progress-fill { height: 100%; background: #58a6ff; transition: width 0.5s ease; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 8px; border-bottom: 2px solid #30363d; color: #8b949e; font-size: 12px; text-transform: uppercase; }
  td { padding: 8px; border-bottom: 1px solid #21262d; font-size: 13px; }
  .sev-P0 { color: #f85149; font-weight: 700; }
  .sev-P1 { color: #db6d28; font-weight: 700; }
  .sev-P2 { color: #d29922; }
  .sev-P3 { color: #8b949e; }
  .sev-P4 { color: #8b949e; }
  .log-entry { font-family: monospace; font-size: 12px; padding: 4px 0; border-bottom: 1px solid #21262d; }
  .log-time { color: #8b949e; margin-right: 8px; }
  .log-type { color: #58a6ff; margin-right: 8px; }
  .spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid #d29922; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 6px; vertical-align: middle; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .elapsed { font-size: 14px; color: #8b949e; }
  .full-width { grid-column: 1 / -1; }
</style>
</head>
<body>
<h1>Audit Dashboard</h1>
<div class="subtitle" id="audit-info">Loading...</div>

<div class="grid">
  <div class="card">
    <h2>Current Phase</h2>
    <div id="current-phase" class="metric">--</div>
    <div class="elapsed" id="elapsed">Elapsed: --</div>
  </div>
  <div class="card">
    <h2>Findings</h2>
    <div id="findings-count" class="metric">0</div>
    <div class="metric-label" id="severity-summary">--</div>
  </div>
  <div class="card">
    <h2>Coverage</h2>
    <div class="progress-bar"><div class="progress-fill" id="coverage-bar" style="width:0%"></div></div>
    <div class="metric-label" id="coverage-label">0 / 0 pages</div>
  </div>
  <div class="card">
    <h2>Pipeline Progress</h2>
    <div class="progress-bar"><div class="progress-fill" id="pipeline-bar" style="width:0%"></div></div>
    <div class="metric-label" id="pipeline-label">0 / 0 phases</div>
  </div>
</div>

<div class="grid">
  <div class="card">
    <h2>Phases</h2>
    <ul class="phase-list" id="phase-list"></ul>
  </div>
  <div class="card">
    <h2>Findings</h2>
    <table>
      <thead><tr><th>Sev</th><th>Title</th><th>Location</th></tr></thead>
      <tbody id="findings-table"></tbody>
    </table>
  </div>
  <div class="card full-width">
    <h2>Action Log (last 20)</h2>
    <div id="action-log"></div>
  </div>
</div>

<script>
// escCss: strip everything except alphanumerics, hyphens, underscores (for CSS class names only)
function escCss(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, ''); }
// escHtml: encode HTML entities to prevent XSS when inserting untrusted text via innerHTML
function escHtml(s) { var d = document.createElement('div'); d.appendChild(document.createTextNode(String(s))); return d.innerHTML; }

function formatElapsed(ms) {
  if (!ms || ms <= 0) return '--';
  var s = Math.floor(ms / 1000);
  var m = Math.floor(s / 60); s = s % 60;
  var h = Math.floor(m / 60); m = m % 60;
  if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}

function formatTime(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  return d.toLocaleTimeString();
}

async function poll() {
  try {
    var [progRes, logRes, findRes] = await Promise.all([
      fetch('/api/progress'),
      fetch('/api/actions'),
      fetch('/api/findings')
    ]);
    var prog = await progRes.json();
    var log = await logRes.json();
    var findings = await findRes.json();

    // Header
    document.getElementById('audit-info').textContent =
      'Audit: ' + (prog.audit_id || 'unknown') + ' | Status: ' + (prog.status || 'unknown');

    // Current phase
    var phaseEl = document.getElementById('current-phase');
    if (prog.current_stage) {
      phaseEl.innerHTML = '';
      var spinSpan = document.createElement('span');
      spinSpan.className = 'spinner';
      phaseEl.appendChild(spinSpan);
      phaseEl.appendChild(document.createTextNode(prog.current_stage));
    } else {
      phaseEl.textContent = prog.status === 'completed' ? 'Done' : '--';
    }

    // Elapsed
    if (prog.started_at) {
      var elapsed = Date.now() - new Date(prog.started_at).getTime();
      document.getElementById('elapsed').textContent = 'Elapsed: ' + formatElapsed(elapsed);
    }

    // Findings count
    document.getElementById('findings-count').textContent = findings.length;
    var sev = prog.metrics && prog.metrics.findings_by_severity || {};
    document.getElementById('severity-summary').textContent =
      'P0:' + (sev.P0||0) + ' P1:' + (sev.P1||0) + ' P2:' + (sev.P2||0) + ' P3:' + (sev.P3||0);

    // Coverage
    var metrics = prog.metrics || {};
    var visited = metrics.pages_visited || 0;
    var total = metrics.pages_total || 1;
    var pct = Math.round((visited / total) * 100);
    document.getElementById('coverage-bar').style.width = pct + '%';
    document.getElementById('coverage-label').textContent = visited + ' / ' + total + ' pages (' + pct + '%)';

    // Pipeline progress
    var stages = prog.stages || {};
    var stageNames = Object.keys(stages);
    var completed = stageNames.filter(function(s) { return stages[s].status === 'completed'; }).length;
    var pipePct = stageNames.length > 0 ? Math.round((completed / stageNames.length) * 100) : 0;
    document.getElementById('pipeline-bar').style.width = pipePct + '%';
    document.getElementById('pipeline-label').textContent = completed + ' / ' + stageNames.length + ' phases (' + pipePct + '%)';

    // Phase list
    var phaseList = document.getElementById('phase-list');
    phaseList.innerHTML = '';
    stageNames.forEach(function(name) {
      var st = stages[name];
      var li = document.createElement('li');
      var statusSpan = document.createElement('span');
      statusSpan.className = 'status-' + escCss(st.status || '');
      if (st.status === 'running') {
        var sp = document.createElement('span');
        sp.className = 'spinner';
        statusSpan.appendChild(sp);
        statusSpan.appendChild(document.createTextNode(st.status));
      } else {
        statusSpan.textContent = st.status;
      }
      li.textContent = name + ' ';
      li.appendChild(statusSpan);
      phaseList.appendChild(li);
    });

    // Findings table
    var tbody = document.getElementById('findings-table');
    tbody.innerHTML = '';
    findings.forEach(function(f) {
      var tr = document.createElement('tr');
      var tdSev = document.createElement('td');
      tdSev.className = 'sev-' + escCss(f.severity || '');
      tdSev.textContent = f.severity || '';
      var tdTitle = document.createElement('td');
      tdTitle.textContent = f.title || '';
      var tdLoc = document.createElement('td');
      tdLoc.textContent = f.location || '';
      tr.appendChild(tdSev);
      tr.appendChild(tdTitle);
      tr.appendChild(tdLoc);
      tbody.appendChild(tr);
    });

    // Action log
    var logDiv = document.getElementById('action-log');
    logDiv.innerHTML = '';
    log.forEach(function(entry) {
      var div = document.createElement('div');
      div.className = 'log-entry';
      var timeSpan = document.createElement('span');
      timeSpan.className = 'log-time';
      timeSpan.textContent = formatTime(entry.timestamp);
      var typeSpan = document.createElement('span');
      typeSpan.className = 'log-type';
      typeSpan.textContent = entry.action_type || '';
      div.appendChild(timeSpan);
      div.appendChild(typeSpan);
      div.appendChild(document.createTextNode(
        (entry.phase ? '[' + entry.phase + '] ' : '')
        + (entry.details || '')
        + (entry.target_url ? ' ' + entry.target_url : '')
      ));
      logDiv.appendChild(div);
    });
  } catch (e) {
    console.error('Poll error:', e);
  }
}

poll();
setInterval(poll, 2000);
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/**
 * Start the live dashboard HTTP server.
 *
 * Serves the dashboard HTML at `/` and JSON API endpoints at:
 * - `/api/progress` - current progress.json
 * - `/api/actions` - last 20 action log entries
 * - `/api/findings` - all findings
 */
export async function startDashboardServer(
  options: DashboardServerOptions,
): Promise<DashboardServer> {
  const { auditDir, startPort = 3847 } = options;

  const html = getDashboardHtml();

  const server = http.createServer((req, res) => {
    const url = req.url || '/';

    // CORS headers for local development
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (url === '/api/progress') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(readProgress(auditDir)));
    } else if (url === '/api/actions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(readActionLog(auditDir)));
    } else if (url === '/api/findings') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(readFindings(auditDir)));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    }
  });

  // Try ports sequentially until one is available
  return tryListen(server, startPort);
}

function tryListen(
  server: http.Server,
  port: number,
): Promise<DashboardServer> {
  const MAX_PORT = 65535;

  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && port < MAX_PORT) {
        server.removeListener('error', onError);
        tryListen(server, port + 1).then(resolve, reject);
      } else {
        reject(err);
      }
    };

    server.on('error', onError);
    server.listen(port, () => {
      server.removeListener('error', onError);
      const dashUrl = `http://localhost:${port}`;
      resolve({
        url: dashUrl,
        port,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}
