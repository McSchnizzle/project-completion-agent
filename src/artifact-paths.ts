/**
 * Artifact Path Conventions - Centralized path management for audit artifacts.
 *
 * Every file produced or consumed by the audit pipeline is located through
 * the helpers in this module. This ensures consistent directory layout
 * across phases, makes resume/checkpoint logic reliable, and provides a
 * single place to update if the layout ever changes.
 *
 * Standard directory structure:
 *   {basePath}/.complete-agent/audits/current/
 *     config.yml
 *     progress.json
 *     checkpoint.json
 *     prd-summary.json
 *     code-analysis.json
 *     coverage-summary.md
 *     report.md
 *     review-decisions.json
 *     created-issues.json
 *     test-data-created.json
 *     audit-log.jsonl
 *     audit-metrics.json
 *     pages/
 *       page-0.json
 *       page-1.json
 *     findings/
 *       {id}.json
 *     screenshots/
 *     dashboard/
 *       index.html
 *
 * @module artifact-paths
 */

import path from 'node:path';
import fs from 'node:fs';

// ---------------------------------------------------------------------------
// Root directories
// ---------------------------------------------------------------------------

/**
 * Return the canonical audit output directory for a project.
 *
 * @param basePath - The project root (e.g. the codebase being audited).
 * @returns Absolute path to `.complete-agent/audits/current/`.
 */
export function getAuditDir(basePath: string): string {
  return path.join(basePath, '.complete-agent', 'audits', 'current');
}

/** Directory that holds per-page inventory JSON files. */
export function getPageDir(auditDir: string): string {
  return path.join(auditDir, 'pages');
}

/** Directory that holds individual finding JSON files. */
export function getFindingDir(auditDir: string): string {
  return path.join(auditDir, 'findings');
}

/** Directory that holds captured screenshots. */
export function getScreenshotDir(auditDir: string): string {
  return path.join(auditDir, 'screenshots');
}

/** Directory that holds the HTML dashboard. */
export function getDashboardDir(auditDir: string): string {
  return path.join(auditDir, 'dashboard');
}

// ---------------------------------------------------------------------------
// Page artifacts
// ---------------------------------------------------------------------------

/**
 * Path to a specific page inventory file.
 *
 * @param auditDir - The audit output directory.
 * @param n - Zero-based page index.
 * @returns Absolute path to `pages/page-{n}.json`.
 */
export function getPagePath(auditDir: string, n: number): string {
  return path.join(auditDir, 'pages', `page-${n}.json`);
}

// ---------------------------------------------------------------------------
// Finding artifacts
// ---------------------------------------------------------------------------

/**
 * Path to a specific finding file.
 *
 * @param auditDir - The audit output directory.
 * @param id - The unique finding identifier (e.g. `F-001`).
 * @returns Absolute path to `findings/{id}.json`.
 */
export function getFindingPath(auditDir: string, id: string): string {
  return path.join(auditDir, 'findings', `${id}.json`);
}

// ---------------------------------------------------------------------------
// Top-level audit files
// ---------------------------------------------------------------------------

/** Pipeline progress tracker. */
export function getProgressPath(auditDir: string): string {
  return path.join(auditDir, 'progress.json');
}

/** Checkpoint file for resume support. */
export function getCheckpointPath(auditDir: string): string {
  return path.join(auditDir, 'checkpoint.json');
}

/** YAML configuration snapshot for the audit run. */
export function getConfigPath(auditDir: string): string {
  return path.join(auditDir, 'config.yml');
}

/** Parsed PRD summary produced by the prd-parsing phase. */
export function getPrdSummaryPath(auditDir: string): string {
  return path.join(auditDir, 'prd-summary.json');
}

/** Static code analysis results. */
export function getCodeAnalysisPath(auditDir: string): string {
  return path.join(auditDir, 'code-analysis.json');
}

/** Markdown summary of page/route coverage. */
export function getCoverageSummaryPath(auditDir: string): string {
  return path.join(auditDir, 'coverage-summary.md');
}

/** Final human-readable audit report. */
export function getReportPath(auditDir: string): string {
  return path.join(auditDir, 'report.md');
}

/** Decisions made during the interactive review phase. */
export function getReviewDecisionsPath(auditDir: string): string {
  return path.join(auditDir, 'review-decisions.json');
}

/** Record of GitHub issues created from findings. */
export function getCreatedIssuesPath(auditDir: string): string {
  return path.join(auditDir, 'created-issues.json');
}

/** Test data injected into the application during testing. */
export function getTestDataPath(auditDir: string): string {
  return path.join(auditDir, 'test-data-created.json');
}

/** Append-only JSON-lines log of all audit events. */
export function getAuditLogPath(auditDir: string): string {
  return path.join(auditDir, 'audit-log.jsonl');
}

/** Aggregated timing and cost metrics for the audit. */
export function getMetricsPath(auditDir: string): string {
  return path.join(auditDir, 'audit-metrics.json');
}

/** Entry point for the live HTML dashboard. */
export function getDashboardPath(auditDir: string): string {
  return path.join(auditDir, 'dashboard', 'index.html');
}

// ---------------------------------------------------------------------------
// Directory creation
// ---------------------------------------------------------------------------

/**
 * Create the full directory tree expected by the audit pipeline.
 *
 * Safe to call repeatedly -- existing directories are left untouched.
 *
 * @param auditDir - The audit output directory (from {@link getAuditDir}).
 */
export function ensureDirectories(auditDir: string): void {
  const dirs = [
    auditDir,
    getPageDir(auditDir),
    getFindingDir(auditDir),
    getScreenshotDir(auditDir),
    getDashboardDir(auditDir),
  ];

  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
