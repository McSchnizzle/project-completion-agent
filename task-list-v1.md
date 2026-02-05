# Project Completion Agent: Implementation Task List v1

*Based on improvement-plan-v2.md (Codex feedback incorporated)*

---

## Task Categories

- **GATE** = Must complete before dependent tasks
- **CORE** = Essential for product functionality
- **QUALITY** = Improves reliability/accuracy
- **POLISH** = Nice to have, can defer

---

## Phase 0: Environment Safety Prerequisites [GATE]

### Task 0.1: Environment Classification System
**Priority:** GATE | **Complexity:** Medium | **Dependencies:** None

**Implementation:**
1. Add `is_production_data` field to config.yml schema
2. Add environment detection logic to preflight phase
3. Implement SAFE MODE restrictions:
   - Block form submissions
   - Block destructive button clicks (delete, remove, cancel)
   - Block edge case testing (XSS, injection, boundary)
   - Allow READ-ONLY exploration only
4. Add `test_mode: "safe" | "full"` to progress.json
5. Log all skipped tests with reason in activity_log

**Acceptance Criteria:**
- [ ] Config has `is_production_data: true/false` field
- [ ] Preflight phase detects and sets environment mode
- [ ] Safe mode prevents all CREATE/UPDATE/DELETE actions
- [ ] Skipped tests are logged with reasons

---

### Task 0.2: Action Classification System
**Priority:** GATE | **Complexity:** Medium | **Dependencies:** Task 0.1

**Implementation:**
1. Create action classification function that categorizes by:
   - Button text patterns (delete, remove, cancel, submit, save)
   - URL patterns (/delete, /remove, /create)
   - Form action attributes
   - HTTP method (GET=READ, POST=CREATE/UPDATE, DELETE=DELETE)
2. Define classification categories:
   - READ: View, Navigate, Scroll → Always allowed
   - CREATE: Submit form, Add item → Full mode only + tracking
   - UPDATE: Edit, Save, Toggle → Full mode only + tracking
   - DELETE: Delete, Remove, Cancel → Full mode + confirmation
   - DANGEROUS: Payment, Account delete → Never auto-execute
3. Add `action_classification` section to config.yml
4. Log all CREATE/UPDATE actions to `test-data-created.json`

**Acceptance Criteria:**
- [ ] Every interactive element is classified before interaction
- [ ] Classification logged in page-{n}.json
- [ ] CREATE/UPDATE actions tracked in test-data-created.json
- [ ] DANGEROUS actions never auto-executed

---

### Task 0.3: Test Data Tracking & Reset
**Priority:** CORE | **Complexity:** Low | **Dependencies:** Task 0.2

**Implementation:**
1. Create `test-data-created.json` schema:
   ```json
   {
     "created_items": [
       {"type": "form_submit", "url": "/create", "data": {...}, "timestamp": "..."}
     ],
     "reset_instructions": "Manual cleanup required for..."
   }
   ```
2. Track all data-creating actions during audit
3. After audit: display cleanup instructions if any data created
4. Add `--cleanup` flag to complete-audit command

**Acceptance Criteria:**
- [ ] All test data creation tracked
- [ ] Cleanup instructions provided after audit
- [ ] User informed of any permanent changes made

---

## Phase A: Dynamic Testing Engine [CORE]

### Task A.1: Form Testing - Safe Mode
**Priority:** CORE | **Complexity:** Medium | **Dependencies:** Task 0.1

**Implementation:**
1. During page exploration, detect all forms
2. In SAFE MODE:
   - Document form structure (fields, types, attributes)
   - Document validation attributes (required, pattern, maxlength, min, max)
   - Create findings for missing validation attributes (observation only)
   - Do NOT submit forms
3. Add `forms_observed[]` to page-{n}.json with:
   - Form action URL
   - Field inventory
   - Validation attributes present
   - Missing recommended validations

**Acceptance Criteria:**
- [ ] All forms on page documented
- [ ] Validation attributes captured
- [ ] No form submissions in safe mode
- [ ] Findings created for missing validations

---

### Task A.2: Form Testing - Full Mode
**Priority:** CORE | **Complexity:** High | **Dependencies:** Task A.1, Task 0.2

**Implementation:**
1. For each form discovered (when `is_production_data: false`):
   - Execute happy path with valid test data
   - Execute validation tests (empty required fields)
   - Execute boundary tests (derived from HTML attributes)
   - Record submit result (success/error/validation message)
2. Smart Boundary Derivation:
   - Use `maxlength` for string limits
   - Use `pattern` for format validation
   - Use `min`/`max` for numeric/date limits
   - Default: 255 chars, reasonable numbers
