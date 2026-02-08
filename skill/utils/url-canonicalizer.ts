/**
 * URL Canonicalizer - Route Deduplication
 * Task 1.4: URL Canonicalization
 * Task 6.6: URL Canonicalization Rules Enhancement
 *
 * Normalizes URLs and extracts route patterns to prevent
 * visiting the same logical route multiple times with
 * different parameter values.
 *
 * Enhanced with:
 * - Query parameter filtering (remove tracking params)
 * - Hash/fragment normalization
 * - Common redirect parameter handling
 */

import * as crypto from 'crypto';

export interface CanonicalizedUrl {
  original: string;
  canonical: string;
  routePattern: string;
  routeId: string;
  params: Record<string, string>;
  queryParams: Record<string, string>;
  method: string;
  hasFragment: boolean;
}

export interface CanonicalizationOptions {
  remove_tracking_params: boolean;
  normalize_fragments: boolean;
  preserve_significant_params: string[];
}

export interface RoutePattern {
  pattern: string;
  paramNames: string[];
  sampleUrls: string[];
  visitCount: number;
}

// Common patterns that indicate dynamic segments
const DYNAMIC_PATTERNS = [
  // UUIDs
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
  // Numeric IDs
  /^[0-9]+$/,
  // MongoDB ObjectIds
  /^[0-9a-f]{24}$/i,
  // Short hashes/codes
  /^[a-z0-9]{6,12}$/i,
  // Timestamps
  /^\d{10,13}$/,
  // Slugified content with numbers
  /^[a-z0-9-]+-\d+$/i
];

// Task 6.6: Tracking parameters to remove
const TRACKING_PARAMS = new Set([
  // Google Analytics
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'gclid', 'gclsrc', 'dclid',
  // Facebook
  'fbclid', 'fb_action_ids', 'fb_action_types', 'fb_source', 'fb_ref',
  // Other common tracking
  'ref', 'ref_', 'referrer', 'source', 'mc_cid', 'mc_eid',
  // Session/cache busting
  '_', 'timestamp', 'ts', 'nocache', 'cachebuster',
  // Adobe Analytics
  's_kwcid', 'ef_id', 'msclkid',
  // Social
  'igshid', 'twclid', 'li_fat_id',
  // Misc
  'yclid', 'wickedid', '_hsenc', '_hsmi', 'hsa_acc', 'hsa_cam', 'hsa_grp'
]);

// Parameters that are significant for routing (should be preserved)
const SIGNIFICANT_PARAMS = new Set([
  'id', 'page', 'limit', 'offset', 'sort', 'order', 'q', 'query', 'search',
  'filter', 'category', 'type', 'status', 'tab', 'view', 'mode', 'action'
]);

const DEFAULT_CANONICALIZATION_OPTIONS: CanonicalizationOptions = {
  remove_tracking_params: true,
  normalize_fragments: true,
  preserve_significant_params: [...SIGNIFICANT_PARAMS]
};

// Segment names to infer from context
const SEGMENT_CONTEXT_HINTS: Record<string, string> = {
  'users': 'userId',
  'user': 'userId',
  'posts': 'postId',
  'post': 'postId',
  'articles': 'articleId',
  'article': 'articleId',
  'products': 'productId',
  'product': 'productId',
  'orders': 'orderId',
  'order': 'orderId',
  'tasks': 'taskId',
  'task': 'taskId',
  'items': 'itemId',
  'item': 'itemId',
  'comments': 'commentId',
  'comment': 'commentId',
  'projects': 'projectId',
  'project': 'projectId',
  'categories': 'categoryId',
  'category': 'categoryId',
  'tags': 'tagId',
  'tag': 'tagId'
};

/**
 * Canonicalize a URL by normalizing and extracting route pattern
 * Task 6.6: Enhanced with query param filtering and fragment normalization
 */
