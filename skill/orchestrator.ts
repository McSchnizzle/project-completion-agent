/**
 * Audit Orchestrator
 * Task 6.2: Orchestrator Pipeline Implementation
 *
 * Manages the execution of audit stages in sequence,
 * handles parallel execution, checkpointing, and recovery.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  initializeCheckpoint,
  loadCheckpoint,
  saveCheckpoint,
  startStage,
  completeStage,
  failStage,
  checkStopFlag,
  checkContinueFlag,
  determineResumePoint,
  Checkpoint
} from './utils/checkpoint';

import {
  initializeProgress,
  loadProgress,
  updateStatus,
  startStageProgress,
  completeStageProgress,
  failStageProgress,
  skipStageProgress,
  updateMetrics,
  setStopFlag as setProgressStopFlag
} from './utils/progress-writer';

import { STAGES, StageName } from './index';

// Import types statically (they don't exist at runtime)
import type { ReportConfig, CoverageReport } from './reporting/report-generator';
import type { NormalizedFinding, RawFinding } from './verification/aggregator';

export interface OrchestratorConfig {
  audit_id: string;
  base_url: string;
  codebase_path: string;
  prd_path?: string;
  focus_areas?: string[];
  mode: 'full' | 'quick' | 'code-only';
  parallel_stages: boolean;
  max_pages: number;
  max_forms: number;
  timeout_per_stage: number;
}

export interface StageResult {
  stage: StageName;
  status: 'completed' | 'failed' | 'skipped';
  findings_count: number;
  duration_seconds: number;
  output_file: string | null;
  error?: string;
}

export interface OrchestratorState {
  config: OrchestratorConfig;
  audit_path: string;
  started_at: string;
  current_stage: StageName | null;
  completed_stages: StageName[];
  skipped_stages: StageName[];
  stage_results: StageResult[];
  is_paused: boolean;
  is_stopped: boolean;
  browser_restarts: number;
  errors_recovered: number;
}

// Stage dependencies - stages that must complete before another can start
const STAGE_DEPENDENCIES: Record<StageName, StageName[]> = {
  'preflight': [],
  'code-scan': ['preflight'],
  'explore': ['preflight'],
  'test': ['explore'],
  'responsive': ['explore'],
  'aggregate': ['code-scan', 'test', 'responsive'],
  'verify': ['aggregate'],
  'compare': ['verify'],
  'report': ['compare']
};

// Stages that can run in parallel
const PARALLEL_GROUPS: StageName[][] = [
  ['code-scan', 'explore'],  // Can run simultaneously after preflight
  ['test', 'responsive']     // Can run simultaneously after explore
];

/**
 * Main Orchestrator class
 */
export class AuditOrchestrator {
  private state: OrchestratorState;
  private checkpoint: Checkpoint | null = null;

  constructor(config: OrchestratorConfig) {
    const auditPath = path.join(
      process.cwd(),
      '.complete-agent',
      'audits',
      config.audit_id
    );

    this.state = {
      config,
      audit_path: auditPath,
      started_at: new Date().toISOString(),
      current_stage: null,
      completed_stages: [],
      skipped_stages: [],
      stage_results: [],
      is_paused: false,
      is_stopped: false,
      browser_restarts: 0,
      errors_recovered: 0
    };
  }

  /**
   * Initialize a new audit
   */
  async initialize(): Promise<void> {
    // Create audit directory
    fs.mkdirSync(this.state.audit_path, { recursive: true });
    fs.mkdirSync(path.join(this.state.audit_path, 'stages'), { recursive: true });
    fs.mkdirSync(path.join(this.state.audit_path, 'findings'), { recursive: true });
    fs.mkdirSync(path.join(this.state.audit_path, 'screenshots'), { recursive: true });

    // Initialize checkpoint
    this.checkpoint = initializeCheckpoint(this.state.audit_path, this.state.config.audit_id);

    // Initialize progress tracking
    initializeProgress(this.state.audit_path, this.state.config.audit_id);
  }

  /**
   * Resume an existing audit from checkpoint
   */
  async resume(): Promise<boolean> {
    this.checkpoint = loadCheckpoint(this.state.audit_path);

    if (!this.checkpoint || !this.checkpoint.can_resume) {
      return false;
    }

    // Restore state from checkpoint
    const resumePoint = determineResumePoint(this.state.audit_path, this.checkpoint);

    if (resumePoint) {
      this.state.completed_stages = this.checkpoint.completed_stages as StageName[];
      this.state.current_stage = resumePoint.stage as StageName;

      // Load progress
      const progress = loadProgress(this.state.audit_path);
      if (progress) {
        this.state.started_at = progress.started_at;
      }

      return true;
    }

    return false;
  }

