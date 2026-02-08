# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-05

### Added

#### Infrastructure
- `package.json` with TypeScript compilation and Vitest testing
- `tsconfig.json` configured for CommonJS module output
- `vitest.config.ts` with 80% coverage thresholds
- Schema validation system using AJV (`skill/utils/schema-validator.ts`)

#### Phase Modules
- **Preflight** (`skill/phases/preflight.ts`) - Environment validation, config loading, PRD discovery
- **Code Analysis** (`skill/phases/code-analysis.ts`) - Route extraction, form discovery, feature mapping
- **Exploration** (`skill/phases/exploration.ts`) - Browser-based page discovery, URL queue management
- **Safety** (`skill/phases/safety.ts`) - Production data protection, destructive action detection
- **Form Testing** (`skill/phases/form-testing.ts`) - Form merging, test plan generation
- **Finding Quality** (`skill/phases/finding-quality.ts`) - Finding critique, deduplication, evidence enforcement
- **Reporting** (`skill/phases/reporting.ts`) - Review decisions, GitHub issue creation
- **Verification** (`skill/phases/verification.ts`) - Issue verification, regression testing
- **Polish** (`skill/phases/polish.ts`) - Command parsing, cleanup, checkpoint validation

#### Utility Enhancements
- Progress markdown generation (`generateProgressMarkdown`)
- Dashboard HTML generation (`generateDashboardHtml`)
- Stop/continue flag file detection
- PRD summary JSON generation with feature IDs
- Feature status tracking

#### Testing
- 142 unit tests covering utils, phases, and integration
- Test files for checkpoint, URL canonicalizer, signature, progress writer, schema validator
- Phase tests for safety, finding quality, polish, verification
- Integration tests for schema validation

### Fixed
- TypeScript compilation errors in index.ts (export conflicts)
- Type mismatches in orchestrator.ts (dynamic imports)
- Spread argument error in code-quality.ts
- Unreachable code in form-tester.ts

### Changed
- Module resolution from NodeNext to CommonJS for compatibility
- Explicit exports in index.ts instead of wildcard exports
- Renamed exports to avoid conflicts (e.g., `QueuedUrl as CoverageQueuedUrl`)

## [0.1.0] - Initial Development

### Added
- Initial skill structure with utility modules
- Analyzers for code quality, security, and architecture
- Browser testing modules (coverage explorer, form tester, responsive testing)
- Verification and aggregation modules
- Reporting and comparison modules
- JSON schemas for audit outputs
- SKILL_INSTRUCTIONS.md with comprehensive audit pipeline

---

## Migration Notes

### From 0.x to 1.0.0

1. Run `npm install` to get dependencies
2. Run `npm run build` to compile TypeScript
3. Run `npm test` to verify installation

The skill now requires:
- Node.js 18+
- TypeScript 5.3+
- `ajv` for schema validation
- `yaml` for config parsing

### Breaking Changes
- Export names changed to avoid conflicts - update any direct imports
- Phase modules now in `skill/phases/` directory
- Progress writer has new exports for dashboard generation
