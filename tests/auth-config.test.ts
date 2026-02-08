/**
 * Tests for the auth config parser module.
 */

import { describe, it, expect } from 'vitest';
import { parseAuthConfig } from '../src/auth-config';

describe('auth-config', () => {
  describe('parseAuthConfig', () => {
    it('returns strategy: none when no auth section', () => {
      expect(parseAuthConfig({}).strategy).toBe('none');
      expect(parseAuthConfig({ url: 'http://localhost' }).strategy).toBe('none');
    });

    it('returns strategy: none for explicit none', () => {
      expect(parseAuthConfig({ auth: { strategy: 'none' } }).strategy).toBe('none');
    });

    it('parses cookie credentials from v2 auth section', () => {
      const config = {
        auth: {
          strategy: 'cookie',
          cookies: [
            { name: 'session', value: 'abc123', domain: '.example.com' },
            { name: 'token', value: 'xyz', domain: 'example.com', path: '/app', httpOnly: true },
          ],
        },
      };

      const result = parseAuthConfig(config);
      expect(result.strategy).toBe('cookie');
      expect(result.cookies).toHaveLength(2);
      expect(result.cookies![0].name).toBe('session');
      expect(result.cookies![0].value).toBe('abc123');
      expect(result.cookies![0].domain).toBe('.example.com');
      expect(result.cookies![1].path).toBe('/app');
      expect(result.cookies![1].httpOnly).toBe(true);
    });

    it('parses cookie credentials from v1 test_credentials section', () => {
      const config = {
        test_credentials: {
          strategy: 'cookie',
          cookies: [
            { name: 'session', value: 'abc', domain: 'localhost' },
          ],
        },
      };

      const result = parseAuthConfig(config);
      expect(result.strategy).toBe('cookie');
      expect(result.cookies).toHaveLength(1);
    });

    it('prefers v2 auth section over v1 test_credentials', () => {
      const config = {
        auth: {
          strategy: 'bearer',
          token: 'v2-token',
        },
        test_credentials: {
          strategy: 'bearer',
          token: 'v1-token',
        },
      };

      const result = parseAuthConfig(config);
      expect(result.strategy).toBe('bearer');
      expect(result.token).toBe('v2-token');
    });

    it('returns none for cookie strategy with empty cookies', () => {
      const config = {
        auth: {
          strategy: 'cookie',
          cookies: [],
        },
      };
      expect(parseAuthConfig(config).strategy).toBe('none');
    });

    it('parses bearer token credentials', () => {
      const config = {
        auth: {
          strategy: 'bearer',
          token: 'eyJhbGciOiJIUzI1NiJ9.test',
        },
      };

      const result = parseAuthConfig(config);
      expect(result.strategy).toBe('bearer');
      expect(result.token).toBe('eyJhbGciOiJIUzI1NiJ9.test');
    });

    it('returns none for bearer without token', () => {
      const config = {
        auth: {
          strategy: 'bearer',
        },
      };
      expect(parseAuthConfig(config).strategy).toBe('none');
    });

    it('parses form-login credentials with defaults', () => {
      const config = {
        auth: {
          strategy: 'form-login',
          login_url: 'https://example.com/login',
          username: 'user@example.com',
          password: 'pass123',
        },
      };

      const result = parseAuthConfig(config);
      expect(result.strategy).toBe('form-login');
      expect(result.loginUrl).toBe('https://example.com/login');
      expect(result.credentials).toEqual({
        username: 'user@example.com',
        password: 'pass123',
      });
      // Defaults for selectors should be undefined (browser auth-handler provides defaults)
      expect(result.usernameSelector).toBeUndefined();
      expect(result.submitSelector).toBeUndefined();
    });

    it('parses form-login credentials with custom selectors', () => {
      const config = {
        auth: {
          strategy: 'form-login',
          login_url: 'https://example.com/login',
          username: 'user@example.com',
          password: 'pass123',
          username_selector: '#email',
          password_selector: '#pass',
          submit_selector: '#login-btn',
          success_indicator: '.dashboard',
        },
      };

      const result = parseAuthConfig(config);
      expect(result.usernameSelector).toBe('#email');
      expect(result.passwordSelector).toBe('#pass');
      expect(result.submitSelector).toBe('#login-btn');
      expect(result.successIndicator).toBe('.dashboard');
    });

    it('returns none for form-login without login_url', () => {
      const config = {
        auth: {
          strategy: 'form-login',
          username: 'user',
          password: 'pass',
        },
      };
      expect(parseAuthConfig(config).strategy).toBe('none');
    });

    it('returns none for unknown strategy', () => {
      const config = {
        auth: {
          strategy: 'kerberos',
          token: 'abc',
        },
      };
      expect(parseAuthConfig(config).strategy).toBe('none');
    });

    it('handles loginUrl camelCase format', () => {
      const config = {
        auth: {
          strategy: 'form-login',
          loginUrl: 'https://example.com/login',
          username: 'user',
          password: 'pass',
        },
      };

      const result = parseAuthConfig(config);
      expect(result.loginUrl).toBe('https://example.com/login');
    });
  });
});
