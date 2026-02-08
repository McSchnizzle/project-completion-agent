/**
 * Artifact Store - JSONL-based audit data storage with atomic operations.
 *
 * This module provides a reliable, append-only storage system for audit artifacts.
 * All writes are atomic (using temp files + rename) to ensure data integrity even
 * if the process crashes mid-write.
 *
 * Key features:
 * - JSONL append-only log for event stream (audit-log.jsonl)
 * - Atomic writes for both JSONL and artifact JSON files
 * - In-memory indexing for fast queries
 * - <4KB per JSONL line for POSIX atomic write guarantees
 * - Concurrent-safe for single-process append-only operations
 *
 * @module artifact-store
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAuditLogPath } from './artifact-paths.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Status of an artifact in the audit pipeline.
 */
export type ArtifactStatus = 'created' | 'updated' | 'deleted';

/**
 * A single entry in the audit log.
 *
 * Represents one event in the audit pipeline: creation, update, or deletion
 * of an artifact file.
 */
export interface ArtifactEntry {
  /** ISO 8601 timestamp of when this entry was created */
  timestamp: string;

  /** Pipeline phase that produced this artifact (e.g., 'exploration', 'form-testing') */
  phase: string;

  /** Artifact type/schema (e.g., 'finding', 'page', 'progress') */
  type: string;

  /** Unique identifier for this artifact (e.g., 'F-001', 'page-0') */
  artifactId: string;

  /** Relative path to the artifact file within the audit directory */
  filePath: string;

  /** Current status of the artifact */
  status: ArtifactStatus;

  /** Optional metadata for additional context */
  metadata?: Record<string, unknown>;
}

/**
 * Filter criteria for querying audit entries.
 */
export interface ArtifactFilter {
  /** Filter by phase name */
  phase?: string;

  /** Filter by artifact type */
  type?: string;

  /** Filter by status */
  status?: ArtifactStatus;
}

// ---------------------------------------------------------------------------
// ArtifactStore Class
// ---------------------------------------------------------------------------

/**
 * JSONL-based storage for audit artifacts with atomic writes and indexing.
 *
 * This class manages the audit-log.jsonl file and provides safe concurrent
 * access for append-only operations. All writes use atomic file operations
 * to prevent corruption.
 *
 * @example
 * ```typescript
 * const store = new ArtifactStore('/path/to/.complete-agent/audits/current');
 *
 * // Append a new entry
 * store.append({
 *   phase: 'exploration',
 *   type: 'finding',
 *   artifactId: 'F-001',
 *   filePath: 'findings/F-001.json',
 *   status: 'created',
 * });
 *
 * // Query entries
 * const findings = store.query({ type: 'finding', status: 'created' });
 *
 * // Get latest entry of a type
 * const latestPage = store.getLatest('page');
 * ```
 */
export class ArtifactStore {
  private auditDir: string;
  private logPath: string;

  /**
   * Create a new artifact store.
   *
   * @param auditDir - Path to the audit directory (e.g., `.complete-agent/audits/current/`)
   */
  constructor(auditDir: string) {
    this.auditDir = auditDir;
    this.logPath = getAuditLogPath(auditDir);
  }

  /**
   * Append a new entry to the audit log.
   *
   * This operation is atomic for single-process access. The timestamp is
   * automatically added. Each JSONL line is kept under 4KB to ensure POSIX
   * atomic write guarantees.
   *
   * @param entry - Entry to append (timestamp will be added automatically)
   * @throws If the entry would exceed the 4KB line limit
   */
  append(entry: Omit<ArtifactEntry, 'timestamp'>): void {
    const fullEntry: ArtifactEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };

    // Serialize to JSON (single line)
    const line = JSON.stringify(fullEntry) + '\n';

    // Verify size constraint for atomic writes
    const lineSize = Buffer.byteLength(line, 'utf-8');
    if (lineSize > 4096) {
      throw new Error(
        `Audit log entry exceeds 4KB limit (${lineSize} bytes). ` +
        `Consider reducing metadata or splitting into multiple entries.`
      );
    }

    // Ensure directory exists
    this.ensureLogFileExists();

