/**
 * Phase Registry - Centralized configuration for all audit pipeline phases.
 *
 * Defines metadata for every phase including execution order, dependencies,
 * browser requirements, budget limits, and parallel grouping. Used by the
 * orchestrator to plan and execute the audit pipeline.
 *
 * @module phase-registry
 */

/** All recognized phase names in the audit pipeline. */
export type PhaseName =
  | 'preflight'
  | 'prd-parsing'
  | 'code-analysis'
  | 'progress-init'
  | 'safety'
  | 'exploration'
  | 'form-testing'
  | 'responsive-testing'
  | 'finding-quality'
  | 'reporting'
  | 'interactive-review'
  | 'github-issues'
  | 'verification'
  | 'polish';

/** How a phase is executed. */
export type PhaseType = 'pure-ts' | 'claude-driven' | 'browser-claude';

/** Metadata describing a single pipeline phase. */
export interface PhaseMetadata {
  /** Unique identifier matching the PhaseName union. */
  id: PhaseName;
  /** Human-readable display name. */
  name: string;
  /** Execution order in the pipeline (lower runs first). */
  pipelineOrder: number;
  /** How this phase is executed. */
  phaseType: PhaseType;
  /** Path to the prompt template file, or undefined for code-only phases. */
  promptPath?: string;
  /** AJV schema name used to validate phase output. */
  schemaId?: string;
  /** Whether the phase needs a browser session. */
  requiresBrowser: boolean;
  /** Default budget for this phase in USD. */
  budgetUsd: number;
  /** Phases that must complete before this one can start. */
  dependencies: PhaseName[];
  /** Names of artifact types produced by this phase. */
  outputArtifacts: string[];
  /** Phases sharing a parallelGroup value may execute concurrently. */
  parallelGroup?: string;
}

/**
 * Master registry of all audit pipeline phases.
 *
 * Keyed by PhaseName for O(1) lookup. Pipeline order determines the
 * default sequential execution order; the `parallelGroup` field allows
 * the orchestrator to run certain phases concurrently when enabled.
 */
