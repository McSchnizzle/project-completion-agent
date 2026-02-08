/**
 * Schema Validator - JSON Schema Validation
 *
 * Validates JSON outputs against their schemas before writing to disk.
 * Supports JSON Schema 2020-12 dialect used by all project schemas.
 */

import Ajv2020, { ErrorObject } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import * as fs from 'fs';
import * as path from 'path';

// Re-export Ajv type for external consumers
type Ajv = Ajv2020;

// Schema name to file mapping
const SCHEMA_FILES: Record<string, string> = {
  'finding': 'finding.schema.json',
  'environment': 'environment.schema.json',
  'stage-state': 'stage-state.schema.json',
  'code-quality': 'code-quality.schema.json',
  'security-scan': 'security-scan.schema.json',
  'page': 'page.schema.json',
  'architecture-analysis': 'architecture-analysis.schema.json',
  'verified-finding': 'verified-finding.schema.json',
  'progress': 'progress.schema.json',
  'coverage-queue': 'coverage-queue.schema.json',
  'report': 'report.schema.json'
};

let ajvInstance: Ajv | null = null;
let schemasDir: string | null = null;

/**
 * Get the schema name-to-file mapping (used by schema registry)
 */
export function getSchemaFiles(): Record<string, string> {
  return { ...SCHEMA_FILES };
}

/**
 * Initialize the AJV instance with schemas.
 * Uses Ajv2020 to support JSON Schema 2020-12 dialect.
 */
export function initializeValidator(schemaDirectory?: string): void {
  schemasDir = schemaDirectory || path.join(__dirname, '..', 'schemas');
  ajvInstance = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajvInstance);

  // Load all schemas
  for (const [name, filename] of Object.entries(SCHEMA_FILES)) {
    const schemaPath = path.join(schemasDir, filename);
    if (fs.existsSync(schemaPath)) {
      try {
        const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
        ajvInstance.addSchema(schema, name);
      } catch (error) {
        console.warn(`Warning: Could not load schema ${filename}: ${error}`);
      }
    }
  }
}

/**
 * Get the AJV instance, initializing if needed
 */
function getValidator(): Ajv {
  if (!ajvInstance) {
    initializeValidator();
  }
  return ajvInstance!;
}

/**
 * Validate data against a named schema
 */
export function validateAgainstSchema(
  data: unknown,
  schemaName: string
): ValidationResult {
  const ajv = getValidator();

  const validate = ajv.getSchema(schemaName);
  if (!validate) {
    return {
      valid: false,
      errors: [`Schema '${schemaName}' not found. Available: ${Object.keys(SCHEMA_FILES).join(', ')}`]
    };
  }

  const valid = validate(data);

  if (valid) {
    return { valid: true, errors: [] };
  }

  return {
    valid: false,
    errors: formatValidationErrors(validate.errors || [])
  };
}

/**
 * Validate and throw if invalid
 */
export function assertValid(data: unknown, schemaName: string): void {
  const result = validateAgainstSchema(data, schemaName);
  if (!result.valid) {
    throw new SchemaValidationError(schemaName, result.errors);
  }
}

/**
 * Format AJV errors into readable strings
 */
function formatValidationErrors(errors: ErrorObject[]): string[] {
  return errors.map(error => {
    const path = error.instancePath || '(root)';
    const message = error.message || 'validation failed';
    const params = error.params ? ` (${JSON.stringify(error.params)})` : '';
    return `${path}: ${message}${params}`;
  });
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Schema validation error
 */
export class SchemaValidationError extends Error {
  public readonly schemaName: string;
  public readonly validationErrors: string[];

  constructor(schemaName: string, errors: string[]) {
    super(`Schema validation failed for '${schemaName}':\n  ${errors.join('\n  ')}`);
    this.name = 'SchemaValidationError';
    this.schemaName = schemaName;
    this.validationErrors = errors;
  }
}

/**
 * Check if a schema exists
 */
export function hasSchema(schemaName: string): boolean {
  return schemaName in SCHEMA_FILES;
}

/**
 * Get list of available schema names
 */
export function getAvailableSchemas(): string[] {
  return Object.keys(SCHEMA_FILES);
}

/**
 * Write JSON file with schema validation
 */
export function writeValidatedJson(
  filePath: string,
  data: unknown,
  schemaName: string
): void {
  // Validate first
  assertValid(data, schemaName);

  // Write to disk
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Read and validate JSON file
 */
export function readValidatedJson<T>(
  filePath: string,
  schemaName: string
): T {
  const content = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(content);

  assertValid(data, schemaName);

  return data as T;
}
