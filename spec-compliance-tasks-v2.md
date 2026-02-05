# Task List v2: 100% Spec Compliance Implementation

Based on spec-compliance-plan-v2.md with Codex feedback incorporated.

---

## Task Group 1: Phase 0 - Preflight Enforcement (COMPLETE)

### T1.1: Add Directory Initialization Step
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 0.8 (around line 163)
**Action:** Add:
- Timestamp generation
- mkdir -p commands for audits/{timestamp}, findings, pages
- Symlink: `ln -sfn {timestamp} .complete-agent/audits/current`
- Stale flag check: If stop.flag or continue.flag exists, warn user and offer cleanup
- Gate check: Verify directories exist before proceeding

### T1.2: Add Preflight Check Enforcement
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 0.1-0.8
**Action:** Add explicit enforcement for each check:
- Write access: ABORT if fails
- Browser capability: Set browser_mode variable
- gh auth: Store authentication state for later
- Config file: AskUserQuestion if URL missing
- App URL validation: Error with troubleshooting if unreachable
- PRD discovery: AskUserQuestion for confirmation

### T1.3: Add Preflight Display Enforcement
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 0.9 (around line 173)
**Action:** Add:
- "This display is MANDATORY"
- "Log to progress.md that preflight summary was displayed"
- "Log to activity_log: 'Preflight summary displayed'"

### T1.4: Add User Confirmation Enforcement
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 0.10 (around line 189)
**Action:** Add:
- "Log to activity_log: 'User confirmed audit start'"
- "Set preflight_completed: true in progress.json"

---

## Task Group 2: Phase 1 - PRD Fallback

### T2.1: Enhance No-PRD Fallback Schema
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Line 256 (after "If no PRD:")
**Action:** Add complete schema:
```json
{
  "schema_version": "1.0",
  "prd_file": null,
  "parsed_at": "ISO8601",
  "features": [],
  "flows": [],
  "out_of_scope": [],
  "deferred": [],
  "summary": {...},
  "notes": "No PRD provided - code-only analysis"
}
```

---

## Task Group 3: Phase 2 - External Site Fallback

### T3.1: Add External Site Fallback Section
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** After line 349 (end of Phase 2)
**Action:** Add new section "2.6 External Site / No Codebase Fallback":
- Attempt framework inference from page source
- Create code-analysis.json with codebase_path: null
- Notes field explaining external audit
- Gate check reminder

---

## Task Group 4: Phase 5 - Safety (BEFORE Phase 4!)

### T4.1: Add Safety Gate Enforcement
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 5.0 (around line 781)
**Action:** Add:
- Explicit "BEFORE Phase 4 browser exploration" note
- If is_production_data: true → MANDATORY AskUserQuestion
- If "Abort" selected: Exit with clear message
- If "Yes" selected: Force safe_mode: true

### T4.2: Add Safety Display Requirement
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** After safety determination
**Action:** Add mandatory display box:
```
════════════════════════════════════════
SAFETY MODE: {ON / OFF}
Production Data: {Yes / No}
Destructive Tests: {Enabled / Disabled}
════════════════════════════════════════
```
- Log safety status to progress.md
- Log safety status to progress.json
- "GATE CHECK: Safety determination MUST be logged before browser exploration"

---

## Task Group 5: Phase 3 - Progress System (COMPLETE)

### T5.1: Add Progress File Initialization
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Before line 353 (Phase 3.1)
**Action:** Add section 3.0:
- Create progress.md with full template
- Create progress.json per schema D.1
- Gate check: Both files MUST exist before Phase 4

### T5.2: Enhance Stop Flag Behavior
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 3.2 (around line 411)
**Action:** Add:
- "Check for stop.flag BEFORE: any navigation, any click, any form, starting new page"
- checkpoint.json creation with full schema
- Partial report.md generation
- Update progress.json: status: "stopped"
- Delete stop.flag after processing
- Exit message: "Audit stopped by user. Partial report saved. Resume with /complete-audit --resume"

