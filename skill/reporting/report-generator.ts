/**
 * Report Generator
 * Task 5.1: Report Generation (JSON + Markdown)
 * Task 6.1: Schema Naming Alignment (snake_case)
 *
 * Generates comprehensive audit reports in both
 * structured JSON and human-readable Markdown formats.
 */

import { VerifiedFinding } from '../verification/verifier';
import { NormalizedFinding, groupByCategory } from '../verification/aggregator';

// Using snake_case to match JSON Schema requirements
export interface ReportConfig {
  application_name: string | null;
  application_url: string;
  framework: string | null;
  audit_id: string;
  generated_at: string;
}

export interface ReportSummary {
  grade: string;
  score: number;
  status: 'PASS' | 'PASS_WITH_WARNINGS' | 'NEEDS_ATTENTION' | 'FAIL';
  headline: string;
  total_findings: number;
  critical_issues: number;
  verified_findings: number;
  flaky_findings: number;
  unverified_findings: number;
}

export interface CoverageReport {
  routes: {
    total: number;
    visited: number;
    percent: number;
  };
  pages: {
    total: number;
    tested: number;
  };
  forms: {
    total: number;
    tested: number;
    percent: number;
  };
  viewports: {
    tested: string[];
    issues_found: number;
  };
  code_analysis: {
    files_analyzed: number;
    languages: string[];
  };
}

export interface PrdComparison {
  prd_path: string;
  requirements_total: number;
  requirements_verified: number;
  requirements_missing: number;
  requirements_partial: number;
  details: Array<{
    requirement: string;
    status: 'verified' | 'missing' | 'partial' | 'not_testable';
    evidence: string | null;
  }>;
}

export interface ReportFinding {
  id: string;
  title: string;
  severity: string;
  category: string;
  description: string;
  location: string;
  verification_status: string | null;
  labels: string[];
  github_issue: number | null;
}

export interface AuditReport {
  schema_version: string;
  audit_id: string;
  generated_at: string;
  application: {
    name: string | null;
    url: string;
    framework: string | null;
    version: string | null;
  };
  summary: ReportSummary;
  findings: {
    by_severity: Record<string, ReportFinding[]>;
    by_category: Record<string, ReportFinding[]>;
    verification_summary: {
      verified: number;
      flaky: number;
      could_not_reproduce: number;
      verification_error: number;
      not_applicable: number;
    };
  };
  coverage: CoverageReport;
  prd_comparison: PrdComparison | null;
  recommendations: Array<{
    priority: 'critical' | 'high' | 'medium' | 'low';
    category: string;
    title: string;
    description: string;
    related_findings: string[];
  }>;
  github_issues: Array<{
    finding_id: string;
    issue_number: number;
    issue_url: string;
    created_at: string;
  }> | null;
  metadata: {
    duration_seconds: number;
    stages_completed: string[];
    stages_skipped: string[];
    browser_restarts: number;
    errors_recovered: number;
  };
}

/**
 * Calculate audit score
 */
