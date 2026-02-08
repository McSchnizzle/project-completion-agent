/**
 * PRD Parser - Product Requirements Document Analysis
 * Task 6.7: PRD Comparison Logic
 *
 * Parses PRD/planning documents to extract features, requirements,
 * and acceptance criteria for comparison against actual implementation.
 */

import * as fs from 'fs';
import * as path from 'path';

// Using snake_case to match schema conventions
export interface PrdFeature {
  id: string;
  name: string;
  description: string;
  requirements: PrdRequirement[];
  acceptance_criteria: string[];
  priority: 'must-have' | 'should-have' | 'nice-to-have' | 'unknown';
  status: 'not-checked' | 'implemented' | 'partial' | 'missing';
  evidence: ImplementationEvidence[];
}

export interface PrdRequirement {
  id: string;
  text: string;
  type: 'functional' | 'non-functional' | 'constraint' | 'assumption';
  verified: boolean;
  verification_notes: string | null;
}

export interface ImplementationEvidence {
  type: 'ui-element' | 'api-endpoint' | 'code-reference' | 'test-result';
  location: string;
  description: string;
  matches_requirement: boolean;
}

export interface ParsedPrd {
  source_file: string;
  title: string;
  version: string | null;
  parsed_at: string;
  features: PrdFeature[];
  global_requirements: PrdRequirement[];
  raw_sections: PrdSection[];
}

export interface PrdSection {
  heading: string;
  level: number;
  content: string;
  line_start: number;
  line_end: number;
}

export interface PrdComparisonResult {
  prd_source: string;
  comparison_date: string;
  total_features: number;
  implemented: number;
  partial: number;
  missing: number;
  coverage_percent: number;
  feature_results: FeatureComparisonResult[];
  unmatched_routes: string[];
  recommendations: string[];
}

export interface FeatureComparisonResult {
  feature_id: string;
  feature_name: string;
  status: 'implemented' | 'partial' | 'missing';
  requirements_met: number;
  requirements_total: number;
  missing_requirements: string[];
  evidence: ImplementationEvidence[];
}

/**
 * Parse a PRD markdown file into structured features
 */
export function parsePrdDocument(filePath: string): ParsedPrd {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const prd: ParsedPrd = {
    source_file: filePath,
    title: extractTitle(lines),
    version: extractVersion(content),
    parsed_at: new Date().toISOString(),
    features: [],
    global_requirements: [],
    raw_sections: []
  };

  // Extract sections by headings
  prd.raw_sections = extractSections(lines);

  // Parse features from sections
  prd.features = extractFeatures(prd.raw_sections, content);

  // Extract global requirements (not tied to specific features)
  prd.global_requirements = extractGlobalRequirements(prd.raw_sections);

  return prd;
}

/**
 * Extract document title from first H1
 */
