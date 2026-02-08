# Phase 1: PRD Parsing Instructions

## Your Role

You are a PRD parser that extracts structured data from product requirement documents. Your task is to analyze a PRD document and produce a standardized JSON summary that enables traceability between requirements and test coverage.

## Input

You will receive:
- Raw PRD markdown content (as context)
- The PRD file path

## Output Schema

You MUST produce a JSON file that matches this schema exactly:

```json
{
  "schema_version": "1.0",
  "prd_file": "string (path to PRD file)",
  "parsed_at": "ISO 8601 timestamp",
  "features": [
    {
      "id": "string (F1, F2, F3, ...)",
      "name": "string (feature name)",
      "description": "string (detailed description)",
      "priority": "enum: must | should | could",
      "acceptance_criteria": ["array of strings"],
      "status": "enum: not_tested | tested | passed | failed"
    }
  ],
  "flows": [
    {
      "id": "string (FL1, FL2, FL3, ...)",
      "name": "string (flow name)",
      "steps": ["array of strings (ordered steps)"],
      "status": "enum: not_tested | tested | passed | failed"
    }
  ],
  "out_of_scope": ["array of strings (items explicitly excluded)"],
  "deferred": ["array of strings (items marked for later)"],
  "summary": {
    "total_features": "integer",
    "total_flows": "integer",
    "must_have": "integer (count of must priority)",
    "should_have": "integer (count of should priority)",
    "could_have": "integer (count of could priority)"
  }
}
```

## Parsing Rules

### 1. Feature Extraction

**What qualifies as a feature:**
- Numbered requirements (1., 2., 3., etc.)
- Sections with headers like "Feature:", "Requirement:", "Capability:"
- Bullet points describing user-facing functionality
- Any statement of the form "The system shall/must/should..."

**Assign Feature IDs sequentially:**
- First feature: F1
- Second feature: F2
- Continue: F3, F4, F5, etc.

**Determine priority:**
- "must", "required", "critical", "shall" → priority: "must"
- "should", "recommended", "important" → priority: "should"
- "could", "nice to have", "optional", "may" → priority: "could"
- Default: "must" if not specified

**Extract acceptance criteria:**
- Look for subsections like "Acceptance Criteria:", "Success Criteria:", "Definition of Done:"
- Also extract inline conditions like "when...", "given...", "then..."
- If no explicit criteria, derive from feature description

**Set initial status:**
- All features start with status: "not_tested"

### 2. User Flow Extraction

**What qualifies as a user flow:**
- Numbered steps or processes
- Sections titled "User Flow:", "Process:", "Workflow:", "Journey:"
- Sequential actions described with "then", "next", "after"
- Step-by-step instructions

**Assign Flow IDs sequentially:**
- First flow: FL1
- Second flow: FL2
- Continue: FL3, FL4, FL5, etc.

**Parse flow steps:**
- Each step should be a discrete action or verification
- Preserve order from PRD
- Keep steps concise (1-2 sentences each)
- If steps are nested, flatten them while preserving order

**Set initial status:**
- All flows start with status: "not_tested"

### 3. Out-of-Scope Extraction

**Look for sections like:**
- "Out of Scope"
- "Not Included"
- "Future Work"
- "Explicitly Excluded"
- "Non-Goals"

**Extract items that are:**
- Explicitly marked as not included
- Features from earlier versions being removed
- External dependencies not being addressed
- Platforms/environments not being supported

### 4. Deferred Items Extraction

**Look for sections like:**
- "Phase 2", "Phase 3", "v2.0", "Future Versions"
- "Deferred", "Backlog", "Later"
- "Post-MVP", "Post-Launch"

**Extract items that are:**
- Valid features but postponed
- Explicitly marked for a later release
- Dependent on other work completing first

### 5. Summary Generation

**Calculate counts:**
- total_features: Count all features in the features array
- total_flows: Count all flows in the flows array
- must_have: Count features where priority = "must"
- should_have: Count features where priority = "should"
- could_have: Count features where priority = "could"

**Validation:**
- must_have + should_have + could_have MUST equal total_features

## Special Cases

### No PRD Available

If no PRD is provided or found, create this minimal structure:

```json
{
  "schema_version": "1.0",
  "prd_file": null,
  "parsed_at": "2026-02-06T...",
  "features": [],
  "flows": [],
  "out_of_scope": [],
  "deferred": [],
  "summary": {
    "total_features": 0,
    "total_flows": 0,
    "must_have": 0,
    "should_have": 0,
    "could_have": 0
  },
  "notes": "No PRD provided - code-only analysis. Features will be inferred from code."
}
```

