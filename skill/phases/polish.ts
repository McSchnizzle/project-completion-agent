/**
 * Polish Phase - Command Parsing and Cleanup
 * Task B.11: Polish Features
 *
 * Handles command flag parsing, focus area mapping,
 * old audit cleanup, and checkpoint validation.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PrdFeature } from '../comparison/prd-parser';
import { Checkpoint } from '../utils/checkpoint';

export interface CommandFlags {
  resume: boolean;
  focus: string[];
  cleanup: boolean;
  safe_mode: boolean;
  verbose: boolean;
  dry_run: boolean;
  max_pages: number;
  timeout_minutes: number;
}

export interface FocusPattern {
  type: 'url' | 'feature' | 'category' | 'file';
  pattern: string;
  source: string;
}

export interface CleanupResult {
  deleted: string[];
  kept: string[];
  total_size_freed_bytes: number;
  errors: string[];
}

export interface CheckpointValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  can_resume: boolean;
}

/**
 * Parse command flags from arguments
 */
export function parseCommandFlags(args: string): CommandFlags {
  const flags: CommandFlags = {
    resume: false,
    focus: [],
    cleanup: false,
    safe_mode: true,
    verbose: false,
    dry_run: false,
    max_pages: 50,
    timeout_minutes: 30
  };

  // Parse --resume
  if (args.includes('--resume') || args.includes('-r')) {
    flags.resume = true;
  }

  // Parse --cleanup
  if (args.includes('--cleanup') || args.includes('--clean')) {
    flags.cleanup = true;
  }

  // Parse --unsafe (disables safe mode)
  if (args.includes('--unsafe') || args.includes('--no-safe-mode')) {
    flags.safe_mode = false;
  }

  // Parse --verbose
  if (args.includes('--verbose') || args.includes('-v')) {
    flags.verbose = true;
  }

  // Parse --dry-run
  if (args.includes('--dry-run') || args.includes('--dry')) {
    flags.dry_run = true;
  }

  // Parse --focus "area1, area2"
  const focusMatch = args.match(/--focus\s+["']([^"']+)["']/);
  if (focusMatch) {
    flags.focus = focusMatch[1].split(',').map(s => s.trim()).filter(s => s);
  }

  // Parse --max-pages N
  const maxPagesMatch = args.match(/--max-pages\s+(\d+)/);
  if (maxPagesMatch) {
    flags.max_pages = parseInt(maxPagesMatch[1], 10);
  }

  // Parse --timeout N
  const timeoutMatch = args.match(/--timeout\s+(\d+)/);
  if (timeoutMatch) {
    flags.timeout_minutes = parseInt(timeoutMatch[1], 10);
  }

  return flags;
}

/**
 * Map focus areas to URL/file patterns
 */
export function mapFocusToPatterns(
  focus: string[],
  prdFeatures: PrdFeature[]
): FocusPattern[] {
  const patterns: FocusPattern[] = [];

  for (const focusArea of focus) {
    const areaLower = focusArea.toLowerCase().trim();

    // Check if it's a direct URL pattern
    if (areaLower.startsWith('/') || areaLower.includes('://')) {
      patterns.push({
        type: 'url',
        pattern: focusArea,
        source: 'direct'
      });
      continue;
    }

    // Check if it matches a PRD feature
    const matchingFeature = prdFeatures.find(f =>
      f.name.toLowerCase().includes(areaLower) ||
      f.id.toLowerCase().includes(areaLower)
    );

    if (matchingFeature) {
      patterns.push({
        type: 'feature',
        pattern: matchingFeature.id,
        source: `PRD feature: ${matchingFeature.name}`
      });

      // Also add URL patterns from feature name
      const urlPattern = '/' + matchingFeature.name.toLowerCase().replace(/\s+/g, '-');
      patterns.push({
        type: 'url',
        pattern: urlPattern,
        source: `Derived from feature: ${matchingFeature.name}`
      });
      continue;
    }

    // Check if it's a category
    const categories = ['auth', 'login', 'signup', 'payment', 'checkout', 'profile', 'settings', 'admin', 'api', 'form'];
    if (categories.includes(areaLower)) {
      patterns.push({
        type: 'category',
        pattern: areaLower,
        source: 'category match'
      });

      // Add common URL patterns for the category
      patterns.push({
        type: 'url',
        pattern: `/${areaLower}`,
        source: `Category: ${areaLower}`
      });
      continue;
    }

    // Default: treat as URL pattern
    patterns.push({
      type: 'url',
      pattern: `/${areaLower}`,
      source: 'inferred from focus area'
    });
  }

  return patterns;
}

/**
 * Check if URL matches focus patterns
 */
