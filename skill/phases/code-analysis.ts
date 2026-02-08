/**
 * Code Analysis Phase - Static Code Analysis Integration
 * Task B.4: Code Analysis Integration
 *
 * Orchestrates static code analysis to discover routes, forms,
 * API endpoints, and map features to code locations.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  analyzeArchitecture,
  ArchitectureAnalysisResult
} from '../analyzers/architecture-analyzer';
import {
  analyzeCodeQuality,
  CodeQualityResult
} from '../analyzers/code-quality';
import {
  scanSecurity,
  SecurityScanResult
} from '../analyzers/security-scanner';
import { PrdFeature } from '../comparison/prd-parser';

export interface RouteInfo {
  path: string;
  method: string;
  handler: string;
  source_file: string;
  line_number: number;
  parameters: string[];
  auth_required: boolean;
}

export interface FormInfo {
  id: string;
  action: string;
  method: string;
  source_file: string;
  line_number: number;
  fields: FormFieldInfo[];
  submit_handler: string | null;
}

export interface FormFieldInfo {
  name: string;
  type: string;
  required: boolean;
  validation: string | null;
}

export interface ApiEndpoint {
  path: string;
  method: string;
  handler: string;
  source_file: string;
  request_schema: string | null;
  response_schema: string | null;
}

export interface FeatureRouteMapping {
  feature_id: string;
  feature_name: string;
  matched_routes: string[];
  matched_endpoints: string[];
  confidence: number;
}

export interface CodeAnalysisResult {
  schema_version: string;
  analyzed_at: string;
  project_root: string;
  framework: string;
  framework_version: string | null;
  routes: RouteInfo[];
  forms: FormInfo[];
  api_endpoints: ApiEndpoint[];
  feature_mapping: FeatureRouteMapping[];
  quality_issues: CodeQualityResult | null;
  security_issues: SecurityScanResult | null;
  architecture: ArchitectureAnalysisResult | null;
  stats: {
    files_analyzed: number;
    routes_found: number;
    forms_found: number;
    api_endpoints_found: number;
  };
}

/**
 * Run full code analysis on a project
 */
export async function runCodeAnalysis(
  projectRoot: string,
  prdFeatures: PrdFeature[] = []
): Promise<CodeAnalysisResult> {
  const startTime = Date.now();

  // Detect framework and analyze architecture
  const architecture = await analyzeArchitecture(projectRoot);
  const framework = architecture.framework || 'unknown';

  // Extract routes based on framework
  const routes = await extractRoutes(projectRoot, framework);

  // Extract forms from code
  const forms = await extractForms(projectRoot, framework);

  // Extract API endpoints
  const apiEndpoints = await extractApiEndpoints(projectRoot, framework);

  // Map features to routes/endpoints
  const featureMapping = mapFeaturesToCode(prdFeatures, routes, apiEndpoints);

  // Run code quality analysis
  let qualityIssues: CodeQualityResult | null = null;
  try {
    qualityIssues = await analyzeCodeQuality(projectRoot);
  } catch {
    // Quality analysis is optional
  }

  // Run security scan
  let securityIssues: SecurityScanResult | null = null;
  try {
    securityIssues = await scanSecurity(projectRoot);
  } catch {
    // Security scan is optional
  }

  return {
    schema_version: '1.0.0',
    analyzed_at: new Date().toISOString(),
    project_root: projectRoot,
    framework,
    framework_version: null,
    routes,
    forms,
    api_endpoints: apiEndpoints,
    feature_mapping: featureMapping,
    quality_issues: qualityIssues,
    security_issues: securityIssues,
    architecture,
    stats: {
      files_analyzed: architecture.metrics?.totalFiles || 0,
      routes_found: routes.length,
      forms_found: forms.length,
      api_endpoints_found: apiEndpoints.length
    }
  };
}

/**
 * Extract routes from project based on framework
 */
async function extractRoutes(projectRoot: string, framework: string): Promise<RouteInfo[]> {
  const routes: RouteInfo[] = [];

  if (framework.includes('next')) {
    routes.push(...await extractNextJsRoutes(projectRoot));
  } else if (framework.includes('express')) {
    routes.push(...await extractExpressRoutes(projectRoot));
  } else if (framework.includes('react')) {
    routes.push(...await extractReactRouterRoutes(projectRoot));
  }

  return routes;
}

/**
 * Extract Next.js app router and pages router routes
 */
