/**
 * Tests for anthropic-client.ts
 *
 * Tests the LLMClient interface, JSON validation, markdown fence stripping,
 * and factory configuration. Uses mocks for the Anthropic SDK since actual
 * API calls require a key and cost money.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createAnthropicClient,
  stripMarkdownFences,
  validateJsonResponse,
  type LLMClient,
  type LLMResponse,
  type CompletionOptions,
} from '../../src/llm/anthropic-client';

// ---------------------------------------------------------------------------
// Mock the Anthropic SDK
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();
const mockStream = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: mockCreate,
        stream: mockStream,
      };
      constructor(_opts: Record<string, unknown>) {}
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockMessageResponse(content: string, opts?: {
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
  stopReason?: string;
}) {
  return {
    content: [{ type: 'text', text: content }],
    usage: {
      input_tokens: opts?.inputTokens ?? 100,
      output_tokens: opts?.outputTokens ?? 50,
    },
    model: opts?.model ?? 'claude-sonnet-4-5-20250929',
    stop_reason: opts?.stopReason ?? 'end_turn',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('anthropic-client', () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key-123';
    mockCreate.mockReset();
    mockStream.mockReset();
  });

  afterEach(() => {
    if (savedKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = savedKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  describe('createAnthropicClient', () => {
    it('should create a client with default config', () => {
      const client = createAnthropicClient();
      expect(client).toBeDefined();
      expect(typeof client.complete).toBe('function');
      expect(typeof client.stream).toBe('function');
    });

    it('should create a client with explicit API key', () => {
      delete process.env.ANTHROPIC_API_KEY;
      const client = createAnthropicClient({ apiKey: 'explicit-key' });
      expect(client).toBeDefined();
    });

    it('should throw if no API key is available', () => {
      delete process.env.ANTHROPIC_API_KEY;
      expect(() => createAnthropicClient()).toThrow('ANTHROPIC_API_KEY');
    });

    it('should accept custom model', () => {
      const client = createAnthropicClient({ model: 'claude-opus-4-6' });
      expect(client).toBeDefined();
    });
  });

  describe('complete', () => {
    it('should return a valid LLMResponse', async () => {
      mockCreate.mockResolvedValueOnce(
        mockMessageResponse('Hello, world!'),
      );

      const client = createAnthropicClient();
      const response = await client.complete('Say hello');

      expect(response.content).toBe('Hello, world!');
      expect(response.inputTokens).toBe(100);
      expect(response.outputTokens).toBe(50);
      expect(response.model).toBe('claude-sonnet-4-5-20250929');
      expect(response.stopReason).toBe('end_turn');
    });

    it('should pass system prompt to API', async () => {
      mockCreate.mockResolvedValueOnce(
        mockMessageResponse('Analyzed'),
      );

      const client = createAnthropicClient();
      await client.complete('Analyze this', {
        systemPrompt: 'You are an auditor.',
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'You are an auditor.',
        }),
      );
    });

    it('should pass temperature and maxTokens', async () => {
      mockCreate.mockResolvedValueOnce(
        mockMessageResponse('Creative'),
      );

      const client = createAnthropicClient();
      await client.complete('Write something', {
        temperature: 0.7,
        maxTokens: 4096,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
          max_tokens: 4096,
        }),
      );
    });

    it('should use default model from config', async () => {
      mockCreate.mockResolvedValueOnce(
        mockMessageResponse('Result'),
      );

      const client = createAnthropicClient({ model: 'claude-opus-4-6' });
      await client.complete('Test');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-opus-4-6',
        }),
      );
    });

    it('should override default model with per-call option', async () => {
      mockCreate.mockResolvedValueOnce(
        mockMessageResponse('Result', { model: 'claude-haiku-4-5-20251001' }),
      );

      const client = createAnthropicClient({ model: 'claude-sonnet-4-5-20250929' });
      await client.complete('Test', { model: 'claude-haiku-4-5-20251001' });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-haiku-4-5-20251001',
        }),
      );
    });

    it('should add JSON instruction when responseFormat is json', async () => {
      mockCreate.mockResolvedValueOnce(
        mockMessageResponse('{"key": "value"}'),
      );

      const client = createAnthropicClient();
      await client.complete('Return JSON', { responseFormat: 'json' });

      const callArgs = mockCreate.mock.calls[0][0];
      const userMsg = callArgs.messages[0].content;
      expect(userMsg).toContain('IMPORTANT: Respond with valid JSON only');
    });

    it('should validate JSON response when responseFormat is json', async () => {
      mockCreate.mockResolvedValueOnce(
        mockMessageResponse('not valid json'),
      );

      const client = createAnthropicClient();
      await expect(
        client.complete('Return JSON', { responseFormat: 'json' }),
      ).rejects.toThrow('invalid JSON');
    });

    it('should accept valid JSON response', async () => {
      mockCreate.mockResolvedValueOnce(
        mockMessageResponse('{"features": []}'),
      );

      const client = createAnthropicClient();
      const response = await client.complete('Return JSON', {
        responseFormat: 'json',
      });
      expect(response.content).toBe('{"features": []}');
    });

    it('should handle multi-block text responses', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'Part 1. ' },
          { type: 'text', text: 'Part 2.' },
        ],
        usage: { input_tokens: 50, output_tokens: 20 },
        model: 'claude-sonnet-4-5-20250929',
        stop_reason: 'end_turn',
      });

      const client = createAnthropicClient();
      const response = await client.complete('Multi block');
      expect(response.content).toBe('Part 1. Part 2.');
    });

    it('should propagate API errors', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Rate limit exceeded'));

      const client = createAnthropicClient();
      await expect(client.complete('Test')).rejects.toThrow('Rate limit exceeded');
    });
  });

  describe('stripMarkdownFences', () => {
    it('should strip ```json fences', () => {
      expect(stripMarkdownFences('```json\n{"a": 1}\n```')).toBe('{"a": 1}');
    });

    it('should strip plain ``` fences', () => {
      expect(stripMarkdownFences('```\n{"a": 1}\n```')).toBe('{"a": 1}');
    });

    it('should return plain content unchanged', () => {
      expect(stripMarkdownFences('{"a": 1}')).toBe('{"a": 1}');
    });

    it('should trim whitespace', () => {
      expect(stripMarkdownFences('  {"a": 1}  ')).toBe('{"a": 1}');
    });

    it('should handle multiline JSON in fences', () => {
      const fenced = '```json\n{\n  "features": [],\n  "flows": []\n}\n```';
      const expected = '{\n  "features": [],\n  "flows": []\n}';
      expect(stripMarkdownFences(fenced)).toBe(expected);
    });
  });

  describe('validateJsonResponse', () => {
    it('should accept valid JSON', () => {
      expect(() => validateJsonResponse('{"a": 1}')).not.toThrow();
    });

    it('should accept JSON in fences', () => {
      expect(() =>
        validateJsonResponse('```json\n{"a": 1}\n```'),
      ).not.toThrow();
    });

    it('should throw on invalid JSON', () => {
      expect(() => validateJsonResponse('not json')).toThrow('invalid JSON');
    });

    it('should throw on incomplete JSON', () => {
      expect(() => validateJsonResponse('{"a":')).toThrow('invalid JSON');
    });
  });
});
