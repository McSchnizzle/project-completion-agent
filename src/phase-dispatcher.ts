/**
 * Phase Dispatcher - Routes each pipeline phase to the correct execution handler.
 *
 * Three phase types:
 * - **pure-ts**: Execute TypeScript functions directly (no Claude call)
 * - **claude-driven**: Load prompt template, interpolate context, send to Claude
 * - **browser-claude**: Use Playwright to collect page data, then send to Claude
 *
 * @module phase-dispatcher
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { type PhaseName, type PhaseType, getPhaseConfig } from './phase-registry.js';
import { type LLMClient, type LLMResponse } from './llm/anthropic-client.js';
import { loadPrompt, interpolateVariables } from './llm/prompt-loader.js';
import { getFindingDir } from './artifact-paths.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Accumulates cost/token data across multiple LLM calls. */
export interface CostAccumulator {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCalls: number;
}

export interface DispatchContext {
  /** Audit output directory */
  auditDir: string;
  /** Target URL */
  url: string;
  /** Project codebase path */
  codebasePath: string;
  /** Full audit config (passed through for pure-ts phases) */
  config: Record<string, unknown>;
  /** Browser data injected by browser phases (screenshots, DOM, forms, etc.) */
  browserData?: Record<string, unknown>;
  /** Shared cost accumulator updated after each LLM call. */
  costAccumulator?: CostAccumulator;
  /** Additional key-value context for prompt interpolation */
  [key: string]: unknown;
}

export interface PhaseDispatchResult {
  success: boolean;
  output?: string;
  error?: string;
  phaseType: PhaseType;
  durationMs: number;
}

/** Function signature for pure-TS phase implementations. */
export type PureTsHandler = (context: DispatchContext) => Promise<unknown> | unknown;

/** Function signature for browser data collectors. */
export type BrowserCollector = (
  context: DispatchContext,
) => Promise<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Registry of handlers
// ---------------------------------------------------------------------------

/** Map of pure-TS phase handlers. Lazy-loaded to avoid circular imports. */
const pureTsHandlers: Partial<Record<PhaseName, PureTsHandler>> = {};

/** Map of browser data collectors. Lazy-loaded per phase. */
const browserCollectors: Partial<Record<PhaseName, BrowserCollector>> = {};

/**
 * Register a pure-TS handler for a phase.
 */
export function registerPureTsHandler(
  phase: PhaseName,
  handler: PureTsHandler,
): void {
  pureTsHandlers[phase] = handler;
}

/**
 * Register a browser data collector for a phase.
 */
