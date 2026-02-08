/**
 * Browser Session Management - Configures Chrome MCP for SDK calls.
 *
 * Handles browser-specific setup for phases that need web access:
 * creating fresh tabs, handling chrome-extension:// errors, and
 * integrating with the BrowserQueue for serialized access.
 *
 * @module phases/browser-session
 */

import type { BrowserQueue, BrowserLease } from '../browser-queue';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrowserSessionConfig {
  provider: 'chrome' | 'playwright' | 'none';
  browserQueue?: BrowserQueue;
}

export interface BrowserSession {
  lease: BrowserLease | null;
  mcpConfig: McpServerConfig | null;
  release: () => void;
}

export interface McpServerConfig {
  name: string;
  type: 'chrome' | 'playwright';
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Acquire a browser session for a phase.
 *
 * If the phase needs browser access, acquires a lease from the BrowserQueue
 * and returns the MCP server configuration for the SDK call.
 *
 * @param sessionConfig - Browser session configuration.
 * @returns A session with lease and MCP config.
 */
export async function acquireBrowserSession(
  sessionConfig: BrowserSessionConfig,
): Promise<BrowserSession> {
  if (sessionConfig.provider === 'none') {
    return { lease: null, mcpConfig: null, release: () => {} };
  }

  let lease: BrowserLease | null = null;

  // Acquire browser lease if queue is available
  if (sessionConfig.browserQueue) {
    lease = await sessionConfig.browserQueue.acquire();
  }

  // Build MCP server configuration
  const mcpConfig = buildMcpConfig(sessionConfig.provider);

  return {
    lease,
    mcpConfig,
    release: () => {
      if (lease && sessionConfig.browserQueue) {
        sessionConfig.browserQueue.release(lease);
      }
    },
  };
}

/**
 * Build MCP server configuration for Chrome or Playwright.
 */
function buildMcpConfig(provider: 'chrome' | 'playwright'): McpServerConfig {
  if (provider === 'chrome') {
    return {
      name: 'chrome-mcp',
      type: 'chrome',
      config: {
        // Chrome MCP extension connects via native messaging
        tools: [
          'navigate',
          'read_page',
          'screenshot',
          'find',
          'javascript_tool',
          'computer',
          'form_input',
        ],
      },
    };
  }

  // Playwright MCP
  return {
    name: 'playwright-mcp',
    type: 'playwright',
    config: {
      headless: true,
      tools: [
        'navigate',
        'read_page',
        'screenshot',
        'find',
        'evaluate',
      ],
    },
  };
}

/**
 * Retry wrapper for browser operations that may hit
 * chrome-extension:// errors.
 *
 * @param fn - The async function to retry.
 * @param maxRetries - Maximum retry attempts (default 3).
 * @param delayMs - Delay between retries in ms (default 3000).
 * @returns The function's result.
 */
export async function withBrowserRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 3000,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const msg = lastError.message.toLowerCase();

      // chrome-extension:// error is retryable
      if (msg.includes('chrome-extension') || msg.includes('cannot access')) {
        console.warn(
          `[BrowserSession] Chrome extension error (attempt ${attempt + 1}/${maxRetries + 1}): ${lastError.message}`,
        );
        if (attempt < maxRetries) {
          await sleep(delayMs);
          continue;
        }
      }

      // Non-retryable error
      throw lastError;
    }
  }

  throw lastError ?? new Error('Browser operation failed after retries');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
