/**
 * Exploration Phase - Visits pages and builds page inventory.
 *
 * Uses Claude Agent SDK with browser MCP to navigate the application,
 * capture page data, and build a comprehensive inventory.
 *
 * @module phases/exploration
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  getPageDir,
  getPagePath,
} from '../artifact-paths';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExplorationConfig {
  auditDir: string;
  baseUrl: string;
  routes: string[];
  maxPages: number;
  promptPath: string;
}

export interface ExplorationResult {
  pagesVisited: number;
  pagesWritten: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Run the exploration phase.
 *
 * This function prepares the exploration context and delegates to the
 * SDK bridge for actual browser exploration. The Claude agent receives
 * the route list and visits each page, writing page-{n}.json files.
 *
 * @param config - Exploration configuration.
 * @param runClaudePhase - SDK bridge function for Claude calls.
 * @returns Exploration results.
 */
export async function runExploration(
  config: ExplorationConfig,
  runClaudePhase: (phaseConfig: {
    phaseName: string;
    promptPath: string;
    inputContext: Record<string, unknown>;
    requiresBrowser: boolean;
    maxRetries: number;
    budgetUsd: number;
  }) => Promise<{ success: boolean; output: unknown; error?: string }>,
): Promise<ExplorationResult> {
  const result: ExplorationResult = {
    pagesVisited: 0,
    pagesWritten: [],
    errors: [],
  };

  // Ensure page directory exists
  const pageDir = getPageDir(config.auditDir);
  fs.mkdirSync(pageDir, { recursive: true });

  // Limit routes to maxPages
  const routesToVisit = config.routes.slice(0, config.maxPages);

  console.log(
    `[Exploration] Starting: ${routesToVisit.length} routes to visit (max ${config.maxPages})`,
  );

  // Call Claude agent with exploration prompt
  const phaseResult = await runClaudePhase({
    phaseName: 'exploration',
    promptPath: config.promptPath,
    inputContext: {
      baseUrl: config.baseUrl,
      routes: routesToVisit,
      maxPages: config.maxPages,
      auditDir: config.auditDir,
    },
    requiresBrowser: true,
    maxRetries: 2,
    budgetUsd: 1.0,
  });

  if (!phaseResult.success) {
    result.errors.push(phaseResult.error ?? 'Exploration failed');
    return result;
  }

  // Count pages written by the agent
  if (fs.existsSync(pageDir)) {
    const pageFiles = fs.readdirSync(pageDir).filter(f => f.endsWith('.json'));
    result.pagesVisited = pageFiles.length;
    result.pagesWritten = pageFiles.map(f => path.join(pageDir, f));
  }

  console.log(`[Exploration] Complete: ${result.pagesVisited} pages visited.`);

  return result;
}

/**
 * Validate page files written by the exploration agent.
 *
 * @param auditDir - The audit output directory.
 * @returns List of valid and invalid page file paths.
 */
export function validatePageFiles(
  auditDir: string,
): { valid: string[]; invalid: string[] } {
  const pageDir = getPageDir(auditDir);
  if (!fs.existsSync(pageDir)) return { valid: [], invalid: [] };

  const valid: string[] = [];
  const invalid: string[] = [];

  const files = fs.readdirSync(pageDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    const filePath = path.join(pageDir, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      // Minimum validation: must have url field
      if (data.url) {
        valid.push(filePath);
      } else {
        invalid.push(filePath);
      }
    } catch {
      invalid.push(filePath);
    }
  }

  return { valid, invalid };
}
