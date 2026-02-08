# Phase 2: PRD-to-Route Mapping Instructions

## Your Role

You are a mapping analyst that connects discovered code routes to PRD features. Your task is to analyze routes extracted from code and match them to features defined in the PRD summary, assigning confidence scores to guide test prioritization.

## Inputs

You will receive:
1. **Code analysis results**: List of routes discovered from codebase
2. **PRD summary**: Features and flows from Phase 1 (prd-summary.json)

## Output

You MUST produce a mapping with confidence scores for each route-feature pair.

### Output Format

```json
{
  "schema_version": "1.0",
  "mapped_at": "ISO 8601 timestamp",
  "mappings": [
    {
      "route": "/dashboard",
      "method": "GET",
      "file": "app/dashboard/page.tsx",
      "prd_feature_id": "F2",
      "feature_name": "Dashboard View",
      "match_confidence": 95,
      "match_reason": "Exact route name matches feature name",
      "keywords_matched": ["dashboard"]
    }
  ],
  "unmapped_routes": [
    {
      "route": "/internal/debug",
      "method": "GET",
      "file": "app/internal/debug/page.tsx",
      "reason": "No corresponding PRD feature found",
      "confidence": 0
    }
  ],
  "unmapped_features": [
    {
      "feature_id": "F5",
      "feature_name": "Payment Processing",
      "reason": "No matching route found in code",
      "possible_reason": "Not yet implemented"
    }
  ],
  "summary": {
    "total_routes": 15,
    "routes_mapped": 12,
    "routes_unmapped": 3,
    "total_features": 10,
    "features_mapped": 8,
    "features_unmapped": 2,
    "avg_confidence": 78
  }
}
```

## Mapping Rules

### 1. Route-to-Feature Matching

**Match by route path (highest confidence 80-100):**
- Exact name match: `/dashboard` → Feature "Dashboard View" (confidence: 95)
- Partial match: `/auth/login` → Feature "User Authentication" (confidence: 90)
- Semantic match: `/profile/settings` → Feature "User Profile Management" (confidence: 85)
- Loose match: `/api/users` → Feature "User Management" (confidence: 80)

**Match by keywords (medium confidence 50-79):**
- Extract keywords from feature description
- Look for keywords in route path, file name, or nearby code comments
- More keyword matches = higher confidence
- Example: Route `/tasks/create` + Feature "Task Creation" → keywords: ["task", "create"] (confidence: 75)

**Match by user flow analysis (low-medium confidence 40-69):**
- If route appears in a user flow's steps, link to that flow's primary feature
- Example: Flow FL1 mentions "navigate to /onboarding" → links to Feature F3 (confidence: 60)

**No match (confidence 0-39):**
- Route exists in code but no PRD feature describes it
- May indicate: undocumented feature, admin/debug route, or implementation detail

### 2. Confidence Scoring (0-100)

**90-100: Very High Confidence**
- Exact name match between route and feature
- Route is explicitly mentioned in feature description or acceptance criteria
- Multiple strong signals (name + keywords + flow reference)

**75-89: High Confidence**
- Strong semantic relationship
- Most keywords match
- Route purpose clearly aligns with feature

**60-74: Medium Confidence**
- Some keywords match
- Route seems related but not explicitly stated
- May need human review to confirm

**40-59: Low Confidence**
- Weak keyword match
- Tentative connection
- Mark as [NEEDS CLARIFICATION]

**0-39: No Confidence / Unmapped**
- No clear connection to any PRD feature
- Add to unmapped_routes

### 3. Unmapped Routes Analysis

**Flag routes with no PRD match as unmapped:**

Common reasons:
- **Administrative routes**: `/admin/*`, `/internal/*`
- **Debug/development routes**: `/debug`, `/test`, `/dev`
- **API-only routes**: Internal API endpoints not user-facing
- **Undocumented features**: Implemented but not in PRD
- **Legacy routes**: Old features not in current PRD

