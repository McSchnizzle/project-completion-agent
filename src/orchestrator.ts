/**
 * Orchestrator - Main audit pipeline coordinator.
 *
 * Coordinates the entire audit lifecycle:
 * 1. Setup & resume detection
 * 2. Phase dispatch (pure-ts / claude-driven / browser-claude)
 * 3. Parallel execution of independent phases via JobRunner
 * 4. Progress tracking, checkpoints, and dashboard generation
 *
 * @module orchestrator
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AuditConfig,
} from './config.js';
import {
  getPhasesByOrder,
  getPhaseConfig,
  type PhaseName,
} from './phase-registry.js';
import { dispatchPhase, type DispatchContext, type CostAccumulator } from './phase-dispatcher.js';
import { initializePhaseHandlers } from './phase-init.js';
import { ArtifactStore } from './artifact-store.js';
import { PlaywrightBrowser } from './playwright-browser.js';
import { PlaywrightBrowserAdapter } from './playwright-browser-adapter.js';
import type { BrowserBackend } from './browser-backend.js';
import { JobRunner, type Job } from './job-runner.js';
import { writeDashboard } from './dashboard-writer.js';
import {
  getAuditDir,
  ensureDirectories,
  getMetricsPath,
  getProgressPath,
  getReportPath,
  getFindingDir,
} from './artifact-paths.js';
import { createAnthropicClient, type LLMClient } from './llm/anthropic-client.js';
import { loadPrompt } from './llm/prompt-loader.js';
import { ActionLogger } from './storage/action-logger.js';
import {
  saveCheckpoint as saveCheckpointV2,
  buildCheckpointState,
  loadCheckpoint as loadCheckpointV2,
} from './pipeline/checkpoint-manager.js';
import { startDashboardServer, type DashboardServer } from './reporting/dashboard-server.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface AuditResult {
  success: boolean;
  auditId: string;
  auditDir: string;
  phasesCompleted: number;
  phasesTotal: number;
  totalCostUsd: number;
  totalDurationMs: number;
  error?: string;
  reportPath?: string;
}

export interface VerifyResult {
  findingId: string;
  status: 'fixed' | 'still_broken' | 'new_error' | 'cannot_verify';
  durationMs: number;
  notes?: string;
  error?: string;
  reproductionAttempts: number;
}

// ---------------------------------------------------------------------------
// Main Orchestrator
// ---------------------------------------------------------------------------

export async function runAudit(config: AuditConfig): Promise<AuditResult> {
  const startTime = Date.now();

  // Step 1: Setup audit directory
  const auditDir = getAuditDir(config.codebasePath);
  ensureDirectories(auditDir);

  console.log(`[Orchestrator] Starting audit: ${config.auditId}`);
  console.log(`[Orchestrator] Audit directory: ${auditDir}`);
  console.log(`[Orchestrator] Mode: ${config.mode} ${config.parallel ? '(parallel)' : '(sequential)'}`);

  // Step 2: Initialize shared resources
  const artifactStore = new ArtifactStore(auditDir);

  // Create LLM client via Anthropic SDK (replaces old claude-subprocess)
  let llmClient: LLMClient;
  try {
    llmClient = createAnthropicClient({
      timeoutMs: config.timeoutPerPhase * 1000,
      maxRetries: 2,
    });
  } catch (error) {
    // If no API key is available, create a no-op client for pure-TS-only runs
    console.warn(`[Orchestrator] Warning: LLM client unavailable (${error}). Claude-driven phases will fail.`);
    llmClient = {
      complete: async () => { throw new Error('ANTHROPIC_API_KEY not set'); },
      stream: async function* () { throw new Error('ANTHROPIC_API_KEY not set'); },
    };
  }

  // Shared cost accumulator for tracking LLM usage across phases
  const costAccumulator: CostAccumulator = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCalls: 0,
  };

  // Step 2b: Create browser backend (V4: wrapped in BrowserBackend adapter for full feature support)
  let browserBackend: BrowserBackend | undefined;
  let playwrightBrowser: PlaywrightBrowser | undefined;
  if (config.browser !== 'none') {
    try {
      const adapter = new PlaywrightBrowserAdapter({
        type: 'playwright',
        headless: true,
        screenshots: true,
        authConfig: config.authConfig,
      });
      const launched = await adapter.launch();
      if (launched) {
        browserBackend = adapter;
        console.log(`[Orchestrator] Playwright browser launched via BrowserBackend adapter${config.authConfig ? ` (auth: ${config.authConfig.strategy})` : ''}`);
      }
    } catch (error) {
      console.warn(`[Orchestrator] Warning: BrowserBackend adapter failed: ${error}`);
      // Fall back to raw PlaywrightBrowser for backward compatibility
      try {
        playwrightBrowser = new PlaywrightBrowser({
          authConfig: config.authConfig,
        });
        await playwrightBrowser.launch();
        console.log(`[Orchestrator] Playwright browser launched (legacy mode, V4 features disabled)`);
      } catch (err2) {
        console.warn(`[Orchestrator] Warning: Failed to launch Playwright browser: ${err2}`);
        console.warn(`[Orchestrator] Browser phases will proceed without browser data`);
      }
    }
  }

  // Step 2c: Register phase handlers with the dispatcher
  initializePhaseHandlers(browserBackend ?? playwrightBrowser);

  // Step 2d: Initialize action logger
  const actionLogger = ActionLogger.init(auditDir);
  actionLogger.log({ action_type: 'audit_start', details: `Audit ${config.auditId} started` });

  // Step 2e: Start live dashboard server
  let dashboardServer: DashboardServer | undefined;
  try {
    dashboardServer = await startDashboardServer({ auditDir });
    console.log(`[Orchestrator] Dashboard: ${dashboardServer.url}`);
  } catch (error) {
    console.warn(`[Orchestrator] Warning: Dashboard server failed: ${error}`);
  }

  // Step 3: Get phases to run
  const allPhases = getPhasesByOrder();
  let phasesToRun = allPhases.map((p) => p.id);

  // Step 4: Handle cleanup
  if (config.cleanup && !config.resume) {
    console.log(`[Orchestrator] Cleaning up previous audit artifacts...`);
    try {
      if (fs.existsSync(auditDir)) {
        fs.rmSync(auditDir, { recursive: true });
        ensureDirectories(auditDir);
      }
    } catch (error) {
      console.warn(`[Orchestrator] Warning: Failed to clean audit directory: ${error}`);
    }
  }

  // Step 4b: Focus mode - inject focusPatterns into phase contexts
  if (config.focusPatterns && config.focusPatterns.length > 0) {
    console.log(`[Orchestrator] Focus mode: patterns = ${config.focusPatterns.join(', ')}`);
  }

  // Step 5: Resume support - skip completed phases
  let completedPhases: string[] = [];

  if (config.resume) {
    const checkpoint = loadCheckpointV2(auditDir);
    if (checkpoint && checkpoint.completedPhases.length > 0) {
      completedPhases = checkpoint.completedPhases;
      phasesToRun = phasesToRun.filter((p) => !completedPhases.includes(p));
      console.log(`[Orchestrator] Resuming from checkpoint: ${completedPhases.length} phases done, ${phasesToRun.length} remaining`);
      actionLogger.log({
        action_type: 'checkpoint_saved',
        details: `Resumed from checkpoint with ${completedPhases.length} completed phases`,
      });
    }
  }

  // Step 6: Initialize progress tracking
  initializeProgress(auditDir, config.auditId, allPhases.map((p) => p.id), config);

  // Mark already-completed phases
  for (const phase of completedPhases) {
    updatePhaseProgress(auditDir, phase, 'completed');
  }

  // Step 7: Execute pipeline
  let auditSuccess = true;
  let earlyStopReason: string | undefined;

  try {
    if (config.parallel) {
      completedPhases = await runPhasesParallel(
        phasesToRun,
        completedPhases,
        auditDir,
        config,
        llmClient,
        costAccumulator,
        artifactStore,
        startTime,
      );
    } else {
      completedPhases = await runPhasesSequentially(
        phasesToRun,
        completedPhases,
        auditDir,
        config,
        llmClient,
        costAccumulator,
        artifactStore,
        startTime,
      );
    }

    if (completedPhases.length < allPhases.length) {
      auditSuccess = false;
      earlyStopReason = `Only completed ${completedPhases.length}/${allPhases.length} phases`;
    }
  } catch (error) {
    auditSuccess = false;
    earlyStopReason = error instanceof Error ? error.message : String(error);
    console.error(`[Orchestrator] Pipeline failed: ${earlyStopReason}`);
  }

  // Step 8: Close browser
  if (browserBackend) {
    try {
      await browserBackend.close();
      console.log(`[Orchestrator] Browser backend closed`);
    } catch (error) {
      console.warn(`[Orchestrator] Warning: Failed to close browser backend: ${error}`);
    }
  } else if (playwrightBrowser) {
    try {
      await playwrightBrowser.close();
      console.log(`[Orchestrator] Playwright browser closed`);
    } catch (error) {
      console.warn(`[Orchestrator] Warning: Failed to close browser: ${error}`);
    }
  }

  // Step 8b: Shut down dashboard server
  if (dashboardServer) {
    try {
      await dashboardServer.close();
      console.log(`[Orchestrator] Dashboard server stopped`);
    } catch (error) {
      console.warn(`[Orchestrator] Warning: Dashboard server shutdown failed: ${error}`);
    }
  }

  // Step 9: Write dashboard
  try {
    const dashPath = writeDashboard(auditDir);
    console.log(`[Orchestrator] Dashboard written: ${dashPath}`);
  } catch (error) {
    console.warn(`[Orchestrator] Warning: Dashboard generation failed: ${error}`);
  }

  // Step 10: Finalize metrics
  const totalDurationMs = Date.now() - startTime;
  // Estimate cost from token usage (Sonnet pricing: ~$3/M input, ~$15/M output)
  const totalCostUsd =
    (costAccumulator.totalInputTokens * 3 + costAccumulator.totalOutputTokens * 15) / 1_000_000;

  console.log(`[Orchestrator] Audit completed in ${(totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`[Orchestrator] Total cost: $${totalCostUsd.toFixed(4)}`);
  console.log(`[Orchestrator] Phases completed: ${completedPhases.length}/${allPhases.length}`);

  const metricsPath = getMetricsPath(auditDir);
  fs.writeFileSync(metricsPath, JSON.stringify({
    auditId: config.auditId,
    totalCostUsd,
    totalDurationMs,
    phasesCompleted: completedPhases.length,
    phasesTotal: allPhases.length,
    completedPhases,
  }, null, 2), 'utf-8');

  // Step 11: Update final progress
  updateFinalProgress(auditDir, auditSuccess ? 'completed' : 'failed');

  // Step 11b: Final action log entry
  ActionLogger.getInstance()?.log({
    action_type: 'audit_complete',
    details: `Audit ${auditSuccess ? 'completed' : 'failed'} in ${totalDurationMs}ms`,
  });
  ActionLogger.reset();

  const reportPath = getReportPath(auditDir);
  const reportExists = fs.existsSync(reportPath);

  return {
    success: auditSuccess,
    auditId: config.auditId,
    auditDir,
    phasesCompleted: completedPhases.length,
    phasesTotal: allPhases.length,
    totalCostUsd,
    totalDurationMs,
    error: earlyStopReason,
    reportPath: reportExists ? reportPath : undefined,
  };
}

// ---------------------------------------------------------------------------
// Verify Command
// ---------------------------------------------------------------------------

/**
 * Run the verify command against a single issue/finding.
 *
 * Reads the finding from the audit directory, re-executes its
 * reproduction steps, and reports: Fixed | Still Broken | New Error | Cannot Verify.
 *
 * @param config - Audit configuration (needs codebasePath and url).
 * @param issueOrFinding - Issue number (e.g. "42") or finding ID (e.g. "F-001").
 * @returns Verification result.
 */
