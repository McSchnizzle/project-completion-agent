/**
 * PRD Parsing Phase tests.
 *
 * Tests the pure-TypeScript PRD parser against both synthetic markdown
 * and the real calendar project PRD.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parsePrd, loadPrdSummary, discoverPrdFiles } from '../../src/phases/prd-parsing';

const TEST_DIR = '/tmp/test-prd-parsing-' + Date.now();
const AUDIT_DIR = path.join(TEST_DIR, '.complete-agent', 'audits', 'current');
const CALENDAR_PRD = '/Users/paulbrown/Desktop/coding-projects/calendar/apps/frontend/docs/prd.md';

describe('PRD Parsing Phase', () => {
  beforeEach(() => {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('parsePrd', () => {
    it('should return empty summary when no PRD path is provided', () => {
      const result = parsePrd(null, AUDIT_DIR);

      expect(result.schema_version).toBe('1.0');
      expect(result.prd_file).toBeNull();
      expect(result.features).toHaveLength(0);
      expect(result.flows).toHaveLength(0);
      expect(result.notes).toBeDefined();
      expect(result.summary.total_features).toBe(0);
    });

    it('should return empty summary when PRD file does not exist', () => {
      const result = parsePrd('/nonexistent/prd.md', AUDIT_DIR);

      expect(result.features).toHaveLength(0);
      expect(result.prd_file).toBe('/nonexistent/prd.md');
      expect(result.notes).toContain('No PRD');
    });

    it('should parse a simple PRD with features', () => {
      const prdPath = path.join(TEST_DIR, 'prd.md');
      fs.writeFileSync(prdPath, `# My App PRD

## User Authentication
* Users can sign up with email
* Users can log in with OAuth
* Session persists across refreshes

## Dashboard
* Shows daily activity
* Displays user avatar
* Loads within 2 seconds
`);

      const result = parsePrd(prdPath, AUDIT_DIR);

      expect(result.schema_version).toBe('1.0');
      expect(result.prd_file).toBe(prdPath);
      expect(result.features.length).toBeGreaterThanOrEqual(2);

      const authFeature = result.features.find(f => f.name.includes('Authentication'));
      expect(authFeature).toBeDefined();
      expect(authFeature!.id).toBe('F1');
      expect(authFeature!.status).toBe('not_tested');
      expect(authFeature!.acceptance_criteria.length).toBeGreaterThan(0);

      const dashboard = result.features.find(f => f.name.includes('Dashboard'));
      expect(dashboard).toBeDefined();
    });

    it('should assign sequential feature IDs', () => {
      const prdPath = path.join(TEST_DIR, 'prd.md');
      fs.writeFileSync(prdPath, `# PRD

## Feature A
* Bullet one
* Bullet two

## Feature B
* Bullet three

## Feature C
* Bullet four
`);

      const result = parsePrd(prdPath, AUDIT_DIR);

      const ids = result.features.map(f => f.id);
      expect(ids).toContain('F1');
      expect(ids).toContain('F2');
      expect(ids).toContain('F3');
    });

    it('should infer priority from keywords', () => {
      const prdPath = path.join(TEST_DIR, 'prd.md');
      fs.writeFileSync(prdPath, `# PRD

## Critical Auth
* Users must be able to log in
* This is required for the system

## Nice Theme Toggle
* Users could toggle dark mode
* This is optional and nice to have
`);

      const result = parsePrd(prdPath, AUDIT_DIR);

      const criticalFeature = result.features.find(f => f.name.includes('Critical Auth'));
      expect(criticalFeature?.priority).toBe('must');

      const optionalFeature = result.features.find(f => f.name.includes('Nice Theme'));
      expect(optionalFeature?.priority).toBe('could');
    });

    it('should extract flows from step-by-step sections', () => {
      const prdPath = path.join(TEST_DIR, 'prd.md');
      fs.writeFileSync(prdPath, `# PRD

## Login Feature
* Enter credentials
* Click submit

## Login Flow
1. Navigate to /login
2. Enter email and password
3. Click "Sign In" button
4. Redirected to dashboard
`);

      const result = parsePrd(prdPath, AUDIT_DIR);

      expect(result.flows.length).toBeGreaterThanOrEqual(1);
      const loginFlow = result.flows.find(f => f.name.includes('Login'));
      expect(loginFlow).toBeDefined();
      expect(loginFlow!.id).toBe('FL1');
      expect(loginFlow!.steps.length).toBe(4);
      expect(loginFlow!.status).toBe('not_tested');
    });

    it('should extract out-of-scope items', () => {
      const prdPath = path.join(TEST_DIR, 'prd.md');
      fs.writeFileSync(prdPath, `# PRD

## Features
* Core feature one
* Core feature two

## Out of Scope
* Mobile native apps
* Payment processing
* Multi-language support
`);

      const result = parsePrd(prdPath, AUDIT_DIR);

      expect(result.out_of_scope.length).toBe(3);
      expect(result.out_of_scope).toContain('Mobile native apps');
    });

    it('should extract deferred items', () => {
      const prdPath = path.join(TEST_DIR, 'prd.md');
      fs.writeFileSync(prdPath, `# PRD

## Features
* Core feature

## Future Work
* Two-factor authentication
* Social media integration
`);

      const result = parsePrd(prdPath, AUDIT_DIR);

      expect(result.deferred.length).toBe(2);
      expect(result.deferred.some(d => d.includes('Two-factor'))).toBe(true);
    });

    it('should produce correct summary counts', () => {
      const prdPath = path.join(TEST_DIR, 'prd.md');
      fs.writeFileSync(prdPath, `# PRD

## Auth Feature
* Users must log in
* This is required

## Dashboard
* Shows activity
* Should display stats

## Theme Toggle
* Could toggle theme
* Optional nice to have
`);

      const result = parsePrd(prdPath, AUDIT_DIR);

      expect(result.summary.total_features).toBe(result.features.length);
      expect(result.summary.must_have + result.summary.should_have + result.summary.could_have)
        .toBe(result.summary.total_features);
    });

    it('should write prd-summary.json to audit directory', () => {
      const prdPath = path.join(TEST_DIR, 'prd.md');
      fs.writeFileSync(prdPath, `# PRD\n\n## Feature\n* Item one\n* Item two\n`);

      parsePrd(prdPath, AUDIT_DIR);

      const summaryPath = path.join(AUDIT_DIR, 'prd-summary.json');
      expect(fs.existsSync(summaryPath)).toBe(true);

      const loaded = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
      expect(loaded.schema_version).toBe('1.0');
    });

    it('should exclude technical/meta sections from features', () => {
      const prdPath = path.join(TEST_DIR, 'prd.md');
      fs.writeFileSync(prdPath, `# PRD

## Overview
A description of the project background.

## User Authentication
* Users can log in
* Users can sign up

## Technical Details
* Uses React with Next.js
* PostgreSQL database

## Hosting & Deployment
* Deployed on Vercel
* SSL enabled
`);

      const result = parsePrd(prdPath, AUDIT_DIR);

      const featureNames = result.features.map(f => f.name);
      expect(featureNames).toContain('User Authentication');
      expect(featureNames).not.toContain('Overview');
      expect(featureNames).not.toContain('Technical Details');
      expect(featureNames).not.toContain('Hosting & Deployment');
    });
  });

  describe('parsePrd with real calendar PRD', () => {
    it('should parse the calendar dashboard PRD', () => {
      if (!fs.existsSync(CALENDAR_PRD)) {
        return; // Skip if calendar project not available
      }

      const result = parsePrd(CALENDAR_PRD, AUDIT_DIR);

      expect(result.schema_version).toBe('1.0');
      expect(result.prd_file).toBe(CALENDAR_PRD);

      // Should extract core features
      expect(result.features.length).toBeGreaterThanOrEqual(3);

      // Check that key features were extracted
      const featureNames = result.features.map(f => f.name.toLowerCase());
      const hasAgenda = featureNames.some(n =>
        n.includes('agenda') || n.includes('daily') || n.includes('homepage')
      );
      const hasBirthdays = featureNames.some(n => n.includes('birthday'));
      const hasHappyHours = featureNames.some(n => n.includes('happy hour'));

      // At least some of the core features should be found
      expect(hasAgenda || hasBirthdays || hasHappyHours).toBe(true);

      // Should have flows from Implementation Roadmap
      expect(result.flows.length).toBeGreaterThanOrEqual(1);

      // Summary should be valid
      expect(result.summary.total_features).toBe(result.features.length);
      expect(result.summary.total_flows).toBe(result.flows.length);

      // All features should have IDs matching F1, F2, F3...
      for (const feature of result.features) {
        expect(feature.id).toMatch(/^F\d+$/);
        expect(feature.status).toBe('not_tested');
      }
    });
  });

  describe('loadPrdSummary', () => {
    it('should load a previously written summary', () => {
      const prdPath = path.join(TEST_DIR, 'prd.md');
      fs.writeFileSync(prdPath, `# PRD\n\n## Feature\n* Item one\n`);

      parsePrd(prdPath, AUDIT_DIR);
      const loaded = loadPrdSummary(AUDIT_DIR);

      expect(loaded).not.toBeNull();
      expect(loaded!.schema_version).toBe('1.0');
    });

    it('should return null for missing file', () => {
      const loaded = loadPrdSummary('/nonexistent/audit/dir');
      expect(loaded).toBeNull();
    });
  });

  describe('discoverPrdFiles', () => {
    it('should find PRD.md at project root', () => {
      fs.writeFileSync(path.join(TEST_DIR, 'PRD.md'), '# PRD');
      const result = discoverPrdFiles(TEST_DIR);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toContain('PRD.md');
    });

    it('should find PRD files in docs directory', () => {
      const docsDir = path.join(TEST_DIR, 'docs');
      fs.mkdirSync(docsDir, { recursive: true });
      fs.writeFileSync(path.join(docsDir, 'prd.md'), '# PRD');
      const result = discoverPrdFiles(TEST_DIR);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should find files matching *prd* pattern in docs/', () => {
      const docsDir = path.join(TEST_DIR, 'docs');
      fs.mkdirSync(docsDir, { recursive: true });
      fs.writeFileSync(path.join(docsDir, 'my-project-prd.md'), '# PRD');
      const result = discoverPrdFiles(TEST_DIR);
      expect(result.some(f => f.includes('my-project-prd.md'))).toBe(true);
    });

    it('should return empty array when no PRD found', () => {
      const result = discoverPrdFiles(TEST_DIR);
      expect(result).toHaveLength(0);
    });
  });
});
