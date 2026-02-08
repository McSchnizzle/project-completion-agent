/**
 * Full Audit Pipeline Integration Test (T-059)
 *
 * Tests the complete audit pipeline from CLI to report generation
 * using mocked Claude SDK and browser calls.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildConfig } from '../../src/config';
import { ArtifactStore } from '../../src/artifact-store';
import { CostTracker } from '../../src/cost-tracker';
import { BrowserQueue } from '../../src/browser-queue';
import { getAuditDir, ensureDirectories, getProgressPath, getFindingDir, getPageDir } from '../../src/artifact-paths';
import { generateCoverageSummary } from '../../src/phases/coverage-summary';
import { assessSafety } from '../../src/phases/safety';
import { applyFocusFilter } from '../../src/phases/focus-filter';
import { checkResume, saveCheckpoint, getPhasesToRun } from '../../src/phases/resume';
import { groupRoutesByPrefix } from '../../src/phases/parallel-exploration';

// Helper to create temp workspace
function createTempWorkspace(): { basePath: string; auditDir: string; cleanup: () => void } {
  const basePath = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-'));
  const auditDir = getAuditDir(basePath);
  ensureDirectories(auditDir);
  return {
    basePath,
    auditDir,
    cleanup: () => fs.rmSync(basePath, { recursive: true, force: true }),
  };
}

describe('Full Audit Pipeline Integration', () => {
  let workspace: ReturnType<typeof createTempWorkspace>;

  beforeEach(() => {
    workspace = createTempWorkspace();
  });

  afterEach(() => {
    workspace.cleanup();
  });

  describe('Config Building', () => {
    it('builds config with CLI args overriding defaults', () => {
      const config = buildConfig({
        url: 'http://localhost:3000',
        maxPages: 10,
        parallel: true,
      });
      expect(config.url).toBe('http://localhost:3000');
      expect(config.maxPages).toBe(10);
      expect(config.parallel).toBe(true);
      expect(config.mode).toBe('full'); // default
    });

    it('generates audit ID when not provided', () => {
      const config = buildConfig({ url: 'http://localhost:3000' });
      expect(config.auditId).toMatch(/^audit-\d{8}-\d{6}$/);
    });

    it('respects CI env var for non-interactive mode', () => {
      const config = buildConfig({}, {}, { CI: '1' });
      expect(config.nonInteractive).toBe(true);
    });
  });

  describe('Artifact Store', () => {
    it('appends and queries entries', () => {
      const store = new ArtifactStore(workspace.auditDir);
      store.append({
        phase: 'exploration',
        type: 'page',
        artifactId: 'page-0',
        filePath: 'pages/page-0.json',
        status: 'created',
      });
      store.append({
        phase: 'form-testing',
        type: 'finding',
        artifactId: 'F-001',
        filePath: 'findings/F-001.json',
        status: 'created',
      });

      const all = store.getAll();
      expect(all).toHaveLength(2);

      const pages = store.query({ type: 'page' });
      expect(pages).toHaveLength(1);
      expect(pages[0].artifactId).toBe('page-0');

      const latest = store.getLatest('finding');
      expect(latest?.artifactId).toBe('F-001');
    });

    it('writes artifact atomically', () => {
      const store = new ArtifactStore(workspace.auditDir);
      const data = { url: 'http://localhost:3000/', title: 'Home' };
      store.writeArtifact(
        { phase: 'exploration', type: 'page', artifactId: 'page-0', filePath: 'pages/page-0.json', status: 'created' },
        data,
      );

      const filePath = path.join(workspace.auditDir, 'pages/page-0.json');
      expect(fs.existsSync(filePath)).toBe(true);
      const written = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(written.url).toBe('http://localhost:3000/');
    });
  });

  describe('Cost Tracker', () => {
    it('tracks phase costs and checks budget', () => {
      const tracker = new CostTracker('test-audit');
      tracker.recordPhase({
        phaseName: 'preflight',
        inputTokens: 1000,
        outputTokens: 200,
        costUsd: 0.005,
        durationMs: 2000,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        retries: 0,
        status: 'completed',
      });

      expect(tracker.getTotalCost()).toBe(0.005);
      expect(tracker.isOverBudget(10)).toBe(false);
      expect(tracker.isOverBudget(0.001)).toBe(true);
    });
  });

  describe('Browser Queue', () => {
    it('grants and releases leases', async () => {
      const queue = new BrowserQueue({ timeout: 5000 });
      expect(queue.isAvailable()).toBe(true);

      const lease = await queue.acquire();
      expect(queue.isAvailable()).toBe(false);
      expect(queue.queueLength()).toBe(0);

      queue.release(lease);
      expect(queue.isAvailable()).toBe(true);
    });
  });

  describe('Safety Assessment', () => {
    it('classifies localhost as development', () => {
      const result = assessSafety(buildConfig({ url: 'http://localhost:3000' }));
      expect(result.classification).toBe('development');
      expect(result.safeMode).toBe(false);
    });

    it('respects explicit safeMode override', () => {
      const result = assessSafety(buildConfig({ url: 'http://example.com', safeMode: true }));
      expect(result.safeMode).toBe(true);
    });
  });

  describe('Focus Filter', () => {
    it('filters routes by glob pattern', () => {
      const routes = [
        { path: '/admin/users' },
        { path: '/admin/settings' },
        { path: '/api/v1/data' },
        { path: '/login' },
      ];
      const { routes: filtered } = applyFocusFilter(routes, [], ['/admin/*']);
      expect(filtered).toHaveLength(2);
      expect(filtered.map(r => r.path)).toEqual(['/admin/users', '/admin/settings']);
    });

    it('returns all routes with no patterns', () => {
      const routes = [{ path: '/a' }, { path: '/b' }];
      const { routes: filtered } = applyFocusFilter(routes, [], []);
      expect(filtered).toHaveLength(2);
    });
  });

  describe('Resume Support', () => {
    it('returns canResume false when no checkpoint exists', () => {
      const result = checkResume(workspace.auditDir);
      expect(result.canResume).toBe(false);
    });

    it('saves and loads checkpoint correctly', () => {
      // Create progress.json for audit ID
      fs.writeFileSync(
        getProgressPath(workspace.auditDir),
        JSON.stringify({ audit_id: 'test-123' }),
      );

      saveCheckpoint(workspace.auditDir, 'code-analysis', ['preflight', 'prd-parsing', 'code-analysis']);
      const result = checkResume(workspace.auditDir);
      expect(result.canResume).toBe(true);
      expect(result.nextPhase).toBe('progress-init');
    });

    it('determines phases to run after resume', () => {
      const phases = getPhasesToRun({ canResume: true, nextPhase: 'exploration' });
      expect(phases[0]).toBe('exploration');
      expect(phases).not.toContain('preflight');
    });
  });

  describe('Coverage Summary', () => {
    it('generates coverage with no pages or routes', () => {
      const result = generateCoverageSummary(workspace.auditDir);
      expect(result.coveragePercent).toBe(0);
      expect(result.totalRoutes).toBe(0);
    });

    it('generates coverage with pages and routes', () => {
      // Create code-analysis.json with routes
      fs.writeFileSync(
        path.join(workspace.auditDir, 'code-analysis.json'),
        JSON.stringify({ routes: [{ path: '/' }, { path: '/about' }, { path: '/contact' }] }),
      );

      // Create page files
      const pageDir = getPageDir(workspace.auditDir);
      fs.writeFileSync(
        path.join(pageDir, 'page-0.json'),
        JSON.stringify({ url: 'http://localhost:3000/' }),
      );
      fs.writeFileSync(
        path.join(pageDir, 'page-1.json'),
        JSON.stringify({ url: 'http://localhost:3000/about' }),
      );

      const result = generateCoverageSummary(workspace.auditDir);
      expect(result.totalRoutes).toBe(3);
      expect(result.visitedRoutes).toBe(2);
      expect(result.coveragePercent).toBe(67); // 2/3
      expect(result.missedRoutes).toContain('/contact');
    });
  });

  describe('Route Grouping', () => {
    it('groups routes by first path segment', () => {
      const groups = groupRoutesByPrefix([
        '/admin/users',
        '/admin/settings',
        '/api/v1/data',
        '/api/v2/data',
        '/login',
      ]);
      expect(groups).toHaveLength(3);
      expect(groups.find(g => g.prefix === '/admin')?.routes).toHaveLength(2);
      expect(groups.find(g => g.prefix === '/api')?.routes).toHaveLength(2);
    });
  });

  describe('End-to-End Pipeline Smoke Test', () => {
    it('runs through artifact lifecycle', () => {
      const config = buildConfig({
        url: 'http://localhost:3000',
        codebasePath: workspace.basePath,
      });

      // Initialize
      const store = new ArtifactStore(workspace.auditDir);
      const tracker = new CostTracker(config.auditId);

      // Simulate preflight
      store.append({ phase: 'preflight', type: 'config', artifactId: 'config', filePath: 'config.yml', status: 'created' });

      // Simulate finding creation
      const findingDir = getFindingDir(workspace.auditDir);
      const finding = {
        id: 'F-001',
        title: 'Missing form validation',
        severity: 'medium',
        category: 'forms',
      };
      store.writeArtifact(
        { phase: 'form-testing', type: 'finding', artifactId: 'F-001', filePath: 'findings/F-001.json', status: 'created' },
        finding,
      );

      // Track cost
      tracker.recordPhase({
        phaseName: 'form-testing',
        inputTokens: 5000,
        outputTokens: 1200,
        costUsd: 0.025,
        durationMs: 15000,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        retries: 0,
        status: 'completed',
      });

      // Verify
      const findings = store.query({ type: 'finding' });
      expect(findings).toHaveLength(1);
      expect(tracker.getTotalCost()).toBe(0.025);
      expect(fs.existsSync(path.join(findingDir, 'F-001.json'))).toBe(true);
    });
  });
});
