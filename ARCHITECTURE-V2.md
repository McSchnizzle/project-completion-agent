# ARCHITECTURE-V2: Project Completion Agent

**Version:** 2.0
**Date:** 2026-02-08
**Status:** Proposed
**Author:** Vision Architect

---

## 1. Executive Summary

The Project Completion Agent is a developer tool that audits running web applications against their PRDs to find, verify, and report the "last 25%" of incomplete work. It reads your codebase, reads your PRD, visits your running application in a real browser, and produces a prioritized list of findings as GitHub issues. V2 solves the critical blocker (Claude subprocess hanging inside Claude Code sessions), replaces the broken LLM execution layer with the Anthropic TypeScript SDK, makes Playwright the primary browser backend, and restructures the tool to run as a standalone CLI, a CI pipeline step, or a GitHub Action. The phase prompts and TypeScript infrastructure from v1 are preserved; the execution spine is rebuilt.

---

## 2. Product Form Factor

### Primary: Standalone CLI (`npx audit-agent`)

**Rationale:** The tool takes 10-60 minutes to run. No developer wants to babysit a terminal for that long, but every developer knows how to run a CLI command and come back when it finishes. A CLI is the lowest-friction form factor that supports all execution contexts: local development, CI pipelines, and remote servers.

```bash
# Local usage
npx audit-agent audit --url http://localhost:3000 --prd docs/prd.md

# CI usage (GitHub Action wraps this)
npx audit-agent audit --url $PREVIEW_URL --prd docs/prd.md --non-interactive

# Resume after failure
npx audit-agent audit --resume

# Verify specific findings
npx audit-agent verify --finding F-001 --url http://localhost:3000
```

### Secondary: GitHub Action

A thin wrapper around the CLI that runs on PR preview deployments. Posts findings as PR comments. Enables continuous completion tracking.

```yaml
# .github/workflows/completion-audit.yml
- uses: paulrbrown/audit-agent@v2
  with:
    url: ${{ steps.deploy.outputs.url }}
    prd: docs/prd.md
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Tertiary: Claude Code Skill (read-only)

A minimal skill wrapper that invokes the CLI in a background process and presents results. The skill does NOT try to be the runtime -- it delegates to the CLI and then helps the user interpret the report. This avoids the subprocess nesting problem entirely.

### What This Is NOT

- Not a VS Code extension (too much surface area for v2, possible v3)
- Not a web dashboard (the CLI generates a static HTML dashboard; no server needed)
- Not a SaaS product (runs locally, your code never leaves your machine)

---

## 3. Execution Architecture

### The Critical Fix: Anthropic TypeScript SDK Replaces `claude --print`

The v1 architecture used `claude --print` as a subprocess. This fails when invoked from within a Claude Code session because you cannot nest Claude processes. The fix is to call the Anthropic API directly using the official TypeScript SDK with an API key.

```
v1 (BROKEN):
  orchestrator.ts -> claude-subprocess.ts -> exec("claude --print ...") -> HANGS

v2 (WORKING):
  orchestrator.ts -> anthropic-client.ts -> Anthropic SDK -> api.anthropic.com -> response
```

### Module: `src/anthropic-client.ts`

Replaces `src/claude-subprocess.ts` entirely.

```typescript
import Anthropic from "@anthropic-ai/sdk";

export interface LLMClient {
  complete(prompt: string, options?: CompletionOptions): Promise<LLMResponse>;
  stream(prompt: string, options?: CompletionOptions): AsyncIterable<StreamChunk>;
}

export interface CompletionOptions {
  model?: string;           // default: "claude-sonnet-4-5-20250929"
  maxTokens?: number;       // default: 8192
  systemPrompt?: string;    // injected as system message
  temperature?: number;     // default: 0 for deterministic audit work
  responseFormat?: "text" | "json";
}

export interface LLMResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  stopReason: string;
}

