/**
 * Schema Validator - Validates LLM JSON output against schemas.
 *
 * Uses Zod for schema validation (already a project dependency) and supports
 * both Zod schemas and raw JSON Schema objects via AJV. This module is used
 * to validate structured LLM responses before they are consumed by downstream
 * pipeline stages.
 *
 * @module llm/schema-validator
 */

import { z } from 'zod';
import Ajv, { type ValidateFunction, type ErrorObject } from 'ajv';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationResult<T = unknown> {
  /** Whether validation succeeded. */
  success: boolean;
  /** The validated/parsed data (only set on success). */
  data?: T;
  /** Human-readable error messages (only set on failure). */
  errors?: string[];
}

// ---------------------------------------------------------------------------
// Zod validation
// ---------------------------------------------------------------------------

/**
 * Validate a JSON string against a Zod schema.
 *
 * Parses the string as JSON, then validates with the schema.
 * Returns a discriminated result with either `data` or `errors`.
 *
 * @param jsonString - Raw JSON string from LLM output.
 * @param schema - A Zod schema to validate against.
 * @returns Validation result.
 */
export function validateWithZod<T>(
  jsonString: string,
  schema: z.ZodType<T>,
): ValidationResult<T> {
  const cleaned = stripFences(jsonString);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    return {
      success: false,
      errors: [`Invalid JSON: ${(err as Error).message}`],
    };
  }

  const result = schema.safeParse(parsed);
  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors = result.error.issues.map(
    (issue) => `${issue.path.join('.')}: ${issue.message}`,
  );
  return { success: false, errors };
}

// ---------------------------------------------------------------------------
// AJV (JSON Schema) validation
// ---------------------------------------------------------------------------

let ajvInstance: Ajv | null = null;

function getAjv(): Ajv {
  if (!ajvInstance) {
    ajvInstance = new Ajv({ allErrors: true, strict: false });
  }
  return ajvInstance;
}

/**
 * Validate a JSON string against a JSON Schema object.
 *
 * @param jsonString - Raw JSON string from LLM output.
 * @param jsonSchema - A JSON Schema object (draft-07 or later).
 * @returns Validation result.
 */
export function validateWithJsonSchema(
  jsonString: string,
  jsonSchema: Record<string, unknown>,
): ValidationResult {
  const cleaned = stripFences(jsonString);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    return {
      success: false,
      errors: [`Invalid JSON: ${(err as Error).message}`],
    };
  }

  const ajv = getAjv();
  let validate: ValidateFunction;

  try {
    validate = ajv.compile(jsonSchema);
  } catch (err) {
    return {
      success: false,
      errors: [`Schema compilation error: ${(err as Error).message}`],
    };
  }

  const valid = validate(parsed);
  if (valid) {
    return { success: true, data: parsed };
  }

  const errors = (validate.errors ?? []).map(formatAjvError);
  return { success: false, errors };
}

/**
 * Validate parsed data (not a string) against a JSON Schema object.
 *
 * @param data - Already-parsed data to validate.
 * @param jsonSchema - A JSON Schema object.
 * @returns Validation result.
 */
export function validateDataWithJsonSchema(
  data: unknown,
  jsonSchema: Record<string, unknown>,
): ValidationResult {
  const ajv = getAjv();
  let validate: ValidateFunction;

  try {
    validate = ajv.compile(jsonSchema);
  } catch (err) {
    return {
      success: false,
      errors: [`Schema compilation error: ${(err as Error).message}`],
    };
  }

  const valid = validate(data);
  if (valid) {
    return { success: true, data };
  }

  const errors = (validate.errors ?? []).map(formatAjvError);
  return { success: false, errors };
}

// ---------------------------------------------------------------------------
// Convenience: parse + validate in one step
// ---------------------------------------------------------------------------

/**
 * Parse a JSON string, stripping markdown fences if present, and optionally
 * validate against a Zod schema. If no schema is provided, just parses.
 *
 * @param jsonString - Raw JSON string (may have markdown fences).
 * @param schema - Optional Zod schema.
 * @returns Validation result.
 */
export function parseAndValidate<T = unknown>(
  jsonString: string,
  schema?: z.ZodType<T>,
): ValidationResult<T> {
  if (schema) {
    return validateWithZod(jsonString, schema);
  }

  const cleaned = stripFences(jsonString);
  try {
    const data = JSON.parse(cleaned) as T;
    return { success: true, data };
  } catch (err) {
    return {
      success: false,
      errors: [`Invalid JSON: ${(err as Error).message}`],
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip markdown code fences from a string.
 */
function stripFences(content: string): string {
  const trimmed = content.trim();
  const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (match) return match[1].trim();
  return trimmed;
}

/**
 * Format an AJV error object into a readable string.
 */
function formatAjvError(error: ErrorObject): string {
  const path = error.instancePath || '/';
  const message = error.message || 'validation failed';
  return `${path}: ${message}`;
}
