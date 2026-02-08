/**
 * Tests for Claude Subprocess SDK
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClaudeSubprocess, interpolatePrompt } from '../../src/claude-subprocess';
import * as child_process from 'node:child_process';

// Mock child_process.exec
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

// Mock util.promisify to wrap our mock
vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:util')>();
  return {
    ...actual,
    promisify: (fn: Function) => {
      return (...args: any[]) =>
        new Promise((resolve, reject) => {
          fn(...args, (err: Error | null, result: any) => {
            if (err) reject(err);
            else resolve(result);
          });
        });
    },
  };
});

describe('interpolatePrompt', () => {
  it('should replace simple placeholders', () => {
    const result = interpolatePrompt('Hello {{name}}!', { name: 'World' });
    expect(result).toBe('Hello World!');
  });

  it('should replace multiple placeholders', () => {
    const result = interpolatePrompt('{{a}} and {{b}}', { a: 'foo', b: 'bar' });
    expect(result).toBe('foo and bar');
  });

  it('should replace missing keys with empty string', () => {
    const result = interpolatePrompt('Hello {{name}}!', {});
    expect(result).toBe('Hello !');
  });

  it('should JSON-stringify non-string values', () => {
    const result = interpolatePrompt('Data: {{data}}', { data: { key: 'value' } });
    expect(result).toBe('Data: {"key":"value"}');
  });

  it('should handle null and undefined values', () => {
    const result = interpolatePrompt('{{a}} {{b}}', { a: null, b: undefined });
    expect(result).toBe(' ');
  });

  it('should leave text without placeholders unchanged', () => {
    const result = interpolatePrompt('No placeholders here', { key: 'value' });
    expect(result).toBe('No placeholders here');
  });

  it('should handle numeric values', () => {
    const result = interpolatePrompt('Count: {{n}}', { n: 42 });
    expect(result).toBe('Count: 42');
  });

  it('should handle boolean values', () => {
    const result = interpolatePrompt('Flag: {{flag}}', { flag: true });
    expect(result).toBe('Flag: true');
  });
});

describe('createClaudeSubprocess', () => {
  const mockExec = child_process.exec as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return an object with executePrompt method', () => {
    const sdk = createClaudeSubprocess();
    expect(sdk).toHaveProperty('executePrompt');
    expect(typeof sdk.executePrompt).toBe('function');
  });

  it('should execute prompt and return success response', async () => {
    mockExec.mockImplementation(
      (_cmd: string, _opts: any, cb: Function) => {
        cb(null, { stdout: 'Claude response text\n', stderr: '' });
      },
    );

    const sdk = createClaudeSubprocess();
    const result = await sdk.executePrompt('Hello');

    expect(result.success).toBe(true);
    expect(result.output).toBe('Claude response text');
    expect(result.cost).toBe(0);
    expect(result.tokensUsed).toBeGreaterThan(0);
  });

  it('should pass the correct command with model', async () => {
    mockExec.mockImplementation(
      (_cmd: string, _opts: any, cb: Function) => {
        cb(null, { stdout: 'ok', stderr: '' });
      },
    );

    const sdk = createClaudeSubprocess({ model: 'claude-opus-4-6' });
    await sdk.executePrompt('Test prompt');

    expect(mockExec).toHaveBeenCalledTimes(1);
    const cmd = mockExec.mock.calls[0][0];
    expect(cmd).toContain('--print');
    expect(cmd).toContain('--model');
    expect(cmd).toContain('claude-opus-4-6');
    expect(cmd).toContain('Test prompt');
  });

  it('should interpolate context into prompt', async () => {
    mockExec.mockImplementation(
      (_cmd: string, _opts: any, cb: Function) => {
        cb(null, { stdout: 'ok', stderr: '' });
      },
    );

    const sdk = createClaudeSubprocess();
    await sdk.executePrompt('Analyze {{url}}', { url: 'http://localhost:3000' });

    const cmd = mockExec.mock.calls[0][0];
    expect(cmd).toContain('Analyze http://localhost:3000');
  });

  it('should handle timeout error', async () => {
    mockExec.mockImplementation(
      (_cmd: string, _opts: any, cb: Function) => {
        const err = Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM' });
        cb(err);
      },
    );

    const sdk = createClaudeSubprocess({ timeoutMs: 5000 });
    const result = await sdk.executePrompt('Long prompt');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Timeout');
  });

  it('should handle CLI not found error', async () => {
    mockExec.mockImplementation(
      (_cmd: string, _opts: any, cb: Function) => {
        const err = Object.assign(new Error('command not found'), { code: 127 });
        cb(err);
      },
    );

    const sdk = createClaudeSubprocess();
    const result = await sdk.executePrompt('Hello');

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should handle generic execution error', async () => {
    mockExec.mockImplementation(
      (_cmd: string, _opts: any, cb: Function) => {
        cb(new Error('Something went wrong'));
      },
    );

    const sdk = createClaudeSubprocess();
    const result = await sdk.executePrompt('Hello');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Something went wrong');
  });

  it('should use custom CLI binary path', async () => {
    mockExec.mockImplementation(
      (_cmd: string, _opts: any, cb: Function) => {
        cb(null, { stdout: 'ok', stderr: '' });
      },
    );

    const sdk = createClaudeSubprocess({ cliBin: '/usr/local/bin/claude' });
    await sdk.executePrompt('Test');

    const cmd = mockExec.mock.calls[0][0];
    expect(cmd).toContain('/usr/local/bin/claude');
  });

  it('should warn on stderr output', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockExec.mockImplementation(
      (_cmd: string, _opts: any, cb: Function) => {
        cb(null, { stdout: 'response', stderr: 'warning message' });
      },
    );

    const sdk = createClaudeSubprocess();
    const result = await sdk.executePrompt('Hello');

    expect(result.success).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('warning message'),
    );

    warnSpy.mockRestore();
  });

  it('should shell-escape prompts with special characters', async () => {
    mockExec.mockImplementation(
      (_cmd: string, _opts: any, cb: Function) => {
        cb(null, { stdout: 'ok', stderr: '' });
      },
    );

    const sdk = createClaudeSubprocess();
    await sdk.executePrompt("What's the time?");

    const cmd = mockExec.mock.calls[0][0];
    // Should contain escaped single quote
    expect(cmd).toContain("'\\''");
  });
});