export function createAnthropicClient(config: {
  apiKey?: string;          // defaults to ANTHROPIC_API_KEY env var
  model?: string;
  maxRetries?: number;
  timeoutMs?: number;
}): LLMClient;
```

**Key design decisions:**

1. **API key from environment.** `ANTHROPIC_API_KEY` env var. No configuration files holding secrets. CI injects via secrets. Local devs set it once.

2. **Model selection.** Default to Sonnet for cost efficiency. Opus available via `--model` flag for users who want maximum quality. The prompts are written to work with Sonnet; Opus is a power-user override.

3. **Structured output via prompting.** Each phase prompt ends with explicit JSON schema instructions. The client validates returned JSON against the schema and retries (max 2) on schema violations. We do NOT rely on tool_use or function calling because the prompts are long-form analysis tasks, not tool invocations.

4. **Streaming for progress.** Long-running phases (exploration analysis, report generation) stream responses. The orchestrator can update the progress dashboard with partial content.

5. **Cost tracking built in.** Every API call returns token counts. The orchestrator accumulates these and enforces the budget cap. When budget is exceeded, the current phase completes but no new phases start.

### Phase Execution Types (Revised)

| Type | Count | How It Runs | Example |
|------|-------|-------------|---------|
| `pure-ts` | 6 | TypeScript function, no LLM | preflight, progress-init, safety, reporting, github-issues, polish |
| `llm-driven` | 5 | Anthropic SDK API call with prompt template | prd-parsing, code-analysis, interactive-review, finding-quality critique, exploration analysis |
| `browser+llm` | 3 | Playwright collects data, then LLM analyzes it | exploration, form-testing, responsive-testing |

The key change from v1: `claude-driven` and `browser-claude` both used the subprocess. Now `llm-driven` uses the Anthropic SDK, and `browser+llm` uses Playwright for data collection THEN the Anthropic SDK for analysis. The browser and the LLM are decoupled.

### How a `browser+llm` Phase Works

```
1. Orchestrator calls Playwright to visit pages and collect raw data
   (HTML, forms, links, console errors, screenshots)

2. Playwright data is serialized to JSON artifacts on disk
   (pages/page-001.json, screenshots/page-001.png)

3. Orchestrator reads artifacts, builds prompt context:
   "Here are 12 pages I visited. Here are the forms I found.
    Here are the console errors. Analyze these against the PRD."

4. Anthropic SDK sends prompt + context to Claude API

5. Claude returns structured analysis (findings, coverage gaps)

6. Orchestrator validates response against schema, writes artifacts
```

This separation means:
- Browser collection can be tested independently (no LLM needed)
- LLM analysis can be tested with fixture data (no browser needed)
- Browser failures don't waste LLM tokens
- LLM is analyzing structured data, not trying to drive a browser

---

## 4. Browser Automation Strategy

### Primary: Playwright (Headless)

**Rationale:** Playwright runs everywhere -- CI, local dev, remote servers -- without requiring a desktop environment or browser extension. It is the only option that works in GitHub Actions.

The existing `src/playwright-browser.ts` is a solid foundation. V2 extends it with:

```typescript
// src/browser/playwright-browser.ts (refactored from src/playwright-browser.ts)

export class AuditBrowser {
  // Existing capabilities (keep)
  async visitPage(url: string): Promise<PageData>;
  async testViewports(url: string, viewports: ViewportSpec[]): Promise<ViewportResults>;
  async fillForm(url: string, formIndex: number, values: Record<string, string>): Promise<FormResult>;

  // New capabilities for v2
  async waitForSPA(options?: SPAWaitOptions): Promise<void>;
  async authenticate(config: AuthConfig): Promise<AuthResult>;
  async interceptNetwork(patterns: string[]): Promise<NetworkLog>;
  async capturePerformance(url: string): Promise<PerformanceMetrics>;
  async crawlRoutes(startUrl: string, options: CrawlOptions): Promise<DiscoveredRoute[]>;
}
```

### SPA Handling

v1 used `waitUntil: 'networkidle'` which fails on SPAs with persistent WebSocket connections or polling. V2 uses a multi-strategy approach:

```typescript
interface SPAWaitOptions {
  strategy: "networkidle" | "domstable" | "selector" | "custom";
  timeout: number;
  // For "domstable": wait until DOM mutations stop for N ms
  domSettleMs?: number;
  // For "selector": wait until this selector appears
  selector?: string;
}

