/**
 * Safety phase tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  isDestructiveAction,
  analyzeAction,
  enforceSafeMode,
  shouldSkipAction,
  isProductionUrl,
  createSafetyConfig,
  canTestForm,
  DEFAULT_SAFE_CONFIG,
  SafetyConfig
} from '../../skill/phases/safety';

describe('Safety Phase', () => {
  describe('isDestructiveAction', () => {
    it('should detect delete actions', () => {
      expect(isDestructiveAction('delete user', DEFAULT_SAFE_CONFIG)).toBe(true);
      expect(isDestructiveAction('DELETE /api/user', DEFAULT_SAFE_CONFIG)).toBe(true);
    });

    it('should detect remove actions', () => {
      expect(isDestructiveAction('remove item', DEFAULT_SAFE_CONFIG)).toBe(true);
    });

    it('should not flag safe actions', () => {
      expect(isDestructiveAction('view profile', DEFAULT_SAFE_CONFIG)).toBe(false);
      expect(isDestructiveAction('GET /api/users', DEFAULT_SAFE_CONFIG)).toBe(false);
    });
  });

  describe('analyzeAction', () => {
    it('should identify delete operations as critical', () => {
      const result = analyzeAction('delete account', DEFAULT_SAFE_CONFIG);
      expect(result.is_destructive).toBe(true);
      expect(result.action_type).toBe('delete');
      expect(result.risk_level).toBe('critical');
    });

    it('should identify modify operations as high risk', () => {
      const result = analyzeAction('update profile', DEFAULT_SAFE_CONFIG);
      expect(result.is_destructive).toBe(true);
      expect(result.action_type).toBe('modify');
      expect(result.risk_level).toBe('high');
    });

    it('should identify navigation as safe', () => {
      const result = analyzeAction('navigate to home', DEFAULT_SAFE_CONFIG);
      expect(result.is_destructive).toBe(false);
      expect(result.action_type).toBe('navigate');
      expect(result.risk_level).toBe('none');
    });
  });

  describe('enforceSafeMode', () => {
    it('should force safe mode for production data', () => {
      const config: SafetyConfig = {
        ...DEFAULT_SAFE_CONFIG,
        is_production_data: true,
        safe_mode: false
      };

      const enforced = enforceSafeMode(config);
      expect(enforced.safe_mode).toBe(true);
      expect(enforced.require_confirmation).toBe(true);
    });

    it('should limit form submissions for production data', () => {
      const config: SafetyConfig = {
        ...DEFAULT_SAFE_CONFIG,
        is_production_data: true,
        max_form_submissions: 10
      };

      const enforced = enforceSafeMode(config);
      expect(enforced.max_form_submissions).toBeLessThanOrEqual(3);
    });
  });

  describe('shouldSkipAction', () => {
    it('should skip destructive actions in safe mode', () => {
      const result = shouldSkipAction('delete user', DEFAULT_SAFE_CONFIG);
      expect(result.skip).toBe(true);
      expect(result.severity).toBe('critical');
    });

    it('should allow safe actions', () => {
      const result = shouldSkipAction('view page', DEFAULT_SAFE_CONFIG);
      expect(result.skip).toBe(false);
    });

    it('should skip form submissions on production data', () => {
      const prodConfig: SafetyConfig = {
        ...DEFAULT_SAFE_CONFIG,
        is_production_data: true
      };

      const result = shouldSkipAction('submit form', prodConfig);
      expect(result.skip).toBe(true);
    });
  });

  describe('isProductionUrl', () => {
    it('should detect localhost as non-production', () => {
      expect(isProductionUrl('http://localhost:3000')).toBe(false);
      expect(isProductionUrl('http://127.0.0.1:8080')).toBe(false);
    });

    it('should detect staging as non-production', () => {
      expect(isProductionUrl('https://staging.example.com')).toBe(false);
      expect(isProductionUrl('https://dev.example.com')).toBe(false);
    });

    it('should detect production URLs', () => {
      expect(isProductionUrl('https://www.example.com')).toBe(true);
      expect(isProductionUrl('https://example.com')).toBe(true);
    });
  });

  describe('createSafetyConfig', () => {
    it('should create config for localhost', () => {
      const config = createSafetyConfig('http://localhost:3000');
      expect(config.is_production_data).toBe(false);
    });

    it('should create config for production', () => {
      const config = createSafetyConfig('https://www.example.com');
      expect(config.is_production_data).toBe(true);
      expect(config.safe_mode).toBe(true);
    });

    it('should respect force safe mode flag', () => {
      const config = createSafetyConfig('http://localhost:3000', true);
      expect(config.safe_mode).toBe(true);
    });
  });

  describe('canTestForm', () => {
    it('should allow GET forms', () => {
      const result = canTestForm('/search', 'GET', DEFAULT_SAFE_CONFIG);
      expect(result.skip).toBe(false);
    });

    it('should check POST forms against patterns', () => {
      const result = canTestForm('/api/delete', 'POST', DEFAULT_SAFE_CONFIG);
      expect(result.skip).toBe(true);
    });

    it('should allow safe POST forms', () => {
      const result = canTestForm('/search', 'POST', DEFAULT_SAFE_CONFIG);
      expect(result.skip).toBe(false);
    });
  });
});
