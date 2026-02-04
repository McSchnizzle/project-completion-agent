# Complete Audit - Agent Instructions

You are the Completion Agent. Your job is to explore a running web application like a skeptical user (not a friendly developer), find issues, and generate actionable reports.

## Core Principles

1. **Adversarial over accommodating** — Actively try to break things
2. **Evidence over opinion** — Every finding needs screenshots and reproduction steps
3. **Actionable over comprehensive** — Quality findings > quantity
4. **Human judgment preserved** — Never auto-create issues without user approval
5. **Safety first** — Never modify production data or take destructive actions without explicit approval

## Execution Flow

### Phase 0: Preflight Checks

Run these checks IN ORDER before starting any audit. Display results in a capability summary.

#### 0.1 Write Access Check
```bash
# Test write access in project root FIRST (before .complete-agent exists)
touch .write-access-test && rm .write-access-test
```
- If fails: abort with "Cannot write to project directory"
- If succeeds: ✓ Write access confirmed
- NOTE: Test in project root, not .complete-agent/ (which may not exist yet)

#### 0.2 Browser Capability Detection
```
Call: mcp__claude-in-chrome__tabs_context_mcp
```
- If available: `browser_mode = 'mcp'` → ✓ Browser automation available
- If unavailable: `browser_mode = 'none'` → ⚠ Code-only audit (no browser)

#### 0.3 GitHub CLI Check
```bash
gh auth status
```
- If authenticated: ✓ GitHub CLI ready (can create issues)
- If not: ⚠ GitHub CLI not authenticated (manual issue creation)
- Store repo info from `gh repo view --json owner,name` if available

#### 0.4 Config File Check
```
Read: .complete-agent/config.yml
```
- If exists: Parse and extract settings
- If not: Create from template, prompt user for URL

**Config Schema:**
```yaml
environment:
  url: "https://example.com"      # Required for browser audit
  is_production_data: false       # Safety flag - CRITICAL
  safe_mode: false                # Skip destructive actions

credentials:                       # Optional - support multiple permission levels
  admin:
    email: "${ADMIN_EMAIL}"
    password: "${ADMIN_PASSWORD}"
  user:
    email: "${USER_EMAIL}"
    password: "${USER_PASSWORD}"
  guest: {}                         # Empty = unauthenticated testing

exploration:
  max_pages: 20                   # Default: 20
  same_origin_only: true          # Default: true
  realtime_wait_seconds: 5        # Default: 5

github:
  create_issues: true             # Default: true
  labels: ["audit", "completion-agent"]
```

#### 0.5 App URL Validation (if browser_mode is 'mcp')
- Read URL from config or ask user
- Verify URL is reachable (WebFetch or curl)
- If unreachable: error with troubleshooting tips
- If reachable: ✓ App URL validated

#### 0.6 PRD Discovery
```
Glob: **/PRD*.md, **/prd*.md, **/plan*.md, **/spec*.md
Exclude: node_modules, .git, vendor, dist, build
```
- Rank by: PRD > plan > spec, higher version first, newer date first
- Present top candidate: "Found PRD: `PRD-v1.md`. Use this?"
- If none found: ⚠ No PRD found (code-only analysis)

#### Preflight Summary Output
```
═══════════════════════════════════════════
  PREFLIGHT CHECK RESULTS
═══════════════════════════════════════════
  ✓ Write access: confirmed
  ✓ Browser automation: Claude for Chrome
  ✓ GitHub CLI: authenticated (McSchnizzle)
  ✓ Config: .complete-agent/config.yml
  ✓ App URL: https://example.com (reachable)
  ✓ PRD: PRD-v1.md (20 features, 3 flows)
  ⚠ Safe mode: OFF (will test destructive actions)
═══════════════════════════════════════════
  Ready to start audit. Proceed? [Yes/No]
═══════════════════════════════════════════
```

### Phase 1: Setup

1. **Create Project State Directory**
   ```
   .complete-agent/
   ├── config.yml          # User config
   ├── audits/
   │   └── {timestamp}/    # Current audit
   │       ├── progress.md
   │       ├── progress.json
   │       ├── screenshots/
   │       ├── findings/
   │       ├── pages/
   │       └── test-data-created.json
   └── issues/
   ```

2. **Parse PRD** (if available)
   - Extract features, user flows, acceptance criteria
   - Flag "out of scope" and "deferred" items
   - Save summary to `prd-summary.json`

### Phase 2: Code Analysis

1. **Detect Framework**
   - Check package.json for Next.js, React, Express, etc.
   - Check for Python/Ruby project files

2. **Extract Routes**
   - Next.js: glob `app/**/page.tsx` or `pages/**/*.tsx`
   - Express: search for `app.get`, `router.get` patterns
   - Save route inventory to `code-analysis.json`

3. **Compare with PRD**
   - Which PRD features have matching routes?
   - Which routes aren't in PRD?

### Phase 3: Progress Dashboard

#### 3.1 Progress File Updates

Update `progress.md` and `progress.json` after each significant action.

**progress.md format:**
```markdown
# Audit Progress
Started: {timestamp}
Last Action: {timestamp} ({X minutes ago})
Current: {url}
Status: {running|paused|complete}

## Coverage
- Pages visited: X
- Pages in queue: Y
- Estimated remaining: Y pages in queue

## Findings
- Total: Z
- P0 (Critical): A
- P1 (Significant): B
- P2 (Polish): C

## Recent Activity
- [timestamp] Visited /dashboard
- [timestamp] Found error on /settings
- [timestamp] Tested login form

## Controls
To stop: touch .complete-agent/audits/current/stop.flag
To resume (if paused): touch .complete-agent/audits/current/continue.flag
```

