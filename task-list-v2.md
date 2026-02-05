# Project Completion Agent: Implementation Task List v2

*Incorporates Codex feedback on task-list-v1.md*

---

## Codex Feedback Incorporated

| Codex Finding | Resolution |
|---------------|------------|
| Task 0.1 lacks concrete environment detection mechanism | Added explicit heuristics: CLI flag > config.yml > hostname patterns > default safe |
| Task 0.2 action classification underspecified for JS handlers | Added DOM event inspection for onclick/data-* and modal detection |
| Task A.2 and G.3 overlap on boundary logic | Merged into single Boundary Testing Module in A.2, G.3 reuses it |
| Task C.2 coverage denominator undefined | Added explicit denominator calculation from code-analysis.json + discovered links |
| Task F.1 async handling vague | Added deterministic wait: DOM ready + no spinners + 3s timeout |
| Task E.1/E.2 schema versioning missing | Added Task E.0: Finding Schema Versioning |
| B.1 horizontal overflow detection unspecified | Added: scrollWidth > clientWidth check |
| D.1 100MB limit enforcement unclear | Added: warning at 80MB, refuse new screenshots at 100MB |

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
1. Define environment detection hierarchy (precedence order):
   ```
   1. CLI flag: --full-mode or --safe-mode (highest priority)
   2. config.yml: is_production_data: true/false
   3. Hostname patterns (if neither above specified):
      - localhost, 127.0.0.1, *.local → FULL MODE
      - staging.*, dev.*, test.* → FULL MODE
      - *.prod.*, production.* → SAFE MODE
      - Everything else → SAFE MODE (default safe)
   ```
2. Add conflict resolution: CLI > config > hostname > default
3. Implement SAFE MODE restrictions:
   - Block form submissions
   - Block destructive button clicks (delete, remove, cancel)
   - Block edge case testing (XSS, injection, boundary)
   - Allow READ-ONLY exploration only
4. Add `test_mode: "safe" | "full"` to progress.json
5. Add `environment_detection_source: "cli" | "config" | "hostname" | "default"` to progress.json
6. Log all skipped tests with reason in activity_log

**Acceptance Criteria:**
- [ ] Config has `is_production_data: true/false` field
- [ ] CLI flags `--full-mode` and `--safe-mode` override config
- [ ] Hostname patterns detected and applied when no explicit config
- [ ] Detection source logged in progress.json
- [ ] Safe mode prevents all CREATE/UPDATE/DELETE actions
- [ ] Skipped tests are logged with reasons

---

### Task 0.2: Action Classification System
**Priority:** GATE | **Complexity:** Medium | **Dependencies:** Task 0.1

**Implementation:**
1. Create action classification function that categorizes by:
   - **Button text patterns:** delete, remove, cancel, submit, save, add, create, update
   - **URL patterns:** /delete, /remove, /create, /update, /destroy
   - **Form action attributes:** method="POST", method="DELETE"
   - **HTTP method inference:** GET=READ, POST=CREATE/UPDATE, DELETE=DELETE
   - **DOM event inspection (NEW):**
     - Check `onclick` attributes for destructive keywords
     - Check `data-action`, `data-method`, `data-confirm` attributes
     - Detect modal triggers (data-toggle="modal", data-bs-toggle)
   - **Link with query params:** `?action=delete`, `?confirm=true`
2. Define classification categories:
   - READ: View, Navigate, Scroll → Always allowed
   - CREATE: Submit form, Add item → Full mode only + tracking
   - UPDATE: Edit, Save, Toggle → Full mode only + tracking
   - DELETE: Delete, Remove, Cancel → Full mode + confirmation
   - DANGEROUS: Payment, Account delete → Never auto-execute
   - UNKNOWN: Cannot classify → Treat as DELETE (safe default)
3. Add `action_classification` section to config.yml with custom patterns
4. Log all CREATE/UPDATE actions to `test-data-created.json`

