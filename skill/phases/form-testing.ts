/**
 * Form Testing Phase - Form Discovery and Testing Orchestration
 * Task B.7: Form Testing Orchestration
 *
 * Merges forms from code analysis and browser discovery,
 * generates test plans respecting safe mode, and records results.
 */

import * as fs from 'fs';
import * as path from 'path';
import { FormInfo as CodeFormInfo } from './code-analysis';
import { FormInventory, FormFieldInventory } from './exploration';
import { SafetyConfig, canTestForm, logSafetyDecision } from './safety';
import {
  TestCase
} from '../testing/form-tester';

export interface UnifiedFormInfo {
  id: string;
  url: string;
  action: string;
  method: string;
  source: 'code' | 'browser' | 'both';
  fields: UnifiedFormField[];
  submit_selector: string | null;
  classification: string | null;
  test_priority: number;
}

export interface UnifiedFormField {
  name: string;
  type: string;
  label: string | null;
  required: boolean;
  validation_pattern: string | null;
  placeholder: string | null;
  options: string[] | null;
}

export interface FormTestPlan {
  schema_version: string;
  created_at: string;
  total_forms: number;
  testable_forms: number;
  skipped_forms: number;
  forms: FormTestPlanEntry[];
  safe_mode: boolean;
  max_submissions: number;
}

export interface FormTestPlanEntry {
  form_id: string;
  url: string;
  action: string;
  method: string;
  will_test: boolean;
  skip_reason: string | null;
  test_cases: TestCase[];
  priority: number;
}

export interface FormTestResultEntry {
  form_id: string;
  url: string;
  test_case_id: string;
  input_values: Record<string, string>;
  success: boolean;
  validation_triggered: boolean;
  error_messages: string[];
  response_status: number | null;
  response_url: string | null;
  screenshot_id: string | null;
  tested_at: string;
  duration_ms: number;
}

export interface FormTestSummary {
  schema_version: string;
  completed_at: string;
  total_forms: number;
  forms_tested: number;
  forms_skipped: number;
  total_test_cases: number;
  test_cases_passed: number;
  test_cases_failed: number;
  findings_generated: number;
  results: FormTestResultEntry[];
}

/**
 * Merge forms from code analysis and browser discovery
 */
export function mergeFormSources(
  codeForms: CodeFormInfo[],
  browserForms: FormInventory[],
  pageUrls: Map<string, string> // formId -> pageUrl
): UnifiedFormInfo[] {
  const mergedForms: UnifiedFormInfo[] = [];
  const seenIds = new Set<string>();

  // Process code-discovered forms
  for (const form of codeForms) {
    const id = form.id;
    seenIds.add(id);

    mergedForms.push({
      id,
      url: form.source_file, // Will be updated if browser form found
      action: form.action,
      method: form.method,
      source: 'code',
      fields: form.fields.map(f => ({
        name: f.name,
        type: f.type,
        label: null,
        required: f.required,
        validation_pattern: f.validation || null,
        placeholder: null,
        options: null
      })),
      submit_selector: form.submit_handler ? `[onclick="${form.submit_handler}"]` : 'button[type="submit"]',
      classification: null,
      test_priority: 50
    });
  }

  // Process browser-discovered forms
  for (const form of browserForms) {
    const pageUrl = pageUrls.get(form.id) || '';

    // Check if already found in code
    const existingIndex = mergedForms.findIndex(f =>
      f.action === form.action && f.method === form.method
    );

    if (existingIndex >= 0) {
      // Merge with existing
      const existing = mergedForms[existingIndex];
      existing.source = 'both';
      existing.url = pageUrl;
      existing.fields = mergeFields(existing.fields, form.fields);
      existing.submit_selector = form.submit_button?.selector || existing.submit_selector;
      existing.test_priority = 70; // Higher priority if found in both
    } else {
      // Add new form from browser
      mergedForms.push({
        id: form.id,
        url: pageUrl,
        action: form.action,
        method: form.method,
        source: 'browser',
        fields: form.fields.map(f => ({
          name: f.name,
          type: f.type,
          label: f.label,
          required: f.required,
          validation_pattern: f.validation_pattern,
          placeholder: f.placeholder,
          options: null
        })),
        submit_selector: form.submit_button?.selector || 'button[type="submit"]',
        classification: null,
        test_priority: 60
      });
    }
  }

  // Sort by priority
  mergedForms.sort((a, b) => b.test_priority - a.test_priority);

  return mergedForms;
}

