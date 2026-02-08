/**
 * PRD Parsing Phase - Pure TypeScript PRD document parser.
 *
 * Extracts structured features, flows, acceptance criteria, and scope
 * boundaries from markdown PRD documents without requiring an LLM call.
 * Produces prd-summary.json matching the phase-1 schema.
 *
 * @module phases/prd-parsing
 */

import fs from 'node:fs';
import path from 'node:path';
import { getPrdSummaryPath } from '../artifact-paths.js';

// ---------------------------------------------------------------------------
// Types (matching the prd-summary.json schema from phase-1 prompt)
// ---------------------------------------------------------------------------

export interface PrdFeature {
  id: string;
  name: string;
  description: string;
  priority: 'must' | 'should' | 'could';
  acceptance_criteria: string[];
  status: 'not_tested' | 'tested' | 'passed' | 'failed';
  /** URL route hints extracted from acceptance criteria (e.g., "/settings", "/dashboard"). */
  routeHints: string[];
  /** Keywords extracted from name and description for page matching. */
  keywords: string[];
}

export interface PrdFlow {
  id: string;
  name: string;
  steps: string[];
  status: 'not_tested' | 'tested' | 'passed' | 'failed';
}

export interface PrdSummary {
  schema_version: string;
  prd_file: string | null;
  parsed_at: string;
  features: PrdFeature[];
  flows: PrdFlow[];
  out_of_scope: string[];
  deferred: string[];
  summary: {
    total_features: number;
    total_flows: number;
    must_have: number;
    should_have: number;
    could_have: number;
  };
  notes?: string;
}

