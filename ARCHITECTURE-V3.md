# ARCHITECTURE-V3: Project Completion Agent

**Version:** 3.0
**Date:** 2026-02-08
**Status:** Proposed
**Author:** V3 Architecture Team

---

## 1. Executive Summary

V2 shipped. It ran a real audit against a real application (socials.paulrbrown.org -- 25 pages, 15 findings, $0.44, 421 seconds). That audit exposed fundamental design flaws that cannot be patched incrementally. The tool does generic page-level QA instead of PRD-driven completion auditing. It parses 67 features from the PRD and then ignores all of them. V3 fixes this by rebuilding the pipeline around the single insight that matters: **features are the unit of work, not pages**.

### What Changes

| Concern | V2 | V3 |
|---------|----|----|
| Organizing principle | Pages | Features |
| PRD parsing | Extract features, never use them | Extract features, drive entire pipeline |
| Data flow | "Visit pages, ask LLM for issues" | "Parse acceptance criteria, map to routes, verify pass/fail" |
| LLM contract | Free-form prompt, free-form response | JSON schema in, JSON schema out, validation with retry |
| Evidence | Some findings cite measurements, some cite "N/A" | Every finding requires URL + DOM snapshot + screenshot + AC reference |
| Verification | Creates new findings (broken) | Confirms or denies existing findings only |
| Screenshots | Promised, never captured/linked | Playwright captures, findings reference by path |
| Form testing | Discovery only | Discovery + structured interaction + result evaluation |
| Quality gates | Post-hoc filter | Built into every phase, reject on failure |
| Cost model | One model for everything | Haiku for classification, Sonnet for analysis |

### What Stays

The V2 infrastructure that works stays. The Anthropic SDK client, Playwright browser, artifact store, config builder, dashboard writer, job runner, and the 15 prompt files are preserved. The execution spine is rebuilt; the plumbing is kept.

---

## 2. Core Design Principle: Feature-First Pipeline

Every phase in V3 operates on **features**, not pages. A feature is a PRD requirement with acceptance criteria. A page is evidence FOR or AGAINST a feature. The pipeline transforms features from `not_tested` to `pass` or `fail`, accumulating evidence at each step.

```
PRD Document
    |
    v
[Feature Extraction]  -->  FeatureSpec[]  (id, name, acceptance_criteria, priority)
    |
    v
[Route Mapping]       -->  FeatureSpec[] + mappedRoutes[]  (which URLs to visit per feature)
    |
    v
[Evidence Collection] -->  FeatureEvidence[]  (page data, screenshots, DOM snapshots per route)
    |
    v
[Criteria Evaluation] -->  CriterionResult[]  (pass/fail per acceptance criterion, with evidence)
    |
    v
[Finding Synthesis]   -->  Finding[]  (one finding per failed criterion, with full evidence chain)
    |
    v
[Quality Gate]        -->  Finding[]  (filtered: no positives, no self-referential, no N/A URLs)
    |
    v
[Verification]        -->  VerifiedFinding[]  (independently re-confirmed, screenshot proof)
    |
    v
[Report]              -->  Markdown + HTML Dashboard + GitHub Issues
```

---

## 3. Type Definitions

These types are the contracts between phases. Every phase consumes and produces typed data. No free-form text crosses phase boundaries.

```typescript
// ---------------------------------------------------------------------------
// Feature Types (the spine of the pipeline)
// ---------------------------------------------------------------------------

/** A single feature extracted from the PRD. */
interface FeatureSpec {
  id: string;                        // "F-001"
  name: string;                      // "User Registration"
  description: string;
  priority: 'must' | 'should' | 'could';
  acceptance_criteria: AcceptanceCriterion[];
  status: FeatureStatus;
  mapped_routes: string[];           // URLs where this feature lives
  evidence: FeatureEvidence[];       // collected during exploration
}

interface AcceptanceCriterion {
  id: string;                        // "F-001-AC-01"
  text: string;                      // "User can register with email and password"
  type: 'functional' | 'visual' | 'performance' | 'accessibility';
  verifiable: boolean;               // Can this be checked with browser automation?
  result?: CriterionResult;
}

type FeatureStatus =
  | 'not_tested'
  | 'mapped'        // routes identified but not yet visited
  | 'evidence_collected'  // pages visited, data captured
  | 'evaluated'     // criteria checked, pass/fail assigned
  | 'pass'
  | 'fail'
  | 'partial';      // some criteria pass, some fail

// ---------------------------------------------------------------------------
// Evidence Types
// ---------------------------------------------------------------------------

/** Evidence collected from visiting a page relevant to a feature. */
interface FeatureEvidence {
  feature_id: string;
  route: string;                     // URL visited
  collected_at: string;              // ISO timestamp
  page_snapshot: PageSnapshot;
  screenshots: ScreenshotRef[];
  network_log: NetworkLogEntry[];
  console_errors: ConsoleEntry[];
}

interface PageSnapshot {
  url: string;
  title: string;
  status_code: number;
  html_excerpt: string;              // First 10KB of HTML
  text_content: string;              // Extracted visible text (first 5KB)
  forms: FormSnapshot[];
  links: string[];
  load_time_ms: number;
  dom_hash: string;                  // SHA-256 of full HTML for dedup
  is_spa: boolean;
}

interface FormSnapshot {
  selector: string;                  // CSS selector to re-find this form
  action: string;
  method: string;
  fields: FormFieldSnapshot[];
}

interface FormFieldSnapshot {
  name: string;
  type: string;
  selector: string;                  // CSS selector for this field
  required: boolean;
  label: string | null;
  placeholder: string | null;
  validation: {
    pattern?: string;
    min?: string;
    max?: string;
    minlength?: number;
    maxlength?: number;
  };
  current_value: string;
}

interface ScreenshotRef {
  path: string;                      // Relative to audit dir
  viewport: { width: number; height: number };
  purpose: 'initial_load' | 'after_interaction' | 'evidence' | 'verification';
  timestamp: string;
}

interface NetworkLogEntry {
  url: string;
  method: string;
  status: number;
  content_type: string;
  duration_ms: number;
  is_error: boolean;                 // 4xx or 5xx
}

interface ConsoleEntry {
  level: 'error' | 'warning' | 'info' | 'log';
  text: string;
  source: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Criterion Evaluation Types
// ---------------------------------------------------------------------------

/** Result of checking one acceptance criterion. */
interface CriterionResult {
  criterion_id: string;
  feature_id: string;
  status: 'pass' | 'fail' | 'cannot_evaluate';
  confidence: number;                // 0-100
  evidence_summary: string;          // One-paragraph explanation
  evidence_refs: EvidenceRef[];      // Pointers to supporting evidence
  evaluated_by: 'haiku' | 'sonnet'; // Which model evaluated
}

interface EvidenceRef {
  type: 'screenshot' | 'dom_snapshot' | 'network_log' | 'console_error' | 'form_result';
  path: string;                      // File path relative to audit dir
  excerpt?: string;                  // Relevant snippet
}

// ---------------------------------------------------------------------------
// Finding Types (V3: always linked to a criterion)
// ---------------------------------------------------------------------------

interface Finding {
  id: string;                        // "F-001-AC-01-001"
  title: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  type: 'functionality' | 'ui' | 'performance' | 'security' | 'accessibility';
  feature_id: string;                // Which PRD feature
  criterion_id: string;              // Which acceptance criterion
  url: string;                       // REQUIRED. Never "N/A".
  description: string;
  expected_behavior: string;         // From the acceptance criterion
  actual_behavior: string;           // From the collected evidence
  reproduction_steps: string[];
  evidence_chain: EvidenceRef[];     // Full chain from page visit to conclusion
  screenshot_path: string | null;    // Path to evidence screenshot
  confidence: number;                // 0-100
  phase: string;                     // Which pipeline phase discovered this
  discovered_at: string;             // ISO timestamp
  verification?: VerificationResult;
}

/** V3: Verification ONLY confirms or denies. It never creates new findings. */
interface VerificationResult {
  status: 'confirmed' | 'not_reproduced' | 'cannot_verify';
  verified_at: string;
  attempts: number;
  screenshot_path: string | null;
  notes: string;
}

// ---------------------------------------------------------------------------
// LLM Contract Types
// ---------------------------------------------------------------------------

/** Every LLM call in V3 uses this request/response wrapper. */
interface LLMRequest<TInput, TOutput> {
  phase: string;
  operation: string;
  input_schema: JSONSchema;          // Schema for TInput
  output_schema: JSONSchema;         // Schema for TOutput
  input: TInput;
  model_preference: 'haiku' | 'sonnet';
  max_tokens: number;
  temperature: number;
}

interface LLMResult<TOutput> {
  output: TOutput;
  raw_response: string;
  input_tokens: number;
  output_tokens: number;
  model_used: string;
  validation_passed: boolean;
  retry_count: number;
}

// ---------------------------------------------------------------------------
// Form Testing Types (V3: actual interaction, not just discovery)
// ---------------------------------------------------------------------------

interface FormTestPlan {
  feature_id: string;
  form_selector: string;
  url: string;
  test_cases: FormTestCase[];
}

interface FormTestCase {
  id: string;
  description: string;
  field_values: Record<string, string>;    // field name -> value to enter
  expected_outcome: 'success' | 'validation_error' | 'redirect';
  expected_validation_messages?: string[];
  expected_redirect_url?: string;
}

interface FormTestResult {
  test_case_id: string;
  status: 'pass' | 'fail' | 'error';
  actual_outcome: string;
  screenshot_before: string;
  screenshot_after: string;
  network_requests: NetworkLogEntry[];
  console_errors: ConsoleEntry[];
  notes: string;
}

// ---------------------------------------------------------------------------
// Plugin Types (V3: extensible checks)
// ---------------------------------------------------------------------------

interface CheckPlugin {
  id: string;
  name: string;
  description: string;
  /** Called once per feature to produce additional checks. */
  evaluate(
    feature: FeatureSpec,
    evidence: FeatureEvidence[],
  ): Promise<CriterionResult[]>;
}
```