**Acceptance Criteria:**
- [ ] Every interactive element is classified before interaction
- [ ] DOM event handlers (onclick, data-*) inspected for classification
- [ ] Modal triggers detected and classified
- [ ] UNKNOWN actions treated as DELETE (fail-safe)
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
     "schema_version": "1.0",
     "created_items": [
       {"type": "form_submit", "url": "/create", "data": {...}, "timestamp": "...", "reversible": true/false}
     ],
     "reset_instructions": "Manual cleanup required for...",
     "estimated_cleanup_time": "5 minutes"
   }
   ```
2. Track all data-creating actions during audit
3. After audit: display cleanup instructions if any data created
4. Add `--cleanup` flag to complete-audit command

**Acceptance Criteria:**
- [ ] All test data creation tracked with timestamps
- [ ] Reversibility noted per item
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

### Task A.2: Form Testing - Full Mode (with Boundary Testing Module)
**Priority:** CORE | **Complexity:** High | **Dependencies:** Task A.1, Task 0.2

**Implementation:**
1. For each form discovered (when `is_production_data: false`):
   - Execute happy path with valid test data
   - Execute validation tests (empty required fields)
   - Execute boundary tests (using Boundary Testing Module)
   - Record submit result (success/error/validation message)

2. **Boundary Testing Module (shared with G.3):**
   ```
   derive_boundary(field):
     1. Check HTML attributes:
        - maxlength → test at maxlength, maxlength+1
        - min/max → test at min-1, min, max, max+1
        - pattern → test valid pattern, invalid pattern
     2. Check PRD field constraints (if available)
     3. Apply conservative defaults if no hints:
        - String: 255 chars (not 10000)
        - Number: -1000 to 1000000 (not MAX_INT)
        - Date: 10 years past to 10 years future
     4. Log source: "html_attribute" | "prd_spec" | "default"
   ```

3. Add `form_test_results[]` to page-{n}.json
4. Add `boundary_source` to each test result
5. Track test data created

**Acceptance Criteria:**
- [ ] Forms submitted with valid data
- [ ] Validation tested with invalid data
- [ ] Boundaries derived from HTML attributes first
- [ ] PRD constraints used when HTML attributes absent
- [ ] Conservative defaults when no hints
- [ ] Boundary source logged for each test
- [ ] Results recorded in page JSON
- [ ] Test data tracked
- [ ] No DoS-risk test values (no 10k strings, no MAX_INT)

---

### Task A.3: Button/Action Testing
**Priority:** CORE | **Complexity:** Medium | **Dependencies:** Task 0.2

**Implementation:**
1. Identify all interactive elements on page
2. Classify each action (READ/CREATE/UPDATE/DELETE/DANGEROUS/UNKNOWN)
3. In SAFE MODE: Document only, no clicks except navigation links
4. In FULL MODE:
   - Execute READ actions freely
   - Execute CREATE/UPDATE with data tracking
   - Skip DELETE unless explicitly allowed in config
   - Never execute DANGEROUS or UNKNOWN actions
5. Add `actions_found[]` and `actions_tested[]` to page-{n}.json

**Acceptance Criteria:**
- [ ] All buttons/actions inventoried
- [ ] Actions classified by type (including UNKNOWN)
- [ ] Safe mode respects restrictions
- [ ] Full mode executes READ/CREATE/UPDATE with tracking
- [ ] DELETE skipped unless config allows
- [ ] DANGEROUS/UNKNOWN never auto-executed

---

### Task A.4: User Flow Execution
**Priority:** CORE | **Complexity:** High | **Dependencies:** Task A.2, Task A.3

**Implementation:**
1. Read flows from prd-summary.json
2. Create PRD-to-action mapping layer:
   - If step has selector/action: execute directly
   - If step is narrative: attempt intelligent mapping via keywords
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
- [ ] Non-automatable steps flagged as manual_step_required
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
   - Resize window using `mcp__claude-in-chrome__resize_window`
   - Take screenshot
   - **Check for horizontal overflow:** `document.documentElement.scrollWidth > document.documentElement.clientWidth`
   - Verify navigation accessible (check for hamburger menu on mobile)
   - Test key interaction (search, date picker if present)
3. Add `viewport_tests[]` to page-{n}.json
4. Add `responsive_test_pages` to config (limit scope)

**Acceptance Criteria:**
- [ ] 3 viewports tested per configured page
- [ ] Horizontal overflow detected via scrollWidth > clientWidth
- [ ] Layout breaks flagged as findings
- [ ] Screenshots captured per viewport
- [ ] Findings created for responsive issues
- [ ] Navigation accessibility verified at each size

---

## Phase C: Comprehensive Exploration [CORE]

### Task C.1: Route Canonicalization
**Priority:** CORE | **Complexity:** Medium | **Dependencies:** None

**Implementation:**
1. Normalize routes:
   - Strip query parameters (except key identifiers like `id`, `tab`)
   - Normalize trailing slashes (remove)
   - Extract route pattern: `/users/123` → `/users/{id}`
   - Detect numeric IDs: `/\d+/` → `/{id}`
   - Detect UUIDs: `/[a-f0-9-]{36}/` → `/{uuid}`
2. Create route ID scheme:
   - `route_id = hash(method + canonical_path)`
3. Implement stop rules:
   - Max 50 unique routes (configurable: `max_routes`)
   - Max 5 instances per route pattern (configurable: `max_per_pattern`)
   - Skip routes matching exclude patterns (configurable: `exclude_patterns`)
   - Time budget: 30 minutes max exploration (configurable: `exploration_timeout`)
4. Add `route_pattern` and `route_id` to page-{n}.json
5. Add `routes_by_pattern` summary to coverage-summary.md

**Acceptance Criteria:**
- [ ] Routes canonicalized (query params stripped, trailing slashes normalized)
- [ ] Parameterized routes grouped by pattern
- [ ] Stop rules prevent infinite crawl
- [ ] Coverage tracks unique patterns not raw URLs

---

### Task C.2: Exhaustive Route Discovery & Visitation
**Priority:** CORE | **Complexity:** Medium | **Dependencies:** Task C.1

**Implementation:**
1. **Define coverage denominator:**
   ```
   total_routes =
     routes_from_code_analysis.json (if present and fresh < 24h) +
     routes_discovered_via_crawl (unique patterns only)

   If code-analysis.json missing/stale:
     - Log warning: "Using crawl-only route discovery"
     - Denominator = discovered routes only
   ```

2. Visit routes in priority order:
   - Routes from code-analysis.json first
   - Discovered links second
3. Apply canonicalization and stop rules
4. For parameterized routes: test 2-3 instances, not every value
5. Stop only when:
   - Queue empty (all patterns visited)
   - max_routes reached (with warning in coverage-summary.md)
   - exploration_timeout exceeded (with warning)
   - stop.flag detected
6. Document unvisited routes with reasons

**Acceptance Criteria:**
- [ ] Coverage denominator explicitly calculated and logged
- [ ] Fallback to crawl-only if code-analysis.json missing/stale
- [ ] >90% unique route patterns visited (of defined denominator)
- [ ] Parameterized routes sampled (2-3 instances), not exhausted
- [ ] Coverage incomplete clearly flagged with percentage
- [ ] Reasons for skips documented per route

---

### Task C.3: Authentication Path Coverage
**Priority:** POLISH | **Complexity:** High | **Dependencies:** Task C.2

**Implementation:**
1. Session management:
   - Clear cookies before switching users
   - Verify logged-out state before re-login
   - Log session switches
2. MFA/SSO handling:
   - If MFA detected: pause with continue.flag mechanism
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
     "type": "full" | "element" | "annotated",
     "finding_id": "finding-001",
     "file_size_bytes": 145000
   }
   ```
