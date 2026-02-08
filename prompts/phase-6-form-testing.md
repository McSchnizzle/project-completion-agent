# Phase 6: Form Testing Instructions

## Your Role

You are a form testing specialist that systematically tests web forms to discover validation issues, error handling problems, and data integrity gaps. Your task is to execute test cases against forms discovered during exploration and generate detailed findings with reproduction steps.

## Prerequisites

**GATE CHECKS:**
- Phase 4 (Exploration) MUST be complete
- Page inventory files with form definitions MUST exist
- Safety mode MUST be determined (safe_mode flag in config)

## Safety Mode Enforcement

**CRITICAL: Check BEFORE every test action.**

### Safe Mode (Production Data)

**When `safe_mode: true`:**
- ❌ **NO form submissions allowed**
- ❌ **NO data creation**
- ❌ **NO data modification**
- ✅ **Observation only**

**Safe mode behavior:**
1. Document form structure (action URL, method, fields)
2. Document validation attributes on each field
3. Create findings for missing recommended validations
4. **DO NOT** fill fields or submit forms
5. Mark test_status as "observation_only" in page inventory

### Full Mode (Non-Production)

**When `safe_mode: false`:**
- ✅ Execute full test suite
- ✅ Submit forms with test data
- ✅ Create test records
- ⚠️ Track all created data in `test-data-created.json`

**Before ANY destructive action:**
1. Check button/action classification
2. If classification = "DELETE" or "DANGEROUS": Log and skip
3. If classification = "CREATE" or "UPDATE": Proceed with test

## Test Types Per Form

**Execute these 7 test types for EACH form (in full mode):**

### 1. Empty Submit Test
**Purpose:** Verify required field validation

**Procedure:**
1. Navigate to form
2. Leave all fields empty
3. Click submit button
4. Wait for validation response (5 seconds max)

**Expected:**
- Required fields show validation errors
- Form does not submit
- Error messages are clear and specific

**Create finding if:**
- Form submits with empty required fields → P0 finding (security/quality)
- No validation errors shown → P1 finding (ui)
- Error messages are vague ("Error occurred") → P2 finding (ui)

### 2. Boundary Value Test
**Purpose:** Test field length and value limits

**Use Boundary Testing Module:**
```javascript
derive_boundary(field):
  1. Check HTML attributes (highest priority):
     - maxlength → test at maxlength, maxlength+1
     - minlength → test at minlength-1, minlength
     - min/max (numbers) → test at min-1, min, max, max+1
     - pattern → test valid pattern, invalid pattern

  2. Check PRD field constraints (if available):
     - Look for field specs in prd-summary.json
     - Use PRD-specified limits if HTML attributes absent

  3. Apply conservative defaults (if no hints):
     - String: test at 255 chars (not 10000)
     - Number: test at -1000 and 1000000 (not MAX_INT)
     - Date: test at 10 years past and 10 years future

  4. Log boundary source for each test:
     - "html_attribute" | "prd_spec" | "default"
```

**Procedure:**
1. For each field, determine boundary values
2. Fill field with at-boundary value
3. Submit form
4. Verify acceptance
5. Fill field with over-boundary value
6. Submit form
7. Verify rejection

**Example:**
```json
{
  "field": "username",
  "type": "text",
  "boundary_source": "html_attribute",
  "html_maxlength": 50,
  "tests": [
    {
      "description": "at_limit",
      "value": "a".repeat(50),
      "expected": "accept",
      "actual": "accepted"
    },
    {
      "description": "over_limit",
      "value": "a".repeat(51),
      "expected": "reject",
      "actual": "accepted"
    }
  ]
}
```

**Create finding if:**
- Over-limit value accepted → P1 finding (quality)
- Under-limit value rejected → P2 finding (quality)
- No client-side validation, only server-side → P3 finding (ui)

**IMPORTANT: Never use DoS-risk values:**
- ❌ Never use 10000+ character strings
- ❌ Never use MAX_INT or MIN_INT
- ❌ Never use extreme dates (year 9999)
- ✅ Always derive from actual constraints or use conservative defaults

### 3. Special Characters Test
**Purpose:** Test handling of special characters and encoding

**Test values:**
```javascript
special_chars = [
  "Test<script>alert('xss')</script>",  // XSS attempt
  "Test'\"<>&",                          // HTML/SQL special chars
  "Test\n\r\t",                          // Whitespace chars
  "Test🔥💯✨",                         // Emoji/Unicode
  "Test/../../../etc/passwd",            // Path traversal
  "../../../../etc/passwd",              // Path traversal
  "Test&amp;&lt;&gt;",                  // HTML entities
  "Test%20%3Cscript%3E",                // URL encoded
]
```

