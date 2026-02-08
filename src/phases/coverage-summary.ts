/**
 * Coverage Summary - Calculates and reports route/page coverage.
 *
 * Compares pages discovered during exploration against routes from
 * code analysis to produce a coverage percentage and markdown summary.
 *
 * @module phases/coverage-summary
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  getPageDir,
  getCodeAnalysisPath,
  getCoverageSummaryPath,
} from '../artifact-paths';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoverageResult {
  totalRoutes: number;
  visitedRoutes: number;
  coveragePercent: number;
  visitedUrls: string[];
  missedRoutes: string[];
  extraPages: string[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Generate a coverage summary comparing explored pages against known routes.
 *
 * @param auditDir - The audit output directory.
 * @returns Coverage metrics and writes coverage-summary.md to disk.
 */
export function generateCoverageSummary(auditDir: string): CoverageResult {
  // Load known routes from code analysis
  const knownRoutes = loadKnownRoutes(auditDir);

  // Load visited pages
  const visitedPages = loadVisitedPages(auditDir);

  // Normalize paths for comparison
  const normalizedKnown = new Set(knownRoutes.map(normalizePath));
  const normalizedVisited = new Set(visitedPages.map(normalizePath));

  // Calculate coverage
  const visitedRoutes = [...normalizedKnown].filter(r => normalizedVisited.has(r));
  const missedRoutes = [...normalizedKnown].filter(r => !normalizedVisited.has(r));
  const extraPages = [...normalizedVisited].filter(r => !normalizedKnown.has(r));

  const totalRoutes = normalizedKnown.size || 1; // avoid division by zero
  const coveragePercent = Math.round((visitedRoutes.length / totalRoutes) * 100);

  const result: CoverageResult = {
    totalRoutes: normalizedKnown.size,
    visitedRoutes: visitedRoutes.length,
    coveragePercent,
    visitedUrls: visitedPages,
    missedRoutes,
    extraPages,
  };

  // Write markdown summary
  const md = formatCoverageMarkdown(result);
  fs.writeFileSync(getCoverageSummaryPath(auditDir), md, 'utf-8');

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadKnownRoutes(auditDir: string): string[] {
  const caPath = getCodeAnalysisPath(auditDir);
  if (!fs.existsSync(caPath)) return [];

  try {
    const data = JSON.parse(fs.readFileSync(caPath, 'utf-8'));
    if (Array.isArray(data.routes)) {
      return data.routes.map((r: { path?: string }) => r.path ?? '').filter(Boolean);
    }
    return [];
  } catch {
    return [];
  }
}

function loadVisitedPages(auditDir: string): string[] {
  const pageDir = getPageDir(auditDir);
  if (!fs.existsSync(pageDir)) return [];

  const urls: string[] = [];
  const files = fs.readdirSync(pageDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(pageDir, file), 'utf-8'));
      if (data.url) {
        try {
          const parsed = new URL(data.url);
          urls.push(parsed.pathname);
        } catch {
          urls.push(data.url);
        }
      } else if (data.route_pattern) {
        urls.push(data.route_pattern);
      }
    } catch {
      // Skip malformed page files
    }
  }

  return urls;
}

function normalizePath(p: string): string {
  return p.replace(/\/+$/, '').toLowerCase() || '/';
}

function formatCoverageMarkdown(result: CoverageResult): string {
  const lines: string[] = [
    '# Route Coverage Summary',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Known routes | ${result.totalRoutes} |`,
    `| Visited | ${result.visitedRoutes} |`,
    `| Coverage | ${result.coveragePercent}% |`,
    `| Missed | ${result.missedRoutes.length} |`,
    `| Extra (discovered) | ${result.extraPages.length} |`,
    '',
  ];

  if (result.missedRoutes.length > 0) {
    lines.push('## Missed Routes', '');
    for (const route of result.missedRoutes) {
      lines.push(`- \`${route}\``);
    }
    lines.push('');
  }

  if (result.extraPages.length > 0) {
    lines.push('## Extra Pages Discovered', '');
    for (const page of result.extraPages) {
      lines.push(`- \`${page}\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}