export const PHASE_REGISTRY: Record<PhaseName, PhaseMetadata> = {
  preflight: {
    id: 'preflight',
    name: 'Preflight Checks',
    pipelineOrder: 0,
    phaseType: 'pure-ts',
    schemaId: 'environment',
    requiresBrowser: false,
    budgetUsd: 0.10,
    dependencies: [],
    outputArtifacts: ['config', 'environment-check'],
  },

  'prd-parsing': {
    id: 'prd-parsing',
    name: 'PRD Parsing',
    pipelineOrder: 1,
    phaseType: 'pure-ts',
    schemaId: 'prd-summary',
    requiresBrowser: false,
    budgetUsd: 0,
    dependencies: ['preflight'],
    outputArtifacts: ['prd-summary'],
  },

  'code-analysis': {
    id: 'code-analysis',
    name: 'Code Analysis',
    pipelineOrder: 1,
    phaseType: 'pure-ts',
    schemaId: 'code-analysis',
    requiresBrowser: false,
    budgetUsd: 0,
    dependencies: ['preflight'],
    outputArtifacts: ['code-analysis', 'route-map'],
    parallelGroup: 'analysis',
  },

  'progress-init': {
    id: 'progress-init',
    name: 'Progress Initialization',
    pipelineOrder: 2,
    phaseType: 'pure-ts',
    schemaId: 'progress',
    requiresBrowser: false,
    budgetUsd: 0.05,
    dependencies: ['prd-parsing', 'code-analysis'],
    outputArtifacts: ['progress'],
  },

  safety: {
    id: 'safety',
    name: 'Safety Analysis',
    pipelineOrder: 2,
    phaseType: 'pure-ts',
    schemaId: 'safety-config',
    requiresBrowser: false,
    budgetUsd: 0.20,
    dependencies: ['preflight'],
    outputArtifacts: ['safety-config', 'safety-log'],
  },

  exploration: {
    id: 'exploration',
    name: 'Browser Exploration',
    pipelineOrder: 3,
    phaseType: 'browser-claude',
    promptPath: 'prompts/phase-4-exploration.md',
    schemaId: 'page',
    requiresBrowser: true,
    budgetUsd: 2.00,
    dependencies: ['code-analysis', 'safety'],
    outputArtifacts: ['page-inventory', 'screenshots', 'coverage-summary'],
  },

  'form-testing': {
    id: 'form-testing',
    name: 'Form Testing',
    pipelineOrder: 4,
    phaseType: 'browser-claude',
    promptPath: 'prompts/phase-6-form-testing.md',
    schemaId: 'finding',
    requiresBrowser: true,
    budgetUsd: 1.50,
    dependencies: ['exploration'],
    outputArtifacts: ['form-test-results', 'findings', 'test-data'],
    parallelGroup: 'testing',
  },

  'responsive-testing': {
    id: 'responsive-testing',
    name: 'Responsive Testing',
    pipelineOrder: 4,
    phaseType: 'browser-claude',
    promptPath: 'prompts/phase-6-responsive.md',
    schemaId: 'finding',
    requiresBrowser: true,
    budgetUsd: 1.00,
    dependencies: ['exploration'],
    outputArtifacts: ['responsive-results', 'findings', 'screenshots'],
    parallelGroup: 'testing',
  },

  'finding-quality': {
    id: 'finding-quality',
    name: 'Finding Quality Review',
    pipelineOrder: 5,
    phaseType: 'pure-ts',
    schemaId: 'verified-finding',
    requiresBrowser: false,
    budgetUsd: 0,
    dependencies: ['form-testing'],
    outputArtifacts: ['quality-report', 'verified-findings'],
  },

  reporting: {
    id: 'reporting',
    name: 'Report Generation',
    pipelineOrder: 6,
    phaseType: 'pure-ts',
    schemaId: 'report',
    requiresBrowser: false,
    budgetUsd: 0.30,
    dependencies: ['finding-quality'],
    outputArtifacts: ['report', 'coverage-summary', 'dashboard'],
  },

  'interactive-review': {
    id: 'interactive-review',
    name: 'Interactive Review',
    pipelineOrder: 7,
    phaseType: 'claude-driven',
    promptPath: 'prompts/phase-8-review.md',
    requiresBrowser: false,
    budgetUsd: 0.50,
    dependencies: ['reporting'],
    outputArtifacts: ['review-decisions'],
  },

  'github-issues': {
    id: 'github-issues',
    name: 'GitHub Issue Creation',
    pipelineOrder: 8,
    phaseType: 'pure-ts',
    requiresBrowser: false,
    budgetUsd: 0.20,
    dependencies: ['interactive-review'],
    outputArtifacts: ['created-issues'],
  },

  verification: {
    id: 'verification',
    name: 'Fix Verification',
    pipelineOrder: 9,
    phaseType: 'browser-claude',
    promptPath: 'prompts/phase-9-verification.md',
    schemaId: 'verified-finding',
    requiresBrowser: true,
    budgetUsd: 1.50,
    dependencies: ['github-issues'],
    outputArtifacts: ['verification-results', 'regression-tests'],
  },

  polish: {
    id: 'polish',
    name: 'Polish & Cleanup',
    pipelineOrder: 10,
    phaseType: 'pure-ts',
    requiresBrowser: false,
    budgetUsd: 0.10,
    dependencies: ['verification'],
    outputArtifacts: ['audit-metrics', 'cleanup-log'],
  },
};

/**
 * Retrieve the metadata for a single phase.
 *
 * @param name - The phase to look up.
 * @returns The PhaseMetadata for the requested phase.
 * @throws {Error} If the phase name is not in the registry.
 */
export function getPhaseConfig(name: PhaseName): PhaseMetadata {
  const meta = PHASE_REGISTRY[name];
  if (!meta) {
    throw new Error(`Unknown phase: ${name}`);
  }
  return meta;
}

/**
 * List all phases that require a browser session.
 *
 * @returns An array of PhaseName values whose `requiresBrowser` flag is true.
 */
export function getPhasesRequiringBrowser(): PhaseName[] {
  return Object.values(PHASE_REGISTRY)
    .filter((meta) => meta.requiresBrowser)
    .map((meta) => meta.id);
}

/**
 * Return all phases sorted by their pipeline execution order.
 *
 * Phases with the same `pipelineOrder` are returned in registry-insertion
 * order (which matches the natural declaration order above).
 *
 * @returns A new array of PhaseMetadata sorted ascending by pipelineOrder.
 */
export function getPhasesByOrder(): PhaseMetadata[] {
  return Object.values(PHASE_REGISTRY).sort(
    (a, b) => a.pipelineOrder - b.pipelineOrder,
  );
}

/**
 * Build a map of parallel group names to the phases in each group.
 *
 * Only phases that declare a `parallelGroup` are included. The orchestrator
 * uses this to decide which phases can execute concurrently.
 *
 * @returns A Map keyed by group name, with arrays of PhaseName values.
 */
export function getParallelGroups(): Map<string, PhaseName[]> {
  const groups = new Map<string, PhaseName[]>();

  for (const meta of Object.values(PHASE_REGISTRY)) {
    if (meta.parallelGroup) {
      const existing = groups.get(meta.parallelGroup) ?? [];
      existing.push(meta.id);
      groups.set(meta.parallelGroup, existing);
    }
  }

  return groups;
}
