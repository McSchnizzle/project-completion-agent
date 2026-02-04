# Project Completion Agent

A Claude Code skill that bridges the gap between "code complete" (~75% done) and "actually complete" (ready for real users).

## What It Does

The Project Completion Agent automates the tedious final stretch of software projects by:

1. **Exploring your running app** like a naive or adversarial user
2. **Comparing behavior** against your PRD specifications
3. **Generating findings** with screenshots and reproduction steps
4. **Creating GitHub issues** that can be fixed via existing workflows
5. **Verifying fixes** with regression testing

## Installation

Clone the repo and copy the skill to your Claude Code skills directory:

```bash
git clone https://github.com/McSchnizzle/project-completion-agent.git
mkdir -p ~/.claude/skills/complete-audit
cp -r project-completion-agent/skill/* ~/.claude/skills/complete-audit/
```

Restart Claude Code to load the skill.

## Usage

### Run an Audit

```
/complete-audit
```

The agent will:
- Detect your framework and extract routes from code
- Open your app in Chrome (via Claude for Chrome)
- Explore pages, capture screenshots, inventory elements
- Compare discovered routes with code analysis
- Report coverage metrics and any findings

### Focused Audit

```
/complete-audit --focus "auth, payments"
```

### Verify a Fix

```
/complete-verify gh issue #42
```

## Configuration

Create `.complete-agent/config.yml` in your project root:

```yaml
environment:
  url: "https://staging.example.com"
  is_production_data: false   # If true, safe_mode is forced ON
  safe_mode: false            # Skip destructive actions (delete, refund)

credentials:
  admin:
    email: "${ADMIN_EMAIL}"
    password: "${ADMIN_PASSWORD}"

exploration:
  max_pages: 20
  same_origin_only: true
  realtime_wait_seconds: 5

github:
  create_issues: true
  labels: ["audit", "completion-agent"]
```

## Requirements

- [Claude Code](https://claude.ai/claude-code) CLI
- [Claude for Chrome](https://chrome.google.com/webstore/detail/claude-for-chrome) extension (for browser automation)
- GitHub CLI (`gh`) authenticated (for issue creation)

## Output

Audit results are saved to `.complete-agent/audits/{timestamp}/`:

```
.complete-agent/
├── config.yml
├── audits/
│   ├── 2026-02-03T16-46-31/
│   │   ├── progress.md          # Audit progress and status
│   │   ├── coverage-summary.md  # Coverage report
│   │   ├── code-analysis.json   # Routes from code
│   │   ├── screenshots/         # Page screenshots
│   │   ├── findings/            # Issue details
│   │   └── pages/               # Page inventories
│   └── current -> 2026-02-03T16-46-31
└── issues/
```

## Stopping an Audit

To gracefully stop a running audit:

```bash
touch .complete-agent/audits/current/stop.flag
```

## Current Status

**Phases 0-7 Complete** - Full audit capability implemented:

### Phase 0-2, 4: Foundation (MVP)
- [x] Preflight checks (write access, browser, GitHub CLI, config)
- [x] PRD parsing (features, user flows, out-of-scope items)
- [x] Browser exploration via Claude for Chrome
- [x] Code analysis (Next.js App Router)
- [x] Route extraction and comparison
- [x] Component analysis (forms, modals, auth patterns)
- [x] Coverage metrics
- [x] Progress tracking with queue-based estimates
- [x] Stop flag support

### Phase 3: Dashboard
- [x] Progress file with completion estimates
- [x] Last action timestamps
- [x] Continue flag for pause/resume

### Phase 5: Authentication
- [x] Data safety gating (production detection, safe mode)
- [x] Credential management with env var substitution
- [x] Login flow with retry logic
- [x] External verification (OAuth, email, SMS pause/resume)
- [x] Multi-permission testing with session isolation

### Phase 6: Test Execution
- [x] Safe mode enforcement for destructive actions
- [x] Flow execution engine
- [x] Form testing (all control types)
- [x] Edge case generation
- [x] Real-time feature testing

### Phase 7: Finding Generation
- [x] Evidence collection (screenshots, console errors)
- [x] Finding classification (severity, confidence)
- [x] LLM critique pass for quality filtering
- [x] Deduplication
- [x] Privacy/screenshot retention policy

### Tested On

- PostCraft (Next.js 14+ app)
  - 47% page coverage (8 of 17 pages)
  - 20 PRD features extracted and mapped
  - 3 forms, 1 modal identified
  - 0 findings (app functioning correctly)

## Roadmap

See [PRD.md](./PRD.md) for full requirements and [plan.md](./plan.md) for implementation phases.

### Upcoming (Phases 8-10)

- Interactive finding review and approval
- GitHub issue creation from approved findings
- Fix verification (`/complete-verify gh issue #42`)
- Regression testing
- Checkpoint/resume for long audits

## License

MIT
