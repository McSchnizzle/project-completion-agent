/**
 * Report Generation
 * Task T-034: Template-driven report generation
 *
 * Generates a markdown audit report by aggregating findings, coverage metrics,
 * and test results. No Claude/LLM calls needed - pure template-driven.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  getFindingDir,
  getPageDir,
  getReportPath,
  getPrdSummaryPath,
  getProgressPath,
} from '../artifact-paths';

/**
 * Severity levels used for findings
 */
type Severity = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';

/**
 * Finding object structure
 */
interface Finding {
  id: string;
  title: string;
  severity: Severity;
  category?: string;
  type?: string;
  status?: string;
  description?: string;
  feature_id?: string;
  source?: string;
  evidence?: {
    url?: string;
    screenshot_id?: string;
  };
  issue_number?: number;
}

/**
 * PRD summary structure
 */
interface PrdSummary {
  features: Array<{
    id: string;
    name: string;
    priority: string;
  }>;
  summary: {
    total_features: number;
    p0_count: number;
    p1_count: number;
    p2_count: number;
  };
}

/**
 * Page inventory structure (supports both legacy and browser-collector formats)
 */
interface PageInventory {
  page_number?: number;
  url: string;
  title: string;
  visited_at?: string;
  features_checked?: Record<string, { status: string; notes: string }>;
  forms?: Array<{ action: string; method: string; fields?: unknown[] }>;
  links?: string[];
  statusCode?: number;
  loadTimeMs?: number;
}

/**
 * Progress tracking structure
 */
interface Progress {
  audit_id: string;
  started_at: string;
  completed_at?: string;
  target_url: string;
  coverage?: {
    pages_visited: number;
    forms_tested: number;
    features_checked: number;
  };
  findings?: {
    total: number;
    by_severity: Record<Severity, number>;
  };
}

/**
 * Generate a complete audit report
 *
 * Reads all findings from the findings directory, aggregates stats,
 * and generates a markdown report with executive summary, findings table,
 * coverage metrics, and recommendations.
 *
 * @param auditDir - Path to the audit directory
 * @returns The generated markdown report content
 */
export function generateReport(auditDir: string): string {
  // Read progress to get audit metadata
  const progressPath = getProgressPath(auditDir);
  const progress: Progress = fs.existsSync(progressPath)
    ? JSON.parse(fs.readFileSync(progressPath, 'utf-8'))
    : { audit_id: 'unknown', started_at: new Date().toISOString(), target_url: 'unknown' };

  // Read all findings
  const findings = loadFindings(auditDir);

  // Read PRD summary if exists
  const prdSummary = loadPrdSummary(auditDir);

  // Read page inventories
  const pages = loadPages(auditDir);

  // Generate report sections
  const header = generateHeader(progress);
  const executiveSummary = generateExecutiveSummary(findings, progress, prdSummary);
  const findingsTable = generateFindingsTable(findings);
  const coverageMetrics = generateCoverageMetrics(progress, prdSummary, pages);
  const pagesExplored = generatePagesExplored(pages);
  const formTestResults = generateFormTestResults(findings);
  const recommendations = generateRecommendations(findings);

  // Assemble full report
  const report = [
    header,
    executiveSummary,
    findingsTable,
    coverageMetrics,
    pagesExplored,
    formTestResults,
    recommendations,
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');

  // Write report to file
  const reportPath = getReportPath(auditDir);
  fs.writeFileSync(reportPath, report, 'utf-8');

  return report;
}

/**
 * Load all findings from the findings directory
 */
function loadFindings(auditDir: string): Finding[] {
  const findingDir = getFindingDir(auditDir);
  if (!fs.existsSync(findingDir)) {
    return [];
  }

  const files = fs.readdirSync(findingDir).filter((f) => f.endsWith('.json'));
  const findings: Finding[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(findingDir, file), 'utf-8');
      const finding = JSON.parse(content) as Finding;
      findings.push(finding);
    } catch (error) {
      // Skip malformed findings
      console.warn(`Skipping malformed finding: ${file}`);
    }
  }

  return findings;
}

/**
 * Load PRD summary if it exists
 */
function loadPrdSummary(auditDir: string): PrdSummary | null {
  const prdPath = getPrdSummaryPath(auditDir);
  if (!fs.existsSync(prdPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(prdPath, 'utf-8')) as PrdSummary;
  } catch {
    return null;
  }
}

/**
 * Load all page inventories
 */
