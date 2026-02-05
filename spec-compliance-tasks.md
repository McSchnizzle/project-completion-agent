# Task List: 100% Spec Compliance Implementation

Based on spec-compliance-plan-v2.md, these tasks update SKILL_INSTRUCTIONS.md to achieve full compliance.

---

## Task Group 1: Phase 0 - Preflight Enforcement

### T1.1: Add Directory Initialization Step
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** After line 163 (Phase 0.8)
**Action:** Add explicit directory creation instructions with gate check

### T1.2: Add Preflight Display Enforcement
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 0.9 (around line 173)
**Action:** Add "This display is MANDATORY. Log to progress.md that it was shown."

### T1.3: Add User Confirmation Enforcement
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 0.10 (around line 189)
**Action:** Add activity_log requirement: "Log: User confirmed audit start"

---

## Task Group 2: Phase 1 - PRD Fallback

### T2.1: Enhance No-PRD Fallback Schema
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Line 256 (after "If no PRD:")
**Action:** Add complete minimal prd-summary.json schema with notes field

---

## Task Group 3: Phase 2 - External Site Fallback

### T3.1: Add External Site Fallback Section
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** After line 349 (end of Phase 2)
**Action:** Add new section 2.6 for external site handling with fallback code-analysis.json schema

---

## Task Group 4: Phase 3 - Progress System

### T4.1: Add Progress File Initialization
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Before line 353 (Phase 3.1)
**Action:** Add section 3.0 with mandatory initialization step and gate check

### T4.2: Enhance Stop Flag Behavior
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 3.2 (around line 411)
**Action:** Add checkpoint.json creation requirement and explicit cleanup steps

### T4.3: Enhance Continue Flag Behavior
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 3.3 (around line 425)
**Action:** Add timeout handling (10 min max), state verification requirement

### T4.4: Add Dashboard Creation Step
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 3.4 (around line 439)
**Action:** Add "create dashboard/index.html if not exists" instruction

---

## Task Group 5: Phase 4 - Browser Exploration

### T5.1: Add Page Inventory Validation
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** After line 737 (Phase 4.3)
**Action:** Add validation step: count pages/*.json must match pages_visited

### T5.2: Strengthen Same-Origin Enforcement
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Around line 743 (same-origin rules)
**Action:** Add explicit subdomain rule and link normalization requirements

### T5.3: Make Coverage Summary Mandatory
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 4.6 (around line 764)
**Action:** Add "coverage-summary.md MUST exist before Phase 7" gate

---

## Task Group 6: Phase 5 - Safety Enforcement

### T6.1: Add Safety Gate Before Browser Actions
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 5.0 (around line 781)
**Action:** Add explicit gate check requirement: "Safety determination MUST be logged before browser exploration"

### T6.2: Add Safety Display Requirement
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** After safety mode AskUserQuestion
**Action:** Add mandatory safety status display box

---

## Task Group 7: Phase 7 - Finding Quality

### T7.1: Add Evidence Requirements (No Placeholders)
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 7.1 (around line 1078)
**Action:** Add explicit "NO PLACEHOLDERS" rule - skip finding if evidence incomplete

### T7.2: Enhance Critique Pass
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 7.3 (around line 1113)
**Action:** Add critique metadata schema to finding JSON

### T7.3: Add Deduplication Metadata
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 7.4 (around line 1126)
**Action:** Add deduplication schema to finding JSON template

---

## Task Group 8: Phase 8 - Review & Issues

### T8.1: Add Review Options
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 8.2 (around line 1214)
**Action:** Add fourth option "Accept all and create issues" to review prompt

### T8.2: Add Per-Finding Timeout
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 8.2 individual review
**Action:** Add "Timeout after 60s per finding → default to Skip"

### T8.3: Add GitHub Preflight Checks
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 8.3 (around line 1271)
**Action:** Add explicit preflight check steps before issue creation

### T8.4: Add Manual Issues Fallback
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 8.3
**Action:** Add manual-issues.md generation when gh unavailable

### T8.5: Add Issue URL Display Requirement
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** After issue creation (around line 1358)
**Action:** Add "MANDATORY: Display issue URLs" with formatted box

### T8.6: Add Completion Checklist
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** End of Phase 8
**Action:** Add section 8.5 with mandatory artifact validation checklist

### T8.7: Ensure created-issues.json Always Created
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 8.3
**Action:** Add explicit instruction for empty array when no issues created

---

## Task Group 9: Phase 9 - Verification

### T9.1: Add Issue Tracking File Creation
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 9.1 (around line 1418)
**Action:** Add instruction to create issues/issue-{N}.json during Phase 8

### T9.2: Enhance Verification Command
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 9.2 (around line 1456)
**Action:** Add fallback to fetch from GitHub if local file missing

---

## Task Group 10: Phase 10 - Checkpoint

### T10.1: Add Checkpoint Save Points
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 10.1 (around line 1521)
**Action:** Add explicit list of when to save checkpoint

### T10.2: Add Resume Validation
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Section 10.1
**Action:** Add JSON validation and age check for stale checkpoints

---

## Task Group 11: Data Contracts

### T11.1: Add review-decisions.json Schema
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Data Contracts section (after line 1600)
**Action:** Add complete schema (already partially exists, ensure complete)

### T11.2: Add critique and deduplication to Finding Schema
**File:** skill/SKILL_INSTRUCTIONS.md
**Location:** Finding Storage Format (around line 1671)
**Action:** Add critique and deduplication fields to finding schema

---

## Execution Order

1. T1.1 → T1.2 → T1.3 (Phase 0)
2. T2.1 (Phase 1)
3. T3.1 (Phase 2)
4. T4.1 → T4.2 → T4.3 → T4.4 (Phase 3)
5. T5.1 → T5.2 → T5.3 (Phase 4)
6. T6.1 → T6.2 (Phase 5)
7. T7.1 → T7.2 → T7.3 (Phase 7)
8. T8.1 → T8.2 → T8.3 → T8.4 → T8.5 → T8.6 → T8.7 (Phase 8)
9. T9.1 → T9.2 (Phase 9)
10. T10.1 → T10.2 (Phase 10)
11. T11.1 → T11.2 (Data Contracts)

---

## Verification

After all tasks complete:
1. Run `/complete-audit` on external site - verify all artifacts created
2. Run `/complete-audit` on site with codebase - verify full flow
3. Test stop/continue flags
4. Test with 0 findings
5. Test with gh not authenticated
