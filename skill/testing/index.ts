/**
 * Testing Modules
 *
 * Browser-based testing utilities for the complete-audit skill.
 */

// Coverage-driven exploration
export {
  ExplorationConfig,
  QueuedUrl,
  VisitedUrl,
  CoverageMetrics,
  CoverageExplorer,
  extractLinks
} from './coverage-explorer';

// Form testing (Task 6.9: Safe/Full modes)
export {
  FormTestMode,
  FormTestConfig,
  DEFAULT_SAFE_CONFIG,
  DEFAULT_FULL_CONFIG,
  FormField,
  FormInfo,
  TestCase,
  TestResult,
  classifyForm,
  generateTestCases,
  analyzeTestResult,
  identifyValidationGaps,
  shouldTestForm,
  analyzeFormSafe,
  getTestCasesForMode,
  createTestConfig
} from './form-tester';

// Responsive testing
export {
  ViewportConfig,
  ResponsiveTestResult,
  ResponsiveIssue,
  VIEWPORT_CONFIGS,
  analyzeViewport,
  getOverflowCheckScript,
  getNavigationCheckScript,
  generateViewportTests,
  prioritizePagesForResponsiveTesting,
  summarizeResponsiveResults
} from './responsive-tester';