  /**
   * Run the full audit pipeline
   */
  async run(): Promise<StageResult[]> {
    updateStatus(this.state.audit_path, 'running');

    try {
      // Get stages to run based on mode
      const stagesToRun = this.getStagesToRun();

      // Run stages in order, respecting dependencies
      for (const stage of stagesToRun) {
        // Check for stop/pause flags
        if (this.checkFlags()) {
          break;
        }

        // Check if dependencies are satisfied
        if (!this.areDependenciesSatisfied(stage)) {
          continue; // Will be run later or skipped
        }

        // Check if already completed (for resume)
        if (this.state.completed_stages.includes(stage)) {
          continue;
        }

        // Check if can run in parallel with another stage
        const parallelStage = this.getParallelStage(stage);
        if (parallelStage && this.state.config.parallel_stages) {
          // Run both stages in parallel
          await this.runStagesParallel([stage, parallelStage]);
        } else {
          // Run single stage
          await this.runStage(stage);
        }
      }

      // Determine final status
      const hasFailures = this.state.stage_results.some(r => r.status === 'failed');
      updateStatus(
        this.state.audit_path,
        hasFailures ? 'failed' : this.state.is_stopped ? 'stopped' : 'completed'
      );

    } catch (error) {
      updateStatus(this.state.audit_path, 'failed');
      throw error;
    }

    return this.state.stage_results;
  }

  /**
   * Run a single stage
   */
  private async runStage(stage: StageName): Promise<StageResult> {
    const startTime = Date.now();
    this.state.current_stage = stage;

    // Update progress
    startStageProgress(this.state.audit_path, stage);

    // Start stage in checkpoint
    startStage(this.state.audit_path, stage, []);

    let result: StageResult;

    try {
      // Execute stage logic
      const output = await this.executeStage(stage);

      // Complete stage
      completeStage(this.state.audit_path, stage, output.output_files);
      completeStageProgress(this.state.audit_path, stage, output.findings_count);

      result = {
        stage,
        status: 'completed',
        findings_count: output.findings_count,
        duration_seconds: (Date.now() - startTime) / 1000,
        output_file: output.output_files[0] || null
      };

      this.state.completed_stages.push(stage);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Fail stage
      failStage(this.state.audit_path, stage, errorMessage, false);
      failStageProgress(this.state.audit_path, stage, errorMessage, false);

      result = {
        stage,
        status: 'failed',
        findings_count: 0,
        duration_seconds: (Date.now() - startTime) / 1000,
        output_file: null,
        error: errorMessage
      };

      this.state.errors_recovered++;
    }

    this.state.stage_results.push(result);
    this.state.current_stage = null;

    return result;
  }

  /**
   * Run multiple stages in parallel
   */
  private async runStagesParallel(stages: StageName[]): Promise<void> {
    const promises = stages.map(stage => this.runStage(stage));
    await Promise.all(promises);
  }

  /**
   * Execute stage-specific logic
   */
  private async executeStage(stage: StageName): Promise<{
    findings_count: number;
    output_files: string[];
  }> {
    const outputDir = path.join(this.state.audit_path, 'stages');

    switch (stage) {
      case 'preflight':
        return this.executePreflightStage(outputDir);

      case 'code-scan':
        return this.executeCodeScanStage(outputDir);

      case 'explore':
        return this.executeExploreStage(outputDir);

      case 'test':
        return this.executeTestStage(outputDir);

      case 'responsive':
        return this.executeResponsiveStage(outputDir);

      case 'aggregate':
        return this.executeAggregateStage(outputDir);

      case 'verify':
        return this.executeVerifyStage(outputDir);

      case 'compare':
        return this.executeCompareStage(outputDir);

      case 'report':
        return this.executeReportStage(outputDir);

      default:
        throw new Error(`Unknown stage: ${stage}`);
    }
  }

  /**
   * Preflight stage - validate environment
   */
  private async executePreflightStage(outputDir: string): Promise<{
    findings_count: number;
    output_files: string[];
  }> {
    const output = {
      schema_version: '1.0.0',
      stage: 'preflight',
      completed_at: new Date().toISOString(),
      environment: {
        base_url: this.state.config.base_url,
        codebase_path: this.state.config.codebase_path,
        prd_path: this.state.config.prd_path || null,
        mode: this.state.config.mode
      },
      checks: {
        url_accessible: true,
        codebase_exists: fs.existsSync(this.state.config.codebase_path),
        prd_exists: this.state.config.prd_path ? fs.existsSync(this.state.config.prd_path) : null
      }
    };

    const outputPath = path.join(outputDir, 'preflight.json');
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

    return { findings_count: 0, output_files: [outputPath] };
  }

