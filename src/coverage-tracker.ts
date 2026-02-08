/**
 * Coverage Tracker - Tracks visited URLs and compares against known routes.
 *
 * Maintains a running tally of which routes have been explored, compares
 * against routes discovered by code-analysis, and reports coverage
 * percentages and unvisited routes.
 *
 * @module coverage-tracker
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getCodeAnalysisPath, getCoverageSummaryPath } from './artifact-paths.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RouteEntry {
  /** The canonical path pattern, e.g. /users/{id} */
  pattern: string;
  /** HTTP method (GET by default for page routes) */
  method: string;
  /** Source that identified this route */
  source: 'code_analysis' | 'prd' | 'discovered' | 'manual';
  /** Whether this route requires authentication */
  authRequired: boolean;
}

export interface VisitRecord {
  url: string;
  pattern: string;
  visitedAt: string;
  statusCode?: number;
  loadTimeMs?: number;
  hasScreenshot: boolean;
  findingsCount: number;
}

export interface CoverageReport {
  knownRoutes: number;
  visitedRoutes: number;
  coveragePercent: number;
  unvisitedRoutes: RouteEntry[];
  visitedByPattern: Record<string, number>;
  totalPagesVisited: number;
  avgLoadTimeMs: number;
  routesBySource: Record<string, number>;
}

// ---------------------------------------------------------------------------
// CoverageTracker class
// ---------------------------------------------------------------------------

export class CoverageTracker {
  private knownRoutes: Map<string, RouteEntry> = new Map();
  private visits: VisitRecord[] = [];
  private visitedPatterns: Set<string> = new Set();
  private patternVisitCounts: Map<string, number> = new Map();
  private maxVisitsPerPattern: number;
  private explorationQueue: string[] = [];

  constructor(maxVisitsPerPattern = 5) {
    this.maxVisitsPerPattern = maxVisitsPerPattern;
  }

  /**
   * Load known routes from code-analysis.json output.
   */
  loadFromCodeAnalysis(auditDir: string): number {
    const analysisPath = getCodeAnalysisPath(auditDir);
    if (!fs.existsSync(analysisPath)) {
      return 0;
    }

    try {
      const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf-8'));
      if (Array.isArray(analysis.routes)) {
        for (const route of analysis.routes) {
          const pattern =
            typeof route === 'string' ? route : route.path || route.pattern;
          if (pattern) {
            this.addKnownRoute({
              pattern: this.normalizePattern(pattern),
              method: route.method || 'GET',
              source: 'code_analysis',
              authRequired: route.authRequired ?? false,
            });
          }
        }
      }
    } catch {
      // Ignore parse errors
    }

    return this.knownRoutes.size;
  }

  /**
   * Add a known route to track.
   */
  addKnownRoute(route: RouteEntry): void {
    const key = `${route.method}:${route.pattern}`;
    this.knownRoutes.set(key, route);
  }

  /**
   * Record a page visit.
   */
  recordVisit(
    url: string,
    statusCode?: number,
    loadTimeMs?: number,
    hasScreenshot = false,
    findingsCount = 0,
  ): VisitRecord {
    const pattern = this.urlToPattern(url);
    const record: VisitRecord = {
      url,
      pattern,
      visitedAt: new Date().toISOString(),
      statusCode,
      loadTimeMs,
      hasScreenshot,
      findingsCount,
    };

    this.visits.push(record);
    this.visitedPatterns.add(pattern);

    const currentCount = this.patternVisitCounts.get(pattern) ?? 0;
    this.patternVisitCounts.set(pattern, currentCount + 1);

    // Remove from exploration queue if present
    this.explorationQueue = this.explorationQueue.filter((u) => u !== url);

    return record;
  }

  /**
   * Check if a URL should be visited (hasn't exceeded pattern limit).
   */
  shouldVisit(url: string): { visit: boolean; reason: string } {
    const pattern = this.urlToPattern(url);
    const count = this.patternVisitCounts.get(pattern) ?? 0;

    if (count >= this.maxVisitsPerPattern) {
      return {
        visit: false,
        reason: `Pattern ${pattern} already visited ${count} times (max: ${this.maxVisitsPerPattern})`,
      };
    }

    // Check if exact URL already visited
    if (this.visits.some((v) => v.url === url)) {
      return { visit: false, reason: `URL already visited: ${url}` };
    }

    return { visit: true, reason: 'Not yet visited' };
  }

  /**
   * Add URLs to the exploration queue.
   */
  addToQueue(urls: string[]): number {
    let added = 0;
    for (const url of urls) {
      const { visit } = this.shouldVisit(url);
      if (visit && !this.explorationQueue.includes(url)) {
        this.explorationQueue.push(url);
        added++;
      }
    }
    return added;
  }

  /**
   * Get the next URL to visit from the queue.
   */
  nextInQueue(): string | undefined {
    return this.explorationQueue.shift();
  }

  /**
   * Get the number of URLs remaining in the queue.
   */
  queueLength(): number {
    return this.explorationQueue.length;
  }

