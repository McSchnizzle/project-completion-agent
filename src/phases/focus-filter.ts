/**
 * Focus Filter - Limits audit scope to matching routes and forms.
 *
 * When `--focus` patterns are provided, filters the route list and
 * form list before exploration and testing phases.
 *
 * @module phases/focus-filter
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FocusFilterResult {
  originalRoutes: number;
  filteredRoutes: number;
  originalForms: number;
  filteredForms: number;
  patterns: string[];
}

interface Route {
  path: string;
  [key: string]: unknown;
}

interface Form {
  action?: string;
  id?: string;
  file?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Filter routes to match focus patterns.
 *
 * Patterns support:
 * - Glob-like: `/admin/*` matches `/admin/users`, `/admin/settings`
 * - Exact: `/login` matches only `/login`
 * - Keyword: `forms` matches routes containing "form"
 *
 * @param routes - Full route list.
 * @param patterns - Focus patterns from `--focus` flag.
 * @returns Filtered route list.
 */
export function filterRoutes(routes: Route[], patterns: string[]): Route[] {
  if (!patterns.length) return routes;
  return routes.filter(route => matchesAnyPattern(route.path, patterns));
}

/**
 * Filter forms to match focus patterns.
 *
 * A form matches if its action URL, ID, or source file matches any pattern.
 *
 * @param forms - Full form list.
 * @param patterns - Focus patterns from `--focus` flag.
 * @returns Filtered form list.
 */
export function filterForms(forms: Form[], patterns: string[]): Form[] {
  if (!patterns.length) return forms;

  return forms.filter(form => {
    const candidates = [
      form.action ?? '',
      form.id ?? '',
      form.file ?? '',
    ].filter(Boolean);

    return candidates.some(c => matchesAnyPattern(c, patterns));
  });
}

/**
 * Apply focus filter and return summary.
 */
export function applyFocusFilter(
  routes: Route[],
  forms: Form[],
  patterns: string[],
): { routes: Route[]; forms: Form[]; summary: FocusFilterResult } {
  const filteredRoutes = filterRoutes(routes, patterns);
  const filteredForms = filterForms(forms, patterns);

  const summary: FocusFilterResult = {
    originalRoutes: routes.length,
    filteredRoutes: filteredRoutes.length,
    originalForms: forms.length,
    filteredForms: filteredForms.length,
    patterns,
  };

  if (patterns.length > 0) {
    console.log(
      `[Focus] Filtered routes: ${summary.filteredRoutes}/${summary.originalRoutes}, ` +
      `forms: ${summary.filteredForms}/${summary.originalForms} ` +
      `(patterns: ${patterns.join(', ')})`,
    );
  }

  return { routes: filteredRoutes, forms: filteredForms, summary };
}

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

function matchesAnyPattern(value: string, patterns: string[]): boolean {
  return patterns.some(pattern => matchesPattern(value, pattern));
}

function matchesPattern(value: string, pattern: string): boolean {
  const lower = value.toLowerCase();
  const patternLower = pattern.toLowerCase();

  // Exact match
  if (lower === patternLower) return true;

  // Keyword match (no slash = keyword)
  if (!pattern.includes('/') && !pattern.includes('*')) {
    return lower.includes(patternLower);
  }

  // Glob match: convert glob to regex
  const regexStr = patternLower
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // escape regex chars
    .replace(/\*/g, '.*'); // * → .*

  try {
    return new RegExp(`^${regexStr}$`).test(lower);
  } catch {
    // Fallback to includes
    return lower.includes(patternLower);
  }
}
