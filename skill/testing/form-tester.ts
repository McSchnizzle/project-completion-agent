/**
 * Form Tester
 * Task 3.2: Form Testing Strategies
 * Task 6.9: Form Testing Safe/Full Modes
 *
 * Tests forms with various input strategies:
 * - Valid data submission
 * - Boundary testing
 * - Validation bypass attempts
 * - Error message verification
 *
 * Supports two testing modes:
 * - SAFE: Read-only analysis, no form submission (default)
 * - FULL: Full testing including form submission
 */

export type FormTestMode = 'safe' | 'full';

export interface FormTestConfig {
  mode: FormTestMode;
  skip_auth_forms: boolean;
  skip_delete_forms: boolean;
  skip_payment_forms: boolean;
  max_tests_per_form: number;
  timeout_ms: number;
}

export const DEFAULT_SAFE_CONFIG: FormTestConfig = {
  mode: 'safe',
  skip_auth_forms: true,
  skip_delete_forms: true,
  skip_payment_forms: true,
  max_tests_per_form: 0, // No submissions in safe mode
  timeout_ms: 5000
};

export const DEFAULT_FULL_CONFIG: FormTestConfig = {
  mode: 'full',
  skip_auth_forms: false,
  skip_delete_forms: true, // Still skip delete by default
  skip_payment_forms: true, // Always skip payment forms
  max_tests_per_form: 10,
  timeout_ms: 10000
};

export interface FormField {
  name: string;
  type: string;
  required: boolean;
  maxlength: number | null;
  pattern: string | null;
  min: number | null;
  max: number | null;
  placeholder: string | null;
  ref: string; // Element reference for interaction
}

export interface FormInfo {
  id: string;
  action: string | null;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  fields: FormField[];
  submitButton: { ref: string; text: string } | null;
  classification: 'CREATE' | 'UPDATE' | 'DELETE' | 'SEARCH' | 'AUTH' | 'UNKNOWN';
}

export interface TestCase {
  name: string;
  description: string;
  inputs: Record<string, string | number | boolean>;
  expectedResult: 'success' | 'validation_error' | 'server_error';
  category: 'happy_path' | 'boundary' | 'security' | 'error_handling';
}

export interface TestResult {
  testCase: TestCase;
  passed: boolean;
  actualResult: 'success' | 'validation_error' | 'server_error' | 'unexpected';
  errorMessage: string | null;
  screenshot: string | null;
  findings: Array<{
    type: string;
    severity: 'P1' | 'P2' | 'P3' | 'P4';
    message: string;
  }>;
}

// Test data generators
const TEST_DATA_GENERATORS = {
  email: {
    valid: ['test@example.com', 'user.name+tag@domain.co.uk'],
    invalid: ['invalid', '@no-local.com', 'no-at-sign.com', 'no@tld', '<script>@xss.com'],
    boundary: ['a@b.co', 'x'.repeat(64) + '@example.com']
  },
  password: {
    valid: ['SecureP@ss123', 'MyP@ssword1!'],
    invalid: ['123', 'short', 'nouppercase1!', 'NOLOWERCASE1!', 'NoNumbers!!'],
    boundary: ['Ab1!xxxx', 'x'.repeat(128)]
  },
  text: {
    valid: ['Valid input', 'Another test'],
    invalid: [],
    boundary: ['', ' ', 'x'.repeat(10000), '🎉'.repeat(100)]
  },
  number: {
    valid: [42, 100, 0],
    invalid: ['abc', 'NaN', '1e999'],
    boundary: [-1, 0, 1, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]
  },
  url: {
    valid: ['https://example.com', 'http://localhost:3000/path'],
    invalid: ['not-a-url', 'javascript:alert(1)', 'ftp://old-protocol.com'],
    boundary: ['http://a.co', 'https://example.com/' + 'x'.repeat(2000)]
  },
  phone: {
    valid: ['+1-555-123-4567', '(555) 123-4567', '5551234567'],
    invalid: ['abc', '123', '++++'],
    boundary: ['1', '+'.repeat(20)]
  },
  date: {
    valid: ['2024-01-15', '2024-12-31'],
    invalid: ['invalid', '2024-13-01', '2024-00-15'],
    boundary: ['1900-01-01', '2100-12-31', '0001-01-01']
  }
};

// XSS payloads for security testing
const XSS_PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '"><script>alert(1)</script>',
  "'-alert(1)-'",
  '{{constructor.constructor("alert(1)")()}}',
  '${alert(1)}',
  '<svg onload=alert(1)>'
];

// SQL injection payloads
const SQL_INJECTION_PAYLOADS = [
  "' OR '1'='1",
  "'; DROP TABLE users; --",
  "1; SELECT * FROM users",
  "1 UNION SELECT * FROM users",
  "' OR 1=1--"
];

