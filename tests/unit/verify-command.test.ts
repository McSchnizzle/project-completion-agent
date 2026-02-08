/**
 * Tests for the verify CLI command and three audit modes (full, focused, verify).
 *
 * Covers:
 * - CLI argument parsing for verify command (--issue, --finding)
 * - Focus mode (--focus flag filtering)
 * - Verification result file structure
 * - Finding lookup from audit directory
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseCliArgs } from '../../src/cli';
import { buildConfig } from '../../src/config';
import { getPhasesByOrder } from '../../src/phase-registry';
import { filterRoutes, filterForms, applyFocusFilter } from '../../src/phases/focus-filter';

// ---------------------------------------------------------------------------
// CLI parsing tests
// ---------------------------------------------------------------------------

describe('CLI verify command parsing', () => {
  it('should parse --issue flag', () => {
    const args = parseCliArgs([
      'node', 'script', 'verify',
      '--issue', '42',
      '--url', 'http://localhost:3000',
      '--codebase-path', '/tmp/test',
    ]);
    expect(args.issue).toBe('42');
  });

  it('should parse --finding flag', () => {
    const args = parseCliArgs([
      'node', 'script', 'verify',
      '--finding', 'F-001',
      '--url', 'http://localhost:3000',
      '--codebase-path', '/tmp/test',
    ]);
    expect(args.issue).toBe('F-001');
  });

  it('should prefer --finding over --issue when both provided', () => {
    const args = parseCliArgs([
      'node', 'script', 'verify',
      '--issue', '42',
      '--finding', 'F-001',
      '--url', 'http://localhost:3000',
      '--codebase-path', '/tmp/test',
    ]);
    expect(args.issue).toBe('F-001');
  });

  it('should parse --focus patterns', () => {
    const args = parseCliArgs([
      'node', 'script', 'audit',
      '--focus', 'auth',
      '--focus', 'payments',
      '--url', 'http://localhost:3000',
      '--codebase-path', '/tmp/test',
    ]);
    expect(args.focusPatterns).toEqual(['auth', 'payments']);
  });

  it('should parse single --focus pattern', () => {
    const args = parseCliArgs([
      'node', 'script', 'audit',
      '--focus', '/admin/*',
      '--url', 'http://localhost:3000',
      '--codebase-path', '/tmp/test',
    ]);
    expect(args.focusPatterns).toEqual(['/admin/*']);
  });

  it('should handle missing --issue for verify command without crashing in parsing', () => {
    const args = parseCliArgs([
      'node', 'script', 'verify',
      '--url', 'http://localhost:3000',
      '--codebase-path', '/tmp/test',
    ]);
    expect(args.issue).toBeUndefined();
  });

  it('should parse browser option', () => {
    const args = parseCliArgs([
      'node', 'script', 'audit',
      '--browser', 'none',
      '--url', 'http://localhost:3000',
      '--codebase-path', '/tmp/test',
    ]);
    expect(args.browser).toBe('none');
  });

  it('should parse --url and --codebase-path for verify', () => {
    const args = parseCliArgs([
      'node', 'script', 'verify',
      '--issue', '7',
      '--url', 'http://localhost:8080',
      '--codebase-path', '/home/user/project',
    ]);
    expect(args.url).toBe('http://localhost:8080');
    expect(args.codebasePath).toBe('/home/user/project');
    expect(args.issue).toBe('7');
  });
});

// ---------------------------------------------------------------------------
// Focus mode tests
// ---------------------------------------------------------------------------

describe('focused audit mode', () => {
  it('should flow focus patterns through buildConfig', () => {
    const config = buildConfig({
      url: 'http://localhost:3000',
      codebasePath: '/tmp/test',
      focusPatterns: ['auth', '/admin/*'],
    });

    expect(config.focusPatterns).toEqual(['auth', '/admin/*']);
  });

  it('filterRoutes should reduce routes based on focus patterns', () => {
    const routes = [
      { path: '/login' },
      { path: '/admin/users' },
      { path: '/admin/settings' },
      { path: '/api/health' },
      { path: '/public/about' },
    ];

    const filtered = filterRoutes(routes, ['/admin/*']);

    expect(filtered).toHaveLength(2);
    expect(filtered[0].path).toBe('/admin/users');
    expect(filtered[1].path).toBe('/admin/settings');
  });

  it('filterRoutes with keyword pattern', () => {
    const routes = [
      { path: '/user-profile' },
      { path: '/user-settings' },
      { path: '/admin-panel' },
    ];

    const filtered = filterRoutes(routes, ['user']);

    expect(filtered).toHaveLength(2);
  });

  it('filterForms should filter by action URL', () => {
    const forms = [
      { action: '/admin/save', id: 'admin-form' },
      { action: '/public/contact', id: 'contact-form' },
    ];

    const filtered = filterForms(forms, ['/admin/*']);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('admin-form');
  });

  it('applyFocusFilter should return summary', () => {
    const routes = [
      { path: '/admin/users' },
      { path: '/admin/settings' },
      { path: '/api/status' },
    ];
    const forms = [
      { action: '/admin/save', id: 'admin-form' },
      { action: '/public/contact', id: 'contact-form' },
    ];

    const result = applyFocusFilter(routes, forms, ['/admin/*', 'admin']);

    expect(result.summary.originalRoutes).toBe(3);
    expect(result.summary.filteredRoutes).toBe(2);
    expect(result.summary.originalForms).toBe(2);
    expect(result.summary.filteredForms).toBe(1);
  });

  it('no focus patterns should pass everything through', () => {
    const routes = [{ path: '/a' }, { path: '/b' }, { path: '/c' }];
    const forms = [{ action: '/x', id: 'form-x' }];

    const result = applyFocusFilter(routes, forms, []);

    expect(result.routes).toHaveLength(3);
    expect(result.forms).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Audit mode structure tests
// ---------------------------------------------------------------------------

describe('audit modes structure', () => {
  it('full mode: should include all 14 phases', () => {
    const allPhases = getPhasesByOrder();

    expect(allPhases.length).toBe(14);
    expect(allPhases.map((p) => p.id)).toContain('preflight');
    expect(allPhases.map((p) => p.id)).toContain('verification');
    expect(allPhases.map((p) => p.id)).toContain('polish');
  });

  it('full mode: phases should be in correct pipeline order', () => {
    const allPhases = getPhasesByOrder();

    // First phase should be preflight (order 0)
    expect(allPhases[0].id).toBe('preflight');

    // Last phase should be polish (order 10)
    expect(allPhases[allPhases.length - 1].id).toBe('polish');

    // Orders should be non-decreasing
    for (let i = 1; i < allPhases.length; i++) {
      expect(allPhases[i].pipelineOrder).toBeGreaterThanOrEqual(
        allPhases[i - 1].pipelineOrder,
      );
    }
  });

  it('verification phase should be browser-claude type', () => {
    const allPhases = getPhasesByOrder();
    const verification = allPhases.find((p) => p.id === 'verification');

    expect(verification).toBeDefined();
    expect(verification!.phaseType).toBe('browser-claude');
    expect(verification!.requiresBrowser).toBe(true);
    expect(verification!.promptPath).toBe('prompts/phase-9-verification.md');
  });
});

// ---------------------------------------------------------------------------
// runVerify tests (with mocked dependencies)
// ---------------------------------------------------------------------------

describe('runVerify finding loading', () => {
  let tempDir: string;
  let auditDir: string;
  let findingDir: string;
  let issuesDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
    auditDir = path.join(tempDir, '.complete-agent', 'audits', 'current');
    findingDir = path.join(auditDir, 'findings');
    issuesDir = path.join(auditDir, 'issues');
    fs.mkdirSync(findingDir, { recursive: true });
    fs.mkdirSync(issuesDir, { recursive: true });
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  // Mock the heavy dependencies to avoid timeouts and external API calls
  function mockDependencies() {
    // Mock Anthropic SDK client to avoid real API calls
    vi.mock('../../src/llm/anthropic-client', () => ({
      createAnthropicClient: () => ({
        complete: async () => ({
          content: JSON.stringify({ findingId: 'mock', status: 'still_broken', notes: 'Mocked LLM verification', attempts: 1 }),
          inputTokens: 100,
          outputTokens: 50,
          model: 'claude-sonnet-4-5-20250929',
          stopReason: 'end_turn',
        }),
        stream: async function* () {
          yield { type: 'done' as const, response: { content: '{}', inputTokens: 0, outputTokens: 0, model: 'mock', stopReason: 'end_turn' } };
        },
      }),
    }));

    // Mock prompt loader to avoid file system reads for prompts
    vi.mock('../../src/llm/prompt-loader', () => ({
      loadPrompt: () => 'Mocked verification prompt template',
    }));

    // Mock PlaywrightBrowser to avoid actual browser launch
    vi.mock('../../src/playwright-browser', () => ({
      PlaywrightBrowser: class {
        async launch() {}
        async close() {}
        async visitPage() {
          return { url: '', title: '', html: '', text: '', links: [], forms: [], statusCode: 200, screenshot: null };
        }
      },
      DEFAULT_VIEWPORTS: [],
    }));
  }

  it('should return cannot_verify for missing finding', async () => {
    mockDependencies();
    const { runVerify } = await import('../../src/orchestrator');

    const config = {
      url: 'http://localhost:3000',
      codebasePath: tempDir,
      mode: 'full' as const,
      parallel: false,
      nonInteractive: true,
      browser: 'none' as const,
      maxPages: 50,
      maxForms: 20,
      maxBudgetUsd: 10,
      maxPhaseBudgetUsd: 2,
      timeoutPerPhase: 10,
      resume: false,
      cleanup: false,
      auditId: 'test-verify',
    };

    const result = await runVerify(config, 'NONEXISTENT');

    expect(result.findingId).toBe('NONEXISTENT');
    expect(result.status).toBe('cannot_verify');
    expect(result.error).toContain('Finding not found');
    expect(result.reproductionAttempts).toBe(0);
  });

  it('should return cannot_verify when no reproduction steps', async () => {
    fs.writeFileSync(
      path.join(findingDir, 'F-002.json'),
      JSON.stringify({
        id: 'F-002',
        title: 'Missing feature',
        reproduction_steps: [],
      }),
    );

    mockDependencies();
    const { runVerify } = await import('../../src/orchestrator');

    const config = {
      url: 'http://localhost:3000',
      codebasePath: tempDir,
      mode: 'full' as const,
      parallel: false,
      nonInteractive: true,
      browser: 'none' as const,
      maxPages: 50,
      maxForms: 20,
      maxBudgetUsd: 10,
      maxPhaseBudgetUsd: 2,
      timeoutPerPhase: 10,
      resume: false,
      cleanup: false,
      auditId: 'test-verify',
    };

    const result = await runVerify(config, 'F-002');

    expect(result.findingId).toBe('F-002');
    expect(result.status).toBe('cannot_verify');
    expect(result.notes).toContain('No reproduction steps');
  });

  it('should find a finding by direct ID and attempt verification', async () => {
    fs.writeFileSync(
      path.join(findingDir, 'F-001.json'),
      JSON.stringify({
        id: 'F-001',
        title: 'Login button broken',
        url: 'http://localhost:3000/login',
        reproduction_steps: ['Navigate to /login', 'Click login button', 'Observe error'],
      }),
    );

    mockDependencies();
    const { runVerify } = await import('../../src/orchestrator');

    const config = {
      url: 'http://localhost:3000',
      codebasePath: tempDir,
      mode: 'full' as const,
      parallel: false,
      nonInteractive: true,
      browser: 'none' as const,
      maxPages: 50,
      maxForms: 20,
      maxBudgetUsd: 10,
      maxPhaseBudgetUsd: 2,
      timeoutPerPhase: 10,
      resume: false,
      cleanup: false,
      auditId: 'test-verify',
    };

    const result = await runVerify(config, 'F-001');

    expect(result.findingId).toBe('F-001');
    // Should not be 'cannot_verify' with "Finding not found" error
    expect(result.error ?? '').not.toContain('Finding not found');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should find a finding via issue number lookup', async () => {
    fs.writeFileSync(
      path.join(findingDir, 'F-010.json'),
      JSON.stringify({
        id: 'F-010',
        title: 'Cart total wrong',
        url: 'http://localhost:3000/cart',
        reproduction_steps: ['Add item to cart', 'Check total'],
      }),
    );

    fs.writeFileSync(
      path.join(issuesDir, 'issue-42.json'),
      JSON.stringify({
        issue_number: 42,
        finding_id: 'F-010',
        title: 'Cart total wrong',
      }),
    );

    mockDependencies();
    const { runVerify } = await import('../../src/orchestrator');

    const config = {
      url: 'http://localhost:3000',
      codebasePath: tempDir,
      mode: 'full' as const,
      parallel: false,
      nonInteractive: true,
      browser: 'none' as const,
      maxPages: 50,
      maxForms: 20,
      maxBudgetUsd: 10,
      maxPhaseBudgetUsd: 2,
      timeoutPerPhase: 10,
      resume: false,
      cleanup: false,
      auditId: 'test-verify',
    };

    const result = await runVerify(config, '42');

    // Should resolve via issue -> finding_id -> finding file
    expect(result.findingId).toBe('F-010');
    expect(result.error ?? '').not.toContain('Finding not found');
  });

  it('should save verification result to disk', async () => {
    fs.writeFileSync(
      path.join(findingDir, 'F-030.json'),
      JSON.stringify({
        id: 'F-030',
        title: 'Button missing',
        url: 'http://localhost:3000/page',
        reproduction_steps: ['Go to page', 'Look for button'],
      }),
    );

    mockDependencies();
    const { runVerify } = await import('../../src/orchestrator');

    const config = {
      url: 'http://localhost:3000',
      codebasePath: tempDir,
      mode: 'full' as const,
      parallel: false,
      nonInteractive: true,
      browser: 'none' as const,
      maxPages: 50,
      maxForms: 20,
      maxBudgetUsd: 10,
      maxPhaseBudgetUsd: 2,
      timeoutPerPhase: 10,
      resume: false,
      cleanup: false,
      auditId: 'test-verify',
    };

    await runVerify(config, 'F-030');

    // Check that a verification result file was written
    const verifyResultPath = path.join(auditDir, 'verify-F-030.json');
    expect(fs.existsSync(verifyResultPath)).toBe(true);

    const resultData = JSON.parse(fs.readFileSync(verifyResultPath, 'utf-8'));
    expect(resultData.findingId).toBe('F-030');
    expect(resultData.verifiedAt).toBeDefined();
    expect(resultData.status).toBeDefined();
  });

  it('should find finding via created-issues.json', async () => {
    fs.writeFileSync(
      path.join(findingDir, 'F-020.json'),
      JSON.stringify({
        id: 'F-020',
        title: 'Search broken',
        url: 'http://localhost:3000/search',
        reproduction_steps: ['Type in search box', 'Press enter', 'See error'],
      }),
    );

    fs.writeFileSync(
      path.join(auditDir, 'created-issues.json'),
      JSON.stringify({
        issues: [
          { issue_number: 99, finding_id: 'F-020', created_at: '2026-02-08T00:00:00Z' },
        ],
      }),
    );

    mockDependencies();
    const { runVerify } = await import('../../src/orchestrator');

    const config = {
      url: 'http://localhost:3000',
      codebasePath: tempDir,
      mode: 'full' as const,
      parallel: false,
      nonInteractive: true,
      browser: 'none' as const,
      maxPages: 50,
      maxForms: 20,
      maxBudgetUsd: 10,
      maxPhaseBudgetUsd: 2,
      timeoutPerPhase: 10,
      resume: false,
      cleanup: false,
      auditId: 'test-verify',
    };

    const result = await runVerify(config, '99');

    expect(result.findingId).toBe('F-020');
    expect(result.error ?? '').not.toContain('Finding not found');
  });

  it('should handle verify result with proper shape', async () => {
    fs.writeFileSync(
      path.join(findingDir, 'F-099.json'),
      JSON.stringify({
        id: 'F-099',
        title: 'Test finding',
        reproduction_steps: ['Step 1', 'Step 2'],
      }),
    );

    mockDependencies();
    const { runVerify } = await import('../../src/orchestrator');

    const config = {
      url: 'http://localhost:3000',
      codebasePath: tempDir,
      mode: 'full' as const,
      parallel: false,
      nonInteractive: true,
      browser: 'none' as const,
      maxPages: 50,
      maxForms: 20,
      maxBudgetUsd: 10,
      maxPhaseBudgetUsd: 2,
      timeoutPerPhase: 10,
      resume: false,
      cleanup: false,
      auditId: 'test-verify',
    };

    const result = await runVerify(config, 'F-099');

    expect(result).toHaveProperty('findingId');
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('durationMs');
    expect(result).toHaveProperty('reproductionAttempts');
    expect(['fixed', 'still_broken', 'new_error', 'cannot_verify']).toContain(
      result.status,
    );
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
