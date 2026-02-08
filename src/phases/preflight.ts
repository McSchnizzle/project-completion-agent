/**
 * Preflight Checks - Pre-audit validation and environment verification.
 *
 * Validates that all required dependencies, permissions, and resources
 * are available before starting the audit. Ensures early failure on
 * misconfiguration rather than discovering issues mid-pipeline.
 *
 * Key validations:
 * - Write permissions to audit directory
 * - Browser availability (if required)
 * - GitHub CLI presence (for issue creation)
 * - Target URL reachability
 * - PRD file existence (if specified)
 * - Directory structure initialization
 *
 * @module phases/preflight
 */

import fs from 'node:fs';
import { execSync } from 'node:child_process';
import type { AuditConfig } from '../config.js';
import { ensureDirectories, getAuditDir } from '../artifact-paths.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Individual preflight check result.
 */
export interface PreflightCheck {
  /** Human-readable name of the check. */
  name: string;
  /** Whether the check passed. */
  passed: boolean;
  /** Detailed message about the result. */
  message: string;
}

/**
 * Complete preflight validation result.
 */
export interface PreflightResult {
  /** Overall pass/fail status. */
  passed: boolean;
  /** Individual check results. */
  checks: PreflightCheck[];
  /** Non-fatal warnings that don't prevent audit from running. */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run all preflight checks and return a comprehensive result.
 *
 * This function validates that the environment is ready for an audit run.
 * It performs checks in a fail-fast manner but collects all results before
 * returning, allowing the user to fix multiple issues at once.
 *
 * @param config - The audit configuration to validate.
 * @returns A preflight result indicating overall pass/fail and individual check details.
 */
export async function runPreflight(config: AuditConfig): Promise<PreflightResult> {
  const checks: PreflightCheck[] = [];
  const warnings: string[] = [];

  console.log('\n=== Preflight Checks ===\n');

  // Get the audit directory path for subsequent checks
  const auditDir = getAuditDir(config.codebasePath);

  // Run each check
  checks.push(checkWriteAccess(auditDir));
  checks.push(checkBrowserConfig(config));
  checks.push(checkGitHubCli());
  checks.push(await checkUrlReachable(config.url));
  checks.push(checkPrdExists(config));
  checks.push(checkDirectoryInit(auditDir));

  // Collect warnings from checks that passed with caveats
  for (const check of checks) {
    if (check.passed && check.message.includes('warning:')) {
      warnings.push(`${check.name}: ${check.message.replace(/^.*?warning:\s*/i, '')}`);
    }
  }

  // Determine overall pass/fail
  const passed = checks.every((c) => c.passed);

  // Display summary
  displaySummary(checks, warnings, passed);

  return {
    passed,
    checks,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

/**
 * Verify write access to the audit output directory.
 */
function checkWriteAccess(auditDir: string): PreflightCheck {
  const name = 'Write Access';

  try {
    // Ensure parent directory exists
    const parentDir = auditDir.split('/').slice(0, -1).join('/');
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // Test write access
    fs.accessSync(auditDir, fs.constants.W_OK);

    return {
      name,
      passed: true,
      message: `✓ Write access confirmed: ${auditDir}`,
    };
  } catch (err) {
    // Directory might not exist yet, try to create it
    try {
      fs.mkdirSync(auditDir, { recursive: true });
      fs.accessSync(auditDir, fs.constants.W_OK);

      return {
        name,
        passed: true,
        message: `✓ Created audit directory: ${auditDir}`,
      };
    } catch (createErr) {
      return {
        name,
        passed: false,
        message: `✗ Cannot write to ${auditDir}: ${createErr instanceof Error ? createErr.message : String(createErr)}`,
      };
    }
  }
}

/**
 * Verify browser configuration is set.
 */
function checkBrowserConfig(config: AuditConfig): PreflightCheck {
  const name = 'Browser Configuration';

  if (config.browser === 'none') {
    return {
      name,
      passed: true,
      message: '⊗ Browser disabled (mode: none)',
    };
  }

  // Just note the configuration; actual browser detection happens later
  return {
    name,
    passed: true,
    message: `✓ Browser configured: ${config.browser}`,
  };
}

/**
 * Check if GitHub CLI (gh) is available in PATH.
 */
function checkGitHubCli(): PreflightCheck {
  const name = 'GitHub CLI';

  try {
    execSync('which gh', { stdio: 'pipe' });

    return {
      name,
      passed: true,
      message: '✓ GitHub CLI (gh) found in PATH',
    };
  } catch (err) {
    return {
      name,
      passed: false,
      message: '✗ GitHub CLI (gh) not found. Install from https://cli.github.com',
    };
  }
}

/**
 * Check if the target URL is reachable.
 */
async function checkUrlReachable(url: string): Promise<PreflightCheck> {
  const name = 'URL Reachability';

  if (!url) {
    return {
      name,
      passed: false,
      message: '✗ No URL provided in configuration',
    };
  }

  try {
    // Parse URL to ensure it's valid
    const parsedUrl = new URL(url);

    // Perform HEAD request with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(parsedUrl.href, {
      method: 'HEAD',
      signal: controller.signal,
      // Avoid CORS issues in preflight
      mode: 'no-cors',
    });

    clearTimeout(timeoutId);

    // In no-cors mode, response.ok is not reliable, so just check if fetch succeeded
    return {
      name,
      passed: true,
      message: `✓ URL reachable: ${url}`,
    };
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        return {
          name,
          passed: false,
          message: `✗ URL timeout after 5s: ${url}`,
        };
      }

      return {
        name,
        passed: false,
        message: `✗ URL unreachable: ${url} (${err.message})`,
      };
    }

    return {
      name,
      passed: false,
      message: `✗ URL unreachable: ${url}`,
    };
  }
}

/**
 * Check if the PRD file exists (if specified).
 */
function checkPrdExists(config: AuditConfig): PreflightCheck {
  const name = 'PRD File';

  if (!config.prdPath) {
    return {
      name,
      passed: true,
      message: '⊗ No PRD specified (skipping feature-gap analysis)',
    };
  }

  if (fs.existsSync(config.prdPath)) {
    return {
      name,
      passed: true,
      message: `✓ PRD found: ${config.prdPath}`,
    };
  }

  return {
    name,
    passed: false,
    message: `✗ PRD not found: ${config.prdPath}`,
  };
}

/**
 * Initialize the audit directory structure.
 */
function checkDirectoryInit(auditDir: string): PreflightCheck {
  const name = 'Directory Structure';

  try {
    ensureDirectories(auditDir);

    return {
      name,
      passed: true,
      message: '✓ Audit directories initialized',
    };
  } catch (err) {
    return {
      name,
      passed: false,
      message: `✗ Failed to create directories: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/**
 * Display a formatted summary of preflight results.
 */
function displaySummary(
  checks: PreflightCheck[],
  warnings: string[],
  passed: boolean,
): void {
  // Display each check result
  for (const check of checks) {
    console.log(`${check.message}`);
  }

  // Display warnings if any
  if (warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    for (const warning of warnings) {
      console.log(`  ${warning}`);
    }
  }

  // Display overall status
  console.log('\n' + '─'.repeat(50));
  if (passed) {
    console.log('✅ All preflight checks passed\n');
  } else {
    console.log('❌ Preflight checks failed\n');
    console.log('Fix the issues above before starting the audit.\n');
  }
}
