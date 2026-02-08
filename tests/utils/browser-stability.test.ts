/**
 * Browser Stability utility tests
 */

import { describe, it, expect, vi } from 'vitest';
import {
  BrowserStabilityError,
  CircuitBreaker
} from '../../skill/utils/browser-stability';

describe('Browser Stability utilities', () => {
  describe('BrowserStabilityError', () => {
    it('should create error with cause', () => {
      const cause = new Error('original');
      const error = new BrowserStabilityError('wrapper', cause);

      expect(error.message).toBe('wrapper');
      expect(error.cause).toBe(cause);
      expect(error.name).toBe('BrowserStabilityError');
    });

    it('should default to recoverable true', () => {
      const error = new BrowserStabilityError('test');
      expect(error.recoverable).toBe(true);
    });

    it('should allow setting recoverable to false', () => {
      const error = new BrowserStabilityError('test', null, false);
      expect(error.recoverable).toBe(false);
    });

    it('should have null cause when not provided', () => {
      const error = new BrowserStabilityError('test');
      expect(error.cause).toBeNull();
    });
  });

  describe('CircuitBreaker', () => {
    it('should start closed', () => {
      const breaker = new CircuitBreaker();
      const state = breaker.getState();

      expect(state.state).toBe('closed');
      expect(state.can_attempt).toBe(true);
      expect(state.failures).toBe(0);
    });

    it('should open after threshold failures', () => {
      const breaker = new CircuitBreaker(3);

      breaker.recordFailure();
      expect(breaker.getState().failures).toBe(1);
      expect(breaker.isOpen()).toBe(false);

      breaker.recordFailure();
      expect(breaker.getState().failures).toBe(2);
      expect(breaker.isOpen()).toBe(false);

      breaker.recordFailure();
      expect(breaker.getState().failures).toBe(3);
      expect(breaker.isOpen()).toBe(true);
    });

    it('should reset on success', () => {
      const breaker = new CircuitBreaker(3);

      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState().failures).toBe(2);

      breaker.recordSuccess();

      const state = breaker.getState();
      expect(state.failures).toBe(0);
      expect(state.state).toBe('closed');
    });

    it('should use default threshold of 5', () => {
      const breaker = new CircuitBreaker();

      for (let i = 0; i < 4; i++) {
        breaker.recordFailure();
        expect(breaker.isOpen()).toBe(false);
      }

      breaker.recordFailure();
      expect(breaker.isOpen()).toBe(true);
    });

    it('should track state correctly', () => {
      const breaker = new CircuitBreaker(2);

      expect(breaker.getState().state).toBe('closed');

      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState().state).toBe('open');
    });

    it('should allow configuring threshold and timeout', () => {
      const breaker = new CircuitBreaker(1, 5000);

      breaker.recordFailure();
      expect(breaker.isOpen()).toBe(true);
    });

    it('should report can_attempt correctly', () => {
      const breaker = new CircuitBreaker(1);

      expect(breaker.getState().can_attempt).toBe(true);

      breaker.recordFailure();
      expect(breaker.getState().can_attempt).toBe(false);
    });

    it('should allow attempt after reset timeout', async () => {
      const breaker = new CircuitBreaker(1, 50); // 50ms reset timeout

      breaker.recordFailure();
      expect(breaker.isOpen()).toBe(true);

      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(breaker.isOpen()).toBe(false);
      expect(breaker.getState().state).toBe('half-open');
    });
  });
});
