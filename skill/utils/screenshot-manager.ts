/**
 * Screenshot Manager - Evidence Persistence
 * Task 6.11: Screenshot Persistence
 *
 * Handles saving, organizing, and retrieving screenshots
 * as evidence for audit findings. Supports both automatic
 * and manual screenshot capture with metadata tracking.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface ScreenshotMetadata {
  id: string;
  filename: string;
  url: string;
  timestamp: string;
  stage: string;
  finding_id: string | null;
  description: string;
  viewport: {
    width: number;
    height: number;
  };
  file_size_bytes: number;
  hash: string;
}

export interface ScreenshotIndex {
  schema_version: string;
  audit_id: string;
  updated_at: string;
  screenshots: ScreenshotMetadata[];
  by_finding: Record<string, string[]>;
  by_url: Record<string, string[]>;
  by_stage: Record<string, string[]>;
  total_size_bytes: number;
}

const SCHEMA_VERSION = '1.0.0';
const SCREENSHOTS_DIR = 'screenshots';
const INDEX_FILENAME = 'screenshot-index.json';

/**
 * Screenshot Manager - handles screenshot persistence and organization
 */
export class ScreenshotManager {
  private auditPath: string;
  private screenshotsDir: string;
  private index: ScreenshotIndex;

  constructor(auditPath: string, auditId: string) {
    this.auditPath = auditPath;
    this.screenshotsDir = path.join(auditPath, SCREENSHOTS_DIR);

    // Ensure screenshots directory exists
    fs.mkdirSync(this.screenshotsDir, { recursive: true });

    // Load or create index
    this.index = this.loadIndex() || this.createIndex(auditId);
  }

  /**
   * Create initial index
   */
  private createIndex(auditId: string): ScreenshotIndex {
    return {
      schema_version: SCHEMA_VERSION,
      audit_id: auditId,
      updated_at: new Date().toISOString(),
      screenshots: [],
      by_finding: {},
      by_url: {},
      by_stage: {},
      total_size_bytes: 0
    };
  }

  /**
   * Load index from disk
   */
  private loadIndex(): ScreenshotIndex | null {
    const indexPath = path.join(this.auditPath, INDEX_FILENAME);

    if (!fs.existsSync(indexPath)) {
      return null;
    }

    try {
      const data = fs.readFileSync(indexPath, 'utf-8');
      return JSON.parse(data) as ScreenshotIndex;
    } catch (error) {
      console.error('Failed to load screenshot index:', error);
      return null;
    }
  }

  /**
   * Save index to disk
   */
  saveIndex(): void {
    this.index.updated_at = new Date().toISOString();
    const indexPath = path.join(this.auditPath, INDEX_FILENAME);
    fs.writeFileSync(indexPath, JSON.stringify(this.index, null, 2));
  }

  /**
   * Save a screenshot (base64 encoded image data)
   */
  saveScreenshot(
    imageData: string,
    options: {
      url: string;
      stage: string;
      finding_id?: string;
      description?: string;
      viewport?: { width: number; height: number };
    }
  ): ScreenshotMetadata {
    // Generate unique ID
    const id = this.generateId();
    const timestamp = new Date().toISOString();

    // Determine file extension from data URL or default to PNG
    let extension = 'png';
    let data = imageData;

    if (imageData.startsWith('data:image/')) {
      const match = imageData.match(/^data:image\/(\w+);base64,/);
      if (match) {
        extension = match[1];
        data = imageData.replace(/^data:image\/\w+;base64,/, '');
      }
    }

    // Create filename with meaningful prefix
    const urlSlug = this.urlToSlug(options.url);
    const filename = `${options.stage}-${urlSlug}-${id}.${extension}`;
    const filePath = path.join(this.screenshotsDir, filename);

    // Write file
    const buffer = Buffer.from(data, 'base64');
    fs.writeFileSync(filePath, buffer);

    // Calculate hash for deduplication
    const hash = crypto.createHash('sha256').update(buffer).digest('hex').substring(0, 16);

    // Create metadata
    const metadata: ScreenshotMetadata = {
      id,
      filename,
      url: options.url,
      timestamp,
      stage: options.stage,
      finding_id: options.finding_id || null,
      description: options.description || `Screenshot of ${options.url}`,
      viewport: options.viewport || { width: 1920, height: 1080 },
      file_size_bytes: buffer.length,
      hash
    };

    // Update index
    this.index.screenshots.push(metadata);
    this.index.total_size_bytes += buffer.length;

    // Update by_finding index
    if (metadata.finding_id) {
      if (!this.index.by_finding[metadata.finding_id]) {
        this.index.by_finding[metadata.finding_id] = [];
      }
      this.index.by_finding[metadata.finding_id].push(id);
    }

    // Update by_url index
    const urlKey = this.normalizeUrlKey(options.url);
    if (!this.index.by_url[urlKey]) {
      this.index.by_url[urlKey] = [];
    }
    this.index.by_url[urlKey].push(id);

    // Update by_stage index
    if (!this.index.by_stage[options.stage]) {
      this.index.by_stage[options.stage] = [];
    }
    this.index.by_stage[options.stage].push(id);

    this.saveIndex();
    return metadata;
  }

