/**
 * Tests for Playwright Browser wrapper.
 *
 * These tests verify the public API without requiring a real Playwright install.
 * We test the non-browser-dependent functionality and error paths.
 */

import { describe, it, expect, vi } from 'vitest';
import { PlaywrightBrowser, DEFAULT_VIEWPORTS } from '../../src/playwright-browser';

describe('PlaywrightBrowser', () => {
  describe('constructor', () => {
    it('should create instance with default config', () => {
      const browser = new PlaywrightBrowser();
      expect(browser.isAvailable()).toBe(false);
    });

    it('should accept custom config', () => {
      const browser = new PlaywrightBrowser({
        headless: false,
        timeout: 60_000,
        screenshots: false,
      });
      expect(browser.isAvailable()).toBe(false);
    });

    it('should accept SPA options', () => {
      const browser = new PlaywrightBrowser({
        spaOptions: { strategy: 'domstable', domSettleMs: 1000 },
      });
      expect(browser.isAvailable()).toBe(false);
    });

    it('should accept auth config', () => {
      const browser = new PlaywrightBrowser({
        authConfig: {
          strategy: 'cookie',
          cookies: [{ name: 'session', value: 'abc', domain: 'localhost' }],
        },
      });
      expect(browser.isAvailable()).toBe(false);
    });
  });

  describe('launch', () => {
    it('should launch successfully when playwright is installed', async () => {
      const browser = new PlaywrightBrowser();
      const result = await browser.launch();

      // Playwright IS installed in this project
      expect(result).toBe(true);
      expect(browser.isAvailable()).toBe(true);

      await browser.close();
      expect(browser.isAvailable()).toBe(false);
    });
  });

  describe('visitPage', () => {
    it('should throw if browser not launched', async () => {
      const browser = new PlaywrightBrowser();
      await expect(browser.visitPage('http://localhost:3000')).rejects.toThrow(
        'Browser not launched',
      );
    });
  });

  describe('fillForm', () => {
    it('should throw if browser not launched', async () => {
      const browser = new PlaywrightBrowser();
      await expect(
        browser.fillForm('http://localhost:3000', 0, { name: 'test' }),
      ).rejects.toThrow('Browser not launched');
    });
  });

  describe('newPage', () => {
    it('should throw if browser not launched', async () => {
      const browser = new PlaywrightBrowser();
      await expect(browser.newPage()).rejects.toThrow('Browser not launched');
    });
  });

  describe('close', () => {
    it('should handle close when not launched', async () => {
      const browser = new PlaywrightBrowser();
      // Should not throw
      await browser.close();
      expect(browser.isAvailable()).toBe(false);
    });
  });

  describe('getContext', () => {
    it('should return null when not launched', () => {
      const browser = new PlaywrightBrowser();
      expect(browser.getContext()).toBeNull();
    });
  });

  describe('DEFAULT_VIEWPORTS', () => {
    it('should have 4 viewport specs', () => {
      expect(DEFAULT_VIEWPORTS).toHaveLength(4);
    });

    it('should include mobile viewport', () => {
      const mobile = DEFAULT_VIEWPORTS.find((v) => v.name === 'mobile');
      expect(mobile).toBeDefined();
      expect(mobile!.width).toBe(375);
      expect(mobile!.height).toBe(667);
    });

    it('should include tablet viewport', () => {
      const tablet = DEFAULT_VIEWPORTS.find((v) => v.name === 'tablet');
      expect(tablet).toBeDefined();
      expect(tablet!.width).toBe(768);
    });

    it('should include desktop viewport', () => {
      const desktop = DEFAULT_VIEWPORTS.find((v) => v.name === 'desktop');
      expect(desktop).toBeDefined();
      expect(desktop!.width).toBe(1280);
    });

    it('should include wide viewport', () => {
      const wide = DEFAULT_VIEWPORTS.find((v) => v.name === 'wide');
      expect(wide).toBeDefined();
      expect(wide!.width).toBe(1920);
    });
  });
});
