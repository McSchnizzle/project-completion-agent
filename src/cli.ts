#!/usr/bin/env node
/**
 * CLI Entry Point for Project Completion Agent
 *
 * Parses command-line arguments and flags, then passes them to the
 * config builder. The actual orchestrator wiring happens in T-009.
 *
 * @module cli
 */

import { parseArgs } from 'node:util';
import { buildConfig, AuditConfig } from './config.js';
import { runAudit, runVerify, type AuditResult, type VerifyResult } from './orchestrator.js';

/** Version extracted from package.json */
const VERSION = '0.75.2';

/** Parsed CLI arguments ready to pass to buildConfig */
export type CliArgs = Partial<AuditConfig> & {
  /** Issue or finding ID for the verify command */
  issue?: string;
};

/**
 * Display help text and exit.
 */
function showHelp(): void {
  console.log(`
Project Completion Agent v${VERSION}

Usage:
  audit [options]        Run a full audit of the target application
  verify [options]       Verify an existing audit report

Options:
  --url <url>                Root URL of the running application to audit
  --codebase-path <path>     Path to project source code (or set AUDIT_CODEBASE_PATH)
  --prd <path>               Path to PRD document for feature-gap analysis
  --resume                   Resume from the most recent checkpoint
  --focus <pattern>          Glob pattern to limit which routes/pages are audited
  --cleanup                  Remove prior audit artifacts before starting
  --non-interactive          Suppress interactive prompts (auto-accept defaults)
  --parallel                 Allow independent phases to run concurrently
  --browser <type>           Browser backend: chrome | playwright | none (default: chrome)
  --max-budget <usd>         Hard spending cap across the entire audit (default: 10)
  --max-pages <n>            Maximum number of pages to visit (default: 50)
  --max-forms <n>            Maximum number of forms to test (default: 20)
  --safe-mode [true|false]   Force safe-mode on or off (default: auto-detect)
  --timeout <seconds>        Wall-clock timeout per phase (default: 600)
  --issue <number>           Issue number to verify (for verify command)
  --finding <id>             Finding ID to verify, e.g. F-001 (for verify command)
  --help, -h                 Show this help message
  --version, -v              Show version number

Environment Variables:
  CI                         Auto-enables non-interactive mode when set
  AUDIT_URL                  Default target URL
  AUDIT_CODEBASE_PATH        Path to source code
  AUDIT_PRD_PATH             Path to PRD document
  AUDIT_MAX_BUDGET           Default budget cap (USD)
  AUDIT_MAX_PAGES            Default page limit
  AUDIT_MAX_FORMS            Default form limit
  AUDIT_SAFE_MODE            Force safe-mode (1/true/yes or 0/false/no)
  AUDIT_TIMEOUT_PER_PHASE    Default timeout per phase (seconds)

Examples:
  audit --url http://localhost:3000 --prd docs/prd.md
  audit --resume --non-interactive
  audit --focus auth --focus payments --url http://localhost:3000
  verify --finding F-001 --url http://localhost:3000 --codebase-path ./my-app
  verify --issue 42 --url http://localhost:3000 --codebase-path ./my-app
  CI=1 audit --url http://localhost:3000 --max-budget 5
`);
  process.exit(0);
}

/**
 * Display version and exit.
 */
function showVersion(): void {
  console.log(`v${VERSION}`);
  process.exit(0);
}

/**
 * Parse command-line arguments into a CliArgs object.
 *
 * @param argv - Command-line arguments (defaults to process.argv)
 * @returns Parsed CLI arguments ready for buildConfig
 */