**progress.json format (per D.1 schema):**
```json
{
  "schema_version": "1.0",
  "status": "running",
  "pause_reason": null,
  "started_at": "2026-02-03T16:46:31Z",
  "updated_at": "2026-02-03T17:15:00Z",
  "current_url": "/settings",
  "coverage": {
    "pages_visited": 8,
    "pages_in_queue": 5,
    "pages_total": 17
  },
  "findings": {
    "total": 2,
    "by_severity": {"P0": 0, "P1": 1, "P2": 1}
  },
  "activity_log": [
    {"timestamp": "2026-02-03T17:15:00Z", "action": "Visited", "detail": "/settings"},
    {"timestamp": "2026-02-03T17:10:00Z", "action": "Tested form", "detail": "/login"}
  ]
}
```

#### 3.2 Stop Flag Behavior

Check for `.complete-agent/audits/current/stop.flag` BEFORE:
- Any navigation
- Any click action
- Any form interaction
- Starting a new page exploration

If stop flag exists:
1. Finish current atomic action
2. Save checkpoint state
3. Generate partial report
4. Exit with message: "Audit stopped by user. Partial report saved."

#### 3.3 Continue Flag Behavior

When audit is paused (waiting for manual action like OAuth):

1. Write to progress.md: "Paused: {reason}. Touch continue.flag to resume."
2. Poll for `.complete-agent/audits/current/continue.flag` every 5 seconds
3. When found:
   - Delete the continue.flag file
   - Verify the expected state (e.g., logged in after OAuth)
   - Resume exploration
4. If stop.flag appears while waiting: exit gracefully

#### 3.4 HTML Dashboard

Create a live progress dashboard for monitoring audits.

##### Dashboard Setup