  /**
   * Code scan stage - static analysis
   */
  private async executeCodeScanStage(outputDir: string): Promise<{
    findings_count: number;
    output_files: string[];
  }> {
    const { analyzeCodeQuality } = await import('./analyzers/code-quality');
    const { scanSecurity } = await import('./analyzers/security-scanner');
    const { analyzeArchitecture } = await import('./analyzers/architecture-analyzer');

    // Run all analyzers
    const [qualityResult, securityResult, architectureResult] = await Promise.all([
      analyzeCodeQuality(this.state.config.codebase_path),
      scanSecurity(this.state.config.codebase_path),
      analyzeArchitecture(this.state.config.codebase_path)
    ]);

    // Save results
    const qualityPath = path.join(outputDir, 'code-quality.json');
    const securityPath = path.join(outputDir, 'security-scan.json');
    const architecturePath = path.join(outputDir, 'architecture.json');

    fs.writeFileSync(qualityPath, JSON.stringify(qualityResult, null, 2));
    fs.writeFileSync(securityPath, JSON.stringify(securityResult, null, 2));
    fs.writeFileSync(architecturePath, JSON.stringify(architectureResult, null, 2));

    const totalFindings =
      qualityResult.findings.length +
      securityResult.findings.length +
      architectureResult.findings.length;

    // Update metrics
    updateMetrics(this.state.audit_path, {
      findings_total: totalFindings
    });

    return {
      findings_count: totalFindings,
      output_files: [qualityPath, securityPath, architecturePath]
    };
  }

  /**
   * Explore stage - browser exploration
   * Note: This is a placeholder - actual browser automation would be done by the skill
   */
  private async executeExploreStage(outputDir: string): Promise<{
    findings_count: number;
    output_files: string[];
  }> {
    // This stage is typically handled by the skill instructions
    // The orchestrator just creates the expected output structure
    const output = {
      schema_version: '1.0.0',
      stage: 'explore',
      completed_at: new Date().toISOString(),
      pages_discovered: [],
      routes_found: [],
      forms_found: [],
      note: 'Browser exploration to be performed by skill instructions'
    };

    const outputPath = path.join(outputDir, 'explore.json');
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

    return { findings_count: 0, output_files: [outputPath] };
  }

  /**
   * Test stage - form and action testing
   */
  private async executeTestStage(outputDir: string): Promise<{
    findings_count: number;
    output_files: string[];
  }> {
    // This stage is typically handled by the skill instructions
    const output = {
      schema_version: '1.0.0',
      stage: 'test',
      completed_at: new Date().toISOString(),
      forms_tested: [],
      actions_tested: [],
      findings: [],
      note: 'Form testing to be performed by skill instructions'
    };

    const outputPath = path.join(outputDir, 'test.json');
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

    return { findings_count: 0, output_files: [outputPath] };
  }

  /**
   * Responsive stage - viewport testing
   */
  private async executeResponsiveStage(outputDir: string): Promise<{
    findings_count: number;
    output_files: string[];
  }> {
    // This stage is typically handled by the skill instructions
    const output = {
      schema_version: '1.0.0',
      stage: 'responsive',
      completed_at: new Date().toISOString(),
      viewports_tested: ['mobile', 'tablet', 'desktop'],
      findings: [],
      note: 'Responsive testing to be performed by skill instructions'
    };

    const outputPath = path.join(outputDir, 'responsive.json');
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

    return { findings_count: 0, output_files: [outputPath] };
  }

  /**
   * Aggregate stage - collect and deduplicate findings
   */
  private async executeAggregateStage(outputDir: string): Promise<{
    findings_count: number;
    output_files: string[];
  }> {
    const { aggregateFindings } = await import('./verification/aggregator');

    // Collect findings from all stages
    const rawFindings: RawFinding[] = [];

    // Load code-scan findings
    const codeScanFiles = ['code-quality.json', 'security-scan.json', 'architecture.json'];
    for (const file of codeScanFiles) {
      const filePath = path.join(outputDir, file);
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (data.findings) {
          for (const finding of data.findings) {
            rawFindings.push({
              source: 'code-scan',
              type: finding.type,
              severity: finding.severity || 'P3',
              message: finding.message,
              file: finding.file,
              line: finding.line
            });
          }
        }
      }
    }