  /**
   * Get screenshot by ID
   */
  getScreenshot(id: string): ScreenshotMetadata | null {
    return this.index.screenshots.find(s => s.id === id) || null;
  }

  /**
   * Get screenshot file path
   */
  getScreenshotPath(id: string): string | null {
    const metadata = this.getScreenshot(id);
    if (!metadata) return null;
    return path.join(this.screenshotsDir, metadata.filename);
  }

  /**
   * Get screenshots for a finding
   */
  getScreenshotsForFinding(findingId: string): ScreenshotMetadata[] {
    const ids = this.index.by_finding[findingId] || [];
    return ids.map(id => this.getScreenshot(id)).filter((s): s is ScreenshotMetadata => s !== null);
  }

  /**
   * Get screenshots for a URL
   */
  getScreenshotsForUrl(url: string): ScreenshotMetadata[] {
    const urlKey = this.normalizeUrlKey(url);
    const ids = this.index.by_url[urlKey] || [];
    return ids.map(id => this.getScreenshot(id)).filter((s): s is ScreenshotMetadata => s !== null);
  }

  /**
   * Get screenshots for a stage
   */
  getScreenshotsForStage(stage: string): ScreenshotMetadata[] {
    const ids = this.index.by_stage[stage] || [];
    return ids.map(id => this.getScreenshot(id)).filter((s): s is ScreenshotMetadata => s !== null);
  }

  /**
   * Associate screenshot with a finding (after the fact)
   */
  associateWithFinding(screenshotId: string, findingId: string): boolean {
    const metadata = this.getScreenshot(screenshotId);
    if (!metadata) return false;

    metadata.finding_id = findingId;

    if (!this.index.by_finding[findingId]) {
      this.index.by_finding[findingId] = [];
    }
    if (!this.index.by_finding[findingId].includes(screenshotId)) {
      this.index.by_finding[findingId].push(screenshotId);
    }

    this.saveIndex();
    return true;
  }

