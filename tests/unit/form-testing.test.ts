/**
 * Form Testing Unit Tests (T-028)
 * Tests form discovery, test plan generation, and responsive testing
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  mergeFormSources,
  generateFormTestPlan,
  recordFormTestResult,
  generateFormTestSummary,
  writeFormTestPlan,
  loadFormTestPlan,
  getFormsToTest,
  getSkippedForms,
  calculateFormTestCoverage
} from '../../skill/phases/form-testing';
import { FormInfo } from '../../skill/phases/code-analysis';
import { FormInventory } from '../../skill/phases/exploration';
import { createSafetyConfig } from '../../skill/phases/safety';
import {
  VIEWPORT_CONFIGS,
  analyzeViewport,
  prioritizePagesForResponsiveTesting,
  summarizeResponsiveResults
} from '../../skill/testing/responsive-tester';

describe('Form Testing', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-forms-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('mergeFormSources', () => {
    it('should merge forms from code analysis and browser discovery', () => {
      const codeForms: FormInfo[] = [
        {
          id: 'form-1',
          action: '/submit',
          method: 'POST',
          source_file: '/app/form.tsx',
          line_number: 10,
          fields: [
            { name: 'email', type: 'email', required: true, validation: null }
          ],
          submit_handler: 'handleSubmit'
        }
      ];

      const browserForms: FormInventory[] = [
        {
          id: 'browser-form-1',
          action: '/submit',
          method: 'POST',
          fields: [
            {
              name: 'email',
              type: 'email',
              label: 'Email Address',
              required: true,
              validation_pattern: null,
              placeholder: 'you@example.com',
              current_value: null
            }
          ],
          submit_button: {
            type: 'button',
            selector: 'button[type="submit"]',
            text: 'Submit',
            href: null,
            attributes: {}
          }
        }
      ];

      const pageUrls = new Map([['browser-form-1', 'https://example.com/form']]);
      const merged = mergeFormSources(codeForms, browserForms, pageUrls);

      expect(merged.length).toBe(1);
      expect(merged[0].source).toBe('both');
      expect(merged[0].fields[0].label).toBe('Email Address');
      expect(merged[0].test_priority).toBe(70);
    });

    it('should add browser-only forms', () => {
      const codeForms: FormInfo[] = [];
      const browserForms: FormInventory[] = [
        {
          id: 'search-form',
          action: '/search',
          method: 'GET',
          fields: [
            {
              name: 'q',
              type: 'text',
              label: 'Search',
              required: false,
              validation_pattern: null,
              placeholder: 'Search...',
              current_value: null
            }
          ],
          submit_button: null
        }
      ];

      const pageUrls = new Map([['search-form', 'https://example.com/search']]);
      const merged = mergeFormSources(codeForms, browserForms, pageUrls);

      expect(merged.length).toBe(1);
      expect(merged[0].source).toBe('browser');
    });

    it('should prioritize forms found in both sources', () => {
      const codeForms: FormInfo[] = [
        {
          id: 'form-1',
          action: '/login',
          method: 'POST',
          source_file: '/app/login.tsx',
          line_number: 10,
          fields: [],
          submit_handler: null
        }
      ];

      const browserForms: FormInventory[] = [
        {
          id: 'login-form',
          action: '/login',
          method: 'POST',
          fields: [],
          submit_button: null
        }
      ];

      const pageUrls = new Map([['login-form', 'https://example.com/login']]);
      const merged = mergeFormSources(codeForms, browserForms, pageUrls);

      expect(merged[0].test_priority).toBe(70);
    });
  });

  describe('generateFormTestPlan', () => {
    it('should allow GET forms in safe mode', () => {
      const forms = [
        {
          id: 'search-form',
          url: 'https://example.com/search',
          action: '/search',
          method: 'GET',
          source: 'browser' as const,
          fields: [
            {
              name: 'q',
              type: 'text',
              label: 'Search',
              required: false,
              validation_pattern: null,
              placeholder: null,
              options: null
            }
          ],
          submit_selector: 'button[type="submit"]',
          classification: null,
          test_priority: 60
        }
      ];

      const safetyConfig = createSafetyConfig('https://example.com');
      const plan = generateFormTestPlan(forms, safetyConfig);

      expect(plan.safe_mode).toBe(true);
      expect(plan.testable_forms).toBe(1);
      expect(plan.skipped_forms).toBe(0);
    });

    it('should skip POST forms in safe mode', () => {
      const forms = [
        {
          id: 'contact-form',
          url: 'https://example.com/contact',
          action: '/submit',
          method: 'POST',
          source: 'browser' as const,
          fields: [],
          submit_selector: 'button[type="submit"]',
          classification: null,
          test_priority: 60
        }
      ];

      const safetyConfig = createSafetyConfig('https://example.com');
      const plan = generateFormTestPlan(forms, safetyConfig);

      expect(plan.skipped_forms).toBe(1);
      expect(plan.forms[0].will_test).toBe(false);
      expect(plan.forms[0].skip_reason).toContain('Production data');
    });

    it('should limit form submissions', () => {
      const forms = Array.from({ length: 10 }, (_, i) => ({
        id: `form-${i}`,
        url: `https://localhost:3000/form${i}`,
        action: `/submit${i}`,
        method: 'POST',
        source: 'browser' as const,
        fields: [],
        submit_selector: 'button[type="submit"]',
        classification: null,
        test_priority: 60
      }));

      const safetyConfig = createSafetyConfig('http://localhost:3000', false);
      const plan = generateFormTestPlan(forms, safetyConfig);

      const testable = plan.forms.filter(f => f.will_test).length;
      expect(testable).toBeLessThanOrEqual(safetyConfig.max_form_submissions);
    });

    it('should generate test cases for testable forms', () => {
      const forms = [
        {
          id: 'login-form',
          url: 'http://localhost:3000/login',
          action: '/login',
          method: 'GET',
          source: 'browser' as const,
          fields: [
            {
              name: 'email',
              type: 'email',
              label: 'Email',
              required: true,
              validation_pattern: null,
              placeholder: null,
              options: null
            },
            {
              name: 'password',
              type: 'password',
              label: 'Password',
              required: true,
              validation_pattern: null,
              placeholder: null,
              options: null
            }
          ],
          submit_selector: 'button[type="submit"]',
          classification: null,
          test_priority: 70
        }
      ];

      const safetyConfig = createSafetyConfig('http://localhost:3000', false);
      const plan = generateFormTestPlan(forms, safetyConfig);

      expect(plan.forms[0].test_cases.length).toBeGreaterThan(0);
      expect(plan.forms[0].test_cases.some(tc => tc.category === 'happy_path')).toBe(true);
    });
  });

  describe('Form Test Results', () => {
    it('should record form test result', () => {
      const result = recordFormTestResult(
        'form-1',
        'https://example.com/form',
        'test-case-1',
        { email: 'test@example.com' },
        true,
        false,
        [],
        200,
        'https://example.com/success',
        'screenshot-1',
        1500
      );

      expect(result.form_id).toBe('form-1');
      expect(result.success).toBe(true);
      expect(result.duration_ms).toBe(1500);
    });

    it('should generate test summary', () => {
      const results = [
        recordFormTestResult('form-1', 'https://example.com/form', 'tc-1', {}, true, false, [], 200, null, null, 1000),
        recordFormTestResult('form-1', 'https://example.com/form', 'tc-2', {}, false, true, ['Validation error'], null, null, null, 800)
      ];

      const plan = {
        schema_version: '1.0.0',
        created_at: new Date().toISOString(),
        total_forms: 2,
        testable_forms: 1,
        skipped_forms: 1,
        forms: [],
        safe_mode: true,
        max_submissions: 5
      };

      const summary = generateFormTestSummary(results, plan);

      expect(summary.total_test_cases).toBe(2);
      expect(summary.test_cases_passed).toBe(1);
      expect(summary.test_cases_failed).toBe(1);
    });

    it('should calculate form test coverage', () => {
      const summary = {
        schema_version: '1.0.0',
        completed_at: new Date().toISOString(),
        total_forms: 10,
        forms_tested: 7,
        forms_skipped: 3,
        total_test_cases: 20,
        test_cases_passed: 15,
        test_cases_failed: 5,
        findings_generated: 3,
        results: []
      };

      const coverage = calculateFormTestCoverage(summary);

      expect(coverage.form_coverage).toBe(70);
      expect(coverage.test_pass_rate).toBe(75);
    });
  });

  describe('Form Test Persistence', () => {
    it('should persist and load form test plan', () => {
      const plan = {
        schema_version: '1.0.0',
        created_at: new Date().toISOString(),
        total_forms: 1,
        testable_forms: 1,
        skipped_forms: 0,
        forms: [],
        safe_mode: true,
        max_submissions: 5
      };

      writeFormTestPlan(tempDir, plan);
      const loaded = loadFormTestPlan(tempDir);

      expect(loaded).toBeDefined();
      expect(loaded?.total_forms).toBe(1);
    });
  });

  describe('Form Filtering Utilities', () => {
    it('should get forms to test', () => {
      const plan = {
        schema_version: '1.0.0',
        created_at: new Date().toISOString(),
        total_forms: 3,
        testable_forms: 2,
        skipped_forms: 1,
        forms: [
          { form_id: 'f1', url: '', action: '', method: 'GET', will_test: true, skip_reason: null, test_cases: [], priority: 50 },
          { form_id: 'f2', url: '', action: '', method: 'POST', will_test: false, skip_reason: 'Safe mode', test_cases: [], priority: 50 },
          { form_id: 'f3', url: '', action: '', method: 'GET', will_test: true, skip_reason: null, test_cases: [], priority: 50 }
        ],
        safe_mode: true,
        max_submissions: 5
      };

      const testable = getFormsToTest(plan);
      expect(testable.length).toBe(2);
    });

    it('should get skipped forms with reasons', () => {
      const plan = {
        schema_version: '1.0.0',
        created_at: new Date().toISOString(),
        total_forms: 2,
        testable_forms: 1,
        skipped_forms: 1,
        forms: [
          { form_id: 'f1', url: '', action: '', method: 'GET', will_test: true, skip_reason: null, test_cases: [], priority: 50 },
          { form_id: 'f2', url: '', action: '', method: 'POST', will_test: false, skip_reason: 'Production data', test_cases: [], priority: 50 }
        ],
        safe_mode: true,
        max_submissions: 5
      };

      const skipped = getSkippedForms(plan);
      expect(skipped.length).toBe(1);
      expect(skipped[0].reason).toBe('Production data');
    });
  });
});

describe('Responsive Testing', () => {
  describe('Viewport Configurations', () => {
    it('should have standard viewport configs', () => {
      expect(VIEWPORT_CONFIGS.length).toBeGreaterThanOrEqual(4);

      const mobile = VIEWPORT_CONFIGS.find(v => v.name === 'mobile');
      expect(mobile?.width).toBe(375);
      expect(mobile?.height).toBe(667);
      expect(mobile?.isMobile).toBe(true);

      const desktop = VIEWPORT_CONFIGS.find(v => v.name === 'desktop');
      expect(desktop?.width).toBe(1280);
      expect(desktop?.isMobile).toBe(false);
    });
  });

  describe('analyzeViewport', () => {
    it('should detect small text issues', () => {
      const accessibilityTree = [
        {
          role: 'text',
          style: { fontSize: '10px' },
          ref: 'ref_1'
        }
      ];

      const issues = analyzeViewport(accessibilityTree, 375, 667, true);
      expect(issues.some(i => i.type === 'small_text')).toBe(true);
    });

    it('should detect small touch targets on mobile', () => {
      const accessibilityTree = [
        {
          role: 'button',
          bounds: { x: 0, y: 0, width: 30, height: 30 },
          ref: 'ref_1'
        }
      ];

      const issues = analyzeViewport(accessibilityTree, 375, 667, true);
      expect(issues.some(i => i.type === 'touch_target')).toBe(true);
    });

    it('should detect horizontal overflow', () => {
      const accessibilityTree = [
        {
          role: 'div',
          bounds: { x: 0, y: 0, width: 400, height: 100 },
          ref: 'ref_1'
        }
      ];

      const issues = analyzeViewport(accessibilityTree, 375, 667, false);
      expect(issues.some(i => i.type === 'overflow')).toBe(true);
    });

    it('should not flag desktop-size elements on desktop', () => {
      const accessibilityTree = [
        {
          role: 'button',
          bounds: { x: 0, y: 0, width: 100, height: 40 },
          ref: 'ref_1'
        }
      ];

      const issues = analyzeViewport(accessibilityTree, 1280, 800, false);
      expect(issues.length).toBe(0);
    });
  });

  describe('prioritizePagesForResponsiveTesting', () => {
    it('should prioritize home pages', () => {
      const pages = [
        { url: 'https://example.com/about', title: 'About', formsCount: 0 },
        { url: 'https://example.com/', title: 'Home', formsCount: 0 }
      ];

      const prioritized = prioritizePagesForResponsiveTesting(pages);
      expect(prioritized[0]).toBe('https://example.com/');
    });

    it('should prioritize pages with forms', () => {
      const pages = [
        { url: 'https://example.com/about', title: 'About', formsCount: 0 },
        { url: 'https://example.com/contact', title: 'Contact', formsCount: 2 }
      ];

      const prioritized = prioritizePagesForResponsiveTesting(pages);
      expect(prioritized[0]).toBe('https://example.com/contact');
    });

    it('should limit results to reasonable number', () => {
      const pages = Array.from({ length: 50 }, (_, i) => ({
        url: `https://example.com/page${i}`,
        title: `Page ${i}`,
        formsCount: 0
      }));

      const prioritized = prioritizePagesForResponsiveTesting(pages);
      expect(prioritized.length).toBeLessThanOrEqual(10);
    });
  });

  describe('summarizeResponsiveResults', () => {
    it('should summarize issues by viewport and severity', () => {
      const results = [
        {
          viewport: VIEWPORT_CONFIGS[0],
          screenshotId: null,
          issues: [
            { type: 'touch_target' as const, severity: 'P2' as const, element: 'btn', description: 'Small button', details: {} },
            { type: 'small_text' as const, severity: 'P3' as const, element: 'text', description: 'Small text', details: {} }
          ],
          navigationAccessible: true,
          hasOverflow: false,
          loadTime: 1000
        }
      ];

      const summary = summarizeResponsiveResults(results);

      expect(summary.totalIssues).toBe(2);
      expect(summary.issuesBySeverity.P2).toBe(1);
      expect(summary.issuesBySeverity.P3).toBe(1);
      expect(summary.recommendations.length).toBeGreaterThan(0);
    });

    it('should generate recommendations for touch issues', () => {
      const results = [
        {
          viewport: VIEWPORT_CONFIGS[0],
          screenshotId: null,
          issues: Array.from({ length: 5 }, () => ({
            type: 'touch_target' as const,
            severity: 'P2' as const,
            element: 'btn',
            description: 'Small button',
            details: {}
          })),
          navigationAccessible: true,
          hasOverflow: false,
          loadTime: 1000
        }
      ];

      const summary = summarizeResponsiveResults(results);
      expect(summary.recommendations.some(r => r.includes('touch target'))).toBe(true);
    });
  });
});
