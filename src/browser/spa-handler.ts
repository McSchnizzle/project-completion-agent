/**
 * SPA Handler - Strategies for waiting on single-page application navigation.
 *
 * SPAs don't trigger traditional page loads. This module provides multiple
 * strategies for detecting when an SPA has finished rendering after a
 * navigation or state change.
 *
 * @module browser/spa-handler
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SPAStrategy = 'networkidle' | 'domstable' | 'selector' | 'hybrid';

export interface SPAWaitOptions {
  /** Which strategy to use. Default: 'hybrid' */
  strategy?: SPAStrategy;
  /** Overall timeout in ms. Default: 10000 */
  timeout?: number;
  /** For 'domstable': ms of DOM quiet before considering settled. Default: 500 */
  domSettleMs?: number;
  /** For 'selector': wait until this selector appears */
  selector?: string;
}

export interface SPANavigationEvent {
  url: string;
  method: 'pushState' | 'replaceState' | 'popstate' | 'hashchange';
  timestamp: number;
}

// ---------------------------------------------------------------------------
// SPA Wait Functions
// ---------------------------------------------------------------------------

/**
 * Wait for the page to settle using the specified SPA strategy.
 *
 * @param page - Playwright Page object
 * @param options - Wait configuration
 */
export async function waitForSPASettle(
  page: any,
  options: SPAWaitOptions = {},
): Promise<void> {
  const strategy = options.strategy ?? 'hybrid';
  const timeout = options.timeout ?? 10_000;

  switch (strategy) {
    case 'networkidle':
      await waitNetworkIdle(page, timeout);
      break;
    case 'domstable':
      await waitDOMStable(page, timeout, options.domSettleMs ?? 500);
      break;
    case 'selector':
      if (options.selector) {
        await waitForSelector(page, options.selector, timeout);
      }
      break;
    case 'hybrid':
      await waitHybrid(page, timeout, options.domSettleMs ?? 500);
      break;
  }
}

/**
 * Install SPA navigation interceptors on a page.
 * Call this once after page creation to track client-side routing.
 *
 * @param page - Playwright Page object
 */
export async function installSPAInterceptors(page: any): Promise<void> {
  await page.addInitScript(() => {
    (window as any).__spaNavigations = [] as SPANavigationEvent[];

    // Intercept History.pushState
    const origPushState = history.pushState.bind(history);
    history.pushState = function (
      ...args: Parameters<typeof history.pushState>
    ) {
      (window as any).__spaNavigations.push({
        url: String(args[2] ?? ''),
        method: 'pushState',
        timestamp: Date.now(),
      });
      return origPushState(...args);
    };

    // Intercept History.replaceState
    const origReplaceState = history.replaceState.bind(history);
    history.replaceState = function (
      ...args: Parameters<typeof history.replaceState>
    ) {
      (window as any).__spaNavigations.push({
        url: String(args[2] ?? ''),
        method: 'replaceState',
        timestamp: Date.now(),
      });
      return origReplaceState(...args);
    };

    // Listen for popstate (back/forward)
    window.addEventListener('popstate', () => {
      (window as any).__spaNavigations.push({
        url: location.href,
        method: 'popstate',
        timestamp: Date.now(),
      });
    });

    // Listen for hashchange
    window.addEventListener('hashchange', () => {
      (window as any).__spaNavigations.push({
        url: location.href,
        method: 'hashchange',
        timestamp: Date.now(),
      });
    });
  });
}

/**
 * Read collected SPA navigation events from the page.
 *
 * @param page - Playwright Page object
 * @returns Array of navigation events since interceptors were installed.
 */
export async function getSPANavigations(
  page: any,
): Promise<SPANavigationEvent[]> {
  try {
    return await page.evaluate(() => {
      const navs = (window as any).__spaNavigations ?? [];
      return JSON.parse(JSON.stringify(navs));
    });
  } catch {
    return [];
  }
}

/**
 * Detect whether the page is an SPA based on heuristics.
 *
 * Checks for common SPA framework signatures (React, Vue, Angular, Svelte).
 *
 * @param page - Playwright Page object
 * @returns true if SPA indicators are detected
 */
export async function detectSPA(page: any): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      // React
      if (document.querySelector('[data-reactroot]')) return true;
      if (document.querySelector('#__next')) return true;
      if ((window as any).__NEXT_DATA__) return true;
      if ((window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__) return true;

      // Vue
      if (document.querySelector('[data-v-]')) return true;
      if (document.querySelector('#__nuxt')) return true;
      if ((window as any).__VUE__) return true;

      // Angular
      if (document.querySelector('[ng-app]')) return true;
      if (document.querySelector('[ng-version]')) return true;
      if (document.querySelector('app-root')) return true;

      // Svelte
      if (document.querySelector('[class*="svelte-"]')) return true;
      if (document.querySelector('#svelte')) return true;

      // Generic SPA signals
      if (document.querySelector('#app') && document.querySelector('script[type="module"]')) return true;
      if (document.querySelector('#root') && document.querySelectorAll('script').length > 3) return true;

      return false;
    });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Internal strategy implementations
// ---------------------------------------------------------------------------

async function waitNetworkIdle(page: any, timeout: number): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout });
  } catch {
    // Timeout is acceptable - network may never go fully idle (websockets, polling)
  }
}

async function waitDOMStable(
  page: any,
  timeout: number,
  settleMs: number,
): Promise<void> {
  try {
    await page.evaluate(
      ({ settleMs, timeout }: { settleMs: number; timeout: number }) => {
        return new Promise<void>((resolve) => {
          let mutationTimeout: ReturnType<typeof setTimeout>;
          const overallTimeout = setTimeout(() => {
            observer.disconnect();
            resolve();
          }, timeout);

          const observer = new MutationObserver(() => {
            clearTimeout(mutationTimeout);
            mutationTimeout = setTimeout(() => {
              observer.disconnect();
              clearTimeout(overallTimeout);
              resolve();
            }, settleMs);
          });

          observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
          });

          // Start the settle timer immediately (in case DOM is already stable)
          mutationTimeout = setTimeout(() => {
            observer.disconnect();
            clearTimeout(overallTimeout);
            resolve();
          }, settleMs);
        });
      },
      { settleMs, timeout },
    );
  } catch {
    // Page may have navigated, that's ok
  }
}

async function waitForSelector(
  page: any,
  selector: string,
  timeout: number,
): Promise<void> {
  try {
    await page.waitForSelector(selector, { timeout, state: 'visible' });
  } catch {
    // Selector may never appear
  }
}

async function waitHybrid(
  page: any,
  timeout: number,
  settleMs: number,
): Promise<void> {
  // Wait for DOM stability first (more reliable for SPAs)
  await waitDOMStable(page, Math.min(timeout, 5000), settleMs);
  // Then a brief network idle check
  await waitNetworkIdle(page, Math.min(timeout - 5000, 3000));
}
