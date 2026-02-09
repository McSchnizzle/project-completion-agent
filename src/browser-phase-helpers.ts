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
import type { BrowserBackend } from './browser-backend.js';
import type { DispatchContext } from './phase-dispatcher.js';
import {
  getPageDir,
  getFindingDir,
  getScreenshotDir,
} from './artifact-paths.js';
import { ScreenshotCapture } from './screenshot-capture.js';
import { CoverageTracker } from './coverage-tracker.js';
import { RouteCrawler, type CrawlResult } from './browser/route-crawler.js';
import { FindingGenerator } from './finding-generator.js';
import { PageDiagnostics } from './page-diagnostics.js';
import { InteractiveTester } from './interactive-tester.js';
import { ResponsiveTester } from './responsive-tester.js';
import { ApiSmokeTester } from './api-smoke-tester.js';
import { EvidenceCapture } from './evidence-capture.js';

/**
 * Browser type accepted by phase helpers.
 * Supports both legacy PlaywrightBrowser and the new BrowserBackend interface.
 */
type BrowserLike = PlaywrightBrowser | BrowserBackend;

/**
 * Type guard to check if a browser instance implements the full BrowserBackend interface.
 * V4 modules (InteractiveTester, ResponsiveTester, etc.) require BrowserBackend.
 */
function isBrowserBackend(browser: BrowserLike): browser is BrowserBackend {
  return (
    'clickElement' in browser &&
    'fillAndSubmitForm' in browser &&
    'captureScreenshot' in browser &&
    'clearBuffers' in browser &&
    typeof (browser as BrowserBackend).clickElement === 'function'
  );
}

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
  browser: BrowserLike,
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
    // V4: Clear console/network buffers before each visit
    if (isBrowserBackend(browser)) {
      browser.clearBuffers();
    }
    try {
      const data = await browser.visitPage(url);

      // V4: Attach buffered network/console data from BrowserBackend
      // so PageDiagnostics can detect slow requests and JS errors
      if (isBrowserBackend(browser)) {
        const networkRequests = browser.getNetworkRequests();
        if (networkRequests.length > 0) {
          (data as any).networkRequests = networkRequests;
        }
      }

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

  // V4: Generate findings autonomously from exploration data
  const findingGenerator = new FindingGenerator(context.auditDir);
  const explorationFindings = findingGenerator.generateFromExploration(pages);

  // V4: Run diagnostics on collected pages and save alongside page inventory
  const diagnostics = new PageDiagnostics();
  const diagnosticReports = pages.map((p, i) => {
    const report = diagnostics.analyzePage(p as any);
    // Save diagnostic data alongside page JSON
    try {
      const pageDir = getPageDir(context.auditDir);
      fs.writeFileSync(
        path.join(pageDir, `page-${i}-diagnostics.json`),
        JSON.stringify(report, null, 2),
      );
    } catch { /* skip write errors */ }
    return report;
  });
  const diagnosticFindings = findingGenerator.generateFromDiagnostics(diagnosticReports);

  // Collect all auto-generated findings
  const allAutoFindings = [...explorationFindings, ...diagnosticFindings];

  // V4: Run interactive testing on discovered pages (requires BrowserBackend)
  let interactionFindingCount = 0;
  if (isBrowserBackend(browser)) {
    try {
      const interactiveTester = new InteractiveTester(browser, {
        maxElementsPerPage: 10,
        safeMode: true,
        testNavigationLinks: false,
      });

      // Test top pages (limit to avoid excessive testing)
      const pagesToTest = pages.slice(0, 10);
      for (const page of pagesToTest) {
        try {
          const interactionResult = await interactiveTester.testPage(page.url);
          // Convert to finding-generator compatible format
          const fgResults = [{
            url: interactionResult.url,
            elementsTested: interactionResult.elementsTested.map((t) => ({
              url: t.url,
              element: { text: t.element.text, elementType: t.element.elementType },
              hasError: t.hasError,
              description: t.description,
              consoleErrors: t.consoleErrors.map((e) => ({ text: e.text })),
              failedRequests: t.failedRequests.map((r) => ({
                method: r.method,
                url: r.url,
                status: r.status,
              })),
            })),
          }];
          const interactionFindings = findingGenerator.generateFromInteractions(fgResults);
          allAutoFindings.push(...interactionFindings);
          interactionFindingCount += interactionFindings.length;
        } catch (err) {
          console.warn(`[Exploration] Interactive testing failed for ${page.url}: ${err}`);
        }
      }
    } catch (err) {
      console.warn(`[Exploration] Interactive tester initialization failed: ${err}`);
    }
  }

  // Write auto-generated findings to disk
  if (allAutoFindings.length > 0) {
    const findingDir = getFindingDir(context.auditDir);
    fs.mkdirSync(findingDir, { recursive: true });
    for (const finding of allAutoFindings) {
      fs.writeFileSync(
        path.join(findingDir, `${finding.id}.json`),
        JSON.stringify(finding, null, 2),
      );
    }
  }

  // V4: Attach evidence screenshots to findings after they're written
  const evidenceCount = await runEvidenceCaptureForFindings(context.auditDir, browser);
  if (evidenceCount > 0) {
    console.log(`[Exploration] Attached evidence to ${evidenceCount} findings`);
  }

  // V4: Build diagnostic summary for prompt context
  const diagnosticSummary = diagnosticReports.map((r) => ({
    url: r.url,
    diagnoseCount: r.diagnoses.length,
    diagnoses: r.diagnoses.map((d) => ({
      category: d.category,
      severity: d.severity,
      title: d.title,
    })),
    stats: r.stats,
  }));

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
    autoFindingsCount: allAutoFindings.length,
    interactionFindingCount,
    diagnosticSummary,
  };
}