async waitForSPA(options: SPAWaitOptions = { strategy: "domstable", timeout: 10000, domSettleMs: 500 }): Promise<void> {
  switch (options.strategy) {
    case "domstable":
      // Uses MutationObserver to detect when the DOM stops changing
      await page.evaluate((settleMs) => {
        return new Promise<void>((resolve) => {
          let timeout: ReturnType<typeof setTimeout>;
          const observer = new MutationObserver(() => {
            clearTimeout(timeout);
            timeout = setTimeout(() => { observer.disconnect(); resolve(); }, settleMs);
          });
          observer.observe(document.body, { childList: true, subtree: true, attributes: true });
          timeout = setTimeout(() => { observer.disconnect(); resolve(); }, settleMs);
        });
      }, options.domSettleMs);
      break;
    // ... other strategies
  }
}
```

### Authentication Support

Many web apps require login. V2 supports three auth strategies:

```typescript
interface AuthConfig {
  strategy: "cookie" | "bearer" | "form-login";

  // For "cookie": inject cookies directly
  cookies?: Array<{ name: string; value: string; domain: string; path?: string }>;

  // For "bearer": inject Authorization header on all requests
  token?: string;

  // For "form-login": automate the login form
  loginUrl?: string;
  credentials?: { username: string; password: string };
  successIndicator?: string; // selector that appears after successful login
}
```

Configured via `config.yml`:
```yaml
auth:
  strategy: cookie
  cookies:
    - name: session
      value: ${AUTH_SESSION_COOKIE}  # from env var
      domain: localhost
```

### Secondary: Chrome MCP (Optional Enhancement)

For users running the audit interactively within Claude Code, Chrome MCP can be used as a secondary data source. The orchestrator detects whether MCP tools are available and uses them for supplementary checks (accessibility tree inspection, visual regression). This is additive, not required.

### Screenshot Strategy

Playwright captures full-page screenshots as PNG buffers. V2 stores them efficiently:

```
.complete-agent/audits/current/
  screenshots/
    page-001-desktop.png      # 1280x720 viewport
    page-001-mobile.png       # 375x667 viewport
    finding-F001-evidence.png  # Screenshot showing the bug
    form-003-before.png        # Form state before submission
    form-003-after.png         # Form state after submission
