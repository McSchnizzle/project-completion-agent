/**
 * Code Analysis Phase - Static analysis with route/form discovery.
 *
 * Performs pure-TypeScript static analysis on a codebase to discover:
 * - Framework type (Next.js, Express, FastAPI, etc.)
 * - Routes (pages router, app router, Express routes, React Router)
 * - HTML forms with field extraction
 * - Language distribution and file/line counts
 * - Optional PRD feature mapping via Claude SDK bridge
 *
 * Produces code-analysis.json matching the pipeline schema.
 *
 * @module phases/code-analysis
 */

import fs from 'node:fs';
import path from 'node:path';
import { getCodeAnalysisPath, getPrdSummaryPath } from '../artifact-paths.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CodeAnalysisConfig {
  auditDir: string;
  codebasePath: string;
  prdMappingPromptPath?: string;
}

export interface RouteInfo {
  path: string;
  method: string;
  file: string;
  component?: string;
  parameters?: string[];
  authRequired?: boolean;
}

export interface FormFieldInfo {
  name: string;
  type: string;
  required: boolean;
}

export interface FormInfo {
  id: string;
  action: string;
  method: string;
  fields: FormFieldInfo[];
  file: string;
}

export interface PrdMapping {
  routePath: string;
  featureId: string;
  confidence: number;
}

export interface CodeAnalysisResult {
  routes: RouteInfo[];
  forms: FormInfo[];
  framework?: string;
  languages: string[];
  filesAnalyzed: number;
  linesOfCode: number;
  prdMapping?: PrdMapping[];
  errors: string[];
}

type SDKBridge = (phaseConfig: {
  phaseName: string;
  promptPath: string;
  inputContext: Record<string, unknown>;
  requiresBrowser: boolean;
  maxRetries: number;
  budgetUsd: number;
}) => Promise<{ success: boolean; output: unknown; error?: string }>;

// Directories to skip during recursive traversal
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  '.cache', 'coverage', '.turbo', '.vercel',
]);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Run code analysis phase.
 *
 * @param config - Code analysis configuration.
 * @param runClaudePhase - SDK bridge (optional, for PRD mapping).
 * @returns Analysis results.
 */
export async function runCodeAnalysis(
  config: CodeAnalysisConfig,
  runClaudePhase?: SDKBridge,
): Promise<CodeAnalysisResult> {
  const result: CodeAnalysisResult = {
    routes: [],
    forms: [],
    languages: [],
    filesAnalyzed: 0,
    linesOfCode: 0,
    errors: [],
  };

  console.log(`[CodeAnalysis] Analyzing ${config.codebasePath}...`);

  try {
    const staticResult = analyzeCodebase(config.codebasePath);
    result.routes = staticResult.routes;
    result.forms = staticResult.forms;
    result.framework = staticResult.framework;
    result.languages = staticResult.languages;
    result.filesAnalyzed = staticResult.filesAnalyzed;
    result.linesOfCode = staticResult.linesOfCode;
  } catch (e) {
    result.errors.push(`Static analysis failed: ${e}`);
  }

  // Optional: PRD feature mapping via Claude
  if (runClaudePhase && config.prdMappingPromptPath) {
    const prdData = loadPrdSummary(config.auditDir);
    if (prdData && result.routes.length > 0) {
      try {
        const mappingResult = await runClaudePhase({
          phaseName: 'code-analysis-prd-mapping',
          promptPath: config.prdMappingPromptPath,
          inputContext: {
            routes: result.routes,
            features: prdData.features ?? [],
          },
          requiresBrowser: false,
          maxRetries: 1,
          budgetUsd: 0.3,
        });

        if (mappingResult.success && mappingResult.output) {
          const output = mappingResult.output as Record<string, unknown>;
          if (Array.isArray(output.mappings)) {
            result.prdMapping = output.mappings as PrdMapping[];
          }
        }
      } catch (e) {
        result.errors.push(`PRD mapping failed: ${e}`);
      }
    }
  }

  // Write results atomically
  const outputData = {
    analyzed_at: new Date().toISOString(),
    codebase_path: config.codebasePath,
    ...result,
  };

  const outPath = getCodeAnalysisPath(config.auditDir);
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = outPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(outputData, null, 2), 'utf-8');
  fs.renameSync(tmpPath, outPath);

  console.log(
    `[CodeAnalysis] Complete: ${result.routes.length} routes, ${result.forms.length} forms, ${result.filesAnalyzed} files.`,
  );

  return result;
}

// ---------------------------------------------------------------------------
// Top-level analysis orchestrator
// ---------------------------------------------------------------------------

interface StaticResult {
  routes: RouteInfo[];
  forms: FormInfo[];
  framework?: string;
  languages: string[];
  filesAnalyzed: number;
  linesOfCode: number;
}

