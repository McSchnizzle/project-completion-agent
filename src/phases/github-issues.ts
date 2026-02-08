/**
 * GitHub Issues Phase - Creates GitHub issues for accepted findings.
 *
 * Uses the `gh` CLI to create issues. Skips gracefully if `gh` is
 * not installed or not authenticated.
 *
 * Features:
 * - Duplicate detection via `gh issue list` search
 * - Severity-based labels (P0=critical, P1=high, P2=medium, P3=low)
 * - Rich markdown formatting with screenshots, reproduction steps, PRD refs
 * - Batch creation with rate limiting
 * - Tracks created issues in created-issues.json
 *
 * @module phases/github-issues
 */

import fs from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import {
  getFindingDir,
  getReviewDecisionsPath,
  getCreatedIssuesPath,
} from '../artifact-paths.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreatedIssue {
  findingId: string;
  issueNumber: number;
  issueUrl: string;
  title: string;
  labels: string[];
  createdAt: string;
}

export interface IssueCreationResult {
  created: CreatedIssue[];
  skipped: string[];
  duplicates: Array<{ findingId: string; existingIssue: number }>;
  errors: Array<{ findingId: string; error: string }>;
  ghAvailable: boolean;
}

// ---------------------------------------------------------------------------
// Severity -> label mapping
// ---------------------------------------------------------------------------

const SEVERITY_LABELS: Record<string, string> = {
  P0: 'priority: critical',
  P1: 'priority: high',
  P2: 'priority: medium',
  P3: 'priority: low',
  P4: 'priority: trivial',
};