async function extractNextJsRoutes(projectRoot: string): Promise<RouteInfo[]> {
  const routes: RouteInfo[] = [];

  // App Router (app directory)
  const appDir = path.join(projectRoot, 'app');
  if (fs.existsSync(appDir)) {
    await scanDirectoryForRoutes(appDir, '', routes, 'app-router');
  }

  // Pages Router (pages directory)
  const pagesDir = path.join(projectRoot, 'pages');
  if (fs.existsSync(pagesDir)) {
    await scanDirectoryForRoutes(pagesDir, '', routes, 'pages-router');
  }

  // Also check src/app and src/pages
  const srcAppDir = path.join(projectRoot, 'src', 'app');
  if (fs.existsSync(srcAppDir)) {
    await scanDirectoryForRoutes(srcAppDir, '', routes, 'app-router');
  }

  const srcPagesDir = path.join(projectRoot, 'src', 'pages');
  if (fs.existsSync(srcPagesDir)) {
    await scanDirectoryForRoutes(srcPagesDir, '', routes, 'pages-router');
  }

  return routes;
}

/**
 * Scan directory for route files
 */
async function scanDirectoryForRoutes(
  dir: string,
  basePath: string,
  routes: RouteInfo[],
  routerType: string
): Promise<void> {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip special directories
      if (entry.name.startsWith('_') || entry.name === 'components' || entry.name === 'lib') {
        continue;
      }

      // Handle dynamic routes [param]
      let routeSegment = entry.name;
      if (entry.name.startsWith('[') && entry.name.endsWith(']')) {
        routeSegment = `:${entry.name.slice(1, -1)}`;
      }

      await scanDirectoryForRoutes(fullPath, `${basePath}/${routeSegment}`, routes, routerType);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      const basename = path.basename(entry.name, ext);

      if (['.tsx', '.ts', '.jsx', '.js'].includes(ext)) {
        if (routerType === 'app-router' && basename === 'page') {
          routes.push({
            path: basePath || '/',
            method: 'GET',
            handler: `${basename}${ext}`,
            source_file: fullPath,
            line_number: 1,
            parameters: extractRouteParams(basePath),
            auth_required: await detectAuthRequired(fullPath)
          });
        } else if (routerType === 'pages-router' && !basename.startsWith('_')) {
          const routePath = basename === 'index' ? basePath || '/' : `${basePath}/${basename}`;
          routes.push({
            path: routePath,
            method: 'GET',
            handler: entry.name,
            source_file: fullPath,
            line_number: 1,
            parameters: extractRouteParams(routePath),
            auth_required: await detectAuthRequired(fullPath)
          });
        }

        // API routes
        if (routerType === 'app-router' && basename === 'route') {
          const methods = await detectApiMethods(fullPath);
          for (const method of methods) {
            routes.push({
              path: basePath,
              method,
              handler: `${basename}${ext}`,
              source_file: fullPath,
              line_number: 1,
              parameters: extractRouteParams(basePath),
              auth_required: await detectAuthRequired(fullPath)
            });
          }
        }
      }
    }
  }
}

/**
 * Extract route parameters from path
 */
function extractRouteParams(routePath: string): string[] {
  const params: string[] = [];
  const matches = routePath.match(/:([^/]+)/g);
  if (matches) {
    for (const match of matches) {
      params.push(match.substring(1));
    }
  }
  return params;
}

/**
 * Detect if a route requires authentication
 */
async function detectAuthRequired(filePath: string): Promise<boolean> {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const authPatterns = [
      /useSession/,
      /getServerSession/,
      /withAuth/,
      /requireAuth/,
      /isAuthenticated/,
      /checkAuth/,
      /middleware.*auth/i
    ];
    return authPatterns.some(pattern => pattern.test(content));
  } catch {
    return false;
  }
}

/**
 * Detect HTTP methods in API route file
 */
async function detectApiMethods(filePath: string): Promise<string[]> {
  const methods: string[] = [];
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const httpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
    for (const method of httpMethods) {
      if (new RegExp(`export\\s+(async\\s+)?function\\s+${method}`, 'i').test(content)) {
        methods.push(method);
      }
    }
  } catch {
    // Ignore read errors
  }
  return methods.length > 0 ? methods : ['GET'];
}

/**
 * Extract Express routes
 */