function extractTitle(lines: string[]): string {
  for (const line of lines) {
    const match = line.match(/^#\s+(.+)$/);
    if (match) {
      return match[1].trim();
    }
  }
  return 'Untitled PRD';
}

/**
 * Extract version from common patterns
 */
function extractVersion(content: string): string | null {
  const patterns = [
    /version:\s*([0-9.]+)/i,
    /v([0-9.]+)/i,
    /\[version\s+([0-9.]+)\]/i
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

/**
 * Extract sections based on markdown headings
 */
function extractSections(lines: string[]): PrdSection[] {
  const sections: PrdSection[] = [];
  let currentSection: PrdSection | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      // Save previous section
      if (currentSection) {
        currentSection.line_end = i - 1;
        sections.push(currentSection);
      }

      // Start new section
      currentSection = {
        heading: headingMatch[2].trim(),
        level: headingMatch[1].length,
        content: '',
        line_start: i,
        line_end: i
      };
    } else if (currentSection) {
      currentSection.content += line + '\n';
    }
  }

  // Save last section
  if (currentSection) {
    currentSection.line_end = lines.length - 1;
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Extract features from sections
 */
function extractFeatures(sections: PrdSection[], fullContent: string): PrdFeature[] {
  const features: PrdFeature[] = [];
  const featureKeywords = ['feature', 'functionality', 'capability', 'module', 'component'];

  for (const section of sections) {
    const headingLower = section.heading.toLowerCase();

    // Check if this section describes a feature
    const isFeatureSection = featureKeywords.some(kw => headingLower.includes(kw)) ||
      section.level === 2; // H2s often represent features

    if (isFeatureSection && section.content.trim()) {
      const feature: PrdFeature = {
        id: generateFeatureId(section.heading),
        name: section.heading,
        description: extractDescription(section.content),
        requirements: extractRequirements(section.content),
        acceptance_criteria: extractAcceptanceCriteria(section.content),
        priority: inferPriority(section.content),
        status: 'not-checked',
        evidence: []
      };

      if (feature.requirements.length > 0 || feature.acceptance_criteria.length > 0) {
        features.push(feature);
      }
    }
  }

  return features;
}

/**
 * Generate a unique feature ID from heading
 */
function generateFeatureId(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

/**
 * Extract description from content (first paragraph)
 */
function extractDescription(content: string): string {
  const lines = content.trim().split('\n');
  const descriptionLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('-') || line.startsWith('*') || line.startsWith('#') || line.trim() === '') {
      if (descriptionLines.length > 0) break;
      continue;
    }
    descriptionLines.push(line);
  }

  return descriptionLines.join(' ').trim() || 'No description provided';
}

/**
 * Extract requirements from content
 */
function extractRequirements(content: string): PrdRequirement[] {
  const requirements: PrdRequirement[] = [];
  const lines = content.split('\n');

  let reqCounter = 1;

  for (const line of lines) {
    // Match bullet points that look like requirements
    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      const text = bulletMatch[1].trim();

      // Skip if it looks like an acceptance criterion
      if (text.toLowerCase().startsWith('given') ||
          text.toLowerCase().startsWith('when') ||
          text.toLowerCase().startsWith('then')) {
        continue;
      }

      requirements.push({
        id: `req-${reqCounter++}`,
        text,
        type: inferRequirementType(text),
        verified: false,
        verification_notes: null
      });
    }

    // Match numbered lists
    const numberedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (numberedMatch) {
      requirements.push({
        id: `req-${reqCounter++}`,
        text: numberedMatch[1].trim(),
        type: inferRequirementType(numberedMatch[1]),
        verified: false,
        verification_notes: null
      });
    }
  }

  return requirements;
}

/**
 * Infer requirement type from text
 */
function inferRequirementType(text: string): PrdRequirement['type'] {
  const lower = text.toLowerCase();

  if (lower.includes('must') || lower.includes('shall') || lower.includes('will')) {
    return 'functional';
  }
  if (lower.includes('performance') || lower.includes('security') || lower.includes('scalab')) {
    return 'non-functional';
  }
  if (lower.includes('constraint') || lower.includes('limit') || lower.includes('restrict')) {
    return 'constraint';
  }
  if (lower.includes('assume') || lower.includes('expect')) {
    return 'assumption';
  }

  return 'functional';
}

/**
 * Extract acceptance criteria (often Gherkin-style)
 */
function extractAcceptanceCriteria(content: string): string[] {
  const criteria: string[] = [];
  const lines = content.split('\n');

  let inCriteriaSection = false;
  let currentCriterion = '';

  for (const line of lines) {
    const lower = line.toLowerCase().trim();

    // Check for acceptance criteria section
    if (lower.includes('acceptance criteria') || lower.includes('acceptance test')) {
      inCriteriaSection = true;
      continue;
    }

    // Gherkin-style criteria
    if (lower.startsWith('given') || lower.startsWith('when') || lower.startsWith('then')) {
      if (currentCriterion && lower.startsWith('given')) {
        criteria.push(currentCriterion.trim());
        currentCriterion = '';
      }
      currentCriterion += line.trim() + ' ';
    } else if (inCriteriaSection && line.trim().startsWith('-')) {
      // Bullet point criteria
      criteria.push(line.replace(/^[-*]\s+/, '').trim());
    }
  }

  if (currentCriterion) {
    criteria.push(currentCriterion.trim());
  }

  return criteria;
}

/**
 * Infer priority from content
 */
function inferPriority(content: string): PrdFeature['priority'] {
  const lower = content.toLowerCase();

  if (lower.includes('must have') || lower.includes('p0') || lower.includes('critical')) {
    return 'must-have';
  }
  if (lower.includes('should have') || lower.includes('p1') || lower.includes('important')) {
    return 'should-have';
  }
  if (lower.includes('nice to have') || lower.includes('p2') || lower.includes('optional')) {
    return 'nice-to-have';
  }

  return 'unknown';
}

/**
 * Extract global requirements not tied to features
 */
function extractGlobalRequirements(sections: PrdSection[]): PrdRequirement[] {
  const requirements: PrdRequirement[] = [];
  const globalKeywords = ['requirement', 'constraint', 'assumption', 'dependency', 'overview'];

  for (const section of sections) {
    const headingLower = section.heading.toLowerCase();

    if (globalKeywords.some(kw => headingLower.includes(kw))) {
      requirements.push(...extractRequirements(section.content));
    }
  }

  return requirements;
}

/**
 * Compare parsed PRD against discovered routes and findings
 */
export function comparePrdToImplementation(
  prd: ParsedPrd,
  discoveredRoutes: string[],
  uiElements: Map<string, string[]>,
  apiEndpoints: string[]
): PrdComparisonResult {
  const featureResults: FeatureComparisonResult[] = [];
  const matchedRoutes = new Set<string>();

  for (const feature of prd.features) {
    const result = compareFeature(feature, discoveredRoutes, uiElements, apiEndpoints);
    featureResults.push(result);

    // Track which routes matched
    for (const evidence of result.evidence) {
      if (evidence.type === 'ui-element' || evidence.type === 'api-endpoint') {
        matchedRoutes.add(evidence.location);
      }
    }
  }

  // Find unmatched routes
  const unmatchedRoutes = discoveredRoutes.filter(r => !matchedRoutes.has(r));

  // Calculate totals
  const implemented = featureResults.filter(r => r.status === 'implemented').length;
  const partial = featureResults.filter(r => r.status === 'partial').length;
  const missing = featureResults.filter(r => r.status === 'missing').length;

  return {
    prd_source: prd.source_file,
    comparison_date: new Date().toISOString(),
    total_features: prd.features.length,
    implemented,
    partial,
    missing,
    coverage_percent: prd.features.length > 0
      ? Math.round((implemented + partial * 0.5) / prd.features.length * 100)
      : 100,
    feature_results: featureResults,
    unmatched_routes: unmatchedRoutes,
    recommendations: generateRecommendations(featureResults, unmatchedRoutes)
  };
}

/**
 * Compare a single feature against implementation
 */
function compareFeature(
  feature: PrdFeature,
  routes: string[],
  uiElements: Map<string, string[]>,
  apiEndpoints: string[]
): FeatureComparisonResult {
  const evidence: ImplementationEvidence[] = [];
  const keywords = extractKeywords(feature.name, feature.description);

  // Search for matching routes
  for (const route of routes) {
    if (keywordsMatch(keywords, route)) {
      evidence.push({
        type: 'ui-element',
        location: route,
        description: `Route matches feature keywords`,
        matches_requirement: true
      });
    }
  }

  // Search for matching API endpoints
  for (const endpoint of apiEndpoints) {
    if (keywordsMatch(keywords, endpoint)) {
      evidence.push({
        type: 'api-endpoint',
        location: endpoint,
        description: `API endpoint matches feature keywords`,
        matches_requirement: true
      });
    }
  }

  // Search for matching UI elements
  for (const [route, elements] of uiElements) {
    for (const element of elements) {
      if (keywordsMatch(keywords, element)) {
        evidence.push({
          type: 'ui-element',
          location: `${route} - ${element}`,
          description: `UI element matches feature keywords`,
          matches_requirement: true
        });
      }
    }
  }

  // Determine status based on evidence
  const requirementsMet = Math.min(evidence.length, feature.requirements.length);
  let status: FeatureComparisonResult['status'] = 'missing';

  if (evidence.length >= feature.requirements.length && feature.requirements.length > 0) {
    status = 'implemented';
  } else if (evidence.length > 0) {
    status = 'partial';
  }

  // Find missing requirements
  const missingRequirements = feature.requirements
    .slice(evidence.length)
    .map(r => r.text);

  return {
    feature_id: feature.id,
    feature_name: feature.name,
    status,
    requirements_met: requirementsMet,
    requirements_total: feature.requirements.length,
    missing_requirements: missingRequirements,
    evidence
  };
}

/**
 * Extract keywords from feature name and description
 */
function extractKeywords(name: string, description: string): string[] {
  const text = `${name} ${description}`.toLowerCase();
  const words = text.split(/\W+/).filter(w => w.length > 3);

  // Filter out common stop words
  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'will',
    'should', 'must', 'shall', 'can', 'could', 'would', 'user', 'users',
    'system', 'application', 'feature', 'functionality'
  ]);

  return [...new Set(words.filter(w => !stopWords.has(w)))];
}