/**
 * Classify form based on fields and context
 */
export function classifyForm(form: FormInfo, pageUrl: string): FormInfo['classification'] {
  const fieldNames = form.fields.map(f => f.name.toLowerCase());
  const fieldTypes = form.fields.map(f => f.type.toLowerCase());

  // Auth forms
  if (
    (fieldNames.includes('email') || fieldNames.includes('username')) &&
    (fieldNames.includes('password') || fieldTypes.includes('password'))
  ) {
    if (fieldNames.includes('confirm') || fieldNames.includes('password_confirmation')) {
      return 'CREATE'; // Registration
    }
    return 'AUTH';
  }

  // Search forms
  if (
    fieldNames.some(n => n.includes('search') || n.includes('query') || n === 'q') ||
    form.method === 'GET'
  ) {
    return 'SEARCH';
  }

  // Delete forms
  if (
    pageUrl.includes('delete') ||
    form.action?.includes('delete') ||
    form.fields.some(f => f.name.includes('delete'))
  ) {
    return 'DELETE';
  }

  // Update vs Create
  if (pageUrl.includes('edit') || pageUrl.includes('update') || form.method === 'PUT' || form.method === 'PATCH') {
    return 'UPDATE';
  }

  if (fieldNames.length > 2 && form.method === 'POST') {
    return 'CREATE';
  }

  return 'UNKNOWN';
}

/**
 * Generate test cases for a form
 */
export function generateTestCases(form: FormInfo): TestCase[] {
  const testCases: TestCase[] = [];

  // 1. Happy path - valid data
  testCases.push({
    name: 'Valid submission',
    description: 'Submit form with all valid data',
    inputs: generateValidInputs(form.fields),
    expectedResult: 'success',
    category: 'happy_path'
  });

  // 2. Required field validation
  for (const field of form.fields.filter(f => f.required)) {
    testCases.push({
      name: `Missing required: ${field.name}`,
      description: `Submit without required field ${field.name}`,
      inputs: {
        ...generateValidInputs(form.fields),
        [field.name]: ''
      },
      expectedResult: 'validation_error',
      category: 'error_handling'
    });
  }

  // 3. Boundary testing
  for (const field of form.fields) {
    const boundaries = getBoundaryValues(field);

    for (const { name, value } of boundaries) {
      testCases.push({
        name: `Boundary: ${field.name} - ${name}`,
        description: `Test ${field.name} with ${name}`,
        inputs: {
          ...generateValidInputs(form.fields),
          [field.name]: value
        },
        expectedResult: name.includes('invalid') ? 'validation_error' : 'success',
        category: 'boundary'
      });
    }
  }

  // 4. Security testing (only for text/textarea fields)
  const textFields = form.fields.filter(f =>
    ['text', 'textarea', 'search', 'url'].includes(f.type)
  );

  if (textFields.length > 0 && form.classification !== 'SEARCH') {
    const targetField = textFields[0];

    // XSS tests
    testCases.push({
      name: 'XSS attempt',
      description: 'Test for XSS vulnerability',
      inputs: {
        ...generateValidInputs(form.fields),
        [targetField.name]: XSS_PAYLOADS[0]
      },
      expectedResult: 'validation_error', // Should be rejected or sanitized
      category: 'security'
    });

    // SQL injection tests (for forms that might hit database)
    // Note: SEARCH forms already excluded by outer condition
    if (form.classification === 'AUTH') {
      testCases.push({
        name: 'SQL injection attempt',
        description: 'Test for SQL injection vulnerability',
        inputs: {
          ...generateValidInputs(form.fields),
          [targetField.name]: SQL_INJECTION_PAYLOADS[0]
        },
        expectedResult: 'validation_error',
        category: 'security'
      });
    }
  }

  return testCases;
}

/**
 * Generate valid inputs for all fields
 */
function generateValidInputs(fields: FormField[]): Record<string, string | number | boolean> {
  const inputs: Record<string, string | number | boolean> = {};

  for (const field of fields) {
    inputs[field.name] = getValidValueForField(field);
  }

  return inputs;
}

/**
 * Get a valid value for a field based on its type
 */
