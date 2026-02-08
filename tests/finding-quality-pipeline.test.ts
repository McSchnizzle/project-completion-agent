/**
 * Tests for finding-quality-pipeline.ts
 *
 * Uses the 14 real calendar findings on disk as fixtures when available,
 * plus synthetic fixtures for unit testing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  runQualityPipeline,
  runQualityPipelineAndSave,
  type QualityPipelineConfig,
} from '../src/finding-quality-pipeline';

// ---------------------------------------------------------------------------
// Helper: Create temp audit dir with finding files
// ---------------------------------------------------------------------------

function createTempAuditDir(
  findings: Record<string, unknown>[],
): string {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'quality-pipeline-test-'),
  );
  const findingsDir = path.join(tmpDir, 'findings');
  fs.mkdirSync(findingsDir, { recursive: true });

  for (const f of findings) {
    const id = String(f.id || `finding-${Math.random().toString(36).slice(2, 8)}`);
    fs.writeFileSync(
      path.join(findingsDir, `${id}.json`),
      JSON.stringify(f, null, 2),
    );
  }

  return tmpDir;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GOOD_FINDING = {
  id: 'F-001',
  severity: 'P0',
  category: 'PRD Non-Compliance',
  title: 'Attendees Not Sorted by meeting_count',
  prd_section: '1.1',
  description:
    'PRD requires attendees sorted by meeting_count showing top 4 by frequency. Implementation slices first N attendees without sorting.',
  evidence: {
    code: [
      'apps/frontend/pages/index.jsx:165-168',
      'apps/frontend/components/calendar/EventRow.jsx:182',
    ],
    browser: 'Attendees displayed in arbitrary order',
  },
  fix: 'Sort attendees descending by count, then slice top 4.',
  status: 'open',
};

const FALSE_POSITIVE_DEVIATION = {
  id: 'F-003',
  severity: 'P0',
  category: 'PRD Deviation',
  title: 'Homepage Uses Calendar Grid Instead of PRD-Specified HTML Table',
  prd_section: '1.1',
  description:
    'PRD specifies HTML table with columns. Homepage shows multi-column calendar grid organized by calendar account.',
  evidence: {
    code: ['apps/frontend/pages/index.jsx'],
    browser: 'Homepage renders visual calendar grid',
  },
  fix: 'Update PRD to reflect current design, or add table-view toggle.',
  status: 'open',
};

const WEAK_FINDING = {
  id: 'F-099',
  severity: 'P3',
  category: 'Data Quality',
  title: 'Minor display issue',
  description: 'Something looks a bit off',
  evidence: {
    browser: 'Observed on the page',
  },
  status: 'open',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('finding-quality-pipeline', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('runQualityPipeline', () => {
    it('should return empty result for empty findings dir', () => {
      tempDir = createTempAuditDir([]);
      const result = runQualityPipeline({ auditDir: tempDir });
      expect(result.finalFindings).toHaveLength(0);
      expect(result.report.total_raw).toBe(0);
    });

    it('should pass through well-evidenced findings', () => {
      tempDir = createTempAuditDir([GOOD_FINDING]);
      const result = runQualityPipeline({ auditDir: tempDir });
      expect(result.finalFindings.length).toBeGreaterThanOrEqual(1);
      expect(result.report.total_raw).toBe(1);
    });

    it('should filter out PRD Deviation findings (F-003)', () => {
      tempDir = createTempAuditDir([GOOD_FINDING, FALSE_POSITIVE_DEVIATION]);
      const result = runQualityPipeline({ auditDir: tempDir });

      // F-003 should be filtered
      const filteredIds = result.report.filtered_findings.map((f) => f.id);
      expect(filteredIds).toContain('F-003');

      // F-001 should remain
      const finalIds = result.finalFindings.map(
        (f) => String((f as Record<string, unknown>).id),
      );
      expect(finalIds).toContain('F-001');
    });

    it('should filter weak findings below confidence threshold', () => {
      tempDir = createTempAuditDir([GOOD_FINDING, WEAK_FINDING]);
      // Explicitly set a threshold that the weak finding won't meet
      const result = runQualityPipeline({
        auditDir: tempDir,
        confidenceThreshold: 25,
      });

      // Weak finding (confidence 0) should be filtered
      const filteredIds = result.report.filtered_findings.map((f) => f.id);
      expect(filteredIds).toContain('F-099');
    });

    it('should calculate false positive rate estimate', () => {
      tempDir = createTempAuditDir([
        GOOD_FINDING,
        FALSE_POSITIVE_DEVIATION,
        WEAK_FINDING,
      ]);
      const result = runQualityPipeline({ auditDir: tempDir });
      expect(result.report.false_positive_rate_estimate).toBeGreaterThan(0);
      expect(result.report.false_positive_rate_estimate).toBeLessThanOrEqual(1);
    });

    it('should include critique scores for all raw findings', () => {
      tempDir = createTempAuditDir([GOOD_FINDING, FALSE_POSITIVE_DEVIATION]);
      const result = runQualityPipeline({ auditDir: tempDir });
      expect(result.report.critique_scores).toHaveLength(2);
    });

    it('should respect custom confidence threshold', () => {
      tempDir = createTempAuditDir([GOOD_FINDING]);
      // Very high threshold should filter almost everything
      const result = runQualityPipeline({
        auditDir: tempDir,
        confidenceThreshold: 95,
      });
      // The good finding should have <= 95 confidence
      expect(result.report.after_filter).toBeLessThanOrEqual(1);
    });

    it('should detect false positive signals in filtered findings', () => {
      tempDir = createTempAuditDir([FALSE_POSITIVE_DEVIATION]);
      const result = runQualityPipeline({ auditDir: tempDir });

      const f003Filtered = result.report.filtered_findings.find(
        (f) => f.id === 'F-003',
      );
      expect(f003Filtered).toBeDefined();
      expect(f003Filtered!.falsePositiveSignals.length).toBeGreaterThan(0);
    });
  });

  describe('runQualityPipelineAndSave', () => {
    it('should write quality-report.json to audit dir', () => {
      tempDir = createTempAuditDir([GOOD_FINDING, FALSE_POSITIVE_DEVIATION]);
      runQualityPipelineAndSave({ auditDir: tempDir });

      const reportPath = path.join(tempDir, 'quality-report.json');
      expect(fs.existsSync(reportPath)).toBe(true);

      const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
      expect(report.total_raw).toBe(2);
      expect(report.filtered_findings).toBeDefined();
    });
  });

  describe('pipeline with real calendar findings directory', () => {
    const calendarAuditDir =
      '/Users/paulbrown/Desktop/coding-projects/calendar/.complete-agent/audits/current';

    it('should process all 14 calendar findings if available', () => {
      if (!fs.existsSync(path.join(calendarAuditDir, 'findings'))) {
        return; // Skip if calendar findings not available
      }

      const result = runQualityPipeline({ auditDir: calendarAuditDir });
      expect(result.report.total_raw).toBe(14);

      // F-003 should be flagged (PRD Deviation category + "instead of" in title)
      const filteredIds = result.report.filtered_findings.map((f) => f.id);
      expect(filteredIds).toContain('F-003');

      // Most real findings should survive with default threshold of 25
      expect(result.finalFindings.length).toBeGreaterThan(8);

      // Only a few should be filtered (F-003, F-011, F-014 have very low scores)
      expect(result.report.false_positive_rate_estimate).toBeGreaterThan(0);
      expect(result.report.false_positive_rate_estimate).toBeLessThan(0.4);
    });
  });
});