/**
 * Form Testing: discover forms on each page and collect their structure.
 */
export async function collectFormTestingData(
  context: DispatchContext,
  browser: BrowserLike,
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

  // V4: Run API smoke testing (requires BrowserBackend)
  let apiSmokeResults: Record<string, unknown> = {};
  if (isBrowserBackend(browser)) {
    try {
      const baseUrl = (context.url as string).replace(/\/+$/, '');
      const smokeTester = new ApiSmokeTester(browser, baseUrl);

      // Discover endpoints from code analysis
      const codeAnalysisPath = path.join(context.auditDir, 'code-analysis.json');
      let codeAnalysis: Record<string, unknown> | undefined;
      if (fs.existsSync(codeAnalysisPath)) {
        try {
          codeAnalysis = JSON.parse(fs.readFileSync(codeAnalysisPath, 'utf-8'));
        } catch { /* ignore */ }
      }

      const endpoints = smokeTester.discoverEndpoints(codeAnalysis);
      if (endpoints.length > 0) {
        const smokeReport = await smokeTester.testEndpoints(endpoints);

        // Generate findings from smoke results
        if (smokeReport.findings.length > 0) {
          const findingGenerator = new FindingGenerator(context.auditDir);
          // Convert ApiSmokeTester findings to finding-generator compatible format
          const fgReport = {
            baseUrl,
            testedAt: new Date().toISOString(),
            endpoints: smokeReport.results.map((r) => ({
              url: r.endpoint.path.startsWith('http')
                ? r.endpoint.path
                : `${baseUrl}${r.endpoint.path}`,
              method: r.endpoint.method,
              status: r.status,
              durationMs: r.durationMs,
            })),
            findings: smokeReport.findings.map((f) => ({
              title: f.title,
              severity: f.severity,
              url: f.url,
              description: f.description,
              evidence: {
                status: f.evidence.status,
                statusText: undefined,
                responseBody: f.evidence.responsePreview,
              },
            })),
          };
          const smokeFindings = findingGenerator.generateFromApiSmoke(fgReport);

          // Write findings to disk
          const findingDir = getFindingDir(context.auditDir);
          fs.mkdirSync(findingDir, { recursive: true });
          for (const finding of smokeFindings) {
            fs.writeFileSync(
              path.join(findingDir, `${finding.id}.json`),
              JSON.stringify(finding, null, 2),
            );
          }

          apiSmokeResults = {
            endpointsDiscovered: endpoints.length,
            endpointsTested: smokeReport.results.length,
            smokeFindingsCount: smokeFindings.length,
            stats: smokeReport.stats,
          };
        }
      }
    } catch (err) {
      console.warn(`[FormTesting] API smoke testing failed: ${err}`);
    }
  }

  // V4: Attach evidence screenshots after form/API findings
  const formEvidenceCount = await runEvidenceCaptureForFindings(context.auditDir, browser);
  if (formEvidenceCount > 0) {
    console.log(`[FormTesting] Attached evidence to ${formEvidenceCount} findings`);
  }

  return {
    discoveredForms: forms,
    formCount: forms.reduce((n, f) => n + f.forms.length, 0),
    ...apiSmokeResults,
  };
}

/**
 * Responsive Testing: test each page at multiple viewports.
 *
 * Uses enhanced testViewports with overflow detection.
 */