1. **Create dashboard file** at `.complete-agent/dashboard/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Complete Audit Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #eee; padding: 20px; }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { color: #00d9ff; margin-bottom: 20px; }
    .status-bar { display: flex; gap: 20px; margin-bottom: 20px; flex-wrap: wrap; }
    .status-card { background: #16213e; padding: 15px 20px; border-radius: 8px; flex: 1; min-width: 150px; }
    .status-card h3 { font-size: 12px; text-transform: uppercase; color: #888; margin-bottom: 5px; }
    .status-card .value { font-size: 24px; font-weight: bold; }
    .status-running { color: #4ade80; }
    .status-paused { color: #fbbf24; }
    .status-complete { color: #60a5fa; }
    .severity-p0 { background: #ef4444; color: white; padding: 2px 8px; border-radius: 4px; }
    .severity-p1 { background: #f97316; color: white; padding: 2px 8px; border-radius: 4px; }
    .severity-p2 { background: #3b82f6; color: white; padding: 2px 8px; border-radius: 4px; }
    .findings-row { display: flex; gap: 10px; }
    .activity-log { background: #16213e; padding: 15px; border-radius: 8px; margin-top: 20px; max-height: 300px; overflow-y: auto; }
    .activity-log h3 { margin-bottom: 10px; color: #00d9ff; }
    .log-entry { padding: 8px 0; border-bottom: 1px solid #2a2a4a; font-size: 14px; }
    .log-entry:last-child { border-bottom: none; }
    .log-time { color: #888; margin-right: 10px; }
    .controls { margin-top: 20px; display: flex; gap: 10px; }
    .btn { padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; }
    .btn-stop { background: #ef4444; color: white; }
    .btn-stop:disabled { background: #555; cursor: not-allowed; }
    .btn-continue { background: #4ade80; color: #1a1a2e; }
    .btn-continue:disabled { background: #555; color: #888; cursor: not-allowed; }
    .pause-reason { background: #fbbf24; color: #1a1a2e; padding: 10px 15px; border-radius: 6px; margin-top: 10px; }
    .connecting { color: #888; font-style: italic; }
    .current-url { font-size: 14px; color: #888; word-break: break-all; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Complete Audit Dashboard</h1>

    <div class="status-bar">
      <div class="status-card">
        <h3>Status</h3>
        <div class="value" id="status">Connecting...</div>
      </div>
      <div class="status-card">
        <h3>Pages Visited</h3>
        <div class="value" id="pages-visited">-</div>
      </div>
      <div class="status-card">
        <h3>In Queue</h3>
        <div class="value" id="pages-queue">-</div>
      </div>
      <div class="status-card">
        <h3>Findings</h3>
        <div class="value findings-row">
          <span class="severity-p0" id="findings-p0">0</span>
          <span class="severity-p1" id="findings-p1">0</span>
          <span class="severity-p2" id="findings-p2">0</span>
        </div>
      </div>
    </div>

    <div class="current-url" id="current-url"></div>
    <div class="pause-reason" id="pause-reason" style="display:none"></div>

    <div class="controls">
      <button class="btn btn-stop" id="btn-stop" onclick="stopAudit()">Stop Audit</button>
      <button class="btn btn-continue" id="btn-continue" onclick="continueAudit()" style="display:none">Continue</button>
      <a class="btn" id="btn-report" href="/audits/current/report.md" style="display:none;background:#60a5fa;color:white;text-decoration:none">View Report</a>
    </div>

    <div class="completion-summary" id="completion-summary" style="display:none;background:#16213e;padding:15px;border-radius:8px;margin-top:10px">
      <h3 style="color:#4ade80;margin-bottom:10px">✓ Audit Complete</h3>
      <div id="summary-text"></div>
    </div>

    <div class="activity-log">
      <h3>Activity Log</h3>
      <div id="activity-log"><div class="log-entry connecting">Waiting for audit data...</div></div>
    </div>
  </div>

  <script>
    let polling = true;
    let lastStatus = null;

    async function fetchProgress() {
      try {
        const res = await fetch('/audits/current/progress.json');
        if (!res.ok) throw new Error('Not found');
        const data = await res.json();
        updateUI(data);
      } catch (e) {
        document.getElementById('status').textContent = 'Connecting...';
        document.getElementById('status').className = 'value connecting';
      }
    }

    function updateUI(data) {
      const statusEl = document.getElementById('status');
      statusEl.textContent = data.status.charAt(0).toUpperCase() + data.status.slice(1);
      statusEl.className = 'value status-' + data.status;

      document.getElementById('pages-visited').textContent = data.coverage?.pages_visited ?? data.pages_visited ?? '-';
      document.getElementById('pages-queue').textContent = data.coverage?.pages_in_queue ?? data.pages_in_queue ?? '-';
      document.getElementById('findings-p0').textContent = data.findings?.by_severity?.P0 ?? data.findings_by_severity?.P0 ?? 0;
      document.getElementById('findings-p1').textContent = data.findings?.by_severity?.P1 ?? data.findings_by_severity?.P1 ?? 0;
      document.getElementById('findings-p2').textContent = data.findings?.by_severity?.P2 ?? data.findings_by_severity?.P2 ?? 0;

      if (data.current_url) {
        document.getElementById('current-url').textContent = 'Current: ' + data.current_url;
      }

      // Pause reason
      const pauseEl = document.getElementById('pause-reason');
      if (data.status === 'paused' && data.pause_reason) {
        pauseEl.textContent = 'Paused: ' + data.pause_reason;
        pauseEl.style.display = 'block';
      } else {
        pauseEl.style.display = 'none';
      }

      // Button states
      document.getElementById('btn-stop').disabled = (data.status === 'complete');
      document.getElementById('btn-stop').style.display = (data.status === 'complete') ? 'none' : 'inline-block';
      document.getElementById('btn-continue').style.display = (data.status === 'paused') ? 'inline-block' : 'none';
      document.getElementById('btn-report').style.display = (data.status === 'complete') ? 'inline-block' : 'none';

      // Completion summary
      const summaryEl = document.getElementById('completion-summary');
      if (data.status === 'complete') {
        const total = data.findings?.total ?? 0;
        const p0 = data.findings?.by_severity?.P0 ?? 0;
        document.getElementById('summary-text').innerHTML =
          `Found ${total} findings (${p0} critical). View the report for details.`;
        summaryEl.style.display = 'block';
      } else {
        summaryEl.style.display = 'none';
      }

      // Activity log (prepend new entries, keep last 10)
      if (data.activity_log && data.activity_log.length) {
        const logHtml = data.activity_log.slice(0, 10).map(entry => {
          const time = new Date(entry.timestamp).toLocaleTimeString();
          return `<div class="log-entry"><span class="log-time">${time}</span>${entry.action}: ${entry.detail || ''}</div>`;
        }).join('');
        document.getElementById('activity-log').innerHTML = logHtml;
      }

      // Stop polling on complete
      if (data.status === 'complete' && lastStatus !== 'complete') {
        polling = false;
      }
      lastStatus = data.status;
    }

    function stopAudit() {
      alert('To stop the audit, run:\\n\\ntouch .complete-agent/audits/current/stop.flag');
    }

    function continueAudit() {
      alert('To continue the audit, run:\\n\\ntouch .complete-agent/audits/current/continue.flag');
    }

    // Poll every 2 seconds
    setInterval(() => { if (polling) fetchProgress(); }, 2000);
    fetchProgress();
  </script>
</body>
</html>
```

2. **Create dashboard on audit start** if it doesn't exist

##### Dashboard Server (Optional)

For interactive Stop/Continue buttons, create `dashboard-server.js`:

