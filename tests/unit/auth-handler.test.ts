/**
 * Tests for Auth Handler module.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  authenticate,
  resolveAuthConfig,
  type AuthConfig,
} from '../../src/browser/auth-handler';

/**
 * Create a mock Playwright BrowserContext.
 */
function createMockContext(overrides: Record<string, any> = {}) {
  return {
    addCookies: vi.fn().mockResolvedValue(undefined),
    setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(createMockPage()),
    ...overrides,
  };
}

function createMockPage(overrides: Record<string, any> = {}) {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    $: vi.fn().mockResolvedValue({
      fill: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      press: vi.fn().mockResolvedValue(undefined),
    }),
    waitForNavigation: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('Auth Handler', () => {
  describe('authenticate', () => {
    it('should handle "none" strategy', async () => {
      const context = createMockContext();
      const result = await authenticate(context, { strategy: 'none' });
      expect(result.success).toBe(true);
      expect(result.strategy).toBe('none');
    });

    describe('cookie strategy', () => {
      it('should set cookies on context', async () => {
        const context = createMockContext();
        const result = await authenticate(context, {
          strategy: 'cookie',
          cookies: [
            { name: 'session', value: 'abc123', domain: 'example.com' },
          ],
        });

        expect(result.success).toBe(true);
        expect(result.cookiesSet).toBe(1);
        expect(context.addCookies).toHaveBeenCalledWith([
          {
            name: 'session',
            value: 'abc123',
            domain: 'example.com',
            path: '/',
            secure: false,
            httpOnly: false,
            sameSite: 'Lax',
          },
        ]);
      });

      it('should fail when no cookies provided', async () => {
        const context = createMockContext();
        const result = await authenticate(context, {
          strategy: 'cookie',
          cookies: [],
        });
        expect(result.success).toBe(false);
      });

      it('should handle addCookies error', async () => {
        const context = createMockContext({
          addCookies: vi.fn().mockRejectedValue(new Error('Invalid cookie')),
        });
        const result = await authenticate(context, {
          strategy: 'cookie',
          cookies: [
            { name: 'session', value: 'val', domain: 'example.com' },
          ],
        });
        expect(result.success).toBe(false);
        expect(result.message).toContain('Invalid cookie');
      });
    });

    describe('bearer strategy', () => {
      it('should set Authorization header', async () => {
        const context = createMockContext();
        const result = await authenticate(context, {
          strategy: 'bearer',
          token: 'my-token-123',
        });

        expect(result.success).toBe(true);
        expect(context.setExtraHTTPHeaders).toHaveBeenCalledWith({
          Authorization: 'Bearer my-token-123',
        });
      });

      it('should fail when no token provided', async () => {
        const context = createMockContext();
        const result = await authenticate(context, { strategy: 'bearer' });
        expect(result.success).toBe(false);
      });
    });

    describe('form-login strategy', () => {
      it('should navigate to login page and fill credentials', async () => {
        const mockField = {
          fill: vi.fn().mockResolvedValue(undefined),
          click: vi.fn().mockResolvedValue(undefined),
          press: vi.fn().mockResolvedValue(undefined),
        };
        const mockPage = createMockPage({
          $: vi.fn().mockResolvedValue(mockField),
        });
        const context = createMockContext({
          newPage: vi.fn().mockResolvedValue(mockPage),
        });

        const result = await authenticate(context, {
          strategy: 'form-login',
          loginUrl: 'https://example.com/login',
          credentials: { username: 'user', password: 'pass' },
        });

        expect(result.success).toBe(true);
        expect(mockPage.goto).toHaveBeenCalledWith(
          'https://example.com/login',
          expect.any(Object),
        );
      });

      it('should fail when loginUrl missing', async () => {
        const context = createMockContext();
        const result = await authenticate(context, {
          strategy: 'form-login',
          credentials: { username: 'user', password: 'pass' },
        });
        expect(result.success).toBe(false);
      });

      it('should fail when credentials missing', async () => {
        const context = createMockContext();
        const result = await authenticate(context, {
          strategy: 'form-login',
          loginUrl: 'https://example.com/login',
        });
        expect(result.success).toBe(false);
      });

      it('should fail when username field not found', async () => {
        const mockPage = createMockPage({
          $: vi.fn().mockResolvedValue(null),
        });
        const context = createMockContext({
          newPage: vi.fn().mockResolvedValue(mockPage),
        });

        const result = await authenticate(context, {
          strategy: 'form-login',
          loginUrl: 'https://example.com/login',
          credentials: { username: 'user', password: 'pass' },
        });
        expect(result.success).toBe(false);
        expect(result.message).toContain('username field');
      });
    });

    it('should handle unknown strategy', async () => {
      const context = createMockContext();
      const result = await authenticate(context, {
        strategy: 'unknown' as any,
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown auth strategy');
    });
  });

  describe('resolveAuthConfig', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    it('should resolve env vars in cookie values', () => {
      process.env.SESSION_TOKEN = 'resolved-value';

      const config: AuthConfig = {
        strategy: 'cookie',
        cookies: [
          {
            name: 'session',
            value: '${SESSION_TOKEN}',
            domain: 'example.com',
          },
        ],
      };

      const resolved = resolveAuthConfig(config);
      expect(resolved.cookies![0].value).toBe('resolved-value');
    });

    it('should resolve env vars in bearer token', () => {
      process.env.AUTH_TOKEN = 'my-bearer-token';

      const config: AuthConfig = {
        strategy: 'bearer',
        token: '${AUTH_TOKEN}',
      };

      const resolved = resolveAuthConfig(config);
      expect(resolved.token).toBe('my-bearer-token');
    });

    it('should resolve env vars in credentials', () => {
      process.env.LOGIN_USER = 'admin';
      process.env.LOGIN_PASS = 'secret';

      const config: AuthConfig = {
        strategy: 'form-login',
        loginUrl: 'https://example.com/login',
        credentials: {
          username: '${LOGIN_USER}',
          password: '${LOGIN_PASS}',
        },
      };

      const resolved = resolveAuthConfig(config);
      expect(resolved.credentials!.username).toBe('admin');
      expect(resolved.credentials!.password).toBe('secret');
    });

    it('should use empty string for undefined env vars', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const config: AuthConfig = {
        strategy: 'bearer',
        token: '${NONEXISTENT_VAR}',
      };

      const resolved = resolveAuthConfig(config);
      expect(resolved.token).toBe('');

      warnSpy.mockRestore();
    });
  });
});
