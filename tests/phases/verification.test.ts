/**
 * Verification phase tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseVerifyCommand,
  createIssueFile,
  recordVerificationAttempt,
  createVerificationResult,
  prepareVerification,
  shouldCloseIssue,
  getCurrentIssueStatus,
  generateVerificationSummary,
  IssueFile
} from '../../skill/phases/verification';
import { Finding } from '../../skill/phases/finding-quality';

const TEST_DIR = '/tmp/test-verification-' + Date.now();

function createTestFinding(): Finding {
  return {
    id: 'test-finding-001',
    title: 'Test Issue',
    description: 'A test issue for verification',
    severity: 'P2',
    category: 'ui',
    source: 'browser-test',
    url: 'https://example.com/page',
    file_path: null,
    line_number: null,
    evidence: [],
    reproduction_steps: ['Go to page', 'Click button', 'Observe error'],
    created_at: new Date().toISOString(),
    confidence: 0.8,
    verification_status: 'unverified'
  };
}

describe('Verification Phase', () => {
  beforeEach(() => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('parseVerifyCommand', () => {
    it('should parse gh issue #123 format', () => {
      const result = parseVerifyCommand('gh issue #123');
      expect(result?.issue_number).toBe(123);
    });

    it('should parse #123 format', () => {
      const result = parseVerifyCommand('#123');
      expect(result?.issue_number).toBe(123);
    });

    it('should parse bare number', () => {
      const result = parseVerifyCommand('42');
      expect(result?.issue_number).toBe(42);
    });

    it('should parse --regression flag', () => {
      const result = parseVerifyCommand('gh issue #123 --regression');
      expect(result?.options.regression).toBe(true);
    });

    it('should parse --max-attempts', () => {
      const result = parseVerifyCommand('#123 --max-attempts 5');
      expect(result?.options.max_attempts).toBe(5);
    });

    it('should parse --no-screenshot', () => {
      const result = parseVerifyCommand('#123 --no-screenshot');
      expect(result?.options.screenshot).toBe(false);
    });

    it('should return null for invalid input', () => {
      const result = parseVerifyCommand('invalid command');
      expect(result).toBeNull();
    });
  });

  describe('createIssueFile', () => {
    it('should create issue file from finding', () => {
      const finding = createTestFinding();
      const issueFile = createIssueFile(finding, 42, 'https://github.com/repo/issues/42');

      expect(issueFile.issue_number).toBe(42);
      expect(issueFile.finding_id).toBe(finding.id);
      expect(issueFile.title).toBe(finding.title);
      expect(issueFile.reproduction_steps).toEqual(finding.reproduction_steps);
      expect(issueFile.verification_history).toEqual([]);
    });
  });

  describe('recordVerificationAttempt', () => {
    it('should add verification attempt to history', () => {
      const finding = createTestFinding();
      const issueFile = createIssueFile(finding, 42, 'https://github.com/repo/issues/42');
      const result = createVerificationResult('fixed', 'Issue is fixed');

      const updated = recordVerificationAttempt(issueFile, result, 'abc123');

      expect(updated.verification_history.length).toBe(1);
      expect(updated.verification_history[0].result).toBe('fixed');
      expect(updated.verification_history[0].commit_sha).toBe('abc123');
    });

    it('should preserve previous history', () => {
      const finding = createTestFinding();
      let issueFile = createIssueFile(finding, 42, 'https://github.com/repo/issues/42');

      issueFile = recordVerificationAttempt(issueFile, createVerificationResult('still_broken', 'Not fixed'));
      issueFile = recordVerificationAttempt(issueFile, createVerificationResult('fixed', 'Now fixed'));

      expect(issueFile.verification_history.length).toBe(2);
    });
  });

  describe('createVerificationResult', () => {
    it('should create result with all fields', () => {
      const result = createVerificationResult('fixed', 'Issue resolved', 'screenshot-001', 3, null);

      expect(result.status).toBe('fixed');
      expect(result.notes).toBe('Issue resolved');
      expect(result.screenshot_id).toBe('screenshot-001');
      expect(result.reproduction_attempts).toBe(3);
      expect(result.last_error).toBeNull();
    });

    it('should include error when present', () => {
      const result = createVerificationResult('still_broken', 'Failed', null, 1, 'Element not found');

      expect(result.last_error).toBe('Element not found');
    });
  });

  describe('prepareVerification', () => {
    it('should return reproduction steps and URL', () => {
      const finding = createTestFinding();
      const issueFile = createIssueFile(finding, 42, 'https://github.com/repo/issues/42');

      const prep = prepareVerification(issueFile);

      expect(prep.steps).toEqual(finding.reproduction_steps);
      expect(prep.verification_url).toBe(finding.url);
    });
  });

  describe('shouldCloseIssue', () => {
    it('should return true when last verification was fixed', () => {
      const finding = createTestFinding();
      let issueFile = createIssueFile(finding, 42, 'https://github.com/repo/issues/42');
      issueFile = recordVerificationAttempt(issueFile, createVerificationResult('fixed', 'Done'));

      expect(shouldCloseIssue(issueFile)).toBe(true);
    });

    it('should return false when last verification was not fixed', () => {
      const finding = createTestFinding();
      let issueFile = createIssueFile(finding, 42, 'https://github.com/repo/issues/42');
      issueFile = recordVerificationAttempt(issueFile, createVerificationResult('still_broken', 'Still broken'));

      expect(shouldCloseIssue(issueFile)).toBe(false);
    });

    it('should return false when no verification history', () => {
      const finding = createTestFinding();
      const issueFile = createIssueFile(finding, 42, 'https://github.com/repo/issues/42');

      expect(shouldCloseIssue(issueFile)).toBe(false);
    });
  });

  describe('getCurrentIssueStatus', () => {
    it('should return unknown for no history', () => {
      const finding = createTestFinding();
      const issueFile = createIssueFile(finding, 42, 'https://github.com/repo/issues/42');

      const status = getCurrentIssueStatus(issueFile);
      expect(status.status).toBe('unknown');
      expect(status.confidence).toBe(0);
    });

    it('should return fixed with high confidence after multiple fixed verifications', () => {
      const finding = createTestFinding();
      let issueFile = createIssueFile(finding, 42, 'https://github.com/repo/issues/42');
      issueFile = recordVerificationAttempt(issueFile, createVerificationResult('fixed', 'Fixed'));
      issueFile = recordVerificationAttempt(issueFile, createVerificationResult('fixed', 'Still fixed'));

      const status = getCurrentIssueStatus(issueFile);
      expect(status.status).toBe('fixed');
      expect(status.confidence).toBeGreaterThan(0.8);
    });

    it('should return flaky for mixed results', () => {
      const finding = createTestFinding();
      let issueFile = createIssueFile(finding, 42, 'https://github.com/repo/issues/42');
      // For flaky detection, the last attempt must NOT be 'fixed' with fixedCount >= 2
      // So we need the last attempt to be broken while having some fixed results
      issueFile = recordVerificationAttempt(issueFile, createVerificationResult('fixed', 'Fixed'));
      issueFile = recordVerificationAttempt(issueFile, createVerificationResult('still_broken', 'Broken'));

      const status = getCurrentIssueStatus(issueFile);
      expect(status.status).toBe('flaky');
    });
  });

  describe('generateVerificationSummary', () => {
    it('should generate markdown summary', () => {
      const finding = createTestFinding();
      let issueFile = createIssueFile(finding, 42, 'https://github.com/repo/issues/42');
      issueFile = recordVerificationAttempt(issueFile, createVerificationResult('fixed', 'Issue fixed'));

      const summary = generateVerificationSummary(issueFile);

      expect(summary).toContain('# Verification Summary');
      expect(summary).toContain('#42');
      expect(summary).toContain('fixed');
    });
  });
});
