# Orchestrator Integration Guide

How to wire the observability modules into the orchestrator.

**Canonical locations (v2 directory structure):**
- `src/pipeline/checkpoint-manager.ts` - Atomic checkpoint save/restore
- `src/storage/action-logger.ts` - Append-only JSONL audit trail
- `src/reporting/dashboard-server.ts` - Live HTTP dashboard

Re-export shims exist at old paths (`src/checkpoint-manager.ts`, etc.) for backward compatibility.

## 1. Imports to Add (orchestrator.ts, top of file)

```typescript
import { ActionLogger } from './storage/action-logger.js';
import {
  saveCheckpoint as saveCheckpointV2,
  buildCheckpointState,
  loadCheckpoint as loadCheckpointV2,
  shouldResume as shouldResumeV2,
} from './pipeline/checkpoint-manager.js';
import { startDashboardServer, type DashboardServer } from './reporting/dashboard-server.js';
```

## 2. Initialize Logger and Dashboard (runAudit, after Step 2c)

Insert after line 103 (`initializePhaseHandlers(playwrightBrowser);`):

```typescript
// Step 2d: Initialize action logger
const actionLogger = ActionLogger.init(auditDir);
actionLogger.log({ action_type: 'audit_start', details: `Audit ${config.auditId} started` });

// Step 2e: Start live dashboard server
let dashboardServer: DashboardServer | undefined;
try {
  dashboardServer = await startDashboardServer({ auditDir });
  console.log(`[Orchestrator] Dashboard: ${dashboardServer.url}`);
} catch (error) {
  console.warn(`[Orchestrator] Warning: Dashboard server failed: ${error}`);
}
```

## 3. Enhanced Resume Support (Step 5)

Replace the existing `loadCheckpoint` call (lines 126-132) with:

```typescript
if (config.resume) {
  const checkpoint = loadCheckpointV2(auditDir);
  if (checkpoint && checkpoint.completedPhases.length > 0) {
    completedPhases = checkpoint.completedPhases;
    phasesToRun = phasesToRun.filter((p) => !completedPhases.includes(p));
    console.log(`[Orchestrator] Resuming from checkpoint: ${completedPhases.length} phases done, ${phasesToRun.length} remaining`);
    actionLogger.log({
      action_type: 'checkpoint_saved',
      details: `Resumed from checkpoint with ${completedPhases.length} completed phases`,
    });
  }
}
```

## 4. Phase Start/Complete Logging (runPhasesSequentially)

After `console.log(\`[Orchestrator] Starting phase: ${phaseName}\`);` (line 264):

```typescript
ActionLogger.getInstance()?.log({
  action_type: 'phase_start',
  phase: phaseName,
  details: `Starting phase ${phaseName}`,
});
```

After `console.log(\`[Orchestrator] Phase ${phaseName} completed ...\`);` (line 273):

```typescript
ActionLogger.getInstance()?.log({
  action_type: 'phase_complete',
  phase: phaseName,
  duration_ms: result.durationMs,
  details: `Phase ${phaseName} completed successfully`,
});
```

After `console.error(\`[Orchestrator] Phase ${phaseName} failed ...\`);` (line 292):

```typescript
ActionLogger.getInstance()?.log({
  action_type: 'phase_failed',
  phase: phaseName,
  details: `Phase ${phaseName} failed: ${result.error}`,
});
```

## 5. Enhanced Checkpoint Saves (runPhasesSequentially)

Replace the existing `saveCheckpoint(auditDir, completedPhases);` (line 290) with:

```typescript
const cpState = buildCheckpointState({
  completedPhases,
  elapsedMs: Date.now() - startTime,
  findingsCount: /* count from findings dir */,
});
saveCheckpointV2(auditDir, cpState);
ActionLogger.getInstance()?.log({
  action_type: 'checkpoint_saved',
  phase: phaseName,
  details: `Checkpoint saved after ${phaseName}`,
});
```

## 6. Same Changes for runPhasesParallel

Apply identical logging and checkpoint patterns to the parallel execution path (lines 317-461).

## 7. Shutdown Dashboard (Step 8, after browser close)

After the browser close block (line 185):

```typescript
// Shut down dashboard server
if (dashboardServer) {
  try {
    await dashboardServer.close();
    console.log(`[Orchestrator] Dashboard server stopped`);
  } catch (error) {
    console.warn(`[Orchestrator] Warning: Dashboard server shutdown failed: ${error}`);
  }
}

// Final action log entry
ActionLogger.getInstance()?.log({
  action_type: 'audit_complete',
  details: `Audit ${auditSuccess ? 'completed' : 'failed'} in ${totalDurationMs}ms`,
});
ActionLogger.reset();
```

## 8. Progress Init Enhancement

The `initializeProgress` function (line 468) should be enhanced to include:
- `phases_completed: 0`
- `total_phases: phases.length`
- `estimated_remaining_ms: null`
- `findings_by_severity: { P0: 0, P1: 0, P2: 0, P3: 0, P4: 0 }`

And `updatePhaseProgress` should track per-phase timing by recording `started_at` and computing duration on completion.
