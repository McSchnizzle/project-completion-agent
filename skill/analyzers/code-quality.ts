/**
 * Code Quality Analyzer
 * Task 2.1: Code Quality Analysis
 * Task 6.1: Schema Naming Alignment (snake_case)
 *
 * Detects code quality issues:
 * - TODO/FIXME/HACK comments
 * - Console statements in production code
 * - Unused exports and imports
 * - High cyclomatic complexity
 * - Large files and deep nesting
 * - Commented-out code blocks
 */

import * as fs from 'fs';
import * as path from 'path';

// Using snake_case to match JSON Schema requirements
export interface CodeQualityFinding {
  type: 'todo' | 'fixme' | 'hack' | 'console_log' | 'unused_export' | 'unused_import' | 'high_complexity' | 'large_file' | 'deep_nesting' | 'commented_code';
  file: string;
  line: number;
  column?: number | null;
  message: string;
  severity: 'P2' | 'P3';
  context?: string | null;
  function_name?: string | null;
  complexity?: number | null;
}

export interface CodeQualityResult {
  schema_version: string;
  analyzed_at: string;
  codebase_path: string | null;
  languages: Array<{
    name: string;
    files_count: number;
    parser: 'ast' | 'regex';
  }>;
  findings: CodeQualityFinding[];
  metrics: {
    files_analyzed: number;
    files_skipped: number;
    total_todos: number;
    total_fixmes: number;
    console_logs: number;
    unused_exports: number;
    unused_imports: number;
    high_complexity_functions: number;
    average_complexity: number;
  };
  exclusions: string[];
}

// Comment patterns to detect
const COMMENT_PATTERNS = {
  todo: /\/\/\s*TODO[:\s](.+)|\/\*\s*TODO[:\s](.+?)\*\//gi,
  fixme: /\/\/\s*FIXME[:\s](.+)|\/\*\s*FIXME[:\s](.+?)\*\//gi,
  hack: /\/\/\s*HACK[:\s](.+)|\/\*\s*HACK[:\s](.+?)\*\//gi,
  xxx: /\/\/\s*XXX[:\s](.+)|\/\*\s*XXX[:\s](.+?)\*\//gi
};

// Console patterns
const CONSOLE_PATTERN = /\bconsole\.(log|warn|error|info|debug|trace|dir|table|time|timeEnd|group|groupEnd)\s*\(/g;

// Export patterns
const EXPORT_PATTERNS = {
  namedExport: /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g,
  defaultExport: /export\s+default\s+(?:function|class)?\s*(\w+)?/g,
  reExport: /export\s+\{([^}]+)\}\s+from/g
};

// Import patterns
const IMPORT_PATTERN = /import\s+(?:\{([^}]+)\}|(\w+)|\*\s+as\s+(\w+))(?:\s*,\s*(?:\{([^}]+)\}|(\w+)))?\s+from\s+['"]([^'"]+)['"]/g;

// Commented code heuristics
const CODE_COMMENT_PATTERNS = [
  /\/\/\s*(const|let|var|function|class|import|export|if|for|while|return)\s/,
  /\/\/\s*\w+\s*[=<>!]+\s*/,
  /\/\/\s*\w+\s*\(\s*\)/,
  /\/\*[\s\S]*?(const|let|var|function|class)[\s\S]*?\*\//
];

/**
 * Analyze a codebase for quality issues
 */