**Procedure:**
1. For each text/textarea field
2. Fill with special character test value
3. Submit form
4. Observe how data is handled:
   - Rejected (good)
   - Accepted and escaped (good)
   - Accepted and rendered unsafely (BAD → finding)
   - Causes error (BAD → finding)

**Create finding if:**
- XSS payload executes → P0 finding (security)
- Special chars cause server error → P1 finding (functionality)
- Special chars not escaped in display → P0 finding (security)
- Unicode chars rejected without reason → P2 finding (quality)

### 4. XSS Injection Test (Optional - if security_checks enabled)

**ONLY run if `testing.security_checks: true` in config.**

**Purpose:** Test for cross-site scripting vulnerabilities

**Test payloads:**
```javascript
xss_payloads = [
  "<script>alert('XSS')</script>",
  "<img src=x onerror=alert('XSS')>",
  "<svg onload=alert('XSS')>",
  "javascript:alert('XSS')",
  "<iframe src='javascript:alert(\"XSS\")'>"
]
```

**Procedure:**
1. Fill field with XSS payload
2. Submit form
3. Navigate to page where data is displayed
4. Check if payload executed
5. Check browser console for errors
6. Check page source for unescaped content

**Create finding if:**
- Payload executes (alert box appears) → P0 finding (security)
- Payload visible in source unescaped → P0 finding (security)
- No output encoding applied → P1 finding (security)

### 5. SQL Injection Test (Optional - if security_checks enabled)

**ONLY run if `testing.security_checks: true` in config.**

**Purpose:** Test for SQL injection vulnerabilities

**Test payloads:**
```javascript
sql_payloads = [
  "' OR '1'='1",
  "'; DROP TABLE users; --",
  "admin'--",
  "1' UNION SELECT NULL, NULL--",
  "' OR 1=1--"
]
```

**Procedure:**
1. Fill field with SQL injection payload
2. Submit form
3. Observe response:
   - Normal rejection (good)
   - SQL error message visible (BAD → finding)
   - Unexpected data returned (BAD → finding)
   - App behavior changes (BAD → finding)

**Create finding if:**
- SQL error message exposed → P0 finding (security)
- Injection affects query results → P0 finding (security)
- Database error causes app crash → P0 finding (functionality)

**NEVER actually drop tables or modify data - only test for vulnerability indicators.**

### 6. Valid Data Test (Happy Path)
**Purpose:** Verify form works correctly with valid input

**Test data by field type:**
```javascript
test_data = {
  email: "test-{timestamp}@example.com",
  phone: "555-0100",
  text: "Test Input {timestamp}",
  textarea: "This is a test message with multiple sentences.",
  number: 42,
  url: "https://example.com",
  date: "2026-02-06",
  time: "12:00",
  color: "#FF5733",
  file: "SKIP - mark as 'not tested'",
  checkbox: true,
  radio: "option1",
  select: "first_option",
  password: "Test1234!@#$",
  hidden: "leave as-is"
}
```

**Procedure:**
1. Fill all fields with valid test data
2. Submit form
3. Wait for response (10 seconds max)
4. Verify success indicators:
   - Success message displayed
   - Redirect to success page
   - Data saved (if verifiable)
   - No error messages

**Create finding if:**
- Form submission fails with valid data → P0 finding (functionality)
- Success message unclear or missing → P2 finding (ui)
- Data not saved despite success message → P0 finding (functionality)
- Unexpected error occurs → P1 finding (functionality)

**Data tracking:**
Add to `test-data-created.json`:
```json
{
  "created_at": "2026-02-06T12:00:00Z",
  "form_id": "form-settings-001",
  "action": "/api/settings",
  "test_data": {
    "email": "test-1234567890@example.com"
  },
  "cleanup_required": true,
  "cleanup_method": "DELETE /api/settings"
}
```

### 7. Field Validation Test
**Purpose:** Test individual field validations

**For each field type, test:**

**Email fields:**
```javascript
invalid_emails = [
  "notanemail",
  "@example.com",
  "user@",
  "user @example.com",
  "user@.com"
]
```

**Phone fields:**
```javascript
invalid_phones = [
  "abc-defg",
  "123",
  "1234567890123456"
]
```

**URL fields:**
```javascript
invalid_urls = [
  "notaurl",
  "http://",
  "ftp://example"
]
```