```

Screenshots are referenced by path in finding JSON, not embedded. The HTML dashboard loads them as `<img>` tags. GitHub issues can include them as uploaded attachments.

---

## 5. Module Structure

```
project-completion-agent/
├── src/
│   ├── cli.ts                    # CLI entry point (KEEP, simplify)
│   ├── config.ts                 # Configuration builder (KEEP)
│   ├── orchestrator.ts           # Pipeline coordinator (REWRITE)
│   │
│   ├── llm/
│   │   ├── anthropic-client.ts   # NEW: Anthropic SDK wrapper
│   │   ├── prompt-loader.ts      # NEW: Loads + interpolates prompt templates
│   │   ├── schema-validator.ts   # NEW: Validates LLM JSON output against schemas
│   │   └── cost-tracker.ts       # MOVE from src/cost-tracker.ts
│   │
│   ├── browser/
│   │   ├── playwright-browser.ts # REFACTOR from src/playwright-browser.ts
│   │   ├── spa-handler.ts        # NEW: SPA wait strategies
│   │   ├── auth-handler.ts       # NEW: Authentication strategies
│   │   ├── route-crawler.ts      # NEW: Breadth-first route discovery
│   │   └── browser-pool.ts       # NEW: Replaces browser-queue.ts with connection pooling
│   │
│   ├── phases/
│   │   ├── preflight.ts          # KEEP (pure-ts)
│   │   ├── prd-parsing.ts        # NEW: Orchestration wrapper for LLM PRD parsing
│   │   ├── code-analysis.ts      # KEEP (pure-ts analysis + LLM mapping)
│   │   ├── progress-init.ts      # KEEP (pure-ts)
│   │   ├── safety.ts             # KEEP (pure-ts)
│   │   ├── exploration.ts        # REWRITE: Playwright collection + LLM analysis
│   │   ├── form-testing.ts       # REWRITE: Playwright form interaction + LLM analysis
│   │   ├── responsive-testing.ts # REWRITE: Playwright viewport testing + LLM analysis
│   │   ├── finding-quality.ts    # KEEP (LLM critique via Anthropic SDK)
│   │   ├── report-generation.ts  # KEEP (pure-ts)
│   │   ├── interactive-review.ts # REWRITE: stdin/stdout instead of LLM-mediated
│   │   ├── github-issues.ts      # KEEP (pure-ts, uses gh CLI)
│   │   ├── verification.ts       # REWRITE: Playwright reproduction + LLM evaluation
│   │   └── polish.ts             # KEEP (pure-ts)
│   │
│   ├── pipeline/
│   │   ├── phase-registry.ts     # KEEP (phase metadata)
│   │   ├── phase-dispatcher.ts   # SIMPLIFY (remove browser-claude complexity)
│   │   ├── phase-init.ts         # SIMPLIFY (fewer handler types)
│   │   ├── job-runner.ts         # KEEP (parallel execution)
│   │   └── checkpoint.ts         # NEW: Extracted from orchestrator checkpoint logic
│   │
│   ├── storage/
│   │   ├── artifact-store.ts     # KEEP (JSONL log)
│   │   ├── artifact-paths.ts     # KEEP (path conventions)
│   │   └── finding-store.ts      # NEW: Finding CRUD with dedup and signature
│   │
│   └── reporting/
│       ├── dashboard-writer.ts   # KEEP (HTML dashboard generation)
│       ├── report-writer.ts      # NEW: Markdown report generation
│       └── github-formatter.ts   # NEW: Format findings as GitHub issue bodies
│
├── prompts/                      # KEEP all 15 prompt files
│   ├── phase-1-prd-parsing.md
│   ├── phase-3-code-analysis.md
│   ├── phase-4-exploration.md
│   ├── phase-6-form-testing.md
│   ├── phase-6-responsive.md
│   ├── phase-7-critique.md
│   ├── phase-7-verification.md
│   ├── phase-8-review.md
│   ├── phase-9-verification.md
│   ├── subagent-explore.md
│   ├── subagent-form-test.md
│   ├── subagent-review-security.md
│   ├── subagent-review-ux.md
│   ├── subagent-review-adversarial.md
│   └── README.md
│
├── schemas/                      # MOVE from skill/schemas/
│   ├── progress.schema.json
│   ├── prd-summary.schema.json
│   ├── code-analysis.schema.json
│   ├── finding.schema.json
│   ├── page.schema.json
│   └── ...
│
├── tests/                        # KEEP all 32 test files, add new ones
│   ├── unit/
│   │   ├── anthropic-client.test.ts    # NEW
│   │   ├── playwright-browser.test.ts  # NEW
│   │   ├── spa-handler.test.ts         # NEW
│   │   └── ...existing tests...
│   ├── integration/
│   │   ├── pipeline-e2e.test.ts        # NEW: Full pipeline with mocked LLM
│   │   ├── browser-collection.test.ts  # NEW: Playwright against test app
│   │   └── ...existing tests...
│   └── fixtures/
│       ├── sample-prd.md
│       ├── sample-page-data.json
│       └── sample-finding.json
│
├── action/                       # NEW: GitHub Action wrapper
│   ├── action.yml
│   ├── entrypoint.sh
│   └── README.md
│
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── ARCHITECTURE-V2.md            # This document
```

### File Count Comparison

| Category | v1 | v2 | Delta |
|----------|----|----|-------|
| Core src/ | 20 | 28 | +8 new, 5 rewritten |
| Prompts | 15 | 15 | unchanged |
| Tests | 32 | ~40 | +8 new |
| Schemas | ~11 | ~11 | moved to root |
| **Total** | **~78** | **~94** | **+16** |

The increase is modest. Most of the "new" files are extracted responsibilities from the monolithic orchestrator and browser module, not new concepts.

---

## 6. Migration Path

### What To Keep (Unchanged)

These modules work correctly and have passing tests:

| Module | Lines | Why Keep |
|--------|-------|----------|
| `src/config.ts` | 249 | Solid config builder with layered precedence |
| `src/phase-registry.ts` | 303 | Clean phase metadata registry |
| `src/job-runner.ts` | 197 | Working parallel job execution |
| `src/artifact-store.ts` | 308 | Atomic JSONL writes, proven pattern |
| `src/artifact-paths.ts` | ~100 | Path conventions |
| `src/cost-tracker.ts` | ~100 | Cost accumulation |
| `src/dashboard-writer.ts` | ~200 | HTML dashboard generation |
| `src/phases/preflight.ts` | ~200 | Pure-TS, works |
| `src/phases/progress-init.ts` | ~100 | Pure-TS, works |
| `src/phases/safety.ts` | ~150 | Pure-TS, works |
| `src/phases/report-generation.ts` | ~200 | Pure-TS, works |
| `src/phases/github-issues.ts` | ~150 | Pure-TS, works |
| `src/phases/polish.ts` | ~100 | Pure-TS, works |
| All 15 prompt files | ~3000 | High-quality, well-structured |
| All 32 test files | ~5000 | 476 passing tests |

### What To Rewrite

| Module | Reason | Approach |
|--------|--------|----------|
| `src/orchestrator.ts` | Tightly coupled to subprocess SDK | Rewrite to use `LLMClient` interface. Keep structure, change execution layer. |
| `src/claude-subprocess.ts` | **THE BLOCKER.** Cannot work inside Claude Code. | Replace entirely with `src/llm/anthropic-client.ts` |
| `src/sdk-bridge.ts` | Wraps the broken subprocess | Replace with thin wrapper around `LLMClient` |
| `src/phase-dispatcher.ts` | Over-engineered for 3 types that are now 2 | Simplify: `pure-ts` and `llm-driven`. Browser collection is a pre-step, not a phase type. |
| `src/phase-init.ts` | Registers browser collectors as phase type | Simplify: browser collection happens inside phase implementations, not as dispatcher concern |
| `src/playwright-browser.ts` | Missing SPA handling, auth, crawling | Extend substantially; move to `src/browser/` |
| `src/browser-phase-helpers.ts` | Tightly coupled to old dispatcher model | Merge into phase implementations |
| `src/phases/exploration.ts` | Needs Playwright-first approach | Rewrite: Playwright crawls and collects, then LLM analyzes collected data |
| `src/phases/form-testing.ts` | Needs Playwright-first approach | Rewrite: Playwright fills forms, then LLM evaluates results |
| `src/phases/verification.ts` | Never worked end-to-end | Rewrite: Playwright reproduces, LLM evaluates |

### What To Delete

| Module | Reason |
|--------|--------|
| `src/claude-subprocess.ts` | Replaced by Anthropic SDK client |
| `src/browser-phase-helpers.ts` | Responsibilities absorbed into phase implementations |
| `src/browser-queue.ts` | Replaced by browser pool (Playwright handles concurrency natively) |
| `skill/SKILL_INSTRUCTIONS.md` | Already deleted; replaced by per-phase prompts |
| `skill/skill.md` | Already deleted; replaced by CLI |
| Various `.md` planning docs at root | Historical; archive to `docs/archive/` |

### What To Create

| Module | Purpose | Estimated Lines |
|--------|---------|-----------------|
| `src/llm/anthropic-client.ts` | Anthropic SDK wrapper with retry, streaming, cost tracking | ~200 |
| `src/llm/prompt-loader.ts` | Load prompt .md files, interpolate `{{variables}}` | ~80 |
| `src/llm/schema-validator.ts` | AJV validation of LLM JSON responses | ~120 |
| `src/browser/spa-handler.ts` | SPA wait strategies (DOM stable, selector, etc.) | ~100 |
| `src/browser/auth-handler.ts` | Cookie, bearer token, and form-login auth | ~150 |
| `src/browser/route-crawler.ts` | BFS route discovery with URL canonicalization | ~200 |
| `src/browser/browser-pool.ts` | Playwright browser context pool for parallel pages | ~100 |
| `src/storage/finding-store.ts` | Finding CRUD, dedup, signature generation | ~150 |
| `src/reporting/report-writer.ts` | Markdown report from findings + coverage | ~150 |
| `src/reporting/github-formatter.ts` | Finding -> GitHub issue body formatting | ~100 |
| `src/pipeline/checkpoint.ts` | Checkpoint save/load extracted from orchestrator | ~80 |
| `action/action.yml` + entrypoint | GitHub Action definition | ~50 |
| **Total new** | | **~1480** |

---

## 7. Implementation Priorities

### Sprint 1: Unblock the LLM (Days 1-3)

**Goal:** Replace `claude --print` subprocess with Anthropic SDK. Make one phase work end-to-end.

1. Create `src/llm/anthropic-client.ts` -- Anthropic SDK wrapper
2. Create `src/llm/prompt-loader.ts` -- load + interpolate prompts
3. Create `src/llm/schema-validator.ts` -- validate LLM JSON output
4. Rewrite `src/sdk-bridge.ts` to use `LLMClient` interface instead of `ClaudeSDK`
5. Wire up PRD parsing phase as proof: `CLI -> orchestrator -> prompt-loader -> anthropic-client -> API -> validate -> save`
6. Test: `npx audit-agent audit --url http://example.com --prd test.md` produces valid `prd-summary.json`

