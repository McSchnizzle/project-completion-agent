# Review: Task #7 - NFR: Checkpointing, Observability, Dashboard

**Reviewer:** reviewer agent
**Date:** 2026-02-08
**Verdict:** APPROVED (with medium XSS note, now fixed)
**Owner:** infra-engineer

---

## Files Reviewed

| File | Lines | Purpose |
|------|-------|---------|
| `src/pipeline/checkpoint-manager.ts` | 133 | Atomic checkpoint save/restore for audit resume |
| `src/storage/action-logger.ts` | 145 | Singleton JSONL audit trail |
| `src/reporting/dashboard-server.ts` | ~410 | Live HTTP dashboard with Node built-in http module |
| `src/ORCHESTRATOR-INTEGRATION.md` | - | Integration guide with specific line references |

Note: Files were originally at `src/checkpoint-manager.ts`, `src/action-logger.ts`, `src/dashboard-server.ts` and were moved to subdirectories during Task #18 integration. Re-export shims exist at the old paths.

## Tests

| Test File | Count | Status |
|-----------|-------|--------|
| `tests/unit/checkpoint-manager.test.ts` | 11 | All passing |
| `tests/unit/action-logger.test.ts` | 11 | All passing |
| `tests/unit/dashboard-server.test.ts` | 7 | All passing |

**Total: 29 tests, all passing**

## Architecture Alignment

- Modules reorganized to match ARCHITECTURE-V2: `src/pipeline/`, `src/storage/`, `src/reporting/`
- Re-export shims at old paths preserve backward compatibility

## Strengths

1. **checkpoint-manager.ts**: Atomic writes (write .tmp then rename) prevent corrupt checkpoints on crash
2. **checkpoint-manager.ts**: `shouldResume()` checks both file existence and data validity
3. **checkpoint-manager.ts**: `CheckpointState` tracks: currentPhase, completedPhases, visitedUrls, explorationQueue, findingsCount, elapsedMs, timestamp
4. **action-logger.ts**: JSONL append-only format - one JSON object per line, easy to parse/stream
5. **action-logger.ts**: Singleton pattern with `init/getInstance/reset` lifecycle
6. **action-logger.ts**: ActionType union: phase_start, phase_complete, phase_failed, page_visit, screenshot_taken, finding_created, form_submitted, error_detected, checkpoint_saved, audit_start, audit_complete
7. **dashboard-server.ts**: API endpoints: `/api/progress`, `/api/actions`, `/api/findings`
8. **dashboard-server.ts**: Auto port selection starting at 3847 - avoids conflicts

## Issues Found

### MEDIUM - XSS in dashboard (originally `dashboard-server.ts:307`)

Previously used `innerHTML` with disk data for finding titles and locations. While low practical risk (localhost-only, data from our own audit artifacts), this is a bad pattern. **Fixed in Task #19** - now uses `textContent` for all dynamic data rendering.

### MINOR - Checkpoint directory dependency

`saveCheckpoint()` does not create the parent directory. It relies on the audit directory already existing (which the orchestrator ensures). If called standalone, it would fail with ENOENT. Low risk since it's always called within the orchestrator lifecycle.

## Notes for Downstream Consumers

- **Checkpoint**: `saveCheckpoint(auditDir, state)` / `loadCheckpoint(auditDir)` / `shouldResume(auditDir)`
- **ActionLogger**: Call `ActionLogger.init(auditDir)` once, then `ActionLogger.getInstance().log({ action_type, details })`, finally `ActionLogger.reset()` on shutdown
- **Dashboard**: `startDashboardServer({ auditDir })` returns `{ url, close() }` - call `close()` when audit completes
- Dashboard reads progress/findings/actions from disk on each API request (no in-memory state)
- JSONL actions file is at `{auditDir}/actions.jsonl`
- Checkpoint file is at `{auditDir}/checkpoint.json`
