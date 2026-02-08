/**
 * Security Scanner tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { scanSecurity } from '../../skill/analyzers/security-scanner';

const TEST_DIR = '/tmp/test-security-scanner-' + Date.now();

describe('Security Scanner', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('scanSecurity', () => {
    it('should return result with schema version', async () => {
      const result = await scanSecurity(TEST_DIR, { skipDependencyAudit: true });

      expect(result.schemaVersion).toBe('1.0.0');
      expect(result.scannedAt).toBeDefined();
    });

    it('should return empty findings for empty directory', async () => {
      const result = await scanSecurity(TEST_DIR, { skipDependencyAudit: true });

      expect(result.findings).toEqual([]);
      expect(result.metrics.filesScanned).toBe(0);
    });

    it('should have metrics structure', async () => {
      const result = await scanSecurity(TEST_DIR, { skipDependencyAudit: true });

      expect(result.metrics).toHaveProperty('filesScanned');
      expect(result.metrics).toHaveProperty('secretsFound');
      expect(result.metrics).toHaveProperty('potentialInjections');
      expect(result.metrics).toHaveProperty('p0Count');
      expect(result.metrics).toHaveProperty('p1Count');
      expect(result.metrics).toHaveProperty('p2Count');
    });

    it('should detect exposed .env files in public directories', async () => {
      fs.mkdirSync(path.join(TEST_DIR, 'public'), { recursive: true });
      fs.writeFileSync(path.join(TEST_DIR, 'public', '.env'), 'SECRET=value');

      const result = await scanSecurity(TEST_DIR, { skipDependencyAudit: true });

      expect(result.findings.some(f => f.type === 'exposed_env')).toBe(true);
    });

    it('should skip test files for secret detection', async () => {
      const srcDir = path.join(TEST_DIR, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'config.test.ts'), `
        const apiKey = "test_fake_key_not_real_0000000";
      `);

      const result = await scanSecurity(TEST_DIR, { skipDependencyAudit: true });

      // Test files should be skipped
      expect(result.findings.filter(f =>
        f.type === 'hardcoded_secret' && f.file.includes('.test.')
      ).length).toBe(0);
    });
  });

  describe('dependency audit', () => {
    it('should skip dependency audit when requested', async () => {
      const result = await scanSecurity(TEST_DIR, { skipDependencyAudit: true });

      expect(result.dependencyAudit.status).toBe('skipped');
    });

    it('should skip if no package.json exists', async () => {
      const result = await scanSecurity(TEST_DIR, { skipDependencyAudit: false });

      expect(result.dependencyAudit.status).toBe('skipped');
    });
  });

  describe('findings severity', () => {
    it('should mark exposed env as P0 severity', async () => {
      fs.mkdirSync(path.join(TEST_DIR, 'public'), { recursive: true });
      fs.writeFileSync(path.join(TEST_DIR, 'public', '.env'), 'SECRET=value');

      const result = await scanSecurity(TEST_DIR, { skipDependencyAudit: true });

      const envFinding = result.findings.find(f => f.type === 'exposed_env');
      expect(envFinding?.severity).toBe('P0');
    });
  });

  describe('options', () => {
    it('should accept excludePatterns option', async () => {
      const result = await scanSecurity(TEST_DIR, {
        skipDependencyAudit: true,
        excludePatterns: ['vendor']
      });

      expect(result).toBeDefined();
    });
  });
});
