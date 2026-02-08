/**
 * Coverage-Driven Explorer
 * Task 3.1: Coverage-Driven Exploration Algorithm
 *
 * Intelligently explores application routes based on:
 * - Routes extracted from code analysis
 * - Links discovered during navigation
 * - Coverage gaps identified
 * - Priority based on page importance
 */

import { RouteRegistry, canonicalizeUrl, isAllowedDomain, getBaseUrl } from '../utils/url-canonicalizer';

export interface ExplorationConfig {
  baseUrl: string;
  maxPagesPerRoute: number;
  maxTotalPages: number;
  allowSubdomains: boolean;
  excludePatterns: string[];
  priorityPatterns: Array<{ pattern: RegExp; priority: number }>;
  requiresAuthPatterns: string[];
}

export interface QueuedUrl {
  url: string;
  routeId: string;
  priority: number;
  source: 'code_analysis' | 'link_discovery' | 'user_specified' | 'queue';
  addedAt: string;
  retryCount: number;
  requiresAuth: boolean;
  parentUrl: string | null;
}

export interface VisitedUrl {
  url: string;
  canonicalUrl: string;
  routeId: string;
  visitedAt: string;
  status: 'success' | 'error' | 'timeout' | 'auth_required';
  pageId: string | null;
}

export interface CoverageMetrics {
  routesFromCode: number;
  routesDiscovered: number;
  routesVisited: number;
  routesSkipped: number;
  coveragePercent: number;
}

/**
 * Coverage-driven URL exploration manager
 */
export class CoverageExplorer {
  private config: ExplorationConfig;
  private routeRegistry: RouteRegistry;
  private queue: QueuedUrl[] = [];
  private visited: VisitedUrl[] = [];
  private knownRoutes: Set<string> = new Set();
  private pagesVisited: number = 0;

  constructor(config: Partial<ExplorationConfig> & { baseUrl: string }) {
    this.config = {
      maxPagesPerRoute: 3,
      maxTotalPages: 100,
      allowSubdomains: false,
      excludePatterns: [
        /\.(pdf|zip|tar|gz|rar|exe|dmg|pkg)$/i,
        /^mailto:/i,
        /^tel:/i,
        /^javascript:/i,
        /#$/,
        /\/logout/i,
        /\/signout/i
      ].map(r => r.source),
      priorityPatterns: [
        { pattern: /\/dashboard/i, priority: 10 },
        { pattern: /\/admin/i, priority: 10 },
        { pattern: /\/settings/i, priority: 8 },
        { pattern: /\/profile/i, priority: 8 },
        { pattern: /\/api\//i, priority: 5 },
        { pattern: /\/(create|new|add)/i, priority: 7 },
        { pattern: /\/(edit|update)/i, priority: 7 },
        { pattern: /\/(delete|remove)/i, priority: 6 }
      ],
      requiresAuthPatterns: [
        '/dashboard',
        '/admin',
        '/settings',
        '/profile',
        '/account'
      ],
      ...config
    };

    this.routeRegistry = new RouteRegistry(this.config.maxPagesPerRoute);
  }

  /**
   * Seed queue with routes from code analysis
   */
  seedFromCodeAnalysis(routes: string[]): void {
    for (const route of routes) {
      const url = this.normalizeRoute(route);
      if (url) {
        this.knownRoutes.add(this.getRoutePattern(url));
        this.addToQueue(url, 'code_analysis', null, 5);
      }
    }
  }

  /**
   * Seed queue with user-specified URLs
   */
  seedFromUserInput(urls: string[]): void {
    for (const url of urls) {
      this.addToQueue(url, 'user_specified', null, 10);
    }
  }

  /**
   * Get next URL to visit from queue
   */
  getNextUrl(): QueuedUrl | null {
    if (this.pagesVisited >= this.config.maxTotalPages) {
      return null;
    }

    // Sort by priority (descending) then by added time (ascending)
    this.queue.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime();
    });

    // Find first URL that should be visited
    for (let i = 0; i < this.queue.length; i++) {
      const item = this.queue[i];
      const registration = this.routeRegistry.register(item.url);

      if (registration.shouldVisit) {
        this.queue.splice(i, 1);
        return item;
      }
    }

