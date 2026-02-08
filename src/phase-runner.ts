/**
 * Phase Runner - Foundation Module
 *
 * Orchestrates execution of audit phases using SDK bridge.
 * Handles validation, budget checks, and phase coordination.
 */

import { SDKBridge, SDKResponse } from './sdk-bridge';

export interface PhaseConfig {
  name: string;
  promptPath: string;
  required: boolean;
  maxBudget?: number;
  validationRules?: ValidationRule[];
  retryOnValidationFailure?: boolean;
}

export interface ValidationRule {
  name: string;
  validate: (output: string) => boolean;
  errorMessage: string;
}

export interface PhaseResult {
  name: string;
  success: boolean;
  output?: string;
  cost: number;
  duration: number;
  validationPassed: boolean;
  validationErrors?: string[];
  error?: string;
}

export class PhaseRunner {
  private sdkBridge: SDKBridge;
  private totalBudget: number;
  private usedBudget: number = 0;

  constructor(sdkBridge: SDKBridge, totalBudget: number = Infinity) {
    this.sdkBridge = sdkBridge;
    this.totalBudget = totalBudget;
  }

  /**
   * Run a single phase
   */
  async runPhase(
    config: PhaseConfig,
    context: Record<string, any> = {}
  ): Promise<PhaseResult> {
    const startTime = Date.now();

    // Check budget
    if (this.usedBudget >= this.totalBudget) {
      return {
        name: config.name,
        success: false,
        cost: 0,
        duration: 0,
        validationPassed: false,
        error: 'Budget exceeded'
      };
    }

    // Check phase-specific budget
    const phaseBudget = config.maxBudget ?? this.totalBudget - this.usedBudget;
    if (phaseBudget <= 0) {
      return {
        name: config.name,
        success: false,
        cost: 0,
        duration: 0,
        validationPassed: false,
        error: 'Insufficient budget for phase'
      };
    }

    let attempts = 0;
    const maxAttempts = config.retryOnValidationFailure ? 3 : 1;

    while (attempts < maxAttempts) {
      attempts++;

      // Execute phase
      const response: SDKResponse = await this.sdkBridge.runClaudePhase(
        config.promptPath,
        context
      );

      const phaseCost = response.cost ?? 0;
      this.usedBudget += phaseCost;

      if (!response.success) {
        return {
          name: config.name,
          success: false,
          cost: phaseCost,
          duration: Date.now() - startTime,
          validationPassed: false,
          error: response.error || 'Phase execution failed'
        };
      }

      // Validate output
      const validationResult = this.validateOutput(
        response.output || '',
        config.validationRules || []
      );

      if (validationResult.passed || attempts >= maxAttempts) {
        return {
          name: config.name,
          success: response.success && validationResult.passed,
          output: response.output,
          cost: phaseCost,
          duration: Date.now() - startTime,
          validationPassed: validationResult.passed,
          validationErrors: validationResult.errors.length > 0
            ? validationResult.errors
            : undefined
        };
      }

      // Validation failed, retry with validation errors in context
      context.validationErrors = validationResult.errors;
    }

    // Should not reach here, but just in case
    return {
      name: config.name,
      success: false,
      cost: this.sdkBridge.getTotalCost(),
      duration: Date.now() - startTime,
      validationPassed: false,
      error: 'Max validation retries exceeded'
    };
  }

  /**
   * Validate phase output
   */
  private validateOutput(
    output: string,
    rules: ValidationRule[]
  ): { passed: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const rule of rules) {
      try {
        if (!rule.validate(output)) {
          errors.push(rule.errorMessage);
        }
      } catch (error) {
        errors.push(`Validation error in rule '${rule.name}': ${error}`);
      }
    }

    return {
      passed: errors.length === 0,
      errors
    };
  }

  /**
   * Get used budget
   */
  getUsedBudget(): number {
    return this.usedBudget;
  }

  /**
   * Get remaining budget
   */
  getRemainingBudget(): number {
    return Math.max(0, this.totalBudget - this.usedBudget);
  }
}

/**
 * Factory function to create phase runner
 */
export function createPhaseRunner(
  sdkBridge: SDKBridge,
  totalBudget?: number
): PhaseRunner {
  return new PhaseRunner(sdkBridge, totalBudget);
}