function analyzeCodebase(codebasePath: string): StaticResult {
  const result: StaticResult = {
    routes: [],
    forms: [],
    languages: [],
    filesAnalyzed: 0,
    linesOfCode: 0,
  };

  if (!fs.existsSync(codebasePath)) return result;

  // Detect framework
  result.framework = detectFramework(codebasePath);

  // Count files and detect languages
  const langSet = new Set<string>();
  const sourceFiles = collectSourceFiles(codebasePath, langSet, result);
  result.languages = [...langSet];

  // Extract routes based on framework
  if (result.framework === 'nextjs') {
    result.routes.push(...extractNextJsRoutes(codebasePath));
  } else if (result.framework === 'express' || result.framework === 'fastify') {
    result.routes.push(...extractExpressRoutes(sourceFiles));
  }
  // React Router (when not Next.js)
  if (result.framework === 'react') {
    result.routes.push(...extractReactRouterRoutes(sourceFiles));
  }
  // FastAPI / Python routes
  if (result.framework === 'fastapi') {
    result.routes.push(...extractFastAPIRoutes(sourceFiles));
  }

  // Extract forms from all source files
  result.forms = extractForms(sourceFiles);

  return result;
}

// ---------------------------------------------------------------------------
// Framework detection
// ---------------------------------------------------------------------------

function detectFramework(codebasePath: string): string | undefined {
  // Check package.json at root or in subdirectories
  const pkgPaths = [
    path.join(codebasePath, 'package.json'),
    path.join(codebasePath, 'apps', 'frontend', 'package.json'),
    path.join(codebasePath, 'frontend', 'package.json'),
  ];

  for (const pkgPath of pkgPaths) {
    if (!fs.existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.next) return 'nextjs';
      if (deps.express) return 'express';
      if (deps.fastify) return 'fastify';
      if (deps['react-router-dom'] || deps['react-router']) return 'react';
      if (deps.react) return 'react';
      if (deps.vue) return 'vue';
      if (deps.svelte || deps['@sveltejs/kit']) return 'svelte';
    } catch {
      // skip
    }
  }

  // Check for next.config files
  for (const name of ['next.config.js', 'next.config.mjs', 'next.config.ts']) {
    if (fs.existsSync(path.join(codebasePath, name))) return 'nextjs';
  }

  // Check for Python web frameworks
  const reqPath = path.join(codebasePath, 'requirements.txt');
  if (fs.existsSync(reqPath)) {
    try {
      const content = fs.readFileSync(reqPath, 'utf-8');
      if (/fastapi/i.test(content)) return 'fastapi';
      if (/flask/i.test(content)) return 'flask';
      if (/django/i.test(content)) return 'django';
    } catch {
      // skip
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Source file collection
// ---------------------------------------------------------------------------

const SOURCE_EXTENSIONS = new Map<string, string>([
  ['.ts', 'typescript'], ['.tsx', 'typescript'],
  ['.js', 'javascript'], ['.jsx', 'javascript'],
  ['.py', 'python'], ['.go', 'go'],
  ['.css', 'css'], ['.scss', 'scss'],
  ['.html', 'html'],
]);

function collectSourceFiles(
  dir: string,
  langSet: Set<string>,
  stats: { filesAnalyzed: number; linesOfCode: number },
  depth = 0,
  collected: string[] = [],
): string[] {
  if (depth > 8) return collected;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return collected;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      collectSourceFiles(path.join(dir, entry.name), langSet, stats, depth + 1, collected);
      continue;
    }

    const ext = path.extname(entry.name);
    const lang = SOURCE_EXTENSIONS.get(ext);
    if (lang) {
      langSet.add(lang);
      stats.filesAnalyzed++;
      const filePath = path.join(dir, entry.name);
      collected.push(filePath);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        stats.linesOfCode += content.split('\n').length;
      } catch {
        // skip unreadable files
      }
    }
  }

  return collected;
}

// ---------------------------------------------------------------------------
// Next.js route extraction
// ---------------------------------------------------------------------------

function extractNextJsRoutes(codebasePath: string): RouteInfo[] {
  const routes: RouteInfo[] = [];

  // Scan all possible page/app directories
  const dirs = [
    { dir: path.join(codebasePath, 'pages'), type: 'pages' as const },
    { dir: path.join(codebasePath, 'src', 'pages'), type: 'pages' as const },
    { dir: path.join(codebasePath, 'app'), type: 'app' as const },
    { dir: path.join(codebasePath, 'src', 'app'), type: 'app' as const },
    // Monorepo patterns
    { dir: path.join(codebasePath, 'apps', 'frontend', 'pages'), type: 'pages' as const },
    { dir: path.join(codebasePath, 'apps', 'frontend', 'app'), type: 'app' as const },
  ];

  for (const { dir, type } of dirs) {
    if (!fs.existsSync(dir)) continue;
    if (type === 'pages') {
      scanPagesRouter(dir, '', routes);
    } else {
      scanAppRouter(dir, '', routes);
    }
  }

  return routes;
}

