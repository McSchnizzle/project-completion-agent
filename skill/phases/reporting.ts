/**
 * Reporting Phase - Report Generation and Issue Creation
 * Task B.9: Reporting Helpers
 *
 * Generates review decisions, creates GitHub issues,
 * and formats issue bodies with reproduction steps.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Finding } from './finding-quality';

export interface ReviewDecision {
  finding_id: string;
  title: string;
  severity: string;
  decision: 'create-issue' | 'skip' | 'defer' | 'merge';
  reason: string;
  merged_with: string | null;
  reviewed_at: string;
}

export interface ReviewDecisionsJson {
  schema_version: string;
  audit_id: string;
  reviewed_at: string;
  total_findings: number;
  decisions: {
    create_issue: number;
    skip: number;
    defer: number;
    merge: number;
  };
  entries: ReviewDecision[];
}

export interface CreatedIssue {
  finding_id: string;
  issue_number: number;
  issue_url: string;
  title: string;
  labels: string[];
  created_at: string;
}

export interface CreatedIssuesJson {
  schema_version: string;
  audit_id: string;
  repo: string;
  created_at: string;
  total_issues: number;
  issues: CreatedIssue[];
}

export interface IssueBody {
  title: string;
  body: string;
  labels: string[];
}

/**
 * Generate review decisions from findings
 */
export function generateReviewDecisions(
  findings: Finding[],
  existingDecisions: Map<string, 'skip' | 'defer'> = new Map()
): ReviewDecision[] {
  const decisions: ReviewDecision[] = [];

  for (const finding of findings) {
    // Check for existing user decision
    const userDecision = existingDecisions.get(finding.id);
    if (userDecision) {
      decisions.push({
        finding_id: finding.id,
        title: finding.title,
        severity: finding.severity,
        decision: userDecision,
        reason: `User decision: ${userDecision}`,
        merged_with: null,
        reviewed_at: new Date().toISOString()
      });
      continue;
    }

    // Default decision logic
    let decision: ReviewDecision['decision'] = 'create-issue';
    let reason = 'Meets quality criteria for issue creation';

    // Skip false positives
    if (finding.verification_status === 'false-positive') {
      decision = 'skip';
      reason = 'Verified as false positive';
    }

    // Skip low confidence findings
    if (finding.confidence < 0.3) {
      decision = 'skip';
      reason = `Low confidence: ${Math.round(finding.confidence * 100)}%`;
    }

    // Defer flaky findings
    if (finding.verification_status === 'flaky') {
      decision = 'defer';
      reason = 'Finding is flaky - needs investigation';
    }

    // Skip P4 findings by default
    if (finding.severity === 'P4') {
      decision = 'defer';
      reason = 'Low severity - deferred for future consideration';
    }

    decisions.push({
      finding_id: finding.id,
      title: finding.title,
      severity: finding.severity,
      decision,
      reason,
      merged_with: null,
      reviewed_at: new Date().toISOString()
    });
  }

  return decisions;
}

/**
 * Generate review decisions JSON
 */
export function generateReviewDecisionsJson(
  auditId: string,
  decisions: ReviewDecision[]
): ReviewDecisionsJson {
  return {
    schema_version: '1.0.0',
    audit_id: auditId,
    reviewed_at: new Date().toISOString(),
    total_findings: decisions.length,
    decisions: {
      create_issue: decisions.filter(d => d.decision === 'create-issue').length,
      skip: decisions.filter(d => d.decision === 'skip').length,
      defer: decisions.filter(d => d.decision === 'defer').length,
      merge: decisions.filter(d => d.decision === 'merge').length
    },
    entries: decisions
  };
}

/**
 * Generate created issues JSON
 */
export function generateCreatedIssuesJson(
  auditId: string,
  repo: string,
  issues: CreatedIssue[]
): CreatedIssuesJson {
  return {
    schema_version: '1.0.0',
    audit_id: auditId,
    repo,
    created_at: new Date().toISOString(),
    total_issues: issues.length,
    issues
  };
}

/**
 * Format issue body for GitHub
 */