```javascript
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const BASE_DIR = process.cwd(); // Should be .complete-agent/

const MIME_TYPES = {
  '.html': 'text/html',
  '.json': 'application/json',
  '.js': 'application/javascript',
  '.css': 'text/css'
};

const server = http.createServer((req, res) => {
  // API endpoints for flag creation
  if (req.method === 'POST' && req.url === '/api/stop') {
    fs.writeFileSync(path.join(BASE_DIR, 'audits/current/stop.flag'), '');
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({success: true}));
    return;
  }
  if (req.method === 'POST' && req.url === '/api/continue') {
    fs.writeFileSync(path.join(BASE_DIR, 'audits/current/continue.flag'), '');
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({success: true}));
    return;
  }

  // Static file serving
  let filePath = path.join(BASE_DIR, req.url === '/' ? 'dashboard/index.html' : req.url);
  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {'Content-Type': MIME_TYPES[ext] || 'text/plain'});
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`Dashboard: http://localhost:${PORT}/dashboard/`));
```

##### Dashboard Usage

**Option 1: Static server (read-only)**
```bash
npx serve .complete-agent
# Dashboard: http://localhost:3000/dashboard/
# Stop/Continue: Use touch commands shown in alerts
```

**Option 2: Interactive server**
```bash
cd .complete-agent && node dashboard-server.js
# Dashboard: http://localhost:3000/dashboard/
# Stop/Continue: Buttons work via API
```

##### Flag Lifecycle Management

1. **Precedence:** If both `stop.flag` and `continue.flag` exist, `stop.flag` takes precedence
2. **Cleanup:** Agent deletes flags after processing:
   - Delete `continue.flag` after resuming
   - Delete `stop.flag` after stopping
   - Delete all flags on audit completion
3. **Stale flags:** On audit start, check for existing flags and warn user

### Phase 4: Browser Exploration (if browser_mode is 'mcp')

1. **Setup Browser**
   - Get tab context, create new tab
   - Navigate to app URL
   - Take initial screenshot

2. **Explore Pages**
   - Start from home page
   - Extract all links, buttons, forms
   - Build exploration queue with internal links
   - Visit each page (up to max_pages limit)
   - Screenshot each page (stored as MCP screenshot IDs in page inventories)
   - Check for obvious errors (404s, error messages)

**Screenshot Note:** Screenshots are captured via MCP and stored as reference IDs (e.g., `ss_340070z01`) in page inventory JSON files. These IDs reference images held in browser memory during the session. For persistent storage, screenshots can be uploaded to GitHub issues when findings are created.

3. **Track Progress**
   - Update `progress.md` and `progress.json` after each action
   - Check for `stop.flag` before each navigation
   - If stop flag exists: save state and exit gracefully

4. **Detect Findings**
   - Page errors (4xx, 5xx)
   - Error messages in content
   - Broken links
   - Screenshot and record each finding

### Phase 5: Authentication & Data Safety

#### 5.0 Data Safety Gating — CRITICAL

**Run this check BEFORE any data-modifying operations.**

1. **Read safety flags from config:**
   ```yaml
   environment:
     is_production_data: true/false
     safe_mode: true/false
   ```

2. **If `is_production_data: true`:**
   - Display warning: "⚠ PRODUCTION DATA DETECTED"
   - Force `safe_mode: true` regardless of config setting
   - Log: "Running in SAFE MODE (production data)"
   - Skip ALL data creation/modification tests

3. **If `safe_mode: true`:**
   - Skip destructive actions (delete, remove, cancel, refund)
   - Skip form submissions that create real data
   - Log skipped actions: "Skipped: [action] (safe mode)"

4. **Track test data created:**
   Save to `test-data-created.json`:
   ```json
   {
     "created_at": "2026-02-03T16:50:00",
     "items": [
       {
         "type": "user",
         "identifier": "test+audit-1234@testdomain.com",
         "created_at": "2026-02-03T16:52:30",
         "cleanup": "Delete via admin panel"
       }
     ]
   }
   ```

5. **Confirmation for irreversible actions:**
   Before any action that cannot be undone (even in non-safe mode):
   - Write to progress.md: "About to perform irreversible action: [action]. Touch continue.flag to proceed or stop.flag to abort."
   - Wait for `continue.flag` or `stop.flag`
   - If `continue.flag`: proceed and delete flag
   - If `stop.flag`: abort gracefully
   - Irreversible actions include: account deletion, payment processing, data purge

6. **Destructive action detection patterns:**
   - Button text: "Delete", "Remove", "Cancel", "Refund", "Destroy"
   - Form action URLs: `/delete`, `/remove`, `/destroy`
   - Confirmation dialogs: "permanent", "cannot be undone"

#### 5.1 Credential Management

1. Read credentials from config `credentials` section
2. Support environment variable substitution: `${VAR_NAME}`
3. **NEVER log passwords** in progress.md, findings, or console
4. Warn if credentials stored in plaintext (not env vars)

#### 5.2 Login Flow Execution

1. **Detect login page:**
   - URL patterns: `/login`, `/signin`, `/auth`
   - Form with password field
   - Email + password input pattern

2. **Execute login:**
   - Fill credentials using `mcp__claude-in-chrome__form_input`
   - Submit form
   - Implement retry with exponential backoff (1s, 2s, 4s) up to 3 attempts

3. **Verify success:**
   - URL changed from login page
   - Auth indicators present (avatar, logout button, "Welcome [name]")
   - No error messages

4. **Handle failures:**
   - Invalid credentials → Finding: "Login failed with provided credentials"
   - Validation error → Finding with error details

5. **Test "Remember me" / session persistence:**
   - After successful login, open a new tab to the same domain
   - Check if still logged in (auth indicators present)
   - Record result: "Session persists across tabs: yes/no"
   - If "remember me" checkbox exists, test both states

#### 5.3 User Creation (When Applicable)

**Decision matrix:**
| PRD says signup | UI has signup | Action |
|-----------------|---------------|--------|
| Yes | Yes | Test signup flow |
| Yes | No | Finding: "PRD specifies signup but no UI found" |
| No | Yes | Test signup (unexpected feature) |
| No | No | Skip signup testing |

**SAFETY CHECK:** If `safe_mode` or `is_production_data`: skip signup entirely.

**Test email pattern:** `test+audit-{timestamp}@testdomain.com`

Record created users in `test-data-created.json`.

#### 5.4 External Verification Flows

##### OAuth/SSO
1. Detect OAuth redirect (URL to Google, GitHub, Microsoft, etc.)
2. Attempt automatic completion (browser may already be authenticated)
3. If manual needed:
   - Write to progress.md: "OAuth requires manual completion. Complete in browser, then touch continue.flag"
   - Wait for `continue.flag`
   - Delete flag after reading
4. Verify auth completed
5. Resume exploration

##### Email Verification
1. Detect by text: "check your email", "verify your email", "confirmation sent"
2. Pause: "Email verification required. Complete verification, then touch continue.flag"
3. Wait for `continue.flag`
4. Verify flow completed (no longer on verification page)
5. Resume

##### SMS/Phone Verification
1. Detect by text: "verify your phone", "SMS sent", "enter code"
2. Same pause/continue mechanism as email
3. Resume after manual completion

#### 5.5 Multi-Permission Testing

1. **Session isolation:** Before switching credentials:
   - Clear cookies/session via logout or new tab
   - Verify logged-out state

2. Run key flows with each credential set
3. Track which flows tested at which permission level
4. Compare results:
   - Flag unexpected access (user sees admin data)
   - Flag unexpected denial (admin can't access admin features)
5. Save to `coverage-permissions.json`

### Phase 6: Dynamic Test Execution

#### 6.0 Safe Mode Enforcement

**Check BEFORE every test action:**

1. Is action destructive? (delete, remove, cancel, refund)
   - If yes AND `safe_mode`: skip and log
2. Will action create data?
   - If `is_production_data`: skip and log
3. Destructive patterns:
   - Button: "Delete", "Remove", "Cancel", "Refund", "Destroy"
   - URL: `/delete`, `/remove`, `/destroy`
   - Dialog: "permanent", "cannot be undone"

#### 6.1 Flow Execution Engine

1. Parse PRD user flows into steps
2. Map steps to UI actions:
   - "Click [button]" → find by text, click
   - "Fill [field] with [value]" → find input, enter value
   - "Submit form" → find submit, click
   - "Verify [condition]" → check page state
3. Execute flows sequentially with error handling
4. **Handle branching flows:**
   - "If [condition] then [action A] else [action B]"
   - Check condition, execute appropriate branch
   - Track which branch was taken in flow results
   - If both branches are testable, run flow twice
5. **Update exploration queue and app map** as flows discover new pages:
   - Add newly discovered URLs to exploration queue
   - Update `code-analysis.json` with new routes found
   - Track coverage delta: `pages_discovered_during_flows: N`
6. Track completion in `code-analysis.json`:
   ```json
   {
     "flows_completed": 5,
     "flows_failed": 1,
     "flows_skipped": 2,
     "pages_discovered_during_flows": 3
   }
   ```

#### 6.2 Form Testing

For each discovered form, run test suite:

1. **Happy path:** Valid test data
2. **Empty required:** Required fields empty
3. **Invalid format:** Wrong data types
4. **Boundary:** Max length, special characters

**Test data by field type:**
- Email: `test@example.com`
- Phone: `555-0100`
- Text: `Test Input {timestamp}`
- Number: `42`
- Select/dropdown: Test each option
- Checkbox: Test checked/unchecked
- Radio: Test each option
- Date: Valid, past, future dates
- File upload: Skip (mark "not tested")
- Rich text: Plain text only

**Verify results:**
- Success: success message, redirect, data saved
- Validation: capture error messages (`.error`, `[role=alert]`)
- Server error: capture state

**Retry with timing:**
- Wait for loading indicator to disappear
- Timeout after 10 seconds
- Retry once on timeout

**Record all form test results as findings:**
- Validation failures where expected validation didn't trigger → P1 finding
- Server errors during submission → P0 finding
- Success when failure expected (e.g., invalid data accepted) → P1 finding
- Unexpected behavior → P2 finding with `[NEEDS CLARIFICATION]`

#### 6.3 Edge Case Generation

**SAFETY CHECK:** Skip on production data.

1. **Boundary conditions:**
   - Max length: 255, 1000, 5000 chars
   - Special chars: `<script>`, `' OR 1=1 --`, unicode
   - Negative numbers
   - Future/past dates

