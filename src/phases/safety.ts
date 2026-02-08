/**
 * Safety Assessment - Environment classification, safe-mode detection,
 * action gating, and allow/deny list enforcement.
 *
 * Analyzes the target URL to determine if the application is running in
 * development, staging, or production. Automatically enables safe-mode
 * protections when production environments are detected to prevent
 * accidental data corruption or user impact.
 *
 * Classification logic:
 * - Development: localhost, 127.0.0.1, *.local, dev.* subdomains, non-standard ports
 * - Staging: *.staging.*, *.stg.*, *.test.* domains
 * - Production: Real TLDs without dev/staging indicators
 * - Unknown: Everything else (defaults to safe mode)
 *
 * @module phases/safety
 */

import type { AuditConfig } from '../config.js';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EnvironmentClassification =
  | 'development'
  | 'staging'
  | 'production'
  | 'unknown';

export interface SafetyResult {
  safeMode: boolean;
  classification: EnvironmentClassification;
  reason: string;
}

export type BlockedActionKind =
  | 'form_submit'
  | 'delete'
  | 'account_modify'
  | 'data_write'
  | 'navigation'
  | 'unknown';

export interface BlockedAction {
  timestamp: string;
  kind: BlockedActionKind;
  url: string;
  selector?: string;
  description: string;
  reason: string;
}

export interface SafetyGuardConfig {
  allowList: string[];
  denyList: string[];
  blockFormSubmissions: boolean;
  blockDeleteActions: boolean;
  blockAccountModifications: boolean;
  maxNavigationsPerMinute: number;
}

// ---------------------------------------------------------------------------
// Blocked-action log (module-level)
// ---------------------------------------------------------------------------

const blockedActions: BlockedAction[] = [];

export function getBlockedActions(): BlockedAction[] {
  return [...blockedActions];
}

export function clearBlockedActions(): void {
  blockedActions.length = 0;
}

