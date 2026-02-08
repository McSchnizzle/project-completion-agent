/**
 * Verification Modules
 *
 * Finding verification and aggregation utilities.
 */

// Verifier
export {
  VerificationStatus,
  VerificationAttempt,
  VerifiedFinding,
  VerificationConfig,
  isBrowserTestable,
  determineStatus,
  determineFinalSeverity,
  determineLabels,
  shouldIncludeInReport,
  shouldCreateGithubIssue,
  createVerifiedFinding,
  VerificationCoordinator
} from './verifier';

// Aggregator
export {
  RawFinding,
  NormalizedFinding,
  AggregationResult,
  aggregateFindings,
  mergeWithPreviousAudit,
  groupByCategory,
  prioritizeForVerification
} from './aggregator';
