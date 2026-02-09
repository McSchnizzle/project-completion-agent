/**
 * Tests for BrowserBackend factory and type exports.
 *
 * The factory function uses dynamic imports to load PlaywrightBrowserAdapter.
 * We mock the import to test without requiring Playwright to be available.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type {
  PageData,
  ConsoleMessage,
  NetworkError,
  FormData,
  FormField,
  ViewportSpec,
  OverflowResult,
  BrowserBackend,
  BrowserBackendConfig,
  NetworkRequest,
  ClickResult,
  DOMChange,
  FormSubmitResult,
  BrowserBackendType,
} from '../../src/browser-backend';

// ---------------------------------------------------------------------------
// Helpers: mock backend classes
// ---------------------------------------------------------------------------

function makeMockBackend(name: string, launchResult = true): BrowserBackend {
  return {
    name,
    launch: vi.fn().mockResolvedValue(launchResult),
    isAvailable: vi.fn().mockReturnValue(launchResult),
    close: vi.fn().mockResolvedValue(undefined),
    visitPage: vi.fn(),
    visitPageAndWait: vi.fn(),
    clickElement: vi.fn(),
    fillAndSubmitForm: vi.fn(),
    testViewports: vi.fn(),
    getConsoleMessages: vi.fn().mockReturnValue([]),
    getNetworkRequests: vi.fn().mockReturnValue([]),
    clearBuffers: vi.fn(),
    executeScript: vi.fn(),
    captureScreenshot: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BrowserBackend', () => {
  // -----------------------------------------------------------------------
  // 1. Type re-exports are accessible
  // -----------------------------------------------------------------------
  describe('re-exported types', () => {
    it('should export all expected type names', () => {
      const pageData: PageData = {
        url: 'https://example.com',
        title: 'Test',
        html: '<html></html>',
        text: 'Test',
        links: [],
        forms: [],
        consoleMessages: [],
        networkErrors: [],
      };
      expect(pageData.url).toBe('https://example.com');

      const msg: ConsoleMessage = { type: 'error', text: 'oops', timestamp: 1 };
      expect(msg.type).toBe('error');

      const nr: NetworkRequest = {
        url: 'https://api.example.com',
        method: 'GET',
        status: 200,
        statusText: 'OK',
        contentType: 'application/json',
        durationMs: 42,
        isError: false,
        timestamp: 1,
      };
      expect(nr.isError).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 2. createBrowserBackend factory
  // -----------------------------------------------------------------------
  describe('createBrowserBackend', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
      vi.resetModules();
    });

    it('type "playwright" creates PlaywrightBrowserAdapter', async () => {
      const mockAdapter = makeMockBackend('playwright');

      vi.doMock('../../src/playwright-browser-adapter', () => ({
        PlaywrightBrowserAdapter: vi.fn().mockImplementation(() => mockAdapter),
      }));

      const { createBrowserBackend } = await import('../../src/browser-backend');

      const backend = await createBrowserBackend({ type: 'playwright' });
      expect(backend).toBe(mockAdapter);
      expect(backend.name).toBe('playwright');
    });

    it('passes config to the backend constructor', async () => {
      const constructorSpy = vi.fn().mockImplementation(() => makeMockBackend('playwright'));

      vi.doMock('../../src/playwright-browser-adapter', () => ({
        PlaywrightBrowserAdapter: constructorSpy,
      }));

      const { createBrowserBackend } = await import('../../src/browser-backend');

      const config: BrowserBackendConfig = {
        type: 'playwright',
        headless: false,
        timeoutMs: 60000,
        screenshots: true,
      };

      await createBrowserBackend(config);
      expect(constructorSpy).toHaveBeenCalledWith(config);
    });
  });

  // -----------------------------------------------------------------------
  // 3. BrowserBackendConfig defaults
  // -----------------------------------------------------------------------
  describe('BrowserBackendConfig defaults', () => {
    it('optional fields are indeed optional', () => {
      const minConfig: BrowserBackendConfig = { type: 'playwright' };
      expect(minConfig.headless).toBeUndefined();
      expect(minConfig.timeoutMs).toBeUndefined();
      expect(minConfig.screenshots).toBeUndefined();
      expect(minConfig.authConfig).toBeUndefined();
    });

    it('accepts the playwright BrowserBackendType value', () => {
      const types: BrowserBackendType[] = ['playwright'];
      types.forEach((t) => {
        const config: BrowserBackendConfig = { type: t };
        expect(config.type).toBe(t);
      });
    });
  });
});
