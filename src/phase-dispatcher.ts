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

import * as path from 'node:path';
import { type PhaseName, type PhaseType, getPhaseConfig } from './phase-registry.js';
import { type LLMClient, type LLMResponse } from './llm/anthropic-client.js';
import { loadPrompt, interpolateVariables } from './llm/prompt-loader.js';

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
  let enrichedContext = { ...context };

  if (collector) {
    try {
      const browserData = await collector(context);
      enrichedContext = { ...enrichedContext, browserData };
    } catch (error) {
      console.warn(
        `[Dispatcher] Browser collector for ${phaseName} failed: ${error}. Proceeding without browser data.`,
      );
    }
  }

  // Step 2: Load prompt, interpolate, call LLM
  const resolved = resolvePromptPath(promptPath);
  const template = loadPrompt(resolved);
  const prompt = interpolateVariables(template, buildPromptVariables(enrichedContext));

  const response = await llmClient.complete(prompt, {
    maxTokens: 8192,
    temperature: 0,
  });

  recordCost(enrichedContext, response);

  return {
    success: true,
    output: response.content,
    phaseType: 'browser-claude',
    durationMs: Date.now() - start,
  };
}
