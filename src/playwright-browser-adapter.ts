/**
 * PlaywrightBrowserAdapter - Adapts PlaywrightBrowser to the BrowserBackend interface.
 *
 * Thin wrapper that delegates to PlaywrightBrowser for existing methods and
 * adds the new V4 methods (clickElement, fillAndSubmitForm, visitPageAndWait,
 * getConsoleMessages, getNetworkRequests, captureScreenshot).
 *
 * @module playwright-browser-adapter
 */

import type {
  BrowserBackend,
  BrowserBackendConfig,
  NetworkRequest,
  ClickResult,
  DOMChange,
  FormSubmitResult,
} from './browser-backend.js';

import {
  PlaywrightBrowser,
  type PageData,
  type ConsoleMessage,
  type ViewportSpec,
  type OverflowResult,
} from './playwright-browser.js';

export class PlaywrightBrowserAdapter implements BrowserBackend {
  readonly name = 'playwright';
  private browser: PlaywrightBrowser;
  private consoleBuffer: ConsoleMessage[] = [];
  private networkBuffer: NetworkRequest[] = [];
  private _retainedPage: import('playwright').Page | null = null;

  constructor(config: BrowserBackendConfig) {
    this.browser = new PlaywrightBrowser({
      headless: config.headless ?? true,
      timeout: config.timeoutMs ?? 30000,
      screenshots: config.screenshots ?? true,
      authConfig: config.authConfig,
    });
  }

  // ---------------------------------------------------------------------------
  // Delegated lifecycle methods
  // ---------------------------------------------------------------------------

  async launch(): Promise<boolean> {
    return this.browser.launch();
  }

  isAvailable(): boolean {
    return this.browser.isAvailable();
  }

  async close(): Promise<void> {
    if (this._retainedPage) {
      try { await this._retainedPage.close(); } catch { /* already closed */ }
      this._retainedPage = null;
    }
    return this.browser.close();
  }

  // ---------------------------------------------------------------------------
  // Page visiting
  // ---------------------------------------------------------------------------

  async visitPage(url: string): Promise<PageData> {
    // Close any previously retained page
    if (this._retainedPage) {
      try { await this._retainedPage.close(); } catch { /* already closed */ }
      this._retainedPage = null;
    }

    const data = await this.browser.visitPage(url);
    // Buffer console and network from the visit
    this.consoleBuffer = [...data.consoleMessages];
    this.networkBuffer = data.networkErrors.map(e => ({
      url: e.url,
      method: e.method,
      status: e.status,
      statusText: e.statusText,
      contentType: '',
      durationMs: 0,
      isError: true,
      timestamp: Date.now(),
    }));

    // Open a retained page at the same URL so executeScript/captureScreenshot
    // have a live page to work with (PlaywrightBrowser.visitPage closes its page)
    try {
      const context = this.browser.getContext();
      if (context) {
        const page = await context.newPage();
        await page.goto(url, {
          timeout: 15000,
          waitUntil: 'domcontentloaded',
        });
        this._retainedPage = page;
      }
    } catch {
      // Retained page is best-effort; detectors degrade gracefully
      this._retainedPage = null;
    }

    return data;
  }

  async visitPageAndWait(
    url: string,
    _selector: string,
    _timeoutMs?: number,
  ): Promise<PageData> {
    // Playwright's visitPage already waits for DOM content loaded + SPA settling.
    // The selector-based wait is a Chrome MCP concern; here we just delegate.
    return this.visitPage(url);
  }

  // ---------------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------------

  async clickElement(url: string, selector: string): Promise<ClickResult> {
    try {
      const context = this.browser.getContext();
      if (!context) throw new Error('Browser not launched');

      const page = await context.newPage();
      await page.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });

      const urlBefore = page.url();
      const consoleMsgs: ConsoleMessage[] = [];
      page.on('console', (msg: any) => {
        consoleMsgs.push({
          type: msg.type(),
          text: msg.text(),
          timestamp: Date.now(),
        });
      });

      const networkReqs: NetworkRequest[] = [];
      page.on('response', (resp: any) => {
        networkReqs.push({
          url: resp.url(),
          method: resp.request().method(),
          status: resp.status(),
          statusText: resp.statusText(),
          contentType: '',
          durationMs: 0,
          isError: resp.status() >= 400,
          timestamp: Date.now(),
        });
      });

      // Capture DOM signature before click
      const domBefore = await this.captureDomSignature(page);

      // Click the element
      await page.click(selector, { timeout: 10000 }).catch(() => null);

      // Wait for any navigation or DOM changes
      await page.waitForTimeout(1000);

      const urlAfter = page.url();
      const navigated = urlAfter !== urlBefore;

      // Capture DOM signature after click (skip if navigated — cross-page comparison is meaningless)
      let domChanges: DOMChange[] = [];
      if (!navigated) {
        const domAfter = await this.captureDomSignature(page);
        domChanges = this.diffDomSignatures(domBefore, domAfter);
      }

      let screenshotAfter: Buffer | undefined;
      try {
        screenshotAfter = await page.screenshot({ fullPage: true });
      } catch {
        // Screenshot capture may fail if the page navigated away
      }

      await page.close();