3. Add `form_test_results[]` to page-{n}.json
4. Track test data created

**Acceptance Criteria:**
- [ ] Forms submitted with valid data
- [ ] Validation tested with invalid data
- [ ] Boundaries derived from HTML attributes
- [ ] Results recorded in page JSON
- [ ] Test data tracked

---

### Task A.3: Button/Action Testing
**Priority:** CORE | **Complexity:** Medium | **Dependencies:** Task 0.2

**Implementation:**
1. Identify all interactive elements on page
2. Classify each action (READ/CREATE/UPDATE/DELETE/DANGEROUS)
3. In SAFE MODE: Document only, no clicks except navigation
4. In FULL MODE:
   - Execute READ actions freely
   - Execute CREATE/UPDATE with data tracking
   - Skip DELETE unless explicitly allowed in config
   - Never execute DANGEROUS actions
5. Add `actions_found[]` and `actions_tested[]` to page-{n}.json

**Acceptance Criteria:**
- [ ] All buttons/actions inventoried
- [ ] Actions classified by type
- [ ] Safe mode respects restrictions
- [ ] Full mode executes with tracking

---

### Task A.4: User Flow Execution
**Priority:** CORE | **Complexity:** High | **Dependencies:** Task A.2, Task A.3

**Implementation:**
1. Read flows from prd-summary.json
2. Create PRD-to-action mapping layer:
   - If step has selector/action: execute directly
   - If step is narrative: attempt intelligent mapping
   - If mapping fails: mark as `manual_step_required`
3. For each flow:
   - Execute automatable steps sequentially
   - Record success/failure at each step
   - Create finding if flow breaks
4. Report flow coverage: `{automated}/{total}` steps
5. Add `flow_mapping_status` to prd-summary.json
6. Add `manual_steps[]` to flow results

**Acceptance Criteria:**
- [ ] Flows parsed from PRD
- [ ] Automatable steps executed
- [ ] Non-automatable steps flagged
- [ ] Coverage percentage reported
- [ ] Findings created for broken flows

---

## Phase B: Responsive Testing [QUALITY]

### Task B.1: Viewport Testing
**Priority:** QUALITY | **Complexity:** Low | **Dependencies:** None

**Implementation:**
1. Define 3 viewport sizes:
   - Desktop: 1400x900
   - Tablet: 768x1024
   - Mobile: 375x667
2. For configured pages (default: homepage + 2):
   - Resize window
   - Take screenshot
   - Check for horizontal overflow
   - Verify navigation accessible (hamburger on mobile)
   - Test key interaction (search, date picker)
3. Add `viewport_tests[]` to page-{n}.json
4. Add `responsive_test_pages` to config (limit scope)

**Acceptance Criteria:**
- [ ] 3 viewports tested
- [ ] Layout breaks detected
- [ ] Screenshots captured per viewport
- [ ] Findings created for responsive issues

---

## Phase C: Comprehensive Exploration [CORE]

### Task C.1: Route Canonicalization
**Priority:** CORE | **Complexity:** Medium | **Dependencies:** None

**Implementation:**
1. Normalize routes:
   - Strip query parameters (except key identifiers)
   - Normalize trailing slashes
   - Extract route pattern: `/users/123` → `/users/{id}`
2. Create route ID scheme:
   - `route_id = hash(method + canonical_path)`
3. Implement stop rules:
   - Max 50 unique routes (configurable)
   - Max 5 instances per route pattern
   - Skip routes matching exclude patterns
   - Time budget: 30 minutes max exploration
4. Add `route_pattern` and `route_id` to page-{n}.json
5. Add `routes_by_pattern` summary to coverage-summary.md

**Acceptance Criteria:**
- [ ] Routes canonicalized correctly
- [ ] Parameterized routes grouped
- [ ] Stop rules prevent infinite crawl
- [ ] Coverage tracks unique patterns

---

### Task C.2: Exhaustive Route Discovery
**Priority:** CORE | **Complexity:** Medium | **Dependencies:** Task C.1

**Implementation:**
1. Visit ALL routes from code-analysis.json
2. Follow ALL internal links discovered
3. Apply canonicalization and stop rules
4. For parameterized routes: test 2-3 instances, not every value
5. Stop only when:
   - Queue empty (all patterns visited)
   - max_routes reached (with warning)
   - time_budget exceeded (with warning)
   - stop.flag detected
6. Document unvisited routes with reasons

**Acceptance Criteria:**
- [ ] >90% unique route patterns visited
- [ ] Parameterized routes sampled, not exhausted
- [ ] Coverage incomplete clearly flagged
- [ ] Reasons for skips documented

