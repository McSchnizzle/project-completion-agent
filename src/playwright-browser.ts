/**
 * Playwright Browser - Headless browser wrapper for page data collection.
 *
 * Provides a high-level API for visiting pages, capturing screenshots,
 * extracting DOM data, and testing forms/viewports. Integrates with the
 * existing BrowserQueue for serialized access.
 *
 * V2 enhancements:
 * - SPA detection and DOM stability waiting
 * - Network error collection (4xx/5xx responses)
 * - Console error/warning collection
 * - Enhanced form field extraction (labels, validation attributes)
 * - Auth support via cookie/bearer/form-login
 * - Integration with ScreenshotCapture for managed screenshots
 *
 * Playwright is loaded dynamically so the module degrades gracefully
 * if the dependency is not installed.
 *
 * @module playwright-browser
 */

import { BrowserQueue, type BrowserLease } from './browser-queue.js';
import {
  waitForSPASettle,
  installSPAInterceptors,
  detectSPA,
  type SPAWaitOptions,
} from './browser/spa-handler.js';
import {
  authenticate,
  resolveAuthConfig,
  type AuthConfig,
  type AuthResult,
} from './browser/auth-handler.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PageData {
  url: string;
  title: string;
  html: string;
  text: string;
  links: string[];
  forms: FormData[];
  screenshot?: Buffer;
  consoleMessages: ConsoleMessage[];
  networkErrors: NetworkError[];
  statusCode?: number;
  loadTimeMs?: number;
  isSPA?: boolean;
}

export interface ConsoleMessage {
  type: string;
  text: string;
  timestamp: number;
}

export interface NetworkError {
  url: string;
  status: number;
  statusText: string;
  method: string;
}

export interface FormData {
  action: string;
  method: string;
  id?: string;
  name?: string;
  fields: FormField[];
}

export interface FormField {
  name: string;
  type: string;
  required: boolean;
  placeholder?: string;
  label?: string;
  maxlength?: number;
  minlength?: number;
  pattern?: string;
  min?: string;
  max?: string;
  ariaLabel?: string;
  validationAttributes: string[];
}

export interface ViewportSpec {
  name: string;
  width: number;
  height: number;
}

export const DEFAULT_VIEWPORTS: ViewportSpec[] = [
  { name: 'mobile', width: 375, height: 667 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'wide', width: 1920, height: 1080 },
];

export interface PlaywrightBrowserConfig {
  /** Headless mode (default: true) */
  headless?: boolean;
  /** Navigation timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Whether to capture screenshots (default: true) */
  screenshots?: boolean;
  /** Browser queue for serialized access (optional) */
  browserQueue?: BrowserQueue;
  /** SPA wait strategy options */
  spaOptions?: SPAWaitOptions;
  /** Authentication configuration */
  authConfig?: AuthConfig;
}

// ---------------------------------------------------------------------------
// PlaywrightBrowser class
// ---------------------------------------------------------------------------

export class PlaywrightBrowser {
  private config: Required<
    Omit<PlaywrightBrowserConfig, 'browserQueue' | 'spaOptions' | 'authConfig'>
  > & {
    browserQueue?: BrowserQueue;
    spaOptions: SPAWaitOptions;
    authConfig?: AuthConfig;
  };
  private browser: any = null;
  private context: any = null;
  private available = false;
  private isSPADetected = false;

  constructor(config: PlaywrightBrowserConfig = {}) {
    this.config = {
      headless: config.headless ?? true,
      timeout: config.timeout ?? 30_000,
      screenshots: config.screenshots ?? true,
      browserQueue: config.browserQueue,
      spaOptions: config.spaOptions ?? { strategy: 'hybrid', timeout: 10_000 },
      authConfig: config.authConfig,
    };
  }

  /**
   * Launch the browser. Returns false if playwright is not available.
   */
  async launch(): Promise<boolean> {
    try {
      // Dynamic import to avoid compile-time dependency on playwright
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pw = require('playwright') as {
        chromium: { launch(opts: any): Promise<any> };
      };
      this.browser = await pw.chromium.launch({
        headless: this.config.headless,
      });
      this.context = await this.browser.newContext();
      this.available = true;

      // Apply authentication if configured
      if (this.config.authConfig) {
        const resolved = resolveAuthConfig(this.config.authConfig);
        const authResult = await authenticate(this.context, resolved);
        if (!authResult.success) {
          console.warn(
            `[PlaywrightBrowser] Auth failed: ${authResult.message}`,
          );
        }
      }

      return true;
    } catch (error) {
      console.warn(
        `[PlaywrightBrowser] Failed to launch: ${error}. Browser features will be unavailable.`,
      );
      this.available = false;
      return false;
    }
  }

  /**
   * Check if the browser is available.
   */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Get the underlying Playwright browser context (for advanced usage).
   */
  getContext(): any {
    return this.context;
  }

