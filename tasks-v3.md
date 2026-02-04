# Project Completion Agent - Tasks v3

**Version:** 3.2
**Date:** February 3, 2026
**Scope:** Remaining Phases: 3.4 (Dashboard), 8 (Reporting), 9 (Verification), 10 (Polish)
**Status:** Codex Feedback Fully Incorporated - Ready for Implementation

> **Previous phases complete:** 0, 1, 2, 3.1-3.3, 4, 5, 6, 7 — see tasks-v1.md and tasks-v2.md

---

## Overview

This task list covers all remaining work to complete the Project Completion Agent v1:

1. **Phase 3.4: HTML Dashboard** — Live progress visibility with stop/continue buttons
2. **Phase 8: Reporting & Issue Creation** — Generate reports, review findings, create GitHub issues
3. **Phase 9: Verification Mode** — `/complete-verify` command for fix verification
4. **Phase 10: Polish & Edge Cases** — Checkpoint/resume, error recovery

### Already Implemented (from previous phases):
- Safe mode (5.0, 6.0) ✅
- External verification pauses (5.4) ✅
- Basic error handling ✅

---

## Cross-Phase Data Contracts

> **Goal:** Define explicit schemas to ensure integration consistency across phases.

### Data Schemas

- [ ] **D.1** Define `progress.json` schema:
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

- [ ] **D.2** Define finding file schema (`findings/finding-{id}.json`):
  ```json
  {
    "schema_version": "1.0",
    "id": "finding-001",
    "severity": "P0|P1|P2",
    "confidence": "high|medium|low",
    "title": "string",
    "description": "string",
    "url": "string",
    "element": "string|null",
    "screenshot_id": "MCP_ID|null",
    "screenshot_uploaded": false,
    "reproduction_steps": ["string"],
    "expected": "string",
    "actual": "string",
    "prd_reference": "string|null",
    "feature_area": "string|null",
    "created_at": "ISO8601",
    "issue_number": null,
    "deduplication": {
      "is_duplicate": false,
      "duplicate_of": null,
      "reason": null
    }
  }
  ```

- [ ] **D.3** Define `created-issues.json` schema:
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

- [ ] **D.4** Define `issue-{number}.json` schema for verification:
  ```json
  {
    "schema_version": "1.0",
    "issue_number": 42,
    "github_url": "https://github.com/...",
    "finding_ids": ["finding-001"],
    "reproduction": {
      "url": "string",
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

---

## Phase 3.4: HTML Dashboard

> **Goal:** Provide live visual progress during audits with interactive controls.

### 3.4.1 Dashboard HTML Structure

- [ ] **3.4.1.1** Create `.complete-agent/dashboard/index.html` with:
  - Header: "Complete Audit Dashboard"
  - Status section: current URL, status (running/paused/complete)
  - Coverage metrics: pages visited, pages in queue, findings count
  - Findings summary: P0/P1/P2 counts with color coding
  - Activity log: last 10 actions (scrollable)
  - Control buttons: Stop, Continue (disabled when not applicable)
- [ ] **3.4.1.2** Style with inline CSS (no build step):
  - Clean, minimal design
  - Color-coded severity badges (red=P0, orange=P1, blue=P2)
  - Responsive layout for different screen sizes
- [ ] **3.4.1.3** Include inline JavaScript for functionality

### 3.4.2 Auto-Refresh via Polling

- [ ] **3.4.2.1** Implement `fetchProgress()` function:
  - Fetch `/audits/current/progress.json` every 2 seconds (relative to server root)
  - **Note:** Server must be started from `.complete-agent/` root, NOT `.complete-agent/dashboard/`
  - Parse JSON and update DOM elements
  - Handle fetch errors gracefully (show "Connecting...")
- [ ] **3.4.2.2** Update UI elements dynamically:
  - Status badge with appropriate color
  - Numeric counters with animation
  - Activity log (prepend new entries, keep last 10)
- [ ] **3.4.2.3** Detect audit completion:
  - When status = "complete", stop polling
  - Show completion summary
  - Disable Stop button, show "View Report" link

### 3.4.3 Stop Button

- [ ] **3.4.3.1** Implement Stop button click handler:
  - Create `stop.flag` file via fetch POST to local endpoint OR
  - Since we can't create files from browser, show instructions: "Run: touch .complete-agent/audits/current/stop.flag"
- [ ] **3.4.3.2** Alternative: Use `dashboard-server.js` (see 3.4.5.2 for canonical endpoint spec)
- [ ] **3.4.3.3** Update button state based on audit status

### 3.4.4 Continue Button

- [ ] **3.4.4.1** Show Continue button only when status = "paused"
- [ ] **3.4.4.2** Implement Continue button to create `continue.flag`
- [ ] **3.4.4.3** Display pause reason from progress.json

### 3.4.6 Flag Lifecycle Management

- [ ] **3.4.6.1** Define flag precedence rules:
  - If both `stop.flag` and `continue.flag` exist: `stop.flag` takes precedence
  - Agent checks for flags at start of each action, not continuously
- [ ] **3.4.6.2** Implement flag cleanup in agent:
  - Delete `continue.flag` after resuming audit
  - Delete `stop.flag` after audit is stopped
  - On audit completion, delete any remaining flags
- [ ] **3.4.6.3** Handle stale flags:
  - On audit start, warn if flags exist from previous run
  - Offer to clean up before starting

### 3.4.5 Server Command

- [ ] **3.4.5.1** Document usage: `npx serve .complete-agent` (serve from root to access both dashboard/ and audits/)
  - Dashboard accessible at: `http://localhost:3000/dashboard/`
  - Progress JSON accessible at: `http://localhost:3000/audits/current/progress.json`
