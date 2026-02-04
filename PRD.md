# Project Completion Agent - Product Requirements Document

**Version:** 1.3
**Date:** February 3, 2026
**Status:** Complete — Ready for Implementation Planning

---

## Project Constitution

> These principles govern all decisions in this project. When in doubt, refer back here.

### Core Philosophy

1. **Adversarial over accommodating** — The agent tests like a skeptical user, not a friendly developer. It actively tries to break things.

2. **Evidence over opinion** — Every finding must have proof: screenshots, reproduction steps, expected vs. actual. "It feels wrong" is not a finding.

3. **Actionable over comprehensive** — A small report of fixable issues beats a massive dump of theoretical concerns. Quality > quantity.

4. **Integrate, don't reinvent** — This agent fits into existing workflows (`/orchestrate`, GitHub Issues, PRD-driven development). It doesn't replace them.

5. **Human judgment preserved** — The agent proposes, the human disposes. Never auto-create issues, auto-modify code, or take irreversible actions without explicit approval.

### Technical Constraints

6. **Claude Code skill system** — Must be implementable as a Claude Code skill that can be invoked via `/complete-audit` and `/complete-verify`.

7. **Browser-first, but not browser-only** — Primary interface is Claude for Chrome MCP, but Playwright fallback ensures headless environments work.

8. **Stateless between invocations** — Each audit is independent. State (checkpoints, findings) persists to files, not memory. Resumption reads from disk.

9. **No new infrastructure required** — Should work with: local filesystem, GitHub API, existing browser. No databases, cloud services, or accounts required for v1.

### Quality Bars

10. **<20% false positive rate** — If more than 1 in 5 findings are noise, the tool is hurting not helping.

11. **Findings must map to action** — Every issue should be addressable via `/orchestrate`. If it can't be fixed by an AI coding agent, flag it as `[MANUAL INTERVENTION REQUIRED]`.

12. **Respect the PRD** — The specification is the source of truth. Don't flag intentional design decisions as bugs. When uncertain, mark `[NEEDS CLARIFICATION]` rather than assume.

---

## Executive Summary

The Project Completion Agent addresses a specific gap in AI-assisted development workflows: the transition from "code complete" to "actually complete." Current agentic coding tools (Claude Code, Cursor, etc.) excel at implementing features from specifications, but stop at task completion. The remaining 25% — edge cases, integration validation, UX polish, error handling — requires a different approach: adversarial exploration of the running application.

### The Problem

> "Code complete" in agentic coding is not the end, but it IS the end of current agents/capabilities.

Projects consistently reach ~75% completion where:
- All planned tasks are checked off
- Features "work" in the happy path
- But real-world usage reveals gaps: auth edge cases, payment flow failures, missing error states, confusing UX

### The Solution

An agent that:
1. **Explores the running application** like a naive user (not the developer who built it)
2. **Compares behavior against specifications** (PRDs, plans, task lists)
3. **Documents gaps** with evidence (screenshots, reproduction steps)
4. **Creates actionable issues** for existing orchestration workflows to execute
5. **Verifies fixes** with regression testing around the fixed area

---

## User Persona

**Primary User:** Solo developer or small team using AI-assisted development workflows

**Context:**
- Uses structured planning (PRDs → Plans → Task Lists)
- Has orchestration tooling (e.g., `/orchestrate gh issue #17`)
- Projects are web applications (primary) or CLI tools (secondary)
- Struggles with the "last 25%" — polish, edge cases, integration testing
- Projects that reach completion have personal stakes or organic daily usage

**Current Workflow:**
```
PRD → Plan → Task List → /orchestrate per task → "Code Complete" → ??? → Abandonment
```

**Desired Workflow:**
```
PRD → Plan → Task List → /orchestrate per task → "Code Complete" → /complete-audit → Issues → /orchestrate per issue → Actually Complete
```

---

## Functional Requirements

### FR-1: Audit Modes

