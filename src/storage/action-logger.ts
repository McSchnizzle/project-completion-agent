/**
 * Action Logger - Append-only JSONL audit trail.
 *
 * Every significant action during an audit run is logged as a single
 * JSON line in `audit-log.jsonl`. The format is designed for both
 * real-time tailing and post-hoc analysis.
 *
 * Uses a singleton pattern so any module can call
 * `ActionLogger.getInstance()` to log events without passing
 * references through the entire call chain.
 *
 * @module storage/action-logger
 */

import * as fs from 'node:fs';
import { getAuditLogPath } from '../artifact-paths.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActionType =
  | 'phase_start'
  | 'phase_complete'
  | 'phase_failed'
  | 'page_visit'
  | 'screenshot_taken'
  | 'finding_created'
  | 'form_submitted'
  | 'error_detected'
  | 'checkpoint_saved'
  | 'audit_start'
  | 'audit_complete';

export interface ActionEntry {
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Category of action. */
  action_type: ActionType;
  /** Which pipeline phase generated this action (if applicable). */
  phase?: string;
  /** URL being acted upon (if applicable). */
  target_url?: string;
  /** Free-form details about the action. */
  details?: string;
  /** How long the action took (if timed). */
  duration_ms?: number;
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: ActionLogger | null = null;

export class ActionLogger {
  private logPath: string;

  private constructor(auditDir: string) {
    this.logPath = getAuditLogPath(auditDir);
  }

  /**
   * Initialize the singleton for a specific audit directory.
   *
   * Must be called once at audit start before any `getInstance()` calls.
   */
  static init(auditDir: string): ActionLogger {
    instance = new ActionLogger(auditDir);
    return instance;
  }

  /**
   * Get the current singleton instance.
   *
   * Returns `null` if `init()` has not been called yet.
   */
  static getInstance(): ActionLogger | null {
    return instance;
  }

  /**
   * Reset the singleton (useful for tests).
   */
  static reset(): void {
    instance = null;
  }

  /**
   * Append a single action entry to the log.
   *
   * Uses `fs.appendFileSync` which is atomic at the OS level for
   * small writes (< PIPE_BUF, typically 4096 bytes).
   */
  log(entry: Omit<ActionEntry, 'timestamp'>): void {
    const full: ActionEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };

    const line = JSON.stringify(full) + '\n';
    fs.appendFileSync(this.logPath, line, 'utf-8');
  }

  /**
   * Read all log entries from disk.
   *
   * Skips blank lines and lines that fail to parse.
   */
  readAll(): ActionEntry[] {
    if (!fs.existsSync(this.logPath)) {
      return [];
    }

    const raw = fs.readFileSync(this.logPath, 'utf-8');
    const entries: ActionEntry[] = [];

    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as ActionEntry);
      } catch {
        // skip malformed lines
      }
    }

    return entries;
  }

  /**
   * Read the last N entries (most recent first).
   */
  readLast(n: number): ActionEntry[] {
    const all = this.readAll();
    return all.slice(-n).reverse();
  }

  /**
   * Get the path to the underlying log file.
   */
  getPath(): string {
    return this.logPath;
  }
}
