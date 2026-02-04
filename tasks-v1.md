# Project Completion Agent - Tasks v1

**Version:** 1.1
**Date:** February 3, 2026
**Scope:** Phases 0, 1, 2, 4 (MVP foundation + code analysis + browser exploration)
**Status:** MVP Complete (2026-02-03)

> **Sequencing Update:** Run Phase 2 (code analysis) BEFORE Phase 4 (browser) to seed exploration queue with routes.

---

## Phase 0: Preflight & Environment Validation

### 0.1 Write Access & Capability Detection

- [ ] **0.1.0** **FIRST:** Test write access by creating/deleting temp file in project root
- [ ] **0.1.1** Create preflight check function that runs before any audit
- [ ] **0.1.2** Check for Claude for Chrome MCP availability by calling `mcp__claude-in-chrome__tabs_context_mcp`
- [ ] **0.1.3** Set internal flag `browser_mode: 'mcp' | 'none'` based on detection
- [ ] **0.1.4** Display capability summary to user:
  - "✓ Write access: confirmed"
  - "✓ Browser automation: Claude for Chrome available" OR
  - "⚠ Browser automation: unavailable, will run code-only audit"
- [ ] **0.1.5** **Only proceed to URL prompt if browser_mode is 'mcp'** — skip URL validation for code-only audits
- [ ] **0.1.6** Allow user to abort if capabilities are insufficient

### 0.2 GitHub CLI Validation

- [ ] **0.2.1** Run `gh auth status` via Bash and parse output
- [ ] **0.2.2** If not authenticated: display error with fix instructions (`gh auth login`)
- [ ] **0.2.3** Check if current directory is a git repo with GitHub remote
- [ ] **0.2.4** If no GitHub remote: warn that issue creation will be skipped, allow continue
- [ ] **0.2.5** Store GitHub repo info (owner/repo) for later issue creation

### 0.3 App URL Validation

- [ ] **0.3.1** Check for `.complete-agent/config.yml` in project root
- [ ] **0.3.2** If config exists, read `environment.url`
- [ ] **0.3.3** If no config or no URL: prompt user to provide URL via AskUserQuestion
- [ ] **0.3.4** Verify URL is accessible (use WebFetch or curl via Bash)
- [ ] **0.3.5** If unreachable: display error with troubleshooting tips, allow retry or abort
- [ ] **0.3.6** Store validated URL for browser automation

### 0.4 PRD Discovery & Confirmation

- [ ] **0.4.1** Glob for planning docs: `**/PRD*.md`, `**/prd*.md`, `**/plan*.md`, `**/tasks*.md`
- [ ] **0.4.2** Filter out node_modules, .git, vendor directories
- [ ] **0.4.3** For each candidate, extract: filename, path, version (from name), frontmatter date if present
- [ ] **0.4.4** Rank candidates: PRD > plan > tasks, higher version numbers first, newer dates first
- [ ] **0.4.5** Present top candidate to user: "Found PRD: `PRD-v4.md`. Use this? [Yes/No/Other]"
- [ ] **0.4.6** If user selects "Other": let them specify path
- [ ] **0.4.7** If no PRD found: warn and ask if user wants to continue with code-only audit
- [ ] **0.4.8** Store selected PRD path for later parsing

---

## Phase 1: Foundation (Core Skill Structure)

### 1.1 Skill Scaffolding

- [x] **1.1.1** Create skill directory: `~/.claude/skills/complete-audit/`
- [x] **1.1.2** Create `skill.md` with:
  - Skill name: "complete-audit"
  - Commands: `/complete-audit`, `/complete-verify`
  - Basic description and usage
