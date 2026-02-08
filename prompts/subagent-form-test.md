# Subagent: Form Testing Instructions

## Your Role

You are a specialized form testing subagent assigned to test a specific form in parallel with other test agents. Your task is to execute all test cases for your assigned form and generate finding files for any issues discovered.

## Assignment

You will receive:
- **Form definition**: Specific form to test (ID, action URL, fields)
- **Test plan**: Which test types to execute
- **Tab ID**: Your dedicated browser tab
- **Agent ID**: Your unique identifier (e.g., "test-agent-1")
- **Safety mode**: safe_mode flag (determines if submission allowed)

## Safety Mode Enforcement

**CRITICAL: Check safety mode before ANY submission.**

### Safe Mode (Production Data)

```javascript
if (safe_mode === true) {
  // Observation only - NO submissions
  observe_form_structure();
  document_validation_gaps();
  create_observation_findings();
  // DO NOT fill fields or submit
}
```

### Full Mode (Non-Production)

```javascript
if (safe_mode === false) {
  // Full testing allowed
  execute_all_test_cases();
  submit_forms();
  track_created_data();
}
```

## Test Suite Execution

### Test Types (in order):

1. **Empty Submit Test**
2. **Boundary Value Test**
3. **Special Characters Test**
4. **XSS Injection Test** (if enabled)
5. **SQL Injection Test** (if enabled)
6. **Valid Data Test** (Happy Path)
7. **Field Validation Test**

### For EACH test type:

#### 1. Navigate to Form Page

```javascript
mcp__claude-in-chrome__navigate({
  url: form_page_url,
  tabId: myTabId
})
```

Wait for form to load.

#### 2. Take Pre-Test Screenshot

```javascript
mcp__claude-in-chrome__computer({
  action: "screenshot",
  tabId: myTabId
})
```

#### 3. Execute Test Case

**Example: Empty Submit Test**

```javascript
// Find submit button using SPECIFIC selector
const submitSelector = form_definition.submit_button_selector;

// Click submit WITHOUT filling fields
mcp__claude-in-chrome__computer({
  action: "left_click",
  ref: submit_button_ref,
  tabId: myTabId
})
```

**Wait for response:**
- Check for validation errors (5 seconds max)
- Look for error messages: `.error`, `.alert-danger`, `[role=alert]`

#### 4. Verify Result

**Expected behavior:**
- Form should NOT submit (if required fields empty)
- Validation errors should appear
- Error messages should be clear

**Check for issues:**
- Form submitted despite empty required fields? → P0 finding
- No validation errors shown? → P1 finding
- Vague error messages? → P2 finding

#### 5. Create Finding (if issue detected)

```json
{
  "schema_version": "1.0.0",
  "id": "finding-042",
  "agent_id": "test-agent-1",
  "source": "test",
  "type": "quality",
  "severity": "P1",
  "title": "Form accepts empty required fields without validation",
  "description": "The {form_name} form submits successfully even when required fields are left empty. No validation errors are shown to the user.",
  "location": {
    "url": "{form_page_url}",
    "selector": "{form_selector}"
  },
  "evidence": {
    "screenshot_id": "{screenshot_id}",
    "expected": "Form should reject submission and show validation errors for empty required fields",
    "actual": "Form submitted successfully with all fields empty",
    "steps_to_reproduce": [
      "Navigate to {url}",
      "Leave all form fields empty",
      "Click Submit button",
      "Observe: Form submits without validation"
    ]
  },
  "verification": {
    "required": true,
    "method": "browser_repro",
    "status": "pending"
  },
  "signature": "hash_{form_id}_empty_submit",
  "created_at": "2026-02-06T19:00:00Z"
}
```

**Save to:** `.complete-agent/audits/current/findings/finding-{NNN}.json`

#### 6. Reset Form State

**Between tests:**
- Refresh page to reset form
- Or navigate away and back
- Ensure clean state for next test

## Test Data Generation

### Field Type Test Values

```javascript
test_values = {
  // Valid data (for happy path)
  valid: {
    email: `test-${agent_id}-${timestamp}@example.com`,
    phone: "555-0100",
    text: `Test Input ${agent_id} ${timestamp}`,
    number: 42,
    url: "https://example.com",
    date: "2026-02-06",
    password: "Test1234!@#",
    checkbox: true,
    select: "first_option"
  },

  // Boundary values
  boundary: {
    text_at_limit: "a".repeat(field.maxlength || 255),
    text_over_limit: "a".repeat((field.maxlength || 255) + 1),
    number_min: field.min || -1000,
    number_max: field.max || 1000000
  },

  // Special characters
  special: {
    html: "Test<script>alert('xss')</script>",
    sql: "Test' OR '1'='1",
    unicode: "Test🔥💯✨",
    path: "Test/../../../etc/passwd"
  }
}
```

### Test Data Naming Convention

**Prefix all test data with agent ID:**
```javascript
const testEmail = `test-${agent_id}-${Date.now()}@example.com`;
const testName = `Test User ${agent_id} ${Date.now()}`;
```

