/**
 * Exploration Phase - Browser-based Page Discovery
 * Task B.6: Browser Exploration Helpers
 *
 * Orchestrates browser-based exploration to discover pages,
 * catalog elements, and build page inventory.
 */

import * as fs from 'fs';
import * as path from 'path';
import { RouteInfo } from './code-analysis';
import { canonicalizeUrl, isSameRoute } from '../utils/url-canonicalizer';

export interface QueuedUrl {
  url: string;
  priority: number;
  source: 'code-analysis' | 'link-discovery' | 'user-specified';
  parent_url: string | null;
  depth: number;
  added_at: string;
}

export interface VisitedPage {
  url: string;
  canonical_url: string;
  title: string;
  visited_at: string;
  load_time_ms: number;
  status: 'success' | 'error' | 'timeout' | 'skipped';
  error_message: string | null;
}

export interface PageElement {
  type: 'link' | 'button' | 'form' | 'input' | 'image' | 'heading' | 'text';
  selector: string;
  text: string | null;
  href: string | null;
  attributes: Record<string, string>;
}

export interface PageInventory {
  schema_version: string;
  page_number: number;
  url: string;
  canonical_url: string;
  title: string;
  visited_at: string;
  viewport: { width: number; height: number };
  elements: {
    links: PageElement[];
    buttons: PageElement[];
    forms: FormInventory[];
    inputs: PageElement[];
    headings: PageElement[];
  };
  screenshots: {
    full_page: string | null;
    viewport: string | null;
  };
  accessibility: {
    missing_alt_count: number;
    missing_labels_count: number;
    contrast_issues: number;
  };
  performance: {
    load_time_ms: number;
    dom_content_loaded_ms: number;
    first_contentful_paint_ms: number | null;
  };
  metadata: {
    description: string | null;
    keywords: string | null;
    og_image: string | null;
  };
}

export interface FormInventory {
  id: string;
  action: string;
  method: string;
  fields: FormFieldInventory[];
  submit_button: PageElement | null;
}

export interface FormFieldInventory {
  name: string;
  type: string;
  label: string | null;
  required: boolean;
  validation_pattern: string | null;
  placeholder: string | null;
  current_value: string | null;
}

export interface ExplorationConfig {
  max_pages: number;
  max_depth: number;
  same_origin_only: boolean;
  base_url: string;
  allowed_domains: string[];
  excluded_patterns: string[];
  timeout_ms: number;
  screenshot_enabled: boolean;
  respect_robots: boolean;
}

export const DEFAULT_EXPLORATION_CONFIG: ExplorationConfig = {
  max_pages: 50,
  max_depth: 5,
  same_origin_only: true,
  base_url: '',
  allowed_domains: [],
  excluded_patterns: [
    '/logout',
    '/signout',
    '/delete',
    '/unsubscribe',
    '.pdf',
    '.zip',
    '.exe',
    '/download/',
    '/api/',
    '/_next/',
    '/static/'
  ],
  timeout_ms: 30000,
  screenshot_enabled: true,
  respect_robots: true
};

/**
 * Initialize exploration queue from code analysis routes
 */
export function initializeExplorationQueue(
  routes: RouteInfo[],
  entryUrl: string
): QueuedUrl[] {
  const queue: QueuedUrl[] = [];
  const seen = new Set<string>();

  // Add entry URL first with highest priority
  queue.push({
    url: entryUrl,
    priority: 100,
    source: 'user-specified',
    parent_url: null,
    depth: 0,
    added_at: new Date().toISOString()
  });
  seen.add(canonicalizeUrl(entryUrl).canonical);

  // Parse base URL
  const baseUrl = new URL(entryUrl);

  // Add routes from code analysis
  for (const route of routes) {
    if (route.method !== 'GET') continue;

    // Convert route path to URL
    let routePath = route.path;

    // Skip API routes
    if (routePath.startsWith('/api/')) continue;

    // Handle dynamic parameters - use placeholder values
    routePath = routePath.replace(/:([^/]+)/g, 'test-$1');
    routePath = routePath.replace(/\[([^\]]+)\]/g, 'test-$1');

    const fullUrl = new URL(routePath, baseUrl.origin).toString();
    const canonical = canonicalizeUrl(fullUrl).canonical;

    if (!seen.has(canonical)) {
      seen.add(canonical);
      queue.push({
        url: fullUrl,
        priority: route.auth_required ? 30 : 50,
        source: 'code-analysis',
        parent_url: entryUrl,
        depth: 1,
        added_at: new Date().toISOString()
      });
    }
  }

  // Sort by priority (highest first)
  queue.sort((a, b) => b.priority - a.priority);

  return queue;
}

