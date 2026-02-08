/**
 * Finding Verifier
 * Task 4.1-4.2: Verification Engine with Flaky Test Detection
 * Task 6.1: Schema Naming Alignment (snake_case)
 * Task 6.4: VERIFICATION_ERROR Issue Creation
 *
 * Verifies browser-testable findings through reproduction attempts.
 * Identifies flaky tests and handles verification errors gracefully.
 */

export type VerificationStatus =
  | 'VERIFIED'
  | 'FLAKY'
  | 'COULD_NOT_REPRODUCE'
  | 'VERIFICATION_ERROR'
  | 'NOT_APPLICABLE';

// Using snake_case to match JSON Schema requirements
export interface VerificationAttempt {
  attempt: number;
  reproduced: boolean;
  timestamp: string;
  error: string | null;
  browser_healthy: boolean;
}

export interface VerifiedFinding {
  schema_version: string;
  id: string;
  original_finding_id: string;
  verification_status: VerificationStatus;
  original_severity: string;
  final_severity: string;
  severity_adjusted: boolean;
  adjustment_reason: string | null;
  verification_attempts: VerificationAttempt[];
  verified_at: string;
  labels: string[];
  include_in_report: boolean;
  create_github_issue: boolean;
  needs_manual_verification: boolean;
  original_finding?: Record<string, unknown>;
}

export interface VerificationConfig {
  max_attempts: number;
  delay_between_attempts: number;
  clear_cache_on_retry: boolean;
  fresh_context_on_final_retry: boolean;
  timeout_per_attempt: number;
}

const DEFAULT_CONFIG: VerificationConfig = {
  max_attempts: 3,
  delay_between_attempts: 2000,
  clear_cache_on_retry: true,
  fresh_context_on_final_retry: true,
  timeout_per_attempt: 30000
};

// Severity downgrade mapping for COULD_NOT_REPRODUCE
const SEVERITY_DOWNGRADE: Record<string, string> = {
  'P0': 'P1',
  'P1': 'P2',
  'P2': 'P3',
  'P3': 'P4',
  'P4': 'P4'
};

/**
 * Determine if a finding is browser-testable
 */
export function isBrowserTestable(finding: {
  type: string;
  source: string;
  location?: { url?: string; file?: string };
}): boolean {
  // Static analysis findings are not browser-testable
  const staticTypes = [
    'todo', 'fixme', 'hack', 'console_log', 'unused_export',
    'unused_import', 'high_complexity', 'large_file', 'deep_nesting',
    'commented_code', 'hardcoded_secret', 'circular_dependency',
    'god_file', 'orphan_file', 'insecure_dependency'
  ];

  if (staticTypes.includes(finding.type)) {
    return false;
  }

  // Findings with URLs are browser-testable
  if (finding.location?.url) {
    return true;
  }

  // Code findings without URLs are not browser-testable
  if (finding.source === 'code-scan') {
    return false;
  }

  return true;
}

/**
 * Determine verification status from attempt results
 */
export function determineStatus(attempts: VerificationAttempt[]): VerificationStatus {
  if (attempts.length === 0) {
    return 'NOT_APPLICABLE';
  }

  const successCount = attempts.filter(a => a.reproduced).length;
  const errorCount = attempts.filter(a => a.error !== null).length;
  const totalAttempts = attempts.length;

  // All attempts had errors
  if (errorCount === totalAttempts) {
    return 'VERIFICATION_ERROR';
  }

  // Reproduced in all attempts
  if (successCount === totalAttempts) {
    return 'VERIFIED';
  }

  // Reproduced in some attempts (flaky)
  if (successCount > 0 && successCount < totalAttempts) {
    return 'FLAKY';
  }

  // Never reproduced
  return 'COULD_NOT_REPRODUCE';
}

/**
 * Determine final severity based on verification status
 */
export function determineFinalSeverity(
  originalSeverity: string,
  status: VerificationStatus
): { severity: string; adjusted: boolean; reason: string | null } {
  if (status === 'COULD_NOT_REPRODUCE') {
    const newSeverity = SEVERITY_DOWNGRADE[originalSeverity] || originalSeverity;
    return {
      severity: newSeverity,
      adjusted: newSeverity !== originalSeverity,
      reason: 'Downgraded due to inability to reproduce'
    };
  }

  if (status === 'FLAKY') {
    // Don't downgrade flaky findings but note it
    return {
      severity: originalSeverity,
      adjusted: false,
      reason: null
    };
  }

  return {
    severity: originalSeverity,
    adjusted: false,
    reason: null
  };
}

/**
 * Determine labels based on verification status
 */
export function determineLabels(status: VerificationStatus): string[] {
  const labels: string[] = [];

  switch (status) {
    case 'VERIFIED':
      labels.push('verified');
      break;
    case 'FLAKY':
      labels.push('flaky', 'needs-investigation');
      break;
    case 'COULD_NOT_REPRODUCE':
      labels.push('unverified', 'could-not-reproduce');
      break;
    case 'VERIFICATION_ERROR':
      labels.push('verification-error', 'needs-manual-check');
      break;
    case 'NOT_APPLICABLE':
      labels.push('static-analysis');
      break;
  }

  return labels;
}

/**
 * Determine if finding should be included in report
 */
