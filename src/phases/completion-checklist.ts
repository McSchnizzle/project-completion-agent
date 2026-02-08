/**
 * Completion Checklist
 * Task T-038: Verify all required artifacts exist
 *
 * Checks that all required audit artifacts are present before marking
 * the audit as complete. Updates progress.json status to "complete"
 * only if all required items are present.
 */

import fs from 'node:fs';
import {
  getProgressPath,
  getPrdSummaryPath,
  getCodeAnalysisPath,
  getCoverageSummaryPath,
  getReportPath,
  getReviewDecisionsPath,
  getPageDir,
  getFindingDir,
} from '../artifact-paths';

/**
 * A single item in the checklist
 */
export interface ChecklistItem {
  name: string;
  path: string;
  exists: boolean;
  required: boolean;
}

/**
 * Result of the checklist verification
 */
export interface ChecklistResult {
  complete: boolean;
  items: ChecklistItem[];
  missingCount: number;
}

/**
 * Run the completion checklist
 *
 * Verifies that all required artifacts exist in the audit directory.
 * Displays a formatted checklist to stdout with checkmark/X icons.
 * Updates progress.json status to "complete" only if all required items are present.
 *
 * @param auditDir - Path to the audit directory
 * @returns Checklist result with completion status and item details
 */
export function runChecklist(auditDir: string): ChecklistResult {
  const items: ChecklistItem[] = [];

  // Check progress.json (required)
  items.push(
    checkFile('Progress Tracker', getProgressPath(auditDir), true)
  );

  // Check if PRD summary exists - it's optional but we need to know
  const prdPath = getPrdSummaryPath(auditDir);
  const hasPrd = fs.existsSync(prdPath);
  items.push(
    checkFile('PRD Summary', prdPath, false)
  );

  // Check code-analysis.json (optional - only if code analysis ran)
  items.push(
    checkFile('Code Analysis', getCodeAnalysisPath(auditDir), false)
  );

  // Check coverage-summary.md (required)
  items.push(
    checkFile('Coverage Summary', getCoverageSummaryPath(auditDir), true)
  );

  // Check report.md (required)
  items.push(
    checkFile('Audit Report', getReportPath(auditDir), true)
  );

  // Check review-decisions.json (required)
  items.push(
    checkFile('Review Decisions', getReviewDecisionsPath(auditDir), true)
  );

  // Check for at least one page file (required)
  const pageDir = getPageDir(auditDir);
  const hasPages = checkForPages(pageDir);
  items.push({
    name: 'Page Inventories',
    path: pageDir,
    exists: hasPages,
    required: true,
  });

  // Check for findings directory (optional - may have zero findings)
  const findingDir = getFindingDir(auditDir);
  const hasFindings = fs.existsSync(findingDir);
  items.push({
    name: 'Findings Directory',
    path: findingDir,
    exists: hasFindings,
    required: false,
  });

  // Calculate missing count (only required items)
  const missingCount = items.filter((item) => item.required && !item.exists).length;
  const complete = missingCount === 0;

  // Display checklist to stdout
  displayChecklist(items, complete);

  // Update progress.json if complete
  if (complete) {
    updateProgressStatus(auditDir, 'complete');
  }

  return {
    complete,
    items,
    missingCount,
  };
}

/**
 * Check if a file exists
 */
function checkFile(name: string, path: string, required: boolean): ChecklistItem {
  return {
    name,
    path,
    exists: fs.existsSync(path),
    required,
  };
}

/**
 * Check if at least one page file exists
 */
function checkForPages(pageDir: string): boolean {
  if (!fs.existsSync(pageDir)) {
    return false;
  }

  try {
    const files = fs.readdirSync(pageDir);
    return files.some((f) => f.match(/^page-\d+\.json$/));
  } catch {
    return false;
  }
}

/**
 * Display formatted checklist to stdout
 */
function displayChecklist(items: ChecklistItem[], complete: boolean): void {
  console.log('\n' + '='.repeat(70));
  console.log('COMPLETION CHECKLIST');
  console.log('='.repeat(70) + '\n');

  for (const item of items) {
    const icon = item.exists ? '✅' : '❌';
    const requiredLabel = item.required ? '(required)' : '(optional)';
    const status = item.exists ? 'PRESENT' : 'MISSING';

    console.log(`${icon} ${item.name} ${requiredLabel}`);
    console.log(`   Status: ${status}`);
    console.log(`   Path: ${item.path}`);
    console.log('');
  }

  console.log('='.repeat(70));
  if (complete) {
    console.log('✅ AUDIT COMPLETE - All required artifacts present');
  } else {
    const missingCount = items.filter((item) => item.required && !item.exists).length;
    console.log(`❌ AUDIT INCOMPLETE - ${missingCount} required artifact(s) missing`);
  }
  console.log('='.repeat(70) + '\n');
}

/**
 * Update progress.json status
 */
function updateProgressStatus(auditDir: string, status: 'complete' | 'incomplete'): void {
  const progressPath = getProgressPath(auditDir);
  if (!fs.existsSync(progressPath)) {
    return;
  }

  try {
    const progress = JSON.parse(fs.readFileSync(progressPath, 'utf-8'));
    progress.status = status;
    if (status === 'complete' && !progress.completed_at) {
      progress.completed_at = new Date().toISOString();
    }
    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to update progress.json:', error);
  }
}
