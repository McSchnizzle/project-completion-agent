/**
 * Core Pipeline Unit Tests (T-017)
 * Tests preflight checks, progress initialization, and safety assessment
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  runPreflight,
  checkWriteAccess,
  loadConfig,
  checkUrlReachable,
  discoverPrdFiles,
  initializeAuditDirectory,
  createDefaultConfig
} from '../../skill/phases/preflight';
import {
  createSafetyConfig,
  isProductionUrl,
  shouldSkipAction,
  canTestForm
} from '../../skill/phases/safety';

describe('Preflight Phase', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-preflight-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('checkWriteAccess', () => {
    it('should return true for writable directory', () => {
      const result = checkWriteAccess(tempDir);
      expect(result).toBe(true);
    });

    it('should return false for non-existent directory', () => {
      const result = checkWriteAccess('/nonexistent/directory/path');
      expect(result).toBe(false);
    });
  });

  describe('loadConfig', () => {
    it('should return defaults when no config file exists', () => {
      const result = loadConfig(tempDir);
      expect(result.loaded).toBe(false);
      expect(result.config).toBeDefined();
      expect(result.config?.environment.url).toBe('');
    });

    it('should load valid config file', () => {
      const configDir = path.join(tempDir, '.complete-agent');
      fs.mkdirSync(configDir, { recursive: true });

      const configContent = `
environment:
  url: "http://localhost:3000"
  safe_mode: true
exploration:
  max_pages: 30
`;
      fs.writeFileSync(path.join(configDir, 'config.yml'), configContent);

      const result = loadConfig(tempDir);
      expect(result.loaded).toBe(true);
      expect(result.config?.environment.url).toBe('http://localhost:3000');
      expect(result.config?.exploration?.max_pages).toBe(30);
    });
  });

  describe('checkUrlReachable', () => {
    it('should detect reachable URL with mock', async () => {
      // Mock execSync to return success status
      const { execSync } = await import('child_process');
      vi.spyOn(require('child_process'), 'execSync').mockReturnValue('200');

      const result = await checkUrlReachable('http://example.com');
      expect(result.reachable).toBe(true);
      expect(result.statusCode).toBe(200);

      vi.restoreAllMocks();
    });
  });

  describe('discoverPrdFiles', () => {
    it('should find PRD files in project root', () => {
      fs.writeFileSync(path.join(tempDir, 'PRD.md'), '# Product Requirements');
      fs.writeFileSync(path.join(tempDir, 'plan.md'), '# Project Plan');

      const result = discoverPrdFiles(tempDir);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toContain('PRD.md');
    });

    it('should return empty array when no PRD files exist', () => {
      const result = discoverPrdFiles(tempDir);
      expect(result).toEqual([]);
    });
  });

  describe('initializeAuditDirectory', () => {
    it('should create audit directory structure', () => {
      const result = initializeAuditDirectory(tempDir, '2024-01-01T00-00-00');

      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(result.audit_path, 'findings'))).toBe(true);
      expect(fs.existsSync(path.join(result.audit_path, 'pages'))).toBe(true);
      expect(fs.existsSync(path.join(result.audit_path, 'screenshots'))).toBe(true);
    });
  });

  describe('createDefaultConfig', () => {
    it('should create default config file', () => {
      const configPath = createDefaultConfig(tempDir, 'http://localhost:3000');

      expect(fs.existsSync(configPath)).toBe(true);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('http://localhost:3000');
      expect(content).toContain('safe_mode: true');
    });
  });
});

describe('Safety Assessment', () => {
  describe('isProductionUrl', () => {
    it('should classify localhost as development', () => {
      expect(isProductionUrl('http://localhost:3000')).toBe(false);
      expect(isProductionUrl('http://127.0.0.1:8080')).toBe(false);
    });

    it('should classify staging patterns as development', () => {
      expect(isProductionUrl('http://staging.example.com')).toBe(false);
      expect(isProductionUrl('http://dev.example.com')).toBe(false);
      expect(isProductionUrl('http://test.example.com')).toBe(false);
    });

    it('should detect production environments', () => {
      expect(isProductionUrl('https://example.com')).toBe(true);
      expect(isProductionUrl('https://www.example.com')).toBe(true);
      expect(isProductionUrl('https://prod.example.com')).toBe(true);
    });

    it('should handle explicit production indicators', () => {
      expect(isProductionUrl('https://production.example.com')).toBe(true);
    });
  });

  describe('createSafetyConfig', () => {
    it('should enable safe mode for production URLs', () => {
      const config = createSafetyConfig('https://example.com');
      expect(config.safe_mode).toBe(true);
      expect(config.is_production_data).toBe(true);
    });

    it('should allow unsafe mode for local development', () => {
      const config = createSafetyConfig('http://localhost:3000', false);
      expect(config.safe_mode).toBe(false);
      expect(config.is_production_data).toBe(false);
    });

    it('should respect explicit safe mode override', () => {
      const config = createSafetyConfig('http://localhost:3000', true);
      expect(config.safe_mode).toBe(true);
    });
  });

  describe('shouldSkipAction', () => {
    it('should skip destructive actions in safe mode', () => {
      const config = createSafetyConfig('https://example.com');
      const result = shouldSkipAction('DELETE /user/account', config);

      expect(result.skip).toBe(true);
      expect(result.severity).toBe('critical');
    });

    it('should allow safe actions', () => {
      const config = createSafetyConfig('http://localhost:3000', false);
      const result = shouldSkipAction('GET /users', config);

      expect(result.skip).toBe(false);
    });
  });

  describe('canTestForm', () => {
    it('should allow GET forms in safe mode', () => {
      const config = createSafetyConfig('https://example.com');
      const result = canTestForm('/search', 'GET', config);

      expect(result.skip).toBe(false);
    });

    it('should restrict POST forms in safe mode', () => {
      const config = createSafetyConfig('https://example.com');
      const result = canTestForm('/submit', 'POST', config);

      expect(result.skip).toBe(true);
    });

    it('should allow POST forms in development', () => {
      const config = createSafetyConfig('http://localhost:3000', false);
      const result = canTestForm('/submit', 'POST', config);

      expect(result.skip).toBe(false);
    });
  });
});
