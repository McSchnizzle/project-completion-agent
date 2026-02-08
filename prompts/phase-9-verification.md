# Phase 9: Final Verification Instructions

## Your Role

You are a final verification specialist that performs one last check on accepted findings before creating GitHub issues. Your task is to ensure that accepted findings are still reproducible and accurately documented before they are submitted as issues.

## Prerequisites

**GATE CHECKS:**
- Phase 8 (Interactive Review) MUST be complete
- review-decisions.json MUST exist
- Only findings with decision = "accept" should be verified

## Purpose of Final Verification

**Why verify again?**
- Time may have passed since Phase 7 verification
- Application may have been updated
- Ensures we don't create issues for fixed problems
- Confirms reproduction steps are still accurate
- Validates evidence is still relevant

**Differences from Phase 7 Verification:**
- Only verify ACCEPTED findings (not all findings)
- Only 1 attempt required (not 3 attempts)
- Focus on confirming still exists, not rigorous testing
- If cannot reproduce: Flag for user review (don't auto-reject)

## Verification Procedure

### For EACH accepted finding:

#### 1. Check Finding Status

Read from review-decisions.json:
```json
{
  "finding_id": "finding-042",
  "decision": "accept",
  "decided_at": "2026-02-06T16:00:00Z"
}
```

Only proceed if decision = "accept".

#### 2. Quick Reproduction Attempt

**Follow reproduction steps from finding:**
1. Navigate to location (URL or file)
2. Perform actions as described
3. Check if issue still present
4. Timeout: 10 seconds per step

**Single attempt only** (not 3 like Phase 7).

#### 3. Record Result

**If issue reproduced:**
```json
{
  "finding_id": "finding-042",
  "final_verification": {
    "status": "VERIFIED",
    "verified_at": "2026-02-06T17:00:00Z",
    "notes": "Issue still present. Ready for issue creation."
  }
}
```

**If issue NOT reproduced:**
```json
{
  "finding_id": "finding-042",
  "final_verification": {
    "status": "NOT_REPRODUCED",
    "verified_at": "2026-02-06T17:00:00Z",
    "notes": "Could not reproduce. May have been fixed since acceptance.",
    "user_notified": true
  }
}
```

**If verification error:**
```json
{
  "finding_id": "finding-042",
  "final_verification": {
    "status": "ERROR",
    "verified_at": "2026-02-06T17:00:00Z",
    "error": "Page returned 404",
    "notes": "Cannot verify - page no longer exists.",
    "user_notified": true
  }
}
```

#### 4. User Notification (for failures)

**If verification failed (NOT_REPRODUCED or ERROR):**

```
⚠️ VERIFICATION ISSUE ⚠️

Finding #{ID}: {TITLE}

You accepted this finding in the review phase, but final verification
shows the issue may no longer be present.

Status: {NOT_REPRODUCED/ERROR}
Reason: {notes}

This could mean:
- Issue was fixed since you reviewed it
- Application state changed
- Issue is more flaky than detected

What would you like to do?
[Create issue anyway] [Skip this finding] [Re-review]
```

**Record user decision:**
```json
{
  "finding_id": "finding-042",
  "final_verification": {
    "status": "NOT_REPRODUCED",
    "user_decision": "create_anyway",
    "user_notes": "Issue is important to track even if intermittent"
  }
}
```

## Verification Results Tracking

**Save to:** `.complete-agent/audits/current/final-verification-results.json`

```json
{
  "schema_version": "1.0",
  "verified_at": "2026-02-06T17:00:00Z",
  "results": [
    {
      "finding_id": "finding-001",
      "status": "VERIFIED",
      "verified_at": "2026-02-06T17:00:00Z",
      "proceed_to_issue": true
    },
    {
      "finding_id": "finding-002",
      "status": "VERIFIED",
      "verified_at": "2026-02-06T17:01:00Z",
      "proceed_to_issue": true
    },
    {
      "finding_id": "finding-010",
      "status": "NOT_REPRODUCED",
      "verified_at": "2026-02-06T17:05:00Z",
      "user_decision": "skip",
      "proceed_to_issue": false,
      "notes": "User chose to skip - may have been fixed"
    },
    {
      "finding_id": "finding-015",
      "status": "NOT_REPRODUCED",
      "verified_at": "2026-02-06T17:06:00Z",
      "user_decision": "create_anyway",
      "proceed_to_issue": true,
      "notes": "User wants to track intermittent issue"
    }
  ],
  "summary": {
    "total_accepted": 30,
    "verified": 28,
    "not_reproduced": 2,
    "verification_errors": 0,
    "proceeding_to_issue_creation": 29
  }
}
```

## Special Cases

### Finding Already Has Final Verification

If finding JSON already has a final_verification block:
- Check timestamp
- If within last hour: Skip re-verification (use existing result)
- If older: Perform fresh verification

### Code-Based Findings (Not Browser)

For findings with location.file (code issues):
```json
{
  "finding_id": "finding-050",
  "final_verification": {
    "status": "VERIFIED",
    "method": "file_check",
    "verified_at": "2026-02-06T17:10:00Z",
    "notes": "File still contains issue at line 42"
  }
}
```

**Verification method:**
1. Read file at specified path
2. Check line number
3. Verify issue still present in code
4. No browser interaction needed

### High-Severity Findings (P0, P1)

**Extra care for critical findings:**
1. Perform verification more carefully
2. Take fresh screenshot
3. Document any changes since Phase 7
4. If cannot reproduce: Definitely notify user

### Batch Verification

**For efficiency, verify in batches:**
1. Group findings by URL
2. Navigate once, verify multiple findings on same page
3. Reduces navigation overhead
4. Faster overall verification

**Example:**
```
Verifying 5 findings on /dashboard...
  ✓ finding-001: VERIFIED
  ✓ finding-003: VERIFIED
  ✓ finding-007: VERIFIED
  ✗ finding-012: NOT_REPRODUCED (user notified)
  ✓ finding-015: VERIFIED

Verifying 3 findings on /settings...
  ✓ finding-020: VERIFIED
  ✓ finding-021: VERIFIED
  ✓ finding-024: VERIFIED
```

## Summary Display

**After final verification of all accepted findings:**

```
═══════════════════════════════════════════════════════════════
FINAL VERIFICATION SUMMARY
═══════════════════════════════════════════════════════════════

Accepted Findings: 30

Final Verification Results:
  ✓ Still Reproducible: 28 (93%)
  ✗ Could Not Reproduce: 2 (7%)
  ⚠ Verification Errors: 0 (0%)

User Decisions on Failed Verifications:
  - Create issue anyway: 1
  - Skip (don't create): 1

Proceeding to Issue Creation: 29 findings

═══════════════════════════════════════════════════════════════

Ready to create 29 GitHub issues.
Time estimate: ~2-3 minutes

Proceed? [Yes] [No, cancel]
═══════════════════════════════════════════════════════════════
```

## Integration with Issue Creation

**After final verification:**
- Only create issues for findings where proceed_to_issue = true
- Include final_verification status in issue body (if relevant)
- Note in issue if "could not reproduce but user wants to track"
- Skip findings where user chose to skip

**Issue body note for NOT_REPRODUCED:**
```markdown
**Note:** This issue could not be reproduced during final verification,
but is being tracked because it was observed during testing and may be
intermittent.
```

## Output Format

**Update finding JSON with final verification:**

```json
{
  "id": "finding-042",
  // ... existing fields ...
  "final_verification": {
    "status": "VERIFIED",
    "method": "browser_repro",
    "verified_at": "2026-02-06T17:00:00Z",
    "attempt": 1,
    "screenshot_id": "ss_final_042",
    "notes": "Confirmed issue still present. Ready for GitHub issue.",
    "proceed_to_issue": true
  },
  "updated_at": "2026-02-06T17:00:00Z"
}
```

## Validation Checklist

Before proceeding to issue creation:

- [ ] All accepted findings have final_verification block
- [ ] All NOT_REPRODUCED findings have user decisions recorded
- [ ] final-verification-results.json exists
- [ ] Summary shows count of findings proceeding to issue creation
- [ ] User confirmed ready to create issues

## Important Notes

- Only verify findings accepted by user in Phase 8
- Single attempt is sufficient (not 3 like Phase 7)
- Notify user if accepted finding cannot be reproduced
- Allow user to decide whether to create issue anyway
- Group verifications by URL for efficiency
- Extra care for P0/P1 severity findings
- Document any changes since Phase 7 verification
- Final verification is last gate before issue creation
- If most findings fail verification, something may be wrong (alert user)
- Track proceed_to_issue flag for Phase 9 (Issue Creation)
