/**
 * Tests for Report Generation and Completion Checklist phases
 * Task T-039: Test report-generation.ts and completion-checklist.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateReport } from '../../src/phases/report-generation';
import {
  runChecklist,
  type ChecklistResult,
} from '../../src/phases/completion-checklist';

describe('report-generation', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-gen-test-'));
    fs.mkdirSync(path.join(tempDir, 'findings'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'pages'), { recursive: true });
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should generate basic report with no findings', () => {
    const progressPath = path.join(tempDir, 'progress.json');
    fs.writeFileSync(
      progressPath,
      JSON.stringify({
        audit_id: 'test-audit-001',
        started_at: new Date().toISOString(),
        target_url: 'http://example.com',
      })
    );

    const report = generateReport(tempDir);

    expect(report).toContain('# Audit Report');
    expect(report).toContain('test-audit-001');
    expect(report).toContain('http://example.com');
    expect(report).toContain('No findings were discovered');
  });

  it('should generate report with findings and severity breakdown', () => {
    const progressPath = path.join(tempDir, 'progress.json');
    fs.writeFileSync(
      progressPath,
      JSON.stringify({
        audit_id: 'test-audit-002',
        started_at: new Date().toISOString(),
        target_url: 'http://example.com',
      })
    );

    // Create test findings
    fs.writeFileSync(
      path.join(tempDir, 'findings', 'F-001.json'),
      JSON.stringify({
        id: 'F-001',
        title: 'Critical XSS vulnerability',
        severity: 'P0',
        category: 'security',
        status: 'open',
      })
    );

    fs.writeFileSync(
      path.join(tempDir, 'findings', 'F-002.json'),
      JSON.stringify({
        id: 'F-002',
        title: 'Missing alt text on image',
        severity: 'P2',
        category: 'accessibility',
        status: 'open',
      })
    );

    const report = generateReport(tempDir);

    expect(report).toContain('**2 findings**');
    expect(report).toContain('Critical (P0):** 1');
    expect(report).toContain('Medium (P2):** 1');
    expect(report).toContain('F-001');
    expect(report).toContain('Critical XSS vulnerability');
    expect(report).toContain('require immediate attention');
  });

  it('should include PRD coverage metrics when available', () => {
    const progressPath = path.join(tempDir, 'progress.json');
    fs.writeFileSync(
      progressPath,
      JSON.stringify({
        audit_id: 'test-audit-003',
        started_at: new Date().toISOString(),
        target_url: 'http://example.com',
        coverage: {
          pages_visited: 15,
          forms_tested: 3,
          features_checked: 8,
        },
      })
    );

    const prdPath = path.join(tempDir, 'prd-summary.json');
    fs.writeFileSync(
      prdPath,
      JSON.stringify({
        features: [
          { id: 'F1', name: 'User Login', priority: 'P0' },
          { id: 'F2', name: 'Profile Page', priority: 'P1' },
        ],
        summary: {
          total_features: 2,
          p0_count: 1,
          p1_count: 1,
          p2_count: 0,
        },
      })
    );

    const report = generateReport(tempDir);

    expect(report).toContain('covering 2 features');
    expect(report).toContain('**Total Features:** 2');
    expect(report).toContain('**Pages Visited:** 15');
    expect(report).toContain('**Forms Tested:** 3');
    expect(report).toContain('User Login');
  });

  it('should include pages explored section', () => {
    const progressPath = path.join(tempDir, 'progress.json');
    fs.writeFileSync(
      progressPath,
      JSON.stringify({
        audit_id: 'test-audit-004',
        started_at: new Date().toISOString(),
        target_url: 'http://example.com',
      })
    );

    fs.writeFileSync(
      path.join(tempDir, 'pages', 'page-0.json'),
      JSON.stringify({
        page_number: 0,
        url: 'http://example.com',
        title: 'Home Page',
        visited_at: new Date().toISOString(),
        features_checked: { login: { status: 'pass', notes: 'OK' } },
      })
    );

    const report = generateReport(tempDir);

    expect(report).toContain('## Pages Explored');
    expect(report).toContain('Home Page');
    expect(report).toContain('http://example.com');
  });

  it('should include form test results when available', () => {
    const progressPath = path.join(tempDir, 'progress.json');
    fs.writeFileSync(
      progressPath,
      JSON.stringify({
        audit_id: 'test-audit-005',
        started_at: new Date().toISOString(),
        target_url: 'http://example.com',
      })
    );

    fs.writeFileSync(
      path.join(tempDir, 'findings', 'F-001.json'),
      JSON.stringify({
        id: 'F-001',
        title: 'Form validation missing',
        severity: 'P1',
        source: 'form-testing',
        evidence: { url: 'http://example.com/signup' },
      })
    );

    const report = generateReport(tempDir);

    expect(report).toContain('## Form Test Results');
    expect(report).toContain('1 findings were discovered during form testing');
    expect(report).toContain('Form validation missing');
  });

  it('should generate appropriate recommendations', () => {
    const progressPath = path.join(tempDir, 'progress.json');
    fs.writeFileSync(
      progressPath,
      JSON.stringify({
        audit_id: 'test-audit-006',
        started_at: new Date().toISOString(),
        target_url: 'http://example.com',
      })
    );

    fs.writeFileSync(
      path.join(tempDir, 'findings', 'F-001.json'),
      JSON.stringify({
        id: 'F-001',
        title: 'SQL injection',
        severity: 'P0',
        category: 'security',
      })
    );

    fs.writeFileSync(
      path.join(tempDir, 'findings', 'F-002.json'),
      JSON.stringify({
        id: 'F-002',
        title: 'Slow page load',
        severity: 'P2',
        category: 'performance',
      })
    );

    const report = generateReport(tempDir);

    expect(report).toContain('## Recommendations');
    expect(report).toContain('Address Critical Issues First');
    expect(report).toContain('Security Review');
    expect(report).toContain('Performance Optimization');
  });

  it('should write report to correct path', () => {
    const progressPath = path.join(tempDir, 'progress.json');
    fs.writeFileSync(
      progressPath,
      JSON.stringify({
        audit_id: 'test-audit-007',
        started_at: new Date().toISOString(),
        target_url: 'http://example.com',
      })
    );

    generateReport(tempDir);

    const reportPath = path.join(tempDir, 'report.md');
    expect(fs.existsSync(reportPath)).toBe(true);

    const content = fs.readFileSync(reportPath, 'utf-8');
    expect(content).toContain('# Audit Report');
  });
});

describe('completion-checklist', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checklist-test-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should report incomplete audit when required files missing', () => {
    const result = runChecklist(tempDir);

    expect(result.complete).toBe(false);
    expect(result.missingCount).toBeGreaterThan(0);
    expect(result.items.length).toBeGreaterThan(0);
  });

  it('should mark progress.json as required', () => {
    const result = runChecklist(tempDir);

    const progressItem = result.items.find((item) => item.name === 'Progress Tracker');
    expect(progressItem).toBeDefined();
    expect(progressItem?.required).toBe(true);
    expect(progressItem?.exists).toBe(false);
  });

  it('should report complete audit when all required files present', () => {
    // Create all required files
    fs.writeFileSync(
      path.join(tempDir, 'progress.json'),
      JSON.stringify({ audit_id: 'test' })
    );
    fs.writeFileSync(
      path.join(tempDir, 'coverage-summary.md'),
      '# Coverage Summary'
    );
    fs.writeFileSync(path.join(tempDir, 'report.md'), '# Report');
    fs.writeFileSync(
      path.join(tempDir, 'review-decisions.json'),
      JSON.stringify({})
    );

    // Create pages directory with at least one page
    fs.mkdirSync(path.join(tempDir, 'pages'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'pages', 'page-0.json'),
      JSON.stringify({ page_number: 0 })
    );

    const result = runChecklist(tempDir);

    expect(result.complete).toBe(true);
    expect(result.missingCount).toBe(0);
  });

  it('should check for at least one page file', () => {
    fs.mkdirSync(path.join(tempDir, 'pages'), { recursive: true });

    const resultEmpty = runChecklist(tempDir);
    const pageItem = resultEmpty.items.find((item) => item.name === 'Page Inventories');
    expect(pageItem?.exists).toBe(false);

    // Add a page file
    fs.writeFileSync(
      path.join(tempDir, 'pages', 'page-0.json'),
      JSON.stringify({ page_number: 0 })
    );

    const resultWithPage = runChecklist(tempDir);
    const pageItemAfter = resultWithPage.items.find(
      (item) => item.name === 'Page Inventories'
    );
    expect(pageItemAfter?.exists).toBe(true);
  });

  it('should mark PRD summary as optional', () => {
    const result = runChecklist(tempDir);

    const prdItem = result.items.find((item) => item.name === 'PRD Summary');
    expect(prdItem).toBeDefined();
    expect(prdItem?.required).toBe(false);
  });

  it('should update progress.json status to complete when all required present', () => {
    const progressPath = path.join(tempDir, 'progress.json');
    fs.writeFileSync(
      progressPath,
      JSON.stringify({ audit_id: 'test', status: 'in_progress' })
    );
    fs.writeFileSync(
      path.join(tempDir, 'coverage-summary.md'),
      '# Coverage Summary'
    );
    fs.writeFileSync(path.join(tempDir, 'report.md'), '# Report');
    fs.writeFileSync(
      path.join(tempDir, 'review-decisions.json'),
      JSON.stringify({})
    );

    fs.mkdirSync(path.join(tempDir, 'pages'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'pages', 'page-0.json'),
      JSON.stringify({ page_number: 0 })
    );

    runChecklist(tempDir);

    const progress = JSON.parse(fs.readFileSync(progressPath, 'utf-8'));
    expect(progress.status).toBe('complete');
    expect(progress.completed_at).toBeDefined();
  });

  it('should not update progress.json when incomplete', () => {
    const progressPath = path.join(tempDir, 'progress.json');
    fs.writeFileSync(
      progressPath,
      JSON.stringify({ audit_id: 'test', status: 'in_progress' })
    );

    runChecklist(tempDir);

    const progress = JSON.parse(fs.readFileSync(progressPath, 'utf-8'));
    expect(progress.status).toBe('in_progress');
  });
});
