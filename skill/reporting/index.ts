/**
 * Reporting Modules
 *
 * Report generation and dashboard utilities.
 */

// Report Generator
export {
  ReportConfig,
  ReportSummary,
  CoverageReport,
  PrdComparison,
  AuditReport,
  calculateScore,
  scoreToGrade,
  determineStatus,
  generateHeadline,
  generateRecommendations,
  generateReport,
  generateMarkdownReport
} from './report-generator';

// Dashboard
export {
  DashboardData,
  generateDashboardHtml,
  generateDashboardJson
} from './dashboard';