export function shouldIncludeInReport(
  status: VerificationStatus,
  finalSeverity: string
): boolean {
  // Always include verified findings
  if (status === 'VERIFIED') return true;

  // Include flaky findings
  if (status === 'FLAKY') return true;

  // Include verification errors (need manual check)
  if (status === 'VERIFICATION_ERROR') return true;

  // Include static analysis findings
  if (status === 'NOT_APPLICABLE') return true;

  // Include high-severity unverified findings
  if (status === 'COULD_NOT_REPRODUCE' && ['P0', 'P1'].includes(finalSeverity)) {
    return true;
  }

  // Exclude low-severity unverified findings
  return false;
}

/**
 * Determine if GitHub issue should be created
 * Task 6.4: VERIFICATION_ERROR findings should also create issues with verification-error label
 */
export function shouldCreateGithubIssue(
  status: VerificationStatus,
  finalSeverity: string
): boolean {
  // Create issues for verified high-severity findings
  if (status === 'VERIFIED' && ['P0', 'P1', 'P2'].includes(finalSeverity)) {
    return true;
  }

  // Create issues for flaky high-severity findings
  if (status === 'FLAKY' && ['P0', 'P1'].includes(finalSeverity)) {
    return true;
  }

  // Task 6.4: Create issues for VERIFICATION_ERROR on P0/P1 findings
  // These need manual verification and shouldn't be silently dropped
  if (status === 'VERIFICATION_ERROR' && ['P0', 'P1'].includes(finalSeverity)) {
    return true;
  }

  return false;
}

/**
 * Create a verified finding record
 */
export function createVerifiedFinding(
  originalFinding: {
    id: string;
    severity: string;
    type: string;
    source: string;
  },
  attempts: VerificationAttempt[],
  verifiedFindingId: string
): VerifiedFinding {
  const status = determineStatus(attempts);
  const { severity, adjusted, reason } = determineFinalSeverity(
    originalFinding.severity,
    status
  );

  return {
    schema_version: '1.0.0',
    id: verifiedFindingId,
    original_finding_id: originalFinding.id,
    verification_status: status,
    original_severity: originalFinding.severity,
    final_severity: severity,
    severity_adjusted: adjusted,
    adjustment_reason: reason,
    verification_attempts: attempts,
    verified_at: new Date().toISOString(),
    labels: determineLabels(status),
    include_in_report: shouldIncludeInReport(status, severity),
    create_github_issue: shouldCreateGithubIssue(status, severity),
    needs_manual_verification: status === 'VERIFICATION_ERROR' || status === 'COULD_NOT_REPRODUCE'
  };
}

/**
 * Verification coordinator
 */
export class VerificationCoordinator {
  private config: VerificationConfig;
  private verifiedFindings: VerifiedFinding[] = [];
  private browserHealthy: boolean = true;
  private consecutiveErrors: number = 0;
  private readonly MAX_CONSECUTIVE_ERRORS = 3;

  constructor(config: Partial<VerificationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record browser health status
   */
  recordBrowserHealth(healthy: boolean): void {
    this.browserHealthy = healthy;

    if (!healthy) {
      this.consecutiveErrors++;
    } else {
      this.consecutiveErrors = 0;
    }
  }

  /**
   * Check if browser needs restart
   */
  needsBrowserRestart(): boolean {
    return this.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS;
  }

  /**
   * Reset error count (after browser restart)
   */
  resetErrorCount(): void {
    this.consecutiveErrors = 0;
  }

  /**
   * Add verified finding
   */
  addVerifiedFinding(finding: VerifiedFinding): void {
    this.verifiedFindings.push(finding);
  }

  /**
   * Get verification summary
   */
  getSummary(): {
    total: number;
    verified: number;
    flaky: number;
    could_not_reproduce: number;
    verification_error: number;
    not_applicable: number;
    issue_worthy: number;
  } {
    const summary = {
      total: this.verifiedFindings.length,
      verified: 0,
      flaky: 0,
      could_not_reproduce: 0,
      verification_error: 0,
      not_applicable: 0,
      issue_worthy: 0
    };

    for (const finding of this.verifiedFindings) {
      switch (finding.verification_status) {
        case 'VERIFIED':
          summary.verified++;
          break;
        case 'FLAKY':
          summary.flaky++;
          break;
        case 'COULD_NOT_REPRODUCE':
          summary.could_not_reproduce++;
          break;
        case 'VERIFICATION_ERROR':
          summary.verification_error++;
          break;
        case 'NOT_APPLICABLE':
          summary.not_applicable++;
          break;
      }

      if (finding.create_github_issue) {
        summary.issue_worthy++;
      }
    }

    return summary;
  }

  /**
   * Get findings for report
   */
  getFindingsForReport(): VerifiedFinding[] {
    return this.verifiedFindings.filter(f => f.include_in_report);
  }

  /**
   * Get findings for GitHub issue creation
   */
  getFindingsForGithubIssues(): VerifiedFinding[] {
    return this.verifiedFindings.filter(f => f.create_github_issue);
  }

  /**
   * Export state for checkpointing
   */
  exportState(): {
    findings: VerifiedFinding[];
    browser_healthy: boolean;
    consecutive_errors: number;
  } {
    return {
      findings: this.verifiedFindings,
      browser_healthy: this.browserHealthy,
      consecutive_errors: this.consecutiveErrors
    };
  }

  /**
   * Import state from checkpoint
   */
  importState(state: ReturnType<VerificationCoordinator['exportState']>): void {
    this.verifiedFindings = state.findings;
    this.browserHealthy = state.browser_healthy;
    this.consecutiveErrors = state.consecutive_errors;
  }
}
