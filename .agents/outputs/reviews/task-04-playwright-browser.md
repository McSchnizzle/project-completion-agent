# Review: Task #4 - FR-3: Playwright Browser Integration

**Reviewer:** reviewer agent
**Date:** 2026-02-08
**Verdict:** APPROVED
**Owner:** browser-engineer

---

## Files Reviewed

| File | Lines | Purpose |
|------|-------|---------|
| `src/screenshot-capture.ts` | 299 | Screenshot lifecycle management with storage budget |
| `src/coverage-tracker.ts` | 382 | URL coverage tracking with exploration queue |
| `src/browser/auth-handler.ts` | ~200 | Cookie, bearer, form-login auth strategies |

## Tests

| Test File | Count | Status |
|-----------|-------|--------|
| `tests/unit/screenshot-capture.test.ts` | 12 | All passing |
| `tests/unit/coverage-tracker.test.ts` | 21 | All passing |
| `tests/unit/auth-handler.test.ts` | 15 | All passing |

**Total: 48 tests, all passing**

## Architecture Alignment

- `screenshot-capture.ts` in `src/` root - acceptable for Sprint 1 (could move to `src/browser/` later)
- `coverage-tracker.ts` in `src/` root - acceptable for Sprint 1
- `auth-handler.ts` correctly placed in `src/browser/` per ARCHITECTURE-V2

## Strengths

1. ScreenshotCapture class with storage budget enforcement (default 100MB, configurable)
2. Manifest persistence via JSON file - supports audit resume
3. Element highlighting for finding evidence screenshots (red border overlay, auto-cleanup)
4. URL-to-pattern normalization replaces UUIDs and numeric IDs with `{uuid}` and `{id}` placeholders
5. FIFO exploration queue with `shouldVisit()` dedup logic prevents revisiting pages
6. Auth handler supports 3 strategies: cookie injection, bearer token headers, form-login automation
7. Environment variable resolution for config values (e.g., `$AUTH_TOKEN` in config.yml)
8. Uses `page: any` to avoid Playwright compile-time dependency - smart for optional browser support

## Issues Found

### MINOR - Field name mismatch (`coverage-tracker.ts:88`)

```typescript
route.auth_required  // snake_case
```

But `code-analysis.ts` outputs routes with `authRequired` (camelCase). This means auth-required routes would never be detected by the coverage tracker. **Fixed in Task #19.**

### MINOR - Budget percent calculation (`screenshot-capture.ts:247`)

```typescript
budgetPercent: Math.round((this.totalSizeBytes / this.maxSizeBytes) * 10000000) / 100000
```

The multiplier/divisor combination (10000000 / 100000) produces 5 decimal places of precision, which is excessive for a percentage display. Works correctly but reads oddly.

## Notes for Downstream Consumers

- `ScreenshotCapture` constructor takes `(auditDir, maxSizeMB?)` - creates `{auditDir}/screenshots/` automatically
- `capture()` returns `ScreenshotMetadata` with stable `id` (format: `ss_{hash}`) for cross-referencing in findings
- `captureFromPage()` and `captureResponsive()` require a Playwright Page object
- `CoverageTracker` tracks both visited URLs and discovered-but-unvisited URLs
- `getExplorationQueue()` returns FIFO queue of unvisited URLs
