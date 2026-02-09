/**
 * Unified Audit Configuration - Single source of truth for all runtime settings.
 *
 * Configuration is resolved from three layers with the following precedence
 * (highest wins):
 *
 *   1. CLI arguments (`cliArgs`)
 *   2. Environment variables (e.g. `CI`, `AUDIT_MAX_BUDGET`)
 *   3. Values loaded from `config.yml`
 *   4. Built-in defaults
 *
 * @module config
 */

import type { AuthConfig } from './browser/auth-handler.js';
import { parseAuthConfig } from './auth-config.js';

/**
 * Complete configuration for a single audit run.
 *
 * Every field has a well-defined default so partial configs are safe.
 */
export interface AuditConfig {
  // -- Target --

  /** Root URL of the running application to audit. */
  url: string;
  /** Absolute path to the project's source code. */
  codebasePath: string;
  /** Optional path to the PRD document for feature-gap analysis. */
  prdPath?: string;

  // -- Mode --

  /** Audit scope: full pipeline, quick scan, or static-only. */
  mode: 'full' | 'quick' | 'code-only';
  /** Allow independent phases to run concurrently. */
  parallel: boolean;
  /** Suppress interactive prompts (auto-accept defaults). */
  nonInteractive: boolean;
  /** Browser backend used for page exploration and testing. */
  browser: 'playwright' | 'none';

  // -- Scope --

  /** Glob patterns that limit which routes/pages are audited. */
  focusPatterns?: string[];
  /** Maximum number of distinct pages to visit during exploration. */
  maxPages: number;
  /** Maximum number of forms to test during the form-testing phase. */
  maxForms: number;

  // -- Budget --

  /** Hard spending cap across the entire audit run (USD). */
  maxBudgetUsd: number;
  /** Per-phase spending cap (USD). */
  maxPhaseBudgetUsd: number;
  /** Wall-clock timeout for any single phase (seconds). */
  timeoutPerPhase: number;

  // -- Resume --

  /** Attempt to resume from the most recent checkpoint. */
  resume: boolean;
  /** Remove prior audit artifacts before starting a fresh run. */
  cleanup: boolean;

  // -- Identity --

  /** Unique identifier for this audit run (format: `audit-YYYYMMDD-HHMMSS`). */
  auditId: string;

  // -- Safety --

  /**
   * Force safe-mode on or off.
   *
   * When `undefined` the system auto-detects by inspecting the target URL
   * (production URLs default to safe-mode enabled).
   */
  safeMode?: boolean;

  // -- Auth --

  /** Authentication configuration for browser sessions. */
  authConfig?: AuthConfig;