/** Internal representation of a markdown section. */
interface MdSection {
  heading: string;
  level: number;
  content: string;
  lineStart: number;
  lineEnd: number;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Parse a PRD markdown file and produce a structured summary.
 *
 * If `prdPath` is null or points to a missing file, an empty summary is
 * returned with a note explaining the situation.
 *
 * @param prdPath  - Absolute path to the PRD markdown file (or null).
 * @param auditDir - The audit output directory where prd-summary.json is written.
 * @returns The parsed PRD summary.
 */
export function parsePrd(prdPath: string | null | undefined, auditDir: string): PrdSummary {
  if (!prdPath || !fs.existsSync(prdPath)) {
    const empty = emptyPrdSummary(prdPath ?? null);
    writePrdSummary(auditDir, empty);
    return empty;
  }

  const content = fs.readFileSync(prdPath, 'utf-8');
  const sections = extractSections(content);

  const features = extractFeatures(sections);
  const flows = extractFlows(sections);
  const outOfScope = extractOutOfScope(sections);
  const deferred = extractDeferred(sections);

  const summary: PrdSummary = {
    schema_version: '1.0',
    prd_file: prdPath,
    parsed_at: new Date().toISOString(),
    features,
    flows,
    out_of_scope: outOfScope,
    deferred,
    summary: {
      total_features: features.length,
      total_flows: flows.length,
      must_have: features.filter((f) => f.priority === 'must').length,
      should_have: features.filter((f) => f.priority === 'should').length,
      could_have: features.filter((f) => f.priority === 'could').length,
    },
  };

  writePrdSummary(auditDir, summary);
  return summary;
}

// ---------------------------------------------------------------------------
// Section extraction
// ---------------------------------------------------------------------------

/**
 * Split markdown content into sections keyed by headings.
 */
function extractSections(content: string): MdSection[] {
  const lines = content.split('\n');
  const sections: MdSection[] = [];
  let current: MdSection | null = null;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      if (current) {
        current.lineEnd = i - 1;
        sections.push(current);
      }
      current = {
        heading: match[2].trim(),
        level: match[1].length,
        content: '',
        lineStart: i,
        lineEnd: i,
      };
    } else if (current) {
      current.content += lines[i] + '\n';
    }
  }

  if (current) {
    current.lineEnd = lines.length - 1;
    sections.push(current);
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Feature extraction
// ---------------------------------------------------------------------------

/**
 * Extract features from H2/H3 sections that describe user-facing functionality.
 */
function extractFeatures(sections: MdSection[]): PrdFeature[] {
  const features: PrdFeature[] = [];
  let featureCounter = 0;

  // Sections whose headings suggest scope/non-feature content
  const excludeHeadings = /\b(overview|introduction|background|roadmap|deployment|hosting|technical|stack|schema|implementation|appendix|changelog|history|out.of.scope|non.goal|future|deferred|phase\s+\d)/i;
  const flowHeadings = /\b(flow|process|workflow|journey|step|procedure)\b/i;

  for (const section of sections) {
    // Only H2 and H3 sections that are not meta sections
    if (section.level < 2 || section.level > 3) continue;
    if (excludeHeadings.test(section.heading)) continue;
    if (flowHeadings.test(section.heading)) continue;
    if (!section.content.trim()) continue;

    const bullets = extractBullets(section.content);
    if (bullets.length === 0) continue;

    featureCounter++;
    const priority = inferPriority(section.content);
    const criteria = extractAcceptanceCriteria(section.content, bullets);

    const name = cleanHeading(section.heading);
    const description = buildDescription(section.content);
    const acceptanceCriteria = criteria.length > 0 ? criteria : bullets.slice(0, 5);

    features.push({
      id: `F${featureCounter}`,
      name,
      description,
      priority,
      acceptance_criteria: acceptanceCriteria,
      status: 'not_tested',
      routeHints: extractRouteHintsFromText(
        [description, ...acceptanceCriteria].join('\n'),
      ),
      keywords: extractKeywordsFromText(`${name} ${description}`),
    });
  }

  return features;
}

// ---------------------------------------------------------------------------
// Flow extraction
// ---------------------------------------------------------------------------

/**
 * Extract user flows from sections that describe step-by-step processes.
 */
function extractFlows(sections: MdSection[]): PrdFlow[] {
  const flows: PrdFlow[] = [];
  let flowCounter = 0;

  const flowHeadings = /\b(flow|process|workflow|journey|step|procedure|roadmap|implementation|phase\s*\d)\b/i;

  for (const section of sections) {
    if (section.level < 2 || section.level > 3) continue;
    if (!flowHeadings.test(section.heading)) continue;
    if (!section.content.trim()) continue;

    const steps = extractNumberedSteps(section.content);
    if (steps.length === 0) continue;

    flowCounter++;
    flows.push({
      id: `FL${flowCounter}`,
      name: cleanHeading(section.heading),
      steps,
      status: 'not_tested',
    });
  }

  return flows;
}

// ---------------------------------------------------------------------------
// Scope extraction
// ---------------------------------------------------------------------------

/**
 * Extract out-of-scope items.
 */
function extractOutOfScope(sections: MdSection[]): string[] {
  const keywords = /\b(out.of.scope|not.included|excluded|non.goal)\b/i;
  return extractScopeItems(sections, keywords);
}

/**
 * Extract deferred items.
 */
function extractDeferred(sections: MdSection[]): string[] {
  const keywords = /\b(deferred|backlog|later|post.mvp|post.launch|future|phase\s+[2-9]|v\d+\.\d+)/i;
  return extractScopeItems(sections, keywords);
}

function extractScopeItems(sections: MdSection[], headingPattern: RegExp): string[] {
  const items: string[] = [];

  for (const section of sections) {
    if (!headingPattern.test(section.heading)) continue;
    const bullets = extractBullets(section.content);
    items.push(...bullets);
  }

  return items;
}

// ---------------------------------------------------------------------------
// Content helpers
// ---------------------------------------------------------------------------

/** Extract bullet-point items from section content. */
function extractBullets(content: string): string[] {
  const bullets: string[] = [];
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*[-*]\s+\*{0,2}(.+?)\*{0,2}\s*$/);
    if (m) {
      const text = m[1].replace(/\*{1,2}/g, '').trim();
      if (text.length > 5) {
        bullets.push(text);
      }
    }
  }
  return bullets;
}

/** Extract numbered steps from section content. */
function extractNumberedSteps(content: string): string[] {
  const steps: string[] = [];
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*\d+\.\s+(.+)$/);
    if (m) {
      steps.push(m[1].trim());
    }
  }
  return steps;
}

/** Infer priority from text content. */
function inferPriority(content: string): PrdFeature['priority'] {
  const lower = content.toLowerCase();
  if (/\b(must|required|critical|shall)\b/.test(lower)) return 'must';
  if (/\b(should|recommended|important)\b/.test(lower)) return 'should';
  if (/\b(could|nice.to.have|optional|may)\b/.test(lower)) return 'could';
  return 'must'; // default per spec
}

/** Extract acceptance criteria from content. */
function extractAcceptanceCriteria(content: string, bullets: string[]): string[] {
  const criteria: string[] = [];
  const lines = content.split('\n');

  let inCriteriaSection = false;
  for (const line of lines) {
    const lower = line.toLowerCase().trim();
    if (/acceptance.criteria|success.criteria|definition.of.done/i.test(lower)) {
      inCriteriaSection = true;
      continue;
    }
    if (inCriteriaSection) {
      const m = line.match(/^\s*[-*]\s+(.+)$/);
      if (m) {
        criteria.push(m[1].trim());
      } else if (/^#{1,6}\s/.test(line)) {
        inCriteriaSection = false;
      }
    }
  }

  // Also pick up Gherkin-style criteria
  for (const line of lines) {
    const lower = line.trim().toLowerCase();
    if (/^(given|when|then)\b/.test(lower)) {
      criteria.push(line.trim());
    }
  }

  return criteria;
}

