/**
 * Browser Exploration Unit Tests (T-023)
 * Tests route discovery, page validation, and browser session management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  initializeExplorationQueue,
  shouldVisitUrl,
  addLinksToQueue,
  generatePageInventory,
  generateCoverageSummary,
  writePageInventory,
  loadPageInventories,
  DEFAULT_EXPLORATION_CONFIG
} from '../../skill/phases/exploration';
import { RouteInfo } from '../../skill/phases/code-analysis';
import {
  canonicalizeUrl,
  isSameRoute,
  RouteRegistry,
  generateRouteId
} from '../../skill/utils/url-canonicalizer';

describe('Route Discovery and Canonicalization', () => {
  describe('canonicalizeUrl', () => {
    it('should normalize URLs with trailing slashes', () => {
      const result = canonicalizeUrl('https://example.com/path/');
      expect(result.canonical).toBe('https://example.com/path');
    });

    it('should extract route patterns from dynamic URLs', () => {
      const result = canonicalizeUrl('https://example.com/users/12345');
      expect(result.routePattern).toBe('/users/{userId}');
      expect(result.params.userId).toBe('12345');
    });

    it('should handle query parameters', () => {
      const result = canonicalizeUrl('https://example.com/search?q=test&page=2');
      expect(result.queryParams).toHaveProperty('q', 'test');
      expect(result.queryParams).toHaveProperty('page', '2');
    });

    it('should remove tracking parameters', () => {
      const result = canonicalizeUrl('https://example.com/page?utm_source=google&id=123');
      expect(result.queryParams).not.toHaveProperty('utm_source');
      expect(result.queryParams).toHaveProperty('id', '123');
    });

    it('should detect UUID patterns', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const result = canonicalizeUrl(`https://example.com/items/${uuid}`);
      expect(result.routePattern).toContain('{');
    });

    it('should normalize fragments', () => {
      const result = canonicalizeUrl('https://example.com/page#section');
      expect(result.hasFragment).toBe(true);
      expect(result.canonical).not.toContain('#');
    });
  });

  describe('isSameRoute', () => {
    it('should recognize same routes with different parameters', () => {
      const url1 = 'https://example.com/users/123';
      const url2 = 'https://example.com/users/456';
      expect(isSameRoute(url1, url2)).toBe(true);
    });

    it('should distinguish different routes', () => {
      const url1 = 'https://example.com/users/123';
      const url2 = 'https://example.com/posts/123';
      expect(isSameRoute(url1, url2)).toBe(false);
    });
  });

  describe('generateRouteId', () => {
    it('should generate consistent IDs for same route', () => {
      const id1 = generateRouteId('GET', '/users/{id}');
      const id2 = generateRouteId('GET', '/users/{id}');
      expect(id1).toBe(id2);
    });

    it('should generate different IDs for different methods', () => {
      const id1 = generateRouteId('GET', '/users');
      const id2 = generateRouteId('POST', '/users');
      expect(id1).not.toBe(id2);
    });
  });

  describe('RouteRegistry', () => {
    let registry: RouteRegistry;

    beforeEach(() => {
      registry = new RouteRegistry(3);
    });

    it('should register new routes', () => {
      const result = registry.register('https://example.com/users/123');
      expect(result.isNewRoute).toBe(true);
      expect(result.shouldVisit).toBe(true);
    });

    it('should detect duplicate routes', () => {
      registry.register('https://example.com/users/123');
      const result = registry.register('https://example.com/users/456');
      expect(result.isNewRoute).toBe(false);
    });

    it('should track visit counts', () => {
      registry.register('https://example.com/users/1');
      registry.register('https://example.com/users/2');
      const result = registry.register('https://example.com/users/3');
      expect(result.visitCount).toBe(3);
    });

    it('should limit samples per route', () => {
      registry.register('https://example.com/users/1');
      registry.register('https://example.com/users/2');
      registry.register('https://example.com/users/3');
      const result = registry.register('https://example.com/users/4');
      expect(result.shouldVisit).toBe(false);
    });
  });
});

describe('Exploration Queue Management', () => {
  describe('initializeExplorationQueue', () => {
    it('should prioritize entry URL first', () => {
      const routes: RouteInfo[] = [
        {
          path: '/about',
          method: 'GET',
          handler: 'about.tsx',
          source_file: '/app/about/page.tsx',
          line_number: 1,
          parameters: [],
          auth_required: false
        }
      ];

      const queue = initializeExplorationQueue(routes, 'https://example.com');
      expect(queue[0].url).toBe('https://example.com');
      expect(queue[0].priority).toBe(100);
    });

    it('should skip API routes', () => {
      const routes: RouteInfo[] = [
        {
          path: '/api/users',
          method: 'GET',
          handler: 'route.ts',
          source_file: '/app/api/users/route.ts',
          line_number: 1,
          parameters: [],
          auth_required: false
        }
      ];

      const queue = initializeExplorationQueue(routes, 'https://example.com');
      expect(queue.length).toBe(1); // Only entry URL
    });

    it('should handle dynamic route parameters', () => {
      const routes: RouteInfo[] = [
        {
          path: '/users/:id',
          method: 'GET',
          handler: 'page.tsx',
          source_file: '/app/users/[id]/page.tsx',
          line_number: 1,
          parameters: ['id'],
          auth_required: false
        }
      ];

      const queue = initializeExplorationQueue(routes, 'https://example.com');
      expect(queue.some(q => q.url.includes('test-id'))).toBe(true);
    });
  });

  describe('shouldVisitUrl', () => {
    const config = {
      ...DEFAULT_EXPLORATION_CONFIG,
      base_url: 'https://example.com'
    };

    it('should skip already visited URLs', () => {
      const visited = new Set(['https://example.com/about']);
      const result = shouldVisitUrl('https://example.com/about', visited, config);
      expect(result.should_visit).toBe(false);
      expect(result.reason).toContain('visited');
    });

    it('should skip excluded patterns', () => {
      const visited = new Set<string>();
      const result = shouldVisitUrl('https://example.com/logout', visited, config);
      expect(result.should_visit).toBe(false);
      expect(result.reason).toContain('excluded');
    });

    it('should skip different origins when same_origin_only', () => {
      const visited = new Set<string>();
      const result = shouldVisitUrl('https://other.com/page', visited, config);
      expect(result.should_visit).toBe(false);
    });

    it('should allow valid URLs', () => {
      const visited = new Set<string>();
      const result = shouldVisitUrl('https://example.com/about', visited, config);
      expect(result.should_visit).toBe(true);
    });
  });

  describe('addLinksToQueue', () => {
    it('should add new links to queue', () => {
      const queue: any[] = [];
      const visited = new Set<string>();
      const config = {
        ...DEFAULT_EXPLORATION_CONFIG,
        base_url: 'https://example.com',
        max_depth: 5
      };

      const links = [
        'https://example.com/about',
        'https://example.com/contact'
      ];

      const count = addLinksToQueue(links, 'https://example.com', 0, queue, visited, config);
      expect(count).toBe(2);
      expect(queue.length).toBe(2);
    });

    it('should skip duplicate links', () => {
      const queue: any[] = [];
      const visited = new Set(['https://example.com/about']);
      const config = {
        ...DEFAULT_EXPLORATION_CONFIG,
        base_url: 'https://example.com',
        max_depth: 5
      };

      const links = ['https://example.com/about'];
      const count = addLinksToQueue(links, 'https://example.com', 0, queue, visited, config);
      expect(count).toBe(0);
    });

    it('should respect depth limits', () => {
      const queue: any[] = [];
      const visited = new Set<string>();
      const config = {
        ...DEFAULT_EXPLORATION_CONFIG,
        base_url: 'https://example.com',
        max_depth: 1
      };

      const links = ['https://example.com/about'];
      const count = addLinksToQueue(links, 'https://example.com', 5, queue, visited, config);
      expect(count).toBe(0);
    });
  });
});

describe('Page Inventory Management', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-exploration-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('generatePageInventory', () => {
    it('should create valid page inventory', () => {
      const inventory = generatePageInventory(
        1,
        'https://example.com/about',
        'About Us',
        {
          links: [],
          buttons: [],
          forms: [],
          inputs: [],
          headings: []
        },
        1500
      );

      expect(inventory.schema_version).toBe('1.0.0');
      expect(inventory.page_number).toBe(1);
      expect(inventory.url).toBe('https://example.com/about');
      expect(inventory.performance.load_time_ms).toBe(1500);
    });
  });

  describe('writePageInventory and loadPageInventories', () => {
    it('should persist and load page inventories', () => {
      const inventory = generatePageInventory(
        1,
        'https://example.com/test',
        'Test Page',
        {
          links: [],
          buttons: [],
          forms: [],
          inputs: [],
          headings: []
        },
        1000
      );

      writePageInventory(tempDir, inventory);
      const loaded = loadPageInventories(tempDir);

      expect(loaded.length).toBe(1);
      expect(loaded[0].url).toBe('https://example.com/test');
    });
  });

  describe('generateCoverageSummary', () => {
    it('should calculate route coverage', () => {
      const visited = [
        {
          url: 'https://example.com/about',
          canonical_url: 'https://example.com/about',
          title: 'About',
          visited_at: new Date().toISOString(),
          load_time_ms: 1000,
          status: 'success' as const,
          error_message: null
        }
      ];

      const routes: RouteInfo[] = [
        {
          path: '/about',
          method: 'GET',
          handler: 'page.tsx',
          source_file: '/app/about/page.tsx',
          line_number: 1,
          parameters: [],
          auth_required: false
        },
        {
          path: '/contact',
          method: 'GET',
          handler: 'page.tsx',
          source_file: '/app/contact/page.tsx',
          line_number: 1,
          parameters: [],
          auth_required: false
        }
      ];

      const summary = generateCoverageSummary(visited, routes);
      expect(summary).toContain('**Pages Visited:** 1');
      expect(summary).toContain('**Known Routes:** 2');
    });
  });
});