3. Create `screenshot_manifest.json`
4. **Storage limits:**
   - Track cumulative size in manifest
   - At 80MB: log warning "Approaching storage limit"
   - At 100MB: refuse new screenshots, log "Storage limit reached"
   - Eviction: none automatic (user decides via --cleanup)
5. Retention strategy:
   - Keep for accepted findings (uploaded to GitHub)
   - Delete for rejected findings after review
6. Add cleanup to `--cleanup` command

**Acceptance Criteria:**
- [ ] Screenshots saved to disk with metadata
- [ ] Cumulative size tracked in manifest
- [ ] Warning logged at 80MB
- [ ] New screenshots refused at 100MB
- [ ] Cleanup removes old screenshots when requested

---

## Phase E: Audit Comparison & History [QUALITY]

### Task E.0: Finding Schema Versioning (NEW)
**Priority:** QUALITY | **Complexity:** Low | **Dependencies:** None

**Implementation:**
1. Add `schema_version: "1.0"` to finding JSON schema
2. Define version compatibility rules:
   - Same major version: fully compatible
   - Different major version: incompatible, skip comparison
3. On audit start, check previous audit schema version
4. If incompatible: log warning, skip E.1/E.2 comparison

**Acceptance Criteria:**
- [ ] Schema version field present in all findings
- [ ] Version compatibility checked before comparison
- [ ] Incompatible versions logged and comparison skipped
- [ ] No crashes from schema mismatches

