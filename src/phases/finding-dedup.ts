/**
 * Finding Deduplication
 * Task T-031: Finding Deduplication
 *
 * Deduplicates findings using signature-based matching and checks for
 * existing GitHub issues that match findings.
 */

import { generateSignature, FindingSignatureInput } from '../../skill/utils/signature';
import { execSync } from 'child_process';

/**
 * Result of deduplication operation
 */
export interface DeduplicationResult {
  unique: Record<string, unknown>[];
  duplicates: {
    original: Record<string, unknown>;
    duplicate: Record<string, unknown>;
  }[];
  stats: {
    totalInput: number;
    uniqueOutput: number;
    duplicatesRemoved: number;
  };
}

/**
 * Internal structure for tracking findings during deduplication
 */
interface FindingWithSignature {
  finding: Record<string, unknown>;
  signature: string;
  confidence: number;
  detailScore: number;
}

/**
 * Main deduplication function
 *
 * Takes a list of findings and returns deduplicated results using signature-based matching.
 * For each group of duplicates, keeps the finding with highest confidence/detail.
 *
 * @param findings - Array of finding objects
 * @returns Deduplication result with unique findings, duplicates, and stats
 */
export function deduplicateFindings(findings: Record<string, unknown>[]): DeduplicationResult {
  const totalInput = findings.length;

  // Generate signatures for all findings
  const findingsWithSignatures: FindingWithSignature[] = findings.map(finding => {
    const signatureInput = createSignatureInput(finding);
    const { signature } = generateSignature(signatureInput);
    const confidence = extractConfidence(finding);
    const detailScore = calculateDetailScore(finding);

    return {
      finding,
      signature,
      confidence,
      detailScore
    };
  });

  // Group by signature
  const signatureGroups = new Map<string, FindingWithSignature[]>();
  for (const item of findingsWithSignatures) {
    const existing = signatureGroups.get(item.signature);
    if (existing) {
      existing.push(item);
    } else {
      signatureGroups.set(item.signature, [item]);
    }
  }

  // Process each group
  const uniqueFindings: Record<string, unknown>[] = [];
  const duplicatePairs: { original: Record<string, unknown>; duplicate: Record<string, unknown> }[] = [];

  for (const group of signatureGroups.values()) {
    if (group.length === 1) {
      // No duplicates for this signature
      uniqueFindings.push(group[0].finding);
    } else {
      // Multiple findings with same signature - pick the best one
      const sorted = group.sort((a, b) => {
        // First sort by confidence
        if (a.confidence !== b.confidence) {
          return b.confidence - a.confidence;
        }
        // Then by detail score
        return b.detailScore - a.detailScore;
      });

      const best = sorted[0];
      uniqueFindings.push(best.finding);

      // Mark others as duplicates
      for (let i = 1; i < sorted.length; i++) {
        duplicatePairs.push({
          original: best.finding,
          duplicate: sorted[i].finding
        });
      }
    }
  }

  return {
    unique: uniqueFindings,
    duplicates: duplicatePairs,
    stats: {
      totalInput,
      uniqueOutput: uniqueFindings.length,
      duplicatesRemoved: duplicatePairs.length
    }
  };
}

/**
 * Check for existing GitHub issues that match findings
 *
 * Uses gh CLI if available to search for existing issues matching finding titles.
 * Returns a map of finding ID to GitHub issue URL for matches.
 *
 * @param findings - Array of finding objects
 * @returns Map of finding ID to issue URL
 */
