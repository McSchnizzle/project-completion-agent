/**
 * Preflight Phase - Environment Validation
 * Per tasks-v4.md Phase 0: Preflight Checks
 *
 * Validates all capabilities before starting audit:
 * - Write access
 * - Browser availability
 * - GitHub CLI authentication
 * - Config file
 * - App URL reachability
 * - PRD discovery
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as yaml from 'yaml';

export interface PreflightResult {
  write_access: boolean;
  browser_mode: 'mcp' | 'none';
  github_authenticated: boolean;
  github_username: string | null;
  github_repo: string | null;
  config_loaded: boolean;
  config_path: string | null;
  config: AuditConfig | null;
  app_url: string | null;
  app_reachable: boolean;
  app_status_code: number | null;
  prd_path: string | null;
  prd_candidates: string[];
  safe_mode: boolean;
  is_production: boolean;
  errors: string[];
  warnings: string[];
}

export interface AuditConfig {
  environment: {
    url: string;
    is_production_data: boolean | null;
    safe_mode: boolean;
    safe_hostnames?: string[];
    production_hostnames?: string[];
  };
  credentials?: Record<string, { email?: string; password?: string }>;
  exploration?: {
    max_pages?: number;
    max_routes?: number;
    max_per_pattern?: number;
    exploration_timeout?: number;
    same_origin_only?: boolean;
    realtime_wait_seconds?: number;
  };
  testing?: {
    security_checks?: boolean;
    boundary_defaults?: {
      string_max?: number;
      number_min?: number;
      number_max?: number;
      date_years_past?: number;
      date_years_future?: number;
    };
  };
  screenshots?: {
    max_storage_mb?: number;
  };
  github?: {
    create_issues?: boolean;
    labels?: string[];
  };
  action_classification?: {
    dangerous_patterns?: string[];
    delete_patterns?: string[];
    create_patterns?: string[];
  };
}

const DEFAULT_CONFIG: AuditConfig = {
  environment: {
    url: '',
    is_production_data: null,
    safe_mode: true,
    safe_hostnames: ['localhost', '127.0.0.1', '*.local', 'staging.*', 'dev.*', 'test.*'],
    production_hostnames: ['*.prod.*', 'production.*']
  },
  exploration: {
    max_pages: 20,
    max_routes: 50,
    max_per_pattern: 5,
    exploration_timeout: 1800,
    same_origin_only: true,
    realtime_wait_seconds: 5
  },
  testing: {
    security_checks: false,
    boundary_defaults: {
      string_max: 255,
      number_min: -1000,
      number_max: 1000000,
      date_years_past: 10,
      date_years_future: 10
    }
  },
  screenshots: {
    max_storage_mb: 100
  },
  github: {
    create_issues: true,
    labels: ['audit', 'completion-agent']
  },
  action_classification: {
    dangerous_patterns: ['delete account', 'payment', 'purchase', 'credit card'],
    delete_patterns: ['delete', 'remove', 'cancel', 'destroy'],
    create_patterns: ['submit', 'create', 'add', 'save', 'post']
  }
};

/**
 * Run all preflight checks
 */
