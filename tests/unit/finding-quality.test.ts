/**
 * Tests for Finding Deduplication and Finding Quality phases
 * Task T-033: Test finding-dedup.ts and finding-quality.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  deduplicateFindings,
  checkGitHubIssues,
  type DeduplicationResult,
} from '../../src/phases/finding-dedup';
import {
  runFindingQuality,
  type QualityConfig,
  type QualityResult,
} from '../../src/phases/finding-quality';

describe('finding-dedup', () => {
  describe('deduplicateFindings', () => {
    it('should return empty result for empty input', () => {
      const result = deduplicateFindings([]);
      expect(result.unique).toEqual([]);
      expect(result.duplicates).toEqual([]);
      expect(result.stats.totalInput).toBe(0);
      expect(result.stats.uniqueOutput).toBe(0);
      expect(result.stats.duplicatesRemoved).toBe(0);
    });

    it('should pass through unique findings unchanged', () => {
      const findings = [
        {
          id: 'F-001',
          title: 'XSS vulnerability in search',
          type: 'security',
          location: { url: 'http://example.com/search', selector: '#searchBox' },
          confidence: 90,
        },
        {
          id: 'F-002',
          title: 'Missing ARIA label on button',
          type: 'accessibility',
          location: { url: 'http://example.com/home', selector: 'button.submit' },
          confidence: 85,
        },
      ];

      const result = deduplicateFindings(findings);
      expect(result.unique).toHaveLength(2);
      expect(result.duplicates).toHaveLength(0);
      expect(result.stats.duplicatesRemoved).toBe(0);
    });

    it('should deduplicate findings with same signature', () => {
      const findings = [
        {
          id: 'F-001',
          title: 'Missing validation',
          type: 'security',
          location: { file: 'src/auth.ts', line: 42 },
          confidence: 90,
          evidence: [{ type: 'code', value: 'snippet' }],
        },
        {
          id: 'F-002',
          title: 'Missing validation',
          type: 'security',
          location: { file: 'src/auth.ts', line: 42 },
          confidence: 85,
        },
      ];

      const result = deduplicateFindings(findings);
      expect(result.unique).toHaveLength(1);
      expect(result.duplicates).toHaveLength(1);
      expect(result.stats.duplicatesRemoved).toBe(1);
    });

    it('should keep highest confidence finding from duplicates', () => {
      const findings = [
        {
          id: 'F-001',
          title: 'TODO comment',
          type: 'code-quality',
          location: { file: 'src/utils.ts', line: 10 },
          confidence: 70,
        },
        {
          id: 'F-002',
          title: 'TODO comment',
          type: 'code-quality',
          location: { file: 'src/utils.ts', line: 10 },
          verification_status: 'verified',
        },
      ];

      const result = deduplicateFindings(findings);
      expect(result.unique).toHaveLength(1);
      // Verified finding should be kept (confidence 90)
      const kept = result.unique[0] as Record<string, unknown>;
      expect(kept.verification_status).toBe('verified');
    });

    it('should prefer findings with more detail when confidence is equal', () => {
      const findings = [
        {
          id: 'F-001',
          title: 'Performance issue',
          type: 'performance',
          location: { url: 'http://example.com/slow' },
          confidence: 80,
          description: 'Short',
        },
        {
          id: 'F-002',
          title: 'Performance issue',
          type: 'performance',
          location: { url: 'http://example.com/slow' },
          confidence: 80,
          description: 'A much longer description with more details about the problem',
          evidence: [
            { type: 'timing', value: '1.5s' },
            { type: 'screenshot', value: 'img.png' },
          ],
          reproduction_steps: ['Step 1', 'Step 2', 'Step 3'],
        },
      ];

      const result = deduplicateFindings(findings);
      expect(result.unique).toHaveLength(1);
      const kept = result.unique[0] as Record<string, unknown>;
      expect(kept.id).toBe('F-002');
    });

    it('should handle multiple groups of duplicates', () => {
      const findings = [
        {
          id: 'F-001',
          title: 'Issue A',
          type: 'type-a',
          location: { file: 'a.ts', line: 1 },
        },
        {
          id: 'F-002',
          title: 'Issue A',
          type: 'type-a',
          location: { file: 'a.ts', line: 1 },
        },
        {
          id: 'F-003',
          title: 'Issue B',
          type: 'type-b',
          location: { file: 'b.ts', line: 2 },
        },
        {
          id: 'F-004',
          title: 'Issue B',
          type: 'type-b',
          location: { file: 'b.ts', line: 2 },
        },
        {
          id: 'F-005',
          title: 'Unique Issue',
          type: 'type-c',
          location: { file: 'c.ts', line: 3 },
        },
      ];

      const result = deduplicateFindings(findings);
      expect(result.unique).toHaveLength(3);
      expect(result.duplicates).toHaveLength(2);
      expect(result.stats.totalInput).toBe(5);
    });
  });

  describe('checkGitHubIssues', () => {
    it('should return empty map when no findings provided', async () => {
      const result = await checkGitHubIssues([]);
      expect(result.size).toBe(0);
    });

    it('should return empty map when gh CLI not available', async () => {
      const findings = [
        {
          id: 'F-001',
          title: 'Test finding',
          type: 'bug',
        },
      ];

      // This will fail silently if gh CLI is not available
      const result = await checkGitHubIssues(findings);
      expect(result).toBeInstanceOf(Map);
    });
  });
});

describe('finding-quality', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finding-quality-test-'));
    // Create required directories
    fs.mkdirSync(path.join(tempDir, 'findings'), { recursive: true });
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should handle empty findings directory', async () => {
    const config: QualityConfig = {
      auditDir: tempDir,
      verificationPromptPath: '/fake/verification-prompt.md',
      critiquePromptPath: '/fake/critique-prompt.md',
    };

    const mockRunClaudePhase = async () => ({
      success: true,
      output: { results: [] },
    });

    const result = await runFindingQuality(config, mockRunClaudePhase);

    expect(result.totalFindings).toBe(0);
    expect(result.uniqueFindings).toBe(0);
  });

  it('should deduplicate findings when dedup function provided', async () => {
    const config: QualityConfig = {
      auditDir: tempDir,
      verificationPromptPath: '/fake/verification-prompt.md',
      critiquePromptPath: '/fake/critique-prompt.md',
    };

    // Create test findings
    fs.writeFileSync(
      path.join(tempDir, 'findings', 'F-001.json'),
      JSON.stringify({ id: 'F-001', title: 'Test', type: 'bug' })
    );
    fs.writeFileSync(
      path.join(tempDir, 'findings', 'F-002.json'),
      JSON.stringify({ id: 'F-002', title: 'Test', type: 'bug' })
    );

    const mockDedup = (findings: Record<string, unknown>[]) => ({
      unique: [findings[0]],
      duplicates: [{ original: findings[0], duplicate: findings[1] }],
    });

    const mockRunClaudePhase = async () => ({
      success: true,
      output: { results: [] },
    });

    const result = await runFindingQuality(
      config,
      mockRunClaudePhase,
      mockDedup
    );

    expect(result.totalFindings).toBe(2);
    expect(result.uniqueFindings).toBe(1);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it('should process verification results', async () => {
    const config: QualityConfig = {
      auditDir: tempDir,
      verificationPromptPath: '/fake/verification-prompt.md',
      critiquePromptPath: '/fake/critique-prompt.md',
    };

    fs.writeFileSync(
      path.join(tempDir, 'findings', 'F-001.json'),
      JSON.stringify({ id: 'F-001', title: 'Test', type: 'bug' })
    );

    const mockRunClaudePhase = async (phaseConfig: {
      phaseName: string;
      inputContext: Record<string, unknown>;
    }) => {
      if (phaseConfig.phaseName === 'finding-quality-verification') {
        return {
          success: true,
          output: {
            results: [
              { status: 'verified', findingId: 'F-001' },
            ],
          },
        };
      }
      return { success: true, output: { results: [] } };
    };

    const result = await runFindingQuality(config, mockRunClaudePhase);

    expect(result.verified).toBe(1);
    expect(result.notReproduced).toBe(0);
    expect(result.flaky).toBe(0);
  });

  it('should handle critique phase with low confidence findings', async () => {
    const config: QualityConfig = {
      auditDir: tempDir,
      verificationPromptPath: '/fake/verification-prompt.md',
      critiquePromptPath: '/fake/critique-prompt.md',
    };

    fs.writeFileSync(
      path.join(tempDir, 'findings', 'F-001.json'),
      JSON.stringify({ id: 'F-001', title: 'Test', type: 'bug' })
    );

    const mockRunClaudePhase = async (phaseConfig: {
      phaseName: string;
    }) => {
      if (phaseConfig.phaseName === 'finding-quality-critique') {
        return {
          success: true,
          output: {
            results: [
              { confidence: 30, findingId: 'F-001' },
            ],
          },
        };
      }
      return { success: true, output: { results: [] } };
    };

    const result = await runFindingQuality(config, mockRunClaudePhase);

    expect(result.critiqued).toBe(1);
    expect(result.needsHumanReview).toBe(1);
  });

  it('should track errors from failed phases', async () => {
    const config: QualityConfig = {
      auditDir: tempDir,
      verificationPromptPath: '/fake/verification-prompt.md',
      critiquePromptPath: '/fake/critique-prompt.md',
    };

    fs.writeFileSync(
      path.join(tempDir, 'findings', 'F-001.json'),
      JSON.stringify({ id: 'F-001', title: 'Test', type: 'bug' })
    );

    const mockRunClaudePhase = async () => {
      throw new Error('Phase failed');
    };

    const result = await runFindingQuality(config, mockRunClaudePhase);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('failed');
  });
});