export async function analyzeCodeQuality(
  codebasePath: string,
  options: {
    maxFileSize?: number;
    maxComplexity?: number;
    maxFileLines?: number;
    maxNestingDepth?: number;
    excludePatterns?: string[];
  } = {}
): Promise<CodeQualityResult> {
  const {
    maxFileSize = 500 * 1024, // 500KB
    maxComplexity = 10,
    maxFileLines = 500,
    maxNestingDepth = 4,
    excludePatterns = ['node_modules', 'dist', 'build', '.git', 'vendor', 'coverage', '__tests__', '*.test.*', '*.spec.*']
  } = options;

  const result: CodeQualityResult = {
    schema_version: '1.0.0',
    analyzed_at: new Date().toISOString(),
    codebase_path: codebasePath,
    languages: [],
    findings: [],
    metrics: {
      files_analyzed: 0,
      files_skipped: 0,
      total_todos: 0,
      total_fixmes: 0,
      console_logs: 0,
      unused_exports: 0,
      unused_imports: 0,
      high_complexity_functions: 0,
      average_complexity: 0
    },
    exclusions: excludePatterns
  };

  // Collect files
  const files = collectFiles(codebasePath, excludePatterns);
  const languageStats = new Map<string, number>();

  // Track exports and imports for unused detection
  const allExports = new Map<string, { file: string; line: number }>();
  const allImports = new Set<string>();
  const importUsages = new Map<string, Set<string>>(); // file -> imported names
  const complexities: number[] = [];

  for (const file of files) {
    const stats = fs.statSync(file);

    // Skip large files
    if (stats.size > maxFileSize) {
      result.metrics.files_skipped++;
      continue;
    }

    const ext = path.extname(file);
    const lang = getLanguageFromExt(ext);
    if (!lang) {
      result.metrics.files_skipped++;
      continue;
    }

    // Track language stats
    languageStats.set(lang, (languageStats.get(lang) || 0) + 1);

    try {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      const relativePath = path.relative(codebasePath, file);

      // Check file size
      if (lines.length > maxFileLines) {
        result.findings.push({
          type: 'large_file',
          file: relativePath,
          line: 1,
          message: `File has ${lines.length} lines (max: ${maxFileLines})`,
          severity: 'P3'
        });
      }

      // Find TODO/FIXME/HACK comments
      findCommentMarkers(content, relativePath, result);

      // Find console statements
      findConsoleStatements(content, relativePath, result);

      // Find exports (for later unused check)
      findExports(content, relativePath, allExports);

      // Find imports and track usage
      const fileImports = findImports(content);
      fileImports.imported.forEach(imp => allImports.add(imp));
      importUsages.set(relativePath, fileImports.used);

      // Check for unused imports in this file
      findUnusedImports(content, relativePath, fileImports, result);

      // Calculate complexity and nesting
      const fileComplexity = analyzeComplexity(content, relativePath, maxComplexity, maxNestingDepth, result);
      complexities.push(...fileComplexity);

      // Check for commented code blocks
      findCommentedCode(content, relativePath, result);

      result.metrics.files_analyzed++;
    } catch (error) {
      result.metrics.files_skipped++;
    }
  }

  // Check for unused exports
  for (const [exportName, info] of allExports) {
    if (!allImports.has(exportName)) {
      result.findings.push({
        type: 'unused_export',
        file: info.file,
        line: info.line,
        message: `Export '${exportName}' is not imported anywhere`,
        severity: 'P3'
      });
      result.metrics.unused_exports++;
    }
  }

  // Calculate average complexity
  if (complexities.length > 0) {
    result.metrics.average_complexity = Math.round(
      complexities.reduce((a, b) => a + b, 0) / complexities.length * 10
    ) / 10;
  }

  // Build language stats
  for (const [lang, count] of languageStats) {
    result.languages.push({
      name: lang,
      files_count: count,
      parser: 'regex' // Using regex-based analysis
    });
  }

  return result;
}

/**
 * Collect all source files recursively
 */
