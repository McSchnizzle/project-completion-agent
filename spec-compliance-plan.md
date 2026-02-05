# Plan: Project Completion Agent - 100% Spec Compliance

## Objective
Bring the Project Completion Agent skill to 100% compliance with SKILL_INSTRUCTIONS.md specification.

## Current State Analysis

### Gaps Identified (from Codex Review)

| Gap | Severity | Root Cause |
|-----|----------|------------|
| Missing `review-decisions.json` | Critical | Phase 8 user review flow never triggered |
| Missing `created-issues.json` | Critical | Phase 8 issue creation flow never triggered |
| Missing `code-analysis.json` (Audit 2) | Critical | Phase 2 skipped for external websites |
| Missing `progress.md` (Audit 2) | Critical | Phase 3 artifact incomplete |
| Phase gating not enforced | Critical | No gate checks before proceeding |
| Incomplete page inventory | Medium | Not all visited pages documented |
| Evidence quality unchecked | Medium | No validation of finding completeness |
| Mandatory user interactions unverified | High | No enforcement of required prompts |

## Implementation Strategy

### Approach: Instruction-Based Enforcement
Since this is a Claude Code skill (not code), enforcement happens through the SKILL_INSTRUCTIONS.md file. The agent follows these instructions, so we need to:
1. Add explicit gate-check instructions at each phase boundary
2. Add mandatory artifact creation steps that cannot be skipped
3. Add validation checklists before phase transitions
4. Create stub artifacts for flows that don't complete naturally

---

## Phase-by-Phase Fixes

### Phase 0: Preflight - No Changes Needed
Current spec is adequate.

### Phase 1: PRD Parsing - No Changes Needed
Current spec is adequate. `prd-summary.json` creation is working.

### Phase 2: Code Analysis - ADD ENFORCEMENT

**Problem:** Skipped for external websites without local codebase access.

**Fix:** Add fallback behavior when no codebase is available:

```markdown
#### 2.6 No Codebase Fallback (MANDATORY)
If no local codebase is accessible (external website audit):
1. Create `code-analysis.json` with:
   ```json
   {
     "schema_version": "1.0",
     "analyzed_at": "ISO8601",
     "framework": "unknown (external site)",
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
     "notes": "External website audit - no codebase access"
   }
   ```
2. Log: "No codebase access - code analysis limited to browser discovery"
3. Continue to Phase 3 (file must exist as gate requirement)
```

### Phase 3: Progress Dashboard - ADD ENFORCEMENT

**Problem:** `progress.md` sometimes not created.

**Fix:** Add mandatory creation step:

```markdown
#### 3.0 Initialize Progress Files (MANDATORY - First Action of Phase 3)
BEFORE any other Phase 3 actions:
1. Create `progress.md` with initial template:
   ```markdown
   # Audit Progress
   Started: {timestamp}
   Status: initializing

   ## Coverage
   - Pages visited: 0
   - Pages in queue: 0

   ## Findings
   - Total: 0

   ## Recent Activity
   - [{timestamp}] Audit initialized
   ```
2. Create `progress.json` with initial schema
3. **GATE CHECK:** Verify both files exist before proceeding
4. If either file creation fails: ABORT with "Cannot create progress files"
```

### Phase 4: Browser Exploration - ADD PAGE INVENTORY ENFORCEMENT

**Problem:** Not all visited pages documented in `pages/*.json`.

**Fix:** Add mandatory documentation step:

