/**
 * Code Analysis Phase tests (src/ version).
 *
 * Tests the pure-TypeScript route/form discovery against both
 * synthetic project structures and the real calendar project.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runCodeAnalysis, loadCodeAnalysis } from '../../src/phases/code-analysis';

const TEST_DIR = '/tmp/test-src-code-analysis-' + Date.now();
const AUDIT_DIR = path.join(TEST_DIR, 'audit');
const CODEBASE_DIR = path.join(TEST_DIR, 'codebase');
const CALENDAR_ROOT = '/Users/paulbrown/Desktop/coding-projects/calendar/apps/frontend';

describe('Code Analysis Phase (src/)', () => {
  beforeEach(() => {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
    fs.mkdirSync(CODEBASE_DIR, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('framework detection', () => {
    it('should detect Next.js from package.json', async () => {
      fs.writeFileSync(
        path.join(CODEBASE_DIR, 'package.json'),
        JSON.stringify({ dependencies: { next: '14.0.0', react: '18.0.0' } }),
      );

      const result = await runCodeAnalysis({
        auditDir: AUDIT_DIR,
        codebasePath: CODEBASE_DIR,
      });

      expect(result.framework).toBe('nextjs');
    });

    it('should detect Express from package.json', async () => {
      fs.writeFileSync(
        path.join(CODEBASE_DIR, 'package.json'),
        JSON.stringify({ dependencies: { express: '4.18.0' } }),
      );

      const result = await runCodeAnalysis({
        auditDir: AUDIT_DIR,
        codebasePath: CODEBASE_DIR,
      });

      expect(result.framework).toBe('express');
    });

    it('should detect Next.js from next.config.js', async () => {
      fs.writeFileSync(
        path.join(CODEBASE_DIR, 'next.config.js'),
        'module.exports = {};',
      );

      const result = await runCodeAnalysis({
        auditDir: AUDIT_DIR,
        codebasePath: CODEBASE_DIR,
      });

      expect(result.framework).toBe('nextjs');
    });
  });

  describe('Next.js pages router route extraction', () => {
    it('should extract routes from pages/ directory', async () => {
      fs.writeFileSync(
        path.join(CODEBASE_DIR, 'next.config.js'),
        'module.exports = {};',
      );
      const pagesDir = path.join(CODEBASE_DIR, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });
      fs.writeFileSync(path.join(pagesDir, 'index.jsx'), 'export default function Home() {}');
      fs.writeFileSync(path.join(pagesDir, 'about.jsx'), 'export default function About() {}');
      fs.writeFileSync(path.join(pagesDir, 'contact.tsx'), 'export default function Contact() {}');

      const result = await runCodeAnalysis({
        auditDir: AUDIT_DIR,
        codebasePath: CODEBASE_DIR,
      });

      expect(result.routes.some(r => r.path === '/')).toBe(true);
      expect(result.routes.some(r => r.path === '/about')).toBe(true);
      expect(result.routes.some(r => r.path === '/contact')).toBe(true);
    });

    it('should handle nested pages directories', async () => {
      fs.writeFileSync(
        path.join(CODEBASE_DIR, 'next.config.js'),
        'module.exports = {};',
      );
      const pagesDir = path.join(CODEBASE_DIR, 'pages');
      fs.mkdirSync(path.join(pagesDir, 'settings'), { recursive: true });
      fs.writeFileSync(path.join(pagesDir, 'settings', 'index.tsx'), 'export default function Settings() {}');
      fs.writeFileSync(path.join(pagesDir, 'settings', 'profile.tsx'), 'export default function Profile() {}');

      const result = await runCodeAnalysis({
        auditDir: AUDIT_DIR,
        codebasePath: CODEBASE_DIR,
      });

      expect(result.routes.some(r => r.path === '/settings')).toBe(true);
      expect(result.routes.some(r => r.path === '/settings/profile')).toBe(true);
    });

    it('should handle dynamic route segments', async () => {
      fs.writeFileSync(
        path.join(CODEBASE_DIR, 'next.config.js'),
        'module.exports = {};',
      );
      const dynamicDir = path.join(CODEBASE_DIR, 'pages', 'users', '[id]');
      fs.mkdirSync(dynamicDir, { recursive: true });
      fs.writeFileSync(path.join(dynamicDir, 'index.tsx'), 'export default function User() {}');

      const result = await runCodeAnalysis({
        auditDir: AUDIT_DIR,
        codebasePath: CODEBASE_DIR,
      });

      const userRoute = result.routes.find(r => r.path.includes(':id'));
      expect(userRoute).toBeDefined();
      expect(userRoute!.parameters).toContain('id');
    });

    it('should skip _app and _document files', async () => {
      fs.writeFileSync(
        path.join(CODEBASE_DIR, 'next.config.js'),
        'module.exports = {};',
      );
      const pagesDir = path.join(CODEBASE_DIR, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });
      fs.writeFileSync(path.join(pagesDir, '_app.tsx'), 'export default function App() {}');
      fs.writeFileSync(path.join(pagesDir, '_document.tsx'), 'export default function Document() {}');
      fs.writeFileSync(path.join(pagesDir, 'index.tsx'), 'export default function Home() {}');

      const result = await runCodeAnalysis({
        auditDir: AUDIT_DIR,
        codebasePath: CODEBASE_DIR,
      });

      expect(result.routes.some(r => r.path.includes('_app'))).toBe(false);
      expect(result.routes.some(r => r.path.includes('_document'))).toBe(false);
      expect(result.routes.some(r => r.path === '/')).toBe(true);
    });

    it('should identify API routes in pages/api/', async () => {
      fs.writeFileSync(
        path.join(CODEBASE_DIR, 'next.config.js'),
        'module.exports = {};',
      );
      const apiDir = path.join(CODEBASE_DIR, 'pages', 'api');
      fs.mkdirSync(apiDir, { recursive: true });
      fs.writeFileSync(path.join(apiDir, 'users.ts'), 'export default function handler() {}');
      fs.writeFileSync(path.join(apiDir, 'health.ts'), 'export default function handler() {}');

      const result = await runCodeAnalysis({
        auditDir: AUDIT_DIR,
        codebasePath: CODEBASE_DIR,
      });

      const apiRoutes = result.routes.filter(r => r.path.startsWith('/api'));
      expect(apiRoutes.length).toBeGreaterThanOrEqual(2);
      expect(apiRoutes.some(r => r.path === '/api/users')).toBe(true);
      expect(apiRoutes.some(r => r.method === 'API')).toBe(true);
    });
  });

  describe('Next.js app router route extraction', () => {
    it('should extract routes from app/ directory', async () => {
      fs.writeFileSync(
        path.join(CODEBASE_DIR, 'next.config.js'),
        'module.exports = {};',
      );
      const appDir = path.join(CODEBASE_DIR, 'app');
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(path.join(appDir, 'page.tsx'), 'export default function Home() {}');

      fs.mkdirSync(path.join(appDir, 'about'), { recursive: true });
      fs.writeFileSync(path.join(appDir, 'about', 'page.tsx'), 'export default function About() {}');

      const result = await runCodeAnalysis({
        auditDir: AUDIT_DIR,
        codebasePath: CODEBASE_DIR,
      });

      expect(result.routes.some(r => r.path === '/')).toBe(true);
      expect(result.routes.some(r => r.path === '/about')).toBe(true);
    });

    it('should extract API route methods from route.ts', async () => {
      fs.writeFileSync(
        path.join(CODEBASE_DIR, 'next.config.js'),
        'module.exports = {};',
      );
      const apiDir = path.join(CODEBASE_DIR, 'app', 'api', 'users');
      fs.mkdirSync(apiDir, { recursive: true });
      fs.writeFileSync(path.join(apiDir, 'route.ts'), `
        export async function GET() { return Response.json({}); }
        export async function POST(req: Request) { return Response.json({}); }
      `);

      const result = await runCodeAnalysis({
        auditDir: AUDIT_DIR,
        codebasePath: CODEBASE_DIR,
      });

      expect(result.routes.some(r => r.path === '/api/users' && r.method === 'GET')).toBe(true);
      expect(result.routes.some(r => r.path === '/api/users' && r.method === 'POST')).toBe(true);
    });

    it('should handle route groups (parenthesized directories)', async () => {
      fs.writeFileSync(
        path.join(CODEBASE_DIR, 'next.config.js'),
        'module.exports = {};',
      );
      const groupDir = path.join(CODEBASE_DIR, 'app', '(auth)', 'login');
      fs.mkdirSync(groupDir, { recursive: true });
      fs.writeFileSync(path.join(groupDir, 'page.tsx'), 'export default function Login() {}');

      const result = await runCodeAnalysis({
        auditDir: AUDIT_DIR,
        codebasePath: CODEBASE_DIR,
      });

      // Route group should not appear in path
      expect(result.routes.some(r => r.path === '/login')).toBe(true);
      expect(result.routes.some(r => r.path.includes('(auth)'))).toBe(false);
    });
  });

  describe('form extraction', () => {
    it('should extract forms from JSX files', async () => {
      fs.writeFileSync(path.join(CODEBASE_DIR, 'LoginForm.tsx'), `
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

      const result = await runCodeAnalysis({
        auditDir: AUDIT_DIR,
        codebasePath: CODEBASE_DIR,
      });

      expect(result.forms.length).toBeGreaterThan(0);
      expect(result.forms[0].action).toBe('/api/login');
      expect(result.forms[0].method).toBe('POST');
      expect(result.forms[0].fields.length).toBeGreaterThanOrEqual(2);
      expect(result.forms[0].fields.some(f => f.name === 'email')).toBe(true);
      expect(result.forms[0].fields.some(f => f.name === 'password')).toBe(true);
    });

    it('should detect required fields', async () => {
      fs.writeFileSync(path.join(CODEBASE_DIR, 'Form.tsx'), `
        <form action="/submit">
          <input name="required_field" type="text" required />
          <input name="optional_field" type="text" />
        </form>
      `);

      const result = await runCodeAnalysis({
        auditDir: AUDIT_DIR,
        codebasePath: CODEBASE_DIR,
      });

      expect(result.forms.length).toBe(1);
      const reqField = result.forms[0].fields.find(f => f.name === 'required_field');
      const optField = result.forms[0].fields.find(f => f.name === 'optional_field');
      expect(reqField?.required).toBe(true);
      expect(optField?.required).toBe(false);
    });

    it('should extract select and textarea fields', async () => {
      fs.writeFileSync(path.join(CODEBASE_DIR, 'Form.tsx'), `
        <form action="/submit">
          <select name="category"><option>A</option></select>
          <textarea name="message"></textarea>
        </form>
      `);

      const result = await runCodeAnalysis({
        auditDir: AUDIT_DIR,
        codebasePath: CODEBASE_DIR,
      });

      expect(result.forms[0].fields.some(f => f.name === 'category' && f.type === 'select')).toBe(true);
      expect(result.forms[0].fields.some(f => f.name === 'message')).toBe(true);
    });
  });

  describe('Express route extraction', () => {
    it('should extract routes from Express route files', async () => {
      fs.writeFileSync(
        path.join(CODEBASE_DIR, 'package.json'),
        JSON.stringify({ dependencies: { express: '4.18.0' } }),
      );
      fs.mkdirSync(path.join(CODEBASE_DIR, 'routes'), { recursive: true });
      fs.writeFileSync(path.join(CODEBASE_DIR, 'routes', 'users.ts'), `
        import { Router } from 'express';
        const router = Router();
        router.get('/api/users', (req, res) => {});
        router.post('/api/users', (req, res) => {});
        router.delete('/api/users/:id', (req, res) => {});
        export default router;
      `);

      const result = await runCodeAnalysis({
        auditDir: AUDIT_DIR,
        codebasePath: CODEBASE_DIR,
      });

      expect(result.routes.some(r => r.path === '/api/users' && r.method === 'GET')).toBe(true);
      expect(result.routes.some(r => r.path === '/api/users' && r.method === 'POST')).toBe(true);
      expect(result.routes.some(r => r.path === '/api/users/:id' && r.method === 'DELETE')).toBe(true);
    });
  });

  describe('auth detection', () => {
    it('should detect auth requirements in page files', async () => {
      fs.writeFileSync(
        path.join(CODEBASE_DIR, 'next.config.js'),
        'module.exports = {};',
      );
      const dashDir = path.join(CODEBASE_DIR, 'pages');
      fs.mkdirSync(dashDir, { recursive: true });
      fs.writeFileSync(path.join(dashDir, 'dashboard.tsx'), `
        import { useSession } from 'next-auth/react';
        export default function Dashboard() {
          const { data: session } = useSession();
          return <div>Dashboard</div>;
        }
      `);

      const result = await runCodeAnalysis({
        auditDir: AUDIT_DIR,
        codebasePath: CODEBASE_DIR,
      });

      const dashRoute = result.routes.find(r => r.path === '/dashboard');
      expect(dashRoute?.authRequired).toBe(true);
    });
  });

  describe('file counting', () => {
    it('should count source files and lines', async () => {
      fs.writeFileSync(path.join(CODEBASE_DIR, 'a.ts'), 'export const a = 1;\nexport const b = 2;\n');
      fs.writeFileSync(path.join(CODEBASE_DIR, 'b.tsx'), 'export default function C() { return <div />; }\n');

      const result = await runCodeAnalysis({
        auditDir: AUDIT_DIR,
        codebasePath: CODEBASE_DIR,
      });

      expect(result.filesAnalyzed).toBeGreaterThanOrEqual(2);
      expect(result.linesOfCode).toBeGreaterThan(0);
      expect(result.languages).toContain('typescript');
    });

    it('should skip node_modules', async () => {
      const nmDir = path.join(CODEBASE_DIR, 'node_modules', 'pkg');
      fs.mkdirSync(nmDir, { recursive: true });
      fs.writeFileSync(path.join(nmDir, 'index.ts'), 'export const x = 1;');
      fs.writeFileSync(path.join(CODEBASE_DIR, 'app.ts'), 'export const y = 2;');

      const result = await runCodeAnalysis({
        auditDir: AUDIT_DIR,
        codebasePath: CODEBASE_DIR,
      });

      expect(result.filesAnalyzed).toBe(1);
    });
  });

  describe('output persistence', () => {
    it('should write code-analysis.json to audit directory', async () => {
      fs.writeFileSync(path.join(CODEBASE_DIR, 'app.ts'), 'export const x = 1;');

      await runCodeAnalysis({
        auditDir: AUDIT_DIR,
        codebasePath: CODEBASE_DIR,
      });

      const outPath = path.join(AUDIT_DIR, 'code-analysis.json');
      expect(fs.existsSync(outPath)).toBe(true);

      const loaded = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
      expect(loaded.analyzed_at).toBeDefined();
      expect(loaded.codebase_path).toBe(CODEBASE_DIR);
    });

    it('should load saved analysis via loadCodeAnalysis', async () => {
      fs.writeFileSync(path.join(CODEBASE_DIR, 'app.ts'), 'export const x = 1;');

      await runCodeAnalysis({
        auditDir: AUDIT_DIR,
        codebasePath: CODEBASE_DIR,
      });

      const loaded = loadCodeAnalysis(AUDIT_DIR);
      expect(loaded).not.toBeNull();
      expect(loaded!.languages).toContain('typescript');
    });

    it('should return null for missing analysis file', () => {
      const loaded = loadCodeAnalysis('/nonexistent/path');
      expect(loaded).toBeNull();
    });
  });

  describe('real calendar project analysis', () => {
    it('should discover routes in the calendar frontend', async () => {
      if (!fs.existsSync(CALENDAR_ROOT)) {
        return; // Skip if calendar project not available
      }

      const result = await runCodeAnalysis({
        auditDir: AUDIT_DIR,
        codebasePath: CALENDAR_ROOT,
      });

      expect(result.framework).toBe('nextjs');
      expect(result.routes.length).toBeGreaterThan(0);

      // Known pages in the calendar app
      const routePaths = result.routes.map(r => r.path);
      expect(routePaths.some(p => p === '/')).toBe(true);
      expect(routePaths.some(p => p.includes('birthday') || p.includes('birthdays'))).toBe(true);
      expect(routePaths.some(p => p.includes('happy-hours'))).toBe(true);
      expect(routePaths.some(p => p.includes('settings'))).toBe(true);

      // Should find API routes
      const apiRoutes = result.routes.filter(r => r.path.startsWith('/api'));
      expect(apiRoutes.length).toBeGreaterThan(0);

      // Should count files
      expect(result.filesAnalyzed).toBeGreaterThan(10);
      expect(result.linesOfCode).toBeGreaterThan(100);
      expect(result.languages).toContain('javascript');
    });
  });
});
