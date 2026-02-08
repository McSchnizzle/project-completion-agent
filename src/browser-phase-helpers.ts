/**
 * Browser Phase Helpers - Per-phase browser data collection strategies.
 *
 * Each browser-claude phase needs specific data from the browser. This module
 * provides collector functions that gather the right data for each phase,
 * then inject it into the prompt context before sending to Claude.
 *
 * V2 enhancements:
 * - Uses CoverageTracker for route coverage
 * - Uses ScreenshotCapture for managed screenshots
 * - Uses RouteCrawler for BFS page discovery
 * - SPA-aware navigation via enhanced PlaywrightBrowser
 *
 * @module browser-phase-helpers
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  PlaywrightBrowser,
  DEFAULT_VIEWPORTS,
  type PageData,
} from './playwright-browser.js';
import type { DispatchContext } from './phase-dispatcher.js';
import {
  getPageDir,
  getFindingDir,
  getScreenshotDir,
} from './artifact-paths.js';
import { ScreenshotCapture } from './screenshot-capture.js';
import { CoverageTracker } from './coverage-tracker.js';
import { RouteCrawler, type CrawlResult } from './browser/route-crawler.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Read route list from code-analysis output or config.
 */
function readRoutes(context: DispatchContext): string[] {
  const codeAnalysisPath = path.join(context.auditDir, 'code-analysis.json');
  if (fs.existsSync(codeAnalysisPath)) {
    try {
      const analysis = JSON.parse(
        fs.readFileSync(codeAnalysisPath, 'utf-8'),
      );
      if (Array.isArray(analysis.routes)) {
        return analysis.routes.map((r: any) =>
          typeof r === 'string' ? r : r.path,
        );
      }
    } catch {
      /* ignore parse errors */
    }
  }
  return ['/'];
}

/**
 * Save a screenshot buffer to the screenshots directory.
 */
