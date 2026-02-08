# Project Completion Agent

A CLI tool that audits running web applications against their PRDs to find the "last 25%" of incomplete work. It reads your codebase, reads your PRD, visits your app in a real browser, and produces a prioritized finding report.

## Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org) or `brew install node`
- **Anthropic API key** — [console.anthropic.com](https://console.anthropic.com) (audits cost ~$0.50 each)

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/McSchnizzle/project-completion-agent.git
cd project-completion-agent
npm install

# 2. Install Playwright browser
npx playwright install chromium

# 3. Set your API key
export ANTHROPIC_API_KEY="sk-ant-..."

# 4. Run an audit against your app
AUDIT_CODEBASE_PATH=/path/to/your/project \
  npx tsx src/cli.ts audit \
  --url http://localhost:3000

# Results appear in your project at:
# .complete-agent/audits/current/report.md
```

## How It Works

The agent runs a **14-phase pipeline**:

```
Preflight → PRD Parsing → Code Analysis → Progress Init → Safety
  → Exploration → Form Testing → Responsive Testing
  → Finding Quality → Report → Interactive Review
  → GitHub Issues → Verification → Polish
```

Phases are either **pure TypeScript** (preflight, safety, report generation) or **browser + LLM** (exploration, form testing, verification). Browser phases use Playwright to collect page data, then send it to Claude for analysis against your PRD.

## Configuration

Create `.complete-agent/config.yml` in your target project:

```yaml
version: "2.0"

target:
  url: "http://localhost:3000"
  codebase_path: "."
  prd_path: "docs/prd.md"

# Optional: authenticate before auditing
auth:
  strategy: "form-login"
  loginUrl: "http://localhost:3000/login"
  credentials:
    username: "${APP_USERNAME}"       # reads from env var
    password: "${APP_PASSWORD}"
  successIndicator: "/dashboard"      # URL path or CSS selector

# Optional: testing controls
testing:
  safe_mode: false
  max_pages: 50
  max_forms: 20

# Optional: focus on specific areas
exploration:
  focus_patterns:
    - "/admin/*"
    - "/api/*"
```

### Authentication

Three auth strategies are supported:

| Strategy | Config | Use When |
|----------|--------|----------|
| `form-login` | `loginUrl`, `credentials`, `successIndicator` | App has a login form |
| `cookie` | `cookies: [{name, value, domain}]` | You have session cookies |
| `bearer` | `token: "..."` | API with bearer token auth |

The `successIndicator` accepts comma-separated values — URL paths (`/dashboard`) and/or CSS selectors (`.logged-in`).

Credentials support `${ENV_VAR}` syntax to read from environment variables.

## CLI Usage

```bash
# Full audit
AUDIT_CODEBASE_PATH=./my-app \
  npx tsx src/cli.ts audit --url http://localhost:3000

# With options
AUDIT_CODEBASE_PATH=./my-app \
  npx tsx src/cli.ts audit \
  --url http://localhost:3000 \
  --max-pages 30 \
  --parallel \
  --focus "/admin/*,/settings/*"

# Code-only mode (no browser, analyzes codebase only)
AUDIT_CODEBASE_PATH=./my-app \
  npx tsx src/cli.ts audit \
  --url http://localhost:3000 \
  --browser none --mode code-only

# Resume from checkpoint after interruption
AUDIT_CODEBASE_PATH=./my-app \
  npx tsx src/cli.ts audit --resume
```

### CLI Options

| Flag | Description | Default |
|------|-------------|---------|
| `--url` | Target application URL | Required |
| `--codebase-path` | Path to source code (or set `AUDIT_CODEBASE_PATH`) | `.` |
| `--prd` | Path to PRD document | Auto-detect from config |
| `--max-pages` | Maximum pages to explore | `50` |
| `--max-forms` | Maximum forms to test | `20` |
| `--parallel` | Enable parallel phase execution | `false` |
| `--focus` | Glob patterns to focus on | All routes |
| `--browser` | Browser backend (`playwright` or `none`) | `playwright` |
| `--mode` | Audit mode (`full` or `code-only`) | `full` |
| `--budget` | Maximum API spend in USD | `5.00` |
| `--resume` | Resume from last checkpoint | `false` |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |
| `AUDIT_CODEBASE_PATH` | Yes | Path to the project being audited |
| `GITHUB_TOKEN` | No | For GitHub issue creation |

## Output

Audit artifacts are written to `.complete-agent/audits/current/` in the target project:

```
.complete-agent/audits/current/
├── report.md              # Final audit report with findings and coverage
├── progress.json          # Machine-readable progress tracking
├── progress.md            # Human-readable progress summary
├── prd-summary.json       # Parsed PRD features and acceptance criteria
├── code-analysis.json     # Routes, forms, framework detection
├── feature-coverage.json  # PRD feature verification results
├── checkpoint.json        # Resume checkpoint
├── dashboard/
│   └── index.html         # Live monitoring dashboard
├── pages/                 # Page inventory (one JSON per page)
├── findings/              # Individual finding files (F-001.json, etc.)
└── screenshots/           # Evidence screenshots
```

### Report Contents

The report includes:
- **Executive summary** with finding counts by severity
- **Completion score** — percentage of must-have PRD features passing
- **Findings table** — P0-P3 defects sorted by severity
- **Feature coverage** — each PRD feature with pass/fail/partial status
- **Pages explored** — every page visited with load times
- **Recommendations** — prioritized next steps

## Safety

The agent classifies environments automatically:

| Environment | Detection | Safe Mode |
|-------------|-----------|-----------|
| Development | localhost, 127.0.0.1, *.local | Off |
| Staging | *.staging.*, *.stg.*, *.test.* | Off |
| Production | Real TLDs, standard ports | **On** |

Safe mode prevents destructive form submissions, account modifications, and data deletions.

## Stopping an Audit

```bash
touch .complete-agent/audits/current/stop.flag
```

The pipeline will stop after the current phase completes.

## Development

```bash
npm install
npm run typecheck     # TypeScript type checking
npm test              # Run tests (watch mode)
npm run test:run      # Run tests once (915 tests)
npm run test:coverage # Run with coverage
npm run build         # Compile TypeScript to dist/
```

### Architecture

| Module | Purpose |
|--------|---------|
| `src/cli.ts` | CLI entry point, config loading |
| `src/orchestrator.ts` | 14-phase pipeline coordinator |
| `src/phase-dispatcher.ts` | Routes phases by type (pure-ts, browser+llm) |
| `src/phase-init.ts` | Wires phase implementations to dispatcher |
| `src/anthropic-client.ts` | Anthropic SDK wrapper with cost tracking |
| `src/playwright-browser.ts` | Playwright browser automation |
| `src/feature-mapper.ts` | Maps PRD features to discovered pages |
| `src/finding-quality-pipeline.ts` | Quality gate filters for findings |
| `src/browser-phase-helpers.ts` | Per-phase browser data collection |
| `src/job-runner.ts` | Parallel job execution with concurrency control |

See [ARCHITECTURE-V2.md](./ARCHITECTURE-V2.md) for the full technical architecture.

## License

MIT
