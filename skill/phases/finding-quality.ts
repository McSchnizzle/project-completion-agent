/**
 * Finding Quality Phase - Finding Validation and Deduplication
 * Task B.8: Finding Quality
 *
 * Critiques findings for quality, deduplicates similar findings,
 * checks for existing GitHub issues, and enforces evidence requirements.
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateSignature, isDuplicate, FindingSignature } from '../utils/signature';

export interface Finding {
  id: string;
  title: string;
  description: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  category: string;
  source: string;
  url: string | null;
  file_path: string | null;
  line_number: number | null;
  evidence: FindingEvidence[];
  reproduction_steps: string[];
  created_at: string;
  confidence: number;
  verification_status: 'unverified' | 'verified' | 'flaky' | 'false-positive';
}

export interface FindingEvidence {
  type: 'screenshot' | 'code-snippet' | 'console-log' | 'network-request' | 'dom-snapshot';
  description: string;
  data: string;
  timestamp: string;
}

export interface CritiqueResult {
  finding_id: string;
  quality_score: number;
  issues: QualityIssue[];
  recommendations: string[];
  should_include: boolean;
  improved_title: string | null;
  improved_description: string | null;
}

export interface QualityIssue {
  type: 'missing-evidence' | 'vague-description' | 'missing-steps' | 'low-confidence' | 'duplicate-likely' | 'invalid-severity';
  severity: 'warning' | 'error';
  message: string;
}

export interface ExistingIssue {
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed';
  labels: string[];
  created_at: string;
  similarity_score: number;
}

export interface RepoInfo {
  owner: string;
  repo: string;
}

export interface EvidenceCheck {
  valid: boolean;
  missing: string[];
  warnings: string[];
}

/**
 * Critique a finding for quality
 */
export function critiqueFinding(finding: Finding): CritiqueResult {
  const issues: QualityIssue[] = [];
  const recommendations: string[] = [];
  let qualityScore = 100;

  // Check for evidence
  if (finding.evidence.length === 0) {
    issues.push({
      type: 'missing-evidence',
      severity: 'error',
      message: 'Finding has no evidence attached'
    });
    qualityScore -= 30;
    recommendations.push('Add at least one piece of evidence (screenshot, code snippet, or log)');
  }

  // Check for reproduction steps
  if (finding.reproduction_steps.length === 0) {
    issues.push({
      type: 'missing-steps',
      severity: 'warning',
      message: 'No reproduction steps provided'
    });
    qualityScore -= 15;
    recommendations.push('Add step-by-step reproduction instructions');
  } else if (finding.reproduction_steps.length < 3) {
    issues.push({
      type: 'missing-steps',
      severity: 'warning',
      message: 'Reproduction steps may be incomplete'
    });
    qualityScore -= 5;
  }

  // Check description quality
  if (finding.description.length < 50) {
    issues.push({
      type: 'vague-description',
      severity: 'warning',
      message: 'Description is too short to be actionable'
    });
    qualityScore -= 10;
    recommendations.push('Expand the description with more context and expected vs actual behavior');
  }

  // Check confidence
  if (finding.confidence < 0.5) {
    issues.push({
      type: 'low-confidence',
      severity: 'warning',
      message: `Low confidence score: ${Math.round(finding.confidence * 100)}%`
    });
    qualityScore -= 15;
    recommendations.push('Consider verifying this finding manually before reporting');
  }

  // Check severity validity
  const validSeverities = ['P0', 'P1', 'P2', 'P3', 'P4'];
  if (!validSeverities.includes(finding.severity)) {
    issues.push({
      type: 'invalid-severity',
      severity: 'error',
      message: `Invalid severity: ${finding.severity}`
    });
    qualityScore -= 20;
  }

  // Check for location info
  if (!finding.url && !finding.file_path) {
    qualityScore -= 10;
    recommendations.push('Add URL or file path to help locate the issue');
  }

  // Generate improved title if needed
  let improvedTitle: string | null = null;
  if (finding.title.length < 20 || finding.title.length > 100) {
    improvedTitle = generateImprovedTitle(finding);
  }

  // Generate improved description if needed
  let improvedDescription: string | null = null;
  if (finding.description.length < 50) {
    improvedDescription = generateImprovedDescription(finding);
  }

  return {
    finding_id: finding.id,
    quality_score: Math.max(0, qualityScore),
    issues,
    recommendations,
    should_include: qualityScore >= 40 && issues.filter(i => i.severity === 'error').length === 0,
    improved_title: improvedTitle,
    improved_description: improvedDescription
  };
}