function logBlockedAction(action: BlockedAction): void {
  blockedActions.push(action);
  console.log(`[Safety] BLOCKED: ${action.kind} - ${action.description} (${action.reason})`);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Assess the target environment and determine safety requirements.
 */
export function assessSafety(config: AuditConfig): SafetyResult {
  console.log('\n=== Safety Assessment ===\n');

  if (config.safeMode !== undefined) {
    const classification = classifyEnvironment(config.url);
    const result: SafetyResult = {
      safeMode: config.safeMode,
      classification,
      reason: `Safe mode explicitly ${config.safeMode ? 'enabled' : 'disabled'} in configuration`,
    };
    displaySafetyStatus(result);
    return result;
  }

  const classification = classifyEnvironment(config.url);
  const result = buildSafetyResult(classification, config.url);

  displaySafetyStatus(result);

  if (classification === 'production') {
    console.warn('WARNING: Production environment detected!');
    console.warn('   Safe mode is enabled by default to prevent data corruption.');
    console.warn('   To disable, set safeMode: false in config.yml\n');
  }

  return result;
}

// ---------------------------------------------------------------------------
// SafetyGuard - runtime action gating
// ---------------------------------------------------------------------------

const DEFAULT_GUARD_CONFIG: SafetyGuardConfig = {
  allowList: [],
  denyList: [],
  blockFormSubmissions: true,
  blockDeleteActions: true,
  blockAccountModifications: true,
  maxNavigationsPerMinute: 60,
};

export function buildGuardConfig(
  overrides: Partial<SafetyGuardConfig> = {},
  configYml: Record<string, unknown> = {},
): SafetyGuardConfig {
  const fromYml: Partial<SafetyGuardConfig> = {};

  if (Array.isArray(configYml.allow_list)) {
    fromYml.allowList = (configYml.allow_list as string[]).map(String);
  }
  if (Array.isArray(configYml.deny_list)) {
    fromYml.denyList = (configYml.deny_list as string[]).map(String);
  }

  return { ...DEFAULT_GUARD_CONFIG, ...fromYml, ...overrides };
}

/**
 * Check whether a URL is permitted by the allow/deny lists.
 *
 * - If `allowList` is non-empty, URL must match at least one pattern.
 * - If `denyList` is non-empty, URL must NOT match any pattern.
 * - Patterns are matched as substrings (case-insensitive).
 */
export function isUrlPermitted(url: string, guard: SafetyGuardConfig): boolean {
  const lower = url.toLowerCase();

  // Deny list takes priority
  if (guard.denyList.length > 0) {
    for (const pattern of guard.denyList) {
      if (lower.includes(pattern.toLowerCase())) {
        return false;
      }
    }
  }

  // If allow list is set, URL must match
  if (guard.allowList.length > 0) {
    return guard.allowList.some((pattern) => lower.includes(pattern.toLowerCase()));
  }

  return true;
}

/**
 * Gate an action in safe mode. Returns `null` if the action is allowed,
 * or a `BlockedAction` describing why it was blocked.
 */
export function gateAction(
  safeMode: boolean,
  guard: SafetyGuardConfig,
  action: {
    kind: BlockedActionKind;
    url: string;
    selector?: string;
    description: string;
  },
): BlockedAction | null {
  if (!safeMode) return null;

  // URL deny-list check
  if (!isUrlPermitted(action.url, guard)) {
    const blocked: BlockedAction = {
      timestamp: new Date().toISOString(),
      kind: action.kind,
      url: action.url,
      selector: action.selector,
      description: action.description,
      reason: 'URL matched deny list or not in allow list',
    };
    logBlockedAction(blocked);
    return blocked;
  }

  // Form submission check
  if (guard.blockFormSubmissions && action.kind === 'form_submit') {
    const blocked: BlockedAction = {
      timestamp: new Date().toISOString(),
      kind: action.kind,
      url: action.url,
      selector: action.selector,
      description: action.description,
      reason: 'Form submissions blocked in safe mode',
    };
    logBlockedAction(blocked);
    return blocked;
  }

  // Delete action check
  if (guard.blockDeleteActions && action.kind === 'delete') {
    const blocked: BlockedAction = {
      timestamp: new Date().toISOString(),
      kind: action.kind,
      url: action.url,
      selector: action.selector,
      description: action.description,
      reason: 'Delete actions blocked in safe mode',
    };
    logBlockedAction(blocked);
    return blocked;
  }

  // Account modification check
  if (guard.blockAccountModifications && action.kind === 'account_modify') {
    const blocked: BlockedAction = {
      timestamp: new Date().toISOString(),
      kind: action.kind,
      url: action.url,
      selector: action.selector,
      description: action.description,
      reason: 'Account modifications blocked in safe mode',
    };
    logBlockedAction(blocked);
    return blocked;
  }

  return null;
}

/**
 * Detect the kind of action from a URL or selector string.
 */
export function detectActionKind(url: string, selector?: string): BlockedActionKind {
  const combined = `${url} ${selector ?? ''}`.toLowerCase();

  if (/delete|remove|destroy|drop|truncate|erase|wipe/.test(combined)) {
    return 'delete';
  }
  if (/submit|post.*form|form.*submit|send|create/i.test(combined)) {
    return 'form_submit';
  }
  if (/account|profile|settings|password|email.*change|deactivate|unsubscribe/.test(combined)) {
    return 'account_modify';
  }
  if (/put|patch|update|modify|edit|save|write/.test(combined)) {
    return 'data_write';
  }

  return 'navigation';
}

/**
 * Write all blocked actions to a JSON file in the audit directory.
 */
export function writeBlockedActions(auditDir: string): void {
  const outPath = path.join(auditDir, 'safety-blocked-actions.json');
  fs.writeFileSync(outPath, JSON.stringify(blockedActions, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Robust production URL detection
// ---------------------------------------------------------------------------

const KNOWN_TLDS = new Set([
  'com', 'org', 'net', 'io', 'app', 'co', 'gov', 'edu',
  'uk', 'de', 'fr', 'jp', 'au', 'ca', 'us', 'in', 'br',
  'ru', 'cn', 'me', 'tv', 'info', 'biz', 'xyz', 'site',
  'online', 'tech', 'dev', 'ai', 'cloud',
]);

/**
 * Robust production detection that uses proper URL parsing.
 */
export function isProductionUrl(url: string): boolean {
  if (!url) return false;

  try {
    // Validate URL is parseable before classifying
    new URL(url);
    return classifyEnvironment(url) === 'production';
  } catch {
    // If we can't parse it, assume production for safety
    return true;
  }
}

// ---------------------------------------------------------------------------
// Classification logic
// ---------------------------------------------------------------------------

export function classifyEnvironment(url: string): EnvironmentClassification {
  if (!url) return 'unknown';

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const port = parsed.port;

    if (isDevelopment(hostname, port)) return 'development';
    if (isStaging(hostname)) return 'staging';
    if (isProduction(hostname, port)) return 'production';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function isDevelopment(hostname: string, port: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
  if (hostname.match(/^192\.168\.\d+\.\d+$/) || hostname.match(/^10\.\d+\.\d+\.\d+$/)) return true;
  if (hostname.endsWith('.local')) return true;
  // Note: .dev is a real Google-owned TLD used for production sites.
  // We only detect dev. subdomain patterns (line below), not the TLD itself.
  if (port && !['80', '443', ''].includes(port)) return true;
  if (hostname.startsWith('dev.') || hostname.includes('.dev.')) return true;
  return false;
}

function isStaging(hostname: string): boolean {
  const stagingPatterns = [
    /\.staging\./,
    /\.stg\./,
    /\.test\./,
    /\.qa\./,
    /^staging\./,
    /^stg\./,
    /^test\./,
    /^qa\./,
    /^preview\./,
    /\.preview\./,
    /^canary\./,
    /\.canary\./,
    /^uat\./,
    /\.uat\./,
  ];

  return stagingPatterns.some((pattern) => pattern.test(hostname));
}

function isProduction(hostname: string, port: string): boolean {
  // Extract TLD
  const parts = hostname.split('.');
  if (parts.length < 2) return false;

  const tld = parts[parts.length - 1];
  const hasTld = KNOWN_TLDS.has(tld);

  const hasDevIndicator =
    hostname.includes('dev.') ||
    hostname.includes('.dev.') ||
    hostname.startsWith('dev-') ||
    hostname.includes('staging') ||
    hostname.includes('stg.') ||
    hostname.includes('test.') ||
    hostname.includes('qa.') ||
    hostname.includes('preview.') ||
    hostname.includes('canary.') ||
    hostname.includes('uat.');

  const standardPort = !port || port === '80' || port === '443';

  return hasTld && !hasDevIndicator && standardPort;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSafetyResult(
  classification: EnvironmentClassification,
  url: string,
): SafetyResult {
  switch (classification) {
    case 'development':
      return {
        safeMode: false,
        classification,
        reason: `Development environment detected (${url}). Safe mode disabled.`,
      };
    case 'staging':
      return {
        safeMode: false,
        classification,
        reason: `Staging environment detected (${url}). Safe mode disabled.`,
      };
    case 'production':
      return {
        safeMode: true,
        classification,
        reason: `Production environment detected (${url}). Safe mode enabled to prevent data corruption.`,
      };
    case 'unknown':
    default:
      return {
        safeMode: true,
        classification: 'unknown',
        reason: `Environment classification uncertain (${url}). Safe mode enabled as a precaution.`,
      };
  }
}

function displaySafetyStatus(result: SafetyResult): void {
  const modeLabel = result.safeMode ? 'ENABLED' : 'DISABLED';

  console.log(`Safe Mode: ${modeLabel}`);
  console.log(`   Environment: ${result.classification}`);
  console.log(`   Reason: ${result.reason}`);
  console.log('');

  if (result.safeMode) {
    console.log('Safe mode protections:');
    console.log('  - No destructive form submissions');
    console.log('  - No account modifications');
    console.log('  - No data deletions');
    console.log('  - Read-only exploration mode');
  } else {
    console.log('Safe mode disabled:');
    console.log('  - Full form testing enabled');
    console.log('  - Destructive actions allowed');
    console.log('  - Use with caution!');
  }

  console.log('');
}
