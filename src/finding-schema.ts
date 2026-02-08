/**
 * Finding Schema - Full 33-field finding type with Zod validation.
 *
 * Every finding produced by the audit pipeline conforms to this schema.
 * The `createFinding()` factory fills in sensible defaults and validates
 * the result at runtime via Zod so that downstream consumers (critique,
 * dedup, review, issue creation) can rely on well-typed, complete data.
 *
 * @module finding-schema
 */

import { z } from 'zod';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const FindingSeverity = z.enum(['P0', 'P1', 'P2', 'P3', 'P4']);
export type FindingSeverity = z.infer<typeof FindingSeverity>;

export const FindingType = z.enum([
  'security',
  'functionality',
  'ui',
  'quality',
  'performance',
  'accessibility',
  'prd-gap',
  'data-integrity',
]);
export type FindingType = z.infer<typeof FindingType>;

export const VerificationStatus = z.enum([
  'pending',
  'verified',
  'flaky',
  'could_not_reproduce',
  'false_positive',
  'verification_error',
]);
export type VerificationStatus = z.infer<typeof VerificationStatus>;

export const ReviewDecision = z.enum([
  'pending',
  'accepted',
  'rejected',
  'skipped',
]);
export type ReviewDecision = z.infer<typeof ReviewDecision>;

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

export const FindingLocation = z.object({
  url: z.string().optional(),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
});
export type FindingLocation = z.infer<typeof FindingLocation>;

export const FindingEvidence = z.object({
  screenshots: z.array(z.string()).default([]),
  console_errors: z.array(z.string()).default([]),
  network_requests: z.array(z.string()).default([]),
});
export type FindingEvidence = z.infer<typeof FindingEvidence>;

export const BrowserInfo = z.object({
  name: z.string().default('unknown'),
  version: z.string().default('unknown'),
});
export type BrowserInfo = z.infer<typeof BrowserInfo>;

export const ViewportSize = z.object({
  width: z.number().int().positive().default(1280),
  height: z.number().int().positive().default(720),
});
export type ViewportSize = z.infer<typeof ViewportSize>;

// ---------------------------------------------------------------------------
// Main finding schema
// ---------------------------------------------------------------------------

export const FindingSchema = z.object({
  // Identity
  id: z.string().min(1),
  type: FindingType,
  severity: FindingSeverity,
  title: z.string().min(1),
  description: z.string().default(''),

  // Location
  location: FindingLocation.default({}),

  // Evidence
  evidence: FindingEvidence.default({ screenshots: [], console_errors: [], network_requests: [] }),
  steps_to_reproduce: z.array(z.string()).default([]),
  expected_behavior: z.string().default(''),
  actual_behavior: z.string().default(''),
  screenshot_id: z.string().optional(),

  // PRD traceability
  prd_section: z.string().optional(),
  prd_requirement: z.string().optional(),

  // Quality signals
  confidence: z.number().min(0).max(100).default(50),
  critique_notes: z.string().default(''),
  verification_status: VerificationStatus.default('pending'),
  is_false_positive: z.boolean().default(false),

  // Classification
  category: z.string().default('uncategorized'),
  component: z.string().default(''),
  affected_users: z.string().default('all'),

  // Resolution
  workaround: z.string().default(''),
  fix_suggestion: z.string().default(''),
  related_findings: z.array(z.string()).default([]),

  // Timestamps
  created_at: z.string().datetime().default(() => new Date().toISOString()),
  updated_at: z.string().datetime().default(() => new Date().toISOString()),

  // Provenance
  source_phase: z.string().default(''),
  browser_info: BrowserInfo.default({ name: 'unknown', version: 'unknown' }),
  viewport_size: ViewportSize.default({ width: 1280, height: 720 }),

  // Dedup & tracking
  dedup_hash: z.string().default(''),
  review_decision: ReviewDecision.default('pending'),
  github_issue_number: z.number().int().positive().optional(),
});

export type Finding = z.infer<typeof FindingSchema>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic dedup hash from the key identity fields.
 *
 * Hashes: type + severity + title + location.url + location.file.
 */
