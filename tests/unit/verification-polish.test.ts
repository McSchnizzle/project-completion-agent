/**
 * Tests for Verification, Polish, Resume, and Focus Filter phases
 * Task T-053: Test verification.ts, polish.ts, resume.ts, focus-filter.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  runVerification,
  type VerificationConfig,
} from '../../src/phases/verification';
import { runPolish, type PolishOptions } from '../../src/phases/polish';
import {
  checkResume,
  saveCheckpoint,
  getPhasesToRun,
  type CheckpointData,
} from '../../src/phases/resume';
import {
  applyFocusFilter,
  filterRoutes,
  filterForms,
} from '../../src/phases/focus-filter';

describe('verification', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verification-test-'));
    fs.mkdirSync(path.join(tempDir, 'findings'), { recursive: true });
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should handle no findings to verify', async () => {
    const config: VerificationConfig = {
      auditDir: tempDir,
      promptPath: '/fake/verification-prompt.md',
    };

    const mockRunClaudePhase = async () => ({
      success: true,
      output: { results: [] },
    });

    const result = await runVerification(config, mockRunClaudePhase);

    expect(result.totalVerified).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('should verify findings and update their status', async () => {
    const config: VerificationConfig = {
      auditDir: tempDir,
      promptPath: '/fake/verification-prompt.md',
    };

    fs.writeFileSync(
      path.join(tempDir, 'findings', 'F-001.json'),
      JSON.stringify({ id: 'F-001', title: 'Test finding' })
    );

    const mockRunClaudePhase = async () => ({
      success: true,
      output: {
        results: [
          {
            findingId: 'F-001',
            status: 'verified',
            attempts: 3,
            details: 'Reproduced successfully',
          },
        ],
      },
    });

    const result = await runVerification(config, mockRunClaudePhase);

    expect(result.verified).toBe(1);
    expect(result.notReproduced).toBe(0);
    expect(result.flaky).toBe(0);

    // Check that finding file was updated
    const finding = JSON.parse(
      fs.readFileSync(path.join(tempDir, 'findings', 'F-001.json'), 'utf-8')
    );
    expect(finding.verification).toBeDefined();
    expect(finding.verification.status).toBe('verified');
  });

  it('should handle flaky findings', async () => {
    const config: VerificationConfig = {
      auditDir: tempDir,
      promptPath: '/fake/verification-prompt.md',
    };

    fs.writeFileSync(
      path.join(tempDir, 'findings', 'F-001.json'),
      JSON.stringify({ id: 'F-001', title: 'Flaky test' })
    );

    const mockRunClaudePhase = async () => ({
      success: true,
      output: {
        results: [
          {
            findingId: 'F-001',
            status: 'flaky',
            attempts: 3,
            details: 'Reproduced 1/3 times',
          },
        ],
      },
    });

    const result = await runVerification(config, mockRunClaudePhase);

    expect(result.flaky).toBe(1);
  });

  it('should verify specific finding when requested', async () => {
    const config: VerificationConfig = {
      auditDir: tempDir,
      promptPath: '/fake/verification-prompt.md',
      specificFinding: 'F-002',
    };

    fs.writeFileSync(
      path.join(tempDir, 'findings', 'F-001.json'),
      JSON.stringify({ id: 'F-001', title: 'Not this one' })
    );
    fs.writeFileSync(
      path.join(tempDir, 'findings', 'F-002.json'),
      JSON.stringify({ id: 'F-002', title: 'Verify this one' })
    );

    let verifiedFindings: unknown[] = [];
    const mockRunClaudePhase = async (phaseConfig: {
      inputContext: { findings: unknown[] };
    }) => {
      verifiedFindings = phaseConfig.inputContext.findings;
      return { success: true, output: { results: [] } };
    };

    await runVerification(config, mockRunClaudePhase);

    expect(verifiedFindings).toHaveLength(1);
    expect((verifiedFindings[0] as Record<string, unknown>).id).toBe('F-002');
  });

  it('should handle verification errors', async () => {
    const config: VerificationConfig = {
      auditDir: tempDir,
      promptPath: '/fake/verification-prompt.md',
    };

    fs.writeFileSync(
      path.join(tempDir, 'findings', 'F-001.json'),
      JSON.stringify({ id: 'F-001' })
    );

    const mockRunClaudePhase = async () => ({
      success: false,
      output: null,
      error: 'Browser crashed',
    });

    const result = await runVerification(config, mockRunClaudePhase);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Browser crashed');
  });
});

describe('polish', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'polish-test-'));
    fs.mkdirSync(path.join(tempDir, '.complete-agent', 'audits', 'current'), {
      recursive: true,
    });
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should update progress status to complete', () => {
    const auditDir = path.join(tempDir, '.complete-agent', 'audits', 'current');
    fs.writeFileSync(
      path.join(auditDir, 'progress.json'),
      JSON.stringify({ audit_id: 'test', status: 'in_progress' })
    );

    const result = runPolish({ basePath: tempDir });

    const progress = JSON.parse(
      fs.readFileSync(path.join(auditDir, 'progress.json'), 'utf-8')
    );
    expect(progress.status).toBe('complete');
    expect(progress.updated_at).toBeDefined();
  });

  it('should clean up test data', () => {
    const auditDir = path.join(tempDir, '.complete-agent', 'audits', 'current');
    fs.writeFileSync(
      path.join(auditDir, 'test-data-created.json'),
      JSON.stringify({
        items: [
          { id: 'user-1', type: 'test_user' },
          { id: 'user-2', type: 'test_user' },
        ],
      })
    );

    const result = runPolish({ basePath: tempDir });

    expect(result.testDataCleaned).toBe(2);
  });

  it('should archive current audit', () => {
    const auditDir = path.join(tempDir, '.complete-agent', 'audits', 'current');
    fs.writeFileSync(
      path.join(auditDir, 'progress.json'),
      JSON.stringify({ audit_id: 'test' })
    );

    const result = runPolish({ basePath: tempDir });

    expect(result.archived).toBe(true);
    expect(result.archivePath).toBeDefined();
    if (result.archivePath) {
      expect(fs.existsSync(result.archivePath)).toBe(true);
    }
  });

  it('should remove old audits when cleanup enabled', () => {
    const auditsDir = path.join(tempDir, '.complete-agent', 'audits');
    fs.mkdirSync(auditsDir, { recursive: true });

    // Create an old audit directory
    const oldAuditDir = path.join(auditsDir, '2020-01-01T00-00-00');
    fs.mkdirSync(oldAuditDir, { recursive: true });
    fs.writeFileSync(
      path.join(oldAuditDir, 'progress.json'),
      JSON.stringify({ audit_id: 'old' })
    );

    // Set modification time to old date
    const oldTime = new Date('2020-01-01').getTime();
    fs.utimesSync(oldAuditDir, oldTime / 1000, oldTime / 1000);

    const result = runPolish({
      basePath: tempDir,
      cleanup: true,
      maxAuditAge: 30,
    });

    expect(result.oldAuditsRemoved).toBeGreaterThan(0);
  });

  it('should track errors during polish', () => {
    // Create a temp directory but no audit structure
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-polish-'));

    try {
      const result = runPolish({ basePath: emptyDir });

      // Should complete without errors even with missing files
      // (polish is designed to be graceful)
      expect(result.archived).toBe(false);
      expect(result.testDataCleaned).toBe(0);
    } finally {
      if (fs.existsSync(emptyDir)) {
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
    }
  });
});

describe('resume', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-test-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should report no resume when checkpoint missing', () => {
    const result = checkResume(tempDir);

    expect(result.canResume).toBe(false);
    expect(result.reason).toContain('No checkpoint file found');
  });

  it('should resume from checkpoint with valid data', () => {
    const checkpointPath = path.join(tempDir, 'checkpoint.json');
    fs.writeFileSync(
      checkpointPath,
      JSON.stringify({
        auditId: 'test-001',
        lastCompletedPhase: 'exploration',
        completedPhases: ['preflight', 'code-analysis', 'exploration'],
        timestamp: new Date().toISOString(),
        resumable: true,
      })
    );

    const result = checkResume(tempDir);

    expect(result.canResume).toBe(true);
    expect(result.nextPhase).toBe('form-testing');
    expect(result.checkpoint?.lastCompletedPhase).toBe('exploration');
  });

  it('should not resume when checkpoint marked non-resumable', () => {
    const checkpointPath = path.join(tempDir, 'checkpoint.json');
    fs.writeFileSync(
      checkpointPath,
      JSON.stringify({
        auditId: 'test-001',
        lastCompletedPhase: 'safety',
        completedPhases: ['preflight', 'safety'],
        timestamp: new Date().toISOString(),
        resumable: false,
      })
    );

    const result = checkResume(tempDir);

    expect(result.canResume).toBe(false);
    expect(result.reason).toContain('non-resumable');
  });

  it('should save checkpoint after phase completion', () => {
    fs.writeFileSync(
      path.join(tempDir, 'progress.json'),
      JSON.stringify({ audit_id: 'test-001' })
    );

    saveCheckpoint(
      tempDir,
      'exploration',
      ['preflight', 'code-analysis', 'exploration'],
      { someState: 'data' }
    );

    const checkpointPath = path.join(tempDir, 'checkpoint.json');
    expect(fs.existsSync(checkpointPath)).toBe(true);

    const checkpoint: CheckpointData = JSON.parse(
      fs.readFileSync(checkpointPath, 'utf-8')
    );
    expect(checkpoint.lastCompletedPhase).toBe('exploration');
    expect(checkpoint.resumable).toBe(true);
    expect(checkpoint.stateSnapshot).toEqual({ someState: 'data' });
  });

  it('should return all phases when no resume possible', () => {
    const result = checkResume(tempDir);
    const phases = getPhasesToRun(result);

    expect(phases).toContain('preflight');
    expect(phases).toContain('exploration');
    expect(phases).toContain('polish');
  });

  it('should return remaining phases when resuming', () => {
    const checkpointPath = path.join(tempDir, 'checkpoint.json');
    fs.writeFileSync(
      checkpointPath,
      JSON.stringify({
        auditId: 'test-001',
        lastCompletedPhase: 'exploration',
        completedPhases: ['preflight', 'code-analysis', 'exploration'],
        timestamp: new Date().toISOString(),
        resumable: true,
      })
    );

    const result = checkResume(tempDir);
    const phases = getPhasesToRun(result);

    expect(phases).not.toContain('preflight');
    expect(phases).not.toContain('exploration');
    expect(phases).toContain('form-testing');
    expect(phases).toContain('polish');
  });
});

describe('focus-filter', () => {
  it('should pass through all routes when no patterns provided', () => {
    const routes = [
      { path: '/admin/users' },
      { path: '/api/status' },
      { path: '/public/about' },
    ];

    const filtered = filterRoutes(routes, []);

    expect(filtered).toEqual(routes);
  });

  it('should filter routes by exact match', () => {
    const routes = [
      { path: '/login' },
      { path: '/signup' },
      { path: '/about' },
    ];

    const filtered = filterRoutes(routes, ['/login']);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].path).toBe('/login');
  });

  it('should filter routes by glob pattern', () => {
    const routes = [
      { path: '/admin/users' },
      { path: '/admin/settings' },
      { path: '/api/status' },
    ];

    const filtered = filterRoutes(routes, ['/admin/*']);

    expect(filtered).toHaveLength(2);
    expect(filtered.every((r) => r.path.startsWith('/admin'))).toBe(true);
  });

  it('should filter routes by keyword', () => {
    const routes = [
      { path: '/user-profile' },
      { path: '/user-settings' },
      { path: '/admin-panel' },
    ];

    const filtered = filterRoutes(routes, ['user']);

    expect(filtered).toHaveLength(2);
    expect(filtered.every((r) => r.path.includes('user'))).toBe(true);
  });

  it('should filter forms by action URL', () => {
    const forms = [
      { action: '/login', id: 'login-form' },
      { action: '/signup', id: 'signup-form' },
      { action: '/contact', id: 'contact-form' },
    ];

    const filtered = filterForms(forms, ['/login']);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('login-form');
  });

  it('should filter forms by ID or file', () => {
    const forms = [
      { action: '/submit', id: 'user-form', file: 'users.tsx' },
      { action: '/submit', id: 'admin-form', file: 'admin.tsx' },
    ];

    const filtered = filterForms(forms, ['user']);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('user-form');
  });

  it('should apply focus filter and return summary', () => {
    const routes = [
      { path: '/admin/users' },
      { path: '/admin/settings' },
      { path: '/api/status' },
    ];
    const forms = [
      { action: '/admin/save', id: 'admin-form' },
      { action: '/public/contact', id: 'contact-form' },
    ];

    const result = applyFocusFilter(routes, forms, ['/admin/*', 'admin']);

    expect(result.summary.originalRoutes).toBe(3);
    expect(result.summary.filteredRoutes).toBe(2);
    expect(result.summary.originalForms).toBe(2);
    expect(result.summary.filteredForms).toBe(1);
    expect(result.routes).toHaveLength(2);
    expect(result.forms).toHaveLength(1);
  });

  it('should handle case-insensitive matching', () => {
    const routes = [
      { path: '/Admin/Users' },
      { path: '/API/Status' },
    ];

    const filtered = filterRoutes(routes, ['/admin/*']);

    expect(filtered).toHaveLength(1);
  });
});