export function parseCliArgs(argv: string[] = process.argv): CliArgs {
  // Extract command (audit or verify) if present
  const command = argv[2];

  // If first arg is a help or version flag, handle it immediately
  if (command === '--help' || command === '-h') {
    showHelp();
  }
  if (command === '--version' || command === '-v') {
    showVersion();
  }

  // Skip node executable and script name, plus command if present
  const argsStart = command && !command.startsWith('--') ? 3 : 2;

  const { values, positionals } = parseArgs({
    args: argv.slice(argsStart),
    options: {
      // Target
      url: { type: 'string' },
      'codebase-path': { type: 'string' },
      prd: { type: 'string' },

      // Mode
      resume: { type: 'boolean', default: false },
      cleanup: { type: 'boolean', default: false },
      'non-interactive': { type: 'boolean', default: false },
      parallel: { type: 'boolean', default: false },
      browser: { type: 'string' },

      // Scope
      focus: { type: 'string', multiple: true },
      'max-pages': { type: 'string' },
      'max-forms': { type: 'string' },

      // Budget
      'max-budget': { type: 'string' },
      timeout: { type: 'string' },

      // Safety
      'safe-mode': { type: 'string' },

      // Verify
      issue: { type: 'string' },
      finding: { type: 'string' },

      // Meta
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
    allowPositionals: true,
  });

  // Handle help/version flags
  if (values.help) {
    showHelp();
  }
  if (values.version) {
    showVersion();
  }

  // Build the CliArgs object
  const cliArgs: CliArgs = {};

  if (values.url) {
    cliArgs.url = values.url;
  }

  if (values['codebase-path']) {
    cliArgs.codebasePath = values['codebase-path'];
  }

  if (values.prd) {
    cliArgs.prdPath = values.prd;
  }

  if (values.resume) {
    cliArgs.resume = true;
  }

  if (values.cleanup) {
    cliArgs.cleanup = true;
  }

  if (values['non-interactive']) {
    cliArgs.nonInteractive = true;
  }

  if (values.parallel) {
    cliArgs.parallel = true;
  }

  if (values.browser) {
    const browser = values.browser as 'chrome' | 'playwright' | 'none';
    if (['chrome', 'playwright', 'none'].includes(browser)) {
      cliArgs.browser = browser;
    } else {
      console.error(`Invalid browser type: ${browser}. Must be chrome, playwright, or none.`);
      process.exit(1);
    }
  }

  if (values.focus) {
    cliArgs.focusPatterns = Array.isArray(values.focus) ? values.focus : [values.focus];
  }

  if (values['max-pages']) {
    const maxPages = Number(values['max-pages']);
    if (!Number.isFinite(maxPages) || maxPages < 1) {
      console.error(`Invalid --max-pages value: ${values['max-pages']}`);
      process.exit(1);
    }
    cliArgs.maxPages = maxPages;
  }

  if (values['max-forms']) {
    const maxForms = Number(values['max-forms']);
    if (!Number.isFinite(maxForms) || maxForms < 1) {
      console.error(`Invalid --max-forms value: ${values['max-forms']}`);
      process.exit(1);
    }
    cliArgs.maxForms = maxForms;
  }

  if (values['max-budget']) {
    const maxBudget = Number(values['max-budget']);
    if (!Number.isFinite(maxBudget) || maxBudget < 0) {
      console.error(`Invalid --max-budget value: ${values['max-budget']}`);
      process.exit(1);
    }
    cliArgs.maxBudgetUsd = maxBudget;
  }

  if (values.timeout) {
    const timeout = Number(values.timeout);
    if (!Number.isFinite(timeout) || timeout < 1) {
      console.error(`Invalid --timeout value: ${values.timeout}`);
      process.exit(1);
    }
    cliArgs.timeoutPerPhase = timeout;
  }

  if (values.issue) {
    cliArgs.issue = values.issue;
  }

  if (values.finding) {
    // --finding takes precedence if both provided
    cliArgs.issue = values.finding;
  }

  if (values['safe-mode']) {
    const safeMode = values['safe-mode'].toLowerCase();
    if (['true', '1', 'yes'].includes(safeMode)) {
      cliArgs.safeMode = true;
    } else if (['false', '0', 'no'].includes(safeMode)) {
      cliArgs.safeMode = false;
    } else {
      console.error(`Invalid --safe-mode value: ${values['safe-mode']}. Must be true/false/1/0/yes/no.`);
      process.exit(1);
    }
  }

  return cliArgs;
}

/**
 * Main entry point - parses arguments and runs the audit.
 */
export async function main(): Promise<void> {
  const cliArgs = parseCliArgs();

  // Extract command (audit or verify) if present
  const command = process.argv[2];
  const actualCommand = command && !command.startsWith('--') ? command : 'audit';

  // Detect CI environment for non-interactive mode
  if (process.env.CI && !cliArgs.nonInteractive) {
    console.log('CI environment detected - enabling non-interactive mode');
  }

  // Build the final configuration
  const config = buildConfig(cliArgs);

  // Validate required fields
  if (!config.url) {
    console.error('Error: --url is required');
    console.error('Run with --help for usage information');
    process.exit(1);
  }

  if (!config.codebasePath) {
    console.error('Error: --codebase-path is required (or set AUDIT_CODEBASE_PATH)');
    console.error('Run with --help for usage information');
    process.exit(1);
  }

  // Handle commands
  if (actualCommand === 'audit') {
    console.log('Starting audit...');
    console.log('');

    const result = await runAudit(config);

    console.log('');
    console.log('='.repeat(80));
    console.log('Audit Complete');
    console.log('='.repeat(80));
    console.log(`Status: ${result.success ? 'SUCCESS' : 'FAILED'}`);
    console.log(`Phases: ${result.phasesCompleted}/${result.phasesTotal} completed`);
    console.log(`Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s`);
    console.log(`Cost: $${result.totalCostUsd.toFixed(4)}`);
    console.log(`Output: ${result.auditDir}`);

    if (result.reportPath) {
      console.log(`Report: ${result.reportPath}`);
    }

    if (result.error) {
      console.log(`Error: ${result.error}`);
    }

    console.log('='.repeat(80));

    process.exit(result.success ? 0 : 1);
  } else if (actualCommand === 'verify') {
    if (!cliArgs.issue) {
      console.error('Error: --issue <number> or --finding <id> is required for the verify command');
      console.error('Examples:');
      console.error('  verify --issue 42 --url http://localhost:3000 --codebase-path ./my-app');
      console.error('  verify --finding F-001 --url http://localhost:3000 --codebase-path ./my-app');
      process.exit(1);
    }

    console.log(`Starting verification for issue/finding: ${cliArgs.issue}`);
    console.log('');

    const verifyResult = await runVerify(config, cliArgs.issue);

    console.log('');
    console.log('='.repeat(80));
    console.log('Verification Complete');
    console.log('='.repeat(80));
    console.log(`Finding: ${verifyResult.findingId}`);
    console.log(`Status: ${verifyResult.status}`);
    console.log(`Duration: ${(verifyResult.durationMs / 1000).toFixed(1)}s`);

    if (verifyResult.notes) {
      console.log(`Notes: ${verifyResult.notes}`);
    }

    if (verifyResult.error) {
      console.log(`Error: ${verifyResult.error}`);
    }

    console.log('='.repeat(80));

    const exitCode = verifyResult.status === 'fixed' ? 0 : 1;
    process.exit(exitCode);
  } else {
    console.error(`Error: unknown command '${actualCommand}'`);
    console.error('Run with --help for usage information');
    process.exit(1);
  }
}

// Run main if this is the entry point
if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
