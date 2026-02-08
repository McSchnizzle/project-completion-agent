/**
 * Phase Modules - Audit Pipeline Phases
 *
 * Each phase module provides the logic and helpers for a specific
 * stage of the audit pipeline.
 */

// Phase 0: Preflight
export {
  PreflightResult,
  runPreflight,
  checkWriteAccess,
  checkGitHubCli,
  loadConfig,
  discoverPrdFiles,
  formatPreflightSummary,
  initializeAuditDirectory,
  validatePreflightGate
} from './preflight';

// Phase 2: Code Analysis
export {
  RouteInfo,
  FormInfo,
  FormFieldInfo,
  ApiEndpoint,
  FeatureRouteMapping,
  CodeAnalysisResult,
  runCodeAnalysis,
  writeCodeAnalysis,
  loadCodeAnalysis
} from './code-analysis';

// Phase 4: Exploration
export {
  QueuedUrl,
  VisitedPage,
  PageElement,
  PageInventory,
  FormInventory,
  FormFieldInventory,
  ExplorationConfig,
  DEFAULT_EXPLORATION_CONFIG,
  initializeExplorationQueue,
  shouldVisitUrl,
  addLinksToQueue,
  generatePageInventory,
  generateCoverageSummary,
  writePageInventory,
  loadPageInventories,
  writeExplorationState,
  loadExplorationState,
  getNextUrl,
  recordPageVisit
} from './exploration';

// Phase 5: Safety
export {
  SafetyConfig,
  SafetyCheckResult,
  DestructiveActionInfo,
  SafetyLog,
  DEFAULT_SAFE_CONFIG,
  isDestructiveAction,
  analyzeAction,
  enforceSafeMode,
  shouldSkipAction,
  isProductionUrl,
  createSafetyConfig,
  canTestForm,
  logSafetyDecision,
  getSafetyLogs,
  clearSafetyLogs,
  writeSafetyLogs,
  generateSafetySummary
} from './safety';

// Phase 6: Form Testing
export {
  UnifiedFormInfo,
  UnifiedFormField,
  FormTestPlan,
  FormTestPlanEntry,
  FormTestResultEntry,
  FormTestSummary,
  mergeFormSources,
  generateFormTestPlan,
  recordFormTestResult,
  generateFormTestSummary,
  writeFormTestPlan,
  writeFormTestSummary,
  loadFormTestPlan,
  loadFormTestSummary,
  getFormsToTest,
  getSkippedForms,
  calculateFormTestCoverage
} from './form-testing';

// Phase 7: Finding Quality
export {
  Finding,
  FindingEvidence,
  CritiqueResult,
  QualityIssue,
  ExistingIssue,
  RepoInfo,
  EvidenceCheck,
  critiqueFinding,
  deduplicateFindings,
  checkGitHubDuplicates,
  parseGitHubIssues,
  enforceEvidence,
  filterByQuality,
  groupFindingsByCategory,
  sortFindings,
  generateQualityReport,
  writeQualityReport
} from './finding-quality';

// Phase 8: Reporting
export {
  ReviewDecision,
  ReviewDecisionsJson,
  CreatedIssue,
  CreatedIssuesJson,
  IssueBody,
  generateReviewDecisions,
  generateReviewDecisionsJson,
  generateCreatedIssuesJson,
  formatIssueBody,
  formatGhCreateCommand,
  recordCreatedIssue,
  writeReviewDecisions,
  writeCreatedIssues,
  loadReviewDecisions,
  loadCreatedIssues,
  generateReportSummary,
  writeReportSummary,
  getFindingsForIssueCreation
} from './reporting';

// Phase 9: Verification
export {
  VerificationResult,
  IssueFile,
  VerificationAttempt,
  RegressionTestResult,
  ParsedVerifyCommand,
  parseVerifyCommand,
  loadIssueFile,
  saveIssueFile,
  createIssueFile,
  recordVerificationAttempt,
  createVerificationResult,
  prepareVerification,
  findRelatedFindings,
  generateVerificationSummary,
  shouldCloseIssue,
  getCurrentIssueStatus,
  listIssueFiles
} from './verification';

// Phase 10: Polish
export {
  CommandFlags,
  FocusPattern,
  CleanupResult,
  CheckpointValidation,
  parseCommandFlags,
  mapFocusToPatterns,
  urlMatchesFocus,
  cleanupOldAudits,
  formatBytes,
  validateCheckpoint,
  generateCleanupSummary,
  findLatestAudit,
  hasResumableAudit,
  getAuditAge
} from './polish';