export async function checkGitHubIssues(
  findings: Record<string, unknown>[]
): Promise<Map<string, string>> {
  const matchMap = new Map<string, string>();

  // Check if gh CLI is available
  if (!isGhCliAvailable()) {
    return matchMap;
  }

  for (const finding of findings) {
    const findingId = extractFindingId(finding);
    const title = extractTitle(finding);

    if (!findingId || !title) {
      continue;
    }

    try {
      // Search for issues matching the title
      const searchQuery = title.substring(0, 100); // Limit search query length
      const result = execSync(
        `gh issue list --search "${escapeShellArg(searchQuery)}" --json number,title,url --limit 5`,
        {
          encoding: 'utf-8',
          timeout: 5000,
          stdio: ['ignore', 'pipe', 'ignore']
        }
      );

      const issues = JSON.parse(result) as Array<{
        number: number;
        title: string;
        url: string;
      }>;

      // Check if any issue is a close match
      for (const issue of issues) {
        if (isTitleMatch(title, issue.title)) {
          matchMap.set(findingId, issue.url);
          break;
        }
      }
    } catch (error) {
      // Ignore errors - gh CLI might fail for various reasons
      // (no repo, no auth, no network, etc.)
      continue;
    }
  }

  return matchMap;
}

/**
 * Create signature input from a finding object
 */
function createSignatureInput(finding: Record<string, unknown>): FindingSignatureInput {
  const location = finding.location as Record<string, unknown> | undefined;

  return {
    type: String(finding.type || finding.category || 'unknown'),
    file: location?.file ? String(location.file) : undefined,
    line: location?.line ? Number(location.line) : undefined,
    url: location?.url ? String(location.url) : undefined,
    element: location?.selector ? String(location.selector) : undefined,
    message: String(finding.title || finding.description || '')
  };
}

/**
 * Extract confidence score from finding
 */
function extractConfidence(finding: Record<string, unknown>): number {
  if (typeof finding.confidence === 'number') {
    return finding.confidence;
  }
  // Default confidence based on verification status
  const status = String(finding.verification_status || 'unverified');
  if (status === 'verified') return 90;
  if (status === 'flaky') return 50;
  if (status === 'false-positive') return 0;
  return 70; // Default for unverified
}

/**
 * Calculate detail score based on how much information the finding contains
 */
function calculateDetailScore(finding: Record<string, unknown>): number {
  let score = 0;

  // Evidence adds points
  const evidence = finding.evidence;
  if (Array.isArray(evidence)) {
    score += evidence.length * 10;
  }

  // Reproduction steps add points
  const steps = finding.reproduction_steps || finding.steps_to_reproduce;
  if (Array.isArray(steps)) {
    score += steps.length * 5;
  }

  // Code snippet adds points
  const codeSnippet = (finding.evidence as Record<string, unknown>)?.code_snippet;
  if (codeSnippet && String(codeSnippet).length > 0) {
    score += 15;
  }

  // Screenshot adds points
  const screenshot = (finding.evidence as Record<string, unknown>)?.screenshot_id;
  if (screenshot) {
    score += 10;
  }

  // Description length matters
  const description = String(finding.description || '');
  if (description.length > 100) {
    score += 10;
  }

  return score;
}

/**
 * Check if gh CLI is available
 */
function isGhCliAvailable(): boolean {
  try {
    execSync('gh --version', {
      stdio: 'ignore',
      timeout: 2000
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract finding ID from finding object
 */
function extractFindingId(finding: Record<string, unknown>): string | null {
  const id = finding.id || finding.finding_id || finding.findingId;
  return id ? String(id) : null;
}

/**
 * Extract title from finding object
 */
function extractTitle(finding: Record<string, unknown>): string | null {
  const title = finding.title;
  return title ? String(title) : null;
}

/**
 * Escape shell argument for safe command execution
 */
function escapeShellArg(arg: string): string {
  // Replace quotes and special characters
  return arg.replace(/["'`$\\]/g, '\\$&');
}

/**
 * Check if two titles match (fuzzy matching)
 */
function isTitleMatch(title1: string, title2: string): boolean {
  const normalized1 = normalizeTitle(title1);
  const normalized2 = normalizeTitle(title2);

  // Exact match after normalization
  if (normalized1 === normalized2) {
    return true;
  }

  // Check if one contains the other (for partial matches)
  if (normalized1.length > 20 && normalized2.length > 20) {
    return normalized1.includes(normalized2) || normalized2.includes(normalized1);
  }

  return false;
}

/**
 * Normalize title for matching
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