### T5.3: Enhance Continue Flag Behavior
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 3.3 (around line 425)
**Action:** Add:
- Poll every 5 seconds (max 10 minutes)
- If stop.flag appears while waiting: execute stop behavior
- If timeout (10 min): Save checkpoint, exit with pause status
- Update progress.json: status: "running" after continue
- State verification requirement

### T5.4: Add Dashboard Creation Step
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 3.4 (around line 439)
**Action:** Add:
- "Create dashboard/index.html if not exists"
- "Log to progress.md: Dashboard available at .complete-agent/dashboard/index.html"

---

## Task Group 6: Phase 4 - Browser Exploration (COMPLETE)

### T6.1: Add Page Inventory Creation Requirement
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 4.3 (around line 720)
**Action:** Add:
- "IMMEDIATELY after loading any page, create pages/page-{n}.json"
- Full schema with all required fields
- "VALIDATION: Count pages/*.json files, compare to progress.json.coverage.pages_visited"
- "If mismatch: Create missing page files before continuing"

### T6.2: Strengthen Same-Origin Enforcement
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Around line 743 (same-origin rules)
**Action:** Add explicit rules:
- "Subdomain rule: api.example.com ≠ example.com (DIFFERENT origins)"
- "Link normalization exclusions:"
  - `mailto:` links
  - `tel:` links
  - `javascript:` links
  - `#anchor` links
- "If different origin: Log 'Skipped external link: {url}', do NOT add to queue"

### T6.3: Make Coverage Summary Mandatory
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 4.6 (around line 764)
**Action:** Add:
- Full coverage-summary.md template
- "coverage-summary.md MUST exist before Phase 7"

---

## Task Group 7: Phase 6 - Dynamic Testing (NEW)

### T7.1: Add Test Results Recording
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** End of Phase 6 (around line 1043)
**Action:** Add new section "6.5 Record Test Results as Findings":
- Table mapping test results to finding severity:
  - Form validation missing → P1
  - Server error during submit → P0
  - Invalid data accepted → P1
  - Unexpected behavior → P2 + [NEEDS CLARIFICATION]
  - XSS/injection detected → P0 (security)
  - Double-submit creates duplicate → P1
- "Create findings/finding-{n}.json for each issue discovered"

---

## Task Group 8: Phase 7 - Finding Quality (COMPLETE)

### T8.1: Add Evidence Requirements (No Placeholders)
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 7.1 (around line 1078)
**Action:** Add:
- List of required fields with "NO PLACEHOLDERS" rule
- "If evidence cannot be captured: Do NOT create placeholder"
- "Log to progress.md: 'Potential issue on {url} but evidence incomplete - skipped'"
- "Do NOT include in findings count"

### T8.2: Enhance Critique Pass
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 7.3 (around line 1113)
**Action:** Add:
- Confidence levels: high, medium, low
- "low confidence → Do NOT include in report"
- "Mark uncertain as [NEEDS CLARIFICATION]"
- "Log filtered findings to progress.md"
- Critique metadata schema in finding JSON

### T8.3: Add Deduplication Enforcement
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 7.4 (around line 1126)
**Action:** Add:
- Deduplication schema in finding JSON
- "Check existing GitHub issues: gh issue list --search '{keywords}'"
- "If duplicate found: Merge into existing finding, keep best evidence"
- "Log: 'Merged finding into finding-{n}'"

---

## Task Group 9: Phase 8 - Review & Issues (COMPLETE)

### T9.1: Add Review Options
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 8.2 (around line 1214)
**Action:** Add fourth option to AskUserQuestion:
- [Accept all and create issues]

### T9.2: Add Per-Finding Timeout
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 8.2 individual review
**Action:** Add:
- "Timeout after 60s per finding → default to 'Skip'"

### T9.3: Add GitHub Preflight Checks
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 8.3 (around line 1271)
**Action:** Add explicit checks:
- `which gh` → installed?
- `gh auth status` → authenticated?
- `gh repo view --json nameWithOwner` → repo access?

### T9.4: Add Manual Issues Fallback
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 8.3
**Action:** Add:
- "If any check fails: Display 'GitHub CLI not available. Issues will be saved to manual-issues.md'"
- Generate manual-issues.md with formatted templates
- "Create created-issues.json with method: 'manual' and empty issues array"