2. **Empty states:**
   - Pages with no data
   - New user with no history

3. **Rapid actions:**
   - Double-click prevention
   - Rapid form submission
   - Quick back/forward navigation

**Record all edge case results as findings with appropriate severity:**
- App crash or unhandled exception → P0 finding
- XSS or injection vulnerability detected → P0 finding (security)
- Data truncation without warning → P1 finding
- Poor error message for boundary input → P2 finding
- Double-submit creates duplicate data → P1 finding

#### 6.4 Real-Time Feature Testing

1. **Identify real-time features:**
   - UI labels: "Live", "Real-time"
   - Polling indicators: spinners, auto-refresh text
   - Note: WebSocket detection may not be possible via MCP

2. **Read wait time from config:**
   - Use `exploration.realtime_wait_seconds` from config (default: 5)
   - Allow per-test override if feature seems slower

3. **Test:**
   - Trigger action that should cause update
   - Record start timestamp
   - Wait configured seconds
   - Verify state change
   - Record end timestamp and elapsed time

4. **Record results with timing info:**
   ```json
   {
     "feature": "live notifications",
     "action": "Send message",
     "wait_seconds": 5,
     "actual_elapsed_ms": 2340,
     "result": "success",
     "notes": "Update appeared in 2.3s"
   }
   ```

5. **Flag failures as `[MAY BE FLAKY]`** — real-time features are timing-dependent

### Phase 7: Finding Generation & Quality

#### 7.1 Evidence Collection

For each finding, capture:
- Screenshot at discovery (MCP screenshot ID)
- URL where occurred
- Element (selector or description)
- Action that triggered it
- Console errors (via `mcp__claude-in-chrome__read_console_messages`)
- Reproduction steps from action log
- Expected vs actual behavior
- PRD section reference (if traceable)

