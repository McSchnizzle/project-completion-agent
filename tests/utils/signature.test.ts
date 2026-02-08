/**
 * Signature utility tests
 */

import { describe, it, expect } from 'vitest';
import {
  generateSignature,
  isDuplicate,
  signatureToId,
  findDuplicates
} from '../../skill/utils/signature';

describe('Signature utilities', () => {
  describe('generateSignature', () => {
    it('should generate consistent signatures for same input', () => {
      const input = {
        type: 'security',
        file: 'app.ts',
        line: 42,
        message: 'Potential XSS vulnerability'
      };

      const sig1 = generateSignature(input);
      const sig2 = generateSignature(input);

      expect(sig1.signature).toBe(sig2.signature);
    });

    it('should generate different signatures for different inputs', () => {
      const sig1 = generateSignature({
        type: 'security',
        message: 'XSS vulnerability detected'
      });

      const sig2 = generateSignature({
        type: 'quality',
        message: 'Unused variable warning'
      });

      expect(sig1.signature).not.toBe(sig2.signature);
    });

    it('should include all input fields in signature', () => {
      const input = {
        type: 'ui',
        url: 'https://example.com/page',
        element: 'button.submit',
        message: 'Button not accessible'
      };

      const sig = generateSignature(input);
      expect(sig.signature).toBeDefined();
      expect(sig.signature.length).toBeGreaterThan(0);
    });
  });

  describe('isDuplicate', () => {
    it('should detect duplicate signatures', () => {
      const sig1 = generateSignature({
        type: 'security',
        message: 'Same issue'
      });

      const sig2 = generateSignature({
        type: 'security',
        message: 'Same issue'
      });

      // isDuplicate expects signature strings
      expect(isDuplicate(sig1.signature, sig2.signature)).toBe(true);
    });

    it('should not detect non-duplicates', () => {
      const sig1 = generateSignature({
        type: 'security',
        message: 'XSS vulnerability found'
      });

      const sig2 = generateSignature({
        type: 'security',
        message: 'SQL injection risk'
      });

      expect(isDuplicate(sig1.signature, sig2.signature)).toBe(false);
    });
  });

  describe('signatureToId', () => {
    it('should convert signature to readable ID', () => {
      const sig = generateSignature({
        type: 'security',
        message: 'Test issue'
      });

      // signatureToId expects the signature string, not the object
      const id = signatureToId(sig.signature);
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });
  });

  describe('findDuplicates', () => {
    it('should find duplicate signatures in array', () => {
      const sig1 = generateSignature({ type: 'a', message: 'msg1' });
      const sig2 = generateSignature({ type: 'b', message: 'msg2' });
      const sig3 = generateSignature({ type: 'a', message: 'msg1' }); // duplicate
      const sig4 = generateSignature({ type: 'c', message: 'msg3' });

      const findings = [
        { signature: sig1.signature, id: 'f1' },
        { signature: sig2.signature, id: 'f2' },
        { signature: sig3.signature, id: 'f3' }, // duplicate of f1
        { signature: sig4.signature, id: 'f4' }
      ];

      const duplicates = findDuplicates(findings);
      expect(duplicates.size).toBeGreaterThan(0);
    });

    it('should return empty map when no duplicates', () => {
      const sig1 = generateSignature({ type: 'a', message: 'msg1' });
      const sig2 = generateSignature({ type: 'b', message: 'msg2' });
      const sig3 = generateSignature({ type: 'c', message: 'msg3' });

      const findings = [
        { signature: sig1.signature, id: 'f1' },
        { signature: sig2.signature, id: 'f2' },
        { signature: sig3.signature, id: 'f3' }
      ];

      const duplicates = findDuplicates(findings);
      expect(duplicates.size).toBe(0);
    });
  });
});