**Success criterion:** One LLM-driven phase completes without hanging, produces validated output, reports token cost.

### Sprint 2: Browser Foundation (Days 4-7)

**Goal:** Playwright collects real page data. Exploration phase works end-to-end.

1. Refactor `src/playwright-browser.ts` into `src/browser/` module with SPA handling
2. Create `src/browser/route-crawler.ts` -- BFS crawling with URL canonicalization
3. Create `src/browser/auth-handler.ts` -- cookie/bearer/form-login auth
4. Rewrite `src/phases/exploration.ts`:
   - Step 1: Playwright visits pages, saves `page-NNN.json` artifacts
   - Step 2: LLM analyzes collected page data against PRD
5. Simplify `src/phase-dispatcher.ts` -- remove `browser-claude` type, all phases are either `pure-ts` or `llm-driven`
6. Test: Run exploration against a real application, verify page artifacts and screenshots

**Success criterion:** Exploration visits 10+ pages on a real app, saves structured artifacts, takes screenshots, discovers routes by crawling.

### Sprint 3: Testing Phases (Days 8-11)

**Goal:** Form testing and responsive testing work end-to-end.

1. Rewrite `src/phases/form-testing.ts` -- Playwright fills forms, LLM evaluates
2. Rewrite `src/phases/responsive-testing.ts` -- Playwright tests viewports
3. Create `src/storage/finding-store.ts` -- finding dedup and storage
4. Wire finding-quality critique through Anthropic SDK
5. Test: Full Phases 0-7 pipeline against a real application

