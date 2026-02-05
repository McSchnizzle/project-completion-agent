# Plan v2: Project Completion Agent - 100% Spec Compliance

## Objective
Bring the Project Completion Agent skill to 100% compliance with SKILL_INSTRUCTIONS.md specification.

## Codex Review Feedback Incorporated
- ✓ Phase 0/5 now has explicit enforcement (was "no changes needed")
- ✓ Audit directory initialization added
- ✓ Progress system expanded (stop/continue flags, dashboard)
- ✓ Browser exploration rules fully specified
- ✓ Finding quality pipeline complete (no placeholders)
- ✓ Phase 8/9 review flow complete
- ✓ Requirements-to-plan matrix added
- ✓ Negative test paths added

---

## Requirements-to-Plan Matrix

| Spec Section | Requirement | Plan Section | Acceptance Test |
|--------------|-------------|--------------|-----------------|
| Phase 0.1-0.8 | Preflight checks | §1 | All checks pass, summary displayed |
| Phase 0.9 | Preflight summary DISPLAYED | §1 | User sees formatted box |
| Phase 0.10 | User confirmation via AskUserQuestion | §1 | Audit aborts if user says No |
| Phase 1 | prd-summary.json | §2 | File exists with valid schema |
| Phase 1 | No-PRD fallback | §2 | Minimal file created if no PRD |
| Phase 2 | code-analysis.json | §3 | File exists, framework detected or noted |
| Phase 2 | External site fallback | §3 | File created with null codebase_path |
| Phase 3 | progress.md + progress.json | §4 | Both exist, updated per action |
| Phase 3 | Stop flag handling | §4 | Audit stops gracefully on flag |
| Phase 3 | Continue flag handling | §4 | Audit resumes after manual action |
| Phase 3 | HTML dashboard | §4 | dashboard/index.html exists |
| Phase 4 | pages/page-{n}.json per visited page | §5 | Count matches pages_visited |
| Phase 4 | Same-origin enforcement | §5 | External links not followed |
| Phase 4 | coverage-summary.md | §5 | Generated at exploration end |
| Phase 5 | Safety mode BEFORE browser | §6 | Prompt shown, mode logged |
| Phase 5 | Production data warning | §6 | User forced to safe mode or abort |
| Phase 6 | Form testing | §7 | Results logged as findings |
| Phase 7 | Evidence completeness | §8 | All findings have required fields |
| Phase 7 | Critique pass | §8 | Low-confidence filtered out |
| Phase 7 | Deduplication | §8 | dedup metadata in findings |
| Phase 8 | review-decisions.json | §9 | File always created |
| Phase 8 | created-issues.json | §9 | File always created (even if empty) |
| Phase 8 | AskUserQuestion for review | §9 | User prompted with options |
| Phase 8 | gh preflight checks | §9 | Checked before issue creation |
| Phase 8 | Issue URL display | §9 | URLs shown to user |
| Phase 9 | Verification mode | §10 | /complete-verify works |
| Phase 10 | Checkpoint/resume | §11 | checkpoint.json enables resume |

---

## §1: Phase 0 - Preflight (ADD FULL ENFORCEMENT)

**Problem:** Plan v1 said "no changes needed" but spec requires explicit enforcement.

### 1.1 Directory Initialization (MANDATORY FIRST STEP)
```markdown
#### 0.8 Audit Directory Initialization (MANDATORY - ADD TO INSTRUCTIONS)
BEFORE any file writes, create the directory structure:

1. Generate timestamp: `{YYYYMMDD_HHMMSS}`
2. Create directories:
   ```bash
   mkdir -p .complete-agent/audits/{timestamp}
   mkdir -p .complete-agent/audits/{timestamp}/findings
   mkdir -p .complete-agent/audits/{timestamp}/pages
   ```
3. Create symlink:
   ```bash
   ln -sfn {timestamp} .complete-agent/audits/current
   ```
4. Check for stale flags from previous run:
   - If `stop.flag` or `continue.flag` exists: warn user, offer cleanup
5. **GATE CHECK:** Verify directories exist before proceeding

All subsequent file paths use `.complete-agent/audits/current/` prefix.
```

