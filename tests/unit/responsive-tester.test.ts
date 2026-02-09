/**
 * Responsive Tester Unit Tests
 * Tests viewport constants, page testing, finding generation, and multi-page processing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ResponsiveTester,
  STANDARD_VIEWPORTS,
} from '../../src/responsive-tester';
import type { BrowserBackend, NetworkRequest } from '../../src/browser-backend';
import type {
  PageData,
  ViewportSpec,
  OverflowResult,
} from '../../src/playwright-browser';

// ---------------------------------------------------------------------------
// Mock BrowserBackend factory
// ---------------------------------------------------------------------------

function createMockBackend(
  overrides?: Partial<BrowserBackend>,
): BrowserBackend {
  return {
    name: 'mock',
    launch: vi.fn().mockResolvedValue(true),
    isAvailable: vi.fn().mockReturnValue(true),
    close: vi.fn().mockResolvedValue(undefined),
    visitPage: vi.fn().mockResolvedValue({
      url: 'http://localhost',
      title: 'Test',
      html: '',
      text: '',
      links: [],
      forms: [],
      consoleMessages: [],
      networkErrors: [],
    } satisfies PageData),
    visitPageAndWait: vi.fn().mockResolvedValue({
      url: 'http://localhost',
      title: 'Test',
      html: '',
      text: '',
      links: [],
      forms: [],
      consoleMessages: [],
      networkErrors: [],
    } satisfies PageData),
    clickElement: vi.fn().mockResolvedValue({
      success: true,
      urlAfter: 'http://localhost',
      navigated: false,
      domChanges: [],
      consoleMessages: [],
      networkRequests: [],
    }),
    fillAndSubmitForm: vi.fn().mockResolvedValue({
      success: true,
      urlAfter: 'http://localhost',
      navigated: false,
      validationErrors: [],
      consoleMessages: [],
      networkRequests: [],
    }),
    testViewports: vi.fn().mockResolvedValue(new Map()),
    getConsoleMessages: vi.fn().mockReturnValue([]),
    getNetworkRequests: vi.fn().mockReturnValue([]),
    captureScreenshot: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper to build a viewport result map
// ---------------------------------------------------------------------------

function buildViewportMap(
  entries: Array<{
    name: string;
    width: number;
    height: number;
    overflow: OverflowResult;
  }>,
): Map<string, PageData & { overflow: OverflowResult }> {
  const map = new Map<string, PageData & { overflow: OverflowResult }>();
  for (const entry of entries) {
    map.set(entry.name, {
      url: 'http://localhost',
      title: 'Test',
      html: '<html></html>',
      text: '',
      links: [],
      forms: [],
      consoleMessages: [],
      networkErrors: [],
      overflow: entry.overflow,
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ResponsiveTester', () => {
  let backend: BrowserBackend;
  let tester: ResponsiveTester;

  beforeEach(() => {
    backend = createMockBackend();
    tester = new ResponsiveTester(backend);
  });

  // -----------------------------------------------------------------------
  // STANDARD_VIEWPORTS
  // -----------------------------------------------------------------------

  describe('STANDARD_VIEWPORTS', () => {
    it('has mobile, tablet, desktop', () => {
      const names = STANDARD_VIEWPORTS.map((v) => v.name);
      expect(names).toContain('mobile');
      expect(names).toContain('tablet');
      expect(names).toContain('desktop');
      expect(STANDARD_VIEWPORTS.length).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // testPage
  // -----------------------------------------------------------------------

  describe('testPage', () => {
    it('calls backend.testViewports with standard viewports', async () => {
      const viewportMap = buildViewportMap([
        {
          name: 'mobile',
          width: 375,
          height: 812,
          overflow: { hasOverflow: false, scrollWidth: 375, clientWidth: 375, overflowAmount: 0 },
        },
        {
          name: 'tablet',
          width: 768,
          height: 1024,
          overflow: { hasOverflow: false, scrollWidth: 768, clientWidth: 768, overflowAmount: 0 },
        },
        {
          name: 'desktop',
          width: 1440,
          height: 900,
          overflow: { hasOverflow: false, scrollWidth: 1440, clientWidth: 1440, overflowAmount: 0 },
        },
      ]);

      (backend.testViewports as ReturnType<typeof vi.fn>).mockResolvedValue(viewportMap);

      const result = await tester.testPage('http://localhost');

      expect(backend.testViewports).toHaveBeenCalledWith(
        'http://localhost',
        STANDARD_VIEWPORTS,
      );
      expect(result.url).toBe('http://localhost');
      expect(result.viewportResults.size).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // generateFindings
  // -----------------------------------------------------------------------

  describe('generateFindings', () => {
    it('creates P1 for overflow > 50px', async () => {
      const viewportMap = buildViewportMap([
        {
          name: 'mobile',
          width: 375,
          height: 812,
          overflow: { hasOverflow: true, scrollWidth: 500, clientWidth: 375, overflowAmount: 125 },
        },
        {
          name: 'desktop',
          width: 1440,
          height: 900,
          overflow: { hasOverflow: false, scrollWidth: 1440, clientWidth: 1440, overflowAmount: 0 },
        },
      ]);

      (backend.testViewports as ReturnType<typeof vi.fn>).mockResolvedValue(viewportMap);

      const result = await tester.testPage('http://localhost');

      const p1Findings = result.findings.filter((f) => f.severity === 'P1');
      expect(p1Findings.length).toBe(1);
      expect(p1Findings[0].title).toContain('Horizontal overflow');
      expect(p1Findings[0].viewport).toBe('mobile');
      expect(p1Findings[0].description).toContain('125px');
    });

    it('creates no finding for overflow <= 50px', async () => {
      const viewportMap = buildViewportMap([
        {
          name: 'mobile',
          width: 375,
          height: 812,
          overflow: { hasOverflow: true, scrollWidth: 400, clientWidth: 375, overflowAmount: 25 },
        },
        {
          name: 'desktop',
          width: 1440,
          height: 900,
          overflow: { hasOverflow: false, scrollWidth: 1440, clientWidth: 1440, overflowAmount: 0 },
        },
      ]);

      (backend.testViewports as ReturnType<typeof vi.fn>).mockResolvedValue(viewportMap);

      const result = await tester.testPage('http://localhost');

      // No P1 findings because overflow is only 25px, not > 50
      const p1Findings = result.findings.filter((f) => f.severity === 'P1');
      expect(p1Findings.length).toBe(0);
    });

    it('handles empty viewportResults', async () => {
      // Return empty map from testViewports
      (backend.testViewports as ReturnType<typeof vi.fn>).mockResolvedValue(new Map());

      const result = await tester.testPage('http://localhost');

      expect(result.findings.length).toBe(0);
      expect(result.viewportResults.size).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // testPages
  // -----------------------------------------------------------------------

  describe('testPages', () => {
    it('processes multiple URLs sequentially', async () => {
      const viewportMap = buildViewportMap([
        {
          name: 'mobile',
          width: 375,
          height: 812,
          overflow: { hasOverflow: false, scrollWidth: 375, clientWidth: 375, overflowAmount: 0 },
        },
        {
          name: 'desktop',
          width: 1440,
          height: 900,
          overflow: { hasOverflow: false, scrollWidth: 1440, clientWidth: 1440, overflowAmount: 0 },
        },
      ]);

      (backend.testViewports as ReturnType<typeof vi.fn>).mockResolvedValue(viewportMap);

      const urls = ['http://localhost/page1', 'http://localhost/page2', 'http://localhost/page3'];
      const results = await tester.testPages(urls);

      expect(results.length).toBe(3);
      expect(results[0].url).toBe('http://localhost/page1');
      expect(results[1].url).toBe('http://localhost/page2');
      expect(results[2].url).toBe('http://localhost/page3');

      // testViewports should have been called 3 times (once per URL)
      expect(backend.testViewports).toHaveBeenCalledTimes(3);
    });
  });
});