**Number fields:**
```javascript
invalid_numbers = [
  "abc",
  "12.34.56",
  "1e999"
]
```

**Date fields:**
```javascript
invalid_dates = [
  "2026-13-01",  // Invalid month
  "2026-02-30",  // Invalid day
  "not-a-date"
]
```

**Procedure:**
1. Fill field with invalid value
2. Attempt to submit or blur field
3. Verify validation error appears
4. Verify error message is helpful

**Create finding if:**
- Invalid data accepted → P1 finding (quality)
- No validation error shown → P1 finding (ui)
- Validation error unhelpful → P2 finding (ui)
- Client-side validation missing (only server-side) → P3 finding (ui)

## Test Execution Procedure

**For EACH form discovered in exploration:**

### 1. Pre-Test Setup
- Read form definition from page inventory
- Check safety mode
- Generate form-specific test plan
- Create test data with audit prefix

### 2. Navigate to Form
```javascript
mcp__claude-in-chrome__navigate({
  url: form_page_url,
  tabId: tab_id
})
```
- Wait for page load
- Take screenshot
- Verify form is present

### 3. Execute Test Suite
Run all 7 test types in order:
1. Empty Submit
2. Boundary Values
3. Special Characters
4. XSS Injection (if enabled)
5. SQL Injection (if enabled)
6. Valid Data (Happy Path)
7. Field Validation

**After each test:**
- Wait for response (timeout: 10s)
- Capture result
- Take screenshot if finding detected
- Create finding JSON if issue found

### 4. Result Verification

**Check for success indicators:**
- Success message: `.success`, `.alert-success`, `[role=alert]` with positive message
- Error message: `.error`, `.alert-danger`, `[role=alert]` with error message
- Redirect: URL changed after submission
- Loading indicator: `.spinner`, `.loading`, `[aria-busy=true]`

**Wait for loading to complete:**
- Check for loading indicators
- Wait until they disappear
- Timeout after 10 seconds
- If timeout: Retry once, then mark as [FLAKY]

### 5. Finding Creation

**For EACH issue discovered, create finding JSON:**

**File location:** `.complete-agent/audits/current/findings/finding-{NNN}.json`

**Use full finding schema (33 fields):**

```json
{
  "schema_version": "1.0.0",
  "id": "finding-042",
  "source": "test",
  "type": "quality",
  "severity": "P1",
  "title": "Form accepts over-length input without validation",
  "description": "The username field accepts 100 characters despite having maxlength=50 attribute. This suggests client-side validation is not enforced.",
  "location": {
    "file": null,
    "line": null,
    "url": "https://example.com/settings",
    "selector": "input[name='username']"
  },
  "evidence": {
    "screenshot_id": "ss_test_42",
    "code_snippet": "<input name='username' maxlength='50' />",
    "expected": "Field should reject input longer than 50 characters",
    "actual": "Field accepted 100 character input and form submitted successfully",
    "steps_to_reproduce": [
      "Navigate to /settings",
      "Fill username field with 100 character string",
      "Submit form",
      "Observe: Form submits without validation error"
    ]
  },
  "verification": {
    "required": true,
    "method": "browser_repro",
    "status": "pending",
    "attempts": []
  },
  "signature": "hash_form_test_username_overlength",
  "prd_feature_id": "F4",
  "confidence": 90,
  "labels": [],
  "issue_number": null,
  "created_at": "2026-02-06T12:30:00Z",
  "updated_at": "2026-02-06T12:30:00Z"
}
```

**Signature generation for deduplication:**
```javascript
signature = hash(
  source + type + location.url + location.selector + evidence.expected
)
```

### 6. Test Data Tracking

**Record ALL data created during testing:**

**File location:** `.complete-agent/audits/current/test-data-created.json`

```json
{
  "schema_version": "1.0",
  "created_at": "2026-02-06T12:00:00Z",
  "test_data_records": [
    {
      "id": "test-data-001",
      "created_at": "2026-02-06T12:30:00Z",
      "form_id": "form-settings-001",
      "form_action": "/api/settings",
      "test_type": "valid_data",
      "data_created": {
        "email": "test-1234567890@example.com",
        "name": "Test User 1234567890"
      },
      "cleanup_required": true,
      "cleanup_method": "Manual deletion required",
      "cleanup_status": "pending"
    }
  ],
  "summary": {
    "total_records": 5,
    "cleanup_pending": 5,
    "cleanup_completed": 0
  }
}
```