export function calculateScore(findings: NormalizedFinding[], coverage: CoverageReport): number {
  let score = 100;

  // Deduct for findings by severity
  for (const finding of findings) {
    switch (finding.severity) {
      case 'P0':
        score -= 25;
        break;
      case 'P1':
        score -= 10;
        break;
      case 'P2':
        score -= 3;
        break;
      case 'P3':
        score -= 1;
        break;
      case 'P4':
        score -= 0.5;
        break;
    }
  }

  // Bonuses
  if (coverage.routes.percent >= 80) {
    score += 5;
  }

  // Ensure score is within bounds
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Determine grade from score
 */
export function scoreToGrade(score: number): string {
  if (score >= 97) return 'A+';
  if (score >= 93) return 'A';
  if (score >= 90) return 'A-';
  if (score >= 87) return 'B+';
  if (score >= 83) return 'B';
  if (score >= 80) return 'B-';
  if (score >= 77) return 'C+';
  if (score >= 73) return 'C';
  if (score >= 70) return 'C-';
  if (score >= 67) return 'D+';
  if (score >= 63) return 'D';
  if (score >= 60) return 'D-';
  return 'F';
}

/**
 * Determine status from findings
 */
export function determineStatus(findings: NormalizedFinding[]): ReportSummary['status'] {
  const p0Count = findings.filter(f => f.severity === 'P0').length;
  const p1Count = findings.filter(f => f.severity === 'P1').length;

  if (p0Count > 0) return 'FAIL';
  if (p1Count > 3) return 'NEEDS_ATTENTION';
  if (p1Count > 0) return 'PASS_WITH_WARNINGS';
  return 'PASS';
}

/**
 * Generate headline from status
 */
export function generateHeadline(status: ReportSummary['status'], findings: NormalizedFinding[]): string {
  const p0Count = findings.filter(f => f.severity === 'P0').length;
  const p1Count = findings.filter(f => f.severity === 'P1').length;
  const totalCount = findings.length;

  switch (status) {
    case 'PASS':
      return totalCount === 0
        ? 'No issues found - application is ready for launch!'
        : `${totalCount} minor issues found - application is ready for launch with small improvements.`;
    case 'PASS_WITH_WARNINGS':
      return `${p1Count} high-priority issues should be addressed before launch.`;
    case 'NEEDS_ATTENTION':
      return `${p1Count} high-priority issues require immediate attention.`;
    case 'FAIL':
      return `${p0Count} critical issues must be fixed before launch.`;
  }
}

/**
 * Convert NormalizedFinding to ReportFinding
 */
function toReportFinding(finding: NormalizedFinding, verifiedFinding?: VerifiedFinding): ReportFinding {
  const location = finding.location.file
    ? `${finding.location.file}${finding.location.line ? ':' + finding.location.line : ''}`
    : finding.location.url || 'Unknown';

  return {
    id: finding.id,
    title: finding.title,
    severity: finding.severity,
    category: finding.type,
    description: finding.description,
    location,
    verification_status: verifiedFinding?.verification_status || finding.verification.status,
    labels: verifiedFinding?.labels || finding.labels,
    github_issue: finding.issue_number
  };
}

/**
 * Generate recommendations based on findings
 */
export function generateRecommendations(
  findings: NormalizedFinding[],
  coverage: CoverageReport
): AuditReport['recommendations'] {
  const recommendations: AuditReport['recommendations'] = [];

  // Security recommendations
  const securityFindings = findings.filter(f =>
    ['hardcoded_secret', 'sql_injection', 'xss_vulnerability', 'missing_auth'].includes(f.type)
  );
  if (securityFindings.length > 0) {
    recommendations.push({
      priority: 'critical',
      category: 'Security',
      title: 'Address Security Vulnerabilities',
      description: `${securityFindings.length} security issues were found. These should be addressed immediately to prevent potential exploits.`,
      related_findings: securityFindings.map(f => f.id)
    });
  }

  // Code quality recommendations
  const todoCount = findings.filter(f => f.type === 'todo').length;
  const fixmeCount = findings.filter(f => f.type === 'fixme').length;
  if (todoCount + fixmeCount > 5) {
    recommendations.push({
      priority: 'medium',
      category: 'Code Quality',
      title: 'Complete Unfinished Work',
      description: `Found ${todoCount} TODO and ${fixmeCount} FIXME comments. Review these items before launch.`,
      related_findings: findings.filter(f => ['todo', 'fixme'].includes(f.type)).map(f => f.id)
    });
  }

  // Coverage recommendations
  if (coverage.routes.percent < 60) {
    recommendations.push({
      priority: 'high',
      category: 'Testing',
      title: 'Improve Test Coverage',
      description: `Only ${coverage.routes.percent}% of routes were tested. Consider expanding test coverage.`,
      related_findings: []
    });
  }

  // Architecture recommendations
  const archFindings = findings.filter(f =>
    ['circular_dependency', 'god_file'].includes(f.type)
  );
  if (archFindings.length > 0) {
    recommendations.push({
      priority: 'low',
      category: 'Architecture',
      title: 'Refactor Architecture Issues',
      description: 'Code architecture could be improved to reduce complexity and improve maintainability.',
      related_findings: archFindings.map(f => f.id)
    });
  }

  return recommendations;
}

/**
 * Generate complete audit report
 */
export function generateReport(
  config: ReportConfig,
  findings: NormalizedFinding[],
  verifiedFindings: VerifiedFinding[],
  coverage: CoverageReport,
  prdComparison: PrdComparison | null,
  metadata: AuditReport['metadata']
): AuditReport {
  const score = calculateScore(findings, coverage);
  const grade = scoreToGrade(score);
  const status = determineStatus(findings);

  // Create map of verified findings by original ID
  const verifiedMap = new Map<string, VerifiedFinding>();
  for (const vf of verifiedFindings) {
    verifiedMap.set(vf.original_finding_id, vf);
  }

  // Convert to report findings
  const reportFindings = findings.map(f => toReportFinding(f, verifiedMap.get(f.id)));

  // Group findings
  const by_severity: Record<string, ReportFinding[]> = {
    P0: reportFindings.filter(f => f.severity === 'P0'),
    P1: reportFindings.filter(f => f.severity === 'P1'),
    P2: reportFindings.filter(f => f.severity === 'P2'),
    P3: reportFindings.filter(f => f.severity === 'P3'),
    P4: reportFindings.filter(f => f.severity === 'P4')
  };

  const by_category: Record<string, ReportFinding[]> = {};
  const grouped = groupByCategory(findings);
  for (const [category, categoryFindings] of grouped) {
    by_category[category] = categoryFindings.map(f => toReportFinding(f, verifiedMap.get(f.id)));
  }

  // Verification summary
  const verification_summary = {
    verified: verifiedFindings.filter(f => f.verification_status === 'VERIFIED').length,
    flaky: verifiedFindings.filter(f => f.verification_status === 'FLAKY').length,
    could_not_reproduce: verifiedFindings.filter(f => f.verification_status === 'COULD_NOT_REPRODUCE').length,
    verification_error: verifiedFindings.filter(f => f.verification_status === 'VERIFICATION_ERROR').length,
    not_applicable: verifiedFindings.filter(f => f.verification_status === 'NOT_APPLICABLE').length
  };

  return {
    schema_version: '1.0.0',
    audit_id: config.audit_id,
    generated_at: config.generated_at,
    application: {
      name: config.application_name,
      url: config.application_url,
      framework: config.framework,
      version: null
    },
    summary: {
      grade,
      score,
      status,
      headline: generateHeadline(status, findings),
      total_findings: findings.length,
      critical_issues: by_severity.P0.length,
      verified_findings: verification_summary.verified,
      flaky_findings: verification_summary.flaky,
      unverified_findings: verification_summary.could_not_reproduce
    },
    findings: {
      by_severity,
      by_category,
      verification_summary
    },
    coverage,
    prd_comparison: prdComparison,
    recommendations: generateRecommendations(findings, coverage),
    github_issues: null, // Populated after issue creation
    metadata
  };
}

/**
 * Generate Markdown report
 */
export function generateMarkdownReport(report: AuditReport): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Audit Report: ${report.application.name || report.application.url}`);
  lines.push('');
  lines.push(`**Audit ID:** ${report.audit_id}`);
  lines.push(`**Generated:** ${new Date(report.generated_at).toLocaleString()}`);
  lines.push(`**Framework:** ${report.application.framework || 'Unknown'}`);
  lines.push('');

  // Summary box
  lines.push('---');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| **Grade** | ${report.summary.grade} |`);
  lines.push(`| **Score** | ${report.summary.score}/100 |`);
  lines.push(`| **Status** | ${report.summary.status} |`);
  lines.push(`| **Total Findings** | ${report.summary.total_findings} |`);
  lines.push(`| **Critical Issues** | ${report.summary.critical_issues} |`);
  lines.push('');
  lines.push(`> ${report.summary.headline}`);
  lines.push('');

  // Findings by severity
  lines.push('---');
  lines.push('');
  lines.push('## Findings by Severity');
  lines.push('');

  for (const severity of ['P0', 'P1', 'P2', 'P3', 'P4']) {
    const severityFindings = report.findings.by_severity[severity];
    if (severityFindings && severityFindings.length > 0) {
      const label = {
        'P0': 'Critical',
        'P1': 'High',
        'P2': 'Medium',
        'P3': 'Low',
        'P4': 'Info'
      }[severity];

      lines.push(`### ${severity} - ${label} (${severityFindings.length})`);
      lines.push('');

      for (const finding of severityFindings) {
        lines.push(`- **${finding.title}** - ${finding.location}`);
        lines.push(`  - ${finding.description}`);
        if (finding.verification_status) {
          lines.push(`  - _Verification: ${finding.verification_status}_`);
        }
        if (finding.labels.length > 0) {
          lines.push(`  - Labels: ${finding.labels.join(', ')}`);
        }
      }
      lines.push('');
    }
  }

  // Coverage
  lines.push('---');
  lines.push('');
  lines.push('## Coverage');
  lines.push('');
  lines.push(`| Area | Coverage |`);
  lines.push(`|------|----------|`);
  lines.push(`| Routes | ${report.coverage.routes.visited}/${report.coverage.routes.total} (${report.coverage.routes.percent}%) |`);
  lines.push(`| Pages Tested | ${report.coverage.pages.tested}/${report.coverage.pages.total} |`);
  lines.push(`| Forms Tested | ${report.coverage.forms.tested}/${report.coverage.forms.total} (${report.coverage.forms.percent}%) |`);
  lines.push(`| Viewports | ${report.coverage.viewports.tested.join(', ')} |`);
  lines.push(`| Files Analyzed | ${report.coverage.code_analysis.files_analyzed} |`);
  lines.push('');

  // Verification Summary
  lines.push('---');
  lines.push('');
  lines.push('## Verification Summary');
  lines.push('');
  lines.push(`| Status | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Verified | ${report.findings.verification_summary.verified} |`);
  lines.push(`| Flaky | ${report.findings.verification_summary.flaky} |`);
  lines.push(`| Could Not Reproduce | ${report.findings.verification_summary.could_not_reproduce} |`);
  lines.push(`| Verification Error | ${report.findings.verification_summary.verification_error} |`);
  lines.push(`| Not Applicable | ${report.findings.verification_summary.not_applicable} |`);
  lines.push('');

  // PRD Comparison
  if (report.prd_comparison) {
    lines.push('---');
    lines.push('');
    lines.push('## PRD Comparison');
    lines.push('');
    lines.push(`| Status | Count |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Verified | ${report.prd_comparison.requirements_verified} |`);
    lines.push(`| Missing | ${report.prd_comparison.requirements_missing} |`);
    lines.push(`| Partial | ${report.prd_comparison.requirements_partial} |`);
    lines.push('');
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## Recommendations');
    lines.push('');

    for (const rec of report.recommendations) {
      const emoji = {
        'critical': '🔴',
        'high': '🟠',
        'medium': '🟡',
        'low': '🟢'
      }[rec.priority];

      lines.push(`### ${emoji} ${rec.title}`);
      lines.push('');
      lines.push(rec.description);
      lines.push('');
    }
  }

  // Footer
  lines.push('---');
  lines.push('');
  lines.push(`_Generated by Complete Audit Agent in ${report.metadata.duration_seconds}s_`);

  return lines.join('\n');
}
