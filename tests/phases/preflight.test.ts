/**
 * Preflight Phase tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  runPreflight,
  checkWriteAccess,
  checkGitHubCli,
  loadConfig,
  discoverPrdFiles,
  detectProductionEnvironment,
  formatPreflightSummary,
  validatePreflightGate,
  initializeAuditDirectory,
  createDefaultConfig,
  AuditConfig
} from '../../skill/phases/preflight';

const TEST_DIR = '/tmp/test-preflight-' + Date.now();

describe('Preflight Phase', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('checkWriteAccess', () => {
    it('should return true for writable directory', () => {
      const result = checkWriteAccess(TEST_DIR);
      expect(result).toBe(true);
    });

    it('should return false for non-existent directory', () => {
      const result = checkWriteAccess('/nonexistent/path/12345');
      expect(result).toBe(false);
    });
  });

  describe('loadConfig', () => {
    it('should return defaults when no config file exists', () => {
      const result = loadConfig(TEST_DIR);

      expect(result.loaded).toBe(false);
      expect(result.config).toBeDefined();
      expect(result.config?.environment.safe_mode).toBe(true);
    });

    it('should load config from .complete-agent/config.yml', () => {
      const configDir = path.join(TEST_DIR, '.complete-agent');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'config.yml'), `
environment:
  url: https://example.com
  safe_mode: false
`);

      const result = loadConfig(TEST_DIR);

      expect(result.loaded).toBe(true);
      expect(result.config?.environment.url).toBe('https://example.com');
      expect(result.config?.environment.safe_mode).toBe(false);
    });

    it('should merge with defaults', () => {
      const configDir = path.join(TEST_DIR, '.complete-agent');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'config.yml'), `
environment:
  url: https://example.com
`);

      const result = loadConfig(TEST_DIR);

      // Custom value applied
      expect(result.config?.environment.url).toBe('https://example.com');
      // Default value preserved
      expect(result.config?.exploration?.max_pages).toBeDefined();
    });
  });

  describe('discoverPrdFiles', () => {
    it('should find PRD files in project root', () => {
      fs.writeFileSync(path.join(TEST_DIR, 'PRD.md'), '# PRD');

      const result = discoverPrdFiles(TEST_DIR);

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toContain('PRD.md');
    });

    it('should find PRD files in subdirectories', () => {
      fs.mkdirSync(path.join(TEST_DIR, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(TEST_DIR, 'docs', 'PRD.md'), '# PRD');

      const result = discoverPrdFiles(TEST_DIR);

      expect(result.length).toBeGreaterThan(0);
    });

    it('should prioritize PRD over plan files', () => {
      fs.writeFileSync(path.join(TEST_DIR, 'plan.md'), '# Plan');
      fs.writeFileSync(path.join(TEST_DIR, 'PRD.md'), '# PRD');

      const result = discoverPrdFiles(TEST_DIR);

      expect(result[0]).toContain('PRD.md');
    });

    it('should exclude node_modules', () => {
      fs.mkdirSync(path.join(TEST_DIR, 'node_modules', 'pkg'), { recursive: true });
      fs.writeFileSync(path.join(TEST_DIR, 'node_modules', 'pkg', 'PRD.md'), '# PRD');

      const result = discoverPrdFiles(TEST_DIR);

      expect(result.filter(f => f.includes('node_modules')).length).toBe(0);
    });
  });

  describe('detectProductionEnvironment', () => {
    it('should return true when explicitly set', () => {
      const config: AuditConfig = {
        environment: {
          url: 'https://localhost:3000',
          is_production_data: true,
          safe_mode: false
        }
      };

      const result = detectProductionEnvironment(config);
      expect(result).toBe(true);
    });

    it('should return false for localhost', () => {
      const config: AuditConfig = {
        environment: {
          url: 'http://localhost:3000',
          is_production_data: null,
          safe_mode: false,
          safe_hostnames: ['localhost']
        }
      };

      const result = detectProductionEnvironment(config);
      expect(result).toBe(false);
    });

    it('should return true for production-like URLs', () => {
      const config: AuditConfig = {
        environment: {
          url: 'https://app.production.example.com',
          is_production_data: null,
          safe_mode: false,
          production_hostnames: ['*.production.*']
        }
      };

      const result = detectProductionEnvironment(config);
      expect(result).toBe(true);
    });
  });

  describe('formatPreflightSummary', () => {
    it('should format summary with all fields', () => {
      const result = {
        write_access: true,
        browser_mode: 'mcp' as const,
        github_authenticated: true,
        github_username: 'testuser',
        github_repo: 'owner/repo',
        config_loaded: true,
        config_path: '/path/to/config.yml',
        config: null,
        app_url: 'http://localhost:3000',
        app_reachable: true,
        app_status_code: 200,
        prd_path: '/path/to/PRD.md',
        prd_candidates: ['/path/to/PRD.md'],
        safe_mode: true,
        is_production: false,
        errors: [],
        warnings: []
      };

      const summary = formatPreflightSummary(result);

      expect(summary).toContain('Write access');
      expect(summary).toContain('confirmed');
      expect(summary).toContain('GitHub CLI');
      expect(summary).toContain('testuser');
    });

    it('should include errors when present', () => {
      const result = {
        write_access: false,
        browser_mode: 'none' as const,
        github_authenticated: false,
        github_username: null,
        github_repo: null,
        config_loaded: false,
        config_path: null,
        config: null,
        app_url: null,
        app_reachable: false,
        app_status_code: null,
        prd_path: null,
        prd_candidates: [],
        safe_mode: true,
        is_production: false,
        errors: ['Cannot write to directory'],
        warnings: ['No PRD found']
      };

      const summary = formatPreflightSummary(result);

      expect(summary).toContain('ERRORS');
      expect(summary).toContain('Cannot write to directory');
      expect(summary).toContain('WARNINGS');
    });
  });

  describe('validatePreflightGate', () => {
    it('should pass when write access is available', () => {
      const result = {
        write_access: true,
        browser_mode: 'none' as const,
        github_authenticated: false,
        github_username: null,
        github_repo: null,
        config_loaded: false,
        config_path: null,
        config: null,
        app_url: null,
        app_reachable: false,
        app_status_code: null,
        prd_path: null,
        prd_candidates: [],
        safe_mode: true,
        is_production: false,
        errors: [],
        warnings: []
      };

      const validation = validatePreflightGate(result);
      expect(validation.pass).toBe(true);
    });

    it('should fail when write access is denied', () => {
      const result = {
        write_access: false,
        browser_mode: 'none' as const,
        github_authenticated: false,
        github_username: null,
        github_repo: null,
        config_loaded: false,
        config_path: null,
        config: null,
        app_url: null,
        app_reachable: false,
        app_status_code: null,
        prd_path: null,
        prd_candidates: [],
        safe_mode: true,
        is_production: false,
        errors: [],
        warnings: []
      };

      const validation = validatePreflightGate(result);
      expect(validation.pass).toBe(false);
      expect(validation.blocking_errors.length).toBeGreaterThan(0);
    });

    it('should fail when app URL is set but not reachable', () => {
      const result = {
        write_access: true,
        browser_mode: 'none' as const,
        github_authenticated: false,
        github_username: null,
        github_repo: null,
        config_loaded: false,
        config_path: null,
        config: null,
        app_url: 'http://localhost:9999',
        app_reachable: false,
        app_status_code: null,
        prd_path: null,
        prd_candidates: [],
        safe_mode: true,
        is_production: false,
        errors: [],
        warnings: []
      };

      const validation = validatePreflightGate(result);
      expect(validation.pass).toBe(false);
    });
  });

  describe('initializeAuditDirectory', () => {
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

  describe('createDefaultConfig', () => {
    it('should create config file', () => {
      const configPath = createDefaultConfig(TEST_DIR, 'http://localhost:3000');

      expect(fs.existsSync(configPath)).toBe(true);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('http://localhost:3000');
    });
  });
});