```markdown
#### 4.3.1 Page Documentation (MANDATORY for EVERY visited page)
IMMEDIATELY after visiting any page (before any other actions):
1. Create `pages/page-{n}.json` with required schema
2. Increment page counter in `progress.json`
3. **VALIDATION:** `pages_visited` in progress.json MUST equal count of `pages/*.json` files
4. If mismatch detected: Create missing page files before continuing
```

### Phase 5: Safety - No Changes Needed
Current spec is adequate.

### Phase 6: Dynamic Testing - No Changes Needed
Current spec is adequate.

### Phase 7: Finding Generation - ADD EVIDENCE VALIDATION

**Problem:** Evidence quality (screenshots, repro steps) not validated.

**Fix:** Add validation step:

```markdown
#### 7.1.1 Evidence Completeness Check (MANDATORY before saving finding)
Before writing `findings/finding-{n}.json`:
1. Validate required fields present:
   - `screenshot_id` OR `screenshot_uploaded: false` with note
   - `reproduction_steps` array with ≥1 step
   - `expected` and `actual` fields populated
   - `url` field populated
2. If validation fails: Add missing fields with placeholder values:
   - Missing screenshot: `"screenshot_id": null, "screenshot_note": "Not captured"`
   - Missing repro steps: `"reproduction_steps": ["See description"]`
3. Log any evidence gaps in finding's `notes` field
```

### Phase 8: Reporting & Issue Creation - MAJOR ADDITIONS

**Problem:** `review-decisions.json` and `created-issues.json` never created.

**Fix:** Make these artifacts mandatory regardless of issue creation:

```markdown
#### 8.0 Phase 8 Gate Check (MANDATORY - First Action)
Before ANY Phase 8 actions:
1. Verify all prior phase artifacts exist:
   - `prd-summary.json` (Phase 1)
   - `code-analysis.json` (Phase 2)
   - `progress.md` AND `progress.json` (Phase 3)
   - At least one `pages/page-*.json` file (Phase 4)
2. If any missing: ABORT with "Phase gate failure: {missing_artifact}"

#### 8.1.1 Report Generation (MANDATORY)
Generate `report.md` - current spec adequate.

#### 8.2 Finding Review (MANDATORY - Even if 0 findings)
**This step CANNOT be skipped.**

1. **If findings exist (≥1):**
   Use AskUserQuestion to present review options:
   ```
   Audit found {N} findings. How would you like to proceed?
   Options:
   - [Review findings and create GitHub issues]
   - [Review findings only (no issues)]
   - [Skip review - generate report only]
   ```

2. **If "Review findings and create GitHub issues" selected:**
   - Present each finding for Accept/Reject/Skip
   - For accepted findings: create GitHub issues
   - Save decisions to `review-decisions.json`
   - Save created issues to `created-issues.json`

3. **If "Review findings only" selected:**
   - Present each finding for Accept/Reject/Skip
   - Save decisions to `review-decisions.json`
   - Create `created-issues.json` with empty issues array:
     ```json
     {
       "schema_version": "1.0",
       "created_at": "ISO8601",
       "repo": null,
       "issues": [],
       "summary": {
         "total_created": 0,
         "findings_covered": 0,
         "reason": "User chose not to create issues"
       }
     }
     ```

4. **If "Skip review" selected OR no findings (0):**
   - Create `review-decisions.json`:
     ```json
     {
       "schema_version": "1.0",
       "reviewed_at": "ISO8601",
       "review_method": "skipped",
       "findings": {},
       "summary": {
         "accepted": 0,
         "rejected": 0,
         "skipped": 0,
         "reason": "User skipped review" OR "No findings to review"
       }
     }
     ```
   - Create `created-issues.json` with empty array (as above)

5. **GATE CHECK (MANDATORY):**
   Before completing Phase 8, verify:
   - `review-decisions.json` exists
   - `created-issues.json` exists
   If either missing: Create with "skipped" status

#### 8.5 Audit Completion Checklist (MANDATORY - Final Step)
Before marking audit complete, run this checklist:

```
═══════════════════════════════════════════════════
  AUDIT COMPLETION CHECKLIST
═══════════════════════════════════════════════════
  Phase 1: prd-summary.json        [EXISTS/MISSING]
  Phase 2: code-analysis.json      [EXISTS/MISSING]
  Phase 3: progress.md             [EXISTS/MISSING]
  Phase 3: progress.json           [EXISTS/MISSING]
  Phase 4: pages/*.json            [COUNT] files
  Phase 7: findings/*.json         [COUNT] files
  Phase 8: report.md               [EXISTS/MISSING]
  Phase 8: review-decisions.json   [EXISTS/MISSING]
  Phase 8: created-issues.json     [EXISTS/MISSING]
═══════════════════════════════════════════════════
```

If ANY required artifact missing:
1. Attempt to create with stub/default values
2. If creation fails: Mark audit as "incomplete" with reason
3. Log missing artifacts in `progress.json`

Only mark `status: "complete"` when ALL artifacts present.
```

---

## New Sections to Add

### Artifact Validation Schema
Add a new section defining minimum valid schemas for each artifact, enabling validation.

### Self-Audit Mode
Add a `/complete-audit --validate` command that checks an existing audit for spec compliance without re-running.

---

## Testing Plan

After implementing changes:
1. Run audit on external site (no codebase) - verify code-analysis.json created
2. Run audit with 0 findings - verify Phase 8 artifacts created
3. Run audit with findings, skip review - verify Phase 8 artifacts created
4. Run audit with findings, create issues - verify full workflow
5. Validate all artifacts against schemas

---

## Success Criteria

An audit is 100% spec-compliant when:
- [ ] All 9 required artifacts exist
- [ ] All artifacts pass schema validation
- [ ] Phase gates were respected (logged in activity_log)
- [ ] Mandatory user interactions occurred (logged)
- [ ] Page inventory matches pages_visited count
- [ ] All findings have required evidence fields
