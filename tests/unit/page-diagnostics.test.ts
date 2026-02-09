/**
 * Tests for PageDiagnostics - console and network issue detection.
 *
 * Validates each diagnostic category using mock PageData objects,
 * without requiring a real browser.
 */

import { describe, it, expect } from 'vitest';
import {
  PageDiagnostics,
  type PageDiagnosticReport,
  type DiagnosisCategory,
} from '../../src/page-diagnostics';
import type { PageData, ConsoleMessage, NetworkError } from '../../src/playwright-browser';
import type { NetworkRequest } from '../../src/browser-backend';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePageData(
  overrides: Partial<PageData> & { networkRequests?: NetworkRequest[] } = {},
): PageData & { networkRequests?: NetworkRequest[] } {
  return {
    url: 'https://example.com',
    title: 'Test',
    html: '<html><body>Test</body></html>',
    text: 'Test content',
    links: [],
    forms: [],
    consoleMessages: [],
    networkErrors: [],
    ...overrides,
  };
}

function makeConsoleMessage(
  overrides: Partial<ConsoleMessage> = {},
): ConsoleMessage {
  return {
    type: 'log',
    text: '',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeNetworkError(
  overrides: Partial<NetworkError> = {},
): NetworkError {
  return {
    url: 'https://example.com/api/data',
    status: 500,
    statusText: 'Internal Server Error',
    method: 'GET',
    ...overrides,
  };
}

function makeNetworkRequest(
  overrides: Partial<NetworkRequest> = {},
): NetworkRequest {
  return {
    url: 'https://example.com/api/data',
    method: 'GET',
    status: 200,
    statusText: 'OK',
    contentType: 'application/json',
    durationMs: 100,
    isError: false,
    timestamp: Date.now(),
    ...overrides,
  };
}

function findByCategory(
  report: PageDiagnosticReport,
  category: DiagnosisCategory,
) {
  return report.diagnoses.filter((d) => d.category === category);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PageDiagnostics', () => {
  const diag = new PageDiagnostics();

  // -----------------------------------------------------------------------
  // 1. JS error detection
  // -----------------------------------------------------------------------
  describe('JS error detection', () => {
    it('should create js-error diagnosis from console error messages', () => {
      const pageData = makePageData({
        consoleMessages: [
          makeConsoleMessage({
            type: 'error',
            text: 'Uncaught TypeError: Cannot read property "foo" of undefined',
          }),
        ],
      });

      const report = diag.analyzePage(pageData);
      const jsErrors = findByCategory(report, 'js-error');

      expect(jsErrors).toHaveLength(1);
      expect(jsErrors[0].severity).toBe('error');
      expect(jsErrors[0].title).toContain('TypeError');
      expect(jsErrors[0].evidence[0].source).toBe('console');
    });

    it('should not flag non-error console messages as js-error', () => {
      const pageData = makePageData({
        consoleMessages: [
          makeConsoleMessage({ type: 'log', text: 'App initialized' }),
          makeConsoleMessage({ type: 'warning', text: 'Deprecation notice' }),
        ],
      });

      const report = diag.analyzePage(pageData);
      const jsErrors = findByCategory(report, 'js-error');

      expect(jsErrors).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // 2. API failure detection
  // -----------------------------------------------------------------------
  describe('API failure detection', () => {
    it('should create api-failure diagnosis for 5xx on /api/ URLs', () => {
      const pageData = makePageData({
        networkErrors: [
          makeNetworkError({
            url: 'https://example.com/api/users',
            status: 500,
            statusText: 'Internal Server Error',
            method: 'GET',
          }),
        ],
      });

      const report = diag.analyzePage(pageData);
      const apiFailures = findByCategory(report, 'api-failure');

      expect(apiFailures).toHaveLength(1);
      expect(apiFailures[0].severity).toBe('error');
      expect(apiFailures[0].title).toContain('500');
      expect(apiFailures[0].url).toBe('https://example.com/api/users');
    });

    it('should create api-failure diagnosis for 4xx on /api/ URLs (not 401/403)', () => {
      const pageData = makePageData({
        networkErrors: [
          makeNetworkError({
            url: 'https://example.com/api/items',
            status: 400,
            statusText: 'Bad Request',
            method: 'POST',
          }),
        ],
      });

      const report = diag.analyzePage(pageData);
      const apiFailures = findByCategory(report, 'api-failure');

      expect(apiFailures).toHaveLength(1);
      expect(apiFailures[0].severity).toBe('warning');
      expect(apiFailures[0].title).toContain('400');
    });

    it('should not create api-failure for non-API URLs', () => {
      const pageData = makePageData({
        networkErrors: [
          makeNetworkError({
            url: 'https://example.com/page/broken',
            status: 500,
            statusText: 'Internal Server Error',
          }),
        ],
      });

      const report = diag.analyzePage(pageData);
      const apiFailures = findByCategory(report, 'api-failure');

      expect(apiFailures).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Missing resource detection
  // -----------------------------------------------------------------------
  describe('Missing resource detection', () => {
    it('should create missing-resource diagnosis for 404 on .js files', () => {
      const pageData = makePageData({
        networkErrors: [
          makeNetworkError({
            url: 'https://example.com/static/bundle.js',
            status: 404,
            statusText: 'Not Found',
          }),
        ],
      });

      const report = diag.analyzePage(pageData);
      const missing = findByCategory(report, 'missing-resource');

      expect(missing).toHaveLength(1);
      expect(missing[0].severity).toBe('error');
      expect(missing[0].title).toContain('JS');
      expect(missing[0].title).toContain('404');
    });

    it('should create missing-resource diagnosis for 404 on .css files', () => {
      const pageData = makePageData({
        networkErrors: [
          makeNetworkError({
            url: 'https://example.com/styles/main.css',
            status: 404,
            statusText: 'Not Found',
          }),
        ],
      });

      const report = diag.analyzePage(pageData);
      const missing = findByCategory(report, 'missing-resource');

      expect(missing).toHaveLength(1);
      expect(missing[0].severity).toBe('error');
      expect(missing[0].title).toContain('CSS');
    });

    it('should flag missing images as warning severity', () => {
      const pageData = makePageData({
        networkErrors: [
          makeNetworkError({
            url: 'https://example.com/images/hero.png',
            status: 404,
            statusText: 'Not Found',
          }),
        ],
      });

      const report = diag.analyzePage(pageData);
      const missing = findByCategory(report, 'missing-resource');

      expect(missing).toHaveLength(1);
      expect(missing[0].severity).toBe('warning');
    });
  });

  // -----------------------------------------------------------------------
  // 4. Loading stuck detection
  // -----------------------------------------------------------------------
  describe('Loading stuck detection', () => {
    it('should create loading-stuck diagnosis when page text contains "Loading..." and minimal content', () => {
      const pageData = makePageData({
        text: 'Loading...',
        html: '<html><body><div class="loading-spinner">Loading...</div></body></html>',
      });

      const report = diag.analyzePage(pageData);
      const stuck = findByCategory(report, 'loading-stuck');

      expect(stuck).toHaveLength(1);
      expect(stuck[0].severity).toBe('error');
      expect(stuck[0].category).toBe('loading-stuck');
    });

    it('should not flag loading-stuck on a page with substantial content', () => {
      // Page text is long and does not have DOM loading indicators
      const pageData = makePageData({
        text: 'Loading indicator in the footer. ' + 'Real page content. '.repeat(50),
        html: '<html><body>' + '<p>Real page content.</p>'.repeat(50) + '</body></html>',
      });

      const report = diag.analyzePage(pageData);
      const stuck = findByCategory(report, 'loading-stuck');

      expect(stuck).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Auth failure detection
  // -----------------------------------------------------------------------
  describe('Auth failure detection', () => {
    it('should create auth-failure diagnosis for 401 responses', () => {
      const pageData = makePageData({
        networkErrors: [
          makeNetworkError({
            url: 'https://example.com/api/profile',
            status: 401,
            statusText: 'Unauthorized',
            method: 'GET',
          }),
        ],
      });

      const report = diag.analyzePage(pageData);
      const authFailures = findByCategory(report, 'auth-failure');

      expect(authFailures).toHaveLength(1);
      expect(authFailures[0].severity).toBe('error');
      expect(authFailures[0].title).toContain('401');
    });

    it('should create auth-failure diagnosis for 403 responses', () => {
      const pageData = makePageData({
        networkErrors: [
          makeNetworkError({
            url: 'https://example.com/api/admin',
            status: 403,
            statusText: 'Forbidden',
            method: 'GET',
          }),
        ],
      });

      const report = diag.analyzePage(pageData);
      const authFailures = findByCategory(report, 'auth-failure');

      expect(authFailures).toHaveLength(1);
      expect(authFailures[0].title).toContain('403');
    });

    it('should not double-report 401/403 as api-failure', () => {
      const pageData = makePageData({
        networkErrors: [
          makeNetworkError({
            url: 'https://example.com/api/secret',
            status: 401,
            statusText: 'Unauthorized',
          }),
        ],
      });

      const report = diag.analyzePage(pageData);
      const apiFailures = findByCategory(report, 'api-failure');
      const authFailures = findByCategory(report, 'auth-failure');

      expect(apiFailures).toHaveLength(0);
      expect(authFailures).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // 6. CORS error detection
  // -----------------------------------------------------------------------
  describe('CORS error detection', () => {
    it('should create cors-error diagnosis for CORS console errors', () => {
      const pageData = makePageData({
        consoleMessages: [
          makeConsoleMessage({
            type: 'error',
            text: "Access to XMLHttpRequest at 'https://api.other.com/data' from origin 'https://example.com' has been blocked by CORS policy",
          }),
        ],
      });

      const report = diag.analyzePage(pageData);
      const corsErrors = findByCategory(report, 'cors-error');

      expect(corsErrors).toHaveLength(1);
      expect(corsErrors[0].severity).toBe('error');
      expect(corsErrors[0].category).toBe('cors-error');
    });

    it('should not double-report CORS errors as js-error', () => {
      const pageData = makePageData({
        consoleMessages: [
          makeConsoleMessage({
            type: 'error',
            text: 'Access-Control-Allow-Origin header is missing on the requested resource',
          }),
        ],
      });

      const report = diag.analyzePage(pageData);
      const corsErrors = findByCategory(report, 'cors-error');
      const jsErrors = findByCategory(report, 'js-error');

      expect(corsErrors).toHaveLength(1);
      expect(jsErrors).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // 7. Framework error detection
  // -----------------------------------------------------------------------
  describe('Framework error detection', () => {
    it('should create render-error for React error boundary messages', () => {
      const pageData = makePageData({
        consoleMessages: [
          makeConsoleMessage({
            type: 'error',
            text: 'The above error occurred in the <UserProfile> component',
          }),
        ],
      });

      const report = diag.analyzePage(pageData);
      const renderErrors = findByCategory(report, 'render-error');

      expect(renderErrors).toHaveLength(1);
      expect(renderErrors[0].title).toContain('React error boundary');
      expect(renderErrors[0].severity).toBe('error');
    });

    it('should detect React error boundary fallback in DOM', () => {
      const pageData = makePageData({
        html: '<html><body><div class="error-boundary">Something went wrong</div></body></html>',
        text: 'Something went wrong',
      });

      const report = diag.analyzePage(pageData);
      const renderErrors = findByCategory(report, 'render-error');

      expect(renderErrors).toHaveLength(1);
      expect(renderErrors[0].title).toContain('error boundary fallback');
    });

    it('should detect React hydration mismatch', () => {
      const pageData = makePageData({
        consoleMessages: [
          makeConsoleMessage({
            type: 'error',
            text: 'Text content does not match server-rendered HTML',
          }),
        ],
      });

      const report = diag.analyzePage(pageData);
      const renderErrors = findByCategory(report, 'render-error');

      expect(renderErrors).toHaveLength(1);
      expect(renderErrors[0].title).toContain('hydration');
    });
  });

  // -----------------------------------------------------------------------
  // 8. Noise filtering
  // -----------------------------------------------------------------------
  describe('Noise filtering', () => {
    it('should filter out HMR console messages', () => {
      const pageData = makePageData({
        consoleMessages: [
          makeConsoleMessage({
            type: 'error',
            text: '[HMR] Waiting for update signal from WDS...',
          }),
          makeConsoleMessage({
            type: 'error',
            text: 'Uncaught ReferenceError: foo is not defined',
          }),
        ],
      });

      const report = diag.analyzePage(pageData);
      const jsErrors = findByCategory(report, 'js-error');

      // Only the real error should appear, HMR message should be filtered
      expect(jsErrors).toHaveLength(1);
      expect(jsErrors[0].title).toContain('ReferenceError');
    });

    it('should filter out React DevTools download messages', () => {
      const pageData = makePageData({
        consoleMessages: [
          makeConsoleMessage({
            type: 'log',
            text: 'Download the React DevTools for a better development experience',
          }),
        ],
      });

      const report = diag.analyzePage(pageData);

      expect(report.diagnoses).toHaveLength(0);
    });

    it('should filter out favicon.ico network errors', () => {
      const pageData = makePageData({
        networkErrors: [
          makeNetworkError({
            url: 'https://example.com/favicon.ico',
            status: 404,
            statusText: 'Not Found',
          }),
        ],
      });

      const report = diag.analyzePage(pageData);

      expect(report.diagnoses).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // 9. Stats computation
  // -----------------------------------------------------------------------
  describe('Stats computation', () => {
    it('should count console errors and warnings correctly', () => {
      const pageData = makePageData({
        consoleMessages: [
          makeConsoleMessage({ type: 'error', text: 'Error 1' }),
          makeConsoleMessage({ type: 'error', text: 'Error 2' }),
          makeConsoleMessage({ type: 'warning', text: 'Warning 1' }),
          makeConsoleMessage({ type: 'log', text: 'Just a log' }),
        ],
        networkErrors: [
          makeNetworkError({ url: 'https://example.com/api/fail', status: 500 }),
        ],
      });

      const report = diag.analyzePage(pageData);

      expect(report.stats.consoleErrors).toBe(2);
      expect(report.stats.consoleWarnings).toBe(1);
      expect(report.stats.networkErrors).toBe(1);
    });

    it('should compute slow requests and total requests from NetworkRequest[]', () => {
      const pageData = makePageData({
        networkRequests: [
          makeNetworkRequest({ durationMs: 100 }),
          makeNetworkRequest({ durationMs: 200 }),
          makeNetworkRequest({
            url: 'https://example.com/api/slow',
            durationMs: 5000,
          }),
        ],
      });

      const report = diag.analyzePage(pageData);

      expect(report.stats.totalRequests).toBe(3);
      expect(report.stats.slowRequests).toBe(1);
    });

    it('should use loadTimeMs from pageData when available', () => {
      const pageData = makePageData({ loadTimeMs: 1234 });
      const report = diag.analyzePage(pageData);

      expect(report.stats.pageLoadTimeMs).toBe(1234);
    });

    it('should default pageLoadTimeMs to 0 when not provided', () => {
      const pageData = makePageData();
      const report = diag.analyzePage(pageData);

      expect(report.stats.pageLoadTimeMs).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 10. Empty page
  // -----------------------------------------------------------------------
  describe('Empty page', () => {
    it('should produce no diagnoses for a clean page', () => {
      const pageData = makePageData();
      const report = diag.analyzePage(pageData);

      expect(report.diagnoses).toHaveLength(0);
      expect(report.url).toBe('https://example.com');
      expect(report.stats.consoleErrors).toBe(0);
      expect(report.stats.consoleWarnings).toBe(0);
      expect(report.stats.networkErrors).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 11. Slow request detection (V4 NetworkRequest[])
  // -----------------------------------------------------------------------
  describe('Slow request detection', () => {
    it('should flag requests exceeding the threshold as slow-request', () => {
      const pageData = makePageData({
        networkRequests: [
          makeNetworkRequest({
            url: 'https://example.com/api/heavy-query',
            durationMs: 5000,
            status: 200,
            statusText: 'OK',
          }),
        ],
      });

      const report = diag.analyzePage(pageData);
      const slow = findByCategory(report, 'slow-request');

      expect(slow).toHaveLength(1);
      expect(slow[0].title).toContain('5000ms');
      expect(slow[0].severity).toBe('warning');
    });

    it('should flag very slow requests (>2x threshold) as error severity', () => {
      const pageData = makePageData({
        networkRequests: [
          makeNetworkRequest({
            url: 'https://example.com/api/very-slow',
            durationMs: 7000,
            status: 200,
            statusText: 'OK',
          }),
        ],
      });

      const report = diag.analyzePage(pageData);
      const slow = findByCategory(report, 'slow-request');

      expect(slow).toHaveLength(1);
      expect(slow[0].severity).toBe('error');
    });

    it('should not flag fast requests as slow', () => {
      const pageData = makePageData({
        networkRequests: [
          makeNetworkRequest({ durationMs: 150 }),
          makeNetworkRequest({ durationMs: 800 }),
        ],
      });

      const report = diag.analyzePage(pageData);
      const slow = findByCategory(report, 'slow-request');

      expect(slow).toHaveLength(0);
    });

    it('should not produce slow-request diagnoses without networkRequests', () => {
      const pageData = makePageData();
      const report = diag.analyzePage(pageData);
      const slow = findByCategory(report, 'slow-request');

      expect(slow).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // 12. Custom config
  // -----------------------------------------------------------------------
  describe('Custom config', () => {
    it('should respect a custom slowRequestThresholdMs', () => {
      const customDiag = new PageDiagnostics({ slowRequestThresholdMs: 500 });
      const pageData = makePageData({
        networkRequests: [
          makeNetworkRequest({
            url: 'https://example.com/api/data',
            durationMs: 600,
          }),
        ],
      });

      const report = customDiag.analyzePage(pageData);
      const slow = findByCategory(report, 'slow-request');

      expect(slow).toHaveLength(1);
    });

    it('should respect custom ignoreConsolePatterns', () => {
      const customDiag = new PageDiagnostics({
        ignoreConsolePatterns: [/my-app-noise/],
      });
      const pageData = makePageData({
        consoleMessages: [
          makeConsoleMessage({
            type: 'error',
            text: '[my-app-noise] Some internal debug error',
          }),
          makeConsoleMessage({
            type: 'error',
            text: 'Uncaught TypeError: real error',
          }),
        ],
      });

      const report = customDiag.analyzePage(pageData);
      const jsErrors = findByCategory(report, 'js-error');

      expect(jsErrors).toHaveLength(1);
      expect(jsErrors[0].title).toContain('TypeError');
    });
  });

  // -----------------------------------------------------------------------
  // 13. Report structure
  // -----------------------------------------------------------------------
  describe('Report structure', () => {
    it('should include url and analyzedAt in the report', () => {
      const pageData = makePageData({ url: 'https://myapp.com/dashboard' });
      const report = diag.analyzePage(pageData);

      expect(report.url).toBe('https://myapp.com/dashboard');
      expect(report.analyzedAt).toBeDefined();
      // ISO timestamp format check
      expect(() => new Date(report.analyzedAt)).not.toThrow();
    });

    it('should produce deterministic diagnosis IDs within a report', () => {
      const pageData = makePageData({
        consoleMessages: [
          makeConsoleMessage({ type: 'error', text: 'Error A' }),
          makeConsoleMessage({ type: 'error', text: 'Error B' }),
        ],
      });

      const report = diag.analyzePage(pageData);

      expect(report.diagnoses[0].id).toBe('js-error-1');
      expect(report.diagnoses[1].id).toBe('js-error-2');
    });
  });
});