/** Clean heading by removing numbering prefixes. */
function cleanHeading(heading: string): string {
  return heading.replace(/^\d+(\.\d+)*\s+/, '').trim();
}

/** Build a short description from the first non-bullet paragraph. */
function buildDescription(content: string): string {
  const lines = content.trim().split('\n');
  const descParts: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (descParts.length > 0) break;
      continue;
    }
    if (/^[-*#\d]/.test(trimmed)) {
      if (descParts.length > 0) break;
      continue;
    }
    descParts.push(trimmed);
  }

  // If no paragraph text, use first bullet
  if (descParts.length === 0) {
    const bullets = extractBullets(content);
    return bullets[0] ?? '';
  }

  return descParts.join(' ');
}

// ---------------------------------------------------------------------------
// Route hint & keyword extraction (for feature-to-page mapping)
// ---------------------------------------------------------------------------

/** Stop words excluded from keyword extraction. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'must', 'need', 'not', 'no',
  'all', 'each', 'every', 'any', 'some', 'this', 'that', 'these', 'those',
  'it', 'its', 'as', 'if', 'when', 'then', 'than', 'so', 'up', 'out',
  'about', 'into', 'over', 'after', 'before', 'between', 'under', 'above',
  'user', 'users', 'able', 'also', 'feature', 'page', 'view',
]);

/**
 * Extract URL route hints from text (e.g., "/settings", "/dashboard").
 */
function extractRouteHintsFromText(text: string): string[] {
  const routes: string[] = [];
  const routeRegex = /(?:^|\s|["'`(])(\/[a-z][a-z0-9-/]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = routeRegex.exec(text)) !== null) {
    const route = match[1].toLowerCase();
    if (!route.startsWith('/n') || route.length > 3) {
      routes.push(route);
    }
  }
  return [...new Set(routes)];
}

/**
 * Extract meaningful keywords from text for page matching.
 */
function extractKeywordsFromText(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return [...new Set(words)];
}

// ---------------------------------------------------------------------------
// Empty summary
// ---------------------------------------------------------------------------

function emptyPrdSummary(prdFile: string | null): PrdSummary {
  return {
    schema_version: '1.0',
    prd_file: prdFile,
    parsed_at: new Date().toISOString(),
    features: [],
    flows: [],
    out_of_scope: [],
    deferred: [],
    summary: {
      total_features: 0,
      total_flows: 0,
      must_have: 0,
      should_have: 0,
      could_have: 0,
    },
    notes: 'No PRD provided - code-only analysis. Features will be inferred from code.',
  };
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

/**
 * Write the PRD summary to disk atomically (write-then-rename).
 */
function writePrdSummary(auditDir: string, summary: PrdSummary): void {
  const outPath = getPrdSummaryPath(auditDir);
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = outPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(summary, null, 2), 'utf-8');
  fs.renameSync(tmpPath, outPath);
}

/**
 * Load a previously written PRD summary from the audit directory.
 */
export function loadPrdSummary(auditDir: string): PrdSummary | null {
  const summaryPath = getPrdSummaryPath(auditDir);
  if (!fs.existsSync(summaryPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as PrdSummary;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// PRD file discovery
// ---------------------------------------------------------------------------

/**
 * Search common locations for PRD files.
 */
export function discoverPrdFiles(projectRoot: string): string[] {
  const candidates = [
    'PRD.md', 'prd.md', 'REQUIREMENTS.md', 'requirements.md',
    'docs/PRD.md', 'docs/prd.md', 'docs/requirements.md', 'docs/spec.md',
    'planning/PRD.md', 'planning/requirements.md',
    '.claude/product-requirements.md',
  ];

  const found: string[] = [];
  for (const candidate of candidates) {
    const full = path.join(projectRoot, candidate);
    if (fs.existsSync(full)) {
      found.push(full);
    }
  }

  // Also search for any file matching *prd*.md in docs/
  const docsDir = path.join(projectRoot, 'docs');
  if (fs.existsSync(docsDir)) {
    try {
      for (const entry of fs.readdirSync(docsDir)) {
        if (/prd/i.test(entry) && entry.endsWith('.md')) {
          const full = path.join(docsDir, entry);
          if (!found.includes(full)) {
            found.push(full);
          }
        }
      }
    } catch {
      // ignore read errors
    }
  }

  return found;
}