---

## 4. Phase Architecture

V3 has 12 phases organized into 5 stages. Each stage must complete before the next begins. Within a stage, phases can run in parallel where indicated.

```
Stage 0: Setup
  [0] preflight              (pure-ts)

Stage 1: Analysis              (parallel)
  [1a] feature-extraction    (llm: sonnet)
  [1b] code-analysis         (pure-ts)

Stage 2: Mapping & Planning
  [2] route-mapping           (llm: haiku + pure-ts)

Stage 3: Evidence Collection   (parallel where independent)
  [3a] exploration            (browser + llm: haiku for classification)
  [3b] form-testing           (browser + llm: sonnet for evaluation)
  [3c] responsive-testing     (browser only, no LLM)

Stage 4: Evaluation & Reporting
  [4a] criteria-evaluation    (llm: sonnet)
  [4b] quality-gate           (pure-ts)
  [4c] verification           (browser + llm: sonnet)
  [4d] report-generation      (pure-ts)
  [4e] github-issues          (pure-ts)
```

### Phase Details

#### Phase 0: Preflight (pure-ts) -- KEEP from V2

No changes. Validates config, checks API key, verifies target URL is reachable.

**Input:** `AuditConfig`
**Output:** `PreflightResult { url_reachable, api_key_valid, browser_available, config_valid }`

---

#### Phase 1a: Feature Extraction (llm: sonnet) -- REWRITE

**V2 problem:** PRD parsing is pure-TS regex. It extracts headings and bullets but misses semantic meaning. It cannot distinguish a feature from a design principle or a deployment note.

**V3 approach:** Use Sonnet to extract features from the PRD with structured output. The LLM understands context: "Users can filter posts by date" is a feature; "We use React 18" is not. Each feature gets explicit acceptance criteria, even if the PRD does not state them -- the LLM infers testable criteria from the description.

**LLM Contract:**

```typescript
// Input
interface FeatureExtractionInput {
  prd_text: string;                  // Full PRD markdown
  project_url: string;               // For context
  codebase_summary?: string;         // From code-analysis if available
}

// Output (strict JSON schema)
interface FeatureExtractionOutput {
  features: Array<{
    id: string;                      // F-001, F-002, ...
    name: string;
    description: string;
    priority: 'must' | 'should' | 'could';
    acceptance_criteria: Array<{
      id: string;                    // F-001-AC-01
      text: string;
      type: 'functional' | 'visual' | 'performance' | 'accessibility';
      verifiable: boolean;
    }>;
    likely_routes: string[];         // LLM's best guess at relevant URL paths
  }>;
  out_of_scope: string[];
  deferred: string[];
  confidence_notes: string;
}
```

**Fallback:** If no PRD is provided, the LLM analyzes the codebase (route definitions, component names) to infer features. Output is the same schema but with `inferred: true` flag.

**Cost model:** One Sonnet call, ~$0.05-0.15 depending on PRD length.

---

#### Phase 1b: Code Analysis (pure-ts) -- KEEP from V2, EXTEND

Keep the existing route extraction and file analysis. Add a new output field: `route_to_component_map` that maps each discovered route to the source files that implement it. This enables Phase 2 to cross-reference PRD features with code.

**New output field:**

```typescript
interface CodeAnalysisResult {
  // ... existing fields ...
  routes: RouteDefinition[];
  route_component_map: Record<string, string[]>; // route pattern -> source file paths
  api_endpoints: APIEndpoint[];                    // discovered API routes
}
```

---

#### Phase 2: Route Mapping (llm: haiku + pure-ts) -- NEW

**Purpose:** Map each feature to the specific URLs where it can be verified. This is the critical missing link in V2.

**How it works:**

1. **Pure-TS pass:** Match feature `likely_routes` against code-analysis `routes` using pattern matching (e.g., feature mentions "profile page" and code has `/profile/:id` route).

2. **Haiku classification:** For features that did not match in step 1, send a batch to Haiku: "Given these features and these routes, which routes are relevant to each feature?" Haiku is fast and cheap for this classification task.

3. **Merge and validate:** Combine results. Every feature must have at least one mapped route. Features with zero routes get flagged as `unmappable` and are reported in the final output as coverage gaps.

**LLM Contract (Haiku):**

```typescript
// Input (batched -- up to 20 features per call)
interface RouteMappingInput {
  features: Array<{
    id: string;
    name: string;
    description: string;
    acceptance_criteria: string[];
  }>;
  available_routes: Array<{
    pattern: string;
    url: string;
    source_files: string[];
  }>;
}

// Output
interface RouteMappingOutput {
  mappings: Array<{
    feature_id: string;
    route_urls: string[];            // Ordered by relevance
    confidence: number;              // 0-100
    reasoning: string;               // One sentence
  }>;
}
```

**Cost model:** 1-3 Haiku calls at ~$0.002 each. Negligible.

---

#### Phase 3a: Exploration (browser + llm: haiku) -- REWRITE

