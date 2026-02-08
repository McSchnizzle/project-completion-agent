/**
 * Integration tests for full audit flow
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runPreflight, initializeAuditDirectory, checkWriteAccess, loadConfig, discoverPrdFiles } from '../../skill/phases/preflight';
import { runCodeAnalysis, writeCodeAnalysis, loadCodeAnalysis } from '../../skill/phases/code-analysis';
import { initializeProgress, startStageProgress, loadProgress } from '../../skill/utils/progress-writer';
import { initializeCheckpoint, startStage, completeStage, loadCheckpoint } from '../../skill/utils/checkpoint';

const TEST_DIR = '/tmp/test-full-audit-' + Date.now();

describe('Full Audit Flow Integration', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('Preflight checks', () => {
    it('should verify write access', () => {
      const result = checkWriteAccess(TEST_DIR);
      expect(result).toBe(true);
    });

    it('should return false for non-existent directory', () => {
      const result = checkWriteAccess('/nonexistent/path/12345');
      expect(result).toBe(false);
    });

    it('should load default config when no config file exists', () => {
      const result = loadConfig(TEST_DIR);
      expect(result.loaded).toBe(false);
      expect(result.config).toBeDefined();
    });

    it('should discover PRD files', () => {
      fs.writeFileSync(path.join(TEST_DIR, 'PRD.md'), '# PRD');
      const result = discoverPrdFiles(TEST_DIR);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('Audit initialization', () => {
    it('should create audit directory structure', () => {
      const result = initializeAuditDirectory(TEST_DIR);

      expect(result.success).toBe(true);
      expect(fs.existsSync(result.audit_path)).toBe(true);
      expect(fs.existsSync(path.join(result.audit_path, 'findings'))).toBe(true);
      expect(fs.existsSync(path.join(result.audit_path, 'pages'))).toBe(true);
      expect(fs.existsSync(path.join(result.audit_path, 'screenshots'))).toBe(true);
    });

    it('should use provided timestamp', () => {
      const result = initializeAuditDirectory(TEST_DIR, '2024-01-01T00-00-00');
      expect(result.audit_path).toContain('2024-01-01T00-00-00');
    });
  });

  describe('Checkpoint management', () => {
    it('should initialize checkpoint', () => {
      const auditInit = initializeAuditDirectory(TEST_DIR);
      const checkpoint = initializeCheckpoint(auditInit.audit_path, 'test-audit');

      expect(checkpoint.status).toBe('running');
      expect(checkpoint.audit_id).toBe('test-audit');
    });

    it('should track stage progress', () => {
      const auditInit = initializeAuditDirectory(TEST_DIR);
      initializeCheckpoint(auditInit.audit_path, 'test-audit');

      startStage(auditInit.audit_path, 'preflight');
      completeStage(auditInit.audit_path, 'preflight', { status: 'success' });

      const loaded = loadCheckpoint(auditInit.audit_path);
      expect(loaded?.completed_stages).toContain('preflight');
    });

    it('should persist checkpoint to disk', () => {
      const auditInit = initializeAuditDirectory(TEST_DIR);
      initializeCheckpoint(auditInit.audit_path, 'test-audit');

      const checkpointPath = path.join(auditInit.audit_path, 'checkpoint.json');
      expect(fs.existsSync(checkpointPath)).toBe(true);
    });
  });

  describe('Progress tracking', () => {
    it('should initialize progress', () => {
      const auditInit = initializeAuditDirectory(TEST_DIR);
      const progress = initializeProgress(auditInit.audit_path, 'test-audit');

      expect(progress.audit_id).toBe('test-audit');
      expect(progress.stages).toHaveProperty('preflight');
      expect(progress.stages).toHaveProperty('code-scan');
    });

    it('should update stage status', () => {
      const auditInit = initializeAuditDirectory(TEST_DIR);
      initializeProgress(auditInit.audit_path, 'test-audit');
      startStageProgress(auditInit.audit_path, 'preflight');
      const progress = loadProgress(auditInit.audit_path);

      expect(progress?.stages.preflight.status).toBe('running');
    });
  });

  describe('Code analysis', () => {
    it('should analyze project and return result', async () => {
      fs.writeFileSync(path.join(TEST_DIR, 'package.json'), JSON.stringify({
        name: 'test-project'
      }));

      const result = await runCodeAnalysis(TEST_DIR);

      expect(result.schema_version).toBe('1.0.0');
      expect(result.project_root).toBe(TEST_DIR);
    });

    it('should write and load analysis result', async () => {
      const auditInit = initializeAuditDirectory(TEST_DIR);

      const result = await runCodeAnalysis(TEST_DIR);
      writeCodeAnalysis(auditInit.audit_path, result);

      const loaded = loadCodeAnalysis(auditInit.audit_path);
      expect(loaded).toBeDefined();
      expect(loaded?.schema_version).toBe('1.0.0');
    });
  });

  describe('Complete workflow', () => {
    it('should run preflight and initialize audit', async () => {
      // Create minimal project structure
      fs.writeFileSync(path.join(TEST_DIR, 'package.json'), JSON.stringify({
        name: 'test-project'
      }));

      // Create config
      const configDir = path.join(TEST_DIR, '.complete-agent');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'config.yml'), `
environment:
  url: http://localhost:3000
  safe_mode: true
`);

      // Run preflight
      const preflightResult = await runPreflight(TEST_DIR);
      expect(preflightResult.write_access).toBe(true);
      expect(preflightResult.config_loaded).toBe(true);

      // Initialize audit
      const auditInit = initializeAuditDirectory(TEST_DIR);
      expect(auditInit.success).toBe(true);

      // Initialize checkpoint
      const checkpoint = initializeCheckpoint(auditInit.audit_path, 'test-audit');
      expect(checkpoint.status).toBe('running');
    });
  });

  describe('Error handling', () => {
    it('should handle projects without PRD gracefully', async () => {
      fs.writeFileSync(path.join(TEST_DIR, 'package.json'), JSON.stringify({
        name: 'test-project'
      }));

      const preflightResult = await runPreflight(TEST_DIR);

      expect(preflightResult.prd_path).toBeNull();
      expect(preflightResult.warnings.some(w => w.includes('PRD'))).toBe(true);
    });
  });
});
