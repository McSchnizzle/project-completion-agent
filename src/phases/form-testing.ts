/**
 * Form Testing Phase - Tests forms discovered during exploration.
 *
 * Generates test plans for each form and delegates to the Claude agent
 * for browser-based testing. Produces finding files for issues discovered.
 *
 * @module phases/form-testing
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  getFindingDir,
  getCodeAnalysisPath,
  getTestDataPath,
} from '../artifact-paths';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FormTestConfig {
  auditDir: string;
  baseUrl: string;
  maxForms: number;
  promptPath: string;
  auditId: string;
  safeMode: boolean;
}

export interface FormTestResult {
  formsTested: number;
  findingsCreated: number;
  testDataItems: string[];
  errors: string[];
}

interface FormDefinition {
  id: string;
  action: string;
  method: string;
  fields: string[];
  file?: string;
  url?: string;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Run form testing phase.
 *
 * @param config - Form testing configuration.
 * @param runClaudePhase - SDK bridge function.
 * @returns Form testing results.
 */
export async function runFormTesting(
  config: FormTestConfig,
  runClaudePhase: (phaseConfig: {
    phaseName: string;
    promptPath: string;
    inputContext: Record<string, unknown>;
    requiresBrowser: boolean;
    maxRetries: number;
    budgetUsd: number;
  }) => Promise<{ success: boolean; output: unknown; error?: string }>,
): Promise<FormTestResult> {
  const result: FormTestResult = {
    formsTested: 0,
    findingsCreated: 0,
    testDataItems: [],
    errors: [],
  };

  // Load forms from code analysis
  const forms = loadForms(config.auditDir);
  const formsToTest = forms.slice(0, config.maxForms);

  if (formsToTest.length === 0) {
    console.log('[FormTesting] No forms found to test.');
    return result;
  }

  console.log(
    `[FormTesting] Testing ${formsToTest.length} form(s) (max ${config.maxForms})`,
  );

  // Ensure finding directory exists
  fs.mkdirSync(getFindingDir(config.auditDir), { recursive: true });

  // Call Claude agent with form testing prompt
  const phaseResult = await runClaudePhase({
    phaseName: 'form-testing',
    promptPath: config.promptPath,
    inputContext: {
      baseUrl: config.baseUrl,
      forms: formsToTest,
      auditId: config.auditId,
      safeMode: config.safeMode,
      auditDir: config.auditDir,
      testTypes: [
        'empty-submit',
        'boundary-values',
        'special-characters',
        'xss-vectors',
        'sql-injection',
        'valid-data',
        'field-validation',
      ],
    },
    requiresBrowser: true,
    maxRetries: 2,
    budgetUsd: 1.5,
  });

  if (!phaseResult.success) {
    result.errors.push(phaseResult.error ?? 'Form testing failed');
    return result;
  }

  result.formsTested = formsToTest.length;

  // Count findings created by the agent
  const findingDir = getFindingDir(config.auditDir);
  if (fs.existsSync(findingDir)) {
    const findingFiles = fs.readdirSync(findingDir).filter(f => f.endsWith('.json'));
    result.findingsCreated = findingFiles.length;
  }

  // Track test data
  writeTestDataRecord(config.auditDir, config.auditId, formsToTest);

  console.log(
    `[FormTesting] Complete: ${result.formsTested} forms tested, ${result.findingsCreated} findings.`,
  );

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadForms(auditDir: string): FormDefinition[] {
  const caPath = getCodeAnalysisPath(auditDir);
  if (!fs.existsSync(caPath)) return [];

  try {
    const data = JSON.parse(fs.readFileSync(caPath, 'utf-8'));
    if (Array.isArray(data.forms)) {
      return data.forms.map((f: Record<string, unknown>, i: number) => ({
        id: f.id ?? `form-${i}`,
        action: f.action ?? '',
        method: f.method ?? 'POST',
        fields: Array.isArray(f.fields) ? f.fields : [],
        file: f.file as string | undefined,
        url: f.url as string | undefined,
      }));
    }
    return [];
  } catch {
    return [];
  }
}

function writeTestDataRecord(
  auditDir: string,
  auditId: string,
  forms: FormDefinition[],
): void {
  const record = {
    auditId,
    createdAt: new Date().toISOString(),
    items: forms.map(f => ({
      formId: f.id,
      testDataPrefix: `${auditId}-`,
      fields: f.fields,
    })),
  };

  fs.writeFileSync(
    getTestDataPath(auditDir),
    JSON.stringify(record, null, 2),
    'utf-8',
  );
}