---

### Task E.1: Previous Audit Comparison
**Priority:** QUALITY | **Complexity:** Medium | **Dependencies:** Task E.0

**Implementation:**
1. On audit start, load previous audit findings (if schema compatible)
2. Compare new findings with previous:
   - NEW: Not in previous audit
   - RECURRING: Same as previous (still broken)
   - FIXED: In previous, not in current
   - REGRESSION: Was fixed, now broken again
3. Add `comparison_status` to finding schema
4. Add "Regressions" section to report.md

**Acceptance Criteria:**
- [ ] Previous findings loaded (if schema compatible)
- [ ] Comparison status assigned to each finding
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
     element_selector +     // input#email or "email input"
     error_type +           // validation_missing, crash, etc.
     expected_behavior      // normalized lowercase
   )
   ```
2. Store signature in finding JSON
3. Store signature in GitHub issue body (for search)
4. Use for deduplication:
   - Exact match: mark as `recurring`
   - >80% match: flag for human review
5. Use for issue search: `gh issue list --search "signature:abc123"`

**Acceptance Criteria:**
- [ ] Signatures generated consistently (same input = same hash)
- [ ] Duplicates detected via exact signature match
- [ ] Similar findings (>80% match) flagged for review
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

2. **Deterministic wait strategy:**
   ```
   wait_for_page_ready():
     1. Wait for DOMContentLoaded
     2. Wait for no active XHR/fetch requests (check via performance API or MCP)
     3. Check for loading indicators:
        - No elements matching: .loading, .spinner, [aria-busy="true"]
        - No skeleton screens
     4. Hard timeout: 3 seconds max after DOM ready
     5. Return ready or timeout_exceeded
   ```

3. Retry strategy:
   - Attempt 3 times
   - Wait 2 seconds between attempts
   - 2/3 succeed: VERIFIED
   - 1/3 succeed: FLAKY (include with warning label)
   - 0/3 succeed: COULD_NOT_REPRODUCE
4. Add `verification_status` to finding schema
5. Add `verification_attempts` count

**Acceptance Criteria:**
- [ ] All findings re-verified before report
- [ ] Page readiness determined via DOM + no spinners + timeout
- [ ] Flaky findings marked as FLAKY (not dropped)
- [ ] Non-reproducible findings marked COULD_NOT_REPRODUCE
- [ ] Async/dynamic content handled with deterministic waits

---

### Task F.2: Confidence Scoring
**Priority:** QUALITY | **Complexity:** Low | **Dependencies:** Task F.1

**Implementation:**
1. Calculate confidence 0-100 based on:
   - Evidence completeness (screenshot, steps, expected/actual)
   - Reproduction success rate (3/3 = +30, 2/3 = +15, 1/3 = +5)
   - Severity indicators in page
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
- [ ] Score breakdown available in finding JSON
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
- [ ] Error messages validated for user-friendliness
- [ ] Stack trace exposure flagged as P0
- [ ] Results documented

---

### Task G.2: Security-Adjacent Testing (Opt-In)
**Priority:** POLISH | **Complexity:** Medium | **Dependencies:** Task 0.1 (full mode only)

**Implementation:**
1. Add `security_checks: true/false` to config (default: false)
2. If enabled:
   - Basic XSS check with obvious payload (`<script>XSS_TEST_123</script>`)
   - Basic injection check (single quote in search)
   - Check for exposed sensitive data patterns
3. Throttling:
   - Max 1 security test per form
   - 5 second delay between tests
   - Stop on WAF block detection (403 response pattern)
4. Add `security_checks[]` to page-{n}.json

**Acceptance Criteria:**
- [ ] Opt-in only (default off)
- [ ] Throttling prevents WAF blocks
- [ ] WAF detection stops tests early
- [ ] Results documented

---

### Task G.3: Smart Boundary Testing Extension
**Priority:** QUALITY | **Complexity:** Low | **Dependencies:** Task A.2

**Note:** Boundary Testing Module implemented in Task A.2. This task extends it for edge case scenarios.

**Implementation:**
1. Reuse Boundary Testing Module from A.2
2. Add edge case extensions:
   - Unicode/emoji in text fields
   - Special characters (< > & " ' / \)
   - Null bytes and control characters
3. Add `boundary_edge_cases_tested[]` to page-{n}.json

**Acceptance Criteria:**
- [ ] Boundary Testing Module from A.2 reused (no duplication)
- [ ] Edge case extensions applied
- [ ] Results logged separately from A.2 results

---

## Implementation Order (Updated)

### Sprint 1: Safety Foundation (Must Complete First)
1. Task 0.1: Environment Classification System (with detection hierarchy)
2. Task 0.2: Action Classification System (with DOM event inspection)
3. Task 0.3: Test Data Tracking & Reset

### Sprint 2: Core Testing Capabilities
4. Task A.1: Form Testing - Safe Mode
5. Task A.2: Form Testing - Full Mode (includes Boundary Testing Module)
6. Task A.3: Button/Action Testing
7. Task C.1: Route Canonicalization
8. Task C.2: Exhaustive Route Discovery & Visitation

### Sprint 3: Verification & Quality
9. Task F.1: Finding Verification with Retry (with deterministic waits)
10. Task G.1: Error State Testing
11. Task A.4: User Flow Execution

### Sprint 4: Evidence & Comparison
12. Task D.1: Screenshot Storage System (with storage limits)
13. Task E.0: Finding Schema Versioning (NEW - before E.1)
14. Task E.1: Previous Audit Comparison
15. Task E.2: Finding Signature System

### Sprint 5: Polish & Edge Cases
16. Task B.1: Viewport Testing (with overflow detection)
17. Task F.2: Confidence Scoring
18. Task G.3: Smart Boundary Testing Extension (reuses A.2 module)
19. Task G.2: Security-Adjacent Testing (Opt-In)
20. Task C.3: Authentication Path Coverage

---

## Success Metrics

| Metric | Current | Target | Task |
|--------|---------|--------|------|
| Route coverage | 46% | >90% of unique patterns (defined denominator) | C.1, C.2 |
| Forms tested | 0% | 100% (safe: observed, full: tested) | A.1, A.2 |
| PRD flows executed | 0% | 100% of automatable steps | A.4 |
| Finding verification | 0% | 100% with flakiness handling | F.1 |
| Responsive viewports | 1 | 3 | B.1 |
| Edge cases per form | 0 | Smart boundaries (derived, not hardcoded) | A.2, G.3 |
| False positive rate | Unknown | <10% via verification | F.1, F.2 |
| Production data safety | Risky | 100% safe mode compliance | 0.1, 0.2 |
| Schema compatibility | N/A | Versioned, migration-safe | E.0 |