/**
 * Scan Next.js pages/ directory for routes.
 */
function scanPagesRouter(dir: string, basePath: string, routes: RouteInfo[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name.startsWith('_') || entry.name === 'components' || entry.name === 'lib') {
        continue;
      }
      // Dynamic segments: [id] -> :id
      let segment = entry.name;
      const params: string[] = [];
      if (entry.name.startsWith('[') && entry.name.endsWith(']')) {
        const param = entry.name.slice(1, -1);
        segment = `:${param}`;
        params.push(param);
      }
      scanPagesRouter(fullPath, `${basePath}/${segment}`, routes);
      continue;
    }

    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (!['.tsx', '.ts', '.jsx', '.js'].includes(ext)) continue;

    const basename = path.basename(entry.name, ext);
    if (basename.startsWith('_')) continue; // _app, _document, etc.

    // Determine if this is an API route
    const isApi = basePath.startsWith('/api') || basePath === '/api';

    if (basename === 'index') {
      routes.push(makePageRoute(basePath || '/', fullPath, isApi));
    } else {
      routes.push(makePageRoute(`${basePath}/${basename}`, fullPath, isApi));
    }
  }
}

/**
 * Scan Next.js app/ directory for routes.
 */
function scanAppRouter(dir: string, basePath: string, routes: RouteInfo[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name.startsWith('_') || entry.name === 'components' || entry.name === 'lib') {
        continue;
      }
      let segment = entry.name;
      if (entry.name.startsWith('[') && entry.name.endsWith(']')) {
        segment = `:${entry.name.slice(1, -1)}`;
      }
      // Route groups: (group) don't add to path
      if (entry.name.startsWith('(') && entry.name.endsWith(')')) {
        scanAppRouter(fullPath, basePath, routes);
      } else {
        scanAppRouter(fullPath, `${basePath}/${segment}`, routes);
      }
      continue;
    }

    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (!['.tsx', '.ts', '.jsx', '.js'].includes(ext)) continue;

    const basename = path.basename(entry.name, ext);

    if (basename === 'page') {
      routes.push(makePageRoute(basePath || '/', fullPath, false));
    } else if (basename === 'route') {
      // API route handler - detect methods
      const methods = detectExportedMethods(fullPath);
      for (const method of methods) {
        routes.push({
          path: basePath || '/',
          method,
          file: fullPath,
          parameters: extractParamsFromPath(basePath),
        });
      }
    }
  }
}

function makePageRoute(routePath: string, file: string, isApi: boolean): RouteInfo {
  return {
    path: routePath,
    method: isApi ? 'API' : 'GET',
    file,
    parameters: extractParamsFromPath(routePath),
    authRequired: detectAuthInFile(file),
  };
}

// ---------------------------------------------------------------------------
// Express/Fastify route extraction
// ---------------------------------------------------------------------------

function extractExpressRoutes(sourceFiles: string[]): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const routePattern = /\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

  for (const file of sourceFiles) {
    if (!isRouteFile(file)) continue;
    try {
      const content = fs.readFileSync(file, 'utf-8');
      let match;
      while ((match = routePattern.exec(content)) !== null) {
        routes.push({
          path: match[2],
          method: match[1].toUpperCase(),
          file,
          parameters: extractParamsFromPath(match[2]),
        });
      }
      routePattern.lastIndex = 0;
    } catch {
      // skip unreadable
    }
  }

  return routes;
}

function isRouteFile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return /route|router|controller|endpoint|api|handler/i.test(base) ||
    /\/(routes?|api|controllers?|handlers?)\//i.test(filePath);
}

// ---------------------------------------------------------------------------
// React Router route extraction
// ---------------------------------------------------------------------------

