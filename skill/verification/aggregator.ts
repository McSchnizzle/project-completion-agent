/**
 * Finding Aggregator
 * Task 4.4: Finding Aggregation and Deduplication
 * Task 6.1: Schema Naming Alignment (snake_case)
 *
 * Collects findings from all stages, normalizes them,
 * removes duplicates, and prepares for verification.
 */

import { generateSignature, findDuplicates, FindingSignatureInput } from '../utils/signature';

export interface RawFinding {
  id?: string;
  source: string;
  type: string;
  severity: string;
  title?: string;
  message: string;
  file?: string;
  line?: number;
  url?: string;
  element?: string;
  evidence?: string;
  recommendation?: string;
  context?: unknown;
}

// Using snake_case to match JSON Schema requirements
export interface NormalizedFinding {
  schema_version: string;
  id: string;
  source: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  location: {
    file: string | null;
    line: number | null;
    url: string | null;
    selector: string | null;
  };
  evidence: {
    screenshot_id: string | null;
    code_snippet: string | null;
    expected: string | null;
    actual: string | null;
    steps_to_reproduce: string[];
  };
  verification: {
    required: boolean;
    method: 'file_check' | 'browser_repro' | 'manual' | 'none';
    status: string | null;
    attempts: Array<{
      attempt: number;
      reproduced: boolean;
      timestamp: string;
      error: string | null;
    }>;
  };
  signature: string;
  duplicate_of: string | null;
  recommendation: string | null;
  prd_feature_id: string | null;
  confidence: number;
  labels: string[];
  issue_number: number | null;
  created_at: string;
  updated_at: string;
}

export interface AggregationResult {
  findings: NormalizedFinding[];
  duplicate_groups: Map<string, string[]>;
  summary: {
    total_raw: number;
    total_after_dedup: number;
    duplicates_removed: number;
    by_severity: Record<string, number>;
    by_source: Record<string, number>;
    by_type: Record<string, number>;
  };
}

/**
 * Aggregate findings from multiple sources
 */
export function aggregateFindings(
  rawFindings: RawFinding[],
  options: {
    startingId?: number;
    idPrefix?: string;
  } = {}
): AggregationResult {
  const { startingId = 1, idPrefix = 'finding' } = options;

  const normalized: NormalizedFinding[] = [];
  const signatureMap = new Map<string, NormalizedFinding>();
  let idCounter = startingId;

  // First pass: normalize all findings
  for (const raw of rawFindings) {
    const finding = normalizeFinding(raw, `${idPrefix}-${String(idCounter).padStart(3, '0')}`);
    idCounter++;

    // Check for duplicates by signature
    const existing = signatureMap.get(finding.signature);
    if (existing) {
      // Mark as duplicate of the first occurrence
      finding.duplicate_of = existing.id;
    } else {
      signatureMap.set(finding.signature, finding);
    }

    normalized.push(finding);
  }

  // Get unique findings (excluding duplicates)
  const uniqueFindings = normalized.filter(f => f.duplicate_of === null);

  // Find duplicate groups
  const duplicateGroups = findDuplicates(
    normalized.map(f => ({ signature: f.signature, id: f.id }))
  );

  // Build summary
  const summary = buildSummary(uniqueFindings, normalized.length, duplicateGroups.size);

  return {
    findings: uniqueFindings,
    duplicate_groups: duplicateGroups,
    summary
  };
}

/**
 * Normalize a raw finding to standard format
 */