- [ ] **3.4.5.2** Alternative: Create `dashboard-server.js` that handles flag creation (canonical endpoint spec):
  - Serve static files from `.complete-agent/`
  - GET `/audits/current/progress.json` → serves progress data (same as static)
  - POST `/api/stop` → creates `audits/current/stop.flag`, returns `{"success": true}`
  - POST `/api/continue` → creates `audits/current/continue.flag`, returns `{"success": true}`
  - Dashboard JS should POST to `/api/stop` and `/api/continue` for flag creation
- [ ] **3.4.5.3** Add to SKILL_INSTRUCTIONS.md dashboard section

---

## Phase 8: Reporting & Issue Creation

> **Goal:** Generate readable reports, allow user to review findings, create GitHub issues.

### 8.1 Report Generation

- [ ] **8.1.1** Generate `report.md` from findings:
  - Title: "Audit Report - {app_name} - {date}"
  - Executive summary: total findings by severity
  - Coverage section: pages visited, forms tested, flows completed
  - Findings section: grouped by severity (P0 first)
- [ ] **8.1.2** For each finding in report:
  - Severity badge
  - Title/description
  - URL and element
  - Screenshot reference (MCP ID or "screenshot lost")
  - Reproduction steps as numbered list
  - Expected vs actual
  - PRD reference if available
- [ ] **8.1.3** Include recommendations section:
  - Which findings to prioritize
  - Suggested fix approaches (from LLM analysis)
- [ ] **8.1.4** Save to `.complete-agent/audits/current/report.md`

### 8.2 Interactive Review

- [ ] **8.2.1** Present findings to user via AskUserQuestion tool:
  - Show finding summary (severity, title, URL)
  - Options: "Accept", "Reject", "Skip for now"
- [ ] **8.2.2** Support bulk actions:
  - "Accept all P0 findings"
  - "Reject all P2 findings"
  - "Review remaining one by one"
- [ ] **8.2.3** Allow editing finding details:
  - Change severity
  - Edit description
  - Add notes
- [ ] **8.2.4** Save review decisions to `review-decisions.json`:
  ```json
  {
    "reviewed_at": "2026-02-03T18:00:00",
    "findings": {
      "finding-001": {"decision": "accept", "edited_severity": null},
      "finding-002": {"decision": "reject", "reason": "Intentional design"},
      "finding-003": {"decision": "skip"}
    }
  }
  ```

### 8.3 GitHub Issue Creation

- [ ] **8.3.0** Preflight checks before issue creation:
  - Verify `gh` CLI is installed: `which gh`
  - Verify `gh` is authenticated: `gh auth status`
  - Verify repo access: `gh repo view --json nameWithOwner`
  - If any check fails:
    - Show clear error message explaining what's missing
    - Offer to skip issue creation and save findings for manual creation
    - Save findings to `manual-issues.md` as formatted issue templates
