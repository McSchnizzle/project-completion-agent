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
import { filterFindings } from './finding-quality-pipeline.js';
import { mapFeaturesToPages, saveFeatureCoverage, type MappablePage, type FeatureCoverage } from './feature-mapper.js';

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
  let prdFeatures: any[] = [];
  const prdSummaryPath = path.join(context.auditDir, 'prd-summary.json');
  if (fs.existsSync(prdSummaryPath)) {
    try {
      const prdData = JSON.parse(fs.readFileSync(prdSummaryPath, 'utf-8'));
      const features = prdData.features || prdData;
      if (Array.isArray(features)) {
        prdFeatures = features;
        prdContext = features.map((f: any) =>
          `- ${f.id || ''}: ${f.name || f.title || ''} [${f.priority || 'must'}] ${f.acceptance_criteria ? '| AC: ' + (Array.isArray(f.acceptance_criteria) ? f.acceptance_criteria.join('; ') : f.acceptance_criteria) : ''}`
        ).join('\n');
      }
    } catch { /* skip */ }
  }

  // Build visited pages list from browser data (needed for URL requirements and filters)
  const visitedPages: string[] = [];
  if (browserData) {
    const pages = browserData.pages ?? browserData.visitedPages ?? browserData.urls;
    if (Array.isArray(pages)) {
      for (const p of pages) {
        if (typeof p === 'string') visitedPages.push(p);
        else if (p && typeof (p as Record<string, unknown>).url === 'string') visitedPages.push((p as Record<string, unknown>).url as string);
      }
    }
  }
  if (context.url && !visitedPages.includes(context.url)) {
    visitedPages.push(context.url);
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

  // Quality instructions appended to ALL browser-claude phases
  const qualityInstructions = `\n\n## QUALITY REQUIREMENTS

- Only report actual defects, bugs, missing features, or deviations from the PRD
- Do NOT report positive observations as findings (e.g., "good performance" is not a finding)
- Do NOT report tool/audit limitations as findings (e.g., "no accessibility testing performed")
- Do NOT report vague observations without specific PRD criteria references
- Every finding must have concrete evidence from the collected page data`;

  // URL requirements appended to ALL browser-claude phases
  const urlRequirements = `\n\n## URL REQUIREMENTS

IMPORTANT: Every finding MUST include a specific page URL from the visited pages list.
Do NOT use "N/A" as a URL. If you cannot identify a specific URL, use the closest matching page from the visited list.
Available page URLs:
${visitedPages.map((u) => `- ${u}`).join('\n')}`;

  // --- Verification-only mode ---
  if (phaseName === 'verification') {
    return dispatchVerificationPhase(
      phaseName, llmClient, enrichedContext, interpolated,
      dataSection, qualityInstructions, urlRequirements,
      visitedPages, start,
    );
  }

  // --- Exploration: feature checking ---
  let featureVerificationSection = '';
  if (phaseName === 'exploration' && prdFeatures.length > 0) {
    // Build MappablePage list from browser data for feature mapping
    const mappablePages: MappablePage[] = [];
    if (browserData) {
      const pages = browserData.pages ?? browserData.visitedPages;
      if (Array.isArray(pages)) {
        for (const p of pages) {
          if (p && typeof p === 'object') {
            const pg = p as Record<string, unknown>;
            mappablePages.push({
              url: (pg.url as string) || '',
              title: (pg.title as string) || '',
              text: (pg.text as string) || '',
            });
          }
        }
      }
    }

    // Generate feature-to-page mappings
    const featureMappings = mapFeaturesToPages(prdFeatures, mappablePages);

    const featureList = prdFeatures.map((f: any) => {
      const mapping = featureMappings.find((m) => m.featureId === f.id);
      const mappedPageUrls = mapping?.mappedPages?.map((mp) => mp.url).join(', ') || 'none';
      const ac = Array.isArray(f.acceptance_criteria) ? f.acceptance_criteria.join('; ') : (f.acceptance_criteria || '');
      return `- ${f.id}: ${f.name || f.title || ''} [${f.priority || 'must'}]\n  Acceptance criteria: ${ac}\n  Mapped pages: ${mappedPageUrls}`;
    }).join('\n');

    featureVerificationSection = `\n\n## PRD Feature Verification

For each feature below, check whether the visited pages satisfy its acceptance criteria.
Report your feature coverage assessment in the JSON response under a "featureCoverage" key.

Features to verify:
${featureList}

For each feature, report:
{
  "featureId": "F1",
  "status": "pass" | "fail" | "partial" | "not_testable",
  "evidence": "specific evidence from page data",
  "checkedCriteria": [
    {"criterion": "...", "status": "pass"|"fail"|"not_testable", "evidence": "..."}
  ]
}`;
  }

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
  ${phaseName === 'exploration' && prdFeatures.length > 0 ? '"featureCoverage": [...],\n  ' : ''}"summary": "Brief summary of analysis"
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

  const prompt = interpolated + dataSection + prdSection + qualityInstructions + urlRequirements + featureVerificationSection + outputInstruction;

  const response = await llmClient.complete(prompt, {
    maxTokens: 8192,
    temperature: 0,
  });

  recordCost(enrichedContext, response);

  // Step 4: Extract feature coverage from response (exploration phase only)
  if (phaseName === 'exploration' && prdFeatures.length > 0) {
    try {
      const jsonMatch = response.content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : response.content;
      const parsed = JSON.parse(jsonStr.trim());
      if (parsed.featureCoverage && Array.isArray(parsed.featureCoverage)) {
        const coverage: FeatureCoverage[] = parsed.featureCoverage.map((fc: any) => ({
          featureId: fc.featureId || '',
          featureName: prdFeatures.find((f: any) => f.id === fc.featureId)?.name || '',
          priority: prdFeatures.find((f: any) => f.id === fc.featureId)?.priority || 'must',
          status: fc.status || 'not_checked',
          checkedCriteria: Array.isArray(fc.checkedCriteria) ? fc.checkedCriteria : [],
        }));
        saveFeatureCoverage(context.auditDir, coverage);
        console.log(`[Dispatcher] exploration: saved feature coverage for ${coverage.length} features`);
      }
    } catch {
      console.warn('[Dispatcher] exploration: could not extract featureCoverage from LLM response');
    }
  }

  // Step 5: Extract findings from LLM response and filter through quality gates
  const extractedFindings = extractFindings(response.content);
  if (extractedFindings.length > 0) {
    // Run quality gate filters
    const filterResult = filterFindings(extractedFindings, visitedPages);

    if (filterResult.rejected.length > 0) {
      console.log(`[Dispatcher] ${phaseName}: rejected ${filterResult.rejected.length} non-findings:`);
      for (const r of filterResult.rejected) {
        console.log(`  - ${(r.finding.id || 'unknown')}: [${r.filter}] ${r.reason}`);
      }
    }

    // Save only accepted findings to disk
    const findingDir = getFindingDir(context.auditDir);
    fs.mkdirSync(findingDir, { recursive: true });

    for (const finding of filterResult.accepted) {
      const findingId = (finding.id as string) || `F-${String(filterResult.accepted.indexOf(finding) + 1).padStart(3, '0')}`;
      finding.id = findingId;
      finding.phase = phaseName;
      finding.discovered_at = new Date().toISOString();

      const findingPath = path.join(findingDir, `${findingId}.json`);
      fs.writeFileSync(findingPath, JSON.stringify(finding, null, 2), 'utf-8');
    }

    console.log(`[Dispatcher] ${phaseName}: accepted ${filterResult.accepted.length}/${extractedFindings.length} findings`);
  }

  return {
    success: true,
    output: response.content,
    phaseType: 'browser-claude',
    durationMs: Date.now() - start,
  };
}

