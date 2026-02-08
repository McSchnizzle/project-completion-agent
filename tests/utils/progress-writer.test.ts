/**
 * Progress Writer tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  initializeProgress,
  loadProgress,
  writeProgress,
  updateStatus,
  startStageProgress,
  completeStageProgress,
  failStageProgress,
  updateMetrics,
  incrementFindings,
  generateProgressMarkdown,
  generateDashboardHtml,
  checkStopFlagFile,
  checkContinueFlagFile
} from '../../skill/utils/progress-writer';

const TEST_DIR = '/tmp/test-progress-' + Date.now();

describe('Progress Writer', () => {
  beforeEach(() => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('initializeProgress', () => {
    it('should create progress with all stages', () => {
      const progress = initializeProgress(TEST_DIR, 'audit-001');

      expect(progress.audit_id).toBe('audit-001');
      expect(progress.status).toBe('initializing');
      expect(Object.keys(progress.stages).length).toBeGreaterThan(0);
    });

    it('should write progress files to disk', () => {
      initializeProgress(TEST_DIR, 'audit-002');

      expect(fs.existsSync(path.join(TEST_DIR, 'progress.json'))).toBe(true);
      expect(fs.existsSync(path.join(TEST_DIR, 'progress.md'))).toBe(true);
    });
  });

  describe('loadProgress', () => {
    it('should load existing progress', () => {
      initializeProgress(TEST_DIR, 'audit-003');
      const loaded = loadProgress(TEST_DIR);

      expect(loaded).toBeDefined();
      expect(loaded?.audit_id).toBe('audit-003');
    });

    it('should return null for non-existent progress', () => {
      const loaded = loadProgress('/nonexistent');
      expect(loaded).toBeNull();
    });
  });

  describe('startStageProgress', () => {
    it('should update stage to running', () => {
      initializeProgress(TEST_DIR, 'audit-004');
      startStageProgress(TEST_DIR, 'preflight', 10);

      const progress = loadProgress(TEST_DIR);
      expect(progress?.stages['preflight'].status).toBe('running');
      expect(progress?.stages['preflight'].items_total).toBe(10);
    });
  });

  describe('completeStageProgress', () => {
    it('should mark stage as completed', () => {
      initializeProgress(TEST_DIR, 'audit-005');
      startStageProgress(TEST_DIR, 'preflight');
      completeStageProgress(TEST_DIR, 'preflight', 5);

      const progress = loadProgress(TEST_DIR);
      expect(progress?.stages['preflight'].status).toBe('completed');
      expect(progress?.stages['preflight'].progress_percent).toBe(100);
      expect(progress?.stages['preflight'].findings_count).toBe(5);
    });
  });

  describe('failStageProgress', () => {
    it('should mark stage as failed and record error', () => {
      initializeProgress(TEST_DIR, 'audit-006');
      startStageProgress(TEST_DIR, 'preflight');
      failStageProgress(TEST_DIR, 'preflight', 'Test error', false);

      const progress = loadProgress(TEST_DIR);
      expect(progress?.stages['preflight'].status).toBe('failed');
      expect(progress?.status).toBe('failed');
      expect(progress?.errors.length).toBeGreaterThan(0);
    });
  });

  describe('updateMetrics', () => {
    it('should update metrics', () => {
      initializeProgress(TEST_DIR, 'audit-007');
      updateMetrics(TEST_DIR, {
        pages_visited: 10,
        pages_total: 20
      });

      const progress = loadProgress(TEST_DIR);
      expect(progress?.metrics.pages_visited).toBe(10);
      expect(progress?.metrics.pages_total).toBe(20);
    });
  });

  describe('incrementFindings', () => {
    it('should increment finding counts', () => {
      initializeProgress(TEST_DIR, 'audit-008');
      startStageProgress(TEST_DIR, 'code-scan');
      incrementFindings(TEST_DIR, 'P1', 'code-scan');
      incrementFindings(TEST_DIR, 'P1', 'code-scan');
      incrementFindings(TEST_DIR, 'P2', 'code-scan');

      const progress = loadProgress(TEST_DIR);
      expect(progress?.metrics.findings_total).toBe(3);
      expect(progress?.metrics.findings_by_severity['P1']).toBe(2);
      expect(progress?.stages['code-scan'].findings_count).toBe(3);
    });
  });

  describe('generateProgressMarkdown', () => {
    it('should generate markdown string', () => {
      const progress = initializeProgress(TEST_DIR, 'audit-009');
      const md = generateProgressMarkdown(progress);

      expect(md).toContain('# Audit Progress');
      expect(md).toContain('audit-009');
    });
  });

  describe('generateDashboardHtml', () => {
    it('should generate HTML string', () => {
      const progress = initializeProgress(TEST_DIR, 'audit-010');
      const html = generateDashboardHtml(progress);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('audit-010');
    });
  });

  describe('flag file checks', () => {
    it('should detect stop flag file', () => {
      initializeProgress(TEST_DIR, 'audit-011');

      expect(checkStopFlagFile(TEST_DIR)).toBe(false);

      fs.writeFileSync(path.join(TEST_DIR, 'stop.flag'), '');
      expect(checkStopFlagFile(TEST_DIR)).toBe(true);
    });

    it('should detect continue flag file', () => {
      initializeProgress(TEST_DIR, 'audit-012');

      expect(checkContinueFlagFile(TEST_DIR)).toBe(false);

      fs.writeFileSync(path.join(TEST_DIR, 'continue.flag'), '');
      expect(checkContinueFlagFile(TEST_DIR)).toBe(true);
    });
  });
});
