/**
 * Safety Phase - Production Data Protection
 * Task B.5: Safety Enforcement
 *
 * Ensures safe mode is enforced when handling production data,
 * detects destructive actions, and provides skip reasons.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface SafetyConfig {
  is_production_data: boolean;
  safe_mode: boolean;
  dangerous_patterns: string[];
  delete_patterns: string[];
  allowed_write_patterns: string[];
  max_form_submissions: number;
  require_confirmation: boolean;
}

export interface SafetyCheckResult {
  skip: boolean;
  reason: string;
  severity: 'info' | 'warning' | 'critical';
  action_type: string;
}

export interface DestructiveActionInfo {
  is_destructive: boolean;
  action_type: 'delete' | 'modify' | 'submit' | 'navigate' | 'safe';
  risk_level: 'none' | 'low' | 'medium' | 'high' | 'critical';
  description: string;
}

/**
 * Default safe mode configuration
 */
export const DEFAULT_SAFE_CONFIG: SafetyConfig = {
  is_production_data: false,
  safe_mode: true,
  dangerous_patterns: [
    'delete',
    'remove',
    'destroy',
    'drop',
    'truncate',
    'erase',
    'wipe',
    'reset',
    'clear all',
    'unsubscribe',
    'cancel subscription',
    'close account',
    'terminate'
  ],
  delete_patterns: [
    '/delete',
    '/remove',
    '/destroy',
    '/admin/delete',
    'action=delete',
    'method=DELETE'
  ],
  allowed_write_patterns: [
    '/search',
    '/filter',
    '/sort',
    '/page',
    '/view'
  ],
  max_form_submissions: 5,
  require_confirmation: true
};

/**
 * Check if an action is destructive
 */
export function isDestructiveAction(action: string, config: SafetyConfig): boolean {
  const actionLower = action.toLowerCase();

  // Check against dangerous patterns
  for (const pattern of config.dangerous_patterns) {
    if (actionLower.includes(pattern.toLowerCase())) {
      return true;
    }
  }

  // Check against delete patterns
  for (const pattern of config.delete_patterns) {
    if (actionLower.includes(pattern.toLowerCase())) {
      return true;
    }
  }

  return false;
}

/**
 * Analyze action for detailed destructive info
 */
export function analyzeAction(action: string, config: SafetyConfig): DestructiveActionInfo {
  const actionLower = action.toLowerCase();

  // Check for delete operations
  const deleteKeywords = ['delete', 'remove', 'destroy', 'drop', 'truncate', 'erase', 'wipe'];
  for (const keyword of deleteKeywords) {
    if (actionLower.includes(keyword)) {
      return {
        is_destructive: true,
        action_type: 'delete',
        risk_level: 'critical',
        description: `Action contains destructive keyword: ${keyword}`
      };
    }
  }

  // Check for modification operations
  const modifyKeywords = ['update', 'edit', 'modify', 'change', 'reset', 'clear'];
  for (const keyword of modifyKeywords) {
    if (actionLower.includes(keyword)) {
      return {
        is_destructive: true,
        action_type: 'modify',
        risk_level: 'high',
        description: `Action contains modification keyword: ${keyword}`
      };
    }
  }

  // Check for form submissions
  const submitKeywords = ['submit', 'post', 'send', 'create', 'add', 'save'];
  for (const keyword of submitKeywords) {
    if (actionLower.includes(keyword)) {
      return {
        is_destructive: false,
        action_type: 'submit',
        risk_level: config.safe_mode ? 'medium' : 'low',
        description: `Form submission action: ${keyword}`
      };
    }
  }

  // Navigation is generally safe
  if (actionLower.includes('navigate') || actionLower.includes('visit') || actionLower.includes('get')) {
    return {
      is_destructive: false,
      action_type: 'navigate',
      risk_level: 'none',
      description: 'Navigation action'
    };
  }

  return {
    is_destructive: false,
    action_type: 'safe',
    risk_level: 'none',
    description: 'Action appears safe'
  };
}

/**
 * Enforce safe mode based on environment
 */
export function enforceSafeMode(config: SafetyConfig): SafetyConfig {
  // If production data, force safe mode on
  if (config.is_production_data) {
    return {
      ...config,
      safe_mode: true,
      max_form_submissions: Math.min(config.max_form_submissions, 3),
      require_confirmation: true
    };
  }

  return config;
}

/**
 * Check if an action should be skipped
 */
export function shouldSkipAction(action: string, config: SafetyConfig): SafetyCheckResult {
  const actionInfo = analyzeAction(action, config);

  // Always skip destructive actions in safe mode
  if (config.safe_mode && actionInfo.is_destructive) {
    return {
      skip: true,
      reason: `Safe mode: Skipping destructive action (${actionInfo.action_type})`,
      severity: 'critical',
      action_type: actionInfo.action_type
    };
  }

  // Skip high-risk modifications in safe mode
  if (config.safe_mode && actionInfo.risk_level === 'high') {
    return {
      skip: true,
      reason: `Safe mode: Skipping high-risk action (${actionInfo.description})`,
      severity: 'warning',
      action_type: actionInfo.action_type
    };
  }

  // Skip form submissions on production data
  if (config.is_production_data && actionInfo.action_type === 'submit') {
    return {
      skip: true,
      reason: 'Production data: Skipping form submission to prevent data modification',
      severity: 'warning',
      action_type: actionInfo.action_type
    };
  }

  return {
    skip: false,
    reason: '',
    severity: 'info',
    action_type: actionInfo.action_type
  };
}