export async function runPreflight(projectRoot: string): Promise<PreflightResult> {
  const result: PreflightResult = {
    write_access: false,
    browser_mode: 'none',
    github_authenticated: false,
    github_username: null,
    github_repo: null,
    config_loaded: false,
    config_path: null,
    config: null,
    app_url: null,
    app_reachable: false,
    app_status_code: null,
    prd_path: null,
    prd_candidates: [],
    safe_mode: true,
    is_production: false,
    errors: [],
    warnings: []
  };

  // 0.1: Write access check
  result.write_access = checkWriteAccess(projectRoot);
  if (!result.write_access) {
    result.errors.push('Cannot write to project directory');
    return result;
  }

  // 0.2: Browser capability detection (will be checked by Claude, we just note it)
  // This will be determined at runtime by Claude when it tries to use MCP
  result.browser_mode = 'none'; // Default, Claude will override if MCP available

  // 0.3: GitHub CLI check
  const githubStatus = checkGitHubCli();
  result.github_authenticated = githubStatus.authenticated;
  result.github_username = githubStatus.username;
  result.github_repo = githubStatus.repo;
  if (!githubStatus.authenticated) {
    result.warnings.push('GitHub CLI not authenticated (manual issue creation required)');
  }

  // 0.4: Config file check
  const configResult = loadConfig(projectRoot);
  result.config_loaded = configResult.loaded;
  result.config_path = configResult.path;
  result.config = configResult.config;
  if (!configResult.loaded) {
    result.warnings.push('No config file found, using defaults');
  }

  // 0.5: App URL validation
  if (result.config?.environment.url) {
    result.app_url = result.config.environment.url;
    const reachability = await checkUrlReachable(result.app_url);
    result.app_reachable = reachability.reachable;
    result.app_status_code = reachability.statusCode;
    if (!reachability.reachable) {
      result.errors.push(`App URL not reachable: ${result.app_url}`);
    }
  }

  // 0.6: PRD discovery
  result.prd_candidates = discoverPrdFiles(projectRoot);
  if (result.prd_candidates.length > 0) {
    result.prd_path = result.prd_candidates[0];
  } else {
    result.warnings.push('No PRD found (code-only analysis)');
  }

  // Determine safety mode
  if (result.config) {
    result.is_production = detectProductionEnvironment(result.config);
    result.safe_mode = result.config.environment.safe_mode ||
                       result.config.environment.is_production_data === true ||
                       result.is_production;
  }

  return result;
}

/**
 * Check write access to project directory
 */
