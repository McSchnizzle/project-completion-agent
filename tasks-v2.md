# Project Completion Agent - Tasks v2

**Version:** 2.1
**Date:** February 3, 2026
**Scope:** Phases 3, 5, 6, 7 (Dashboard, Authentication, Test Execution, Finding Generation)
**Status:** Codex Reviewed - Feedback Incorporated

> **Previous phases complete:** Phases 0, 1, 2, 4 (Preflight, Foundation, Code Analysis, Browser Exploration) — see tasks-v1.md

---

## Phase 3: Progress Dashboard

> **Note:** Core progress tracking (progress.md, progress.json, stop.flag) already implemented in Phase 4. This phase adds remaining dashboard features.

### 3.1 Progress File Enhancement

- [x] **3.1.1** Write `progress.md` after each significant action (done in Phase 4)
- [x] **3.1.2** Include coverage counts, findings count, elapsed time (done)
- [x] **3.1.3** Write `progress.json` for programmatic access (done)
- [ ] **3.1.4** Add estimated completion based on exploration queue length
  - Display as "X pages remaining in queue" (not percentages)
  - Note: estimate may change as new pages are discovered
- [ ] **3.1.5** Add "last action" timestamp with human-readable elapsed time

### 3.2 Stop Signal (Complete)

- [x] **3.2.1** Check for `stop.flag` before each major action (done)
- [x] **3.2.2** Graceful stop: finish current action, save state (done)
- [x] **3.2.3** Clear instructions in progress.md on how to stop (done)

### 3.3 Continue Signal (v1 Mechanism)

> **Note:** v1 uses file-based signals instead of HTML dashboard buttons.

- [ ] **3.3.1** Document `continue.flag` mechanism in progress.md when paused
- [ ] **3.3.2** Instructions: "Touch .complete-agent/audits/current/continue.flag to resume"
- [ ] **3.3.3** Delete `continue.flag` after reading to prevent re-triggering

### 3.4 HTML Dashboard (Deferred to v1.1)

- [ ] **3.4.1** Create static HTML dashboard in `.complete-agent/dashboard/index.html`
- [ ] **3.4.2** Auto-refresh via polling `progress.json`
- [ ] **3.4.3** "Stop" button that creates stop.flag
- [ ] **3.4.4** "Continue" button that creates continue.flag
- [ ] **3.4.5** Simple local server command (`npx serve .complete-agent/dashboard`)

**Phase 3 Status:** 90% Complete (HTML dashboard deferred)

---

## Phase 5: Authentication & User Flows

### 5.0 Data Safety Gating (PRD FR-4.2) — HIGH PRIORITY

> **CRITICAL:** Must run before any data-modifying operations.

- [ ] **5.0.1** Read `environment.is_production_data` from config
- [ ] **5.0.2** If `is_production_data: true`:
  - Display warning: "Production data detected. Destructive operations will be skipped."
  - Set internal flag `safe_mode: true` (override any config setting)
  - Log to progress.md: "Running in SAFE MODE (production data)"
- [ ] **5.0.3** Read `environment.safe_mode` from config (default: false)
- [ ] **5.0.4** If `safe_mode: true`:
  - Skip all destructive actions (delete, refund, cancel, remove)
  - Skip form submissions that create real data (use read-only exploration)
  - Log skipped actions as "not tested - destructive/safe mode"
- [ ] **5.0.5** Require explicit confirmation before any irreversible action:
  - Write to progress.md: "About to [action]. Touch continue.flag to proceed or stop.flag to abort."
  - Wait for signal file
- [ ] **5.0.6** Track all created test data for potential cleanup:
  - Save to `.complete-agent/audits/current/test-data-created.json`
  - Include: type, identifier, creation time, cleanup instructions

### 5.1 Credential Management

- [ ] **5.1.1** Read credentials from `.complete-agent/config.yml` `credentials` section
- [ ] **5.1.2** Support multiple credential sets: `admin`, `user`, `guest`
- [ ] **5.1.3** Implement environment variable substitution (`${VAR_NAME}`)
- [ ] **5.1.4** Never log or output passwords in reports or progress files
- [ ] **5.1.5** Warn if credentials are stored in plaintext (not env vars)

### 5.2 Login Flow Execution

- [ ] **5.2.1** Detect login page by:
  - URL patterns (`/login`, `/signin`, `/auth`)
  - Form with password field
  - Common login UI patterns (email + password inputs)