**V2 problem:** Crawls pages, dumps data to the LLM, asks "what's wrong?" The LLM produces findings about generic issues (performance, accessibility) that have nothing to do with the PRD.

**V3 approach:** Exploration is now FEATURE-DIRECTED. Instead of blind crawling, the browser visits the specific routes mapped to each feature. For each visit, it collects structured evidence (PageSnapshot, screenshots, network log, console errors). It does NOT ask the LLM for findings -- it collects raw data for the evaluation phase.

**Haiku is used only for SPA detection:** After visiting a page, if the HTML is mostly empty (SPA shell), Haiku classifies: "Is this a client-rendered page that needs JavaScript execution time?" If yes, the browser waits for DOM stability.

**Algorithm:**

```
for each feature in feature_specs:
  for each route in feature.mapped_routes:
    page_data = browser.visitPage(route)
    screenshot = browser.screenshot()
    network_log = browser.getNetworkLog()
    console_errors = browser.getConsoleErrors()

    evidence = {
      feature_id: feature.id,
      route,
      page_snapshot: buildSnapshot(page_data),
      screenshots: [{ path: saveScreenshot(screenshot), ... }],
      network_log,
      console_errors,
    }

    feature.evidence.push(evidence)

  feature.status = 'evidence_collected'
```

**Output:** Updated `FeatureSpec[]` with populated `evidence` arrays. All evidence artifacts written to disk.

**Cost model:** Haiku calls only for SPA detection (~$0.001 per page). Browser time dominates cost.

---

#### Phase 3b: Form Testing (browser + llm: sonnet) -- REWRITE

**V2 problem:** Only discovers forms. Never fills them, never submits them, never checks results.

**V3 approach:** Three sub-steps:

1. **Plan generation (Sonnet):** For each form linked to a feature, Sonnet generates test cases based on the acceptance criteria. Example: if the criterion says "User can register with email and password", Sonnet generates test cases for valid registration, invalid email, missing password, duplicate email.

2. **Execution (Playwright):** For each test case, Playwright fills the form fields, takes a "before" screenshot, submits, waits for response, takes an "after" screenshot, captures network requests.

3. **Evaluation (Sonnet):** Sonnet receives the before/after screenshots (as text descriptions), network logs, and the expected outcome. It produces a pass/fail result with explanation.

**LLM Contract (test plan generation):**

```typescript
// Input
interface FormTestPlanInput {
  feature: {
    id: string;
    name: string;
    acceptance_criteria: string[];
  };
  form: FormSnapshot;
  page_url: string;
}

// Output
interface FormTestPlanOutput {
  test_cases: Array<{
    id: string;
    description: string;
    field_values: Record<string, string>;
    expected_outcome: 'success' | 'validation_error' | 'redirect';
    expected_validation_messages?: string[];
  }>;
}
```

**Playwright form interaction:**

```typescript
async function executeFormTest(
  browser: AuditBrowser,
  url: string,
  formSelector: string,
  testCase: FormTestCase,
): Promise<FormTestResult> {
  await browser.navigateTo(url);
  const screenshotBefore = await browser.screenshot();

  // Fill each field
  for (const [fieldName, value] of Object.entries(testCase.field_values)) {
    await browser.fillField(formSelector, fieldName, value);
  }

  // Submit
  await browser.submitForm(formSelector);
  await browser.waitForNavigation({ timeout: 10000 });

  const screenshotAfter = await browser.screenshot();
  const networkRequests = browser.getRecentNetworkRequests();
  const consoleErrors = browser.getRecentConsoleErrors();

  return {
    test_case_id: testCase.id,
    screenshot_before: saveScreenshot(screenshotBefore),
    screenshot_after: saveScreenshot(screenshotAfter),
    network_requests: networkRequests,
    console_errors: consoleErrors,
    // ... actual_outcome determined by evaluation LLM
  };
}
```

**Cost model:** 1 Sonnet call per form for test plan (~$0.03), 1 Sonnet call per form for evaluation (~$0.03). For 10 forms: ~$0.60 total.

---

#### Phase 3c: Responsive Testing (browser only) -- SIMPLIFY

**V3 change:** No LLM call needed. Pure Playwright viewport testing.

For each feature's mapped routes, test at 3 viewports (375px, 768px, 1280px). Capture screenshots. Detect overflow via JavaScript `document.body.scrollWidth > document.body.clientWidth`. Record results as evidence.

Responsive failures are surfaced during criteria evaluation (Phase 4a), not during collection.

---

#### Phase 4a: Criteria Evaluation (llm: sonnet) -- NEW (the core of V3)

**Purpose:** For each acceptance criterion on each feature, determine pass/fail using the collected evidence.

This is the phase that V2 never had. It is the heart of V3.

**How it works:**

For each feature, batch all its acceptance criteria with all its collected evidence into a single Sonnet call. The LLM receives:
- The criterion text
- The page snapshot(s) from relevant routes
- Screenshot descriptions (extracted text from screenshots)
- Network log entries (errors, slow responses)
- Console error entries
- Form test results (if applicable)

The LLM returns a `CriterionResult` for each criterion.

**LLM Contract:**

```typescript
// Input (one per feature, batched criteria)
interface CriteriaEvaluationInput {
  feature: {
    id: string;
    name: string;
    description: string;
  };
  criteria: Array<{
    id: string;
    text: string;
    type: string;
  }>;
  evidence: Array<{
    route: string;
    page_title: string;
    page_text_excerpt: string;       // First 3KB of visible text
    form_count: number;
    console_errors: string[];
    network_errors: Array<{ url: string; status: number }>;
    load_time_ms: number;
    form_test_results?: Array<{
      description: string;
      status: string;
      notes: string;
    }>;
  }>;
}

// Output (strict JSON schema, validated)
interface CriteriaEvaluationOutput {
  results: Array<{
    criterion_id: string;
    status: 'pass' | 'fail' | 'cannot_evaluate';
    confidence: number;
    evidence_summary: string;
    failure_description?: string;    // Only if status is 'fail'
    suggested_severity?: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  }>;
  feature_status: 'pass' | 'fail' | 'partial';
  notes: string;
}
```

**Batching strategy:** Group features to keep each LLM call under 30K tokens of input. Typically 3-5 features per batch depending on evidence volume.

**Cost model:** ~$0.05-0.15 per feature. For 67 features: ~$3.50-10.00. This is the most expensive phase and the most valuable.

---

#### Phase 4b: Quality Gate (pure-ts) -- REWRITE

**V2 problem:** Quality filtering runs after findings are created, as an afterthought. It catches some false positives but misses structural issues (findings with N/A URLs, positive observations, self-referential issues).

**V3 approach:** The quality gate is a hard filter between criteria evaluation and finding synthesis. No finding can exist that fails these checks:

```typescript
interface QualityGate {
  /** Checks run against every finding before it is persisted. */
  checks: QualityCheck[];
}

interface QualityCheck {
  id: string;
  name: string;
  /** Return null if the finding passes, or a rejection reason if it fails. */
  evaluate(finding: Finding): string | null;
}

// Built-in checks:

const QUALITY_CHECKS: QualityCheck[] = [
  {
    id: 'no-positive-observations',
    name: 'Reject positive observations',
    evaluate: (f) => {
      const positivePatterns = [
        /good (performance|practice|implementation)/i,
        /properly (implemented|configured|handled)/i,
        /no issues? (found|detected|observed)/i,
        /works (correctly|well|as expected)/i,
        /successfully (loads|renders|displays)/i,
      ];
      for (const pattern of positivePatterns) {
        if (pattern.test(f.title) || pattern.test(f.description)) {
          return `Positive observation: matches pattern "${pattern.source}"`;
        }
      }
      return null;
    },
  },

  {
    id: 'no-self-referential',
    name: 'Reject self-referential findings',
    evaluate: (f) => {
      const selfRefPatterns = [
        /audit (tool|agent|process)/i,
        /cannot (test|verify|check|access)/i,
        /no (accessibility|performance|security) testing/i,
        /limited (by|to|in)/i,
        /tool limitation/i,
      ];
      for (const pattern of selfRefPatterns) {
        if (pattern.test(f.title) || pattern.test(f.description)) {
          return `Self-referential: matches "${pattern.source}"`;
        }
      }
      return null;
    },
  },

  {
    id: 'require-valid-url',
    name: 'Require valid URL (not N/A)',
    evaluate: (f) => {
      if (!f.url || f.url === 'N/A' || f.url === 'n/a' || f.url === '') {
        return 'Finding has no valid URL';
      }
      try {
        new URL(f.url);
        return null;
      } catch {
        return `Invalid URL: "${f.url}"`;
      }
    },
  },

  {
    id: 'require-criterion-link',
    name: 'Require link to acceptance criterion',
    evaluate: (f) => {
      if (!f.criterion_id || f.criterion_id === '') {
        return 'Finding is not linked to any acceptance criterion';
      }
      return null;
    },
  },

  {
    id: 'require-evidence',
    name: 'Require at least one evidence reference',
    evaluate: (f) => {
      if (!f.evidence_chain || f.evidence_chain.length === 0) {
        return 'Finding has no evidence references';
      }
      return null;
    },
  },

  {
    id: 'minimum-confidence',
    name: 'Require minimum confidence score',
    evaluate: (f) => {
      if (f.confidence < 40) {
        return `Confidence ${f.confidence} is below minimum threshold of 40`;
      }
      return null;
    },
  },

  {
    id: 'no-vague-descriptions',
    name: 'Reject vague descriptions',
    evaluate: (f) => {
      const vaguePatterns = [
        /^minimal (functionality|content|features)/i,
        /^basic (implementation|functionality)/i,
        /^(could|might|may) (benefit|improve)/i,
        /^consider (adding|implementing)/i,
      ];
      for (const pattern of vaguePatterns) {
        if (pattern.test(f.description)) {
          return `Vague description: matches "${pattern.source}"`;
        }
      }
      return null;
    },
  },
];
```

Findings that fail any check are written to `filtered-findings/` with the rejection reason but are NOT included in the report or GitHub issues.

---

#### Phase 4c: Verification (browser + llm: sonnet) -- REWRITE

**V2 problem:** Verification creates NEW findings instead of verifying existing ones. It also fails on findings with N/A URLs.

**V3 approach:** Verification has exactly one job: independently confirm or deny each existing finding.

**Algorithm:**

```
for each finding in quality_gated_findings:
  // Visit the finding's URL fresh (new browser context, no cache)
  page = browser.visitPage(finding.url, { fresh_context: true })
  screenshot = browser.screenshot()

  // Send to Sonnet for independent evaluation
  result = llm.evaluate({
    finding_title: finding.title,
    finding_description: finding.description,
    expected_behavior: finding.expected_behavior,
    actual_behavior: finding.actual_behavior,
    reproduction_steps: finding.reproduction_steps,
    current_page_data: {
      text: page.text,
      console_errors: page.consoleErrors,
      network_errors: page.networkErrors,
    },
  })

  // Result is ONLY: confirmed | not_reproduced | cannot_verify
  // NEVER a new finding.
  finding.verification = {
    status: result.status,
    screenshot_path: saveScreenshot(screenshot),
    attempts: 1,
    notes: result.notes,
  }
```

**LLM Contract:**

```typescript
// Input
interface VerificationInput {
  finding: {
    title: string;
    description: string;
    expected_behavior: string;
    actual_behavior: string;
    reproduction_steps: string[];
  };
  current_page: {
    url: string;
    text_excerpt: string;
    console_errors: string[];
    network_errors: Array<{ url: string; status: number }>;
    form_count: number;
  };
}

// Output (strict -- no other fields allowed)
interface VerificationOutput {
  status: 'confirmed' | 'not_reproduced' | 'cannot_verify';
  confidence: number;
  notes: string;
}
```

Findings that are `not_reproduced` are downgraded: their confidence is halved and they are flagged in the report. They are NOT deleted (the evidence chain is preserved), but they do not generate GitHub issues unless `--include-unverified` is passed.

---

#### Phase 4d: Report Generation (pure-ts) -- REWRITE

**V3 change:** The report is organized by feature, not by severity.

**Report structure:**

```markdown
# Audit Report: {project_name}

## Executive Summary
- Features tested: 67
- Features passing: 48 (72%)
- Features failing: 15 (22%)
- Features partial: 4 (6%)
- Total findings: 23
- Critical (P0/P1): 5
- Verified: 18 (78%)

## Feature Coverage Matrix

| Feature | Priority | Status | Criteria | Pass | Fail | Findings |
|---------|----------|--------|----------|------|------|----------|
| F-001: User Registration | must | FAIL | 5 | 3 | 2 | F-001-AC-02-001, F-001-AC-04-001 |
| F-002: Login | must | PASS | 3 | 3 | 0 | - |
| ... |

## Findings by Feature

### F-001: User Registration

#### F-001-AC-02-001: Email validation missing (P1)
**Criterion:** F-001-AC-02: "Email format is validated before submission"
**Expected:** Invalid emails are rejected with a clear error message
**Actual:** Form accepts any string as email, including "not-an-email"
**Evidence:**
- Screenshot: `screenshots/F-001-AC-02-evidence.png`
- Network: POST /api/register returned 500 with invalid email
- Console: TypeError: Cannot read property 'split' of undefined
**Verification:** Confirmed (2026-02-08)
**Reproduction:**
1. Navigate to /register
2. Enter "not-an-email" in the email field
3. Click Submit
4. Observe: form submits, server returns 500

### ...

## Uncovered Features
Features that could not be mapped to any route:
- F-045: "Email notifications for new followers" (no routes found)
- F-062: "Export data as CSV" (no routes found)

## Pages Explored
| URL | Title | Load Time | Console Errors | Features Tested |
| ... |

## Form Test Results
| Form | URL | Test Cases | Pass | Fail |
| ... |
```

---

#### Phase 4e: GitHub Issues (pure-ts) -- EXTEND

Same as V2 but with richer issue bodies that include:
- The acceptance criterion text
- The evidence chain summary
- Screenshot attachment (uploaded via `gh` CLI)
- Verification status
- Label: `audit-finding`, severity label (`P0`, `P1`, etc.), feature label

---

## 5. Data Flow Diagram