#### FR-1.1: Full Audit
- Comprehensive exploration of the entire application
- Frequency: Monthly or less (expensive, time-consuming)
- Discovers unknown unknowns
- Must handle long execution times (background processing, checkpointing)
- **Definition of "complete":**
  1. Analyze codebase first — identify routes, components, API endpoints, key functions as "testable surface area"
  2. Build coverage checklist — map code artifacts to expected UI/behavior
  3. Track progress — mark items as covered during exploration
  4. Complete when all identified coverage items tested, OR user stops via dashboard
- **Progress Dashboard:** Local web page showing:
  - Coverage metrics (% routes tested, forms submitted, flows completed)
  - Issues found (live updating)
  - Current agent activity
  - "That's enough" button to stop early

#### FR-1.2: Focused Audit
- User provides steering: "prioritize auth, user CRUD, payment flows"
- Agent gives extra attention to specified areas
- Still explores generally but with weighted focus

#### FR-1.3: Targeted Verify
- Verifies specific issue was fixed
- Tests adjacent functionality for regressions
- Quick execution (single flow + related flows)
- Command: `/complete-verify gh issue #42`

### FR-2: Context Discovery

#### FR-2.1: Auto-discover Planning Docs
- Glob for: `**/PRD*.md`, `**/prd*.md`, `**/plan*.md`, `**/tasks*.md`
- Use latest version as source of truth
- Scan earlier versions and related docs for intentional changes/deferrals
- **Version Detection:** Determine "latest" by: (1) version in filename (v1, v2), (2) frontmatter date, (3) git commit date

#### FR-2.2: Build Mental Model
- Parse PRD to understand what the app IS and SHOULD DO
- Identify key user flows, features, and acceptance criteria
- Note what was explicitly deferred vs. potentially forgotten

### FR-3: Application Interaction

#### FR-3.1: Browser Automation
- **Primary:** Claude for Chrome (MCP-based, visual inspection)
- **Fallback:** Playwright headless (for systems without browser access)
- Screenshot each page during exploration
- Identify all interactive elements (links, buttons, forms)
- **SPA Handling:** Wait for DOM mutations, detect client-side routing, scroll to trigger lazy loading
- **Multi-tab/Popup Flows:** Handle OAuth windows, payment provider popups, new tab navigation

#### FR-3.2: Dynamic Test Plan
- Start with expected flows from PRD
- Discover UI elements → add to test plan
- Recursive exploration: find new paths → update plan → explore
- Build a map of the application as it explores
- **Coverage Metrics:** Track screens visited, elements interacted, flows completed to determine audit completeness
- **Non-Happy-Path States:** Explicitly test empty states, max limits, rate limits, suspended accounts

#### FR-3.3: Multi-Permission Testing
- Accept credentials for multiple roles (admin, user, guest)
- Test same flows at each permission level
- Catch authorization bugs ("admin can see user data")

### FR-4: Authentication & Data Safety

#### FR-4.1: Authentication
- Accept test credentials as configuration
- **User creation:** Infer from PRD and UI, not config flag:
  | PRD says signup | UI has signup | Action |
  |-----------------|---------------|--------|
  | Yes | Yes | Test it (create test user with pattern `test+audit-{timestamp}@testdomain.com`) |
  | Yes | No | **Finding:** "PRD specifies signup but no button found" |
  | No | Yes | Test it (unexpected but verify it works) |
  | No | No | Move on |
- **OAuth/SSO handling (v1):**
  1. Attempt OAuth via Claude for Chrome (browser may already be authenticated)
  2. If succeeds automatically, continue
  3. If requires interaction, pause and notify via dashboard: "OAuth needs manual completion"
  4. User completes in browser, clicks Continue on dashboard
  5. Agent verifies auth succeeded and resumes

#### FR-4.2: Data Safety
- **Must ask:** Is this production data?
- If production: require sandbox/test company/fake data strategy
- Never modify real user data without explicit confirmation
- Support "test mode" flags for payment systems (Stripe test keys, etc.)
- **Safe Mode:** Option to skip destructive actions (delete, refunds, irreversible changes)
- **Test Data Reset:** Strategy for cleaning up or using dedicated test org/company

