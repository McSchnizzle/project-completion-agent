# Complete Audit Skill

Use this skill when the user wants to audit a web application for completeness, find bugs, or verify that features work correctly. This skill explores running applications, compares behavior against PRD specifications, and generates actionable findings.

## Commands

- `/complete-audit` — Run a full audit of the application
- `/complete-audit --focus "auth, payments"` — Run a focused audit on specific areas
- `/complete-verify gh issue #42` — Verify a specific issue was fixed

## When to Use

- After "code complete" to find remaining issues before launch
- When the user says things like "test my app", "find bugs", "check if it's ready"
- When verifying fixes from previous audits

## Prerequisites

- Application must be running and accessible at a URL
- PRD or planning docs recommended (but optional)
- GitHub CLI (`gh`) authenticated for issue creation

## Base Directory

/Users/paulbrown/.claude/skills/complete-audit