/**
 * Check if a URL should be visited
 */
export function shouldVisitUrl(
  url: string,
  visited: Set<string>,
  config: ExplorationConfig
): { should_visit: boolean; reason: string } {
  try {
    const parsed = new URL(url);
    const canonical = canonicalizeUrl(url).canonical;

    // Check if already visited
    if (visited.has(canonical)) {
      return { should_visit: false, reason: 'Already visited' };
    }

    // Check same-origin policy
    if (config.same_origin_only) {
      const baseUrl = new URL(config.base_url);
      if (parsed.origin !== baseUrl.origin) {
        // Check allowed domains
        if (!config.allowed_domains.includes(parsed.hostname)) {
          return { should_visit: false, reason: 'Different origin and not in allowed domains' };
        }
      }
    }

    // Check excluded patterns
    for (const pattern of config.excluded_patterns) {
      if (url.toLowerCase().includes(pattern.toLowerCase())) {
        return { should_visit: false, reason: `Matches excluded pattern: ${pattern}` };
      }
    }

    // Check for common non-page URLs
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { should_visit: false, reason: 'Non-HTTP protocol' };
    }

    // Check for fragments (same page anchors)
    if (parsed.hash && !parsed.pathname) {
      return { should_visit: false, reason: 'Same-page anchor' };
    }

    return { should_visit: true, reason: '' };
  } catch {
    return { should_visit: false, reason: 'Invalid URL' };
  }
}

/**
 * Add discovered links to queue
 */
export function addLinksToQueue(
  links: string[],
  parentUrl: string,
  parentDepth: number,
  queue: QueuedUrl[],
  visited: Set<string>,
  config: ExplorationConfig
): number {
  let addedCount = 0;
  const existingUrls = new Set(queue.map(q => canonicalizeUrl(q.url).canonical));

  for (const link of links) {
    // Resolve relative URLs
    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(link, parentUrl).toString();
    } catch {
      continue;
    }

    const canonical = canonicalizeUrl(absoluteUrl).canonical;

    // Skip if already in queue or visited
    if (existingUrls.has(canonical) || visited.has(canonical)) {
      continue;
    }

    // Check if should visit
    const check = shouldVisitUrl(absoluteUrl, visited, config);
    if (!check.should_visit) {
      continue;
    }

    // Check depth limit
    const newDepth = parentDepth + 1;
    if (newDepth > config.max_depth) {
      continue;
    }

    // Add to queue
    queue.push({
      url: absoluteUrl,
      priority: Math.max(10, 50 - newDepth * 10),
      source: 'link-discovery',
      parent_url: parentUrl,
      depth: newDepth,
      added_at: new Date().toISOString()
    });

    existingUrls.add(canonical);
    addedCount++;
  }

  // Re-sort queue by priority
  queue.sort((a, b) => b.priority - a.priority);

  return addedCount;
}

/**
 * Generate page inventory JSON
 */
export function generatePageInventory(
  pageNumber: number,
  url: string,
  title: string,
  elements: PageInventory['elements'],
  loadTimeMs: number,
  viewport: { width: number; height: number } = { width: 1280, height: 720 }
): PageInventory {
  const canonicalized = canonicalizeUrl(url);

  return {
    schema_version: '1.0.0',
    page_number: pageNumber,
    url,
    canonical_url: canonicalized.canonical,
    title,
    visited_at: new Date().toISOString(),
    viewport,
    elements,
    screenshots: {
      full_page: null,
      viewport: null
    },
    accessibility: {
      missing_alt_count: elements.inputs.filter(i =>
        i.type === 'image' && !i.attributes['alt']
      ).length,
      missing_labels_count: elements.inputs.filter(i =>
        !i.attributes['aria-label'] && !i.attributes['id']
      ).length,
      contrast_issues: 0
    },
    performance: {
      load_time_ms: loadTimeMs,
      dom_content_loaded_ms: loadTimeMs,
      first_contentful_paint_ms: null
    },
    metadata: {
      description: null,
      keywords: null,
      og_image: null
    }
  };
}

/**
 * Generate coverage summary
 */
