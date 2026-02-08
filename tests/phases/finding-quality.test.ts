/**
 * Finding Quality phase tests
 */

import { describe, it, expect } from 'vitest';
import {
  critiqueFinding,
  deduplicateFindings,
  enforceEvidence,
  filterByQuality,
  groupFindingsByCategory,
  sortFindings,
  Finding
} from '../../skill/phases/finding-quality';

function createFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'finding-001',
    title: 'Test Finding',
    description: 'A detailed description of the test finding that explains the issue.',
    severity: 'P2',
    category: 'code-quality',
    source: 'code-scan',
    url: 'https://example.com/page',
    file_path: null,
    line_number: null,
    evidence: [],
    reproduction_steps: ['Step 1', 'Step 2', 'Step 3'],
    created_at: new Date().toISOString(),
    confidence: 0.8,
    verification_status: 'unverified',
    ...overrides
  };
}

describe('Finding Quality Phase', () => {
  describe('critiqueFinding', () => {
    it('should pass high quality findings', () => {
      const finding = createFinding({
        evidence: [{
          type: 'screenshot',
          description: 'Screenshot of issue',
          data: 'data:image/png;base64,...',
          timestamp: new Date().toISOString()
        }]
      });

      const result = critiqueFinding(finding);
      expect(result.should_include).toBe(true);
      expect(result.quality_score).toBeGreaterThan(50);
    });

    it('should flag findings without evidence', () => {
      const finding = createFinding({ evidence: [] });

      const result = critiqueFinding(finding);
      expect(result.issues.some(i => i.type === 'missing-evidence')).toBe(true);
      expect(result.quality_score).toBeLessThan(80);
    });

    it('should flag findings without reproduction steps', () => {
      const finding = createFinding({ reproduction_steps: [] });

      const result = critiqueFinding(finding);
      expect(result.issues.some(i => i.type === 'missing-steps')).toBe(true);
    });

    it('should flag low confidence findings', () => {
      const finding = createFinding({ confidence: 0.3 });

      const result = critiqueFinding(finding);
      expect(result.issues.some(i => i.type === 'low-confidence')).toBe(true);
    });

    it('should flag vague descriptions', () => {
      const finding = createFinding({ description: 'Bug here' });

      const result = critiqueFinding(finding);
      expect(result.issues.some(i => i.type === 'vague-description')).toBe(true);
    });
  });

  describe('deduplicateFindings', () => {
    it('should remove duplicate findings', () => {
      const findings = [
        createFinding({ id: 'f1', title: 'Same issue', description: 'Same description' }),
        createFinding({ id: 'f2', title: 'Same issue', description: 'Same description' }),
        createFinding({ id: 'f3', title: 'Different issue', description: 'Different description' })
      ];

      const deduplicated = deduplicateFindings(findings);
      expect(deduplicated.length).toBeLessThan(findings.length);
    });

    it('should keep unique findings', () => {
      const findings = [
        createFinding({ id: 'f1', title: 'Issue 1', category: 'security' }),
        createFinding({ id: 'f2', title: 'Issue 2', category: 'quality' }),
        createFinding({ id: 'f3', title: 'Issue 3', category: 'ui' })
      ];

      const deduplicated = deduplicateFindings(findings);
      expect(deduplicated.length).toBe(3);
    });
  });

  describe('enforceEvidence', () => {
    it('should require screenshots for UI findings', () => {
      const finding = createFinding({
        category: 'ui-issue',
        evidence: []
      });

      const result = enforceEvidence(finding);
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('screenshot');
    });

    it('should pass when evidence is present', () => {
      const finding = createFinding({
        category: 'ui-issue',
        evidence: [{
          type: 'screenshot',
          description: 'Screenshot',
          data: 'base64...',
          timestamp: new Date().toISOString()
        }]
      });

      const result = enforceEvidence(finding);
      expect(result.missing).not.toContain('screenshot');
    });

    it('should require reproduction steps', () => {
      const finding = createFinding({ reproduction_steps: [] });

      const result = enforceEvidence(finding);
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('reproduction_steps');
    });
  });

  describe('filterByQuality', () => {
    it('should filter out low quality findings', () => {
      const findings = [
        createFinding({
          id: 'high',
          evidence: [{
            type: 'screenshot',
            description: 'test',
            data: 'data',
            timestamp: new Date().toISOString()
          }]
        }),
        createFinding({
          id: 'low',
          evidence: [],
          reproduction_steps: [],
          confidence: 0.2
        })
      ];

      const filtered = filterByQuality(findings, 50);
      expect(filtered.some(f => f.id === 'high')).toBe(true);
    });
  });

  describe('groupFindingsByCategory', () => {
    it('should group findings by category', () => {
      const findings = [
        createFinding({ id: 'f1', category: 'security' }),
        createFinding({ id: 'f2', category: 'security' }),
        createFinding({ id: 'f3', category: 'quality' })
      ];

      const grouped = groupFindingsByCategory(findings);
      expect(grouped.get('security')?.length).toBe(2);
      expect(grouped.get('quality')?.length).toBe(1);
    });
  });

  describe('sortFindings', () => {
    it('should sort by severity first', () => {
      const findings = [
        createFinding({ id: 'f1', severity: 'P3' }),
        createFinding({ id: 'f2', severity: 'P0' }),
        createFinding({ id: 'f3', severity: 'P1' })
      ];

      const sorted = sortFindings(findings);
      expect(sorted[0].severity).toBe('P0');
      expect(sorted[1].severity).toBe('P1');
      expect(sorted[2].severity).toBe('P3');
    });

    it('should sort by confidence within same severity', () => {
      const findings = [
        createFinding({ id: 'f1', severity: 'P1', confidence: 0.5 }),
        createFinding({ id: 'f2', severity: 'P1', confidence: 0.9 }),
        createFinding({ id: 'f3', severity: 'P1', confidence: 0.7 })
      ];

      const sorted = sortFindings(findings);
      expect(sorted[0].confidence).toBe(0.9);
      expect(sorted[1].confidence).toBe(0.7);
      expect(sorted[2].confidence).toBe(0.5);
    });
  });
});
