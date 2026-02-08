/**
 * Feature-to-Page Mapper - Maps PRD features to discovered pages.
 *
 * Uses heuristic matching (URL paths, keywords, acceptance criteria mentions)
 * to connect features from the parsed PRD to pages found during browser
 * exploration. Produces a coverage report that replaces the "Not Checked"
 * entries in the final audit report.
 *
 * @module feature-mapper
 */

import fs from 'node:fs';
import path from 'node:path';
import type { PrdFeature } from './phases/prd-parsing.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal page data needed for mapping (compatible with PageInventory). */
export interface MappablePage {
  url: string;
  title: string;
  text?: string;
  links?: string[];
}

export interface FeatureMapping {
  featureId: string;
  featureName: string;
  priority: string;
  acceptanceCriteria: string[];
  mappedPages: Array<{
    url: string;
    confidence: number; // 0-1
    matchReason: string;
  }>;
  status: 'mapped' | 'unmapped' | 'partial';
}

export interface FeatureCoverage {
  featureId: string;
  featureName: string;
  priority: string;
  status: 'pass' | 'fail' | 'partial' | 'not_testable' | 'not_checked';
  checkedCriteria: Array<{
    criterion: string;
    status: 'pass' | 'fail' | 'not_testable';
    evidence: string;
    pageUrl?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Keyword extraction
// ---------------------------------------------------------------------------

/** Stop words to exclude from keyword matching. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'must', 'need', 'not', 'no',
  'all', 'each', 'every', 'any', 'some', 'this', 'that', 'these', 'those',
  'it', 'its', 'as', 'if', 'when', 'then', 'than', 'so', 'up', 'out',
  'about', 'into', 'over', 'after', 'before', 'between', 'under', 'above',
  'user', 'users', 'able', 'also', 'feature', 'page', 'view',
]);

/**
 * Extract meaningful keywords from text for matching.
 * Returns lowercase, de-duped keywords with stop words removed.
 */
export function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  return [...new Set(words)];
}

/**
 * Extract URL route hints from text (e.g., "/settings", "/dashboard").
 */
export function extractRouteHints(text: string): string[] {
  const routes: string[] = [];
  // Match /path patterns
  const routeRegex = /(?:^|\s|["'`(])(\/[a-z][a-z0-9-/]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = routeRegex.exec(text)) !== null) {
    const route = match[1].toLowerCase();
    // Skip common false positives
    if (!route.startsWith('/n') || route.length > 3) {
      routes.push(route);
    }
  }
  return [...new Set(routes)];
}

// ---------------------------------------------------------------------------
// Matching heuristics
// ---------------------------------------------------------------------------

/**
 * Score how well a page matches a feature based on URL path.
 * Returns 0-1 confidence.
 */
function scoreUrlMatch(featureKeywords: string[], routeHints: string[], pageUrl: string): { score: number; reason: string } {
  const urlPath = new URL(pageUrl).pathname.toLowerCase();
  const urlSegments = urlPath.split('/').filter(Boolean);

  // Direct route hint match (highest confidence)
  for (const hint of routeHints) {
    if (urlPath === hint || urlPath.startsWith(hint + '/') || urlPath.startsWith(hint)) {
      return { score: 0.9, reason: `URL path matches route hint "${hint}"` };
    }
  }

  // Feature keyword in URL segments
  let keywordMatches = 0;
  const matchedKeywords: string[] = [];
  for (const keyword of featureKeywords) {
    for (const segment of urlSegments) {
      if (segment.includes(keyword) || keyword.includes(segment)) {
        keywordMatches++;
        matchedKeywords.push(keyword);
        break;
      }
    }
  }

  if (keywordMatches > 0) {
    const score = Math.min(0.8, 0.4 + keywordMatches * 0.2);
    return { score, reason: `URL contains keywords: ${matchedKeywords.join(', ')}` };
  }

  return { score: 0, reason: '' };
}

/**
 * Score how well a page matches a feature based on title/text content.
 * Returns 0-1 confidence.
 */
function scoreContentMatch(featureKeywords: string[], page: MappablePage): { score: number; reason: string } {
  const titleLower = (page.title || '').toLowerCase();
  const textLower = (page.text || '').toLowerCase().slice(0, 5000); // Limit text scanning

  let titleMatches = 0;
  let textMatches = 0;
  const matchedInTitle: string[] = [];
  const matchedInText: string[] = [];

  for (const keyword of featureKeywords) {
    if (titleLower.includes(keyword)) {
      titleMatches++;
      matchedInTitle.push(keyword);
    } else if (textLower.includes(keyword)) {
      textMatches++;
      matchedInText.push(keyword);
    }
  }

  if (titleMatches > 0) {
    const score = Math.min(0.7, 0.3 + titleMatches * 0.2);
    const reason = `Page title contains: ${matchedInTitle.join(', ')}`;
    return { score, reason };
  }

  if (textMatches >= 2) {
    const score = Math.min(0.5, 0.2 + textMatches * 0.1);
    const reason = `Page text contains: ${matchedInText.join(', ')}`;
    return { score, reason };
  }

  return { score: 0, reason: '' };
}

// ---------------------------------------------------------------------------
// Main mapping function
// ---------------------------------------------------------------------------

/**
 * Map PRD features to discovered pages using heuristic matching.
 *
 * For each feature, scores every page and selects the best matches
 * (confidence >= 0.2). Features with at least one mapped page are
 * marked 'mapped'; those with weak matches are 'partial'; the rest
 * are 'unmapped'.
 */
export function mapFeaturesToPages(
  features: PrdFeature[],
  pages: MappablePage[],
): FeatureMapping[] {
  return features.map((feature) => {
    const keywords = extractKeywords(`${feature.name} ${feature.description}`);
    const routeHints = extractRouteHints(
      [feature.description, ...feature.acceptance_criteria].join('\n'),
    );

    const scoredPages: Array<{ url: string; confidence: number; matchReason: string }> = [];

    for (const page of pages) {
      const urlResult = scoreUrlMatch(keywords, routeHints, page.url);
      const contentResult = scoreContentMatch(keywords, page);

      // Take the best score from either heuristic
      const best = urlResult.score >= contentResult.score ? urlResult : contentResult;

      // Boost if both heuristics agree
      let finalScore = best.score;
      let reason = best.reason;
      if (urlResult.score > 0 && contentResult.score > 0) {
        finalScore = Math.min(1, best.score + 0.1);
        reason = `${urlResult.reason}; ${contentResult.reason}`;
      }

      if (finalScore >= 0.2) {
        scoredPages.push({
          url: page.url,
          confidence: Math.round(finalScore * 100) / 100,
          matchReason: reason,
        });
      }
    }

    // Sort by confidence descending
    scoredPages.sort((a, b) => b.confidence - a.confidence);

    let status: FeatureMapping['status'];
    if (scoredPages.length > 0 && scoredPages[0].confidence >= 0.5) {
      status = 'mapped';
    } else if (scoredPages.length > 0) {
      status = 'partial';
    } else {
      status = 'unmapped';
    }

    return {
      featureId: feature.id,
      featureName: feature.name,
      priority: feature.priority,
      acceptanceCriteria: feature.acceptance_criteria,
      mappedPages: scoredPages,
      status,
    };
  });
}

// ---------------------------------------------------------------------------
// Coverage persistence
// ---------------------------------------------------------------------------

const COVERAGE_FILENAME = 'feature-coverage.json';

function getCoveragePath(auditDir: string): string {
  return path.join(auditDir, COVERAGE_FILENAME);
}

/**
 * Save feature coverage results to disk.
 */
export function saveFeatureCoverage(
  auditDir: string,
  coverage: FeatureCoverage[],
): void {
  const outPath = getCoveragePath(auditDir);
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = outPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(coverage, null, 2), 'utf-8');
  fs.renameSync(tmpPath, outPath);
}

/**
 * Load previously saved feature coverage from disk.
 */
export function loadFeatureCoverage(
  auditDir: string,
): FeatureCoverage[] | null {
  const coveragePath = getCoveragePath(auditDir);
  if (!fs.existsSync(coveragePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(coveragePath, 'utf-8')) as FeatureCoverage[];
  } catch {
    return null;
  }
}

/**
 * Save feature mappings to disk.
 */
export function saveFeatureMappings(
  auditDir: string,
  mappings: FeatureMapping[],
): void {
  const outPath = path.join(auditDir, 'feature-mappings.json');
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = outPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(mappings, null, 2), 'utf-8');
  fs.renameSync(tmpPath, outPath);
}

/**
 * Load previously saved feature mappings from disk.
 */
export function loadFeatureMappings(
  auditDir: string,
): FeatureMapping[] | null {
  const mappingsPath = path.join(auditDir, 'feature-mappings.json');
  if (!fs.existsSync(mappingsPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(mappingsPath, 'utf-8')) as FeatureMapping[];
  } catch {
    return null;
  }
}