export async function collectResponsiveData(
  context: DispatchContext,
  browser: BrowserLike,
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

  // V4: Generate responsive findings (requires BrowserBackend)
  let responsiveFindingCount = 0;
  if (isBrowserBackend(browser)) {
    try {
      const responsiveTester = new ResponsiveTester(browser);
      const testUrls = routes
        .slice(0, 5)
        .map((r) => (r.startsWith('http') ? r : `${baseUrl}${r}`));
      const responsiveResults = await responsiveTester.testPages(testUrls);

      // Convert to finding-generator compatible format and write findings
      const findingGenerator = new FindingGenerator(context.auditDir);
      const fgResults = responsiveResults.map((r) => ({
        url: r.url,
        findings: r.findings.map((f) => ({
          title: f.title,
          severity: f.severity as 'P0' | 'P1' | 'P2' | 'P3' | 'P4',
          url: f.url,
          viewport: f.viewport,
          description: f.description,
        })),
      }));
      const responsiveFindings = findingGenerator.generateFromResponsive(fgResults);
      responsiveFindingCount = responsiveFindings.length;

      if (responsiveFindings.length > 0) {
        const findingDir = getFindingDir(context.auditDir);
        fs.mkdirSync(findingDir, { recursive: true });
        for (const finding of responsiveFindings) {
          fs.writeFileSync(
            path.join(findingDir, `${finding.id}.json`),
            JSON.stringify(finding, null, 2),
          );
        }
      }

      // Save viewport screenshots for findings
      for (let i = 0; i < responsiveResults.length; i++) {
        const r = responsiveResults[i];
        responsiveTester.saveViewportScreenshots(
          context.auditDir, r.findings, r.viewportResults, i,
        );
      }
    } catch (err) {
      console.warn(`[Responsive] Responsive tester finding generation failed: ${err}`);
    }
  }

  // V4: Attach evidence screenshots after responsive findings
  const responsiveEvidenceCount = await runEvidenceCaptureForFindings(context.auditDir, browser);
  if (responsiveEvidenceCount > 0) {
    console.log(`[Responsive] Attached evidence to ${responsiveEvidenceCount} findings`);
  }

  return { responsiveResults: results, responsiveFindingCount };
}

/**
 * Finding Quality: revisit pages with findings for verification screenshots.
 */
export async function collectFindingQualityData(
  context: DispatchContext,
  browser: BrowserLike,
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

  // V4: Attach screenshot evidence to findings (requires BrowserBackend)
  let evidenceCount = 0;
  if (isBrowserBackend(browser) && findings.length > 0) {
    try {
      const screenshotCapture = new ScreenshotCapture(context.auditDir);
      const evidenceCapture = new EvidenceCapture(browser, screenshotCapture, {
        screenshotDir: getScreenshotDir(context.auditDir),
      });

      // Register existing screenshots for reuse
      const screenshotDir = getScreenshotDir(context.auditDir);
      if (fs.existsSync(screenshotDir)) {
        const screenshotFiles = fs.readdirSync(screenshotDir).filter((f) => f.endsWith('.png'));
        // Try to match screenshots to finding URLs by reading manifest
        const manifestPath = path.join(screenshotDir, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            if (Array.isArray(manifest.screenshots)) {
              for (const entry of manifest.screenshots) {
                if (entry.url && entry.path) {
                  evidenceCapture.registerPageScreenshot(entry.url, entry.path);
                }
              }
            }
          } catch { /* ignore manifest parse errors */ }
        }
      }

      const evidenceResults = await evidenceCapture.attachEvidence(findings);
      evidenceCount = evidenceResults.filter((e) => e.screenshotPath && !e.screenshotPath.endsWith('.txt')).length;

      // Re-write findings with updated screenshot evidence
      for (const finding of findings) {
        if (finding.evidence?.screenshots?.length > 0) {
          try {
            fs.writeFileSync(
              path.join(findingDir, `${finding.id}.json`),
              JSON.stringify(finding, null, 2),
            );
          } catch { /* skip write errors */ }
        }
      }
    } catch (err) {
      console.warn(`[FindingQuality] Evidence capture failed: ${err}`);
    }
  }

  return { findings, findingCount: findings.length, evidenceCount };
}

/**
 * Run evidence capture for findings produced during a browser phase.
 * Reads finding JSON files from disk, attaches screenshot evidence,
 * and re-writes the findings with updated evidence paths.
 *
 * Called after findings are written in collectExplorationData,
 * collectFormTestingData, and collectResponsiveData.
 */
async function runEvidenceCaptureForFindings(
  auditDir: string,
  browser: BrowserLike,
): Promise<number> {
  if (!isBrowserBackend(browser)) return 0;

  const findingDir = getFindingDir(auditDir);
  if (!fs.existsSync(findingDir)) return 0;

  const files = fs.readdirSync(findingDir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) return 0;

  const findings: any[] = [];
  for (const file of files) {
    try {
      findings.push(
        JSON.parse(fs.readFileSync(path.join(findingDir, file), 'utf-8')),
      );
    } catch {
      /* skip bad files */
    }
  }

  // Only process findings without screenshot evidence
  const needsEvidence = findings.filter(
    (f) =>
      !f.evidence?.screenshots ||
      f.evidence.screenshots.length === 0,
  );

  if (needsEvidence.length === 0) return 0;

  try {
    const screenshotCapture = new ScreenshotCapture(auditDir);
    const evidenceCapture = new EvidenceCapture(browser, screenshotCapture, {
      screenshotDir: getScreenshotDir(auditDir),
    });

    const evidenceResults = await evidenceCapture.attachEvidence(needsEvidence);
    let count = 0;

    for (const finding of needsEvidence) {
      if (finding.evidence?.screenshots?.length > 0) {
        try {
          fs.writeFileSync(
            path.join(findingDir, `${finding.id}.json`),
            JSON.stringify(finding, null, 2),
          );
          count++;
        } catch {
          /* skip write errors */
        }
      }
    }

    return count;
  } catch (err) {
    console.warn(`[EvidenceCapture] Post-phase evidence capture failed: ${err}`);
    return 0;
  }
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
  browser: BrowserLike,
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
