/**
 * Verification Phase - Issue Verification Mode
 * Task B.10: Verification Mode
 *
 * Handles /complete-verify command to verify if issues
 * have been fixed and run regression tests.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Finding } from './finding-quality';

export interface VerificationResult {
  status: 'fixed' | 'still_broken' | 'new_error' | 'cannot_verify';
  screenshot_id: string | null;
  notes: string;
  verified_at: string;
  reproduction_attempts: number;
  last_error: string | null;
}

export interface IssueFile {
  schema_version: string;
  issue_number: number;
  issue_url: string;
  finding_id: string;
  title: string;
  severity: string;
  category: string;
  url: string | null;
  file_path: string | null;
  reproduction_steps: string[];
  verification_history: VerificationAttempt[];
  created_at: string;
  last_verified_at: string | null;
}

export interface VerificationAttempt {
  timestamp: string;
  result: VerificationResult['status'];
  notes: string;
  screenshot_id: string | null;
  commit_sha: string | null;
}

export interface RegressionTestResult {
  finding_id: string;
  test_passed: boolean;
  error_message: string | null;
  duration_ms: number;
  tested_at: string;
}

export interface ParsedVerifyCommand {
  issue_number: number;
  options: {
    regression: boolean;
    max_attempts: number;
    screenshot: boolean;
  };
}

/**
 * Parse /complete-verify command
 */
export function parseVerifyCommand(command: string): ParsedVerifyCommand | null {
  // Match patterns like:
  // /complete-verify gh issue #42
  // /complete-verify #42
  // /complete-verify 42
  // /complete-verify gh issue #42 --regression

  const patterns = [
    /gh\s+issue\s+#?(\d+)/i,
    /#(\d+)/,
    /^(\d+)$/
  ];

  let issueNumber: number | null = null;

  for (const pattern of patterns) {
    const match = command.match(pattern);
    if (match) {
      issueNumber = parseInt(match[1], 10);
      break;
    }
  }

  if (!issueNumber) {
    return null;
  }

  // Parse options
  const regression = command.includes('--regression') || command.includes('-r');
  const maxAttempts = parseInt(command.match(/--max-attempts[=\s]+(\d+)/)?.[1] || '3', 10);
  const screenshot = !command.includes('--no-screenshot');

  return {
    issue_number: issueNumber,
    options: {
      regression,
      max_attempts: maxAttempts,
      screenshot
    }
  };
}

/**
 * Load issue file from audit directory
 */
export function loadIssueFile(auditPath: string, issueNumber: number): IssueFile | null {
  const issuesDir = path.join(auditPath, 'issues');
  const issueFilePath = path.join(issuesDir, `issue-${issueNumber}.json`);

  if (!fs.existsSync(issueFilePath)) {
    // Try to find in created-issues.json
    const createdIssuesPath = path.join(auditPath, 'created-issues.json');
    if (fs.existsSync(createdIssuesPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(createdIssuesPath, 'utf-8'));
        const issue = data.issues?.find((i: any) => i.issue_number === issueNumber);
        if (issue) {
          // Create issue file from created issue data
          return createIssueFileFromCreated(issue, auditPath);
        }
      } catch {
        // Ignore parse errors
      }
    }
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(issueFilePath, 'utf-8')) as IssueFile;
  } catch {
    return null;
  }
}

/**
 * Create issue file from created issues data
 */
function createIssueFileFromCreated(issue: any, auditPath: string): IssueFile | null {
  // Try to load the original finding
  const findingsDir = path.join(auditPath, 'findings');
  if (!fs.existsSync(findingsDir)) {
    return null;
  }

  // Find the finding file
  const findingFiles = fs.readdirSync(findingsDir).filter(f => f.endsWith('.json'));
  for (const file of findingFiles) {
    try {
      const finding = JSON.parse(fs.readFileSync(path.join(findingsDir, file), 'utf-8'));
      if (finding.id === issue.finding_id) {
        return {
          schema_version: '1.0.0',
          issue_number: issue.issue_number,
          issue_url: issue.issue_url,
          finding_id: issue.finding_id,
          title: finding.title,
          severity: finding.severity,
          category: finding.category,
          url: finding.url || null,
          file_path: finding.file_path || null,
          reproduction_steps: finding.reproduction_steps || [],
          verification_history: [],
          created_at: issue.created_at,
          last_verified_at: null
        };
      }
    } catch {
      // Ignore parse errors
    }
  }

  return null;
}

/**
 * Save issue file
 */
export function saveIssueFile(auditPath: string, issueFile: IssueFile): void {
  const issuesDir = path.join(auditPath, 'issues');
  if (!fs.existsSync(issuesDir)) {
    fs.mkdirSync(issuesDir, { recursive: true });
  }

  const issueFilePath = path.join(issuesDir, `issue-${issueFile.issue_number}.json`);
  fs.writeFileSync(issueFilePath, JSON.stringify(issueFile, null, 2));
}

/**
 * Create issue file from finding
 */
export function createIssueFile(
  finding: Finding,
  issueNumber: number,
  issueUrl: string
): IssueFile {
  return {
    schema_version: '1.0.0',
    issue_number: issueNumber,
    issue_url: issueUrl,
    finding_id: finding.id,
    title: finding.title,
    severity: finding.severity,
    category: finding.category,
    url: finding.url,
    file_path: finding.file_path,
    reproduction_steps: finding.reproduction_steps,
    verification_history: [],
    created_at: new Date().toISOString(),
    last_verified_at: null
  };
}

/**
 * Record verification attempt
 */
