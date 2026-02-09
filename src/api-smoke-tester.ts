/**
 * API Smoke Tester - Discovers API endpoints from code analysis and network
 * captures, then smoke tests them via the browser backend.
 *
 * Discovery sources:
 *   - Static code analysis (route definitions, file lists)
 *   - Network request captures (XHR/fetch traffic)
 *   - Route files and OpenAPI specs
 *
 * Only GET/HEAD requests are executed; mutating methods are never called.
 *
 * @module api-smoke-tester
 */

import type { BrowserBackend, NetworkRequest } from './browser-backend.js';
import type { PageData } from './playwright-browser.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoveredEndpoint {
  path: string;
  method: string;
  source: 'code-analysis' | 'network-capture' | 'route-file' | 'openapi';
  expectedStatus?: number;
  requiresAuth?: boolean;
}

export interface EndpointTestResult {
  endpoint: DiscoveredEndpoint;
  status: number;
  statusText: string;
  contentType: string;
  durationMs: number;
  responseSize: number;
  isValidJson?: boolean;
  responsePreview: string;
  isFailure: boolean;
  failureReason?: string;
  category:
    | 'success'
    | 'auth-failure'
    | 'not-found'
    | 'server-error'
    | 'timeout'
    | 'other-error';
}

export interface ApiSmokeReport {
  endpoints: DiscoveredEndpoint[];
  results: EndpointTestResult[];
  findings: ApiSmokeFinding[];
  stats: {
    total: number;
    success: number;
    authFailure: number;
    notFound: number;
    serverError: number;
    timeout: number;
  };
}