function collectFiles(dir: string, excludePatterns: string[]): string[] {
  const files: string[] = [];

  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      // Check exclusions
      const shouldExclude = excludePatterns.some(pattern => {
        if (pattern.includes('*')) {
          const regex = new RegExp(pattern.replace(/\*/g, '.*'));
          return regex.test(entry.name) || regex.test(fullPath);
        }
        return entry.name === pattern || fullPath.includes(pattern);
      });

      if (shouldExclude) continue;

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (isSourceFile(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  walk(dir);
  return files;
}

function isSourceFile(ext: string): boolean {
  const sourceExts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'];
  return sourceExts.includes(ext);
}

function getLanguageFromExt(ext: string): string | null {
  const langMap: Record<string, string> = {
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript',
    '.js': 'JavaScript',
    '.jsx': 'JavaScript',
    '.mjs': 'JavaScript',
    '.cjs': 'JavaScript',
    '.vue': 'Vue',
    '.svelte': 'Svelte'
  };
  return langMap[ext] || null;
}

/**
 * Find TODO/FIXME/HACK markers
 */
function findCommentMarkers(content: string, file: string, result: CodeQualityResult): void {
  const lines = content.split('\n');

  for (const [type, pattern] of Object.entries(COMMENT_PATTERNS)) {
    let match;
    pattern.lastIndex = 0;

    while ((match = pattern.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      const message = (match[1] || match[2] || '').trim();

      const findingType = type === 'xxx' ? 'todo' : type as CodeQualityFinding['type'];

      result.findings.push({
        type: findingType,
        file,
        line: lineNum,
        message: message || `${type.toUpperCase()} comment found`,
        severity: type === 'fixme' || type === 'hack' ? 'P2' : 'P3',
        context: lines[lineNum - 1]?.trim()
      });

      if (type === 'todo' || type === 'xxx') result.metrics.total_todos++;
      if (type === 'fixme') result.metrics.total_fixmes++;
    }
  }
}

/**
 * Find console statements
 */
function findConsoleStatements(content: string, file: string, result: CodeQualityResult): void {
  let match;
  CONSOLE_PATTERN.lastIndex = 0;

  while ((match = CONSOLE_PATTERN.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    const method = match[1];

    result.findings.push({
      type: 'console_log',
      file,
      line: lineNum,
      message: `console.${method}() found in production code`,
      severity: 'P3'
    });
    result.metrics.console_logs++;
  }
}

/**
 * Find exports for unused detection
 */
function findExports(
  content: string,
  file: string,
  exports: Map<string, { file: string; line: number }>
): void {
  // Named exports
  let match;
  EXPORT_PATTERNS.namedExport.lastIndex = 0;
  while ((match = EXPORT_PATTERNS.namedExport.exec(content)) !== null) {
    const name = match[1];
    const line = content.substring(0, match.index).split('\n').length;
    exports.set(name, { file, line });
  }
}

/**
 * Find imports and track which are used (Task 6.8: Unused Imports Detection)
 */
function findImports(content: string): { imported: Set<string>; used: Set<string>; byName: Map<string, number> } {
  const imported = new Set<string>();
  const used = new Set<string>();
  const byName = new Map<string, number>(); // name -> line number

  let match;
  IMPORT_PATTERN.lastIndex = 0;

  while ((match = IMPORT_PATTERN.exec(content)) !== null) {
    const line = content.substring(0, match.index).split('\n').length;

    // Named imports: import { a, b } from '...'
    if (match[1]) {
      match[1].split(',').forEach(name => {
        // Handle "as" alias: import { foo as bar } from '...'
        const parts = name.trim().split(/\s+as\s+/);
        const localName = (parts[1] || parts[0]).trim();
        const importedName = parts[0].trim();
        if (localName) {
          imported.add(importedName);
          byName.set(localName, line);
        }
      });
    }
    // Default import: import foo from '...'
    if (match[2]) {
      imported.add(match[2]);
      byName.set(match[2], line);
    }
    // Namespace import: import * as foo from '...'
    if (match[3]) {
      imported.add(match[3]);
      byName.set(match[3], line);
    }
    // Additional named imports after default: import foo, { bar } from '...'
    if (match[4]) {
      match[4].split(',').forEach(name => {
        const parts = name.trim().split(/\s+as\s+/);
        const localName = (parts[1] || parts[0]).trim();
        const importedName = parts[0].trim();
        if (localName) {
          imported.add(importedName);
          byName.set(localName, line);
        }
      });
    }
  }

  // Check which imports are used in the code (excluding import statements)
  const codeWithoutImports = content.replace(/import\s+.+?from\s+['"][^'"]+['"]/gs, '');

  for (const [name] of byName) {
    // Check if the imported name is used in the code
    // Use word boundary to avoid false positives
    const usagePattern = new RegExp(`\\b${escapeRegex(name)}\\b`, 'g');
    if (usagePattern.test(codeWithoutImports)) {
      used.add(name);
    }
  }

  return { imported, used, byName };
}

/**
 * Find unused imports in a file (Task 6.8)
 */
function findUnusedImports(
  content: string,
  file: string,
  imports: { imported: Set<string>; used: Set<string>; byName: Map<string, number> },
  result: CodeQualityResult
): void {
  for (const [name, line] of imports.byName) {
    if (!imports.used.has(name)) {
      // Skip if it's a type-only import (TypeScript)
      const lineContent = content.split('\n')[line - 1] || '';
      if (lineContent.includes('import type') || lineContent.includes('type {')) {
        continue; // Type imports may be used for type checking only
      }

      result.findings.push({
        type: 'unused_import',
        file,
        line,
        message: `Import '${name}' is declared but never used`,
        severity: 'P3'
      });
      result.metrics.unused_imports++;
    }
  }
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Analyze complexity (simplified cyclomatic complexity)
 */
function analyzeComplexity(
  content: string,
  file: string,
  maxComplexity: number,
  maxNestingDepth: number,
  result: CodeQualityResult
): number[] {
  const complexities: number[] = [];

  // Simple complexity heuristics based on control flow keywords
  const complexityKeywords = /\b(if|else|for|while|do|switch|case|catch|&&|\|\||\?)\b/g;

  // Find function boundaries (simplified)
  const functionPattern = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>|(\w+)\s*\([^)]*\)\s*\{)/g;

  let match;
  functionPattern.lastIndex = 0;

  while ((match = functionPattern.exec(content)) !== null) {
    const funcName = match[1] || match[2] || match[3] || 'anonymous';
    const funcStart = match.index;

    // Find function body (simplified - just count to next function or EOF)
    const nextFunc = content.indexOf('function ', funcStart + 1);
    const funcEnd = nextFunc > 0 ? nextFunc : content.length;
    const funcBody = content.substring(funcStart, funcEnd);

    // Count complexity
    let complexity = 1; // Base complexity
    let keywordMatch;
    complexityKeywords.lastIndex = 0;
    while ((keywordMatch = complexityKeywords.exec(funcBody)) !== null) {
      complexity++;
    }

    complexities.push(complexity);

    if (complexity > maxComplexity) {
      const line = content.substring(0, funcStart).split('\n').length;
      result.findings.push({
        type: 'high_complexity',
        file,
        line,
        message: `Function '${funcName}' has complexity ${complexity} (max: ${maxComplexity})`,
        severity: 'P2',
        function_name: funcName,
        complexity
      });
      result.metrics.high_complexity_functions++;
    }

    // Check nesting depth
    const maxNesting = calculateNestingDepth(funcBody);
    if (maxNesting > maxNestingDepth) {
      const line = content.substring(0, funcStart).split('\n').length;
      result.findings.push({
        type: 'deep_nesting',
        file,
        line,
        message: `Function '${funcName}' has nesting depth ${maxNesting} (max: ${maxNestingDepth})`,
        severity: 'P3',
        function_name: funcName
      });
    }
  }

  return complexities;
}

/**
 * Calculate maximum nesting depth
 */
function calculateNestingDepth(code: string): number {
  let maxDepth = 0;
  let currentDepth = 0;

  for (const char of code) {
    if (char === '{') {
      currentDepth++;
      maxDepth = Math.max(maxDepth, currentDepth);
    } else if (char === '}') {
      currentDepth = Math.max(0, currentDepth - 1);
    }
  }

  return maxDepth;
}

/**
 * Find commented-out code blocks
 */
function findCommentedCode(content: string, file: string, result: CodeQualityResult): void {
  const lines = content.split('\n');
  let consecutiveCommentedCode = 0;
  let startLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isCommentedCode = CODE_COMMENT_PATTERNS.some(p => p.test(line));

    if (isCommentedCode) {
      if (consecutiveCommentedCode === 0) {
        startLine = i + 1;
      }
      consecutiveCommentedCode++;
    } else {
      if (consecutiveCommentedCode >= 5) {
        result.findings.push({
          type: 'commented_code',
          file,
          line: startLine,
          message: `${consecutiveCommentedCode} consecutive lines of commented-out code`,
          severity: 'P3'
        });
      }
      consecutiveCommentedCode = 0;
    }
  }
}
