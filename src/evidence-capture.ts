/**
 * EvidenceCapture - Captures and attaches screenshot evidence to every finding.
 *
 * Coordinates between BrowserBackend (for live page captures) and
 * ScreenshotCapture (for storage/manifest) to produce an evidence record
 * for each GeneratedFinding. Pre-registered screenshots are reused via
 * file copy; missing screenshots trigger a live capture attempt.
 *
 * @module evidence-capture
 */

import type { BrowserBackend } from './browser-backend.js';
import type { GeneratedFinding } from './finding-generator.js';
import { ScreenshotCapture, type ScreenshotPurpose } from './screenshot-capture.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FindingEvidence {
  findingId: string;
  screenshotPath: string;
  additionalScreenshots: string[];
  consoleLog?: string;
  networkLog?: string;
}

export interface EvidenceCaptureConfig {
  screenshotDir: string;
  fullPage?: boolean;
  maxScreenshotSize?: number;
  format?: 'png' | 'jpeg';
}

// ---------------------------------------------------------------------------
// EvidenceCapture class
// ---------------------------------------------------------------------------

export class EvidenceCapture {
  private backend: BrowserBackend;
  private screenshotCapture: ScreenshotCapture;
  private config: Required<EvidenceCaptureConfig>;
  private urlScreenshotMap: Map<string, string> = new Map();

  constructor(
    backend: BrowserBackend,
    screenshotCapture: ScreenshotCapture,
    config: EvidenceCaptureConfig,
  ) {
    this.backend = backend;
    this.screenshotCapture = screenshotCapture;
    this.config = {
      screenshotDir: config.screenshotDir,
      fullPage: config.fullPage ?? true,
      maxScreenshotSize: config.maxScreenshotSize ?? 5 * 1024 * 1024,
      format: config.format ?? 'png',
    };
  }

  /**
   * Register a pre-existing screenshot for a URL so that it can be reused
   * when attaching evidence to findings for the same URL.
   */
  registerPageScreenshot(url: string, screenshotPath: string): void {
    this.urlScreenshotMap.set(url, screenshotPath);
  }

