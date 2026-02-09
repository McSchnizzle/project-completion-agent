/**
 * Responsive Tester - Tests pages at multiple viewports and generates
 * responsive findings autonomously.
 *
 * Uses the BrowserBackend interface to test pages at standard breakpoints
 * (mobile, tablet, desktop), detects horizontal overflow, and produces
 * severity-ranked findings. Hidden-element and truncated-text detection
 * are stubbed for future implementation; the primary value today is
 * overflow detection and automated finding generation.
 *
 * @module responsive-tester
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BrowserBackend, NetworkRequest } from './browser-backend.js';
import type { PageData, ViewportSpec, OverflowResult } from './playwright-browser.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const STANDARD_VIEWPORTS: ViewportSpec[] = [
  { name: 'mobile',  width: 375,  height: 812 },
  { name: 'tablet',  width: 768,  height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ViewportResult {
  viewport: ViewportSpec;
  pageData: PageData;
  overflow: OverflowResult;
  screenshot?: Buffer;
  hiddenElements: HiddenElement[];
  truncatedText: TruncatedText[];
}

export interface HiddenElement {
  selector: string;
  text: string;
  isCritical: boolean;
}

export interface TruncatedText {
  selector: string;
  fullText: string;
  visibleText: string;
}

export interface ResponsivePageResult {
  url: string;
  viewportResults: Map<string, ViewportResult>;
  findings: ResponsiveFinding[];
}

export interface ResponsiveFinding {
  title: string;
  severity: 'P1' | 'P2' | 'P3';
  url: string;
  viewport: string;
  description: string;
  screenshotPath?: string;
}

/** Internal type for element info returned by executeScript */
interface ElementInfo {
  tagName: string;
  id: string;
  className: string;
  textSnippet: string;
  isCritical: boolean;
  isVisible: boolean;
}

// ---------------------------------------------------------------------------
// ResponsiveTester
// ---------------------------------------------------------------------------

export class ResponsiveTester {
  private backend: BrowserBackend;
  private viewports: ViewportSpec[];

  constructor(backend: BrowserBackend, viewports?: ViewportSpec[]) {
    this.backend = backend;
    this.viewports = viewports ?? STANDARD_VIEWPORTS;
  }

  // -------------------------------------------------------------------------
  // testPage
  // -------------------------------------------------------------------------

  /**
   * Test a single page at all configured viewports. Collects page data,
   * overflow measurements, and generates severity-ranked findings.
   * Also runs hidden-element and text-truncation detection via executeScript.
   */
  async testPage(url: string): Promise<ResponsivePageResult> {
    // backend.testViewports returns Map<string, PageData & { overflow: OverflowResult }>
    const rawResults = await this.backend.testViewports(url, this.viewports);

    // Capture desktop element set for hidden-element comparison
    const desktopRaw = rawResults.get('desktop');
    let desktopElements: ElementInfo[] = [];
    if (desktopRaw) {
      desktopElements = await this.detectInteractiveElements();
    }

    const viewportResults = new Map<string, ViewportResult>();

    for (const vp of this.viewports) {
      const raw = rawResults.get(vp.name);
      if (!raw) {
        continue;
      }

      let hiddenElements: HiddenElement[] = [];
      let truncatedText: TruncatedText[] = [];

      // Run P2/P3 detectors for non-desktop viewports
      if (vp.name !== 'desktop') {
        // Visit page at this viewport size to run detectors
        try {
          await this.backend.visitPage(url);
        } catch {
          // Page visit may fail; skip detectors
        }

        hiddenElements = await this.detectHiddenElements(desktopElements);
        truncatedText = await this.detectTruncatedText();
      }

      const viewportResult: ViewportResult = {
        viewport: vp,
        pageData: raw,
        overflow: raw.overflow,
        screenshot: raw.screenshot,
        hiddenElements,
        truncatedText,
      };

      viewportResults.set(vp.name, viewportResult);
    }

    const findings = this.generateFindings(url, viewportResults);

    return {
      url,
      viewportResults,
      findings,
    };
  }