**Success criterion:** Complete audit produces validated findings with evidence (screenshots, console errors, form results).

### Sprint 4: Reporting and End-to-End (Days 12-15)

**Goal:** Complete pipeline produces actionable output.

1. Rewrite interactive-review to use CLI stdin/stdout (not LLM-mediated)
2. Wire GitHub issue creation with formatted bodies and screenshot uploads
3. Create `src/reporting/report-writer.ts` -- markdown report
4. Rewrite verification phase -- Playwright reproduces findings
5. Full end-to-end test: audit a real application, produce report, create issues
6. Create GitHub Action wrapper

**Success criterion:** `npx audit-agent audit --url http://localhost:3000 --prd docs/prd.md` runs all 14 phases, produces report.md, creates GitHub issues, and exits cleanly.

### Sprint 5: Polish and Ship (Days 16-20)

**Goal:** Production-ready for other developers.

1. Documentation: README, configuration reference, architecture overview
2. Error messages: helpful errors for common problems (no API key, app not running, auth failure)
3. CI integration: GitHub Action tested on a real repository
4. Performance: parallel phase execution for independent phases
5. Budget controls: per-phase and total budget enforcement with graceful degradation

---

## 8. The Vision

### At 1.0 (Ship Target)

**What it does:** You give it a URL, a PRD, and your codebase. It comes back 20 minutes later with a prioritized list of everything that is incomplete, broken, or missing -- as GitHub issues with screenshots, reproduction steps, and PRD traceability. Each issue is verified (reproduced 3x), critiqued for false positives, and linked to the specific PRD requirement it violates.