async function extractExpressRoutes(projectRoot: string): Promise<RouteInfo[]> {
  const routes: RouteInfo[] = [];
  const routeFiles = findFiles(projectRoot, /routes?\.([tj]sx?|mjs)$/);

  for (const file of routeFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const routePattern = /\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
      let match;

      while ((match = routePattern.exec(content)) !== null) {
        routes.push({
          path: match[2],
          method: match[1].toUpperCase(),
          handler: 'inline',
          source_file: file,
          line_number: content.substring(0, match.index).split('\n').length,
          parameters: extractRouteParams(match[2]),
          auth_required: false
        });
      }
    } catch {
      // Ignore read errors
    }
  }

  return routes;
}

/**
 * Extract React Router routes
 */
async function extractReactRouterRoutes(projectRoot: string): Promise<RouteInfo[]> {
  const routes: RouteInfo[] = [];
  const routeFiles = findFiles(projectRoot, /(router|routes|App)\.[tj]sx?$/);

  for (const file of routeFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      // Match Route components with path attribute
      const routePattern = /<Route[^>]*path=["'`]([^"'`]+)["'`]/gi;
      let match;

      while ((match = routePattern.exec(content)) !== null) {
        routes.push({
          path: match[1],
          method: 'GET',
          handler: 'component',
          source_file: file,
          line_number: content.substring(0, match.index).split('\n').length,
          parameters: extractRouteParams(match[1]),
          auth_required: false
        });
      }
    } catch {
      // Ignore read errors
    }
  }

  return routes;
}

/**
 * Extract forms from code
 */
async function extractForms(projectRoot: string, framework: string): Promise<FormInfo[]> {
  const forms: FormInfo[] = [];
  const componentFiles = findFiles(projectRoot, /\.(tsx?|jsx?)$/);

  let formCounter = 0;

  for (const file of componentFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');

      // Match <form> elements
      const formPattern = /<form[^>]*>/gi;
      let match;

      while ((match = formPattern.exec(content)) !== null) {
        const formTag = match[0];
        const action = extractAttribute(formTag, 'action') || '';
        const method = extractAttribute(formTag, 'method') || 'GET';

        // Find form end and extract fields
        const formStartIndex = match.index;
        const formEndIndex = findClosingTag(content, formStartIndex, 'form');
        const formContent = content.substring(formStartIndex, formEndIndex);

        forms.push({
          id: `form-${++formCounter}`,
          action,
          method: method.toUpperCase(),
          source_file: file,
          line_number: content.substring(0, formStartIndex).split('\n').length,
          fields: extractFormFields(formContent),
          submit_handler: extractAttribute(formTag, 'onSubmit') || null
        });
      }
    } catch {
      // Ignore read errors
    }
  }

  return forms;
}

/**
 * Extract attribute value from HTML tag
 */
function extractAttribute(tag: string, attr: string): string | null {
  const pattern = new RegExp(attr + '=["\']([^"\']*)["\']', 'i');
  const match = tag.match(pattern);
  return match ? match[1] : null;
}

/**
 * Find closing tag index
 */
function findClosingTag(content: string, startIndex: number, tagName: string): number {
  let depth = 1;
  let index = startIndex + 1;

  while (depth > 0 && index < content.length) {
    const openPattern = new RegExp(`<${tagName}[^>]*>`, 'gi');
    const closePattern = new RegExp(`</${tagName}>`, 'gi');

    openPattern.lastIndex = index;
    closePattern.lastIndex = index;

    const nextOpen = openPattern.exec(content);
    const nextClose = closePattern.exec(content);

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

/**
 * Extract form fields from form content
 */
function extractFormFields(formContent: string): FormFieldInfo[] {
  const fields: FormFieldInfo[] = [];
  const inputPattern = /<(input|select|textarea)[^>]*>/gi;
  let match;

  while ((match = inputPattern.exec(formContent)) !== null) {
    const tag = match[0];
    const name = extractAttribute(tag, 'name');

    if (name) {
      fields.push({
        name,
        type: extractAttribute(tag, 'type') || (match[1] === 'select' ? 'select' : 'text'),
        required: tag.includes('required'),
        validation: extractAttribute(tag, 'pattern') || null
      });
    }
  }

  return fields;
}

/**
 * Extract API endpoints
 */
async function extractApiEndpoints(projectRoot: string, framework: string): Promise<ApiEndpoint[]> {
  const endpoints: ApiEndpoint[] = [];

  // API routes in Next.js
  const apiDir = path.join(projectRoot, 'app', 'api');
  if (fs.existsSync(apiDir)) {
    await scanApiDirectory(apiDir, '/api', endpoints);
  }

  const pagesApiDir = path.join(projectRoot, 'pages', 'api');
  if (fs.existsSync(pagesApiDir)) {
    await scanApiDirectory(pagesApiDir, '/api', endpoints);
  }

  // src variations
  const srcApiDir = path.join(projectRoot, 'src', 'app', 'api');
  if (fs.existsSync(srcApiDir)) {
    await scanApiDirectory(srcApiDir, '/api', endpoints);
  }

  return endpoints;
}

/**
 * Scan API directory for endpoints
 */
async function scanApiDirectory(
  dir: string,
  basePath: string,
  endpoints: ApiEndpoint[]
): Promise<void> {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      let routeSegment = entry.name;
      if (entry.name.startsWith('[') && entry.name.endsWith(']')) {
        routeSegment = `:${entry.name.slice(1, -1)}`;
      }
      await scanApiDirectory(fullPath, `${basePath}/${routeSegment}`, endpoints);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      const basename = path.basename(entry.name, ext);

      if (['.ts', '.js'].includes(ext) && basename === 'route') {
        const methods = await detectApiMethods(fullPath);
        for (const method of methods) {
          endpoints.push({
            path: basePath,
            method,
            handler: entry.name,
            source_file: fullPath,
            request_schema: null,
            response_schema: null
          });
        }
      }
    }
  }
}

/**
 * Map PRD features to code locations
 */
function mapFeaturesToCode(
  features: PrdFeature[],
  routes: RouteInfo[],
  endpoints: ApiEndpoint[]
): FeatureRouteMapping[] {
  const mappings: FeatureRouteMapping[] = [];

  for (const feature of features) {
    const keywords = extractFeatureKeywords(feature);
    const matchedRoutes: string[] = [];
    const matchedEndpoints: string[] = [];

    // Match routes
    for (const route of routes) {
      if (keywordsMatchPath(keywords, route.path)) {
        matchedRoutes.push(route.path);
      }
    }

    // Match endpoints
    for (const endpoint of endpoints) {
      if (keywordsMatchPath(keywords, endpoint.path)) {
        matchedEndpoints.push(`${endpoint.method} ${endpoint.path}`);
      }
    }

    const totalMatches = matchedRoutes.length + matchedEndpoints.length;
    const confidence = Math.min(totalMatches / Math.max(keywords.length, 1), 1);

    mappings.push({
      feature_id: feature.id,
      feature_name: feature.name,
      matched_routes: matchedRoutes,
      matched_endpoints: matchedEndpoints,
      confidence
    });
  }

  return mappings;
}

/**
 * Extract keywords from feature
 */
function extractFeatureKeywords(feature: PrdFeature): string[] {
  const text = `${feature.name} ${feature.description}`.toLowerCase();
  const words = text.split(/\W+/).filter(w => w.length > 3);

  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'will',
    'should', 'must', 'shall', 'can', 'could', 'would', 'user', 'users',
    'system', 'application', 'feature', 'functionality'
  ]);

  return [...new Set(words.filter(w => !stopWords.has(w)))];
}

/**
 * Check if keywords match a path
 */
function keywordsMatchPath(keywords: string[], routePath: string): boolean {
  const pathLower = routePath.toLowerCase().replace(/[/:_-]/g, ' ');
  const matchCount = keywords.filter(kw => pathLower.includes(kw)).length;
  return matchCount >= 1;
}

/**
 * Find files matching pattern in directory
 */
function findFiles(dir: string, pattern: RegExp, files: string[] = []): string[] {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist') {
          findFiles(fullPath, pattern, files);
        }
      } else if (entry.isFile() && pattern.test(entry.name)) {
        files.push(fullPath);
      }
    }
  } catch {
    // Ignore access errors
  }

  return files;
}

/**
 * Write code analysis result to file
 */
export function writeCodeAnalysis(auditPath: string, result: CodeAnalysisResult): void {
  const outputPath = path.join(auditPath, 'code-analysis.json');
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
}

/**
 * Load code analysis result from file
 */
export function loadCodeAnalysis(auditPath: string): CodeAnalysisResult | null {
  const analysisPath = path.join(auditPath, 'code-analysis.json');
  if (!fs.existsSync(analysisPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(analysisPath, 'utf-8');
    return JSON.parse(content) as CodeAnalysisResult;
  } catch {
    return null;
  }
}