function loadPages(auditDir: string): PageInventory[] {
  const pageDir = getPageDir(auditDir);
  if (!fs.existsSync(pageDir)) {
    return [];
  }

  const files = fs.readdirSync(pageDir).filter((f) => f.endsWith('.json'));
  const pages: PageInventory[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(pageDir, file), 'utf-8');
      const page = JSON.parse(content) as PageInventory;
      pages.push(page);
    } catch (error) {
      console.warn(`Skipping malformed page: ${file}`);
    }
  }

  return pages.sort((a, b) => (a.page_number ?? 0) - (b.page_number ?? 0));
}

/**
 * Generate report header
 */
function generateHeader(progress: Progress): string {
  return `# Audit Report

**Audit ID:** ${progress.audit_id}
**Target URL:** ${progress.target_url}
**Started:** ${new Date(progress.started_at).toLocaleString()}
**Completed:** ${progress.completed_at ? new Date(progress.completed_at).toLocaleString() : 'In Progress'}`;
}

/**
 * Generate executive summary
 */
function generateExecutiveSummary(
  findings: Finding[],
  progress: Progress,
  prdSummary: PrdSummary | null
): string {
  const severityCounts = {
    P0: 0,
    P1: 0,
    P2: 0,
    P3: 0,
    P4: 0,
  };

  for (const finding of findings) {
    if (finding.severity in severityCounts) {
      severityCounts[finding.severity]++;
    }
  }

  const criticalCount = severityCounts.P0 + severityCounts.P1;
  const coverage = progress.coverage;
  const featureCount = prdSummary?.summary.total_features ?? 0;

  // Use page count from progress OR count pages directly
  const pageCount = coverage?.pages_visited || 0;

  return `## Executive Summary

This audit discovered **${findings.length} findings** across ${pageCount} pages${
    featureCount > 0 ? ` covering ${featureCount} features` : ''
  }.

### Findings Breakdown

- **Critical (P0):** ${severityCounts.P0}
- **High (P1):** ${severityCounts.P1}
- **Medium (P2):** ${severityCounts.P2}
- **Low (P3):** ${severityCounts.P3}
- **Info (P4):** ${severityCounts.P4}

${criticalCount > 0 ? `⚠️ **${criticalCount} critical/high priority findings require immediate attention.**` : '✅ No critical or high priority findings detected.'}`;
}

/**
 * Generate findings table
 */
function generateFindingsTable(findings: Finding[]): string {
  if (findings.length === 0) {
    return `## Findings

No findings were discovered during this audit.`;
  }

  const rows = findings
    .sort((a, b) => {
      // Sort by severity first (P0 > P1 > P2 > P3 > P4)
      const severityOrder = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
      const aSev = severityOrder[a.severity] ?? 99;
      const bSev = severityOrder[b.severity] ?? 99;
      if (aSev !== bSev) return aSev - bSev;
      // Then by ID
      return a.id.localeCompare(b.id);
    })
    .map((f) => {
      const category = f.category || f.type || 'general';
      const status = f.status || 'open';
      const issueLink = f.issue_number ? ` [#${f.issue_number}]` : '';
      return `| ${f.severity} | ${f.id}${issueLink} | ${f.title} | ${category} | ${status} |`;
    })
    .join('\n');

  return `## Findings

| Severity | ID | Title | Category | Status |
|----------|-----|-------|----------|--------|
${rows}`;
}

/**
 * Generate coverage metrics section
 */
