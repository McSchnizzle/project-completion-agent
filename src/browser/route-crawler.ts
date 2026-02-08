/**
 * Route Crawler - Breadth-first route discovery with URL canonicalization.
 *
 * Crawls a web application starting from a given URL, discovering routes
 * by following same-origin links. Integrates with CoverageTracker and
 * respects exploration stop rules.
 *
 * @module browser/route-crawler
 */

import { CoverageTracker } from '../coverage-tracker.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrawlOptions {
  /** Maximum number of pages to visit */
  maxPages?: number;
  /** Maximum unique route patterns before stopping */
  maxRoutePatterns?: number;
  /** Maximum instances per route pattern */
  maxPerPattern?: number;
  /** Time budget in ms */
  timeoutMs?: number;
  /** Delay between page visits in ms */
  rateLimitMs?: number;
  /** Only follow same-origin links */
  sameOriginOnly?: boolean;
  /** URL patterns to exclude (regexps) */
  excludePatterns?: string[];
  /** Maximum link depth from start URL */
  maxDepth?: number;
}

export interface CrawlResult {
  url: string;
  depth: number;
  discoveredLinks: string[];
  statusCode?: number;
  loadTimeMs: number;
  error?: string;
}

export interface CrawlSummary {
  pagesVisited: number;
  routePatternsFound: number;
  linksDiscovered: number;
  errors: number;
  stopReason: string;
  durationMs: number;
}

interface QueueEntry {
  url: string;
  depth: number;
  referrer: string;
}

const DEFAULT_CRAWL_OPTIONS: Required<CrawlOptions> = {
  maxPages: 50,
  maxRoutePatterns: 50,
  maxPerPattern: 5,
  timeoutMs: 30 * 60 * 1000, // 30 minutes
  rateLimitMs: 1000,
  sameOriginOnly: true,
  excludePatterns: [
    '/logout',
    '/signout',
    '/api/',
    '/auth/',
    '\\.(pdf|zip|tar|gz|jpg|jpeg|png|gif|svg|ico|css|js|woff|woff2|ttf|eot)$',
  ],
  maxDepth: 10,
};

// ---------------------------------------------------------------------------
// RouteCrawler class
// ---------------------------------------------------------------------------

export class RouteCrawler {
  private options: Required<CrawlOptions>;
  private tracker: CoverageTracker;
  private queue: QueueEntry[] = [];
  private visited: Set<string> = new Set();
  private startTime = 0;
  private startOrigin = '';
  private excludeRegexps: RegExp[] = [];
  private aborted = false;

  /**
   * Callback invoked for each page visit. Implement to do the actual
   * Playwright page.goto() and data extraction.
   */
  onVisitPage?: (
    url: string,
    depth: number,
  ) => Promise<CrawlResult>;

  constructor(
    tracker: CoverageTracker,
    options: CrawlOptions = {},
  ) {
    this.tracker = tracker;
    this.options = { ...DEFAULT_CRAWL_OPTIONS, ...options };
    this.excludeRegexps = this.options.excludePatterns.map(
      (p) => new RegExp(p, 'i'),
    );
  }

  /**
   * Begin crawling from the start URL.
   *
   * @param startUrl - The URL to start crawling from
   * @returns Summary of the crawl
   */
  async crawl(startUrl: string): Promise<CrawlSummary> {
    this.startTime = Date.now();
    this.startOrigin = new URL(startUrl).origin;
    this.queue = [{ url: startUrl, depth: 0, referrer: '' }];
    this.visited.clear();
    this.aborted = false;

    let pagesVisited = 0;
    let totalLinksDiscovered = 0;
    let errors = 0;
    let stopReason = 'queue_empty';

    while (this.queue.length > 0 && !this.aborted) {
      // Check stop conditions
      if (pagesVisited >= this.options.maxPages) {
        stopReason = 'max_pages_reached';
        break;
      }

      if (Date.now() - this.startTime > this.options.timeoutMs) {
        stopReason = 'timeout';
        break;
      }

      const entry = this.queue.shift()!;

      // Skip if already visited or shouldn't visit
      if (this.visited.has(entry.url)) continue;
      const shouldVisitResult = this.tracker.shouldVisit(entry.url);
      if (!shouldVisitResult.visit) continue;

      // Mark as visited before processing to avoid duplicates
      this.visited.add(entry.url);

      // Rate limiting
      if (pagesVisited > 0 && this.options.rateLimitMs > 0) {
        await sleep(this.options.rateLimitMs);
      }

      // Visit the page
      let result: CrawlResult;
      if (this.onVisitPage) {
        result = await this.onVisitPage(entry.url, entry.depth);
      } else {
        result = {
          url: entry.url,
          depth: entry.depth,
          discoveredLinks: [],
          loadTimeMs: 0,
        };
      }

      pagesVisited++;

      // Record visit in tracker
      this.tracker.recordVisit(
        entry.url,
        result.statusCode,
        result.loadTimeMs,
      );

      if (result.error) {
        errors++;
      }

      // Process discovered links
      if (entry.depth < this.options.maxDepth) {
        const newLinks = this.filterLinks(result.discoveredLinks);
        totalLinksDiscovered += newLinks.length;
        for (const link of newLinks) {
          if (!this.visited.has(link)) {
            this.queue.push({
              url: link,
              depth: entry.depth + 1,
              referrer: entry.url,
            });
          }
        }
      }
    }

    return {
      pagesVisited,
      routePatternsFound: this.tracker.getState().uniquePatterns,
      linksDiscovered: totalLinksDiscovered,
      errors,
      stopReason,
      durationMs: Date.now() - this.startTime,
    };
  }

  /**
   * Abort the crawl gracefully.
   */
  abort(): void {
    this.aborted = true;
  }

  /**
   * Get the current queue length.
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Filter links to only include valid, same-origin, non-excluded URLs.
   */
  private filterLinks(links: string[]): string[] {
    const filtered: string[] = [];

    for (const link of links) {
      try {
        const parsed = new URL(link);

        // Same-origin check
        if (this.options.sameOriginOnly && parsed.origin !== this.startOrigin) {
          continue;
        }

        // Protocol check
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          continue;
        }

        // Exclude patterns
        const pathname = parsed.pathname;
        if (this.excludeRegexps.some((re) => re.test(pathname) || re.test(link))) {
          continue;
        }

        // Normalize: strip trailing slash, strip hash
        const normalized = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '') || '/'}${parsed.search}`;

        if (!this.visited.has(normalized) && !filtered.includes(normalized)) {
          filtered.push(normalized);
        }
      } catch {
        // Invalid URL, skip
      }
    }

    return filtered;
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