---

### Task C.3: Authentication Path Coverage
**Priority:** POLISH | **Complexity:** High | **Dependencies:** Task C.2

**Implementation:**
1. Session management:
   - Clear cookies before switching users
   - Verify logged-out state before re-login
   - Log session switches
2. MFA/SSO handling:
   - If MFA detected: pause with continue.flag
   - If SSO: attempt auto-completion, fallback to pause
   - Document auth method per credential
3. Multi-role testing:
   - Test as each credential level
   - Verify access controls
   - Document permission matrix

**Acceptance Criteria:**
- [ ] Sessions properly reset between users
- [ ] MFA pauses for user input
- [ ] Permission matrix documented
- [ ] Access control violations flagged

---

## Phase D: Screenshot Persistence [QUALITY]

### Task D.1: Screenshot Storage System
**Priority:** QUALITY | **Complexity:** Medium | **Dependencies:** None

**Implementation:**
1. Create `screenshots/` directory in audit
2. Save screenshots with metadata:
   ```json
   {
     "id": "ss_001",
     "file_path": "screenshots/finding-001-full.png",
     "captured_at": "ISO8601",
     "viewport": {"width": 1400, "height": 900},
     "url": "/settings",
     "type": "full",
     "finding_id": "finding-001"
   }
   ```
3. Create `screenshot_manifest.json`
4. Retention strategy:
   - Keep for accepted findings
   - Delete for rejected findings after review
   - Max 100MB per audit (warn if exceeded)
5. Add cleanup to `--cleanup` command

**Acceptance Criteria:**
- [ ] Screenshots saved to disk
- [ ] Metadata tracked in manifest
- [ ] Storage limits enforced
- [ ] Cleanup removes old screenshots

---

## Phase E: Audit Comparison & History [QUALITY]

### Task E.1: Previous Audit Comparison
**Priority:** QUALITY | **Complexity:** Medium | **Dependencies:** None

**Implementation:**
1. On audit start, load previous audit findings
2. Compare new findings with previous:
   - NEW: Not in previous audit
   - RECURRING: Same as previous (still broken)
   - FIXED: In previous, not in current
   - REGRESSION: Was fixed, now broken again
3. Add `comparison_status` to finding schema
4. Add "Regressions" section to report.md

**Acceptance Criteria:**
- [ ] Previous findings loaded
- [ ] Comparison status assigned
- [ ] Regressions highlighted in report
- [ ] Fixed issues tracked

---

### Task E.2: Finding Signature System
**Priority:** QUALITY | **Complexity:** Medium | **Dependencies:** Task E.1

**Implementation:**
1. Generate deterministic signature:
   ```
   signature = hash(
     url_pattern +          // /settings (not /settings?tab=1)
     element_selector +     // input#email
     error_type +           // validation_missing
     expected_behavior      // normalized
   )
   ```
2. Store signature in finding JSON
3. Store signature in GitHub issue body
4. Use for deduplication:
   - Exact match: mark as `recurring`
   - >80% match: flag for human review
5. Use for issue search: `gh issue list --search`

**Acceptance Criteria:**
- [ ] Signatures generated consistently
- [ ] Duplicates detected
- [ ] Similar findings flagged for review
- [ ] GitHub issues searchable by signature

---

## Phase F: Pre-Report Verification [CORE]

### Task F.1: Finding Verification with Retry
**Priority:** CORE | **Complexity:** Medium | **Dependencies:** None

**Implementation:**
1. After all findings collected, before report:
   - Re-navigate to each finding URL
   - Re-execute reproduction steps
   - Verify finding still reproduces
2. Retry strategy:
   - Attempt 3 times (not 2)
   - Wait 2 seconds between attempts
   - 2/3 succeed: VERIFIED
   - 1/3 succeed: FLAKY (include with warning)
   - 0/3 succeed: COULD_NOT_REPRODUCE
3. Async content handling:
   - Wait for page load complete
   - Wait for network idle (5 seconds)
   - Check for loading indicators
4. Add `verification_status` to finding schema

**Acceptance Criteria:**
- [ ] All findings re-verified
- [ ] Flaky findings marked as FLAKY
- [ ] Non-reproducible findings marked
- [ ] Async content handled properly

---

### Task F.2: Confidence Scoring
**Priority:** QUALITY | **Complexity:** Low | **Dependencies:** Task F.1

**Implementation:**
1. Calculate confidence 0-100 based on:
   - Evidence completeness
   - Reproduction success rate
   - Severity indicators
   - PRD alignment
