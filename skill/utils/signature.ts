/**
 * Finding Signature Generator
 * Task 1.5: Finding Signature Generation
 *
 * Creates unique, stable signatures for findings to enable:
 * - Deduplication within and across audits
 * - Tracking fix status over time
 * - Comparing findings between runs
 */

import * as crypto from 'crypto';

export interface FindingSignatureInput {
  type: string;
  file?: string;
  line?: number;
  url?: string;
  element?: string;
  message: string;
}

export interface FindingSignature {
  signature: string;
  normalized: {
    type: string;
    location: string;
    message: string;
  };
}

/**
 * Generate a stable signature for a finding
 *
 * The signature is based on:
 * 1. Finding type (e.g., 'todo', 'xss_vulnerability', 'missing_validation')
 * 2. Normalized location (file:line or url#element)
 * 3. Normalized message (lowercase, stripped of dynamic content)
 */
export function generateSignature(input: FindingSignatureInput): FindingSignature {
  const normalizedType = normalizeType(input.type);
  const normalizedLocation = normalizeLocation(input);
  const normalizedMessage = normalizeMessage(input.message);

  const signatureInput = [
    normalizedType,
    normalizedLocation,
    normalizedMessage
  ].join('|');

  const hash = crypto.createHash('sha256');
  hash.update(signatureInput);
  const signature = hash.digest('hex').substring(0, 16);

  return {
    signature,
    normalized: {
      type: normalizedType,
      location: normalizedLocation,
      message: normalizedMessage
    }
  };
}

/**
 * Normalize finding type to consistent format
 */
function normalizeType(type: string): string {
  return type.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

/**
 * Normalize location to consistent format
 * - Code findings: file:line (relative path)
 * - UI findings: url#element (canonical URL with element selector)
 */
function normalizeLocation(input: FindingSignatureInput): string {
  if (input.file) {
    // Code-based finding
    const relativePath = normalizeFilePath(input.file);
    if (input.line) {
      return `${relativePath}:${input.line}`;
    }
    return relativePath;
  }

  if (input.url) {
    // UI-based finding
    const canonicalUrl = normalizeUrl(input.url);
    if (input.element) {
      return `${canonicalUrl}#${normalizeSelector(input.element)}`;
    }
    return canonicalUrl;
  }

  return 'unknown';
}

/**
 * Normalize file path (remove absolute prefix, normalize separators)
 */
function normalizeFilePath(filePath: string): string {
  // Remove common absolute path prefixes
  let normalized = filePath
    .replace(/^\/Users\/[^/]+\//, '~/')
    .replace(/^\/home\/[^/]+\//, '~/')
    .replace(/^[A-Z]:\\Users\\[^\\]+\\/, '~/')
    .replace(/\\/g, '/');

  // Remove node_modules prefix variants
  const nodeModulesMatch = normalized.match(/node_modules\/(.+)/);
  if (nodeModulesMatch) {
    normalized = 'node_modules/' + nodeModulesMatch[1];
  }

  return normalized;
}

/**
 * Normalize URL (remove dynamic query params, normalize protocol)
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);

    // Keep only path, remove dynamic params
    const path = parsed.pathname.replace(/\/+$/, '') || '/';

    // Remove known dynamic query params
    const staticParams = new URLSearchParams();
    const dynamicParamPatterns = [
      /^_/, // Next.js params
      /^utm_/, // Analytics
      /^fbclid$/, // Facebook
      /^gclid$/, // Google
      /^timestamp$/,
      /^t$/,
      /^v$/
    ];

    for (const [key, value] of parsed.searchParams.entries()) {
      const isDynamic = dynamicParamPatterns.some(p => p.test(key));
      if (!isDynamic) {
        staticParams.set(key, value);
      }
    }

    const queryString = staticParams.toString();
    return path + (queryString ? '?' + queryString : '');
  } catch {
    return url;
  }
}

/**
 * Normalize CSS selector (simplify complex selectors)
 */
function normalizeSelector(selector: string): string {
  // Remove dynamic parts like :nth-child(n) indexes
  return selector
    .replace(/:nth-child\(\d+\)/g, ':nth-child(n)')
    .replace(/:nth-of-type\(\d+\)/g, ':nth-of-type(n)')
    .replace(/\[data-testid="[^"]+"\]/g, '[data-testid]')
    .replace(/\[id="[^"]+"\]/g, '[id]')
    .toLowerCase()
    .trim();
}

/**
 * Normalize message (strip dynamic content, lowercase)
 */
function normalizeMessage(message: string): string {
  return message
    .toLowerCase()
    // Remove quotes content
    .replace(/"[^"]*"/g, '""')
    .replace(/'[^']*'/g, "''")
    // Remove numbers (IDs, counts)
    .replace(/\b\d+\b/g, 'N')
    // Remove UUIDs
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, 'UUID')
    // Remove file paths
    .replace(/\/[\w/.-]+\.(js|ts|tsx|jsx|json|md)/g, 'FILE')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if two findings are duplicates based on signature
 */
export function isDuplicate(sig1: string, sig2: string): boolean {
  return sig1 === sig2;
}

/**
 * Create a finding ID from signature
 */
export function signatureToId(signature: string, prefix: string = 'finding'): string {
  // Use first 6 chars of signature as the numeric-like ID
  const numericPart = parseInt(signature.substring(0, 6), 16) % 1000;
  return `${prefix}-${numericPart.toString().padStart(3, '0')}`;
}

/**
 * Batch check for duplicates in a list of findings
 */
export function findDuplicates(
  findings: Array<{ signature: string; id: string }>
): Map<string, string[]> {
  const signatureGroups = new Map<string, string[]>();

  for (const finding of findings) {
    const existing = signatureGroups.get(finding.signature);
    if (existing) {
      existing.push(finding.id);
    } else {
      signatureGroups.set(finding.signature, [finding.id]);
    }
  }

  // Filter to only groups with duplicates
  const duplicates = new Map<string, string[]>();
  for (const [sig, ids] of signatureGroups) {
    if (ids.length > 1) {
      duplicates.set(sig, ids);
    }
  }

  return duplicates;
}

/**
 * Compare findings across two audits
 */
export function compareFindings(
  previousSignatures: Set<string>,
  currentSignatures: Set<string>
): {
  new: string[];
  fixed: string[];
  persistent: string[];
} {
  const newFindings: string[] = [];
  const fixedFindings: string[] = [];
  const persistentFindings: string[] = [];

  // Find new findings (in current but not previous)
  for (const sig of currentSignatures) {
    if (previousSignatures.has(sig)) {
      persistentFindings.push(sig);
    } else {
      newFindings.push(sig);
    }
  }

  // Find fixed findings (in previous but not current)
  for (const sig of previousSignatures) {
    if (!currentSignatures.has(sig)) {
      fixedFindings.push(sig);
    }
  }

  return {
    new: newFindings,
    fixed: fixedFindings,
    persistent: persistentFindings
  };
}