export function checkWriteAccess(projectRoot: string): boolean {
  const testFile = path.join(projectRoot, '.write-access-test');
  try {
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check GitHub CLI authentication status
 */
export function checkGitHubCli(): {
  authenticated: boolean;
  username: string | null;
  repo: string | null;
} {
  try {
    const authOutput = execSync('gh auth status 2>&1', { encoding: 'utf-8' });
    const authenticated = authOutput.includes('Logged in');

    let username: string | null = null;
    const usernameMatch = authOutput.match(/Logged in to .+ as (.+?) /);
    if (usernameMatch) {
      username = usernameMatch[1];
    }

    let repo: string | null = null;
    try {
      const repoOutput = execSync('gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null', { encoding: 'utf-8' });
      repo = repoOutput.trim() || null;
    } catch {
      // Not in a git repo or gh repo view failed
    }

    return { authenticated, username, repo };
  } catch {
    return { authenticated: false, username: null, repo: null };
  }
}

/**
 * Load config from .complete-agent/config.yml
 */
export function loadConfig(projectRoot: string): {
  loaded: boolean;
  path: string | null;
  config: AuditConfig | null;
} {
  const configPath = path.join(projectRoot, '.complete-agent', 'config.yml');

  if (!fs.existsSync(configPath)) {
    return { loaded: false, path: null, config: { ...DEFAULT_CONFIG } };
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = yaml.parse(content);
    const config = mergeConfig(DEFAULT_CONFIG, parsed);
    return { loaded: true, path: configPath, config };
  } catch (error) {
    return { loaded: false, path: configPath, config: { ...DEFAULT_CONFIG } };
  }
}

/**
 * Merge user config with defaults
 */
function mergeConfig(defaults: AuditConfig, user: Partial<AuditConfig>): AuditConfig {
  return {
    environment: { ...defaults.environment, ...user.environment },
    credentials: user.credentials || defaults.credentials,
    exploration: { ...defaults.exploration, ...user.exploration },
    testing: {
      ...defaults.testing,
      ...user.testing,
      boundary_defaults: { ...defaults.testing?.boundary_defaults, ...user.testing?.boundary_defaults }
    },
    screenshots: { ...defaults.screenshots, ...user.screenshots },
    github: { ...defaults.github, ...user.github },
    action_classification: {
      ...defaults.action_classification,
      ...user.action_classification
    }
  };
}

/**
 * Check if URL is reachable
 */
export async function checkUrlReachable(url: string): Promise<{
  reachable: boolean;
  statusCode: number | null;
}> {
  try {
    const output = execSync(
      `curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 "${url}"`,
      { encoding: 'utf-8' }
    );
    const statusCode = parseInt(output.trim(), 10);
    return {
      reachable: statusCode >= 200 && statusCode < 500,
      statusCode
    };
  } catch {
    return { reachable: false, statusCode: null };
  }
}

/**
 * Discover PRD files in project
 */
export function discoverPrdFiles(projectRoot: string): string[] {
  const candidates: string[] = [];
  const patterns = ['PRD*.md', 'prd*.md', 'plan*.md', 'spec*.md', 'requirements*.md'];
  const excludeDirs = ['node_modules', '.git', 'vendor', 'dist', 'build', '.next', '.complete-agent'];

  function searchDir(dir: string, depth: number = 0): void {
    if (depth > 3) return; // Limit search depth

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (!excludeDirs.includes(entry.name)) {
            searchDir(fullPath, depth + 1);
          }
        } else if (entry.isFile()) {
          for (const pattern of patterns) {
            const regex = new RegExp('^' + pattern.replace('*', '.*') + '$', 'i');
            if (regex.test(entry.name)) {
              candidates.push(fullPath);
            }
          }
        }
      }
    } catch {
      // Directory not readable
    }
  }

  searchDir(projectRoot);

  // Sort by priority: PRD > plan > spec, then by version number (higher first)
  candidates.sort((a, b) => {
    const aName = path.basename(a).toLowerCase();
    const bName = path.basename(b).toLowerCase();

    // Priority by prefix
    const getPriority = (name: string): number => {
      if (name.startsWith('prd')) return 0;
      if (name.startsWith('plan')) return 1;
      if (name.startsWith('spec')) return 2;
      return 3;
    };

    const priorityDiff = getPriority(aName) - getPriority(bName);
    if (priorityDiff !== 0) return priorityDiff;

    // Extract version number
    const getVersion = (name: string): number => {
      const match = name.match(/v?(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    };

    return getVersion(bName) - getVersion(aName); // Higher version first
  });

  return candidates;
}

/**
 * Detect if environment is production based on config and URL patterns
 */
export function detectProductionEnvironment(config: AuditConfig): boolean {
  // Explicit flag takes precedence
  if (config.environment.is_production_data === true) {
    return true;
  }
  if (config.environment.is_production_data === false) {
    return false;
  }

  // Check URL against patterns
  const url = config.environment.url;
  if (!url) return true; // Default to safe

  try {
    const hostname = new URL(url).hostname.toLowerCase();

    // Check safe patterns
    const safePatterns = config.environment.safe_hostnames || [];
    for (const pattern of safePatterns) {
      if (matchHostnamePattern(hostname, pattern)) {
        return false;
      }
    }

    // Check production patterns
    const prodPatterns = config.environment.production_hostnames || [];
    for (const pattern of prodPatterns) {
      if (matchHostnamePattern(hostname, pattern)) {
        return true;
      }
    }
  } catch {
    // Invalid URL, assume production
    return true;
  }

  // Default to assuming production (safe)
  return true;
}

/**
 * Match hostname against pattern with wildcard support
 */
function matchHostnamePattern(hostname: string, pattern: string): boolean {
  const regex = new RegExp(
    '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$',
    'i'
  );
  return regex.test(hostname);
}

/**
 * Format preflight summary for display
 */
export function formatPreflightSummary(result: PreflightResult): string {
  const lines = [
    '═══════════════════════════════════════════════════════',
    '  PREFLIGHT CHECK RESULTS',
    '═══════════════════════════════════════════════════════',
    `  ${result.write_access ? '✓' : '✗'} Write access: ${result.write_access ? 'confirmed' : 'DENIED'}`,
    `  ${result.browser_mode !== 'none' ? '✓' : '⚠'} Browser automation: ${result.browser_mode === 'mcp' ? 'Claude for Chrome (MCP)' : 'not available'}`,
    `  ${result.github_authenticated ? '✓' : '⚠'} GitHub CLI: ${result.github_authenticated ? `authenticated as ${result.github_username}` : 'not authenticated'}`,
    `  ${result.config_loaded ? '✓' : '⚠'} Config: ${result.config_loaded ? result.config_path : 'using defaults'}`,
  ];

  if (result.app_url) {
    lines.push(`  ${result.app_reachable ? '✓' : '✗'} App URL: ${result.app_url} (HTTP ${result.app_status_code || 'N/A'})`);
  }

  lines.push(`  ${result.prd_path ? '✓' : '⚠'} PRD: ${result.prd_path || 'none - code-only audit'}`);
  lines.push(`  ⚠ Safe mode: ${result.safe_mode ? 'ON' : 'OFF'}`);
  lines.push(`  ⚠ Production data: ${result.is_production ? 'YES' : 'NO'}`);
  lines.push('═══════════════════════════════════════════════════════');

  if (result.errors.length > 0) {
    lines.push('');
    lines.push('ERRORS:');
    for (const error of result.errors) {
      lines.push(`  ✗ ${error}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push('');
    lines.push('WARNINGS:');
    for (const warning of result.warnings) {
      lines.push(`  ⚠ ${warning}`);
    }
  }

  return lines.join('\n');
}

/**
 * Validate preflight result meets minimum requirements
 */
export function validatePreflightGate(result: PreflightResult): {
  pass: boolean;
  blocking_errors: string[];
} {
  const blockingErrors: string[] = [];

  if (!result.write_access) {
    blockingErrors.push('Write access denied - cannot proceed');
  }

  if (result.app_url && !result.app_reachable) {
    blockingErrors.push('App URL not reachable - cannot proceed with browser audit');
  }

  return {
    pass: blockingErrors.length === 0,
    blocking_errors: blockingErrors
  };
}

/**
 * Initialize audit directory structure
 */
export function initializeAuditDirectory(projectRoot: string, timestamp?: string): {
  success: boolean;
  audit_path: string;
  error?: string;
} {
  const ts = timestamp || new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const auditPath = path.join(projectRoot, '.complete-agent', 'audits', ts);
  const currentLink = path.join(projectRoot, '.complete-agent', 'audits', 'current');

  try {
    // Create directories
    fs.mkdirSync(path.join(auditPath, 'findings'), { recursive: true });
    fs.mkdirSync(path.join(auditPath, 'pages'), { recursive: true });
    fs.mkdirSync(path.join(auditPath, 'screenshots'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, '.complete-agent', 'dashboard'), { recursive: true });

    // Create/update symlink
    try {
      if (fs.existsSync(currentLink)) {
        fs.unlinkSync(currentLink);
      }
      fs.symlinkSync(ts, currentLink);
    } catch {
      // Symlink might not work on all systems, that's OK
    }

    return { success: true, audit_path: auditPath };
  } catch (error) {
    return {
      success: false,
      audit_path: auditPath,
      error: `Failed to create audit directory: ${error}`
    };
  }
}

/**
 * Create default config file
 */
export function createDefaultConfig(projectRoot: string, url?: string): string {
  const configDir = path.join(projectRoot, '.complete-agent');
  const configPath = path.join(configDir, 'config.yml');

  fs.mkdirSync(configDir, { recursive: true });

  const configYaml = `# Complete Audit Configuration
# See SKILL_INSTRUCTIONS.md for full documentation

environment:
  url: "${url || 'https://your-app.com'}"
  is_production_data: false
  safe_mode: true

exploration:
  max_pages: 20
  max_routes: 50
  same_origin_only: true

testing:
  security_checks: false

github:
  create_issues: true
  labels:
    - audit
    - completion-agent
`;

  fs.writeFileSync(configPath, configYaml);
  return configPath;
}
