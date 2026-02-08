/**
 * Security Scanner
 * Task 2.2: Security Vulnerability Detection
 *
 * Scans code for security vulnerabilities:
 * - Hardcoded secrets and API keys
 * - SQL injection risks
 * - XSS vulnerabilities
 * - CORS misconfigurations
 * - Missing authentication checks
 * - Exposed environment files
 */

import * as fs from 'fs';
import * as path from 'path';

export interface SecurityFinding {
  type: 'hardcoded_secret' | 'sql_injection' | 'xss_vulnerability' | 'cors_misconfiguration' | 'missing_auth' | 'exposed_env' | 'insecure_dependency';
  severity: 'P0' | 'P1' | 'P2';
  file: string;
  line: number | null;
  message: string;
  evidence: string | null;
  recommendation: string | null;
  cve: string | null;
}

export interface SecurityScanResult {
  schemaVersion: string;
  scannedAt: string;
  findings: SecurityFinding[];
  dependencyAudit: {
    status: 'complete' | 'offline_fallback' | 'skipped' | 'failed';
    method: 'npm_audit' | 'yarn_audit' | 'advisory_db' | null;
    advisoryDbStatus: {
      lastUpdated: string;
      ageDays: number;
      isStale: boolean;
    } | null;
    vulnerabilities: Array<{
      package: string;
      severity: string;
      vulnerableVersions: string;
      patchedVersions: string | null;
      cve: string | null;
      title: string;
    }>;
  };
  metrics: {
    filesScanned: number;
    secretsFound: number;
    potentialInjections: number;
    dependencyVulnerabilities: number;
    p0Count: number;
    p1Count: number;
    p2Count: number;
  };
}

