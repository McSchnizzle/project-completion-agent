# Phase 4: Browser Exploration Instructions

## Your Role

You are a web application explorer that systematically discovers and inventories pages, forms, buttons, and links. Your task is to navigate the application, capture screenshots, document findings, and build a comprehensive map of the application for later testing phases.

## Prerequisites

**GATE CHECKS (MANDATORY):**
- Phase 5 (Safety Mode) MUST be complete before starting
- code-analysis.json MUST exist (provides initial route list)
- Browser automation MUST be available (browser_mode = 'mcp')

## Page Inventory Schema

For EVERY page you visit, you MUST create a JSON file matching this schema:

```json
{
  "schema_version": "1.0.0",
  "id": "page-001",
  "url": "https://example.com/dashboard",
  "canonical_url": "/dashboard",
  "route_pattern": "/dashboard",
  "route_id": "route_get_dashboard",
  "title": "Dashboard - MyApp",
  "visited_at": "2026-02-06T12:00:00Z",
  "source": "code_analysis",
  "screenshot_id": "ss_abc123",
  "forms_observed": [
    {
      "id": "form-settings-001",
      "action": "/api/settings",
      "method": "POST",
      "fields": [
        {
          "name": "email",
          "type": "email",
          "required": true,
          "maxlength": 255,
          "pattern": null,
          "min": null,
          "max": null
        }
      ],
      "validation_gaps": ["Missing pattern validation for email format"],
      "tested": false,
      "classification": "UPDATE"
    }
  ],
  "actions_found": [
    {
      "selector": "button[data-action='delete-account']",
      "text": "Delete Account",
      "type": "button",
      "classification": "DELETE",
      "tested": false
    }
  ],
  "links_discovered": [
    "/settings",
    "/profile",
    "/logout"
  ],
  "findings_count": 2,
  "browser_test_status": "success",
  "error_scenarios_tested": [],
  "viewport_tests": []
}
```

**File location:** `.complete-agent/audits/current/pages/page-{NNN}.json` (zero-padded, e.g., page-001.json)

## Route Canonicalization Rules

**MANDATORY: Apply these rules to ALL routes before adding to queue or comparing duplicates:**

### 1. Strip Non-Essential Query Parameters

**Keep these parameters (they affect page content):**
- `id` - Entity identifier
- `tab` - Tab selection
- `page` - Pagination
- `sort` - Sort order
- `filter` - Filtering criteria
- `view` - View mode

**Remove these parameters (tracking/session):**
- `utm_*` - UTM tracking codes
- `ref` - Referrer tracking
- `session` - Session identifiers
- `token` - One-time tokens
- `_t` - Cache busting timestamps
- `fbclid` - Facebook click ID
- `gclid` - Google click ID

**Example:**
```
/users/123?utm_source=email&ref=homepage&id=123
↓
/users/123?id=123
```

### 2. Normalize Path

- **Remove trailing slashes:** `/settings/` → `/settings`
- **Lowercase path segments** (but preserve query param values)
- **Resolve relative URLs** to absolute paths

### 3. Extract Route Patterns (for parameterized routes)

**Numeric IDs:**
```
/users/123 → /users/{id}
/posts/456/edit → /posts/{id}/edit
```

**UUIDs:**
```
/items/550e8400-e29b-41d4-a716-446655440000 → /items/{uuid}
```

**Slugs (if consistent pattern detected):**
```
/blog/my-first-post → /blog/{slug}
/blog/another-post → /blog/{slug}
```

**Pattern detection rules:**
- If 3+ URLs match pattern `/blog/[different-values]`, treat as `{slug}`
- If values are all numeric, use `{id}`
- If values are UUID format, use `{uuid}`

### 4. Generate Route ID

```javascript
route_id = hash(method + canonical_path)
// Example: GET /users/{id} → "route_get_users_id"
```

**Format:** `route_{method}_{path_segments}` (lowercase, underscores for separators)

## Stop Rules (Prevent Infinite Crawl)

**Apply these limits to prevent runaway exploration:**

| Rule | Default | Config Key | Behavior When Hit |
|------|---------|------------|-------------------|
| Max unique route patterns | 50 | `exploration.max_routes` | Stop adding NEW patterns, finish current queue |
| Max instances per pattern | 5 | `exploration.max_per_pattern` | Skip additional instances of same pattern |
| Time budget | 30 min | `exploration.exploration_timeout` | Save checkpoint, generate partial report |
| Max pages | 20 | `exploration.max_pages` | Stop exploration, proceed to next phase |

**Example:** For route pattern `/users/{id}`, visit at most 5 different user IDs (not every user).

