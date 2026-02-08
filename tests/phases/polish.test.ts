/**
 * Polish phase tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseCommandFlags,
  mapFocusToPatterns,
  urlMatchesFocus,
  cleanupOldAudits,
  formatBytes,
  findLatestAudit,
  getAuditAge
} from '../../skill/phases/polish';
import { PrdFeature } from '../../skill/comparison/prd-parser';

const TEST_DIR = '/tmp/test-polish-' + Date.now();

describe('Polish Phase', () => {
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

  describe('parseCommandFlags', () => {
    it('should parse --resume flag', () => {
      const flags = parseCommandFlags('--resume');
      expect(flags.resume).toBe(true);
    });

    it('should parse -r shorthand', () => {
      const flags = parseCommandFlags('-r');
      expect(flags.resume).toBe(true);
    });

    it('should parse --cleanup flag', () => {
      const flags = parseCommandFlags('--cleanup');
      expect(flags.cleanup).toBe(true);
    });

    it('should parse --focus with quoted value', () => {
      const flags = parseCommandFlags('--focus "auth, payments"');
      expect(flags.focus).toContain('auth');
      expect(flags.focus).toContain('payments');
    });

    it('should parse --max-pages', () => {
      const flags = parseCommandFlags('--max-pages 100');
      expect(flags.max_pages).toBe(100);
    });

    it('should parse --timeout', () => {
      const flags = parseCommandFlags('--timeout 60');
      expect(flags.timeout_minutes).toBe(60);
    });

    it('should parse --unsafe flag', () => {
      const flags = parseCommandFlags('--unsafe');
      expect(flags.safe_mode).toBe(false);
    });

    it('should parse --verbose flag', () => {
      const flags = parseCommandFlags('--verbose');
      expect(flags.verbose).toBe(true);
    });

    it('should parse --dry-run flag', () => {
      const flags = parseCommandFlags('--dry-run');
      expect(flags.dry_run).toBe(true);
    });

    it('should handle multiple flags', () => {
      const flags = parseCommandFlags('--resume --focus "auth" --max-pages 50 --verbose');
      expect(flags.resume).toBe(true);
      expect(flags.focus).toContain('auth');
      expect(flags.max_pages).toBe(50);
      expect(flags.verbose).toBe(true);
    });

    it('should have defaults for unparsed flags', () => {
      const flags = parseCommandFlags('');
      expect(flags.resume).toBe(false);
      expect(flags.safe_mode).toBe(true);
      expect(flags.max_pages).toBe(50);
    });
  });

  describe('mapFocusToPatterns', () => {
    const prdFeatures: PrdFeature[] = [
      {
        id: 'user-auth',
        name: 'User Authentication',
        description: 'Login and signup functionality',
        requirements: [],
        acceptance_criteria: [],
        priority: 'must-have',
        status: 'not-checked',
        evidence: []
      }
    ];

    it('should map direct URL patterns', () => {
      const patterns = mapFocusToPatterns(['/api/users'], []);
      expect(patterns.some(p => p.type === 'url' && p.pattern === '/api/users')).toBe(true);
    });

    it('should map PRD feature names', () => {
      const patterns = mapFocusToPatterns(['auth'], prdFeatures);
      expect(patterns.some(p => p.type === 'feature')).toBe(true);
    });

    it('should map categories', () => {
      const patterns = mapFocusToPatterns(['login'], []);
      expect(patterns.some(p => p.type === 'category' || p.type === 'url')).toBe(true);
    });
  });

  describe('urlMatchesFocus', () => {
    it('should match when no focus (all URLs match)', () => {
      expect(urlMatchesFocus('https://example.com/any', [])).toBe(true);
    });

    it('should match URL patterns', () => {
      const patterns = [{ type: 'url' as const, pattern: '/auth', source: 'test' }];
      expect(urlMatchesFocus('https://example.com/auth/login', patterns)).toBe(true);
    });

    it('should not match non-matching URLs', () => {
      const patterns = [{ type: 'url' as const, pattern: '/auth', source: 'test' }];
      expect(urlMatchesFocus('https://example.com/api/users', patterns)).toBe(false);
    });
  });

  describe('cleanupOldAudits', () => {
    it('should delete old audit directories', () => {
      // Create old audit directory
      const oldDir = path.join(TEST_DIR, 'old-audit');
      fs.mkdirSync(oldDir);
      fs.writeFileSync(path.join(oldDir, 'file.txt'), 'test');

      // Set modification time to 60 days ago
      const oldTime = Date.now() - (60 * 24 * 60 * 60 * 1000);
      fs.utimesSync(oldDir, oldTime / 1000, oldTime / 1000);

      const result = cleanupOldAudits(TEST_DIR, 30);
      expect(result.deleted).toContain('old-audit');
      expect(fs.existsSync(oldDir)).toBe(false);
    });

    it('should keep recent audit directories', () => {
      const recentDir = path.join(TEST_DIR, 'recent-audit');
      fs.mkdirSync(recentDir);

      const result = cleanupOldAudits(TEST_DIR, 30);
      expect(result.kept).toContain('recent-audit');
      expect(fs.existsSync(recentDir)).toBe(true);
    });

    it('should respect dry run mode', () => {
      const oldDir = path.join(TEST_DIR, 'old-audit-dry');
      fs.mkdirSync(oldDir);

      const oldTime = Date.now() - (60 * 24 * 60 * 60 * 1000);
      fs.utimesSync(oldDir, oldTime / 1000, oldTime / 1000);

      const result = cleanupOldAudits(TEST_DIR, 30, true);
      expect(result.deleted[0]).toContain('[dry-run]');
      expect(fs.existsSync(oldDir)).toBe(true);
    });
  });

  describe('formatBytes', () => {
    it('should format bytes', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(500)).toBe('500 B');
    });

    it('should format kilobytes', () => {
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(2048)).toBe('2 KB');
    });

    it('should format megabytes', () => {
      expect(formatBytes(1024 * 1024)).toBe('1 MB');
    });

    it('should format gigabytes', () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
    });
  });

  describe('findLatestAudit', () => {
    it('should return null for non-existent directory', () => {
      expect(findLatestAudit('/nonexistent')).toBeNull();
    });

    it('should return null for empty directory', () => {
      expect(findLatestAudit(TEST_DIR)).toBeNull();
    });

    it('should return latest audit directory', () => {
      // Create audit directories
      fs.mkdirSync(path.join(TEST_DIR, 'audit-1'));
      fs.mkdirSync(path.join(TEST_DIR, 'audit-2'));

      // Make audit-2 newer
      const now = Date.now();
      fs.utimesSync(path.join(TEST_DIR, 'audit-1'), (now - 1000) / 1000, (now - 1000) / 1000);
      fs.utimesSync(path.join(TEST_DIR, 'audit-2'), now / 1000, now / 1000);

      const latest = findLatestAudit(TEST_DIR);
      expect(latest).toContain('audit-2');
    });
  });

  describe('getAuditAge', () => {
    it('should return "just now" for recent audits', () => {
      fs.mkdirSync(path.join(TEST_DIR, 'recent'));
      const age = getAuditAge(path.join(TEST_DIR, 'recent'));
      expect(age).toBe('just now');
    });

    it('should return age in hours for older audits', () => {
      const oldDir = path.join(TEST_DIR, 'hours-old');
      fs.mkdirSync(oldDir);

      const hoursAgo = Date.now() - (2 * 60 * 60 * 1000);
      fs.utimesSync(oldDir, hoursAgo / 1000, hoursAgo / 1000);

      const age = getAuditAge(oldDir);
      expect(age).toContain('hour');
    });
  });
});