/**
 * Merge field information from multiple sources
 */
function mergeFields(
  codeFields: UnifiedFormField[],
  browserFields: FormFieldInventory[]
): UnifiedFormField[] {
  const merged: UnifiedFormField[] = [];
  const fieldsByName = new Map<string, UnifiedFormField>();

  // Add code fields first
  for (const field of codeFields) {
    fieldsByName.set(field.name, field);
  }

  // Merge browser fields
  for (const field of browserFields) {
    const existing = fieldsByName.get(field.name);
    if (existing) {
      // Merge - browser info takes precedence for runtime details
      existing.label = field.label || existing.label;
      existing.placeholder = field.placeholder || existing.placeholder;
      existing.validation_pattern = field.validation_pattern || existing.validation_pattern;
      existing.required = field.required || existing.required;
    } else {
      fieldsByName.set(field.name, {
        name: field.name,
        type: field.type,
        label: field.label,
        required: field.required,
        validation_pattern: field.validation_pattern,
        placeholder: field.placeholder,
        options: null
      });
    }
  }

  return Array.from(fieldsByName.values());
}

/**
 * Generate simplified test cases for a form
 */
function generateSimpleTestCases(form: UnifiedFormInfo, safeMode: boolean): TestCase[] {
  const testCases: TestCase[] = [];

  // In safe mode, don't generate test cases for forms that might modify data
  if (safeMode && form.method !== 'GET') {
    return [];
  }

  // Generate a basic happy path test case
  const happyPathInputs: Record<string, string | number | boolean> = {};
  for (const field of form.fields) {
    happyPathInputs[field.name] = getTestValueForField(field);
  }

  testCases.push({
    name: 'Happy path - valid inputs',
    description: `Submit form with valid data`,
    inputs: happyPathInputs,
    expectedResult: 'success',
    category: 'happy_path'
  });

  // Generate an empty required fields test
  const requiredFields = form.fields.filter(f => f.required);
  if (requiredFields.length > 0) {
    testCases.push({
      name: 'Validation - missing required fields',
      description: 'Submit form with empty required fields',
      inputs: {},
      expectedResult: 'validation_error',
      category: 'error_handling'
    });
  }

  return testCases;
}

/**
 * Get a test value for a field based on its type
 */
function getTestValueForField(field: UnifiedFormField): string {
  switch (field.type.toLowerCase()) {
    case 'email':
      return 'test@example.com';
    case 'password':
      return 'TestPassword123!';
    case 'tel':
    case 'phone':
      return '555-123-4567';
    case 'number':
      return '42';
    case 'url':
      return 'https://example.com';
    case 'date':
      return '2024-01-15';
    case 'checkbox':
      return 'true';
    default:
      return field.placeholder || 'test value';
  }
}

/**
 * Generate form test plan respecting safety config
 */
export function generateFormTestPlan(
  forms: UnifiedFormInfo[],
  safetyConfig: SafetyConfig
): FormTestPlan {
  const plan: FormTestPlan = {
    schema_version: '1.0.0',
    created_at: new Date().toISOString(),
    total_forms: forms.length,
    testable_forms: 0,
    skipped_forms: 0,
    forms: [],
    safe_mode: safetyConfig.safe_mode,
    max_submissions: safetyConfig.max_form_submissions
  };

  let submissionCount = 0;

  for (const form of forms) {
    // Check if form can be tested
    const safetyCheck = canTestForm(form.action, form.method, safetyConfig);

    if (safetyCheck.skip) {
      logSafetyDecision(
        `Form ${form.id}: ${form.method} ${form.action}`,
        'skipped',
        safetyCheck.reason,
        safetyConfig
      );

      plan.forms.push({
        form_id: form.id,
        url: form.url,
        action: form.action,
        method: form.method,
        will_test: false,
        skip_reason: safetyCheck.reason,
        test_cases: [],
        priority: form.test_priority
      });
      plan.skipped_forms++;
      continue;
    }

    // Check submission limit
    if (submissionCount >= safetyConfig.max_form_submissions && form.method !== 'GET') {
      plan.forms.push({
        form_id: form.id,
        url: form.url,
        action: form.action,
        method: form.method,
        will_test: false,
        skip_reason: `Submission limit reached (${safetyConfig.max_form_submissions})`,
        test_cases: [],
        priority: form.test_priority
      });
      plan.skipped_forms++;
      continue;
    }

    // Generate simplified test cases
    const testCases = generateSimpleTestCases(form, safetyConfig.safe_mode);

    plan.forms.push({
      form_id: form.id,
      url: form.url,
      action: form.action,
      method: form.method,
      will_test: true,
      skip_reason: null,
      test_cases: testCases,
      priority: form.test_priority
    });
    plan.testable_forms++;

    if (form.method !== 'GET') {
      submissionCount++;
    }
  }

  return plan;
}