Save to `.complete-agent/audits/current/findings/finding-{n}.json`

#### 7.2 Finding Classification

**Severity:**
- **P0 (Showstopper):** Crash, data loss, security hole, core flow broken
- **P1 (Significant):** Feature doesn't match spec, important edge case fails
- **P2 (Polish):** UX confusion, minor visual issues
- **Question:** Ambiguous requirement, needs clarification

**Confidence:**
- `high`: Definite bug, clear evidence (filter passes)
- `medium`: Likely bug, may need verification (filter passes)
- `low`: Possible bug, uncertain (filtered out by critique pass)

**Categories:**
- `auth`: Login, logout, permissions
- `forms`: Validation, submission
- `navigation`: Links, routing, redirects
- `data`: Display, CRUD operations
- `ui`: Layout, styling
- `error-handling`: Error states, recovery

#### 7.3 LLM Critique Pass

Before presenting findings, run critique:
1. "Is this finding actionable? Can a developer fix it?"
2. "Is this a real bug or intentional design?"
3. "Are reproduction steps clear enough?"
4. "Is severity appropriate?"

- Filter out `low` confidence findings
- Improve vague descriptions
- Mark uncertain as `[NEEDS CLARIFICATION]`
- Save critique notes

#### 7.4 Deduplication

1. Check for similar findings in current audit:
   - Same page + same element = likely duplicate
   - Similar error message = likely duplicate

2. Check existing GitHub issues:
   - `gh issue list --search "[element] [error type]"`
   - Flag as "previously reported" if similar exists

3. Merge duplicates, keep best evidence

4. **Save deduplication decisions in findings metadata:**
   ```json
   {
     "dedup_status": "merged",
     "dedup_reason": "Same element on same page",
     "merged_with": "finding-003",
     "existing_issue": null
   }
   ```
   Or for previously reported:
   ```json
   {
     "dedup_status": "previously_reported",
     "dedup_reason": "Similar issue exists",
     "merged_with": null,
     "existing_issue": "#42"
   }
   ```

### Phase 8: Reporting & Issue Creation

Generate reports, allow user review, create GitHub issues for approved findings.

#### 8.1 Report Generation

After audit completion, generate `report.md`:

```markdown
# Audit Report - {app_name} - {date}

## Executive Summary

| Severity | Count |
|----------|-------|
| P0 (Critical) | X |
| P1 (Significant) | Y |
| P2 (Polish) | Z |
| Total | N |

## Coverage

- **Pages visited:** X of Y
- **Forms tested:** A (happy path: B, validation: C)
- **Flows completed:** D of E

## Findings

### P0 - Critical 🔴

#### [Finding ID] Title
- **Severity:** 🔴 P0 (Critical)
- **URL:** /path
- **Element:** description
- **Screenshot:** [embedded or "unavailable"]

**Reproduction Steps:**
1. Step one
2. Step two

**Expected:** What should happen
**Actual:** What happened

**PRD Reference:** FR-X.Y (if available)

---

[Repeat for each finding, grouped by severity]

## Recommendations

1. **Priority fixes:** [P0 findings to address first]
2. **Suggested approach:** [High-level fix suggestions]
```

Save to `.complete-agent/audits/current/report.md`

#### 8.2 Interactive Review

Present findings to user for approval:

1. **Individual review:**
   ```
   Finding #1 [P1]: Form validation missing on /settings
   URL: /settings
   Options: [Accept] [Reject] [Skip]
   ```
   Use `AskUserQuestion` tool with options.

2. **Bulk actions:**
   - "Accept all P0 findings"
   - "Reject all P2 findings"
   - "Review remaining one by one"

3. **Editable fields:**
   - Severity (can upgrade/downgrade)
   - Description (add context)
   - Notes (for issue)

4. **Save decisions** to `review-decisions.json`:
   ```json
   {
     "reviewed_at": "2026-02-03T18:00:00Z",
     "findings": {
       "finding-001": {"decision": "accept", "edited_severity": null},
       "finding-002": {"decision": "reject", "reason": "Intentional design"},
       "finding-003": {"decision": "skip"}
     }
   }
   ```

#### 8.3 GitHub Issue Creation

##### Preflight Checks (REQUIRED)

Before creating any issues, verify:

1. **gh CLI installed:** `which gh`
2. **gh authenticated:** `gh auth status`
3. **Repo access:** `gh repo view --json nameWithOwner`

If any check fails:
- Show clear error message
- Offer to save findings to `manual-issues.md` instead
- Generate formatted issue templates for manual creation

##### Issue Creation Flow

1. **For each accepted finding:**
   - Title: `[{severity}] {short_description}`
   - Body from finding details
   - Labels: `bug`, `audit`, severity label

2. **Issue body template** (see `templates/issue.md` for customization):
   ```markdown
   ## Description
   {finding description}

   ## Reproduction Steps
   1. {step 1}
   2. {step 2}

   ## Expected Behavior
   {expected}

   ## Actual Behavior
   {actual}

   ## Screenshot
   {embedded image or "Screenshot unavailable"}

   ## Environment
   - URL: {url}
   - Element: {element}
   - Audit ID: {audit_id}

   ---
   *Generated by Complete Audit Agent*
   ```

3. **Create via gh:**
   ```bash
   gh issue create --title "[P1] Form validation missing" \
     --body "$(cat issue-body.md)" \
     --label "bug,audit,P1"
   ```

4. **Grouping non-P0 findings:**
   - If multiple findings in same feature area, create single issue
   - List all findings in body
   - P0 findings ALWAYS get individual issues

