# Project Completion Agent: Improvement Plan v2

*Incorporates Codex feedback from v1 review*

---

## Codex Feedback Incorporated

| Codex Finding | Resolution |
|---------------|------------|
| Data safety guardrails underspecified | Added Phase 0: Environment Safety Prerequisites |
| Route coverage will blow up on parameterized routes | Added route canonicalization and stop rules to C.1 |
| Verification lacks flakiness handling | Added retry/backoff and flakiness detection to F.1 |
| Phase B says cross-browser but only does viewport | Renamed to "Responsive Testing" and scoped to viewport only |
| Authentication missing session reset/MFA | Added explicit session handling and MFA fallback to C.2 |
| Issue dedup needs deterministic signatures | Added finding signature hash to E.2 |
| Boundary tests could cause DoS | Added smart boundary derivation from HTML/PRD |
| PRD flows may not be step-executable | Added PRD-to-action mapping prerequisite |
| Confidence <50 filter hides issues | Changed to "needs review" instead of filter |
| Missing accessibility/performance | Added as optional future scope (not core) |

---

## Updated Implementation Plan

### Phase 0: Environment Safety Prerequisites (NEW - MUST BE FIRST)

**Goal:** Ensure testing cannot damage production data.

#### 0.1 Environment Classification (MANDATORY GATE)

Before ANY dynamic testing:

1. **Classify environment:**
   ```
   If is_production_data: true → SAFE MODE ONLY
   If is_production_data: false → FULL TESTING ALLOWED
   ```

2. **Safe Mode Restrictions:**
   - NO form submissions that create/modify data
   - NO button clicks on destructive actions (delete, remove, cancel)
   - NO edge case testing (XSS, injection, boundary)
   - READ-ONLY exploration only
   - Log all skipped tests with reason

3. **Full Testing Prerequisites (if is_production_data: false):**
   - Verify test data seeding available OR
   - User confirms data can be created/modified
   - Define explicit action allowlist and denylist

#### 0.2 Action Classification System

**Classify every interactive action:**

| Category | Examples | Safe Mode | Full Mode |
|----------|----------|-----------|-----------|
| READ | View, Navigate, Scroll | ✅ | ✅ |
| CREATE | Submit form, Add item | ❌ | ✅ (with tracking) |
| UPDATE | Edit, Save, Toggle | ❌ | ✅ (with tracking) |
| DELETE | Delete, Remove, Cancel | ❌ | ⚠️ (requires confirmation) |
| DANGEROUS | Payment, Account delete | ❌ | ❌ (never auto-execute) |

**Implementation:**
- Add `action_classification` to config.yml
- Detect action type from button text, URL patterns, form action
- Log all CREATE/UPDATE actions to `test-data-created.json`

#### 0.3 Test Data Reset Strategy

**If full testing mode:**
1. Before audit: snapshot current state (if possible)
2. Track all data created during audit
3. After audit: offer cleanup of test data
4. Store reset instructions in `test-data-created.json`

---

### Phase A: Dynamic Testing Engine

**Gate:** Phase 0 must be complete. Environment classified.

#### A.1 Form Testing Implementation

**Current:** Forms detected but never tested
**Required:** Test forms based on environment mode

**Safe Mode:**
- Observe form structure only
- Document fields, validation attributes, required fields
- Create findings for missing validation attributes (no interaction)

**Full Mode:**
1. For each form discovered:
   - Execute happy path (valid data)
   - Execute validation tests (empty required fields)
   - Execute boundary tests (derived from HTML maxlength/pattern/PRD)
   - Record submit result
2. Create finding for each failure
3. Track test data created

**Smart Boundary Derivation (Codex feedback):**
- Use `maxlength` attribute for string length
- Use `pattern` attribute for format
- Use `min`/`max` for numbers/dates
- Fallback to PRD constraints if specified
- Default conservative limits: 255 chars, reasonable numbers

**Implementation:**
- Add `form_test_results[]` to page-{n}.json
- Add `test_mode: "safe" | "full"` to results
- Skip forms matching `skip_actions` config

#### A.2 Button/Action Testing

**Gate:** Environment safety classification from Phase 0

**Safe Mode:**
- Document all buttons/actions found
- Note which would be tested in full mode
- No clicks except navigation links

**Full Mode:**
1. Classify each action (READ/CREATE/UPDATE/DELETE)
2. Execute READ actions freely
3. Execute CREATE/UPDATE with data tracking
4. Skip DELETE unless explicitly allowed
5. Never execute DANGEROUS actions

**Implementation:**
- Add `actions_found[]` and `actions_tested[]` to page-{n}.json
- Add `action_type` classification to each action

#### A.3 User Flow Execution

**Prerequisite:** PRD-to-action mapping scheme

**PRD Flow Parsing:**
1. Read flows from prd-summary.json
2. For each flow step:
   - If step has selector/action: execute directly
   - If step is narrative only: attempt intelligent mapping
   - If mapping fails: mark as `manual_step_required`
