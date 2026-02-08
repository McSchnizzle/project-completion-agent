/**
 * Tests for src/pipeline/checkpoint-manager.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  saveCheckpoint,
  loadCheckpoint,
  shouldResume,
  buildCheckpointState,
  type CheckpointState,
} from '../../src/pipeline/checkpoint-manager';

const TEST_DIR = `/tmp/test-checkpoint-mgr-${Date.now()}`;
const AUDIT_DIR = path.join(TEST_DIR, '.complete-agent', 'audits', 'current');

describe('CheckpointManager', () => {
  beforeEach(() => {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('buildCheckpointState', () => {
    it('should create a valid checkpoint with defaults', () => {
      const state = buildCheckpointState({
        completedPhases: ['preflight', 'prd-parsing'],
      });

      expect(state.completedPhases).toEqual(['preflight', 'prd-parsing']);
      expect(state.currentPhase).toBeNull();
      expect(state.visitedUrls).toEqual([]);
      expect(state.explorationQueue).toEqual([]);
      expect(state.findingsCount).toBe(0);
      expect(state.elapsedMs).toBe(0);
      expect(state.timestamp).toBeTruthy();
    });

    it('should accept all optional fields', () => {
      const state = buildCheckpointState({
        currentPhase: 'exploration',
        completedPhases: ['preflight'],
        visitedUrls: ['http://localhost:3000/'],
        explorationQueue: ['http://localhost:3000/about'],
        findingsCount: 5,
        elapsedMs: 30000,
      });

      expect(state.currentPhase).toBe('exploration');
      expect(state.visitedUrls).toEqual(['http://localhost:3000/']);
      expect(state.explorationQueue).toEqual(['http://localhost:3000/about']);
      expect(state.findingsCount).toBe(5);
      expect(state.elapsedMs).toBe(30000);
    });
  });

  describe('saveCheckpoint / loadCheckpoint', () => {
    it('should round-trip a checkpoint through save and load', () => {
      const state = buildCheckpointState({
        completedPhases: ['preflight', 'code-analysis'],
        findingsCount: 3,
        elapsedMs: 15000,
      });

      saveCheckpoint(AUDIT_DIR, state);
      const loaded = loadCheckpoint(AUDIT_DIR);

      expect(loaded).not.toBeNull();
      expect(loaded!.completedPhases).toEqual(['preflight', 'code-analysis']);
      expect(loaded!.findingsCount).toBe(3);
      expect(loaded!.elapsedMs).toBe(15000);
    });

    it('should write atomically (no .tmp file left behind)', () => {
      const state = buildCheckpointState({ completedPhases: ['preflight'] });
      saveCheckpoint(AUDIT_DIR, state);

      const files = fs.readdirSync(AUDIT_DIR);
      expect(files).toContain('checkpoint.json');
      expect(files).not.toContain('checkpoint.json.tmp');
    });

    it('should return null for non-existent checkpoint', () => {
      const loaded = loadCheckpoint('/nonexistent/dir');
      expect(loaded).toBeNull();
    });

    it('should return null for malformed JSON', () => {
      const checkpointPath = path.join(AUDIT_DIR, 'checkpoint.json');
      fs.writeFileSync(checkpointPath, 'not valid json', 'utf-8');

      const loaded = loadCheckpoint(AUDIT_DIR);
      expect(loaded).toBeNull();
    });

    it('should return null for structurally invalid checkpoint', () => {
      const checkpointPath = path.join(AUDIT_DIR, 'checkpoint.json');
      fs.writeFileSync(
        checkpointPath,
        JSON.stringify({ foo: 'bar' }),
        'utf-8',
      );

      const loaded = loadCheckpoint(AUDIT_DIR);
      expect(loaded).toBeNull();
    });

    it('should overwrite an existing checkpoint', () => {
      const state1 = buildCheckpointState({
        completedPhases: ['preflight'],
        findingsCount: 1,
      });
      saveCheckpoint(AUDIT_DIR, state1);

      const state2 = buildCheckpointState({
        completedPhases: ['preflight', 'code-analysis'],
        findingsCount: 5,
      });
      saveCheckpoint(AUDIT_DIR, state2);

      const loaded = loadCheckpoint(AUDIT_DIR);
      expect(loaded!.completedPhases).toEqual(['preflight', 'code-analysis']);
      expect(loaded!.findingsCount).toBe(5);
    });
  });

  describe('shouldResume', () => {
    it('should return false when no checkpoint exists', () => {
      expect(shouldResume('/nonexistent')).toBe(false);
    });

    it('should return false when checkpoint has no completed phases', () => {
      const state = buildCheckpointState({ completedPhases: [] });
      saveCheckpoint(AUDIT_DIR, state);

      expect(shouldResume(AUDIT_DIR)).toBe(false);
    });

    it('should return true when checkpoint has completed phases', () => {
      const state = buildCheckpointState({
        completedPhases: ['preflight'],
      });
      saveCheckpoint(AUDIT_DIR, state);

      expect(shouldResume(AUDIT_DIR)).toBe(true);
    });
  });
});
