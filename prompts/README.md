# Project Completion Agent - Prompts

This directory contains all prompt files used by the orchestrator to guide Claude through each phase of the audit pipeline.

## Prompt Files Created

### Phase Prompts (Main Pipeline)

| File | Lines | Purpose | Task ID |
|------|-------|---------|---------|
| `phase-1-prd-parsing.md` | 308 | Extract structured data from PRD documents | T-008 |
| `phase-2-prd-mapping.md` | 301 | Map discovered routes to PRD features with confidence scores | T-013 |
| `phase-4-exploration.md` | 671 | Systematically explore application pages and capture inventory | T-018 |
| `phase-6-form-testing.md` | 644 | Execute 7 test types per form with safety mode enforcement | T-024 |
| `phase-6-responsive.md` | 515 | Test responsive behavior at mobile/tablet/desktop viewports | T-025 |
| `phase-7-verification.md` | 445 | Reproduce findings 3 times in different browser states | T-029 |
| `phase-7-critique.md` | 460 | Evaluate findings for confidence, actionability, PRD alignment | T-030 |
| `phase-8-review.md` | 362 | Present findings to user for accept/reject/skip decisions | T-035 |
| `phase-9-verification.md` | 330 | Final verification before GitHub issue creation | T-048 |

### Subagent Prompts (Parallel Execution)

| File | Lines | Purpose | Task ID |
|------|-------|---------|---------|
| `subagent-explore.md` | 338 | Page exploration worker (parallel route exploration) | T-040 |
| `subagent-form-test.md` | 421 | Form testing worker (parallel form testing) | T-041 |
| `subagent-review-security.md` | 345 | Security lens review (OWASP, injection, auth issues) | T-042a |
| `subagent-review-ux.md` | 384 | UX lens review (feedback, flows, accessibility) | T-042b |
| `subagent-review-adversarial.md` | 390 | Devil's advocate review (false positive detection) | T-042c |

**Total:** 15 prompt files, 6,062 lines of instructions

## Prompt Structure

Each prompt file follows this structure:

1. **Role Definition**: Clear statement of the agent's role and task
2. **Input Specification**: What data/context the agent receives
3. **Output Schema**: Exact JSON structure expected (with inline schemas)
4. **Rules & Guidelines**: Step-by-step instructions and constraints
5. **Examples**: Concrete examples of correct output
6. **Special Cases**: Edge cases and fallback behaviors
7. **Validation Checklist**: Pre-flight checks before completion

## Key Features

### Inline Schemas
All prompts include complete JSON schemas inline (not references). This ensures the agent has full context without needing to reference external files.

### Safety Enforcement
- `safe_mode` checks before any destructive actions
- Explicit instructions to skip submissions in production
- Data tracking for all test data created

### Selector Safety
- Mandatory use of specific selectors (never generic `querySelector('button')`)
- Examples of safe vs unsafe selectors
- Enforcement in exploration and testing phases

### Finding Schema (33 Fields)
All finding-creation prompts include the complete 33-field finding schema:
- schema_version, id, source, type, severity
- title, description, location (file, line, url, selector)
- evidence (screenshot_id, code_snippet, expected, actual, steps_to_reproduce)
- verification (required, method, status, attempts)
- signature, prd_feature_id, confidence, labels
- issue_number, created_at, updated_at

### Stop Rules
Exploration prompts include stop conditions:
- Max pages (default: 20)
- Max routes (default: 50)
- Max instances per pattern (default: 5)
- Time budget (default: 30 minutes)
- stop.flag detection

## Usage by Orchestrator

The orchestrator loads these prompts dynamically based on the current phase:

```typescript
const prompt = await loadPrompt(`prompts/phase-${phaseNumber}-${phaseName}.md`);
const response = await claude.messages.create({
  messages: [{
    role: 'user',
    content: prompt + contextData
  }]
});
```

## Prompt Versioning

- All prompts specify `schema_version: "1.0.0"` in their output schemas
- Breaking changes to schemas require new prompt versions
- Orchestrator validates output against expected schemas

## Testing Prompts

To test a prompt in isolation:

```bash
# Load prompt
cat prompts/phase-1-prd-parsing.md

# Provide test PRD as context
cat test-fixtures/sample-prd.md

# Run through Claude API
# Expected: prd-summary.json matching schema
```

## Maintenance Notes

- Keep prompts self-contained (all schemas inline)
- Update line counts in this README when modifying prompts
- Test prompt changes against audit pipeline
- Version prompts if schemas change
- Document any new special cases or edge cases