  /** Path to a pre-authenticated browser profile directory (for oauth-redirect). */
  browserProfile?: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default values applied when no explicit configuration is provided. */
const DEFAULTS: AuditConfig = {
  url: '',
  codebasePath: '',
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
  auditId: '',  // generated at build time
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic audit ID from the current wall-clock time.
 *
 * Format: `audit-YYYYMMDD-HHMMSS`
 *
 * @param now - Optional Date for testability; defaults to `new Date()`.
 * @returns A string like `audit-20260206-143021`.
 */
export function generateAuditId(now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');

  const y = now.getFullYear();
  const mo = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const h = pad(now.getHours());
  const mi = pad(now.getMinutes());
  const s = pad(now.getSeconds());

  return `audit-${y}${mo}${d}-${h}${mi}${s}`;
}

/**
 * Parse a numeric value from a string, returning `undefined` on failure.
 */
function parseNum(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse a boolean-ish environment variable.
 *
 * Truthy: `"1"`, `"true"`, `"yes"` (case-insensitive).
 * Falsy: `"0"`, `"false"`, `"no"`.
 * Anything else returns `undefined`.
 */
function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  const lower = value.toLowerCase();
  if (['1', 'true', 'yes'].includes(lower)) return true;
  if (['0', 'false', 'no'].includes(lower)) return false;
  return undefined;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Merge configuration from all sources and return a fully-resolved config.
 *
 * Precedence (highest wins): `cliArgs` > environment > `configYml` > defaults.
 *
 * @param cliArgs   - Values supplied directly from the command line.
 * @param configYml - Key/value pairs loaded from the project's `config.yml`.
 * @param env       - Environment variable map (defaults to `process.env`).
 * @returns A complete {@link AuditConfig} with every field populated.
 */
export function buildConfig(
  cliArgs: Partial<AuditConfig> = {},
  configYml: Record<string, unknown> = {},
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): AuditConfig {
  // ---- Layer 3: config.yml (lowest override) ----------------------------

  const fromYml: Partial<AuditConfig> = {};

  if (configYml.url !== undefined) fromYml.url = String(configYml.url);
  if (configYml.codebasePath !== undefined) fromYml.codebasePath = String(configYml.codebasePath);
  if (configYml.codebase_path !== undefined) fromYml.codebasePath = String(configYml.codebase_path);
  if (configYml.prdPath !== undefined) fromYml.prdPath = String(configYml.prdPath);
  if (configYml.prd_path !== undefined) fromYml.prdPath = String(configYml.prd_path);
  if (configYml.mode !== undefined) fromYml.mode = String(configYml.mode) as AuditConfig['mode'];
  if (configYml.parallel !== undefined) fromYml.parallel = Boolean(configYml.parallel);
  if (configYml.browser !== undefined) fromYml.browser = String(configYml.browser) as AuditConfig['browser'];
  if (configYml.maxPages !== undefined) fromYml.maxPages = Number(configYml.maxPages);
  if (configYml.max_pages !== undefined) fromYml.maxPages = Number(configYml.max_pages);
  if (configYml.maxForms !== undefined) fromYml.maxForms = Number(configYml.maxForms);
  if (configYml.max_forms !== undefined) fromYml.maxForms = Number(configYml.max_forms);
  if (configYml.maxBudgetUsd !== undefined) fromYml.maxBudgetUsd = Number(configYml.maxBudgetUsd);
  if (configYml.max_budget_usd !== undefined) fromYml.maxBudgetUsd = Number(configYml.max_budget_usd);
  if (configYml.maxPhaseBudgetUsd !== undefined) fromYml.maxPhaseBudgetUsd = Number(configYml.maxPhaseBudgetUsd);
  if (configYml.max_phase_budget_usd !== undefined) fromYml.maxPhaseBudgetUsd = Number(configYml.max_phase_budget_usd);
  if (configYml.timeoutPerPhase !== undefined) fromYml.timeoutPerPhase = Number(configYml.timeoutPerPhase);
  if (configYml.timeout_per_phase !== undefined) fromYml.timeoutPerPhase = Number(configYml.timeout_per_phase);
  if (configYml.safeMode !== undefined) fromYml.safeMode = Boolean(configYml.safeMode);
  if (configYml.safe_mode !== undefined) fromYml.safeMode = Boolean(configYml.safe_mode);
  if (configYml.browserProfile !== undefined) fromYml.browserProfile = String(configYml.browserProfile);
  if (configYml.browser_profile !== undefined) fromYml.browserProfile = String(configYml.browser_profile);

  // ---- Layer 2: environment variables -----------------------------------

  const fromEnv: Partial<AuditConfig> = {};

  if (env.AUDIT_URL) fromEnv.url = env.AUDIT_URL;
  if (env.AUDIT_CODEBASE_PATH) fromEnv.codebasePath = env.AUDIT_CODEBASE_PATH;
  if (env.AUDIT_PRD_PATH) fromEnv.prdPath = env.AUDIT_PRD_PATH;
  if (env.AUDIT_MODE) fromEnv.mode = env.AUDIT_MODE as AuditConfig['mode'];
  if (env.AUDIT_BROWSER) fromEnv.browser = env.AUDIT_BROWSER as AuditConfig['browser'];

  const envMaxPages = parseNum(env.AUDIT_MAX_PAGES);
  if (envMaxPages !== undefined) fromEnv.maxPages = envMaxPages;

  const envMaxForms = parseNum(env.AUDIT_MAX_FORMS);
  if (envMaxForms !== undefined) fromEnv.maxForms = envMaxForms;

  const envBudget = parseNum(env.AUDIT_MAX_BUDGET);
  if (envBudget !== undefined) fromEnv.maxBudgetUsd = envBudget;

  const envPhaseBudget = parseNum(env.AUDIT_MAX_PHASE_BUDGET);
  if (envPhaseBudget !== undefined) fromEnv.maxPhaseBudgetUsd = envPhaseBudget;

  const envTimeout = parseNum(env.AUDIT_TIMEOUT_PER_PHASE);
  if (envTimeout !== undefined) fromEnv.timeoutPerPhase = envTimeout;

  const envSafe = parseBool(env.AUDIT_SAFE_MODE);
  if (envSafe !== undefined) fromEnv.safeMode = envSafe;

  // CI environment implies non-interactive mode
  if (env.CI !== undefined && env.CI !== '' && env.CI !== '0' && env.CI !== 'false') {
    fromEnv.nonInteractive = true;
  }

  const envParallel = parseBool(env.AUDIT_PARALLEL);
  if (envParallel !== undefined) fromEnv.parallel = envParallel;

  // ---- Parse auth config from config.yml ---------------------------------

  const authConfig = parseAuthConfig(configYml);

  // ---- Merge (cli > env > yml > defaults) -------------------------------

  const merged: AuditConfig = {
    ...DEFAULTS,
    ...fromYml,
    ...fromEnv,
    ...cliArgs,
  };

  // Attach auth config if a strategy was found (not 'none')
  if (authConfig.strategy !== 'none') {
    merged.authConfig = merged.authConfig ?? authConfig;
  }

  // Generate an audit ID if none was provided at any layer
  if (!merged.auditId) {
    merged.auditId = generateAuditId();
  }

  return merged;
}
