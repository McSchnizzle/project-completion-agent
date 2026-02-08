/**
 * Tests for the enhanced safety module (src/phases/safety.ts).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  assessSafety,
  classifyEnvironment,
  isProductionUrl,
  isUrlPermitted,
  buildGuardConfig,
  gateAction,
  detectActionKind,
  getBlockedActions,
  clearBlockedActions,
  type SafetyGuardConfig,
} from '../../src/phases/safety';
import type { AuditConfig } from '../../src/config';

function makeConfig(overrides: Partial<AuditConfig> = {}): AuditConfig {
  return {
    url: 'http://localhost:3000',
    codebasePath: '/tmp/test',
    mode: 'full',
    parallel: false,
    nonInteractive: false,
    browser: 'playwright',
    maxPages: 50,
    maxForms: 20,
    maxBudgetUsd: 10,
    maxPhaseBudgetUsd: 2,
    timeoutPerPhase: 600,
    resume: false,
    cleanup: false,
    auditId: 'test-001',
    ...overrides,
  };
}

describe('Safety v2', () => {
  beforeEach(() => {
    clearBlockedActions();
  });

  describe('classifyEnvironment', () => {
    it('detects localhost as development', () => {
      expect(classifyEnvironment('http://localhost:3000')).toBe('development');
      expect(classifyEnvironment('http://127.0.0.1:8080')).toBe('development');
      expect(classifyEnvironment('http://[::1]:3000')).toBe('development');
    });

    it('detects private IP ranges as development', () => {
      expect(classifyEnvironment('http://192.168.1.100:3000')).toBe('development');
      expect(classifyEnvironment('http://10.0.0.50:8080')).toBe('development');
    });

    it('detects .local domains as development', () => {
      expect(classifyEnvironment('http://myapp.local')).toBe('development');
    });

    it('detects non-standard ports as development', () => {
      expect(classifyEnvironment('http://myapp.com:3000')).toBe('development');
      expect(classifyEnvironment('http://myapp.com:8080')).toBe('development');
    });

    it('detects staging patterns', () => {
      expect(classifyEnvironment('https://staging.example.com')).toBe('staging');
      expect(classifyEnvironment('https://app.staging.example.com')).toBe('staging');
      expect(classifyEnvironment('https://test.example.com')).toBe('staging');
      expect(classifyEnvironment('https://qa.example.com')).toBe('staging');
      expect(classifyEnvironment('https://preview.example.com')).toBe('staging');
      expect(classifyEnvironment('https://uat.example.com')).toBe('staging');
    });

    it('detects production URLs', () => {
      expect(classifyEnvironment('https://example.com')).toBe('production');
      expect(classifyEnvironment('https://www.example.com')).toBe('production');
      expect(classifyEnvironment('https://myapp.io')).toBe('production');
      expect(classifyEnvironment('https://research.paulrbrown.org')).toBe('production');
    });

    it('returns unknown for empty or invalid URLs', () => {
      expect(classifyEnvironment('')).toBe('unknown');
      expect(classifyEnvironment('not-a-url')).toBe('unknown');
    });
  });

  describe('isProductionUrl', () => {
    it('detects production URLs', () => {
      expect(isProductionUrl('https://example.com')).toBe(true);
      expect(isProductionUrl('https://www.mysite.io')).toBe(true);
    });

    it('rejects development URLs', () => {
      expect(isProductionUrl('http://localhost:3000')).toBe(false);
      expect(isProductionUrl('http://127.0.0.1:8080')).toBe(false);
    });

    it('defaults to true for unparseable URLs', () => {
      expect(isProductionUrl('not-a-url')).toBe(true);
    });
  });

  describe('assessSafety', () => {
    it('auto-detects safe mode for production', () => {
      const result = assessSafety(makeConfig({ url: 'https://example.com' }));
      expect(result.safeMode).toBe(true);
      expect(result.classification).toBe('production');
    });

    it('auto-detects safe mode off for development', () => {
      const result = assessSafety(makeConfig({ url: 'http://localhost:3000' }));
      expect(result.safeMode).toBe(false);
      expect(result.classification).toBe('development');
    });

    it('respects explicit safeMode override', () => {
      const result = assessSafety(makeConfig({
        url: 'http://localhost:3000',
        safeMode: true,
      }));
      expect(result.safeMode).toBe(true);
    });

    it('enables safe mode for unknown environments', () => {
      const result = assessSafety(makeConfig({ url: '' }));
      expect(result.safeMode).toBe(true);
      expect(result.classification).toBe('unknown');
    });
  });

  describe('SafetyGuard - allow/deny lists', () => {
    it('permits any URL when lists are empty', () => {
      const guard = buildGuardConfig();
      expect(isUrlPermitted('https://anything.com', guard)).toBe(true);
    });

    it('blocks URLs matching deny list', () => {
      const guard = buildGuardConfig({ denyList: ['admin', 'delete'] });
      expect(isUrlPermitted('https://example.com/admin/users', guard)).toBe(false);
      expect(isUrlPermitted('https://example.com/api/delete', guard)).toBe(false);
      expect(isUrlPermitted('https://example.com/home', guard)).toBe(true);
    });

    it('restricts to allow list when set', () => {
      const guard = buildGuardConfig({ allowList: ['example.com'] });
      expect(isUrlPermitted('https://example.com/page', guard)).toBe(true);
      expect(isUrlPermitted('https://other.com/page', guard)).toBe(false);
    });

    it('deny list takes priority over allow list', () => {
      const guard = buildGuardConfig({
        allowList: ['example.com'],
        denyList: ['example.com/admin'],
      });
      expect(isUrlPermitted('https://example.com/home', guard)).toBe(true);
      expect(isUrlPermitted('https://example.com/admin', guard)).toBe(false);
    });

    it('parses allow/deny from config YAML', () => {
      const guard = buildGuardConfig({}, {
        allow_list: ['mysite.com', 'api.mysite.com'],
        deny_list: ['/admin', '/api/delete'],
      });
      expect(guard.allowList).toEqual(['mysite.com', 'api.mysite.com']);
      expect(guard.denyList).toEqual(['/admin', '/api/delete']);
    });
  });

  describe('gateAction', () => {
    const guard = buildGuardConfig();

    it('allows everything when safe mode is off', () => {
      const blocked = gateAction(false, guard, {
        kind: 'delete',
        url: 'https://example.com/api/delete',
        description: 'Delete user',
      });
      expect(blocked).toBeNull();
    });

    it('blocks form submissions in safe mode', () => {
      const blocked = gateAction(true, guard, {
        kind: 'form_submit',
        url: 'https://example.com/form',
        description: 'Submit contact form',
      });
      expect(blocked).not.toBeNull();
      expect(blocked!.reason).toContain('Form submissions blocked');
    });

    it('blocks delete actions in safe mode', () => {
      const blocked = gateAction(true, guard, {
        kind: 'delete',
        url: 'https://example.com/api/user/123',
        description: 'Delete user 123',
      });
      expect(blocked).not.toBeNull();
      expect(blocked!.reason).toContain('Delete actions blocked');
    });

    it('blocks account modifications in safe mode', () => {
      const blocked = gateAction(true, guard, {
        kind: 'account_modify',
        url: 'https://example.com/settings',
        description: 'Change email address',
      });
      expect(blocked).not.toBeNull();
      expect(blocked!.reason).toContain('Account modifications blocked');
    });

    it('allows navigation in safe mode', () => {
      const blocked = gateAction(true, guard, {
        kind: 'navigation',
        url: 'https://example.com/about',
        description: 'Navigate to about page',
      });
      expect(blocked).toBeNull();
    });

    it('blocks URLs matching deny list', () => {
      const denyGuard = buildGuardConfig({ denyList: ['/admin'] });
      const blocked = gateAction(true, denyGuard, {
        kind: 'navigation',
        url: 'https://example.com/admin/panel',
        description: 'Navigate to admin panel',
      });
      expect(blocked).not.toBeNull();
      expect(blocked!.reason).toContain('deny list');
    });

    it('logs blocked actions', () => {
      gateAction(true, guard, {
        kind: 'delete',
        url: 'https://example.com/api/delete',
        description: 'Delete something',
      });

      const logs = getBlockedActions();
      expect(logs).toHaveLength(1);
      expect(logs[0].kind).toBe('delete');
    });
  });

  describe('detectActionKind', () => {
    it('detects delete actions', () => {
      expect(detectActionKind('https://example.com/api/delete')).toBe('delete');
      expect(detectActionKind('https://example.com', 'button.remove-item')).toBe('delete');
    });

    it('detects form submissions', () => {
      expect(detectActionKind('https://example.com/submit')).toBe('form_submit');
    });

    it('detects account modifications', () => {
      expect(detectActionKind('https://example.com/settings')).toBe('account_modify');
      expect(detectActionKind('https://example.com/account/password')).toBe('account_modify');
    });

    it('detects data writes', () => {
      expect(detectActionKind('https://example.com/api/update')).toBe('data_write');
    });

    it('defaults to navigation', () => {
      expect(detectActionKind('https://example.com/about')).toBe('navigation');
    });
  });
});
