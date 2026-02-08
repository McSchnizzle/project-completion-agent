/**
 * Route Discovery - Multi-Source Route Discovery
 * Task T-019: Route Discovery Implementation
 *
 * Discovers routes from multiple sources:
 * 1. Code analysis (primary)
 * 2. Sitemap.xml
 * 3. robots.txt
 * 4. Link crawling (fallback)
 */

import { canonicalizeUrl } from '../skill/utils/url-canonicalizer.js';

export type RouteSource = 'code-analysis' | 'sitemap' | 'robots' | 'crawl' | 'manual';

export interface DiscoveredRoute {
  url: string;
  path: string;
  source: RouteSource;
  metadata?: Record<string, unknown>;
}

export interface RouteDiscoveryOptions {
  baseUrl: string;
  codeAnalysisRoutes?: string[];
  maxDepth?: number;
  maxUrls?: number;
  timeout?: number;
}

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_URLS = 100;
const DEFAULT_TIMEOUT = 30000;

/**
 * Discover routes from multiple sources with fallback strategy
 */
export async function discoverRoutes(
  options: RouteDiscoveryOptions
): Promise<DiscoveredRoute[]> {
  const {
    baseUrl,
    codeAnalysisRoutes,
    maxDepth = DEFAULT_MAX_DEPTH,
    maxUrls = DEFAULT_MAX_URLS,
    timeout = DEFAULT_TIMEOUT
  } = options;

  const discoveredRoutes: DiscoveredRoute[] = [];
  const seenPaths = new Set<string>();

  // Normalize base URL (remove trailing slash)
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');

  // 1. Primary: Use routes from code analysis if provided
  if (codeAnalysisRoutes && codeAnalysisRoutes.length > 0) {
    for (const route of codeAnalysisRoutes) {
      const fullUrl = route.startsWith('http') ? route : `${normalizedBaseUrl}${route}`;
      const normalizedPath = normalizePath(new URL(fullUrl).pathname);

      if (!seenPaths.has(normalizedPath)) {
        seenPaths.add(normalizedPath);
        discoveredRoutes.push({
          url: fullUrl,
          path: normalizedPath,
          source: 'code-analysis',
          metadata: { fromCodeAnalysis: true }
        });
      }
    }
  }

  // 2. Fallback 1: Fetch sitemap.xml
  try {
    const sitemapUrls = await fetchSitemapUrls(normalizedBaseUrl, timeout);
    for (const url of sitemapUrls) {
      const normalizedPath = normalizePath(new URL(url).pathname);

      if (!seenPaths.has(normalizedPath)) {
        seenPaths.add(normalizedPath);
        discoveredRoutes.push({
          url,
          path: normalizedPath,
          source: 'sitemap',
          metadata: { fromSitemap: true }
        });
      }
    }
  } catch (error) {
    // Sitemap not available or failed, continue to next fallback
    console.warn(`Sitemap fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  // 3. Fallback 2: Fetch robots.txt and extract sitemap directives
  try {
    const robotsSitemaps = await fetchRobotsSitemaps(normalizedBaseUrl, timeout);
    for (const sitemapUrl of robotsSitemaps) {
      try {
        const sitemapUrls = await fetchSitemapUrls(sitemapUrl, timeout);
        for (const url of sitemapUrls) {
          const normalizedPath = normalizePath(new URL(url).pathname);

          if (!seenPaths.has(normalizedPath)) {
            seenPaths.add(normalizedPath);
            discoveredRoutes.push({
              url,
              path: normalizedPath,
              source: 'robots',
              metadata: { fromRobotsTxt: true, sitemapUrl }
            });
          }
        }
      } catch (error) {
        console.warn(`Failed to fetch sitemap from robots.txt: ${sitemapUrl}`);
      }
    }
  } catch (error) {
    console.warn(`Robots.txt fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  // 4. Fallback 3: Breadth-first link crawl
  // Only crawl if we have very few routes discovered
  if (discoveredRoutes.length < 10) {
    try {
      const crawledUrls = await crawlLinks(normalizedBaseUrl, maxDepth, maxUrls, timeout);
      for (const url of crawledUrls) {
        const normalizedPath = normalizePath(new URL(url).pathname);

        if (!seenPaths.has(normalizedPath)) {
          seenPaths.add(normalizedPath);
          discoveredRoutes.push({
            url,
            path: normalizedPath,
            source: 'crawl',
            metadata: { fromCrawl: true }
          });
        }
      }
    } catch (error) {
      console.warn(`Link crawl failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return discoveredRoutes;
}

/**
 * Normalize a URL path for deduplication
 * - Strip trailing slash
 * - Lowercase
 * - Remove query params
 */
function normalizePath(path: string): string {
  // Remove query params and hash
  const cleanPath = path.split('?')[0].split('#')[0];

  // Remove trailing slash (except for root)
  const normalized = cleanPath === '/' ? '/' : cleanPath.replace(/\/$/, '');

  // Lowercase for case-insensitive comparison
  return normalized.toLowerCase();
}

/**
 * Fetch and parse sitemap.xml from a URL
 */
async function fetchSitemapUrls(sitemapUrl: string, timeout: number): Promise<string[]> {
  // Ensure sitemapUrl ends with sitemap.xml if it's a base URL
  const url = sitemapUrl.endsWith('sitemap.xml')
    ? sitemapUrl
    : `${sitemapUrl}/sitemap.xml`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'ProjectCompletionAgent/1.0 (+https://github.com/anthropic/project-completion-agent)'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const xml = await response.text();
    return parseSitemapXml(xml);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Parse sitemap XML and extract URLs from <loc> tags
 */
export function parseSitemapXml(xml: string): string[] {
  const urls: string[] = [];

  // Match <loc>URL</loc> tags (handles both regular sitemaps and sitemap indexes)
  const locRegex = /<loc>\s*([^<]+)\s*<\/loc>/gi;
  let match;

  while ((match = locRegex.exec(xml)) !== null) {
    const url = match[1].trim();
    if (url) {
      urls.push(url);
    }
  }

  return urls;
}

/**
 * Fetch robots.txt and extract sitemap URLs
 */
async function fetchRobotsSitemaps(baseUrl: string, timeout: number): Promise<string[]> {
  const robotsUrl = `${baseUrl}/robots.txt`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(robotsUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'ProjectCompletionAgent/1.0 (+https://github.com/anthropic/project-completion-agent)'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const txt = await response.text();
    return parseRobotsTxt(txt);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Parse robots.txt and extract Sitemap: directives
 */
export function parseRobotsTxt(txt: string): string[] {
  const sitemaps: string[] = [];

  // Match Sitemap: directives (case-insensitive)
  const lines = txt.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    const match = /^Sitemap:\s*(.+)$/i.exec(trimmed);
    if (match) {
      const url = match[1].trim();
      if (url) {
        sitemaps.push(url);
      }
    }
  }

  return sitemaps;
}

/**
 * Crawl links using breadth-first search
 * NOTE: This is a lightweight HTTP-only crawl (fetch HTML, parse <a href> tags)
 */
export async function crawlLinks(
  baseUrl: string,
  maxDepth: number,
  maxUrls: number,
  timeout: number = DEFAULT_TIMEOUT
): Promise<string[]> {
  const visited = new Set<string>();
  const discovered = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: baseUrl, depth: 0 }];

  const baseDomain = new URL(baseUrl).hostname;

  while (queue.length > 0 && discovered.size < maxUrls) {
    const { url, depth } = queue.shift()!;

    // Skip if already visited or max depth reached
    if (visited.has(url) || depth > maxDepth) {
      continue;
    }

    visited.add(url);
    discovered.add(url);

    // Don't crawl deeper if at max depth
    if (depth >= maxDepth) {
      continue;
    }

    try {
      const links = await fetchPageLinks(url, baseDomain, timeout);

      // Add new links to queue
      for (const link of links) {
        if (!visited.has(link) && discovered.size < maxUrls) {
          queue.push({ url: link, depth: depth + 1 });
        }
      }
    } catch (error) {
      // Failed to fetch page, skip it
      console.warn(`Failed to crawl ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return Array.from(discovered);
}

/**
 * Fetch a page and extract all internal links
 */
async function fetchPageLinks(url: string, baseDomain: string, timeout: number): Promise<string[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'ProjectCompletionAgent/1.0 (+https://github.com/anthropic/project-completion-agent)',
        'Accept': 'text/html'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    return parseHtmlLinks(html, url, baseDomain);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Parse HTML and extract <a href> links
 */
function parseHtmlLinks(html: string, baseUrl: string, baseDomain: string): string[] {
  const links: string[] = [];
  const base = new URL(baseUrl);

  // Match <a href="..."> tags
  const hrefRegex = /<a[^>]+href=["']([^"']+)["']/gi;
  let match;

  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1].trim();

    // Skip empty, anchor, javascript, and mailto links
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) {
      continue;
    }

    try {
      // Resolve relative URLs
      const absoluteUrl = new URL(href, base);

      // Only include links from the same domain
      if (absoluteUrl.hostname === baseDomain) {
        // Normalize: remove hash, use canonical URL
        const normalized = `${absoluteUrl.protocol}//${absoluteUrl.host}${absoluteUrl.pathname}${absoluteUrl.search}`;
        links.push(normalized);
      }
    } catch (error) {
      // Invalid URL, skip it
      continue;
    }
  }

  return [...new Set(links)]; // Deduplicate
}

/**
 * Deduplicate routes by normalized path using URL canonicalization
 */
export function deduplicateRoutes(routes: DiscoveredRoute[]): DiscoveredRoute[] {
  const seen = new Map<string, DiscoveredRoute>();

  for (const route of routes) {
    // Use canonical route pattern for deduplication
    const canonical = canonicalizeUrl(route.url);
    const key = canonical.routePattern;

    // Keep the first occurrence (priority: code-analysis > sitemap > robots > crawl)
    if (!seen.has(key)) {
      seen.set(key, route);
    } else {
      // If existing route has lower priority source, replace it
      const existing = seen.get(key)!;
      const sourcePriority: Record<RouteSource, number> = {
        'code-analysis': 4,
        'sitemap': 3,
        'robots': 2,
        'crawl': 1,
        'manual': 5
      };

      if (sourcePriority[route.source] > sourcePriority[existing.source]) {
        seen.set(key, route);
      }
    }
  }

  return Array.from(seen.values());
}