### 1.2 Preflight Checks (ENFORCE EACH STEP)
```markdown
#### 0.1-0.8 Preflight Execution (ADD EXPLICIT ENFORCEMENT)
Execute these checks IN ORDER, logging each result:

1. **Write access check:**
   - `touch .write-access-test && rm .write-access-test`
   - If fails: ABORT "Cannot write to project directory"

2. **Browser capability:**
   - Call `mcp__claude-in-chrome__tabs_context_mcp`
   - Set `browser_mode = 'mcp'` or `'none'`

3. **GitHub CLI:**
   - Run `gh auth status`
   - Store authentication state

4. **Config file:**
   - Read `.complete-agent/config.yml` or create from template
   - **USE AskUserQuestion** if URL missing

5. **App URL validation** (if browser_mode is 'mcp'):
   - Verify URL reachable
   - If unreachable: error with troubleshooting

6. **PRD discovery:**
   - Glob for PRD files
   - **MANDATORY AskUserQuestion:**
     ```
     Found PRD: {file}. Use this?
     Options: [Yes] [No, select different] [Proceed without PRD]
     ```

7. **Initialize audit directory** (per 1.1 above)
```

### 1.3 Preflight Summary Display (MANDATORY)
```markdown
#### 0.9 Preflight Summary Output (MANDATORY - MUST BE DISPLAYED)
ALWAYS display this box to the user before proceeding:

```
═══════════════════════════════════════════
  PREFLIGHT CHECK RESULTS
═══════════════════════════════════════════
  ✓ Write access: confirmed
  ✓ Browser automation: {Claude for Chrome / none}
  ✓ GitHub CLI: {authenticated (username) / not authenticated}
  ✓ Config: {path or 'created from template'}
  ✓ App URL: {url} (HTTP {status})
  ✓ PRD: {file or 'none - code-only audit'}
  ⚠ Safe mode: {ON/OFF}
  ⚠ Production data: {true/false}
═══════════════════════════════════════════
```

This display is MANDATORY. Log to progress.md that it was shown.
```

### 1.4 User Confirmation (MANDATORY)
```markdown
#### 0.10 User Confirmation (MANDATORY - CANNOT SKIP)
**Use AskUserQuestion:**
```
Ready to start audit of {url}. Proceed?
Options: [Yes, start audit] [No, abort]
```

- If "No": Exit with "Audit aborted by user"
- If "Yes":
  - Record `preflight_completed: true` in progress.json
  - Log to activity_log: "User confirmed audit start"
  - Proceed to Phase 1
```

---

## §2: Phase 1 - PRD Parsing (ENFORCE FALLBACK)

**Current:** Mostly working, but fallback needs explicit schema.

```markdown
#### 1.4 No-PRD Fallback (MANDATORY)
If user selected "Proceed without PRD" or no PRD found:

Create `prd-summary.json`:
```json
{
  "schema_version": "1.0",
  "prd_file": null,
  "parsed_at": "ISO8601",
  "features": [],
  "flows": [],
  "out_of_scope": [],
  "deferred": [],
  "summary": {
    "total_features": 0,
    "total_flows": 0,
    "must_have": 0,
    "should_have": 0,
    "could_have": 0
  },
  "notes": "No PRD provided - code-only analysis"
}
```

**GATE CHECK:** `prd-summary.json` MUST exist before Phase 2.
```

---

## §3: Phase 2 - Code Analysis (ADD EXTERNAL SITE FALLBACK)

```markdown
#### 2.6 External Site / No Codebase Fallback (MANDATORY)
If no local codebase is accessible:

1. Attempt to infer framework from page source (check for React, Vue markers)
2. Create `code-analysis.json`:
```json
{
  "schema_version": "1.0",
  "analyzed_at": "ISO8601",
  "framework": "unknown (external site)" OR "React (inferred from page source)",
  "codebase_path": null,
  "routes": [],
  "forms": [],
  "api_routes": [],
  "coverage": {
    "routes_found": 0,
    "routes_matched_to_prd": 0,
    "routes_unmatched": 0,
    "forms_found": 0
  },
  "notes": "External website audit - routes discovered via browser exploration only"
}
```

3. Log: "No codebase access - routes will be discovered via browser"

**GATE CHECK:** `code-analysis.json` MUST exist before Phase 4.
```

---

## §4: Phase 3 - Progress Dashboard (FULL IMPLEMENTATION)

### 4.1 Initialize Progress Files
```markdown
#### 3.0 Initialize Progress Files (MANDATORY - First Action of Phase 3)
IMMEDIATELY after Phase 2 gate passes:

1. Create `progress.md`:
```markdown
# Audit Progress
Started: {timestamp}
Last Action: {timestamp}
Current: initializing
Status: running

