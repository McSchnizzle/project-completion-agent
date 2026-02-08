/**
 * Test Harness
 * T-G05: Comprehensive test utilities for the Project Completion Agent
 *
 * Provides mocks for the Claude Agent SDK, browser provider (MCP tools),
 * temporary workspace creation, and sample data factories for all core
 * data structures used throughout the audit pipeline.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// Claude SDK Mock
// ---------------------------------------------------------------------------

/** Configuration for the mock Claude SDK */
export interface MockClaudeOptions {
  /** Default response object returned by query(). Defaults to `{ success: true }`. */
  response?: Record<string, unknown>;
  /** When set, the mock will reject with this error instead of resolving. */
  error?: Error;
  /** Simulated token usage for cost-tracking tests. */
  cost?: { inputTokens: number; outputTokens: number };
}

/** A single recorded call to the mock query function. */
export interface MockClaudeCall {
  prompt: string;
  options?: Record<string, unknown>;
  timestamp: string;
}

/** The object returned by `mockClaudeSDK`. */
export interface MockClaudeSDK {
  /** Mimics the Claude Agent SDK `query()` function. */
  query: (prompt: string, options?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** All recorded calls, in order. */
  calls: MockClaudeCall[];
  /** The arguments passed to the most recent call, or `null` if never called. */
  lastCallArgs: { prompt: string; options?: Record<string, unknown> } | null;
  /** Simulated token usage returned with every successful call. */
  cost: { inputTokens: number; outputTokens: number };
  /** Reset recorded calls. */
  reset: () => void;
}

/**
 * Create a mock that mimics the Claude Agent SDK `query()` function.
 *
 * @param options - Configuration for response data, errors, and token costs.
 * @returns An object with a callable `query` method and assertion helpers.
 *
 * @example
 * ```ts
 * const claude = mockClaudeSDK({ response: { answer: 42 } });
 * const result = await claude.query('What is the meaning of life?');
 * expect(result).toEqual({ answer: 42 });
 * expect(claude.calls).toHaveLength(1);
 * ```
 */
export function mockClaudeSDK(options: MockClaudeOptions = {}): MockClaudeSDK {
  const defaultResponse: Record<string, unknown> = options.response ?? { success: true };
  const cost = options.cost ?? { inputTokens: 0, outputTokens: 0 };
  const calls: MockClaudeCall[] = [];
  let lastCallArgs: { prompt: string; options?: Record<string, unknown> } | null = null;

  async function query(
    prompt: string,
    queryOptions?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const callRecord: MockClaudeCall = {
      prompt,
      options: queryOptions,
      timestamp: new Date().toISOString(),
    };
    calls.push(callRecord);
    lastCallArgs = { prompt, options: queryOptions };

    if (options.error) {
      throw options.error;
    }

    return { ...defaultResponse };
  }

  return {
    query,
    calls,
    get lastCallArgs() {
      return lastCallArgs;
    },
    cost,
    reset() {
      calls.length = 0;
      lastCallArgs = null;
    },
  };
}

// ---------------------------------------------------------------------------
// Browser Provider Mock
// ---------------------------------------------------------------------------

/** Describes a single page that the mock browser can serve. */
export interface MockPageData {
  title: string;
  html: string;
  links: string[];
}

/** Configuration for the mock browser provider. */
export interface MockBrowserOptions {
  /** Map of URL -> page data. Unknown URLs return a 404-style response. */
  pages?: Record<string, MockPageData>;
  /** When true, every tool call rejects with an error. */
  shouldError?: boolean;
}

/** A recorded call to any mock browser tool. */
export interface MockBrowserCall {
  tool: string;
  args: Record<string, unknown>;
  timestamp: string;
}

/** The mock browser provider returned by `mockBrowserProvider`. */
export interface MockBrowserProvider {
  navigate: (url: string) => Promise<MockPageData | null>;
  read_page: (url?: string) => Promise<Record<string, unknown>>;
  screenshot: (url?: string) => Promise<string>;
  find: (query: string) => Promise<Array<{ ref: string; text: string }>>;
  javascript_tool: (code: string) => Promise<unknown>;
  /** All recorded calls across every tool, in order. */
  calls: MockBrowserCall[];
  /** Reset recorded calls. */
  reset: () => void;
}

/**
 * Create a mock for MCP browser tools (navigate, read_page, screenshot, find, javascript_tool).
 *
 * @param options - Pages to serve and error behaviour.
 * @returns An object exposing the five mock tool functions plus call tracking.
 *
 * @example
 * ```ts
 * const browser = mockBrowserProvider({
 *   pages: { 'https://example.com': { title: 'Example', html: '<h1>Hi</h1>', links: [] } },
 * });
 * const page = await browser.navigate('https://example.com');
 * expect(page?.title).toBe('Example');
 * ```
 */
export function mockBrowserProvider(options: MockBrowserOptions = {}): MockBrowserProvider {
  const pages = options.pages ?? {};
  const calls: MockBrowserCall[] = [];

  function record(tool: string, args: Record<string, unknown>): void {
    calls.push({ tool, args, timestamp: new Date().toISOString() });
  }

  function maybeError(tool: string): void {
    if (options.shouldError) {
      throw new Error(`Mock browser error in ${tool}: simulated failure`);
    }
  }

  async function navigate(url: string): Promise<MockPageData | null> {
    record('navigate', { url });
    maybeError('navigate');
    return pages[url] ?? null;
  }

  async function read_page(url?: string): Promise<Record<string, unknown>> {
    record('read_page', { url });
    maybeError('read_page');

    const page = url ? pages[url] : Object.values(pages)[0];
    if (!page) {
      return { role: 'document', name: 'Empty', children: [] };
    }

    return {
      role: 'document',
      name: page.title,
      children: [
        { role: 'heading', name: page.title, level: 1 },
        ...page.links.map((link, i) => ({
          role: 'link',
          name: `Link ${i + 1}`,
          href: link,
        })),
      ],
    };
  }

  async function screenshot(_url?: string): Promise<string> {
    record('screenshot', { url: _url });
    maybeError('screenshot');
    // Return a minimal fake base64-encoded 1x1 PNG
    return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  }

  async function find(query: string): Promise<Array<{ ref: string; text: string }>> {
    record('find', { query });
    maybeError('find');
    // Return a single generic match
    return [{ ref: 'ref_1', text: `Mock result for: ${query}` }];
  }

  async function javascript_tool(code: string): Promise<unknown> {
    record('javascript_tool', { code });
    maybeError('javascript_tool');
    return { result: 'mock_js_result' };
  }

  return {
    navigate,
    read_page,
    screenshot,
    find,
    javascript_tool,
    calls,
    reset() {
      calls.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Temporary Audit Workspace
// ---------------------------------------------------------------------------

/** The value returned by `createTempAuditWorkspace`. */
export interface TempAuditWorkspace {
  /** Root of the temporary project directory. */
  path: string;
  /** The `.complete-agent/audits/current` directory inside `path`. */
  auditDir: string;
  /** Remove the entire temporary tree. Safe to call more than once. */
  cleanup: () => void;
}

/**
 * Create a temporary directory tree that mirrors a real audit workspace.
 *
 * The layout created is:
 * ```
 * <tmp>/
 *   .complete-agent/
 *     audits/
 *       current/
 *         pages/
 *         findings/
 *         screenshots/
 *     dashboard/
 * ```
 *
 * @returns An object with the base path, the audit directory path, and a cleanup function.
 */
export function createTempAuditWorkspace(): TempAuditWorkspace {
  const id = randomBytes(8).toString('hex');
  const basePath = join(tmpdir(), `audit-test-${id}`);
  const auditDir = join(basePath, '.complete-agent', 'audits', 'current');

  mkdirSync(join(auditDir, 'pages'), { recursive: true });
  mkdirSync(join(auditDir, 'findings'), { recursive: true });
  mkdirSync(join(auditDir, 'screenshots'), { recursive: true });
  mkdirSync(join(basePath, '.complete-agent', 'dashboard'), { recursive: true });

  let cleaned = false;

  function cleanup(): void {
    if (cleaned) return;
    cleaned = true;
    if (existsSync(basePath)) {
      rmSync(basePath, { recursive: true, force: true });
    }
  }

  return { path: basePath, auditDir, cleanup };
}

// ---------------------------------------------------------------------------
// Sample Data Factories
// ---------------------------------------------------------------------------

/**
 * Return a complete 33-field NormalizedFinding object with sensible defaults.
 * All required fields are populated. Pass `overrides` to replace any field.
 *
 * @param overrides - Partial object merged on top of the defaults.
 */
export function sampleFinding(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  const now = new Date().toISOString();
  const base: Record<string, unknown> = {
    schema_version: '1.0.0',
    id: 'finding-001',
    source: 'code-scan',
    type: 'console_log',
    severity: 'P3',
    title: 'Console Statement in Code',
    description: 'console.log found in production code',
    location: {
      file: 'src/app.ts',
      line: 42,
      url: null,
      selector: null,
    },
    evidence: {
      screenshot_id: null,
      code_snippet: 'console.log("debug");',
      expected: 'No console statements in production code',
      actual: 'console.log statement found',
      steps_to_reproduce: ['Open src/app.ts', 'Go to line 42'],
    },
    verification: {
      required: true,
      method: 'file_check',
      status: null,
      attempts: [],
    },
    signature: 'sig-console_log-src/app.ts-42',
    duplicate_of: null,
    recommendation: 'Remove or replace with a proper logging library.',
    prd_feature_id: null,
    confidence: 80,
    labels: ['code-quality'],
    issue_number: null,
    created_at: now,
    updated_at: now,
    // Fields 21-33: extended metadata used in some reporting paths
    category: 'Code Quality',
    browser_testable: false,
    viewport: null,
    form_id: null,
    route: null,
    response_code: null,
    latency_ms: null,
    accessibility_impact: null,
    wcag_criterion: null,
    affected_users: null,
    remediation_effort: 'low',
    auto_fixable: false,
    related_findings: [],
  };

  return { ...base, ...(overrides ?? {}) };
}

/**
 * Return a page inventory object with sensible defaults.
 *
 * @param overrides - Partial object merged on top of the defaults.
 */
export function samplePage(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  const now = new Date().toISOString();
  const base: Record<string, unknown> = {
    url: 'https://localhost:3000/dashboard',
    route_pattern: '/dashboard',
    title: 'Dashboard',
    status_code: 200,
    content_type: 'text/html',
    discovered_at: now,
    visited_at: now,
    links_found: ['/settings', '/profile', '/logout'],
    forms_found: [],
    interactive_elements: 12,
    has_errors: false,
    screenshot_id: null,
    load_time_ms: 320,
    viewport_tested: ['desktop'],
    accessibility_score: null,
    notes: null,
  };

  return { ...base, ...(overrides ?? {}) };
}

/**
 * Return a PRD summary object with 2 sample features and 1 user flow.
 *
 * @param overrides - Partial object merged on top of the defaults.
 */
export function samplePrdSummary(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  const base: Record<string, unknown> = {
    prd_path: '/project/PRD.md',
    parsed_at: new Date().toISOString(),
    title: 'Sample Application PRD',
    features: [
      {
        id: 'feat-001',
        name: 'User Authentication',
        description: 'Users can sign up, log in, and reset passwords.',
        acceptance_criteria: [
          'Sign-up form validates email format',
          'Login redirects to dashboard on success',
          'Password reset sends an email',
        ],
        status: 'verified',
      },
      {
        id: 'feat-002',
        name: 'Dashboard Overview',
        description: 'Displays key metrics and recent activity.',
        acceptance_criteria: [
          'Shows total revenue card',
          'Lists last 5 activities',
        ],
        status: 'partial',
      },
    ],
    flows: [
      {
        id: 'flow-001',
        name: 'Onboarding Flow',
        steps: [
          'User lands on home page',
          'Clicks "Get Started"',
          'Fills sign-up form',
          'Verifies email',
          'Lands on dashboard',
        ],
        status: 'verified',
      },
    ],
    requirements_total: 5,
    requirements_verified: 3,
    requirements_missing: 1,
    requirements_partial: 1,
  };

  return { ...base, ...(overrides ?? {}) };
}

/**
 * Return a code analysis result with 3 routes and 1 form.
 *
 * @param overrides - Partial object merged on top of the defaults.
 */
export function sampleCodeAnalysis(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  const base: Record<string, unknown> = {
    analyzed_at: new Date().toISOString(),
    codebase_path: '/project/src',
    languages: ['typescript', 'css'],
    files_analyzed: 47,
    lines_of_code: 8200,
    routes: [
      { path: '/', component: 'HomePage', file: 'src/pages/Home.tsx' },
      { path: '/dashboard', component: 'DashboardPage', file: 'src/pages/Dashboard.tsx' },
      { path: '/settings', component: 'SettingsPage', file: 'src/pages/Settings.tsx' },
    ],
    forms: [
      {
        id: 'form-login',
        action: '/api/auth/login',
        method: 'POST',
        fields: ['email', 'password'],
        file: 'src/components/LoginForm.tsx',
      },
    ],
    findings: [],
    framework: 'react',
    build_tool: 'vite',
    test_framework: 'vitest',
    has_typescript: true,
    has_eslint: true,
    has_prettier: true,
  };

  return { ...base, ...(overrides ?? {}) };
}

/**
 * Return a `progress.json`-shaped object matching the `AuditProgress` interface.
 *
 * @param overrides - Partial object merged on top of the defaults.
 */
export function sampleProgress(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  const now = new Date().toISOString();
  const base: Record<string, unknown> = {
    schema_version: '1.0.0',
    audit_id: 'audit-20260206-120000',
    started_at: now,
    updated_at: now,
    status: 'running',
    current_stage: 'code-scan',
    stages: {
      preflight: {
        status: 'completed',
        started_at: now,
        completed_at: now,
        duration_seconds: 2.1,
        findings_count: 0,
        error: null,
      },
      'code-scan': {
        status: 'running',
        started_at: now,
        completed_at: null,
        duration_seconds: null,
        findings_count: 0,
        error: null,
      },
    },
    metrics: {
      pages_visited: 0,
      pages_total: 0,
      routes_covered: 0,
      routes_total: 0,
      findings_total: 0,
      findings_by_severity: {},
      verified_count: 0,
      flaky_count: 0,
      unverified_count: 0,
    },
    focus_areas: null,
    stop_flag: false,
    checkpoint: null,
    errors: [],
  };

  return { ...base, ...(overrides ?? {}) };
}
