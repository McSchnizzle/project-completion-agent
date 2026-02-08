/**
 * Schema Registry - Maps schema IDs to files and manages AJV loading.
 *
 * Defines the relationship between:
 * - Schema names (used as AJV identifiers)
 * - Schema files on disk (skill/schemas/*.schema.json)
 * - Inline schemas in prompts (for Claude to follow)
 *
 * Prompts contain schemas for Claude to structure its output.
 * The orchestrator validates Claude's output against AJV schemas after receipt.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';

/**
 * Schema entry with metadata about validation context.
 */
export interface SchemaEntry {
  /** Schema name used as AJV key (e.g., 'finding') */
  name: string;
  /** Filename in schemas directory (e.g., 'finding.schema.json') */
  filename: string;
  /** Which pipeline phases produce this schema's output */
  producedByPhases: string[];
  /** Which pipeline phases consume this schema's output */
  consumedByPhases: string[];
  /** Whether this schema is embedded inline in prompt files */
  inlineInPrompts: boolean;
}

/**
 * Complete schema map for all audit artifacts.
 */
export const SCHEMA_MAP: Record<string, SchemaEntry> = {
  'finding': {
    name: 'finding',
    filename: 'finding.schema.json',
    producedByPhases: ['form-testing', 'responsive-testing', 'exploration'],
    consumedByPhases: ['finding-quality', 'reporting', 'interactive-review', 'verification'],
    inlineInPrompts: true,
  },
  'environment': {
    name: 'environment',
    filename: 'environment.schema.json',
    producedByPhases: ['safety'],
    consumedByPhases: ['exploration', 'form-testing'],
    inlineInPrompts: false,
  },
  'stage-state': {
    name: 'stage-state',
    filename: 'stage-state.schema.json',
    producedByPhases: ['preflight'],
    consumedByPhases: ['reporting', 'polish'],
    inlineInPrompts: false,
  },
  'code-quality': {
    name: 'code-quality',
    filename: 'code-quality.schema.json',
    producedByPhases: ['code-analysis'],
    consumedByPhases: ['finding-quality'],
    inlineInPrompts: false,
  },
  'security-scan': {
    name: 'security-scan',
    filename: 'security-scan.schema.json',
    producedByPhases: ['code-analysis'],
    consumedByPhases: ['finding-quality'],
    inlineInPrompts: false,
  },
  'page': {
    name: 'page',
    filename: 'page.schema.json',
    producedByPhases: ['exploration'],
    consumedByPhases: ['form-testing', 'reporting'],
    inlineInPrompts: true,
  },
  'architecture-analysis': {
    name: 'architecture-analysis',
    filename: 'architecture-analysis.schema.json',
    producedByPhases: ['code-analysis'],
    consumedByPhases: ['reporting'],
    inlineInPrompts: false,
  },
  'verified-finding': {
    name: 'verified-finding',
    filename: 'verified-finding.schema.json',
    producedByPhases: ['verification'],
    consumedByPhases: ['reporting'],
    inlineInPrompts: false,
  },
  'progress': {
    name: 'progress',
    filename: 'progress.schema.json',
    producedByPhases: ['progress-init'],
    consumedByPhases: ['reporting', 'polish'],
    inlineInPrompts: false,
  },
  'coverage-queue': {
    name: 'coverage-queue',
    filename: 'coverage-queue.schema.json',
    producedByPhases: ['exploration'],
    consumedByPhases: ['form-testing'],
    inlineInPrompts: false,
  },
  'report': {
    name: 'report',
    filename: 'report.schema.json',
    producedByPhases: ['reporting'],
    consumedByPhases: ['interactive-review'],
    inlineInPrompts: false,
  },
};

/**
 * Get a schema entry by name.
 * @throws if schema name is unknown
 */
export function getSchemaEntry(name: string): SchemaEntry {
  const entry = SCHEMA_MAP[name];
  if (!entry) {
    throw new Error(
      `Unknown schema '${name}'. Available: ${Object.keys(SCHEMA_MAP).join(', ')}`
    );
  }
  return entry;
}

/**
 * Get the full file path for a schema.
 */
export function getSchemaPath(name: string, schemasDir: string): string {
  const entry = getSchemaEntry(name);
  return path.join(schemasDir, entry.filename);
}

/**
 * Get all schema names.
 */
export function getAllSchemaNames(): string[] {
  return Object.keys(SCHEMA_MAP);
}

/**
 * Get schemas that should be inlined in prompt files.
 */
export function getInlineSchemas(): SchemaEntry[] {
  return Object.values(SCHEMA_MAP).filter(e => e.inlineInPrompts);
}

/**
 * Get schemas produced by a specific phase.
 */
export function getSchemasForPhase(phaseName: string): SchemaEntry[] {
  return Object.values(SCHEMA_MAP).filter(
    e => e.producedByPhases.includes(phaseName)
  );
}

/**
 * Load a schema's JSON content from disk.
 */
export function loadSchemaContent(name: string, schemasDir: string): Record<string, unknown> {
  const schemaPath = getSchemaPath(name, schemasDir);
  const content = fs.readFileSync(schemaPath, 'utf-8');
  return JSON.parse(content) as Record<string, unknown>;
}

/**
 * Load all schemas and return as a map of name → content.
 * Used for bulk registration with AJV.
 */
export function loadAllSchemas(schemasDir: string): Map<string, Record<string, unknown>> {
  const schemas = new Map<string, Record<string, unknown>>();
  for (const name of getAllSchemaNames()) {
    const schemaPath = getSchemaPath(name, schemasDir);
    if (fs.existsSync(schemaPath)) {
      try {
        schemas.set(name, loadSchemaContent(name, schemasDir));
      } catch (error) {
        console.warn(`Warning: Could not load schema '${name}': ${error}`);
      }
    }
  }
  return schemas;
}
