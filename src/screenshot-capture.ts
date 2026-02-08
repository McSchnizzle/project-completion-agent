/**
 * Screenshot Capture - Manages screenshot lifecycle for audit findings.
 *
 * Handles full-page and viewport screenshots, saves to the audit screenshots
 * directory, and returns stable IDs for cross-referencing in findings.
 *
 * @module screenshot-capture
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { getScreenshotDir } from './artifact-paths.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScreenshotMetadata {
  id: string;
  filename: string;
  filePath: string;
  capturedAt: string;
  pageUrl: string;
  viewport: { width: number; height: number };
  purpose: ScreenshotPurpose;
  sizeBytes: number;
}

export type ScreenshotPurpose =
  | 'initial_load'
  | 'finding_evidence'
  | 'responsive_test'
  | 'form_state'
  | 'error_state'
  | 'verification'
  | 'element_highlight';

export interface ScreenshotOptions {
  /** Full-page capture (scrolls entire page). Default: true */
  fullPage?: boolean;
  /** Purpose tag for the screenshot */
  purpose?: ScreenshotPurpose;
  /** Optional suffix for the filename */
  suffix?: string;
  /** Element selector to highlight before capture */
  highlightSelector?: string;
}

// ---------------------------------------------------------------------------
// ScreenshotCapture class
// ---------------------------------------------------------------------------

export class ScreenshotCapture {
  private auditDir: string;
  private screenshotDir: string;
  private manifest: ScreenshotMetadata[] = [];
  private counter = 0;
  private totalSizeBytes = 0;
  private maxSizeBytes: number;

  constructor(auditDir: string, maxSizeMB = 100) {
    this.auditDir = auditDir;
    this.screenshotDir = getScreenshotDir(auditDir);
    this.maxSizeBytes = maxSizeMB * 1024 * 1024;
    fs.mkdirSync(this.screenshotDir, { recursive: true });
    this.loadExistingManifest();
  }

  /**
   * Generate a unique screenshot ID.
   */
  private generateId(): string {
    this.counter++;
    const hash = crypto
      .createHash('sha256')
      .update(`${Date.now()}-${this.counter}`)
      .digest('hex')
      .substring(0, 8);
    return `ss_${hash}`;
  }

  /**
   * Save a screenshot buffer and return its metadata.
   */
  async capture(
    buffer: Buffer,
    pageUrl: string,
    viewport: { width: number; height: number },
    options: ScreenshotOptions = {},
  ): Promise<ScreenshotMetadata> {
    const purpose = options.purpose ?? 'initial_load';
    const id = this.generateId();

    // Check storage budget
    if (this.totalSizeBytes + buffer.length > this.maxSizeBytes) {
      console.warn(
        `[ScreenshotCapture] Storage budget exceeded (${this.totalSizeBytes} + ${buffer.length} > ${this.maxSizeBytes}). Skipping.`,
      );
      // Return metadata without saving
      return {
        id,
        filename: 'SKIPPED',
        filePath: '',
        capturedAt: new Date().toISOString(),
        pageUrl,
        viewport,
        purpose,
        sizeBytes: 0,
      };
    }

    const suffix = options.suffix ? `-${options.suffix}` : '';
    const filename = `${id}${suffix}.png`;
    const filePath = path.join(this.screenshotDir, filename);

    fs.writeFileSync(filePath, buffer);

    const metadata: ScreenshotMetadata = {
      id,
      filename,
      filePath,
      capturedAt: new Date().toISOString(),
      pageUrl,
      viewport,
      purpose,
      sizeBytes: buffer.length,
    };

    this.manifest.push(metadata);
    this.totalSizeBytes += buffer.length;
    this.saveManifest();

    return metadata;
  }

