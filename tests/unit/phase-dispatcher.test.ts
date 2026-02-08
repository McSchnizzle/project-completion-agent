/**
 * Tests for Phase Dispatcher
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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
