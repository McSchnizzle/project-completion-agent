/**
 * Job Runner - Foundation Module
 *
 * Manages concurrent job execution with retry, timeout, and budget controls.
 */

export interface Job<T = any> {
  id: string;
  execute: () => Promise<T>;
  priority?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface JobResult<T = any> {
  id: string;
  success: boolean;
  result?: T;
  error?: string;
  attempts: number;
  duration: number;
}

export interface JobRunnerConfig {
  maxConcurrent?: number;
  defaultTimeout?: number;
  defaultRetries?: number;
  maxBudget?: number;
  costPerJob?: number;
}

export class JobRunner {
  private config: JobRunnerConfig;
  private currentCost: number = 0;
  private activeJobs: number = 0;

  constructor(config: JobRunnerConfig = {}) {
    this.config = {
      maxConcurrent: config.maxConcurrent ?? 3,
      defaultTimeout: config.defaultTimeout ?? 60000,
      defaultRetries: config.defaultRetries ?? 2,
      maxBudget: config.maxBudget ?? Infinity,
      costPerJob: config.costPerJob ?? 1
    };
  }

  /**
   * Run multiple jobs with concurrency control
   */
  async runJobs<T>(jobs: Job<T>[]): Promise<JobResult<T>[]> {
    const results: JobResult<T>[] = [];
    const queue = [...jobs].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    while (queue.length > 0) {
      // Check budget
      if (this.currentCost >= this.config.maxBudget!) {
        // Mark remaining jobs as failed
        for (const job of queue) {
          results.push({
            id: job.id,
            success: false,
            error: 'Budget exceeded',
            attempts: 0,
            duration: 0
          });
        }
        break;
      }

      // Get next batch respecting concurrency limit
      const batch: Job<T>[] = [];
      while (
        batch.length < this.config.maxConcurrent! &&
        queue.length > 0 &&
        this.activeJobs + batch.length < this.config.maxConcurrent!
      ) {
        batch.push(queue.shift()!);
      }

      if (batch.length === 0) break;

      // Run batch in parallel
      const batchResults = await Promise.all(
        batch.map(job => this.runJob(job))
      );

      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Run a single job with retry logic
   */
  private async runJob<T>(job: Job<T>): Promise<JobResult<T>> {
    const startTime = Date.now();
    const maxRetries = job.maxRetries ?? this.config.defaultRetries!;
    const timeout = job.timeoutMs ?? this.config.defaultTimeout!;
    let lastError: Error | null = null;

    this.activeJobs++;

    try {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          // Check budget before each attempt
          if (this.currentCost >= this.config.maxBudget!) {
            throw new Error('Budget exceeded');
          }

          const result = await this.executeWithTimeout(job.execute, timeout);

          // Update cost
          this.currentCost += this.config.costPerJob!;

          return {
            id: job.id,
            success: true,
            result,
            attempts: attempt + 1,
            duration: Date.now() - startTime
          };
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          // Don't retry on budget or timeout errors
          if (
            lastError.message.includes('Budget exceeded') ||
            lastError.message.includes('Timeout')
          ) {
            break;
          }

          // Exponential backoff
          if (attempt < maxRetries) {
            await this.delay(Math.pow(2, attempt) * 1000);
          }
        }
      }

      return {
        id: job.id,
        success: false,
        error: lastError?.message || 'Unknown error',
        attempts: maxRetries + 1,
        duration: Date.now() - startTime
      };
    } finally {
      this.activeJobs--;
    }
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout<T>(
    execute: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      execute(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), timeoutMs)
      )
    ]);
  }

  /**
   * Get current cost
   */
  getCurrentCost(): number {
    return this.currentCost;
  }

  /**
   * Get active job count
   */
  getActiveJobCount(): number {
    return this.activeJobs;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Factory function to create job runner
 */
export function createJobRunner(config?: JobRunnerConfig): JobRunner {
  return new JobRunner(config);
}
