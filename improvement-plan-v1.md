# Project Completion Agent: Improvement Plan v1

## Current State Assessment

### What Works (MVP Level)
- Phase gating enforced correctly
- All required artifacts created (13/13)
- GitHub issue creation functional
- PRD feature mapping
- Basic page exploration
- Finding evidence structure

### Critical Gaps Identified

| Gap | Impact | Current Behavior | Required Behavior |
|-----|--------|------------------|-------------------|
| **No Dynamic Testing** | Major | Only observes pages, doesn't interact | Must test forms, buttons, flows |
| **No Responsive Testing** | Major | Desktop only | Must test mobile/tablet viewports |
| **Shallow Exploration** | Major | 6/13 pages visited | Must visit all discoverable routes |
| **No Screenshot Persistence** | Medium | IDs lost after session | Must save to disk or upload |
| **No Diff Against Prior Audits** | Medium | Each audit isolated | Should compare with previous findings |
| **No Verification Pass** | Medium | Creates issues, doesn't verify | Should verify findings before reporting |
| **Edge Cases Skipped** | Major | Happy path only | Must test boundaries, errors, edge cases |
| **No Feature-Specific Testing** | Major | Generic exploration | Must test PRD-specific behavior |

---

## Improvement Plan

### Phase A: Dynamic Testing Engine (CRITICAL)

**Goal:** Transform from "observer" to "tester" - actually exercise functionality.

#### A.1 Form Testing Implementation
**Current:** Forms detected in code-analysis.json but never tested
**Required:**
1. For each form discovered:
   - Execute happy path (valid data)
   - Execute validation tests (empty required fields)
   - Execute boundary tests (max length, special chars)
   - Record submit result (success/error/validation message)
2. Create finding for each failure type
3. Track forms tested in coverage-summary.md

**Implementation:**
- Add `form_test_results[]` to page-{n}.json
- Add explicit form testing step after page load
- Use `mcp__claude-in-chrome__form_input` for field entry
- Capture validation messages via DOM inspection
- Skip destructive forms in safe mode

#### A.2 Button/Action Testing
**Current:** Buttons listed in page inventory, never clicked
**Required:**
1. Identify interactive elements (buttons, links, toggles)
2. Click each and observe result:
   - Navigation → add to queue
   - Modal → document, close, continue
   - State change → verify change occurred
   - Error → create finding
3. Test keyboard accessibility (Tab, Enter, Escape)

**Implementation:**
- Add `actions_tested[]` to page-{n}.json
- Define safe vs unsafe actions (delete, submit, buy = unsafe)
- Use `mcp__claude-in-chrome__find` to locate elements
- Use `mcp__claude-in-chrome__computer` for interactions

#### A.3 User Flow Execution
**Current:** Flows defined in prd-summary.json, never executed
**Required:**
1. Parse each flow into executable steps
2. Execute step-by-step with verification
3. Record success/failure at each step
4. Create finding if flow breaks