- [ ] **5.2.2** Fill credentials using `mcp__claude-in-chrome__form_input` tool
- [ ] **5.2.3** Submit login form using `mcp__claude-in-chrome__computer` (click) or form submit
- [ ] **5.2.4** Verify login succeeded by checking:
  - URL changed from login page
  - Auth indicators (user avatar, logout button, "Welcome [name]")
  - No error messages present
- [ ] **5.2.5** Handle login failures gracefully:
  - If credentials invalid: log as finding "Login failed with provided credentials"
  - If form validation error: log as finding with details
- [ ] **5.2.6** Handle "remember me" / persistent session:
  - Test by opening new tab and checking if still logged in
  - Record session persistence behavior
- [ ] **5.2.7** Implement retry logic with exponential backoff:
  - Retry transient failures up to 3 times
  - Wait 1s, 2s, 4s between retries
  - Log retry attempts

### 5.3 User Creation (When Applicable)

- [ ] **5.3.1** Check PRD features list for signup/registration requirement
- [ ] **5.3.2** Check UI for signup button/link
- [ ] **5.3.3** Decision matrix:
  | PRD says signup | UI has signup | Action |
  |-----------------|---------------|--------|
  | Yes | Yes | Test signup flow |
  | Yes | No | Finding: "PRD specifies signup but no button found" |
  | No | Yes | Test signup (unexpected feature) |
  | No | No | Skip signup testing |
