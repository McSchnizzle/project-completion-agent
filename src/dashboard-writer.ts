/**
 * Dashboard Writer - Generates the HTML dashboard from audit state.
 *
 * Reads progress.json and the findings directory, builds a DashboardData
 * object, then calls the existing `generateDashboardHtml()` to produce
 * the HTML file at `{auditDir}/dashboard/index.html`.
 *
 * @module dashboard-writer
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  generateDashboardHtml,
  type DashboardData,
} from '../skill/reporting/dashboard.js';
import {
  getProgressPath,
  getFindingDir,
  getDashboardDir,
  getDashboardPath,
} from './artifact-paths.js';

/**
 * Build DashboardData from current audit state on disk.
 */
export function buildDashboardData(auditDir: string): DashboardData {
  // Read progress.json
  const progressPath = getProgressPath(auditDir);
  let progress: any = {
    audit_id: 'unknown',
    status: 'unknown',
    started_at: new Date().toISOString(),
    stages: {},
    metrics: {
      pages_visited: 0,
      pages_total: 0,
      routes_covered: 0,
      routes_total: 0,
      findings_total: 0,
      findings_by_severity: { P0: 0, P1: 0, P2: 0, P3: 0, P4: 0 },
    },
  };

  if (fs.existsSync(progressPath)) {
    try {
      progress = JSON.parse(fs.readFileSync(progressPath, 'utf-8'));
    } catch {
      console.warn('[DashboardWriter] Failed to parse progress.json');
    }
  }

  // Read findings
  const findingDir = getFindingDir(auditDir);
  const findings: Array<{ id: string; severity: string; title: string; location: string }> = [];

  if (fs.existsSync(findingDir)) {
    const files = fs.readdirSync(findingDir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const finding = JSON.parse(
          fs.readFileSync(path.join(findingDir, file), 'utf-8'),
        );
        findings.push({
          id: finding.id || file.replace('.json', ''),
          severity: finding.severity || 'P3',
          title: finding.title || finding.description || 'Untitled finding',
          location: finding.location || finding.url || '',
        });
      } catch {
        /* skip unparseable files */
      }
    }
  }

  // Build stages map for dashboard
  const stages: Record<string, { status: string; progress: number; findings: number }> = {};
  if (progress.stages) {
    for (const [name, data] of Object.entries(progress.stages)) {
      const stageData = data as any;
      stages[name] = {
        status: stageData.status || 'pending',
        progress: stageData.progress_percent || 0,
        findings: stageData.findings_count || 0,
      };
    }
  }

  // Count findings by severity
  const severityCounts: Record<string, number> = { P0: 0, P1: 0, P2: 0, P3: 0, P4: 0 };
  for (const f of findings) {
    if (severityCounts[f.severity] !== undefined) {
      severityCounts[f.severity]++;
    }
  }

  const metrics = progress.metrics || {};

  return {
    audit_id: progress.audit_id || 'unknown',
    status: progress.status || 'unknown',
    started_at: progress.started_at || new Date().toISOString(),
    current_stage: progress.current_stage || null,
    stages,
    metrics: {
      pages_visited: metrics.pages_visited || 0,
      pages_total: metrics.pages_total || 0,
      routes_covered: metrics.routes_covered || 0,
      routes_total: metrics.routes_total || 0,
      findings_total: findings.length,
      findings_by_severity: severityCounts,
    },
    recent_findings: findings.slice(-10).reverse(),
  };
}

/**
 * Write the HTML dashboard to disk.
 *
 * @param auditDir - Path to the audit output directory.
 * @returns Path to the written dashboard file.
 */
export function writeDashboard(auditDir: string): string {
  const data = buildDashboardData(auditDir);
  const html = generateDashboardHtml(data);

  const dashDir = getDashboardDir(auditDir);
  fs.mkdirSync(dashDir, { recursive: true });

  const dashPath = getDashboardPath(auditDir);
  fs.writeFileSync(dashPath, html, 'utf-8');

  return dashPath;
}
