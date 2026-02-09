/**
 * Page Diagnostics - Captures and analyzes console output and network activity
 * to diagnose page issues.
 *
 * Works with PageData from the browser backend. When the V4 BrowserBackend
 * provides full NetworkRequest[] data, richer diagnostics (slow-request
 * detection, content-type analysis) become available. When only V2 PageData
 * is available (with NetworkError[]), the module still produces useful
 * JS-error, API-failure, auth-failure, and CORS diagnostics.
 *
 * @module page-diagnostics
 */

import type { PageData, ConsoleMessage, NetworkError } from './playwright-browser.js';
import type { NetworkRequest } from './browser-backend.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiagnosisCategory =
  | 'js-error'
  | 'api-failure'
  | 'missing-resource'
  | 'loading-stuck'
  | 'auth-failure'
  | 'cors-error'
  | 'slow-request'
  | 'mixed-content'
  | 'websocket-error'
  | 'render-error';

export interface DiagnosticEvidence {
  /** The source of evidence: console message, network request, page content, etc. */
  source: 'console' | 'network' | 'dom' | 'timing';
  /** Raw data snippet backing this evidence. */
  raw: string;
  /** Timestamp of the evidence (epoch ms) if available. */
  timestamp?: number;
}

export interface PageDiagnosis {
  /** Unique identifier for this diagnosis within the report. */
  id: string;
  /** The URL the diagnosis relates to (page URL or resource URL). */
  url: string;
  /** Classification of the issue. */
  category: DiagnosisCategory;
  /** How severe is this issue? */
  severity: 'error' | 'warning' | 'info';
  /** Short human-readable title. */
  title: string;
  /** Longer description explaining the problem. */
  description: string;
  /** Supporting evidence collected from the page. */
  evidence: DiagnosticEvidence[];
  /** Best-guess explanation of the root cause. */
  suggestedCause: string;
}

export interface DiagnosticStats {
  consoleErrors: number;
  consoleWarnings: number;
  networkErrors: number;
  slowRequests: number;
  totalRequests: number;
  pageLoadTimeMs: number;
}

export interface PageDiagnosticReport {
  /** The page URL that was analyzed. */
  url: string;
  /** ISO timestamp of when the analysis was performed. */
  analyzedAt: string;
  /** All diagnoses found. */
  diagnoses: PageDiagnosis[];
  /** Summary statistics. */
  stats: DiagnosticStats;
}

export interface DiagnosticsConfig {
  /** Requests slower than this are flagged (ms). Default: 3000. */
  slowRequestThresholdMs?: number;
  /** Max console messages to process. Default: 200. */
  maxConsoleMessages?: number;
  /** Max network requests to process. Default: 200. */
  maxNetworkRequests?: number;
  /** Console message patterns to ignore. */
  ignoreConsolePatterns?: RegExp[];
  /** Network URL patterns to ignore. */
  ignoreNetworkPatterns?: RegExp[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Required<DiagnosticsConfig> = {
  slowRequestThresholdMs: 3000,
  maxConsoleMessages: 200,
  maxNetworkRequests: 200,
  ignoreConsolePatterns: [
    /\[HMR\]/,
    /Download the React DevTools/,
    /favicon\.ico/,
  ],
  ignoreNetworkPatterns: [
    /google-analytics/,
    /googletagmanager/,
    /fonts\.googleapis/,
    /favicon\.ico/,
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RESOURCE_EXTENSIONS = /\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|eot|ico|map)(\?|$)/i;
const API_PATH_PATTERN = /\/(api|graphql)\b/i;

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(value));
}

let nextDiagnosisSeq = 0;

function diagId(category: DiagnosisCategory): string {
  nextDiagnosisSeq += 1;
  return `${category}-${nextDiagnosisSeq}`;
}

// ---------------------------------------------------------------------------
// PageDiagnostics class
// ---------------------------------------------------------------------------

export class PageDiagnostics {
  private readonly config: Required<DiagnosticsConfig>;