**What makes it different:** Every "audit tool" finds problems. This one finds the RIGHT problems -- the delta between what you said you would build (PRD) and what you actually built (running app + code). It is not a linter, not a test runner, not a security scanner. It is the automated version of the QA lead who reads the spec and then actually uses the product.

**Who uses it:** Solo developers and small teams (2-5 engineers) building web applications who want to ship complete work. The person who knows the PRD exists but hasn't had time to check every requirement against the running app.

**How they use it:** Run it before every release. Point it at the staging deployment. Review the findings. Close the issues. Ship with confidence that nothing was missed.

### At 2.0 (Future Vision)

**Continuous completion tracking.** The GitHub Action runs on every PR that touches a preview deployment. A completion score (e.g., "87% of PRD requirements verified passing") is posted as a PR comment. Developers see their completion percentage go up as they close issues and down when new requirements are added to the PRD.

**Multi-PRD support.** Large projects have multiple PRDs (one per epic, one per feature area). The agent runs all of them and produces a unified report with cross-PRD dependency tracking.

**Regression detection.** The agent compares the current audit against the previous one. If a finding that was previously passing is now failing, it gets flagged as a regression with P0 severity. This catches "fixed bugs that come back."

**Learning from history.** The agent remembers which findings were rejected by the user as false positives. It uses this history to calibrate its confidence scores and avoid repeating rejected findings.

**Visual regression.** Playwright takes screenshots at every viewport on every page on every run. The agent compares screenshots across runs to detect unintended visual changes (shifted layouts, missing elements, broken images) that no test suite catches.

**Collaborative review.** The interactive review phase becomes a web UI where the entire team can review findings, vote on severity, and assign issues. Think "Figma comments but for QA findings."

### What Success Looks Like

A developer runs `npx audit-agent audit` on Friday afternoon. They come back from lunch to find 12 new GitHub issues, each with a screenshot, reproduction steps, and a link to the PRD requirement. They spend the afternoon closing them. On Monday they run it again and the report says "0 new findings, 12 findings resolved." They ship. The PRD is 100% complete.

That is the tool.

---

## Appendix A: Dependency Changes

### Remove

| Package | Reason |
|---------|--------|
| `@playwright/test` | Replace with `playwright` (non-test runner variant) |

### Keep

| Package | Purpose |
|---------|---------|
| `@anthropic-ai/sdk` | Direct API access (already in package.json) |
| `playwright` | Browser automation (already optional dep) |
| `ajv` + `ajv-formats` | Schema validation |
| `yaml` | Config file parsing |

### Add

| Package | Purpose |
|---------|---------|
| `commander` | CLI argument parsing (replaces manual parseArgs) |
| `ora` | Terminal spinner for progress indication |
| `chalk` | Colored terminal output |

### Total Dependencies: 7 runtime (excluding devDeps)

Small dependency footprint is intentional. Every dependency is a maintenance burden. Prefer Node.js built-ins where possible.

---

## Appendix B: Configuration Schema (v2)