  // -------------------------------------------------------------------------
  // testPages
  // -------------------------------------------------------------------------

  /**
   * Test multiple pages sequentially at all configured viewports.
   */
  async testPages(urls: string[]): Promise<ResponsivePageResult[]> {
    const results: ResponsivePageResult[] = [];

    for (const url of urls) {
      const result = await this.testPage(url);
      results.push(result);
    }

    return results;
  }

  /**
   * Save viewport screenshots for findings to the evidence directory.
   * Uses `{findingId}-{viewport}-{pageIndex}.png` naming to prevent collisions.
   */
  saveViewportScreenshots(
    auditDir: string,
    findings: ResponsiveFinding[],
    viewportResults: Map<string, ViewportResult>,
    pageIndex: number,
  ): void {
    const evidenceDir = path.join(auditDir, 'evidence');
    fs.mkdirSync(evidenceDir, { recursive: true });

    for (let i = 0; i < findings.length; i++) {
      const finding = findings[i];
      const vpResult = viewportResults.get(finding.viewport);
      if (!vpResult?.screenshot) continue;

      const findingId = `responsive-${i + 1}`;
      const filename = `${findingId}-${finding.viewport}-${pageIndex}.png`;
      const filePath = path.join(evidenceDir, filename);

      try {
        fs.writeFileSync(filePath, vpResult.screenshot);
        finding.screenshotPath = filePath;
      } catch {
        // Screenshot save is best-effort
      }
    }
  }

  // -------------------------------------------------------------------------
  // detectInteractiveElements (private)
  // -------------------------------------------------------------------------