3. Report flow coverage: `{automated}/{total}` steps

**Manual Step Fallback (Codex feedback):**
- If >50% steps cannot be automated: flag flow as `partially_testable`
- Document which steps need manual verification
- Don't count as "tested" unless automated portion passes

**Implementation:**
- Add `flow_mapping_status` to prd-summary.json
- Add `manual_steps[]` to flow results
- Gate: Only count flow as tested if automated portion passes

---

### Phase B: Responsive Testing (Renamed from Cross-Browser)

*Scope clarified per Codex: Viewport testing only, not browser engine variation*

**Goal:** Verify app works at different viewport sizes.

#### B.1 Viewport Testing

**Test at 3 viewport sizes:**
- Desktop: 1400x900
- Tablet: 768x1024
- Mobile: 375x667

**Per viewport:**
1. Take screenshot
2. Check for horizontal overflow (layout break)
3. Verify navigation accessible (hamburger menu on mobile)
4. Test key interaction (search, date picker if present)
5. Create finding for responsive issues

**Implementation:**
- Use `mcp__claude-in-chrome__resize_window`
- Add `viewport_tests[]` to page-{n}.json
- Limit to `responsive_test_pages` config (default: homepage + 2)

#### B.2 Future: True Cross-Browser Testing

*Deferred - requires Playwright or similar, not MCP-only*

If needed later:
- Integrate Playwright for Chromium/WebKit/Gecko
- Add touch input emulation
- Add device frame emulation

---

### Phase C: Comprehensive Exploration

#### C.1 Exhaustive Route Coverage

**Route Canonicalization (Codex feedback):**

1. **Normalize routes:**
   - Strip query parameters for dedup (except key identifiers)
   - Normalize trailing slashes
   - Extract route pattern: `/users/123` → `/users/{id}`

2. **Route ID scheme:**
   ```
   route_id = hash(method + canonical_path)
   Example: GET /users/{id} → "route_users_id"
   ```

3. **Stop rules to prevent infinite crawl:**
   - Max 50 unique routes (configurable)
   - Max 5 instances of same route pattern (e.g., 5 different user IDs)
   - Skip routes matching exclude patterns
   - Time budget: 30 minutes max exploration

4. **Parameterized route handling:**
   - Identify parameter patterns: `/item/{id}`, `/user/{username}`
   - Test 2-3 instances per pattern, not every value
   - Log skipped instances

**Implementation:**
- Add `route_canonicalization` logic
- Add `route_pattern` and `route_id` to page-{n}.json
- Add `routes_by_pattern` summary to coverage-summary.md
- Add `exploration_time_limit` to config

#### C.2 Authentication Path Coverage

**Session Management (Codex feedback):**

1. **Session reset between permission levels:**
   - Clear cookies before switching users
   - Verify logged-out state before re-login
   - Log session switches

2. **MFA/SSO handling:**
   - If MFA detected: pause with `continue.flag` mechanism
   - If SSO: attempt auto-completion, fallback to pause
   - Document auth method per credential

3. **Secret storage:**
   - Credentials in config via env vars only
   - Never log credentials
   - Support MFA codes via manual entry (pause)

**Implementation:**
- Add `session_reset()` before credential switch
- Add `auth_method: "password" | "sso" | "mfa"` to credential config
- Add `mfa_required: true/false` detection

---

### Phase D: Screenshot Persistence

#### D.1 Screenshot File Storage

**With Metadata (Codex feedback):**

Each screenshot saved with:
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

**Retention/Cleanup Strategy:**
- Keep screenshots for accepted findings (uploaded to GitHub)
- Delete screenshots for rejected findings after review
- Cleanup command removes screenshots >30 days old
- Max storage: 100MB per audit (warn if exceeded)

**Implementation:**
- Create `screenshots/` directory in audit
- Add `screenshot_manifest.json` tracking all screenshots
- Add cleanup to `/complete-audit --cleanup`

---

### Phase E: Audit Comparison & History

#### E.1 Previous Audit Comparison

*No changes from v1*

#### E.2 Issue Sync with Deterministic Signatures

**Finding Signature (Codex feedback):**

```
signature = hash(
  url_pattern +          // /settings (not /settings?tab=1)
  element_selector +     // input#email or "email input"
  error_type +           // validation_missing, crash, etc.
  expected_behavior      // normalized
)
```

**Deduplication logic:**
1. Compute signature for new finding
2. Search existing findings by signature
3. If exact match: mark as `recurring`
4. If similar (>80% match): flag for human review
5. Search GitHub issues by signature in body

**Implementation:**
- Add `signature` field to finding schema
- Store signature in GitHub issue body
- Use signature for `gh issue list --search`

---

### Phase F: Pre-Report Verification

#### F.1 Finding Verification Pass

**Flakiness Handling (Codex feedback):**

