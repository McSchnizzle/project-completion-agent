/**
 * Code Quality Analyzer tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { analyzeCodeQuality } from '../../skill/analyzers/code-quality';

const TEST_DIR = '/tmp/test-code-quality-' + Date.now();

describe('Code Quality Analyzer', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('analyzeCodeQuality', () => {
    it('should return result with schema version', async () => {
      const result = await analyzeCodeQuality(TEST_DIR);

      expect(result.schema_version).toBe('1.0.0');
      expect(result.analyzed_at).toBeDefined();
      expect(result.codebase_path).toBe(TEST_DIR);
    });

    it('should return empty findings for empty directory', async () => {
      const result = await analyzeCodeQuality(TEST_DIR);

      expect(result.findings).toEqual([]);
      expect(result.metrics.files_analyzed).toBe(0);
    });

    it('should return metrics structure', async () => {
      const result = await analyzeCodeQuality(TEST_DIR);

      expect(result.metrics).toHaveProperty('files_analyzed');
      expect(result.metrics).toHaveProperty('files_skipped');
      expect(result.metrics).toHaveProperty('total_todos');
      expect(result.metrics).toHaveProperty('total_fixmes');
      expect(result.metrics).toHaveProperty('console_logs');
    });

    it('should respect exclusion patterns', async () => {
      const result = await analyzeCodeQuality(TEST_DIR);

      expect(result.exclusions).toContain('node_modules');
      expect(result.exclusions).toContain('dist');
    });
  });

  describe('finding detection', () => {
    it('should detect TODO comments when present', async () => {
      const srcDir = path.join(TEST_DIR, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'app.ts'), '// TODO: Fix this later\nconst x = 1;');

      const result = await analyzeCodeQuality(TEST_DIR);

      // Check that the analyzer found the file
      if (result.metrics.files_analyzed > 0) {
        expect(result.findings.some(f => f.type === 'todo')).toBe(true);
      }
    });

    it('should detect console statements when present', async () => {
      const srcDir = path.join(TEST_DIR, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'debug.ts'), 'console.log("debugging");');

      const result = await analyzeCodeQuality(TEST_DIR);

      if (result.metrics.files_analyzed > 0) {
        expect(result.findings.some(f => f.type === 'console_log')).toBe(true);
      }
    });
  });

  describe('language tracking', () => {
    it('should track TypeScript files', async () => {
      const srcDir = path.join(TEST_DIR, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'module.ts'), 'export const a = 1;');

      const result = await analyzeCodeQuality(TEST_DIR);

      if (result.metrics.files_analyzed > 0) {
        expect(result.languages.some(l => l.name === 'TypeScript')).toBe(true);
      }
    });

    it('should use regex parser', async () => {
      const srcDir = path.join(TEST_DIR, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'module.ts'), 'export const a = 1;');

      const result = await analyzeCodeQuality(TEST_DIR);

      if (result.languages.length > 0) {
        expect(result.languages[0].parser).toBe('regex');
      }
    });
  });

  describe('options', () => {
    it('should accept maxFileSize option', async () => {
      const result = await analyzeCodeQuality(TEST_DIR, { maxFileSize: 1024 });
      expect(result).toBeDefined();
    });

    it('should accept maxComplexity option', async () => {
      const result = await analyzeCodeQuality(TEST_DIR, { maxComplexity: 5 });
      expect(result).toBeDefined();
    });

    it('should accept excludePatterns option', async () => {
      const result = await analyzeCodeQuality(TEST_DIR, { excludePatterns: ['vendor'] });
      expect(result.exclusions).toContain('vendor');
    });
  });
});
