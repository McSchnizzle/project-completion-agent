/**
 * Comparison Module
 * Task 6.7: PRD Comparison Logic
 *
 * Provides tools for comparing implementation against
 * product requirements and planning documents.
 */

export {
  PrdFeature,
  PrdRequirement,
  ImplementationEvidence,
  ParsedPrd,
  PrdSection,
  PrdComparisonResult,
  FeatureComparisonResult,
  PrdSummaryJson,
  PrdFeatureSummary,
  parsePrdDocument,
  comparePrdToImplementation,
  findPrdFiles,
  generatePrdSummaryJson,
  updateFeatureStatus,
  writePrdSummary,
  loadPrdSummary,
  getFeaturesByStatus,
  getMissingHighPriorityFeatures
} from './prd-parser';