/**
 * Detect if URL points to production environment
 */
export function isProductionUrl(url: string): boolean {
  const productionIndicators = [
    'prod',
    'production',
    'live',
    'www.',
    '.com/',
    '.io/',
    '.org/',
    '.net/'
  ];

  const devIndicators = [
    'localhost',
    '127.0.0.1',
    '.local',
    'dev.',
    'staging.',
    'test.',
    'preview.',
    ':3000',
    ':8080',
    ':5000'
  ];

  const urlLower = url.toLowerCase();

  // Check for dev indicators first
  for (const indicator of devIndicators) {
    if (urlLower.includes(indicator)) {
      return false;
    }
  }

  // Check for production indicators
  for (const indicator of productionIndicators) {
    if (urlLower.includes(indicator)) {
      return true;
    }
  }

  // Default to production if unsure
  return true;
}

/**
 * Create safety config from URL and environment
 */
export function createSafetyConfig(
  appUrl: string,
  forceSafeMode?: boolean,
  isProduction?: boolean
): SafetyConfig {
  const isProductionData = isProduction ?? isProductionUrl(appUrl);

  const config: SafetyConfig = {
    ...DEFAULT_SAFE_CONFIG,
    is_production_data: isProductionData,
    safe_mode: forceSafeMode ?? isProductionData
  };

  return enforceSafeMode(config);
}

/**
 * Check if a form can be safely tested
 */
export function canTestForm(
  formAction: string,
  formMethod: string,
  config: SafetyConfig
): SafetyCheckResult {
  const method = formMethod.toUpperCase();

  // GET forms are always safe to test
  if (method === 'GET') {
    return {
      skip: false,
      reason: '',
      severity: 'info',
      action_type: 'navigate'
    };
  }

  // Check if action is in allowed patterns
  const actionLower = formAction.toLowerCase();
  for (const pattern of config.allowed_write_patterns) {
    if (actionLower.includes(pattern)) {
      return {
        skip: false,
        reason: '',
        severity: 'info',
        action_type: 'submit'
      };
    }
  }

  // POST/PUT/DELETE forms need extra scrutiny
  return shouldSkipAction(`${method} ${formAction}`, config);
}

/**
 * Log safety decision
 */
export interface SafetyLog {
  timestamp: string;
  action: string;
  decision: 'allowed' | 'skipped' | 'warned';
  reason: string;
  config_state: {
    safe_mode: boolean;
    is_production: boolean;
  };
}

const safetyLogs: SafetyLog[] = [];

/**
 * Log a safety decision
 */
export function logSafetyDecision(
  action: string,
  decision: 'allowed' | 'skipped' | 'warned',
  reason: string,
  config: SafetyConfig
): void {
  safetyLogs.push({
    timestamp: new Date().toISOString(),
    action,
    decision,
    reason,
    config_state: {
      safe_mode: config.safe_mode,
      is_production: config.is_production_data
    }
  });
}

/**
 * Get all safety logs
 */
export function getSafetyLogs(): SafetyLog[] {
  return [...safetyLogs];
}

/**
 * Clear safety logs
 */
export function clearSafetyLogs(): void {
  safetyLogs.length = 0;
}

/**
 * Write safety logs to file
 */
export function writeSafetyLogs(auditPath: string): void {
  const logsPath = path.join(auditPath, 'safety-log.json');
  fs.writeFileSync(logsPath, JSON.stringify(safetyLogs, null, 2));
}

/**
 * Generate safety summary
 */
export function generateSafetySummary(config: SafetyConfig): string {
  const lines: string[] = [];

  lines.push('## Safety Configuration');
  lines.push('');
  lines.push(`- **Safe Mode:** ${config.safe_mode ? 'ENABLED' : 'DISABLED'}`);
  lines.push(`- **Production Data:** ${config.is_production_data ? 'YES' : 'NO'}`);
  lines.push(`- **Max Form Submissions:** ${config.max_form_submissions}`);
  lines.push(`- **Require Confirmation:** ${config.require_confirmation ? 'YES' : 'NO'}`);
  lines.push('');

  if (config.safe_mode) {
    lines.push('### Safe Mode Restrictions');
    lines.push('');
    lines.push('- Destructive actions will be skipped');
    lines.push('- Form submissions limited');
    lines.push('- High-risk modifications blocked');
  }

  const logs = getSafetyLogs();
  if (logs.length > 0) {
    lines.push('');
    lines.push('### Safety Decisions');
    lines.push('');
    const skipped = logs.filter(l => l.decision === 'skipped').length;
    const warned = logs.filter(l => l.decision === 'warned').length;
    const allowed = logs.filter(l => l.decision === 'allowed').length;
    lines.push(`- Allowed: ${allowed}`);
    lines.push(`- Warned: ${warned}`);
    lines.push(`- Skipped: ${skipped}`);
  }

  return lines.join('\n');
}