function extractReactRouterRoutes(sourceFiles: string[]): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const routePattern = /<Route[^>]*path=["'`]([^"'`]+)["'`]/gi;

  for (const file of sourceFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      let match;
      while ((match = routePattern.exec(content)) !== null) {
        routes.push({
          path: match[1],
          method: 'GET',
          file,
          parameters: extractParamsFromPath(match[1]),
        });
      }
      routePattern.lastIndex = 0;
    } catch {
      // skip
    }
  }

  return routes;
}

// ---------------------------------------------------------------------------
// FastAPI route extraction
// ---------------------------------------------------------------------------

function extractFastAPIRoutes(sourceFiles: string[]): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const decoratorPattern = /@(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/gi;

  for (const file of sourceFiles) {
    if (!file.endsWith('.py')) continue;
    try {
      const content = fs.readFileSync(file, 'utf-8');
      let match;
      while ((match = decoratorPattern.exec(content)) !== null) {
        routes.push({
          path: match[2],
          method: match[1].toUpperCase(),
          file,
          parameters: extractParamsFromPath(match[2]),
        });
      }
      decoratorPattern.lastIndex = 0;
    } catch {
      // skip
    }
  }

  return routes;
}

// ---------------------------------------------------------------------------
// Form extraction
// ---------------------------------------------------------------------------

function extractForms(sourceFiles: string[]): FormInfo[] {
  const forms: FormInfo[] = [];
  let formCounter = 0;

  for (const file of sourceFiles) {
    const ext = path.extname(file);
    if (!['.tsx', '.jsx', '.html', '.ts', '.js'].includes(ext)) continue;

    try {
      const content = fs.readFileSync(file, 'utf-8');
      const formPattern = /<form[^>]*>/gi;
      let match;

      while ((match = formPattern.exec(content)) !== null) {
        const formTag = match[0];
        const action = extractAttribute(formTag, 'action') ?? '';
        const method = (extractAttribute(formTag, 'method') ?? 'GET').toUpperCase();

        // Find closing </form> and extract fields
        const formStart = match.index;
        const formEnd = findClosingTag(content, formStart, 'form');
        const formContent = content.substring(formStart, formEnd);
        const fields = extractFormFields(formContent);

        formCounter++;
        forms.push({
          id: `form-${formCounter}`,
          action,
          method,
          fields,
          file,
        });
      }
    } catch {
      // skip
    }
  }

  return forms;
}

function extractAttribute(tag: string, attr: string): string | null {
  // Handle both quotes and JSX expressions
  const patterns = [
    new RegExp(`${attr}=["']([^"']*)["']`, 'i'),
    new RegExp(`${attr}=\\{["']([^"']*)["']\\}`, 'i'),
  ];
  for (const pattern of patterns) {
    const m = tag.match(pattern);
    if (m) return m[1];
  }
  return null;
}

function findClosingTag(content: string, startIndex: number, tagName: string): number {
  let depth = 1;
  let index = startIndex + 1;
  const openRe = new RegExp(`<${tagName}[^>]*>`, 'gi');
  const closeRe = new RegExp(`</${tagName}>`, 'gi');

  while (depth > 0 && index < content.length) {
    openRe.lastIndex = index;
    closeRe.lastIndex = index;

    const nextOpen = openRe.exec(content);
    const nextClose = closeRe.exec(content);

    if (!nextClose) break;

    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      index = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      index = nextClose.index + nextClose[0].length;
    }
  }

  return index;
}

function extractFormFields(formContent: string): FormFieldInfo[] {
  const fields: FormFieldInfo[] = [];
  const inputPattern = /<(input|select|textarea)[^>]*>/gi;
  let match;

  while ((match = inputPattern.exec(formContent)) !== null) {
    const tag = match[0];
    const name = extractAttribute(tag, 'name');
    if (!name) continue;

    fields.push({
      name,
      type: extractAttribute(tag, 'type') ?? (match[1] === 'select' ? 'select' : 'text'),
      required: /\brequired\b/i.test(tag),
    });
  }

  return fields;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractParamsFromPath(routePath: string): string[] {
  const params: string[] = [];
  const matches = routePath.match(/:([^/]+)/g);
  if (matches) {
    for (const m of matches) {
      params.push(m.substring(1));
    }
  }
  // Also catch Next.js bracket notation that wasn't yet converted
  const bracketMatches = routePath.match(/\[([^\]]+)\]/g);
  if (bracketMatches) {
    for (const m of bracketMatches) {
      params.push(m.slice(1, -1));
    }
  }
  return params;
}

function detectExportedMethods(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const methods: string[] = [];
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      if (new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`, 'i').test(content)) {
        methods.push(method);
      }
    }
    return methods.length > 0 ? methods : ['GET'];
  } catch {
    return ['GET'];
  }
}

function detectAuthInFile(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return /useSession|getServerSession|withAuth|requireAuth|isAuthenticated|checkAuth|middleware.*auth/i.test(content);
  } catch {
    return false;
  }
}

function loadPrdSummary(auditDir: string): Record<string, unknown> | null {
  const prdPath = getPrdSummaryPath(auditDir);
  if (!fs.existsSync(prdPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(prdPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Load a previously written code analysis from disk.
 */
export function loadCodeAnalysis(auditDir: string): CodeAnalysisResult | null {
  const analysisPath = getCodeAnalysisPath(auditDir);
  if (!fs.existsSync(analysisPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(analysisPath, 'utf-8')) as CodeAnalysisResult;
  } catch {
    return null;
  }
}