#### FR-4.3: Privacy & Screenshots
- **PII Redaction:** Guidance on redacting sensitive data from screenshots before storage
- **Retention Policy:**
  1. Screenshots stored temporarily in `.complete-agent/audits/*/screenshots/`
  2. When GitHub issues created: upload to GitHub, embed in issue body
  3. After issue creation: delete local copies (evidence lives in GitHub)
  4. Findings not promoted to issues: delete at end of audit
  5. Fallback if upload fails: keep locally, reference paths in issue
- **Compliance:** Consider GDPR/privacy implications of evidence collection

#### FR-4.4: External Verification Flows
- **Email/SMS verification (v1):**
  1. Agent detects "check your email" / "verify your phone" flows
  2. Pauses and notifies via dashboard: "Verification required. Complete it, then click Continue"
  3. User manually completes verification
  4. Agent resumes and verifies flow completed
- **Email/SMS verification (v2):** Integrate with test email services (Mailosaur, ethereal.email) for full automation

#### FR-4.5: Real-Time Features
- **Websockets, presence, notifications (v1):**
  1. Trigger action that should cause real-time update
  2. Wait configurable N seconds (default: 5s)
  3. Verify expected state change occurred
  4. Pass: mark as tested
  5. Fail: report as finding with "real-time feature may be flaky or broken"
- **v2:** Evaluate additional needs based on v1 experience

### FR-5: Issue Generation

#### FR-5.1: Finding Classification
- **Showstopper (P0):** App crashes, data loss, security hole, core flow broken
- **Significant (P1):** Feature doesn't match spec, important edge case fails
- **Polish (P2):** UX confusion, minor visual issues, nice-to-have improvements
- **Question:** Ambiguous requirement, needs human clarification

#### FR-5.2: Evidence Collection
- Screenshots of the issue
- Steps to reproduce
- Expected vs. actual behavior
- Related PRD section (if traceable)

#### FR-5.3: Output Flow
1. Generate local report (markdown)
2. Present findings to user for review
3. User selects which findings become issues
4. Create GitHub issues for approved findings
5. Issues are grouped by feature area (except P0 which are atomic)
6. **Deduplication:** Check for existing similar issues before creating new ones
7. **Batching:** Avoid issue spam with triage thresholds and grouping

### FR-6: Verification & Regression

#### FR-6.1: Issue Tracking
- Track which issues were created by completion agent
- Store reproduction steps for later verification

#### FR-6.2: Fix Verification
- Re-run the specific test that found the issue
- Verify the issue is resolved

#### FR-6.3: Regression Testing
- Test adjacent functionality around the fix
- Example: "deleted user login" fix → also test active user login, logout, password reset
- Catch unintended side effects

### FR-7: Quality Assurance

#### FR-7.1: LLM Critique
- Before presenting findings to user, run critique pass
- Filter out low-confidence or subjective findings
- Ensure findings are actionable, not vague

#### FR-7.2: Avoid False Positives
- Don't flag intentional design decisions as bugs
- Cross-reference PRD for "that's not a bug, it's a feature" cases
- Mark uncertain findings as `[NEEDS CLARIFICATION]`

---

## Non-Functional Requirements

### NFR-1: Execution Time
- Full audit may take 30-60+ minutes
- Must handle gracefully: background execution, progress updates, checkpointing
- Targeted verify should complete in under 5 minutes
- **Retry Policy:** Configurable retries with exponential backoff for flaky elements
- **Timing Heuristics:** Wait strategies for eventual consistency, background jobs, network latency

### NFR-2: Environment
- **Supported:** Staging, Production
- **Not supported:** Local development (too preliminary for "completion" testing)
- App must be running before agent is invoked (user confirms this)

### NFR-3: Integration
- Output format compatible with existing `/orchestrate` workflow
- GitHub Issues as primary issue tracker
- Markdown reports for local review

### NFR-4: Observability
- Log all actions taken during audit
- Capture screenshots at each step
- Generate audit trail for debugging agent behavior

