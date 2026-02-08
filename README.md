# Project Completion Agent

A Claude Code skill and TypeScript orchestrator that bridges the gap between "code complete" (~75% done) and "actually complete" (ready for real users).

## What It Does

The Project Completion Agent automates the tedious final stretch of software projects by:

1. **Exploring your running app** like a naive or adversarial user
2. **Comparing behavior** against your PRD specifications
3. **Generating findings** with screenshots and reproduction steps
4. **Creating GitHub issues** that can be fixed via existing workflows
5. **Verifying fixes** with regression testing

## Architecture

The agent runs as a **14-phase pipeline** orchestrated by TypeScript:

```
Preflight → PRD Parsing → Code Analysis → Progress Init → Safety
    → Exploration → Form Testing → Responsive Testing
    → Finding Quality → Report → Interactive Review
    → Verification → Completion Checklist → Polish
```

Each phase is either **pure TypeScript** (preflight, safety, progress, report) or **Claude-powered** (exploration, form testing, verification) via the Claude Agent SDK.

### Key Components

| Module | Purpose |
|--------|---------|
| `src/orchestrator.ts` | Pipeline execution engine |
| `src/phase-runner.ts` | Per-phase execution with retry, validation, budget |
| `src/sdk-bridge.ts` | Bridge to Claude Agent SDK with cost tracking |
| `src/job-runner.ts` | Parallel job execution with concurrency control |
| `src/browser-queue.ts` | Exclusive-lease queue for serialized browser access |
| `src/artifact-store.ts` | JSONL append-only artifact store with atomic writes |
| `src/cost-tracker.ts` | Per-phase cost/token/duration accounting |
| `src/route-discovery.ts` | Multi-source route discovery (code + sitemap + crawl) |

## Installation

### As a Claude Code Skill (Interactive)

```bash
git clone https://github.com/McSchnizzle/project-completion-agent.git
mkdir -p ~/.claude/skills/complete-audit
cp -r project-completion-agent/skill/* ~/.claude/skills/complete-audit/
```

### As a CLI Tool (Programmatic)

```bash
git clone https://github.com/McSchnizzle/project-completion-agent.git
cd project-completion-agent
npm install
npm run build
```

## Usage

### Claude Code Skill

```
/complete-audit
```

### CLI

```bash
# Full audit
npx tsx src/cli.ts audit --url http://localhost:3000

# With options
npx tsx src/cli.ts audit \
  --url http://localhost:3000 \
  --codebase-path ./my-app \
  --max-pages 20 \
  --parallel \
  --focus "/admin/*,/api/*"

# Verify a fix
npx tsx src/cli.ts verify --issue 42

# CI mode (non-interactive)
CI=1 npx tsx src/cli.ts audit --url http://localhost:3000
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--url` | Target application URL | Required |
| `--codebase-path` | Path to source code | `.` |
| `--prd` | Path to PRD document | Auto-detect |
| `--max-pages` | Maximum pages to explore | `50` |
| `--max-forms` | Maximum forms to test | `20` |
| `--parallel` | Enable parallel exploration | `false` |
| `--focus` | Glob patterns to focus on | All routes |
| `--browser` | Browser provider (`chrome`/`playwright`/`none`) | `chrome` |
| `--safe-mode` | Force safe mode (no destructive actions) | Auto-detect |
| `--budget` | Maximum spend in USD | `5.00` |
| `--resume` | Resume from last checkpoint | `false` |

## Configuration

Create `.complete-agent/config.yml` in your project root:

```yaml
environment:
  url: "https://staging.example.com"
  is_production_data: false
  safe_mode: false

credentials:
  admin:
    email: "${ADMIN_EMAIL}"
    password: "${ADMIN_PASSWORD}"

exploration:
  max_pages: 20
  same_origin_only: true

github:
  create_issues: true
  labels: ["audit", "completion-agent"]
```

## Requirements

- Node.js 18+
- [Claude Code](https://claude.ai/claude-code) CLI
- [Claude for Chrome](https://chrome.google.com/webstore/detail/claude-for-chrome) extension (or Playwright for headless)
- GitHub CLI (`gh`) authenticated (for issue creation)

## Output

Audit results are saved to `.complete-agent/audits/{audit-id}/`:

```
.complete-agent/audits/audit-20260206-120000/
├── progress.json       # Machine-readable progress
├── progress.md         # Human-readable progress
├── code-analysis.json  # Routes, forms, framework info
├── coverage-summary.md # Coverage metrics
├── report.md           # Final audit report
├── review-decisions.json # Finding review decisions
├── checkpoint.json     # Resume checkpoint
├── pages/              # Page inventory files
├── findings/           # Finding detail files
└── screenshots/        # Page screenshots
```

## Development

```bash
npm install
npm run typecheck    # TypeScript type checking
npm test             # Run tests (watch mode)
npm run test:run     # Run tests once
npm run test:coverage # Run with coverage
npm run build        # Compile TypeScript
```

## Parallel Mode

When `--parallel` is enabled, the agent fans out work using the JobRunner:

- **Exploration**: Routes grouped by prefix, explored concurrently
- **Form Testing**: Each form tested independently in parallel
- **Finding Review**: Three review lenses (security, UX, adversarial) run simultaneously

Browser access is serialized via the BrowserQueue (exclusive lease pattern). Non-browser work runs truly in parallel.

## Safety

The agent automatically classifies environments:

| Environment | Detection | Safe Mode |
|-------------|-----------|-----------|
| Development | localhost, 127.0.0.1, *.local, non-standard ports | Off |
| Staging | *.staging.*, *.stg.*, *.test.* | Off |
| Production | Real TLDs, standard ports | **On** |

Safe mode prevents destructive form submissions, account modifications, and data deletions.

## Stopping an Audit

```bash
touch .complete-agent/audits/current/stop.flag
```

## License

MIT
