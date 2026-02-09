/**
 * FindingGenerator - Autonomous finding generation from phase data.
 *
 * Converts structured data anomalies (HTTP errors, loading states, empty pages,
 * diagnostic reports, interaction failures, responsive issues, API smoke results)
 * into typed findings WITHOUT requiring LLM analysis.
 *
 * This fixes the findings_count: 0 problem by generating findings directly
 * from data collected during each phase.
 *
 * @module finding-generator
 */

import type { PageData } from './playwright-browser.js';
import type { NetworkRequest } from './browser-backend.js';
import type {
  DiagnosisCategory,
  PageDiagnosis,
  PageDiagnosticReport,
} from './page-diagnostics.js';

// ---------------------------------------------------------------------------
// Minimal interfaces for interaction testing results
// ---------------------------------------------------------------------------

export interface InteractionTestResult {
  url: string;
  element: {
    text: string;
    elementType: string;
  };
  hasError: boolean;
  description: string;
  consoleErrors: Array<{ text: string }>;
  failedRequests: Array<{ method: string; url: string; status: number }>;
}

export interface PageInteractionResult {
  url: string;
  elementsTested: InteractionTestResult[];
}

// ---------------------------------------------------------------------------
// Minimal interfaces for responsive testing results
// ---------------------------------------------------------------------------

export interface ResponsiveFinding {
  title: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  url: string;
  viewport: string;
  description: string;
}

export interface ResponsivePageResult {
  url: string;
  findings: ResponsiveFinding[];
}

// ---------------------------------------------------------------------------
// Minimal interfaces for API smoke testing results
// ---------------------------------------------------------------------------

export interface ApiSmokeFinding {
  title: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  url: string;
  description: string;
  evidence: {
    status: number;
    statusText?: string;
    responseBody?: string;
  };
}

export interface ApiSmokeReport {
  baseUrl: string;
  testedAt: string;
  endpoints: Array<{
    url: string;
    method: string;
    status: number;
    durationMs: number;
  }>;
  findings: ApiSmokeFinding[];
}

// ---------------------------------------------------------------------------
// GeneratedFinding type
// ---------------------------------------------------------------------------

/** A finding generated autonomously from data, not from LLM analysis. */
export interface GeneratedFinding {
  id: string;
  title: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  category: 'functionality' | 'ux' | 'performance' | 'accessibility' | 'security';
  url: string;
  description: string;
  evidence: {
    screenshots: string[];
    consoleMessages?: string[];
    networkRequests?: string[];
    pageTextExcerpt?: string;
  };
  prd_reference?: string;
  steps_to_reproduce: string;
  source: 'exploration' | 'form-testing' | 'responsive-testing' | 'api-smoke' | 'diagnostics';
  /** The phase that generated this finding */
  phase: string;
}

// ---------------------------------------------------------------------------
// FindingGenerator Class
// ---------------------------------------------------------------------------

/**
 * Generates findings autonomously from phase data.
 *
 * Each phase collects structured data (PageData, diagnostics, interaction
 * results, responsive results, API smoke results). This generator converts
 * data anomalies into findings that are written to the findings/ directory
 * and counted in progress.json.
 *
 * Data-driven rules (no LLM needed):
 *
 * From Exploration:
 *   - P0: Page returns HTTP 500+
 *   - P1: Page stuck in loading state
 *   - P2: Page with zero interactive elements (empty shell)
 *
 * From Diagnostics:
 *   - Severity mapped from DiagnosisCategory:
 *     render-error -> P0, js-error -> P1/P2, api-failure -> P1/P2,
 *     loading-stuck -> P1, auth-failure -> P1, missing-resource -> P2,
 *     cors-error -> P2, slow-request -> P3, mixed-content -> P3,
 *     websocket-error -> P2
 *
 * From Interactions:
 *   - P1: Interaction triggers console errors or 500+ network failures
 *   - P2: Interaction has error but no console/network failures
 *
 * From Responsive Testing:
 *   - Mapped directly from responsive findings
 *
 * From API Smoke Testing:
 *   - Mapped directly from API smoke findings
 */
export class FindingGenerator {
  private findingCounter = 0;
  private auditDir: string;

  constructor(auditDir: string) {
    this.auditDir = auditDir;
  }

  // -----------------------------------------------------------------------
  // Phase-specific generators
  // -----------------------------------------------------------------------

