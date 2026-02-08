/**
 * Tests for prompt-loader.ts
 *
 * Tests template loading, variable interpolation, and file discovery.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  loadPrompt,
  interpolateVariables,
  listPromptFiles,
} from '../../src/llm/prompt-loader';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-loader-test-'));
});

afterEach(() => {
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('prompt-loader', () => {
  describe('interpolateVariables', () => {
    it('should replace simple string variables', () => {
      const result = interpolateVariables(
        'Analyze {{url}} against {{prdFile}}',
        { url: 'http://localhost:3000', prdFile: 'docs/prd.md' },
      );
      expect(result).toBe('Analyze http://localhost:3000 against docs/prd.md');
    });

    it('should JSON-stringify object variables', () => {
      const result = interpolateVariables(
        'Features: {{features}}',
        { features: [{ name: 'Auth' }, { name: 'Dashboard' }] },
      );
      expect(result).toContain('"name": "Auth"');
      expect(result).toContain('"name": "Dashboard"');
    });

    it('should replace null/undefined with empty string', () => {
      const result = interpolateVariables(
        'Value: {{missing}}',
        { missing: null },
      );
      expect(result).toBe('Value: ');
    });

    it('should handle undefined variables gracefully', () => {
      const result = interpolateVariables(
        'Value: {{notProvided}}',
        {},
      );
      expect(result).toBe('Value: ');
    });

    it('should handle numeric variables', () => {
      const result = interpolateVariables(
        'Count: {{count}}',
        { count: 42 },
      );
      expect(result).toBe('Count: 42');
    });

    it('should handle boolean variables', () => {
      const result = interpolateVariables(
        'Enabled: {{enabled}}',
        { enabled: true },
      );
      expect(result).toBe('Enabled: true');
    });

    it('should replace multiple occurrences of same variable', () => {
      const result = interpolateVariables(
        '{{name}} says {{name}} is great',
        { name: 'Alice' },
      );
      expect(result).toBe('Alice says Alice is great');
    });

    it('should leave non-matching patterns unchanged', () => {
      const result = interpolateVariables(
        'Keep {{ spaced }} and {single}',
        {},
      );
      // {{spaced}} won't match because of spaces in the pattern
      expect(result).toBe('Keep {{ spaced }} and {single}');
    });
  });

  describe('loadPrompt', () => {
    it('should load a prompt file from absolute path', () => {
      const promptPath = path.join(tempDir, 'test.md');
      fs.writeFileSync(promptPath, '# Test Prompt\n\nAnalyze the code.');

      const result = loadPrompt(promptPath);
      expect(result).toContain('# Test Prompt');
      expect(result).toContain('Analyze the code.');
    });

    it('should interpolate variables when loading', () => {
      const promptPath = path.join(tempDir, 'test.md');
      fs.writeFileSync(promptPath, 'Analyze {{url}} for issues.');

      const result = loadPrompt(promptPath, {
        variables: { url: 'http://example.com' },
      });
      expect(result).toBe('Analyze http://example.com for issues.');
    });

    it('should resolve relative paths against promptDir', () => {
      const subDir = path.join(tempDir, 'prompts');
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(subDir, 'phase-1.md'), 'Phase 1 prompt');

      const result = loadPrompt('phase-1.md', { promptDir: subDir });
      expect(result).toBe('Phase 1 prompt');
    });

    it('should throw if file does not exist', () => {
      expect(() => loadPrompt('/nonexistent/prompt.md')).toThrow(
        'Prompt file not found',
      );
    });

    it('should load without variables (no interpolation)', () => {
      const promptPath = path.join(tempDir, 'raw.md');
      fs.writeFileSync(promptPath, 'Raw template with {{placeholder}}');

      const result = loadPrompt(promptPath);
      expect(result).toBe('Raw template with {{placeholder}}');
    });

    it('should handle real prompt files from project', () => {
      const projectPrompts = path.resolve(
        __dirname,
        '../../prompts',
      );
      if (!fs.existsSync(projectPrompts)) return;

      const files = fs.readdirSync(projectPrompts).filter(f => f.endsWith('.md'));
      if (files.length === 0) return;

      // Should be able to load any prompt file
      const firstPrompt = path.join(projectPrompts, files[0]);
      const content = loadPrompt(firstPrompt);
      expect(content.length).toBeGreaterThan(0);
    });
  });

  describe('listPromptFiles', () => {
    it('should list .md files in a directory', () => {
      fs.writeFileSync(path.join(tempDir, 'phase-1.md'), 'p1');
      fs.writeFileSync(path.join(tempDir, 'phase-2.md'), 'p2');
      fs.writeFileSync(path.join(tempDir, 'not-a-prompt.txt'), 'txt');

      const files = listPromptFiles(tempDir);
      expect(files).toHaveLength(2);
      expect(files[0]).toContain('phase-1.md');
      expect(files[1]).toContain('phase-2.md');
    });

    it('should return empty array for nonexistent directory', () => {
      const files = listPromptFiles('/nonexistent/dir');
      expect(files).toHaveLength(0);
    });

    it('should return sorted results', () => {
      fs.writeFileSync(path.join(tempDir, 'z-last.md'), '');
      fs.writeFileSync(path.join(tempDir, 'a-first.md'), '');
      fs.writeFileSync(path.join(tempDir, 'm-middle.md'), '');

      const files = listPromptFiles(tempDir);
      expect(files).toHaveLength(3);
      expect(path.basename(files[0])).toBe('a-first.md');
      expect(path.basename(files[1])).toBe('m-middle.md');
      expect(path.basename(files[2])).toBe('z-last.md');
    });
  });
});