    return null;
  }

  /**
   * Mark URL as visited
   */
  markVisited(
    url: string,
    status: VisitedUrl['status'],
    pageId: string | null = null
  ): void {
    const canonical = canonicalizeUrl(url);

    this.visited.push({
      url,
      canonicalUrl: canonical.canonical,
      routeId: canonical.routeId,
      visitedAt: new Date().toISOString(),
      status,
      pageId
    });

    this.pagesVisited++;
  }

  /**
   * Add discovered links to queue
   */
  addDiscoveredLinks(links: string[], parentUrl: string): void {
    for (const link of links) {
      const normalizedLink = this.normalizeLink(link, parentUrl);
      if (normalizedLink && this.shouldVisit(normalizedLink)) {
        this.addToQueue(normalizedLink, 'link_discovery', parentUrl);
      }
    }
  }

  /**
   * Get coverage metrics
   */
  getCoverageMetrics(): CoverageMetrics {
    const routesCoverage = this.routeRegistry.getCoverage(this.knownRoutes.size);

    return {
      routesFromCode: this.knownRoutes.size,
      routesDiscovered: routesCoverage.discovered,
      routesVisited: routesCoverage.visited,
      routesSkipped: this.getSkippedCount(),
      coveragePercent: routesCoverage.percent
    };
  }

  /**
   * Get queue status
   */
  getQueueStatus(): {
    queueSize: number;
    visitedCount: number;
    remainingCapacity: number;
  } {
    return {
      queueSize: this.queue.length,
      visitedCount: this.visited.length,
      remainingCapacity: Math.max(0, this.config.maxTotalPages - this.pagesVisited)
    };
  }

  /**
   * Check if exploration is complete
   */
  isComplete(): boolean {
    return (
      this.pagesVisited >= this.config.maxTotalPages ||
      (this.queue.length === 0 && this.getNextUrl() === null)
    );
  }

  /**
   * Get unvisited routes (coverage gaps)
   */
  getUnvisitedRoutes(): string[] {
    const allRoutes = this.routeRegistry.getAllRoutes();
    const unvisited: string[] = [];

    for (const [routeId, route] of allRoutes) {
      if (route.visitCount === 0) {
        unvisited.push(route.pattern);
      }
    }

    // Also check known routes from code that haven't been discovered
    for (const pattern of this.knownRoutes) {
      if (!Array.from(allRoutes.values()).some(r => r.pattern === pattern)) {
        unvisited.push(pattern);
      }
    }

    return unvisited;
  }

  /**
   * Export state for checkpointing
   */
  exportState(): {
    queue: QueuedUrl[];
    visited: VisitedUrl[];
    routes: Record<string, any>;
    knownRoutes: string[];
    pagesVisited: number;
  } {
    return {
      queue: this.queue,
      visited: this.visited,
      routes: this.routeRegistry.toJSON(),
      knownRoutes: Array.from(this.knownRoutes),
      pagesVisited: this.pagesVisited
    };
  }

  /**
   * Import state from checkpoint
   */
  importState(state: ReturnType<CoverageExplorer['exportState']>): void {
    this.queue = state.queue;
    this.visited = state.visited;
    this.routeRegistry = RouteRegistry.fromJSON(state.routes);
    this.knownRoutes = new Set(state.knownRoutes);
    this.pagesVisited = state.pagesVisited;
  }

  // Private methods

  private addToQueue(
    url: string,
    source: QueuedUrl['source'],
    parentUrl: string | null,
    basePriority: number = 1
  ): void {
    const canonical = canonicalizeUrl(url);

    // Check if already in queue or visited
    if (this.queue.some(q => q.routeId === canonical.routeId)) return;
    if (this.visited.some(v => v.routeId === canonical.routeId)) return;

    // Calculate priority
    let priority = basePriority;
    for (const { pattern, priority: bonus } of this.config.priorityPatterns) {
      if (pattern.test(url)) {
        priority += bonus;
        break;
      }
    }

    // Check if requires auth
    const requiresAuth = this.config.requiresAuthPatterns.some(p =>
      url.toLowerCase().includes(p.toLowerCase())
    );

    this.queue.push({
      url,
      routeId: canonical.routeId,
      priority,
      source,
      addedAt: new Date().toISOString(),
      retryCount: 0,
      requiresAuth,
      parentUrl
    });
  }

  private normalizeRoute(route: string): string | null {
    // Convert route pattern to URL
    const cleanRoute = route
      .replace(/\{[^}]+\}/g, '1') // Replace {id} with placeholder
      .replace(/\[\.\.\.[^\]]+\]/g, '') // Remove Next.js catch-all
      .replace(/\[[^\]]+\]/g, '1'); // Replace [id] with placeholder

    try {
      return new URL(cleanRoute, this.config.baseUrl).href;
    } catch {
      return null;
    }
  }

  private normalizeLink(link: string, baseUrl: string): string | null {
    try {
      const resolved = new URL(link, baseUrl);

      // Remove hash
      resolved.hash = '';

      return resolved.href;
    } catch {
      return null;
    }
  }

  private shouldVisit(url: string): boolean {
    // Check domain
    const baseHost = new URL(this.config.baseUrl).hostname;
    if (!isAllowedDomain(url, baseHost, this.config.allowSubdomains)) {
      return false;
    }

    // Check exclude patterns
    for (const pattern of this.config.excludePatterns) {
      if (new RegExp(pattern, 'i').test(url)) {
        return false;
      }
    }

    return true;
  }

  private getRoutePattern(url: string): string {
    return canonicalizeUrl(url).routePattern;
  }

  private getSkippedCount(): number {
    const allRoutes = this.routeRegistry.getAllRoutes();
    return Array.from(allRoutes.values()).filter(r => r.visitCount > this.config.maxPagesPerRoute).length;
  }
}

/**
 * Extract links from page content
 */
export function extractLinks(
  accessibilityTree: any[],
  currentUrl: string
): string[] {
  const links: string[] = [];

  function traverse(node: any) {
    if (node.role === 'link' && node.attributes?.href) {
      links.push(node.attributes.href);
    }

    if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }

  for (const node of accessibilityTree) {
    traverse(node);
  }

  // Resolve relative URLs
  return links.map(link => {
    try {
      return new URL(link, currentUrl).href;
    } catch {
      return null;
    }
  }).filter((link): link is string => link !== null);
}
