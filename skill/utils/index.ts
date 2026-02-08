/**
 * Complete Audit Utilities
 *
 * Shared utilities for the modular complete-audit skill pipeline.
 */

// Stage state and checkpointing
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
  pauseCheckpoint
} from './checkpoint';

// URL canonicalization and route management
export {
  CanonicalizedUrl,
  RoutePattern,
  CanonicalizationOptions,
  canonicalizeUrl,
  generateRouteId,
  isSameRoute,
  RouteRegistry,
  getBaseUrl,
  isAllowedDomain
} from './url-canonicalizer';

// Finding signature generation
export {
  FindingSignatureInput,
  FindingSignature,
  generateSignature,
  isDuplicate,
  signatureToId,
  findDuplicates,
  compareFindings
} from './signature';

// Progress tracking and reporting
export {
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
  setCheckpoint
} from './progress-writer';

// Browser stability and retry logic (Task 6.5)
export {
  RetryOptions,
  BrowserHealthCheck,
  BrowserStabilityError,
  withRetry,
  waitForPageStable,
  RecoveryStrategies,
  CircuitBreaker,
  withCircuitBreaker,
  createStableBrowserAction
} from './browser-stability';

// Coverage queue persistence (Task 6.10)
export {
  QueuedUrl,
  QueueState,
  QueueStats,
  CoverageQueue
} from './coverage-queue';

// Screenshot management (Task 6.11)
export {
  ScreenshotMetadata,
  ScreenshotIndex,
  ScreenshotManager
} from './screenshot-manager';
