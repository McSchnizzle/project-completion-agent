/**
 * Complete Audit Skill - Core Modules
 *
 * A comprehensive web application auditing system that:
 * - Analyzes code for quality, security, and architecture issues
 * - Explores running applications via browser automation
 * - Tests forms, actions, and responsive design
 * - Verifies findings and generates actionable reports
 *
 * @version 1.0.0
 */

// Utility modules - explicit exports to avoid conflicts
export {
  StageState,
  Checkpoint,
  ResumePoint,
  SessionState,
  StageOutput,
  CheckpointError,
  getAuditPath,
  getStageStatePath,
  initializeCheckpoint,
  loadCheckpoint,
  saveCheckpoint,
  startStage,
  completeStage,
  failStage,
  loadStageState,
  getSkippableStages,
  checkStopFlag,
  checkContinueFlag,
  determineResumePoint,
  updateResumePoint,
  saveSessionState,
  getCompletedStages,
  stopCheckpoint,
  pauseCheckpoint,
  CanonicalizedUrl,
  RoutePattern,
  CanonicalizationOptions,
  canonicalizeUrl,
  generateRouteId,
  isSameRoute,
  RouteRegistry,
  getBaseUrl,
  isAllowedDomain,
  FindingSignatureInput,
  FindingSignature,
  generateSignature,
  isDuplicate,
  signatureToId,
  findDuplicates,
  compareFindings,
  StageProgress,
  AuditProgress,
  initializeProgress,
  loadProgress,
  writeProgress,
  updateStatus,
  startStageProgress,
  updateStageProgress,
  completeStageProgress,
  failStageProgress,
  skipStageProgress,
  updateMetrics,
  incrementFindings,
  setStopFlag,
  setCheckpoint,
  RetryOptions,
  BrowserHealthCheck,
  BrowserStabilityError,
  withRetry,
  waitForPageStable,
  RecoveryStrategies,
  CircuitBreaker,
  withCircuitBreaker,
  createStableBrowserAction,
  QueuedUrl as CoverageQueuedUrl,
  QueueState,
  QueueStats,
  CoverageQueue,
  ScreenshotMetadata,
  ScreenshotIndex,
  ScreenshotManager
} from './utils';

// Code analysis modules
export * from './analyzers';

// Browser testing modules - explicit exports to avoid conflicts
export {
  ExplorationConfig,
  QueuedUrl as ExplorationQueuedUrl,
  VisitedUrl,
  CoverageMetrics,
  CoverageExplorer,
  extractLinks,
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
  createTestConfig,
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
} from './testing';

// Verification modules - explicit exports to avoid conflicts
export {
  VerificationStatus,
  VerificationAttempt,
  VerifiedFinding,
  VerificationConfig,
  isBrowserTestable,
  determineStatus as determineVerificationStatus,
  determineFinalSeverity,
  determineLabels,
  shouldIncludeInReport,
  shouldCreateGithubIssue,
  createVerifiedFinding,
  VerificationCoordinator,
  RawFinding,
  NormalizedFinding,
  AggregationResult,
  aggregateFindings as aggregateFindingsFromVerification,
  mergeWithPreviousAudit,
  groupByCategory,
  prioritizeForVerification
} from './verification';

// Reporting modules
export * from './reporting';

// Comparison modules
export * from './comparison';

// Phase modules
export * from './phases';

// Schema version
export const SCHEMA_VERSION = '1.0.0';

// Stage definitions
export const STAGES = [
  'preflight',
  'code-scan',
  'explore',
  'test',
  'responsive',
  'aggregate',
  'verify',
  'compare',
  'report'
] as const;

export type StageName = typeof STAGES[number];

// Stage descriptions
export const STAGE_DESCRIPTIONS: Record<StageName, string> = {
  'preflight': 'Validate environment and gather baseline information',
  'code-scan': 'Static analysis for code quality, security, and architecture',
  'explore': 'Browser-based page discovery and element cataloging',
  'test': 'Form testing and action verification',
  'responsive': 'Viewport testing across device sizes',
  'aggregate': 'Collect and deduplicate findings',
  'verify': 'Reproduce browser-testable findings',
  'compare': 'Compare against PRD requirements',
  'report': 'Generate final report and create issues'
};
