# Review: Task #6 - FR-7: Quality Assurance Pipeline

**Reviewer:** reviewer agent
**Date:** 2026-02-08
**Verdict:** APPROVED
**Owner:** discovery-engineer

---

## Files Reviewed

| File | Lines | Purpose |
|------|-------|---------|
| `src/phases/finding-critique.ts` | 301 | Evidence-based confidence scoring + false positive detection |
| `src/phases/finding-dedup.ts` | 320 | Signature-based deduplication with GitHub issue matching |
| `src/finding-quality-pipeline.ts` | 213 | Pipeline orchestrator: critique -> dedup -> filter |

## Tests

| Test File | Count | Status |
|-----------|-------|--------|
| `tests/phases/finding-critique.test.ts` | 28 | All passing |
| `tests/finding-quality-pipeline.test.ts` | 10 | All passing |
| `tests/unit/finding-quality.test.ts` | 13 | All passing |

**Total: 51 tests, all passing**

## Architecture Alignment

- `finding-critique.ts` and `finding-dedup.ts` correctly placed in `src/phases/`
- `finding-quality-pipeline.ts` is in `src/` root (ARCHITECTURE-V2 suggests `src/pipeline/` for pipeline infra) - acceptable for Sprint 1
- Pipeline registered in `phase-init.ts:104` as pure-ts handler

## Strengths

1. Graceful fallback if dedup fails (`finding-quality-pipeline.ts:106-119`) - very resilient
2. Dual-format support across all modules (legacy + Zod schema field names)
3. Pre-compiled regex patterns for deviation detection (`finding-critique.ts:68-70`) - good performance
4. Detail-score tiebreaker in dedup keeps highest-quality finding (`finding-dedup.ts:86-93`)
5. Comprehensive evidence checks covering 6 signal types + deviation penalty

## Score Weights Reference

| Signal | Weight |
|--------|--------|
| hasScreenshot | +15 |
| hasCodeFileRef | +15 |
| hasLineNumbers | +10 |
| hasReproductionSteps | +20 |
| hasExpectedVsActual | +15 |
| hasPrdSectionRef | +15 |
| deviationPenalty | -30 |

Maximum possible score: 90 (all positive signals, no deviation).
Default confidence threshold: 25 (lowered from 50 in pipeline config).

## Issues Found

### MINOR - Cross-layer import (`finding-dedup.ts:9`)

```typescript
import { generateSignature, FindingSignatureInput } from '../../skill/utils/signature';
```

Imports from old v1 `skill/` directory. Should eventually migrate to `src/` path. Acceptable for Sprint 1 since the module exists and compiles, but creates a dependency on the legacy skill structure.

### MINOR - Double critique computation (`finding-quality-pipeline.ts:84,128`)

Each finding is critiqued twice - once in Step 1 (line 84) to filter flagged findings, and again in Step 4 (line 128) as a final confidence filter. The second pass re-runs the same pure function on a subset that already passed. Not a bug, but redundant work. Could cache the CritiqueScore from Step 1 and reuse it.

### MINOR - Evidence type conflict (`finding-dedup.ts:220-231`)

`calculateDetailScore()` treats `finding.evidence` as both an Array (line 220) and a Record (lines 231, 237) in the same function. If evidence is an array, the Record casts on lines 231/237 will produce `undefined` for `.code_snippet` and `.screenshot_id`. Not a crash, but those bonus points will never fire when evidence is array-shaped.

### INFO - Shell injection surface (`finding-dedup.ts:150`)

```typescript
`gh issue list --search "${escapeShellArg(searchQuery)}" ...`
```

The `escapeShellArg` function (line 285-288) escapes quotes and special chars. Passed inside double-quotes in a template literal fed to `execSync`. The escaping covers the common cases. Acceptable.

## Notes for Downstream Consumers

- `runQualityPipeline({ auditDir, confidenceThreshold? })` is the main entry point
- Pipeline reads findings from `{auditDir}/findings/*.json`
- Output: `QualityPipelineResult` with `finalFindings[]` and `report`
- `runQualityPipelineAndSave()` additionally writes `quality-report.json` to audit dir
- Quality report includes: false positive rate estimate, critique scores, dedup stats, filtered findings with reasons