function normalizeFinding(raw: RawFinding, id: string): NormalizedFinding {
  const signatureInput: FindingSignatureInput = {
    type: raw.type,
    file: raw.file,
    line: raw.line,
    url: raw.url,
    element: raw.element,
    message: raw.message
  };

  const { signature } = generateSignature(signatureInput);
  const now = new Date().toISOString();

  // Determine verification method based on finding type
  const verificationMethod = determineVerificationMethod(raw);

  return {
    schema_version: '1.0.0',
    id,
    source: raw.source,
    type: raw.type,
    severity: normalizeSeverity(raw.severity),
    title: raw.title || formatTitle(raw.type),
    description: raw.message,
    location: {
      file: raw.file || null,
      line: raw.line || null,
      url: raw.url || null,
      selector: raw.element || null
    },
    evidence: {
      screenshot_id: null,
      code_snippet: raw.evidence || null,
      expected: null,
      actual: null,
      steps_to_reproduce: []
    },
    verification: {
      required: verificationMethod !== 'none',
      method: verificationMethod,
      status: null,
      attempts: []
    },
    signature,
    duplicate_of: null,
    recommendation: raw.recommendation || null,
    prd_feature_id: null,
    confidence: 80, // Default confidence
    labels: [],
    issue_number: null,
    created_at: now,
    updated_at: now
  };
}

/**
 * Determine verification method for a finding
 */
function determineVerificationMethod(raw: RawFinding): 'file_check' | 'browser_repro' | 'manual' | 'none' {
  // Static analysis findings use file_check
  const staticTypes = [
    'todo', 'fixme', 'hack', 'console_log', 'unused_export',
    'unused_import', 'high_complexity', 'large_file', 'deep_nesting',
    'commented_code', 'hardcoded_secret', 'circular_dependency',
    'god_file', 'orphan_file'
  ];

  if (staticTypes.includes(raw.type)) {
    return 'file_check';
  }

  // Browser findings use browser_repro
  if (raw.url) {
    return 'browser_repro';
  }

  // Security findings may need manual verification
  const manualTypes = ['missing_auth', 'cors_misconfiguration', 'insecure_dependency'];
  if (manualTypes.includes(raw.type)) {
    return 'manual';
  }

  return 'none';
}

/**
 * Normalize severity levels
 */
function normalizeSeverity(severity: string): string {
  const upper = severity.toUpperCase();

  // Handle various severity formats
  const mappings: Record<string, string> = {
    'CRITICAL': 'P0',
    'HIGH': 'P1',
    'MEDIUM': 'P2',
    'LOW': 'P3',
    'INFO': 'P4',
    'INFORMATIONAL': 'P4',
    'WARNING': 'P3',
    'ERROR': 'P1'
  };

  if (mappings[upper]) {
    return mappings[upper];
  }

  // Already in P0-P4 format
  if (/^P[0-4]$/.test(upper)) {
    return upper;
  }

  // Default to P3 for unknown
  return 'P3';
}

/**
 * Format finding type as human-readable title
 */
