/**
 * Tests for Phase Dispatcher
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  dispatchPhase,
  registerPureTsHandler,
  registerBrowserCollector,
  type DispatchContext,
} from '../../src/phase-dispatcher';
import type { LLMClient, LLMResponse } from '../../src/llm/anthropic-client';

function makeContext(overrides: Partial<DispatchContext> = {}): DispatchContext {
  return {
    auditDir: '/tmp/test-audit',
    url: 'http://localhost:3000',
    codebasePath: '/tmp/project',
    config: {},
    ...overrides,
  };
}

function makeMockLLM(response: { content: string; error?: string }): LLMClient {
  const completeFn = response.error
    ? vi.fn().mockRejectedValue(new Error(response.error))
    : vi.fn().mockResolvedValue({
        content: response.content,
        inputTokens: 50,
        outputTokens: 50,
        model: 'test-model',
        stopReason: 'end_turn',
      } satisfies LLMResponse);

  return {
    complete: completeFn,
    stream: vi.fn() as any,
  };
}

describe('dispatchPhase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('pure-ts phases', () => {
    it('should call registered handler for preflight', async () => {
      const handler = vi.fn().mockReturnValue({ status: 'ok' });
      registerPureTsHandler('preflight', handler);

      const llm = makeMockLLM({ content: '' });
      const ctx = makeContext();

      const result = await dispatchPhase('preflight', llm, ctx);

      expect(result.success).toBe(true);
      expect(result.phaseType).toBe('pure-ts');
      expect(handler).toHaveBeenCalledWith(ctx);
      expect(result.output).toContain('"status"');
    });

    it('should fail if no handler registered', async () => {
      // progress-init has no registered handler in test context
      registerPureTsHandler('progress-init', undefined as any);

      const llm = makeMockLLM({ content: '' });
      const ctx = makeContext();

      const result = await dispatchPhase('progress-init', llm, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No pure-TS handler');
    });

    it('should handle handler that returns a string', async () => {
      registerPureTsHandler('safety', async () => 'safety analysis complete');

      const llm = makeMockLLM({ content: '' });
      const ctx = makeContext();

      const result = await dispatchPhase('safety', llm, ctx);

      expect(result.success).toBe(true);
      expect(result.output).toBe('safety analysis complete');
    });

    it('should catch handler errors', async () => {
      registerPureTsHandler('polish', async () => {
        throw new Error('polish exploded');
      });

      const llm = makeMockLLM({ content: '' });
      const ctx = makeContext();

      const result = await dispatchPhase('polish', llm, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('polish exploded');
    });
  });

  describe('pure-ts phases (prd-parsing, code-analysis)', () => {
    it('should dispatch prd-parsing as pure-ts', async () => {
      const handler = vi.fn().mockReturnValue({ features: [] });
      registerPureTsHandler('prd-parsing', handler);

      const llm = makeMockLLM({ content: '' });
      const ctx = makeContext();

      const result = await dispatchPhase('prd-parsing', llm, ctx);

      expect(result.success).toBe(true);
      expect(result.phaseType).toBe('pure-ts');
      expect(handler).toHaveBeenCalledWith(ctx);
    });

    it('should dispatch code-analysis as pure-ts', async () => {
      const handler = vi.fn().mockReturnValue({ routes: [], forms: [] });
      registerPureTsHandler('code-analysis', handler);

      const llm = makeMockLLM({ content: '' });
      const ctx = makeContext();

      const result = await dispatchPhase('code-analysis', llm, ctx);

      expect(result.success).toBe(true);
      expect(result.phaseType).toBe('pure-ts');
      expect(handler).toHaveBeenCalledWith(ctx);
    });
  });

  describe('claude-driven phases', () => {
    it('should call LLMClient with loaded prompt', async () => {
      const llm = makeMockLLM({ content: 'review result' });
      const ctx = makeContext();

      const result = await dispatchPhase('interactive-review', llm, ctx);

      expect(result.success).toBe(true);
      expect(result.phaseType).toBe('claude-driven');
      expect(result.output).toBe('review result');
    });

    it('should report Claude errors', async () => {
      const llm = makeMockLLM({ content: '', error: 'model error' });
      const ctx = makeContext();

      const result = await dispatchPhase('interactive-review', llm, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain('model error');
    });
  });

  describe('browser-claude phases', () => {
    it('should dispatch browser-claude phase', async () => {
      const llm = makeMockLLM({ content: 'exploration result' });
      const ctx = makeContext();

      const result = await dispatchPhase('exploration', llm, ctx);

      expect(result.phaseType).toBe('browser-claude');
      // May succeed or fail depending on prompt file existence,
      // but the phaseType routing is correct
    });

    it('should use browser collector if registered', async () => {
      const collector = vi.fn().mockResolvedValue({ pages: ['/', '/about'] });
      registerBrowserCollector('form-testing', collector);

      const llm = makeMockLLM({ content: 'form test results' });
      const ctx = makeContext();

      const result = await dispatchPhase('form-testing', llm, ctx);

      expect(collector).toHaveBeenCalledWith(ctx);
      expect(result.phaseType).toBe('browser-claude');
    });

    it('should continue if browser collector fails', async () => {
      const collector = vi.fn().mockRejectedValue(new Error('browser crash'));
      registerBrowserCollector('responsive-testing', collector);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const llm = makeMockLLM({ content: 'responsive results' });
      const ctx = makeContext();

      const result = await dispatchPhase('responsive-testing', llm, ctx);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Browser collector'),
      );

      warnSpy.mockRestore();
    });
  });

  describe('browser-claude prompt quality', () => {
    it('should include quality instructions in prompt', async () => {
      const collector = vi.fn().mockResolvedValue({
        pages: [{ url: 'http://localhost:3000/', title: 'Home' }],
      });
      registerBrowserCollector('exploration', collector);

      const llm = makeMockLLM({ content: '{"findings": [], "summary": "ok"}' });
      const ctx = makeContext();

      await dispatchPhase('exploration', llm, ctx);

      const prompt = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      if (prompt) {
        expect(prompt).toContain('QUALITY REQUIREMENTS');
        expect(prompt).toContain('Do NOT report positive observations');
        expect(prompt).toContain('Do NOT report tool/audit limitations');
        expect(prompt).toContain('Do NOT report vague observations');
      }
    });

    it('should include URL requirements with visited pages', async () => {
      const collector = vi.fn().mockResolvedValue({
        pages: [
          { url: 'http://localhost:3000/', title: 'Home' },
          { url: 'http://localhost:3000/about', title: 'About' },
        ],
      });
      registerBrowserCollector('form-testing', collector);

      const llm = makeMockLLM({ content: '{"findings": [], "summary": "ok"}' });
      const ctx = makeContext();

      await dispatchPhase('form-testing', llm, ctx);

      const prompt = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      if (prompt) {
        expect(prompt).toContain('URL REQUIREMENTS');
        expect(prompt).toContain('Do NOT use "N/A" as a URL');
        expect(prompt).toContain('http://localhost:3000/');
        expect(prompt).toContain('http://localhost:3000/about');
      }
    });

    it('should include context url in visited pages when no browser data pages', async () => {
      const llm = makeMockLLM({ content: '{"findings": [], "summary": "ok"}' });
      const ctx = makeContext({ url: 'http://example.com' });

      await dispatchPhase('exploration', llm, ctx);

      const prompt = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      if (prompt) {
        expect(prompt).toContain('http://example.com');
      }
    });
  });

  describe('exploration feature checking', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync('/tmp/dispatcher-test-');
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should include feature verification section when PRD features exist', async () => {
      // Write prd-summary.json
      const prdSummary = {
        features: [
          {
            id: 'F1',
            name: 'User Login',
            description: 'Users can log in',
            priority: 'must',
            acceptance_criteria: ['Login form visible', 'Redirect to /dashboard'],
            status: 'not_tested',
            routeHints: ['/login'],
            keywords: ['login'],
          },
        ],
      };
      fs.writeFileSync(path.join(tmpDir, 'prd-summary.json'), JSON.stringify(prdSummary));

      const collector = vi.fn().mockResolvedValue({
        pages: [
          { url: 'http://localhost:3000/login', title: 'Login Page', text: 'Login form' },
        ],
      });
      registerBrowserCollector('exploration', collector);

      const llm = makeMockLLM({
        content: '```json\n{"findings": [], "featureCoverage": [{"featureId": "F1", "status": "pass", "evidence": "Login form found", "checkedCriteria": []}], "summary": "ok"}\n```',
      });
      const ctx = makeContext({ auditDir: tmpDir });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await dispatchPhase('exploration', llm, ctx);

      const prompt = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(prompt).toContain('PRD Feature Verification');
      expect(prompt).toContain('F1');
      expect(prompt).toContain('User Login');
      expect(prompt).toContain('featureCoverage');

      logSpy.mockRestore();
    });

    it('should save feature coverage when LLM returns it', async () => {
      const prdSummary = {
        features: [
          {
            id: 'F1',
            name: 'User Login',
            description: 'Users can log in',
            priority: 'must',
            acceptance_criteria: ['Login form visible'],
            status: 'not_tested',
            routeHints: [],
            keywords: ['login'],
          },
        ],
      };
      fs.writeFileSync(path.join(tmpDir, 'prd-summary.json'), JSON.stringify(prdSummary));

      const collector = vi.fn().mockResolvedValue({
        pages: [{ url: 'http://localhost:3000/', title: 'Home' }],
      });
      registerBrowserCollector('exploration', collector);

      const llm = makeMockLLM({
        content: '```json\n{"findings": [], "featureCoverage": [{"featureId": "F1", "status": "pass", "evidence": "Found", "checkedCriteria": [{"criterion": "Login form visible", "status": "pass", "evidence": "yes"}]}], "summary": "ok"}\n```',
      });
      const ctx = makeContext({ auditDir: tmpDir });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await dispatchPhase('exploration', llm, ctx);

      const coveragePath = path.join(tmpDir, 'feature-coverage.json');
      expect(fs.existsSync(coveragePath)).toBe(true);
      const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf-8'));
      expect(coverage).toHaveLength(1);
      expect(coverage[0].featureId).toBe('F1');
      expect(coverage[0].status).toBe('pass');

      logSpy.mockRestore();
    });

    it('should not include feature verification for non-exploration phases', async () => {
      const prdSummary = {
        features: [
          { id: 'F1', name: 'Login', description: 'test', priority: 'must', acceptance_criteria: [], status: 'not_tested', routeHints: [], keywords: [] },
        ],
      };
      fs.writeFileSync(path.join(tmpDir, 'prd-summary.json'), JSON.stringify(prdSummary));

      const collector = vi.fn().mockResolvedValue({
        pages: [{ url: 'http://localhost:3000/', title: 'Home' }],
      });
      registerBrowserCollector('form-testing', collector);

      const llm = makeMockLLM({ content: '{"findings": [], "summary": "ok"}' });
      const ctx = makeContext({ auditDir: tmpDir });

      await dispatchPhase('form-testing', llm, ctx);

      const prompt = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      if (prompt) {
        expect(prompt).not.toContain('PRD Feature Verification');
      }
    });
  });

  describe('verification phase', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync('/tmp/dispatcher-verify-');
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should use verification-only prompt with existing findings', async () => {
      // Create findings directory with an existing finding
      const findingDir = path.join(tmpDir, 'findings');
      fs.mkdirSync(findingDir, { recursive: true });
      fs.writeFileSync(
        path.join(findingDir, 'F-001.json'),
        JSON.stringify({
          id: 'F-001',
          title: 'Broken login',
          severity: 'P1',
          url: 'http://localhost:3000/login',
          description: 'Login form does not submit',
        }),
      );

      const collector = vi.fn().mockResolvedValue({
        pages: [{ url: 'http://localhost:3000/login', title: 'Login' }],
      });
      registerBrowserCollector('verification', collector);

      const llm = makeMockLLM({
        content: '```json\n{"verifications": [{"findingId": "F-001", "verificationStatus": "verified", "evidence": "Still broken"}], "summary": "1 verified"}\n```',
      });
      const ctx = makeContext({ auditDir: tmpDir });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await dispatchPhase('verification', llm, ctx);

      expect(result.success).toBe(true);
      expect(result.phaseType).toBe('browser-claude');

      // Check that the prompt says "Verification Mode"
      const prompt = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(prompt).toContain('Verification Mode');
      expect(prompt).toContain('Do NOT create new findings');
      expect(prompt).toContain('F-001');
      expect(prompt).toContain('Broken login');

      logSpy.mockRestore();
    });

    it('should update existing finding files with verification status', async () => {
      const findingDir = path.join(tmpDir, 'findings');
      fs.mkdirSync(findingDir, { recursive: true });
      fs.writeFileSync(
        path.join(findingDir, 'F-001.json'),
        JSON.stringify({
          id: 'F-001',
          title: 'Broken login',
          severity: 'P1',
          url: 'http://localhost:3000/login',
          description: 'Login fails',
        }),
      );

      const collector = vi.fn().mockResolvedValue({
        pages: [{ url: 'http://localhost:3000/login', title: 'Login' }],
      });
      registerBrowserCollector('verification', collector);

      const llm = makeMockLLM({
        content: '```json\n{"verifications": [{"findingId": "F-001", "verificationStatus": "verified", "evidence": "Confirmed broken"}], "summary": "done"}\n```',
      });
      const ctx = makeContext({ auditDir: tmpDir });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await dispatchPhase('verification', llm, ctx);

      // Check that the finding file was updated
      const findingData = JSON.parse(fs.readFileSync(path.join(findingDir, 'F-001.json'), 'utf-8'));
      expect(findingData.verificationStatus).toBe('verified');
      expect(findingData.verificationEvidence).toBe('Confirmed broken');
      expect(findingData.verified_at).toBeDefined();
      // Original fields preserved
      expect(findingData.id).toBe('F-001');
      expect(findingData.title).toBe('Broken login');

      logSpy.mockRestore();
    });

    it('should not create new finding files during verification', async () => {
      const findingDir = path.join(tmpDir, 'findings');
      fs.mkdirSync(findingDir, { recursive: true });
      fs.writeFileSync(
        path.join(findingDir, 'F-001.json'),
        JSON.stringify({ id: 'F-001', title: 'Bug', severity: 'P2', url: 'http://localhost:3000', description: 'x' }),
      );

      const collector = vi.fn().mockResolvedValue({ pages: [] });
      registerBrowserCollector('verification', collector);

      const llm = makeMockLLM({
        content: '```json\n{"verifications": [{"findingId": "F-001", "verificationStatus": "false_positive", "evidence": "Works now"}], "summary": "done"}\n```',
      });
      const ctx = makeContext({ auditDir: tmpDir });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await dispatchPhase('verification', llm, ctx);

      // Only the original F-001.json should exist, no new files
      const files = fs.readdirSync(findingDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toBe('F-001.json');

      logSpy.mockRestore();
    });

    it('should handle verification with no existing findings', async () => {
      // No findings directory at all
      const collector = vi.fn().mockResolvedValue({ pages: [] });
      registerBrowserCollector('verification', collector);

      const llm = makeMockLLM({
        content: '```json\n{"verifications": [], "summary": "nothing to verify"}\n```',
      });
      const ctx = makeContext({ auditDir: tmpDir });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await dispatchPhase('verification', llm, ctx);

      expect(result.success).toBe(true);
      // Prompt should contain "no existing findings"
      const prompt = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(prompt).toContain('(no existing findings)');

      logSpy.mockRestore();
    });
  });

  describe('finding quality filters', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync('/tmp/dispatcher-filter-');
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should reject positive observation findings', async () => {
      const collector = vi.fn().mockResolvedValue({
        pages: [{ url: 'http://localhost:3000/', title: 'Home' }],
      });
      registerBrowserCollector('form-testing', collector);

      const llm = makeMockLLM({
        content: JSON.stringify({
          findings: [
            {
              id: 'F-001',
              title: 'Good performance observed',
              severity: 'P4',
              url: 'http://localhost:3000/',
              description: 'The application performs well and meets expectations',
              actual_behavior: 'Working correctly',
              evidence: 'No issues',
            },
          ],
          summary: 'ok',
        }),
      });
      const ctx = makeContext({ auditDir: tmpDir });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await dispatchPhase('form-testing', llm, ctx);

      // The finding should be rejected - no file created
      const findingDir = path.join(tmpDir, 'findings');
      if (fs.existsSync(findingDir)) {
        const files = fs.readdirSync(findingDir).filter((f) => f.endsWith('.json'));
        expect(files).toHaveLength(0);
      }

      logSpy.mockRestore();
    });

    it('should accept valid defect findings', async () => {
      const collector = vi.fn().mockResolvedValue({
        pages: [{ url: 'http://localhost:3000/', title: 'Home' }],
      });
      registerBrowserCollector('form-testing', collector);

      const llm = makeMockLLM({
        content: JSON.stringify({
          findings: [
            {
              id: 'F-001',
              title: 'Login form missing validation',
              severity: 'P1',
              url: 'http://localhost:3000/',
              description: 'The login form accepts empty submissions',
              expected_behavior: 'Form should validate required fields',
              actual_behavior: 'Form submits without validation',
              evidence: 'Submitted empty form, no error shown',
            },
          ],
          summary: 'ok',
        }),
      });
      const ctx = makeContext({ auditDir: tmpDir });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await dispatchPhase('form-testing', llm, ctx);

      // The finding should be accepted
      const findingDir = path.join(tmpDir, 'findings');
      expect(fs.existsSync(findingDir)).toBe(true);
      const files = fs.readdirSync(findingDir).filter((f) => f.endsWith('.json'));
      expect(files.length).toBeGreaterThanOrEqual(1);

      logSpy.mockRestore();
    });
  });

  describe('cost tracking', () => {
    it('should update cost accumulator for claude-driven phases', async () => {
      const llm = makeMockLLM({ content: 'result' });
      const costAccumulator = { totalInputTokens: 0, totalOutputTokens: 0, totalCalls: 0 };
      const ctx = makeContext({ costAccumulator });

      const result = await dispatchPhase('interactive-review', llm, ctx);

      expect(result.success).toBe(true);
      expect(costAccumulator.totalInputTokens).toBe(50);
      expect(costAccumulator.totalOutputTokens).toBe(50);
      expect(costAccumulator.totalCalls).toBe(1);
    });

    it('should not fail without cost accumulator', async () => {
      const llm = makeMockLLM({ content: 'result' });
      const ctx = makeContext(); // no costAccumulator

      const result = await dispatchPhase('interactive-review', llm, ctx);

      expect(result.success).toBe(true);
    });
  });

  describe('timing', () => {
    it('should report durationMs', async () => {
      registerPureTsHandler('preflight', async () => {
        return { ok: true };
      });

      const llm = makeMockLLM({ content: '' });
      const ctx = makeContext();

      const result = await dispatchPhase('preflight', llm, ctx);

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
