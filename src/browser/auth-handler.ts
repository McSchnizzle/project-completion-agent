/**
 * Auth Handler - Authentication strategies for browser automation.
 *
 * Supports cookie injection, bearer token injection, and form-based login.
 * Called before exploration begins to establish authenticated sessions.
 *
 * @module browser/auth-handler
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthStrategy = 'none' | 'cookie' | 'bearer' | 'form-login';

export interface CookieSpec {
  name: string;
  value: string;
  domain: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface AuthConfig {
  strategy: AuthStrategy;
  /** For 'cookie' strategy */
  cookies?: CookieSpec[];
  /** For 'bearer' strategy: token value */
  token?: string;
  /** For 'form-login' strategy */
  loginUrl?: string;
  credentials?: { username: string; password: string };
  /** Selector that appears after successful login */
  successIndicator?: string;
  /** Optional: field selectors for form-login */
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
}

export interface AuthResult {
  success: boolean;
  strategy: AuthStrategy;
  message: string;
  cookiesSet?: number;
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * Apply authentication to a browser context.
 *
 * @param context - Playwright BrowserContext
 * @param config - Authentication configuration
 * @returns Result indicating success/failure
 */
export async function authenticate(
  context: any,
  config: AuthConfig,
): Promise<AuthResult> {
  switch (config.strategy) {
    case 'none':
      return { success: true, strategy: 'none', message: 'No auth required' };

    case 'cookie':
      return applyCookieAuth(context, config);

    case 'bearer':
      return applyBearerAuth(context, config);

    case 'form-login':
      return applyFormLogin(context, config);

    default:
      return {
        success: false,
        strategy: config.strategy,
        message: `Unknown auth strategy: ${config.strategy}`,
      };
  }
}

/**
 * Parse auth config from environment variables and config object.
 *
 * Resolves ${ENV_VAR} references in cookie values and tokens.
 */
export function resolveAuthConfig(config: AuthConfig): AuthConfig {
  const resolved = { ...config };

  if (resolved.cookies) {
    resolved.cookies = resolved.cookies.map((cookie) => ({
      ...cookie,
      value: resolveEnvRef(cookie.value),
    }));
  }

  if (resolved.token) {
    resolved.token = resolveEnvRef(resolved.token);
  }

  if (resolved.credentials) {
    resolved.credentials = {
      username: resolveEnvRef(resolved.credentials.username),
      password: resolveEnvRef(resolved.credentials.password),
    };
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Strategy implementations
// ---------------------------------------------------------------------------

async function applyCookieAuth(
  context: any,
  config: AuthConfig,
): Promise<AuthResult> {
  if (!config.cookies || config.cookies.length === 0) {
    return {
      success: false,
      strategy: 'cookie',
      message: 'No cookies specified in auth config',
    };
  }

  try {
    const playwrightCookies = config.cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path ?? '/',
      secure: c.secure ?? false,
      httpOnly: c.httpOnly ?? false,
      sameSite: c.sameSite ?? ('Lax' as const),
    }));

    await context.addCookies(playwrightCookies);

    return {
      success: true,
      strategy: 'cookie',
      message: `Set ${config.cookies.length} cookie(s)`,
      cookiesSet: config.cookies.length,
    };
  } catch (error) {
    return {
      success: false,
      strategy: 'cookie',
      message: `Cookie auth failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function applyBearerAuth(
  context: any,
  config: AuthConfig,
): Promise<AuthResult> {
  if (!config.token) {
    return {
      success: false,
      strategy: 'bearer',
      message: 'No token specified in auth config',
    };
  }

  try {
    // Set extra HTTP headers on all requests
    await context.setExtraHTTPHeaders({
      Authorization: `Bearer ${config.token}`,
    });

    return {
      success: true,
      strategy: 'bearer',
      message: 'Bearer token set on all requests',
    };
  } catch (error) {
    return {
      success: false,
      strategy: 'bearer',
      message: `Bearer auth failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function applyFormLogin(
  context: any,
  config: AuthConfig,
): Promise<AuthResult> {
  if (!config.loginUrl || !config.credentials) {
    return {
      success: false,
      strategy: 'form-login',
      message: 'loginUrl and credentials required for form-login strategy',
    };
  }

  try {
    const page = await context.newPage();
    await page.goto(config.loginUrl, {
      waitUntil: 'networkidle',
      timeout: 15_000,
    });

    // Find and fill username
    const usernameSelector =
      config.usernameSelector ??
      'input[name="username"], input[name="email"], input[type="email"], input[id="username"], input[id="email"]';
    const usernameField = await page.$(usernameSelector);
    if (!usernameField) {
      await page.close();
      return {
        success: false,
        strategy: 'form-login',
        message: `Could not find username field with selector: ${usernameSelector}`,
      };
    }
    await usernameField.fill(config.credentials.username);

    // Find and fill password
    const passwordSelector =
      config.passwordSelector ?? 'input[type="password"]';
    const passwordField = await page.$(passwordSelector);
    if (!passwordField) {
      await page.close();
      return {
        success: false,
        strategy: 'form-login',
        message: `Could not find password field with selector: ${passwordSelector}`,
      };
    }
    await passwordField.fill(config.credentials.password);

    // Submit
    const submitSelector =
      config.submitSelector ??
      'button[type="submit"], input[type="submit"], button:has-text("Log in"), button:has-text("Sign in")';
    const submitBtn = await page.$(submitSelector);
    if (submitBtn) {
      await Promise.all([
        page
          .waitForNavigation({ timeout: 10_000 })
          .catch(() => null),
        submitBtn.click(),
      ]);
    } else {
      // Try pressing Enter
      await passwordField.press('Enter');
      await page
        .waitForNavigation({ timeout: 10_000 })
        .catch(() => null);
    }

    // Verify login success
    if (config.successIndicator) {
      try {
        await page.waitForSelector(config.successIndicator, { timeout: 5_000 });
      } catch {
        await page.close();
        return {
          success: false,
          strategy: 'form-login',
          message: `Login may have failed: success indicator "${config.successIndicator}" not found`,
        };
      }
    }

    await page.close();

    return {
      success: true,
      strategy: 'form-login',
      message: 'Form login completed',
    };
  } catch (error) {
    return {
      success: false,
      strategy: 'form-login',
      message: `Form login failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve ${ENV_VAR} references in a string value.
 */
function resolveEnvRef(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, varName) => {
    const envValue = process.env[varName];
    if (envValue === undefined) {
      console.warn(
        `[AuthHandler] Environment variable ${varName} not set, using empty string`,
      );
      return '';
    }
    return envValue;
  });
}
