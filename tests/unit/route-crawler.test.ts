/**
 * Tests for Route Crawler module.
 */

import { describe, it, expect, vi } from 'vitest';
import { RouteCrawler, type CrawlResult } from '../../src/browser/route-crawler';
import { CoverageTracker } from '../../src/coverage-tracker';

describe('RouteCrawler', () => {
  describe('crawl', () => {
    it('should visit the start URL', async () => {
      const tracker = new CoverageTracker();
      const crawler = new RouteCrawler(tracker, { maxPages: 5, rateLimitMs: 0 });

      const visitedUrls: string[] = [];
      crawler.onVisitPage = async (url, depth): Promise<CrawlResult> => {
        visitedUrls.push(url);
        return {
          url,
          depth,
          discoveredLinks: [],
          loadTimeMs: 100,
          statusCode: 200,
        };
      };

      const summary = await crawler.crawl('https://example.com');

      expect(visitedUrls).toContain('https://example.com');
      expect(summary.pagesVisited).toBe(1);
      expect(summary.stopReason).toBe('queue_empty');
    });

    it('should follow discovered links', async () => {
      const tracker = new CoverageTracker();
      const crawler = new RouteCrawler(tracker, { maxPages: 10, rateLimitMs: 0 });

      crawler.onVisitPage = async (url, depth): Promise<CrawlResult> => {
        if (url === 'https://example.com') {
          return {
            url,
            depth,
            discoveredLinks: [
              'https://example.com/about',
              'https://example.com/contact',
            ],
            loadTimeMs: 100,
          };
        }
        return {
          url,
          depth,
          discoveredLinks: [],
          loadTimeMs: 50,
        };
      };

      const summary = await crawler.crawl('https://example.com');

      expect(summary.pagesVisited).toBe(3);
      expect(summary.linksDiscovered).toBe(2);
    });

    it('should respect maxPages limit', async () => {
      const tracker = new CoverageTracker();
      const crawler = new RouteCrawler(tracker, { maxPages: 2, rateLimitMs: 0 });

      crawler.onVisitPage = async (url, depth): Promise<CrawlResult> => ({
        url,
        depth,
        discoveredLinks: [
          `https://example.com/page-${depth + 1}a`,
          `https://example.com/page-${depth + 1}b`,
        ],
        loadTimeMs: 10,
      });

      const summary = await crawler.crawl('https://example.com');

      expect(summary.pagesVisited).toBe(2);
      expect(summary.stopReason).toBe('max_pages_reached');
    });

    it('should filter out cross-origin links', async () => {
      const tracker = new CoverageTracker();
      const crawler = new RouteCrawler(tracker, {
        maxPages: 10,
        rateLimitMs: 0,
        sameOriginOnly: true,
      });

      const visitedUrls: string[] = [];
      crawler.onVisitPage = async (url, depth): Promise<CrawlResult> => {
        visitedUrls.push(url);
        return {
          url,
          depth,
          discoveredLinks: [
            'https://other-domain.com/page',
            'https://example.com/local-page',
          ],
          loadTimeMs: 10,
        };
      };

      await crawler.crawl('https://example.com');

      expect(visitedUrls).not.toContain('https://other-domain.com/page');
      expect(visitedUrls).toContain('https://example.com/local-page');
    });

    it('should filter out excluded patterns', async () => {
      const tracker = new CoverageTracker();
      const crawler = new RouteCrawler(tracker, {
        maxPages: 10,
        rateLimitMs: 0,
        excludePatterns: ['/logout', '/api/'],
      });

      const visitedUrls: string[] = [];
      crawler.onVisitPage = async (url, depth): Promise<CrawlResult> => {
        visitedUrls.push(url);
        return {
          url,
          depth,
          discoveredLinks: [
            'https://example.com/logout',
            'https://example.com/api/users',
            'https://example.com/safe-page',
          ],
          loadTimeMs: 10,
        };
      };

      await crawler.crawl('https://example.com');

      expect(visitedUrls).not.toContain('https://example.com/logout');
      expect(visitedUrls).not.toContain('https://example.com/api/users');
      expect(visitedUrls).toContain('https://example.com/safe-page');
    });

    it('should not revisit already visited URLs', async () => {
      const tracker = new CoverageTracker();
      const crawler = new RouteCrawler(tracker, { maxPages: 10, rateLimitMs: 0 });

      const visitedUrls: string[] = [];
      crawler.onVisitPage = async (url, depth): Promise<CrawlResult> => {
        visitedUrls.push(url);
        // Every page discovers /about and the start URL
        return {
          url,
          depth,
          discoveredLinks: [
            'https://example.com',
            'https://example.com/about',
          ],
          loadTimeMs: 10,
        };
      };

      await crawler.crawl('https://example.com');

      // Each unique URL should appear at most once
      const uniqueVisits = new Set(visitedUrls);
      expect(uniqueVisits.size).toBe(visitedUrls.length);
    });

    it('should respect maxDepth limit', async () => {
      const tracker = new CoverageTracker();
      const crawler = new RouteCrawler(tracker, {
        maxPages: 20,
        rateLimitMs: 0,
        maxDepth: 1,
      });

      let maxDepthSeen = 0;
      crawler.onVisitPage = async (url, depth): Promise<CrawlResult> => {
        maxDepthSeen = Math.max(maxDepthSeen, depth);
        return {
          url,
          depth,
          discoveredLinks: [`https://example.com/level-${depth + 1}`],
          loadTimeMs: 10,
        };
      };

      await crawler.crawl('https://example.com');

      // Depth 0 = start, depth 1 = first level
      // Links discovered at depth 1 should not be added (depth 2 exceeds maxDepth 1)
      expect(maxDepthSeen).toBeLessThanOrEqual(1);
    });

    it('should count errors', async () => {
      const tracker = new CoverageTracker();
      const crawler = new RouteCrawler(tracker, { maxPages: 5, rateLimitMs: 0 });

      crawler.onVisitPage = async (url, depth): Promise<CrawlResult> => ({
        url,
        depth,
        discoveredLinks: ['https://example.com/error-page'],
        loadTimeMs: 10,
        error: depth > 0 ? 'Page load failed' : undefined,
      });

      const summary = await crawler.crawl('https://example.com');

      expect(summary.errors).toBeGreaterThanOrEqual(1);
    });

    it('should respect timeout', async () => {
      const tracker = new CoverageTracker();
      const crawler = new RouteCrawler(tracker, {
        maxPages: 100,
        rateLimitMs: 0,
        timeoutMs: 50, // Very short timeout
      });

      crawler.onVisitPage = async (url, depth): Promise<CrawlResult> => {
        // Simulate slow page
        await new Promise((r) => setTimeout(r, 30));
        return {
          url,
          depth,
          discoveredLinks: Array.from({ length: 10 }, (_, i) =>
            `https://example.com/page-${depth}-${i}`,
          ),
          loadTimeMs: 30,
        };
      };

      const summary = await crawler.crawl('https://example.com');

      expect(summary.stopReason).toBe('timeout');
    });
  });

  describe('abort', () => {
    it('should stop crawl gracefully', async () => {
      const tracker = new CoverageTracker();
      const crawler = new RouteCrawler(tracker, { maxPages: 100, rateLimitMs: 0 });

      let visits = 0;
      crawler.onVisitPage = async (url, depth): Promise<CrawlResult> => {
        visits++;
        if (visits >= 3) {
          crawler.abort();
        }
        return {
          url,
          depth,
          discoveredLinks: [`https://example.com/page-${visits}`],
          loadTimeMs: 10,
        };
      };

      await crawler.crawl('https://example.com');

      expect(visits).toBe(3);
    });
  });

  describe('getQueueLength', () => {
    it('should reflect current queue size', () => {
      const tracker = new CoverageTracker();
      const crawler = new RouteCrawler(tracker);
      expect(crawler.getQueueLength()).toBe(0);
    });
  });
});
