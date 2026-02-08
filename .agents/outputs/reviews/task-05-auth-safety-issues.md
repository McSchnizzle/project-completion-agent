# Review: Task #5 - FR-4+FR-5: Auth/Safety Gating + Issue Generation

**Reviewer:** reviewer agent
**Date:** 2026-02-08
**Verdict:** APPROVED
**Owner:** safety-engineer

---

## Files Reviewed

| File | Lines | Purpose |
|------|-------|---------|
| `src/finding-schema.ts` | 279 | Zod-based finding validation with 33+ logical fields |
| `src/phases/safety.ts` | 446 | Environment classification + SafetyGuard action gating |
| `src/phases/github-issues.ts` | 504 | Issue creation with duplicate detection via gh CLI |

## Tests

| Test File | Count | Status |
|-----------|-------|--------|
| `tests/unit/safety-v2.test.ts` | 31 | All passing |
| `tests/unit/finding-schema.test.ts` | 14 | All passing |

**Total: 45 tests, all passing**

## Dependencies

- `zod` confirmed in package.json dependencies (not devDependencies)

## Architecture Alignment

- `finding-schema.ts` in `src/` root - correct (shared module used across phases)
- `safety.ts` in `src/phases/` - correct
- `github-issues.ts` in `src/phases/` - correct

## Strengths

1. **finding-schema.ts**: Factory function `createFinding()` with auto-incrementing IDs and dedup hashes
2. **finding-schema.ts**: `upgradeLegacyFinding()` for backward compatibility with v1 findings
3. **finding-schema.ts**: `validateFinding()` returns discriminated union (`{ success: true, data }` or `{ success: false, errors }`)
4. **safety.ts**: 4-tier environment classification: dev (localhost, private IPs, .local, non-standard ports), staging (qa/preview/canary/uat), production (known TLDs), unknown
5. **safety.ts**: SafetyGuard with configurable allow/deny lists + action gating for form_submit, delete, account_modify, data_write
6. **safety.ts**: Production + unknown environments default to safe mode - correct fail-safe behavior
7. **github-issues.ts**: Duplicate detection via `gh issue list --label audit-finding` before creating
8. **github-issues.ts**: Rich markdown issue body with severity badges, PRD section refs, evidence links

## Issues Found

### MINOR - Label quote injection (`github-issues.ts:326`)

Previously:
```typescript
const labelArgs = labels.map((l) => `--label "${l}"`).join(' ');
```

A label containing double quotes would break the shell command. **Fixed in Task #19** - now uses `shellEscape()`.

### MINOR - Dead code (`safety.ts:334`)

Previously:
```typescript
if (hostname.endsWith('.dev') && !hostname.includes('.')) return true;
```

If a hostname ends with `.dev`, it must contain at least one dot (the one before `dev`), so `!hostname.includes('.')` is always false. The condition can never be true. **Fixed in Task #19.**

## Notes for Downstream Consumers

- `createFinding(partial)` auto-generates: `id` (F-001, F-002, ...), `dedup_hash`, `created_at`, `confidence` (default 70)
- `assessSafety(config)` is the main entry point - returns `{ safeMode, classification, reason }`
- `gateAction(safeMode, guard, action)` returns `null` if allowed, or `BlockedAction` if blocked
- `writeBlockedActions(auditDir)` persists all blocked actions to `safety-blocked-actions.json`
- GitHub issues require `gh` CLI to be installed and authenticated