function generateCoverageMetrics(
  progress: Progress,
  prdSummary: PrdSummary | null,
  pages: PageInventory[]
): string {
  if (!prdSummary) {
    return `## Coverage Metrics

No PRD was provided for this audit.

- **Pages Visited:** ${progress.coverage?.pages_visited ?? 0}
- **Forms Tested:** ${progress.coverage?.forms_tested ?? 0}`;
  }

  // Count features by status
  const featureStatus = new Map<string, number>();
  for (const page of pages) {
    if (page.features_checked) {
      for (const [, check] of Object.entries(page.features_checked)) {
        const status = check.status;
        featureStatus.set(status, (featureStatus.get(status) || 0) + 1);
      }
    }
  }

  const featureRows = prdSummary.features
    .map((f) => {
      // Count how many times this feature was checked
      let passCount = 0;
      let failCount = 0;
      let partialCount = 0;
      let notTestedCount = 0;

      for (const page of pages) {
        if (page.features_checked) {
          for (const [key, check] of Object.entries(page.features_checked)) {
            if (key.includes(f.id.toLowerCase())) {
              if (check.status === 'pass') passCount++;
              else if (check.status === 'fail') failCount++;
              else if (check.status === 'partial') partialCount++;
              else if (check.status === 'not_testable') notTestedCount++;
            }
          }
        }
      }

      const statusIcon =
        failCount > 0
          ? '❌'
          : partialCount > 0
          ? '⚠️'
          : passCount > 0
          ? '✅'
          : notTestedCount > 0
          ? '❓'
          : '⏭️';
      const statusText =
        failCount > 0
          ? 'Failed'
          : partialCount > 0
          ? 'Partial'
          : passCount > 0
          ? 'Pass'
          : notTestedCount > 0
          ? 'Not Testable'
          : 'Not Checked';

      return `| ${statusIcon} | ${f.id} | ${f.name} | ${f.priority} | ${statusText} |`;
    })
    .join('\n');

  return `## Coverage Metrics

### Feature Coverage

| Status | ID | Feature | Priority | Result |
|--------|-----|---------|----------|--------|
${featureRows}

**Summary:**
- **Total Features:** ${prdSummary.summary.total_features}
- **Pages Visited:** ${progress.coverage?.pages_visited ?? 0}
- **Forms Tested:** ${progress.coverage?.forms_tested ?? 0}
- **Features Checked:** ${progress.coverage?.features_checked ?? 0}`;
}

/**
 * Generate pages explored section
 */
function generatePagesExplored(pages: PageInventory[]): string {
  if (pages.length === 0) {
    return '';
  }

  const rows = pages
    .map((p, index) => {
      const featureCount = p.features_checked ? Object.keys(p.features_checked).length : 0;
      const pageNum = p.page_number ?? (index + 1);
      const visitedAt = p.visited_at ? new Date(p.visited_at).toLocaleString() : (p.loadTimeMs ? `${p.loadTimeMs}ms load` : '-');
      const title = p.title || p.url;
      return `| ${pageNum} | [${title}](${p.url}) | ${featureCount} | ${visitedAt} |`;
    })
    .join('\n');

  return `## Pages Explored

| # | Page | Features Checked | Visited At |
|---|------|------------------|------------|
${rows}`;
}

/**
 * Generate form test results summary
 */
function generateFormTestResults(findings: Finding[]): string {
  const formFindings = findings.filter((f) => f.source === 'test' || f.source === 'form-testing');

  if (formFindings.length === 0) {
    return '';
  }

  const rows = formFindings
    .map((f) => {
      const url = f.evidence?.url || 'N/A';
      return `| ${f.severity} | ${f.title} | ${url} |`;
    })
    .join('\n');

  return `## Form Test Results

${formFindings.length} findings were discovered during form testing:

| Severity | Title | URL |
|----------|-------|-----|
${rows}`;
}

/**
 * Generate recommendations section
 */
function generateRecommendations(findings: Finding[]): string {
  const criticalCount = findings.filter((f) => f.severity === 'P0' || f.severity === 'P1').length;

  const recommendations: string[] = [];

  if (criticalCount > 0) {
    recommendations.push(
      `1. **Address Critical Issues First:** ${criticalCount} critical/high priority findings require immediate attention. Review and fix P0/P1 issues before proceeding with lower priority items.`
    );
  }

  const securityFindings = findings.filter(
    (f) => f.category === 'security' || f.type === 'security'
  );
  if (securityFindings.length > 0) {
    recommendations.push(
      `2. **Security Review:** ${securityFindings.length} security-related findings were detected. Conduct a thorough security review and consider engaging a security specialist.`
    );
  }

  const accessibilityFindings = findings.filter(
    (f) => f.category === 'accessibility' || f.type === 'accessibility'
  );
  if (accessibilityFindings.length > 0) {
    recommendations.push(
      `3. **Accessibility Improvements:** ${accessibilityFindings.length} accessibility findings were detected. Ensure the application is usable by all users, including those with disabilities.`
    );
  }

  const performanceFindings = findings.filter(
    (f) => f.category === 'performance' || f.type === 'performance'
  );
  if (performanceFindings.length > 0) {
    recommendations.push(
      `4. **Performance Optimization:** ${performanceFindings.length} performance-related findings were detected. Consider performance testing and optimization.`
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      '1. **Continue Monitoring:** No critical issues were detected. Continue monitoring the application and conduct regular audits to maintain quality.'
    );
  }

  return `## Recommendations

${recommendations.join('\n\n')}`;
}