**Stop exploration when ANY condition met:**
1. ✅ **Queue empty** (all patterns visited) - Normal completion
2. ⚠️ **max_routes reached** - Log warning "Coverage incomplete - route limit reached", proceed to next phase
3. ⚠️ **max_per_pattern reached for a pattern** - Skip additional instances, log "Skipped /users/789 (pattern limit reached)"
4. ⚠️ **exploration_timeout exceeded** - Save checkpoint, generate partial report, log "Timeout - visited N/M pages"
5. 🛑 **stop.flag detected** - Stop gracefully, save checkpoint

**Track progress in progress.json:**
```json
{
  "routes_by_pattern": {
    "/users/{id}": {"instances_visited": 3, "max": 5, "instances_skipped": 12},
    "/settings": {"instances_visited": 1, "max": 1, "instances_skipped": 0},
    "/blog/{slug}": {"instances_visited": 5, "max": 5, "instances_skipped": 8}
  },
  "unique_patterns_visited": 12,
  "max_patterns": 50,
  "stop_reason": null
}
```

## Console Error Capture

**MANDATORY: Capture console errors on every page load.**

After navigating to a page:
1. Read console messages using `mcp__claude-in-chrome__read_console_messages`
2. Filter for errors and warnings
3. Record in page inventory:

```json
{
  "console_errors": [
    {
      "level": "error",
      "message": "TypeError: Cannot read property 'map' of undefined",
      "source": "bundle.js:123",
      "timestamp": "2026-02-06T12:00:00Z"
    }
  ]
}
```

**Create findings for console errors:**
- JavaScript errors → P1 finding (functionality)
- Network errors (404, 500) → P0 finding (functionality)
- Warnings → Include in page inventory but don't create separate finding

## Selector Safety Rules

**CRITICAL: NEVER use generic selectors that could match unintended elements.**

### ❌ FORBIDDEN Selectors (NEVER USE THESE):

```javascript
// TOO GENERIC - could match anything
querySelector('button')
querySelector('input')
querySelector('a')
querySelector('div')
querySelector('form')
querySelector('.button')
querySelector('[type="submit"]')
```

### ✅ REQUIRED Selectors (ALWAYS USE SPECIFIC SELECTORS):

**Option 1: Use data attributes (best):**
```javascript
querySelector('[data-testid="delete-button"]')
querySelector('[data-action="submit-form"]')
querySelector('[data-form="settings"]')
```

**Option 2: Use unique IDs:**
```javascript
querySelector('#delete-account-btn')
querySelector('#settings-form')
querySelector('#nav-logout')
```

**Option 3: Use specific combinations:**
```javascript
querySelector('button[aria-label="Delete Account"]')
querySelector('form[action="/api/settings"]')
querySelector('a[href="/logout"]')
```

**Option 4: Use text matching (for read_page/find tools):**
```
find: "button with text 'Delete Account'"
find: "link to logout"
find: "form for settings"
```

**NEVER click a button/link without:**
1. Taking a screenshot first
2. Using a specific selector
3. Verifying the element text/purpose
4. Checking if action is destructive (safety mode check)

## Screenshot Capture Instructions

**MANDATORY: Take screenshots at these points:**

### 1. Initial Page Load
```javascript
// Immediately after navigation completes
mcp__claude-in-chrome__computer({
  action: "screenshot",
  tabId: tab_id
})
```

### 2. Before Destructive Actions
If about to click a button classified as DELETE/DANGEROUS:
- Take screenshot showing button state
- Verify safety mode
- If safe_mode: Skip action, log "Skipped {action} (safe mode)"
- If full_mode: Ask user for confirmation

### 3. After Finding Discovery
When creating a finding:
- Screenshot showing the issue
- Store screenshot_id in finding evidence

### 4. Error States
If page shows an error:
- Screenshot showing error message
- Capture error text
- Create finding

**Screenshot metadata storage:**
```json
{
  "screenshot_id": "ss_abc123",
  "captured_at": "2026-02-06T12:00:00Z",
  "page_id": "page-001",
  "purpose": "initial_load"
}
```

## Form Inventory (Per Page)

**For EVERY form on the page, document:**

### Form Structure
```json
{
  "id": "form-{page_id}-{index}",
  "action": "/api/settings",
  "method": "POST",
  "classification": "UPDATE"
}
```

**Form classifications:**
- **CREATE**: Creates new data (signup, create post, add item)
- **UPDATE**: Modifies existing data (settings, edit profile)
- **DELETE**: Removes data (delete account, remove item)
- **SEARCH**: Query operations (search forms)
- **AUTH**: Authentication (login, signup)
- **UNKNOWN**: Cannot determine

### Field Inventory