```
                            config.yml + CLI args
                                    |
                                    v
                            +---------------+
                            |   Preflight   |  (Stage 0)
                            +-------+-------+
                                    |
                       +------------+------------+
                       |                         |
                       v                         v
              +--------+--------+       +--------+--------+
              | Feature Extract |       | Code Analysis   |  (Stage 1, parallel)
              | (Sonnet)        |       | (pure-ts)       |
              +--------+--------+       +--------+--------+
                       |                         |
                       +------------+------------+
                                    |
                                    v
                           +--------+--------+
                           | Route Mapping   |  (Stage 2)
                           | (Haiku + TS)    |
                           +--------+--------+
                                    |
                                    |  FeatureSpec[] with mapped_routes
                                    |
                  +-----------------+-----------------+
                  |                 |                 |
                  v                 v                 v
         +--------+------+  +------+-------+  +------+--------+
         | Exploration   |  | Form Testing |  | Responsive    |  (Stage 3, parallel)
         | (browser)     |  | (browser+LLM)|  | (browser)     |
         +--------+------+  +------+-------+  +------+--------+
                  |                 |                 |
                  +-----------------+-----------------+
                                    |
                                    |  FeatureSpec[] with evidence[]
                                    |
                                    v
                         +----------+-----------+
                         | Criteria Evaluation  |  (Stage 4a)
                         | (Sonnet, batched)    |
                         +----------+-----------+
                                    |
                                    |  CriterionResult[] -> Finding[]
                                    |
                                    v
                         +----------+-----------+
                         | Quality Gate         |  (Stage 4b)
                         | (pure-ts, hard filter|
                         +----------+-----------+
                                    |
                                    |  Finding[] (filtered)
                                    |
                                    v
                         +----------+-----------+
                         | Verification         |  (Stage 4c)
                         | (browser + Sonnet)   |
                         +----------+-----------+
                                    |
                                    |  VerifiedFinding[]
                                    |
                       +------------+------------+
                       |                         |
                       v                         v
              +--------+--------+       +--------+--------+
              | Report Gen      |       | GitHub Issues   |  (Stage 4d-e)
              | (pure-ts)       |       | (pure-ts + gh)  |
              +--------+--------+       +--------+--------+
                       |                         |
                       v                         v
                   report.md              GitHub Issues
                   dashboard.html         with screenshots
```

---

## 6. Artifact Directory Structure

```
.complete-agent/audits/current/
  config.json                          # Resolved audit config
  progress.json                        # Live progress tracking
  checkpoint.json                      # Resume state

  features/
    feature-specs.json                 # All features after extraction
    route-mappings.json                # Feature -> route mappings
    feature-status.json                # Live status of each feature

  evidence/
    F-001/
      route-1-snapshot.json            # PageSnapshot for first mapped route
      route-1-network.json             # Network log
      route-1-console.json             # Console errors
      route-2-snapshot.json
      ...
    F-002/
      ...

  screenshots/
    F-001-route-1-desktop.png
    F-001-route-1-mobile.png
    F-001-route-1-tablet.png
    F-001-AC-02-evidence.png           # Evidence screenshot for a finding
    F-001-AC-02-verify.png             # Verification screenshot
    ...

  forms/
    form-test-plans.json               # Generated test plans
    form-test-results.json             # Execution results

  evaluation/
    criteria-results.json              # All CriterionResult records
    evaluation-log.jsonl               # LLM call log for auditing

  findings/
    F-001-AC-02-001.json               # Finding linked to feature + criterion
    F-003-AC-01-001.json
    ...

  filtered-findings/
    rejected-001.json                  # Findings rejected by quality gate
    ...

  quality-report.json                  # Quality gate summary

  report.md                            # Final markdown report
  dashboard.html                       # Static HTML dashboard
  metrics.json                         # Cost, duration, token usage
  audit-log.jsonl                      # Action log

  created-issues.json                  # GitHub issue references
```

---

## 7. LLM Call Strategy

### Model Selection

| Task | Model | Rationale | Estimated Cost |
|------|-------|-----------|---------------|
| Feature extraction from PRD | Sonnet | Requires deep comprehension | $0.05-0.15 |
| Route-to-feature mapping | Haiku | Simple classification task | $0.002-0.006 |
| SPA detection | Haiku | Binary classification | $0.001 per page |
| Form test plan generation | Sonnet | Needs creativity + domain knowledge | $0.03 per form |
| Criteria evaluation | Sonnet | Core judgment, highest quality needed | $0.05-0.15 per feature |
| Form test evaluation | Sonnet | Needs to interpret before/after state | $0.03 per form |
| Verification | Sonnet | Must independently confirm findings | $0.03 per finding |

**Total estimated cost for a 67-feature, 25-page audit:** $4-8 (vs. $0.44 in V2, which did not actually check features).

### Structured Output Enforcement

Every LLM call in V3 follows this pattern:

```typescript
async function callLLM<TInput, TOutput>(
  request: LLMRequest<TInput, TOutput>,
  llmClient: LLMClient,
): Promise<LLMResult<TOutput>> {
  const MAX_RETRIES = 2;

  // Build prompt with embedded schema
  const prompt = buildSchemaPrompt(request);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const model = request.model_preference === 'haiku'
      ? 'claude-haiku-4-5-20251001'
      : 'claude-sonnet-4-5-20250929';

    const response = await llmClient.complete(prompt, {
      model,
      maxTokens: request.max_tokens,
      temperature: request.temperature,
      responseFormat: 'json',
    });

    // Validate against output schema
    const validation = validateAgainstSchema(response.content, request.output_schema);

    if (validation.valid) {
      return {
        output: validation.data as TOutput,
        raw_response: response.content,
        input_tokens: response.inputTokens,
        output_tokens: response.outputTokens,
        model_used: response.model,
        validation_passed: true,
        retry_count: attempt,
      };
    }

    // On validation failure, retry with error feedback
    if (attempt < MAX_RETRIES) {
      prompt = buildRetryPrompt(request, response.content, validation.errors);
      console.warn(
        `[LLM] Retry ${attempt + 1}/${MAX_RETRIES} for ${request.phase}/${request.operation}: ${validation.errors[0]}`
      );
    }
  }

  throw new Error(
    `LLM output failed schema validation after ${MAX_RETRIES + 1} attempts for ${request.phase}/${request.operation}`
  );
}

function buildSchemaPrompt<TInput, TOutput>(
  request: LLMRequest<TInput, TOutput>,
): string {
  return `You are analyzing a web application as part of a PRD completion audit.

## Task: ${request.operation}

## Input Data

\`\`\`json
${JSON.stringify(request.input, null, 2)}
\`\`\`

## Required Output Schema

Your response MUST be valid JSON matching this exact schema:

\`\`\`json
${JSON.stringify(request.output_schema, null, 2)}
\`\`\`

## Rules
- Return ONLY valid JSON. No markdown fences, no explanatory text.
- Every required field must be present.
- Do NOT include positive observations. Only report issues.
- Do NOT report tool limitations as findings.
- Every finding must have a valid URL (not "N/A").
- Be specific: cite exact text, exact selectors, exact error messages.`;
}
```

---

## 8. Progress Tracking

V3 progress tracking matches the actual pipeline phases. No more mismatched stage names.

```typescript
interface AuditProgress {
  schema_version: '3.0';
  audit_id: string;
  started_at: string;
  status: 'running' | 'completed' | 'failed';
  current_stage: string;

  stages: {
    preflight:           StageProgress;
    feature_extraction:  StageProgress;
    code_analysis:       StageProgress;
    route_mapping:       StageProgress;
    exploration:         StageProgress;
    form_testing:        StageProgress;
    responsive_testing:  StageProgress;
    criteria_evaluation: StageProgress;
    quality_gate:        StageProgress;
    verification:        StageProgress;
    report_generation:   StageProgress;
    github_issues:       StageProgress;
  };

  metrics: {
    features_total: number;
    features_tested: number;
    features_passing: number;
    features_failing: number;
    criteria_total: number;
    criteria_evaluated: number;
    pages_visited: number;
    forms_tested: number;
    findings_total: number;
    findings_verified: number;
    findings_by_severity: Record<string, number>;
    cost_usd: number;
    tokens_input: number;
    tokens_output: number;
  };
}