  /**
   * Delete screenshot
   */
  deleteScreenshot(id: string): boolean {
    const metadata = this.getScreenshot(id);
    if (!metadata) return false;

    // Delete file
    const filePath = path.join(this.screenshotsDir, metadata.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Remove from index
    const index = this.index.screenshots.findIndex(s => s.id === id);
    if (index !== -1) {
      this.index.screenshots.splice(index, 1);
      this.index.total_size_bytes -= metadata.file_size_bytes;
    }

    // Remove from by_finding
    if (metadata.finding_id && this.index.by_finding[metadata.finding_id]) {
      const findingIndex = this.index.by_finding[metadata.finding_id].indexOf(id);
      if (findingIndex !== -1) {
        this.index.by_finding[metadata.finding_id].splice(findingIndex, 1);
      }
    }

    // Remove from by_url
    const urlKey = this.normalizeUrlKey(metadata.url);
    if (this.index.by_url[urlKey]) {
      const urlIndex = this.index.by_url[urlKey].indexOf(id);
      if (urlIndex !== -1) {
        this.index.by_url[urlKey].splice(urlIndex, 1);
      }
    }

    // Remove from by_stage
    if (this.index.by_stage[metadata.stage]) {
      const stageIndex = this.index.by_stage[metadata.stage].indexOf(id);
      if (stageIndex !== -1) {
        this.index.by_stage[metadata.stage].splice(stageIndex, 1);
      }
    }

    this.saveIndex();
    return true;
  }

  /**
   * Check for duplicate screenshots by hash
   */
  findDuplicate(imageData: string): ScreenshotMetadata | null {
    let data = imageData;
    if (imageData.startsWith('data:image/')) {
      data = imageData.replace(/^data:image\/\w+;base64,/, '');
    }

    const buffer = Buffer.from(data, 'base64');
    const hash = crypto.createHash('sha256').update(buffer).digest('hex').substring(0, 16);

    return this.index.screenshots.find(s => s.hash === hash) || null;
  }

  /**
   * Get all screenshots
   */
  getAllScreenshots(): ScreenshotMetadata[] {
    return [...this.index.screenshots];
  }

  /**
   * Get statistics
   */
  getStats(): {
    total_count: number;
    total_size_bytes: number;
    total_size_mb: number;
    by_stage: Record<string, number>;
    with_findings: number;
    without_findings: number;
  } {
    const byStage: Record<string, number> = {};
    for (const [stage, ids] of Object.entries(this.index.by_stage)) {
      byStage[stage] = ids.length;
    }

    const withFindings = this.index.screenshots.filter(s => s.finding_id).length;

    return {
      total_count: this.index.screenshots.length,
      total_size_bytes: this.index.total_size_bytes,
      total_size_mb: Math.round(this.index.total_size_bytes / 1024 / 1024 * 100) / 100,
      by_stage: byStage,
      with_findings: withFindings,
      without_findings: this.index.screenshots.length - withFindings
    };
  }

  /**
   * Cleanup old screenshots (keep recent, remove old without findings)
   */
  cleanup(options: {
    max_age_hours?: number;
    keep_with_findings?: boolean;
    max_count?: number;
  } = {}): number {
    const maxAgeMs = (options.max_age_hours || 168) * 60 * 60 * 1000; // Default 7 days
    const keepWithFindings = options.keep_with_findings !== false;
    const maxCount = options.max_count || 500;
    const now = Date.now();

    let deleted = 0;

    // Sort by timestamp (oldest first)
    const sorted = [...this.index.screenshots].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    for (const screenshot of sorted) {
      // Stop if within count limit
      if (this.index.screenshots.length - deleted <= maxCount) {
        break;
      }

      const age = now - new Date(screenshot.timestamp).getTime();

      // Check if should keep
      if (keepWithFindings && screenshot.finding_id) {
        continue;
      }

      if (age > maxAgeMs) {
        if (this.deleteScreenshot(screenshot.id)) {
          deleted++;
        }
      }
    }

    return deleted;
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  /**
   * Convert URL to filesystem-safe slug
   */
  private urlToSlug(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.pathname
        .replace(/^\//, '')
        .replace(/\//g, '-')
        .replace(/[^a-z0-9-]/gi, '')
        .substring(0, 30) || 'root';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Normalize URL for use as index key
   */
  private normalizeUrlKey(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  }

  /**
   * Export index data
   */
  toJSON(): ScreenshotIndex {
    return { ...this.index };
  }

  /**
   * Static method to load manager from audit path
   */
  static load(auditPath: string): ScreenshotManager | null {
    const indexPath = path.join(auditPath, INDEX_FILENAME);

    if (!fs.existsSync(indexPath)) {
      return null;
    }

    try {
      const data = fs.readFileSync(indexPath, 'utf-8');
      const index = JSON.parse(data) as ScreenshotIndex;
      return new ScreenshotManager(auditPath, index.audit_id);
    } catch {
      return null;
    }
  }
}