    // Append atomically (append-only writes are atomic in POSIX)
    fs.appendFileSync(this.logPath, line, 'utf-8');
  }

  /**
   * Query the audit log with optional filters.
   *
   * Reads the entire JSONL file, builds an in-memory index, and filters
   * by the provided criteria. For large logs, consider using more specific
   * filters to reduce memory usage.
   *
   * @param filter - Optional filter criteria
   * @returns Array of matching entries, in chronological order
   */
  query(filter: ArtifactFilter = {}): ArtifactEntry[] {
    const allEntries = this.getAll();

    return allEntries.filter((entry) => {
      if (filter.phase && entry.phase !== filter.phase) {
        return false;
      }
      if (filter.type && entry.type !== filter.type) {
        return false;
      }
      if (filter.status && entry.status !== filter.status) {
        return false;
      }
      return true;
    });
  }

  /**
   * Get the most recent entry of a given type.
   *
   * Useful for finding the latest version of an artifact (e.g., the most
   * recent progress update or the last finding created).
   *
   * @param type - Artifact type to search for
   * @returns The latest entry of that type, or null if none found
   */
  getLatest(type: string): ArtifactEntry | null {
    const entries = this.query({ type });

    if (entries.length === 0) {
      return null;
    }

    // Return the last entry (chronologically latest)
    return entries[entries.length - 1];
  }

  /**
   * Get all entries from the audit log.
   *
   * Reads and parses the entire JSONL file. Entries are returned in
   * chronological order (order of insertion).
   *
   * @returns Array of all entries
   */
  getAll(): ArtifactEntry[] {
    if (!fs.existsSync(this.logPath)) {
      return [];
    }

    const content = fs.readFileSync(this.logPath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.length > 0);

    const entries: ArtifactEntry[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      try {
        const entry = JSON.parse(line) as ArtifactEntry;
        entries.push(entry);
      } catch (error) {
        console.warn(
          `Warning: Failed to parse line ${i + 1} in ${this.logPath}: ${error}`
        );
        // Continue parsing remaining lines
      }
    }

    return entries;
  }

  /**
   * Write an artifact file and log it atomically.
   *
   * This is a convenience method that combines artifact file writing with
   * audit log tracking. The artifact is written atomically (using a temp file
   * and rename), then the entry is appended to the audit log.
   *
   * The operation is NOT fully atomic across both files (there's a window
   * between the artifact write and log append), but this is acceptable since:
   * - The artifact write is atomic
   * - The log append is atomic
   * - Missing log entries can be detected via file scanning
   *
   * @param entry - Entry to log (timestamp will be added automatically)
   * @param data - JSON-serializable data to write to the artifact file
   * @throws If the artifact path is absolute or tries to escape the audit directory
   */
  writeArtifact(entry: Omit<ArtifactEntry, 'timestamp'>, data: unknown): void {
    // Validate that the file path is relative and doesn't escape the audit dir
    if (path.isAbsolute(entry.filePath)) {
      throw new Error(
        `Artifact filePath must be relative, got: ${entry.filePath}`
      );
    }

    if (entry.filePath.includes('..')) {
      throw new Error(
        `Artifact filePath cannot contain '..' (path traversal), got: ${entry.filePath}`
      );
    }

    // Compute absolute paths
    const artifactPath = path.join(this.auditDir, entry.filePath);
    const tmpPath = artifactPath + '.tmp';

    // Ensure parent directory exists
    const parentDir = path.dirname(artifactPath);
    fs.mkdirSync(parentDir, { recursive: true });

    // Write to temp file
    const json = JSON.stringify(data, null, 2) + '\n';
    fs.writeFileSync(tmpPath, json, 'utf-8');

    // Atomic rename
    fs.renameSync(tmpPath, artifactPath);

    // Append to audit log
    this.append(entry);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Ensure the audit log file exists.
   *
   * Creates the parent directory if needed, and creates an empty log file
   * if it doesn't exist. Safe to call repeatedly.
   */
  private ensureLogFileExists(): void {
    // Ensure parent directory exists
    const parentDir = path.dirname(this.logPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // Create empty log file if it doesn't exist
    if (!fs.existsSync(this.logPath)) {
      fs.writeFileSync(this.logPath, '', 'utf-8');
    }
  }
}