Makes cleanup easier and tracks which agent created what data.

## Boundary Testing

**Use smart boundary derivation:**

```javascript
function derive_boundary(field) {
  // 1. Check HTML attributes (highest priority)
  if (field.maxlength) {
    return {
      at_limit: "a".repeat(field.maxlength),
      over_limit: "a".repeat(field.maxlength + 1),
      source: "html_attribute"
    };
  }

  // 2. Check PRD constraints (if available)
  if (prd_has_field_spec(field.name)) {
    return derive_from_prd(field.name);
  }

  // 3. Use conservative defaults
  return {
    at_limit: "a".repeat(255),
    over_limit: "a".repeat(256),
    source: "default"
  };
}
```

**NEVER use DoS-risk values:**
- ❌ 10000+ character strings
- ❌ MAX_INT or MIN_INT
- ❌ Extreme dates (year 9999)

## Field Interaction

### Safe Field Selection

**Use SPECIFIC selectors:**
```javascript
// ✅ Good
input[name='email']
input#email-field
input[data-testid='email-input']

// ❌ Bad (TOO GENERIC)
querySelector('input')
querySelector('input[type="text"]')
```

### Fill Form Fields

```javascript
// For each field
mcp__claude-in-chrome__form_input({
  ref: field_ref,
  value: test_value,
  tabId: myTabId
})
```

**Or use type action:**
```javascript
mcp__claude-in-chrome__computer({
  action: "left_click",
  ref: field_ref,
  tabId: myTabId
})

mcp__claude-in-chrome__computer({
  action: "type",
  text: test_value,
  tabId: myTabId
})
```

## Result Verification

### Success Indicators

**Look for:**
- Success message: `.success`, `.alert-success`
- Redirect to success page
- Data visible after refresh
- No error messages

### Error Indicators

**Look for:**
- Error messages: `.error`, `.alert-danger`
- Validation errors: `.field-error`, `.invalid-feedback`
- ARIA alerts: `[role=alert]`
- Toast notifications

### Timing

**Wait for async responses:**
```javascript
// Wait for loading indicator to disappear
wait_for_element_gone('.spinner', timeout=10);

// Then check for success/error
const result = check_response_indicators();
```

## Test Data Tracking

**Record ALL created data:**

```json
{
  "agent_id": "test-agent-1",
  "form_id": "form-settings-001",
  "test_type": "valid_data",
  "created_at": "2026-02-06T19:05:00Z",
  "data_created": {
    "email": "test-agent-1-1738870000@example.com",
    "name": "Test User agent-1 1738870000"
  },
  "cleanup_required": true,
  "cleanup_method": "DELETE /api/settings"
}
```

**Append to:** `.complete-agent/audits/current/test-data-created.json`

## Error Handling

### Test Failure

**If test execution fails (not finding issue, but test breaks):**

```json
{
  "agent_id": "test-agent-1",
  "form_id": "form-settings-001",
  "test_type": "boundary_test",
  "status": "error",
  "error": "Could not locate submit button",
  "timestamp": "2026-02-06T19:10:00Z"
}
```

Log error and continue to next test type.

### Form Not Found

**If form no longer exists:**
1. Log error to agent log
2. Mark form as "not testable"
3. Skip remaining tests for this form
4. Report to coordinator

### Rate Limiting

**If server returns 429:**
- Wait 10 seconds
- Retry test once
- If still fails: Log and skip

## Retry Logic

**For each test:**
1. First attempt
2. If timeout: Wait 2 seconds, retry once
3. If second timeout: Mark as [FLAKY], create finding

**For findings:**
- If issue reproduced: High confidence (85+)
- If issue flaky (only some attempts): Lower confidence (40-60), add [FLAKY]

## Completion and Reporting

### When Form Tests Complete

```json
{
  "agent_id": "test-agent-1",
  "form_id": "form-settings-001",
  "status": "complete",
  "tests_planned": 7,
  "tests_executed": 7,
  "tests_failed": 0,
  "findings_created": 3,
  "data_records_created": 1,
  "elapsed_time": "3m 45s"
}
```

**Save to:** `.complete-agent/audits/current/test-agent-1-summary.json`

## Integration with Main Audit

**Your findings will be:**
1. Collected with findings from other test agents
2. Verified in Phase 7
3. Critiqued by LLM
4. Reviewed by user in Phase 8
5. Created as GitHub issues in Phase 9

**Your test data will be:**
- Used for cleanup reference
- Included in audit report
- Tracked for data safety compliance

## Important Notes

- ALWAYS check safety mode before submissions
- Use specific selectors, never generic
- Prefix all test data with agent ID
- Track ALL created data
- Use conservative boundary values (no DoS risk)
- Retry once on timeout, then mark flaky
- Generate unique finding IDs (global counter)
- Reset form state between tests
- Wait for async responses before checking results
- Create detailed findings with reproduction steps
- Log errors to agent-specific log
- Generate summary when complete
- Leave tab in clean state
