# Review: Task #19 - Fix All Reviewer Findings

**Reviewer:** reviewer agent
**Date:** 2026-02-08
**Verdict:** APPROVED
**Owner:** verify-engineer

---

## Fixes Requested and Verified

### 1. github-issues.ts - Label quote injection

**File:** `src/phases/github-issues.ts:326`
**Severity:** MINOR
**Status:** FIXED

Before:
```typescript
const labelArgs = labels.map((l) => `--label "${l}"`).join(' ');
```

After:
```typescript
const labelArgs = sanitizedLabels.map((l) => `--label ${shellEscape(l)}`).join(' ');
```

Now uses `shellEscape()` to properly handle special characters in label names.

### 2. safety.ts - Dead .dev TLD check

**File:** `src/phases/safety.ts:334`
**Severity:** MINOR
**Status:** FIXED

Before:
```typescript
if (hostname.endsWith('.dev') && !hostname.includes('.')) return true;
```

The condition was impossible (`endsWith('.dev')` requires a dot, but `!includes('.')` requires no dot). Removed the impossible condition.

### 3. finding-schema.ts - Zod dependency location

**File:** `package.json`
**Severity:** MINOR
**Status:** VERIFIED OK

`zod` was already in `dependencies` (not `devDependencies`). No change needed.

### 4. coverage-tracker.ts - Field name mismatch

**File:** `src/coverage-tracker.ts:88`
**Severity:** MINOR
**Status:** FIXED

Before:
```typescript
route.auth_required  // snake_case
```

After:
```typescript
route.authRequired  // camelCase - matches code-analysis.ts output
```

### 5. phase-init.ts - Dead ternary

**File:** `src/phase-init.ts:96`
**Severity:** MINOR
**Status:** FIXED

Before:
```typescript
prdMappingPromptPath: config.prdPath ? undefined : undefined
```

Both branches produced `undefined`. Simplified to just `undefined` (or removed the field entirely).

### 6. dashboard-server.ts - XSS fix

**File:** `src/reporting/dashboard-server.ts` (moved from `src/dashboard-server.ts`)
**Severity:** MEDIUM
**Status:** FIXED

Before: Used `innerHTML` to render finding titles, severity, and location data from disk.

After: Uses `textContent` for all dynamic data (lines 314, 316, 318). `innerHTML` is only used for clearing elements (setting to `''`), which is safe.

## Post-Fix Verification

- **0 TypeScript errors** (clean `tsc --noEmit`)
- **811 tests passing**, 0 failures
- **14/14 E2E pipeline phases** completing
- All grep searches for the old patterns returned no matches - fixes are thorough

## Notes

All fixes were minimal and targeted - no unnecessary refactoring. Each fix addressed exactly the issue identified in the review without introducing new complexity.
