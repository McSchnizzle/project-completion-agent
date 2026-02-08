/**
 * Responsive Testing Phase - Tests viewport sizes for layout issues.
 *
 * Resizes the browser to mobile, tablet, and desktop viewports,
 * then checks key pages for layout problems.
 *
 * @module phases/responsive-testing
 */

import fs from 'node:fs';
import { getFindingDir, getPageDir } from '../artifact-paths';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResponsiveConfig {
  auditDir: string;
  baseUrl: string;
  promptPath: string;
  viewports?: Viewport[];
}

export interface Viewport {
  name: string;
  width: number;
  height: number;
}

export interface ResponsiveResult {
  viewportsTested: number;
  pagesChecked: number;
  findingsCreated: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_VIEWPORTS: Viewport[] = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Run responsive testing phase.
 *
 * @param config - Responsive testing configuration.
 * @param runClaudePhase - SDK bridge function.
 * @returns Responsive testing results.
 */
export async function runResponsiveTesting(
  config: ResponsiveConfig,
  runClaudePhase: (phaseConfig: {
    phaseName: string;
    promptPath: string;
    inputContext: Record<string, unknown>;
    requiresBrowser: boolean;
    maxRetries: number;
    budgetUsd: number;
  }) => Promise<{ success: boolean; output: unknown; error?: string }>,
): Promise<ResponsiveResult> {
  const viewports = config.viewports ?? DEFAULT_VIEWPORTS;
  const result: ResponsiveResult = {
    viewportsTested: 0,
    pagesChecked: 0,
    findingsCreated: 0,
    errors: [],
  };

  // Get key pages to test from page inventory
  const keyPages = getKeyPages(config.auditDir);

  if (keyPages.length === 0) {
    console.log('[Responsive] No pages to test.');
    return result;
  }

  console.log(
    `[Responsive] Testing ${keyPages.length} page(s) across ${viewports.length} viewports`,
  );

  // Call Claude agent
  const phaseResult = await runClaudePhase({
    phaseName: 'responsive-testing',
    promptPath: config.promptPath,
    inputContext: {
      baseUrl: config.baseUrl,
      viewports,
      pages: keyPages,
      auditDir: config.auditDir,
      checks: [
        'horizontal-overflow',
        'truncated-text',
        'overlapping-elements',
        'broken-navigation',
        'touch-target-size',
        'font-readability',
      ],
    },
    requiresBrowser: true,
    maxRetries: 2,
    budgetUsd: 0.5,
  });

  if (!phaseResult.success) {
    result.errors.push(phaseResult.error ?? 'Responsive testing failed');
    return result;
  }

  result.viewportsTested = viewports.length;
  result.pagesChecked = keyPages.length;

  // Count findings
  const findingDir = getFindingDir(config.auditDir);
  if (fs.existsSync(findingDir)) {
    const files = fs.readdirSync(findingDir).filter(f =>
      f.endsWith('.json') && f.includes('responsive'),
    );
    result.findingsCreated = files.length;
  }

  console.log(
    `[Responsive] Complete: ${result.pagesChecked} pages, ${result.viewportsTested} viewports, ${result.findingsCreated} findings.`,
  );

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getKeyPages(auditDir: string): string[] {
  const pageDir = getPageDir(auditDir);
  if (!fs.existsSync(pageDir)) return [];

  const urls: string[] = [];
  const files = fs.readdirSync(pageDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(pageDir, file), 'utf-8'));
      if (data.url) urls.push(data.url);
    } catch {
      // skip
    }
  }

  // Return up to 10 key pages (prioritize those with forms or interactions)
  return urls.slice(0, 10);
}
