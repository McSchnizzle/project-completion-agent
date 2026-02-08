/**
 * Code Analyzers
 *
 * Static analysis modules for the complete-audit skill.
 */

// Code Quality Analysis
export {
  CodeQualityFinding,
  CodeQualityResult,
  analyzeCodeQuality
} from './code-quality';

// Security Scanning
export {
  SecurityFinding,
  SecurityScanResult,
  scanSecurity
} from './security-scanner';

// Architecture Analysis
export {
  DependencyNode,
  DependencyEdge,
  CircularDependency,
  ArchitectureFinding,
  PatternCompliance,
  ArchitectureAnalysisResult,
  analyzeArchitecture
} from './architecture-analyzer';

/**
 * Run all code analysis phases
 */
export async function runFullCodeAnalysis(
  codebasePath: string,
  options: {
    excludePatterns?: string[];
    skipDependencyAudit?: boolean;
    maxComplexity?: number;
    maxFileLines?: number;
  } = {}
): Promise<{
  codeQuality: import('./code-quality').CodeQualityResult;
  security: import('./security-scanner').SecurityScanResult;
  architecture: import('./architecture-analyzer').ArchitectureAnalysisResult;
}> {
  const { analyzeCodeQuality } = await import('./code-quality');
  const { scanSecurity } = await import('./security-scanner');
  const { analyzeArchitecture } = await import('./architecture-analyzer');

  const [codeQuality, security, architecture] = await Promise.all([
    analyzeCodeQuality(codebasePath, options),
    scanSecurity(codebasePath, {
      excludePatterns: options.excludePatterns,
      skipDependencyAudit: options.skipDependencyAudit
    }),
    analyzeArchitecture(codebasePath, {
      excludePatterns: options.excludePatterns
    })
  ]);

  return { codeQuality, security, architecture };
}

/**
 * Convert analysis results to unified findings format
 */
export function aggregateFindings(
  codeQuality: import('./code-quality').CodeQualityResult,
  security: import('./security-scanner').SecurityScanResult,
  architecture: import('./architecture-analyzer').ArchitectureAnalysisResult
): Array<{
  id: string;
  source: 'code-scan';
  type: string;
  severity: string;
  title: string;
  description: string;
  file: string;
  line: number | null;
}> {
  const findings: Array<{
    id: string;
    source: 'code-scan';
    type: string;
    severity: string;
    title: string;
    description: string;
    file: string;
    line: number | null;
  }> = [];

  let findingIndex = 1;

  // Code quality findings
  for (const f of codeQuality.findings) {
    findings.push({
      id: `finding-${String(findingIndex++).padStart(3, '0')}`,
      source: 'code-scan',
      type: f.type,
      severity: f.severity,
      title: formatFindingTitle(f.type),
      description: f.message,
      file: f.file,
      line: f.line
    });
  }

  // Security findings
  for (const f of security.findings) {
    findings.push({
      id: `finding-${String(findingIndex++).padStart(3, '0')}`,
      source: 'code-scan',
      type: f.type,
      severity: f.severity,
      title: formatFindingTitle(f.type),
      description: f.message,
      file: f.file,
      line: f.line
    });
  }

  // Architecture findings
  for (const f of architecture.findings) {
    findings.push({
      id: `finding-${String(findingIndex++).padStart(3, '0')}`,
      source: 'code-scan',
      type: f.type,
      severity: f.severity,
      title: formatFindingTitle(f.type),
      description: f.message,
      file: f.file,
      line: null
    });
  }

  return findings;
}

/**
 * Format finding type as human-readable title
 */
function formatFindingTitle(type: string): string {
  const titles: Record<string, string> = {
    todo: 'TODO Comment',
    fixme: 'FIXME Comment',
    hack: 'HACK Comment',
    console_log: 'Console Statement',
    unused_export: 'Unused Export',
    unused_import: 'Unused Import',
    high_complexity: 'High Complexity Function',
    large_file: 'Large File',
    deep_nesting: 'Deep Nesting',
    commented_code: 'Commented Code Block',
    hardcoded_secret: 'Hardcoded Secret',
    sql_injection: 'SQL Injection Risk',
    xss_vulnerability: 'XSS Vulnerability',
    cors_misconfiguration: 'CORS Misconfiguration',
    missing_auth: 'Missing Authentication',
    exposed_env: 'Exposed Environment File',
    insecure_dependency: 'Insecure Dependency',
    circular_dependency: 'Circular Dependency',
    god_file: 'God File',
    orphan_file: 'Orphan File',
    missing_error_boundary: 'Missing Error Boundary',
    pattern_violation: 'Pattern Violation',
    missing_validation: 'Missing Validation'
  };

  return titles[type] || type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