/**
 * Generate improved title for a finding
 */
function generateImprovedTitle(finding: Finding): string {
  const category = finding.category.replace(/-/g, ' ');
  const location = finding.url
    ? new URL(finding.url).pathname
    : finding.file_path
      ? path.basename(finding.file_path)
      : '';

  return `[${finding.severity}] ${category}: ${finding.title.substring(0, 50)}${location ? ` (${location})` : ''}`;
}

/**
 * Generate improved description for a finding
 */
function generateImprovedDescription(finding: Finding): string {
  const parts: string[] = [];

  parts.push(`## Description\n${finding.description}`);

  if (finding.url) {
    parts.push(`\n## Location\nURL: ${finding.url}`);
  }
  if (finding.file_path) {
    parts.push(`File: ${finding.file_path}${finding.line_number ? `:${finding.line_number}` : ''}`);
  }

  if (finding.reproduction_steps.length > 0) {
    parts.push(`\n## Reproduction Steps\n${finding.reproduction_steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
  }

  return parts.join('\n');
}

/**
 * Deduplicate findings based on signatures
 */
export function deduplicateFindings(findings: Finding[]): Finding[] {
  const uniqueFindings: Finding[] = [];
  const signatures = new Map<string, Finding>();

  for (const finding of findings) {
    const sig = generateSignature({
      type: finding.category,
      url: finding.url || undefined,
      file: finding.file_path || undefined,
      line: finding.line_number || undefined,
      message: finding.title + finding.description
    });

    const sigKey = sig.signature;

    if (!signatures.has(sigKey)) {
      signatures.set(sigKey, finding);
      uniqueFindings.push(finding);
    } else {
      // Merge evidence from duplicate
      const existing = signatures.get(sigKey)!;
      existing.evidence.push(...finding.evidence);

      // Keep higher confidence
      if (finding.confidence > existing.confidence) {
        existing.confidence = finding.confidence;
      }
    }
  }

  return uniqueFindings;
}

/**
 * Simple string hash function
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

/**
 * Check for existing GitHub issues that might be duplicates
 */
export async function checkGitHubDuplicates(
  finding: Finding,
  repoInfo: RepoInfo,
  existingIssues: ExistingIssue[]
): Promise<ExistingIssue | null> {
  const titleWords = finding.title.toLowerCase().split(/\W+/).filter(w => w.length > 3);

  for (const issue of existingIssues) {
    const issueWords = issue.title.toLowerCase().split(/\W+/).filter(w => w.length > 3);

    // Calculate similarity based on word overlap
    const commonWords = titleWords.filter(w => issueWords.includes(w));
    const similarity = commonWords.length / Math.max(titleWords.length, issueWords.length);

    if (similarity >= 0.5) {
      return {
        ...issue,
        similarity_score: similarity
      };
    }
  }

  return null;
}

/**
 * Fetch existing issues from GitHub (to be called with gh CLI output)
 */
export function parseGitHubIssues(ghOutput: string): ExistingIssue[] {
  const issues: ExistingIssue[] = [];

  try {
    const parsed = JSON.parse(ghOutput);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        issues.push({
          number: item.number,
          title: item.title,
          url: item.url || item.html_url,
          state: item.state,
          labels: item.labels?.map((l: any) => l.name || l) || [],
          created_at: item.created_at,
          similarity_score: 0
        });
      }
    }
  } catch {
    // Invalid JSON, return empty
  }

  return issues;
}

/**
 * Enforce evidence requirements
 */
export function enforceEvidence(finding: Finding): EvidenceCheck {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Browser-testable findings should have screenshots
  const browserCategories = ['ui', 'ux', 'responsive', 'accessibility', 'form-validation'];
  if (browserCategories.some(c => finding.category.toLowerCase().includes(c))) {
    if (!finding.evidence.some(e => e.type === 'screenshot')) {
      missing.push('screenshot');
    }
  }

  // Code findings should have code snippets
  const codeCategories = ['code-quality', 'security', 'architecture'];
  if (codeCategories.some(c => finding.category.toLowerCase().includes(c))) {
    if (!finding.evidence.some(e => e.type === 'code-snippet')) {
      warnings.push('Code snippet would strengthen this finding');
    }
  }

  // API findings should have network evidence
  if (finding.category.toLowerCase().includes('api')) {
    if (!finding.evidence.some(e => e.type === 'network-request')) {
      warnings.push('Network request/response data would help debug this issue');
    }
  }

  // All findings should have reproduction steps
  if (finding.reproduction_steps.length === 0) {
    missing.push('reproduction_steps');
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings
  };
}

/**
 * Filter findings by minimum quality score
 */
export function filterByQuality(findings: Finding[], minScore: number = 50): Finding[] {
  return findings.filter(f => {
    const critique = critiqueFinding(f);
    return critique.quality_score >= minScore;
  });
}

/**
 * Group findings by category
 */
export function groupFindingsByCategory(findings: Finding[]): Map<string, Finding[]> {
  const groups = new Map<string, Finding[]>();

  for (const finding of findings) {
    const category = finding.category;
    if (!groups.has(category)) {
      groups.set(category, []);
    }
    groups.get(category)!.push(finding);
  }

  return groups;
}

/**
 * Sort findings by severity and confidence
 */
export function sortFindings(findings: Finding[]): Finding[] {
  const severityOrder = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };

  return [...findings].sort((a, b) => {
    // First by severity
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;

    // Then by confidence (higher first)
    return b.confidence - a.confidence;
  });
}

/**
 * Generate quality report
 */
export function generateQualityReport(findings: Finding[]): string {
  const lines: string[] = [];
  const critiques = findings.map(f => ({ finding: f, critique: critiqueFinding(f) }));

  lines.push('## Finding Quality Report');
  lines.push('');

  // Summary
  const avgScore = critiques.reduce((sum, c) => sum + c.critique.quality_score, 0) / critiques.length;
  const passCount = critiques.filter(c => c.critique.should_include).length;

  lines.push(`**Total Findings:** ${findings.length}`);
  lines.push(`**Average Quality Score:** ${Math.round(avgScore)}%`);
  lines.push(`**Pass Quality Gate:** ${passCount}/${findings.length}`);
  lines.push('');

  // Issues by type
  const issuesByType = new Map<string, number>();
  for (const c of critiques) {
    for (const issue of c.critique.issues) {
      issuesByType.set(issue.type, (issuesByType.get(issue.type) || 0) + 1);
    }
  }

  if (issuesByType.size > 0) {
    lines.push('### Quality Issues');
    lines.push('');
    for (const [type, count] of issuesByType) {
      lines.push(`- ${type}: ${count}`);
    }
    lines.push('');
  }

  // Findings needing attention
  const lowQuality = critiques.filter(c => c.critique.quality_score < 50);
  if (lowQuality.length > 0) {
    lines.push('### Findings Needing Attention');
    lines.push('');
    for (const { finding, critique } of lowQuality) {
      lines.push(`- **${finding.title}** (Score: ${critique.quality_score}%)`);
      for (const rec of critique.recommendations) {
        lines.push(`  - ${rec}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Write quality report to file
 */
export function writeQualityReport(auditPath: string, findings: Finding[]): void {
  const reportPath = path.join(auditPath, 'quality-report.md');
  fs.writeFileSync(reportPath, generateQualityReport(findings));
}
