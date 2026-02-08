/**
 * Tests for src/dashboard-server.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { startDashboardServer, type DashboardServer } from '../../src/reporting/dashboard-server';

const TEST_DIR = `/tmp/test-dashboard-${Date.now()}`;
const AUDIT_DIR = path.join(TEST_DIR, '.complete-agent', 'audits', 'current');

describe('DashboardServer', () => {
  let server: DashboardServer | null = null;

  beforeEach(() => {
    fs.mkdirSync(path.join(AUDIT_DIR, 'findings'), { recursive: true });
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should start and serve the dashboard HTML', async () => {
    server = await startDashboardServer({
      auditDir: AUDIT_DIR,
      startPort: 18000,
    });

    expect(server.port).toBeGreaterThanOrEqual(18000);
    expect(server.url).toContain('http://localhost:');

    const res = await fetch(server.url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');

    const html = await res.text();
    expect(html).toContain('Audit Dashboard');
    expect(html).toContain('/api/progress');
  });

  it('should serve progress API', async () => {
    // Write a progress.json
    fs.writeFileSync(
      path.join(AUDIT_DIR, 'progress.json'),
      JSON.stringify({
        audit_id: 'test-123',
        status: 'running',
        stages: { preflight: { status: 'completed', progress_percent: 100 } },
        metrics: { pages_visited: 3, pages_total: 10 },
      }),
      'utf-8',
    );

    server = await startDashboardServer({
      auditDir: AUDIT_DIR,
      startPort: 18010,
    });

    const res = await fetch(`${server.url}/api/progress`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.audit_id).toBe('test-123');
    expect(data.status).toBe('running');
    expect(data.metrics.pages_visited).toBe(3);
  });

  it('should serve actions API from JSONL log', async () => {
    // Write some log entries
    const logPath = path.join(AUDIT_DIR, 'audit-log.jsonl');
    const entries = [
      { timestamp: '2026-02-08T10:00:00Z', action_type: 'audit_start' },
      { timestamp: '2026-02-08T10:00:01Z', action_type: 'phase_start', phase: 'preflight' },
    ];
    fs.writeFileSync(
      logPath,
      entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
      'utf-8',
    );

    server = await startDashboardServer({
      auditDir: AUDIT_DIR,
      startPort: 18020,
    });

    const res = await fetch(`${server.url}/api/actions`);
    const data = await res.json();

    // Most recent first
    expect(data.length).toBe(2);
    expect(data[0].action_type).toBe('phase_start');
    expect(data[1].action_type).toBe('audit_start');
  });

  it('should serve findings API', async () => {
    // Write a finding file
    const findingDir = path.join(AUDIT_DIR, 'findings');
    fs.writeFileSync(
      path.join(findingDir, 'F-001.json'),
      JSON.stringify({
        id: 'F-001',
        severity: 'P1',
        title: 'Missing CSRF protection',
        location: '/api/submit',
      }),
      'utf-8',
    );

    server = await startDashboardServer({
      auditDir: AUDIT_DIR,
      startPort: 18030,
    });

    const res = await fetch(`${server.url}/api/findings`);
    const data = await res.json();

    expect(data.length).toBe(1);
    expect(data[0].id).toBe('F-001');
    expect(data[0].severity).toBe('P1');
  });

  it('should return defaults when no state files exist', async () => {
    server = await startDashboardServer({
      auditDir: AUDIT_DIR,
      startPort: 18040,
    });

    const progRes = await fetch(`${server.url}/api/progress`);
    const progData = await progRes.json();
    expect(progData.status).toBe('initializing');

    const actRes = await fetch(`${server.url}/api/actions`);
    const actData = await actRes.json();
    expect(actData).toEqual([]);

    const findRes = await fetch(`${server.url}/api/findings`);
    const findData = await findRes.json();
    expect(findData).toEqual([]);
  });

  it('should auto-select next port if preferred is busy', async () => {
    // Start first server on a specific port
    server = await startDashboardServer({
      auditDir: AUDIT_DIR,
      startPort: 18050,
    });
    const firstPort = server.port;
    expect(firstPort).toBe(18050);

    // Start second server - should get a different port since 18050 is taken
    const server2 = await startDashboardServer({
      auditDir: AUDIT_DIR,
      startPort: 18050,
    });

    // The second server should get a port >= 18050
    // (could be same port on different address, or next port)
    expect(server2.port).toBeGreaterThanOrEqual(18050);

    // Both servers should be independently reachable
    const [res1, res2] = await Promise.all([
      fetch(`http://localhost:${firstPort}`),
      fetch(`http://localhost:${server2.port}`),
    ]);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    await server2.close();
  });

  it('should cleanly shut down', async () => {
    server = await startDashboardServer({
      auditDir: AUDIT_DIR,
      startPort: 18060,
    });

    const url = server.url;
    await server.close();
    server = null;

    // Server should no longer accept connections
    try {
      await fetch(url);
      expect.fail('Should have thrown');
    } catch {
      // Expected - connection refused
    }
  });
});
