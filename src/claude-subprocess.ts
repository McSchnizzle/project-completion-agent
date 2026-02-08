/**
 * Claude Subprocess SDK - Implements ClaudeSDK interface via `claude --print` subprocess.
 *
 * Uses the Claude Code CLI's `--print` flag to execute prompts as a subprocess.
 * On MAX plan, all calls are zero cost. The subprocess approach avoids needing
 * an API key or the @anthropic-ai/sdk dependency for execution.
 *
 * @module claude-subprocess
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ClaudeSDK, SDKResponse } from './sdk-bridge.js';

const execAsync = promisify(exec);

export interface ClaudeSubprocessConfig {
  /** Model to use (default: claude-sonnet-4-20250514) */
  model?: string;
  /** Timeout in milliseconds (default: 120000) */
  timeoutMs?: number;
  /** Path to the claude CLI binary (default: 'claude') */
  cliBin?: string;
}

/**
 * Interpolate `{{variable}}` placeholders in a prompt string.
 *
 * @param template - Prompt template with `{{key}}` placeholders.
 * @param vars - Key-value pairs to substitute.
 * @returns The interpolated string.
 */
export function interpolatePrompt(
  template: string,
  vars: Record<string, unknown>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = vars[key];
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  });
}

/**
 * Estimate token count from a string.
 * Rough heuristic: ~4 chars per token for English text.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Escape a string for safe inclusion in a shell command.
 * Uses single-quote wrapping with escaping of single quotes inside.
 */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Create a ClaudeSDK implementation that calls `claude --print` as a subprocess.
 *
 * @param config - Optional subprocess configuration.
 * @returns An object conforming to the ClaudeSDK interface.
 */
export function createClaudeSubprocess(
  config: ClaudeSubprocessConfig = {},
): ClaudeSDK {
  const model = config.model ?? 'claude-sonnet-4-20250514';
  const timeoutMs = config.timeoutMs ?? 120_000;
  const cliBin = config.cliBin ?? 'claude';

  return {
    async executePrompt(
      prompt: string,
      context?: Record<string, unknown>,
    ): Promise<SDKResponse> {
      // Interpolate context variables into the prompt
      const resolvedPrompt = context
        ? interpolatePrompt(prompt, context)
        : prompt;

      try {
        // Use shell exec with proper escaping for the prompt
        const cmd = `${shellEscape(cliBin)} --print --model ${shellEscape(model)} ${shellEscape(resolvedPrompt)}`;

        const { stdout, stderr } = await execAsync(cmd, {
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024, // 10 MB
          env: { ...process.env },
        });

        if (stderr && stderr.trim().length > 0) {
          console.warn(`[ClaudeSubprocess] stderr: ${stderr.trim()}`);
        }

        const output = stdout.trim();
        const tokensUsed = estimateTokens(resolvedPrompt) + estimateTokens(output);

        return {
          success: true,
          output,
          tokensUsed,
          cost: 0, // MAX plan — zero per-call cost
        };
      } catch (error: unknown) {
        const err = error as Error & { code?: string | number; killed?: boolean; signal?: string };

        // Timeout
        if (err.killed || err.signal === 'SIGTERM') {
          return {
            success: false,
            error: `Timeout after ${timeoutMs}ms`,
          };
        }

        // CLI not found
        if (err.code === 127 || (err.message && err.message.includes('not found'))) {
          return {
            success: false,
            error: `Claude CLI not found at '${cliBin}'. Is it installed and on your PATH?`,
          };
        }

        return {
          success: false,
          error: err.message || String(error),
        };
      }
    },
  };
}