## Coverage
- Pages visited: 0
- Pages in queue: 0
- Estimated remaining: unknown

## Findings
- Total: 0
- P0 (Critical): 0
- P1 (Significant): 0
- P2 (Polish): 0

## Recent Activity
- [{timestamp}] Audit initialized
- [{timestamp}] Preflight completed
- [{timestamp}] PRD parsed: {n} features
- [{timestamp}] Code analysis complete

## Controls
To stop: touch .complete-agent/audits/current/stop.flag
To resume (if paused): touch .complete-agent/audits/current/continue.flag
```

2. Create `progress.json` per schema D.1

**GATE CHECK:** Both files MUST exist before Phase 4.
```

### 4.2 Stop Flag Handling
```markdown
#### 3.2 Stop Flag Behavior (ADD ENFORCEMENT)
Check for `stop.flag` BEFORE:
- Any navigation
- Any click action
- Any form interaction
- Starting new page exploration

If `stop.flag` exists:
1. Finish current atomic action
2. Save `checkpoint.json`:
   ```json
   {
     "checkpoint_at": "ISO8601",
     "current_url": "/path",
     "exploration_queue": [...],
     "visited_pages": [...],
     "findings_so_far": N,
     "current_permission_level": "user"
   }
   ```
3. Generate partial `report.md`
4. Update progress.json: `status: "stopped"`
5. Delete `stop.flag`
6. Exit with: "Audit stopped by user. Partial report saved. Resume with /complete-audit --resume"
```

### 4.3 Continue Flag Handling
```markdown
#### 3.3 Continue Flag Behavior (ADD ENFORCEMENT)
When audit is paused (OAuth, email verification, etc.):

1. Update progress.md: "Paused: {reason}. Touch continue.flag to resume."
2. Update progress.json: `status: "paused", pause_reason: "{reason}"`
3. Poll for `continue.flag` every 5 seconds (max 10 minutes)
4. When found:
   - Delete `continue.flag`
   - Verify expected state (logged in, verification complete)
   - Update progress.json: `status: "running"`
   - Resume exploration
5. If `stop.flag` appears while waiting: execute stop behavior
6. If timeout (10 min): Save checkpoint, exit with pause status
```

### 4.4 HTML Dashboard
```markdown
#### 3.4 HTML Dashboard (ADD CREATION STEP)
On audit start, create `dashboard/index.html` if not exists:
- Copy from template in SKILL_INSTRUCTIONS.md (lines 445-619)
- Dashboard reads `audits/current/progress.json`

Log to progress.md: "Dashboard available at .complete-agent/dashboard/index.html"
```

---

## §5: Phase 4 - Browser Exploration (FULL SPECIFICATION)

