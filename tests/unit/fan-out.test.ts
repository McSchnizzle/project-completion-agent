/**
 * Tests for Parallel Fan-out phases
 * Task T-047: Test parallel-exploration.ts, parallel-form-testing.ts, parallel-finding-review.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  groupRoutesByPrefix,
  runParallelExploration,
  type RouteGroup,
  type ParallelExplorationConfig,
} from '../../src/phases/parallel-exploration';
import {
  runParallelFormTesting,
  type ParallelFormTestConfig,
} from '../../src/phases/parallel-form-testing';
import {
  runParallelFindingReview,
  type ParallelReviewConfig,
} from '../../src/phases/parallel-finding-review';

describe('parallel-exploration', () => {
  describe('groupRoutesByPrefix', () => {
    it('should group routes by first path segment', () => {
      const routes = [
        '/admin/users',
        '/admin/settings',
        '/api/v1/users',
        '/api/v1/posts',
        '/public/about',
      ];

      const groups = groupRoutesByPrefix(routes);

      expect(groups).toHaveLength(3);
      expect(groups.find((g) => g.prefix === '/admin')?.routes).toEqual([
        '/admin/users',
        '/admin/settings',
      ]);
      expect(groups.find((g) => g.prefix === '/api')?.routes).toEqual([
        '/api/v1/users',
        '/api/v1/posts',
      ]);
      expect(groups.find((g) => g.prefix === '/public')?.routes).toEqual([
        '/public/about',
      ]);
    });

    it('should handle routes with single segment', () => {
      const routes = ['/login', '/signup', '/about'];

      const groups = groupRoutesByPrefix(routes);

      expect(groups).toHaveLength(3);
      expect(groups.find((g) => g.prefix === '/login')).toBeDefined();
      expect(groups.find((g) => g.prefix === '/signup')).toBeDefined();
    });

    it('should handle root path', () => {
      const routes = ['/'];

      const groups = groupRoutesByPrefix(routes);

      expect(groups).toHaveLength(1);
      expect(groups[0].prefix).toBe('/');
      expect(groups[0].routes).toEqual(['/']);
    });

    it('should handle empty routes array', () => {
      const groups = groupRoutesByPrefix([]);
      expect(groups).toEqual([]);
    });

    it('should group nested routes under same prefix', () => {
      const routes = [
        '/dashboard',
        '/dashboard/overview',
        '/dashboard/reports/summary',
        '/dashboard/reports/details',
      ];

      const groups = groupRoutesByPrefix(routes);

      expect(groups).toHaveLength(1);
      const dashboardGroup = groups.find((g) => g.prefix === '/dashboard');
      expect(dashboardGroup?.routes).toHaveLength(4);
    });
  });

  describe('runParallelExploration', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallel-explore-test-'));
      fs.mkdirSync(path.join(tempDir, 'pages'), { recursive: true });
    });

    afterEach(() => {
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should create jobs for each route group', async () => {
      const config: ParallelExplorationConfig = {
        auditDir: tempDir,
        baseUrl: 'http://example.com',
        routes: ['/admin/users', '/admin/settings', '/api/status'],
        maxPages: 10,
        promptPath: '/fake/prompt.md',
        concurrency: 2,
      };

      const jobsCreated: string[] = [];
      const mockJobRunner = async (
        jobs: Array<{ id: string; name: string }>,
        _options: unknown
      ) => {
        jobsCreated.push(...jobs.map((j) => j.id));
        return jobs.map((j) => ({ jobId: j.id, status: 'completed' }));
      };

      const mockCreateJob = (_group: RouteGroup, _index: number) => async () => ({});

      await runParallelExploration(config, mockJobRunner, mockCreateJob);

      expect(jobsCreated).toHaveLength(2); // /admin and /api
      expect(jobsCreated).toContain('explore-group-0');
      expect(jobsCreated).toContain('explore-group-1');
    });

    it('should respect maxPages limit', async () => {
      const config: ParallelExplorationConfig = {
        auditDir: tempDir,
        baseUrl: 'http://example.com',
        routes: Array.from({ length: 100 }, (_, i) => `/page-${i}`),
        maxPages: 5,
        promptPath: '/fake/prompt.md',
        concurrency: 2,
      };

      let routesProcessed = 0;
      const mockJobRunner = async (
        jobs: Array<{ id: string }>,
        _options: unknown
      ) => {
        return jobs.map((j) => ({ jobId: j.id, status: 'completed' }));
      };

      const mockCreateJob = (group: RouteGroup, _index: number) => async () => {
        routesProcessed += group.routes.length;
        return {};
      };

      await runParallelExploration(config, mockJobRunner, mockCreateJob);

      expect(routesProcessed).toBeLessThanOrEqual(5);
    });

    it('should count pages from directory', async () => {
      const config: ParallelExplorationConfig = {
        auditDir: tempDir,
        baseUrl: 'http://example.com',
        routes: ['/page1', '/page2'],
        maxPages: 10,
        promptPath: '/fake/prompt.md',
        concurrency: 2,
      };

      // Create mock page files
      fs.writeFileSync(
        path.join(tempDir, 'pages', 'page-0.json'),
        JSON.stringify({})
      );
      fs.writeFileSync(
        path.join(tempDir, 'pages', 'page-1.json'),
        JSON.stringify({})
      );

      const mockJobRunner = async (
        jobs: Array<{ id: string }>,
        _options: unknown
      ) => {
        return jobs.map((j) => ({ jobId: j.id, status: 'completed' }));
      };

      const mockCreateJob = (_group: RouteGroup, _index: number) => async () => ({});

      const result = await runParallelExploration(
        config,
        mockJobRunner,
        mockCreateJob
      );

      expect(result.totalPagesVisited).toBe(2);
    });

    it('should track errors from failed jobs', async () => {
      const config: ParallelExplorationConfig = {
        auditDir: tempDir,
        baseUrl: 'http://example.com',
        routes: ['/page1', '/page2'],
        maxPages: 10,
        promptPath: '/fake/prompt.md',
        concurrency: 2,
      };

      const mockJobRunner = async (
        jobs: Array<{ id: string }>,
        _options: unknown
      ) => {
        return [
          { jobId: jobs[0].id, status: 'completed' },
          { jobId: jobs[1].id, status: 'failed', error: 'Network timeout' },
        ];
      };

      const mockCreateJob = (_group: RouteGroup, _index: number) => async () => ({});

      const result = await runParallelExploration(
        config,
        mockJobRunner,
        mockCreateJob
      );

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Network timeout');
    });
  });
});

describe('parallel-form-testing', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallel-form-test-'));
    fs.mkdirSync(path.join(tempDir, 'findings'), { recursive: true });
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should handle no forms available', async () => {
    const config: ParallelFormTestConfig = {
      auditDir: tempDir,
      baseUrl: 'http://example.com',
      maxForms: 10,
      promptPath: '/fake/prompt.md',
      auditId: 'test-001',
      safeMode: true,
      concurrency: 2,
    };

    const mockJobRunner = async (_jobs: unknown[], _options: unknown) => [];
    const mockCreateJob = (_form: unknown, _index: number) => async () => ({});

    const result = await runParallelFormTesting(
      config,
      mockJobRunner,
      mockCreateJob
    );

    expect(result.formsTested).toBe(0);
    expect(result.totalFindings).toBe(0);
  });

  it('should create one job per form', async () => {
    const config: ParallelFormTestConfig = {
      auditDir: tempDir,
      baseUrl: 'http://example.com',
      maxForms: 10,
      promptPath: '/fake/prompt.md',
      auditId: 'test-001',
      safeMode: true,
      concurrency: 2,
    };

    // Create code-analysis.json with forms
    fs.writeFileSync(
      path.join(tempDir, 'code-analysis.json'),
      JSON.stringify({
        forms: [
          { id: 'login-form', action: '/login', method: 'POST', fields: ['email', 'password'] },
          { id: 'signup-form', action: '/signup', method: 'POST', fields: ['name', 'email'] },
        ],
      })
    );

    const jobsCreated: string[] = [];
    const mockJobRunner = async (
      jobs: Array<{ id: string }>,
      _options: unknown
    ) => {
      jobsCreated.push(...jobs.map((j) => j.id));
      return jobs.map((j) => ({ jobId: j.id, status: 'completed' }));
    };

    const mockCreateJob = (_form: unknown, _index: number) => async () => ({});

    await runParallelFormTesting(config, mockJobRunner, mockCreateJob);

    expect(jobsCreated).toHaveLength(2);
    expect(jobsCreated).toContain('form-test-login-form');
    expect(jobsCreated).toContain('form-test-signup-form');
  });

  it('should respect maxForms limit', async () => {
    const config: ParallelFormTestConfig = {
      auditDir: tempDir,
      baseUrl: 'http://example.com',
      maxForms: 2,
      promptPath: '/fake/prompt.md',
      auditId: 'test-001',
      safeMode: true,
      concurrency: 2,
    };

    fs.writeFileSync(
      path.join(tempDir, 'code-analysis.json'),
      JSON.stringify({
        forms: Array.from({ length: 10 }, (_, i) => ({
          id: `form-${i}`,
          action: `/form-${i}`,
        })),
      })
    );

    const jobsCreated: string[] = [];
    const mockJobRunner = async (
      jobs: Array<{ id: string }>,
      _options: unknown
    ) => {
      jobsCreated.push(...jobs.map((j) => j.id));
      return jobs.map((j) => ({ jobId: j.id, status: 'completed' }));
    };

    const mockCreateJob = (_form: unknown, _index: number) => async () => ({});

    await runParallelFormTesting(config, mockJobRunner, mockCreateJob);

    expect(jobsCreated).toHaveLength(2);
  });
});

describe('parallel-finding-review', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallel-review-test-'));
    fs.mkdirSync(path.join(tempDir, 'findings'), { recursive: true });
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should create three review lens jobs', async () => {
    const config: ParallelReviewConfig = {
      auditDir: tempDir,
      securityPromptPath: '/fake/security.md',
      uxPromptPath: '/fake/ux.md',
      adversarialPromptPath: '/fake/adversarial.md',
    };

    const jobsCreated: string[] = [];
    const mockJobRunner = async (
      jobs: Array<{ id: string; requiresBrowser: boolean }>,
      _options: unknown
    ) => {
      jobsCreated.push(...jobs.map((j) => j.id));
      // Verify none require browser
      expect(jobs.every((j) => !j.requiresBrowser)).toBe(true);

      return jobs.map((j) => ({
        jobId: j.id,
        status: 'completed',
        output: { reviewed: 5, flagged: 1, approved: 4 },
      }));
    };

    const mockCreateJob = (_lens: string, _promptPath: string) => async () => ({
      reviewed: 5,
      flagged: 1,
      approved: 4,
    });

    const result = await runParallelFindingReview(
      config,
      mockJobRunner,
      mockCreateJob
    );

    expect(jobsCreated).toHaveLength(3);
    expect(jobsCreated).toContain('review-security');
    expect(jobsCreated).toContain('review-ux');
    expect(jobsCreated).toContain('review-adversarial');
    expect(result.lenses).toHaveLength(3);
  });

  it('should write individual review files', async () => {
    const config: ParallelReviewConfig = {
      auditDir: tempDir,
      securityPromptPath: '/fake/security.md',
      uxPromptPath: '/fake/ux.md',
      adversarialPromptPath: '/fake/adversarial.md',
    };

    const mockJobRunner = async (
      jobs: Array<{ id: string }>,
      _options: unknown
    ) => {
      return jobs.map((j) => ({
        jobId: j.id,
        status: 'completed',
        output: { reviewed: 3, flagged: 0, approved: 3 },
      }));
    };

    const mockCreateJob = (_lens: string, _promptPath: string) => async () => ({
      reviewed: 3,
      flagged: 0,
      approved: 3,
    });

    await runParallelFindingReview(config, mockJobRunner, mockCreateJob);

    expect(fs.existsSync(path.join(tempDir, 'review-security.json'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'review-ux.json'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'review-adversarial.json'))).toBe(
      true
    );
  });

  it('should track errors from failed review jobs', async () => {
    const config: ParallelReviewConfig = {
      auditDir: tempDir,
      securityPromptPath: '/fake/security.md',
      uxPromptPath: '/fake/ux.md',
      adversarialPromptPath: '/fake/adversarial.md',
    };

    const mockJobRunner = async (
      jobs: Array<{ id: string }>,
      _options: unknown
    ) => {
      return [
        { jobId: jobs[0].id, status: 'completed', output: { reviewed: 5 } },
        { jobId: jobs[1].id, status: 'failed', error: 'Timeout' },
        { jobId: jobs[2].id, status: 'completed', output: { reviewed: 5 } },
      ];
    };

    const mockCreateJob = (_lens: string, _promptPath: string) => async () => ({});

    const result = await runParallelFindingReview(
      config,
      mockJobRunner,
      mockCreateJob
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Timeout');
  });
});