---

## Invocation Interface

### Full Audit
```
/complete-audit
/complete-audit --focus "auth, payments, user CRUD"
```

### Targeted Verify
```
/complete-verify gh issue #42
/complete-verify --flow "user registration"
```

### Configuration
```yaml
# .complete-agent.yml or similar
credentials:
  admin:
    email: admin@test.com
    password: ${ADMIN_TEST_PASSWORD}
  user:
    email: user@test.com
    password: ${USER_TEST_PASSWORD}

environment:
  url: https://staging.myapp.com
  is_production_data: false

github:
  repo: owner/repo
  create_issues: true  # or false for report-only mode
```

---

## Success Criteria

1. **Finds real issues** — Audit discovers bugs that would have been found by real users
2. **Actionable output** — Issues have clear reproduction steps, can be fixed via `/orchestrate`
3. **Reasonable signal-to-noise** — <20% false positive rate on findings
4. **Integrates with workflow** — Fits naturally into existing PRD → Plan → Task → Orchestrate flow
5. **Actually gets used** — Becomes part of the regular development cycle, not shelfware

---

## Out of Scope (v1)

- Mobile app testing (web only for v1)
- API-only testing without UI (future: REST/GraphQL audit mode)
- Performance testing (focus is functional correctness)
- Security penetration testing (basic auth checks only)
- Continuous/scheduled audits (manual trigger only for v1)

---

## Architecture Decisions

> High-level technical decisions made before implementation planning.

### AD-1: Implementation Form Factor

**Decision:** Claude Code Skill (not standalone CLI, not MCP server)

**Rationale:**
- Fits existing workflow — user already invokes skills via `/command`
- Access to Claude Code's tools (Bash, Read, Write, browser MCP, GitHub CLI)
- No separate installation or infrastructure
- Can leverage Task tool for long-running background work

**Structure:**
```
~/.claude/skills/complete-audit/
├── skill.md           # Skill definition and instructions
├── templates/
│   ├── report.md      # Finding report template
│   └── issue.md       # GitHub issue template
└── lib/
    └── checklist.md   # Audit checklist by app type
```

### AD-2: State Management

**Decision:** File-based state in project's `.complete-agent/` directory

**Rationale:**
- Stateless between invocations (per constitution)
- Human-readable for debugging
- Git-ignorable for sensitive data
- No database required

**Structure:**
```
.complete-agent/
├── config.yml              # Credentials, environment, settings
├── audits/
│   └── 2026-02-03-full/
│       ├── checkpoint.json # Resume state (JSON for machine parsing)
│       ├── coverage.json   # Test coverage metrics and progress
│       ├── findings.md     # Raw findings before review
│       ├── report.md       # Final report after LLM critique
│       └── screenshots/    # Evidence images (deleted after issue creation)
├── dashboard/              # Local progress dashboard
│   └── index.html          # Auto-refreshing status page
└── issues/
    └── issue-42-verify.md  # Reproduction steps for verification
```

### AD-3: Browser Automation Strategy

**Decision:** Claude for Chrome primary, Playwright secondary

**Implementation:**
- Detect if Claude for Chrome MCP is available
- If yes: use `mcp__claude-in-chrome__*` tools for visual inspection
- If no: fall back to Playwright via Bash commands
- Screenshot at each significant state change
- Build page map incrementally as exploration proceeds

### AD-4: Long-Running Audit Handling

**Decision:** Checkpointing with background Task agent

**Implementation:**
- Full audit runs as background Task agent
- Checkpoint state saved every N pages/actions
- If interrupted, `/complete-audit --resume` reads checkpoint
- Progress updates written to `.complete-agent/audits/*/progress.md`

### AD-5: Issue Creation Integration

**Decision:** GitHub CLI (`gh`) for issue management

**Rationale:**
- Already available in Claude Code environment
- User's existing `/orchestrate` workflow uses GitHub issues
- No additional authentication required if `gh` is configured

