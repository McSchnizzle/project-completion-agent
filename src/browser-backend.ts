/**
 * BrowserBackend interface - V4 abstraction over browser automation.
 *
 * All browser-consuming code depends on this interface, never on a concrete
 * implementation. PlaywrightBrowserAdapter is the sole implementation.
 */

// Re-export existing types from playwright-browser for compatibility
export type {
  PageData,
  ConsoleMessage,
  NetworkError,
  FormData,
  FormField,
  ViewportSpec,
  OverflowResult,
} from './playwright-browser.js';

import type { ConsoleMessage, PageData, ViewportSpec, OverflowResult } from './playwright-browser.js';

// New types for V4

export interface NetworkRequest {
  url: string;
  method: string;
  status: number;
  statusText: string;
  contentType: string;
  durationMs: number;
  requestHeaders?: Record<string, string>;
  responseSize?: number;
  isError: boolean;
  timestamp: number;
}

export interface ClickResult {
  success: boolean;
  urlAfter: string;
  navigated: boolean;
  domChanges: DOMChange[];
  consoleMessages: ConsoleMessage[];
  networkRequests: NetworkRequest[];
  screenshotAfter?: Buffer;
  error?: string;
}

export interface DOMChange {
  type: 'added' | 'removed' | 'modified';
  selector: string;
  description: string;
}

export interface FormSubmitResult {
  success: boolean;
  urlAfter: string;
  navigated: boolean;
  pageAfter?: PageData;
  screenshotBefore?: Buffer;
  screenshotAfter?: Buffer;
  validationErrors: string[];
  consoleMessages: ConsoleMessage[];
  networkRequests: NetworkRequest[];
  domChanges?: DOMChange[];
  error?: string;
}

export type BrowserBackendType = 'playwright';

export interface BrowserBackendConfig {
  type: BrowserBackendType;
  headless?: boolean;
  timeoutMs?: number;
  screenshots?: boolean;
  authConfig?: import('./browser/auth-handler.js').AuthConfig;
}

// Auth failure detection
export type AuthFailureType = 'oauth-redirect' | 'sso-redirect' | 'login-form-failed' | 'session-expired';

export class AuthFailureError extends Error {
  readonly authType: AuthFailureType;
  readonly redirectUrl?: string;

  constructor(message: string, authType: AuthFailureType, redirectUrl?: string) {
    super(message);
    this.name = 'AuthFailureError';
    this.authType = authType;
    this.redirectUrl = redirectUrl;
  }
}

/** Heuristic detection of auth failure from page data. */
export function isAuthFailure(pageData: PageData): boolean {
  const url = pageData.url.toLowerCase();
  const text = pageData.text.toLowerCase();

  // SSO provider redirects
  const ssoProviders = ['accounts.google.com', 'login.microsoftonline.com', 'auth0.com', 'okta.com', 'cognito'];
  if (ssoProviders.some((p) => url.includes(p))) return true;

  // OAuth redirect patterns
  if (/[?&](redirect_uri|client_id|response_type)=/.test(pageData.url)) return true;

  // Login form detection
  if (text.includes('sign in') || text.includes('log in') || text.includes('enter your password')) {
    if (pageData.forms.some((f) => f.fields.some((field) => field.type === 'password'))) {
      return true;
    }
  }

  return false;
}

// The main interface
export interface BrowserBackend {
  readonly name: string;
  launch(): Promise<boolean>;
  isAvailable(): boolean;
  close(): Promise<void>;

  // Page visiting
  visitPage(url: string): Promise<PageData>;
  visitPageAndWait(url: string, selector: string, timeoutMs?: number): Promise<PageData>;

  // Interaction
  clickElement(url: string, selector: string): Promise<ClickResult>;
  fillAndSubmitForm(
    url: string,
    formSelector: string,
    fieldValues: Record<string, string>,
  ): Promise<FormSubmitResult>;

  // Viewport testing
  testViewports(
    url: string,
    viewports: ViewportSpec[],
  ): Promise<Map<string, PageData & { overflow: OverflowResult }>>;

  // Diagnostics
  getConsoleMessages(): ConsoleMessage[];
  getNetworkRequests(): NetworkRequest[];
  clearBuffers(): void;

  // Script execution (for API smoke testing with auth cookies)
  executeScript<T = unknown>(script: string): Promise<T>;

  // Screenshots
  captureScreenshot(fullPage?: boolean): Promise<Buffer | undefined>;
}

// Factory function
export async function createBrowserBackend(
  config: BrowserBackendConfig,
): Promise<BrowserBackend> {
  const { PlaywrightBrowserAdapter } = await import('./playwright-browser-adapter.js');
  return new PlaywrightBrowserAdapter(config);
}