/**
 * Check if keywords match a string
 */
function keywordsMatch(keywords: string[], text: string): boolean {
  const lower = text.toLowerCase();
  const matchCount = keywords.filter(kw => lower.includes(kw)).length;
  return matchCount >= Math.ceil(keywords.length * 0.3); // 30% match threshold
}

/**
 * Generate recommendations based on comparison results
 */
function generateRecommendations(
  featureResults: FeatureComparisonResult[],
  unmatchedRoutes: string[]
): string[] {
  const recommendations: string[] = [];

  // Missing features
  const missing = featureResults.filter(r => r.status === 'missing');
  if (missing.length > 0) {
    recommendations.push(
      `${missing.length} features appear to be missing implementation. ` +
      `Review: ${missing.map(f => f.feature_name).join(', ')}`
    );
  }

  // Partial features
  const partial = featureResults.filter(r => r.status === 'partial');
  if (partial.length > 0) {
    recommendations.push(
      `${partial.length} features are partially implemented. ` +
      `Complete: ${partial.map(f => f.feature_name).join(', ')}`
    );
  }

  // Unmatched routes
  if (unmatchedRoutes.length > 5) {
    recommendations.push(
      `${unmatchedRoutes.length} routes don't map to PRD features. ` +
      `Consider documenting or removing undocumented functionality.`
    );
  }

  return recommendations;
}

