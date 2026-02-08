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
import {
  collectExplorationData,
  collectFormTestingData,
  collectResponsiveData,
  collectFindingQualityData,
  collectVerificationData,
} from './browser-phase-helpers.js';
import type { AuditConfig } from './config.js';
import { runQualityPipelineAndSave } from './finding-quality-pipeline.js';

/**
 * Register all phase handlers with the dispatcher.
 *
 * Must be called once before `dispatchPhase()` is invoked. Calling it
 * multiple times is safe (later registrations overwrite earlier ones).
 *
 * @param browser - Optional PlaywrightBrowser instance for browser phases.
 *                  If omitted, browser collectors are not registered and
 *                  browser-claude phases proceed without browser data.
 */
export function initializePhaseHandlers(browser?: PlaywrightBrowser): void {
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

  registerPureTsHandler('finding-quality', (ctx: DispatchContext) => {
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