export interface ApiSmokeFinding {
  title: string;
  severity: 'P0' | 'P1' | 'P2';
  url: string;
  description: string;
  evidence: {
    status: number;
    responsePreview: string;
    durationMs: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Patterns that indicate an API-like URL path. */
const API_PATH_RE = /\/api\/|\/graphql|\/v\d+\//;

/** Next.js API route file patterns. */
const NEXTJS_API_FILE_RE = /(?:pages|app)\/api\//;

/** HTTP methods considered safe for smoke testing. */
const SAFE_METHODS = new Set(['GET', 'HEAD']);

/** Max characters kept from a response body for preview. */
const PREVIEW_MAX_CHARS = 512;

// ---------------------------------------------------------------------------
// ApiSmokeTester
// ---------------------------------------------------------------------------

export class ApiSmokeTester {
  private backend: BrowserBackend;
  private baseUrl: string;

  constructor(backend: BrowserBackend, baseUrl: string) {
    this.backend = backend;
    // Ensure baseUrl has no trailing slash so concatenation is predictable
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Discover API endpoints from code analysis data and/or captured network
   * requests.  Both inputs are optional; results are merged and deduplicated.
   */
  discoverEndpoints(
    codeAnalysis?: Record<string, unknown>,
    networkCaptures?: NetworkRequest[],
  ): DiscoveredEndpoint[] {
    const fromCode = codeAnalysis
      ? this.extractFromCodeAnalysis(codeAnalysis)
      : [];
    const fromNetwork = networkCaptures
      ? this.extractFromNetworkCaptures(networkCaptures)
      : [];

    return this.deduplicateEndpoints([...fromCode, ...fromNetwork]);
  }

  /**
   * Smoke-test the given endpoints.  Only GET and HEAD methods are tested;
   * mutating methods are silently skipped.
   */
  async testEndpoints(
    endpoints: DiscoveredEndpoint[],
  ): Promise<ApiSmokeReport> {
    const safeEndpoints = endpoints.filter((ep) =>
      SAFE_METHODS.has(ep.method.toUpperCase()),
    );

    const results: EndpointTestResult[] = [];
    for (const ep of safeEndpoints) {
      const result = await this.testEndpoint(ep);
      results.push(result);
    }

    const findings = this.generateFindings(results);
    const stats = this.computeStats(results);

    return {
      endpoints: safeEndpoints,
      results,
      findings,
      stats,
    };
  }

  // -------------------------------------------------------------------------
  // Private: endpoint testing
  // -------------------------------------------------------------------------

  /**
   * Check if a URL is same-origin relative to the base URL.
   * Only same-origin URLs can be fetched via executeScript(fetch) without
   * CORS/CSP issues.
   */
  private isSameOrigin(url: string): boolean {
    try {
      const base = new URL(this.baseUrl);
      const target = new URL(url);
      return base.origin === target.origin;
    } catch {
      return false;
    }
  }

  private async testEndpoint(
    endpoint: DiscoveredEndpoint,
  ): Promise<EndpointTestResult> {
    const url = this.baseUrl + endpoint.path;
    const start = Date.now();

    // Try executeScript(fetch) for same-origin URLs first (preserves auth cookies)
    if (this.isSameOrigin(url)) {
      try {
        const fetchResult = await this.backend.executeScript<{
          status: number;
          body: string;
        }>(`
          (async () => {
            const r = await fetch(${JSON.stringify(url)}, {
              method: ${JSON.stringify(endpoint.method.toUpperCase())},
              credentials: 'include',
              headers: { 'Accept': 'application/json' }
            });
            return { status: r.status, body: (await r.text()).substring(0, ${PREVIEW_MAX_CHARS}) };
          })()
        `);

        if (fetchResult && typeof fetchResult.status === 'number') {
          const durationMs = Date.now() - start;
          const status = fetchResult.status;
          const responsePreview = fetchResult.body || '';
          const responseSize = new TextEncoder().encode(responsePreview).byteLength;

          let isValidJson: boolean | undefined;
          try {
            JSON.parse(responsePreview);
            isValidJson = true;
          } catch {
            isValidJson = false;
          }

          const contentType = isValidJson ? 'application/json' : 'text/plain';
          const category = this.categorize(status);
          const isFailure = category !== 'success';
          const failureReason = isFailure
            ? this.failureReason(category, status, url)
            : undefined;

          return {
            endpoint,
            status,
            statusText: this.statusTextFromCode(status),
            contentType,
            durationMs,
            responseSize,
            isValidJson,
            responsePreview,
            isFailure,
            failureReason,
            category,
          };
        }
      } catch {
        // executeScript(fetch) failed (CSP, CORS, or other issue) — fall through to visitPage
      }
    }

    // Fallback: use visitPage (works for cross-origin and when fetch is blocked)
    try {
      const pageData: PageData = await this.backend.visitPage(url);
      const durationMs = Date.now() - start;

      const status = pageData.statusCode ?? 0;
      const statusText = this.statusTextFromCode(status);
      const responseText = pageData.text ?? '';
      const responsePreview = responseText.slice(0, PREVIEW_MAX_CHARS);
      const responseSize = new TextEncoder().encode(responseText).byteLength;

      // Attempt JSON parse to flag validity
      let isValidJson: boolean | undefined;
      try {
        JSON.parse(responseText);
        isValidJson = true;
      } catch {
        isValidJson = false;
      }

      const contentType = this.inferContentType(pageData, isValidJson);
      const category = this.categorize(status);
      const isFailure = category !== 'success';
      const failureReason = isFailure
        ? this.failureReason(category, status, url)
        : undefined;

      return {
        endpoint,
        status,
        statusText,
        contentType,
        durationMs,
        responseSize,
        isValidJson,
        responsePreview,
        isFailure,
        failureReason,
        category,
      };
    } catch (error) {
      const durationMs = Date.now() - start;
      const isTimeout =
        error instanceof Error &&
        (error.message.includes('timeout') ||
          error.message.includes('Timeout'));

      const category: EndpointTestResult['category'] = isTimeout
        ? 'timeout'
        : 'other-error';

      return {
        endpoint,
        status: 0,
        statusText: error instanceof Error ? error.message : String(error),
        contentType: '',
        durationMs,
        responseSize: 0,
        isValidJson: undefined,
        responsePreview: '',
        isFailure: true,
        failureReason:
          error instanceof Error ? error.message : String(error),
        category,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Private: discovery helpers
  // -------------------------------------------------------------------------

  /**
   * Extract endpoints from a code-analysis payload.  The shape is intentionally
   * flexible: we look for common property names that hold route information.
   */
  private extractFromCodeAnalysis(
    codeAnalysis: Record<string, unknown>,
  ): DiscoveredEndpoint[] {
    const endpoints: DiscoveredEndpoint[] = [];

    // 1. Look for explicit route arrays under common keys
    const routeKeys = ['routes', 'apiRoutes', 'endpoints', 'api'];
    for (const key of routeKeys) {
      const value = codeAnalysis[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          const ep = this.coerceToEndpoint(item, 'code-analysis');
          if (ep) endpoints.push(ep);
        }
      } else if (value && typeof value === 'object') {
        // Could be a map of method -> paths or path -> config
        for (const [subKey, subVal] of Object.entries(
          value as Record<string, unknown>,
        )) {
          if (typeof subVal === 'string' && subVal.startsWith('/')) {
            endpoints.push({
              path: subVal,
              method: subKey.toUpperCase(),
              source: 'code-analysis',
            });
          } else if (typeof subKey === 'string' && subKey.startsWith('/')) {
            endpoints.push({
              path: subKey,
              method: 'GET',
              source: 'code-analysis',
            });
          }
        }
      }
    }

    // 2. Walk all string values looking for /api/ patterns
    this.walkStrings(codeAnalysis, (str) => {
      if (API_PATH_RE.test(str) && str.startsWith('/')) {
        // Avoid duplicates from the routeKeys pass
        if (!endpoints.some((ep) => ep.path === str)) {
          endpoints.push({
            path: str,
            method: 'GET',
            source: 'code-analysis',
          });
        }
      }
    });

    // 3. Next.js file-based API routes (pages/api/**, app/api/**)
    const fileListKeys = ['fileList', 'files', 'sourceFiles'];
    for (const key of fileListKeys) {
      const value = codeAnalysis[key];
      if (Array.isArray(value)) {
        for (const filePath of value) {
          if (typeof filePath !== 'string') continue;
          if (!NEXTJS_API_FILE_RE.test(filePath)) continue;

          const apiPath = this.nextjsFileToApiPath(filePath);
          if (apiPath && !endpoints.some((ep) => ep.path === apiPath)) {
            endpoints.push({
              path: apiPath,
              method: 'GET',
              source: 'code-analysis',
            });
          }
        }
      }
    }

    return endpoints;
  }

  /**
   * Extract endpoints from captured network traffic.
   */
  private extractFromNetworkCaptures(
    requests: NetworkRequest[],
  ): DiscoveredEndpoint[] {
    const endpoints: DiscoveredEndpoint[] = [];
    const seen = new Set<string>();

    for (const req of requests) {
      let path: string;
      try {
        const parsed = new URL(req.url);
        path = parsed.pathname;
      } catch {
        continue;
      }

      if (!API_PATH_RE.test(path)) continue;

      const method = req.method.toUpperCase();
      const key = `${method}:${path}`;
      if (seen.has(key)) continue;
      seen.add(key);

      endpoints.push({
        path,
        method,
        source: 'network-capture',
      });
    }

    return endpoints;
  }

  // -------------------------------------------------------------------------
  // Private: deduplication & merging
  // -------------------------------------------------------------------------

  /**
   * Deduplicate by method+path.  When there is a collision the code-analysis
   * source is preferred because it has higher confidence.
   */
  private deduplicateEndpoints(
    endpoints: DiscoveredEndpoint[],
  ): DiscoveredEndpoint[] {
    const SOURCE_PRIORITY: Record<DiscoveredEndpoint['source'], number> = {
      'code-analysis': 0,
      'route-file': 1,
      openapi: 2,
      'network-capture': 3,
    };

    const map = new Map<string, DiscoveredEndpoint>();
    for (const ep of endpoints) {
      const key = `${ep.method.toUpperCase()}:${ep.path}`;
      const existing = map.get(key);
      if (
        !existing ||
        SOURCE_PRIORITY[ep.source] < SOURCE_PRIORITY[existing.source]
      ) {
        map.set(key, ep);
      }
    }

    return Array.from(map.values());
  }

  // -------------------------------------------------------------------------
  // Private: findings generation
  // -------------------------------------------------------------------------

  private generateFindings(
    results: EndpointTestResult[],
  ): ApiSmokeFinding[] {
    const findings: ApiSmokeFinding[] = [];

    for (const r of results) {
      const url = this.baseUrl + r.endpoint.path;

      if (r.category === 'server-error') {
        findings.push({
          title: `Server error on ${r.endpoint.method} ${r.endpoint.path}`,
          severity: 'P0',
          url,
          description: `API endpoint returned HTTP ${r.status}. This indicates an unhandled server-side error that will affect users.`,
          evidence: {
            status: r.status,
            responsePreview: r.responsePreview,
            durationMs: r.durationMs,
          },
        });
      }

      if (
        r.category === 'not-found' &&
        r.endpoint.source === 'code-analysis'
      ) {
        findings.push({
          title: `Defined route returns 404: ${r.endpoint.method} ${r.endpoint.path}`,
          severity: 'P1',
          url,
          description: `Endpoint discovered in code analysis returned HTTP 404. The route may be misconfigured or the handler may be missing.`,
          evidence: {
            status: r.status,
            responsePreview: r.responsePreview,
            durationMs: r.durationMs,
          },
        });
      }

      if (
        r.category === 'auth-failure' &&
        r.endpoint.requiresAuth === false
      ) {
        findings.push({
          title: `Unexpected auth requirement: ${r.endpoint.method} ${r.endpoint.path}`,
          severity: 'P2',
          url,
          description: `Endpoint marked as not requiring auth returned HTTP ${r.status}. Either the endpoint metadata is wrong or auth middleware is too broad.`,
          evidence: {
            status: r.status,
            responsePreview: r.responsePreview,
            durationMs: r.durationMs,
          },
        });
      }
    }

    return findings;
  }

  // -------------------------------------------------------------------------
  // Private: stats
  // -------------------------------------------------------------------------

  private computeStats(
    results: EndpointTestResult[],
  ): ApiSmokeReport['stats'] {
    const stats: ApiSmokeReport['stats'] = {
      total: results.length,
      success: 0,
      authFailure: 0,
      notFound: 0,
      serverError: 0,
      timeout: 0,
    };

    for (const r of results) {
      switch (r.category) {
        case 'success':
          stats.success++;
          break;
        case 'auth-failure':
          stats.authFailure++;
          break;
        case 'not-found':
          stats.notFound++;
          break;
        case 'server-error':
          stats.serverError++;
          break;
        case 'timeout':
          stats.timeout++;
          break;
        // 'other-error' is counted in total but has no dedicated bucket
      }
    }

    return stats;
  }

  // -------------------------------------------------------------------------
  // Private: utilities
  // -------------------------------------------------------------------------

  /** Map an HTTP status code to a result category. */
  private categorize(status: number): EndpointTestResult['category'] {
    if (status >= 200 && status < 300) return 'success';
    if (status === 401 || status === 403) return 'auth-failure';
    if (status === 404) return 'not-found';
    if (status >= 500) return 'server-error';
    if (status === 0) return 'timeout';
    return 'other-error';
  }

  /** Human-readable reason string for non-success categories. */
  private failureReason(
    category: EndpointTestResult['category'],
    status: number,
    url: string,
  ): string {
    switch (category) {
      case 'auth-failure':
        return `Authentication/authorization failure (HTTP ${status}) at ${url}`;
      case 'not-found':
        return `Endpoint not found (HTTP 404) at ${url}`;
      case 'server-error':
        return `Server error (HTTP ${status}) at ${url}`;
      case 'timeout':
        return `Request timed out for ${url}`;
      case 'other-error':
        return `Unexpected error (HTTP ${status}) at ${url}`;
      default:
        return '';
    }
  }

  /** Derive a reasonable status text from a numeric code. */
  private statusTextFromCode(status: number): string {
    const map: Record<number, string> = {
      0: 'No Response',
      200: 'OK',
      201: 'Created',
      204: 'No Content',
      301: 'Moved Permanently',
      302: 'Found',
      304: 'Not Modified',
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      405: 'Method Not Allowed',
      408: 'Request Timeout',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
      504: 'Gateway Timeout',
    };
    return map[status] ?? `HTTP ${status}`;
  }

  /** Best-effort content-type inference when we do not have real headers. */
  private inferContentType(
    pageData: PageData,
    isValidJson: boolean | undefined,
  ): string {
    if (isValidJson) return 'application/json';
    if (
      pageData.html &&
      (pageData.html.includes('<!DOCTYPE') ||
        pageData.html.includes('<html'))
    ) {
      return 'text/html';
    }
    return 'text/plain';
  }

  /**
   * Try to coerce an unknown value (from code analysis payloads) into a
   * DiscoveredEndpoint.
   */
  private coerceToEndpoint(
    item: unknown,
    source: DiscoveredEndpoint['source'],
  ): DiscoveredEndpoint | null {
    if (typeof item === 'string') {
      if (item.startsWith('/')) {
        return { path: item, method: 'GET', source };
      }
      return null;
    }

    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const path =
        typeof obj.path === 'string'
          ? obj.path
          : typeof obj.url === 'string'
            ? obj.url
            : typeof obj.route === 'string'
              ? obj.route
              : null;

      if (!path || !path.startsWith('/')) return null;

      const method =
        typeof obj.method === 'string' ? obj.method.toUpperCase() : 'GET';

      return {
        path,
        method,
        source,
        expectedStatus:
          typeof obj.expectedStatus === 'number'
            ? obj.expectedStatus
            : undefined,
        requiresAuth:
          typeof obj.requiresAuth === 'boolean'
            ? obj.requiresAuth
            : undefined,
      };
    }

    return null;
  }

  /**
   * Convert a Next.js file path like `pages/api/users/[id].ts` into an API
   * path like `/api/users/[id]`.
   */
  private nextjsFileToApiPath(filePath: string): string | null {
    // Match pages/api/... or app/api/.../route.ts
    const pagesMatch = filePath.match(/pages\/(api\/.+)\.\w+$/);
    if (pagesMatch) {
      let route = '/' + pagesMatch[1];
      // Remove /index suffix
      route = route.replace(/\/index$/, '');
      return route || '/api';
    }

    const appMatch = filePath.match(/app\/(api\/.+?)\/route\.\w+$/);
    if (appMatch) {
      return '/' + appMatch[1];
    }

    // Fallback: just extract the api/... portion
    const genericMatch = filePath.match(/(\/api\/[^\s]+)\.\w+$/);
    if (genericMatch) {
      return genericMatch[1].replace(/\/index$/, '') || '/api';
    }

    return null;
  }

  /**
   * Recursively walk an object, invoking `cb` for every string value found.
   * Arrays and plain objects are traversed; depth is capped to avoid cycles.
   */
  private walkStrings(
    obj: unknown,
    cb: (value: string) => void,
    depth = 0,
  ): void {
    if (depth > 10) return;

    if (typeof obj === 'string') {
      cb(obj);
      return;
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        this.walkStrings(item, cb, depth + 1);
      }
      return;
    }

    if (obj && typeof obj === 'object') {
      for (const value of Object.values(obj as Record<string, unknown>)) {
        this.walkStrings(value, cb, depth + 1);
      }
    }
  }
}