export function canonicalizeUrl(
  url: string,
  method: string = 'GET',
  options: Partial<CanonicalizationOptions> = {}
): CanonicalizedUrl {
  const opts = { ...DEFAULT_CANONICALIZATION_OPTIONS, ...options };
  const parsed = new URL(url);

  // Normalize: lowercase host, remove trailing slash
  const normalizedHost = parsed.hostname.toLowerCase();
  let pathname = parsed.pathname.replace(/\/+$/, '') || '/';

  // Task 6.6: Filter query parameters
  const queryParams = new URLSearchParams(parsed.search);
  const filteredParams = new URLSearchParams();
  const preservedQueryParams: Record<string, string> = {};

  for (const [key, value] of queryParams.entries()) {
    const keyLower = key.toLowerCase();

    // Skip tracking params if option enabled
    if (opts.remove_tracking_params && TRACKING_PARAMS.has(keyLower)) {
      continue;
    }

    filteredParams.append(key, value);
    preservedQueryParams[key] = value;
  }

  // Sort filtered params for consistency
  const sortedParams = new URLSearchParams([...filteredParams.entries()].sort());
  const queryString = sortedParams.toString();

  // Task 6.6: Handle fragment normalization
  let hasFragment = false;
  if (parsed.hash) {
    hasFragment = true;
    // Fragments are typically client-side navigation, ignore for routing
    // unless they match patterns like #/path (SPA routing)
    if (!opts.normalize_fragments && parsed.hash.startsWith('#/')) {
      // SPA-style routing - include in canonical URL
      pathname = pathname + parsed.hash.replace('#', '');
    }
  }

  // Build canonical URL
  const canonical = `${parsed.protocol}//${normalizedHost}${pathname}${queryString ? '?' + queryString : ''}`;

  // Extract route pattern and params
  const { pattern, params, paramNames } = extractRoutePattern(pathname);

  // Generate route ID (hash of method + pattern + significant query params)
  const significantQueryForHash = Array.from(sortedParams.entries())
    .filter(([key]) => SIGNIFICANT_PARAMS.has(key.toLowerCase()))
    .map(([key, val]) => `${key}=${val}`)
    .join('&');

  const routeId = generateRouteId(method, pattern + (significantQueryForHash ? `?${significantQueryForHash}` : ''));

  return {
    original: url,
    canonical,
    routePattern: pattern,
    routeId,
    params,
    queryParams: preservedQueryParams,
    method,
    hasFragment
  };
}

/**
 * Extract route pattern from pathname, replacing dynamic segments with placeholders
 */
function extractRoutePattern(pathname: string): {
  pattern: string;
  params: Record<string, string>;
  paramNames: string[];
} {
  const segments = pathname.split('/').filter(Boolean);
  const patternSegments: string[] = [];
  const params: Record<string, string> = {};
  const paramNames: string[] = [];

  let prevSegment: string | null = null;

  for (const segment of segments) {
    if (isDynamicSegment(segment)) {
      // Infer parameter name from previous segment
      const paramName = inferParamName(prevSegment, patternSegments.length);
      paramNames.push(paramName);
      params[paramName] = segment;
      patternSegments.push(`{${paramName}}`);
    } else {
      patternSegments.push(segment);
    }
    prevSegment = segment;
  }

  const pattern = '/' + patternSegments.join('/');

  return { pattern, params, paramNames };
}

/**
 * Check if a path segment appears to be a dynamic value
 */
function isDynamicSegment(segment: string): boolean {
  // Check against known dynamic patterns
  for (const pattern of DYNAMIC_PATTERNS) {
    if (pattern.test(segment)) {
      return true;
    }
    // Reset regex lastIndex for global patterns
    if (pattern.global) {
      pattern.lastIndex = 0;
    }
  }

  return false;
}

/**
 * Infer a meaningful parameter name from context
 */
