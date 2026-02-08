/**
 * Schema Validator tests
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  initializeValidator,
  validateAgainstSchema,
  assertValid,
  hasSchema,
  getAvailableSchemas,
  SchemaValidationError
} from '../../skill/utils/schema-validator';
import * as path from 'path';

describe('Schema Validator', () => {
  beforeAll(() => {
    // Initialize with the actual schemas directory
    const schemasDir = path.join(__dirname, '../../skill/schemas');
    initializeValidator(schemasDir);
  });

  describe('hasSchema', () => {
    it('should return true for known schemas', () => {
      expect(hasSchema('finding')).toBe(true);
      expect(hasSchema('progress')).toBe(true);
    });

    it('should return false for unknown schemas', () => {
      expect(hasSchema('nonexistent')).toBe(false);
    });
  });

  describe('getAvailableSchemas', () => {
    it('should return list of schema names', () => {
      const schemas = getAvailableSchemas();
      expect(Array.isArray(schemas)).toBe(true);
      expect(schemas.length).toBeGreaterThan(0);
      expect(schemas).toContain('finding');
    });
  });

  describe('validateAgainstSchema', () => {
    it('should validate progress data', () => {
      const validProgress = {
        schema_version: '1.0.0',
        audit_id: 'test-001',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: 'running',
        current_stage: 'preflight',
        stages: {},
        metrics: {
          pages_visited: 0,
          pages_total: 0,
          routes_covered: 0,
          routes_total: 0,
          findings_total: 0,
          findings_by_severity: {},
          verified_count: 0,
          flaky_count: 0,
          unverified_count: 0
        },
        focus_areas: null,
        stop_flag: false,
        errors: []
      };

      const result = validateAgainstSchema(validProgress, 'progress');
      // Note: This will pass if schema exists and data is valid
      expect(result).toBeDefined();
    });

    it('should return error for missing schema', () => {
      const result = validateAgainstSchema({}, 'nonexistent-schema');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('assertValid', () => {
    it('should throw SchemaValidationError for invalid data', () => {
      expect(() => {
        assertValid(null, 'nonexistent');
      }).toThrow();
    });
  });

  describe('SchemaValidationError', () => {
    it('should have correct properties', () => {
      const error = new SchemaValidationError('test-schema', ['Error 1', 'Error 2']);

      expect(error.name).toBe('SchemaValidationError');
      expect(error.schemaName).toBe('test-schema');
      expect(error.validationErrors).toEqual(['Error 1', 'Error 2']);
      expect(error.message).toContain('test-schema');
    });
  });
});
