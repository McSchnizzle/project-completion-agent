/**
 * Architecture Analyzer
 * Task 2.3: Architecture Pattern Analysis
 *
 * Analyzes codebase architecture:
 * - Dependency graph construction
 * - Circular dependency detection
 * - God file identification
 * - Orphan file detection
 * - Pattern compliance checking
 */

import * as fs from 'fs';
import * as path from 'path';

export interface DependencyNode {
  id: string;
  path: string;
  type: 'component' | 'page' | 'api' | 'util' | 'hook' | 'type' | 'other';
  importsCount: number;
  importedByCount: number;
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: 'import' | 're-export';
}

export interface CircularDependency {
  cycle: string[];
  severity: 'P2' | 'P3';
}

export interface ArchitectureFinding {
  type: 'circular_dependency' | 'god_file' | 'orphan_file' | 'missing_error_boundary' | 'pattern_violation' | 'missing_validation';
  severity: 'P2' | 'P3';
  file: string;
  message: string;
  details: Record<string, any> | null;
}

export interface PatternCompliance {
  patternName: string;
  compliantFiles: number;
  nonCompliantFiles: number;
  violations: string[];
}

export interface ArchitectureAnalysisResult {
  schemaVersion: string;
  analyzedAt: string;
  framework: string | null;
  architectureConfig: string | null;
  dependencyGraph: {
    nodes: DependencyNode[];
    edges: DependencyEdge[];
  };
  circularDependencies: CircularDependency[];
  findings: ArchitectureFinding[];
  patternCompliance: PatternCompliance[];
  metrics: {
    totalFiles: number;
    totalImports: number;
    circularDependencyCount: number;
    orphanFileCount: number;
    godFileCount: number;
    averageImportsPerFile: number;
    maxImportsInFile: number;
  };
}

// Framework detection patterns
const FRAMEWORK_PATTERNS = {
  next: ['next.config.js', 'next.config.mjs', 'pages/_app.tsx', 'app/layout.tsx'],
  react: ['src/App.tsx', 'src/App.jsx', 'src/index.tsx'],
  vue: ['vue.config.js', 'src/App.vue', 'nuxt.config.js'],
  svelte: ['svelte.config.js', 'src/App.svelte'],
  angular: ['angular.json', 'src/app/app.module.ts'],
  express: ['app.js', 'server.js', 'src/app.ts']
};