function inferParamName(prevSegment: string | null, index: number): string {
  if (prevSegment) {
    // Singularize common plurals and add Id
    const hint = SEGMENT_CONTEXT_HINTS[prevSegment.toLowerCase()];
    if (hint) {
      return hint;
    }

    // Generic: previous segment name + Id
    if (prevSegment.endsWith('s')) {
      return prevSegment.slice(0, -1) + 'Id';
    }
    return prevSegment + 'Id';
  }

  // Fallback to generic param name
  return `param${index}`;
}

/**
 * Generate a unique route ID from method and pattern
 */
export function generateRouteId(method: string, pattern: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(`${method.toUpperCase()}:${pattern}`);
  return hash.digest('hex').substring(0, 12);
}

/**
 * Check if two URLs represent the same route
 */
export function isSameRoute(url1: string, url2: string, method: string = 'GET'): boolean {
  const canonical1 = canonicalizeUrl(url1, method);
  const canonical2 = canonicalizeUrl(url2, method);
  return canonical1.routeId === canonical2.routeId;
}

/**
 * Manage a collection of route patterns
 */
export class RouteRegistry {
  private routes: Map<string, RoutePattern> = new Map();
  private maxSamplesPerRoute: number;

  constructor(maxSamplesPerRoute: number = 3) {
    this.maxSamplesPerRoute = maxSamplesPerRoute;
  }

  /**
   * Register a URL and return whether it's a new route
   */
  register(url: string, method: string = 'GET'): {
    isNewRoute: boolean;
    routeId: string;
    visitCount: number;
    shouldVisit: boolean;
  } {
    const canonical = canonicalizeUrl(url, method);
    const existing = this.routes.get(canonical.routeId);

    if (existing) {
      existing.visitCount++;
      if (existing.sampleUrls.length < this.maxSamplesPerRoute) {
        existing.sampleUrls.push(url);
      }

      return {
        isNewRoute: false,
        routeId: canonical.routeId,
        visitCount: existing.visitCount,
        shouldVisit: existing.visitCount <= this.maxSamplesPerRoute
      };
    }

    // New route
    const routePattern: RoutePattern = {
      pattern: canonical.routePattern,
      paramNames: Object.keys(canonical.params),
      sampleUrls: [url],
      visitCount: 1
    };

    this.routes.set(canonical.routeId, routePattern);

    return {
      isNewRoute: true,
      routeId: canonical.routeId,
      visitCount: 1,
      shouldVisit: true
    };
  }

  /**
   * Get all registered routes
   */
  getAllRoutes(): Map<string, RoutePattern> {
    return new Map(this.routes);
  }

  /**
   * Get coverage statistics
   */
  getCoverage(totalKnownRoutes: number): {
    discovered: number;
    visited: number;
    percent: number;
  } {
    const discovered = this.routes.size;
    const visited = Array.from(this.routes.values()).filter(r => r.visitCount > 0).length;
    const total = Math.max(totalKnownRoutes, discovered);

    return {
      discovered,
      visited,
      percent: total > 0 ? Math.round((visited / total) * 100) : 0
    };
  }

  /**
   * Export to JSON for persistence
   */
  toJSON(): Record<string, RoutePattern> {
    return Object.fromEntries(this.routes);
  }

  /**
   * Import from JSON
   */
  static fromJSON(data: Record<string, RoutePattern>): RouteRegistry {
    const registry = new RouteRegistry();
    for (const [id, pattern] of Object.entries(data)) {
      registry.routes.set(id, pattern);
    }
    return registry;
  }
}

/**
 * Extract base URL from a full URL
 */
export function getBaseUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}

/**
 * Check if URL is within allowed domain
 */
export function isAllowedDomain(
  url: string,
  allowedDomain: string,
  allowSubdomains: boolean = false
): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const allowed = allowedDomain.toLowerCase();

    if (host === allowed) {
      return true;
    }

    if (allowSubdomains && host.endsWith('.' + allowed)) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}