function computeDedupHash(partial: Partial<Finding>): string {
  const payload = [
    partial.type ?? '',
    partial.severity ?? '',
    (partial.title ?? '').toLowerCase().trim(),
    partial.location?.url ?? '',
    partial.location?.file ?? '',
  ].join('|');

  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/**
 * Auto-incrementing counter for finding IDs.
 *
 * **Important:** This counter persists for the lifetime of the process.
 * Callers MUST call `resetFindingCounter()` at the start of each audit
 * run to ensure IDs start from F-001. The orchestrator handles this
 * automatically during pipeline initialization.
 */
let findingCounter = 0;

/**
 * Create a validated Finding from a partial input.
 *
 * Fills in defaults for every omitted field and generates:
 * - `id` if missing (auto-incrementing `F-NNN`)
 * - `dedup_hash` from identity fields
 * - `created_at` / `updated_at` timestamps
 *
 * Throws a `ZodError` if the result fails validation.
 */
export function createFinding(partial: Partial<Finding> & { title: string; type: FindingType; severity: FindingSeverity }): Finding {
  findingCounter++;
  const now = new Date().toISOString();

  const raw: Record<string, unknown> = {
    id: `F-${String(findingCounter).padStart(3, '0')}`,
    created_at: now,
    updated_at: now,
    ...partial,
  };

  // Compute dedup hash if not provided
  if (!raw.dedup_hash) {
    raw.dedup_hash = computeDedupHash(partial);
  }

  return FindingSchema.parse(raw);
}

/**
 * Validate an existing finding object (e.g. loaded from JSON).
 *
 * Returns a discriminated union with `success`, `data`, and `error` fields.
 */
export function validateFinding(data: unknown): { success: boolean; data?: Finding; error?: z.ZodError } {
  const result = FindingSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error as z.ZodError };
}

/**
 * Reset the internal counter (useful for tests).
 */
export function resetFindingCounter(value = 0): void {
  findingCounter = value;
}

/**
 * Upgrade a legacy finding (old ~7-field format) to the full schema.
 *
 * Maps known legacy fields and fills defaults for everything else.
 */
export function upgradeLegacyFinding(legacy: Record<string, unknown>): Finding {
  const partial: Record<string, unknown> = {
    id: legacy.id as string,
    title: legacy.title as string,
    severity: legacy.severity as string,
    type: mapLegacyCategoryToType(legacy.category as string),
    category: legacy.category as string,
    description: legacy.description as string ?? '',
    prd_section: legacy.prd_section as string,
    fix_suggestion: legacy.fix as string ?? '',
  };

  // Map legacy evidence object
  const evidence = legacy.evidence as Record<string, unknown> | undefined;
  if (evidence) {
    const codeRefs = (evidence.code as string[]) ?? [];
    const browserNote = (evidence.browser as string) ?? '';

    partial.evidence = {
      screenshots: [],
      console_errors: [],
      network_requests: [],
    };
    partial.actual_behavior = browserNote;

    // Extract file locations from code refs
    if (codeRefs.length > 0) {
      const firstRef = codeRefs[0];
      const [file, lineStr] = firstRef.split(':');
      partial.location = {
        file,
        line: lineStr ? parseInt(lineStr.split('-')[0], 10) || undefined : undefined,
      };
    }
  }

  // Map verification status from legacy "status" field
  if (legacy.status === 'open') {
    partial.verification_status = 'pending';
    partial.review_decision = 'pending';
  }

  return createFinding(partial as Partial<Finding> & { title: string; type: FindingType; severity: FindingSeverity });
}

/**
 * Map a legacy category string to the closest FindingType.
 */
function mapLegacyCategoryToType(category: string | undefined): FindingType {
  if (!category) return 'functionality';

  const lower = category.toLowerCase();
  if (lower.includes('security')) return 'security';
  if (lower.includes('prd') || lower.includes('compliance') || lower.includes('gap')) return 'prd-gap';
  if (lower.includes('ui') || lower.includes('visual') || lower.includes('responsive')) return 'ui';
  if (lower.includes('performance') || lower.includes('perf')) return 'performance';
  if (lower.includes('accessibility') || lower.includes('a11y')) return 'accessibility';
  if (lower.includes('data') || lower.includes('integrity')) return 'data-integrity';
  if (lower.includes('quality') || lower.includes('code')) return 'quality';
  return 'functionality';
}