export function registerBrowserCollector(
  phase: PhaseName,
  collector: BrowserCollector,
): void {
  browserCollectors[phase] = collector;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Resolve a prompt path relative to the project root.
 * Registry paths like 'prompts/phase-8-review.md' become absolute.
 */
function resolvePromptPath(promptPath: string): string {
  if (path.isAbsolute(promptPath)) return promptPath;
  const projectRoot = path.resolve(__dirname, '..');
  return path.join(projectRoot, promptPath);
}

/**
 * Dispatch a phase to the correct handler based on its phaseType.
 *
 * @param phaseName - The pipeline phase to dispatch.
 * @param llmClient - LLM client for Claude API calls (used by claude-driven and browser-claude).
 * @param context   - Execution context with audit config and state.
 * @returns Result of the phase execution.
 */
export async function dispatchPhase(
  phaseName: PhaseName,
  llmClient: LLMClient,
  context: DispatchContext,
): Promise<PhaseDispatchResult> {
  const start = Date.now();
  const meta = getPhaseConfig(phaseName);

  try {
    switch (meta.phaseType) {
      case 'pure-ts':
        return await dispatchPureTs(phaseName, context, start);

      case 'claude-driven':
        return await dispatchClaudeDriven(phaseName, llmClient, context, meta.promptPath, start);

      case 'browser-claude':
        return await dispatchBrowserClaude(phaseName, llmClient, context, meta.promptPath, start);

      default:
        return {
          success: false,
          error: `Unknown phaseType: ${meta.phaseType}`,
          phaseType: meta.phaseType,
          durationMs: Date.now() - start,
        };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      phaseType: meta.phaseType,
      durationMs: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// Internal dispatch handlers
// ---------------------------------------------------------------------------

async function dispatchPureTs(
  phaseName: PhaseName,
  context: DispatchContext,
  start: number,
): Promise<PhaseDispatchResult> {
  const handler = pureTsHandlers[phaseName];

  if (!handler) {
    return {
      success: false,
      error: `No pure-TS handler registered for phase: ${phaseName}`,
      phaseType: 'pure-ts',
      durationMs: Date.now() - start,
    };
  }

  const result = await handler(context);
  const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

  return {
    success: true,
    output,
    phaseType: 'pure-ts',
    durationMs: Date.now() - start,
  };
}

/**
 * Build interpolation variables from a DispatchContext for prompt templates.
 */
function buildPromptVariables(context: DispatchContext): Record<string, unknown> {
  return {
    auditDir: context.auditDir,
    url: context.url,
    codebasePath: context.codebasePath,
    config: context.config,
    browserData: context.browserData,
    prd: context.prd,
    phaseName: context.phaseName,
    maxPages: context.maxPages,
    maxForms: context.maxForms,
    focusPatterns: context.focusPatterns,
  };
}

/**
 * Record token usage from an LLM response into the cost accumulator.
 */
function recordCost(context: DispatchContext, response: LLMResponse): void {
  if (context.costAccumulator) {
    context.costAccumulator.totalInputTokens += response.inputTokens;
    context.costAccumulator.totalOutputTokens += response.outputTokens;
    context.costAccumulator.totalCalls += 1;
  }
}

async function dispatchClaudeDriven(
  phaseName: PhaseName,
  llmClient: LLMClient,
  context: DispatchContext,
  promptPath: string | undefined,
  start: number,
): Promise<PhaseDispatchResult> {
  if (!promptPath) {
    return {
      success: false,
      error: `Phase ${phaseName} is claude-driven but has no promptPath`,
      phaseType: 'claude-driven',
      durationMs: Date.now() - start,
    };
  }

  // Load prompt template and interpolate context variables
  const resolved = resolvePromptPath(promptPath);
  const template = loadPrompt(resolved);
  const prompt = interpolateVariables(template, buildPromptVariables(context));

  const response = await llmClient.complete(prompt, {
    maxTokens: 8192,
    temperature: 0,
  });

  recordCost(context, response);

  return {
    success: true,
    output: response.content,
    phaseType: 'claude-driven',
    durationMs: Date.now() - start,
  };
}

async function dispatchBrowserClaude(
  phaseName: PhaseName,
  llmClient: LLMClient,
  context: DispatchContext,
  promptPath: string | undefined,
  start: number,
): Promise<PhaseDispatchResult> {
  if (!promptPath) {
    return {
      success: false,
      error: `Phase ${phaseName} is browser-claude but has no promptPath`,
      phaseType: 'browser-claude',
      durationMs: Date.now() - start,
    };
  }

  // Step 1: Collect browser data if a collector is registered
  const collector = browserCollectors[phaseName];
  let browserData: Record<string, unknown> | undefined;

  if (collector) {
    try {
      browserData = await collector(context);
    } catch (error) {
      console.warn(
        `[Dispatcher] Browser collector for ${phaseName} failed: ${error}. Proceeding without browser data.`,
      );
    }
  }

  // Step 2: Load PRD features context if available
  let prdContext = '';
  const prdSummaryPath = path.join(context.auditDir, 'prd-summary.json');
  if (fs.existsSync(prdSummaryPath)) {
    try {
      const prdData = JSON.parse(fs.readFileSync(prdSummaryPath, 'utf-8'));
      const features = prdData.features || prdData;
      if (Array.isArray(features)) {
        prdContext = features.map((f: any) =>
          `- ${f.id || ''}: ${f.name || f.title || ''} [${f.priority || 'must'}] ${f.acceptance_criteria ? '| AC: ' + (Array.isArray(f.acceptance_criteria) ? f.acceptance_criteria.join('; ') : f.acceptance_criteria) : ''}`
        ).join('\n');
      }
    } catch { /* skip */ }
  }

  // Step 3: Build analysis prompt with collected data injected
  const resolved = resolvePromptPath(promptPath);
  const template = loadPrompt(resolved);
  const enrichedContext = { ...context, browserData };
  const interpolated = interpolateVariables(template, buildPromptVariables(enrichedContext));

  // Build the actual analysis prompt that includes collected data
  const dataSection = browserData
    ? `\n\n## COLLECTED BROWSER DATA\n\nThe following data was automatically collected by visiting the application pages with a headless browser. Analyze this data to identify issues.\n\n\`\`\`json\n${JSON.stringify(browserData, null, 2).substring(0, 50000)}\n\`\`\``
    : '\n\n## NOTE: No browser data was collected for this phase.';

  const prdSection = prdContext
    ? `\n\n## PRD FEATURES TO CHECK\n\n${prdContext}`
    : '';

  const outputInstruction = `\n\n## REQUIRED OUTPUT FORMAT

You are analyzing pre-collected browser data. Do NOT describe how you would explore the app - the exploration is already done. Instead, analyze the collected data and produce findings.

Return a JSON object with this structure:
\`\`\`json
{
  "findings": [
    {
      "id": "F-001",
      "title": "Short description of the issue",
      "severity": "P0|P1|P2|P3|P4",
      "type": "functionality|ui|performance|security|accessibility",
      "url": "https://...",
      "description": "Detailed description of what is wrong",
      "expected_behavior": "What the PRD or best practices say should happen",
      "actual_behavior": "What actually happens based on the collected data",
      "prd_feature": "Feature ID from PRD if applicable",
      "reproduction_steps": ["step 1", "step 2"],
      "confidence": 85,
      "evidence": "Specific data from the collected browser data that supports this finding"
    }
  ],
  "summary": "Brief summary of analysis"
}
\`\`\`

Severity guide:
- P0 (Critical): App crashes, data loss, security vulnerability, complete feature missing
- P1 (High): Major functionality broken, significant UX issue, key PRD requirement unmet
- P2 (Medium): Feature partially works, minor PRD gap, UI inconsistency
- P3 (Low): Minor polish issue, nice-to-have missing, cosmetic
- P4 (Info): Observation, suggestion, not a bug

Be specific and evidence-based. Only report findings you can support with the collected data.
If no issues are found, return: {"findings": [], "summary": "No issues found"}`;

  const prompt = interpolated + dataSection + prdSection + outputInstruction;

  const response = await llmClient.complete(prompt, {
    maxTokens: 8192,
    temperature: 0,
  });

  recordCost(enrichedContext, response);

  // Step 4: Extract findings from LLM response and save to findings directory
  const extractedFindings = extractFindings(response.content);
  if (extractedFindings.length > 0) {
    const findingDir = getFindingDir(context.auditDir);
    fs.mkdirSync(findingDir, { recursive: true });

    for (const finding of extractedFindings) {
      const findingId = finding.id || `F-${String(extractedFindings.indexOf(finding) + 1).padStart(3, '0')}`;
      finding.id = findingId;
      finding.phase = phaseName;
      finding.discovered_at = new Date().toISOString();

      const findingPath = path.join(findingDir, `${findingId}.json`);
      fs.writeFileSync(findingPath, JSON.stringify(finding, null, 2), 'utf-8');
    }

    console.log(`[Dispatcher] ${phaseName}: extracted ${extractedFindings.length} findings`);
  }

  return {
    success: true,
    output: response.content,
    phaseType: 'browser-claude',
    durationMs: Date.now() - start,
  };
}

/**
 * Extract findings array from LLM response content.
 * Handles JSON wrapped in markdown code blocks or raw JSON.
 */
function extractFindings(content: string): Record<string, unknown>[] {
  // Try to extract JSON from markdown code blocks
  const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : content;

  try {
    const parsed = JSON.parse(jsonStr.trim());
    if (Array.isArray(parsed)) return parsed;
    if (parsed.findings && Array.isArray(parsed.findings)) return parsed.findings;
    return [];
  } catch {
    // Try to find JSON object in the content
    const objectMatch = content.match(/\{[\s\S]*"findings"[\s\S]*\}/);
    if (objectMatch) {
      try {
        const parsed = JSON.parse(objectMatch[0]);
        if (parsed.findings && Array.isArray(parsed.findings)) return parsed.findings;
      } catch { /* give up */ }
    }
    return [];
  }
}
