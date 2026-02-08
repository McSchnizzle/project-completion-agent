/**
 * URL Canonicalizer tests
 */

import { describe, it, expect } from 'vitest';
import {
  canonicalizeUrl,
  generateRouteId,
  isSameRoute,
  getBaseUrl,
  isAllowedDomain
} from '../../skill/utils/url-canonicalizer';

describe('URL Canonicalizer', () => {
  describe('canonicalizeUrl', () => {
    it('should normalize URLs consistently', () => {
      const result = canonicalizeUrl('https://example.com/path');
      expect(result.canonical).toBeDefined();
      expect(result.original).toBe('https://example.com/path');
    });

    it('should remove trailing slashes', () => {
      const result = canonicalizeUrl('https://example.com/path/');
      expect(result.canonical).not.toContain('/path/');
    });

    it('should sort query parameters', () => {
      const result = canonicalizeUrl('https://example.com?b=2&a=1');
      expect(result.queryParams).toBeDefined();
    });

    it('should handle URLs without query params', () => {
      const result = canonicalizeUrl('https://example.com/path');
      expect(Object.keys(result.queryParams).length).toBe(0);
    });

    it('should detect route parameters', () => {
      const result = canonicalizeUrl('https://example.com/users/123/posts/456');
      expect(result.routePattern).toBeDefined();
      expect(result.params).toBeDefined();
    });
  });

  describe('generateRouteId', () => {
    it('should generate consistent IDs for same URLs', () => {
      const id1 = generateRouteId('https://example.com/path');
      const id2 = generateRouteId('https://example.com/path');
      expect(id1).toBe(id2);
    });

    it('should generate different IDs for different URLs', () => {
      const id1 = generateRouteId('https://example.com/path1');
      const id2 = generateRouteId('https://example.com/path2');
      expect(id1).not.toBe(id2);
    });
  });

  describe('isSameRoute', () => {
    it('should match identical URLs', () => {
      expect(isSameRoute(
        'https://example.com/path',
        'https://example.com/path'
      )).toBe(true);
    });

    it('should match URLs with different IDs', () => {
      expect(isSameRoute(
        'https://example.com/users/123',
        'https://example.com/users/456'
      )).toBe(true);
    });

    it('should not match different paths', () => {
      expect(isSameRoute(
        'https://example.com/users',
        'https://example.com/posts'
      )).toBe(false);
    });
  });

  describe('getBaseUrl', () => {
    it('should extract base URL without path', () => {
      const base = getBaseUrl('https://example.com/path/to/page');
      expect(base).toBe('https://example.com');
    });

    it('should handle URLs with ports', () => {
      const base = getBaseUrl('http://localhost:3000/path');
      expect(base).toBe('http://localhost:3000');
    });
  });

  describe('isAllowedDomain', () => {
    it('should allow same domain', () => {
      expect(isAllowedDomain(
        'https://example.com/path',
        'example.com'
      )).toBe(true);
    });

    it('should allow subdomains when enabled', () => {
      expect(isAllowedDomain(
        'https://cdn.example.com/asset',
        'example.com',
        true
      )).toBe(true);
    });

    it('should reject different domains', () => {
      expect(isAllowedDomain(
        'https://other.com/path',
        'example.com'
      )).toBe(false);
    });

    it('should reject subdomains when not enabled', () => {
      expect(isAllowedDomain(
        'https://cdn.example.com/asset',
        'example.com',
        false
      )).toBe(false);
    });
  });
});