export function formatIssueBody(finding: Finding): IssueBody {
  const lines: string[] = [];

  // Header with severity badge
  const severityEmoji = getSeverityEmoji(finding.severity);
  lines.push(`## ${severityEmoji} ${finding.severity} - ${finding.category}`);
  lines.push('');

  // Description
  lines.push('### Description');
  lines.push('');
  lines.push(finding.description);
  lines.push('');

  // Location
  if (finding.url || finding.file_path) {
    lines.push('### Location');
    lines.push('');
    if (finding.url) {
      lines.push(`**URL:** ${finding.url}`);
    }
    if (finding.file_path) {
      lines.push(`**File:** \`${finding.file_path}${finding.line_number ? `:${finding.line_number}` : ''}\``);
    }
    lines.push('');
  }

  // Reproduction Steps
  if (finding.reproduction_steps.length > 0) {
    lines.push('### Steps to Reproduce');
    lines.push('');
    finding.reproduction_steps.forEach((step, i) => {
      lines.push(`${i + 1}. ${step}`);
    });
    lines.push('');
  }

  // Evidence
  if (finding.evidence.length > 0) {
    lines.push('### Evidence');
    lines.push('');
    for (const evidence of finding.evidence) {
      if (evidence.type === 'screenshot') {
        lines.push(`**Screenshot:** ${evidence.description}`);
        lines.push(`![${evidence.description}](${evidence.data})`);
      } else if (evidence.type === 'code-snippet') {
        lines.push(`**Code:**`);
        lines.push('```');
        lines.push(evidence.data);
        lines.push('```');
      } else if (evidence.type === 'console-log') {
        lines.push(`**Console Output:**`);
        lines.push('```');
        lines.push(evidence.data);
        lines.push('```');
      } else {
        lines.push(`**${evidence.type}:** ${evidence.description}`);
      }
      lines.push('');
    }
  }

  // Metadata
  lines.push('---');
  lines.push('');
  lines.push('<details>');
  lines.push('<summary>Audit Metadata</summary>');
  lines.push('');
  lines.push(`- **Finding ID:** ${finding.id}`);
  lines.push(`- **Source:** ${finding.source}`);
  lines.push(`- **Confidence:** ${Math.round(finding.confidence * 100)}%`);
  lines.push(`- **Verification:** ${finding.verification_status}`);
  lines.push(`- **Generated:** ${finding.created_at}`);
  lines.push('');
  lines.push('</details>');
  lines.push('');
  lines.push('---');
  lines.push('*Generated by Complete Audit Skill*');

  // Generate labels
  const labels = generateLabels(finding);

  return {
    title: `[${finding.severity}] ${finding.title}`,
    body: lines.join('\n'),
    labels
  };
}

/**
 * Get emoji for severity level
 */
function getSeverityEmoji(severity: string): string {
  const emojis: Record<string, string> = {
    P0: '🔴',
    P1: '🟠',
    P2: '🟡',
    P3: '🔵',
    P4: '⚪'
  };
  return emojis[severity] || '❓';
}

/**
 * Generate labels for a finding
 */
function generateLabels(finding: Finding): string[] {
  const labels: string[] = [];

  // Severity label
  labels.push(`priority:${finding.severity.toLowerCase()}`);

  // Category label
  const categoryLabel = finding.category.toLowerCase().replace(/\s+/g, '-');
  labels.push(categoryLabel);

  // Type labels based on category
  if (finding.category.includes('security')) {
    labels.push('security');
  }
  if (finding.category.includes('accessibility')) {
    labels.push('a11y');
  }
  if (finding.category.includes('performance')) {
    labels.push('performance');
  }
  if (finding.category.includes('ux') || finding.category.includes('ui')) {
    labels.push('ux');
  }

  // Bug label
  labels.push('bug');

  // Audit label
  labels.push('audit-finding');

  return [...new Set(labels)];
}

/**
 * Format gh CLI command for issue creation
 */