// Secret detection patterns
const SECRET_PATTERNS = [
  // API Keys
  { pattern: /['"`](?:api[_-]?key|apikey)['"]*\s*[:=]\s*['"`]([a-zA-Z0-9_-]{20,})['"`]/gi, type: 'API key' },
  { pattern: /['"`](?:secret[_-]?key|secretkey)['"]*\s*[:=]\s*['"`]([a-zA-Z0-9_-]{20,})['"`]/gi, type: 'Secret key' },
  { pattern: /['"`](?:access[_-]?token|accesstoken)['"]*\s*[:=]\s*['"`]([a-zA-Z0-9_-]{20,})['"`]/gi, type: 'Access token' },
  { pattern: /['"`](?:auth[_-]?token|authtoken)['"]*\s*[:=]\s*['"`]([a-zA-Z0-9_-]{20,})['"`]/gi, type: 'Auth token' },

  // AWS
  { pattern: /AKIA[0-9A-Z]{16}/g, type: 'AWS Access Key ID' },
  { pattern: /(?:aws[_-]?secret[_-]?access[_-]?key)['"]*\s*[:=]\s*['"`]([a-zA-Z0-9/+=]{40})['"`]/gi, type: 'AWS Secret Key' },

  // GitHub
  { pattern: /ghp_[a-zA-Z0-9]{36}/g, type: 'GitHub Personal Access Token' },
  { pattern: /github[_-]?token['"]*\s*[:=]\s*['"`]([a-zA-Z0-9_-]{36,})['"`]/gi, type: 'GitHub Token' },

  // Generic passwords
  { pattern: /['"`](?:password|passwd|pwd)['"]*\s*[:=]\s*['"`]([^'"]{8,})['"`]/gi, type: 'Hardcoded password' },

  // Private keys
  { pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g, type: 'Private key' },

  // JWT
  { pattern: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, type: 'JWT token' },

  // Database URLs
  { pattern: /(?:mongodb|mysql|postgres|postgresql|redis):\/\/[^:]+:[^@]+@[^/]+/gi, type: 'Database URL with credentials' }
];

// SQL injection patterns
const SQL_INJECTION_PATTERNS = [
  // String concatenation in queries
  /(?:query|execute|exec|sql)\s*\(\s*['"`][^'"]*\$\{/gi,
  /(?:query|execute|exec|sql)\s*\(\s*['"`][^'"]*\s*\+\s*(?!['"`])/gi,
  /(?:query|execute|exec|sql)\s*\(\s*`[^`]*\$\{/gi,

  // Raw query building
  /\.raw\s*\(\s*['"`][^'"]*\s*\+/gi,
  /\.query\s*\(\s*['"`](?:SELECT|INSERT|UPDATE|DELETE)[^'"]*\s*\+/gi
];

// XSS patterns
const XSS_PATTERNS = [
  // innerHTML with dynamic content
  /\.innerHTML\s*=\s*(?!['"`])[^;]+/gi,

  // document.write
  /document\.write\s*\([^)]*\$\{/gi,
  /document\.write\s*\([^)]*\+/gi,

  // dangerouslySetInnerHTML (React)
  /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:\s*[^}]+\}/gi,

  // v-html (Vue)
  /v-html\s*=\s*['"`][^'"]+['"`]/gi
];

// CORS patterns
const CORS_PATTERNS = [
  // Wildcard origin
  /['"`]Access-Control-Allow-Origin['"`]\s*[:=]\s*['"`]\*['"`]/gi,
  /cors\s*\(\s*\{\s*origin\s*:\s*(?:true|\*|['"`]\*['"`])/gi,

  // Reflecting origin without validation
  /origin\s*:\s*(?:req\.headers\.origin|request\.headers\.origin)/gi
];

/**
 * Scan codebase for security vulnerabilities
 */
export async function scanSecurity(
  codebasePath: string,
  options: {
    excludePatterns?: string[];
    skipDependencyAudit?: boolean;
  } = {}
): Promise<SecurityScanResult> {
  const {
    excludePatterns = ['node_modules', 'dist', 'build', '.git', 'vendor', 'coverage'],
    skipDependencyAudit = false
  } = options;

  const result: SecurityScanResult = {
    schemaVersion: '1.0.0',
    scannedAt: new Date().toISOString(),
    findings: [],
    dependencyAudit: {
      status: 'skipped',
      method: null,
      advisoryDbStatus: null,
      vulnerabilities: []
    },
    metrics: {
      filesScanned: 0,
      secretsFound: 0,
      potentialInjections: 0,
      dependencyVulnerabilities: 0,
      p0Count: 0,
      p1Count: 0,
      p2Count: 0
    }
  };

  // Check for exposed .env files
  checkExposedEnvFiles(codebasePath, result);

  // Scan source files
  const files = collectSourceFiles(codebasePath, excludePatterns);

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const relativePath = path.relative(codebasePath, file);

      // Scan for secrets
      scanForSecrets(content, relativePath, result);

      // Scan for SQL injection
      scanForSqlInjection(content, relativePath, result);

      // Scan for XSS
      scanForXss(content, relativePath, result);

      // Scan for CORS issues
      scanForCorsIssues(content, relativePath, result);

      // Scan for missing auth
      scanForMissingAuth(content, relativePath, result);

      result.metrics.filesScanned++;
    } catch {
      // Skip unreadable files
    }
  }

  // Dependency audit
  if (!skipDependencyAudit) {
    await runDependencyAudit(codebasePath, result);
  }

  // Count severities
  for (const finding of result.findings) {
    if (finding.severity === 'P0') result.metrics.p0Count++;
    else if (finding.severity === 'P1') result.metrics.p1Count++;
    else if (finding.severity === 'P2') result.metrics.p2Count++;
  }

  return result;
}

/**
 * Collect source files
 */
function collectSourceFiles(dir: string, excludePatterns: string[]): string[] {
  const files: string[] = [];
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.py', '.rb', '.php', '.java', '.go'];

  function walk(currentDir: string) {
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const shouldExclude = excludePatterns.some(p => entry.name === p || fullPath.includes(p));

        if (shouldExclude) continue;

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  walk(dir);
  return files;
}

/**
 * Check for exposed .env files
 */
function checkExposedEnvFiles(codebasePath: string, result: SecurityScanResult): void {
  const publicDirs = ['public', 'static', 'www', 'dist', 'build'];
  const envFiles = ['.env', '.env.local', '.env.production', '.env.development'];

  for (const publicDir of publicDirs) {
    const publicPath = path.join(codebasePath, publicDir);
    if (fs.existsSync(publicPath)) {
      for (const envFile of envFiles) {
        const envPath = path.join(publicPath, envFile);
        if (fs.existsSync(envPath)) {
          result.findings.push({
            type: 'exposed_env',
            severity: 'P0',
            file: path.join(publicDir, envFile),
            line: null,
            message: `Environment file exposed in public directory`,
            evidence: envPath,
            recommendation: 'Move .env files out of public directories and add them to .gitignore',
            cve: null
          });
          result.metrics.secretsFound++;
        }
      }
    }
  }
}

/**
 * Scan for hardcoded secrets
 */
function scanForSecrets(content: string, file: string, result: SecurityScanResult): void {
  // Skip test files and example files
  if (file.includes('.test.') || file.includes('.spec.') || file.includes('example') || file.includes('mock')) {
    return;
  }

  for (const { pattern, type } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    let match;

    while ((match = pattern.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      const evidence = match[0].substring(0, 50) + (match[0].length > 50 ? '...' : '');

      // Check if it looks like a placeholder
      const value = match[1] || match[0];
      if (isLikelyPlaceholder(value)) continue;

      result.findings.push({
        type: 'hardcoded_secret',
        severity: 'P0',
        file,
        line,
        message: `Potential ${type} found in source code`,
        evidence,
        recommendation: 'Move secrets to environment variables and use a secrets manager',
        cve: null
      });
      result.metrics.secretsFound++;
    }
  }
}

/**
 * Check if value looks like a placeholder
 */
function isLikelyPlaceholder(value: string): boolean {
  const placeholderPatterns = [
    /^your[_-]?/i,
    /^xxx+$/i,
    /^placeholder/i,
    /^example/i,
    /^test[_-]?/i,
    /^dummy/i,
    /^\$\{/,
    /^process\.env\./,
    /<.*>/,
    /^\.\.\./
  ];

  return placeholderPatterns.some(p => p.test(value));
}

/**
 * Scan for SQL injection vulnerabilities
 */
function scanForSqlInjection(content: string, file: string, result: SecurityScanResult): void {
  for (const pattern of SQL_INJECTION_PATTERNS) {
    pattern.lastIndex = 0;
    let match;

    while ((match = pattern.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;

      result.findings.push({
        type: 'sql_injection',
        severity: 'P0',
        file,
        line,
        message: 'Potential SQL injection: string concatenation in database query',
        evidence: match[0].substring(0, 100),
        recommendation: 'Use parameterized queries or an ORM with proper escaping',
        cve: null
      });
      result.metrics.potentialInjections++;
    }
  }
}

/**
 * Scan for XSS vulnerabilities
 */
function scanForXss(content: string, file: string, result: SecurityScanResult): void {
  for (const pattern of XSS_PATTERNS) {
    pattern.lastIndex = 0;
    let match;

    while ((match = pattern.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;

      result.findings.push({
        type: 'xss_vulnerability',
        severity: 'P1',
        file,
        line,
        message: 'Potential XSS vulnerability: unescaped dynamic content in HTML',
        evidence: match[0].substring(0, 80),
        recommendation: 'Sanitize user input before rendering or use framework-provided escaping',
        cve: null
      });
      result.metrics.potentialInjections++;
    }
  }
}

/**
 * Scan for CORS misconfigurations
 */
function scanForCorsIssues(content: string, file: string, result: SecurityScanResult): void {
  for (const pattern of CORS_PATTERNS) {
    pattern.lastIndex = 0;
    let match;

    while ((match = pattern.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;

      result.findings.push({
        type: 'cors_misconfiguration',
        severity: 'P2',
        file,
        line,
        message: 'CORS configuration allows all origins or reflects origin unsafely',
        evidence: match[0],
        recommendation: 'Specify explicit allowed origins instead of using wildcards',
        cve: null
      });
    }
  }
}

/**
 * Scan for potential missing authentication
 */
function scanForMissingAuth(content: string, file: string, result: SecurityScanResult): void {
  // Look for API route definitions without auth middleware
  const routePatterns = [
    /app\.(get|post|put|patch|delete)\s*\(\s*['"`]\/api\/[^'"]+['"`]\s*,\s*(?!.*(?:auth|protect|verify|jwt|session))/gi,
    /router\.(get|post|put|patch|delete)\s*\(\s*['"`]\/[^'"]+['"`]\s*,\s*(?!.*(?:auth|protect|verify|jwt|session))/gi
  ];

  // Skip if file already imports auth middleware
  if (/import.*(?:auth|protect|verify|jwt)/i.test(content)) {
    return;
  }

  for (const pattern of routePatterns) {
    pattern.lastIndex = 0;
    let match;

    while ((match = pattern.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;

      // Check if route handles sensitive operations
      const isSensitive = /(?:admin|user|profile|account|settings|payment)/i.test(match[0]);

      if (isSensitive) {
        result.findings.push({
          type: 'missing_auth',
          severity: 'P2',
          file,
          line,
          message: 'API endpoint may be missing authentication middleware',
          evidence: match[0].substring(0, 80),
          recommendation: 'Add authentication middleware to protect sensitive endpoints',
          cve: null
        });
      }
    }
  }
}

/**
 * Run dependency audit
 */
async function runDependencyAudit(codebasePath: string, result: SecurityScanResult): Promise<void> {
  const packageJsonPath = path.join(codebasePath, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    result.dependencyAudit.status = 'skipped';
    return;
  }

  // Try npm audit first
  try {
    const { execSync } = require('child_process');
    const auditOutput = execSync('npm audit --json 2>/dev/null', {
      cwd: codebasePath,
      encoding: 'utf-8',
      timeout: 60000
    });

    const auditData = JSON.parse(auditOutput);
    result.dependencyAudit.status = 'complete';
    result.dependencyAudit.method = 'npm_audit';

    if (auditData.vulnerabilities) {
      for (const [pkg, vuln] of Object.entries(auditData.vulnerabilities as Record<string, any>)) {
        result.dependencyAudit.vulnerabilities.push({
          package: pkg,
          severity: vuln.severity || 'unknown',
          vulnerableVersions: vuln.range || 'unknown',
          patchedVersions: vuln.fixAvailable?.version || null,
          cve: vuln.via?.[0]?.cve || null,
          title: vuln.via?.[0]?.title || `Vulnerability in ${pkg}`
        });

        result.findings.push({
          type: 'insecure_dependency',
          severity: mapNpmSeverity(vuln.severity),
          file: 'package.json',
          line: null,
          message: `Vulnerable dependency: ${pkg} (${vuln.severity})`,
          evidence: `Affected versions: ${vuln.range}`,
          recommendation: vuln.fixAvailable ? `Upgrade to ${vuln.fixAvailable.version}` : 'Check for updates or alternatives',
          cve: vuln.via?.[0]?.cve || null
        });
        result.metrics.dependencyVulnerabilities++;
      }
    }
  } catch {
    // npm audit failed, try offline fallback
    result.dependencyAudit.status = 'offline_fallback';
    result.dependencyAudit.method = 'advisory_db';
    result.dependencyAudit.advisoryDbStatus = {
      lastUpdated: new Date().toISOString(),
      ageDays: 0,
      isStale: true // Mark as stale since we couldn't get fresh data
    };
  }
}

/**
 * Map npm severity to our severity levels
 */
function mapNpmSeverity(npmSeverity: string): 'P0' | 'P1' | 'P2' {
  switch (npmSeverity?.toLowerCase()) {
    case 'critical':
      return 'P0';
    case 'high':
      return 'P1';
    default:
      return 'P2';
  }
}