### 5.1 Page Inventory Schema
```markdown
#### 4.3 Page Documentation (MANDATORY for EVERY visited page)
IMMEDIATELY after loading any page, create `pages/page-{n}.json`:

```json
{
  "schema_version": "1.0",
  "page_number": N,
  "url": "/path",
  "visited_at": "ISO8601",
  "screenshot_id": "ss_XXXXX" OR null,
  "title": "Page Title",
  "links_found": ["/link1", "/link2"],
  "forms_found": N,
  "buttons_found": ["Button1", "Button2"],
  "errors_detected": false,
  "console_errors": [],
  "prd_features_checked": ["F1", "F3"],
  "findings_on_page": ["finding-001"],
  "observations": ["Notable observation 1"]
}
```

**VALIDATION:** After each page visit:
- Count `pages/*.json` files
- Compare to `progress.json.coverage.pages_visited`
- If mismatch: Create missing page files before continuing
```

### 5.2 Same-Origin Enforcement
```markdown
#### 4.3.2 Same-Origin Rules (ADD ENFORCEMENT)
Before following any link:

1. Parse origin: `{protocol}://{host}:{port}`
2. Compare to starting URL origin
3. **Subdomain rule:** api.example.com ≠ example.com (DIFFERENT origins)
4. If different origin:
   - Log: "Skipped external link: {url}"
   - Do NOT add to queue
   - Do NOT navigate

**Link Normalization:**
- Strip query params for deduplication: `/page?a=1` → `/page`
- Normalize trailing slashes: `/page/` → `/page`
- Resolve relative URLs to absolute
- Exclude: `mailto:`, `tel:`, `javascript:`, `#anchors`
```

### 5.3 Coverage Summary
```markdown
#### 4.6 Coverage Summary (ADD MANDATORY GENERATION)
At end of exploration, generate `coverage-summary.md`:

```markdown
# Coverage Summary

## Routes
- Found in code: {N} (from code-analysis.json)
- Visited in browser: {M}
- Not visited: {N-M}
  - /route1 (reason: requires auth)
  - /route2 (reason: 404)

## Forms Discovered
- Total: {N}
- Tested: {M}

## PRD Features
- Total: {N}
- Checked: {M}
- Not testable: {K}

## Pages
- Visited: {N}
- Documented: {N} (must match)
```

**VALIDATION:** `coverage-summary.md` MUST exist before Phase 7.
```

---

## §6: Phase 5 - Safety (ADD ENFORCEMENT)

```markdown
#### 5.0 Safety Gate (MANDATORY - BEFORE ANY BROWSER ACTIONS)
This check MUST complete before Phase 4 browser exploration:

1. Read `is_production_data` from config
2. **If true:**
   - Display warning: "⚠️ PRODUCTION DATA DETECTED"
   - **MANDATORY AskUserQuestion:**
     ```
     Production data detected. For safety, this audit should run in SAFE MODE.
     Safe mode skips: form submissions, data creation, destructive actions.
     Options: [Yes, use safe mode] [Abort audit]
     ```
   - If "Abort": Exit with "Audit aborted - user declined safe mode"
   - If "Yes": Force `safe_mode: true`

3. **Display Safety Status (MANDATORY):**
   ```
   ════════════════════════════════════════
   SAFETY MODE: {ON / OFF}
   Production Data: {Yes / No}
   Destructive Tests: {Enabled / Disabled}
   ════════════════════════════════════════
   ```

4. Log safety status to progress.md and progress.json
5. **GATE CHECK:** Safety determination MUST be logged before browser exploration
```

---

## §7: Phase 6 - Dynamic Testing (RECORD AS FINDINGS)

```markdown
#### 6.5 Record Test Results as Findings (ADD ENFORCEMENT)
ALL test results that indicate issues MUST become findings:

| Test Result | Finding Severity |
|-------------|------------------|
| Form validation missing | P1 |
| Server error during submit | P0 |
| Invalid data accepted | P1 |
| Unexpected behavior | P2 + [NEEDS CLARIFICATION] |
| XSS/injection detected | P0 (security) |
| Double-submit creates duplicate | P1 |

Create `findings/finding-{n}.json` for each issue discovered.
```

---

## §8: Phase 7 - Finding Generation (COMPLETE PIPELINE)

### 8.1 Evidence Requirements (NO PLACEHOLDERS)
```markdown
#### 7.1 Evidence Collection (MANDATORY FIELDS - NO PLACEHOLDERS)
Every finding MUST have these fields populated with real data:

**Required (will invalidate finding if missing):**
- `screenshot_id`: MCP screenshot ID OR `null` with `screenshot_note` explaining why
- `reproduction_steps`: Array with ≥1 meaningful step (not placeholder)
- `url`: Page URL where issue occurred
- `expected`: What should happen
- `actual`: What actually happened

**Required (can be inferred):**
- `element`: Selector or description of element
- `prd_reference`: PRD section if traceable, or `null`
- `feature_area`: Category (auth, forms, navigation, data, ui, error-handling)

**If evidence cannot be captured:**
- Do NOT create placeholder
- Log to progress.md: "Potential issue on {url} but evidence incomplete - skipped"
- Do NOT include in findings count
```

### 8.2 Critique Pass
```markdown
#### 7.3 LLM Critique Pass (ADD ENFORCEMENT)
Before including finding in report:

1. Self-evaluate:
   - "Is this finding actionable? Can a developer fix it?"
   - "Is this a real bug or intentional design?"
   - "Are reproduction steps clear enough?"
   - "Is severity appropriate?"

2. Assign confidence: `high`, `medium`, `low`

3. **Filter:**
   - `low` confidence → Do NOT include in report
   - Mark as `[NEEDS CLARIFICATION]` if uncertain
   - Log filtered findings to progress.md

4. Save critique notes in finding JSON:
   ```json
   "critique": {
     "actionable": true,
     "confidence": "high",
     "notes": "Clear validation bug"
   }
   ```
```

### 8.3 Deduplication
```markdown
#### 7.4 Deduplication (ADD METADATA)
For each finding, check for duplicates:

1. Same page + same element = likely duplicate
2. Similar error message = likely duplicate
3. Check existing GitHub issues: `gh issue list --search "{keywords}"`

Add to finding JSON:
```json
"deduplication": {
  "is_duplicate": false,
  "duplicate_of": null,
  "reason": null,
  "existing_issue": null
}
```

If duplicate found:
- Merge into existing finding
- Keep best evidence
- Log: "Merged finding into finding-{n}"
```

---

## §9: Phase 8 - Reporting & Issues (COMPLETE FLOW)

### 9.1 Report Generation
```markdown
#### 8.1 Report Generation (EXISTING - NO CHANGES)
Generate `report.md` per existing spec.
```

### 9.2 Finding Review (MANDATORY)
```markdown
#### 8.2 Finding Review (MANDATORY - CANNOT SKIP)
This step creates `review-decisions.json` which is a REQUIRED artifact.

**Step 1: Present summary via AskUserQuestion:**
```
Audit found {N} findings:
- P0 (Critical): {count}
- P1 (Significant): {count}
- P2 (Polish): {count}

How would you like to proceed?
Options:
- [Review findings and create GitHub issues]
- [Review findings only (no issues)]
- [Accept all and create issues]
- [Skip review - report only]
```

**Step 2: Based on selection:**

**If "Review findings and create GitHub issues":**
- Present each finding via AskUserQuestion:
  ```
  Finding #{n} [{severity}]: {title}
  URL: {url}
  Description: {description}

  Options: [Accept - create issue] [Reject - not a bug] [Edit severity] [Skip]
  ```
- Timeout after 60s per finding → default to "Skip"
- Save decision for each finding
- Proceed to issue creation for accepted findings

**If "Review findings only":**
- Same per-finding review
- Do NOT create issues
- Create `created-issues.json` with empty array

**If "Accept all and create issues":**
- Mark all as accepted
- Proceed to issue creation

**If "Skip review":**
- Mark all as "skipped"
- Do NOT create issues

**Step 3: Create review-decisions.json (MANDATORY):**
```json
{
  "schema_version": "1.0",
  "reviewed_at": "ISO8601",
  "review_method": "individual|bulk|skipped",
  "findings": {
    "finding-001": {"decision": "accept", "edited_severity": null, "notes": null},
    "finding-002": {"decision": "reject", "reason": "Intentional design"},
    "finding-003": {"decision": "skip", "reason": "timeout"}
  },
  "summary": {
    "accepted": N,
    "rejected": N,
    "skipped": N
  }
}
```
```

### 9.3 GitHub Issue Creation
```markdown
#### 8.3 GitHub Issue Creation (WITH PREFLIGHT + FALLBACK)

**Preflight Checks (before creating any issues):**
1. `which gh` → installed?
2. `gh auth status` → authenticated?
3. `gh repo view --json nameWithOwner` → repo access?

**If any check fails:**
- Display: "GitHub CLI not available. Issues will be saved to manual-issues.md"
- Generate `manual-issues.md` with formatted issue templates
- Create `created-issues.json` with `"method": "manual"` and empty issues array

**If checks pass, for each accepted finding:**
1. Create issue via gh:
   ```bash
   gh issue create --title "[{severity}] {title}" \
     --body "$(cat issue-body.md)" \
     --label "bug,audit,{severity}"
   ```
2. Handle screenshot upload if session active
3. Update finding JSON with `issue_number`
4. Group non-P0 findings in same feature area (P0 always individual)

**After issue creation, display URLs (MANDATORY):**
```
════════════════════════════════════════
ISSUES CREATED
════════════════════════════════════════
#42: [P1] Form validation missing
    https://github.com/owner/repo/issues/42
#43: [P2] Layout issues
    https://github.com/owner/repo/issues/43
════════════════════════════════════════
Total: 2 issues for 3 findings
════════════════════════════════════════
```

**Create created-issues.json (MANDATORY - even if empty):**
```json
{
  "schema_version": "1.0",
  "created_at": "ISO8601",
  "repo": "owner/repo" OR null,
  "method": "github" OR "manual",
  "issues": [...],
  "summary": {
    "total_created": N,
    "findings_covered": N,
    "screenshots_uploaded": N
  }
}
```
```

### 9.4 Audit Completion Checklist
```markdown
#### 8.5 Audit Completion Checklist (MANDATORY - Final Step)
Before setting `status: "complete"`:

1. **Run artifact validation:**
   ```
   ═══════════════════════════════════════════════════
     AUDIT COMPLETION CHECKLIST
   ═══════════════════════════════════════════════════
     Phase 1: prd-summary.json        [✓/✗]
     Phase 2: code-analysis.json      [✓/✗]
     Phase 3: progress.md             [✓/✗]
     Phase 3: progress.json           [✓/✗]
     Phase 4: pages/*.json            [{N} files]
     Phase 4: coverage-summary.md     [✓/✗]
     Phase 7: findings/*.json         [{N} files]
     Phase 8: report.md               [✓/✗]
     Phase 8: review-decisions.json   [✓/✗]
     Phase 8: created-issues.json     [✓/✗]
   ═══════════════════════════════════════════════════
   ```

2. **If ANY required artifact missing:**
   - Attempt to create with minimal valid schema
   - If still missing: Mark audit `status: "incomplete"`
   - Log reason in progress.json

3. **Only set `status: "complete"` when ALL artifacts present**

4. **Cleanup flags:**
   - Delete any `stop.flag` or `continue.flag`
```

---

## §10: Phase 9 - Verification Mode

```markdown
#### 9.0 Verification Command (ADD SUPPORT)
Support `/complete-verify gh issue #N`:

1. Parse issue number from command
2. Load `.complete-agent/issues/issue-{N}.json` (created during Phase 8)
3. If file missing: fetch from GitHub via `gh issue view {N} --json title,body`
4. Extract reproduction steps
5. Navigate to URL, execute steps
6. Capture result screenshot
7. Determine result: fixed | still_broken | new_error | cannot_verify
8. Update issue file with verification record
9. Optionally comment on GitHub issue

Create `issues/issue-{N}.json` during Phase 8:
```json
{
  "schema_version": "1.0",
  "issue_number": N,
  "github_url": "https://...",
  "finding_ids": ["finding-001"],
  "reproduction": {
    "url": "/path",
    "element": "description",
    "steps": ["Step 1", "Step 2"],
    "expected": "What should happen"
  },
  "verifications": []
}
```
```

---

## §11: Phase 10 - Checkpoint & Resume

```markdown
#### 10.1 Checkpoint Save (ADD ENFORCEMENT)
Save `checkpoint.json` after:
- Each page visit
- Each finding creation
- Before any pause/stop

Schema:
```json
{
  "checkpoint_at": "ISO8601",
  "current_url": "/path",
  "exploration_queue": ["/remaining1", "/remaining2"],
  "visited_pages": ["/done1", "/done2"],
  "findings_so_far": N,
  "current_permission_level": "admin|user|guest"
}
```

#### 10.2 Resume Command
Support `/complete-audit --resume`:
1. Check `checkpoint.json` exists
2. Validate JSON (if corrupted: warn, offer fresh start)
3. Check age (if >24h: warn about stale state)
4. Restore state and continue
5. Update progress.md: "Resumed from checkpoint"
```

---

## Testing Plan (Expanded with Negative Paths)

| Test Case | Expected Result |
|-----------|-----------------|
| External site, no codebase | code-analysis.json created with null path |
| No PRD found | prd-summary.json created with null prd_file |
| 0 findings | review-decisions.json + created-issues.json still created |
| User skips review | Both Phase 8 artifacts created with "skipped" |
| gh not authenticated | manual-issues.md created, created-issues.json has method:"manual" |
| stop.flag during exploration | checkpoint.json saved, partial report generated |
| continue.flag after OAuth pause | Audit resumes correctly |
| Session ends before screenshot upload | Finding notes "Screenshot unavailable (session ended)" |
| Production data detected | User prompted, safe mode enforced |
| Preflight fails (no write access) | Audit aborts with clear message |

---

## Success Criteria

An audit achieves 100% spec compliance when:
- [ ] All 10 required artifacts exist
- [ ] All artifacts pass schema validation
- [ ] Phase gates were respected (logged in activity_log)
- [ ] Mandatory user interactions occurred (AskUserQuestion logged)
- [ ] Preflight summary was displayed
- [ ] Safety mode was determined before browser actions
- [ ] Page inventory count matches pages_visited
- [ ] All findings have required evidence fields (no placeholders)
- [ ] Critique pass filtered low-confidence findings
- [ ] review-decisions.json shows user was prompted
- [ ] Issue URLs were displayed (if issues created)