1. **Retry strategy:**
   - Attempt reproduction 3 times (not 2)
   - Wait 2 seconds between attempts
   - If 2/3 succeed: mark VERIFIED
   - If 1/3 succeed: mark FLAKY (include with warning)
   - If 0/3 succeed: mark COULD_NOT_REPRODUCE

2. **Async content handling:**
   - Wait for page load complete
   - Wait for network idle (5 seconds)
   - Check for loading indicators
   - Retry after additional wait if content seems dynamic

3. **Data drift detection:**
   - If finding depends on specific data: note data dependency
   - If data changed: mark as DATA_DEPENDENT
   - Include data state in reproduction steps

**Implementation:**
- Add `verification_attempts: 3` (was 2)
- Add `verification_status: "verified" | "flaky" | "could_not_reproduce" | "data_dependent"`
- Add `FLAKY` findings to report with warning label

#### F.2 Confidence Scoring

**No Auto-Filter (Codex feedback):**

- Score 0-100 based on evidence
- <50: Mark as `[NEEDS HUMAN REVIEW]` (don't filter)
- 50-75: Include with medium confidence
- >75: Include with high confidence

**Implementation:**
- Remove auto-filter at <50
- Add `[NEEDS HUMAN REVIEW]` label for low-confidence
- Let user decide during review phase

---

### Phase G: Edge Case & Error Handling Tests

**Gate:** Phase 0 must classify environment. Only run in full mode.

#### G.1 Error State Testing

*No changes from v1*

#### G.2 Security-Adjacent Testing

**Opt-In and Throttled (Codex feedback):**

1. **Explicit opt-in required:**
   ```yaml
   testing:
     security_checks: true  # Default: false
   ```

2. **Throttling:**
   - Max 1 security test per form
   - 5 second delay between security tests
   - Stop on first WAF block detection

3. **Sandboxing:**
   - Use obviously-test payloads: `<script>XSS_TEST_12345</script>`
   - Never use actual exploit code
   - Log all security test attempts

**Implementation:**
- Add `security_checks` config flag (default: false)
- Add throttling between tests
- Add WAF detection (403 response pattern)

#### G.3 Boundary Testing

**Smart Boundaries (Codex feedback):**

Derive limits from:
1. HTML `maxlength`, `min`, `max`, `pattern` attributes
2. PRD field constraints if specified
3. Conservative defaults if no hints:
   - String: 255 chars (not 10000)
   - Number: -1000 to 1000000 (not MAX_INT)
   - Date: 10 years past to 10 years future

**Implementation:**
- Add `derive_boundaries(field)` function
- Parse HTML attributes for limits
- Check PRD for field specs
- Log boundary source: "html_attribute" | "prd_spec" | "default"

---

## Revised Implementation Priority

### Prerequisites (Must Complete First)
0. **Phase 0: Environment Safety** - GATE FOR ALL TESTING

### Must Have (MVP → Product)
1. **A.1 Form Testing** - with safe mode support
2. **C.1 Route Coverage** - with canonicalization
3. **F.1 Verification Pass** - with flakiness handling
4. **G.1 Error State Testing** - in full mode only

### Should Have (Product Quality)
5. **A.3 User Flow Execution** - with PRD mapping
6. **A.2 Button/Action Testing** - with classification
7. **B.1 Viewport Testing** - scoped to viewports
8. **D.1 Screenshot Persistence** - with metadata
9. **E.1 Audit Comparison** - for regression detection

### Nice to Have (Polish)
10. **E.2 Issue Sync** - with signatures
11. **F.2 Confidence Scoring** - without auto-filter
12. **G.3 Boundary Testing** - with smart derivation
13. **G.2 Security Testing** - opt-in only
14. **C.2 Auth Coverage** - with session handling

---

## Dependency Graph

```
Phase 0 (Safety)
    │
    ├── A.1 (Form Testing)
    │       └── A.3 (Flow Execution) ─requires─> PRD Mapping
    │
    ├── A.2 (Button Testing)
    │
    ├── C.1 (Route Coverage)
    │       └── F.1 (Verification) ─requires─> D.1 (Screenshots)
    │
    ├── G.1 (Error Testing)
    │
    └── G.2/G.3 (Security/Boundary) ─only in full mode─
```

---

## Success Metrics (Updated)

| Metric | Current | Target |
|--------|---------|--------|
| Route coverage | 46% | >90% of unique patterns |
| Forms tested | 0% | 100% in full mode, documented in safe mode |
| PRD flows executed | 0% | 100% of automatable steps |
| Finding verification | 0% | 100% with flakiness handling |
| Responsive viewports | 1 | 3 |
| Edge cases per form | 0 | Smart boundaries (not fixed 4) |
| False positive rate | Unknown | <10% (via verification) |

---

## Out of Scope (Per Codex Guidance)

- True cross-browser testing (Chromium/WebKit/Gecko) - requires Playwright
- Accessibility testing - separate tool recommended
- Performance testing - separate tool recommended
- Visual regression - future enhancement, not core
- Model-based crawling - overkill for MVP