### T9.5: Add Issue Grouping Rule
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 8.3 (grouping section)
**Action:** Add:
- "Group non-P0 findings in same feature area into single issue"
- "P0 findings ALWAYS get individual issues"

### T9.6: Add issue_number Update
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 8.3 (post-creation)
**Action:** Add:
- "Update each finding JSON with issue_number field"

### T9.7: Add Issue URL Display Requirement
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** After issue creation (around line 1358)
**Action:** Add:
- "MANDATORY: Display issue URLs" with formatted box template
- "Total: N issues for M findings"

### T9.8: Add Completion Checklist
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** End of Phase 8
**Action:** Add section 8.5:
- Full artifact validation checklist
- "If ANY required artifact missing: Attempt to create with minimal valid schema"
- "Only set status: 'complete' when ALL artifacts present"
- "Cleanup: Delete any stop.flag or continue.flag"

### T9.9: Ensure created-issues.json Always Created
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 8.3
**Action:** Add:
- "created-issues.json MUST exist (even if empty array)"
- "Even if user skips review, create with summary.reason"

---

## Task Group 10: Phase 9 - Verification

### T10.1: Add Issue Tracking File Creation
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 9.1 (around line 1418)
**Action:** Add:
- "Create issues/issue-{N}.json during Phase 8 issue creation"
- Full schema with reproduction steps

### T10.2: Enhance Verification Command
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 9.2 (around line 1456)
**Action:** Add:
- "If file missing: fetch from GitHub via gh issue view {N} --json title,body"
- "Update issue file with verification record"
- "Optionally comment on GitHub issue"

---

## Task Group 11: Phase 10 - Checkpoint

### T11.1: Add Checkpoint Save Points
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 10.1 (around line 1521)
**Action:** Add:
- "Save checkpoint.json after: each page visit, each finding creation, before any pause/stop"
- Full checkpoint schema

### T11.2: Add Resume Validation
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 10.1
**Action:** Add:
- "Validate JSON (if corrupted: warn, offer fresh start)"
- "Check age (if >24h: warn about stale state)"
- "Restore state: navigate to current_url, restore queue"
- "Update progress.md: 'Resumed from checkpoint'"

---

## Task Group 12: Data Contracts

### T12.1: Add critique and deduplication to Finding Schema
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Finding Storage Format (around line 1671)
**Action:** Add to schema:
```json
"critique": {
  "actionable": true,
  "confidence": "high",
  "notes": "string"
},
"deduplication": {
  "is_duplicate": false,
  "duplicate_of": null,
  "reason": null,
  "existing_issue": null
}
```

---

## Execution Order (Corrected)

**Phase order respects dependencies:**

1. **Phase 0** (Preflight): T1.1 → T1.2 → T1.3 → T1.4
2. **Phase 1** (PRD): T2.1
3. **Phase 2** (Code Analysis): T3.1
4. **Phase 3** (Progress): T5.1 → T5.2 → T5.3 → T5.4
5. **Phase 5** (Safety - BEFORE browser!): T4.1 → T4.2
6. **Phase 4** (Browser): T6.1 → T6.2 → T6.3
7. **Phase 6** (Dynamic Testing): T7.1
8. **Phase 7** (Findings): T8.1 → T8.2 → T8.3
9. **Phase 8** (Review/Issues): T9.1 → T9.2 → T9.3 → T9.4 → T9.5 → T9.6 → T9.7 → T9.8 → T9.9
10. **Phase 9** (Verification): T10.1 → T10.2
11. **Phase 10** (Checkpoint): T11.1 → T11.2
12. **Data Contracts**: T12.1

---

## Verification

After all tasks complete:
1. Run `/complete-audit` on external site (no codebase) - verify code-analysis.json created
2. Run `/complete-audit` on site with 0 findings - verify Phase 8 artifacts created
3. Test stop.flag during exploration - verify checkpoint saved
4. Test continue.flag after OAuth pause - verify resume works
5. Test with gh not authenticated - verify manual-issues.md created
6. Verify page count matches pages/*.json count
7. Verify all findings have required evidence (no placeholders)