- [ ] **8.3.1** For each accepted finding, prepare issue content:
  - Title: "[{severity}] {short_description}"
  - Body from issue.md template
  - Labels: "bug", "audit", severity label (P0/P1/P2)
- [ ] **8.3.2** Upload screenshots to GitHub:
  - Use `mcp__claude-in-chrome__upload_image` if MCP session active
  - If session ended, note "Screenshot unavailable (session ended)"
- [ ] **8.3.3** Create issues via `gh issue create`:
  ```bash
  gh issue create --title "[P1] Form validation missing on /settings" \
    --body "$(cat issue-body.md)" \
    --label "bug,audit,P1"
  ```
- [ ] **8.3.4** Group non-P0 findings by feature area:
  - If multiple findings in same area (e.g., "auth"), create single issue
  - List all findings in issue body
  - P0 findings always get individual issues
- [ ] **8.3.5** Record created issues in `created-issues.json` (per schema D.3):
  ```json
  {
    "schema_version": "1.0",
    "created_at": "2026-02-03T18:00:00Z",
    "issues": [
      {"number": 42, "findings": ["finding-001"], "url": "https://github.com/...", "title": "[P1] ...", "grouped": false, "screenshot_uploaded": true}
    ]
  }
  ```

### 8.4 Screenshot Handling

- [ ] **8.4.0** Validate screenshot upload capability:
  - Check if `mcp__claude-in-chrome__upload_image` tool is available in current session
    - **Note:** This is the canonical MCP tool name from Claude for Chrome extension
  - Check if MCP session is active (tabs_context_mcp returns valid tabs)
  - If tool unavailable or session ended:
    - Log warning: "Screenshot upload unavailable"
    - Set `screenshot_upload_available: false` in audit state
    - Continue with issue creation without screenshots
- [ ] **8.4.1** Before issue creation, check MCP session status:
  - If active and tool available: screenshots can be uploaded
  - If ended or unavailable: mark screenshots as unavailable, add note to issue body
- [ ] **8.4.2** Upload workflow:
  - Upload screenshot to GitHub (embed in issue)
  - Mark finding: `screenshot_uploaded: true`
  - If upload fails: note in issue "Screenshot upload failed"
- [ ] **8.4.3** Post-creation cleanup:
  - Update findings with issue numbers
  - Generate summary: "Created X issues for Y findings"

---

## Phase 9: Verification Mode

> **Goal:** Verify that reported issues have been fixed.

### 9.1 Issue Tracking

- [ ] **9.1.1** When issues are created, save reproduction data:
  - Create `.complete-agent/issues/issue-{number}.json`
  - Include: reproduction steps, URL, element, expected behavior
- [ ] **9.1.2** Track issue status:
  - Query `gh issue view {number} --json state`
  - Detect when issue is closed
- [ ] **9.1.3** Link findings to issues bidirectionally:
  - Finding → Issue number
  - Issue → Finding IDs

### 9.2 Verify Command Implementation

- [ ] **9.2.1** Implement `/complete-verify gh issue #42`:
  - Parse issue number from command
  - Load reproduction steps from issue file
- [ ] **9.2.2** Execute verification:
  - Navigate to URL
  - Perform reproduction steps
  - Check if issue still occurs
- [ ] **9.2.3** Report results:
  - **Fixed**: Issue no longer reproduces
  - **Still Broken**: Issue still reproduces (capture new screenshot)
  - **New Error**: Different error occurred
  - **Cannot Verify**: Unable to reach page or execute steps
- [ ] **9.2.4** Update issue tracking:
  - Save verification result to issue file
  - Optionally add comment to GitHub issue

### 9.3 Regression Testing

- [ ] **9.3.1** After verifying a fix, identify related functionality:
  - Same page: test other elements
  - Same feature area: test related flows
  - Example: login fix → test logout, password reset
- [ ] **9.3.2** Run abbreviated tests on related areas:
  - Quick happy-path tests (no edge cases)
  - Look for new errors introduced
  - **Budget:** Max 20 steps per regression run (configurable via `verification.max_regression_steps` in config.yml)