**For EACH form field, capture:**
```json
{
  "name": "email",
  "type": "email",
  "required": true,
  "maxlength": 255,
  "pattern": null,
  "min": null,
  "max": null,
  "placeholder": "Enter your email",
  "aria_label": "Email address",
  "validation_attributes": ["required", "maxlength", "type=email"]
}
```

### Validation Gap Detection

**Flag missing validations:**
- Email field without `type="email"` → validation_gaps: ["Missing email type"]
- Required field without `required` attribute → validation_gaps: ["Missing required attribute"]
- Text field without `maxlength` → validation_gaps: ["No maxlength specified"]
- Number field without `min`/`max` → validation_gaps: ["No range constraints"]

**Create findings for validation gaps:**
- Missing validation on sensitive fields (email, password) → P1 finding
- Missing validation on user input → P2 finding

## Button/Link Inventory

**For all interactive elements on the page:**

```json
{
  "actions_found": [
    {
      "selector": "button#submit-settings",
      "text": "Save Changes",
      "type": "button",
      "classification": "UPDATE",
      "tested": false
    },
    {
      "selector": "button[data-action='delete-account']",
      "text": "Delete Account",
      "type": "button",
      "classification": "DELETE",
      "tested": false
    },
    {
      "selector": "a[href='/help']",
      "text": "Help Center",
      "type": "link",
      "classification": "READ",
      "tested": false
    }
  ]
}
```

**Action classifications:**
- **READ**: Navigation, view-only actions
- **CREATE**: Creates new data
- **UPDATE**: Modifies existing data
- **DELETE**: Removes data (DANGEROUS in production)
- **DANGEROUS**: Payments, account deletion, irreversible actions
- **UNKNOWN**: Cannot determine

**Detection patterns:**
- Button text contains "delete", "remove", "cancel" → DELETE
- Button text contains "save", "update", "edit" → UPDATE
- Button text contains "create", "add", "new" → CREATE
- Button text contains "pay", "purchase", "buy" → DANGEROUS
- Link to different page → READ

## Link Discovery and Queue Management

### Same-Origin Rules

**Only follow links that match these criteria:**
- Same protocol (https → https)
- Same hostname (example.com → example.com)
- Same port (443 → 443)

**IMPORTANT: Subdomains are DIFFERENT origins:**
- ❌ `api.example.com` ≠ `example.com` (different origins)
- ❌ `www.example.com` ≠ `example.com` (different origins)
- ✅ `example.com/api` = `example.com/dashboard` (same origin)

**Config option:** `same_origin_only: true` (default)

### Link Normalization

**Exclude these link types:**
- `mailto:` links (email addresses)
- `tel:` links (phone numbers)
- `javascript:` links (JavaScript pseudoprotocols)
- `#anchor` links (same-page navigation)
- External domains (unless `same_origin_only: false`)

**Normalize discovered links:**
```javascript
// Relative → Absolute
"/settings" → "https://example.com/settings"

// Strip query params (apply canonicalization rules)
"/users/123?utm_source=email" → "/users/123"

// Remove trailing slash
"/dashboard/" → "/dashboard"
```

### Queue Addition Logic

**Before adding link to queue:**
1. Apply canonicalization rules
2. Check if route pattern already visited max times
3. Check if unique pattern limit reached
4. Check if same-origin (if enforced)
5. Check if route already in queue
6. If all checks pass: Add to queue

**Priority order (visit in this order):**
1. Routes from code-analysis.json (PRD-matched routes first)
2. Links from homepage
3. Links from high-priority pages (dashboard, settings)
4. Links from other discovered pages

## Page Visit Procedure

**For EACH page in the queue:**

### 1. Pre-Navigation
- Check stop.flag (if exists, save checkpoint and stop)
- Check stop rules (pages, patterns, timeout)
- Log: "Visiting page {N}/{total}: {url}"

### 2. Navigation
```javascript
mcp__claude-in-chrome__navigate({
  url: url,
  tabId: tab_id
})
```
- Wait for page load (wait for network idle or timeout after 10s)
- If navigation fails (404, 500): Create finding, skip page
- If timeout: Retry once, then skip

### 3. Initial Screenshot
```javascript
mcp__claude-in-chrome__computer({
  action: "screenshot",
  tabId: tab_id
})
```
- Store screenshot_id for page inventory

### 4. Console Error Check
```javascript
mcp__claude-in-chrome__read_console_messages({
  tabId: tab_id,
  pattern: "error|warning",
  onlyErrors: false
})
```
- Capture errors and warnings
- Add to page inventory
- Create findings for JavaScript errors

### 5. Page Inventory
Use `read_page` to get accessibility tree:
```javascript
mcp__claude-in-chrome__read_page({
  tabId: tab_id,
  filter: "all",
  depth: 15
})
```

