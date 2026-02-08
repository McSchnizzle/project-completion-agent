/**
 * Integration test: Real Claude subprocess call.
 *
 * This test calls the actual `claude --print` CLI. It is skipped
 * automatically if the `claude` binary is not on PATH or if running
 * inside a nested Claude Code session (which blocks subprocess calls).
 *
 * Run manually with: npx vitest run tests/integration/claude-subprocess.test.ts
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { createClaudeSubprocess } from '../../src/claude-subprocess';

function isClaudeAvailable(): boolean {
  try {
    execSync('which claude', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function isInsideClaudeSession(): boolean {
  // When running inside a Claude Code session, subprocess calls may hang.
  return !!process.env.CLAUDE_CODE_ENTRYPOINT || !!process.env.CLAUDECODE;
}

const canRunIntegration = isClaudeAvailable() && !isInsideClaudeSession();

describe.skipIf(!canRunIntegration)('Claude Subprocess Integration', () => {
  it('should execute a simple prompt and return SDKResponse', async () => {
    const sdk = createClaudeSubprocess({
      timeoutMs: 60_000,
    });

    const result = await sdk.executePrompt(
      'Reply with exactly the word "pong" and nothing else.',
    );

    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
    expect(result.output!.toLowerCase()).toContain('pong');
    expect(result.cost).toBe(0);
    expect(result.tokensUsed).toBeGreaterThan(0);
  }, 90_000);

  it('should handle context interpolation in real call', async () => {
    const sdk = createClaudeSubprocess({
      timeoutMs: 60_000,
    });

    const result = await sdk.executePrompt(
      'What is 2 + {{number}}? Reply with just the number.',
      { number: 3 },
    );

    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
    expect(result.output!).toContain('5');
  }, 90_000);
});
