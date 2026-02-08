/**
 * Tests for src/action-logger.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ActionLogger } from '../../src/storage/action-logger';

const TEST_DIR = `/tmp/test-action-logger-${Date.now()}`;
const AUDIT_DIR = path.join(TEST_DIR, '.complete-agent', 'audits', 'current');

describe('ActionLogger', () => {
  beforeEach(() => {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
    ActionLogger.reset();
  });

  afterEach(() => {
    ActionLogger.reset();
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('singleton', () => {
    it('should return null before init', () => {
      expect(ActionLogger.getInstance()).toBeNull();
    });

    it('should return instance after init', () => {
      ActionLogger.init(AUDIT_DIR);
      expect(ActionLogger.getInstance()).not.toBeNull();
    });

    it('should return null after reset', () => {
      ActionLogger.init(AUDIT_DIR);
      ActionLogger.reset();
      expect(ActionLogger.getInstance()).toBeNull();
    });
  });

  describe('log', () => {
    it('should write a JSONL entry to disk', () => {
      const logger = ActionLogger.init(AUDIT_DIR);
      logger.log({
        action_type: 'phase_start',
        phase: 'preflight',
        details: 'Starting preflight checks',
      });

      const logPath = logger.getPath();
      expect(fs.existsSync(logPath)).toBe(true);

      const content = fs.readFileSync(logPath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(1);

      const entry = JSON.parse(lines[0]);
      expect(entry.action_type).toBe('phase_start');
      expect(entry.phase).toBe('preflight');
      expect(entry.timestamp).toBeTruthy();
    });

    it('should append multiple entries', () => {
      const logger = ActionLogger.init(AUDIT_DIR);

      logger.log({ action_type: 'audit_start' });
      logger.log({ action_type: 'phase_start', phase: 'preflight' });
      logger.log({ action_type: 'phase_complete', phase: 'preflight', duration_ms: 500 });

      const content = fs.readFileSync(logger.getPath(), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(3);
    });

    it('should include optional fields when provided', () => {
      const logger = ActionLogger.init(AUDIT_DIR);
      logger.log({
        action_type: 'page_visit',
        phase: 'exploration',
        target_url: 'http://localhost:3000/',
        details: 'Visited homepage',
        duration_ms: 1200,
      });

      const entries = logger.readAll();
      expect(entries[0].target_url).toBe('http://localhost:3000/');
      expect(entries[0].duration_ms).toBe(1200);
    });
  });

  describe('readAll', () => {
    it('should return empty array when no log file exists', () => {
      const logger = ActionLogger.init(AUDIT_DIR);
      const entries = logger.readAll();
      expect(entries).toEqual([]);
    });

    it('should return all entries in order', () => {
      const logger = ActionLogger.init(AUDIT_DIR);
      logger.log({ action_type: 'audit_start' });
      logger.log({ action_type: 'phase_start', phase: 'preflight' });
      logger.log({ action_type: 'phase_complete', phase: 'preflight' });

      const entries = logger.readAll();
      expect(entries.length).toBe(3);
      expect(entries[0].action_type).toBe('audit_start');
      expect(entries[1].action_type).toBe('phase_start');
      expect(entries[2].action_type).toBe('phase_complete');
    });

    it('should skip malformed lines', () => {
      const logger = ActionLogger.init(AUDIT_DIR);
      logger.log({ action_type: 'audit_start' });

      // Inject a malformed line
      fs.appendFileSync(logger.getPath(), 'not json\n', 'utf-8');

      logger.log({ action_type: 'phase_start', phase: 'preflight' });

      const entries = logger.readAll();
      expect(entries.length).toBe(2);
      expect(entries[0].action_type).toBe('audit_start');
      expect(entries[1].action_type).toBe('phase_start');
    });
  });

  describe('readLast', () => {
    it('should return the last N entries in reverse order', () => {
      const logger = ActionLogger.init(AUDIT_DIR);
      logger.log({ action_type: 'audit_start' });
      logger.log({ action_type: 'phase_start', phase: 'preflight' });
      logger.log({ action_type: 'phase_complete', phase: 'preflight' });
      logger.log({ action_type: 'phase_start', phase: 'code-analysis' });

      const last2 = logger.readLast(2);
      expect(last2.length).toBe(2);
      expect(last2[0].action_type).toBe('phase_start');
      expect(last2[0].phase).toBe('code-analysis');
      expect(last2[1].action_type).toBe('phase_complete');
    });

    it('should handle requesting more entries than exist', () => {
      const logger = ActionLogger.init(AUDIT_DIR);
      logger.log({ action_type: 'audit_start' });

      const last10 = logger.readLast(10);
      expect(last10.length).toBe(1);
    });
  });
});