  /**
   * Generate findings from exploration phase data.
   *
   * Rules:
   * - P0: HTTP 500+ status code
   * - P1: Loading stuck (text matches loading patterns)
   * - P2: Empty shell (no forms, <=1 link, <100 chars text)
   */
  generateFromExploration(pages: PageData[]): GeneratedFinding[] {
    const findings: GeneratedFinding[] = [];

    for (const page of pages) {
      // P0: HTTP 500+ error
      if (page.statusCode !== undefined && page.statusCode >= 500) {
        findings.push(this.createFinding({
          title: `${page.url} returns ${page.statusCode} Server Error`,
          severity: 'P0',
          category: 'functionality',
          url: page.url,
          description: `Page returned HTTP ${page.statusCode}. This is a server crash that blocks access to the entire page.`,
          steps_to_reproduce: `1. Navigate to ${page.url}\n2. Observe ${page.statusCode} error`,
          source: 'exploration',
          phase: 'exploration',
          evidence: {
            screenshots: [],
            networkRequests: page.networkErrors
              .filter(e => e.status >= 500)
              .map(e => `${e.method} ${e.url} -> ${e.status}`),
          },
        }));
      }

      // P1: Page stuck in loading state
      const loadingPatterns = [
        /loading\.{0,3}$/im,
        /^loading$/im,
        /please wait/i,
      ];
      const isStuckLoading = loadingPatterns.some(pattern => pattern.test(page.text));

      if (isStuckLoading) {
        const apiErrors = page.networkErrors.filter(e => /\/api\//i.test(e.url));
        const rootCauseDescription = apiErrors.length > 0
          ? `Root cause: ${apiErrors.length} API call(s) failing (${apiErrors.map(e => `${e.url} -> ${e.status}`).join(', ')})`
          : 'No API errors detected - may be waiting for data that never arrives.';

        findings.push(this.createFinding({
          title: `${this.extractPageName(page.url)} stuck in loading state`,
          severity: 'P1',
          category: 'functionality',
          url: page.url,
          description: `Page text contains loading indicators. ${rootCauseDescription}`,
          steps_to_reproduce: [
            `1. Navigate to ${page.url}`,
            '2. Wait for page to fully load',
            '3. Observe persistent "Loading" state',
          ].join('\n'),
          source: 'exploration',
          phase: 'exploration',
          evidence: {
            screenshots: [],
            pageTextExcerpt: page.text.substring(0, 300),
            consoleMessages: page.consoleMessages
              .filter(m => m.type === 'error')
              .map(m => m.text),
            networkRequests: apiErrors.map(e => `${e.method} ${e.url} -> ${e.status}`),
          },
        }));
      }

      // P2: Empty shell (no meaningful content)
      if (
        page.forms.length === 0 &&
        page.links.length <= 1 &&
        page.text.trim().length < 100
      ) {
        findings.push(this.createFinding({
          title: `${this.extractPageName(page.url)} is an empty shell`,
          severity: 'P2',
          category: 'functionality',
          url: page.url,
          description: `Page has no forms, at most 1 link, and less than 100 characters of text content. This appears to be a UI shell without working content.`,
          steps_to_reproduce: `1. Navigate to ${page.url}\n2. Observe empty page with no content`,
          source: 'exploration',
          phase: 'exploration',
          evidence: {
            screenshots: [],
            pageTextExcerpt: page.text.substring(0, 300),
          },
        }));
      }
    }

    return findings;
  }

  /**
   * Generate findings from diagnostic reports.
   *
   * Skips 'info' severity diagnoses.
   * Maps DiagnosisCategory to finding severity via mapDiagnosisSeverity().
   */
  generateFromDiagnostics(reports: PageDiagnosticReport[]): GeneratedFinding[] {
    const findings: GeneratedFinding[] = [];

    for (const report of reports) {
      for (const diagnosis of report.diagnoses) {
        // Skip info-level noise
        if (diagnosis.severity === 'info') continue;

        const severity = this.mapDiagnosisSeverity(diagnosis);

        findings.push(this.createFinding({
          title: diagnosis.title,
          severity,
          category: 'functionality',
          url: diagnosis.url,
          description: `${diagnosis.description}\n\nSuggested cause: ${diagnosis.suggestedCause}`,
          steps_to_reproduce: [
            `1. Navigate to ${diagnosis.url}`,
            '2. Open browser DevTools console',
            `3. Observe: ${diagnosis.title}`,
          ].join('\n'),
          source: 'diagnostics',
          phase: 'exploration',
          evidence: {
            screenshots: [],
            consoleMessages: diagnosis.evidence
              .filter((e) => e.source === 'console')
              .map((e) => e.raw),
            networkRequests: diagnosis.evidence
              .filter((e) => e.source === 'network')
              .map((e) => e.raw),
            pageTextExcerpt: diagnosis.evidence
              .filter((e) => e.source === 'dom')
              .map((e) => e.raw)
              .join('\n') || undefined,
          },
        }));
      }
    }

    return findings;
  }

  /**
   * Generate findings from interaction test results.
   *
   * Only generates findings for interactions where hasError is true.
   * - P1: if console errors or 500+ network failures are present
   * - P2: otherwise
   */
  generateFromInteractions(results: PageInteractionResult[]): GeneratedFinding[] {
    const findings: GeneratedFinding[] = [];

    for (const pageResult of results) {
      for (const test of pageResult.elementsTested) {
        if (!test.hasError) continue;

        // Determine severity based on error type
        let severity: 'P1' | 'P2' = 'P2';
        if (test.consoleErrors.length > 0) severity = 'P1';
        if (test.failedRequests.some(r => r.status >= 500)) severity = 'P1';

        const descriptionParts: string[] = [test.description];

        if (test.consoleErrors.length > 0) {
          descriptionParts.push(
            `\nConsole errors: ${test.consoleErrors.map(m => m.text).join('; ')}`,
          );
        }

        if (test.failedRequests.length > 0) {
          descriptionParts.push(
            `\nFailed requests: ${test.failedRequests.map(r => `${r.method} ${r.url} -> ${r.status}`).join('; ')}`,
          );
        }

        findings.push(this.createFinding({
          title: `Clicking "${test.element.text}" ${test.element.elementType} triggers error`,
          severity,
          category: 'functionality',
          url: test.url,
          description: descriptionParts.join(''),
          steps_to_reproduce: [
            `1. Navigate to ${test.url}`,
            `2. Click the "${test.element.text}" ${test.element.elementType}`,
            '3. Observe error',
          ].join('\n'),
          source: 'form-testing',
          phase: 'form-testing',
          evidence: {
            screenshots: [],
            consoleMessages: test.consoleErrors.map(m => m.text),
            networkRequests: test.failedRequests.map(
              r => `${r.method} ${r.url} -> ${r.status}`,
            ),
          },
        }));
      }
    }

    return findings;
  }

  /**
   * Generate findings from responsive test results.
   *
   * Maps findings directly from ResponsivePageResult, preserving
   * the severity and viewport information from the responsive tester.
   */
  generateFromResponsive(results: ResponsivePageResult[]): GeneratedFinding[] {
    const findings: GeneratedFinding[] = [];

    for (const result of results) {
      for (const rf of result.findings) {
        findings.push(this.createFinding({
          title: rf.title,
          severity: rf.severity,
          category: 'ux',
          url: rf.url,
          description: rf.description,
          steps_to_reproduce: [
            `1. Navigate to ${rf.url}`,
            `2. Resize viewport to ${rf.viewport}`,
            '3. Observe issue',
          ].join('\n'),
          source: 'responsive-testing',
          phase: 'responsive-testing',
          evidence: {
            screenshots: [],
          },
        }));
      }
    }

    return findings;
  }

  /**
   * Generate findings from API smoke test results.
   *
   * Maps findings directly from ApiSmokeReport, preserving the
   * severity and evidence from the API smoke tester.
   */
  generateFromApiSmoke(report: ApiSmokeReport): GeneratedFinding[] {
    return report.findings.map(af =>
      this.createFinding({
        title: af.title,
        severity: af.severity,
        category: 'functionality',
        url: af.url,
        description: af.description,
        steps_to_reproduce: [
          `1. Send GET request to ${af.url}`,
          `2. Observe HTTP ${af.evidence.status} response`,
        ].join('\n'),
        source: 'api-smoke',
        phase: 'form-testing',
        evidence: {
          screenshots: [],
          networkRequests: [`GET ${af.url} -> ${af.evidence.status}`],
        },
      }),
    );
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Create a GeneratedFinding with auto-incremented ID (F-001, F-002, ...).
   * Merges evidence with default empty screenshots array.
   */
  private createFinding(
    data: Omit<GeneratedFinding, 'id'> & {
      evidence?: Partial<GeneratedFinding['evidence']>;
    },
  ): GeneratedFinding {
    this.findingCounter++;
    const { evidence: partialEvidence, ...rest } = data;
    const mergedEvidence: GeneratedFinding['evidence'] = {
      screenshots: partialEvidence?.screenshots ?? [],
      consoleMessages: partialEvidence?.consoleMessages,
      networkRequests: partialEvidence?.networkRequests,
      pageTextExcerpt: partialEvidence?.pageTextExcerpt,
    };
    return {
      id: `F-${String(this.findingCounter).padStart(3, '0')}`,
      evidence: mergedEvidence,
      ...rest,
    } as GeneratedFinding;
  }

  /**
   * Map a PageDiagnosis to a finding severity based on its category.
   *
   * Mapping:
   * - render-error    -> P0
   * - js-error        -> P1 (critical) / P2 (warning)
   * - api-failure     -> P1 (critical) / P2 (warning)
   * - loading-stuck   -> P1
   * - auth-failure    -> P1
   * - missing-resource -> P2
   * - cors-error      -> P2
   * - websocket-error -> P2
   * - slow-request    -> P3
   * - mixed-content   -> P3
   */
  private mapDiagnosisSeverity(
    diagnosis: PageDiagnosis,
  ): 'P0' | 'P1' | 'P2' | 'P3' {
    switch (diagnosis.category) {
      case 'render-error':
        return 'P0';
      case 'js-error':
        return diagnosis.severity === 'error' ? 'P1' : 'P2';
      case 'api-failure':
        return diagnosis.severity === 'error' ? 'P1' : 'P2';
      case 'loading-stuck':
        return 'P1';
      case 'auth-failure':
        return 'P1';
      case 'missing-resource':
        return 'P2';
      case 'cors-error':
        return 'P2';
      case 'websocket-error':
        return 'P2';
      case 'slow-request':
        return 'P3';
      case 'mixed-content':
        return 'P3';
      default:
        return 'P3';
    }
  }

  /**
   * Extract a human-readable page name from a URL.
   * Returns the pathname, or 'Homepage' for the root path.
   */
  private extractPageName(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      return pathname === '/' ? 'Homepage' : pathname;
    } catch {
      return url;
    }
  }
}
