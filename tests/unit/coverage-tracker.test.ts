/**
 * Tests for CoverageTracker module.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CoverageTracker } from '../../src/coverage-tracker';

describe('CoverageTracker', () => {
  let tracker: CoverageTracker;

  beforeEach(() => {
    tracker = new CoverageTracker(3); // max 3 visits per pattern
  });

  describe('addKnownRoute', () => {
    it('should add routes to tracking', () => {
      tracker.addKnownRoute({
        pattern: '/users/{id}',
        method: 'GET',
        source: 'code_analysis',
        authRequired: false,
      });
      tracker.addKnownRoute({
        pattern: '/settings',
        method: 'GET',
        source: 'code_analysis',
        authRequired: false,
      });

      const report = tracker.getReport();
      expect(report.knownRoutes).toBe(2);
    });
  });

  describe('recordVisit', () => {
    it('should record a page visit', () => {
      const record = tracker.recordVisit(
        'https://example.com/settings',
        200,
        1500,
        true,
        2,
      );

      expect(record.url).toBe('https://example.com/settings');
      expect(record.pattern).toBe('/settings');
      expect(record.statusCode).toBe(200);
      expect(record.loadTimeMs).toBe(1500);
      expect(record.hasScreenshot).toBe(true);
      expect(record.findingsCount).toBe(2);
    });

    it('should normalize numeric IDs in URL patterns', () => {
      const record = tracker.recordVisit('https://example.com/users/123');
      expect(record.pattern).toBe('/users/{id}');
    });

    it('should normalize UUIDs in URL patterns', () => {
      const record = tracker.recordVisit(
        'https://example.com/items/550e8400-e29b-41d4-a716-446655440000',
      );
      expect(record.pattern).toBe('/items/{uuid}');
    });
  });

  describe('shouldVisit', () => {
    it('should allow unvisited URLs', () => {
      const result = tracker.shouldVisit('https://example.com/about');
      expect(result.visit).toBe(true);
    });

    it('should reject already visited URLs', () => {
      tracker.recordVisit('https://example.com/about');
      const result = tracker.shouldVisit('https://example.com/about');
      expect(result.visit).toBe(false);
      expect(result.reason).toContain('already visited');
    });

    it('should reject when pattern limit reached', () => {
      tracker.recordVisit('https://example.com/users/1');
      tracker.recordVisit('https://example.com/users/2');
      tracker.recordVisit('https://example.com/users/3');

      const result = tracker.shouldVisit('https://example.com/users/4');
      expect(result.visit).toBe(false);
      expect(result.reason).toContain('already visited 3 times');
    });
  });

  describe('addToQueue / nextInQueue', () => {
    it('should add URLs to queue', () => {
      const added = tracker.addToQueue([
        'https://example.com/a',
        'https://example.com/b',
      ]);
      expect(added).toBe(2);
      expect(tracker.queueLength()).toBe(2);
    });

    it('should skip duplicates in queue', () => {
      tracker.addToQueue(['https://example.com/a']);
      tracker.addToQueue(['https://example.com/a']);
      expect(tracker.queueLength()).toBe(1);
    });

    it('should return URLs in FIFO order', () => {
      tracker.addToQueue([
        'https://example.com/a',
        'https://example.com/b',
      ]);
      expect(tracker.nextInQueue()).toBe('https://example.com/a');
      expect(tracker.nextInQueue()).toBe('https://example.com/b');
      expect(tracker.nextInQueue()).toBeUndefined();
    });

    it('should remove visited URLs from queue when visited', () => {
      tracker.addToQueue([
        'https://example.com/a',
        'https://example.com/b',
      ]);
      tracker.recordVisit('https://example.com/a');
      expect(tracker.queueLength()).toBe(1);
    });
  });

  describe('getReport', () => {
    it('should calculate coverage percentage', () => {
      tracker.addKnownRoute({
        pattern: '/settings',
        method: 'GET',
        source: 'code_analysis',
        authRequired: false,
      });
      tracker.addKnownRoute({
        pattern: '/about',
        method: 'GET',
        source: 'code_analysis',
        authRequired: false,
      });

      tracker.recordVisit('https://example.com/settings');

      const report = tracker.getReport();
      expect(report.knownRoutes).toBe(2);
      expect(report.visitedRoutes).toBe(1);
      expect(report.coveragePercent).toBe(50);
    });

    it('should list unvisited routes', () => {
      tracker.addKnownRoute({
        pattern: '/settings',
        method: 'GET',
        source: 'code_analysis',
        authRequired: false,
      });
      tracker.addKnownRoute({
        pattern: '/admin',
        method: 'GET',
        source: 'code_analysis',
        authRequired: true,
      });

      tracker.recordVisit('https://example.com/settings');

      const report = tracker.getReport();
      expect(report.unvisitedRoutes).toHaveLength(1);
      expect(report.unvisitedRoutes[0].pattern).toBe('/admin');
      expect(report.unvisitedRoutes[0].authRequired).toBe(true);
    });

    it('should calculate average load time', () => {
      tracker.recordVisit('https://example.com/a', 200, 1000);
      tracker.recordVisit('https://example.com/b', 200, 2000);
      tracker.recordVisit('https://example.com/c', 200, 3000);

      const report = tracker.getReport();
      expect(report.avgLoadTimeMs).toBe(2000);
    });

    it('should track routes by source', () => {
      tracker.addKnownRoute({
        pattern: '/a',
        method: 'GET',
        source: 'code_analysis',
        authRequired: false,
      });
      tracker.addKnownRoute({
        pattern: '/b',
        method: 'GET',
        source: 'prd',
        authRequired: false,
      });
      tracker.addKnownRoute({
        pattern: '/c',
        method: 'GET',
        source: 'code_analysis',
        authRequired: false,
      });

      const report = tracker.getReport();
      expect(report.routesBySource['code_analysis']).toBe(2);
      expect(report.routesBySource['prd']).toBe(1);
    });

    it('should return 0% coverage when no known routes', () => {
      tracker.recordVisit('https://example.com/settings');
      const report = tracker.getReport();
      expect(report.coveragePercent).toBe(0);
    });
  });

  describe('writeSummary', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-coverage-'));
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should write markdown summary file', () => {
      tracker.addKnownRoute({
        pattern: '/settings',
        method: 'GET',
        source: 'code_analysis',
        authRequired: false,
      });
      tracker.recordVisit('https://example.com/settings', 200, 1500);

      const summaryPath = tracker.writeSummary(tempDir);
      expect(fs.existsSync(summaryPath)).toBe(true);

      const content = fs.readFileSync(summaryPath, 'utf-8');
      expect(content).toContain('# Coverage Summary');
      expect(content).toContain('**Known Routes:** 1');
      expect(content).toContain('**Coverage:** 100%');
    });
  });

  describe('getState', () => {
    it('should return current state summary', () => {
      tracker.addToQueue([
        'https://example.com/a',
        'https://example.com/b',
      ]);
      tracker.recordVisit('https://example.com/c');

      const state = tracker.getState();
      expect(state.pagesVisited).toBe(1);
      expect(state.queueLength).toBe(2);
      expect(state.uniquePatterns).toBe(1);
    });
  });

  describe('loadFromCodeAnalysis', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-coverage-'));
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should load routes from code-analysis.json', () => {
      const analysisPath = path.join(tempDir, 'code-analysis.json');
      fs.writeFileSync(
        analysisPath,
        JSON.stringify({
          routes: [
            { path: '/users', method: 'GET', auth_required: false },
            { path: '/settings', method: 'GET', auth_required: true },
            { path: '/about', method: 'GET' },
          ],
        }),
      );

      const count = tracker.loadFromCodeAnalysis(tempDir);
      expect(count).toBe(3);

      const report = tracker.getReport();
      expect(report.knownRoutes).toBe(3);
    });

    it('should handle string routes', () => {
      const analysisPath = path.join(tempDir, 'code-analysis.json');
      fs.writeFileSync(
        analysisPath,
        JSON.stringify({
          routes: ['/users', '/settings', '/about'],
        }),
      );

      const count = tracker.loadFromCodeAnalysis(tempDir);
      expect(count).toBe(3);
    });

    it('should return 0 when file does not exist', () => {
      const count = tracker.loadFromCodeAnalysis('/nonexistent/path');
      expect(count).toBe(0);
    });
  });
});