export function formatGhCreateCommand(
  issueBody: IssueBody,
  repo: string
): string {
  const labelsArg = issueBody.labels.length > 0
    ? `--label "${issueBody.labels.join(',')}"`
    : '';

  // Escape special characters in title and body
  const escapedTitle = issueBody.title.replace(/"/g, '\\"');

  return `gh issue create --repo "${repo}" --title "${escapedTitle}" ${labelsArg} --body-file -`;
}

/**
 * Record created issue
 */
export function recordCreatedIssue(
  findingId: string,
  issueNumber: number,
  issueUrl: string,
  title: string,
  labels: string[]
): CreatedIssue {
  return {
    finding_id: findingId,
    issue_number: issueNumber,
    issue_url: issueUrl,
    title,
    labels,
    created_at: new Date().toISOString()
  };
}

/**
 * Write review decisions to file
 */
export function writeReviewDecisions(auditPath: string, decisions: ReviewDecisionsJson): void {
  const filePath = path.join(auditPath, 'review-decisions.json');
  fs.writeFileSync(filePath, JSON.stringify(decisions, null, 2));
}

/**
 * Write created issues to file
 */
export function writeCreatedIssues(auditPath: string, issues: CreatedIssuesJson): void {
  const filePath = path.join(auditPath, 'created-issues.json');
  fs.writeFileSync(filePath, JSON.stringify(issues, null, 2));
}

/**
 * Load review decisions from file
 */
export function loadReviewDecisions(auditPath: string): ReviewDecisionsJson | null {
  const filePath = path.join(auditPath, 'review-decisions.json');
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ReviewDecisionsJson;
  } catch {
    return null;
  }
}

/**
 * Load created issues from file
 */
export function loadCreatedIssues(auditPath: string): CreatedIssuesJson | null {
  const filePath = path.join(auditPath, 'created-issues.json');
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CreatedIssuesJson;
  } catch {
    return null;
  }
}

/**
 * Generate report summary markdown
 */
export function generateReportSummary(
  decisions: ReviewDecisionsJson,
  createdIssues: CreatedIssuesJson | null
): string {
  const lines: string[] = [];

  lines.push('# Audit Report Summary');
  lines.push('');
  lines.push(`**Audit ID:** ${decisions.audit_id}`);
  lines.push(`**Date:** ${decisions.reviewed_at}`);
  lines.push('');

  lines.push('## Findings Overview');
  lines.push('');
  lines.push(`- **Total Findings:** ${decisions.total_findings}`);
  lines.push(`- **Issues Created:** ${decisions.decisions.create_issue}`);
  lines.push(`- **Skipped:** ${decisions.decisions.skip}`);
  lines.push(`- **Deferred:** ${decisions.decisions.defer}`);
  lines.push(`- **Merged:** ${decisions.decisions.merge}`);
  lines.push('');

  if (createdIssues && createdIssues.issues.length > 0) {
    lines.push('## Created Issues');
    lines.push('');
    for (const issue of createdIssues.issues) {
      lines.push(`- [#${issue.issue_number}](${issue.issue_url}) - ${issue.title}`);
    }
    lines.push('');
  }

  // Decision breakdown by severity
  const bySeverity = new Map<string, ReviewDecision[]>();
  for (const entry of decisions.entries) {
    if (!bySeverity.has(entry.severity)) {
      bySeverity.set(entry.severity, []);
    }
    bySeverity.get(entry.severity)!.push(entry);
  }

  lines.push('## Findings by Severity');
  lines.push('');
  for (const [severity, entries] of bySeverity) {
    const created = entries.filter(e => e.decision === 'create-issue').length;
    lines.push(`### ${severity}`);
    lines.push(`- Total: ${entries.length}`);
    lines.push(`- Issues Created: ${created}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Write report summary to file
 */
export function writeReportSummary(
  auditPath: string,
  decisions: ReviewDecisionsJson,
  createdIssues: CreatedIssuesJson | null
): void {
  const reportPath = path.join(auditPath, 'report.md');
  fs.writeFileSync(reportPath, generateReportSummary(decisions, createdIssues));
}

/**
 * Get findings to create issues for
 */
export function getFindingsForIssueCreation(
  findings: Finding[],
  decisions: ReviewDecision[]
): Finding[] {
  const createIds = new Set(
    decisions
      .filter(d => d.decision === 'create-issue')
      .map(d => d.finding_id)
  );

  return findings.filter(f => createIds.has(f.id));
}