/**
 * Handle the verification phase in verification-only mode.
 * Loads existing findings and asks the LLM to verify them, not create new ones.
 * Updates existing finding files with verification status.
 */
async function dispatchVerificationPhase(
  phaseName: PhaseName,
  llmClient: LLMClient,
  context: DispatchContext & { browserData?: Record<string, unknown> },
  interpolated: string,
  dataSection: string,
  qualityInstructions: string,
  urlRequirements: string,
  visitedPages: string[],
  start: number,
): Promise<PhaseDispatchResult> {
  // Load existing findings
  const findingDir = getFindingDir(context.auditDir);
  const existingFindings: Record<string, unknown>[] = [];
  if (fs.existsSync(findingDir)) {
    const files = fs.readdirSync(findingDir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(findingDir, file), 'utf-8'));
        existingFindings.push(data);
      } catch { /* skip unparseable */ }
    }
  }

  const findingsList = existingFindings.map((f: any) =>
    `- ${f.id}: "${f.title}" [${f.severity}] at ${f.url || 'N/A'}\n  Description: ${(f.description || '').substring(0, 200)}`
  ).join('\n');

  const verificationPrompt = `${interpolated}${dataSection}${qualityInstructions}${urlRequirements}

## Verification Mode

You are ONLY verifying existing findings. Do NOT create new findings.
For each finding below, check whether it can be reproduced with the current page data.

Existing findings to verify:
${findingsList || '(no existing findings)'}

For each finding, report:
\`\`\`json
{
  "verifications": [
    {
      "findingId": "F-001",
      "verificationStatus": "verified" | "flaky" | "false_positive",
      "evidence": "what you observed"
    }
  ],
  "summary": "Brief summary of verification results"
}
\`\`\`

IMPORTANT: Do NOT add new findings. Only verify the ones listed above.`;

  const response = await llmClient.complete(verificationPrompt, {
    maxTokens: 8192,
    temperature: 0,
  });

  recordCost(context, response);

  // Parse verification results and update existing finding files
  try {
    const jsonMatch = response.content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : response.content;
    const parsed = JSON.parse(jsonStr.trim());
    const verifications = parsed.verifications || parsed.findings || [];

    if (Array.isArray(verifications) && fs.existsSync(findingDir)) {
      for (const v of verifications) {
        const findingId = v.findingId || v.id;
        if (!findingId) continue;
        const findingPath = path.join(findingDir, `${findingId}.json`);
        if (fs.existsSync(findingPath)) {
          try {
            const findingData = JSON.parse(fs.readFileSync(findingPath, 'utf-8'));
            findingData.verificationStatus = v.verificationStatus || v.status || 'unverified';
            findingData.verificationEvidence = v.evidence || '';
            findingData.verified_at = new Date().toISOString();
            fs.writeFileSync(findingPath, JSON.stringify(findingData, null, 2), 'utf-8');
          } catch { /* skip */ }
        }
      }
      console.log(`[Dispatcher] verification: updated ${verifications.length} existing findings`);
    }
  } catch {
    console.warn('[Dispatcher] verification: could not parse verification results from LLM response');
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
