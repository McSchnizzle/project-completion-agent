/**
 * Code Analysis Phase tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  runCodeAnalysis,
  writeCodeAnalysis,
  loadCodeAnalysis,
  CodeAnalysisResult
} from '../../skill/phases/code-analysis';

const TEST_DIR = '/tmp/test-code-analysis-' + Date.now();

describe('Code Analysis Phase', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('runCodeAnalysis', () => {
    it('should return result with schema version', async () => {
      const result = await runCodeAnalysis(TEST_DIR);

      expect(result.schema_version).toBe('1.0.0');
      expect(result.analyzed_at).toBeDefined();
      expect(result.project_root).toBe(TEST_DIR);
    });

    it('should detect Next.js routes in app directory', async () => {
      // Create Next.js app router structure
      const appDir = path.join(TEST_DIR, 'app');
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(path.join(appDir, 'page.tsx'), 'export default function Home() {}');

      fs.mkdirSync(path.join(appDir, 'about'), { recursive: true });
      fs.writeFileSync(path.join(appDir, 'about', 'page.tsx'), 'export default function About() {}');

      // Create next.config.js to identify as Next.js
      fs.writeFileSync(path.join(TEST_DIR, 'next.config.js'), 'module.exports = {};');

      const result = await runCodeAnalysis(TEST_DIR);

      expect(result.framework).toBe('next');
      expect(result.routes.length).toBeGreaterThan(0);
      expect(result.routes.some(r => r.path === '/')).toBe(true);
      expect(result.routes.some(r => r.path === '/about')).toBe(true);
    });

    it('should detect Next.js routes in pages directory', async () => {
      // Create Next.js pages router structure
      const pagesDir = path.join(TEST_DIR, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });
      fs.writeFileSync(path.join(pagesDir, 'index.tsx'), 'export default function Home() {}');
      fs.writeFileSync(path.join(pagesDir, 'contact.tsx'), 'export default function Contact() {}');

      fs.writeFileSync(path.join(TEST_DIR, 'next.config.js'), 'module.exports = {};');

      const result = await runCodeAnalysis(TEST_DIR);

      expect(result.routes.some(r => r.path === '/')).toBe(true);
      expect(result.routes.some(r => r.path === '/contact')).toBe(true);
    });

    it('should detect dynamic routes', async () => {
      const appDir = path.join(TEST_DIR, 'app', 'users', '[id]');
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(path.join(appDir, 'page.tsx'), 'export default function User() {}');

      fs.writeFileSync(path.join(TEST_DIR, 'next.config.js'), 'module.exports = {};');

      const result = await runCodeAnalysis(TEST_DIR);

      expect(result.routes.some(r => r.path.includes(':id'))).toBe(true);
      expect(result.routes.some(r => r.parameters.includes('id'))).toBe(true);
    });

    it('should extract forms from components', async () => {
      fs.writeFileSync(path.join(TEST_DIR, 'LoginForm.tsx'), `
        export function LoginForm() {
          return (
            <form action="/api/login" method="POST">
              <input name="email" type="email" required />
              <input name="password" type="password" required />
              <button type="submit">Login</button>
            </form>
          );
        }
      `);

      const result = await runCodeAnalysis(TEST_DIR);

      expect(result.forms.length).toBeGreaterThan(0);
      expect(result.forms[0].action).toBe('/api/login');
      expect(result.forms[0].method).toBe('POST');
      expect(result.forms[0].fields.length).toBeGreaterThanOrEqual(2);
    });

    it('should extract API endpoints from Next.js route handlers', async () => {
      const apiDir = path.join(TEST_DIR, 'app', 'api', 'users');
      fs.mkdirSync(apiDir, { recursive: true });
      fs.writeFileSync(path.join(apiDir, 'route.ts'), `
        export async function GET() {
          return Response.json({ users: [] });
        }
        export async function POST(request: Request) {
          return Response.json({ success: true });
        }
      `);

      fs.writeFileSync(path.join(TEST_DIR, 'next.config.js'), 'module.exports = {};');

      const result = await runCodeAnalysis(TEST_DIR);

      expect(result.api_endpoints.length).toBeGreaterThan(0);
      expect(result.api_endpoints.some(e => e.path === '/api/users' && e.method === 'GET')).toBe(true);
      expect(result.api_endpoints.some(e => e.path === '/api/users' && e.method === 'POST')).toBe(true);
    });

    it('should detect auth requirements in routes', async () => {
      const appDir = path.join(TEST_DIR, 'app', 'dashboard');
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(path.join(appDir, 'page.tsx'), `
        import { useSession } from 'next-auth/react';
        export default function Dashboard() {
          const { data: session } = useSession();
          return <div>Dashboard</div>;
        }
      `);

      fs.writeFileSync(path.join(TEST_DIR, 'next.config.js'), 'module.exports = {};');

      const result = await runCodeAnalysis(TEST_DIR);

      const dashboardRoute = result.routes.find(r => r.path === '/dashboard');
      expect(dashboardRoute?.auth_required).toBe(true);
    });

    it('should map features to routes', async () => {
      const appDir = path.join(TEST_DIR, 'app', 'auth');
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(path.join(appDir, 'page.tsx'), 'export default function Auth() {}');

      fs.writeFileSync(path.join(TEST_DIR, 'next.config.js'), 'module.exports = {};');

      const features = [
        { id: 'F1', name: 'User Authentication', description: 'Login and registration', priority: 'high' as const }
      ];

      const result = await runCodeAnalysis(TEST_DIR, features);

      expect(result.feature_mapping.length).toBeGreaterThan(0);
      expect(result.feature_mapping[0].feature_id).toBe('F1');
    });

    it('should include code quality issues', async () => {
      fs.writeFileSync(path.join(TEST_DIR, 'app.ts'), `
        // TODO: Fix this
        console.log('debug');
      `);

      const result = await runCodeAnalysis(TEST_DIR);

      expect(result.quality_issues).toBeDefined();
    });

    it('should include architecture analysis', async () => {
      fs.writeFileSync(path.join(TEST_DIR, 'a.ts'), `import { b } from './b';`);
      fs.writeFileSync(path.join(TEST_DIR, 'b.ts'), `export const b = 1;`);

      const result = await runCodeAnalysis(TEST_DIR);

      expect(result.architecture).toBeDefined();
      expect(result.architecture?.dependencyGraph.nodes.length).toBeGreaterThan(0);
    });

    it('should calculate stats correctly', async () => {
      fs.writeFileSync(path.join(TEST_DIR, 'a.ts'), `export const a = 1;`);
      fs.writeFileSync(path.join(TEST_DIR, 'b.ts'), `export const b = 2;`);

      const result = await runCodeAnalysis(TEST_DIR);

      expect(result.stats.files_analyzed).toBeGreaterThanOrEqual(2);
    });
  });

  describe('writeCodeAnalysis and loadCodeAnalysis', () => {
    it('should write and load analysis result', async () => {
      const auditPath = path.join(TEST_DIR, 'audit');
      fs.mkdirSync(auditPath, { recursive: true });

      const result: CodeAnalysisResult = {
        schema_version: '1.0.0',
        analyzed_at: new Date().toISOString(),
        project_root: TEST_DIR,
        framework: 'next',
        framework_version: null,
        routes: [],
        forms: [],
        api_endpoints: [],
        feature_mapping: [],
        quality_issues: null,
        security_issues: null,
        architecture: null,
        stats: {
          files_analyzed: 0,
          routes_found: 0,
          forms_found: 0,
          api_endpoints_found: 0
        }
      };

      writeCodeAnalysis(auditPath, result);
      const loaded = loadCodeAnalysis(auditPath);

      expect(loaded).toBeDefined();
      expect(loaded?.schema_version).toBe('1.0.0');
      expect(loaded?.framework).toBe('next');
    });

    it('should return null for non-existent file', () => {
      const loaded = loadCodeAnalysis('/nonexistent/path');
      expect(loaded).toBeNull();
    });
  });
});
