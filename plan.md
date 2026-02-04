# Project Completion Agent - Implementation Plan

**Version:** 1.1
**Date:** February 3, 2026
**Based On:** PRD v1.3
**Status:** Draft (Codex Reviewed)

---

## Overview

This plan breaks the Project Completion Agent into implementable phases, with each phase delivering usable functionality. Following the constitution principle of "integrate, don't reinvent," we build on existing Claude Code skill infrastructure.

---

## Phase 0: Preflight & Environment Validation

> **Goal:** Validate environment before any audit work. Fail fast with clear errors.

### 0.1 Capability Detection

**Tasks:**
- [ ] Check for Claude for Chrome MCP tools (`mcp__claude-in-chrome__*`)
- [ ] If MCP available: set `browser_mode: mcp`
- [ ] If MCP unavailable: set `browser_mode: none` (code-only audit)
- [ ] **No Playwright fallback in v1** — too complex, defer to v2
- [ ] Report capability summary to user before proceeding

**Acceptance Criteria:**
- Clear message: "Browser automation: available via Claude for Chrome" or "Browser automation: unavailable, running code-only audit"
- User can proceed or abort based on capabilities

### 0.2 GitHub CLI Validation

**Tasks:**
- [ ] Check `gh auth status` — is user authenticated?
- [ ] Check repo context — are we in a git repo with GitHub remote?
- [ ] If not authenticated: clear error with instructions (`gh auth login`)
- [ ] If no GitHub remote: warn that issue creation will be skipped

**Acceptance Criteria:**
- Fails fast if `gh` not installed or not authenticated
- Clear actionable error messages

### 0.3 App URL Validation

**Tasks:**
- [ ] Read `environment.url` from config
- [ ] If missing: prompt user to provide URL or detect from common patterns
- [ ] Verify URL is accessible (HTTP 200 or redirect)
- [ ] If unreachable: clear error with troubleshooting tips

**Acceptance Criteria:**
- Audit doesn't start if app URL is unreachable
- User knows exactly what to fix

### 0.4 PRD Confirmation

**Tasks:**
- [ ] Run PRD discovery (glob for planning docs)
- [ ] Rank candidates by: filename version, frontmatter, keywords
- [ ] Present top candidate to user: "Found PRD: `PRD-v4.md`. Use this? [Y/n/other]"
- [ ] Allow user to specify different file
- [ ] If no PRD found: warn and allow code-only audit

**Acceptance Criteria:**
- User confirms which PRD to use (no silent mis-selection)
- Can proceed without PRD (reduced functionality)

---

## Phase 1: Foundation (Core Skill Structure)

> **Goal:** Skeleton skill that can be invoked, reads PRD, and produces basic output.

### 1.1 Skill Scaffolding

**Create skill directory structure:**
```
~/.claude/skills/complete-audit/
├── skill.md                    # Main skill definition
├── SKILL_INSTRUCTIONS.md       # Detailed agent instructions
└── templates/
    ├── config.example.yml      # Example configuration
    ├── report.md               # Finding report template
    └── issue.md                # GitHub issue template
```

**Tasks:**
- [ ] Create `skill.md` with basic invocation handling (`/complete-audit`, `/complete-verify`)
- [ ] Create `SKILL_INSTRUCTIONS.md` with agent behavior rules
- [ ] Create example config template
- [ ] Create report and issue markdown templates
- [ ] Test basic skill invocation works

**Acceptance Criteria:**
- `/complete-audit` is recognized as a valid command
- Skill outputs "Completion Agent initialized" message
- Templates are readable

### 1.2 Project State Directory

**Create `.complete-agent/` management:**

**Tasks:**
- [ ] On first run, create `.complete-agent/` in project root
- [ ] Create `config.yml` from template if not exists (prompt user to fill in)
- [ ] Create `audits/` directory structure
- [ ] Add `.complete-agent/` patterns to `.gitignore` suggestions

**Acceptance Criteria:**
- Running `/complete-audit` creates proper directory structure
- Config file is created with placeholder values
- User is prompted to configure before first real audit

### 1.3 PRD Discovery & Parsing

**Implement context discovery (FR-2.1):**

**Tasks:**
- [ ] Glob for planning docs: `**/PRD*.md`, `**/prd*.md`, `**/plan*.md`, `**/tasks*.md`
- [ ] Version detection: parse filenames for v1/v2/etc, check frontmatter dates, fall back to git dates
- [ ] Select latest version of each document type
- [ ] Parse PRD to extract:
  - Project name/description
  - User flows and features
  - Acceptance criteria
  - Explicitly deferred items
