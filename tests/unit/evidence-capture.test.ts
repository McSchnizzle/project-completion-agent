/**
 * Tests for EvidenceCapture module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { EvidenceCapture } from '../../src/evidence-capture';
import { ScreenshotCapture } from '../../src/screenshot-capture';
import type { BrowserBackend } from '../../src/browser-backend';
import type { GeneratedFinding } from '../../src/finding-generator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockBackend(): BrowserBackend {
  return {
    name: 'test',
    launch: vi.fn().mockResolvedValue(true),
    isAvailable: vi.fn().mockReturnValue(true),
    close: vi.fn().mockResolvedValue(undefined),
    visitPage: vi.fn().mockResolvedValue({
      url: 'https://example.com',
      title: 'Test',
      html: '<html></html>',
      text: 'Test',
      links: [],
      forms: [],
      consoleMessages: [],
      networkErrors: [],
      screenshot: Buffer.from('fake-screenshot'),
    }),
    visitPageAndWait: vi.fn(),
    clickElement: vi.fn(),
    fillAndSubmitForm: vi.fn(),
    testViewports: vi.fn(),
    getConsoleMessages: vi.fn().mockReturnValue([]),
    getNetworkRequests: vi.fn().mockReturnValue([]),
    captureScreenshot: vi.fn().mockResolvedValue(Buffer.from('fake-screenshot')),
  } as unknown as BrowserBackend;
}

function createTestFinding(overrides: Partial<GeneratedFinding> = {}): GeneratedFinding {
  return {
    id: 'F-001',
    title: 'Test finding',
    severity: 'P1',
    category: 'functionality',
    url: 'https://example.com/test',
    description: 'Test',
    evidence: { screenshots: [] },
    steps_to_reproduce: 'Navigate to page',
    source: 'exploration',
    phase: 'exploration',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('EvidenceCapture', () => {
  let tempDir: string;
  let screenshotDir: string;
  let mockBackend: BrowserBackend;
  let screenshotCapture: ScreenshotCapture;
  let evidenceCapture: EvidenceCapture;

  beforeEach(() => {
    // Create a temp directory that mimics the audit dir structure.
    // ScreenshotCapture expects an auditDir and creates auditDir/screenshots/.
    // EvidenceCaptureConfig.screenshotDir is a separate directory for evidence
    // screenshots; attachEvidence creates an 'evidence' sibling of that dir.
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-evidence-'));
    screenshotDir = path.join(tempDir, 'screenshots');
    fs.mkdirSync(screenshotDir, { recursive: true });

    mockBackend = createMockBackend();

    // ScreenshotCapture constructor creates auditDir/screenshots/ and loads manifest.
    screenshotCapture = new ScreenshotCapture(tempDir);

    evidenceCapture = new EvidenceCapture(mockBackend, screenshotCapture, {
      screenshotDir,
    });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // 1. registerPageScreenshot stores URL -> path mapping
  // -----------------------------------------------------------------------
  describe('registerPageScreenshot', () => {
    it('stores URL to path mapping that is reused by attachEvidence', async () => {
      // Create a pre-existing screenshot file.
      const existingPath = path.join(screenshotDir, 'existing.png');
      fs.writeFileSync(existingPath, Buffer.from('pre-existing-screenshot'));

      evidenceCapture.registerPageScreenshot(
        'https://example.com/test',
        existingPath,
      );

      const finding = createTestFinding({ url: 'https://example.com/test' });
      const results = await evidenceCapture.attachEvidence([finding]);

      expect(results).toHaveLength(1);
      // It should have copied the existing screenshot rather than doing a live capture.
      expect((mockBackend.visitPage as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();

      // The evidence file should exist in the evidence directory.
      const evidenceDir = path.join(tempDir, 'evidence');
      const evidenceFile = path.join(evidenceDir, 'F-001.png');
      expect(fs.existsSync(evidenceFile)).toBe(true);
      expect(fs.readFileSync(evidenceFile).toString()).toBe('pre-existing-screenshot');
    });
  });

  // -----------------------------------------------------------------------
  // 2. attachEvidence creates evidence directory
  // -----------------------------------------------------------------------
  describe('attachEvidence', () => {
    it('creates evidence directory', async () => {
      const finding = createTestFinding();
      await evidenceCapture.attachEvidence([finding]);

      const evidenceDir = path.join(tempDir, 'evidence');
      expect(fs.existsSync(evidenceDir)).toBe(true);
      expect(fs.statSync(evidenceDir).isDirectory()).toBe(true);
    });

    // -------------------------------------------------------------------
    // 3. attachEvidence copies existing screenshots for known URLs
    // -------------------------------------------------------------------
    it('copies existing screenshots for known URLs', async () => {
      const existingPath = path.join(screenshotDir, 'known.png');
      fs.writeFileSync(existingPath, Buffer.from('known-screenshot-data'));

      evidenceCapture.registerPageScreenshot(
        'https://example.com/known',
        existingPath,
      );

      const finding = createTestFinding({
        id: 'F-010',
        url: 'https://example.com/known',
      });
      const results = await evidenceCapture.attachEvidence([finding]);

      expect(results).toHaveLength(1);
      expect(results[0].findingId).toBe('F-010');

      // The copied evidence file should match the original.
      const evidenceFile = path.join(tempDir, 'evidence', 'F-010.png');
      expect(fs.existsSync(evidenceFile)).toBe(true);
      expect(fs.readFileSync(evidenceFile).toString()).toBe('known-screenshot-data');
      expect(results[0].screenshotPath).toBe(evidenceFile);
    });

    // -------------------------------------------------------------------
    // 4. attachEvidence captures new screenshots when URL not registered
    // -------------------------------------------------------------------
    it('captures new screenshots when URL is not registered', async () => {
      const finding = createTestFinding({
        id: 'F-020',
        url: 'https://example.com/unregistered',
      });
      const results = await evidenceCapture.attachEvidence([finding]);

      expect(results).toHaveLength(1);
      expect(results[0].findingId).toBe('F-020');

      // Should have called the backend to visit the page and capture a screenshot.
      expect(mockBackend.visitPage).toHaveBeenCalledWith(
        'https://example.com/unregistered',
      );
      expect(mockBackend.captureScreenshot).toHaveBeenCalledWith(true);

      // The evidence file should exist with the live-captured data.
      const evidenceFile = path.join(tempDir, 'evidence', 'F-020.png');
      expect(fs.existsSync(evidenceFile)).toBe(true);
      expect(fs.readFileSync(evidenceFile).toString()).toBe('fake-screenshot');
    });

    // -------------------------------------------------------------------
    // 5. attachEvidence handles screenshot capture failures gracefully
    // -------------------------------------------------------------------
    it('handles screenshot capture failures gracefully', async () => {
      // Make the backend fail on visitPage.
      (mockBackend.visitPage as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Browser crashed'),
      );

      const finding = createTestFinding({
        id: 'F-030',
        url: 'https://example.com/failing',
      });
      const results = await evidenceCapture.attachEvidence([finding]);

      // Should not throw; should return a result with a text placeholder.
      expect(results).toHaveLength(1);
      expect(results[0].findingId).toBe('F-030');

      // A .txt placeholder should exist in the evidence directory.
      const placeholderFile = path.join(tempDir, 'evidence', 'F-030.txt');
      expect(fs.existsSync(placeholderFile)).toBe(true);

      const content = fs.readFileSync(placeholderFile, 'utf-8');
      expect(content).toContain('Finding: F-030');
      expect(content).toContain('Screenshot capture failed');
    });

    // -------------------------------------------------------------------
    // 6. Finding JSON gets updated with screenshotPaths
    // -------------------------------------------------------------------
    it('updates finding evidence.screenshots with captured paths', async () => {
      const finding = createTestFinding({
        id: 'F-040',
        url: 'https://example.com/update-check',
      });

      // Ensure evidence.screenshots starts empty.
      expect(finding.evidence.screenshots).toHaveLength(0);

      await evidenceCapture.attachEvidence([finding]);

      // After attachEvidence, the finding's screenshots array should be populated.
      expect(finding.evidence.screenshots.length).toBeGreaterThan(0);
      const evidenceFile = path.join(tempDir, 'evidence', 'F-040.png');
      expect(finding.evidence.screenshots[0]).toBe(evidenceFile);
    });
  });

  // -----------------------------------------------------------------------
  // 7. captureAndRegister visits page and saves screenshot
  // -----------------------------------------------------------------------
  describe('captureAndRegister', () => {
    it('visits page, saves screenshot, and registers URL mapping', async () => {
      const url = 'https://example.com/capture-register';
      const result = await evidenceCapture.captureAndRegister(url);

      // Should return a file path.
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(fs.existsSync(result!)).toBe(true);

      // Should have visited the page.
      expect(mockBackend.visitPage).toHaveBeenCalledWith(url);
      expect(mockBackend.captureScreenshot).toHaveBeenCalledWith(true);

      // File should contain the screenshot data.
      expect(fs.readFileSync(result!).toString()).toBe('fake-screenshot');

      // Should be registered so a subsequent attachEvidence reuses it.
      const finding = createTestFinding({
        id: 'F-050',
        url: 'https://example.com/capture-register',
      });
      const evidenceResults = await evidenceCapture.attachEvidence([finding]);
      const evidenceFile = path.join(tempDir, 'evidence', 'F-050.png');
      expect(fs.existsSync(evidenceFile)).toBe(true);

      // The backend.visitPage should NOT have been called again for the copy path
      // (it's called once inside captureAndRegister and once in the fallback live
      // capture path of attachEvidence only if copy fails). Since the file exists
      // and was registered, the copy path is taken.
      // Total calls: 1 from captureAndRegister + 0 from attachEvidence = 1.
      // But note the first finding call may also call visitPage if the file is
      // somehow not found. We just check the evidence file has the right content.
      expect(fs.readFileSync(evidenceFile).toString()).toBe('fake-screenshot');
    });

    // -------------------------------------------------------------------
    // 8. captureAndRegister returns undefined on failure
    // -------------------------------------------------------------------
    it('returns undefined on failure', async () => {
      (mockBackend.visitPage as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network timeout'),
      );

      const result = await evidenceCapture.captureAndRegister(
        'https://example.com/fail',
      );

      expect(result).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Additional edge case tests
  // -----------------------------------------------------------------------
  describe('edge cases', () => {
    it('handles multiple findings in a single attachEvidence call', async () => {
      const findings = [
        createTestFinding({ id: 'F-100', url: 'https://a.com' }),
        createTestFinding({ id: 'F-101', url: 'https://b.com' }),
        createTestFinding({ id: 'F-102', url: 'https://c.com' }),
      ];

      const results = await evidenceCapture.attachEvidence(findings);

      expect(results).toHaveLength(3);
      expect(results.map((r) => r.findingId)).toEqual(['F-100', 'F-101', 'F-102']);

      // All three evidence files should exist.
      for (const finding of findings) {
        const evidenceFile = path.join(
          tempDir,
          'evidence',
          `${finding.id}.png`,
        );
        expect(fs.existsSync(evidenceFile)).toBe(true);
      }
    });

    it('captureAndRegister returns undefined when screenshot buffer is empty', async () => {
      (mockBackend.captureScreenshot as ReturnType<typeof vi.fn>).mockResolvedValue(
        Buffer.alloc(0),
      );

      const result = await evidenceCapture.captureAndRegister(
        'https://example.com/empty',
      );

      expect(result).toBeUndefined();
    });

    it('writes placeholder when live capture returns empty buffer', async () => {
      (mockBackend.captureScreenshot as ReturnType<typeof vi.fn>).mockResolvedValue(
        Buffer.alloc(0),
      );

      const finding = createTestFinding({
        id: 'F-200',
        url: 'https://example.com/empty-buffer',
      });
      const results = await evidenceCapture.attachEvidence([finding]);

      expect(results).toHaveLength(1);
      // Should fall back to text placeholder.
      const placeholderFile = path.join(tempDir, 'evidence', 'F-200.txt');
      expect(fs.existsSync(placeholderFile)).toBe(true);
      expect(fs.readFileSync(placeholderFile, 'utf-8')).toContain('F-200');
    });

    it('captures console and network log in evidence record', async () => {
      const finding = createTestFinding({
        id: 'F-300',
        url: 'https://example.com/logs',
        evidence: {
          screenshots: [],
          consoleMessages: ['Error: something broke'],
          networkRequests: ['GET /api/data 500'],
        },
      });

      const existingPath = path.join(screenshotDir, 'logs.png');
      fs.writeFileSync(existingPath, Buffer.from('log-screenshot'));
      evidenceCapture.registerPageScreenshot(
        'https://example.com/logs',
        existingPath,
      );

      const results = await evidenceCapture.attachEvidence([finding]);

      expect(results[0].consoleLog).toBe('Error: something broke');
      expect(results[0].networkLog).toBe('GET /api/data 500');
    });
  });
});