export async function runVerify(
  config: AuditConfig,
  issueOrFinding: string,
): Promise<VerifyResult> {
  const startTime = Date.now();
  const auditDir = getAuditDir(config.codebasePath);

  console.log(`[Verify] Audit directory: ${auditDir}`);
  console.log(`[Verify] Looking for issue/finding: ${issueOrFinding}`);

  // Try to load the finding
  const finding = loadFindingForVerify(auditDir, issueOrFinding);

  if (!finding) {
    return {
      findingId: issueOrFinding,
      status: 'cannot_verify',
      durationMs: Date.now() - startTime,
      error: `Finding not found: ${issueOrFinding}. Looked in ${auditDir}/findings/ and ${auditDir}/issues/`,
      reproductionAttempts: 0,
    };
  }

  const findingId = (finding.id as string) || issueOrFinding;
  console.log(`[Verify] Found finding: ${findingId} - ${finding.title || 'Untitled'}`);

  // Get reproduction steps
  const steps = finding.reproduction_steps as string[] | undefined;
  if (!steps || steps.length === 0) {
    return {
      findingId,
      status: 'cannot_verify',
      durationMs: Date.now() - startTime,
      notes: 'No reproduction steps defined for this finding',
      reproductionAttempts: 0,
    };
  }

  // Step 1: Collect browser data if a browser is available and the finding has a URL
  let browserData: Record<string, unknown> | undefined;
  let playwrightBrowser: PlaywrightBrowser | undefined;
  const findingUrl = finding.url as string | undefined;

  if (findingUrl && config.browser !== 'none') {
    playwrightBrowser = new PlaywrightBrowser();
    try {
      await playwrightBrowser.launch();
      const page = await playwrightBrowser.visitPage(findingUrl);
      browserData = {
        url: page.url,
        title: page.title,
        html: page.html.substring(0, 5000),
        text: page.text.substring(0, 3000),
        statusCode: page.statusCode,
        formCount: page.forms.length,
        linkCount: page.links.length,
      };
      console.log(`[Verify] Browser data collected from ${findingUrl}`);
    } catch (error) {
      console.warn(`[Verify] Warning: Failed to collect browser data: ${error}`);
      playwrightBrowser = undefined;
    }
  }

  // Step 2: Build prompt and call LLM via Anthropic SDK (v2 architecture)
  let result: VerifyResult;

  try {
    const promptTemplate = loadPrompt('phase-9-verification.md');

    // Build context for the verification prompt
    const verifyContext = JSON.stringify({
      findingId,
      title: finding.title,
      description: finding.description,
      severity: finding.severity,
      url: findingUrl,
      reproductionSteps: steps,
      browserData: browserData || 'No browser data available (browser disabled or collection failed)',
      auditDir,
    }, null, 2);

    const prompt = `${promptTemplate}\n\n## Finding to Verify\n\n${verifyContext}\n\n## Instructions\n\nVerify this single finding. Return a JSON object with these fields:\n- findingId: string\n- status: "fixed" | "still_broken" | "new_error" | "cannot_verify"\n- notes: string explaining the verification result\n- attempts: number of reproduction attempts made\n`;

    const llmClient = createAnthropicClient({
      timeoutMs: Math.min(config.timeoutPerPhase * 1000, 300000),
      maxRetries: 1,
    });

    const llmResponse = await llmClient.complete(prompt, {
      responseFormat: 'json',
      maxTokens: 4096,
      temperature: 0,
    });

    const parsed = parseVerifyOutput(llmResponse.content, findingId);
    result = {
      findingId,
      status: parsed.status,
      durationMs: Date.now() - startTime,
      notes: parsed.notes,
      reproductionAttempts: parsed.attempts,
    };

    console.log(`[Verify] LLM tokens: ${llmResponse.inputTokens} in, ${llmResponse.outputTokens} out`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // If ANTHROPIC_API_KEY is not set, fall back gracefully
    if (errorMsg.includes('ANTHROPIC_API_KEY')) {
      console.warn(`[Verify] No API key available. Attempting local verification.`);
      result = {
        findingId,
        status: browserData ? 'still_broken' : 'cannot_verify',
        durationMs: Date.now() - startTime,
        notes: browserData
          ? `Browser visited ${findingUrl} (status ${browserData.statusCode}). LLM verification unavailable (no API key).`
          : 'Cannot verify: no browser data and no API key for LLM verification.',
        reproductionAttempts: browserData ? 1 : 0,
      };
    } else {
      result = {
        findingId,
        status: 'cannot_verify',
        durationMs: Date.now() - startTime,
        error: errorMsg,
        reproductionAttempts: 0,
      };
    }
  }

  // Save verification result to the finding file
  saveVerifyResult(auditDir, findingId, result);

  // Close browser
  if (playwrightBrowser) {
    try {
      await playwrightBrowser.close();
    } catch { /* ignore */ }
  }

  console.log(`[Verify] Result: ${result.status}`);
  return result;
}

// ---------------------------------------------------------------------------
// Verify helpers
// ---------------------------------------------------------------------------

function loadFindingForVerify(
  auditDir: string,
  issueOrFinding: string,
): Record<string, unknown> | null {
  const findingDir = path.join(auditDir, 'findings');
  const issuesDir = path.join(auditDir, 'issues');

  // Try direct finding ID (e.g. "F-001")
  const findingPath = path.join(findingDir, `${issueOrFinding}.json`);
  if (fs.existsSync(findingPath)) {
    try {
      return JSON.parse(fs.readFileSync(findingPath, 'utf-8'));
    } catch { /* fall through */ }
  }

  // Try issue number (e.g. "42" -> look for issue-42.json)
  const issueNum = parseInt(issueOrFinding, 10);
  if (!isNaN(issueNum)) {
    const issuePath = path.join(issuesDir, `issue-${issueNum}.json`);
    if (fs.existsSync(issuePath)) {
      try {
        const issue = JSON.parse(fs.readFileSync(issuePath, 'utf-8'));
        // Issue file may reference a finding_id
        if (issue.finding_id) {
          const referencedPath = path.join(findingDir, `${issue.finding_id}.json`);
          if (fs.existsSync(referencedPath)) {
            try {
              return JSON.parse(fs.readFileSync(referencedPath, 'utf-8'));
            } catch { /* fall through */ }
          }
        }
        // Return the issue data itself as a finding-like object
        return issue;
      } catch { /* fall through */ }
    }

    // Also check created-issues.json
    const createdIssuesPath = path.join(auditDir, 'created-issues.json');
    if (fs.existsSync(createdIssuesPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(createdIssuesPath, 'utf-8'));
        const issues = data.issues || data;
        if (Array.isArray(issues)) {
          const match = issues.find(
            (i: Record<string, unknown>) => i.issue_number === issueNum,
          );
          if (match?.finding_id) {
            const refPath = path.join(findingDir, `${match.finding_id}.json`);
            if (fs.existsSync(refPath)) {
              try {
                return JSON.parse(fs.readFileSync(refPath, 'utf-8'));
              } catch { /* fall through */ }
            }
          }
          if (match) return match;
        }
      } catch { /* fall through */ }
    }
  }

  // Scan findings directory for matching ID substring
  if (fs.existsSync(findingDir)) {
    const files = fs.readdirSync(findingDir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(
          fs.readFileSync(path.join(findingDir, file), 'utf-8'),
        );
        if (data.id === issueOrFinding || data.finding_id === issueOrFinding) {
          return data;
        }
      } catch { /* skip */ }
    }
  }

  return null;
}