- [ ] Build "mental model" summary for agent reference

**Acceptance Criteria:**
- Agent correctly identifies latest PRD in a project with multiple versions
- Extracted features list matches PRD content
- Deferred items are flagged as "do not report as missing"

---

## Phase 2: Code Analysis & Coverage Metrics

> **Goal:** Analyze codebase to identify testable surface area before browser exploration.

### 2.1 Route/Endpoint Discovery

**Tasks:**
- [ ] Detect framework (Next.js, React Router, Express, etc.)
- [ ] Extract routes from:
  - File-based routing (Next.js `app/` or `pages/`)
  - Router configuration files
  - API endpoint definitions
- [ ] Build route inventory with:
  - Path
  - HTTP method (for APIs)
  - Expected parameters
  - Auth requirements (if detectable)

**Acceptance Criteria:**
- For a Next.js app, correctly identifies all page routes
- For an Express app, correctly identifies API endpoints
- Route inventory saved to `.complete-agent/audits/*/coverage.json`

### 2.2 Component/Feature Mapping

**Tasks:**
- [ ] Identify major UI components (forms, modals, lists)
- [ ] Map components to routes where possible
- [ ] Identify interactive elements (buttons with handlers, form submissions)
- [ ] Cross-reference with PRD features

**Acceptance Criteria:**
- Component inventory includes forms and their fields
- Interactive elements have associated actions identified
- PRD features mapped to code locations where possible

### 2.3 Coverage Tracking Structure

**Tasks:**
- [ ] Create `coverage.json` schema:
  ```json
  {
    "routes": [{"path": "/login", "visited": false, "findings": []}],
    "forms": [{"id": "signup-form", "submitted": false, "fields_tested": []}],
    "flows": [{"name": "user-registration", "steps_completed": 0, "total_steps": 5}]
  }
  ```
- [ ] **v1: Use counts only** ("5 of 12 pages visited") — no percentages initially
- [ ] Track coverage updates during exploration
- [ ] **v2: Add percentage calculation** after counts are reliable

**Acceptance Criteria:**
- Coverage counts accurately reflect what has/hasn't been tested
- No misleading "80% coverage" claims — just raw counts

---

## Phase 3: Progress Dashboard

> **Goal:** Visibility into audit progress. Start simple, add HTML later.

### 3.1 Progress File (v1 MVP)

**Tasks:**
- [ ] Write `progress.md` after each significant action (human-readable)
- [ ] Include:
  - Current page/action
  - Coverage counts (X pages visited, Y forms submitted)
  - Findings count
  - Elapsed time
- [ ] User can `tail -f .complete-agent/audits/*/progress.md` to monitor
- [ ] Also write `progress.json` for programmatic access

**Acceptance Criteria:**
- Progress visible via simple file watching
- Updates every few actions
- Human-readable format

### 3.2 Stop Signal

**Tasks:**
- [ ] Check for `stop.flag` in audit directory before each major action
- [ ] User creates file manually: `touch .complete-agent/audits/current/stop.flag`
- [ ] Graceful stop: finish current action, save state, generate partial report
- [ ] Clear instructions in progress.md on how to stop

**Acceptance Criteria:**
- Stop flag causes clean shutdown
- Partial report generated on early stop
- User knows how to stop (documented in progress output)

### 3.3 HTML Dashboard (v1.1 — Deferred)

**Tasks:**
- [ ] Create static HTML dashboard in `.complete-agent/dashboard/index.html`
- [ ] Auto-refresh via polling `progress.json`
- [ ] "That's enough" button that creates stop flag
- [ ] Simple local server to serve it

**Acceptance Criteria:**
- Dashboard renders correctly in browser
- Metrics update as audit progresses
- **Deferred until core audit works**

---

## Phase 4: Browser Automation

> **Goal:** Explore running application via Claude for Chrome.

### 4.1 Browser Detection & Setup

**Tasks:**
- [ ] Check if Claude for Chrome MCP is available (done in Phase 0 preflight)
- [ ] If available: use MCP tools (`mcp__claude-in-chrome__*`)
- [ ] If not available: **skip browser exploration, do code-only audit** (no Playwright in v1)
- [ ] URL accessibility verified in Phase 0 preflight

