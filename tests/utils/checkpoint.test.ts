/**
 * Checkpoint utility tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  initializeCheckpoint,
  loadCheckpoint,
  saveCheckpoint,
  startStage,
  completeStage,
  failStage,
  getCompletedStages,
  Checkpoint
} from '../../skill/utils/checkpoint';

const TEST_DIR = '/tmp/test-checkpoint-' + Date.now();

describe('Checkpoint utilities', () => {
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

  describe('initializeCheckpoint', () => {
    it('should create a new checkpoint with correct structure', () => {
      const checkpoint = initializeCheckpoint(TEST_DIR, 'test-audit-1');

      expect(checkpoint).toBeDefined();
      expect(checkpoint.audit_id).toBe('test-audit-1');
      expect(checkpoint.status).toBe('running');
      expect(checkpoint.completed_stages).toEqual([]);
      expect(checkpoint.can_resume).toBe(true);
    });

    it('should write checkpoint file to disk', () => {
      initializeCheckpoint(TEST_DIR, 'test-audit-2');

      const checkpointPath = path.join(TEST_DIR, 'checkpoint.json');
      expect(fs.existsSync(checkpointPath)).toBe(true);
    });
  });

  describe('loadCheckpoint', () => {
    it('should load existing checkpoint', () => {
      const original = initializeCheckpoint(TEST_DIR, 'test-audit-3');
      const loaded = loadCheckpoint(TEST_DIR);

      expect(loaded).toBeDefined();
      expect(loaded?.audit_id).toBe('test-audit-3');
    });

    it('should return null for non-existent checkpoint', () => {
      const loaded = loadCheckpoint('/nonexistent/path');
      expect(loaded).toBeNull();
    });
  });

  describe('startStage', () => {
    it('should update current stage', () => {
      initializeCheckpoint(TEST_DIR, 'test-audit-4');
      startStage(TEST_DIR, 'preflight');

      // startStage returns StageState, check checkpoint directly
      const checkpoint = loadCheckpoint(TEST_DIR);
      expect(checkpoint?.current_stage).toBe('preflight');
      expect(checkpoint?.status).toBe('running');
    });
  });

  describe('completeStage', () => {
    it('should add stage to completed stages', () => {
      initializeCheckpoint(TEST_DIR, 'test-audit-5');
      startStage(TEST_DIR, 'preflight');
      completeStage(TEST_DIR, 'preflight', { result: 'success' });

      // completeStage returns StageState, check checkpoint directly
      const checkpoint = loadCheckpoint(TEST_DIR);
      expect(checkpoint?.completed_stages).toContain('preflight');
      expect(checkpoint?.stage_outputs['preflight']).toBeDefined();
    });
  });

  describe('failStage', () => {
    it('should record error and update status', () => {
      initializeCheckpoint(TEST_DIR, 'test-audit-6');
      startStage(TEST_DIR, 'preflight');
      failStage(TEST_DIR, 'preflight', 'Test error', false);

      // failStage returns StageState, check checkpoint directly
      const checkpoint = loadCheckpoint(TEST_DIR);
      expect(checkpoint?.status).toBe('failed');
      expect(checkpoint?.errors.length).toBeGreaterThan(0);
    });

    it('should mark as paused when recoverable', () => {
      initializeCheckpoint(TEST_DIR, 'test-audit-7');
      startStage(TEST_DIR, 'preflight');
      failStage(TEST_DIR, 'preflight', 'Recoverable error', true);

      // failStage returns StageState, check the checkpoint directly
      const checkpoint = loadCheckpoint(TEST_DIR);
      expect(checkpoint?.status).toBe('paused');
      expect(checkpoint?.can_resume).toBe(true);
      expect(checkpoint?.errors[0].recoverable).toBe(true);
    });
  });

  describe('getCompletedStages', () => {
    it('should return list of completed stages', () => {
      initializeCheckpoint(TEST_DIR, 'test-audit-8');
      startStage(TEST_DIR, 'preflight');
      completeStage(TEST_DIR, 'preflight', {});
      startStage(TEST_DIR, 'code-scan');
      completeStage(TEST_DIR, 'code-scan', {});

      const completed = getCompletedStages(TEST_DIR);
      expect(completed).toContain('preflight');
      expect(completed).toContain('code-scan');
    });
  });
});