**Implementation:**
- Add Phase 6.1 flow execution (already spec'd but not enforced)
- Add `flow_results[]` to progress.json
- Require minimum 1 flow tested per PRD-defined flow

---

### Phase B: Responsive & Cross-Browser Testing

**Goal:** Verify app works at different viewport sizes.

#### B.1 Viewport Testing
**Current:** Single desktop viewport
**Required:**
1. Test at 3 viewport sizes:
   - Desktop: 1400x900
   - Tablet: 768x1024
   - Mobile: 375x667
2. At each viewport:
   - Check for layout breaks
   - Verify navigation accessible
   - Test key interactions
3. Create findings for responsive issues

**Implementation:**
- Use `mcp__claude-in-chrome__resize_window`
- Add `viewport_tested` to page-{n}.json
- Add responsive section to coverage-summary.md
- Define responsive_test_pages config (default: homepage + 2 key pages)

#### B.2 Visual Regression (Future)
**Current:** No visual comparison
**Future Enhancement:**
- Screenshot each page at each viewport
- Compare with baseline (if exists)
- Flag visual differences > threshold

---

### Phase C: Comprehensive Exploration

**Goal:** Visit ALL discoverable routes, not just sample.

#### C.1 Exhaustive Route Coverage
**Current:** max_pages: 20, stopped at 6
**Required:**
1. Visit ALL routes from code-analysis.json
2. Follow ALL internal links discovered
3. Only stop when:
   - Queue empty (all pages visited)
   - max_pages reached (with explicit "coverage incomplete" warning)
   - stop.flag detected
4. Document unvisited routes with reasons

**Implementation:**
- Change default max_pages to 50
- Add `coverage_complete: true/false` to progress.json
- Add `unvisited_routes[]` with reasons to coverage-summary.md
- Require >80% route coverage for "complete" status

#### C.2 Authentication Path Coverage
**Current:** Only tests logged-in state
**Required:**
1. Test as unauthenticated user first
2. Test with each credential level (guest, user, admin)
3. Verify access controls (can't access admin as user)
4. Document permission matrix

**Implementation:**
- Add multi-credential testing loop
- Add `permission_level` to page-{n}.json
- Add access control findings category

---

### Phase D: Screenshot Persistence

**Goal:** Screenshots survive session end.

#### D.1 Screenshot File Storage
**Current:** MCP IDs only, lost after session
**Required:**
1. After each screenshot, attempt to save to disk
2. Store in `findings/screenshots/` directory
3. Reference file path in finding JSON
4. Upload to GitHub issue on creation

**Implementation:**
- Add `screenshots/` directory to audit structure
- Use `mcp__claude-in-chrome__computer` screenshot → save to file
- Add `screenshot_path` field to findings schema
- Fallback to MCP ID if file save fails

#### D.2 Screenshot Quality
**Current:** Full page captures
**Required:**
1. Full page screenshot for context
2. Zoomed screenshot of specific element for clarity
3. Annotated screenshots (highlight problem area)

**Implementation:**
- Use `zoom` action for element-specific captures
- Add `screenshot_type: "full" | "element" | "annotated"`

---

### Phase E: Audit Comparison & History

**Goal:** Track issues across audits, identify regressions.

#### E.1 Previous Audit Comparison
**Current:** Each audit isolated
**Required:**
1. On audit start, load previous audit findings
2. Compare new findings with previous
3. Classify each finding:
   - NEW: Not in previous audit
   - RECURRING: Same as previous (still broken)
   - FIXED: In previous, not in current
   - REGRESSION: Was fixed, now broken again
4. Highlight regressions in report

**Implementation:**
- Add `load_previous_audit()` function
- Add `comparison_status` to finding schema
- Add "Regressions" section to report.md
- Store finding signatures for matching

#### E.2 Issue Status Sync
**Current:** Issues created, never checked again
**Required:**
1. Before creating issue, check if similar open issue exists
2. If exists: link finding to existing issue (don't duplicate)
3. If closed: check if regression, reopen or create new
4. Update finding with issue status

**Implementation:**
- `gh issue list --search "{keywords}"` before creation
- Add `existing_issue_check` to issue creation flow
- Add `linked_issues[]` to finding schema

---

### Phase F: Pre-Report Verification

**Goal:** Verify findings are real before presenting to user.

#### F.1 Finding Verification Pass
**Current:** Findings presented without re-verification
**Required:**
1. After all findings collected, before report:
2. Re-navigate to each finding URL
3. Re-execute reproduction steps
4. Verify finding still reproduces
5. Mark as VERIFIED or COULD_NOT_REPRODUCE
6. Filter out non-reproducible findings

**Implementation:**
- Add Phase 7.5: Verification Pass
- Add `verified: true/false` to finding schema
- Add `verification_attempts` count
- Require 2 successful reproductions for VERIFIED

#### F.2 Confidence Scoring
**Current:** Manual confidence assignment
**Required:**
1. Auto-calculate confidence based on:
   - Evidence completeness (screenshot, steps, expected/actual)
   - Reproduction success rate
   - Severity indicators in page
   - PRD alignment
2. Auto-filter low-confidence findings
3. Flag uncertain findings for human review

**Implementation:**
- Add confidence scoring algorithm
- Add `confidence_score: 0-100` to finding schema
- Threshold: <50 = filter, 50-75 = needs review, >75 = include

---

### Phase G: Edge Case & Error Handling Tests

**Goal:** Actively try to break things, not just observe.

#### G.1 Error State Testing
**Current:** Only tests happy paths
**Required:**
1. For each page, test error scenarios:
   - Invalid URL parameters
   - Missing required data
   - Network timeout simulation (if possible)
2. Verify error handling:
   - Meaningful error message shown
   - No stack traces exposed
   - Graceful degradation

**Implementation:**
- Add `error_scenarios_tested[]` to page-{n}.json
- Test `/page?id=invalid`, `/page?id=999999`
- Check for error message patterns

#### G.2 Security-Adjacent Testing
**Current:** No security testing
**Required:**
1. Basic XSS check: `<script>alert(1)</script>` in text fields
2. Basic injection check: `' OR '1'='1` in search
3. Check for exposed sensitive data in page source
4. Verify HTTPS used for sensitive pages
5. **Note:** Not a security audit, just basic checks

**Implementation:**
- Add `security_checks[]` to page-{n}.json
- Create P0 findings for any security issues
- Clear warning: "This is not a penetration test"

#### G.3 Boundary Testing
**Current:** Standard test data only
**Required:**
1. Test input boundaries:
   - Empty strings
   - Very long strings (10000 chars)
   - Unicode/emoji
   - Special characters
2. Test numeric boundaries:
   - 0, -1, MAX_INT
3. Test date boundaries:
   - Past dates, far future dates

**Implementation:**
- Add boundary test suite to form testing
- Create findings for boundary failures

---

## Implementation Priority

### Must Have (MVP → Product)
1. **A.1 Form Testing** - Core testing capability
2. **A.3 User Flow Execution** - PRD validation
3. **C.1 Exhaustive Route Coverage** - Complete coverage
4. **F.1 Finding Verification Pass** - Quality assurance
5. **G.1 Error State Testing** - Find real bugs

### Should Have (Product Quality)
6. **A.2 Button/Action Testing** - Interaction coverage
7. **B.1 Viewport Testing** - Responsive validation
8. **D.1 Screenshot Persistence** - Evidence retention
9. **E.1 Previous Audit Comparison** - Regression detection
10. **G.3 Boundary Testing** - Edge case coverage

### Nice to Have (Polish)
11. **E.2 Issue Status Sync** - Workflow integration
12. **F.2 Confidence Scoring** - Quality filtering
13. **G.2 Security-Adjacent Testing** - Basic security
14. **C.2 Authentication Path Coverage** - Permission testing
15. **D.2 Screenshot Quality** - Better evidence

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Route coverage | 46% (6/13) | >90% |
| Forms tested | 0% | 100% of discovered |
| PRD flows executed | 0% | 100% of defined |
| Finding verification rate | 0% | 100% |
| Responsive viewports tested | 1 | 3 |
| Edge cases tested per form | 0 | 4 (empty, invalid, boundary, special) |
| Regressions detected | N/A | Track per audit |

---

## Estimated Implementation Effort

| Phase | Complexity | Files Changed |
|-------|------------|---------------|
| A. Dynamic Testing | High | SKILL_INSTRUCTIONS.md (major) |
| B. Responsive Testing | Medium | SKILL_INSTRUCTIONS.md |
| C. Comprehensive Exploration | Medium | SKILL_INSTRUCTIONS.md |
| D. Screenshot Persistence | Medium | SKILL_INSTRUCTIONS.md, finding schema |
| E. Audit Comparison | High | SKILL_INSTRUCTIONS.md, new file |
| F. Verification Pass | Medium | SKILL_INSTRUCTIONS.md |
| G. Edge Case Testing | High | SKILL_INSTRUCTIONS.md |

Total: ~400-600 lines of new instructions, modifications to multiple phases.