  /**
   * Close the browser and release resources.
   */
  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    this.available = false;
  }

  /**
   * Visit a page and extract comprehensive data.
   */
  async visitPage(url: string): Promise<PageData> {
    if (!this.available || !this.context) {
      throw new Error('Browser not launched. Call launch() first.');
    }

    let lease: BrowserLease | undefined;
    if (this.config.browserQueue) {
      lease = await this.config.browserQueue.acquire();
    }

    try {
      const page = await this.context.newPage();
      const consoleMessages: ConsoleMessage[] = [];
      const networkErrors: NetworkError[] = [];

      // Collect console messages
      page.on('console', (msg: any) => {
        consoleMessages.push({
          type: msg.type(),
          text: msg.text(),
          timestamp: Date.now(),
        });
      });

      // Collect network errors
      page.on('response', (response: any) => {
        const status = response.status();
        if (status >= 400) {
          networkErrors.push({
            url: response.url(),
            status,
            statusText: response.statusText(),
            method: response.request().method(),
          });
        }
      });

      // Install SPA interceptors for navigation tracking
      await installSPAInterceptors(page);

      // Navigate and measure load time
      const startTime = Date.now();
      let statusCode: number | undefined;
      const response = await page.goto(url, {
        timeout: this.config.timeout,
        waitUntil: 'domcontentloaded',
      });
      statusCode = response?.status();

      // Wait for SPA to settle
      await waitForSPASettle(page, this.config.spaOptions);

      const loadTimeMs = Date.now() - startTime;

      // Detect SPA on first visit
      if (!this.isSPADetected) {
        this.isSPADetected = await detectSPA(page);
      }

      const title = await page.title();
      const html = await page.content();
      const text = await page.evaluate(() => document.body?.innerText ?? '');

      // Extract links
      const links: string[] = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]'))
          .map((a: Element) => (a as HTMLAnchorElement).href)
          .filter(
            (href: string) =>
              href.startsWith('http') &&
              !href.startsWith('javascript:') &&
              !href.startsWith('mailto:') &&
              !href.startsWith('tel:'),
          ),
      );

      // Extract forms with enhanced field data
      const forms: FormData[] = await page.evaluate(() =>
        Array.from(document.querySelectorAll('form')).map(
          (form: HTMLFormElement) => {
            const fields = Array.from(
              form.querySelectorAll('input, select, textarea'),
            ).map((field: Element) => {
              const input = field as HTMLInputElement;
              const validationAttrs: string[] = [];
              if (input.required) validationAttrs.push('required');
              if (input.maxLength > 0) validationAttrs.push(`maxlength=${input.maxLength}`);
              if (input.minLength > 0) validationAttrs.push(`minlength=${input.minLength}`);
              if (input.pattern) validationAttrs.push(`pattern=${input.pattern}`);
              if (input.min) validationAttrs.push(`min=${input.min}`);
              if (input.max) validationAttrs.push(`max=${input.max}`);
              if (input.type) validationAttrs.push(`type=${input.type}`);

              // Find associated label
              let label: string | undefined;
              if (input.id) {
                const labelEl = document.querySelector(
                  `label[for="${input.id}"]`,
                );
                if (labelEl) label = labelEl.textContent?.trim();
              }
              if (!label && input.closest('label')) {
                label = input.closest('label')?.textContent?.trim();
              }

              return {
                name: input.name || '',
                type: input.type || 'text',
                required: input.required || false,
                placeholder: input.placeholder || undefined,
                label,
                maxlength:
                  input.maxLength > 0 ? input.maxLength : undefined,
                minlength:
                  input.minLength > 0 ? input.minLength : undefined,
                pattern: input.pattern || undefined,
                min: input.min || undefined,
                max: input.max || undefined,
                ariaLabel:
                  input.getAttribute('aria-label') || undefined,
                validationAttributes: validationAttrs,
              };
            });

            return {
              action: form.action || '',
              method: (form.method || 'GET').toUpperCase(),
              id: form.id || undefined,
              name: form.name || undefined,
              fields,
            };
          },
        ),
      );

      // Capture screenshot
      let screenshot: Buffer | undefined;
      if (this.config.screenshots) {
        screenshot = await page.screenshot({ fullPage: true });
      }

      await page.close();

      return {
        url,
        title,
        html,
        text,
        links: [...new Set(links)],
        forms,
        screenshot,
        consoleMessages,
        networkErrors,
        statusCode,
        loadTimeMs,
        isSPA: this.isSPADetected,
      };
    } finally {
      if (lease && this.config.browserQueue) {
        this.config.browserQueue.release(lease);
      }
    }
  }

  /**
   * Test a page at multiple viewports and check for responsive issues.
   */
  async testViewports(
    url: string,
    viewports: ViewportSpec[] = DEFAULT_VIEWPORTS,
  ): Promise<Map<string, PageData & { overflow: OverflowResult }>> {
    const results = new Map<string, PageData & { overflow: OverflowResult }>();

    for (const vp of viewports) {
      if (this.context) {
        await this.context.close();
      }
      this.context = await this.browser.newContext({
        viewport: { width: vp.width, height: vp.height },
      });

      const data = await this.visitPage(url);

      // Check for horizontal overflow at this viewport
      const page = await this.context.newPage();
      await page.goto(url, {
        timeout: this.config.timeout,
        waitUntil: 'domcontentloaded',
      });
      await waitForSPASettle(page, this.config.spaOptions);

      const overflow: OverflowResult = await page.evaluate(() => {
        const scrollWidth = document.documentElement.scrollWidth;
        const clientWidth = document.documentElement.clientWidth;
        return {
          hasOverflow: scrollWidth > clientWidth,
          scrollWidth,
          clientWidth,
          overflowAmount: Math.max(0, scrollWidth - clientWidth),
        };
      });

      await page.close();

      results.set(vp.name, { ...data, overflow });
    }

    // Restore default context
    if (this.context) {
      await this.context.close();
    }
    this.context = await this.browser.newContext();

    return results;
  }

  /**
   * Fill and submit a form on a page.
   */
  async fillForm(
    url: string,
    formIndex: number,
    values: Record<string, string>,
  ): Promise<{
    submitted: boolean;
    resultPage?: PageData;
    error?: string;
    beforeScreenshot?: Buffer;
    afterScreenshot?: Buffer;
  }> {
    if (!this.available || !this.context) {
      throw new Error('Browser not launched. Call launch() first.');
    }

    let lease: BrowserLease | undefined;
    if (this.config.browserQueue) {
      lease = await this.config.browserQueue.acquire();
    }

    try {
      const page = await this.context.newPage();
      await page.goto(url, {
        timeout: this.config.timeout,
        waitUntil: 'domcontentloaded',
      });
      await waitForSPASettle(page, this.config.spaOptions);

      const forms = await page.$$('form');
      if (formIndex >= forms.length) {
        await page.close();
        return {
          submitted: false,
          error: `Form index ${formIndex} out of range (${forms.length} forms)`,
        };
      }

      const form = forms[formIndex];

      // Screenshot before filling
      let beforeScreenshot: Buffer | undefined;
      if (this.config.screenshots) {
        beforeScreenshot = await page.screenshot({ fullPage: true });
      }

      // Fill fields
      for (const [name, value] of Object.entries(values)) {
        const field = await form.$(`[name="${name}"]`);
        if (field) {
          const tagName = await field.evaluate((el: Element) =>
            el.tagName.toLowerCase(),
          );
          if (tagName === 'select') {
            await field.selectOption(value);
          } else {
            await field.fill(value);
          }
        }
      }

      // Submit
      const submitBtn = await form.$(
        'button[type="submit"], input[type="submit"]',
      );
      if (submitBtn) {
        await Promise.all([
          page
            .waitForNavigation({ timeout: this.config.timeout })
            .catch(() => null),
          submitBtn.click(),
        ]);
      }

      // Wait for response
      await waitForSPASettle(page, {
        ...this.config.spaOptions,
        timeout: 5000,
      });

      // Screenshot after submission
      let afterScreenshot: Buffer | undefined;
      if (this.config.screenshots) {
        afterScreenshot = await page.screenshot({ fullPage: true });
      }

      const resultPage = await this.extractPageData(page);
      await page.close();

      return {
        submitted: true,
        resultPage,
        beforeScreenshot,
        afterScreenshot,
      };
    } catch (error) {
      return {
        submitted: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (lease && this.config.browserQueue) {
        this.config.browserQueue.release(lease);
      }
    }
  }

  /**
   * Create a new page for raw Playwright access (e.g., for crawling).
   */
  async newPage(): Promise<any> {
    if (!this.available || !this.context) {
      throw new Error('Browser not launched. Call launch() first.');
    }
    const page = await this.context.newPage();
    await installSPAInterceptors(page);
    return page;
  }

  private async extractPageData(page: any): Promise<PageData> {
    const title = await page.title();
    const html = await page.content();
    const text = await page.evaluate(() => document.body?.innerText ?? '');
    const url = page.url();

    return {
      url,
      title,
      html,
      text,
      links: [],
      forms: [],
      consoleMessages: [],
      networkErrors: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Types for viewport testing
// ---------------------------------------------------------------------------

export interface OverflowResult {
  hasOverflow: boolean;
  scrollWidth: number;
  clientWidth: number;
  overflowAmount: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Factory: create and optionally launch a PlaywrightBrowser.
 */
export async function createPlaywrightBrowser(
  config: PlaywrightBrowserConfig = {},
): Promise<PlaywrightBrowser> {
  const browser = new PlaywrightBrowser(config);
  await browser.launch();
  return browser;
}