- [x] **1.1.3** Create `SKILL_INSTRUCTIONS.md` with detailed agent behavior rules
- [x] **1.1.4** Create `templates/` subdirectory
- [x] **1.1.5** Create `templates/config.example.yml` with documented schema:
  ```yaml
  # Required
  environment:
    url: "https://staging.example.com"  # App URL to audit
    is_production_data: false           # Safety flag

  # Optional
  credentials:
    admin:
      email: "${ADMIN_EMAIL}"
      password: "${ADMIN_PASSWORD}"
    user:
      email: "${USER_EMAIL}"
      password: "${USER_PASSWORD}"

  exploration:
    max_pages: 20                       # Max pages to visit
    same_origin_only: true              # Don't follow external links

  github:
    create_issues: true                 # Auto-create issues
    labels: ["audit", "completion-agent"]
  ```
- [x] **1.1.6** Create `templates/report.md` - finding report template
- [x] **1.1.7** Create `templates/issue.md` - GitHub issue template
- [x] **1.1.8** Test that `/complete-audit` is recognized and loads the skill

### 1.2 Project State Directory

- [x] **1.2.1** On skill invocation, check for `.complete-agent/` in project root
- [x] **1.2.2** If not exists: create `.complete-agent/` directory structure:
  ```
  .complete-agent/
  ├── config.yml
  ├── audits/
  └── issues/
  ```
- [x] **1.2.3** If `config.yml` doesn't exist: copy from template, prompt user to configure
- [x] **1.2.4** Create audit directory with timestamp: `.complete-agent/audits/{ISO-timestamp}/`
- [x] **1.2.5** Create symlink `.complete-agent/audits/current` → latest audit directory
- [ ] **1.2.6** Suggest adding to `.gitignore`: `.complete-agent/audits/`, `.complete-agent/config.yml`

### 1.3 PRD Parsing

- [ ] **1.3.1** Read the confirmed PRD file
- [ ] **1.3.2** Parse markdown structure: extract headings, lists, code blocks
- [ ] **1.3.3** Identify key sections:
  - Executive summary / description
  - Features / functional requirements
  - User flows / user stories
  - Acceptance criteria
  - Out of scope / deferred items
