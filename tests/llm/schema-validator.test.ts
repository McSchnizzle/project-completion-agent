/**
 * Tests for schema-validator.ts
 *
 * Tests Zod validation, JSON Schema (AJV) validation, fence stripping,
 * and the parseAndValidate convenience function.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  validateWithZod,
  validateWithJsonSchema,
  validateDataWithJsonSchema,
  parseAndValidate,
} from '../../src/llm/schema-validator';

// ---------------------------------------------------------------------------
// Zod schemas for testing
// ---------------------------------------------------------------------------

const PrdSummarySchema = z.object({
  schema_version: z.string(),
  features: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      priority: z.enum(['must', 'should', 'could']),
    }),
  ),
  total_features: z.number().int().nonnegative(),
});

const SimpleSchema = z.object({
  name: z.string(),
  age: z.number(),
});

// ---------------------------------------------------------------------------
// JSON Schema for testing
// ---------------------------------------------------------------------------

const personJsonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    age: { type: 'number', minimum: 0 },
    email: { type: 'string', format: 'email' },
  },
  required: ['name', 'age'],
  additionalProperties: false,
};

const findingJsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3', 'P4'] },
    title: { type: 'string', minLength: 1 },
    type: { type: 'string' },
  },
  required: ['id', 'severity', 'title'],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('schema-validator', () => {
  describe('validateWithZod', () => {
    it('should validate valid JSON against schema', () => {
      const json = JSON.stringify({
        schema_version: '1.0',
        features: [
          { id: 'F1', name: 'Auth', priority: 'must' },
        ],
        total_features: 1,
      });

      const result = validateWithZod(json, PrdSummarySchema);
      expect(result.success).toBe(true);
      expect(result.data?.schema_version).toBe('1.0');
      expect(result.data?.features).toHaveLength(1);
    });

    it('should reject invalid JSON string', () => {
      const result = validateWithZod('not json', SimpleSchema);
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain('Invalid JSON');
    });

    it('should reject data that fails schema validation', () => {
      const json = JSON.stringify({ name: 'Alice' }); // missing age
      const result = validateWithZod(json, SimpleSchema);
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.some(e => e.includes('age'))).toBe(true);
    });

    it('should handle JSON in markdown fences', () => {
      const fenced = '```json\n{"name": "Bob", "age": 30}\n```';
      const result = validateWithZod(fenced, SimpleSchema);
      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('Bob');
    });

    it('should handle JSON in plain fences', () => {
      const fenced = '```\n{"name": "Charlie", "age": 25}\n```';
      const result = validateWithZod(fenced, SimpleSchema);
      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('Charlie');
    });

    it('should report correct field path in errors', () => {
      const json = JSON.stringify({
        schema_version: '1.0',
        features: [
          { id: 'F1', name: 'Auth', priority: 'invalid' },
        ],
        total_features: 1,
      });

      const result = validateWithZod(json, PrdSummarySchema);
      expect(result.success).toBe(false);
      expect(result.errors!.some(e => e.includes('features'))).toBe(true);
    });
  });

  describe('validateWithJsonSchema', () => {
    it('should validate valid data', () => {
      const json = JSON.stringify({ name: 'Alice', age: 30 });
      const result = validateWithJsonSchema(json, personJsonSchema);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'Alice', age: 30 });
    });

    it('should reject missing required fields', () => {
      const json = JSON.stringify({ name: 'Alice' }); // missing age
      const result = validateWithJsonSchema(json, personJsonSchema);
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('should reject invalid types', () => {
      const json = JSON.stringify({ name: 'Alice', age: 'thirty' });
      const result = validateWithJsonSchema(json, personJsonSchema);
      expect(result.success).toBe(false);
    });

    it('should reject additional properties when additionalProperties is false', () => {
      const json = JSON.stringify({
        name: 'Alice',
        age: 30,
        extra: 'field',
      });
      const result = validateWithJsonSchema(json, personJsonSchema);
      expect(result.success).toBe(false);
    });

    it('should handle fenced JSON', () => {
      const fenced = '```json\n{"name": "Bob", "age": 25}\n```';
      const result = validateWithJsonSchema(fenced, personJsonSchema);
      expect(result.success).toBe(true);
    });

    it('should reject invalid JSON string', () => {
      const result = validateWithJsonSchema('not json', personJsonSchema);
      expect(result.success).toBe(false);
      expect(result.errors![0]).toContain('Invalid JSON');
    });

    it('should validate finding schema', () => {
      const json = JSON.stringify({
        id: 'F-001',
        severity: 'P0',
        title: 'Missing feature',
        type: 'prd-gap',
      });
      const result = validateWithJsonSchema(json, findingJsonSchema);
      expect(result.success).toBe(true);
    });

    it('should reject invalid severity enum', () => {
      const json = JSON.stringify({
        id: 'F-001',
        severity: 'critical', // not in enum
        title: 'Bug',
      });
      const result = validateWithJsonSchema(json, findingJsonSchema);
      expect(result.success).toBe(false);
    });
  });

  describe('validateDataWithJsonSchema', () => {
    it('should validate already-parsed data', () => {
      const data = { name: 'Alice', age: 30 };
      const result = validateDataWithJsonSchema(data, personJsonSchema);
      expect(result.success).toBe(true);
    });

    it('should reject invalid data', () => {
      const data = { name: 'Alice', age: -5 };
      const result = validateDataWithJsonSchema(data, personJsonSchema);
      expect(result.success).toBe(false);
    });
  });

  describe('parseAndValidate', () => {
    it('should parse JSON without schema', () => {
      const result = parseAndValidate('{"a": 1}');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ a: 1 });
    });

    it('should parse and validate with Zod schema', () => {
      const result = parseAndValidate(
        '{"name": "Alice", "age": 30}',
        SimpleSchema,
      );
      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('Alice');
    });

    it('should strip fences and parse', () => {
      const result = parseAndValidate('```json\n{"a": 1}\n```');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ a: 1 });
    });

    it('should return error for invalid JSON', () => {
      const result = parseAndValidate('not json');
      expect(result.success).toBe(false);
      expect(result.errors![0]).toContain('Invalid JSON');
    });

    it('should return schema errors when validation fails', () => {
      const result = parseAndValidate('{"name": 123}', SimpleSchema);
      expect(result.success).toBe(false);
      expect(result.errors!.length).toBeGreaterThan(0);
    });
  });
});