  /**
   * Attach evidence to a list of findings. Creates an evidence/ directory
   * next to the configured screenshotDir, captures or copies screenshots
   * for each finding, and updates the finding's evidence.screenshots array.
   *
   * @returns An array of FindingEvidence records, one per finding.
   */
  async attachEvidence(findings: GeneratedFinding[]): Promise<FindingEvidence[]> {
    const evidenceDir = path.join(path.dirname(this.config.screenshotDir), 'evidence');
    fs.mkdirSync(evidenceDir, { recursive: true });

    const results: FindingEvidence[] = [];

    for (const finding of findings) {
      try {
        // Ensure evidence is an object before mutating
        if (typeof finding.evidence === 'string') {
          (finding as any).evidence = { screenshots: [], description: finding.evidence };
        } else if (!finding.evidence) {
          (finding as any).evidence = { screenshots: [] };
        }

        const evidence = await this.captureForFinding(finding, evidenceDir);
        // Update the finding's evidence screenshots with the captured path
        if (evidence.screenshotPath) {
          finding.evidence.screenshots = [
            evidence.screenshotPath,
            ...evidence.additionalScreenshots,
          ];
        }
        results.push(evidence);
      } catch (err) {
        // Screenshot failure must not crash the pipeline
        console.warn(
          `[EvidenceCapture] Failed to capture evidence for ${finding.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
        results.push({
          findingId: finding.id,
          screenshotPath: '',
          additionalScreenshots: [],
        });
      }
    }

    return results;
  }

  /**
   * Capture or copy a screenshot for a single finding into the evidence
   * directory. Falls back to a .txt placeholder if capture fails.
   */
  private async captureForFinding(
    finding: GeneratedFinding,
    evidenceDir: string,
  ): Promise<FindingEvidence> {
    const filename = `${finding.id}.${this.config.format}`;
    const evidencePath = path.join(evidenceDir, filename);

    const existingPath = this.urlScreenshotMap.get(finding.url);

    if (existingPath && fs.existsSync(existingPath)) {
      // Reuse existing screenshot by copying to evidence directory
      try {
        fs.copyFileSync(existingPath, evidencePath);
        return {
          findingId: finding.id,
          screenshotPath: evidencePath,
          additionalScreenshots: [],
          consoleLog: finding.evidence.consoleMessages?.join('\n'),
          networkLog: finding.evidence.networkRequests?.join('\n'),
        };
      } catch (copyErr) {
        console.warn(
          `[EvidenceCapture] Failed to copy screenshot for ${finding.id}: ${copyErr instanceof Error ? copyErr.message : String(copyErr)}`,
        );
        // Fall through to live capture attempt
      }
    }

    // No pre-registered screenshot; attempt a live capture
    try {
      await this.backend.visitPage(finding.url);
      const buffer = await this.backend.captureScreenshot(this.config.fullPage);

      if (buffer && buffer.length > 0) {
        // Respect maxScreenshotSize limit
        if (buffer.length <= this.config.maxScreenshotSize) {
          fs.writeFileSync(evidencePath, buffer);

          // Also register with ScreenshotCapture for manifest tracking
          const purpose: ScreenshotPurpose = 'finding_evidence';
          await this.screenshotCapture.capture(
            buffer,
            finding.url,
            { width: 1280, height: 720 },
            { purpose },
          );

          return {
            findingId: finding.id,
            screenshotPath: evidencePath,
            additionalScreenshots: [],
            consoleLog: finding.evidence.consoleMessages?.join('\n'),
            networkLog: finding.evidence.networkRequests?.join('\n'),
          };
        }

        console.warn(
          `[EvidenceCapture] Screenshot for ${finding.id} exceeds max size (${buffer.length} > ${this.config.maxScreenshotSize}). Writing placeholder.`,
        );
      }
    } catch (captureErr) {
      console.warn(
        `[EvidenceCapture] Live capture failed for ${finding.id} at ${finding.url}: ${captureErr instanceof Error ? captureErr.message : String(captureErr)}`,
      );
    }

    // Final fallback: write a text placeholder so the evidence directory
    // still has an entry for this finding.
    const placeholderPath = path.join(evidenceDir, `${finding.id}.txt`);
    const placeholderContent = [
      `Finding: ${finding.id}`,
      `Title: ${finding.title}`,
      `URL: ${finding.url}`,
      `Severity: ${finding.severity}`,
      '',
      'Screenshot capture failed. See finding details for evidence.',
      '',
      finding.evidence.consoleMessages?.length
        ? `Console messages:\n${finding.evidence.consoleMessages.join('\n')}`
        : '',
      finding.evidence.networkRequests?.length
        ? `Network requests:\n${finding.evidence.networkRequests.join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      fs.writeFileSync(placeholderPath, placeholderContent);
    } catch {
      // Even the placeholder failed; nothing more we can do
    }

    return {
      findingId: finding.id,
      screenshotPath: placeholderPath,
      additionalScreenshots: [],
      consoleLog: finding.evidence.consoleMessages?.join('\n'),
      networkLog: finding.evidence.networkRequests?.join('\n'),
    };
  }

  /**
   * Visit a page, capture a screenshot, save it to the screenshots directory,
   * and register the URL -> path mapping for later reuse.
   *
   * @returns The file path of the saved screenshot, or undefined on failure.
   */
  async captureAndRegister(url: string): Promise<string | undefined> {
    try {
      await this.backend.visitPage(url);
      const buffer = await this.backend.captureScreenshot(this.config.fullPage);

      if (!buffer || buffer.length === 0) {
        console.warn(`[EvidenceCapture] Empty screenshot buffer for ${url}`);
        return undefined;
      }

      if (buffer.length > this.config.maxScreenshotSize) {
        console.warn(
          `[EvidenceCapture] Screenshot for ${url} exceeds max size (${buffer.length} > ${this.config.maxScreenshotSize}). Skipping.`,
        );
        return undefined;
      }

      // Save via ScreenshotCapture for manifest tracking
      const purpose: ScreenshotPurpose = 'finding_evidence';
      const metadata = await this.screenshotCapture.capture(
        buffer,
        url,
        { width: 1280, height: 720 },
        { purpose },
      );

      // Also save a copy into the screenshots dir for direct path access
      const filename = `capture-${Date.now()}.${this.config.format}`;
      const filePath = path.join(this.config.screenshotDir, filename);
      fs.mkdirSync(this.config.screenshotDir, { recursive: true });
      fs.writeFileSync(filePath, buffer);

      // Register for later reuse
      this.urlScreenshotMap.set(url, filePath);

      return filePath;
    } catch (err) {
      console.warn(
        `[EvidenceCapture] captureAndRegister failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }
}
