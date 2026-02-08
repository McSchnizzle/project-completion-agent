/**
 * Foundation Modules Unit Tests
 *
 * Tests for sdk-bridge, job-runner, and phase-runner modules
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  createSDKBridge,
  SDKBridge,
  ClaudeSDK,
  SDKResponse,
  SDKConfig
} from '../../src/sdk-bridge';
import {
  createJobRunner,
  JobRunner,
  Job,
  JobRunnerConfig
} from '../../src/job-runner';
import {
  createPhaseRunner,
  PhaseRunner,
  PhaseConfig
} from '../../src/phase-runner';

// Test helpers
let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(process.cwd(), '.test-'));
});

afterEach(() => {
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  vi.clearAllMocks();
});

// SDK Bridge Tests
describe('SDKBridge', () => {
  describe('createSDKBridge', () => {
    it('should create an SDK bridge instance', () => {
      const mockSDK: ClaudeSDK = {
        executePrompt: vi.fn().mockResolvedValue({ success: true })
      };

      const bridge = createSDKBridge(mockSDK);
      expect(bridge).toBeInstanceOf(SDKBridge);
    });

    it('should accept custom configuration', () => {
      const mockSDK: ClaudeSDK = {
        executePrompt: vi.fn().mockResolvedValue({ success: true })
      };
      const config: SDKConfig = {
        maxRetries: 5,
        timeoutMs: 10000,
        costPerToken: 0.00002
      };

      const bridge = createSDKBridge(mockSDK, config);
      expect(bridge).toBeInstanceOf(SDKBridge);
    });
  });

  describe('runClaudePhase', () => {
    it('should execute prompt successfully', async () => {
      const mockSDK: ClaudeSDK = {
        executePrompt: vi.fn().mockResolvedValue({
          success: true,
          output: 'Test output',
          tokensUsed: 100
        })
      };

      const promptPath = path.join(tempDir, 'test-prompt.txt');
      fs.writeFileSync(promptPath, 'Test prompt content');

      const bridge = createSDKBridge(mockSDK);
      const result = await bridge.runClaudePhase(promptPath, { key: 'value' });

      expect(result.success).toBe(true);
      expect(result.output).toBe('Test output');
      expect(mockSDK.executePrompt).toHaveBeenCalledWith(
        'Test prompt content',
        { key: 'value' }
      );
    });

    it('should retry on failure', async () => {
      let attempts = 0;
      const mockSDK: ClaudeSDK = {
        executePrompt: vi.fn().mockImplementation(async () => {
          attempts++;
          if (attempts < 3) {
            return { success: false, error: 'Temporary failure' };
          }
          return { success: true, output: 'Success after retries', tokensUsed: 50 };
        })
      };

      const promptPath = path.join(tempDir, 'test-prompt.txt');
      fs.writeFileSync(promptPath, 'Test prompt');

      const bridge = createSDKBridge(mockSDK, { maxRetries: 3, timeoutMs: 100 });
      const result = await bridge.runClaudePhase(promptPath);

      expect(result.success).toBe(true);
      expect(attempts).toBe(3);
      expect(mockSDK.executePrompt).toHaveBeenCalledTimes(3);
    }, 10000);

    it('should fail after max retries', async () => {
      const mockSDK: ClaudeSDK = {
        executePrompt: vi.fn().mockResolvedValue({
          success: false,
          error: 'Persistent failure'
        })
      };

      const promptPath = path.join(tempDir, 'test-prompt.txt');
      fs.writeFileSync(promptPath, 'Test prompt');

      const bridge = createSDKBridge(mockSDK, { maxRetries: 2 });
      const result = await bridge.runClaudePhase(promptPath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Persistent failure');
      expect(mockSDK.executePrompt).toHaveBeenCalledTimes(2);
    });

    it('should handle timeout', async () => {
      const mockSDK: ClaudeSDK = {
        executePrompt: vi.fn().mockImplementation(
          () => new Promise(resolve => setTimeout(() => resolve({ success: true }), 5000))
        )
      };

      const promptPath = path.join(tempDir, 'test-prompt.txt');
      fs.writeFileSync(promptPath, 'Test prompt');

      const bridge = createSDKBridge(mockSDK, { timeoutMs: 100, maxRetries: 1 });
      const result = await bridge.runClaudePhase(promptPath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Timeout');
    });
  });

  describe('cost tracking', () => {
    it('should track token usage and cost', async () => {
      const mockSDK: ClaudeSDK = {
        executePrompt: vi.fn().mockResolvedValue({
          success: true,
          output: 'Test',
          tokensUsed: 1000
        })
      };

      const promptPath = path.join(tempDir, 'test-prompt.txt');
      fs.writeFileSync(promptPath, 'Test prompt');

      const bridge = createSDKBridge(mockSDK, { costPerToken: 0.00001 });
      await bridge.runClaudePhase(promptPath);

      expect(bridge.getTotalTokens()).toBe(1000);
      expect(bridge.getTotalCost()).toBe(0.01);
    });

    it('should accumulate costs across multiple calls', async () => {
      const mockSDK: ClaudeSDK = {
        executePrompt: vi.fn().mockResolvedValue({
          success: true,
          tokensUsed: 500
        })
      };

      const promptPath = path.join(tempDir, 'test-prompt.txt');
      fs.writeFileSync(promptPath, 'Test prompt');

      const bridge = createSDKBridge(mockSDK, { costPerToken: 0.00001 });
      await bridge.runClaudePhase(promptPath);
      await bridge.runClaudePhase(promptPath);

      expect(bridge.getTotalTokens()).toBe(1000);
      expect(bridge.getTotalCost()).toBe(0.01);
    });
  });
});

// Job Runner Tests
describe('JobRunner', () => {
  describe('createJobRunner', () => {
    it('should create a job runner instance', () => {
      const runner = createJobRunner();
      expect(runner).toBeInstanceOf(JobRunner);
    });

    it('should accept custom configuration', () => {
      const config: JobRunnerConfig = {
        maxConcurrent: 5,
        defaultTimeout: 30000,
        maxBudget: 100
      };
      const runner = createJobRunner(config);
      expect(runner).toBeInstanceOf(JobRunner);
    });
  });

  describe('runJobs', () => {
    it('should execute jobs successfully', async () => {
      const jobs: Job<string>[] = [
        {
          id: 'job1',
          execute: vi.fn().mockResolvedValue('result1')
        },
        {
          id: 'job2',
          execute: vi.fn().mockResolvedValue('result2')
        }
      ];

      const runner = createJobRunner();
      const results = await runner.runJobs(jobs);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[0].result).toBe('result1');
      expect(results[1].success).toBe(true);
      expect(results[1].result).toBe('result2');
    });

    it('should handle job failures', async () => {
      const jobs: Job<string>[] = [
        {
          id: 'job1',
          execute: vi.fn().mockRejectedValue(new Error('Job failed')),
          maxRetries: 1
        }
      ];

      const runner = createJobRunner({ defaultRetries: 1 });
      const results = await runner.runJobs(jobs);

      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('Job failed');
      expect(results[0].attempts).toBe(2);
    });

    it('should respect concurrency limits', async () => {
      let concurrentJobs = 0;
      let maxConcurrent = 0;

      const jobs: Job<string>[] = Array.from({ length: 10 }, (_, i) => ({
        id: `job${i}`,
        execute: async () => {
          concurrentJobs++;
          maxConcurrent = Math.max(maxConcurrent, concurrentJobs);
          await new Promise(resolve => setTimeout(resolve, 50));
          concurrentJobs--;
          return `result${i}`;
        }
      }));

      const runner = createJobRunner({ maxConcurrent: 3 });
      await runner.runJobs(jobs);

      expect(maxConcurrent).toBeLessThanOrEqual(3);
    });

    it('should respect budget limits', async () => {
      const jobs: Job<string>[] = Array.from({ length: 10 }, (_, i) => ({
        id: `job${i}`,
        execute: vi.fn().mockResolvedValue(`result${i}`)
      }));

      const runner = createJobRunner({ maxBudget: 5, costPerJob: 1, maxConcurrent: 1 });
      const results = await runner.runJobs(jobs);

      const successfulJobs = results.filter(r => r.success).length;
      expect(successfulJobs).toBe(5);
      expect(runner.getCurrentCost()).toBe(5);
    });

    it('should handle timeouts', async () => {
      const jobs: Job<string>[] = [
        {
          id: 'job1',
          execute: () => new Promise(resolve => setTimeout(() => resolve('done'), 5000)),
          timeoutMs: 100
        }
      ];

      const runner = createJobRunner({ defaultRetries: 0 });
      const results = await runner.runJobs(jobs);

      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('Timeout');
    });

    it('should prioritize jobs correctly', async () => {
      const executionOrder: string[] = [];

      const jobs: Job<string>[] = [
        {
          id: 'low',
          priority: 1,
          execute: async () => {
            executionOrder.push('low');
            return 'low';
          }
        },
        {
          id: 'high',
          priority: 10,
          execute: async () => {
            executionOrder.push('high');
            return 'high';
          }
        },
        {
          id: 'medium',
          priority: 5,
          execute: async () => {
            executionOrder.push('medium');
            return 'medium';
          }
        }
      ];

      const runner = createJobRunner({ maxConcurrent: 1 });
      await runner.runJobs(jobs);

      expect(executionOrder).toEqual(['high', 'medium', 'low']);
    });

    it('should retry with exponential backoff', async () => {
      const timestamps: number[] = [];
      let attempts = 0;

      const jobs: Job<string>[] = [
        {
          id: 'job1',
          maxRetries: 2,
          execute: async () => {
            timestamps.push(Date.now());
            attempts++;
            if (attempts < 3) {
              throw new Error('Retry needed');
            }
            return 'success';
          }
        }
      ];

      const runner = createJobRunner();
      await runner.runJobs(jobs);

      // Check that delays increase (backoff)
      if (timestamps.length >= 2) {
        const delay1 = timestamps[1] - timestamps[0];
        const delay2 = timestamps[2] - timestamps[1];
        expect(delay2).toBeGreaterThan(delay1);
      }
    });
  });
});

// Phase Runner Tests
describe('PhaseRunner', () => {
  describe('createPhaseRunner', () => {
    it('should create a phase runner instance', () => {
      const mockSDK: ClaudeSDK = {
        executePrompt: vi.fn().mockResolvedValue({ success: true })
      };
      const bridge = createSDKBridge(mockSDK);
      const runner = createPhaseRunner(bridge, 100);

      expect(runner).toBeInstanceOf(PhaseRunner);
    });
  });

  describe('runPhase', () => {
    it('should execute phase successfully', async () => {
      const mockSDK: ClaudeSDK = {
        executePrompt: vi.fn().mockResolvedValue({
          success: true,
          output: 'Phase output',
          tokensUsed: 100,
          cost: 0.001
        })
      };

      const promptPath = path.join(tempDir, 'phase-prompt.txt');
      fs.writeFileSync(promptPath, 'Phase prompt');

      const bridge = createSDKBridge(mockSDK);
      const runner = createPhaseRunner(bridge, 100);

      const config: PhaseConfig = {
        name: 'test-phase',
        promptPath,
        required: true
      };

      const result = await runner.runPhase(config, { test: 'context' });

      expect(result.success).toBe(true);
      expect(result.output).toBe('Phase output');
      expect(result.validationPassed).toBe(true);
    });

    it('should validate phase output', async () => {
      const mockSDK: ClaudeSDK = {
        executePrompt: vi.fn().mockResolvedValue({
          success: true,
          output: 'Invalid output',
          cost: 0.001
        })
      };

      const promptPath = path.join(tempDir, 'phase-prompt.txt');
      fs.writeFileSync(promptPath, 'Phase prompt');

      const bridge = createSDKBridge(mockSDK);
      const runner = createPhaseRunner(bridge);

      const config: PhaseConfig = {
        name: 'test-phase',
        promptPath,
        required: true,
        retryOnValidationFailure: false,
        validationRules: [
          {
            name: 'contains-expected',
            validate: (output: string) => output.includes('expected'),
            errorMessage: 'Output must contain "expected"'
          }
        ]
      };

      const result = await runner.runPhase(config);

      expect(result.success).toBe(false);
      expect(result.validationPassed).toBe(false);
      expect(result.validationErrors).toContain('Output must contain "expected"');
    });

    it('should retry on validation failure when enabled', async () => {
      let sdkCallCount = 0;
      const mockSDK: ClaudeSDK = {
        executePrompt: vi.fn().mockImplementation(async () => {
          sdkCallCount++;
          return {
            success: true,
            output: sdkCallCount >= 2 ? 'output with expected text' : 'invalid output',
            cost: 0.001
          };
        })
      };

      const promptPath = path.join(tempDir, 'phase-prompt.txt');
      fs.writeFileSync(promptPath, 'Phase prompt');

      const bridge = createSDKBridge(mockSDK, { maxRetries: 1 });
      const runner = createPhaseRunner(bridge);

      const config: PhaseConfig = {
        name: 'test-phase',
        promptPath,
        required: true,
        retryOnValidationFailure: true,
        validationRules: [
          {
            name: 'contains-expected',
            validate: (output: string) => output.includes('expected'),
            errorMessage: 'Must contain "expected"'
          }
        ]
      };

      const result = await runner.runPhase(config);

      expect(result.success).toBe(true);
      expect(result.validationPassed).toBe(true);
      expect(mockSDK.executePrompt).toHaveBeenCalledTimes(2);
    });

    it('should check budget before execution', async () => {
      const mockSDK: ClaudeSDK = {
        executePrompt: vi.fn().mockResolvedValue({
          success: true,
          cost: 10
        })
      };

      const promptPath = path.join(tempDir, 'phase-prompt.txt');
      fs.writeFileSync(promptPath, 'Phase prompt');

      const bridge = createSDKBridge(mockSDK);
      const runner = createPhaseRunner(bridge, 5);

      // First use up the budget
      const config1: PhaseConfig = {
        name: 'phase1',
        promptPath,
        required: true
      };
      await runner.runPhase(config1);

      // Now try to run another phase - should fail on budget
      const config2: PhaseConfig = {
        name: 'phase2',
        promptPath,
        required: true
      };
      const result = await runner.runPhase(config2);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Budget');
    });

    it('should track budget usage', async () => {
      const mockSDK: ClaudeSDK = {
        executePrompt: vi.fn().mockResolvedValue({
          success: true,
          cost: 5
        })
      };

      const promptPath = path.join(tempDir, 'phase-prompt.txt');
      fs.writeFileSync(promptPath, 'Phase prompt');

      const bridge = createSDKBridge(mockSDK);
      const runner = createPhaseRunner(bridge, 100);

      const config: PhaseConfig = {
        name: 'test-phase',
        promptPath,
        required: true
      };

      await runner.runPhase(config);

      expect(runner.getUsedBudget()).toBe(5);
      expect(runner.getRemainingBudget()).toBe(95);
    });
  });
});
