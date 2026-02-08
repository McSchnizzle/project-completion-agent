/**
 * Cost Tracker Service
 * T-G07: Token and cost accounting for audit phases
 *
 * Tracks per-phase token usage, cost in USD, duration, and retry counts.
 * Provides budget-checking helpers so the orchestrator can abort early
 * when spending exceeds configured limits.
 */

import { writeFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Metrics collected for a single completed (or failed) phase. */
export interface PhaseMetrics {
  /** Human-readable phase name (e.g. "preflight", "code-scan"). */
  phaseName: string;
  /** Total input tokens consumed during this phase. */
  inputTokens: number;
  /** Total output tokens consumed during this phase. */
  outputTokens: number;
  /** Estimated cost in US dollars for this phase. */
  costUsd: number;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** ISO-8601 timestamp when the phase started. */
  startedAt: string;
  /** ISO-8601 timestamp when the phase completed (or failed). */
  completedAt: string;
  /** Number of retries attempted before the final result. */
  retries: number;
  /** Terminal status of the phase. */
  status: 'completed' | 'failed' | 'incomplete';
}

/** Aggregate metrics for an entire audit run. */
export interface AuditMetrics {
  /** Unique audit identifier. */
  auditId: string;
  /** ISO-8601 timestamp when the audit started. */
  startedAt: string;
  /** ISO-8601 timestamp when the audit completed. `undefined` while running. */
  completedAt?: string;
  /** Ordered list of per-phase metrics. */
  phases: PhaseMetrics[];
  /** Sum of `costUsd` across all recorded phases. */
  totalCostUsd: number;
  /** Sum of `durationMs` across all recorded phases. */
  totalDurationMs: number;
  /** Sum of `inputTokens` across all recorded phases. */
  totalInputTokens: number;
  /** Sum of `outputTokens` across all recorded phases. */
  totalOutputTokens: number;
}

// ---------------------------------------------------------------------------
// CostTracker
// ---------------------------------------------------------------------------

/**
 * Accumulates token-usage and cost data for every phase of an audit.
 *
 * @example
 * ```ts
 * const tracker = new CostTracker('audit-20260206-120000');
 *
 * tracker.recordPhase({
 *   phaseName: 'preflight',
 *   inputTokens: 1200,
 *   outputTokens: 350,
 *   costUsd: 0.004,
 *   durationMs: 2100,
 *   startedAt: '2026-02-06T12:00:00.000Z',
 *   completedAt: '2026-02-06T12:00:02.100Z',
 *   retries: 0,
 *   status: 'completed',
 * });
 *
 * console.log(tracker.getTotalCost()); // 0.004
 * console.log(tracker.isOverBudget(1.00)); // false
 * ```
 */
export class CostTracker {
  private readonly auditId: string;
  private readonly startedAt: string;
  private readonly phases: PhaseMetrics[] = [];

  constructor(auditId: string) {
    this.auditId = auditId;
    this.startedAt = new Date().toISOString();
  }

  /**
   * Record metrics for a completed (or failed) phase.
   *
   * @param metrics - The phase metrics to record.
   */
  recordPhase(metrics: PhaseMetrics): void {
    this.phases.push({ ...metrics });
  }

  /**
   * Get the total cost across all recorded phases so far.
   *
   * @returns Total cost in USD, rounded to 6 decimal places.
   */
  getTotalCost(): number {
    const sum = this.phases.reduce((acc, p) => acc + p.costUsd, 0);
    return Math.round(sum * 1_000_000) / 1_000_000;
  }

  /**
   * Get the total wall-clock duration across all recorded phases.
   *
   * @returns Total duration in milliseconds.
   */
  getTotalDuration(): number {
    return this.phases.reduce((acc, p) => acc + p.durationMs, 0);
  }

  /**
   * Check whether the cumulative cost has exceeded the given budget.
   *
   * @param maxBudgetUsd - The maximum allowed spend in USD.
   * @returns `true` if total cost exceeds `maxBudgetUsd`.
   */
  isOverBudget(maxBudgetUsd: number): boolean {
    return this.getTotalCost() > maxBudgetUsd;
  }

  /**
   * Check whether adding `additionalCostUsd` to a specific phase would
   * push that phase over its per-phase budget.
   *
   * @param phaseName      - The name of the phase to check.
   * @param additionalCostUsd - The cost about to be incurred.
   * @param maxPhaseBudgetUsd - The maximum allowed spend for this phase.
   * @returns `true` if the phase's accumulated cost plus `additionalCostUsd`
   *          would exceed `maxPhaseBudgetUsd`.
   */
  wouldExceedPhaseBudget(
    phaseName: string,
    additionalCostUsd: number,
    maxPhaseBudgetUsd: number,
  ): boolean {
    const currentPhaseCost = this.phases
      .filter((p) => p.phaseName === phaseName)
      .reduce((acc, p) => acc + p.costUsd, 0);

    return currentPhaseCost + additionalCostUsd > maxPhaseBudgetUsd;
  }

  /**
   * Produce a JSON-serialisable summary of all audit metrics.
   *
   * @returns An `AuditMetrics` object.
   */
  toJSON(): AuditMetrics {
    const totalInputTokens = this.phases.reduce((acc, p) => acc + p.inputTokens, 0);
    const totalOutputTokens = this.phases.reduce((acc, p) => acc + p.outputTokens, 0);

    return {
      auditId: this.auditId,
      startedAt: this.startedAt,
      phases: [...this.phases],
      totalCostUsd: this.getTotalCost(),
      totalDurationMs: this.getTotalDuration(),
      totalInputTokens,
      totalOutputTokens,
    };
  }

  /**
   * Serialise the current metrics to JSON and write them to disk.
   *
   * @param filePath - Absolute path where the JSON file will be written.
   */
  writeToFile(filePath: string): void {
    const data = this.toJSON();
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
}