function saveScreenshot(
  auditDir: string,
  name: string,
  buffer: Buffer,
): string {
  const dir = getScreenshotDir(auditDir);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${name}.png`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

// ---------------------------------------------------------------------------
// Phase-specific collectors
// ---------------------------------------------------------------------------

/**
 * Exploration: crawl from homepage, follow links, capture page data and screenshots.
 *
 * Uses RouteCrawler for BFS discovery and CoverageTracker for coverage reporting.
 */
export async function collectExplorationData(
  context: DispatchContext,
  browser: PlaywrightBrowser,
): Promise<Record<string, unknown>> {
  const routes = readRoutes(context);
  const baseUrl = (context.url as string).replace(/\/+$/, '');
  const maxPages = (context.config?.maxPages as number) || 50;

  const screenshotCapture = new ScreenshotCapture(context.auditDir);
  const coverageTracker = new CoverageTracker();
  coverageTracker.loadFromCodeAnalysis(context.auditDir);

  // Seed the queue with known routes
  const seedUrls = routes.map((route) =>
    route.startsWith('http') ? route : `${baseUrl}${route}`,
  );

  const crawler = new RouteCrawler(coverageTracker, {
    maxPages,
    maxRoutePatterns: (context.config?.maxRoutes as number) || 50,
    maxPerPattern: (context.config?.maxPerPattern as number) || 5,
    rateLimitMs: (context.config?.rateLimitMs as number) || 1000,
    sameOriginOnly: true,
  });

  const pages: PageData[] = [];
  let pageIndex = 0;

  // Define the visit callback
  crawler.onVisitPage = async (
    url: string,
    depth: number,
  ): Promise<CrawlResult> => {
    const startTime = Date.now();
    try {
      const data = await browser.visitPage(url);
      pages.push(data);

      // Save screenshot
      if (data.screenshot) {
        await screenshotCapture.capture(
          data.screenshot,
          url,
          { width: 1280, height: 720 },
          { purpose: 'initial_load', suffix: `page-${pageIndex}` },
        );
      }

      // Save page JSON (without screenshot buffer)
      const pageDir = getPageDir(context.auditDir);
      fs.mkdirSync(pageDir, { recursive: true });
      const { screenshot: _ss, ...pageWithoutScreenshot } = data;
      fs.writeFileSync(
        path.join(pageDir, `page-${pageIndex}.json`),
        JSON.stringify(pageWithoutScreenshot, null, 2),
      );

      pageIndex++;

      return {
        url,
        depth,
        discoveredLinks: data.links,
        statusCode: data.statusCode,
        loadTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        url,
        depth,
        discoveredLinks: [],
        loadTimeMs: Date.now() - startTime,
        error:
          error instanceof Error ? error.message : String(error),
      };
    }
  };

  // Add seed URLs directly to tracker queue
  coverageTracker.addToQueue(seedUrls);

  // Run the crawl
  const crawlSummary = await crawler.crawl(baseUrl);

  // Write coverage summary
  coverageTracker.writeSummary(context.auditDir);

  // Build summary for prompt context
  const coverageReport = coverageTracker.getReport();

  return {
    pagesVisited: pages.length,
    routes: routes.slice(0, maxPages),
    crawlSummary: {
      ...crawlSummary,
      coveragePercent: coverageReport.coveragePercent,
      unvisitedRoutes: coverageReport.unvisitedRoutes.map((r) => r.pattern),
    },
    pageSummaries: pages.map((p) => ({
      url: p.url,
      title: p.title,
      linkCount: p.links.length,
      formCount: p.forms.length,
      statusCode: p.statusCode,
      loadTimeMs: p.loadTimeMs,
      consoleErrorCount: p.consoleMessages.filter(
        (m) => m.type === 'error',
      ).length,
      networkErrorCount: p.networkErrors.length,
      isSPA: p.isSPA,
    })),
    screenshotCount: screenshotCapture.getCount(),
    storageUsed: screenshotCapture.getStorageUsed(),
  };
}

/**
 * Form Testing: discover forms on each page and collect their structure.
 */
export async function collectFormTestingData(
  context: DispatchContext,
  browser: PlaywrightBrowser,
): Promise<Record<string, unknown>> {
  const pageDir = getPageDir(context.auditDir);
  const forms: Array<{ url: string; forms: any[] }> = [];

  if (fs.existsSync(pageDir)) {
    const pageFiles = fs
      .readdirSync(pageDir)
      .filter((f) => f.endsWith('.json'));

    for (const file of pageFiles) {
      try {
        const page = JSON.parse(
          fs.readFileSync(path.join(pageDir, file), 'utf-8'),
        );
        if (page.forms && page.forms.length > 0) {
          forms.push({ url: page.url, forms: page.forms });
        }
      } catch {
        /* skip bad files */
      }
    }
  }

  return {
    discoveredForms: forms,
    formCount: forms.reduce((n, f) => n + f.forms.length, 0),
  };
}

/**
 * Responsive Testing: test each page at multiple viewports.
 *
 * Uses enhanced testViewports with overflow detection.
 */
export async function collectResponsiveData(
  context: DispatchContext,
  browser: PlaywrightBrowser,
): Promise<Record<string, unknown>> {
  const baseUrl = (context.url as string).replace(/\/+$/, '');
  const routes = readRoutes(context).slice(0, 5); // Test top 5 routes
  const screenshotCapture = new ScreenshotCapture(context.auditDir);
  const results: Record<string, unknown>[] = [];

  for (const route of routes) {
    const url = route.startsWith('http') ? route : `${baseUrl}${route}`;
    try {
      const viewportResults = await browser.testViewports(
        url,
        DEFAULT_VIEWPORTS,
      );
      const summaries: Record<string, unknown> = {};

      for (const [vpName, data] of viewportResults) {
        if (data.screenshot) {
          const safeName = route.replace(/[^a-zA-Z0-9]/g, '_');
          await screenshotCapture.capture(
            data.screenshot,
            url,
            {
              width:
                DEFAULT_VIEWPORTS.find((v) => v.name === vpName)?.width ??
                1280,
              height:
                DEFAULT_VIEWPORTS.find((v) => v.name === vpName)
                  ?.height ?? 720,
            },
            { purpose: 'responsive_test', suffix: `${safeName}-${vpName}` },
          );
        }
        summaries[vpName] = {
          title: data.title,
          textLength: data.text.length,
          linkCount: data.links.length,
          overflow: data.overflow,
        };
      }

      results.push({ url, viewports: summaries });
    } catch (error) {
      console.warn(`[Responsive] Failed for ${url}: ${error}`);
    }
  }

  return { responsiveResults: results };
}

/**
 * Finding Quality: revisit pages with findings for verification screenshots.
 */
export async function collectFindingQualityData(
  context: DispatchContext,
  browser: PlaywrightBrowser,
): Promise<Record<string, unknown>> {
  const findingDir = getFindingDir(context.auditDir);
  const findings: any[] = [];

  if (fs.existsSync(findingDir)) {
    const files = fs
      .readdirSync(findingDir)
      .filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        findings.push(
          JSON.parse(
            fs.readFileSync(path.join(findingDir, file), 'utf-8'),
          ),
        );
      } catch {
        /* skip bad files */
      }
    }
  }

  return { findings, findingCount: findings.length };
}

/**
 * Load existing finding JSON files from the findings directory.
 */
function loadExistingFindings(findingDir: string): any[] {
  if (!fs.existsSync(findingDir)) return [];

  const files = fs.readdirSync(findingDir).filter((f) => f.endsWith('.json'));
  const findings: any[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(findingDir, file), 'utf-8');
      findings.push(JSON.parse(content));
    } catch {
      // Skip malformed files
    }
  }

  return findings;
}

/**
 * Check whether a finding URL is valid and visitable.
 */
function isVisitableUrl(url: unknown): url is string {
  return (
    typeof url === 'string' &&
    url !== 'N/A' &&
    url !== 'undefined' &&
    url !== '' &&
    url.startsWith('http')
  );
}

/**
 * Verification: re-check previously found issues with fresh browser visits.
 *
 * Separates findings into verifiable (valid URL) and unverifiable (bad URL),
 * then visits pages for verifiable findings. Returns structured data so
 * the dispatcher can update existing findings rather than creating new ones.
 */
export async function collectVerificationData(
  context: DispatchContext,
  browser: PlaywrightBrowser,
): Promise<Record<string, unknown>> {
  const findingDir = getFindingDir(context.auditDir);
  const findings = loadExistingFindings(findingDir);

  // Partition findings by URL validity
  const verifiableFindings: any[] = [];
  const unverifiableFindings: any[] = [];

  for (const finding of findings) {
    const url = finding.url || finding.evidence?.url || finding.location?.url;
    if (isVisitableUrl(url)) {
      verifiableFindings.push(finding);
    } else {
      unverifiableFindings.push({
        ...finding,
        verificationStatus: 'unverifiable',
        verificationNote: `Cannot verify: invalid URL "${url ?? 'missing'}"`,
      });
    }
  }

  // Visit pages for verifiable findings and collect page data
  const verificationData: Array<{
    findingId: string;
    url: string;
    pageData: Record<string, unknown>;
  }> = [];

  for (const finding of verifiableFindings) {
    const url = finding.url || finding.evidence?.url || finding.location?.url;
    try {
      const pageData = await browser.visitPage(url);
      verificationData.push({
        findingId: finding.id,
        url,
        pageData: {
          title: pageData.title,
          statusCode: pageData.statusCode,
          loadTimeMs: pageData.loadTimeMs,
          consoleErrors: pageData.consoleMessages.filter(
            (m: any) => m.type === 'error',
          ),
          networkErrors: pageData.networkErrors,
          textSnippet: pageData.text.substring(0, 2000),
        },
      });
    } catch (error) {
      unverifiableFindings.push({
        ...finding,
        verificationStatus: 'unverifiable',
        verificationNote: `Verification failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      // Remove from verifiable list since it failed
      const idx = verifiableFindings.indexOf(finding);
      if (idx !== -1) verifiableFindings.splice(idx, 1);
    }
  }

  return {
    verifiableFindings,
    unverifiableFindings,
    verificationData,
    existingFindings: findings,
  };
}