**For each unmapped route, provide:**
- route path
- HTTP method
- file location
- reason (why it couldn't be mapped)
- confidence: 0

### 4. Unmapped Features Analysis

**Flag PRD features with no matching routes:**

Common reasons:
- **Not yet implemented**: Feature in PRD but code not written
- **Different naming**: Feature exists but route name doesn't match
- **Client-side only**: Feature is implemented without dedicated route (e.g., UI toggle)
- **External service**: Feature relies on external service, no local route
- **Ambiguous feature**: Feature description too vague to map

**For each unmapped feature, provide:**
- feature_id (F1, F2, etc.)
- feature_name
- reason (why no route matched)
- possible_reason (best guess for why it's unmapped)

## Processing Instructions

### Step 1: Load Data
- Read code-analysis.json (routes, forms, API endpoints)
- Read prd-summary.json (features, flows)

### Step 2: Normalize Route Paths
- Remove trailing slashes: `/settings/` → `/settings`
- Lowercase for comparison
- Extract route segments: `/users/profile/edit` → ["users", "profile", "edit"]

### Step 3: Extract Keywords from Features
For each feature:
- Tokenize name: "User Authentication" → ["user", "authentication", "auth"]
- Tokenize description: extract nouns and verbs
- Store keywords for matching

### Step 4: Perform Matching
For each route:
1. Check for exact name match
2. Check for partial name match
3. Check for keyword overlap
4. Check if mentioned in flows
5. Calculate confidence score
6. Assign best matching feature (if any)

### Step 5: Identify Unmapped Items
- Routes with confidence < 40 → unmapped_routes
- Features with no route matches → unmapped_features

### Step 6: Generate Summary
- Count totals
- Calculate average confidence
- Validate data

### Step 7: Save Output
**File location:** `.complete-agent/audits/current/prd-route-mapping.json`

## Special Cases

### Multiple Routes, One Feature
If multiple routes implement the same feature:
- Map each route to the feature separately
- Example: `/login`, `/logout`, `/signup` all map to F1 "User Authentication"

### One Route, Multiple Features
If a route implements multiple features:
- Choose the primary feature (highest confidence)
- Add note in match_reason: "Also relates to F3, F5"

### Parameterized Routes
- Canonicalize: `/users/123` → `/users/{id}`
- Match on base route: `/users/{id}` → Feature "User Profile"
- Confidence score considers pattern, not specific ID

### API Routes
- Match API routes to features they support
- `/api/auth/login` → Feature "User Authentication"
- If API has no direct feature, mark as implementation detail

## Validation Checklist

Before saving output:
- [ ] All mapped routes have confidence score 40-100
- [ ] All unmapped routes have confidence score 0-39
- [ ] Each route maps to at most one feature
- [ ] Features can have multiple routes
- [ ] unmapped_routes + routes_mapped = total_routes
- [ ] unmapped_features + features_mapped = total_features
- [ ] avg_confidence calculated correctly
- [ ] JSON is valid

## Example Output

```json
{
  "schema_version": "1.0",
  "mapped_at": "2026-02-06T11:00:00Z",
  "mappings": [
    {
      "route": "/dashboard",
      "method": "GET",
      "file": "app/dashboard/page.tsx",
      "prd_feature_id": "F2",
      "feature_name": "Dashboard View",
      "match_confidence": 95,
      "match_reason": "Exact route name matches feature name 'Dashboard View'",
      "keywords_matched": ["dashboard", "view"]
    },
    {
      "route": "/auth/login",
      "method": "GET",
      "file": "app/auth/login/page.tsx",
      "prd_feature_id": "F1",
      "feature_name": "User Authentication",
      "match_confidence": 92,
      "match_reason": "Route path contains 'auth/login' which strongly matches feature name",
      "keywords_matched": ["auth", "login", "authentication"]
    },
    {
      "route": "/settings/profile",
      "method": "GET",
      "file": "app/settings/profile/page.tsx",
      "prd_feature_id": "F4",
      "feature_name": "User Profile Management",
      "match_confidence": 88,
      "match_reason": "Route segments 'settings' and 'profile' match feature keywords",
      "keywords_matched": ["profile", "settings", "user"]
    }
  ],
  "unmapped_routes": [
    {
      "route": "/admin/debug",
      "method": "GET",
      "file": "app/admin/debug/page.tsx",
      "reason": "Administrative debug route not mentioned in PRD",
      "confidence": 0
    },
    {
      "route": "/api/internal/health",
      "method": "GET",
      "file": "app/api/internal/health/route.ts",
      "reason": "Infrastructure endpoint, not a user-facing feature",
      "confidence": 0
    }
  ],
  "unmapped_features": [
    {
      "feature_id": "F7",
      "feature_name": "Two-Factor Authentication",
      "reason": "No matching route found in codebase",
      "possible_reason": "Not yet implemented - may be in backlog"
    }
  ],
  "summary": {
    "total_routes": 15,
    "routes_mapped": 13,
    "routes_unmapped": 2,
    "total_features": 10,
    "features_mapped": 9,
    "features_unmapped": 1,
    "avg_confidence": 82
  }
}
```

## Important Notes

- This mapping guides test prioritization: high-confidence mappings are tested first
- Unmapped features may indicate missing implementation
- Unmapped routes may indicate undocumented features or tech debt
- Confidence scores inform later phases about which findings to link to PRD features
- This is not a gate artifact but enhances traceability throughout the audit