**Acceptance Criteria:**
- Agent uses MCP if available
- If no browser, gracefully degrades to code-only audit with clear messaging
- No silent failures

### 4.2 Page Exploration

**Tasks:**
- [ ] Navigate to configured base URL
- [ ] Screenshot current page
- [ ] Use `read_page` to get accessibility tree
- [ ] Identify all interactive elements (links, buttons, forms, inputs)
- [ ] Build page map: element → action → expected result
- [ ] Track visited pages to avoid loops

**Acceptance Criteria:**
- All visible links and buttons identified
- Forms identified with their fields
- No infinite loops on pages with self-links

### 4.3 SPA Handling

**Tasks:**
- [ ] Detect client-side navigation (URL changes without full reload)
- [ ] Wait for DOM mutations to settle after navigation
- [ ] Scroll to trigger lazy-loaded content
- [ ] Re-scan page after dynamic content loads

**Acceptance Criteria:**
- Lazy-loaded content is discovered
- Client-side route changes are detected
- Agent waits appropriately for async content

### 4.4 Multi-Tab/Popup Handling

**Tasks:**
- [ ] Detect when action opens new tab or popup
- [ ] Switch context to new tab
- [ ] Complete flow in popup (e.g., OAuth)
- [ ] Return to original tab
- [ ] Handle popup blockers gracefully

**Acceptance Criteria:**
- OAuth popups can be navigated
- Agent returns to correct tab after popup flow
- Blocked popups reported as finding

---

## Phase 5: Authentication & User Flows

> **Goal:** Test authenticated features with multiple permission levels.

### 5.1 Credential Management

**Tasks:**
- [ ] Read credentials from `.complete-agent/config.yml`
- [ ] Support multiple credential sets (admin, user, guest)
- [ ] Secure handling (never log passwords, warn about plaintext)
- [ ] Environment variable substitution (`${VAR_NAME}`)

**Acceptance Criteria:**
- Credentials loaded from config
- Environment variables resolved
- No passwords in logs or reports

### 5.2 Login Flow Execution

**Tasks:**
- [ ] Detect login page/form
- [ ] Fill credentials and submit
- [ ] Verify login succeeded (check for auth state indicators)
- [ ] Handle login failures gracefully
- [ ] Support "remember me" / session persistence

**Acceptance Criteria:**
- Can log in with valid credentials
- Failed login reported as finding (if unexpected)
- Session maintained across page navigations

### 5.3 User Creation (When Applicable)

**Tasks:**
- [ ] Check PRD for signup feature
- [ ] Check UI for signup button/link
- [ ] If both indicate signup exists: test it
- [ ] Use test email pattern: `test+audit-{timestamp}@testdomain.com`
- [ ] Complete signup flow including any verification pauses
- [ ] Report missing signup as finding if PRD expects it

**Acceptance Criteria:**
- Signup tested when appropriate
- Test users identifiable for cleanup
- PRD/UI mismatch reported

### 5.4 OAuth/SSO Handling

**Tasks:**
- [ ] Detect OAuth redirect
- [ ] Attempt automatic completion (browser may be authenticated)
- [ ] If manual intervention needed: pause and notify via dashboard
- [ ] Wait for user to click Continue
- [ ] Verify auth completed and resume

**Acceptance Criteria:**
- Auto-OAuth works when browser is authenticated
- Manual pause shows clear instructions
- Resume works correctly after manual completion

### 5.5 Multi-Permission Testing