  constructor(config: DiagnosticsConfig = {}) {
    this.config = {
      slowRequestThresholdMs:
        config.slowRequestThresholdMs ?? DEFAULT_CONFIG.slowRequestThresholdMs,
      maxConsoleMessages:
        config.maxConsoleMessages ?? DEFAULT_CONFIG.maxConsoleMessages,
      maxNetworkRequests:
        config.maxNetworkRequests ?? DEFAULT_CONFIG.maxNetworkRequests,
      ignoreConsolePatterns:
        config.ignoreConsolePatterns ?? [...DEFAULT_CONFIG.ignoreConsolePatterns],
      ignoreNetworkPatterns:
        config.ignoreNetworkPatterns ?? [...DEFAULT_CONFIG.ignoreNetworkPatterns],
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Analyze a page and return a full diagnostic report.
   *
   * Accepts standard PageData (V2) and optionally the richer V4
   * `networkRequests` array for deeper network analysis.
   */
  analyzePage(
    pageData: PageData & { networkRequests?: NetworkRequest[] },
  ): PageDiagnosticReport {
    // Reset the sequence counter per analysis run so IDs are deterministic
    // within a single report.
    nextDiagnosisSeq = 0;

    const consoleMessages = this.filterConsoleMessages(
      pageData.consoleMessages,
    );
    const networkErrors = this.filterNetworkErrors(pageData.networkErrors);
    const networkRequests = this.filterNetworkRequests(
      pageData.networkRequests,
    );

    const diagnoses: PageDiagnosis[] = [
      ...this.diagnoseJsErrors(consoleMessages, pageData.url),
      ...this.diagnoseApiFailures(networkErrors, networkRequests, pageData.url),
      ...this.diagnoseMissingResources(networkErrors, networkRequests, pageData.url),
      ...this.diagnoseAuthFailures(networkErrors, networkRequests, pageData.url),
      ...this.diagnoseCorsErrors(consoleMessages, pageData.url),
      ...this.diagnoseSlowRequests(networkRequests, pageData.url),
      ...this.diagnoseLoadingStuck(pageData, networkErrors, consoleMessages),
      ...this.diagnoseFrameworkErrors(consoleMessages, pageData),
      ...this.diagnoseMixedContent(consoleMessages, pageData.url),
      ...this.diagnoseWebSocketErrors(consoleMessages, pageData.url),
    ];

    const stats = this.computeStats(
      consoleMessages,
      networkErrors,
      networkRequests,
      pageData.loadTimeMs,
    );

    return {
      url: pageData.url,
      analyzedAt: new Date().toISOString(),
      diagnoses,
      stats,
    };
  }

  // -------------------------------------------------------------------------
  // Filtering
  // -------------------------------------------------------------------------

  private filterConsoleMessages(
    messages: ConsoleMessage[],
  ): ConsoleMessage[] {
    return messages
      .filter((m) => !matchesAny(m.text, this.config.ignoreConsolePatterns))
      .slice(0, this.config.maxConsoleMessages);
  }

  private filterNetworkErrors(errors: NetworkError[]): NetworkError[] {
    return errors
      .filter((e) => !matchesAny(e.url, this.config.ignoreNetworkPatterns))
      .slice(0, this.config.maxNetworkRequests);
  }

  private filterNetworkRequests(
    requests?: NetworkRequest[],
  ): NetworkRequest[] | undefined {
    if (!requests) return undefined;
    return requests
      .filter((r) => !matchesAny(r.url, this.config.ignoreNetworkPatterns))
      .slice(0, this.config.maxNetworkRequests);
  }

  // -------------------------------------------------------------------------
  // Diagnosis: JS errors
  // -------------------------------------------------------------------------

  private diagnoseJsErrors(
    messages: ConsoleMessage[],
    pageUrl: string,
  ): PageDiagnosis[] {
    const results: PageDiagnosis[] = [];

    for (const msg of messages) {
      if (msg.type !== 'error') continue;

      // Skip CORS errors (handled separately)
      if (this.isCorsMessage(msg.text)) continue;
      // Skip mixed content (handled separately)
      if (this.isMixedContentMessage(msg.text)) continue;

      const severity = this.classifyJsErrorSeverity(msg.text);

      results.push({
        id: diagId('js-error'),
        url: pageUrl,
        category: 'js-error',
        severity,
        title: this.extractJsErrorTitle(msg.text),
        description: msg.text.length > 300
          ? msg.text.slice(0, 300) + '...'
          : msg.text,
        evidence: [
          {
            source: 'console',
            raw: msg.text,
            timestamp: msg.timestamp,
          },
        ],
        suggestedCause: this.suggestJsErrorCause(msg.text),
      });
    }

    return results;
  }

  private classifyJsErrorSeverity(text: string): 'error' | 'warning' | 'info' {
    const criticalPatterns = [
      /Uncaught\s+(TypeError|ReferenceError|SyntaxError)/i,
      /cannot read propert/i,
      /is not defined/i,
      /is not a function/i,
      /ChunkLoadError/i,
      /Loading chunk .* failed/i,
      /Script error/i,
    ];
    if (criticalPatterns.some((p) => p.test(text))) return 'error';

    const warningPatterns = [
      /deprecated/i,
      /warning/i,
      /failed to load/i,
    ];
    if (warningPatterns.some((p) => p.test(text))) return 'warning';

    return 'error'; // Console errors default to error severity
  }

  private extractJsErrorTitle(text: string): string {
    // Try to extract the error type and brief message
    const match = text.match(
      /^(Uncaught\s+)?(TypeError|ReferenceError|SyntaxError|RangeError|Error):\s*(.{0,80})/,
    );
    if (match) {
      const errorType = match[2];
      const brief = match[3].length >= 80 ? match[3] + '...' : match[3];
      return `${errorType}: ${brief}`;
    }
    // Fall back to first line, truncated
    const firstLine = text.split('\n')[0];
    return firstLine.length > 80
      ? firstLine.slice(0, 80) + '...'
      : firstLine;
  }

  private suggestJsErrorCause(text: string): string {
    if (/cannot read propert/i.test(text)) {
      return 'Attempting to access a property on null or undefined. Check that the variable is initialized before use.';
    }
    if (/is not defined/i.test(text)) {
      return 'A variable or function is referenced but not declared. Check for typos or missing imports.';
    }
    if (/is not a function/i.test(text)) {
      return 'A non-function value is being called as a function. Check that the import is correct and the API has not changed.';
    }
    if (/ChunkLoadError|Loading chunk .* failed/i.test(text)) {
      return 'A code-split chunk failed to load. This can be caused by a deployment that invalidated old chunk hashes, or a network issue.';
    }
    if (/SyntaxError/i.test(text)) {
      return 'JavaScript syntax error, possibly from a transpilation issue or an unexpected server response (e.g., HTML served instead of JS).';
    }
    if (/Script error/i.test(text)) {
      return 'Cross-origin script error. The browser is hiding details because the script is loaded from a different origin without proper CORS headers.';
    }
    return 'A JavaScript runtime error occurred. Inspect the browser console for a full stack trace.';
  }

  // -------------------------------------------------------------------------
  // Diagnosis: API failures
  // -------------------------------------------------------------------------

  private diagnoseApiFailures(
    networkErrors: NetworkError[],
    networkRequests: NetworkRequest[] | undefined,
    pageUrl: string,
  ): PageDiagnosis[] {
    const results: PageDiagnosis[] = [];

    // From V2 NetworkError[]
    for (const err of networkErrors) {
      if (!API_PATH_PATTERN.test(err.url)) continue;
      // Skip 401/403 (handled by auth-failure diagnosis)
      if (err.status === 401 || err.status === 403) continue;
      // Skip 404 on non-API resources (handled by missing-resource)
      if (err.status === 404 && RESOURCE_EXTENSIONS.test(err.url)) continue;

      results.push({
        id: diagId('api-failure'),
        url: err.url,
        category: 'api-failure',
        severity: err.status >= 500 ? 'error' : 'warning',
        title: `API ${err.method} ${err.status} ${err.statusText}`,
        description: `${err.method} request to ${err.url} returned ${err.status} ${err.statusText}.`,
        evidence: [
          {
            source: 'network',
            raw: `${err.method} ${err.url} -> ${err.status} ${err.statusText}`,
          },
        ],
        suggestedCause: this.suggestApiFailureCause(err.status, err.url),
      });
    }

    // From V4 NetworkRequest[] (may include non-error API requests we haven't seen)
    if (networkRequests) {
      const seenUrls = new Set(networkErrors.map((e) => `${e.method}:${e.url}`));
      for (const req of networkRequests) {
        if (!req.isError) continue;
        if (!API_PATH_PATTERN.test(req.url)) continue;
        if (req.status === 401 || req.status === 403) continue;
        if (req.status === 404 && RESOURCE_EXTENSIONS.test(req.url)) continue;

        const key = `${req.method}:${req.url}`;
        if (seenUrls.has(key)) continue; // Already reported from NetworkError
        seenUrls.add(key);

        results.push({
          id: diagId('api-failure'),
          url: req.url,
          category: 'api-failure',
          severity: req.status >= 500 ? 'error' : 'warning',
          title: `API ${req.method} ${req.status} ${req.statusText}`,
          description: `${req.method} request to ${req.url} returned ${req.status} ${req.statusText}. Took ${req.durationMs}ms.`,
          evidence: [
            {
              source: 'network',
              raw: `${req.method} ${req.url} -> ${req.status} ${req.statusText} (${req.durationMs}ms)`,
              timestamp: req.timestamp,
            },
          ],
          suggestedCause: this.suggestApiFailureCause(req.status, req.url),
        });
      }
    }

    return results;
  }

  private suggestApiFailureCause(status: number, url: string): string {
    if (status >= 500 && status < 600) {
      return `Server error (${status}). The backend may be crashing or overloaded. Check server logs.`;
    }
    if (status === 400) {
      return 'Bad request. The client is sending malformed or invalid data to the API.';
    }
    if (status === 404) {
      return 'API endpoint not found. The route may be missing or the API version may have changed.';
    }
    if (status === 405) {
      return 'HTTP method not allowed. The client is using the wrong HTTP verb for this endpoint.';
    }
    if (status === 408) {
      return 'Request timeout. The API took too long to respond.';
    }
    if (status === 409) {
      return 'Conflict. The request conflicts with the current state of the resource.';
    }
    if (status === 422) {
      return 'Unprocessable entity. The request data failed server-side validation.';
    }
    if (status === 429) {
      return 'Rate limited. Too many requests have been sent in a short period.';
    }
    return `API returned HTTP ${status}. Check the server logs and API documentation for ${url}.`;
  }

  // -------------------------------------------------------------------------
  // Diagnosis: Missing resources
  // -------------------------------------------------------------------------

  private diagnoseMissingResources(
    networkErrors: NetworkError[],
    networkRequests: NetworkRequest[] | undefined,
    pageUrl: string,
  ): PageDiagnosis[] {
    const results: PageDiagnosis[] = [];
    const seen = new Set<string>();

    // From V2 NetworkError[]
    for (const err of networkErrors) {
      if (err.status !== 404) continue;
      if (!RESOURCE_EXTENSIONS.test(err.url)) continue;
      if (seen.has(err.url)) continue;
      seen.add(err.url);

      const ext = this.extractExtension(err.url);
      results.push({
        id: diagId('missing-resource'),
        url: err.url,
        category: 'missing-resource',
        severity: this.resourceSeverity(ext),
        title: `Missing ${ext.toUpperCase()} resource (404)`,
        description: `The page requested ${err.url} but received a 404. This ${ext} file is missing from the server.`,
        evidence: [
          {
            source: 'network',
            raw: `GET ${err.url} -> 404`,
          },
        ],
        suggestedCause: this.suggestMissingResourceCause(ext, err.url),
      });
    }

    // From V4 NetworkRequest[]
    if (networkRequests) {
      for (const req of networkRequests) {
        if (req.status !== 404) continue;
        if (!RESOURCE_EXTENSIONS.test(req.url)) continue;
        if (seen.has(req.url)) continue;
        seen.add(req.url);

        const ext = this.extractExtension(req.url);
        results.push({
          id: diagId('missing-resource'),
          url: req.url,
          category: 'missing-resource',
          severity: this.resourceSeverity(ext),
          title: `Missing ${ext.toUpperCase()} resource (404)`,
          description: `The page requested ${req.url} but received a 404.`,
          evidence: [
            {
              source: 'network',
              raw: `${req.method} ${req.url} -> 404 (${req.durationMs}ms)`,
              timestamp: req.timestamp,
            },
          ],
          suggestedCause: this.suggestMissingResourceCause(ext, req.url),
        });
      }
    }

    return results;
  }

  private extractExtension(url: string): string {
    const match = url.match(/\.(\w+)(\?|$)/);
    return match ? match[1].toLowerCase() : 'unknown';
  }

  private resourceSeverity(ext: string): 'error' | 'warning' {
    // Missing JS/CSS are blocking resources
    if (ext === 'js' || ext === 'css') return 'error';
    return 'warning';
  }

  private suggestMissingResourceCause(ext: string, url: string): string {
    if (ext === 'js') {
      if (/chunk|bundle/i.test(url)) {
        return 'A JavaScript bundle chunk is missing. This often happens after a new deployment when old chunk hashes are no longer valid. A hard refresh may resolve it.';
      }
      return 'A JavaScript file is missing from the server. Check the build output and deployment.';
    }
    if (ext === 'css') {
      return 'A CSS stylesheet is missing. This will cause unstyled content. Check the build pipeline.';
    }
    if (/png|jpg|jpeg|gif|svg|ico/.test(ext)) {
      return 'An image file is missing. Check that the asset was included in the deployment.';
    }
    if (/woff2?|ttf|eot/.test(ext)) {
      return 'A font file is missing. Text may render in a fallback font until this is resolved.';
    }
    if (ext === 'map') {
      return 'A source map file is missing. This does not affect users but will hinder debugging.';
    }
    return `A ${ext} resource is missing from the server. Verify the file exists and the URL path is correct.`;
  }

  // -------------------------------------------------------------------------
  // Diagnosis: Loading stuck
  // -------------------------------------------------------------------------

  private diagnoseLoadingStuck(
    pageData: PageData & { networkRequests?: NetworkRequest[] },
    networkErrors: NetworkError[],
    consoleMessages: ConsoleMessage[],
  ): PageDiagnosis[] {
    const results: PageDiagnosis[] = [];

    // Detect "loading" indicators still present in the page text
    const loadingPatterns = [
      /\bloading\.{0,3}\b/i,
      /\bspinner\b/i,
      /\bplease wait\b/i,
      /\bfetching\b/i,
    ];

    const textLower = pageData.text.toLowerCase();
    const hasLoadingText = loadingPatterns.some((p) => p.test(textLower));

    if (!hasLoadingText) return results;

    // Also check if the page content is suspiciously short (loading state)
    const hasMinimalContent = pageData.text.trim().length < 200;

    if (!hasMinimalContent && !this.hasLoadingDomIndicators(pageData.html)) {
      return results;
    }

    // Determine likely cause
    const evidence: DiagnosticEvidence[] = [
      {
        source: 'dom',
        raw: `Page text contains loading indicators. Text length: ${pageData.text.trim().length} chars.`,
      },
    ];

    let suggestedCause = 'The page appears to be stuck in a loading state.';

    // Check if API errors could be the cause
    const apiErrors = networkErrors.filter((e) => API_PATH_PATTERN.test(e.url));
    if (apiErrors.length > 0) {
      suggestedCause =
        `The page is stuck loading, likely because ${apiErrors.length} API request(s) failed: ` +
        apiErrors
          .slice(0, 3)
          .map((e) => `${e.method} ${e.url} (${e.status})`)
          .join(', ') +
        '.';
      for (const err of apiErrors.slice(0, 3)) {
        evidence.push({
          source: 'network',
          raw: `${err.method} ${err.url} -> ${err.status}`,
        });
      }
    }

    // Check if JS errors could be the cause
    const jsErrors = consoleMessages.filter(
      (m) => m.type === 'error' && !this.isCorsMessage(m.text),
    );
    if (jsErrors.length > 0 && apiErrors.length === 0) {
      suggestedCause =
        `The page is stuck loading, likely due to ${jsErrors.length} JavaScript error(s) preventing rendering.`;
      evidence.push({
        source: 'console',
        raw: jsErrors[0].text,
        timestamp: jsErrors[0].timestamp,
      });
    }

    // If no errors found, it might just be slow
    if (apiErrors.length === 0 && jsErrors.length === 0) {
      suggestedCause =
        'The page appears stuck in a loading state with no obvious errors. ' +
        'This may be caused by a long-running request, a missing API response, ' +
        'or the SPA router not completing navigation.';
    }

    results.push({
      id: diagId('loading-stuck'),
      url: pageData.url,
      category: 'loading-stuck',
      severity: 'error',
      title: 'Page appears stuck in loading state',
      description:
        `The page text contains loading indicators and has minimal rendered content ` +
        `(${pageData.text.trim().length} chars). The page may not have finished loading data.`,
      evidence,
      suggestedCause,
    });

    return results;
  }

  private hasLoadingDomIndicators(html: string): boolean {
    const patterns = [
      /class="[^"]*loading[^"]*"/i,
      /class="[^"]*spinner[^"]*"/i,
      /class="[^"]*skeleton[^"]*"/i,
      /aria-busy="true"/i,
      /<progress\b/i,
    ];
    return patterns.some((p) => p.test(html));
  }

  // -------------------------------------------------------------------------
  // Diagnosis: Auth failures
  // -------------------------------------------------------------------------

  private diagnoseAuthFailures(
    networkErrors: NetworkError[],
    networkRequests: NetworkRequest[] | undefined,
    pageUrl: string,
  ): PageDiagnosis[] {
    const results: PageDiagnosis[] = [];
    const seen = new Set<string>();

    // From V2 NetworkError[]
    for (const err of networkErrors) {
      if (err.status !== 401 && err.status !== 403) continue;
      const key = `${err.method}:${err.url}`;
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        id: diagId('auth-failure'),
        url: err.url,
        category: 'auth-failure',
        severity: 'error',
        title: err.status === 401
          ? 'Authentication required (401)'
          : 'Access forbidden (403)',
        description: `${err.method} ${err.url} returned ${err.status} ${err.statusText}.`,
        evidence: [
          {
            source: 'network',
            raw: `${err.method} ${err.url} -> ${err.status} ${err.statusText}`,
          },
        ],
        suggestedCause: err.status === 401
          ? 'The request requires authentication. The user may not be logged in, or the auth token may have expired.'
          : 'The authenticated user does not have permission to access this resource. Check role/permission configuration.',
      });
    }

    // From V4 NetworkRequest[]
    if (networkRequests) {
      for (const req of networkRequests) {
        if (req.status !== 401 && req.status !== 403) continue;
        const key = `${req.method}:${req.url}`;
        if (seen.has(key)) continue;
        seen.add(key);

        results.push({
          id: diagId('auth-failure'),
          url: req.url,
          category: 'auth-failure',
          severity: 'error',
          title: req.status === 401
            ? 'Authentication required (401)'
            : 'Access forbidden (403)',
          description: `${req.method} ${req.url} returned ${req.status} ${req.statusText}. Took ${req.durationMs}ms.`,
          evidence: [
            {
              source: 'network',
              raw: `${req.method} ${req.url} -> ${req.status} ${req.statusText} (${req.durationMs}ms)`,
              timestamp: req.timestamp,
            },
          ],
          suggestedCause: req.status === 401
            ? 'The request requires authentication. The user may not be logged in, or the auth token may have expired.'
            : 'The authenticated user does not have permission to access this resource. Check role/permission configuration.',
        });
      }
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Diagnosis: CORS errors
  // -------------------------------------------------------------------------

  private diagnoseCorsErrors(
    messages: ConsoleMessage[],
    pageUrl: string,
  ): PageDiagnosis[] {
    const results: PageDiagnosis[] = [];

    for (const msg of messages) {
      if (msg.type !== 'error') continue;
      if (!this.isCorsMessage(msg.text)) continue;

      // Try to extract the blocked URL from the message
      const blockedUrl = this.extractCorsBlockedUrl(msg.text) ?? pageUrl;

      results.push({
        id: diagId('cors-error'),
        url: blockedUrl,
        category: 'cors-error',
        severity: 'error',
        title: 'CORS policy blocked request',
        description: msg.text.length > 300
          ? msg.text.slice(0, 300) + '...'
          : msg.text,
        evidence: [
          {
            source: 'console',
            raw: msg.text,
            timestamp: msg.timestamp,
          },
        ],
        suggestedCause:
          'A cross-origin request was blocked by the browser CORS policy. ' +
          'The target server needs to include the appropriate Access-Control-Allow-Origin header. ' +
          'Check the server CORS configuration.',
      });
    }

    return results;
  }

  private isCorsMessage(text: string): boolean {
    return (
      /CORS/i.test(text) ||
      /cross-origin/i.test(text) ||
      /Access-Control-Allow-Origin/i.test(text) ||
      /blocked by CORS policy/i.test(text)
    );
  }

  private extractCorsBlockedUrl(text: string): string | undefined {
    // Common patterns in CORS error messages
    const patterns = [
      /Access to .+ at '([^']+)'/,
      /from origin .+ has been blocked.*'([^']+)'/,
      /Cross-Origin .+ blocked.*loading '([^']+)'/,
    ];
    for (const p of patterns) {
      const match = text.match(p);
      if (match) return match[1];
    }
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Diagnosis: Slow requests (V4 only - needs durationMs)
  // -------------------------------------------------------------------------

  private diagnoseSlowRequests(
    networkRequests: NetworkRequest[] | undefined,
    pageUrl: string,
  ): PageDiagnosis[] {
    if (!networkRequests) return [];
    const results: PageDiagnosis[] = [];

    for (const req of networkRequests) {
      if (req.durationMs < this.config.slowRequestThresholdMs) continue;

      results.push({
        id: diagId('slow-request'),
        url: req.url,
        category: 'slow-request',
        severity: req.durationMs > this.config.slowRequestThresholdMs * 2
          ? 'error'
          : 'warning',
        title: `Slow request: ${req.durationMs}ms`,
        description:
          `${req.method} ${req.url} took ${req.durationMs}ms ` +
          `(threshold: ${this.config.slowRequestThresholdMs}ms). ` +
          `Status: ${req.status}${req.responseSize ? `, size: ${this.formatBytes(req.responseSize)}` : ''}.`,
        evidence: [
          {
            source: 'network',
            raw: `${req.method} ${req.url} -> ${req.status} (${req.durationMs}ms)`,
            timestamp: req.timestamp,
          },
        ],
        suggestedCause: this.suggestSlowRequestCause(req),
      });
    }

    return results;
  }

  private suggestSlowRequestCause(req: NetworkRequest): string {
    if (req.status >= 500) {
      return 'The server took a long time and ultimately returned an error. The backend may be overloaded or the query may be expensive.';
    }
    if (req.responseSize && req.responseSize > 1_000_000) {
      return `The response is large (${this.formatBytes(req.responseSize)}). Consider pagination, compression, or reducing the payload size.`;
    }
    if (API_PATH_PATTERN.test(req.url)) {
      return 'This API request is slow. Check for expensive database queries, missing indexes, or N+1 query problems on the backend.';
    }
    if (/\.(js|css)(\?|$)/i.test(req.url)) {
      return 'A static asset is loading slowly. Consider using a CDN, enabling compression, or optimizing the bundle size.';
    }
    return `This request took ${req.durationMs}ms. Investigate the server-side handling time, network latency, or response size.`;
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  // -------------------------------------------------------------------------
  // Diagnosis: Framework errors (React, Vue)
  // -------------------------------------------------------------------------

  private diagnoseFrameworkErrors(
    messages: ConsoleMessage[],
    pageData: PageData,
  ): PageDiagnosis[] {
    const results: PageDiagnosis[] = [];

    for (const msg of messages) {
      // React error boundaries
      if (this.isReactErrorBoundary(msg.text)) {
        results.push({
          id: diagId('render-error'),
          url: pageData.url,
          category: 'render-error',
          severity: 'error',
          title: 'React error boundary triggered',
          description: msg.text.length > 300
            ? msg.text.slice(0, 300) + '...'
            : msg.text,
          evidence: [
            {
              source: 'console',
              raw: msg.text,
              timestamp: msg.timestamp,
            },
          ],
          suggestedCause:
            'A React component threw an error during rendering. An error boundary caught it, ' +
            'but the affected subtree has been replaced with fallback UI. Check the component stack trace.',
        });
        continue;
      }

      // React hydration errors
      if (this.isReactHydrationError(msg.text)) {
        results.push({
          id: diagId('render-error'),
          url: pageData.url,
          category: 'render-error',
          severity: 'warning',
          title: 'React hydration mismatch',
          description: msg.text.length > 300
            ? msg.text.slice(0, 300) + '...'
            : msg.text,
          evidence: [
            {
              source: 'console',
              raw: msg.text,
              timestamp: msg.timestamp,
            },
          ],
          suggestedCause:
            'The server-rendered HTML does not match what React expected during hydration. ' +
            'This can cause layout flickers and unexpected behavior. Common causes: browser extensions, ' +
            'date/time differences, or conditional rendering based on client-only state.',
        });
        continue;
      }

      // Vue warnings
      if (this.isVueWarning(msg.text)) {
        results.push({
          id: diagId('render-error'),
          url: pageData.url,
          category: 'render-error',
          severity: msg.type === 'error' ? 'error' : 'warning',
          title: 'Vue framework warning',
          description: msg.text.length > 300
            ? msg.text.slice(0, 300) + '...'
            : msg.text,
          evidence: [
            {
              source: 'console',
              raw: msg.text,
              timestamp: msg.timestamp,
            },
          ],
          suggestedCause:
            'Vue has detected an issue with a component. Check the component name and ' +
            'the specific warning message for details on what needs to be fixed.',
        });
        continue;
      }

      // Next.js specific errors
      if (this.isNextJsError(msg.text)) {
        results.push({
          id: diagId('render-error'),
          url: pageData.url,
          category: 'render-error',
          severity: 'error',
          title: 'Next.js framework error',
          description: msg.text.length > 300
            ? msg.text.slice(0, 300) + '...'
            : msg.text,
          evidence: [
            {
              source: 'console',
              raw: msg.text,
              timestamp: msg.timestamp,
            },
          ],
          suggestedCause:
            'A Next.js-specific error occurred. This may be related to server-side rendering, ' +
            'data fetching, or routing. Check the Next.js error overlay for more details.',
        });
      }
    }

    // Check DOM for React error boundary fallback markers
    if (this.hasReactErrorBoundaryInDom(pageData.html)) {
      const alreadyReported = results.some(
        (d) => d.category === 'render-error' && d.title.includes('React error boundary'),
      );
      if (!alreadyReported) {
        results.push({
          id: diagId('render-error'),
          url: pageData.url,
          category: 'render-error',
          severity: 'error',
          title: 'React error boundary fallback detected in DOM',
          description:
            'The page HTML contains markers suggesting a React error boundary fallback is being displayed.',
          evidence: [
            {
              source: 'dom',
              raw: 'Found error boundary fallback indicators in page HTML.',
            },
          ],
          suggestedCause:
            'A React component tree crashed during rendering. The error boundary is showing fallback UI. ' +
            'Check the console for the original error.',
        });
      }
    }

    return results;
  }

  private isReactErrorBoundary(text: string): boolean {
    return (
      /The above error occurred in/i.test(text) ||
      /Error boundaries should implement/i.test(text) ||
      /React will try to recreate this component/i.test(text) ||
      /Consider adding an error boundary/i.test(text)
    );
  }

  private isReactHydrationError(text: string): boolean {
    return (
      /Hydration failed because/i.test(text) ||
      /There was an error while hydrating/i.test(text) ||
      /Text content does not match server-rendered HTML/i.test(text) ||
      /did not match\. Server:/i.test(text)
    );
  }

  private isVueWarning(text: string): boolean {
    return (
      /\[Vue warn\]/i.test(text) ||
      /\[Vue error\]/i.test(text) ||
      /vue\.runtime/i.test(text)
    );
  }

  private isNextJsError(text: string): boolean {
    return (
      /Unhandled Runtime Error/i.test(text) ||
      /Next\.js.*error/i.test(text) ||
      /getServerSideProps.*error/i.test(text) ||
      /getStaticProps.*error/i.test(text)
    );
  }

  private hasReactErrorBoundaryInDom(html: string): boolean {
    return (
      /data-reactroot.*error/i.test(html) ||
      /class="[^"]*error-boundary[^"]*"/i.test(html) ||
      /id="[^"]*error-boundary[^"]*"/i.test(html)
    );
  }

  // -------------------------------------------------------------------------
  // Diagnosis: Mixed content
  // -------------------------------------------------------------------------

  private diagnoseMixedContent(
    messages: ConsoleMessage[],
    pageUrl: string,
  ): PageDiagnosis[] {
    const results: PageDiagnosis[] = [];

    for (const msg of messages) {
      if (!this.isMixedContentMessage(msg.text)) continue;

      const blockedUrl = this.extractMixedContentUrl(msg.text);

      results.push({
        id: diagId('mixed-content'),
        url: blockedUrl ?? pageUrl,
        category: 'mixed-content',
        severity: /\bblocked\b/i.test(msg.text) ? 'error' : 'warning',
        title: 'Mixed content detected',
        description: msg.text.length > 300
          ? msg.text.slice(0, 300) + '...'
          : msg.text,
        evidence: [
          {
            source: 'console',
            raw: msg.text,
            timestamp: msg.timestamp,
          },
        ],
        suggestedCause:
          'The page is loaded over HTTPS but is requesting resources over HTTP. ' +
          'Browsers block or warn about this. Update all resource URLs to use HTTPS.',
      });
    }

    return results;
  }

  private isMixedContentMessage(text: string): boolean {
    return (
      /Mixed Content/i.test(text) ||
      /was loaded over HTTPS, but requested an insecure/i.test(text)
    );
  }

  private extractMixedContentUrl(text: string): string | undefined {
    const match = text.match(/insecure (?:resource|XMLHttpRequest|image|stylesheet|script|frame) '([^']+)'/i);
    return match ? match[1] : undefined;
  }

  // -------------------------------------------------------------------------
  // Diagnosis: WebSocket errors
  // -------------------------------------------------------------------------

  private diagnoseWebSocketErrors(
    messages: ConsoleMessage[],
    pageUrl: string,
  ): PageDiagnosis[] {
    const results: PageDiagnosis[] = [];

    for (const msg of messages) {
      if (msg.type !== 'error') continue;
      if (!this.isWebSocketError(msg.text)) continue;

      const wsUrl = this.extractWebSocketUrl(msg.text);

      results.push({
        id: diagId('websocket-error'),
        url: wsUrl ?? pageUrl,
        category: 'websocket-error',
        severity: 'warning',
        title: 'WebSocket connection error',
        description: msg.text.length > 300
          ? msg.text.slice(0, 300) + '...'
          : msg.text,
        evidence: [
          {
            source: 'console',
            raw: msg.text,
            timestamp: msg.timestamp,
          },
        ],
        suggestedCause:
          'A WebSocket connection failed. This could be due to the WebSocket server being down, ' +
          'a firewall blocking the connection, or incorrect WebSocket URL configuration.',
      });
    }

    return results;
  }

  private isWebSocketError(text: string): boolean {
    return (
      /WebSocket/i.test(text) &&
      (/failed|error|closed|refused|timed out/i.test(text))
    );
  }

  private extractWebSocketUrl(text: string): string | undefined {
    const match = text.match(/(wss?:\/\/[^\s'"]+)/);
    return match ? match[1] : undefined;
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  private computeStats(
    consoleMessages: ConsoleMessage[],
    networkErrors: NetworkError[],
    networkRequests: NetworkRequest[] | undefined,
    loadTimeMs?: number,
  ): DiagnosticStats {
    const consoleErrors = consoleMessages.filter(
      (m) => m.type === 'error',
    ).length;
    const consoleWarnings = consoleMessages.filter(
      (m) => m.type === 'warning',
    ).length;

    let slowRequests = 0;
    let totalRequests = 0;

    if (networkRequests) {
      totalRequests = networkRequests.length;
      slowRequests = networkRequests.filter(
        (r) => r.durationMs >= this.config.slowRequestThresholdMs,
      ).length;
    }

    return {
      consoleErrors,
      consoleWarnings,
      networkErrors: networkErrors.length,
      slowRequests,
      totalRequests,
      pageLoadTimeMs: loadTimeMs ?? 0,
    };
  }
}
