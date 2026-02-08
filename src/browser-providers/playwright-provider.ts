/**
 * Playwright Browser Provider - Alternative to Chrome MCP.
 *
 * Enables headless mode, true parallel tabs, and CI usage.
 * Abstracts browser operations behind the same interface as Chrome MCP.
 *
 * @module browser-providers/playwright-provider
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlaywrightConfig {
  headless: boolean;
  timeout: number;
  viewport: { width: number; height: number };
}

export interface BrowserProvider {
  name: string;
  type: 'chrome' | 'playwright';
  isAvailable: () => Promise<boolean>;
  getConfig: () => Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: PlaywrightConfig = {
  headless: true,
  timeout: 30_000,
  viewport: { width: 1440, height: 900 },
};

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Create a Playwright browser provider.
 *
 * @param config - Optional Playwright configuration overrides.
 * @returns A BrowserProvider instance.
 */
export function createPlaywrightProvider(
  config: Partial<PlaywrightConfig> = {},
): BrowserProvider {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  return {
    name: 'playwright-mcp',
    type: 'playwright',

    /**
     * Check if Playwright is available.
     * Attempts to require the playwright package.
     */
    async isAvailable(): Promise<boolean> {
      try {
        // Dynamic import check - don't require at module load
        // @ts-ignore - playwright is an optional peer dependency
        await import(/* webpackIgnore: true */ 'playwright').catch(() => null);
        return true;
      } catch {
        return false;
      }
    },

    /**
     * Get MCP server configuration for Playwright.
     */
    getConfig(): Record<string, unknown> {
      return {
        type: 'playwright',
        headless: mergedConfig.headless,
        timeout: mergedConfig.timeout,
        viewport: mergedConfig.viewport,
        // Playwright MCP would be configured here when available
        mcpServer: {
          command: 'npx',
          args: ['@anthropic-ai/playwright-mcp'],
          env: {
            HEADLESS: String(mergedConfig.headless),
          },
        },
      };
    },
  };
}

/**
 * Create a Chrome browser provider (default).
 *
 * @returns A BrowserProvider for Chrome MCP extension.
 */
export function createChromeProvider(): BrowserProvider {
  return {
    name: 'chrome-mcp',
    type: 'chrome',

    async isAvailable(): Promise<boolean> {
      // Chrome MCP is available if the extension is installed
      // We can't easily check this from Node, so assume available
      return true;
    },

    getConfig(): Record<string, unknown> {
      return {
        type: 'chrome',
        // Chrome MCP extension connects via native messaging
        // No explicit server config needed - the extension handles it
      };
    },
  };
}

/**
 * Detect the best available browser provider.
 *
 * @param preferred - User's preferred browser type.
 * @returns The appropriate BrowserProvider.
 */
export async function detectBrowserProvider(
  preferred: 'chrome' | 'playwright' | 'none',
): Promise<BrowserProvider | null> {
  if (preferred === 'none') return null;

  if (preferred === 'playwright') {
    const pw = createPlaywrightProvider();
    if (await pw.isAvailable()) return pw;
    console.warn('[Browser] Playwright not available, falling back to Chrome.');
  }

  return createChromeProvider();
}