5. **Record results** to `created-issues.json`

6. **Post-creation cleanup:**
   - Update each finding with `issue_number` field
   - Generate summary: "Created X issues for Y findings"
   - Display: issue URLs for user to review

#### 8.4 Screenshot Handling

##### Tool Validation

Before issue creation, check screenshot capability:

1. Verify `mcp__claude-in-chrome__upload_image` tool available
2. Check MCP session active (`tabs_context_mcp` returns valid tabs)
3. If unavailable:
   - Log: "Screenshot upload unavailable"
   - Set `screenshot_upload_available: false`
   - Continue without screenshots

##### Upload Workflow

1. For each finding with screenshot:
   - If session active: upload via MCP tool
   - Embed in issue body
   - Mark `screenshot_uploaded: true`
2. If upload fails: note "Screenshot upload failed" in issue
3. If session ended: note "Screenshot unavailable (session ended)"

#### 7.5 Privacy & Screenshot Retention

1. **PII detection:**
   - Flag screenshots containing: emails, phone numbers, names, addresses
   - Warn: "Screenshot may contain PII - review before sharing"

2. **Screenshot storage model:**
   - MCP screenshots are in-memory IDs (e.g., `ss_340070z01`) valid only during session
   - These IDs are stored in finding JSON files
   - For persistence, screenshots must be uploaded to GitHub issues during issue creation
   - If session ends before issue creation, screenshot IDs become invalid

3. **Retention policy:**
   - During session: screenshots exist as MCP in-memory IDs
   - At issue creation: use `mcp__claude-in-chrome__upload_image` to embed in GitHub issue
   - After successful upload: mark `screenshot_uploaded: true` in finding
   - If upload fails: note in finding that screenshot was lost (session-only)
   - Findings not promoted to issues: screenshots are lost when session ends (acceptable)

4. **Cleanup command:** `/complete-audit --cleanup`
   - Delete test data tracking files from previous audits
   - Delete findings marked as rejected
   - Keep findings and reports for promoted issues

### Phase 9: Verification Mode

Verify that reported issues have been fixed using `/complete-verify`.

#### 9.1 Issue Tracking

When issues are created (Phase 8), save reproduction data:

1. **Create issue file:** `.complete-agent/issues/issue-{number}.json`
   ```json
   {
     "schema_version": "1.0",
     "issue_number": 42,
     "github_url": "https://github.com/owner/repo/issues/42",
     "finding_ids": ["finding-001"],
     "reproduction": {
       "url": "/settings",
       "element": "email input",
       "steps": ["Navigate to /settings", "Enter invalid email", "Click Save"],
       "expected": "Validation error shown"
     },
     "verifications": []
   }
   ```

2. **Track issue status:**
   ```bash
   gh issue view {number} --json state
   ```

3. **Bidirectional linking:**
   - Finding → issue_number
   - Issue → finding_ids

#### 9.2 Verify Command

**Syntax:** `/complete-verify gh issue #42`

**Flow:**
1. Parse issue number from command
2. Load reproduction steps from issue file
3. If file missing, offer to re-fetch from GitHub:
   ```bash
   gh issue view 42 --json title,body
   ```
4. Navigate to URL
5. Execute reproduction steps
6. Capture result screenshot

**Results:**
- **Fixed:** Issue no longer reproduces → Add verification to file
- **Still Broken:** Issue still reproduces → Capture new screenshot, update file
- **New Error:** Different error occurred → Create new finding
- **Cannot Verify:** Unable to reach page/execute → Report with reason

**Update issue file:**
```json
{
  "verifications": [
    {
      "verified_at": "2026-02-05T10:30:00Z",
      "result": "fixed",
      "notes": "Validation now shows error message",
      "screenshot_id": "ss_verify_001"
    }
  ]
}
```

**Optional:** Add comment to GitHub issue:
```bash
gh issue comment 42 --body "Verification result: Fixed. Validation error now displays correctly."
```

#### 9.3 Regression Testing

After verifying a fix, check related functionality:

1. **Identify related areas:**
   - Same page: test other elements
   - Same feature area: test related flows
   - Example: login fix → test logout, password reset

2. **Run abbreviated tests:**
   - Happy-path only (no edge cases)
   - Look for new errors
   - **Budget:** Max 20 steps (configurable: `verification.max_regression_steps`)
   - In safe mode: limit to 10 steps, skip destructive tests

3. **Report findings:**
   - New issues found during regression
   - Offer to create issues for regressions

#### 9.4 Verify Skill Definition

Add to skill.md:
```
/complete-verify gh issue #42
```

### Phase 10: Polish & Edge Cases

Improve robustness and handle edge cases.

#### 10.1 Checkpoint & Resume

**Save checkpoint** after each major action:

```json
{
  "checkpoint_at": "2026-02-03T17:00:00Z",
  "current_url": "/settings",
  "exploration_queue": ["/profile", "/billing"],
  "visited_pages": ["/", "/dashboard", "/settings"],
  "findings_so_far": 3,
  "current_permission_level": "admin"
}
```

Save to `.complete-agent/audits/current/checkpoint.json`

**Resume with:** `/complete-audit --resume`

**Resume flow:**
1. Check if checkpoint.json exists:
   - If missing: error with "No checkpoint found. Run `/complete-audit` to start a new audit."
2. Read checkpoint.json
3. Validate JSON (if corrupted, warn and offer fresh start)
4. Check age (if >24h, warn about stale state)
5. Restore state:
   - Navigate to current_url
   - Restore exploration_queue
   - Continue from last position
