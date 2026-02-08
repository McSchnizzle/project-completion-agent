/**
 * Prompt Loader - Loads markdown prompt files and interpolates variables.
 *
 * Reads `.md` prompt templates from disk and replaces `{{variable}}`
 * placeholders with provided values. Used by the orchestrator to prepare
 * prompts before sending them to the Anthropic SDK.
 *
 * @module llm/prompt-loader
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptLoadOptions {
  /** Directory to resolve relative prompt paths against. */
  promptDir?: string;
  /** Variables to interpolate into the template. */
  variables?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Load a prompt template from a `.md` file and interpolate variables.
 *
 * @param promptPath - Absolute or relative path to the prompt file.
 * @param options - Load options (directory, variables).
 * @returns The interpolated prompt string.
 * @throws If the file does not exist or cannot be read.
 */
export function loadPrompt(
  promptPath: string,
  options: PromptLoadOptions = {},
): string {
  const resolved = resolvePromptPath(promptPath, options.promptDir);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Prompt file not found: ${resolved} (original: ${promptPath})`);
  }

  const template = fs.readFileSync(resolved, 'utf-8');
  return options.variables
    ? interpolateVariables(template, options.variables)
    : template;
}

/**
 * Interpolate `{{variable}}` placeholders in a template string.
 *
 * - String values are inserted directly.
 * - Objects/arrays are JSON-stringified.
 * - `null`/`undefined` values produce an empty string.
 *
 * @param template - Template string with `{{key}}` placeholders.
 * @param variables - Key-value map of substitutions.
 * @returns The interpolated string.
 */
export function interpolateVariables(
  template: string,
  variables: Record<string, unknown>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = variables[key];
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2);
  });
}

/**
 * List all prompt files (`.md`) in a directory.
 *
 * @param dir - Directory to scan.
 * @returns Array of absolute paths to `.md` files.
 */
export function listPromptFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(dir, f))
    .sort();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a prompt path to an absolute path.
 *
 * If `promptPath` is already absolute, it is returned as-is.
 * Otherwise it is resolved relative to `promptDir` or the project
 * `prompts/` directory.
 */
function resolvePromptPath(promptPath: string, promptDir?: string): string {
  if (path.isAbsolute(promptPath)) return promptPath;

  if (promptDir) {
    return path.resolve(promptDir, promptPath);
  }

  // Default: resolve relative to project root's prompts/ directory
  const projectRoot = findProjectRoot();
  return path.resolve(projectRoot, 'prompts', promptPath);
}

/**
 * Walk up from the current file's directory to find the project root
 * (directory containing package.json).
 */
function findProjectRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
