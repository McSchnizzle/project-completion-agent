/**
 * Coverage Queue utility tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CoverageQueue, QueuedUrl } from '../../skill/utils/coverage-queue';

const TEST_DIR = '/tmp/test-coverage-queue-' + Date.now();

describe('CoverageQueue utilities', () => {
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

  describe('constructor', () => {
    it('should create new queue with initial state', () => {
      const queue = new CoverageQueue(TEST_DIR, 'test-audit');

      expect(queue.length).toBe(0);
      expect(queue.isEmpty).toBe(true);
    });

    it('should load existing state from disk', () => {
      // Create first queue and add items
      const queue1 = new CoverageQueue(TEST_DIR, 'test-audit');
      queue1.enqueue('https://example.com/page1', 'route-1');
      queue1.save();

      // Create second queue - should load existing state
      const queue2 = new CoverageQueue(TEST_DIR, 'test-audit');
      expect(queue2.length).toBe(1);
    });
  });

  describe('enqueue', () => {
    it('should add URL to queue', () => {
      const queue = new CoverageQueue(TEST_DIR, 'test-audit');

      const added = queue.enqueue('https://example.com/page1', 'route-1');

      expect(added).toBe(true);
      expect(queue.length).toBe(1);
    });

    it('should not add duplicate URLs', () => {
      const queue = new CoverageQueue(TEST_DIR, 'test-audit');

      queue.enqueue('https://example.com/page1', 'route-1');
      const addedAgain = queue.enqueue('https://example.com/page1', 'route-1');

      expect(addedAgain).toBe(false);
      expect(queue.length).toBe(1);
    });

    it('should respect depth limit', () => {
      const queue = new CoverageQueue(TEST_DIR, 'test-audit', { maxDepth: 2 });

      const added = queue.enqueue('https://example.com/deep', 'route-1', { depth: 5 });

      expect(added).toBe(false);
    });

    it('should order by priority', () => {
      const queue = new CoverageQueue(TEST_DIR, 'test-audit');

      queue.enqueue('https://example.com/low', 'route-1', { priority: 1 });
      queue.enqueue('https://example.com/high', 'route-2', { priority: 10 });
      queue.enqueue('https://example.com/medium', 'route-3', { priority: 5 });

      const first = queue.dequeue();
      expect(first?.url).toBe('https://example.com/high');
    });
  });

  describe('dequeue', () => {
    it('should return and remove first item', () => {
      const queue = new CoverageQueue(TEST_DIR, 'test-audit');
      queue.enqueue('https://example.com/page1', 'route-1');

      const item = queue.dequeue();

      expect(item?.url).toBe('https://example.com/page1');
      expect(queue.length).toBe(0);
    });

    it('should return null when empty', () => {
      const queue = new CoverageQueue(TEST_DIR, 'test-audit');

      const item = queue.dequeue();

      expect(item).toBeNull();
    });
  });

  describe('peek', () => {
    it('should return first item without removing', () => {
      const queue = new CoverageQueue(TEST_DIR, 'test-audit');
      queue.enqueue('https://example.com/page1', 'route-1');

      const item = queue.peek();

      expect(item?.url).toBe('https://example.com/page1');
      expect(queue.length).toBe(1);
    });
  });

  describe('markVisited', () => {
    it('should add URL to visited list', () => {
      const queue = new CoverageQueue(TEST_DIR, 'test-audit');

      queue.markVisited('https://example.com/page1');

      expect(queue.hasVisited('https://example.com/page1')).toBe(true);
    });
  });

  describe('markSkipped', () => {
    it('should add URL to skipped list and remove from pending', () => {
      const queue = new CoverageQueue(TEST_DIR, 'test-audit');
      queue.enqueue('https://example.com/page1', 'route-1');

      queue.markSkipped('https://example.com/page1');

      expect(queue.length).toBe(0);
    });
  });

  describe('markFailed', () => {
    it('should add URL to failed list', () => {
      const queue = new CoverageQueue(TEST_DIR, 'test-audit');
      queue.enqueue('https://example.com/page1', 'route-1');

      queue.markFailed('https://example.com/page1');

      expect(queue.length).toBe(0);
    });
  });

  describe('hasSeenRoute', () => {
    it('should track seen routes', () => {
      const queue = new CoverageQueue(TEST_DIR, 'test-audit');

      queue.enqueue('https://example.com/page1', 'route-1');

      expect(queue.hasSeenRoute('route-1')).toBe(true);
      expect(queue.hasSeenRoute('route-2')).toBe(false);
    });
  });

  describe('bulkEnqueue', () => {
    it('should add multiple URLs at once', () => {
      const queue = new CoverageQueue(TEST_DIR, 'test-audit');

      const added = queue.bulkEnqueue([
        { url: 'https://example.com/page1', routeId: 'route-1' },
        { url: 'https://example.com/page2', routeId: 'route-2' },
        { url: 'https://example.com/page3', routeId: 'route-3' }
      ]);

      expect(added).toBe(3);
      expect(queue.length).toBe(3);
    });
  });

  describe('reprioritize', () => {
    it('should change priority of existing URL', () => {
      const queue = new CoverageQueue(TEST_DIR, 'test-audit');
      queue.enqueue('https://example.com/page1', 'route-1', { priority: 1 });
      queue.enqueue('https://example.com/page2', 'route-2', { priority: 5 });

      queue.reprioritize('https://example.com/page1', 10);

      const first = queue.peek();
      expect(first?.url).toBe('https://example.com/page1');
    });

    it('should return false for non-existent URL', () => {
      const queue = new CoverageQueue(TEST_DIR, 'test-audit');

      const result = queue.reprioritize('https://nonexistent.com', 10);

      expect(result).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return queue statistics', () => {
      const queue = new CoverageQueue(TEST_DIR, 'test-audit');
      queue.enqueue('https://example.com/page1', 'route-1');
      queue.enqueue('https://example.com/page2', 'route-2');
      queue.markVisited('https://example.com/visited');

      const stats = queue.getStats();

      expect(stats.total_discovered).toBeGreaterThan(0);
      expect(stats.total_visited).toBe(1);
      expect(stats.unique_routes).toBe(2);
    });
  });

  describe('save and load', () => {
    it('should persist state to disk', () => {
      const queue = new CoverageQueue(TEST_DIR, 'test-audit');
      queue.enqueue('https://example.com/page1', 'route-1');
      queue.markVisited('https://example.com/visited');

      queue.save();

      const filePath = path.join(TEST_DIR, 'coverage-queue.json');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should load state from disk via static method', () => {
      const queue1 = new CoverageQueue(TEST_DIR, 'test-audit');
      queue1.enqueue('https://example.com/page1', 'route-1');
      queue1.save();

      const queue2 = CoverageQueue.load(TEST_DIR);

      expect(queue2).not.toBeNull();
      expect(queue2?.length).toBe(1);
    });
  });

  describe('clear and reset', () => {
    it('should clear pending queue', () => {
      const queue = new CoverageQueue(TEST_DIR, 'test-audit');
      queue.enqueue('https://example.com/page1', 'route-1');
      queue.markVisited('https://example.com/visited');

      queue.clear();

      expect(queue.length).toBe(0);
      // Visited history preserved
      expect(queue.hasVisited('https://example.com/visited')).toBe(true);
    });

    it('should reset entire state', () => {
      const queue = new CoverageQueue(TEST_DIR, 'test-audit');
      queue.enqueue('https://example.com/page1', 'route-1');
      queue.markVisited('https://example.com/visited');

      queue.reset('new-audit');

      expect(queue.length).toBe(0);
      expect(queue.hasVisited('https://example.com/visited')).toBe(false);
    });
  });
});