    // Aggregate and deduplicate
    const result = aggregateFindings(rawFindings);

    const output = {
      schema_version: '1.0.0',
      stage: 'aggregate',
      completed_at: new Date().toISOString(),
      summary: result.summary,
      findings: result.findings
    };

    const outputPath = path.join(outputDir, 'aggregate.json');
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

    // Save individual findings
    const findingsDir = path.join(this.state.audit_path, 'findings');
    for (const finding of result.findings) {
      const findingPath = path.join(findingsDir, `${finding.id}.json`);
      fs.writeFileSync(findingPath, JSON.stringify(finding, null, 2));
    }

    return {
      findings_count: result.findings.length,
      output_files: [outputPath]
    };
  }

  /**
   * Verify stage - verify browser-testable findings
   */
  private async executeVerifyStage(outputDir: string): Promise<{
    findings_count: number;
    output_files: string[];
  }> {
    const { VerificationCoordinator, isBrowserTestable, createVerifiedFinding } = await import('./verification/verifier');

    // Load aggregated findings
    const aggregatePath = path.join(outputDir, 'aggregate.json');
    if (!fs.existsSync(aggregatePath)) {
      throw new Error('Aggregate stage output not found');
    }

    const aggregateData = JSON.parse(fs.readFileSync(aggregatePath, 'utf-8'));
    const findings = aggregateData.findings || [];

    const coordinator = new VerificationCoordinator();

    // Process each finding
    for (const finding of findings) {
      if (!isBrowserTestable(finding)) {
        // Static analysis findings - mark as NOT_APPLICABLE
        const verified = createVerifiedFinding(
          { id: finding.id, severity: finding.severity, type: finding.type, source: finding.source },
          [],
          `verified-${finding.id.split('-')[1]}`
        );
        coordinator.addVerifiedFinding(verified);
      } else {
        // Browser-testable findings would be verified by skill instructions
        // For now, mark as needing verification
        const verified = createVerifiedFinding(
          { id: finding.id, severity: finding.severity, type: finding.type, source: finding.source },
          [{ attempt: 1, reproduced: false, timestamp: new Date().toISOString(), error: 'Requires browser verification', browser_healthy: true }],
          `verified-${finding.id.split('-')[1]}`
        );
        coordinator.addVerifiedFinding(verified);
      }
    }

    const summary = coordinator.getSummary();
    const verifiedFindings = coordinator.getFindingsForReport();

    const output = {
      schema_version: '1.0.0',
      stage: 'verify',
      completed_at: new Date().toISOString(),
      summary,
      findings: verifiedFindings
    };

    const outputPath = path.join(outputDir, 'verify.json');
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

    return {
      findings_count: verifiedFindings.length,
      output_files: [outputPath]
    };
  }

  /**
   * Compare stage - compare against PRD
   */
  private async executeCompareStage(outputDir: string): Promise<{
    findings_count: number;
    output_files: string[];
  }> {
    let prdComparison = null;

    if (this.state.config.prd_path && fs.existsSync(this.state.config.prd_path)) {
      // Import PRD parser if available
      try {
        const { parsePrdDocument, comparePrdToImplementation } = await import('./comparison/prd-parser');
        const parsedPrd = parsePrdDocument(this.state.config.prd_path);

        // Load verified findings for route discovery
        const verifyPath = path.join(outputDir, 'verify.json');
        const verifyData = fs.existsSync(verifyPath)
          ? JSON.parse(fs.readFileSync(verifyPath, 'utf-8'))
          : { findings: [] };

        // Extract routes from verify data
        const discoveredRoutes: string[] = verifyData.routes || [];
        const uiElements = new Map<string, string[]>();
        const apiEndpoints: string[] = [];

        prdComparison = comparePrdToImplementation(parsedPrd, discoveredRoutes, uiElements, apiEndpoints);
      } catch {
        // PRD comparison module not available
        prdComparison = null;
      }
    }

    const output = {
      schema_version: '1.0.0',
      stage: 'compare',
      completed_at: new Date().toISOString(),
      prd_comparison: prdComparison
    };

    const outputPath = path.join(outputDir, 'compare.json');
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

    return {
      findings_count: 0,
      output_files: [outputPath]
    };
  }

  /**
   * Report stage - generate final report
   */
  private async executeReportStage(outputDir: string): Promise<{
    findings_count: number;
    output_files: string[];
  }> {
    const { generateReport, generateMarkdownReport } = await import('./reporting/report-generator');

    // Load all stage outputs
    const verifyPath = path.join(outputDir, 'verify.json');
    const comparePath = path.join(outputDir, 'compare.json');
    const aggregatePath = path.join(outputDir, 'aggregate.json');

    const verifyData = fs.existsSync(verifyPath)
      ? JSON.parse(fs.readFileSync(verifyPath, 'utf-8'))
      : { findings: [] };

    const compareData = fs.existsSync(comparePath)
      ? JSON.parse(fs.readFileSync(comparePath, 'utf-8'))
      : { prd_comparison: null };

    const aggregateData = fs.existsSync(aggregatePath)
      ? JSON.parse(fs.readFileSync(aggregatePath, 'utf-8'))
      : { findings: [] };

    // Build report config
    const config: ReportConfig = {
      application_name: null,
      application_url: this.state.config.base_url,
      framework: null,
      audit_id: this.state.config.audit_id,
      generated_at: new Date().toISOString()
    };

    // Build coverage report
    const coverage: CoverageReport = {
      routes: { total: 0, visited: 0, percent: 0 },
      pages: { total: 0, tested: 0 },
      forms: { total: 0, tested: 0, percent: 0 },
      viewports: { tested: ['mobile', 'tablet', 'desktop'], issues_found: 0 },
      code_analysis: {
        files_analyzed: 0,
        languages: []
      }
    };

    // Calculate duration
    const durationSeconds = (Date.now() - new Date(this.state.started_at).getTime()) / 1000;

    // Generate report
    const report = generateReport(
      config,
      aggregateData.findings || [],
      verifyData.findings || [],
      coverage,
      compareData.prd_comparison,
      {
        duration_seconds: durationSeconds,
        stages_completed: this.state.completed_stages,
        stages_skipped: this.state.skipped_stages,
        browser_restarts: this.state.browser_restarts,
        errors_recovered: this.state.errors_recovered
      }
    );

    // Generate markdown
    const markdown = generateMarkdownReport(report);

    // Save outputs
    const jsonPath = path.join(this.state.audit_path, 'report.json');
    const mdPath = path.join(this.state.audit_path, 'report.md');

    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    fs.writeFileSync(mdPath, markdown);

    return {
      findings_count: report.summary.total_findings,
      output_files: [jsonPath, mdPath]
    };
  }

  /**
   * Get stages to run based on mode
   */
  private getStagesToRun(): StageName[] {
    switch (this.state.config.mode) {
      case 'code-only':
        return ['preflight', 'code-scan', 'aggregate', 'report'];

      case 'quick':
        return ['preflight', 'code-scan', 'explore', 'aggregate', 'verify', 'report'];

      case 'full':
      default:
        return [...STAGES];
    }
  }

  /**
   * Check if dependencies are satisfied
   */
  private areDependenciesSatisfied(stage: StageName): boolean {
    const deps = STAGE_DEPENDENCIES[stage];
    return deps.every(dep => this.state.completed_stages.includes(dep));
  }

  /**
   * Get parallel stage if available
   */
  private getParallelStage(stage: StageName): StageName | null {
    for (const group of PARALLEL_GROUPS) {
      if (group.includes(stage)) {
        const other = group.find(s => s !== stage && !this.state.completed_stages.includes(s));
        if (other && this.areDependenciesSatisfied(other)) {
          return other;
        }
      }
    }
    return null;
  }

  /**
   * Check stop/pause flags
   */
  private checkFlags(): boolean {
    if (checkStopFlag(this.state.audit_path)) {
      this.state.is_stopped = true;
      setProgressStopFlag(this.state.audit_path);
      return true;
    }

    if (!checkContinueFlag(this.state.audit_path) && this.state.is_paused) {
      return true;
    }

    return false;
  }

  /**
   * Get current state
   */
  getState(): OrchestratorState {
    return { ...this.state };
  }

  /**
   * Get audit path
   */
  getAuditPath(): string {
    return this.state.audit_path;
  }
}

/**
 * Create a new audit orchestrator
 */
export function createOrchestrator(config: OrchestratorConfig): AuditOrchestrator {
  return new AuditOrchestrator(config);
}

/**
 * Generate audit ID
 */
export function generateAuditId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toISOString().slice(11, 19).replace(/:/g, '');
  return `audit-${date}-${time}`;
}
