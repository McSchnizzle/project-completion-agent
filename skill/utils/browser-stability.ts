/**
 * Browser Stability - Retry & Recovery
 * Task 6.5: Browser Retry & Recovery
 *
 * Provides utilities for handling browser automation failures
 * with configurable retry logic, backoff, and recovery strategies.
 */

export interface RetryOptions {
  max_attempts: number;
  base_delay_ms: number;
  max_delay_ms: number;
  backoff_multiplier: number;
  retryable_errors: string[];
  on_retry?: (attempt: number, error: Error) => void;
}

export interface BrowserHealthCheck {
  tab_responsive: boolean;
  page_loaded: boolean;
  no_modal_blocking: boolean;
  network_idle: boolean;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  max_attempts: 3,
  base_delay_ms: 1000,
  max_delay_ms: 10000,
  backoff_multiplier: 2,
  retryable_errors: [
    'timeout',
    'network error',
    'tab not found',
    'page not loaded',
    'element not found',
    'stale element',
    'connection refused',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND'
  ]
};

/**
 * Wrap an async function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | null = null;
  let delay = opts.base_delay_ms;

  for (let attempt = 1; attempt <= opts.max_attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable
      if (!isRetryableError(lastError, opts.retryable_errors)) {
        throw lastError;
      }

      // Don't retry on last attempt
      if (attempt >= opts.max_attempts) {
        break;
      }

      // Call retry callback if provided
      if (opts.on_retry) {
        opts.on_retry(attempt, lastError);
      }

      // Wait before retry with exponential backoff
      await sleep(delay);
      delay = Math.min(delay * opts.backoff_multiplier, opts.max_delay_ms);
    }
  }

  throw new BrowserStabilityError(
    `Failed after ${opts.max_attempts} attempts: ${lastError?.message}`,
    lastError
  );
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error: Error, retryablePatterns: string[]): boolean {
  const message = error.message.toLowerCase();
  return retryablePatterns.some(pattern =>
    message.includes(pattern.toLowerCase())
  );
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Custom error for browser stability issues
 */
export class BrowserStabilityError extends Error {
  public readonly cause: Error | null;
  public readonly recoverable: boolean;

  constructor(message: string, cause: Error | null = null, recoverable: boolean = true) {
    super(message);
    this.name = 'BrowserStabilityError';
    this.cause = cause;
    this.recoverable = recoverable;
  }
}

/**
 * Wait for page to be fully loaded and stable
 */
export async function waitForPageStable(
  checkFn: () => Promise<BrowserHealthCheck>,
  timeout_ms: number = 30000,
  poll_interval_ms: number = 500
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeout_ms) {
    const health = await checkFn();

    if (health.tab_responsive &&
        health.page_loaded &&
        health.no_modal_blocking &&
        health.network_idle) {
      return;
    }

    await sleep(poll_interval_ms);
  }

  throw new BrowserStabilityError(
    `Page did not stabilize within ${timeout_ms}ms`,
    null,
    true
  );
}

/**
 * Recovery strategies for common browser issues
 */
export const RecoveryStrategies = {
  /**
   * Refresh the page and wait for it to stabilize
   */
  async refreshPage(
    refreshFn: () => Promise<void>,
    healthCheckFn: () => Promise<BrowserHealthCheck>
  ): Promise<void> {
    await refreshFn();
    await waitForPageStable(healthCheckFn);
  },

  /**
   * Close modal/dialog and retry
   */
  async dismissModal(
    dismissFn: () => Promise<void>
  ): Promise<void> {
    await dismissFn();
    await sleep(500); // Brief pause for modal animation
  },

  /**
   * Navigate back and try alternative path
   */
  async navigateBack(
    backFn: () => Promise<void>,
    healthCheckFn: () => Promise<BrowserHealthCheck>
  ): Promise<void> {
    await backFn();
    await waitForPageStable(healthCheckFn);
  },

  /**
   * Create new tab if current tab is unresponsive
   */
  async recreateTab(
    createTabFn: () => Promise<number>,
    navigateFn: (tabId: number, url: string) => Promise<void>,
    targetUrl: string
  ): Promise<number> {
    const newTabId = await createTabFn();
    await navigateFn(newTabId, targetUrl);
    return newTabId;
  }
};

/**
 * Circuit breaker for preventing repeated failures
 */
export class CircuitBreaker {
  private failures: number = 0;
  private last_failure_time: number = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private readonly failure_threshold: number = 5,
    private readonly reset_timeout_ms: number = 60000
  ) {}

  /**
   * Check if circuit is open (should not attempt)
   */
  isOpen(): boolean {
    if (this.state === 'open') {
      // Check if reset timeout has passed
      if (Date.now() - this.last_failure_time >= this.reset_timeout_ms) {
        this.state = 'half-open';
        return false;
      }
      return true;
    }
    return false;
  }

  /**
   * Record a successful operation
   */
  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  /**
   * Record a failed operation
   */
  recordFailure(): void {
    this.failures++;
    this.last_failure_time = Date.now();

    if (this.failures >= this.failure_threshold) {
      this.state = 'open';
    }
  }

  /**
   * Get current state
   */
  getState(): { state: string; failures: number; can_attempt: boolean } {
    return {
      state: this.state,
      failures: this.failures,
      can_attempt: !this.isOpen()
    };
  }
}

/**
 * Wrapper that combines retry logic with circuit breaker
 */
export async function withCircuitBreaker<T>(
  fn: () => Promise<T>,
  breaker: CircuitBreaker,
  retryOptions: Partial<RetryOptions> = {}
): Promise<T> {
  if (breaker.isOpen()) {
    throw new BrowserStabilityError(
      'Circuit breaker is open - too many recent failures',
      null,
      false
    );
  }

  try {
    const result = await withRetry(fn, retryOptions);
    breaker.recordSuccess();
    return result;
  } catch (error) {
    breaker.recordFailure();
    throw error;
  }
}

/**
 * Create a retry-wrapped browser action
 */
export function createStableBrowserAction<T>(
  action: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): () => Promise<T> {
  return () => withRetry(action, options);
}