function getValidValueForField(field: FormField): string | number | boolean {
  const type = field.type.toLowerCase();

  switch (type) {
    case 'email':
      return TEST_DATA_GENERATORS.email.valid[0];
    case 'password':
      return TEST_DATA_GENERATORS.password.valid[0];
    case 'number':
    case 'range':
      return field.min !== null ? field.min + 1 : 50;
    case 'tel':
      return TEST_DATA_GENERATORS.phone.valid[0];
    case 'url':
      return TEST_DATA_GENERATORS.url.valid[0];
    case 'date':
      return TEST_DATA_GENERATORS.date.valid[0];
    case 'checkbox':
      return true;
    case 'textarea':
      return 'This is a test message with sufficient content.';
    default:
      // Use placeholder as hint or generate from name
      if (field.placeholder) {
        return field.placeholder.replace(/e\.g\.|example/gi, '').trim() || 'Test value';
      }
      if (field.name.includes('name')) return 'Test User';
      if (field.name.includes('title')) return 'Test Title';
      if (field.name.includes('description')) return 'Test description text';
      return 'Test value';
  }
}

/**
 * Get boundary test values for a field
 */
function getBoundaryValues(field: FormField): Array<{ name: string; value: string | number }> {
  const values: Array<{ name: string; value: string | number }> = [];
  const type = field.type.toLowerCase();

  // Empty value (if not required)
  if (!field.required) {
    values.push({ name: 'empty', value: '' });
  }

  // Max length tests
  if (field.maxlength) {
    values.push({
      name: 'at_maxlength',
      value: 'x'.repeat(field.maxlength)
    });
    values.push({
      name: 'over_maxlength_invalid',
      value: 'x'.repeat(field.maxlength + 10)
    });
  }

  // Number boundaries
  if (type === 'number' || type === 'range') {
    if (field.min !== null) {
      values.push({ name: 'at_min', value: field.min });
      values.push({ name: 'below_min_invalid', value: field.min - 1 });
    }
    if (field.max !== null) {
      values.push({ name: 'at_max', value: field.max });
      values.push({ name: 'above_max_invalid', value: field.max + 1 });
    }
  }

  // Type-specific boundaries
  const generator = TEST_DATA_GENERATORS[type as keyof typeof TEST_DATA_GENERATORS];
  if (generator) {
    for (const val of generator.boundary || []) {
      values.push({
        name: `boundary_${String(val).substring(0, 20)}`,
        value: val as string | number
      });
    }
  }

  return values;
}

/**
 * Analyze test result and generate findings
 */
export function analyzeTestResult(
  testCase: TestCase,
  actualResult: TestResult['actualResult'],
  responseContent: string | null
): TestResult['findings'] {
  const findings: TestResult['findings'] = [];

  // Check for unexpected results
  if (testCase.expectedResult !== actualResult) {
    if (testCase.category === 'security') {
      // Security test passed when it shouldn't have
      if (actualResult === 'success') {
        const isXss = testCase.name.includes('XSS');
        const isSqli = testCase.name.includes('SQL');

        findings.push({
          type: isXss ? 'xss_vulnerability' : isSqli ? 'sql_injection' : 'security_vulnerability',
          severity: 'P1',
          message: `${testCase.name}: Potentially dangerous input was accepted`
        });
      }
    } else if (testCase.category === 'error_handling') {
      if (actualResult === 'success') {
        findings.push({
          type: 'missing_validation',
          severity: 'P2',
          message: `${testCase.name}: Validation not enforced`
        });
      }
    }
  }

  // Check response content for issues
  if (responseContent) {
    // Check if XSS payload was reflected unescaped
    for (const payload of XSS_PAYLOADS) {
      if (responseContent.includes(payload)) {
        findings.push({
          type: 'reflected_xss',
          severity: 'P1',
          message: 'XSS payload reflected in response without sanitization'
        });
        break;
      }
    }

    // Check for verbose error messages
    if (/stack\s*trace|exception|error\s*at|line\s*\d+/i.test(responseContent)) {
      findings.push({
        type: 'verbose_error',
        severity: 'P3',
        message: 'Verbose error message may leak implementation details'
      });
    }
  }

  return findings;
}

/**
 * Identify validation gaps in a form
 */
export function identifyValidationGaps(form: FormInfo): string[] {
  const gaps: string[] = [];

  for (const field of form.fields) {
    // Email without pattern
    if (field.type === 'email' && !field.pattern) {
      // Browser handles email validation, but custom pattern is better
    }

    // Text field without maxlength
    if ((field.type === 'text' || field.type === 'textarea') && !field.maxlength) {
      gaps.push(`${field.name}: No maximum length specified`);
    }

    // Number field without min/max
    if (field.type === 'number' && field.min === null && field.max === null) {
      gaps.push(`${field.name}: No numeric bounds specified`);
    }

    // Password field requirements
    if (field.type === 'password' && !field.pattern && field.name !== 'current_password') {
      gaps.push(`${field.name}: No password strength pattern`);
    }

    // Required field that should be required
    if (!field.required) {
      const shouldBeRequired = [
        'email', 'password', 'username', 'name', 'title'
      ].some(n => field.name.toLowerCase().includes(n));

      if (shouldBeRequired && form.classification !== 'SEARCH') {
        gaps.push(`${field.name}: Should likely be required`);
      }
    }
  }

  return gaps;
}