- [ ] **9.3.3** Report regression findings:
  - New issues found during regression
  - Offer to create new issues for regressions
- [ ] **9.3.4** Regression budgeting in safe mode:
  - In safe mode, limit regression to 10 steps
  - Skip any destructive action tests
  - Log skipped tests with reason

### 9.4 Verify Skill Definition

- [ ] **9.4.1** Add `/complete-verify` to skill.md:
  - Command syntax
  - Examples
  - Output format
- [ ] **9.4.2** Add verification flow to SKILL_INSTRUCTIONS.md

---

## Phase 10: Polish & Edge Cases

> **Goal:** Improve robustness and handle edge cases.

### 10.1 Checkpoint & Resume

- [ ] **10.1.1** Save checkpoint after each major action:
  - Create `checkpoint.json` in audit directory
  - Include: current URL, exploration queue, visited pages, findings so far
- [ ] **10.1.2** Implement `/complete-audit --resume`:
  - Read checkpoint.json
  - Restore state
  - Continue from last position
- [ ] **10.1.3** Handle checkpoint edge cases:
  - Corrupted checkpoint: warn and offer fresh start
  - Old checkpoint (>24h): warn about stale state
  - Missing checkpoint: error with helpful message

### 10.2 Error Recovery (Enhancement)

- [ ] **10.2.1** Handle network errors:
  - Retry with exponential backoff (already implemented)
  - Save checkpoint before giving up
  - Log error details for debugging
- [ ] **10.2.2** Handle page crashes:
  - Detect unresponsive page
  - Save checkpoint
  - Skip page and continue
- [ ] **10.2.3** Handle unexpected modals/popups:
  - Detect modal overlays
  - Try to dismiss (click X, press Escape)
  - If can't dismiss, log and continue

### 10.3 Focused Audit Mode

- [ ] **10.3.1** Implement `/complete-audit --focus "auth, payments"`:
  - Parse focus areas from command
  - Filter exploration to matching routes/features
- [ ] **10.3.2** Match focus areas to:
  - URL patterns (e.g., "auth" matches /login, /signup, /logout)
  - PRD feature names
  - Component categories
- [ ] **10.3.3** Report focus coverage:
  - "Focused on: auth, payments"
  - "Covered X of Y routes in focus areas"

### 10.4 Cleanup Command

- [ ] **10.4.1** Implement `/complete-audit --cleanup`:
  - Delete old audit directories (>30 days)
  - Delete test data tracking files
  - Keep issue tracking data
- [ ] **10.4.2** Confirm before deletion:
  - List what will be deleted
  - Require user confirmation
- [ ] **10.4.3** Add to skill.md and SKILL_INSTRUCTIONS.md

---

## Checkpoints & Exit Criteria

### After Phase 3.4 (Dashboard):
- [ ] Dashboard displays live progress
- [ ] Stop/Continue buttons work (or clear instructions provided)
- [ ] Auto-refresh updates metrics

### After Phase 8 (Reporting):
- [ ] Report.md is generated with all findings
- [ ] User can review and accept/reject findings
- [ ] GitHub issues are created for accepted findings
- [ ] Screenshots uploaded where possible

### After Phase 9 (Verification):
- [ ] `/complete-verify gh issue #42` works
- [ ] Verification results are reported
- [ ] Regression testing runs on related areas

### After Phase 10 (Polish):
- [ ] Checkpoint/resume works for interrupted audits
- [ ] Focused audit mode filters appropriately
- [ ] Cleanup command removes old data

---

## Definition of Done (v3 - Final)

The Project Completion Agent v1 is complete when:
1. [ ] Dashboard provides live visibility during audits
2. [ ] Reports are generated with proper formatting
3. [ ] Users can review findings interactively
4. [ ] GitHub issues are created for approved findings
5. [ ] `/complete-verify` can verify fixes
6. [ ] Regression testing identifies side effects
7. [ ] Interrupted audits can resume
8. [ ] Focused audit mode works
9. [ ] All features tested end-to-end

---

## Technical Notes