```yaml
# .complete-agent/config.yml
version: "2.0"

# Target application
target:
  url: "http://localhost:3000"
  codebase_path: "."       # relative to repo root
  prd_path: "docs/prd.md"  # relative to repo root

# Authentication (optional)
auth:
  strategy: "cookie"        # none | cookie | bearer | form-login
  cookies:
    - name: "session"
      value: "${AUTH_COOKIE}" # env var reference
      domain: "localhost"

# LLM settings
llm:
  model: "claude-sonnet-4-5-20250929"
  max_budget_usd: 5.0
  max_phase_budget_usd: 2.0
  temperature: 0

# Browser settings
browser:
  headless: true
  timeout_ms: 30000
  screenshots: true
  spa_strategy: "domstable"  # networkidle | domstable | selector

# Exploration limits
exploration:
  max_pages: 50
  max_routes: 50
  max_per_pattern: 5
  timeout_minutes: 30
  rate_limit_ms: 1000

# Testing
testing:
  safe_mode: auto            # auto | true | false
  max_forms: 20
  test_viewports: [375, 768, 1280]

# Reporting
reporting:
  create_github_issues: true
  min_severity: "P2"
  skip_unverified: true

# Execution
execution:
  parallel: true
  timeout_per_phase_seconds: 600
  non_interactive: false
```

---

## Appendix C: Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | **Required.** API key for Claude API calls. | none |
| `AUDIT_URL` | Target application URL | none |
| `AUDIT_CODEBASE_PATH` | Path to source code | current directory |
| `AUDIT_PRD_PATH` | Path to PRD document | none |
| `AUDIT_MAX_BUDGET` | Total budget cap (USD) | 10 |
| `AUDIT_MODEL` | Claude model to use | claude-sonnet-4-5-20250929 |
| `CI` | Enables non-interactive mode | unset |
| `AUTH_COOKIE` | Session cookie for auth | unset |
| `AUTH_TOKEN` | Bearer token for auth | unset |

---

## Appendix D: Key Architectural Decisions

### D1: Why Anthropic SDK instead of claude --print

`claude --print` cannot be invoked from within a Claude Code session. This is the #1 blocker for the tool's primary use case. The Anthropic SDK makes direct HTTP calls to the API, which works everywhere -- inside Claude Code, in CI, on remote servers, on any machine with Node.js.

Trade-off: Requires an API key and costs money per call. On the MAX plan, `claude --print` was free. Mitigation: Costs are ~$0.50-$2.00 per audit using Sonnet. Budget caps prevent surprises.

### D2: Why Playwright instead of Chrome MCP

Chrome MCP requires a running Chrome browser with the Claude extension installed. This rules out CI, headless servers, and any environment without a desktop. Playwright runs headless by default and installs its own browser binaries.

Trade-off: Chrome MCP can inspect the accessibility tree more naturally and interact with the extension's tools. Mitigation: Playwright's accessibility tree API (`page.accessibility.snapshot()`) provides equivalent data.

### D3: Why decouple browser collection from LLM analysis

In v1, `browser-claude` phases tried to have the LLM drive the browser AND analyze the results in a single context. This fails because: (a) the LLM context fills up with browser state, (b) browser errors crash the LLM phase, (c) you cannot test browser collection and LLM analysis independently.

In v2, the browser collects raw data (synchronous, deterministic, testable) and the LLM analyzes that data (async, creative, testable with fixtures). This is the same pattern as a compiler's lexer/parser split: separate concerns, compose them.

### D4: Why not a web application

A web application requires a server, deployment, authentication, a database, and ongoing infrastructure. The tool's entire value proposition is "find the incomplete work in your web application" -- it would be ironic if the tool itself were an incomplete web application. A CLI that generates a static HTML dashboard gives the same user experience without the infrastructure burden.

### D5: Why keep the 15 prompt files

The prompt files are the intellectual core of the product. They encode what "complete" means, what constitutes a finding, how to classify severity, how to structure evidence, and how to evaluate forms. They are well-written, battle-tested (multiple Codex reviews), and model-agnostic. The execution infrastructure can change completely without touching the prompts.