function parseVerifyOutput(
  output: string,
  findingId: string,
): { status: VerifyResult['status']; notes: string; attempts: number } {
  try {
    const parsed = JSON.parse(output);

    // Check for direct status
    if (parsed.status) {
      const statusMap: Record<string, VerifyResult['status']> = {
        VERIFIED: 'still_broken',
        NOT_REPRODUCED: 'fixed',
        fixed: 'fixed',
        still_broken: 'still_broken',
        new_error: 'new_error',
        cannot_verify: 'cannot_verify',
        ERROR: 'new_error',
      };
      return {
        status: statusMap[parsed.status] || 'cannot_verify',
        notes: parsed.notes || parsed.message || '',
        attempts: parsed.attempts || parsed.reproduction_attempts || 1,
      };
    }

    // Check for results array (from the verification phase)
    if (Array.isArray(parsed.results)) {
      const match = parsed.results.find(
        (r: Record<string, unknown>) =>
          r.findingId === findingId || r.finding_id === findingId,
      );
      if (match) {
        return {
          status: match.status || 'cannot_verify',
          notes: match.notes || match.details || '',
          attempts: match.attempts || 1,
        };
      }
    }
  } catch {
    // Output is not JSON; try to parse from text
    const lower = output.toLowerCase();
    if (lower.includes('fixed') || lower.includes('not reproduced')) {
      return { status: 'fixed', notes: output.substring(0, 200), attempts: 1 };
    }
    if (lower.includes('still broken') || lower.includes('reproduced')) {
      return { status: 'still_broken', notes: output.substring(0, 200), attempts: 1 };
    }
    if (lower.includes('new error')) {
      return { status: 'new_error', notes: output.substring(0, 200), attempts: 1 };
    }
  }

  return { status: 'cannot_verify', notes: 'Could not parse verification output', attempts: 0 };
}

