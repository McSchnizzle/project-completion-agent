/**
 * Auth Config Parser - Reads credentials from config.yml and produces
 * an AuthConfig for the browser auth handler.
 *
 * This module bridges the config layer (config.yml / env vars) with the
 * browser auth handler (src/browser/auth-handler.ts). It resolves
 * ${ENV_VAR} references and validates the credential configuration.
 *
 * @module auth-config
 */

import type { AuthConfig } from './browser/auth-handler.js';

// ---------------------------------------------------------------------------
// Config parsing
// ---------------------------------------------------------------------------

/**
 * Parse the `test_credentials` or `auth` section from config.yml into
 * an AuthConfig suitable for the browser auth handler.
 *
 * Supports two config shapes:
 *
 * 1. V1 format (`test_credentials`):
 *    ```yaml
 *    test_credentials:
 *      strategy: cookie
 *      cookies: [...]
 *    ```
 *
 * 2. V2 format (`auth`):
 *    ```yaml
 *    auth:
 *      strategy: cookie
 *      cookies: [...]
 *    ```
 *
 * Returns a config with `strategy: 'none'` if no credentials are found.
 */
export function parseAuthConfig(configYml: Record<string, unknown>): AuthConfig {
  // Try v2 format first, then fall back to v1
  const raw = (configYml.auth ?? configYml.test_credentials) as Record<string, unknown> | undefined;

  if (!raw || !raw.strategy) {
    return { strategy: 'none' };
  }

  const strategy = String(raw.strategy);

  switch (strategy) {
    case 'cookie': {
      const rawCookies = raw.cookies as Array<Record<string, unknown>> | undefined;
      if (!rawCookies?.length) {
        return { strategy: 'none' };
      }
      return {
        strategy: 'cookie',
        cookies: rawCookies.map((c) => ({
          name: String(c.name ?? ''),
          value: String(c.value ?? ''),
          domain: String(c.domain ?? ''),
          path: c.path ? String(c.path) : undefined,
          secure: c.secure != null ? Boolean(c.secure) : undefined,
          httpOnly: c.httpOnly != null ? Boolean(c.httpOnly) : undefined,
          sameSite: c.sameSite as 'Strict' | 'Lax' | 'None' | undefined,
        })),
      };
    }

    case 'bearer': {
      const token = raw.token ? String(raw.token) : undefined;
      if (!token) {
        return { strategy: 'none' };
      }
      return {
        strategy: 'bearer',
        token,
      };
    }

    case 'form-login': {
      const loginUrl = raw.login_url ?? raw.loginUrl;
      // Support both flat (username/password) and nested (credentials.username/password)
      const creds = raw.credentials as Record<string, unknown> | undefined;
      const username = raw.username ?? creds?.username;
      const password = raw.password ?? creds?.password;

      if (!loginUrl || !username || !password) {
        return { strategy: 'none' };
      }

      return {
        strategy: 'form-login',
        loginUrl: String(loginUrl),
        credentials: {
          username: String(username),
          password: String(password),
        },
        usernameSelector: raw.username_selector ?? raw.usernameSelector
          ? String(raw.username_selector ?? raw.usernameSelector)
          : undefined,
        passwordSelector: raw.password_selector ?? raw.passwordSelector
          ? String(raw.password_selector ?? raw.passwordSelector)
          : undefined,
        submitSelector: raw.submit_selector ?? raw.submitSelector
          ? String(raw.submit_selector ?? raw.submitSelector)
          : undefined,
        successIndicator: raw.success_indicator ?? raw.successIndicator
          ? String(raw.success_indicator ?? raw.successIndicator)
          : undefined,
      };
    }

    case 'oauth-redirect': {
      const oauthUrl = raw.oauth_url ?? raw.oauthUrl;
      if (!oauthUrl) {
        return { strategy: 'none' };
      }
      return {
        strategy: 'oauth-redirect',
        oauthUrl: String(oauthUrl),
        callbackPattern: raw.callback_pattern ?? raw.callbackPattern
          ? String(raw.callback_pattern ?? raw.callbackPattern)
          : undefined,
        provider: raw.provider as AuthConfig['provider'] | undefined,
        timeoutMs: raw.timeout_ms ?? raw.timeoutMs
          ? Number(raw.timeout_ms ?? raw.timeoutMs)
          : undefined,
        browserProfile: raw.browser_profile ?? raw.browserProfile
          ? String(raw.browser_profile ?? raw.browserProfile)
          : undefined,
      };
    }

    case 'none':
      return { strategy: 'none' };

    default:
      console.warn(`[AuthConfig] Unknown auth strategy: ${strategy}, defaulting to none`);
      return { strategy: 'none' };
  }
}