  /**
   * Capture a screenshot from a Playwright page object.
   */
  async captureFromPage(
    page: any,
    options: ScreenshotOptions = {},
  ): Promise<ScreenshotMetadata> {
    const fullPage = options.fullPage ?? true;
    const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
    const url = page.url();

    // If highlighting an element, add a visual indicator before capture
    if (options.highlightSelector) {
      try {
        await page.evaluate((selector: string) => {
          const el = document.querySelector(selector);
          if (el) {
            const overlay = document.createElement('div');
            overlay.setAttribute('data-audit-highlight', 'true');
            const rect = el.getBoundingClientRect();
            overlay.style.cssText = [
              'position:fixed',
              `top:${rect.top - 2}px`,
              `left:${rect.left - 2}px`,
              `width:${rect.width + 4}px`,
              `height:${rect.height + 4}px`,
              'border:3px solid #ff0000',
              'background:rgba(255,0,0,0.1)',
              'z-index:999999',
              'pointer-events:none',
            ].join(';');
            document.body.appendChild(overlay);
          }
        }, options.highlightSelector);
      } catch {
        // Element may not exist, proceed without highlight
      }
    }

    const buffer = await page.screenshot({ fullPage });

    // Remove highlight overlay after capture
    if (options.highlightSelector) {
      try {
        await page.evaluate(() => {
          document
            .querySelectorAll('[data-audit-highlight]')
            .forEach((el: Element) => el.remove());
        });
      } catch {
        // Best effort cleanup
      }
    }

    return this.capture(buffer, url, viewport, options);
  }

  /**
   * Capture the same page at multiple viewports.
   */
  async captureResponsive(
    page: any,
    viewports: Array<{ name: string; width: number; height: number }>,
  ): Promise<Map<string, ScreenshotMetadata>> {
    const results = new Map<string, ScreenshotMetadata>();

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      // Wait for layout to stabilize
      await page.waitForTimeout(500);

      const metadata = await this.captureFromPage(page, {
        purpose: 'responsive_test',
        suffix: vp.name,
      });
      results.set(vp.name, metadata);
    }

    return results;
  }

  /**
   * Get a screenshot by its ID.
   */
  getById(id: string): ScreenshotMetadata | undefined {
    return this.manifest.find((m) => m.id === id);
  }

  /**
   * Get all screenshots for a given URL.
   */
  getByUrl(url: string): ScreenshotMetadata[] {
    return this.manifest.filter((m) => m.pageUrl === url);
  }

  /**
   * Get all screenshots with a given purpose.
   */
  getByPurpose(purpose: ScreenshotPurpose): ScreenshotMetadata[] {
    return this.manifest.filter((m) => m.purpose === purpose);
  }

  /**
   * Get total storage used.
   */
  getStorageUsed(): { bytes: number; megabytes: number; budgetPercent: number } {
    return {
      bytes: this.totalSizeBytes,
      megabytes: Math.round((this.totalSizeBytes / (1024 * 1024)) * 100) / 100,
      budgetPercent:
        Math.round((this.totalSizeBytes / this.maxSizeBytes) * 10000000) / 100000,
    };
  }

  /**
   * Get the full manifest of screenshots.
   */
  getManifest(): ScreenshotMetadata[] {
    return [...this.manifest];
  }

  /**
   * Get the count of screenshots captured.
   */
  getCount(): number {
    return this.manifest.length;
  }

  // ---------------------------------------------------------------------------
  // Manifest persistence
  // ---------------------------------------------------------------------------

  private manifestPath(): string {
    return path.join(this.screenshotDir, 'manifest.json');
  }

  private loadExistingManifest(): void {
    const mp = this.manifestPath();
    if (fs.existsSync(mp)) {
      try {
        const data = JSON.parse(fs.readFileSync(mp, 'utf-8'));
        if (Array.isArray(data)) {
          this.manifest = data;
          this.totalSizeBytes = data.reduce(
            (sum: number, m: ScreenshotMetadata) => sum + m.sizeBytes,
            0,
          );
          this.counter = data.length;
        }
      } catch {
        // Start fresh if manifest is corrupt
      }
    }
  }

  private saveManifest(): void {
    fs.writeFileSync(
      this.manifestPath(),
      JSON.stringify(this.manifest, null, 2),
    );
  }
}
