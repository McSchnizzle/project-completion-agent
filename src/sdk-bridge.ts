/**
 * SDK Bridge - Foundation Module
 *
 * Provides interface between the audit system and Claude SDK.
 * Handles prompt execution, cost tracking, and retry logic.
 */

export interface SDKConfig {
  maxRetries?: number;
  timeoutMs?: number;
  costPerToken?: number;
}

export interface SDKResponse {
  success: boolean;
  output?: string;
  tokensUsed?: number;
  cost?: number;
  error?: string;
}

export interface ClaudeSDK {
  executePrompt(prompt: string, context?: Record<string, any>): Promise<SDKResponse>;
}

export class SDKBridge {
  private sdk: ClaudeSDK;
  private config: SDKConfig;
  private totalCost: number = 0;
  private totalTokens: number = 0;

  constructor(sdk: ClaudeSDK, config: SDKConfig = {}) {
    this.sdk = sdk;
    this.config = {
      maxRetries: config.maxRetries ?? 3,
      timeoutMs: config.timeoutMs ?? 30000,
      costPerToken: config.costPerToken ?? 0.00001
    };
  }

  /**
   * Execute a Claude phase with retry logic
   */
  async runClaudePhase(
    promptPath: string,
    context: Record<string, any> = {}
  ): Promise<SDKResponse> {
    const prompt = await this.loadPrompt(promptPath);
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.maxRetries!; attempt++) {
      try {
        const response = await this.executeWithTimeout(prompt, context);

        if (response.success) {
          this.updateCosts(response);
          return response;
        }

        lastError = new Error(response.error || 'Unknown error');

        if (attempt < this.config.maxRetries!) {
          await this.delay(Math.pow(2, attempt) * 1000);
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.config.maxRetries!) {
          await this.delay(Math.pow(2, attempt) * 1000);
        }
      }
    }

    return {
      success: false,
      error: lastError?.message || 'Max retries exceeded'
    };
  }

  /**
   * Execute prompt with timeout
   */
  private async executeWithTimeout(
    prompt: string,
    context: Record<string, any>
  ): Promise<SDKResponse> {
    return Promise.race([
      this.sdk.executePrompt(prompt, context),
      new Promise<SDKResponse>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), this.config.timeoutMs)
      )
    ]);
  }

  /**
   * Load prompt from file system.
   * Resolves relative paths against the project root (directory containing package.json).
   */
  private async loadPrompt(promptPath: string): Promise<string> {
    const fs = await import('fs/promises');
    const path = await import('path');

    let resolved = promptPath;
    if (!path.isAbsolute(promptPath)) {
      // Walk up from this file's directory to find the project root
      const projectRoot = path.resolve(__dirname, '..');
      resolved = path.join(projectRoot, promptPath);
    }

    try {
      return await fs.readFile(resolved, 'utf-8');
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') {
        throw new Error(`Prompt file not found: ${resolved} (original: ${promptPath})`);
      }
      throw err;
    }
  }

  /**
   * Update cost tracking
   */
  private updateCosts(response: SDKResponse): void {
    if (response.tokensUsed) {
      this.totalTokens += response.tokensUsed;
      const cost = response.tokensUsed * this.config.costPerToken!;
      this.totalCost += cost;
    }
  }

  /**
   * Get total cost
   */
  getTotalCost(): number {
    return this.totalCost;
  }

  /**
   * Get total tokens
   */
  getTotalTokens(): number {
    return this.totalTokens;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Factory function to create SDK bridge
 */
export function createSDKBridge(sdk: ClaudeSDK, config?: SDKConfig): SDKBridge {
  return new SDKBridge(sdk, config);
}