### Dashboard Architecture
- Static HTML + vanilla JS (no build step)
- **Important:** Serve from `.complete-agent/` root: `npx serve .complete-agent`
- Dashboard URL: `http://localhost:3000/dashboard/`
- Polls `/audits/current/progress.json` every 2 seconds
- For flag creation: either CLI instructions or dashboard-server.js
- Style: minimal, clean, color-coded

### Issue Creation Flow
1. Preflight checks (gh auth) → 2. Generate findings → 3. User reviews → 4. Upload screenshots → 5. Create issues → 6. Record results

### Verification Flow
1. Load reproduction steps → 2. Execute steps → 3. Check result → 4. Run regression → 5. Report

### File Structure (Final)
```
.complete-agent/
├── config.yml
├── dashboard/
│   ├── index.html
│   └── server.js (optional)
├── audits/
│   ├── {timestamp}/
│   │   ├── progress.md
│   │   ├── progress.json
│   │   ├── checkpoint.json
│   │   ├── report.md
│   │   ├── review-decisions.json
│   │   ├── created-issues.json
│   │   ├── findings/
│   │   └── pages/
│   └── current -> {timestamp}
└── issues/
    └── issue-{number}.json
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Dashboard can't create flag files | Provide CLI instructions or simple server (3.4.5.2) |
| Dashboard polling path mismatch | Serve from `.complete-agent/` root, not dashboard/ (3.4.5.1) |
| MCP session ends before issue creation | Note screenshots as unavailable, continue (8.4.0, 8.4.1) |
| `gh` CLI not available/authenticated | Preflight checks with fallback to manual-issues.md (8.3.0) |
| Screenshot upload tool unavailable | Validate tool availability, graceful degradation (8.4.0) |
| Checkpoint corruption | Validate JSON, offer fresh start (10.1.3) |
| Too many issues created | Group by feature area, require user approval (8.3.4) |
| Verification can't reproduce | Report "Cannot Verify" with reason (9.2.3) |
| Both stop/continue flags exist | stop.flag takes precedence (3.4.6.1) |
| Stale flags from previous audit | Warn on startup, offer cleanup (3.4.6.3) |
| Unbounded regression testing | Max step budgets (20 default, 10 in safe mode) (9.3.2, 9.3.4) |
| Cross-phase data mismatch | Explicit schemas with version field (D.1-D.4) |

---

## Testing Plan

### Phase 3.4 Testing
- [ ] Open dashboard while audit runs
- [ ] Verify metrics update every 2 seconds
- [ ] Test stop flag creation
- [ ] Test continue flag when paused
- [ ] **Edge case:** Both stop.flag and continue.flag exist (stop should win)
- [ ] **Edge case:** Stale flags from previous audit exist on startup
- [ ] **Edge case:** Dashboard opened before audit starts (should show "Waiting...")

### Phase 8 Testing
- [ ] Run audit that generates findings
- [ ] Review findings interactively
- [ ] Create GitHub issues
- [ ] Verify issues have correct content
- [ ] **Edge case:** Zero findings report (should generate summary-only report)
- [ ] **Edge case:** Grouped issue body format (multiple findings in one issue)
- [ ] **Edge case:** `gh` not installed or not authenticated
- [ ] **Edge case:** MCP session ended before screenshot upload
- [ ] **Edge case:** All findings rejected (no issues created)

### Phase 9 Testing
- [ ] Create a finding, get it fixed
- [ ] Run `/complete-verify` on the issue
- [ ] Verify result is correct
- [ ] Check regression tests run
- [ ] **Edge case:** Verify a closed issue (should still verify)
- [ ] **Edge case:** Issue file missing (should offer to re-fetch from GitHub)
- [ ] **Edge case:** Page no longer exists (should report "Cannot Verify")
- [ ] **Budgeting:** Regression tests should have max step count (default: 20 steps)

### Phase 10 Testing
- [ ] Interrupt audit mid-run
- [ ] Resume with `--resume`
- [ ] Run focused audit
- [ ] Run cleanup command
- [ ] **Edge case:** Cleanup with `current` symlink pointing to active audit
- [ ] **Edge case:** Cleanup with in-progress audit (should warn and skip)
- [ ] **Edge case:** Corrupted checkpoint.json (should offer fresh start)
- [ ] **Edge case:** Resume when no checkpoint exists