- [ ] **5.3.4** **SAFETY CHECK:** If `safe_mode` or `is_production_data`, skip signup (don't create real users)
- [ ] **5.3.5** Use test email pattern: `test+audit-{timestamp}@testdomain.com`
- [ ] **5.3.6** Complete signup flow, handling verification pauses (see 5.4)
- [ ] **5.3.7** Record created test user in `test-data-created.json` for cleanup

### 5.4 External Verification Flows (PRD FR-4.4) — HIGH PRIORITY

> **Covers:** OAuth/SSO, Email verification, SMS verification

#### 5.4.1 OAuth/SSO Handling
- [ ] **5.4.1.1** Detect OAuth/SSO redirect (URL to Google, GitHub, Microsoft, etc.)
- [ ] **5.4.1.2** Attempt automatic completion (browser may already be authenticated)
- [ ] **5.4.1.3** If manual intervention needed:
  - Write to progress.md: "OAuth requires manual completion. Complete in browser, then touch continue.flag"
  - Wait for `continue.flag` file to appear
  - Delete `continue.flag` after reading
- [ ] **5.4.1.4** Verify auth completed (check for logged-in state)
- [ ] **5.4.1.5** Resume exploration after OAuth completion

#### 5.4.2 Email Verification Handling
- [ ] **5.4.2.1** Detect email verification requirement by looking for:
  - Text: "check your email", "verify your email", "confirmation sent"
  - Input field for verification code
- [ ] **5.4.2.2** Pause and notify:
  - Write to progress.md: "Email verification required. Check email, complete verification, then touch continue.flag"
- [ ] **5.4.2.3** Wait for `continue.flag`
- [ ] **5.4.2.4** Verify flow completed (no longer on verification page)
- [ ] **5.4.2.5** Resume exploration

#### 5.4.3 SMS/Phone Verification Handling
- [ ] **5.4.3.1** Detect SMS verification by looking for:
  - Text: "verify your phone", "SMS sent", "enter code"
  - Phone number input or verification code input
- [ ] **5.4.3.2** Pause with same mechanism as email verification
- [ ] **5.4.3.3** Wait for manual completion and `continue.flag`
- [ ] **5.4.3.4** Verify and resume

### 5.5 Multi-Permission Testing

- [ ] **5.5.1** Before switching credential sets, ensure session isolation:
  - Clear cookies/session via new incognito context or explicit logout
  - Verify logged-out state before proceeding
- [ ] **5.5.2** Run key flows with each configured credential set
- [ ] **5.5.3** Track which flows were tested at which permission level
- [ ] **5.5.4** Compare results across permission levels:
  - Flag unexpected access (user sees admin-only data)
  - Flag unexpected denial (admin can't access admin features)
- [ ] **5.5.5** Save permission comparison to `coverage-permissions.json`

---

## Phase 6: Dynamic Test Execution

### 6.0 Safe Mode Enforcement (PRD FR-4.2) — HIGH PRIORITY

> **CRITICAL:** Check before every test action.

- [ ] **6.0.1** Before each form submission, check:
  - Is form action destructive? (delete, remove, cancel, refund)
  - If yes AND `safe_mode`: skip and log "Skipped destructive action: [action]"
- [ ] **6.0.2** Before creating any data:
  - If `is_production_data`: skip data creation tests
  - Log: "Skipped data creation (production environment)"
- [ ] **6.0.3** Destructive action patterns to detect:
  - Button text: "Delete", "Remove", "Cancel", "Refund", "Destroy"
  - Form action URLs containing: `/delete`, `/remove`, `/destroy`
  - Confirmation dialogs with "permanent", "cannot be undone"

### 6.1 Flow Execution Engine

- [ ] **6.1.1** Parse PRD user flows into executable step sequences
- [ ] **6.1.2** Map step descriptions to UI actions:
  - "Click [button]" → find button by text, click
  - "Fill [field] with [value]" → find input, enter value
  - "Submit form" → find submit button or form, submit
  - "Verify [condition]" → check page state
- [ ] **6.1.3** Execute flows sequentially with error handling
- [ ] **6.1.4** Handle branching flows (if X then Y else Z)
- [ ] **6.1.5** Track flow completion in code-analysis.json: `flows_completed`, `flows_failed`
- [ ] **6.1.6** **Update exploration queue as flows discover new pages/paths:**
  - When flow navigates to new URL, add to page inventory
  - Update app map with newly discovered routes
  - Track coverage delta from flow execution

### 6.2 Form Testing

- [ ] **6.2.1** For each discovered form, run test suite:
  - **Happy path:** Submit with valid test data
  - **Empty required:** Submit with required fields empty
  - **Invalid format:** Submit with wrong data types (text in number field, etc.)
  - **Boundary:** Test max length, special characters
- [ ] **6.2.2** Generate appropriate test data based on field type:
  - Email fields: `test@example.com`
  - Phone fields: `555-0100`
  - Text fields: `Test Input {timestamp}`
  - Number fields: `42`
  - **Select/dropdown:** Test each option
  - **Checkbox:** Test checked/unchecked states
  - **Radio buttons:** Test each option
  - **Date picker:** Test valid date, past date, future date
  - **File upload:** Skip in v1 (mark as "not tested - file upload")
  - **Rich text/WYSIWYG:** Test plain text input only
- [ ] **6.2.3** Verify form submission results:
  - Success: look for success message, redirect, or data confirmation
  - Validation error: capture error messages (look for `.error`, `[role=alert]`, red text)
  - Server error: capture error state
- [ ] **6.2.4** Record all form test results in findings
- [ ] **6.2.5** Implement retry with timing heuristics:
  - Wait for form submission to complete (loading indicator gone)
  - Timeout after 10 seconds
  - Retry once on timeout

### 6.3 Edge Case Generation

- [ ] **6.3.1** Test boundary conditions:
  - Max length strings (255, 1000, 5000 chars)
  - Special characters (`<script>`, `' OR 1=1 --`, unicode)
  - Negative numbers where positive expected
  - Future/past dates
- [ ] **6.3.2** Test empty states:
  - Pages with no data (empty lists, no results)
  - New user with no history
- [ ] **6.3.3** Test rapid repeated actions:
  - Double-click prevention
  - Rapid form submission
  - Quick navigation back/forward
- [ ] **6.3.4** Record edge case results as findings (with appropriate severity)
- [ ] **6.3.5** **SAFETY CHECK:** Skip edge case tests on production data

### 6.4 Real-Time Feature Testing

- [ ] **6.4.1** Identify real-time features by:
  - UI elements with "Live" or "Real-time" labels
  - Polling indicators (spinners, auto-refresh text)
  - **Note:** WebSocket detection may not be possible via MCP; use UI heuristics
- [ ] **6.4.2** Test real-time updates:
  - Trigger action that should cause update
  - Wait configurable seconds (default: 5)
  - Verify expected state change occurred
- [ ] **6.4.3** Flag failures as `[MAY BE FLAKY]` — real-time features can be timing-dependent
- [ ] **6.4.4** Record real-time test results with timing info
- [ ] **6.4.5** Implement configurable wait times:
  - Read `exploration.realtime_wait_seconds` from config (default: 5)
  - Allow override per-test

---

## Phase 7: Finding Generation & Quality

### 7.1 Evidence Collection

- [ ] **7.1.1** For each finding, capture:
  - Screenshot at moment of discovery
  - URL where issue occurred
  - Element involved (selector or description)
  - Action that triggered issue
  - Console errors (if any, via `mcp__claude-in-chrome__read_console_messages`)
- [ ] **7.1.2** Record reproduction steps from action log
- [ ] **7.1.3** Capture expected vs actual behavior:
  - Expected: from PRD, or reasonable default
  - Actual: what actually happened
- [ ] **7.1.4** Link to relevant PRD section if traceable
- [ ] **7.1.5** Save to `.complete-agent/audits/current/findings/finding-{n}.json`

### 7.2 Finding Classification

- [ ] **7.2.1** Apply severity classification:
  - **P0 (Showstopper):** App crash, data loss, security hole, core flow broken
  - **P1 (Significant):** Feature doesn't match spec, important edge case fails
  - **P2 (Polish):** UX confusion, minor visual issues, nice-to-have
  - **Question:** Ambiguous requirement, needs human clarification
- [ ] **7.2.2** Apply confidence score (0-100):
  - 90-100: Definite bug, clear evidence
  - 70-89: Likely bug, may need verification
  - 50-69: Possible bug, uncertain
  - <50: Low confidence, filter out
- [ ] **7.2.3** Tag with category:
  - `auth`: Login, logout, permissions
  - `forms`: Form validation, submission
  - `navigation`: Links, routing, redirects
  - `data`: Display, CRUD operations
  - `ui`: Layout, styling, responsiveness
  - `error-handling`: Error states, recovery

### 7.3 LLM Critique Pass

- [ ] **7.3.1** Before presenting findings, run critique prompt:
  - "Is this finding actionable? Can a developer fix it?"
  - "Is this a real bug or intentional design?"
  - "Are reproduction steps clear enough?"
  - "Is severity appropriate?"
- [ ] **7.3.2** Filter out findings with confidence < 50
- [ ] **7.3.3** Improve vague descriptions with specific details
- [ ] **7.3.4** Mark uncertain items as `[NEEDS CLARIFICATION]`
- [ ] **7.3.5** Save critique notes with each finding

### 7.4 Deduplication

- [ ] **7.4.1** Check for similar findings in current audit:
  - Same page + same element type = likely duplicate
  - Similar error message = likely duplicate
- [ ] **7.4.2** Check for existing GitHub issues (if gh CLI available):
  - `gh issue list --search "[element] [error type]"`
  - Flag as "previously reported" if similar issue exists
- [ ] **7.4.3** Merge duplicate findings, keeping best evidence
- [ ] **7.4.4** Save deduplication decisions in findings metadata

### 7.5 Privacy & Screenshot Retention (PRD FR-4.3) — HIGH PRIORITY

- [ ] **7.5.1** PII detection guidance:
  - Flag screenshots containing: email addresses, phone numbers, names, addresses
  - Warn in progress.md: "Screenshot may contain PII - review before sharing"
- [ ] **7.5.2** Screenshot retention policy:
  - Keep local screenshots until issue creation succeeds
  - After issue created with screenshot: delete local copy
  - Findings not promoted to issues: delete screenshots at end of audit
  - If upload fails: keep local, reference path in issue
- [ ] **7.5.3** Implement cleanup command: `/complete-audit --cleanup`
  - Delete all screenshots from previous audits
  - Delete test data tracking files
  - Keep findings and reports
- [ ] **7.5.4** Add retention metadata to findings:
  - `screenshot_uploaded: true/false`
  - `screenshot_deleted: true/false`
  - `retention_reason: "uploaded to issue #42" | "not promoted" | "upload failed"`

---

## Checkpoints & Exit Criteria

### After Phase 3 (Dashboard):
- [ ] progress.md includes queue-based completion estimate
- [ ] stop.flag works reliably
- [ ] continue.flag mechanism documented and working
- [x] progress.json exists for programmatic access

### After Phase 5 (Authentication):
- [ ] Data safety gating prevents destructive actions on production
- [ ] Can login with configured credentials
- [ ] Multi-permission testing executes with session isolation
- [ ] OAuth/Email/SMS pause/resume works

### After Phase 6 (Test Execution):
- [ ] Safe mode skips destructive actions
- [ ] PRD flows can be executed
- [ ] Forms are tested with valid/invalid inputs (all control types)
- [ ] Edge cases are generated and tested (non-production only)
- [ ] Exploration queue updates as new paths discovered

### After Phase 7 (Findings):
- [ ] Every finding has screenshot + reproduction steps
- [ ] Findings are classified by severity and confidence
- [ ] LLM critique filters out low-quality findings
- [ ] No duplicate findings in output
- [ ] Screenshot retention policy enforced

---

## Definition of Done (v2)

This phase is complete when:
1. [ ] Data safety gating works (production detection, safe mode)
2. [ ] Login flow works with configured credentials
3. [ ] At least 3 forms are tested with valid/invalid inputs
4. [ ] PRD user flows can be executed (simple flows only)
5. [ ] Findings have proper evidence collection
6. [ ] LLM critique reduces false positives
7. [ ] No duplicate findings in final report
8. [ ] Screenshot retention policy enforced

---

## Technical Notes

### Credential Security
- Credentials loaded at runtime from config, not stored in code
- Environment variables preferred over plaintext
- Never log passwords in progress.md, progress.json, or findings

### Test Data Generation
- Use predictable but unique values (`test+{timestamp}@...`)
- Track created data in `test-data-created.json` for cleanup
- Avoid real user data in any environment
- Skip data creation on production environments

### MCP Tool Names (Aligned with Claude-for-Chrome)
- `mcp__claude-in-chrome__form_input` - Fill form fields
- `mcp__claude-in-chrome__computer` - Click, type, screenshot
- `mcp__claude-in-chrome__read_page` - Get accessibility tree
- `mcp__claude-in-chrome__navigate` - Go to URL
- `mcp__claude-in-chrome__read_console_messages` - Get console errors

### Finding Storage Format
```json
{
  "id": "finding-001",
  "severity": "P1",
  "confidence": 85,
  "category": "forms",
  "url": "/settings",
  "element": "email input",
  "action": "Submit with invalid email",
  "expected": "Validation error message",
  "actual": "Form submitted without validation",
  "screenshot": "ss_finding_001",
  "screenshot_uploaded": false,
  "screenshot_deleted": false,
  "reproduction": [
    "Navigate to /settings",
    "Enter 'notanemail' in email field",
    "Click Save"
  ],
  "prd_reference": "FR-4.2 Email validation",
  "critique_notes": "Clear bug, validation missing"
}
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Production data modification | Data safety gating (5.0), safe mode enforcement (6.0) |
| Login failures block audit | Fall back to unauthenticated exploration, report as finding |
| Form testing creates bad data | Safe test patterns, track created data, skip on production |
| Edge cases cause crashes | Catch exceptions, continue with next test |
| Real-time tests are flaky | Flag as `[MAY BE FLAKY]`, configurable wait times |
| OAuth/verification requires manual | Clear pause/continue instructions via file flags |
| Session cross-contamination | Explicit logout/cookie clear between permission sets |
| PII in screenshots | Detection guidance, retention policy, cleanup command |

---

## Assumptions to Validate

1. Form detection from code analysis matches actual rendered forms
2. PRD flows can be parsed into executable steps
3. Test data patterns don't conflict with existing data
4. File-based continue.flag approach works reliably
5. Credential environment variables are available at runtime
6. Session isolation via logout is sufficient (vs incognito)
7. MCP tools provide stable element references across navigations

---

## Codex Review Feedback (Incorporated)

**Review Date:** February 3, 2026

### HIGH Priority - Addressed:
- [x] Data safety gating (5.0) - production detection, safe mode, cleanup tracking
- [x] Privacy/screenshot retention (7.5) - PII guidance, retention policy, cleanup command
- [x] External verification flows (5.4) - OAuth, email, SMS pause/resume
- [x] Production-unsafe form testing (6.0) - safe mode enforcement for destructive actions

### MED Priority - Addressed:
- [x] OAuth mechanism documented as file-based v1 approach (3.3)
- [x] MCP tool names aligned to actual Claude-for-Chrome tools (5.2.2, Technical Notes)
- [x] Dynamic test plan recursion (6.1.6) - update exploration queue
- [x] Retry/timing heuristics (5.2.7, 6.2.5, 6.4.5)
- [x] Multi-permission isolation (5.5.1) - explicit logout/cookie clear
- [x] Form coverage gaps (6.2.2) - added select, checkbox, radio, datepicker, file upload, rich-text

### LOW Priority - Addressed:
- [x] ETA estimation clarified as queue-based, not percentage (3.1.4)
- [x] Real-time detection uses UI heuristics, not WebSocket (6.4.1)