**Flow:**
1. Generate findings locally
2. User reviews and approves in terminal
3. Approved findings → `gh issue create` with template
4. Issue body includes reproduction steps for `/orchestrate` and `/complete-verify`

---

## Open Questions — All Resolved

1. **Checkpoint format:** ✅ JSON (machine-optimized, agent can interpret if human needs to read)
2. **Screenshot storage:** ✅ Upload to GitHub when issues created, delete local copies after
3. **Multi-repo projects:** ✅ `[DEFERRED TO V2]` — v1 assumes single app, single repo
4. **CI/CD integration:** ✅ `[DEFERRED TO V2]`
5. **External verification flows:** ✅ v1: pause for manual completion; v2: test email service integration
6. **Real-time features:** ✅ v1: basic temporal checks (wait N seconds, verify state); v2: evaluate based on experience
7. **Issue tracker flexibility:** ✅ `[DEFERRED TO V2]` — GitHub only for v1

---

## Codex Review Feedback (Incorporated)

**Review Date:** February 3, 2026

### Additions Made Based on Feedback:
- FR-3.1: Added SPA handling, multi-tab/popup flow support
- FR-3.2: Added coverage metrics, non-happy-path state testing
- FR-4.2: Added safe mode, test data reset strategy
- FR-4.3: New section for privacy/screenshot handling
- FR-5.3: Added deduplication and batching for issue creation
- FR-2.1: Added version detection logic
- NFR-1: Added retry policy and timing heuristics

### Deferred to Future Versions:
- Hybrid UI + API contract testing
- Record/replay golden paths
- Product analytics integration for flow prioritization
- Internationalization/accessibility flow testing
- File upload/download testing
- Test email service integration (Mailosaur, etc.)
- Advanced real-time feature validation
- Multi-repo/monorepo support
- Alternative issue trackers (Jira, Linear, Notion)
- CI/CD gate mode

---

## Appendix: Learnings from Reference Projects

### From BMAD-METHOD
- Scale-adaptive intelligence (adjust depth based on complexity)
- Specialized agents for different concerns (UI, data, security)
- Two-path model (quick vs. comprehensive)

### From spec-kit (GitHub)
- Specifications as source of truth
- Explicit uncertainty markers (`[NEEDS CLARIFICATION]`)
- Template-driven quality (checklists as "unit tests" for audits)
- Traceable decisions (link findings to requirements)

### From social-marketing-tool Case Study
- COMPREHENSIVE_PROJECT_REVIEW.md = ideal audit output format
- HARDENING-PLAN.md = ideal remediation plan format
- The gap between "tasks checked off" and "actually works" is real and consistent

---

## PRD Completeness Checklist

> Per spec-kit methodology: checklists as "unit tests" for specifications.

### Requirements Quality
- [x] Problem statement is clear and evidence-based
- [x] User persona is defined with context
- [x] Functional requirements cover all major capabilities
- [x] Non-functional requirements address performance, environment, integration
- [x] Success criteria are measurable
- [x] Out of scope is explicitly defined

### Clarity & Ambiguity
- [x] All `[NEEDS CLARIFICATION]` markers resolved
- [x] Requirements use specific language (not "should be fast" but "<5 minutes")
- [x] Edge cases identified (via Codex review)
- [x] Acceptance criteria are testable

### Architecture Readiness
- [x] Form factor decided (Claude Code skill)
- [x] State management approach defined
- [x] Integration points identified (GitHub, browser MCP)
- [x] No new infrastructure required (per constitution)

### Process Compliance
- [x] Constitution/principles defined
- [x] Codex review completed and feedback incorporated
- [x] Open questions documented with clarification status
- [x] All open questions resolved OR marked `[DEFERRED TO V2]`

### Ready for Implementation Planning
- [x] All blocking `[NEEDS CLARIFICATION]` items resolved
- [x] Architecture decisions documented
- [x] Technical constraints clear
- [x] Integration with existing workflow validated (skill system, GitHub, /orchestrate)

---

**PRD Status:** ✅ Complete — All clarifications resolved. Ready for implementation planning.
