/**
 * Tests for ScreenshotCapture module.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScreenshotCapture } from '../../src/screenshot-capture';

describe('ScreenshotCapture', () => {
  let tempDir: string;
  let capture: ScreenshotCapture;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-screenshots-'));
    capture = new ScreenshotCapture(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should create screenshots directory', () => {
      const dir = path.join(tempDir, 'screenshots');
      expect(fs.existsSync(dir)).toBe(true);
    });

    it('should start with zero screenshots', () => {
      expect(capture.getCount()).toBe(0);
      expect(capture.getManifest()).toHaveLength(0);
    });
  });

  describe('capture', () => {
    it('should save a screenshot and return metadata', async () => {
      const buffer = Buffer.from('fake-png-data');
      const metadata = await capture.capture(
        buffer,
        'https://example.com/page',
        { width: 1280, height: 720 },
        { purpose: 'initial_load' },
      );

      expect(metadata.id).toMatch(/^ss_/);
      expect(metadata.pageUrl).toBe('https://example.com/page');
      expect(metadata.viewport).toEqual({ width: 1280, height: 720 });
      expect(metadata.purpose).toBe('initial_load');
      expect(metadata.sizeBytes).toBe(buffer.length);
      expect(fs.existsSync(metadata.filePath)).toBe(true);
    });

    it('should increment count after capture', async () => {
      const buffer = Buffer.from('data');
      await capture.capture(buffer, 'https://example.com', { width: 1280, height: 720 });
      expect(capture.getCount()).toBe(1);

      await capture.capture(buffer, 'https://example.com/2', { width: 1280, height: 720 });
      expect(capture.getCount()).toBe(2);
    });

    it('should use suffix in filename when provided', async () => {
      const buffer = Buffer.from('data');
      const metadata = await capture.capture(
        buffer,
        'https://example.com',
        { width: 375, height: 667 },
        { suffix: 'mobile' },
      );

      expect(metadata.filename).toContain('-mobile.png');
    });

    it('should skip saving when storage budget exceeded', async () => {
      // Create capture with 1 byte budget
      const smallCapture = new ScreenshotCapture(tempDir, 0.000001);
      const buffer = Buffer.alloc(1024); // 1KB

      const metadata = await smallCapture.capture(
        buffer,
        'https://example.com',
        { width: 1280, height: 720 },
      );

      expect(metadata.filename).toBe('SKIPPED');
      expect(metadata.sizeBytes).toBe(0);
    });
  });

  describe('getById', () => {
    it('should retrieve screenshot by ID', async () => {
      const buffer = Buffer.from('data');
      const saved = await capture.capture(buffer, 'https://example.com', { width: 1280, height: 720 });

      const found = capture.getById(saved.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(saved.id);
    });

    it('should return undefined for unknown ID', () => {
      expect(capture.getById('ss_nonexistent')).toBeUndefined();
    });
  });

  describe('getByUrl', () => {
    it('should return screenshots for a URL', async () => {
      const buffer = Buffer.from('data');
      await capture.capture(buffer, 'https://example.com/a', { width: 1280, height: 720 });
      await capture.capture(buffer, 'https://example.com/a', { width: 375, height: 667 });
      await capture.capture(buffer, 'https://example.com/b', { width: 1280, height: 720 });

      const results = capture.getByUrl('https://example.com/a');
      expect(results).toHaveLength(2);
    });
  });

  describe('getByPurpose', () => {
    it('should filter by purpose', async () => {
      const buffer = Buffer.from('data');
      await capture.capture(buffer, 'https://example.com', { width: 1280, height: 720 }, { purpose: 'initial_load' });
      await capture.capture(buffer, 'https://example.com', { width: 1280, height: 720 }, { purpose: 'finding_evidence' });
      await capture.capture(buffer, 'https://example.com', { width: 1280, height: 720 }, { purpose: 'initial_load' });

      expect(capture.getByPurpose('initial_load')).toHaveLength(2);
      expect(capture.getByPurpose('finding_evidence')).toHaveLength(1);
      expect(capture.getByPurpose('verification')).toHaveLength(0);
    });
  });

  describe('getStorageUsed', () => {
    it('should track storage usage', async () => {
      const buffer = Buffer.alloc(1024 * 1024); // 1MB
      await capture.capture(buffer, 'https://example.com', { width: 1280, height: 720 });

      const usage = capture.getStorageUsed();
      expect(usage.bytes).toBe(1024 * 1024);
      expect(usage.megabytes).toBe(1);
      expect(usage.budgetPercent).toBeGreaterThan(0);
      expect(usage.budgetPercent).toBeLessThanOrEqual(100);
    });
  });

  describe('manifest persistence', () => {
    it('should save and load manifest across instances', async () => {
      const buffer = Buffer.from('test-data');
      await capture.capture(buffer, 'https://example.com', { width: 1280, height: 720 });
      await capture.capture(buffer, 'https://example.com/2', { width: 375, height: 667 });

      // Create a new instance pointing to same directory
      const capture2 = new ScreenshotCapture(tempDir);
      expect(capture2.getCount()).toBe(2);
      expect(capture2.getManifest()).toHaveLength(2);
    });
  });
});