  /**
   * Query interactive elements on the current page via executeScript.
   * Returns an array of ElementInfo for comparison across viewports.
   */
  private async detectInteractiveElements(): Promise<ElementInfo[]> {
    try {
      return await this.backend.executeScript<ElementInfo[]>(`
        (() => {
          const selector = 'button, a, nav, form, [role="navigation"], [role="button"], input[type="submit"]';
          const elements = document.querySelectorAll(selector);
          return Array.from(elements).slice(0, 100).map(el => {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            const tagName = el.tagName.toLowerCase();
            const isCritical = tagName === 'nav' || tagName === 'form' ||
              el.getAttribute('role') === 'navigation' ||
              (tagName === 'button' && (el.textContent || '').trim().length > 0);
            return {
              tagName,
              id: el.id || '',
              className: (el.className && typeof el.className === 'string') ? el.className.split(' ')[0] || '' : '',
              textSnippet: (el.textContent || '').trim().substring(0, 50),
              isCritical,
              isVisible: style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                parseFloat(style.opacity || '1') > 0 &&
                rect.width > 0 && rect.height > 0,
            };
          });
        })()
      `);
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // detectHiddenElements (private)
  // -------------------------------------------------------------------------

  /**
   * P2 detector: Find interactive elements that were visible at the desktop
   * viewport but are hidden at the current (smaller) viewport. Uses
   * executeScript to query computed styles. Matches elements by
   * tagName+id or tagName+textSnippet pairs.
   */
  private async detectHiddenElements(
    desktopElements: ElementInfo[],
  ): Promise<HiddenElement[]> {
    try {
      const currentElements = await this.detectInteractiveElements();
      const hidden: HiddenElement[] = [];

      for (const desktopEl of desktopElements) {
        if (!desktopEl.isVisible) continue;

        // Match by tagName+id or tagName+textSnippet
        const match = currentElements.find((cur) => {
          if (desktopEl.id && cur.id === desktopEl.id && cur.tagName === desktopEl.tagName) {
            return true;
          }
          if (
            desktopEl.textSnippet &&
            cur.textSnippet === desktopEl.textSnippet &&
            cur.tagName === desktopEl.tagName
          ) {
            return true;
          }
          return false;
        });

        if (match && !match.isVisible) {
          hidden.push({
            selector: match.id
              ? `#${match.id}`
              : `${match.tagName}${match.className ? '.' + match.className : ''}`,
            text: match.textSnippet,
            isCritical: match.isCritical,
          });
        }
      }

      return hidden;
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // detectTruncatedText (private)
  // -------------------------------------------------------------------------

  /**
   * P3 detector: Find elements where scrollWidth > clientWidth + 2,
   * indicating text truncation. Filters out overflow:visible elements
   * and zero-width containers to reduce false positives.
   */
  private async detectTruncatedText(): Promise<TruncatedText[]> {
    try {
      return await this.backend.executeScript<TruncatedText[]>(`
        (() => {
          const results = [];
          const candidates = document.querySelectorAll('h1, h2, h3, h4, p, span, a, button, li, td, th, label');
          for (const el of candidates) {
            if (results.length >= 20) break;
            const style = window.getComputedStyle(el);
            // Skip overflow:visible (text isn't actually clipped)
            if (style.overflow === 'visible' && style.overflowX === 'visible') continue;
            // Skip zero-width containers
            if (el.clientWidth === 0) continue;
            // Check for truncation
            if (el.scrollWidth > el.clientWidth + 2) {
              const fullText = (el.textContent || '').trim();
              if (!fullText) continue;
              const ratio = el.clientWidth / el.scrollWidth;
              const visibleLen = Math.floor(fullText.length * ratio);
              results.push({
                selector: el.id ? '#' + el.id :
                  el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''),
                fullText: fullText.substring(0, 100),
                visibleText: fullText.substring(0, visibleLen),
              });
            }
          }
          return results;
        })()
      `);
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // generateFindings (private)
  // -------------------------------------------------------------------------

  /**
   * Analyze viewport results against the desktop baseline and produce
   * severity-ranked responsive findings.
   *
   * Severity rules:
   *   P1 - Horizontal overflow > 50px (content spills off-screen)
   *   P2 - Critical element hidden at a non-desktop viewport
   *   P3 - Text truncated at a non-desktop viewport
   */
  private generateFindings(
    url: string,
    viewportResults: Map<string, ViewportResult>,
  ): ResponsiveFinding[] {
    const findings: ResponsiveFinding[] = [];

    // Desktop is the baseline; compare all other viewports against it
    const desktopResult = viewportResults.get('desktop');

    for (const [vpName, vpResult] of viewportResults) {
      // Skip the desktop baseline itself
      if (vpName === 'desktop') {
        continue;
      }

      // P1: Significant horizontal overflow
      if (vpResult.overflow.hasOverflow && vpResult.overflow.overflowAmount > 50) {
        findings.push({
          title: `Horizontal overflow at ${vpName} viewport`,
          severity: 'P1',
          url,
          viewport: vpName,
          description:
            `Page overflows horizontally by ${vpResult.overflow.overflowAmount}px ` +
            `at ${vpResult.viewport.width}x${vpResult.viewport.height} ` +
            `(scrollWidth: ${vpResult.overflow.scrollWidth}, ` +
            `clientWidth: ${vpResult.overflow.clientWidth}). ` +
            `Content is inaccessible without horizontal scrolling.`,
        });
      }

      // P2: Critical hidden elements
      for (const hidden of vpResult.hiddenElements) {
        if (hidden.isCritical) {
          findings.push({
            title: `Critical element hidden at ${vpName} viewport`,
            severity: 'P2',
            url,
            viewport: vpName,
            description:
              `Element "${hidden.selector}" with text "${hidden.text}" ` +
              `is hidden at ${vpResult.viewport.width}x${vpResult.viewport.height} ` +
              `but visible on desktop. This may prevent users from accessing ` +
              `important functionality.`,
          });
        }
      }

      // P3: Truncated text
      for (const truncated of vpResult.truncatedText) {
        findings.push({
          title: `Text truncated at ${vpName} viewport`,
          severity: 'P3',
          url,
          viewport: vpName,
          description:
            `Element "${truncated.selector}" text is truncated at ` +
            `${vpResult.viewport.width}x${vpResult.viewport.height}. ` +
            `Full text: "${truncated.fullText}", ` +
            `visible text: "${truncated.visibleText}".`,
        });
      }
    }

    return findings;
  }
}