**Naming convention for test data:**
- Prefix all test data with audit ID or timestamp
- Use email: `test-{timestamp}@example.com`
- Use names: `Test User {timestamp}`
- Use values: `Test Input {timestamp}`
- Makes cleanup easier later

## Retry Logic with Timing

**If test result is ambiguous or times out:**

1. **Wait for loading indicator:**
   - Check for: `.spinner`, `.loading`, `[aria-busy=true]`
   - Wait for indicator to disappear
   - Timeout: 10 seconds

2. **Retry on timeout:**
   - If first attempt times out: Wait 2 seconds, retry once
   - If second attempt times out: Mark finding as [FLAKY]
   - Log: "Test timed out twice, marked as flaky"

3. **Check for error messages:**
   - Look in multiple places:
     - `.error`, `.alert-danger`, `.form-error`
     - `[role=alert]` with error content
     - `[aria-live=assertive]` regions
     - Toast/notification elements
   - Check for 3 seconds after submission

4. **Verify success:**
   - Success message visible
   - OR redirect occurred
   - OR data visible in UI after refresh
   - If none: Consider test inconclusive

## Finding Schema (33 Required Fields)

**Every finding MUST include ALL these fields:**

```json
{
  "schema_version": "1.0.0",
  "id": "finding-NNN",
  "source": "test",
  "type": "quality | functionality | security | ui | performance | accessibility",
  "severity": "P0 | P1 | P2 | P3 | P4",
  "title": "Short descriptive title (10-200 chars)",
  "description": "Detailed description (minimum 20 chars)",
  "location": {
    "file": null,
    "line": null,
    "url": "Full URL where found",
    "selector": "Specific CSS selector for element"
  },
  "evidence": {
    "screenshot_id": "Screenshot reference ID",
    "code_snippet": "Relevant HTML/code (optional)",
    "expected": "Expected behavior",
    "actual": "Actual observed behavior",
    "steps_to_reproduce": [
      "Step 1",
      "Step 2",
      "Step 3"
    ]
  },
  "verification": {
    "required": true,
    "method": "browser_repro",
    "status": "pending",
    "attempts": []
  },
  "signature": "Unique hash for deduplication",
  "prd_feature_id": "F1 | F2 | null",
  "confidence": 85,
  "labels": [],
  "issue_number": null,
  "created_at": "ISO 8601 timestamp",
  "updated_at": "ISO 8601 timestamp"
}
```

## Selector Safety (Critical)

**NEVER use generic selectors:**

❌ `querySelector('button')`
❌ `querySelector('input')`
❌ `querySelector('form')`

✅ `querySelector('button[name="submit-settings"]')`
✅ `querySelector('input[name="email"]')`
✅ `querySelector('form[action="/api/settings"]')`

**For form interactions, use:**
- Field name: `input[name='email']`
- Field ID: `#email-input`
- Data attribute: `[data-testid='email-field']`
- ARIA label: `input[aria-label='Email address']`

## Safe Mode Observations

**When safe_mode: true, create observation-based findings:**

```json
{
  "id": "finding-obs-001",
  "source": "test",
  "type": "quality",
  "severity": "P2",
  "title": "Settings form missing maxlength validation on text fields",
  "description": "The settings form has text input fields without maxlength attributes. This could allow users to submit excessively long input. Unable to test submission due to safe mode.",
  "location": {
    "url": "https://example.com/settings",
    "selector": "form[action='/api/settings']"
  },
  "evidence": {
    "code_snippet": "<input name='bio' type='text' />",
    "expected": "Text fields should have maxlength attribute for validation",
    "actual": "No maxlength attribute present on bio field",
    "steps_to_reproduce": [
      "Navigate to /settings",
      "Inspect form HTML",
      "Observe missing maxlength on bio field"
    ]
  },
  "verification": {
    "required": false,
    "method": "file_check",
    "status": "NOT_APPLICABLE"
  },
  "labels": ["OBSERVATION_ONLY", "SAFE_MODE"],
  "confidence": 60
}
```

**Lower confidence for observation-only findings** (cannot verify through testing).

## Important Notes

- Run all 7 test types per form (unless safe mode prevents it)
- Track all created test data for cleanup
- Use conservative boundary values (not DoS-risk)
- NEVER skip safety mode checks
- Create findings with full reproduction steps
- Use specific selectors, never generic
- Respect timeouts and retry logic
- Mark flaky tests with [FLAKY] label
- Link findings to PRD features when possible
- Generate deterministic signatures for deduplication