interface StageProgress {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  started_at: string | null;
  completed_at: string | null;
  progress_percent: number;
  current_action: string | null;     // "Evaluating F-032: Password Reset"
  items_processed: number;
  items_total: number;
}
```

---

## 9. CI/CD Integration

### GitHub Action

```yaml
# .github/workflows/completion-audit.yml
name: PRD Completion Audit

on:
  pull_request:
    types: [opened, synchronize]
  workflow_dispatch:
    inputs:
      severity_threshold:
        description: 'Minimum severity to block merge (P0, P1, P2, P3, P4)'
        default: 'P1'

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Start preview deployment
        id: deploy
        run: |
          # Your deployment step here
          echo "url=https://preview-${{ github.event.pull_request.number }}.your-app.dev" >> $GITHUB_OUTPUT

      - name: Run completion audit
        id: audit
        uses: paulrbrown/audit-agent@v3
        with:
          url: ${{ steps.deploy.outputs.url }}
          prd: docs/prd.md
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          severity-threshold: ${{ inputs.severity_threshold || 'P1' }}
          max-budget-usd: '10'

      - name: Post PR comment
        if: always()
        uses: actions/github-script@v7
        with:
          script: |
            const report = require('./audit-report.json');
            const body = formatPRComment(report);
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body,
            });

      - name: Check severity threshold
        if: steps.audit.outputs.has-blocking-findings == 'true'
        run: exit 1
```

### PR Comment Format

```markdown
## PRD Completion Audit

**Feature coverage:** 48/67 (72%) passing

### Blocking Findings (P0/P1)
| Finding | Feature | Severity | Status |
|---------|---------|----------|--------|
| Email validation missing | User Registration | P1 | Verified |
| Profile page 500 error | User Profile | P0 | Verified |

### Summary
- 23 findings total (5 critical, 12 medium, 6 low)
- 18/23 verified (78%)
- Full report: [audit-report.md](link)
```

---

## 10. Plugin Architecture

V3 supports custom check plugins for project-specific concerns. Plugins run during the criteria evaluation phase and can add additional CriterionResults.

```typescript
// plugins/api-json-check.ts
import type { CheckPlugin, FeatureSpec, FeatureEvidence, CriterionResult } from '../types';

export const apiJsonCheck: CheckPlugin = {
  id: 'api-json-check',
  name: 'API JSON Response Check',
  description: 'Verify all API endpoints return valid JSON with correct content-type',

  async evaluate(
    feature: FeatureSpec,
    evidence: FeatureEvidence[],
  ): Promise<CriterionResult[]> {
    const results: CriterionResult[] = [];

    for (const ev of evidence) {
      const apiRequests = ev.network_log.filter(
        (r) => r.url.includes('/api/') && r.status < 400,
      );

      for (const req of apiRequests) {
        if (!req.content_type.includes('application/json')) {
          results.push({
            criterion_id: `${feature.id}-plugin-api-json`,
            feature_id: feature.id,
            status: 'fail',
            confidence: 95,
            evidence_summary: `API endpoint ${req.url} returns content-type "${req.content_type}" instead of "application/json"`,
            evidence_refs: [{
              type: 'network_log',
              path: `evidence/${feature.id}/network.json`,
              excerpt: JSON.stringify(req),
            }],
            evaluated_by: 'haiku',    // Plugin-generated, no LLM needed
          });
        }
      }
    }

    return results;
  },
};
```

**Plugin loading:**

```yaml
# .complete-agent/config.yml
plugins:
  - ./plugins/api-json-check.ts
  - ./plugins/wcag-contrast-check.ts
  - npm:audit-agent-plugin-lighthouse
```

---

## 11. Module Structure (V3)

```
project-completion-agent/
  src/
    cli.ts                           # CLI entry point (SIMPLIFY)
    config.ts                        # Configuration builder (KEEP)
    orchestrator.ts                  # Pipeline coordinator (REWRITE: stage-based)

    llm/
      anthropic-client.ts            # KEEP: Anthropic SDK wrapper
      prompt-loader.ts               # KEEP: Template loading
      schema-validator.ts            # EXTEND: AJV validation with retry protocol
      llm-caller.ts                  # NEW: Typed callLLM<TInput, TOutput> wrapper
      cost-tracker.ts                # KEEP: Token/cost accumulation

    browser/
      playwright-browser.ts          # KEEP + EXTEND: form interaction methods
      spa-handler.ts                 # KEEP
      auth-handler.ts                # KEEP
      route-crawler.ts               # KEEP (used as fallback for unmapped routes)
      screenshot-capture.ts          # KEEP

    phases/
      preflight.ts                   # KEEP (pure-ts)
      feature-extraction.ts          # NEW: LLM-driven feature parsing (replaces prd-parsing.ts)
      code-analysis.ts               # KEEP + EXTEND: route_component_map output
      route-mapping.ts               # NEW: Feature-to-route mapping
      exploration.ts                 # REWRITE: Feature-directed, evidence collection only
      form-testing.ts                # REWRITE: Plan + execute + evaluate
      responsive-testing.ts          # SIMPLIFY: Browser-only, no LLM
      criteria-evaluation.ts         # NEW: Core evaluation phase
      quality-gate.ts                # NEW: Hard filter (replaces finding-quality-pipeline.ts)
      verification.ts                # REWRITE: Confirm/deny only, no new findings
      report-generation.ts           # REWRITE: Feature-organized report
      github-issues.ts               # KEEP + EXTEND: Screenshot uploads

    pipeline/
      phase-registry.ts              # REWRITE: New phase names and types
      phase-dispatcher.ts            # SIMPLIFY: Stage-based dispatch
      phase-init.ts                  # SIMPLIFY: Fewer handler types
      job-runner.ts                  # KEEP: Parallel execution
      checkpoint-manager.ts          # KEEP

    storage/
      artifact-store.ts              # KEEP
      artifact-paths.ts              # EXTEND: New directory structure
      feature-store.ts               # NEW: Feature CRUD, status tracking
      evidence-store.ts              # NEW: Evidence write/read per feature

    plugins/
      plugin-loader.ts               # NEW: Dynamic plugin loading
      plugin-runner.ts               # NEW: Plugin execution during evaluation

    reporting/
      dashboard-writer.ts            # KEEP
      report-writer.ts               # REWRITE: Feature-organized markdown
      github-formatter.ts            # EXTEND: Richer issue bodies

  prompts/                           # KEEP structure, UPDATE content
    feature-extraction.md            # NEW: Replace phase-1-prd-parsing.md
    route-mapping.md                 # NEW
    criteria-evaluation.md           # NEW
    form-test-planning.md            # NEW
    form-test-evaluation.md          # NEW
    verification.md                  # REWRITE: Confirm/deny only
    # Legacy prompts archived to prompts/v2/

  schemas/
    feature-spec.schema.json         # NEW
    criterion-result.schema.json     # NEW
    finding-v3.schema.json           # NEW
    verification-result.schema.json  # NEW
    route-mapping.schema.json        # NEW
    form-test-plan.schema.json       # NEW
    # ... keep existing schemas for backwards compat

  tests/
    unit/
      feature-extraction.test.ts     # NEW
      route-mapping.test.ts          # NEW
      criteria-evaluation.test.ts    # NEW
      quality-gate.test.ts           # NEW
      form-testing.test.ts           # NEW
      verification.test.ts           # NEW
      # ... keep existing tests
    integration/
      feature-pipeline-e2e.test.ts   # NEW: Full feature-first pipeline
    fixtures/
      sample-prd-features.json       # NEW
      sample-evidence.json           # NEW
      sample-criterion-results.json  # NEW