function formatTitle(type: string): string {
  const titles: Record<string, string> = {
    // Code quality
    'todo': 'TODO Comment Found',
    'fixme': 'FIXME Comment Found',
    'hack': 'HACK Comment Found',
    'console_log': 'Console Statement in Code',
    'unused_export': 'Unused Export',
    'unused_import': 'Unused Import',
    'high_complexity': 'High Complexity Function',
    'large_file': 'Large File',
    'deep_nesting': 'Deep Nesting',
    'commented_code': 'Commented Code Block',

    // Security
    'hardcoded_secret': 'Hardcoded Secret',
    'sql_injection': 'Potential SQL Injection',
    'xss_vulnerability': 'Potential XSS Vulnerability',
    'cors_misconfiguration': 'CORS Misconfiguration',
    'missing_auth': 'Missing Authentication',
    'exposed_env': 'Exposed Environment File',
    'insecure_dependency': 'Vulnerable Dependency',

    // Architecture
    'circular_dependency': 'Circular Dependency',
    'god_file': 'God File',
    'orphan_file': 'Orphan File',
    'missing_error_boundary': 'Missing Error Boundary',
    'pattern_violation': 'Architecture Pattern Violation',

    // UI/UX
    'missing_validation': 'Missing Form Validation',
    'overflow': 'Layout Overflow',
    'small_text': 'Text Too Small',
    'touch_target': 'Touch Target Too Small',
    'navigation_hidden': 'Navigation Not Accessible',

    // Requirements
    'missing_requirement': 'Missing Requirement',
    'partial_requirement': 'Partially Implemented Requirement'
  };

  return titles[type] || type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Build aggregation summary
 */
function buildSummary(
  uniqueFindings: NormalizedFinding[],
  totalRaw: number,
  duplicateGroups: number
): AggregationResult['summary'] {
  const by_severity: Record<string, number> = {};
  const by_source: Record<string, number> = {};
  const by_type: Record<string, number> = {};

  for (const finding of uniqueFindings) {
    // By severity
    by_severity[finding.severity] = (by_severity[finding.severity] || 0) + 1;

    // By source
    by_source[finding.source] = (by_source[finding.source] || 0) + 1;

    // By type
    by_type[finding.type] = (by_type[finding.type] || 0) + 1;
  }

  return {
    total_raw: totalRaw,
    total_after_dedup: uniqueFindings.length,
    duplicates_removed: totalRaw - uniqueFindings.length,
    by_severity,
    by_source,
    by_type
  };
}

/**
 * Merge findings from previous audit (for delta detection)
 */
export function mergeWithPreviousAudit(
  currentFindings: NormalizedFinding[],
  previousFindings: NormalizedFinding[]
): {
  new_findings: NormalizedFinding[];
  fixed_findings: NormalizedFinding[];
  persistent_findings: NormalizedFinding[];
} {
  const previousSignatures = new Set(previousFindings.map(f => f.signature));
  const currentSignatures = new Set(currentFindings.map(f => f.signature));

  const new_findings = currentFindings.filter(f => !previousSignatures.has(f.signature));
  const fixed_findings = previousFindings.filter(f => !currentSignatures.has(f.signature));
  const persistent_findings = currentFindings.filter(f => previousSignatures.has(f.signature));

  return { new_findings, fixed_findings, persistent_findings };
}

/**
 * Group findings by category for reporting
 */
export function groupByCategory(findings: NormalizedFinding[]): Map<string, NormalizedFinding[]> {
  const categories: Record<string, string[]> = {
    'Security': ['hardcoded_secret', 'sql_injection', 'xss_vulnerability', 'cors_misconfiguration', 'missing_auth', 'exposed_env', 'insecure_dependency'],
    'Code Quality': ['todo', 'fixme', 'hack', 'console_log', 'unused_export', 'unused_import', 'high_complexity', 'large_file', 'deep_nesting', 'commented_code'],
    'Architecture': ['circular_dependency', 'god_file', 'orphan_file', 'missing_error_boundary', 'pattern_violation'],
    'UI/UX': ['missing_validation', 'overflow', 'small_text', 'touch_target', 'navigation_hidden', 'layout_break'],
    'Requirements': ['missing_requirement', 'partial_requirement']
  };

  const grouped = new Map<string, NormalizedFinding[]>();

  for (const [category, types] of Object.entries(categories)) {
    const categoryFindings = findings.filter(f => types.includes(f.type));
    if (categoryFindings.length > 0) {
      grouped.set(category, categoryFindings);
    }
  }

  // Handle uncategorized
  const categorizedTypes = Object.values(categories).flat();
  const uncategorized = findings.filter(f => !categorizedTypes.includes(f.type));
  if (uncategorized.length > 0) {
    grouped.set('Other', uncategorized);
  }

  return grouped;
}

/**
 * Prioritize findings for verification
 */
export function prioritizeForVerification(findings: NormalizedFinding[]): NormalizedFinding[] {
  // Sort by severity (P0 first) then by type priority
  const typePriority: Record<string, number> = {
    'hardcoded_secret': 1,
    'sql_injection': 1,
    'xss_vulnerability': 2,
    'missing_auth': 2,
    'missing_validation': 3
  };

  return [...findings].sort((a, b) => {
    // First by severity
    const sevDiff = parseInt(a.severity.slice(1)) - parseInt(b.severity.slice(1));
    if (sevDiff !== 0) return sevDiff;

    // Then by type priority
    const aPriority = typePriority[a.type] || 10;
    const bPriority = typePriority[b.type] || 10;
    return aPriority - bPriority;
  });
}
