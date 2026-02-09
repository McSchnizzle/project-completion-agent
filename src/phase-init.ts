/**
 * Phase Initialization - Wires phase implementations to the dispatcher.
 *
 * This module bridges the gap between the generic dispatcher interface
 * (PureTsHandler / BrowserCollector) and the specific function signatures
 * of each phase implementation. It must be called once before the pipeline
 * starts executing phases.
 *
 * @module phase-init
 */

import {
  registerPureTsHandler,
  registerBrowserCollector,
  type DispatchContext,
} from './phase-dispatcher.js';
import { runPreflight } from './phases/preflight.js';
import { parsePrd } from './phases/prd-parsing.js';
import { runCodeAnalysis } from './phases/code-analysis.js';
import { initProgress } from './phases/progress-init.js';
import { assessSafety } from './phases/safety.js';
import { generateReport } from './phases/report-generation.js';
import { createGitHubIssues } from './phases/github-issues.js';
import { runPolish } from './phases/polish.js';
import type { PlaywrightBrowser } from './playwright-browser.js';
import type { BrowserBackend } from './browser-backend.js';
import {
  collectExplorationData,
  collectFormTestingData,
  collectResponsiveData,
  collectFindingQualityData,
  collectVerificationData,
} from './browser-phase-helpers.js';
import type { AuditConfig } from './config.js';
import { runQualityPipelineAndSave } from './finding-quality-pipeline.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getProgressPath, getPageDir, getFindingDir } from './artifact-paths.js';

/**
 * Register all phase handlers with the dispatcher.
 *
 * Must be called once before `dispatchPhase()` is invoked. Calling it
 * multiple times is safe (later registrations overwrite earlier ones).
 *
 * @param browser - Optional browser instance for browser phases.
 *                  Accepts PlaywrightBrowser or any BrowserBackend implementation.
 *                  If omitted, browser collectors are not registered and
 *                  browser-claude phases proceed without browser data.
 */
export function initializePhaseHandlers(browser?: PlaywrightBrowser | BrowserBackend): void {
  // ---------------------------------------------------------------------------
  // Pure-TS phase handlers
  // ---------------------------------------------------------------------------

  registerPureTsHandler('preflight', async (ctx: DispatchContext) => {
    const config = ctx.config as unknown as AuditConfig;
    return runPreflight(config);
  });

  registerPureTsHandler('progress-init', (ctx: DispatchContext) => {
    const config = ctx.config as unknown as AuditConfig;
    return initProgress(ctx.auditDir, config);
  });

  registerPureTsHandler('safety', (ctx: DispatchContext) => {
    const config = ctx.config as unknown as AuditConfig;
    return assessSafety(config);
  });

  registerPureTsHandler('reporting', (ctx: DispatchContext) => {
    // Update progress with page and finding counts before generating report
    updateProgressMetrics(ctx.auditDir);
    return generateReport(ctx.auditDir);
  });

  registerPureTsHandler('github-issues', async (ctx: DispatchContext) => {
    return createGitHubIssues(ctx.auditDir, ctx.codebasePath);
  });

  registerPureTsHandler('polish', (ctx: DispatchContext) => {
    const config = ctx.config as unknown as AuditConfig;
    return runPolish({
      basePath: ctx.codebasePath,
      cleanup: config.cleanup,
    });
  });

  // ---------------------------------------------------------------------------
  // Pure-TS analysis handlers (PRD parsing + code analysis)
  // ---------------------------------------------------------------------------

  registerPureTsHandler('prd-parsing', (ctx: DispatchContext) => {
    const config = ctx.config as unknown as AuditConfig;
    return parsePrd(config.prdPath, ctx.auditDir);
  });

  registerPureTsHandler('code-analysis', async (ctx: DispatchContext) => {
    const config = ctx.config as unknown as AuditConfig;
    return runCodeAnalysis({
      auditDir: ctx.auditDir,
      codebasePath: ctx.codebasePath,
      prdMappingPromptPath: undefined,
    });
  });

  // ---------------------------------------------------------------------------
  // Quality pipeline pre-filter (pure-TS, runs before LLM critique)
  // ---------------------------------------------------------------------------

  registerPureTsHandler('finding-quality', async (ctx: DispatchContext) => {
    // Step 1: Attach evidence screenshots to findings BEFORE quality scoring
    // (findings without evidence score lower in the quality pipeline)
    if (browser) {
      try {
        await collectFindingQualityData(ctx, browser);
      } catch (err) {
        console.warn(`[FindingQuality] Evidence capture failed, proceeding with quality pipeline: ${err}`);
      }
    }

    // Step 2: Run quality pipeline on now-enriched findings
    return runQualityPipelineAndSave({
      auditDir: ctx.auditDir,
    });
  });

  // ---------------------------------------------------------------------------
  // Browser data collectors (only when a browser is available)
  // ---------------------------------------------------------------------------

  if (browser) {
    registerBrowserCollector('exploration', (ctx) =>
      collectExplorationData(ctx, browser),
    );

    registerBrowserCollector('form-testing', (ctx) =>
      collectFormTestingData(ctx, browser),
    );

    registerBrowserCollector('responsive-testing', (ctx) =>
      collectResponsiveData(ctx, browser),
    );

    registerBrowserCollector('finding-quality', (ctx) =>
      collectFindingQualityData(ctx, browser),
    );

    registerBrowserCollector('verification', (ctx) =>
      collectVerificationData(ctx, browser),
    );
  }
}

/**
 * Update progress.json with actual page/finding counts before report generation.
 */
function updateProgressMetrics(auditDir: string): void {
  const progressPath = getProgressPath(auditDir);
  if (!fs.existsSync(progressPath)) return;

  try {
    const progress = JSON.parse(fs.readFileSync(progressPath, 'utf-8'));

    // Count pages from pages directory
    const pageDir = getPageDir(auditDir);
    let pageCount = 0;
    if (fs.existsSync(pageDir)) {
      pageCount = fs.readdirSync(pageDir).filter((f) => f.endsWith('.json')).length;
    }

    // Count findings from findings directory
    const findingDir = getFindingDir(auditDir);
    let findingCount = 0;
    const severityCounts: Record<string, number> = { P0: 0, P1: 0, P2: 0, P3: 0, P4: 0 };
    if (fs.existsSync(findingDir)) {
      const files = fs.readdirSync(findingDir).filter((f) => f.endsWith('.json'));
      findingCount = files.length;
      for (const file of files) {
        try {
          const finding = JSON.parse(fs.readFileSync(path.join(findingDir, file), 'utf-8'));
          const sev = finding.severity as string;
          if (sev in severityCounts) severityCounts[sev]++;
        } catch { /* skip */ }
      }
    }

    // Update metrics
    progress.metrics = progress.metrics || {};
    progress.metrics.pages_visited = pageCount;
    progress.metrics.pages_total = pageCount;
    progress.metrics.findings_total = findingCount;
    progress.metrics.findings_by_severity = severityCounts;

    // Also set coverage for report generator
    progress.coverage = {
      pages_visited: pageCount,
      forms_tested: 0,
      features_checked: 0,
    };

    progress.updated_at = new Date().toISOString();
    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), 'utf-8');
  } catch (error) {
    console.warn(`[PhaseInit] Warning: Failed to update progress metrics: ${error}`);
  }
}