- [ ] **1.3.4** Extract feature list with names and brief descriptions
- [ ] **1.3.5** Extract user flows as list of steps
- [ ] **1.3.6** Flag "out of scope" and "deferred" items (don't report these as missing)
- [ ] **1.3.7** Save parsed PRD summary to `.complete-agent/audits/current/prd-summary.json`
- [ ] **1.3.8** Display summary to user: "Found X features, Y user flows, Z deferred items"

---

## Phase 4: Browser Automation (MVP)

### 4.1 Browser Setup

- [x] **4.1.1** If `browser_mode` is 'none': skip browser phases, log message, proceed to code analysis
- [x] **4.1.2** Call `mcp__claude-in-chrome__tabs_context_mcp` with `createIfEmpty: true`
- [x] **4.1.3** Store tab group context for session
- [x] **4.1.4** Create new tab via `mcp__claude-in-chrome__tabs_create_mcp`
- [x] **4.1.5** Navigate to validated app URL via `mcp__claude-in-chrome__navigate`
- [x] **4.1.6** Wait for page load, take initial screenshot
- [x] **4.1.7** Save screenshot to `.complete-agent/audits/current/screenshots/`

### 4.2 Page Discovery

- [x] **4.2.1** Use `mcp__claude-in-chrome__read_page` to get accessibility tree
- [x] **4.2.2** Extract all interactive elements: links, buttons, inputs, forms
- [x] **4.2.3** For each link: extract href, text, whether internal or external
- [x] **4.2.4** For each button: extract text, type, associated form if any
- [x] **4.2.5** For each form: extract action, method, all fields with types
- [x] **4.2.6** Build page inventory and save to `.complete-agent/audits/current/pages/{url-slug}.json`
- [x] **4.2.7** Initialize visited pages set with current URL

### 4.3 Basic Exploration

- [x] **4.3.1** Create exploration queue with all discovered internal links
- [x] **4.3.2** For each link in queue (up to configurable max, default 20):
  - [x] **4.3.2.1** Skip if already visited
  - [x] **4.3.2.2** Navigate to link via `mcp__claude-in-chrome__navigate`
  - [x] **4.3.2.3** Wait for page load
  - [x] **4.3.2.4** Take screenshot
  - [x] **4.3.2.5** Read page and extract elements (repeat 4.2.1-4.2.6)
  - [x] **4.3.2.6** Add new internal links to queue
  - [x] **4.3.2.7** Mark URL as visited
  - [x] **4.3.2.8** Update progress file
- [x] **4.3.3** Check for stop flag before each navigation
- [x] **4.3.4** Handle navigation errors gracefully (log and continue)

### 4.4 Progress Tracking

- [x] **4.4.1** After each page visit, update `.complete-agent/audits/current/progress.md`:
  ```markdown
  # Audit Progress
  Started: {timestamp}
  Current: {current_url}
  Pages visited: X
  Pages queued: Y
  Findings so far: Z

  To stop: touch .complete-agent/audits/current/stop.flag
  ```
- [ ] **4.4.2** Also write `progress.json` with structured data
- [x] **4.4.3** Check for `stop.flag` file before each major action
- [x] **4.4.4** If stop flag exists: save state, generate partial report, exit gracefully

### 4.5 Basic Finding Detection

- [x] **4.5.1** During exploration, detect obvious issues:
  - [x] **4.5.1.1** Page returns error (4xx, 5xx status)
  - [x] **4.5.1.2** Page shows error message in content (regex for common error patterns)
  - [x] **4.5.1.3** Link leads to 404
  - [ ] **4.5.1.4** Button click causes visible error
- [x] **4.5.2** For each detected issue:
  - [x] **4.5.2.1** Take screenshot
  - [x] **4.5.2.2** Record URL, element, action, error
  - [x] **4.5.2.3** Save to `.complete-agent/audits/current/findings/finding-{n}.json`
- [x] **4.5.3** Increment findings count in progress

---

## Phase 2: Code Analysis

### 2.1 Framework Detection

- [x] **2.1.1** Check for `package.json` — if exists, it's a Node.js project
- [x] **2.1.2** Parse `package.json` dependencies to detect framework:
  - `next` → Next.js
  - `react-router` or `react-router-dom` → React with React Router
  - `express` → Express.js backend
  - `@angular/core` → Angular
  - `vue` → Vue.js
  - `svelte` or `@sveltejs/kit` → Svelte/SvelteKit
- [ ] **2.1.3** Check for other project types:
  - `requirements.txt` or `pyproject.toml` → Python (Django, Flask, FastAPI)
  - `Gemfile` → Ruby (Rails)
- [x] **2.1.4** Store detected framework(s) in audit state
- [x] **2.1.5** Log: "Detected framework: {framework}"

### 2.2 Route Discovery

- [x] **2.2.1** Based on detected framework, run appropriate route extraction:

**For Next.js (App Router):**
- [x] **2.2.2a** Glob for `app/**/page.{tsx,jsx,ts,js}`
- [x] **2.2.3a** Parse file paths to routes (e.g., `app/dashboard/settings/page.tsx` → `/dashboard/settings`)
- [x] **2.2.4a** Handle dynamic segments: `[id]` → `:id`, `[...slug]` → `*`
- [x] **2.2.5a** Handle route groups: `(group)` segments are not part of URL

**For Next.js (Pages Router):**
- [ ] **2.2.2b** Glob for `pages/**/*.{tsx,jsx,ts,js}` excluding `_app`, `_document`
- [ ] **2.2.3b** Parse file paths to routes

**For Express:**
- [ ] **2.2.2c** Search for `app.get`, `app.post`, `router.get`, `router.post` patterns
- [ ] **2.2.3c** Extract route paths and HTTP methods

**For other frameworks:**
- [ ] **2.2.2d** Use generic heuristics or skip with warning

- [x] **2.2.6** Save route inventory to `.complete-agent/audits/current/coverage.json`
- [x] **2.2.7** Log: "Found X routes from code analysis"

### 2.3 Route Comparison

- [x] **2.3.1** Compare discovered routes (from code) with visited pages (from browser)
- [x] **2.3.2** Identify routes in code but not visited — these need exploration
- [x] **2.3.3** Identify visited pages not in code — may be dynamic or external
- [ ] **2.3.4** Add unvisited routes to exploration queue (if browser mode available)
- [x] **2.3.5** Log comparison summary

### 2.4 Component Analysis (Basic)

- [ ] **2.4.1** Search for form elements in code:
  - React: `<form`, `onSubmit`, `handleSubmit`
  - HTML: `<form action=`
- [ ] **2.4.2** Extract form identifiers and associated routes where possible
- [ ] **2.4.3** Search for common UI patterns:
  - Modals: `Modal`, `Dialog`, `isOpen`
  - Authentication: `login`, `logout`, `signIn`, `signOut`
  - CRUD: `create`, `update`, `delete`, `edit`
- [ ] **2.4.4** Cross-reference with PRD features
- [ ] **2.4.5** Save component inventory to coverage.json

### 2.5 Coverage Summary

- [x] **2.5.1** Generate coverage summary:
  ```
  Routes: X found in code, Y visited in browser
  Forms: X found in code (submission testing in Phase 6)
  Features from PRD: X total, Y have matching code
  ```
- [x] **2.5.2** Save to `.complete-agent/audits/current/coverage-summary.md`
- [x] **2.5.3** Display summary to user

---

## Checkpoints & Exit Criteria

### After Phase 0:
- [x] All preflight checks pass or user explicitly continues
- [x] Have: browser_mode, github_info, app_url, prd_path (or nulls with warnings)

### After Phase 1:
- [x] Skill is invocable via `/complete-audit`
- [x] Project state directory exists with config
- [ ] PRD is parsed and summarized (skipped for live test)

### After Phase 4:
- [x] Have visited at least the home page
- [x] Have page inventory for visited pages
- [x] Have screenshots saved
- [x] Have any obvious findings recorded
- [x] Progress tracking works

### After Phase 2:
- [x] Framework detected
- [x] Routes extracted from code
- [x] Routes compared with visited pages
- [x] Coverage summary generated

---

## Definition of Done (MVP)

The MVP is complete when:
1. ✅ `/complete-audit` can be invoked and runs preflight checks
2. ✅ Browser exploration visits multiple pages and captures screenshots
3. ✅ Code analysis extracts routes and compares with visited pages
4. ✅ Progress file updates during audit
5. ✅ User can stop audit via stop flag
6. ✅ Basic findings (404s, errors) are detected and recorded
7. ✅ Coverage summary is generated at end

**MVP Status: COMPLETE** (2026-02-03)

### Test Results (socials.paulrbrown.org):
- Pages visited: 8 of 17 (47% coverage)
- Framework detected: Next.js 14+ (App Router)
- Routes from code: 17 pages, 14 API routes
- Forms found: 3
- Findings: 0 (app functioning correctly)
- Screenshots captured: 7 (1 failed due to Chrome extension issue)

---

## Codex Review Feedback (Incorporated)

**Review Date:** February 3, 2026

### Changes Made:
- ✅ Added write access check as first preflight step (0.1.0)
- ✅ Reordered: only prompt for URL if browser mode available
- ✅ Added config schema definition in task 1.1.5
- ✅ Fixed coverage summary to remove "forms submitted" (not in MVP scope)
- ✅ Updated sequencing: Phase 2 before Phase 4 to seed exploration

### Riskiest Assumptions to Validate First:
1. Browser MCP tools are callable (smoke test navigation + screenshot)
2. Can write to `.complete-agent/` in project root
3. Skill scaffolding path/naming works for Claude Code
