# Complete Audit Skill

Use this skill when the user wants to audit a web application for completeness, find bugs, or verify that features work correctly. This skill explores running applications, compares behavior against PRD specifications, and generates actionable findings.

## Commands

### Audit Commands
- `/complete-audit` — Run a full audit of the application
- `/complete-audit --focus "auth, payments"` — Run a focused audit on specific areas
- `/complete-audit --resume` — Resume an interrupted audit from checkpoint
- `/complete-audit --cleanup` — Delete old audit data (>30 days)

### Verification Commands
- `/complete-verify gh issue #42` — Verify a specific issue was fixed

## When to Use

- After "code complete" to find remaining issues before launch
- When the user says things like "test my app", "find bugs", "check if it's ready"
- When verifying fixes from previous audits
- When resuming an interrupted audit

## Prerequisites

- Application must be running and accessible at a URL
- PRD or planning docs recommended (but optional)
- GitHub CLI (`gh`) authenticated for issue creation
- Claude for Chrome extension for browser automation

## Dashboard

Monitor audit progress in real-time:

```bash
npx serve .complete-agent
# Open http://localhost:3000/dashboard/
```

## Controls

Stop a running audit:
```bash
touch .complete-agent/audits/current/stop.flag
```

Resume a paused audit:
```bash
touch .complete-agent/audits/current/continue.flag
```

## Output

Audit results are saved to `.complete-agent/audits/{timestamp}/`:
- `progress.md` / `progress.json` — Live progress
- `report.md` — Final audit report
- `findings/` — Individual finding files
- `created-issues.json` — GitHub issues created

## Base Directory

/Users/paulbrown/.claude/skills/complete-audit
