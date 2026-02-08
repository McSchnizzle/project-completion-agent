/**
 * Architecture Analyzer tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { analyzeArchitecture } from '../../skill/analyzers/architecture-analyzer';

const TEST_DIR = '/tmp/test-architecture-' + Date.now();

describe('Architecture Analyzer', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('analyzeArchitecture', () => {
    it('should return result with schema version', async () => {
      const result = await analyzeArchitecture(TEST_DIR);

      expect(result.schemaVersion).toBe('1.0.0');
      expect(result.analyzedAt).toBeDefined();
    });

    it('should return null framework for empty project', async () => {
      const result = await analyzeArchitecture(TEST_DIR);

      expect(result.framework).toBeNull();
    });

    it('should detect Next.js framework from config file', async () => {
      fs.writeFileSync(path.join(TEST_DIR, 'next.config.js'), 'module.exports = {};');

      const result = await analyzeArchitecture(TEST_DIR);

      expect(result.framework).toBe('next');
    });

    it('should detect React framework from package.json', async () => {
      fs.writeFileSync(path.join(TEST_DIR, 'package.json'), JSON.stringify({
        dependencies: { react: '^18.0.0' }
      }));

      const result = await analyzeArchitecture(TEST_DIR);

      expect(result.framework).toBe('react');
    });

    it('should detect Express framework from package.json', async () => {
      fs.writeFileSync(path.join(TEST_DIR, 'package.json'), JSON.stringify({
        dependencies: { express: '^4.0.0' }
      }));

      const result = await analyzeArchitecture(TEST_DIR);

      expect(result.framework).toBe('express');
    });

    it('should have empty dependency graph for empty project', async () => {
      const result = await analyzeArchitecture(TEST_DIR);

      expect(result.dependencyGraph.nodes).toEqual([]);
      expect(result.dependencyGraph.edges).toEqual([]);
    });

    it('should build dependency graph for project with imports', async () => {
      const srcDir = path.join(TEST_DIR, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'a.ts'), `import { b } from './b';`);
      fs.writeFileSync(path.join(srcDir, 'b.ts'), `export const b = 1;`);

      const result = await analyzeArchitecture(TEST_DIR);

      expect(result.dependencyGraph.nodes.length).toBeGreaterThan(0);
    });
  });

  describe('metrics', () => {
    it('should return metrics structure', async () => {
      const result = await analyzeArchitecture(TEST_DIR);

      expect(result.metrics).toHaveProperty('totalFiles');
      expect(result.metrics).toHaveProperty('totalImports');
      expect(result.metrics).toHaveProperty('circularDependencyCount');
      expect(result.metrics).toHaveProperty('orphanFileCount');
      expect(result.metrics).toHaveProperty('godFileCount');
    });

    it('should count files correctly', async () => {
      const srcDir = path.join(TEST_DIR, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'a.ts'), `export const a = 1;`);
      fs.writeFileSync(path.join(srcDir, 'b.ts'), `export const b = 2;`);

      const result = await analyzeArchitecture(TEST_DIR);

      expect(result.metrics.totalFiles).toBeGreaterThanOrEqual(2);
    });
  });

  describe('pattern compliance', () => {
    it('should return pattern compliance array', async () => {
      const result = await analyzeArchitecture(TEST_DIR);

      expect(Array.isArray(result.patternCompliance)).toBe(true);
    });
  });

  describe('circular dependency detection', () => {
    it('should return empty array when no circular dependencies', async () => {
      const srcDir = path.join(TEST_DIR, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'a.ts'), `export const a = 1;`);

      const result = await analyzeArchitecture(TEST_DIR);

      expect(result.circularDependencies).toEqual([]);
    });
  });

  describe('options', () => {
    it('should accept excludePatterns option', async () => {
      const result = await analyzeArchitecture(TEST_DIR, {
        excludePatterns: ['vendor']
      });

      expect(result).toBeDefined();
    });
  });
});
