/**
 * Browser Queue - Exclusive-lease FIFO queue for serialized browser access
 *
 * Ensures only one operation can use the browser at a time, with automatic
 * deadlock detection and recovery.
 */

export interface BrowserLease {
  id: string;
  acquiredAt: number;
  timeout: number;
}

interface QueuedRequest {
  resolve: (lease: BrowserLease) => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
}

export interface BrowserQueueOptions {
  timeout?: number;
}

export class BrowserQueue {
  private currentLease: BrowserLease | null = null;
  private queue: QueuedRequest[] = [];
  private defaultTimeout: number;
  private leaseCounter = 0;
  private timeoutHandle: NodeJS.Timeout | null = null;

  constructor(options: BrowserQueueOptions = {}) {
    this.defaultTimeout = options.timeout ?? 300_000; // 5 minutes default
  }

  /**
   * Acquire an exclusive lease on the browser.
   * If the browser is currently leased, waits in FIFO queue until available.
   */
  async acquire(): Promise<BrowserLease> {
    // If browser is available, grant lease immediately
    if (this.currentLease === null) {
      return this.grantLease();
    }

    // Otherwise, queue the request and wait
    return new Promise<BrowserLease>((resolve, reject) => {
      this.queue.push({
        resolve,
        reject,
        enqueuedAt: Date.now()
      });
    });
  }

  /**
   * Release a lease, allowing the next queued request to proceed.
   */
  release(lease: BrowserLease): void {
    // Validate that this is the current lease
    if (this.currentLease === null) {
      console.warn(`[BrowserQueue] Attempted to release lease ${lease.id}, but no lease is active`);
      return;
    }

    if (this.currentLease.id !== lease.id) {
      console.warn(`[BrowserQueue] Attempted to release lease ${lease.id}, but current lease is ${this.currentLease.id}`);
      return;
    }

    // Clear the timeout handle
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }

    // Clear current lease
    this.currentLease = null;

    // Process next in queue
    this.processNextInQueue();
  }

  /**
   * Wait for all queued jobs to complete (queue drains).
   */
  async waitAll(): Promise<void> {
    // If no active lease and empty queue, return immediately
    if (this.currentLease === null && this.queue.length === 0) {
      return;
    }

    // Wait for queue to drain
    return new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.currentLease === null && this.queue.length === 0) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100); // Check every 100ms
    });
  }

  /**
   * Check if the browser is currently unleased.
   */
  isAvailable(): boolean {
    return this.currentLease === null;
  }

  /**
   * Get the number of waiters in the queue.
   */
  queueLength(): number {
    return this.queue.length;
  }

  /**
   * Grant a new lease and set up timeout for deadlock detection.
   */
  private grantLease(): BrowserLease {
    const lease: BrowserLease = {
      id: this.generateLeaseId(),
      acquiredAt: Date.now(),
      timeout: this.defaultTimeout
    };

    this.currentLease = lease;

    // Set up deadlock detection timeout
    this.timeoutHandle = setTimeout(() => {
      this.handleLeaseTimeout(lease);
    }, lease.timeout);

    return lease;
  }

  /**
   * Generate a unique lease ID.
   */
  private generateLeaseId(): string {
    // Use crypto.randomUUID if available, otherwise fallback to counter-based ID
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `lease-${++this.leaseCounter}-${Date.now()}`;
  }

  /**
   * Handle lease timeout (deadlock detection).
   */
  private handleLeaseTimeout(lease: BrowserLease): void {
    if (this.currentLease?.id === lease.id) {
      const heldFor = Date.now() - lease.acquiredAt;
      console.error(
        `[BrowserQueue] Lease ${lease.id} exceeded timeout (${lease.timeout}ms). ` +
        `Held for ${heldFor}ms. Force-releasing to prevent deadlock.`
      );

      // Force release
      this.currentLease = null;
      this.timeoutHandle = null;

      // Process next in queue
      this.processNextInQueue();
    }
  }

  /**
   * Process the next request in the queue.
   */
  private processNextInQueue(): void {
    if (this.queue.length === 0) {
      return;
    }

    const request = this.queue.shift()!;
    const lease = this.grantLease();
    request.resolve(lease);
  }

  /**
   * Get diagnostic information about the queue state.
   */
  getState(): {
    hasActiveLease: boolean;
    currentLeaseId: string | null;
    leaseHeldFor: number | null;
    queueLength: number;
  } {
    return {
      hasActiveLease: this.currentLease !== null,
      currentLeaseId: this.currentLease?.id ?? null,
      leaseHeldFor: this.currentLease
        ? Date.now() - this.currentLease.acquiredAt
        : null,
      queueLength: this.queue.length
    };
  }
}