      return {
        success: true,
        urlAfter,
        navigated,
        domChanges,
        consoleMessages: consoleMsgs,
        networkRequests: networkReqs,
        screenshotAfter,
      };
    } catch (error) {
      return {
        success: false,
        urlAfter: url,
        navigated: false,
        domChanges: [],
        consoleMessages: [],
        networkRequests: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async fillAndSubmitForm(
    url: string,
    formSelector: string,
    fieldValues: Record<string, string>,
  ): Promise<FormSubmitResult> {
    try {
      // Parse form index from selector (e.g. "form:nth-of-type(1)" -> 0)
      const formIndex = this.parseFormIndex(formSelector);
      const result = await this.browser.fillForm(url, formIndex, fieldValues);

      // Compute DOM diff if we stayed on the same page
      let domChanges: DOMChange[] = [];
      const navigated = result.resultPage?.url !== url;
      if (!navigated && result.resultPage) {
        // We can't easily get before/after DOM signatures from fillForm
        // since it manages its own page lifecycle. The fillForm already
        // captures before/after screenshots; DOM diff would require
        // access to the page object which is internal to fillForm.
        // For now, indicate form submission happened via a synthetic change.
        if (result.submitted) {
          domChanges.push({
            type: 'modified',
            selector: formSelector,
            description: 'Form submitted successfully',
          });
        }
      }

      return {
        success: result.submitted,
        urlAfter: result.resultPage?.url ?? url,
        navigated,
        pageAfter: result.resultPage,
        screenshotBefore: result.beforeScreenshot,
        screenshotAfter: result.afterScreenshot,
        validationErrors: [],
        consoleMessages: [],
        networkRequests: [],
        domChanges,
        error: result.error,
      };
    } catch (error) {
      return {
        success: false,
        urlAfter: url,
        navigated: false,
        validationErrors: [],
        consoleMessages: [],
        networkRequests: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Viewport testing (delegated)
  // ---------------------------------------------------------------------------

  async testViewports(
    url: string,
    viewports: ViewportSpec[],
  ): Promise<Map<string, PageData & { overflow: OverflowResult }>> {
    return this.browser.testViewports(url, viewports);
  }

  // ---------------------------------------------------------------------------
  // Diagnostics
  // ---------------------------------------------------------------------------

  getConsoleMessages(): ConsoleMessage[] {
    return [...this.consoleBuffer];
  }

  getNetworkRequests(): NetworkRequest[] {
    return [...this.networkBuffer];
  }

  clearBuffers(): void {
    this.consoleBuffer = [];
    this.networkBuffer = [];
  }

  async executeScript<T = unknown>(script: string): Promise<T> {
    if (this._retainedPage) {
      return this._retainedPage.evaluate(script) as Promise<T>;
    }
    throw new Error('No pages open — call visitPage() first');
  }

  // ---------------------------------------------------------------------------
  // Screenshots
  // ---------------------------------------------------------------------------

  async captureScreenshot(fullPage?: boolean): Promise<Buffer | undefined> {
    try {
      if (this._retainedPage) {
        return await this._retainedPage.screenshot({ fullPage: fullPage ?? true });
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // DOM change detection helpers
  // ---------------------------------------------------------------------------

  /**
   * Capture a DOM signature from the page: element counts by tag name,
   * total element count, and body innerHTML length. Returns an empty
   * signature on failure (e.g., page navigated or context detached).
   */
  private async captureDomSignature(
    page: import('playwright').Page,
  ): Promise<Record<string, number>> {
    try {
      return await page.evaluate(() => {
        const counts: Record<string, number> = {};
        document.querySelectorAll('*').forEach((el) => {
          const tag = el.tagName.toLowerCase();
          counts[tag] = (counts[tag] || 0) + 1;
        });
        counts['__bodyLen'] = document.body?.innerHTML?.length || 0;
        counts['__total'] = document.querySelectorAll('*').length;
        return counts;
      });
    } catch {
      // Page navigated or context detached — return empty signature
      return {};
    }
  }

  /**
   * Compare two DOM signatures and produce DOMChange entries for meaningful
   * differences. Ignores trivial differences (<= 0 tag count change and
   * < 100 char body length change).
   */
  private diffDomSignatures(
    before: Record<string, number>,
    after: Record<string, number>,
  ): DOMChange[] {
    const changes: DOMChange[] = [];

    // Skip diff if either signature is empty (capture failed)
    if (Object.keys(before).length === 0 || Object.keys(after).length === 0) {
      return changes;
    }

    const allTags = new Set([...Object.keys(before), ...Object.keys(after)]);

    for (const tag of allTags) {
      // Skip internal tracking keys for per-tag reporting
      if (tag.startsWith('__')) continue;

      const beforeCount = before[tag] || 0;
      const afterCount = after[tag] || 0;
      const diff = afterCount - beforeCount;

      if (diff > 0) {
        changes.push({
          type: 'added',
          selector: tag,
          description: `${diff} <${tag}> element${diff !== 1 ? 's' : ''} added`,
        });
      } else if (diff < 0) {
        changes.push({
          type: 'removed',
          selector: tag,
          description: `${-diff} <${tag}> element${-diff !== 1 ? 's' : ''} removed`,
        });
      }
    }

    // Check body length change (> 100 chars is significant)
    const bodyLenBefore = before['__bodyLen'] || 0;
    const bodyLenAfter = after['__bodyLen'] || 0;
    const bodyDiff = bodyLenAfter - bodyLenBefore;
    if (Math.abs(bodyDiff) > 100) {
      changes.push({
        type: 'modified',
        selector: 'body',
        description: `Body content ${bodyDiff > 0 ? 'grew' : 'shrank'} by ${Math.abs(bodyDiff)} characters`,
      });
    }

    return changes;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private parseFormIndex(selector: string): number {
    // Try to extract index from "form:nth-of-type(N)" or "form:nth-child(N)"
    const match = selector.match(/nth-(?:of-type|child)\((\d+)\)/);
    if (match) return parseInt(match[1], 10) - 1;
    // Default to first form
    return 0;
  }
}
