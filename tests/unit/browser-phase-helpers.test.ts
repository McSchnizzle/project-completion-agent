/**
 * Browser Phase Helpers Unit Tests
 * Tests verification data collection: URL filtering, error handling, return structure
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { collectVerificationData } from '../../src/browser-phase-helpers.js';
import type { DispatchContext } from '../../src/phase-dispatcher.js';

// Mock PlaywrightBrowser
function createMockBrowser(pageResults: Record<string, any> = {}) {
  return {
    visitPage: vi.fn(async (url: string) => {
      if (pageResults[url]?.error) {
        throw new Error(pageResults[url].error);
      }
      return pageResults[url] || {
        url,
        title: `Page at ${url}`,
        html: '<html></html>',
        text: `Content of ${url}`,
        links: [],
        forms: [],
        consoleMessages: [],
        networkErrors: [],
        statusCode: 200,
        loadTimeMs: 100,
      };
    }),
  } as any;
}

function createContext(auditDir: string): DispatchContext {
  return {
    auditDir,
    url: 'https://example.com',
    codebasePath: '/tmp/test-codebase',
    config: {},
  };
}

describe('collectVerificationData', () => {
  let tmpDir: string;
  let findingDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
    findingDir = path.join(tmpDir, 'findings');
    fs.mkdirSync(findingDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFinding(id: string, data: Record<string, any>) {
    fs.writeFileSync(
      path.join(findingDir, `${id}.json`),
      JSON.stringify({ id, ...data }),
    );
  }

  it('should include findings with valid URLs in verifiable list', async () => {
    writeFinding('F-001', {
      url: 'https://example.com/page1',
      title: 'Test finding',
      priority: 'P2',
    });

    const browser = createMockBrowser();
    const result = await collectVerificationData(createContext(tmpDir), browser);

    expect(result.verifiableFindings).toHaveLength(1);
    expect((result.verifiableFindings as any[])[0].id).toBe('F-001');
    expect(result.unverifiableFindings).toHaveLength(0);
    expect(browser.visitPage).toHaveBeenCalledWith('https://example.com/page1');
  });

  it('should move findings with url="N/A" to unverifiable list', async () => {
    writeFinding('F-002', {
      url: 'N/A',
      title: 'Finding with N/A URL',
      priority: 'P1',
    });

    const browser = createMockBrowser();
    const result = await collectVerificationData(createContext(tmpDir), browser);

    expect(result.verifiableFindings).toHaveLength(0);
    expect(result.unverifiableFindings).toHaveLength(1);
    const unverifiable = (result.unverifiableFindings as any[])[0];
    expect(unverifiable.id).toBe('F-002');
    expect(unverifiable.verificationStatus).toBe('unverifiable');
    expect(unverifiable.verificationNote).toContain('N/A');
    expect(browser.visitPage).not.toHaveBeenCalled();
  });

  it('should move findings with url="undefined" to unverifiable list', async () => {
    writeFinding('F-003', {
      url: 'undefined',
      title: 'Finding with undefined URL',
      priority: 'P2',
    });

    const browser = createMockBrowser();
    const result = await collectVerificationData(createContext(tmpDir), browser);

    expect(result.verifiableFindings).toHaveLength(0);
    expect(result.unverifiableFindings).toHaveLength(1);
    const unverifiable = (result.unverifiableFindings as any[])[0];
    expect(unverifiable.verificationStatus).toBe('unverifiable');
    expect(unverifiable.verificationNote).toContain('undefined');
    expect(browser.visitPage).not.toHaveBeenCalled();
  });

  it('should move findings with empty url to unverifiable list', async () => {
    writeFinding('F-004', {
      url: '',
      title: 'Finding with empty URL',
    });

    const browser = createMockBrowser();
    const result = await collectVerificationData(createContext(tmpDir), browser);

    expect(result.verifiableFindings).toHaveLength(0);
    expect(result.unverifiableFindings).toHaveLength(1);
    expect(browser.visitPage).not.toHaveBeenCalled();
  });

  it('should move findings with missing url to unverifiable list', async () => {
    writeFinding('F-005', {
      title: 'Finding with no URL at all',
      priority: 'P3',
    });

    const browser = createMockBrowser();
    const result = await collectVerificationData(createContext(tmpDir), browser);

    expect(result.verifiableFindings).toHaveLength(0);
    expect(result.unverifiableFindings).toHaveLength(1);
    const unverifiable = (result.unverifiableFindings as any[])[0];
    expect(unverifiable.verificationNote).toContain('missing');
    expect(browser.visitPage).not.toHaveBeenCalled();
  });

  it('should catch page visit errors and mark finding unverifiable', async () => {
    writeFinding('F-006', {
      url: 'https://example.com/broken',
      title: 'Finding on broken page',
    });

    const browser = createMockBrowser({
      'https://example.com/broken': { error: 'net::ERR_CONNECTION_REFUSED' },
    });

    const result = await collectVerificationData(createContext(tmpDir), browser);

    // Failed finding moves to unverifiable
    expect(result.unverifiableFindings).toHaveLength(1);
    const unverifiable = (result.unverifiableFindings as any[])[0];
    expect(unverifiable.id).toBe('F-006');
    expect(unverifiable.verificationStatus).toBe('unverifiable');
    expect(unverifiable.verificationNote).toContain('net::ERR_CONNECTION_REFUSED');
  });

  it('should return all three lists in the result structure', async () => {
    writeFinding('F-010', {
      url: 'https://example.com/good',
      title: 'Good finding',
    });
    writeFinding('F-011', {
      url: 'N/A',
      title: 'Bad finding',
    });

    const browser = createMockBrowser();
    const result = await collectVerificationData(createContext(tmpDir), browser);

    // Check the return structure has all expected keys
    expect(result).toHaveProperty('verifiableFindings');
    expect(result).toHaveProperty('unverifiableFindings');
    expect(result).toHaveProperty('verificationData');
    expect(result).toHaveProperty('existingFindings');

    expect(result.verifiableFindings).toHaveLength(1);
    expect(result.unverifiableFindings).toHaveLength(1);
    expect(result.verificationData).toHaveLength(1);
    // existingFindings should contain ALL findings (both good and bad)
    expect(result.existingFindings).toHaveLength(2);
  });

  it('should collect page data for verifiable findings', async () => {
    writeFinding('F-020', {
      url: 'https://example.com/verify-me',
      title: 'Finding to verify',
    });

    const browser = createMockBrowser({
      'https://example.com/verify-me': {
        url: 'https://example.com/verify-me',
        title: 'Verify Page',
        html: '<html><body>Content</body></html>',
        text: 'Content for verification',
        links: [],
        forms: [],
        consoleMessages: [{ type: 'error', text: 'JS error', timestamp: 1 }],
        networkErrors: [{ url: '/api/broken', status: 500, statusText: 'Internal', method: 'GET' }],
        statusCode: 200,
        loadTimeMs: 150,
      },
    });

    const result = await collectVerificationData(createContext(tmpDir), browser);
    const vData = (result.verificationData as any[])[0];

    expect(vData.findingId).toBe('F-020');
    expect(vData.url).toBe('https://example.com/verify-me');
    expect(vData.pageData.title).toBe('Verify Page');
    expect(vData.pageData.statusCode).toBe(200);
    expect(vData.pageData.consoleErrors).toHaveLength(1);
    expect(vData.pageData.networkErrors).toHaveLength(1);
  });

  it('should handle findings with url in evidence.url', async () => {
    writeFinding('F-030', {
      evidence: { url: 'https://example.com/from-evidence' },
      title: 'Finding with evidence URL',
    });

    const browser = createMockBrowser();
    const result = await collectVerificationData(createContext(tmpDir), browser);

    expect(result.verifiableFindings).toHaveLength(1);
    expect(browser.visitPage).toHaveBeenCalledWith('https://example.com/from-evidence');
  });

  it('should handle findings with url in location.url', async () => {
    writeFinding('F-031', {
      location: { url: 'https://example.com/from-location' },
      title: 'Finding with location URL',
    });

    const browser = createMockBrowser();
    const result = await collectVerificationData(createContext(tmpDir), browser);

    expect(result.verifiableFindings).toHaveLength(1);
    expect(browser.visitPage).toHaveBeenCalledWith('https://example.com/from-location');
  });

  it('should return empty lists when finding dir does not exist', async () => {
    const emptyDir = path.join(tmpDir, 'nonexistent-audit');
    const browser = createMockBrowser();

    const result = await collectVerificationData(
      createContext(emptyDir),
      browser,
    );

    expect(result.verifiableFindings).toHaveLength(0);
    expect(result.unverifiableFindings).toHaveLength(0);
    expect(result.verificationData).toHaveLength(0);
    expect(result.existingFindings).toHaveLength(0);
    expect(browser.visitPage).not.toHaveBeenCalled();
  });

  it('should handle mixed valid and invalid URLs', async () => {
    writeFinding('F-040', { url: 'https://example.com/ok', title: 'Good' });
    writeFinding('F-041', { url: 'N/A', title: 'Bad N/A' });
    writeFinding('F-042', { url: 'https://example.com/also-ok', title: 'Also good' });
    writeFinding('F-043', { url: '', title: 'Bad empty' });
    writeFinding('F-044', { title: 'No URL' });

    const browser = createMockBrowser();
    const result = await collectVerificationData(createContext(tmpDir), browser);

    expect(result.verifiableFindings).toHaveLength(2);
    expect(result.unverifiableFindings).toHaveLength(3);
    expect(result.verificationData).toHaveLength(2);
    expect(result.existingFindings).toHaveLength(5);
    expect(browser.visitPage).toHaveBeenCalledTimes(2);
  });

  it('should reject non-http URLs like relative paths', async () => {
    writeFinding('F-050', { url: '/relative/path', title: 'Relative URL' });
    writeFinding('F-051', { url: 'ftp://files.example.com', title: 'FTP URL' });

    const browser = createMockBrowser();
    const result = await collectVerificationData(createContext(tmpDir), browser);

    expect(result.verifiableFindings).toHaveLength(0);
    expect(result.unverifiableFindings).toHaveLength(2);
    expect(browser.visitPage).not.toHaveBeenCalled();
  });
});
