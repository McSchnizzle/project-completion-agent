/**
 * Tests for SPA Handler module.
 *
 * Tests the SPA detection and wait strategy logic without
 * requiring a real browser. Uses mock page objects.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  waitForSPASettle,
  detectSPA,
  getSPANavigations,
  installSPAInterceptors,
} from '../../src/browser/spa-handler';

/**
 * Create a mock Playwright page object.
 */
function createMockPage(overrides: Record<string, any> = {}) {
  return {
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined),
    addInitScript: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('SPA Handler', () => {
  describe('waitForSPASettle', () => {
    it('should call waitForLoadState for networkidle strategy', async () => {
      const page = createMockPage();
      await waitForSPASettle(page, { strategy: 'networkidle', timeout: 5000 });
      expect(page.waitForLoadState).toHaveBeenCalledWith('networkidle', {
        timeout: 5000,
      });
    });

    it('should call evaluate for domstable strategy', async () => {
      const page = createMockPage();
      await waitForSPASettle(page, {
        strategy: 'domstable',
        timeout: 5000,
        domSettleMs: 300,
      });
      expect(page.evaluate).toHaveBeenCalled();
    });

    it('should call waitForSelector for selector strategy', async () => {
      const page = createMockPage();
      await waitForSPASettle(page, {
        strategy: 'selector',
        timeout: 5000,
        selector: '#app-loaded',
      });
      expect(page.waitForSelector).toHaveBeenCalledWith('#app-loaded', {
        timeout: 5000,
        state: 'visible',
      });
    });

    it('should use hybrid strategy by default', async () => {
      const page = createMockPage();
      await waitForSPASettle(page);
      // Hybrid calls evaluate (domstable) then waitForLoadState (networkidle)
      expect(page.evaluate).toHaveBeenCalled();
      expect(page.waitForLoadState).toHaveBeenCalled();
    });

    it('should not throw on networkidle timeout', async () => {
      const page = createMockPage({
        waitForLoadState: vi.fn().mockRejectedValue(new Error('Timeout')),
      });
      // Should not throw
      await expect(
        waitForSPASettle(page, { strategy: 'networkidle', timeout: 100 }),
      ).resolves.toBeUndefined();
    });

    it('should not throw on selector not found', async () => {
      const page = createMockPage({
        waitForSelector: vi.fn().mockRejectedValue(new Error('Timeout')),
      });
      await expect(
        waitForSPASettle(page, {
          strategy: 'selector',
          selector: '#missing',
          timeout: 100,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('installSPAInterceptors', () => {
    it('should call addInitScript on the page', async () => {
      const page = createMockPage();
      await installSPAInterceptors(page);
      expect(page.addInitScript).toHaveBeenCalledTimes(1);
      expect(typeof page.addInitScript.mock.calls[0][0]).toBe('function');
    });
  });

  describe('detectSPA', () => {
    it('should return true when React root detected', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue(true),
      });
      const result = await detectSPA(page);
      expect(result).toBe(true);
    });

    it('should return false when no SPA detected', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue(false),
      });
      const result = await detectSPA(page);
      expect(result).toBe(false);
    });

    it('should return false on evaluation error', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockRejectedValue(new Error('Page closed')),
      });
      const result = await detectSPA(page);
      expect(result).toBe(false);
    });
  });

  describe('getSPANavigations', () => {
    it('should return navigation events from page', async () => {
      const navEvents = [
        { url: '/dashboard', method: 'pushState', timestamp: 1000 },
        { url: '/settings', method: 'pushState', timestamp: 2000 },
      ];
      const page = createMockPage({
        evaluate: vi.fn().mockResolvedValue(navEvents),
      });
      const result = await getSPANavigations(page);
      expect(result).toEqual(navEvents);
    });

    it('should return empty array on error', async () => {
      const page = createMockPage({
        evaluate: vi.fn().mockRejectedValue(new Error('Error')),
      });
      const result = await getSPANavigations(page);
      expect(result).toEqual([]);
    });
  });
});
