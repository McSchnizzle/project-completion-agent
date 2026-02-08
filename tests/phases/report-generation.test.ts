/**
 * Report Generation Phase tests.
 *
 * Tests the template-driven report generation against synthetic data,
 * verifying feature coverage rendering, target URL fallback, P4 separation,
 * completion score, and methodology section.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { generateReport } from '../../src/phases/report-generation';

const TEST_DIR = '/tmp/test-report-gen-' + Date.now();
const AUDIT_DIR = path.join(TEST_DIR, '.complete-agent', 'audits', 'current');

function writeJSON(filePath: string, data: unknown) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function setupProgress(overrides: Record<string, unknown> = {}) {
  writeJSON(path.join(AUDIT_DIR, 'progress.json'), {
    audit_id: 'test-001',
    started_at: '2026-02-08T10:00:00Z',
    completed_at: '2026-02-08T11:00:00Z',
    target_url: 'https://example.com',
    coverage: { pages_visited: 5, forms_tested: 2, features_checked: 3 },
    ...overrides,
  });
}

function setupPrdSummary(features = defaultFeatures()) {
  writeJSON(path.join(AUDIT_DIR, 'prd-summary.json'), {
    features,
    summary: {
      total_features: features.length,
      p0_count: features.filter((f: { priority: string }) => f.priority === 'must-have').length,
      p1_count: features.filter((f: { priority: string }) => f.priority === 'should-have').length,
      p2_count: features.filter((f: { priority: string }) => f.priority === 'could-have').length,
    },
  });
}

function defaultFeatures() {
  return [
    { id: 'F-001', name: 'User Registration', priority: 'must-have' },
    { id: 'F-002', name: 'Login Flow', priority: 'must-have' },
    { id: 'F-003', name: 'Dashboard', priority: 'should-have' },
    { id: 'F-004', name: 'Settings', priority: 'could-have' },
  ];
}

function setupFindings(findings: Array<Record<string, unknown>>) {
  const findingsDir = path.join(AUDIT_DIR, 'findings');
  fs.mkdirSync(findingsDir, { recursive: true });
  for (const f of findings) {
    writeJSON(path.join(findingsDir, `${f.id}.json`), f);
  }
}

function setupPages(pages: Array<Record<string, unknown>>) {
  const pagesDir = path.join(AUDIT_DIR, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  for (let i = 0; i < pages.length; i++) {
    writeJSON(path.join(pagesDir, `page-${i}.json`), { page_number: i, ...pages[i] });
  }
}

function setupFeatureCoverage(coverage: Array<Record<string, unknown>>) {
  writeJSON(path.join(AUDIT_DIR, 'feature-coverage.json'), coverage);
}

describe('Report Generation Phase', () => {
  beforeEach(() => {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('target URL fallback', () => {
    it('should use progress.target_url when available', () => {
      setupProgress({ target_url: 'https://myapp.com' });
      setupPages([{ url: 'https://myapp.com/home', title: 'Home' }]);

      const report = generateReport(AUDIT_DIR);
      expect(report).toContain('**Target URL:** https://myapp.com');
    });

    it('should fall back to first page origin when target_url is undefined', () => {
      setupProgress({ target_url: undefined });
      setupPages([
        { url: 'https://fallback.example.com/login', title: 'Login' },
        { url: 'https://fallback.example.com/dashboard', title: 'Dashboard' },
      ]);

      const report = generateReport(AUDIT_DIR);
      expect(report).toContain('**Target URL:** https://fallback.example.com');
    });

    it('should fall back to first page origin when target_url is "undefined" string', () => {
      setupProgress({ target_url: 'undefined' });
      setupPages([{ url: 'https://str-fallback.example.com/page', title: 'Page' }]);

      const report = generateReport(AUDIT_DIR);
      expect(report).toContain('**Target URL:** https://str-fallback.example.com');
    });

    it('should show "unknown" when no pages and no target_url', () => {
      setupProgress({ target_url: undefined });

      const report = generateReport(AUDIT_DIR);
      expect(report).toContain('**Target URL:** unknown');
    });
  });

  describe('feature coverage from feature-coverage.json', () => {
    it('should show actual pass/fail/partial statuses from feature-coverage.json', () => {
      setupProgress();
      setupPrdSummary();
      setupPages([{ url: 'https://example.com/home', title: 'Home' }]);
      setupFeatureCoverage([
        {
          featureId: 'F-001',
          featureName: 'User Registration',
          priority: 'must-have',
          status: 'pass',
          checkedCriteria: [
            { criterion: 'Form submits', status: 'pass', evidence: 'Form submitted OK' },
          ],
        },
        {
          featureId: 'F-002',
          featureName: 'Login Flow',
          priority: 'must-have',
          status: 'fail',
          checkedCriteria: [
            { criterion: 'Login works', status: 'fail', evidence: 'Login button missing' },
          ],
        },
        {
          featureId: 'F-003',
          featureName: 'Dashboard',
          priority: 'should-have',
          status: 'partial',
          checkedCriteria: [
            { criterion: 'Stats load', status: 'pass', evidence: 'Stats visible' },
            { criterion: 'Charts render', status: 'fail', evidence: 'Chart area blank' },
          ],
        },
      ]);

      const report = generateReport(AUDIT_DIR);

      expect(report).toContain('| PASS | F-001');
      expect(report).toContain('| FAIL | F-002');
      expect(report).toContain('| PARTIAL | F-003');
      // Should have Evidence column
      expect(report).toContain('| Evidence |');
      expect(report).toContain('Form submitted OK');
    });

    it('should fall back gracefully when feature-coverage.json does not exist', () => {
      setupProgress();
      setupPrdSummary();
      setupPages([{ url: 'https://example.com/home', title: 'Home' }]);
      // No setupFeatureCoverage()

      const report = generateReport(AUDIT_DIR);

      // Should still show feature table with Not Checked
      expect(report).toContain('F-001');
      expect(report).toContain('Not Checked');
      // Should not have Evidence column (old format)
      expect(report).not.toContain('| Evidence |');
    });
  });

  describe('P4 informational separation', () => {
    it('should put P4 findings in Informational Notes section', () => {
      setupProgress();
      setupPages([{ url: 'https://example.com/home', title: 'Home' }]);
      setupFindings([
        { id: 'F-001', title: 'Critical Bug', severity: 'P0', category: 'functionality' },
        { id: 'F-002', title: 'Minor Issue', severity: 'P2', category: 'ui' },
        { id: 'F-003', title: 'Suggestion', severity: 'P4', category: 'enhancement' },
        { id: 'F-004', title: 'Observation', severity: 'P4', category: 'general' },
      ]);

      const report = generateReport(AUDIT_DIR);

      // P4 should NOT be in Findings section
      expect(report).toContain('## Findings');
      expect(report).toContain('## Informational Notes');

      // Split by Informational Notes to check each section
      const [findingsSection, infoSection] = report.split('## Informational Notes');

      // Real findings in Findings section
      expect(findingsSection).toContain('F-001');
      expect(findingsSection).toContain('Critical Bug');
      expect(findingsSection).toContain('F-002');

      // P4 in Informational Notes
      expect(infoSection).toContain('F-003');
      expect(infoSection).toContain('F-004');
      expect(infoSection).toContain('Suggestion');
      expect(infoSection).toContain('Observation');
      expect(infoSection).toContain('not actionable defects');
    });

    it('should not show Informational Notes when no P4 findings', () => {
      setupProgress();
      setupPages([{ url: 'https://example.com/home', title: 'Home' }]);
      setupFindings([
        { id: 'F-001', title: 'Real Bug', severity: 'P1', category: 'functionality' },
      ]);

      const report = generateReport(AUDIT_DIR);
      expect(report).not.toContain('## Informational Notes');
    });
  });

  describe('completion score', () => {
    it('should calculate completion score correctly', () => {
      setupProgress();
      setupPrdSummary();
      setupPages([{ url: 'https://example.com/home', title: 'Home' }]);
      setupFeatureCoverage([
        { featureId: 'F-001', featureName: 'Registration', priority: 'must-have', status: 'pass', checkedCriteria: [] },
        { featureId: 'F-002', featureName: 'Login', priority: 'must-have', status: 'fail', checkedCriteria: [] },
        { featureId: 'F-003', featureName: 'Dashboard', priority: 'should-have', status: 'pass', checkedCriteria: [] },
        { featureId: 'F-004', featureName: 'Settings', priority: 'could-have', status: 'not_checked', checkedCriteria: [] },
      ]);

      const report = generateReport(AUDIT_DIR);

      expect(report).toContain('### Completion Score');
      expect(report).toContain('1/2 must-have features passing (50%)');
      expect(report).toContain('Must-have: 1/2 passing');
      expect(report).toContain('Should-have: 1/1 passing');
      expect(report).toContain('Could-have: 0/1 passing');
    });

    it('should not show completion score when no feature-coverage.json', () => {
      setupProgress();
      setupPrdSummary();
      setupPages([{ url: 'https://example.com/home', title: 'Home' }]);

      const report = generateReport(AUDIT_DIR);
      expect(report).not.toContain('### Completion Score');
    });
  });

  describe('methodology section', () => {
    it('should include methodology section', () => {
      setupProgress();
      setupPages([
        { url: 'https://example.com/a', title: 'A' },
        { url: 'https://example.com/b', title: 'B' },
      ]);

      const report = generateReport(AUDIT_DIR);

      expect(report).toContain('## Methodology');
      expect(report).toContain('Playwright (headless Chromium)');
      expect(report).toContain('**Pages Visited**: 2');
      expect(report).toContain('Claude API (Anthropic)');
      expect(report).toContain('**Phases Completed**: 14/14');
    });

    it('should show auth strategy from config', () => {
      setupProgress();
      setupPages([{ url: 'https://example.com/a', title: 'A' }]);
      // Write a config.yml with auth_strategy
      const configPath = path.join(AUDIT_DIR, 'config.yml');
      fs.writeFileSync(configPath, 'auth_strategy: form-login\nbase_url: https://example.com\n');

      const report = generateReport(AUDIT_DIR);
      expect(report).toContain('**Authentication**: form-login');
    });

    it('should show "in progress" when audit not completed', () => {
      setupProgress({ completed_at: undefined });
      setupPages([{ url: 'https://example.com/a', title: 'A' }]);

      const report = generateReport(AUDIT_DIR);
      expect(report).toContain('**Phases Completed**: in progress');
    });
  });

  describe('executive summary with P4 separation', () => {
    it('should report real findings count separately from informational', () => {
      setupProgress();
      setupPages([{ url: 'https://example.com/home', title: 'Home' }]);
      setupFindings([
        { id: 'F-001', title: 'Bug', severity: 'P1', category: 'functionality' },
        { id: 'F-002', title: 'Issue', severity: 'P2', category: 'ui' },
        { id: 'F-003', title: 'Info', severity: 'P4', category: 'general' },
        { id: 'F-004', title: 'Info2', severity: 'P4', category: 'general' },
      ]);

      const report = generateReport(AUDIT_DIR);

      // Should count 2 real findings + 2 informational
      expect(report).toContain('**2 findings** (plus 2 informational notes)');
    });
  });
});