```

### File Count

| Category | V2 | V3 | Delta |
|----------|----|----|-------|
| Core src/ | 28 | 35 | +7 new, 6 rewritten |
| Prompts | 15 | 12 | -3 legacy, +6 new (net: -3) |
| Schemas | 11 | 17 | +6 new |
| Tests | 40 | 48 | +8 new |
| **Total** | **~94** | **~112** | **+18** |

---

## 12. Migration Path: V2 to V3

V3 is designed for incremental migration. The phases can be swapped one at a time while the rest of the pipeline continues using V2 logic.

### Phase 1: Feature Extraction (Week 1)

1. Create `src/phases/feature-extraction.ts` alongside existing `prd-parsing.ts`
2. Add `feature-extraction` to the phase registry with the new LLM contract
3. Keep `prd-parsing.ts` as fallback (used when no API key is available)
4. Output: `features/feature-specs.json` written to artifact directory
5. **Test:** Run both parsers on the same PRD, compare feature count and quality

### Phase 2: Route Mapping (Week 1-2)

1. Create `src/phases/route-mapping.ts`
2. Wire it to consume `feature-specs.json` and `code-analysis.json`
3. Output: `features/route-mappings.json`
4. **Test:** For socials.paulrbrown.org, verify that "Post Creation" maps to `/compose` and "Profile" maps to `/profile/:id`

### Phase 3: Feature-Directed Exploration (Week 2)

1. Modify `collectExplorationData` to accept `FeatureSpec[]` and visit mapped routes instead of blind crawling
2. Store evidence per feature in `evidence/{feature_id}/`
3. Keep blind crawling as fallback for routes not mapped to any feature
4. **Test:** Exploration visits at least one route per feature

### Phase 4: Criteria Evaluation (Week 3)

1. Create `src/phases/criteria-evaluation.ts` -- the new core phase
2. Wire it to read features + evidence, call Sonnet, produce CriterionResults
3. Synthesize findings from failed criteria
4. **Test:** Run evaluation on fixture data, verify pass/fail accuracy

### Phase 5: Quality Gate + Verification Fix (Week 3-4)

1. Replace `finding-quality-pipeline.ts` with `quality-gate.ts`
2. Fix verification to ONLY confirm/deny (hard-coded constraint: no new findings)
3. **Test:** Feed verification a finding with N/A URL, verify it is skipped not crashed

### Phase 6: Report + Issues (Week 4)

1. Rewrite `report-generation.ts` for feature-organized output
2. Extend `github-issues.ts` with screenshot uploads and criterion links
3. **Test:** Generate report for the socials.paulrbrown.org audit data, verify feature coverage matrix

### Backwards Compatibility

During migration, a `V3_FEATURE_PIPELINE=true` environment variable enables the new phases. When false, the V2 pipeline runs unchanged. This allows A/B testing the same audit with both pipelines.

---

## 13. Configuration Schema (V3)

```yaml
# .complete-agent/config.yml
version: "3.0"

# Target application
target:
  url: "http://localhost:3000"
  codebase_path: "."
  prd_path: "docs/prd.md"

# Authentication (unchanged from V2)
auth:
  strategy: "form-login"
  login_url: "/login"
  credentials:
    username: "${AUTH_USERNAME}"
    password: "${AUTH_PASSWORD}"
  success_indicator: "/dashboard"

# LLM settings (V3: model routing)
llm:
  analysis_model: "claude-sonnet-4-5-20250929"    # For deep analysis
  classification_model: "claude-haiku-4-5-20251001"  # For classification tasks
  max_budget_usd: 10.0
  max_phase_budget_usd: 3.0
  temperature: 0

# Browser settings (unchanged)
browser:
  headless: true
  timeout_ms: 30000
  screenshots: true
  spa_strategy: "domstable"

# Feature pipeline (V3)
features:
  min_confidence: 40            # Minimum confidence for findings
  require_verification: true    # Only report verified findings
  include_coverage_gaps: true   # Report unmappable features
  max_criteria_per_batch: 20    # LLM batching limit

# Exploration limits
exploration:
  max_pages: 50
  max_per_feature: 5           # Max pages to visit per feature
  fallback_crawl: true         # Blind-crawl routes not mapped to features

# Form testing (V3)
form_testing:
  enabled: true
  max_forms: 20
  max_test_cases_per_form: 5
  submit_forms: true            # Actually submit (vs. just fill)
  safe_mode: auto               # auto | true | false

# Responsive testing
responsive:
  viewports: [375, 768, 1280]

# Reporting
reporting:
  create_github_issues: true
  min_severity: "P2"
  skip_unverified: true
  upload_screenshots: true

# Plugins (V3)
plugins: []
  # - ./plugins/api-json-check.ts
  # - ./plugins/wcag-contrast-check.ts
```

---

## 14. Cost Comparison: V2 vs V3

**Scenario:** 67-feature PRD, 25-page application, 15 findings.

| Phase | V2 Cost | V3 Cost | Notes |
|-------|---------|---------|-------|
| PRD Parsing | $0.00 | $0.10 | V3 uses Sonnet for semantic extraction |
| Code Analysis | $0.00 | $0.00 | Pure TS in both |
| Route Mapping | N/A | $0.01 | Haiku classification |
| Exploration | $0.12 | $0.03 | V3: Haiku for SPA detection only |
| Form Testing | $0.08 | $0.60 | V3: Actually tests forms (plan + execute + evaluate) |
| Responsive | $0.06 | $0.00 | V3: No LLM needed |
| Criteria Evaluation | N/A | $3.50 | V3: The core value -- checking every criterion |
| Finding Quality | $0.00 | $0.00 | Pure TS in both |
| Verification | $0.10 | $0.45 | V3: Independent re-confirmation |
| Reporting | $0.00 | $0.00 | Pure TS in both |
| Interactive Review | $0.08 | $0.00 | V3: Removed (replaced by quality gate) |
| **Total** | **$0.44** | **~$4.69** | **10x cost, 100x value** |

The cost increase is justified: V2 spent $0.44 and checked zero features. V3 spends ~$5 and checks all 67 features against their acceptance criteria. The delta between "$0.44 for noise" and "$5 for signal" is not a cost increase -- it is the difference between a broken tool and a working one.

---

## 15. Key Architectural Decisions

### D1: Why features, not pages

Pages are implementation details. Features are what the user cares about. A feature may span multiple pages (e.g., "User Registration" involves `/register`, `/verify-email`, and `/login`). A page may serve multiple features (e.g., `/dashboard` contains elements for "View Posts", "Create Post", and "User Profile"). Organizing by pages means you cannot answer "is Feature X complete?" without manually cross-referencing. Organizing by features makes this the default output.

### D2: Why two models (Haiku + Sonnet)

Classification tasks (route mapping, SPA detection) do not need Sonnet's depth. Using Haiku for these reduces cost by 10x with no quality loss. Sonnet is reserved for tasks requiring judgment: feature extraction, criteria evaluation, and verification. This tiered approach keeps the total cost under $10 for a full audit while maintaining quality where it matters.

### D3: Why a hard quality gate instead of post-hoc filtering

V2's approach of "generate findings, then filter bad ones" is backwards. It wastes LLM tokens generating findings that should never exist. V3's quality gate is structural: findings cannot be persisted without passing all checks. This is the same principle as type checking -- catch errors at the boundary, not in production.

### D4: Why verification must not create findings

Verification's job is to increase confidence in existing findings by independently re-testing them. If verification discovers new issues, those issues were missed by the evaluation phase -- which means the evaluation phase needs fixing, not that verification should fill the gap. Allowing verification to create findings creates a feedback loop where the tool "discovers" issues by running the same analysis twice with different prompts. This is how V2 ended up with duplicate and contradictory findings.

### D5: Why no interactive review phase

V2 has an "interactive review" phase where the LLM mediates between the user and the findings. This is unnecessary complexity. The quality gate and verification phases ensure finding quality. The report presents findings clearly. The user reviews the report and decides which issues to file. Adding an LLM-mediated review step between "here are the findings" and "create GitHub issues" adds cost and latency without adding value. Users who want to filter findings before issue creation can use `--min-severity P1` or edit the findings JSON directly.

### D6: Why structured LLM contracts with retry

Free-form LLM output (V2's approach) requires fragile regex parsing and produces inconsistent results. Structured contracts with JSON schemas allow:
- **Validation:** Reject malformed output immediately
- **Retry:** Re-prompt with the schema and the validation error
- **Testing:** Mock LLM calls with fixture data that matches the schema
- **Composability:** One phase's output is another phase's input, both typed

The retry cost is minimal (most calls succeed on first attempt) and the reliability improvement is dramatic.

---

## 16. What Success Looks Like

A developer runs `npx audit-agent audit` on their staging deployment. 20 minutes later:

1. **Feature coverage matrix:** 48/67 features passing, 15 failing, 4 partial.
2. **23 findings:** Each linked to a specific acceptance criterion, with a screenshot, reproduction steps, and a verified status.
3. **0 false positives:** No "good performance" observations, no tool limitations, no N/A URLs.
4. **GitHub issues:** 17 issues created (6 unverified findings excluded by default), each with a screenshot attachment and the acceptance criterion in the description.
5. **PR comment:** "72% feature coverage. 5 blocking findings (P0/P1). See full report."

The developer reads the report organized by feature, not by a wall of unsorted findings. They can see instantly that "User Registration" has 2 failing criteria and "Password Reset" is untested because no route was found. They fix the 5 blocking issues, run the audit again, and the score moves to 82%. They ship.

That is the tool V3 builds.

---

## Appendix A: Prompt Templates (V3)

### feature-extraction.md

```markdown
You are analyzing a Product Requirements Document (PRD) for a web application.