/**
 * Determine if a form should be tested based on mode and classification
 * Task 6.9: Form Testing Safe/Full Modes
 */
export function shouldTestForm(
  form: FormInfo,
  config: FormTestConfig = DEFAULT_SAFE_CONFIG
): { should_test: boolean; reason: string } {
  // In safe mode, never submit forms
  if (config.mode === 'safe') {
    return {
      should_test: false,
      reason: 'Safe mode - forms are analyzed but not submitted'
    };
  }

  // Skip auth forms if configured
  if (config.skip_auth_forms && form.classification === 'AUTH') {
    return {
      should_test: false,
      reason: 'Auth forms skipped by configuration'
    };
  }

  // Skip delete forms if configured
  if (config.skip_delete_forms && form.classification === 'DELETE') {
    return {
      should_test: false,
      reason: 'Delete forms skipped by configuration'
    };
  }

  // Always skip payment forms (detect by field names)
  const hasPaymentFields = form.fields.some(f => {
    const name = f.name.toLowerCase();
    return name.includes('card') ||
           name.includes('cvv') ||
           name.includes('cvc') ||
           name.includes('payment') ||
           name.includes('credit') ||
           name.includes('billing');
  });

  if (config.skip_payment_forms && hasPaymentFields) {
    return {
      should_test: false,
      reason: 'Payment forms are never submitted automatically'
    };
  }

  // Check for dangerous actions in form action URL
  const dangerousPatterns = ['delete', 'remove', 'destroy', 'cancel', 'deactivate'];
  if (form.action) {
    const actionLower = form.action.toLowerCase();
    for (const pattern of dangerousPatterns) {
      if (actionLower.includes(pattern)) {
        return {
          should_test: false,
          reason: `Form action contains dangerous pattern: ${pattern}`
        };
      }
    }
  }

  return {
    should_test: true,
    reason: 'Form can be tested'
  };
}

/**
 * Perform safe-mode analysis of a form (no submission)
 */
export function analyzeFormSafe(form: FormInfo, pageUrl: string): {
  classification: FormInfo['classification'];
  validation_gaps: string[];
  test_cases: TestCase[];
  risk_level: 'low' | 'medium' | 'high';
  recommendations: string[];
} {
  const classification = classifyForm(form, pageUrl);
  const validationGaps = identifyValidationGaps(form);
  const testCases = generateTestCases(form);

  // Determine risk level
  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  if (classification === 'AUTH' || classification === 'DELETE') {
    riskLevel = 'high';
  } else if (classification === 'CREATE' || classification === 'UPDATE') {
    riskLevel = 'medium';
  }

  // Generate recommendations
  const recommendations: string[] = [];

  if (validationGaps.length > 0) {
    recommendations.push(`Fix ${validationGaps.length} validation gaps`);
  }

  if (!form.submitButton) {
    recommendations.push('Form has no visible submit button');
  }

  if (classification === 'AUTH' && !form.fields.some(f => f.type === 'password')) {
    recommendations.push('Auth form missing password field');
  }

  const hasCSRFField = form.fields.some(f =>
    f.name.toLowerCase().includes('csrf') ||
    f.name.toLowerCase().includes('token') ||
    f.name === '_token'
  );

  if (!hasCSRFField && form.method !== 'GET') {
    recommendations.push('Consider adding CSRF protection');
  }

  return {
    classification,
    validation_gaps: validationGaps,
    test_cases: testCases,
    risk_level: riskLevel,
    recommendations
  };
}

/**
 * Get filtered test cases based on config
 */
export function getTestCasesForMode(
  form: FormInfo,
  config: FormTestConfig
): TestCase[] {
  const allCases = generateTestCases(form);

  if (config.mode === 'safe') {
    return []; // No test execution in safe mode
  }

  // Limit number of test cases
  let filteredCases = allCases.slice(0, config.max_tests_per_form);

  // In full mode with skip_auth_forms, skip credential testing
  if (config.skip_auth_forms && form.classification === 'AUTH') {
    filteredCases = filteredCases.filter(tc =>
      tc.category !== 'security' && !tc.name.includes('password')
    );
  }

  return filteredCases;
}

/**
 * Create test config from options
 */
export function createTestConfig(options: Partial<FormTestConfig> = {}): FormTestConfig {
  const baseConfig = options.mode === 'full' ? DEFAULT_FULL_CONFIG : DEFAULT_SAFE_CONFIG;
  return { ...baseConfig, ...options };
}