// File type classification patterns
const FILE_TYPE_PATTERNS: Array<[RegExp, DependencyNode['type']]> = [
  [/\/components?\/|\.component\./i, 'component'],
  [/\/pages?\/|\/app\/.*\/page\./i, 'page'],
  [/\/api\/|\.api\.|\/routes?\//i, 'api'],
  [/\/utils?\/|\/helpers?\/|\/lib\//i, 'util'],
  [/\/hooks?\/|\.hook\.|use[A-Z]/i, 'hook'],
  [/\/types?\/|\.types?\.|\.d\.ts$/i, 'type']
];

// God file thresholds
const GOD_FILE_THRESHOLDS = {
  maxImports: 20,
  maxExports: 15,
  maxImportedBy: 30
};

/**
 * Analyze codebase architecture
 */
export async function analyzeArchitecture(
  codebasePath: string,
  options: {
    excludePatterns?: string[];
    architectureConfigPath?: string;
  } = {}
): Promise<ArchitectureAnalysisResult> {
  const {
    excludePatterns = ['node_modules', 'dist', 'build', '.git', 'vendor', 'coverage', '__tests__'],
    architectureConfigPath
  } = options;

  const result: ArchitectureAnalysisResult = {
    schemaVersion: '1.0.0',
    analyzedAt: new Date().toISOString(),
    framework: null,
    architectureConfig: architectureConfigPath || null,
    dependencyGraph: {
      nodes: [],
      edges: []
    },
    circularDependencies: [],
    findings: [],
    patternCompliance: [],
    metrics: {
      totalFiles: 0,
      totalImports: 0,
      circularDependencyCount: 0,
      orphanFileCount: 0,
      godFileCount: 0,
      averageImportsPerFile: 0,
      maxImportsInFile: 0
    }
  };

  // Detect framework
  result.framework = detectFramework(codebasePath);

  // Build dependency graph
  const files = collectSourceFiles(codebasePath, excludePatterns);
  const nodeMap = new Map<string, DependencyNode>();
  const edges: DependencyEdge[] = [];
  const importedByMap = new Map<string, Set<string>>();

  for (const file of files) {
    const relativePath = path.relative(codebasePath, file);
    const nodeId = normalizeModuleId(relativePath);

    try {
      const content = fs.readFileSync(file, 'utf-8');
      const imports = extractImports(content, path.dirname(file), codebasePath);

      const node: DependencyNode = {
        id: nodeId,
        path: relativePath,
        type: classifyFile(relativePath),
        importsCount: imports.length,
        importedByCount: 0
      };

      nodeMap.set(nodeId, node);

      for (const imp of imports) {
        const normalizedImp = normalizeModuleId(imp);

        // Add edge
        edges.push({
          from: nodeId,
          to: normalizedImp,
          type: 'import'
        });

        // Track imported-by relationships
        if (!importedByMap.has(normalizedImp)) {
          importedByMap.set(normalizedImp, new Set());
        }
        importedByMap.get(normalizedImp)!.add(nodeId);
      }

      result.metrics.totalImports += imports.length;
      result.metrics.maxImportsInFile = Math.max(result.metrics.maxImportsInFile, imports.length);
    } catch {
      // Skip unreadable files
    }
  }

  // Update imported-by counts
  for (const [nodeId, importers] of importedByMap) {
    const node = nodeMap.get(nodeId);
    if (node) {
      node.importedByCount = importers.size;
    }
  }

  result.dependencyGraph.nodes = Array.from(nodeMap.values());
  result.dependencyGraph.edges = edges;
  result.metrics.totalFiles = nodeMap.size;

  if (result.metrics.totalFiles > 0) {
    result.metrics.averageImportsPerFile = Math.round(
      result.metrics.totalImports / result.metrics.totalFiles * 10
    ) / 10;
  }

  // Detect circular dependencies
  result.circularDependencies = detectCircularDependencies(nodeMap, edges);
  result.metrics.circularDependencyCount = result.circularDependencies.length;

  // Find god files
  findGodFiles(nodeMap, result);

  // Find orphan files
  findOrphanFiles(nodeMap, importedByMap, result);

  // Check for missing error boundaries (React)
  if (result.framework === 'react' || result.framework === 'next') {
    checkErrorBoundaries(codebasePath, files, result);
  }

  // Convert circular dependencies to findings
  for (const cycle of result.circularDependencies) {
    result.findings.push({
      type: 'circular_dependency',
      severity: cycle.severity,
      file: cycle.cycle[0],
      message: `Circular dependency: ${cycle.cycle.join(' → ')} → ${cycle.cycle[0]}`,
      details: { cycle: cycle.cycle }
    });
  }

  return result;
}

/**
 * Detect project framework
 */
function detectFramework(codebasePath: string): string | null {
  for (const [framework, patterns] of Object.entries(FRAMEWORK_PATTERNS)) {
    for (const pattern of patterns) {
      if (fs.existsSync(path.join(codebasePath, pattern))) {
        return framework;
      }
    }
  }

  // Check package.json dependencies
  const packageJsonPath = path.join(codebasePath, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (deps.next) return 'next';
      if (deps.react) return 'react';
      if (deps.vue || deps.nuxt) return 'vue';
      if (deps.svelte) return 'svelte';
      if (deps['@angular/core']) return 'angular';
      if (deps.express) return 'express';
    } catch {
      // Ignore parse errors
    }
  }

  return null;
}

/**
 * Collect source files
 */
function collectSourceFiles(dir: string, excludePatterns: string[]): string[] {
  const files: string[] = [];
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.vue', '.svelte'];

  function walk(currentDir: string) {
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const shouldExclude = excludePatterns.some(p =>
          entry.name === p || fullPath.includes(`/${p}/`) || fullPath.includes(`\\${p}\\`)
        );

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
 * Extract imports from file content
 */
function extractImports(content: string, fileDir: string, codebasePath: string): string[] {
  const imports: string[] = [];

  // ES module imports
  const importPattern = /import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;

  while ((match = importPattern.exec(content)) !== null) {
    const importPath = match[1];

    // Skip external packages
    if (!importPath.startsWith('.') && !importPath.startsWith('/') && !importPath.startsWith('@/')) {
      continue;
    }

    // Resolve relative imports
    let resolvedPath = importPath;
    if (importPath.startsWith('.')) {
      resolvedPath = path.relative(codebasePath, path.resolve(fileDir, importPath));
    } else if (importPath.startsWith('@/')) {
      resolvedPath = importPath.replace('@/', 'src/');
    }

    imports.push(resolvedPath);
  }

  // CommonJS requires
  const requirePattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requirePattern.exec(content)) !== null) {
    const importPath = match[1];
    if (importPath.startsWith('.')) {
      const resolvedPath = path.relative(codebasePath, path.resolve(fileDir, importPath));
      imports.push(resolvedPath);
    }
  }

  return imports;
}

/**
 * Normalize module ID (remove extension, handle index files)
 */
function normalizeModuleId(filePath: string): string {
  return filePath
    .replace(/\.(ts|tsx|js|jsx|mjs|vue|svelte)$/, '')
    .replace(/\/index$/, '')
    .replace(/\\/g, '/');
}

/**
 * Classify file type based on path patterns
 */
function classifyFile(filePath: string): DependencyNode['type'] {
  for (const [pattern, type] of FILE_TYPE_PATTERNS) {
    if (pattern.test(filePath)) {
      return type;
    }
  }
  return 'other';
}

/**
 * Detect circular dependencies using DFS
 */
function detectCircularDependencies(
  nodes: Map<string, DependencyNode>,
  edges: DependencyEdge[]
): CircularDependency[] {
  const cycles: CircularDependency[] = [];
  const adjacencyList = new Map<string, string[]>();

  // Build adjacency list
  for (const edge of edges) {
    if (!adjacencyList.has(edge.from)) {
      adjacencyList.set(edge.from, []);
    }
    adjacencyList.get(edge.from)!.push(edge.to);
  }

  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  function dfs(nodeId: string): void {
    if (recursionStack.has(nodeId)) {
      // Found cycle
      const cycleStart = path.indexOf(nodeId);
      const cycle = path.slice(cycleStart);

      // Avoid duplicate cycles
      const cycleKey = [...cycle].sort().join(',');
      const isDuplicate = cycles.some(c => [...c.cycle].sort().join(',') === cycleKey);

      if (!isDuplicate && cycle.length > 0) {
        cycles.push({
          cycle,
          severity: cycle.length > 3 ? 'P2' : 'P3'
        });
      }
      return;
    }

    if (visited.has(nodeId)) return;

    visited.add(nodeId);
    recursionStack.add(nodeId);
    path.push(nodeId);

    const neighbors = adjacencyList.get(nodeId) || [];
    for (const neighbor of neighbors) {
      // Only follow internal imports
      if (nodes.has(neighbor)) {
        dfs(neighbor);
      }
    }

    path.pop();
    recursionStack.delete(nodeId);
  }

  for (const nodeId of nodes.keys()) {
    if (!visited.has(nodeId)) {
      dfs(nodeId);
    }
  }

  return cycles;
}

/**
 * Find god files (files that do too much)
 */
function findGodFiles(nodes: Map<string, DependencyNode>, result: ArchitectureAnalysisResult): void {
  for (const node of nodes.values()) {
    const isGodFile =
      node.importsCount > GOD_FILE_THRESHOLDS.maxImports ||
      node.importedByCount > GOD_FILE_THRESHOLDS.maxImportedBy;

    if (isGodFile) {
      result.findings.push({
        type: 'god_file',
        severity: 'P2',
        file: node.path,
        message: `File has too many dependencies (imports: ${node.importsCount}, imported by: ${node.importedByCount})`,
        details: {
          imports: node.importsCount,
          importedBy: node.importedByCount,
          thresholds: GOD_FILE_THRESHOLDS
        }
      });
      result.metrics.godFileCount++;
    }
  }
}

/**
 * Find orphan files (files that are not imported anywhere)
 */
function findOrphanFiles(
  nodes: Map<string, DependencyNode>,
  importedByMap: Map<string, Set<string>>,
  result: ArchitectureAnalysisResult
): void {
  // Entry points that are allowed to be orphans
  const entryPointPatterns = [
    /index\.(ts|tsx|js|jsx)$/,
    /main\.(ts|tsx|js|jsx)$/,
    /app\.(ts|tsx|js|jsx)$/,
    /server\.(ts|tsx|js|jsx)$/,
    /\/pages?\//,
    /\/app\//,
    /\.config\./,
    /\.test\./,
    /\.spec\./
  ];

  for (const node of nodes.values()) {
    const isImported = (importedByMap.get(node.id)?.size || 0) > 0;
    const isEntryPoint = entryPointPatterns.some(p => p.test(node.path));

    if (!isImported && !isEntryPoint && node.type !== 'page' && node.type !== 'api') {
      result.findings.push({
        type: 'orphan_file',
        severity: 'P3',
        file: node.path,
        message: 'File is not imported anywhere and may be dead code',
        details: { type: node.type }
      });
      result.metrics.orphanFileCount++;
    }
  }
}

/**
 * Check for missing error boundaries in React apps
 */
function checkErrorBoundaries(
  codebasePath: string,
  files: string[],
  result: ArchitectureAnalysisResult
): void {
  // Look for error boundary implementations
  let hasErrorBoundary = false;

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      if (/componentDidCatch|ErrorBoundary|error-boundary/i.test(content)) {
        hasErrorBoundary = true;
        break;
      }
    } catch {
      // Skip unreadable files
    }
  }

  if (!hasErrorBoundary) {
    result.findings.push({
      type: 'missing_error_boundary',
      severity: 'P2',
      file: 'src/',
      message: 'No React Error Boundary found in the application',
      details: {
        recommendation: 'Add an ErrorBoundary component to gracefully handle runtime errors'
      }
    });
  }
}
