/**
 * Interactive Tester Unit Tests
 * Tests element discovery, skip logic, page testing, and result descriptions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InteractiveTester } from '../../src/interactive-tester';
import type { BrowserBackend, ClickResult, NetworkRequest } from '../../src/browser-backend';
import type { PageData, ConsoleMessage, OverflowResult, ViewportSpec } from '../../src/playwright-browser';

// ---------------------------------------------------------------------------
// Mock BrowserBackend factory
// ---------------------------------------------------------------------------

function createMockBackend(overrides?: Partial<BrowserBackend>): BrowserBackend {
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
    } satisfies ClickResult),
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
// Tests
// ---------------------------------------------------------------------------

describe('InteractiveTester', () => {
  let backend: BrowserBackend;
  let tester: InteractiveTester;

  beforeEach(() => {
    backend = createMockBackend();
    tester = new InteractiveTester(backend);
  });

  // -----------------------------------------------------------------------
  // discoverElements
  // -----------------------------------------------------------------------

  describe('discoverElements', () => {
    it('finds buttons in HTML', async () => {
      const html = `
        <html><body>
          <button id="btn1">Save</button>
          <button class="cancel-btn">Cancel</button>
        </body></html>
      `;
      (backend.visitPage as ReturnType<typeof vi.fn>).mockResolvedValue({
        url: 'http://localhost',
        title: 'Test',
        html,
        text: '',
        links: [],
        forms: [],
        consoleMessages: [],
        networkErrors: [],
      } satisfies PageData);

      const elements = await tester.discoverElements('http://localhost');
      const buttons = elements.filter((e) => e.elementType === 'button');

      expect(buttons.length).toBe(2);
      expect(buttons[0].text).toBe('Save');
      expect(buttons[1].text).toBe('Cancel');
    });

    it('finds links in HTML', async () => {
      const html = `
        <html><body>
          <a href="/about">About Us</a>
          <a href="/contact">Contact</a>
        </body></html>
      `;
      (backend.visitPage as ReturnType<typeof vi.fn>).mockResolvedValue({
        url: 'http://localhost',
        title: 'Test',
        html,
        text: '',
        links: [],
        forms: [],
        consoleMessages: [],
        networkErrors: [],
      } satisfies PageData);

      const elements = await tester.discoverElements('http://localhost');
      const links = elements.filter((e) => e.elementType === 'link');

      expect(links.length).toBe(2);
      expect(links[0].href).toBe('/about');
      expect(links[0].text).toBe('About Us');
      expect(links[1].href).toBe('/contact');
    });

    it('finds select elements', async () => {
      const html = `
        <html><body>
          <select name="color"><option>Red</option><option>Blue</option></select>
        </body></html>
      `;
      (backend.visitPage as ReturnType<typeof vi.fn>).mockResolvedValue({
        url: 'http://localhost',
        title: 'Test',
        html,
        text: '',
        links: [],
        forms: [],
        consoleMessages: [],
        networkErrors: [],
      } satisfies PageData);

      const elements = await tester.discoverElements('http://localhost');
      const dropdowns = elements.filter((e) => e.elementType === 'dropdown');

      expect(dropdowns.length).toBe(1);
      expect(dropdowns[0].tagName).toBe('select');
      expect(dropdowns[0].selector).toBe('select[name="color"]');
    });
  });

  // -----------------------------------------------------------------------
  // testPage - maxElementsPerPage
  // -----------------------------------------------------------------------

  describe('testPage', () => {
    it('respects maxElementsPerPage limit', async () => {
      // Create HTML with many buttons
      const buttons = Array.from({ length: 10 }, (_, i) =>
        `<button id="btn${i}">Button ${i}</button>`,
      ).join('\n');
      const html = `<html><body>${buttons}</body></html>`;

      (backend.visitPage as ReturnType<typeof vi.fn>).mockResolvedValue({
        url: 'http://localhost',
        title: 'Test',
        html,
        text: '',
        links: [],
        forms: [],
        consoleMessages: [],
        networkErrors: [],
      } satisfies PageData);

      // Configure with a low limit
      const limitedTester = new InteractiveTester(backend, {
        maxElementsPerPage: 3,
        safeMode: false,
      });

      const result = await limitedTester.testPage('http://localhost');

      // Only 3 should have been tested, rest skipped
      expect(result.elementsTested.length).toBe(3);
      expect(result.elementsSkipped.length).toBe(7);
      expect(
        result.elementsSkipped.some((s) =>
          s.reason.includes('maxElementsPerPage'),
        ),
      ).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // shouldSkip
  // -----------------------------------------------------------------------

  describe('shouldSkip', () => {
    it('skips invisible elements', () => {
      const reason = tester.shouldSkip({
        selector: '#hidden-btn',
        tagName: 'button',
        elementType: 'button',
        text: 'Hidden',
        visible: false,
        enabled: true,
      });
      expect(reason).toBe('Element is not visible');
    });

    it('skips disabled elements', () => {
      const reason = tester.shouldSkip({
        selector: '#disabled-btn',
        tagName: 'button',
        elementType: 'button',
        text: 'Disabled',
        visible: true,
        enabled: false,
      });
      expect(reason).toBe('Element is disabled');
    });

    it('skips destructive elements in safe mode', () => {
      // Default config has safeMode: true
      const reason = tester.shouldSkip({
        selector: '#delete-btn',
        tagName: 'button',
        elementType: 'button',
        text: 'Delete Account',
        visible: true,
        enabled: true,
      });
      expect(reason).toContain('Safe mode');
      expect(reason).toContain('destructive pattern');
    });

    it('allows non-destructive buttons', () => {
      const reason = tester.shouldSkip({
        selector: '#save-btn',
        tagName: 'button',
        elementType: 'button',
        text: 'Save Changes',
        visible: true,
        enabled: true,
      });
      // Links are skipped by default (testNavigationLinks=false),
      // but buttons are not links, so this should pass.
      expect(reason).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // describeResult
  // -----------------------------------------------------------------------

  describe('describeResult', () => {
    it('generates readable descriptions', () => {
      const element = {
        selector: '#save-btn',
        tagName: 'button',
        elementType: 'button' as const,
        text: 'Save',
        visible: true,
        enabled: true,
      };

      const clickResult: ClickResult = {
        success: true,
        urlAfter: 'http://localhost',
        navigated: false,
        domChanges: [
          { type: 'modified', selector: '.toast', description: 'Toast appeared' },
        ],
        consoleMessages: [],
        networkRequests: [],
      };

      const desc = tester.describeResult(element, clickResult);
      expect(desc).toContain("Clicked button 'Save'");
      expect(desc).toContain('1 DOM change');
    });

    it('describes errors in click results', () => {
      const element = {
        selector: '#broken-btn',
        tagName: 'button',
        elementType: 'button' as const,
        text: 'Broken',
        visible: true,
        enabled: true,
      };

      const clickResult: ClickResult = {
        success: false,
        urlAfter: 'http://localhost',
        navigated: false,
        domChanges: [],
        consoleMessages: [],
        networkRequests: [],
        error: 'Element not found',
      };

      const desc = tester.describeResult(element, clickResult);
      expect(desc).toContain("Clicked button 'Broken'");
      expect(desc).toContain('error: Element not found');
    });

    it('describes navigation result', () => {
      const element = {
        selector: '#nav-link',
        tagName: 'a',
        elementType: 'link' as const,
        text: 'Home',
        visible: true,
        enabled: true,
      };

      const clickResult: ClickResult = {
        success: true,
        urlAfter: 'http://localhost/home',
        navigated: true,
        domChanges: [],
        consoleMessages: [],
        networkRequests: [],
      };

      const desc = tester.describeResult(element, clickResult);
      expect(desc).toContain("Clicked link 'Home'");
      expect(desc).toContain('navigated to http://localhost/home');
    });
  });
});
