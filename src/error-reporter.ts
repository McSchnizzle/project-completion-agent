/**
 * Error Reporter - Structured error and cost logging.
 *
 * Collects errors during audit execution and produces a structured
 * summary at completion.
 *
 * @module error-reporter
 */

import fs from 'node:fs';
import { getMetricsPath, getAuditLogPath } from './artifact-paths';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditError {
  phase: string;
  message: string;
  timestamp: string;
  fatal: boolean;
  stack?: string;
}

export interface AuditSummary {
  auditId: string;
  startedAt: string;
  completedAt: string;
  totalCostUsd: number;
  totalDurationMs: number;
  totalTokens: { input: number; output: number };
  phaseSummaries: PhaseSummary[];
  errors: AuditError[];
  success: boolean;
}

export interface PhaseSummary {
  phase: string;
  status: 'completed' | 'failed' | 'skipped';
  costUsd: number;
  durationMs: number;
  tokens: { input: number; output: number };
  errors: number;
}

// ---------------------------------------------------------------------------
// ErrorReporter
// ---------------------------------------------------------------------------

export class ErrorReporter {
  private readonly auditId: string;
  private readonly startedAt: string;
  private readonly errors: AuditError[] = [];
  private readonly phaseSummaries: PhaseSummary[] = [];

  constructor(auditId: string) {
    this.auditId = auditId;
    this.startedAt = new Date().toISOString();
  }

  /**
   * Record an error that occurred during a phase.
   */
  recordError(phase: string, error: Error | string, fatal = false): void {
    const auditError: AuditError = {
      phase,
      message: error instanceof Error ? error.message : error,
      timestamp: new Date().toISOString(),
      fatal,
      stack: error instanceof Error ? error.stack : undefined,
    };

    this.errors.push(auditError);

    const prefix = fatal ? 'FATAL' : 'ERROR';
    console.error(`[${prefix}] [${phase}] ${auditError.message}`);
  }

  /**
   * Record a completed phase's summary.
   */
  recordPhase(summary: PhaseSummary): void {
    this.phaseSummaries.push(summary);
  }

  /**
   * Get all errors for a specific phase.
   */
  getPhaseErrors(phase: string): AuditError[] {
    return this.errors.filter(e => e.phase === phase);
  }

  /**
   * Check if any fatal errors occurred.
   */
  hasFatalError(): boolean {
    return this.errors.some(e => e.fatal);
  }

  /**
   * Generate the final audit summary.
   */
  getSummary(): AuditSummary {
    const totalCostUsd = this.phaseSummaries.reduce((acc, p) => acc + p.costUsd, 0);
    const totalDurationMs = this.phaseSummaries.reduce((acc, p) => acc + p.durationMs, 0);
    const totalInput = this.phaseSummaries.reduce((acc, p) => acc + p.tokens.input, 0);
    const totalOutput = this.phaseSummaries.reduce((acc, p) => acc + p.tokens.output, 0);

    return {
      auditId: this.auditId,
      startedAt: this.startedAt,
      completedAt: new Date().toISOString(),
      totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
      totalDurationMs,
      totalTokens: { input: totalInput, output: totalOutput },
      phaseSummaries: [...this.phaseSummaries],
      errors: [...this.errors],
      success: !this.hasFatalError() && this.phaseSummaries.every(p => p.status !== 'failed'),
    };
  }

  /**
   * Write audit metrics to disk.
   */
  writeMetrics(auditDir: string): void {
    const summary = this.getSummary();
    const metricsPath = getMetricsPath(auditDir);
    fs.writeFileSync(metricsPath, JSON.stringify(summary, null, 2), 'utf-8');
  }

  /**
   * Print summary to stdout.
   */
  printSummary(): void {
    const s = this.getSummary();
    console.log('\n=== Audit Summary ===');
    console.log(`  Audit ID:  ${s.auditId}`);
    console.log(`  Status:    ${s.success ? 'SUCCESS' : 'FAILED'}`);
    console.log(`  Duration:  ${(s.totalDurationMs / 1000).toFixed(1)}s`);
    console.log(`  Cost:      $${s.totalCostUsd.toFixed(4)}`);
    console.log(`  Tokens:    ${s.totalTokens.input} in / ${s.totalTokens.output} out`);
    console.log(`  Phases:    ${s.phaseSummaries.length}`);
    console.log(`  Errors:    ${s.errors.length}`);

    if (s.errors.length > 0) {
      console.log('\n  Errors:');
      for (const e of s.errors) {
        const prefix = e.fatal ? 'FATAL' : 'ERROR';
        console.log(`    [${prefix}] [${e.phase}] ${e.message}`);
      }
    }

    console.log('====================\n');
  }
}

/**
 * Append a structured log entry to the audit log JSONL file.
 */
export function appendAuditLog(
  auditDir: string,
  entry: { event: string; phase?: string; data?: Record<string, unknown> },
): void {
  const logPath = getAuditLogPath(auditDir);
  const line = JSON.stringify({
    ...entry,
    timestamp: new Date().toISOString(),
  });
  fs.appendFileSync(logPath, line + '\n', 'utf-8');
}