const SEVERITY_BADGE: Record<string, string> = {
  P0: '![P0](https://img.shields.io/badge/severity-P0%20Critical-red)',
  P1: '![P1](https://img.shields.io/badge/severity-P1%20High-orange)',
  P2: '![P2](https://img.shields.io/badge/severity-P2%20Medium-yellow)',
  P3: '![P3](https://img.shields.io/badge/severity-P3%20Low-blue)',
  P4: '![P4](https://img.shields.io/badge/severity-P4%20Trivial-lightgrey)',
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Create GitHub issues for accepted findings.
 */
export async function createGitHubIssues(
  auditDir: string,
  codebasePath: string,
  options: { rateLimitMs?: number; dryRun?: boolean } = {},
): Promise<IssueCreationResult> {
  const { rateLimitMs = 2000, dryRun = false } = options;

  const result: IssueCreationResult = {
    created: [],
    skipped: [],
    duplicates: [],
    errors: [],
    ghAvailable: false,
  };

  if (!isGhAvailable()) {
    console.log('[Issues] GitHub CLI (gh) not available. Skipping issue creation.');
    writeResult(auditDir, result);
    return result;
  }
  result.ghAvailable = true;

  if (!isGhAuthenticated()) {
    console.log('[Issues] GitHub CLI not authenticated. Run `gh auth login` first.');
    writeResult(auditDir, result);
    return result;
  }

  // Load review decisions
  const decisions = loadReviewDecisions(auditDir);
  const acceptedIds = new Set(
    decisions.filter((d) => d.decision === 'accepted').map((d) => d.findingId),
  );

  if (acceptedIds.size === 0) {
    console.log('[Issues] No accepted findings to create issues for.');
    writeResult(auditDir, result);
    return result;
  }

  // Load accepted findings
  const findings = loadAcceptedFindings(auditDir, acceptedIds);
  console.log(`[Issues] Creating ${findings.length} GitHub issue(s)...`);

  // Get existing issues for dedup
  const existingTitles = fetchExistingIssueTitles(codebasePath);

  for (let i = 0; i < findings.length; i++) {
    const finding = findings[i];
    const candidateTitle = buildIssueTitle(finding);

    // Duplicate check
    const duplicate = findDuplicate(candidateTitle, finding, existingTitles);
    if (duplicate) {
      result.duplicates.push({ findingId: finding.id, existingIssue: duplicate });
      console.log(`  Skipped ${finding.id}: duplicate of #${duplicate}`);
      continue;
    }

    if (dryRun) {
      result.skipped.push(finding.id);
      console.log(`  [DRY RUN] Would create: ${candidateTitle}`);
      continue;
    }

    try {
      const issue = createIssue(finding, codebasePath);
      result.created.push(issue);
      console.log(`  Created #${issue.issueNumber}: ${issue.title}`);

      // Rate limiting between creates
      if (i < findings.length - 1 && rateLimitMs > 0) {
        await sleep(rateLimitMs);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      result.errors.push({ findingId: finding.id, error: msg });
      console.log(`  Failed for ${finding.id}: ${msg}`);
    }
  }

  writeResult(auditDir, result);

  console.log(
    `[Issues] Done: ${result.created.length} created, ` +
    `${result.duplicates.length} duplicates, ` +
    `${result.errors.length} failed.`,
  );

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isGhAvailable(): boolean {
  try {
    execSync('which gh', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function isGhAuthenticated(): boolean {
  try {
    execSync('gh auth status', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

interface ReviewDecision {
  findingId: string;
  decision: string;
}

function loadReviewDecisions(auditDir: string): ReviewDecision[] {
  const decPath = getReviewDecisionsPath(auditDir);
  if (!fs.existsSync(decPath)) return [];

  try {
    const data = JSON.parse(fs.readFileSync(decPath, 'utf-8'));
    return Array.isArray(data.decisions) ? data.decisions : [];
  } catch {
    return [];
  }
}

interface Finding {
  id: string;
  title: string;
  severity: string;
  type?: string;
  category: string;
  description?: string;
  steps_to_reproduce?: string[];
  expected_behavior?: string;
  actual_behavior?: string;
  url?: string;
  location?: { url?: string; file?: string; line?: number };
  evidence?: {
    screenshots?: string[];
    console_errors?: string[];
    network_requests?: string[];
  };
  prd_section?: string;
  prd_requirement?: string;
  confidence?: number;
  component?: string;
  fix_suggestion?: string;
  screenshot_id?: string;
}

function loadAcceptedFindings(auditDir: string, acceptedIds: Set<string>): Finding[] {
  const findingDir = getFindingDir(auditDir);
  if (!fs.existsSync(findingDir)) return [];

  const findings: Finding[] = [];
  const files = fs.readdirSync(findingDir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(findingDir, file), 'utf-8'));
      const id = data.id ?? path.basename(file, '.json');
      if (acceptedIds.has(id)) {
        findings.push({ id, ...data });
      }
    } catch {
      // skip
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

interface ExistingIssue {
  number: number;
  title: string;
}

export function fetchExistingIssueTitles(cwd: string): ExistingIssue[] {
  try {
    const output = execSync(
      'gh issue list --state all --label audit-finding --limit 200 --json number,title',
      { cwd, encoding: 'utf-8', timeout: 15_000 },
    ).trim();

    if (!output) return [];
    return JSON.parse(output) as ExistingIssue[];
  } catch {
    return [];
  }
}

function findDuplicate(
  candidateTitle: string,
  finding: Finding,
  existingIssues: ExistingIssue[],
): number | null {
  const candidateLower = candidateTitle.toLowerCase();
  const findingTitleLower = finding.title.toLowerCase();

  for (const existing of existingIssues) {
    const existingLower = existing.title.toLowerCase();

    // Exact title match
    if (existingLower === candidateLower) return existing.number;

    // The finding title (without severity prefix) is contained
    if (existingLower.includes(findingTitleLower)) return existing.number;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Issue creation
// ---------------------------------------------------------------------------

function buildIssueTitle(finding: Finding): string {
  return `[Audit] ${finding.severity?.toUpperCase() ?? 'INFO'}: ${finding.title}`;
}

function buildLabels(finding: Finding): string[] {
  const labels = ['audit-finding'];

  const severityLabel = SEVERITY_LABELS[finding.severity?.toUpperCase() ?? ''];
  if (severityLabel) labels.push(severityLabel);

  if (finding.type) labels.push(`type: ${finding.type}`);

  if (finding.component) labels.push(`component: ${finding.component}`);

  return labels;
}

/**
 * Shell-escape a string for safe inclusion in a shell command.
 * Wraps in single quotes and escapes any embedded single quotes.
 */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function createIssue(finding: Finding, cwd: string): CreatedIssue {
  const title = buildIssueTitle(finding);
  const body = formatIssueBody(finding);
  const labels = buildLabels(finding);

  // Sanitize labels: remove characters that break shell quoting, then shellEscape
  const sanitizedLabels = labels.map((l) => l.replace(/["'`\\$]/g, ''));
  const labelArgs = sanitizedLabels.map((l) => `--label ${shellEscape(l)}`).join(' ');

  // Write body to temp file to avoid shell escaping issues
  const tmpBody = path.join(
    cwd,
    '.complete-agent',
    'audits',
    'current',
    `.issue-body-${finding.id}.tmp`,
  );

  // Ensure parent directory exists
  const tmpDir = path.dirname(tmpBody);
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  fs.writeFileSync(tmpBody, body, 'utf-8');

  try {
    const output = execSync(
      `gh issue create --title ${shellEscape(title)} --body-file ${shellEscape(tmpBody)} ${labelArgs}`,
      { cwd, encoding: 'utf-8', timeout: 30_000 },
    ).trim();

    const issueUrl = output.split('\n').pop() ?? output;
    const issueNumber = parseInt(issueUrl.split('/').pop() ?? '0', 10);

    return {
      findingId: finding.id,
      issueNumber,
      issueUrl,
      title,
      labels,
      createdAt: new Date().toISOString(),
    };
  } finally {
    try {
      fs.unlinkSync(tmpBody);
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Markdown formatting
// ---------------------------------------------------------------------------

export function formatIssueBody(finding: Finding): string {
  const lines: string[] = [];

  // Severity badge
  const badge = SEVERITY_BADGE[finding.severity?.toUpperCase() ?? ''];
  if (badge) {
    lines.push(badge, '');
  }

  lines.push(`## ${finding.title}`, '');

  // Metadata table
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| **Severity** | ${finding.severity ?? 'unknown'} |`);
  lines.push(`| **Type** | ${finding.type ?? finding.category ?? 'uncategorized'} |`);

  if (finding.confidence != null) {
    lines.push(`| **Confidence** | ${finding.confidence}/100 |`);
  }

  const locationUrl = finding.location?.url ?? finding.url;
  if (locationUrl) {
    lines.push(`| **URL** | ${locationUrl} |`);
  }

  if (finding.location?.file) {
    const fileLoc = finding.location.line
      ? `${finding.location.file}:${finding.location.line}`
      : finding.location.file;
    lines.push(`| **File** | \`${fileLoc}\` |`);
  }

  if (finding.component) {
    lines.push(`| **Component** | ${finding.component} |`);
  }

  lines.push('');

  // PRD reference
  if (finding.prd_section || finding.prd_requirement) {
    lines.push('### PRD Reference', '');
    if (finding.prd_section) {
      lines.push(`**Section:** ${finding.prd_section}`);
    }
    if (finding.prd_requirement) {
      lines.push(`**Requirement:** ${finding.prd_requirement}`);
    }
    lines.push('');
  }

  // Description
  if (finding.description) {
    lines.push('### Description', '', finding.description, '');
  }

  // Steps to reproduce
  if (finding.steps_to_reproduce?.length) {
    lines.push('### Steps to Reproduce', '');
    finding.steps_to_reproduce.forEach((step, i) => {
      lines.push(`${i + 1}. ${step}`);
    });
    lines.push('');
  }

  // Expected vs actual behavior
  if (finding.expected_behavior) {
    lines.push('### Expected Behavior', '', finding.expected_behavior, '');
  }

  if (finding.actual_behavior) {
    lines.push('### Actual Behavior', '', finding.actual_behavior, '');
  }

  // Evidence
  const evidence = finding.evidence;
  if (evidence) {
    const hasEvidence =
      (evidence.console_errors?.length ?? 0) > 0 ||
      (evidence.network_requests?.length ?? 0) > 0 ||
      (evidence.screenshots?.length ?? 0) > 0;

    if (hasEvidence) {
      lines.push('### Evidence', '');

      if (evidence.console_errors?.length) {
        lines.push('**Console Errors:**');
        lines.push('```');
        evidence.console_errors.forEach((err) => lines.push(err));
        lines.push('```', '');
      }

      if (evidence.network_requests?.length) {
        lines.push('**Network Requests:**');
        lines.push('```');
        evidence.network_requests.forEach((req) => lines.push(req));
        lines.push('```', '');
      }

      if (evidence.screenshots?.length) {
        lines.push('**Screenshots:**');
        evidence.screenshots.forEach((s) => lines.push(`- ${s}`));
        lines.push('');
      }
    }
  }

  // Fix suggestion
  if (finding.fix_suggestion) {
    lines.push('### Suggested Fix', '', finding.fix_suggestion, '');
  }

  lines.push('---', '*Generated by Project Completion Agent audit*');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Result persistence
// ---------------------------------------------------------------------------

function writeResult(auditDir: string, result: IssueCreationResult): void {
  const outPath = getCreatedIssuesPath(auditDir);
  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
}