Extract every user-facing feature and its acceptance criteria. A feature is
something a user can do or see. Infrastructure details (hosting, database
schema, CI/CD) are NOT features.

For each feature:
1. Assign a unique ID (F-001, F-002, ...)
2. Write a clear name
3. Write a one-sentence description
4. Assign priority: must (required for launch), should (important), could (nice to have)
5. Extract acceptance criteria. If the PRD does not state explicit criteria,
   infer testable criteria from the description. Each criterion should be
   verifiable by visiting the application in a browser.
6. Guess which URL paths this feature likely lives on (e.g., /register, /profile)

## PRD Document

{{prd_text}}

## Output Schema

Return a JSON object with this structure:

{
  "features": [
    {
      "id": "F-001",
      "name": "Feature name",
      "description": "One sentence",
      "priority": "must|should|could",
      "acceptance_criteria": [
        {
          "id": "F-001-AC-01",
          "text": "Testable criterion",
          "type": "functional|visual|performance|accessibility",
          "verifiable": true
        }
      ],
      "likely_routes": ["/register", "/signup"]
    }
  ],
  "out_of_scope": ["item 1", "item 2"],
  "deferred": ["item 1"],
  "confidence_notes": "Any notes about ambiguous features"
}
```

### criteria-evaluation.md

```markdown
You are evaluating whether a web application meets its PRD acceptance criteria.

You will receive:
1. A feature with its acceptance criteria
2. Evidence collected from visiting the application (page text, console errors,
   network errors, form test results)

For each acceptance criterion, determine:
- PASS: The evidence shows the criterion is met
- FAIL: The evidence shows the criterion is NOT met
- CANNOT_EVALUATE: Not enough evidence to determine

Be strict. "Pass" means clear evidence of the criterion being met. Absence
of evidence is NOT evidence of passing -- it is "cannot_evaluate".

## Feature

{{feature}}

## Evidence

{{evidence}}

## Output Schema

{
  "results": [
    {
      "criterion_id": "F-001-AC-01",
      "status": "pass|fail|cannot_evaluate",
      "confidence": 85,
      "evidence_summary": "Paragraph explaining the evidence",
      "failure_description": "Only if status is fail",
      "suggested_severity": "P0|P1|P2|P3|P4"
    }
  ],
  "feature_status": "pass|fail|partial",
  "notes": "Any additional context"
}
```

---

## Appendix B: Quality Gate Implementation Checklist

When implementing the quality gate, verify these behaviors with unit tests:

- [ ] Positive observation titles are rejected ("Good performance", "Works correctly")
- [ ] Self-referential findings are rejected ("Cannot test accessibility")
- [ ] Findings with URL "N/A" are rejected
- [ ] Findings with empty evidence chain are rejected
- [ ] Findings with confidence < 40 are rejected
- [ ] Findings without criterion link are rejected
- [ ] Vague descriptions are rejected ("Minimal functionality", "Basic implementation")
- [ ] Valid findings with evidence, URL, criterion link, and confidence >= 40 pass through
- [ ] Rejected findings are written to `filtered-findings/` with rejection reason
- [ ] Quality report summarizes: total raw, total rejected, rejection reasons breakdown

---

## Appendix C: V2 -> V3 Phase Name Mapping

| V2 Phase Name | V3 Phase Name | Change |
|---------------|---------------|--------|
| preflight | preflight | Unchanged |
| prd-parsing | feature-extraction | Renamed, rewritten to use LLM |
| code-analysis | code-analysis | Extended with route_component_map |
| progress-init | (merged into orchestrator) | Progress init is now inline |
| safety | (merged into preflight) | Safety checks moved to preflight |
| exploration | exploration | Rewritten: feature-directed |
| form-testing | form-testing | Rewritten: plan+execute+evaluate |
| responsive-testing | responsive-testing | Simplified: browser-only |
| finding-quality | quality-gate | Renamed, rewritten as hard filter |
| reporting | report-generation | Rewritten: feature-organized |
| interactive-review | (removed) | Replaced by quality gate |
| github-issues | github-issues | Extended with screenshots |
| verification | verification | Rewritten: confirm/deny only |
| polish | (removed) | Cleanup moved to orchestrator teardown |

---

## Appendix D: Environment Variables (V3)

| Variable | Purpose | Default |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | **Required.** API key for Claude API calls. | none |
| `AUDIT_URL` | Target application URL | none |
| `AUDIT_CODEBASE_PATH` | Path to source code | current directory |
| `AUDIT_PRD_PATH` | Path to PRD document | none |
| `AUDIT_MAX_BUDGET` | Total budget cap (USD) | 10 |
| `AUDIT_ANALYSIS_MODEL` | Sonnet model for deep analysis | claude-sonnet-4-5-20250929 |
| `AUDIT_CLASSIFICATION_MODEL` | Haiku model for classification | claude-haiku-4-5-20251001 |
| `AUDIT_MIN_CONFIDENCE` | Minimum finding confidence | 40 |
| `AUDIT_REQUIRE_VERIFICATION` | Only report verified findings | true |
| `V3_FEATURE_PIPELINE` | Enable V3 pipeline (migration) | true |
| `CI` | Enables non-interactive mode | unset |
| `AUTH_USERNAME` | Login credentials | unset |
| `AUTH_PASSWORD` | Login credentials | unset |