/**
 * Find PRD files in common locations
 */
export function findPrdFiles(projectRoot: string): string[] {
  const prdFiles: string[] = [];
  const searchPaths = [
    'PRD.md',
    'prd.md',
    'docs/PRD.md',
    'docs/prd.md',
    'docs/requirements.md',
    'docs/spec.md',
    'planning/PRD.md',
    'planning/requirements.md',
    '.claude/product-requirements.md',
    'REQUIREMENTS.md'
  ];

  for (const searchPath of searchPaths) {
    const fullPath = path.join(projectRoot, searchPath);
    if (fs.existsSync(fullPath)) {
      prdFiles.push(fullPath);
    }
  }

  return prdFiles;
}

/**
 * PRD Summary JSON structure (schema-compliant)
 */
export interface PrdSummaryJson {
  schema_version: string;
  source_file: string;
  title: string;
  parsed_at: string;
  features: PrdFeatureSummary[];
  total_features: number;
  total_requirements: number;
  coverage_summary: {
    implemented: number;
    partial: number;
    missing: number;
    not_checked: number;
  };
}

export interface PrdFeatureSummary {
  id: string;
  numeric_id: string;  // F1, F2, etc.
  name: string;
  description: string;
  priority: string;
  status: string;
  requirements_count: number;
  acceptance_criteria_count: number;
}

let featureCounter = 0;

/**
 * Generate schema-compliant PRD summary JSON
 */
export function generatePrdSummaryJson(prd: ParsedPrd): PrdSummaryJson {
  featureCounter = 0;

  const features: PrdFeatureSummary[] = prd.features.map(f => ({
    id: f.id,
    numeric_id: `F${++featureCounter}`,
    name: f.name,
    description: f.description.substring(0, 200) + (f.description.length > 200 ? '...' : ''),
    priority: f.priority,
    status: f.status,
    requirements_count: f.requirements.length,
    acceptance_criteria_count: f.acceptance_criteria.length
  }));

  const coverageSummary = {
    implemented: prd.features.filter(f => f.status === 'implemented').length,
    partial: prd.features.filter(f => f.status === 'partial').length,
    missing: prd.features.filter(f => f.status === 'missing').length,
    not_checked: prd.features.filter(f => f.status === 'not-checked').length
  };

  return {
    schema_version: '1.0.0',
    source_file: prd.source_file,
    title: prd.title,
    parsed_at: prd.parsed_at,
    features,
    total_features: prd.features.length,
    total_requirements: prd.features.reduce((sum, f) => sum + f.requirements.length, 0) + prd.global_requirements.length,
    coverage_summary: coverageSummary
  };
}

/**
 * Update feature status after implementation check
 */
export function updateFeatureStatus(
  prd: ParsedPrd,
  featureId: string,
  status: PrdFeature['status'],
  evidence?: ImplementationEvidence[]
): ParsedPrd {
  const updatedFeatures = prd.features.map(f => {
    if (f.id === featureId) {
      return {
        ...f,
        status,
        evidence: evidence || f.evidence
      };
    }
    return f;
  });

  return {
    ...prd,
    features: updatedFeatures
  };
}

/**
 * Write PRD summary to file
 */
export function writePrdSummary(auditPath: string, prd: ParsedPrd): void {
  const summary = generatePrdSummaryJson(prd);
  const outputPath = path.join(auditPath, 'prd-summary.json');
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));
}

/**
 * Load PRD summary from file
 */
export function loadPrdSummary(auditPath: string): PrdSummaryJson | null {
  const summaryPath = path.join(auditPath, 'prd-summary.json');
  if (!fs.existsSync(summaryPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(summaryPath, 'utf-8');
    return JSON.parse(content) as PrdSummaryJson;
  } catch {
    return null;
  }
}

/**
 * Get features by status
 */
export function getFeaturesByStatus(prd: ParsedPrd, status: PrdFeature['status']): PrdFeature[] {
  return prd.features.filter(f => f.status === status);
}

/**
 * Get high-priority missing features
 */
export function getMissingHighPriorityFeatures(prd: ParsedPrd): PrdFeature[] {
  return prd.features.filter(f =>
    (f.status === 'missing' || f.status === 'not-checked') &&
    (f.priority === 'must-have' || f.priority === 'should-have')
  );
}
