/**
 * Tests for FindingGenerator - autonomous finding generation from phase data.
 *
 * Covers:
 * - generateFromExploration (HTTP 500, loading stuck, empty shell, normal pages)
 * - generateFromDiagnostics (severity mapping from DiagnosisCategory)
 * - generateFromInteractions (console errors, network failures, hasError)
 * - generateFromResponsive (direct mapping)
 * - generateFromApiSmoke (direct mapping)
 * - Finding ID auto-increment (F-001, F-002, F-003, ...)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  FindingGenerator,
  type InteractionTestResult,
  type PageInteractionResult,
  type ResponsivePageResult,
  type ResponsiveFinding,
  type ApiSmokeReport,
  type ApiSmokeFinding,
  type GeneratedFinding,
} from '../../src/finding-generator';
import type { PageData, ConsoleMessage, NetworkError } from '../../src/playwright-browser';
import type {
  PageDiagnosticReport,
  PageDiagnosis,
  DiagnosticStats,
  DiagnosticEvidence,
  DiagnosisCategory,
} from '../../src/page-diagnostics';

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function makePageData(overrides: Partial<PageData> = {}): PageData {
  return {
    url: 'https://example.com/test',
    title: 'Test',
    html: '<html><body>Test</body></html>',
    text: 'Test content here with enough words to be a normal page',
    links: ['https://example.com/a', 'https://example.com/b'],
    forms: [{ action: '', method: 'GET', fields: [] }],
    consoleMessages: [],
    networkErrors: [],
    ...overrides,
  };
}

function makeDiagnosis(overrides: Partial<PageDiagnosis> = {}): PageDiagnosis {
  return {
    id: 'diag-1',
    url: 'https://example.com/test',
    category: 'js-error',
    severity: 'error',
    title: 'Test diagnosis',
    description: 'Test diagnosis description',
    evidence: [{ source: 'console', raw: 'Error: test' }],
    suggestedCause: 'Test cause',
    ...overrides,
  };
}

function makeDiagnosticReport(
  diagnoses: PageDiagnosis[] = [],
  overrides: Partial<PageDiagnosticReport> = {},
): PageDiagnosticReport {
  return {
    url: 'https://example.com/test',
    analyzedAt: new Date().toISOString(),
    diagnoses,
    stats: {
      consoleErrors: 0,
      consoleWarnings: 0,
      networkErrors: 0,
      slowRequests: 0,
      totalRequests: 0,
      pageLoadTimeMs: 500,
    },
    ...overrides,
  };
}

function makeInteractionResult(
  overrides: Partial<InteractionTestResult> = {},
): InteractionTestResult {
  return {
    url: 'https://example.com/test',
    element: { text: 'Submit', elementType: 'button' },
    hasError: false,
    description: 'Clicked Submit button',
    consoleErrors: [],
    failedRequests: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FindingGenerator', () => {
  let gen: FindingGenerator;

  beforeEach(() => {
    gen = new FindingGenerator('/tmp/test-audit');
  });

  // =========================================================================
  // generateFromExploration
  // =========================================================================

  describe('generateFromExploration', () => {
    it('should create P0 finding for HTTP 500 page', () => {
      const page = makePageData({
        url: 'https://example.com/api-page',
        statusCode: 500,
        networkErrors: [
          { url: 'https://example.com/api-page', status: 500, statusText: 'Internal Server Error', method: 'GET' },
        ],
      });

      const findings = gen.generateFromExploration([page]);

      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('P0');
      expect(findings[0].title).toContain('500');
      expect(findings[0].title).toContain('Server Error');
      expect(findings[0].source).toBe('exploration');
      expect(findings[0].category).toBe('functionality');
    });

    it('should create P1 finding for page with "Loading..." text', () => {
      const page = makePageData({
        url: 'https://example.com/dashboard',
        text: 'Loading...',
        consoleMessages: [],
        networkErrors: [],
      });

      const findings = gen.generateFromExploration([page]);

      const loadingFinding = findings.find((f) => f.severity === 'P1');
      expect(loadingFinding).toBeDefined();
      expect(loadingFinding!.title).toContain('loading state');
      expect(loadingFinding!.description).toContain('loading indicators');
    });

    it('should create P2 finding for empty shell page (no forms, <=1 link, <100 chars)', () => {
      const page = makePageData({
        url: 'https://example.com/empty',
        text: 'Hello',
        links: [],
        forms: [],
      });

      const findings = gen.generateFromExploration([page]);

      const emptyFinding = findings.find((f) => f.severity === 'P2');
      expect(emptyFinding).toBeDefined();
      expect(emptyFinding!.title).toContain('empty shell');
      expect(emptyFinding!.description).toContain('no forms');
    });

    it('should create no findings for a normal page', () => {
      const page = makePageData({
        url: 'https://example.com/normal',
        statusCode: 200,
        text: 'This is a perfectly normal page with plenty of content and interactive elements for the user to enjoy browsing.',
        links: ['https://example.com/a', 'https://example.com/b', 'https://example.com/c'],
        forms: [{ action: '/search', method: 'GET', fields: [{ name: 'q', type: 'text', required: false }] }],
      });

      const findings = gen.generateFromExploration([page]);

      expect(findings).toHaveLength(0);
    });

    it('should create multiple findings for issues on different pages', () => {
      const pages = [
        makePageData({
          url: 'https://example.com/broken',
          statusCode: 502,
          networkErrors: [
            { url: 'https://example.com/broken', status: 502, statusText: 'Bad Gateway', method: 'GET' },
          ],
        }),
        makePageData({
          url: 'https://example.com/loading',
          text: 'Please wait',
          consoleMessages: [],
          networkErrors: [],
        }),
        makePageData({
          url: 'https://example.com/shell',
          text: 'Hi',
          links: ['https://example.com'],
          forms: [],
        }),
      ];

      const findings = gen.generateFromExploration(pages);

      expect(findings.length).toBeGreaterThanOrEqual(3);
      expect(findings.some((f) => f.severity === 'P0')).toBe(true);
      expect(findings.some((f) => f.severity === 'P1')).toBe(true);
      expect(findings.some((f) => f.severity === 'P2')).toBe(true);
    });
  });

  // =========================================================================
  // generateFromDiagnostics
  // =========================================================================

  describe('generateFromDiagnostics', () => {
    it('should map render-error diagnosis to P0', () => {
      const report = makeDiagnosticReport([
        makeDiagnosis({ category: 'render-error', severity: 'error', title: 'React error boundary triggered' }),
      ]);

      const findings = gen.generateFromDiagnostics([report]);

      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('P0');
      expect(findings[0].source).toBe('diagnostics');
    });

    it('should map js-error with severity=error to P1', () => {
      const report = makeDiagnosticReport([
        makeDiagnosis({ category: 'js-error', severity: 'error', title: 'TypeError: undefined is not a function' }),
      ]);

      const findings = gen.generateFromDiagnostics([report]);

      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('P1');
    });

    it('should map api-failure with severity=error to P1', () => {
      const report = makeDiagnosticReport([
        makeDiagnosis({
          category: 'api-failure',
          severity: 'error',
          title: 'API GET 500',
          evidence: [{ source: 'network', raw: 'GET /api/data -> 500' }],
        }),
      ]);

      const findings = gen.generateFromDiagnostics([report]);

      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('P1');
    });

    it('should map loading-stuck diagnosis to P1', () => {
      const report = makeDiagnosticReport([
        makeDiagnosis({
          category: 'loading-stuck',
          severity: 'error',
          title: 'Page appears stuck in loading state',
          evidence: [{ source: 'dom', raw: 'Loading text detected' }],
        }),
      ]);

      const findings = gen.generateFromDiagnostics([report]);

      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('P1');
    });

    it('should map missing-resource diagnosis to P2', () => {
      const report = makeDiagnosticReport([
        makeDiagnosis({
          category: 'missing-resource',
          severity: 'error',
          title: 'Missing JS resource (404)',
          evidence: [{ source: 'network', raw: 'GET /bundle.js -> 404' }],
        }),
      ]);

      const findings = gen.generateFromDiagnostics([report]);

      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('P2');
    });

    it('should map slow-request diagnosis to P3', () => {
      const report = makeDiagnosticReport([
        makeDiagnosis({
          category: 'slow-request',
          severity: 'warning',
          title: 'Slow request: 5000ms',
          evidence: [{ source: 'network', raw: 'GET /api/heavy -> 200 (5000ms)' }],
        }),
      ]);

      const findings = gen.generateFromDiagnostics([report]);

      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('P3');
    });

    it('should skip info severity diagnoses', () => {
      const report = makeDiagnosticReport([
        makeDiagnosis({ severity: 'info', title: 'Informational message' }),
      ]);

      const findings = gen.generateFromDiagnostics([report]);

      expect(findings).toHaveLength(0);
    });
  });

  // =========================================================================
  // generateFromInteractions
  // =========================================================================

  describe('generateFromInteractions', () => {
    it('should create P1 finding for interaction with console errors', () => {
      const results: PageInteractionResult[] = [
        {
          url: 'https://example.com/form',
          elementsTested: [
            makeInteractionResult({
              hasError: true,
              consoleErrors: [{ text: 'Uncaught TypeError: cannot read property of null' }],
              failedRequests: [],
            }),
          ],
        },
      ];

      const findings = gen.generateFromInteractions(results);

      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('P1');
      expect(findings[0].source).toBe('form-testing');
      expect(findings[0].description).toContain('Console errors');
    });

    it('should create no finding for interaction with no errors', () => {
      const results: PageInteractionResult[] = [
        {
          url: 'https://example.com/form',
          elementsTested: [
            makeInteractionResult({ hasError: false }),
          ],
        },
      ];

      const findings = gen.generateFromInteractions(results);

      expect(findings).toHaveLength(0);
    });

    it('should create P2 finding for interaction with hasError but no console/network errors', () => {
      const results: PageInteractionResult[] = [
        {
          url: 'https://example.com/form',
          elementsTested: [
            makeInteractionResult({
              hasError: true,
              consoleErrors: [],
              failedRequests: [],
            }),
          ],
        },
      ];

      const findings = gen.generateFromInteractions(results);

      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('P2');
    });

    it('should create P1 finding when interaction has 500+ network failures', () => {
      const results: PageInteractionResult[] = [
        {
          url: 'https://example.com/form',
          elementsTested: [
            makeInteractionResult({
              hasError: true,
              consoleErrors: [],
              failedRequests: [
                { method: 'POST', url: 'https://example.com/api/submit', status: 500 },
              ],
            }),
          ],
        },
      ];

      const findings = gen.generateFromInteractions(results);

      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('P1');
      expect(findings[0].description).toContain('Failed requests');
    });
  });

  // =========================================================================
  // generateFromResponsive
  // =========================================================================

  describe('generateFromResponsive', () => {
    it('should map responsive findings correctly', () => {
      const results: ResponsivePageResult[] = [
        {
          url: 'https://example.com/home',
          findings: [
            {
              title: 'Horizontal overflow on mobile',
              severity: 'P2',
              url: 'https://example.com/home',
              viewport: '375x667',
              description: 'Content overflows horizontally on iPhone SE viewport',
            },
            {
              title: 'Text too small on tablet',
              severity: 'P3',
              url: 'https://example.com/home',
              viewport: '768x1024',
              description: 'Body text is 10px on iPad viewport',
            },
          ],
        },
      ];

      const findings = gen.generateFromResponsive(results);

      expect(findings).toHaveLength(2);
      expect(findings[0].severity).toBe('P2');
      expect(findings[0].category).toBe('ux');
      expect(findings[0].source).toBe('responsive-testing');
      expect(findings[0].steps_to_reproduce).toContain('375x667');
      expect(findings[1].severity).toBe('P3');
    });
  });

  // =========================================================================
  // generateFromApiSmoke
  // =========================================================================

  describe('generateFromApiSmoke', () => {
    it('should map API smoke findings correctly', () => {
      const report: ApiSmokeReport = {
        baseUrl: 'https://example.com',
        testedAt: new Date().toISOString(),
        endpoints: [
          { url: 'https://example.com/api/health', method: 'GET', status: 200, durationMs: 50 },
          { url: 'https://example.com/api/users', method: 'GET', status: 500, durationMs: 1200 },
        ],
        findings: [
          {
            title: 'API /api/users returns 500',
            severity: 'P0',
            url: 'https://example.com/api/users',
            description: 'GET /api/users returned 500 Internal Server Error',
            evidence: { status: 500, statusText: 'Internal Server Error' },
          },
        ],
      };

      const findings = gen.generateFromApiSmoke(report);

      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('P0');
      expect(findings[0].category).toBe('functionality');
      expect(findings[0].source).toBe('api-smoke');
      expect(findings[0].steps_to_reproduce).toContain('GET request');
      expect(findings[0].evidence.networkRequests).toContain('GET https://example.com/api/users -> 500');
    });
  });

  // =========================================================================
  // Finding ID auto-increment
  // =========================================================================

  describe('Finding ID auto-increment', () => {
    it('should auto-increment finding IDs as F-001, F-002, F-003, etc.', () => {
      const pages = [
        makePageData({
          url: 'https://example.com/a',
          statusCode: 500,
          networkErrors: [
            { url: 'https://example.com/a', status: 500, statusText: 'Error', method: 'GET' },
          ],
        }),
        makePageData({
          url: 'https://example.com/b',
          statusCode: 503,
          networkErrors: [
            { url: 'https://example.com/b', status: 503, statusText: 'Error', method: 'GET' },
          ],
        }),
      ];

      const findings = gen.generateFromExploration(pages);

      expect(findings[0].id).toBe('F-001');
      expect(findings[1].id).toBe('F-002');
    });

    it('should continue incrementing IDs across different generator methods', () => {
      // First call: exploration
      const explorationFindings = gen.generateFromExploration([
        makePageData({
          url: 'https://example.com/crash',
          statusCode: 500,
          networkErrors: [
            { url: 'https://example.com/crash', status: 500, statusText: 'Error', method: 'GET' },
          ],
        }),
      ]);

      expect(explorationFindings[0].id).toBe('F-001');

      // Second call: diagnostics
      const diagFindings = gen.generateFromDiagnostics([
        makeDiagnosticReport([
          makeDiagnosis({ category: 'render-error', severity: 'error' }),
        ]),
      ]);

      expect(diagFindings[0].id).toBe('F-002');

      // Third call: interactions
      const interactionFindings = gen.generateFromInteractions([
        {
          url: 'https://example.com/form',
          elementsTested: [
            makeInteractionResult({ hasError: true, consoleErrors: [{ text: 'Error' }] }),
          ],
        },
      ]);

      expect(interactionFindings[0].id).toBe('F-003');
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe('edge cases', () => {
    it('should handle page with both HTTP 500 and loading text', () => {
      const page = makePageData({
        url: 'https://example.com/bad',
        statusCode: 500,
        text: 'Loading...',
        networkErrors: [
          { url: 'https://example.com/bad', status: 500, statusText: 'Error', method: 'GET' },
        ],
      });

      const findings = gen.generateFromExploration([page]);

      // Should produce at least a P0 (HTTP 500) and potentially a P1 (loading)
      expect(findings.length).toBeGreaterThanOrEqual(1);
      expect(findings.some((f) => f.severity === 'P0')).toBe(true);
    });

    it('should include API errors in loading-stuck root cause description', () => {
      const page = makePageData({
        url: 'https://example.com/dashboard',
        text: 'Loading...',
        networkErrors: [
          { url: 'https://example.com/api/data', status: 500, statusText: 'Error', method: 'GET' },
        ],
      });

      const findings = gen.generateFromExploration([page]);

      const loadingFinding = findings.find((f) => f.severity === 'P1');
      expect(loadingFinding).toBeDefined();
      expect(loadingFinding!.description).toContain('API call');
    });

    it('should handle empty arrays without errors', () => {
      expect(gen.generateFromExploration([])).toEqual([]);
      expect(gen.generateFromDiagnostics([])).toEqual([]);
      expect(gen.generateFromInteractions([])).toEqual([]);
      expect(gen.generateFromResponsive([])).toEqual([]);
    });

    it('should use pathname as page name for non-root URLs', () => {
      const page = makePageData({
        url: 'https://example.com/dashboard/settings',
        text: 'Loading...',
      });

      const findings = gen.generateFromExploration([page]);

      const loadingFinding = findings.find((f) => f.severity === 'P1');
      expect(loadingFinding).toBeDefined();
      expect(loadingFinding!.title).toContain('/dashboard/settings');
    });

    it('should use "Homepage" for root path pages', () => {
      const page = makePageData({
        url: 'https://example.com/',
        text: 'Loading...',
      });

      const findings = gen.generateFromExploration([page]);

      const loadingFinding = findings.find((f) => f.severity === 'P1');
      expect(loadingFinding).toBeDefined();
      expect(loadingFinding!.title).toContain('Homepage');
    });

    it('should map js-error with severity=warning to P2', () => {
      const report = makeDiagnosticReport([
        makeDiagnosis({ category: 'js-error', severity: 'warning', title: 'Deprecated API usage' }),
      ]);

      const findings = gen.generateFromDiagnostics([report]);

      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('P2');
    });
  });
});