2. Scoring tiers:
   - <50: Mark as `[NEEDS HUMAN REVIEW]` (don't filter)
   - 50-75: Medium confidence
   - >75: High confidence
3. Add `confidence_score` to finding schema
4. Add confidence label to report output

**Acceptance Criteria:**
- [ ] Confidence calculated for all findings
- [ ] Low-confidence findings marked (not filtered)
- [ ] Score breakdown available
- [ ] User can review uncertain findings

---

## Phase G: Edge Case & Error Testing [CORE]

### Task G.1: Error State Testing
**Priority:** CORE | **Complexity:** Medium | **Dependencies:** Task 0.1 (full mode only)

**Implementation:**
1. For each page, test error scenarios:
   - Invalid URL parameters (`?id=invalid`, `?id=999999`)
   - Missing required data
   - Malformed requests
2. Verify error handling:
   - Meaningful error message shown
   - No stack traces exposed
   - Graceful degradation
3. Add `error_scenarios_tested[]` to page-{n}.json
4. Create P0 findings for exposed stack traces

**Acceptance Criteria:**
- [ ] Error scenarios tested per page
- [ ] Error messages validated
- [ ] Stack trace exposure flagged as P0
- [ ] Results documented

---

### Task G.2: Security-Adjacent Testing (Opt-In)
**Priority:** POLISH | **Complexity:** Medium | **Dependencies:** Task 0.1 (full mode only)

**Implementation:**
1. Add `security_checks: true/false` to config (default: false)
2. If enabled:
   - Basic XSS check with obvious payload
   - Basic injection check
   - Check for exposed sensitive data
3. Throttling:
   - Max 1 security test per form
   - 5 second delay between tests
   - Stop on WAF block detection
4. Add `security_checks[]` to page-{n}.json

**Acceptance Criteria:**
- [ ] Opt-in only (default off)
- [ ] Throttling prevents blocks
- [ ] WAF detection stops tests
- [ ] Results documented

---

### Task G.3: Smart Boundary Testing
**Priority:** QUALITY | **Complexity:** Medium | **Dependencies:** Task A.2

**Implementation:**
1. Derive boundaries from:
   - HTML attributes (maxlength, min, max, pattern)
   - PRD field constraints
   - Conservative defaults if no hints
2. Default limits:
   - String: 255 chars (not 10000)
   - Number: -1000 to 1000000 (not MAX_INT)
   - Date: 10 years past to 10 years future
3. Log boundary source: "html_attribute" | "prd_spec" | "default"
4. Test at boundaries, not beyond

**Acceptance Criteria:**
- [ ] Boundaries derived from available hints
- [ ] Conservative defaults used
- [ ] Source of boundary logged
- [ ] No DoS-risk test values

---

## Implementation Order

### Sprint 1: Safety Foundation (Must Complete First)
1. Task 0.1: Environment Classification System
2. Task 0.2: Action Classification System
3. Task 0.3: Test Data Tracking & Reset

### Sprint 2: Core Testing Capabilities
4. Task A.1: Form Testing - Safe Mode
5. Task A.2: Form Testing - Full Mode
6. Task A.3: Button/Action Testing
7. Task C.1: Route Canonicalization
8. Task C.2: Exhaustive Route Discovery

### Sprint 3: Verification & Quality
9. Task F.1: Finding Verification with Retry
10. Task G.1: Error State Testing
11. Task A.4: User Flow Execution

### Sprint 4: Evidence & Comparison
12. Task D.1: Screenshot Storage System
13. Task E.1: Previous Audit Comparison
14. Task E.2: Finding Signature System

### Sprint 5: Polish & Edge Cases
15. Task B.1: Viewport Testing
16. Task F.2: Confidence Scoring
17. Task G.3: Smart Boundary Testing
18. Task G.2: Security-Adjacent Testing (Opt-In)
19. Task C.3: Authentication Path Coverage

---

## Success Metrics

| Metric | Current | Target | Task |
|--------|---------|--------|------|
| Route coverage | 46% | >90% of unique patterns | C.1, C.2 |
| Forms tested | 0% | 100% (safe: observed, full: tested) | A.1, A.2 |
| PRD flows executed | 0% | 100% of automatable steps | A.4 |
| Finding verification | 0% | 100% with flakiness handling | F.1 |
| Responsive viewports | 1 | 3 | B.1 |
| Edge cases per form | 0 | Smart boundaries | G.3 |
| False positive rate | Unknown | <10% via verification | F.1, F.2 |
| Production data safety | Risky | 100% safe mode compliance | 0.1, 0.2 |
