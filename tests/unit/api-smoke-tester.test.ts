/**
 * API Smoke Tester Unit Tests
 * Tests endpoint discovery, testing, finding generation, and stat computation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ApiSmokeTester,
  type DiscoveredEndpoint,
  type EndpointTestResult,
} from '../../src/api-smoke-tester';
import type { BrowserBackend, NetworkRequest } from '../../src/browser-backend';
import type { PageData } from '../../src/playwright-browser';

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
      statusCode: 200,
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
// Helper to build a mock PageData with a given status code
// ---------------------------------------------------------------------------

function pageWithStatus(statusCode: number, text = ''): PageData {
  return {
    url: 'http://localhost',
    title: 'Test',
    html: '',
    text,
    links: [],
    forms: [],
    consoleMessages: [],
    networkErrors: [],
    statusCode,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ApiSmokeTester', () => {
  let backend: BrowserBackend;
  let tester: ApiSmokeTester;

  beforeEach(() => {
    backend = createMockBackend();
    tester = new ApiSmokeTester(backend, 'http://localhost:3000');
  });

  // -----------------------------------------------------------------------
  // discoverEndpoints
  // -----------------------------------------------------------------------

  describe('discoverEndpoints', () => {
    it('extracts from network captures', () => {
      const captures: NetworkRequest[] = [
        {
          url: 'http://localhost:3000/api/users',
          method: 'GET',
          status: 200,
          statusText: 'OK',
          contentType: 'application/json',
          durationMs: 50,
          isError: false,
          timestamp: Date.now(),
        },
        {
          url: 'http://localhost:3000/api/posts',
          method: 'POST',
          status: 201,
          statusText: 'Created',
          contentType: 'application/json',
          durationMs: 100,
          isError: false,
          timestamp: Date.now(),
        },
      ];

      const endpoints = tester.discoverEndpoints(undefined, captures);

      expect(endpoints.length).toBe(2);
      expect(endpoints.some((e) => e.path === '/api/users')).toBe(true);
      expect(endpoints.some((e) => e.path === '/api/posts')).toBe(true);
    });

    it('filters to API URLs only', () => {
      const captures: NetworkRequest[] = [
        {
          url: 'http://localhost:3000/api/data',
          method: 'GET',
          status: 200,
          statusText: 'OK',
          contentType: 'application/json',
          durationMs: 50,
          isError: false,
          timestamp: Date.now(),
        },
        {
          url: 'http://localhost:3000/about',
          method: 'GET',
          status: 200,
          statusText: 'OK',
          contentType: 'text/html',
          durationMs: 30,
          isError: false,
          timestamp: Date.now(),
        },
        {
          url: 'http://localhost:3000/styles.css',
          method: 'GET',
          status: 200,
          statusText: 'OK',
          contentType: 'text/css',
          durationMs: 10,
          isError: false,
          timestamp: Date.now(),
        },
      ];

      const endpoints = tester.discoverEndpoints(undefined, captures);

      // Only /api/data matches the API_PATH_RE pattern
      expect(endpoints.length).toBe(1);
      expect(endpoints[0].path).toBe('/api/data');
    });

    it('deduplicates by path+method', () => {
      const captures: NetworkRequest[] = [
        {
          url: 'http://localhost:3000/api/users',
          method: 'GET',
          status: 200,
          statusText: 'OK',
          contentType: 'application/json',
          durationMs: 50,
          isError: false,
          timestamp: Date.now(),
        },
        {
          url: 'http://localhost:3000/api/users',
          method: 'GET',
          status: 200,
          statusText: 'OK',
          contentType: 'application/json',
          durationMs: 60,
          isError: false,
          timestamp: Date.now(),
        },
      ];

      const endpoints = tester.discoverEndpoints(undefined, captures);

      // Should be deduplicated to just 1
      expect(endpoints.length).toBe(1);
      expect(endpoints[0].path).toBe('/api/users');
    });
  });

  // -----------------------------------------------------------------------
  // testEndpoints
  // -----------------------------------------------------------------------

  describe('testEndpoints', () => {
    it('only tests GET and HEAD', async () => {
      const endpoints: DiscoveredEndpoint[] = [
        { path: '/api/users', method: 'GET', source: 'code-analysis' },
        { path: '/api/users', method: 'POST', source: 'code-analysis' },
        { path: '/api/health', method: 'HEAD', source: 'code-analysis' },
        { path: '/api/items', method: 'DELETE', source: 'code-analysis' },
        { path: '/api/items', method: 'PUT', source: 'code-analysis' },
      ];

      const report = await tester.testEndpoints(endpoints);

      // Only GET and HEAD should be tested (2 endpoints)
      expect(report.results.length).toBe(2);
      expect(report.endpoints.length).toBe(2);
      expect(report.endpoints.every((e) => e.method === 'GET' || e.method === 'HEAD')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // generateFindings
  // -----------------------------------------------------------------------

  describe('generateFindings', () => {
    it('creates P0 for 500 errors', async () => {
      (backend.visitPage as ReturnType<typeof vi.fn>).mockResolvedValue(
        pageWithStatus(500, 'Internal Server Error'),
      );

      const endpoints: DiscoveredEndpoint[] = [
        { path: '/api/broken', method: 'GET', source: 'network-capture' },
      ];

      const report = await tester.testEndpoints(endpoints);

      const p0 = report.findings.filter((f) => f.severity === 'P0');
      expect(p0.length).toBe(1);
      expect(p0[0].title).toContain('Server error');
      expect(p0[0].title).toContain('/api/broken');
    });

    it('creates P1 for code-analysis 404', async () => {
      (backend.visitPage as ReturnType<typeof vi.fn>).mockResolvedValue(
        pageWithStatus(404, 'Not Found'),
      );

      const endpoints: DiscoveredEndpoint[] = [
        { path: '/api/missing', method: 'GET', source: 'code-analysis' },
      ];

      const report = await tester.testEndpoints(endpoints);

      const p1 = report.findings.filter((f) => f.severity === 'P1');
      expect(p1.length).toBe(1);
      expect(p1[0].title).toContain('404');
      expect(p1[0].title).toContain('/api/missing');
      expect(p1[0].description).toContain('code analysis');
    });

    it('creates P2 for unexpected auth failure', async () => {
      (backend.visitPage as ReturnType<typeof vi.fn>).mockResolvedValue(
        pageWithStatus(401, 'Unauthorized'),
      );

      const endpoints: DiscoveredEndpoint[] = [
        {
          path: '/api/public',
          method: 'GET',
          source: 'code-analysis',
          requiresAuth: false,
        },
      ];

      const report = await tester.testEndpoints(endpoints);

      const p2 = report.findings.filter((f) => f.severity === 'P2');
      expect(p2.length).toBe(1);
      expect(p2[0].title).toContain('Unexpected auth');
      expect(p2[0].title).toContain('/api/public');
    });

    it('does not create P1 for 404 from network-capture source', async () => {
      (backend.visitPage as ReturnType<typeof vi.fn>).mockResolvedValue(
        pageWithStatus(404, 'Not Found'),
      );

      const endpoints: DiscoveredEndpoint[] = [
        { path: '/api/gone', method: 'GET', source: 'network-capture' },
      ];

      const report = await tester.testEndpoints(endpoints);

      // 404 from network-capture should NOT generate a P1 finding
      // (P1 is only for code-analysis source)
      const p1 = report.findings.filter((f) => f.severity === 'P1');
      expect(p1.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // computeStats
  // -----------------------------------------------------------------------

  describe('computeStats', () => {
    it('tallies categories correctly', async () => {
      // Return different status codes for sequential calls
      const visitMock = backend.visitPage as ReturnType<typeof vi.fn>;
      visitMock
        .mockResolvedValueOnce(pageWithStatus(200))
        .mockResolvedValueOnce(pageWithStatus(200))
        .mockResolvedValueOnce(pageWithStatus(401))
        .mockResolvedValueOnce(pageWithStatus(404))
        .mockResolvedValueOnce(pageWithStatus(500));

      const endpoints: DiscoveredEndpoint[] = [
        { path: '/api/a', method: 'GET', source: 'code-analysis' },
        { path: '/api/b', method: 'GET', source: 'code-analysis' },
        { path: '/api/c', method: 'GET', source: 'code-analysis' },
        { path: '/api/d', method: 'GET', source: 'code-analysis' },
        { path: '/api/e', method: 'GET', source: 'code-analysis' },
      ];

      const report = await tester.testEndpoints(endpoints);

      expect(report.stats.total).toBe(5);
      expect(report.stats.success).toBe(2);
      expect(report.stats.authFailure).toBe(1);
      expect(report.stats.notFound).toBe(1);
      expect(report.stats.serverError).toBe(1);
      expect(report.stats.timeout).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // extractFromCodeAnalysis
  // -----------------------------------------------------------------------

  describe('extractFromCodeAnalysis', () => {
    it('handles route arrays', () => {
      const codeAnalysis = {
        routes: [
          '/api/users',
          { path: '/api/posts', method: 'GET' },
          { route: '/api/comments', method: 'POST' },
        ],
      };

      const endpoints = tester.discoverEndpoints(codeAnalysis);

      expect(endpoints.length).toBeGreaterThanOrEqual(3);
      expect(endpoints.some((e) => e.path === '/api/users')).toBe(true);
      expect(endpoints.some((e) => e.path === '/api/posts')).toBe(true);
      expect(endpoints.some((e) => e.path === '/api/comments')).toBe(true);
    });

    it('extracts from Next.js file paths', () => {
      const codeAnalysis = {
        files: [
          'pages/api/users/index.ts',
          'pages/api/posts/[id].ts',
          'src/components/Button.tsx',
        ],
      };

      const endpoints = tester.discoverEndpoints(codeAnalysis);

      // Should discover /api/users and /api/posts/[id] but NOT Button.tsx
      expect(endpoints.some((e) => e.path === '/api/users')).toBe(true);
      expect(endpoints.some((e) => e.path === '/api/posts/[id]')).toBe(true);
      expect(endpoints.some((e) => e.path.includes('Button'))).toBe(false);
    });
  });
});