export function urlMatchesFocus(url: string, patterns: FocusPattern[]): boolean {
  if (patterns.length === 0) {
    return true; // No focus means all URLs match
  }

  const urlLower = url.toLowerCase();
  const pathname = new URL(url).pathname.toLowerCase();

  for (const pattern of patterns) {
    if (pattern.type === 'url') {
      if (pathname.includes(pattern.pattern.toLowerCase())) {
        return true;
      }
    } else if (pattern.type === 'category') {
      if (pathname.includes(pattern.pattern)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Cleanup old audit directories
 */
export function cleanupOldAudits(
  auditRoot: string,
  maxAgeDays: number = 30,
  dryRun: boolean = false
): CleanupResult {
  const result: CleanupResult = {
    deleted: [],
    kept: [],
    total_size_freed_bytes: 0,
    errors: []
  };

  if (!fs.existsSync(auditRoot)) {
    return result;
  }

  const now = Date.now();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

  const entries = fs.readdirSync(auditRoot, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dirPath = path.join(auditRoot, entry.name);

    // Check directory age from modification time
    try {
      const stats = fs.statSync(dirPath);
      const age = now - stats.mtime.getTime();

      if (age > maxAgeMs) {
        // Calculate size
        const size = getDirectorySize(dirPath);

        if (!dryRun) {
          try {
            fs.rmSync(dirPath, { recursive: true, force: true });
            result.deleted.push(entry.name);
            result.total_size_freed_bytes += size;
          } catch (err) {
            result.errors.push(`Failed to delete ${entry.name}: ${err}`);
          }
        } else {
          result.deleted.push(`[dry-run] ${entry.name}`);
          result.total_size_freed_bytes += size;
        }
      } else {
        result.kept.push(entry.name);
      }
    } catch (err) {
      result.errors.push(`Failed to check ${entry.name}: ${err}`);
    }
  }

  return result;
}

/**
 * Get directory size recursively
 */
function getDirectorySize(dirPath: string): number {
  let size = 0;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        size += getDirectorySize(fullPath);
      } else if (entry.isFile()) {
        size += fs.statSync(fullPath).size;
      }
    }
  } catch {
    // Ignore errors
  }

  return size;
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${units[i]}`;
}

/**
 * Validate checkpoint for resume
 */
export function validateCheckpoint(checkpoint: Checkpoint): CheckpointValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required fields
  if (!checkpoint.audit_id) {
    errors.push('Missing audit_id');
  }

  if (!checkpoint.current_stage) {
    warnings.push('No current stage set');
  }

  // Check status is valid for resume
  if (checkpoint.status === 'complete' || checkpoint.status === 'failed') {
    warnings.push(`Checkpoint status is '${checkpoint.status}' - may not be resumable`);
  }

  // Check can_resume flag
  if (!checkpoint.can_resume) {
    warnings.push('Checkpoint marked as non-resumable');
  }

  // Check timestamp validity
  if (checkpoint.started_at) {
    const created = new Date(checkpoint.started_at);
    const now = new Date();
    const ageHours = (now.getTime() - created.getTime()) / (1000 * 60 * 60);

    if (ageHours > 24) {
      warnings.push(`Checkpoint is ${Math.round(ageHours)} hours old - consider starting fresh`);
    }
  }

  // Check completed stages exist
  if (checkpoint.completed_stages && checkpoint.completed_stages.length > 0) {
    // Good - some stages completed
  }

  // Check for errors in checkpoint
  if (checkpoint.errors && checkpoint.errors.length > 0) {
    const unrecoverable = checkpoint.errors.filter(e => !e.recoverable);
    if (unrecoverable.length > 0) {
      warnings.push(`Checkpoint has ${unrecoverable.length} unrecoverable error(s)`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    can_resume: errors.length === 0 && checkpoint.can_resume
  };
}

/**
 * Generate cleanup summary
 */
export function generateCleanupSummary(result: CleanupResult): string {
  const lines: string[] = [];

  lines.push('## Cleanup Summary');
  lines.push('');

  if (result.deleted.length > 0) {
    lines.push(`**Deleted:** ${result.deleted.length} audit(s)`);
    lines.push(`**Space Freed:** ${formatBytes(result.total_size_freed_bytes)}`);
    lines.push('');
    lines.push('### Deleted Audits');
    for (const name of result.deleted) {
      lines.push(`- ${name}`);
    }
    lines.push('');
  } else {
    lines.push('*No audits deleted*');
    lines.push('');
  }

  if (result.kept.length > 0) {
    lines.push(`**Kept:** ${result.kept.length} audit(s)`);
    lines.push('');
  }

  if (result.errors.length > 0) {
    lines.push('### Errors');
    for (const error of result.errors) {
      lines.push(`- ${error}`);
    }
  }

  return lines.join('\n');
}

/**
 * Find latest audit directory
 */
export function findLatestAudit(auditRoot: string): string | null {
  if (!fs.existsSync(auditRoot)) {
    return null;
  }

  const entries = fs.readdirSync(auditRoot, { withFileTypes: true });
  const auditDirs = entries
    .filter(e => e.isDirectory())
    .map(e => ({
      name: e.name,
      path: path.join(auditRoot, e.name),
      mtime: fs.statSync(path.join(auditRoot, e.name)).mtime
    }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  return auditDirs.length > 0 ? auditDirs[0].path : null;
}

/**
 * Check if there's an active/resumable audit
 */
export function hasResumableAudit(auditRoot: string): boolean {
  const latest = findLatestAudit(auditRoot);
  if (!latest) return false;

  // Check for checkpoint file
  const checkpointPath = path.join(latest, 'checkpoint.json');
  if (!fs.existsSync(checkpointPath)) return false;

  // Check checkpoint validity
  try {
    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8')) as Checkpoint;
    const validation = validateCheckpoint(checkpoint);
    return validation.can_resume && checkpoint.status !== 'complete';
  } catch {
    return false;
  }
}

/**
 * Get audit age in human-readable format
 */
export function getAuditAge(auditPath: string): string {
  try {
    const stats = fs.statSync(auditPath);
    const ageMs = Date.now() - stats.mtime.getTime();

    const minutes = Math.floor(ageMs / (1000 * 60));
    const hours = Math.floor(ageMs / (1000 * 60 * 60));
    const days = Math.floor(ageMs / (1000 * 60 * 60 * 24));

    if (days > 0) return `${days} day(s) ago`;
    if (hours > 0) return `${hours} hour(s) ago`;
    if (minutes > 0) return `${minutes} minute(s) ago`;
    return 'just now';
  } catch {
    return 'unknown';
  }
}