/**
 * Record a form test result
 */
export function recordFormTestResult(
  formId: string,
  url: string,
  testCaseId: string,
  inputValues: Record<string, string>,
  success: boolean,
  validationTriggered: boolean,
  errorMessages: string[],
  responseStatus: number | null,
  responseUrl: string | null,
  screenshotId: string | null,
  durationMs: number
): FormTestResultEntry {
  return {
    form_id: formId,
    url,
    test_case_id: testCaseId,
    input_values: inputValues,
    success,
    validation_triggered: validationTriggered,
    error_messages: errorMessages,
    response_status: responseStatus,
    response_url: responseUrl,
    screenshot_id: screenshotId,
    tested_at: new Date().toISOString(),
    duration_ms: durationMs
  };
}

/**
 * Generate test summary
 */
export function generateFormTestSummary(
  results: FormTestResultEntry[],
  plan: FormTestPlan
): FormTestSummary {
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  // Count findings (failed tests that found issues)
  const findingsGenerated = results.filter(r =>
    !r.success && r.error_messages.length > 0
  ).length;

  return {
    schema_version: '1.0.0',
    completed_at: new Date().toISOString(),
    total_forms: plan.total_forms,
    forms_tested: plan.testable_forms,
    forms_skipped: plan.skipped_forms,
    total_test_cases: results.length,
    test_cases_passed: passed,
    test_cases_failed: failed,
    findings_generated: findingsGenerated,
    results
  };
}

/**
 * Write form test plan to file
 */
export function writeFormTestPlan(auditPath: string, plan: FormTestPlan): void {
  const planPath = path.join(auditPath, 'form-test-plan.json');
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
}

/**
 * Write form test summary to file
 */
export function writeFormTestSummary(auditPath: string, summary: FormTestSummary): void {
  const summaryPath = path.join(auditPath, 'form-test-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
}

/**
 * Load form test plan
 */
export function loadFormTestPlan(auditPath: string): FormTestPlan | null {
  const planPath = path.join(auditPath, 'form-test-plan.json');
  if (!fs.existsSync(planPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(planPath, 'utf-8')) as FormTestPlan;
  } catch {
    return null;
  }
}

/**
 * Load form test summary
 */
export function loadFormTestSummary(auditPath: string): FormTestSummary | null {
  const summaryPath = path.join(auditPath, 'form-test-summary.json');
  if (!fs.existsSync(summaryPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as FormTestSummary;
  } catch {
    return null;
  }
}

/**
 * Get forms that need testing
 */
export function getFormsToTest(plan: FormTestPlan): FormTestPlanEntry[] {
  return plan.forms.filter(f => f.will_test);
}

/**
 * Get skipped forms with reasons
 */
export function getSkippedForms(plan: FormTestPlan): Array<{ form_id: string; reason: string }> {
  return plan.forms
    .filter(f => !f.will_test)
    .map(f => ({ form_id: f.form_id, reason: f.skip_reason || 'Unknown' }));
}

/**
 * Calculate form testing coverage
 */
export function calculateFormTestCoverage(summary: FormTestSummary): {
  form_coverage: number;
  test_pass_rate: number;
  validation_coverage: number;
} {
  const formCoverage = summary.total_forms > 0
    ? Math.round((summary.forms_tested / summary.total_forms) * 100)
    : 100;

  const testPassRate = summary.total_test_cases > 0
    ? Math.round((summary.test_cases_passed / summary.total_test_cases) * 100)
    : 100;

  // Calculate validation coverage (tests that triggered validation)
  const validationTests = summary.results.filter(r => r.validation_triggered);
  const validationCoverage = summary.total_test_cases > 0
    ? Math.round((validationTests.length / summary.total_test_cases) * 100)
    : 0;

  return {
    form_coverage: formCoverage,
    test_pass_rate: testPassRate,
    validation_coverage: validationCoverage
  };
}