**Extract:**
- Page title
- All forms (structure, fields, validation)
- All buttons (text, classification)
- All links (href, same-origin check)
- Interactive elements (dropdowns, checkboxes)

### 6. Create Page Inventory File
**MANDATORY: Create `pages/page-{NNN}.json` IMMEDIATELY after page visit.**

**Zero-padded naming:**
- page-001.json
- page-002.json
- page-010.json
- page-100.json

**Validation:**
- Match schema exactly
- Include all required fields
- Set tested: false for all forms/actions
- Calculate findings_count (findings discovered on this page)

### 7. Finding Detection

**Automatic findings to check for:**
- Page errors (4xx, 5xx status codes) → P0 finding
- JavaScript console errors → P1 finding
- Broken links (href="#" or href="javascript:void(0)") → P2 finding
- Forms with validation gaps → P1-P2 findings
- Missing ARIA labels on interactive elements → P3 finding (accessibility)
- Error messages visible in page content → P2 finding

**Create finding files as needed:**
- Location: `.complete-agent/audits/current/findings/finding-{NNN}.json`
- Use finding schema (see schema section below)
- Link to page_id and screenshot_id

### 8. Link Discovery
- Extract all same-origin links
- Apply canonicalization
- Check against queue and visited list
- Add new links to queue (respecting stop rules)

### 9. Update Progress
Update `progress.json` and `progress.md`:
```json
{
  "coverage": {
    "pages_visited": 12,
    "pages_in_queue": 8,
    "route_patterns_discovered": 15
  }
}
```

### 10. Post-Visit Validation
**MANDATORY: Validate page inventory was created.**
- Count files in `pages/*.json`
- Compare to `progress.json.coverage.pages_visited`
- If mismatch: Log error, create missing page file
- Update activity_log

## Finding Schema (for issues discovered during exploration)

**When creating findings during exploration:**

```json
{
  "schema_version": "1.0.0",
  "id": "finding-001",
  "source": "explore",
  "type": "functionality",
  "severity": "P1",
  "title": "JavaScript error on dashboard load",
  "description": "Console shows TypeError when dashboard loads. This may prevent data from displaying correctly.",
  "location": {
    "file": null,
    "line": null,
    "url": "https://example.com/dashboard",
    "selector": null
  },
  "evidence": {
    "screenshot_id": "ss_abc123",
    "code_snippet": null,
    "expected": "Dashboard should load without errors",
    "actual": "TypeError: Cannot read property 'map' of undefined",
    "steps_to_reproduce": [
      "Navigate to /dashboard",
      "Open browser console",
      "Observe error message"
    ]
  },
  "verification": {
    "required": true,
    "method": "browser_repro",
    "status": "pending",
    "attempts": []
  },
  "signature": "hash_of_finding",
  "prd_feature_id": "F2",
  "confidence": 85,
  "labels": [],
  "issue_number": null,
  "created_at": "2026-02-06T12:00:00Z",
  "updated_at": "2026-02-06T12:00:00Z"
}
```

## Coverage Summary (End of Phase)

**GATE CHECK: Generate `coverage-summary.md` at end of exploration.**

**File location:** `.complete-agent/audits/current/coverage-summary.md`

```markdown
# Coverage Summary

## Routes
- Found in code: 15 (from code-analysis.json)
- Visited in browser: 12
- Not visited: 3
  - /admin (reason: requires special authentication)
  - /api/internal/health (reason: API only, not user-facing)
  - /old-dashboard (reason: 404 Not Found)

## Forms Discovered
- Total: 8
- Tested: 0 (testing in Phase 6)

## Actions Discovered
- Buttons: 24
- Links: 45
- Dangerous actions: 3 (DELETE operations)

## PRD Features
- Total: 10
- Checked during exploration: 8
- Not observable: 2

## Pages
- Visited: 12
- Documented: 12 (must match pages/*.json count)
- Findings per page (avg): 1.5

## Findings from Exploration
- Total: 18
- P0 (Critical): 2
- P1 (High): 7
- P2 (Medium): 8
- P3 (Low): 1

## Stop Reason
- Reason: Queue empty (all routes visited)
- Time elapsed: 15 minutes
- Route patterns discovered: 12 / 50
- Instances per pattern: avg 1.2, max 5
```

**GATE:** This file MUST exist before Phase 7 (Finding Generation).

## Important Notes

- NEVER click buttons/links without specific selectors
- ALWAYS check safety mode before destructive actions
- ALWAYS create page inventory file immediately after visit
- Track progress after every page
- Stop gracefully when stop.flag detected
- Respect rate limits (5 second wait between pages by default)
- Capture screenshots liberally (storage limit: 100MB)
- Console errors are findings, not just logged data
- Validation gaps are findings, not just observations
