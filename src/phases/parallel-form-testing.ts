/**
 * Parallel Form Testing - Fan-out form testing across forms.
 *
 * Creates one job per form and runs them through the JobRunner
 * with BrowserQueue integration.
 *
 * @module phases/parallel-form-testing
 */

import fs from 'node:fs';
import { getFindingDir, getCodeAnalysisPath } from '../artifact-paths';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParallelFormTestConfig {
  auditDir: string;
  baseUrl: string;
  maxForms: number;
  promptPath: string;
  auditId: string;
  safeMode: boolean;
  concurrency: number;
}

export interface ParallelFormTestResult {
  formsTested: number;
  totalFindings: number;
  errors: string[];
}

interface FormDef {
  id: string;
  action: string;
  method: string;
  fields: string[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Run parallel form testing.
 */
export async function runParallelFormTesting(
  config: ParallelFormTestConfig,
  jobRunner: (
    jobs: Array<{ id: string; name: string; execute: () => Promise<unknown>; requiresBrowser: boolean }>,
    options: { concurrency: number; timeout: number; maxRetries: number; retryBackoff: 'exponential' | 'linear' },
  ) => Promise<Array<{ jobId: string; status: string; output?: unknown; error?: string }>>,
  createFormTestJob: (form: FormDef, index: number) => () => Promise<unknown>,
): Promise<ParallelFormTestResult> {
  const result: ParallelFormTestResult = {
    formsTested: 0,
    totalFindings: 0,
    errors: [],
  };

  // Load forms
  const forms = loadForms(config.auditDir).slice(0, config.maxForms);

  if (forms.length === 0) {
    console.log('[ParallelFormTesting] No forms to test.');
    return result;
  }

  console.log(
    `[ParallelFormTesting] Testing ${forms.length} form(s), concurrency: ${config.concurrency}`,
  );

  // Create one job per form
  const jobs = forms.map((form, i) => ({
    id: `form-test-${form.id}`,
    name: `Test form: ${form.id}`,
    execute: createFormTestJob(form, i),
    requiresBrowser: true,
  }));

  // Run through JobRunner
  const jobResults = await jobRunner(jobs, {
    concurrency: config.concurrency,
    timeout: 180_000, // 3 min per form
    maxRetries: 2,
    retryBackoff: 'exponential',
  });

  for (const jr of jobResults) {
    if (jr.status === 'completed') {
      result.formsTested++;
    } else if (jr.error) {
      result.errors.push(`${jr.jobId}: ${jr.error}`);
    }
  }

  // Count total findings
  const findingDir = getFindingDir(config.auditDir);
  if (fs.existsSync(findingDir)) {
    result.totalFindings = fs.readdirSync(findingDir)
      .filter(f => f.endsWith('.json')).length;
  }

  console.log(
    `[ParallelFormTesting] Complete: ${result.formsTested} forms, ${result.totalFindings} findings.`,
  );

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadForms(auditDir: string): FormDef[] {
  const caPath = getCodeAnalysisPath(auditDir);
  if (!fs.existsSync(caPath)) return [];

  try {
    const data = JSON.parse(fs.readFileSync(caPath, 'utf-8'));
    if (Array.isArray(data.forms)) {
      return data.forms.map((f: Record<string, unknown>, i: number) => ({
        id: (f.id as string) ?? `form-${i}`,
        action: (f.action as string) ?? '',
        method: (f.method as string) ?? 'POST',
        fields: Array.isArray(f.fields) ? f.fields as string[] : [],
      }));
    }
    return [];
  } catch {
    return [];
  }
}