**Tasks:**
- [ ] Run key flows with each credential set
- [ ] Compare results across permission levels
- [ ] Flag unexpected access (user sees admin data)
- [ ] Flag unexpected denial (admin can't access admin features)

**Acceptance Criteria:**
- Same flow tested at multiple permission levels
- Authorization bugs detected
- Results compared and anomalies flagged

---

## Phase 6: Dynamic Test Execution

> **Goal:** Execute tests based on PRD flows and discovered UI elements.

### 6.1 Flow Execution Engine

**Tasks:**
- [ ] Parse PRD user flows into executable steps
- [ ] Map steps to UI actions (click, fill, submit, verify)
- [ ] Execute flows sequentially
- [ ] Handle branches (if X then Y else Z)
- [ ] Track flow completion in coverage

**Acceptance Criteria:**
- PRD flows translated to actions
- Flows execute successfully on working app
- Failures captured with context

### 6.2 Form Testing

**Tasks:**
- [ ] For each discovered form:
  - Submit with valid data (happy path)
  - Submit with empty required fields
  - Submit with invalid data (wrong format)
  - Test field validation messages
- [ ] Verify form submission results (success message, redirect, data saved)

**Acceptance Criteria:**
- Forms tested with valid and invalid inputs
- Validation behavior documented
- Submission results verified

### 6.3 Edge Case Generation

**Tasks:**
- [ ] Test boundary conditions (max length, special characters)
- [ ] Test empty states (no data, new user)
- [ ] Test error states (network failure simulation if possible)
- [ ] Test rate limits (rapid repeated actions)

**Acceptance Criteria:**
- Boundary conditions tested
- Empty states handled or flagged
- Rate limit behavior documented

### 6.4 Real-Time Feature Testing

**Tasks:**
- [ ] Identify real-time features (websockets, polling indicators)
- [ ] Trigger action that should cause real-time update
- [ ] Wait configurable seconds (default 5)
- [ ] Verify expected state change
- [ ] Flag failures as "may be flaky"

**Acceptance Criteria:**
- Real-time features identified
- Basic temporal validation works
- Flaky results flagged appropriately

---

## Phase 7: Finding Generation & Quality

> **Goal:** Document issues with evidence and filter for quality.

### 7.1 Evidence Collection

**Tasks:**
- [ ] Screenshot at moment of issue discovery
- [ ] Record steps to reproduce (action log)
- [ ] Capture expected vs actual behavior
- [ ] Link to relevant PRD section if traceable
- [ ] Store in `.complete-agent/audits/*/findings/`

**Acceptance Criteria:**
- Every finding has screenshot
- Reproduction steps are accurate
- PRD linkage when applicable

### 7.2 Finding Classification

**Tasks:**
- [ ] Apply severity classification:
  - P0: Crash, data loss, security hole, core flow broken
  - P1: Feature doesn't match spec, important edge case fails
  - P2: UX confusion, minor visual issues
  - Question: Ambiguous, needs clarification
- [ ] Apply confidence score (how certain is this a real issue?)
- [ ] Tag with category (auth, forms, navigation, data, UI)

**Acceptance Criteria:**
- All findings have severity and confidence
- Categories applied consistently
- Classification matches issue characteristics

### 7.3 LLM Critique Pass

**Tasks:**
- [ ] Before presenting findings, run critique prompt:
  - Is this actionable?
  - Is this a real bug or intentional design?
  - Is reproduction clear enough to fix?
  - Is severity appropriate?
- [ ] Filter out low-confidence findings
- [ ] Improve descriptions for clarity
- [ ] Mark uncertain items as `[NEEDS CLARIFICATION]`

**Acceptance Criteria:**
- Findings are reviewed before presentation
- Vague findings improved or filtered
- False positive rate reduced

### 7.4 Deduplication

**Tasks:**
- [ ] Check for similar existing findings (same page, same element)
- [ ] Check for existing GitHub issues (via `gh issue list`)
- [ ] Merge duplicates, keep best evidence
- [ ] Flag as "previously reported" if issue exists

**Acceptance Criteria:**
- No duplicate findings in report
- Existing issues not re-reported
- Evidence consolidated

---

## Phase 8: Reporting & Issue Creation

> **Goal:** Present findings to user, create GitHub issues for approved items.

### 8.1 Report Generation

**Tasks:**
- [ ] Generate markdown report from findings
- [ ] Group by severity (P0 first)
- [ ] Include summary statistics
- [ ] Include coverage metrics
- [ ] Include reproduction steps and screenshots
- [ ] Save to `.complete-agent/audits/*/report.md`

**Acceptance Criteria:**
- Report is readable and well-organized
- All findings included with evidence
- Coverage summary accurate

### 8.2 Interactive Review

**Tasks:**
- [ ] Present findings to user in terminal
- [ ] For each finding, allow: Accept, Reject, Edit, Skip
- [ ] Bulk actions: Accept all P0, Reject all P2
- [ ] Save decisions for issue creation

**Acceptance Criteria:**
- User can review each finding
- Bulk actions work correctly
- Decisions persisted

### 8.3 GitHub Issue Creation

**Tasks:**
- [ ] For accepted findings, create GitHub issues via `gh issue create`
- [ ] Upload screenshots to GitHub (embed in issue body)
- [ ] Apply labels (bug, priority/P0, etc.)
- [ ] Group non-P0 findings by feature area into single issues
- [ ] P0 findings get individual issues
- [ ] Include reproduction steps formatted for `/orchestrate`

**Acceptance Criteria:**
- Issues created successfully
- Screenshots visible in issues
- Labels applied correctly
- Grouped appropriately

### 8.4 Screenshot Upload & Cleanup

**Tasks:**
- [ ] Upload screenshots to GitHub when creating issues
- [ ] **Keep local screenshots until issue creation fully succeeds** (don't delete on upload, delete after issue confirmed created)
- [ ] Handle upload failures gracefully (keep local, reference path in issue)
- [ ] Clean up rejected finding screenshots at end of review
- [ ] Provide manual cleanup command: `/complete-audit --cleanup`

**Acceptance Criteria:**
- Screenshots embedded in issues
- Local cleanup only after issue confirmed created
- No data loss on partial failures

---

## Phase 9: Verification Mode

> **Goal:** Verify fixes and check for regressions.

### 9.1 Issue Tracking

**Tasks:**
- [ ] Store reproduction steps for created issues in `.complete-agent/issues/`
- [ ] Track issue number → test mapping
- [ ] Detect when issue is closed (via `gh issue view`)

**Acceptance Criteria:**
- Reproduction steps saved per issue
- Can look up test for any created issue

### 9.2 Targeted Verify Command

**Tasks:**
- [ ] Implement `/complete-verify gh issue #42`
- [ ] Load reproduction steps for issue
- [ ] Execute specific test
- [ ] Report: Fixed / Still Broken / New Error

**Acceptance Criteria:**
- Verify command works with issue number
- Correct result reported
- Evidence captured for still-broken cases

### 9.3 Regression Testing

**Tasks:**
- [ ] After verifying fix, test adjacent functionality
- [ ] Identify related flows (same feature area)
- [ ] Run abbreviated tests on related flows
- [ ] Report any new issues introduced

**Acceptance Criteria:**
- Related flows identified
- Regression testing executes
- New issues flagged

---

## Phase 10: Polish & Edge Cases

> **Goal:** Handle remaining edge cases and improve robustness.

### 10.1 Checkpoint & Resume

**Tasks:**
- [ ] Save checkpoint after each major action
- [ ] Checkpoint includes: current position, coverage state, findings so far
- [ ] `/complete-audit --resume` reads checkpoint and continues
- [ ] Handle corrupted checkpoints gracefully

**Acceptance Criteria:**
- Interrupted audits can resume
- No duplicate work on resume
- Corrupted checkpoints handled

### 10.2 Safe Mode

**Tasks:**
- [ ] Config option: `safe_mode: true`
- [ ] Skip destructive actions (delete, refund, irreversible)
- [ ] Log skipped actions as "not tested - destructive"
- [ ] Allow override for specific actions

**Acceptance Criteria:**
- Destructive actions skipped in safe mode
- Skipped actions documented
- Override works

### 10.3 External Verification Pauses

**Tasks:**
- [ ] Detect "check your email" type messages
- [ ] Pause and notify via dashboard
- [ ] Wait for user Continue signal
- [ ] Verify flow completed after resume

**Acceptance Criteria:**
- Email verification pauses correctly
- Dashboard notification clear
- Resume works after manual step

### 10.4 Error Recovery

**Tasks:**
- [ ] Handle network errors gracefully
- [ ] Handle page crashes
- [ ] Handle unexpected popups/modals
- [ ] Retry transient failures
- [ ] Log unrecoverable errors and continue

**Acceptance Criteria:**
- Transient errors retried
- Unrecoverable errors logged
- Audit continues after non-fatal errors

---

## Implementation Order

> **Updated based on Codex review:** Reordered to get MVP browser exploration working first, defer dashboard.

| Phase | Dependencies | Estimated Complexity | Priority |
|-------|--------------|---------------------|----------|
| 0. Preflight | None | Low | **First** |
| 1. Foundation | Phase 0 | Low | **First** |
| 4. Browser Automation (MVP) | Phase 1 | Medium | **Second** |
| 2. Code Analysis | Phase 1 | Medium | Third |
| 6. Test Execution (Simple) | Phases 2, 4 | Medium | Fourth |
| 7. Finding Generation | Phase 6 | Medium | Fifth |
| 8. Reporting | Phase 7 | Medium | Sixth |
| 3. Dashboard | Phase 1 | Medium | **Deferred** |
| 5. Authentication | Phase 4 | Medium | Seventh |
| 9. Verification | Phase 8 | Medium | Eighth |
| 10. Polish | All above | Low | Last |

**Recommended approach:**
1. **MVP (Phases 0, 1, 4-MVP):** Preflight checks + basic browser exploration ("open URL, find links, click around")
2. **Core Audit (Phases 2, 6-simple, 7, 8):** Code analysis + simple test execution + findings + reporting
3. **Dashboard (Phase 3):** Add after core audit works (can use `progress.md` file initially)
4. **Auth & Polish (Phases 5, 9, 10):** Multi-permission testing, verification mode, edge cases

**De-risking decisions:**
- No Playwright fallback in v1 (if no browser, do code-only audit)
- PRD selection requires user confirmation
- Coverage uses counts, not percentages
- Dashboard starts as `progress.md`, HTML added later

---

## Technical Decisions

### Language/Runtime
- Skill runs within Claude Code (no separate runtime)
- Dashboard: vanilla HTML/JS (no build step)
- Data files: JSON for machine state, Markdown for human-readable

### Dependencies
- Claude for Chrome MCP (primary browser automation — optional, degrades gracefully)
- GitHub CLI (`gh`) for issue management (required for issue creation)
- Python `http.server` or `npx serve` for dashboard (v1.1, deferred)

**Removed from v1:**
- Playwright (too complex, use code-only audit instead)

### State Files
All state in `.complete-agent/`:
- `config.yml` - User configuration
- `audits/{timestamp}/` - Per-audit data (e.g., `2026-02-03T14-30-00/` to avoid collisions)
- `audits/current` - Symlink to latest audit (for easy `tail -f`)
- `dashboard/` - Dashboard static files (v1.1)
- `issues/` - Issue tracking data

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Long audit times | Checkpointing, dashboard stop button, progress visibility |
| False positives | LLM critique pass, confidence scoring, user review before issue creation |
| Browser automation flakiness | Retries, timing heuristics, graceful degradation |
| OAuth complexity | Leverage authenticated browser, manual pause fallback |
| Screenshot PII | User review before upload, redaction guidance in docs |

---

## Success Metrics (v1)

1. **Can complete full audit** of a typical web app (10-20 pages)
2. **Finds at least 3 real issues** that weren't previously known
3. **<20% false positive rate** on findings
4. **Issues are actionable** via `/orchestrate`
5. **Dashboard provides useful visibility** during audit
6. **Verify mode works** for confirming fixes

---

## Out of Scope for v1

- Mobile testing
- API-only testing (no UI)
- Performance testing
- Security penetration testing
- Scheduled/continuous audits
- Multi-repo support
- Non-GitHub issue trackers
- Test email service integration
- Playwright browser fallback (use code-only audit instead)
- Coverage percentages (use counts only)
- HTML dashboard (use progress.md file)

---

## Codex Review Feedback (Incorporated)

**Review Date:** February 3, 2026

### P0 Issues Addressed:
- ✅ Added Phase 0 preflight for capability detection
- ✅ Added code-only audit mode when browser unavailable
- ✅ PRD selection now requires user confirmation
- ✅ Defined interaction model (AskUserQuestion for decisions, files for monitoring)

### P1 Issues Addressed:
- ✅ Removed Playwright fallback — too complex for v1
- ✅ Added GitHub CLI auth check to preflight
- ✅ Coverage uses counts, not percentages
- ✅ Screenshot cleanup waits for issue confirmation
- ✅ Audit directories use timestamps to avoid collisions

### Phase Reordering Applied:
- Original: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10
- New: 0 → 1 → 4 → 2 → 6 → 7 → 8 → 3 → 5 → 9 → 10
- Rationale: Get browser exploration working first, defer dashboard

### Simplifications Applied:
- PRD parsing: user confirms selection
- Coverage: counts only (percentages in v2)
- Dashboard: progress.md file first, HTML later
- No-browser mode: code analysis only, no Playwright
- OAuth: manual pause only (automated OAuth deferred)

### Assumptions to Validate Before Implementation:
1. Claude Code skill runtime can read/write project files
2. Claude for Chrome MCP is available and callable
3. `gh` CLI is installed and authenticated
4. Target app is running at accessible URL
5. Project has parseable PRD (or can proceed without)