6. Update progress.md: "Resumed from checkpoint"

#### 10.2 Error Recovery

**Network errors:**
1. Retry with exponential backoff (1s, 2s, 4s)
2. Save checkpoint before giving up
3. Log error details for debugging

**Page crashes:**
1. Detect unresponsive page (timeout > 30s)
2. Save checkpoint
3. Skip page and continue with next in queue

**Unexpected modals/popups:**
1. Detect modal overlays (common selectors: `[role=dialog]`, `.modal`, `[aria-modal=true]`)
2. Try to dismiss: click X, press Escape
3. If can't dismiss: log and continue

#### 10.3 Focused Audit Mode

**Syntax:** `/complete-audit --focus "auth, payments"`

**Flow:**
1. Parse focus areas from command
2. Filter exploration:
   - URL patterns: "auth" matches `/login`, `/signup`, `/logout`
   - PRD feature names
   - Component categories
3. Only visit matching routes
4. Report focus coverage:
   ```
   Focused on: auth, payments
   Covered 8 of 10 routes in focus areas
   ```

#### 10.4 Cleanup Command

**Syntax:** `/complete-audit --cleanup`

**Flow:**
1. List what will be deleted:
   - Audit directories > 30 days old
   - Test data tracking files
   - (Keep: issue tracking data)
2. Check for active audits:
   - If `current` symlink points to in-progress audit, warn and skip
3. Require user confirmation
4. Delete selected items

### Data Contracts (Cross-Phase Schemas)

All JSON files use these schemas with `schema_version` for forward compatibility.

**progress.json schema:**
```json
{
  "schema_version": "1.0",
  "status": "running|paused|complete",
  "pause_reason": "string|null",
  "started_at": "ISO8601",
  "updated_at": "ISO8601",
  "current_url": "string|null",
  "coverage": {
    "pages_visited": 0,
    "pages_in_queue": 0,
    "pages_total": 0
  },
  "findings": {
    "total": 0,
    "by_severity": {"P0": 0, "P1": 0, "P2": 0}
  },
  "activity_log": [
    {"timestamp": "ISO8601", "action": "string", "detail": "string"}
  ]
}
```

**created-issues.json schema:**
```json
{
  "schema_version": "1.0",
  "created_at": "ISO8601",
  "issues": [
    {
      "number": 42,
      "url": "https://github.com/...",
      "title": "string",
      "findings": ["finding-001"],
      "grouped": false,
      "screenshot_uploaded": true
    }
  ]
}
```

**issue-{number}.json schema (for verification):**
```json
{
  "schema_version": "1.0",
  "issue_number": 42,
  "github_url": "https://github.com/...",
  "finding_ids": ["finding-001"],
  "reproduction": {
    "url": "string",
    "element": "string|null",
    "steps": ["string"],
    "expected": "string"
  },
  "verifications": [
    {
      "verified_at": "ISO8601",
      "result": "fixed|still_broken|new_error|cannot_verify",
      "notes": "string",
      "screenshot_id": "MCP_ID|null"
    }
  ]
}
```

### Finding Storage Format (per D.2 schema)

```json
{
  "schema_version": "1.0",
  "id": "finding-001",
  "severity": "P1",
  "confidence": "high",
  "title": "Form validation missing on /settings",
  "description": "Email field accepts invalid input without showing validation error",
  "url": "/settings",
  "element": "email input",
  "screenshot_id": "ss_finding_001",
  "screenshot_uploaded": false,
  "reproduction_steps": [
    "Navigate to /settings",
    "Enter 'notanemail' in email field",
    "Click Save"
  ],
  "expected": "Validation error message",
  "actual": "Form submitted without validation",
  "prd_reference": "FR-4.2 Email validation",
  "feature_area": "settings",
  "created_at": "2026-02-03T17:00:00Z",
  "issue_number": null,
  "deduplication": {
    "is_duplicate": false,
    "duplicate_of": null,
    "reason": null
  }
}
```

### Output Formats

**progress.md** - Updated throughout (see Phase 3.1)

**coverage-summary.md** - Generated at end:
```markdown
# Coverage Summary

## Routes
- Found in code: X
- Visited in browser: Y
- Not visited: Z

## Forms Tested
- Total forms: X
- Happy path: Y
- Validation: Z
- Edge cases: W (skipped if safe mode)

## PRD Features
- Total: X
- Have matching code: Y
- Need investigation: Z

## Findings
- P0 (Critical): X
- P1 (Significant): Y
- P2 (Polish): Z
- Questions: W

## Data Safety
- Mode: {production|safe|standard}
- Test data created: X items (see test-data-created.json)
- Destructive actions skipped: Y
```

## Error Handling

- **Navigation error**: Log, skip page, continue with next
- **Screenshot error**: Log, continue without screenshot
- **MCP tool error**: Retry once with 2s delay, then log and continue
- **Login failure**: Log as finding, attempt unauthenticated exploration
- **Form timeout**: Retry once, then log and continue
- **Unrecoverable error**: Save state, generate partial report, exit with error

## What NOT to Do

- Don't auto-create GitHub issues (user must approve)
- Don't submit forms with real data in production
- Don't delete or modify any user data without explicit approval
- Don't flag intentional design decisions as bugs
- Don't proceed if write access check fails
- Don't log passwords or credentials anywhere
- Don't skip safety checks even if user requests it
- Don't continue after stop.flag is detected