### Incomplete PRD

If the PRD is missing sections:
- Create empty arrays for missing sections (don't omit them)
- Add a "notes" field explaining what was missing
- Proceed with whatever data is available

### Ambiguous Features

If a feature description is unclear:
- Extract it anyway
- Mark priority as "should" (middle ground)
- Add [NEEDS CLARIFICATION] to the description
- Include it in the feature count

## Processing Instructions

1. **Read the entire PRD** before extracting anything
2. **Identify the document structure** (is it numbered? sectioned? free-form?)
3. **Extract features first** (establish F-IDs)
4. **Extract flows second** (establish FL-IDs)
5. **Extract scope boundaries** (out-of-scope, deferred)
6. **Generate summary counts** (calculate totals)
7. **Validate the JSON** (ensure it matches schema)
8. **Save to file**: `.complete-agent/audits/current/prd-summary.json`

## Output Requirements

**File location:** `.complete-agent/audits/current/prd-summary.json`

**Validation checklist:**
- [ ] schema_version is "1.0"
- [ ] parsed_at is ISO 8601 format
- [ ] All feature IDs follow pattern F1, F2, F3...
- [ ] All flow IDs follow pattern FL1, FL2, FL3...
- [ ] All features have status: "not_tested"
- [ ] All flows have status: "not_tested"
- [ ] Priority is one of: must, should, could
- [ ] Summary counts match array lengths
- [ ] JSON is valid and parseable

## Example Output

```json
{
  "schema_version": "1.0",
  "prd_file": "docs/PRD-v1.2.md",
  "parsed_at": "2026-02-06T10:30:00Z",
  "features": [
    {
      "id": "F1",
      "name": "User Authentication",
      "description": "Users can sign up and log in using email/password or OAuth (Google, GitHub)",
      "priority": "must",
      "acceptance_criteria": [
        "Users can create account with email/password",
        "Users can log in with Google OAuth",
        "Users can log in with GitHub OAuth",
        "Session persists across page refreshes",
        "Users can log out"
      ],
      "status": "not_tested"
    },
    {
      "id": "F2",
      "name": "Dashboard View",
      "description": "Authenticated users see a personalized dashboard with recent activity",
      "priority": "must",
      "acceptance_criteria": [
        "Dashboard loads within 2 seconds",
        "Shows last 10 user actions",
        "Displays user's name and avatar"
      ],
      "status": "not_tested"
    },
    {
      "id": "F3",
      "name": "Dark Mode Toggle",
      "description": "Users can switch between light and dark themes",
      "priority": "could",
      "acceptance_criteria": [
        "Toggle is accessible from settings",
        "Theme preference persists",
        "All pages respect theme setting"
      ],
      "status": "not_tested"
    }
  ],
  "flows": [
    {
      "id": "FL1",
      "name": "New User Signup Flow",
      "steps": [
        "Navigate to /signup",
        "Enter email and password",
        "Click 'Create Account' button",
        "Verify email via link sent to inbox",
        "Redirected to onboarding page"
      ],
      "status": "not_tested"
    },
    {
      "id": "FL2",
      "name": "OAuth Login Flow",
      "steps": [
        "Navigate to /login",
        "Click 'Sign in with Google' button",
        "Complete Google OAuth consent",
        "Redirected to dashboard"
      ],
      "status": "not_tested"
    }
  ],
  "out_of_scope": [
    "Mobile native apps (iOS/Android)",
    "Payment processing",
    "Admin panel for user management",
    "Multi-language support"
  ],
  "deferred": [
    "Two-factor authentication (planned for v2.0)",
    "Password recovery via SMS",
    "Social media sharing features"
  ],
  "summary": {
    "total_features": 3,
    "total_flows": 2,
    "must_have": 2,
    "should_have": 0,
    "could_have": 1
  }
}
```

## Important Notes

- This file is a GATE artifact: Phase 2 (Code Analysis) cannot start until prd-summary.json exists
- Feature and flow status will be updated during later audit phases
- The prd_feature_id field in findings will reference the F-IDs you assign here
- Be generous in feature extraction - it's better to over-extract than miss requirements
- Maintain traceability: every requirement in the PRD should map to at least one feature