export function generateCoverageSummary(
  visited: VisitedPage[],
  routes: RouteInfo[]
): string {
  const lines: string[] = [];

  lines.push('## Exploration Coverage Summary');
  lines.push('');
  lines.push(`**Pages Visited:** ${visited.length}`);
  lines.push(`**Known Routes:** ${routes.length}`);
  lines.push('');

  // Calculate route coverage
  const visitedPaths = new Set(visited.map(v => new URL(v.url).pathname));
  const coveredRoutes = routes.filter(r => {
    // Handle dynamic segments
    const pattern = r.path.replace(/:([^/]+)/g, '[^/]+').replace(/\[([^\]]+)\]/g, '[^/]+');
    const regex = new RegExp(`^${pattern}$`);
    return [...visitedPaths].some(p => regex.test(p));
  });

  const coveragePercent = routes.length > 0
    ? Math.round((coveredRoutes.length / routes.length) * 100)
    : 100;

  lines.push(`**Route Coverage:** ${coveredRoutes.length}/${routes.length} (${coveragePercent}%)`);
  lines.push('');

  // List uncovered routes
  const uncoveredRoutes = routes.filter(r => !coveredRoutes.includes(r));
  if (uncoveredRoutes.length > 0) {
    lines.push('### Uncovered Routes');
    lines.push('');
    for (const route of uncoveredRoutes.slice(0, 10)) {
      lines.push(`- ${route.path} (${route.source_file})`);
    }
    if (uncoveredRoutes.length > 10) {
      lines.push(`- ... and ${uncoveredRoutes.length - 10} more`);
    }
    lines.push('');
  }

  // Page status breakdown
  const successful = visited.filter(v => v.status === 'success').length;
  const errors = visited.filter(v => v.status === 'error').length;
  const timeouts = visited.filter(v => v.status === 'timeout').length;
  const skipped = visited.filter(v => v.status === 'skipped').length;

  lines.push('### Visit Results');
  lines.push('');
  lines.push(`- Success: ${successful}`);
  lines.push(`- Errors: ${errors}`);
  lines.push(`- Timeouts: ${timeouts}`);
  lines.push(`- Skipped: ${skipped}`);

  return lines.join('\n');
}

/**
 * Write page inventory to file
 */
export function writePageInventory(auditPath: string, inventory: PageInventory): void {
  const pagesDir = path.join(auditPath, 'pages');
  if (!fs.existsSync(pagesDir)) {
    fs.mkdirSync(pagesDir, { recursive: true });
  }

  const filePath = path.join(pagesDir, `page-${inventory.page_number}.json`);
  fs.writeFileSync(filePath, JSON.stringify(inventory, null, 2));
}

/**
 * Load all page inventories
 */
export function loadPageInventories(auditPath: string): PageInventory[] {
  const pagesDir = path.join(auditPath, 'pages');
  if (!fs.existsSync(pagesDir)) {
    return [];
  }

  const inventories: PageInventory[] = [];
  const files = fs.readdirSync(pagesDir).filter(f => f.startsWith('page-') && f.endsWith('.json'));

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(pagesDir, file), 'utf-8');
      inventories.push(JSON.parse(content) as PageInventory);
    } catch {
      // Skip invalid files
    }
  }

  return inventories.sort((a, b) => a.page_number - b.page_number);
}

/**
 * Write exploration state
 */
export function writeExplorationState(
  auditPath: string,
  queue: QueuedUrl[],
  visited: VisitedPage[]
): void {
  const statePath = path.join(auditPath, 'exploration-state.json');
  fs.writeFileSync(statePath, JSON.stringify({
    schema_version: '1.0.0',
    updated_at: new Date().toISOString(),
    queue_size: queue.length,
    visited_count: visited.length,
    queue: queue.slice(0, 100), // Save first 100 in queue
    visited
  }, null, 2));
}

/**
 * Load exploration state
 */
export function loadExplorationState(auditPath: string): {
  queue: QueuedUrl[];
  visited: VisitedPage[];
} | null {
  const statePath = path.join(auditPath, 'exploration-state.json');
  if (!fs.existsSync(statePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(statePath, 'utf-8');
    const state = JSON.parse(content);
    return {
      queue: state.queue || [],
      visited: state.visited || []
    };
  } catch {
    return null;
  }
}

/**
 * Get next URL from queue
 */
export function getNextUrl(queue: QueuedUrl[]): QueuedUrl | null {
  return queue.shift() || null;
}

/**
 * Record page visit
 */
export function recordPageVisit(
  url: string,
  title: string,
  status: VisitedPage['status'],
  loadTimeMs: number,
  errorMessage: string | null = null
): VisitedPage {
  return {
    url,
    canonical_url: canonicalizeUrl(url).canonical,
    title,
    visited_at: new Date().toISOString(),
    load_time_ms: loadTimeMs,
    status,
    error_message: errorMessage
  };
}
