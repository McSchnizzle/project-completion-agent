/**
 * Integration test: End-to-end pipeline in code-only mode.
 *
 * Creates a temp directory with a sample codebase, runs `runAudit()` with
 * browser=none and mock Claude SDK, then verifies the expected artifacts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runAudit, type AuditResult } from '../../src/orchestrator';
import { buildConfig } from '../../src/config';
import { registerPureTsHandler } from '../../src/phase-dispatcher';

// Mock the Claude subprocess so we don't need the CLI
vi.mock('../../src/claude-subprocess', () => ({
  createClaudeSubprocess: () => ({
    executePrompt: vi.fn().mockResolvedValue({
      success: true,
      output: JSON.stringify({ status: 'completed', mock: true }),
      tokensUsed: 500,
      cost: 0,
    }),
  }),
  interpolatePrompt: (template: string, vars: Record<string, unknown>) =>
    template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? '')),
}));

const TEST_DIR = path.join('/tmp', `pipeline-e2e-${Date.now()}`);

describe('Pipeline E2E (code-only, no browser)', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });

    // Create minimal project structure
    fs.writeFileSync(
      path.join(TEST_DIR, 'package.json'),
      JSON.stringify({ name: 'test-project', version: '1.0.0' }),
    );
    fs.mkdirSync(path.join(TEST_DIR, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(TEST_DIR, 'src', 'index.ts'),
      'export function main() { console.log("hello"); }',
    );

    // Register pure-TS handlers so those phases succeed
    registerPureTsHandler('preflight', async (ctx) => ({
      status: 'ok',
      codebasePath: ctx.codebasePath,
    }));
    registerPureTsHandler('progress-init', async (ctx) => ({
      initialized: true,
      auditDir: ctx.auditDir,
    }));
    registerPureTsHandler('safety', async () => ({
      safeMode: true,
      blockedUrls: [],
    }));
    registerPureTsHandler('reporting', async (ctx) => {
      // Write a minimal report file
      const reportPath = path.join(ctx.auditDir, 'report.md');
      fs.writeFileSync(reportPath, '# Audit Report\n\nNo findings.\n');
      return { reportGenerated: true };
    });
    registerPureTsHandler('github-issues', async () => ({
      created: 0,
      issues: [],
    }));
    registerPureTsHandler('polish', async () => ({
      cleaned: true,
    }));
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should run audit and create expected artifacts', async () => {
    const config = buildConfig({
      url: 'http://localhost:3000',
      codebasePath: TEST_DIR,
      browser: 'none',
      mode: 'code-only',
      nonInteractive: true,
      parallel: false,
    });

    const result = await runAudit(config);

    // Verify result shape
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('auditId');
    expect(result).toHaveProperty('auditDir');
    expect(result).toHaveProperty('phasesCompleted');
    expect(result).toHaveProperty('phasesTotal');
    expect(result).toHaveProperty('totalCostUsd');
    expect(result).toHaveProperty('totalDurationMs');

    // Verify artifacts exist
    const auditDir = result.auditDir;
    expect(fs.existsSync(auditDir)).toBe(true);
    expect(fs.existsSync(path.join(auditDir, 'progress.json'))).toBe(true);
    expect(fs.existsSync(path.join(auditDir, 'audit-metrics.json'))).toBe(true);
    expect(fs.existsSync(path.join(auditDir, 'dashboard', 'index.html'))).toBe(true);

    // Verify progress.json has correct structure
    const progress = JSON.parse(
      fs.readFileSync(path.join(auditDir, 'progress.json'), 'utf-8'),
    );
    expect(progress.audit_id).toBe(config.auditId);
    expect(progress.stages).toHaveProperty('preflight');

    // Verify metrics
    const metrics = JSON.parse(
      fs.readFileSync(path.join(auditDir, 'audit-metrics.json'), 'utf-8'),
    );
    expect(metrics.auditId).toBe(config.auditId);
    expect(metrics.phasesCompleted).toBeGreaterThan(0);

    // Verify dashboard HTML
    const dashHtml = fs.readFileSync(
      path.join(auditDir, 'dashboard', 'index.html'),
      'utf-8',
    );
    expect(dashHtml).toContain('<!DOCTYPE html>');
    expect(dashHtml).toContain('Audit Dashboard');
  }, 30000);

  it('should support parallel mode', async () => {
    const config = buildConfig({
      url: 'http://localhost:3000',
      codebasePath: TEST_DIR,
      browser: 'none',
      mode: 'code-only',
      nonInteractive: true,
      parallel: true,
    });

    const result = await runAudit(config);

    expect(result.phasesCompleted).toBeGreaterThan(0);
    expect(result.totalDurationMs).toBeGreaterThan(0);
  }, 30000);

  it('should create checkpoint file for resume support', async () => {
    const config = buildConfig({
      url: 'http://localhost:3000',
      codebasePath: TEST_DIR,
      browser: 'none',
      mode: 'code-only',
      nonInteractive: true,
    });

    await runAudit(config);

    const checkpointPath = path.join(
      config.codebasePath,
      '.complete-agent',
      'audits',
      'current',
      'checkpoint.json',
    );
    expect(fs.existsSync(checkpointPath)).toBe(true);

    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'));
    expect(Array.isArray(checkpoint.completedPhases)).toBe(true);
    expect(checkpoint.completedPhases.length).toBeGreaterThan(0);
  }, 30000);

  it('should skip browser phases when browser is none', async () => {
    const config = buildConfig({
      url: 'http://localhost:3000',
      codebasePath: TEST_DIR,
      browser: 'none',
      mode: 'code-only',
      nonInteractive: true,
    });

    const result = await runAudit(config);

    // Browser phases should be "completed" (skipped) when browser=none
    const progress = JSON.parse(
      fs.readFileSync(path.join(result.auditDir, 'progress.json'), 'utf-8'),
    );
    expect(progress.stages.exploration.status).toBe('completed');
    expect(progress.stages['form-testing'].status).toBe('completed');
    expect(progress.stages['responsive-testing'].status).toBe('completed');
  }, 30000);
});