function saveVerifyResult(
  auditDir: string,
  findingId: string,
  result: VerifyResult,
): void {
  const findingDir = path.join(auditDir, 'findings');
  const findingPath = path.join(findingDir, `${findingId}.json`);

  if (fs.existsSync(findingPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(findingPath, 'utf-8'));
      data.verification = {
        status: result.status,
        verifiedAt: new Date().toISOString(),
        attempts: result.reproductionAttempts,
        notes: result.notes || null,
        error: result.error || null,
      };

      const tmpPath = findingPath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmpPath, findingPath);
    } catch { /* Non-critical */ }
  }

  // Also write a standalone verification result file
  const verifyResultPath = path.join(auditDir, `verify-${findingId}.json`);
  try {
    fs.mkdirSync(path.dirname(verifyResultPath), { recursive: true });
    fs.writeFileSync(
      verifyResultPath,
      JSON.stringify(
        {
          findingId,
          status: result.status,
          durationMs: result.durationMs,
          notes: result.notes,
          error: result.error,
          reproductionAttempts: result.reproductionAttempts,
          verifiedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf-8',
    );
  } catch { /* Non-critical */ }
}

// ---------------------------------------------------------------------------
// Sequential Execution
// ---------------------------------------------------------------------------

async function runPhasesSequentially(
  phasesToRun: PhaseName[],
  alreadyCompleted: string[],
  auditDir: string,
  config: AuditConfig,
  llmClient: LLMClient,
  costAccumulator: CostAccumulator,
  artifactStore: ArtifactStore,
  startTime: number,
): Promise<string[]> {
  const completedPhases = [...alreadyCompleted];

  for (const phaseName of phasesToRun) {
    // Check dependencies
    const meta = getPhaseConfig(phaseName);
    const unmetDeps = meta.dependencies.filter((d) => !completedPhases.includes(d));
    if (unmetDeps.length > 0) {
      console.warn(`[Orchestrator] Skipping ${phaseName}: unmet dependencies: ${unmetDeps.join(', ')}`);
      updatePhaseProgress(auditDir, phaseName, 'failed');
      continue;
    }

    // Skip browser phases when browser is disabled
    if (meta.requiresBrowser && config.browser === 'none') {
      console.log(`[Orchestrator] Skipping ${phaseName}: browser disabled`);
      completedPhases.push(phaseName);
      updatePhaseProgress(auditDir, phaseName, 'completed');
      continue;
    }

    console.log(`[Orchestrator] Starting phase: ${phaseName}`);
    updatePhaseProgress(auditDir, phaseName, 'running');
    ActionLogger.getInstance()?.log({
      action_type: 'phase_start',
      phase: phaseName,
      details: `Starting phase ${phaseName}`,
    });

    const context = buildPhaseContext(auditDir, phaseName, config, costAccumulator);

    try {
      const result = await dispatchPhase(phaseName, llmClient, context);

      if (result.success) {
        console.log(`[Orchestrator] Phase ${phaseName} completed (${result.durationMs}ms)`);
        ActionLogger.getInstance()?.log({
          action_type: 'phase_complete',
          phase: phaseName,
          duration_ms: result.durationMs,
          details: `Phase ${phaseName} completed successfully`,
        });

        if (result.output) {
          artifactStore.writeArtifact(
            {
              phase: phaseName,
              type: 'output',
              artifactId: phaseName,
              filePath: `${phaseName}-output.json`,
              status: 'created',
            },
            result.output,
          );
        }

        completedPhases.push(phaseName);
        updatePhaseProgress(auditDir, phaseName, 'completed');

        const cpState = buildCheckpointState({
          currentPhase: phaseName,
          completedPhases,
          elapsedMs: Date.now() - startTime,
          findingsCount: countFindings(auditDir),
        });
        saveCheckpointV2(auditDir, cpState);
        ActionLogger.getInstance()?.log({
          action_type: 'checkpoint_saved',
          phase: phaseName,
          details: `Checkpoint saved after ${phaseName}`,
        });
      } else {
        console.error(`[Orchestrator] Phase ${phaseName} failed: ${result.error}`);
        ActionLogger.getInstance()?.log({
          action_type: 'phase_failed',
          phase: phaseName,
          details: `Phase ${phaseName} failed: ${result.error}`,
        });
        updatePhaseProgress(auditDir, phaseName, 'failed');

        if (isCriticalPhase(phaseName)) {
          throw new Error(`Critical phase ${phaseName} failed: ${result.error}`);
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Orchestrator] Phase ${phaseName} threw: ${errorMsg}`);
      ActionLogger.getInstance()?.log({
        action_type: 'phase_failed',
        phase: phaseName,
        details: `Phase ${phaseName} threw: ${errorMsg}`,
      });
      updatePhaseProgress(auditDir, phaseName, 'failed');

      if (isCriticalPhase(phaseName)) {
        throw error;
      }
    }
  }

  return completedPhases;
}

// ---------------------------------------------------------------------------
// Parallel Execution
// ---------------------------------------------------------------------------

async function runPhasesParallel(
  phasesToRun: PhaseName[],
  alreadyCompleted: string[],
  auditDir: string,
  config: AuditConfig,
  llmClient: LLMClient,
  costAccumulator: CostAccumulator,
  artifactStore: ArtifactStore,
  startTime: number,
): Promise<string[]> {
  const completedPhases = [...alreadyCompleted];

  // Group phases by pipelineOrder
  const orderGroups = new Map<number, PhaseName[]>();
  for (const phaseName of phasesToRun) {
    const meta = getPhaseConfig(phaseName);
    const order = meta.pipelineOrder;
    const group = orderGroups.get(order) ?? [];
    group.push(phaseName);
    orderGroups.set(order, group);
  }

  // Execute groups in order
  const sortedOrders = [...orderGroups.keys()].sort((a, b) => a - b);
  const jobRunner = new JobRunner({ maxConcurrent: 3 });

  for (const order of sortedOrders) {
    const group = orderGroups.get(order)!;

    // Filter out phases with unmet dependencies or disabled browser
    const runnablePhases = group.filter((phaseName) => {
      const meta = getPhaseConfig(phaseName);
      const unmetDeps = meta.dependencies.filter((d) => !completedPhases.includes(d));

      if (unmetDeps.length > 0) {
        console.warn(`[Orchestrator] Skipping ${phaseName}: unmet deps: ${unmetDeps.join(', ')}`);
        updatePhaseProgress(auditDir, phaseName, 'failed');
        return false;
      }

      if (meta.requiresBrowser && config.browser === 'none') {
        console.log(`[Orchestrator] Skipping ${phaseName}: browser disabled`);
        completedPhases.push(phaseName);
        updatePhaseProgress(auditDir, phaseName, 'completed');
        return false;
      }

      return true;
    });

    if (runnablePhases.length === 0) continue;

    if (runnablePhases.length === 1) {
      // Single phase - run directly
      const phaseName = runnablePhases[0];
      console.log(`[Orchestrator] Starting phase: ${phaseName}`);
      updatePhaseProgress(auditDir, phaseName, 'running');
      ActionLogger.getInstance()?.log({
        action_type: 'phase_start',
        phase: phaseName,
        details: `Starting phase ${phaseName}`,
      });

      const context = buildPhaseContext(auditDir, phaseName, config, costAccumulator);
      const result = await dispatchPhase(phaseName, llmClient, context);

      if (result.success) {
        console.log(`[Orchestrator] Phase ${phaseName} completed (${result.durationMs}ms)`);
        ActionLogger.getInstance()?.log({
          action_type: 'phase_complete',
          phase: phaseName,
          duration_ms: result.durationMs,
          details: `Phase ${phaseName} completed successfully`,
        });

        if (result.output) {
          artifactStore.writeArtifact(
            {
              phase: phaseName,
              type: 'output',
              artifactId: phaseName,
              filePath: `${phaseName}-output.json`,
              status: 'created',
            },
            result.output,
          );
        }

        completedPhases.push(phaseName);
        updatePhaseProgress(auditDir, phaseName, 'completed');

        const cpState = buildCheckpointState({
          currentPhase: phaseName,
          completedPhases,
          elapsedMs: Date.now() - startTime,
          findingsCount: countFindings(auditDir),
        });
        saveCheckpointV2(auditDir, cpState);
        ActionLogger.getInstance()?.log({
          action_type: 'checkpoint_saved',
          phase: phaseName,
          details: `Checkpoint saved after ${phaseName}`,
        });
      } else {
        console.error(`[Orchestrator] Phase ${phaseName} failed: ${result.error}`);
        ActionLogger.getInstance()?.log({
          action_type: 'phase_failed',
          phase: phaseName,
          details: `Phase ${phaseName} failed: ${result.error}`,
        });
        updatePhaseProgress(auditDir, phaseName, 'failed');

        if (isCriticalPhase(phaseName)) {
          throw new Error(`Critical phase ${phaseName} failed: ${result.error}`);
        }
      }
    } else {
      // Multiple phases - run in parallel via JobRunner
      console.log(`[Orchestrator] Running parallel group (order ${order}): ${runnablePhases.join(', ')}`);

      const jobs: Job<{ phaseName: PhaseName; output?: string }>[] = runnablePhases.map(
        (phaseName) => ({
          id: phaseName,
          execute: async () => {
            updatePhaseProgress(auditDir, phaseName, 'running');
            ActionLogger.getInstance()?.log({
              action_type: 'phase_start',
              phase: phaseName,
              details: `Starting phase ${phaseName} (parallel)`,
            });
            const context = buildPhaseContext(auditDir, phaseName, config, costAccumulator);
            const result = await dispatchPhase(phaseName, llmClient, context);

            if (!result.success) {
              throw new Error(result.error || 'Phase failed');
            }

            return { phaseName, output: result.output };
          },
        }),
      );

      const results = await jobRunner.runJobs(jobs);

      for (const jobResult of results) {
        const phaseName = jobResult.id as PhaseName;

        if (jobResult.success && jobResult.result) {
          console.log(`[Orchestrator] Phase ${phaseName} completed (${jobResult.duration}ms)`);
          ActionLogger.getInstance()?.log({
            action_type: 'phase_complete',
            phase: phaseName,
            duration_ms: jobResult.duration,
            details: `Phase ${phaseName} completed successfully (parallel)`,
          });

          if (jobResult.result.output) {
            artifactStore.writeArtifact(
              {
                phase: phaseName,
                type: 'output',
                artifactId: phaseName,
                filePath: `${phaseName}-output.json`,
                status: 'created',
              },
              jobResult.result.output,
            );
          }

          completedPhases.push(phaseName);
          updatePhaseProgress(auditDir, phaseName, 'completed');
        } else {
          console.error(`[Orchestrator] Phase ${phaseName} failed: ${jobResult.error}`);
          ActionLogger.getInstance()?.log({
            action_type: 'phase_failed',
            phase: phaseName,
            details: `Phase ${phaseName} failed: ${jobResult.error}`,
          });
          updatePhaseProgress(auditDir, phaseName, 'failed');

          if (isCriticalPhase(phaseName)) {
            throw new Error(`Critical phase ${phaseName} failed: ${jobResult.error}`);
          }
        }
      }

      const cpState = buildCheckpointState({
        completedPhases,
        elapsedMs: Date.now() - startTime,
        findingsCount: countFindings(auditDir),
      });
      saveCheckpointV2(auditDir, cpState);
      ActionLogger.getInstance()?.log({
        action_type: 'checkpoint_saved',
        details: `Checkpoint saved after parallel group (order ${order})`,
      });
    }
  }

  return completedPhases;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initializeProgress(auditDir: string, auditId: string, phases: PhaseName[], config?: AuditConfig): void {
  const progressPath = getProgressPath(auditDir);

  const progress = {
    schema_version: '1.0.0',
    audit_id: auditId,
    started_at: new Date().toISOString(),
    target_url: config?.url || '',
    status: 'running',
    stages: {} as Record<string, any>,
    metrics: {
      pages_visited: 0,
      pages_total: 0,
      routes_covered: 0,
      routes_total: 0,
      findings_total: 0,
      findings_by_severity: { P0: 0, P1: 0, P2: 0, P3: 0, P4: 0 },
      verified_count: 0,
      flaky_count: 0,
      unverified_count: 0,
    },
  };

  for (const phase of phases) {
    progress.stages[phase] = {
      status: 'pending',
      started_at: null,
      completed_at: null,
      progress_percent: 0,
      current_action: null,
      items_processed: 0,
      items_total: 0,
      findings_count: 0,
    };
  }

  fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), 'utf-8');
}

function updatePhaseProgress(
  auditDir: string,
  phaseName: string,
  status: 'pending' | 'running' | 'completed' | 'failed',
): void {
  const progressPath = getProgressPath(auditDir);

  if (!fs.existsSync(progressPath)) return;

  try {
    const progress = JSON.parse(fs.readFileSync(progressPath, 'utf-8'));

    if (!progress.stages[phaseName]) {
      progress.stages[phaseName] = {
        status: 'pending',
        started_at: null,
        completed_at: null,
        progress_percent: 0,
        current_action: null,
        items_processed: 0,
        items_total: 0,
        findings_count: 0,
      };
    }

    const stage = progress.stages[phaseName];
    stage.status = status;

    if (status === 'running' && !stage.started_at) {
      stage.started_at = new Date().toISOString();
    }

    if (status === 'completed' || status === 'failed') {
      stage.completed_at = new Date().toISOString();
      stage.progress_percent = 100;

      // Update findings_count from disk when a phase completes
      const totalFindings = countFindingsOnDisk(auditDir);
      stage.findings_count = totalFindings;
      progress.metrics.findings_total = totalFindings;
    }

    progress.updated_at = new Date().toISOString();
    progress.current_stage = status === 'running' ? phaseName : null;

    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), 'utf-8');
  } catch (error) {
    console.warn(`[Orchestrator] Warning: Failed to update progress for ${phaseName}: ${error}`);
  }
}

function updateFinalProgress(auditDir: string, status: 'completed' | 'failed'): void {
  const progressPath = getProgressPath(auditDir);

  if (!fs.existsSync(progressPath)) return;

  try {
    const progress = JSON.parse(fs.readFileSync(progressPath, 'utf-8'));
    progress.status = status;
    progress.completed_at = new Date().toISOString();
    progress.updated_at = new Date().toISOString();

    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), 'utf-8');
  } catch (error) {
    console.warn(`[Orchestrator] Warning: Failed to update final progress: ${error}`);
  }
}

function buildPhaseContext(
  auditDir: string,
  phaseName: PhaseName,
  config: AuditConfig,
  costAccumulator?: CostAccumulator,
): DispatchContext {
  const context: DispatchContext = {
    auditDir,
    url: config.url,
    codebasePath: config.codebasePath,
    config: config as unknown as Record<string, unknown>,
    phaseName,
    maxPages: config.maxPages,
    maxForms: config.maxForms,
    focusPatterns: config.focusPatterns,
    costAccumulator,
  };

  if (config.prdPath && fs.existsSync(config.prdPath)) {
    try {
      context.prd = fs.readFileSync(config.prdPath, 'utf-8');
    } catch (error) {
      console.warn(`[Orchestrator] Warning: Failed to read PRD: ${error}`);
    }
  }

  return context;
}

function isCriticalPhase(phaseName: PhaseName): boolean {
  const criticalPhases: PhaseName[] = [
    'preflight',
    'prd-parsing',
    'code-analysis',
    'progress-init',
    'safety',
  ];
  return criticalPhases.includes(phaseName);
}

function countFindings(auditDir: string): number {
  return countFindingsOnDisk(auditDir);
}

/**
 * Count finding JSON files on disk and optionally tally by severity.
 * Used by updatePhaseProgress to populate findings_count in progress.json.
 */
export function countFindingsOnDisk(auditDir: string): number {
  const findingDir = getFindingDir(auditDir);
  if (!fs.existsSync(findingDir)) return 0;
  try {
    return fs.readdirSync(findingDir).filter((f) => f.endsWith('.json')).length;
  } catch {
    return 0;
  }
}