export function recordVerificationAttempt(
  issueFile: IssueFile,
  result: VerificationResult,
  commitSha: string | null = null
): IssueFile {
  const attempt: VerificationAttempt = {
    timestamp: new Date().toISOString(),
    result: result.status,
    notes: result.notes,
    screenshot_id: result.screenshot_id,
    commit_sha: commitSha
  };

  return {
    ...issueFile,
    verification_history: [...issueFile.verification_history, attempt],
    last_verified_at: new Date().toISOString()
  };
}

/**
 * Create verification result
 */
export function createVerificationResult(
  status: VerificationResult['status'],
  notes: string,
  screenshotId: string | null = null,
  reproductionAttempts: number = 1,
  lastError: string | null = null
): VerificationResult {
  return {
    status,
    screenshot_id: screenshotId,
    notes,
    verified_at: new Date().toISOString(),
    reproduction_attempts: reproductionAttempts,
    last_error: lastError
  };
}

/**
 * Run verification for an issue
 * Note: Actual browser verification is done by Claude using MCP tools
 * This function provides the structure and helpers
 */
export function prepareVerification(issueFile: IssueFile): {
  steps: string[];
  expected_behavior: string;
  verification_url: string | null;
} {
  return {
    steps: issueFile.reproduction_steps,
    expected_behavior: `Issue #${issueFile.issue_number} should be fixed - the original problem should no longer occur`,
    verification_url: issueFile.url
  };
}

/**
 * Run regression tests for related findings
 */
export function findRelatedFindings(
  issueFile: IssueFile,
  allFindings: Finding[]
): Finding[] {
  const related: Finding[] = [];

  for (const finding of allFindings) {
    // Skip the same finding
    if (finding.id === issueFile.finding_id) {
      continue;
    }

    // Same category
    if (finding.category === issueFile.category) {
      related.push(finding);
      continue;
    }

    // Same URL
    if (issueFile.url && finding.url === issueFile.url) {
      related.push(finding);
      continue;
    }

    // Same file
    if (issueFile.file_path && finding.file_path === issueFile.file_path) {
      related.push(finding);
      continue;
    }
  }

  return related;
}

/**
 * Generate verification summary
 */
export function generateVerificationSummary(issueFile: IssueFile): string {
  const lines: string[] = [];

  lines.push(`# Verification Summary: Issue #${issueFile.issue_number}`);
  lines.push('');
  lines.push(`**Title:** ${issueFile.title}`);
  lines.push(`**Severity:** ${issueFile.severity}`);
  lines.push(`**Category:** ${issueFile.category}`);
  lines.push('');

  if (issueFile.url) {
    lines.push(`**URL:** ${issueFile.url}`);
  }
  if (issueFile.file_path) {
    lines.push(`**File:** ${issueFile.file_path}`);
  }
  lines.push('');

  // Verification history
  if (issueFile.verification_history.length > 0) {
    lines.push('## Verification History');
    lines.push('');

    for (const attempt of issueFile.verification_history) {
      const statusEmoji = getStatusEmoji(attempt.result);
      lines.push(`### ${statusEmoji} ${attempt.timestamp}`);
      lines.push(`- **Result:** ${attempt.result}`);
      lines.push(`- **Notes:** ${attempt.notes}`);
      if (attempt.commit_sha) {
        lines.push(`- **Commit:** ${attempt.commit_sha}`);
      }
      lines.push('');
    }
  } else {
    lines.push('*No verification attempts yet*');
  }

  return lines.join('\n');
}

/**
 * Get status emoji
 */
function getStatusEmoji(status: VerificationResult['status']): string {
  const emojis: Record<string, string> = {
    fixed: '✅',
    still_broken: '❌',
    new_error: '⚠️',
    cannot_verify: '❓'
  };
  return emojis[status] || '❓';
}

/**
 * Check if issue should be closed
 */
export function shouldCloseIssue(issueFile: IssueFile): boolean {
  const history = issueFile.verification_history;
  if (history.length === 0) return false;

  // Check if last verification was fixed
  const lastAttempt = history[history.length - 1];
  if (lastAttempt.result !== 'fixed') return false;

  // Optionally: require multiple successful verifications
  // const fixedCount = history.filter(a => a.result === 'fixed').length;
  // return fixedCount >= 2;

  return true;
}

/**
 * Get current issue status based on verification history
 */
export function getCurrentIssueStatus(issueFile: IssueFile): {
  status: 'fixed' | 'open' | 'flaky' | 'unknown';
  confidence: number;
} {
  const history = issueFile.verification_history;

  if (history.length === 0) {
    return { status: 'unknown', confidence: 0 };
  }

  const lastAttempt = history[history.length - 1];
  const recentAttempts = history.slice(-3);

  // Count results in recent attempts
  const fixedCount = recentAttempts.filter(a => a.result === 'fixed').length;
  const brokenCount = recentAttempts.filter(a => a.result === 'still_broken').length;

  if (lastAttempt.result === 'fixed' && fixedCount >= 2) {
    return { status: 'fixed', confidence: 0.9 };
  }

  if (lastAttempt.result === 'fixed') {
    return { status: 'fixed', confidence: 0.7 };
  }

  // Flaky if mixed results
  if (fixedCount > 0 && brokenCount > 0) {
    return { status: 'flaky', confidence: 0.5 };
  }

  return { status: 'open', confidence: 0.8 };
}

/**
 * List all issue files in audit directory
 */
export function listIssueFiles(auditPath: string): IssueFile[] {
  const issuesDir = path.join(auditPath, 'issues');
  if (!fs.existsSync(issuesDir)) {
    return [];
  }

  const files = fs.readdirSync(issuesDir).filter(f => f.startsWith('issue-') && f.endsWith('.json'));
  const issues: IssueFile[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(issuesDir, file), 'utf-8');
      issues.push(JSON.parse(content) as IssueFile);
    } catch {
      // Skip invalid files
    }
  }

  return issues.sort((a, b) => a.issue_number - b.issue_number);
}