  /**
   * Generate a coverage report.
   */
  getReport(): CoverageReport {
    const visitedKnownPatterns = new Set<string>();

    for (const pattern of this.visitedPatterns) {
      // Check if this pattern matches any known route
      for (const [, route] of this.knownRoutes) {
        if (this.patternsMatch(pattern, route.pattern)) {
          visitedKnownPatterns.add(`${route.method}:${route.pattern}`);
        }
      }
    }

    const visitedByPattern: Record<string, number> = {};
    for (const [pattern, count] of this.patternVisitCounts) {
      visitedByPattern[pattern] = count;
    }

    const routesBySource: Record<string, number> = {};
    for (const [, route] of this.knownRoutes) {
      routesBySource[route.source] = (routesBySource[route.source] ?? 0) + 1;
    }

    const knownCount = this.knownRoutes.size;
    const visitedCount = visitedKnownPatterns.size;
    const coveragePercent =
      knownCount > 0 ? Math.round((visitedCount / knownCount) * 100) : 0;

    const unvisitedRoutes: RouteEntry[] = [];
    for (const [key, route] of this.knownRoutes) {
      if (!visitedKnownPatterns.has(key)) {
        unvisitedRoutes.push(route);
      }
    }

    const loadTimes = this.visits
      .filter((v) => v.loadTimeMs !== undefined)
      .map((v) => v.loadTimeMs!);
    const avgLoadTimeMs =
      loadTimes.length > 0
        ? Math.round(loadTimes.reduce((a, b) => a + b, 0) / loadTimes.length)
        : 0;

    return {
      knownRoutes: knownCount,
      visitedRoutes: visitedCount,
      coveragePercent,
      unvisitedRoutes,
      visitedByPattern,
      totalPagesVisited: this.visits.length,
      avgLoadTimeMs,
      routesBySource,
    };
  }

  /**
   * Write a Markdown coverage summary to the audit directory.
   */
  writeSummary(auditDir: string): string {
    const report = this.getReport();
    const summaryPath = getCoverageSummaryPath(auditDir);

    const lines: string[] = [
      '# Coverage Summary',
      '',
      '## Route Coverage',
      `- **Known Routes:** ${report.knownRoutes}`,
      `- **Visited Routes:** ${report.visitedRoutes}`,
      `- **Coverage:** ${report.coveragePercent}%`,
      `- **Total Pages Visited:** ${report.totalPagesVisited}`,
      `- **Avg Load Time:** ${report.avgLoadTimeMs}ms`,
      '',
    ];

    if (report.unvisitedRoutes.length > 0) {
      lines.push('## Unvisited Routes');
      for (const route of report.unvisitedRoutes) {
        const auth = route.authRequired ? ' (auth required)' : '';
        lines.push(`- \`${route.method} ${route.pattern}\`${auth}`);
      }
      lines.push('');
    }

    lines.push('## Routes by Source');
    for (const [source, count] of Object.entries(report.routesBySource)) {
      lines.push(`- ${source}: ${count}`);
    }
    lines.push('');

    lines.push('## Visit Distribution');
    for (const [pattern, count] of Object.entries(report.visitedByPattern)) {
      lines.push(`- \`${pattern}\`: ${count} visits`);
    }
    lines.push('');

    const content = lines.join('\n');
    fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
    fs.writeFileSync(summaryPath, content);

    return summaryPath;
  }

  /**
   * Get a snapshot of tracker state for progress reporting.
   */
  getState(): {
    pagesVisited: number;
    queueLength: number;
    uniquePatterns: number;
    coveragePercent: number;
  } {
    const report = this.getReport();
    return {
      pagesVisited: this.visits.length,
      queueLength: this.explorationQueue.length,
      uniquePatterns: this.visitedPatterns.size,
      coveragePercent: report.coveragePercent,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Convert a concrete URL to a route pattern.
   * e.g. /users/123/posts/456 -> /users/{id}/posts/{id}
   */
  private urlToPattern(url: string): string {
    try {
      const parsed = new URL(url);
      return this.normalizePattern(parsed.pathname);
    } catch {
      return this.normalizePattern(url);
    }
  }

  /**
   * Normalize a path pattern: strip trailing slashes, replace numeric/UUID
   * segments with parameter placeholders.
   */
  private normalizePattern(pattern: string): string {
    return pattern
      .replace(/\/+$/, '') // strip trailing slashes
      .split('/')
      .map((segment) => {
        if (!segment) return segment;
        // UUID pattern
        if (
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            segment,
          )
        ) {
          return '{uuid}';
        }
        // Numeric ID
        if (/^\d+$/.test(segment)) {
          return '{id}';
        }
        return segment;
      })
      .join('/') || '/';
  }

  /**
   * Check if two route patterns match (fuzzy comparison).
   */
  private patternsMatch(a: string, b: string): boolean {
    const normalA = this.normalizePattern(a);
    const normalB = this.normalizePattern(b);

    if (normalA === normalB) return true;

    // Try matching with parameter placeholders
    const segmentsA = normalA.split('/');
    const segmentsB = normalB.split('/');

    if (segmentsA.length !== segmentsB.length) return false;

    return segmentsA.every((segA, i) => {
      const segB = segmentsB[i];
      // Both are parameters
      if (segA.startsWith('{') && segB.startsWith('{')) return true;
      // One is a parameter
      if (segA.startsWith('{') || segB.startsWith('{')) return true;
      return segA === segB;
    });
  }
}
