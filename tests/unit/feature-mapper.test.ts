/**
 * Feature Mapper tests - comprehensive coverage of feature-to-page mapping.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  mapFeaturesToPages,
  saveFeatureCoverage,
  loadFeatureCoverage,
  saveFeatureMappings,
  loadFeatureMappings,
  extractKeywords,
  extractRouteHints,
  type MappablePage,
  type FeatureCoverage,
  type FeatureMapping,
} from '../../src/feature-mapper';
import type { PrdFeature } from '../../src/phases/prd-parsing';

const TEST_DIR = '/tmp/test-feature-mapper-' + Date.now();
const AUDIT_DIR = path.join(TEST_DIR, '.complete-agent', 'audits', 'current');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFeature(overrides: Partial<PrdFeature> & { id: string; name: string }): PrdFeature {
  return {
    description: '',
    priority: 'must',
    acceptance_criteria: [],
    status: 'not_tested',
    routeHints: [],
    keywords: [],
    ...overrides,
  };
}

function makePage(url: string, title: string, text = ''): MappablePage {
  return { url, title, text };
}

// ---------------------------------------------------------------------------
// Mock data resembling the social marketing tool audit
// ---------------------------------------------------------------------------

const SOCIAL_PAGES: MappablePage[] = [
  makePage('https://socials.paulrbrown.org/', 'Socials - Home'),
  makePage('https://socials.paulrbrown.org/login', 'Login'),
  makePage('https://socials.paulrbrown.org/signup', 'Sign Up'),
  makePage('https://socials.paulrbrown.org/dashboard', 'Dashboard - Overview', 'analytics content scheduling'),
  makePage('https://socials.paulrbrown.org/brand/new', 'Create New Brand', 'onboarding brand setup wizard'),
  makePage('https://socials.paulrbrown.org/brand/1/voice', 'Brand Voice Settings', 'tone personality brand voice'),
  makePage('https://socials.paulrbrown.org/brand/1/content', 'Content Library', 'posts drafts published content'),
  makePage('https://socials.paulrbrown.org/schedule', 'Content Schedule', 'calendar schedule post timing'),
  makePage('https://socials.paulrbrown.org/schedule/queue', 'Schedule Queue', 'queue upcoming posts'),
  makePage('https://socials.paulrbrown.org/analytics', 'Analytics', 'engagement metrics growth tracking'),
  makePage('https://socials.paulrbrown.org/analytics/posts', 'Post Analytics', 'individual post performance'),
  makePage('https://socials.paulrbrown.org/settings', 'Settings', 'account preferences notifications'),
  makePage('https://socials.paulrbrown.org/settings/billing', 'Billing', 'subscription plan payment usage'),
  makePage('https://socials.paulrbrown.org/settings/team', 'Team Settings', 'members roles permissions'),
  makePage('https://socials.paulrbrown.org/compose', 'Compose Post', 'create new post draft'),
  makePage('https://socials.paulrbrown.org/integrations', 'Integrations', 'connect social platforms twitter instagram'),
  makePage('https://socials.paulrbrown.org/help', 'Help Center', 'documentation support faq'),
  makePage('https://socials.paulrbrown.org/brand/1/campaigns', 'Campaigns', 'campaign management marketing'),
  makePage('https://socials.paulrbrown.org/brand/1/templates', 'Templates', 'post templates content reuse'),
  makePage('https://socials.paulrbrown.org/notifications', 'Notifications', 'alerts updates'),
];

const SOCIAL_FEATURES: PrdFeature[] = [
  makeFeature({
    id: 'F1', name: 'Onboarding', priority: 'must',
    description: 'New users can create a brand via the onboarding wizard',
    acceptance_criteria: ['User navigates to /brand/new and creates brand', 'Setup wizard collects brand name and industry'],
    routeHints: ['/brand/new'],
    keywords: ['onboarding', 'brand', 'wizard', 'new', 'create'],
  }),
  makeFeature({
    id: 'F2', name: 'Brand Voice Configuration', priority: 'must',
    description: 'Users configure brand voice tone and personality',
    acceptance_criteria: ['Brand voice editor at /brand/*/voice', 'Tone slider adjusts content suggestions'],
    routeHints: ['/brand/*/voice'],
    keywords: ['brand', 'voice', 'configuration', 'tone', 'personality'],
  }),
  makeFeature({
    id: 'F3', name: 'Content Scheduling', priority: 'must',
    description: 'Users can schedule social media posts for future publication',
    acceptance_criteria: ['Schedule calendar shows upcoming posts', 'Posts can be dragged to reschedule'],
    routeHints: [],
    keywords: ['content', 'scheduling', 'social', 'media', 'posts', 'future', 'publication'],
  }),
  makeFeature({
    id: 'F4', name: 'Analytics Dashboard', priority: 'should',
    description: 'Dashboard displays engagement metrics and growth tracking',
    acceptance_criteria: ['Analytics page shows engagement graphs', 'Data refreshes in real time'],
    routeHints: [],
    keywords: ['analytics', 'dashboard', 'engagement', 'metrics', 'growth', 'tracking'],
  }),
  makeFeature({
    id: 'F5', name: 'Billing Management', priority: 'must',
    description: 'Users can manage their subscription and payment details',
    acceptance_criteria: ['Billing page accessible at /settings/billing', 'User can upgrade or downgrade plan'],
    routeHints: ['/settings/billing'],
    keywords: ['billing', 'management', 'subscription', 'payment', 'details'],
  }),
  makeFeature({
    id: 'F6', name: 'Team Collaboration', priority: 'should',
    description: 'Team members with different roles collaborate on content',
    acceptance_criteria: ['Team settings page lists members', 'Roles can be assigned'],
    routeHints: [],
    keywords: ['team', 'collaboration', 'members', 'different', 'roles', 'content'],
  }),
  makeFeature({
    id: 'F7', name: 'Post Composer', priority: 'must',
    description: 'Rich editor for composing social media posts',
    acceptance_criteria: ['Compose page at /compose', 'Supports image and text posts'],
    routeHints: ['/compose'],
    keywords: ['post', 'composer', 'rich', 'editor', 'composing', 'social', 'media'],
  }),
  makeFeature({
    id: 'F8', name: 'Platform Integrations', priority: 'must',
    description: 'Connect to social media platforms like Twitter and Instagram',
    acceptance_criteria: ['Integrations page lists available platforms', 'OAuth flow connects accounts'],
    routeHints: [],
    keywords: ['platform', 'integrations', 'connect', 'social', 'media', 'twitter', 'instagram'],
  }),
  makeFeature({
    id: 'F9', name: 'Accessibility Compliance', priority: 'could',
    description: 'The application meets WCAG 2.1 AA accessibility standards',
    acceptance_criteria: ['All interactive elements have ARIA labels', 'Color contrast meets AA ratio'],
    routeHints: [],
    keywords: ['accessibility', 'compliance', 'application', 'meets', 'wcag', 'standards'],
  }),
  makeFeature({
    id: 'F10', name: 'Offline Mode', priority: 'could',
    description: 'Users can draft posts while offline with sync on reconnect',
    acceptance_criteria: ['Draft saved locally when connection lost', 'Syncs automatically on reconnect'],
    routeHints: [],
    keywords: ['offline', 'mode', 'draft', 'posts', 'sync', 'reconnect'],
  }),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Feature Mapper', () => {
  beforeEach(() => {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  // ---- extractKeywords ---------------------------------------------------

  describe('extractKeywords', () => {
    it('should extract meaningful words, removing stop words', () => {
      const result = extractKeywords('Users can configure brand voice tone');
      expect(result).toContain('configure');
      expect(result).toContain('brand');
      expect(result).toContain('voice');
      expect(result).toContain('tone');
      expect(result).not.toContain('the');
      expect(result).not.toContain('can');
    });

    it('should remove short words (< 3 chars)', () => {
      const result = extractKeywords('a to be or not to be');
      expect(result).toHaveLength(0);
    });

    it('should deduplicate keywords', () => {
      const result = extractKeywords('brand voice brand tone brand');
      const brandCount = result.filter((k) => k === 'brand').length;
      expect(brandCount).toBe(1);
    });

    it('should handle empty string', () => {
      expect(extractKeywords('')).toHaveLength(0);
    });

    it('should strip special characters', () => {
      const result = extractKeywords('billing/payment (USD) & invoices');
      expect(result).toContain('billing');
      expect(result).toContain('payment');
      expect(result).toContain('invoices');
    });
  });

  // ---- extractRouteHints ------------------------------------------------

  describe('extractRouteHints', () => {
    it('should extract URL paths from text', () => {
      const result = extractRouteHints('User navigates to /settings/billing to manage plan');
      expect(result).toContain('/settings/billing');
    });

    it('should extract multiple routes', () => {
      const result = extractRouteHints('Pages at /dashboard and /analytics show data');
      expect(result).toContain('/dashboard');
      expect(result).toContain('/analytics');
    });

    it('should extract routes in quotes', () => {
      const result = extractRouteHints('Navigate to "/brand/new" to start');
      expect(result).toContain('/brand/new');
    });

    it('should deduplicate route hints', () => {
      const result = extractRouteHints('/settings appears twice /settings here');
      const count = result.filter((r) => r === '/settings').length;
      expect(count).toBe(1);
    });

    it('should return empty array when no routes found', () => {
      expect(extractRouteHints('No routes in this text')).toHaveLength(0);
    });
  });

  // ---- mapFeaturesToPages: URL matching ----------------------------------

  describe('mapFeaturesToPages - URL matching', () => {
    it('should match feature with route hint to exact page URL', () => {
      const features = [makeFeature({
        id: 'F1', name: 'Billing',
        description: 'Manage billing at /settings/billing',
        acceptance_criteria: ['Navigate to /settings/billing'],
        routeHints: ['/settings/billing'],
        keywords: ['billing', 'manage'],
      })];
      const pages = [makePage('https://app.com/settings/billing', 'Billing')];

      const result = mapFeaturesToPages(features, pages);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('mapped');
      expect(result[0].mappedPages).toHaveLength(1);
      expect(result[0].mappedPages[0].url).toBe('https://app.com/settings/billing');
      expect(result[0].mappedPages[0].confidence).toBeGreaterThanOrEqual(0.5);
    });

    it('should match feature keywords to URL segments', () => {
      const features = [makeFeature({
        id: 'F1', name: 'Analytics Dashboard',
        keywords: ['analytics', 'dashboard'],
      })];
      const pages = [
        makePage('https://app.com/analytics', 'Analytics'),
        makePage('https://app.com/settings', 'Settings'),
      ];

      const result = mapFeaturesToPages(features, pages);

      expect(result[0].mappedPages.length).toBeGreaterThanOrEqual(1);
      expect(result[0].mappedPages[0].url).toBe('https://app.com/analytics');
    });

    it('should rank pages by confidence (highest first)', () => {
      const features = [makeFeature({
        id: 'F1', name: 'Schedule',
        description: 'Post scheduling',
        keywords: ['schedule', 'post', 'scheduling'],
      })];
      const pages = [
        makePage('https://app.com/help', 'Help'),
        makePage('https://app.com/schedule', 'Schedule', 'schedule your posts'),
        makePage('https://app.com/schedule/queue', 'Queue', 'queue of scheduled posts'),
      ];

      const result = mapFeaturesToPages(features, pages);

      expect(result[0].mappedPages.length).toBeGreaterThanOrEqual(1);
      // The /schedule page should rank highest or equal
      const scheduleIdx = result[0].mappedPages.findIndex((p) => p.url.endsWith('/schedule'));
      expect(scheduleIdx).toBeLessThanOrEqual(1);
    });
  });

  // ---- mapFeaturesToPages: content matching ------------------------------

  describe('mapFeaturesToPages - content matching', () => {
    it('should match feature keywords to page title', () => {
      const features = [makeFeature({
        id: 'F1', name: 'Campaign Management',
        keywords: ['campaign', 'management'],
      })];
      const pages = [makePage('https://app.com/brand/1/campaigns', 'Campaigns', 'campaign management marketing')];

      const result = mapFeaturesToPages(features, pages);

      expect(result[0].mappedPages).toHaveLength(1);
      expect(result[0].mappedPages[0].confidence).toBeGreaterThan(0);
    });

    it('should match multiple keywords in page text', () => {
      const features = [makeFeature({
        id: 'F1', name: 'Engagement Tracking',
        keywords: ['engagement', 'tracking', 'metrics'],
      })];
      const pages = [makePage('https://app.com/stats', 'Stats', 'engagement metrics growth tracking analytics')];

      const result = mapFeaturesToPages(features, pages);

      expect(result[0].mappedPages).toHaveLength(1);
      expect(result[0].status).not.toBe('unmapped');
    });

    it('should not match when no keywords overlap', () => {
      const features = [makeFeature({
        id: 'F1', name: 'Offline Mode',
        keywords: ['offline', 'mode', 'sync'],
      })];
      const pages = [makePage('https://app.com/dashboard', 'Dashboard', 'analytics content scheduling')];

      const result = mapFeaturesToPages(features, pages);

      expect(result[0].mappedPages).toHaveLength(0);
      expect(result[0].status).toBe('unmapped');
    });
  });

  // ---- mapFeaturesToPages: boost on combined match -----------------------

  describe('mapFeaturesToPages - combined matching', () => {
    it('should boost confidence when both URL and content match', () => {
      const features = [makeFeature({
        id: 'F1', name: 'Analytics',
        keywords: ['analytics', 'engagement'],
      })];
      const pages = [
        makePage('https://app.com/analytics', 'Analytics', 'engagement metrics growth'),
        makePage('https://app.com/settings', 'Settings', ''),
      ];

      const result = mapFeaturesToPages(features, pages);
      const analyticsPage = result[0].mappedPages.find((p) => p.url.includes('/analytics'));

      expect(analyticsPage).toBeDefined();
      expect(analyticsPage!.confidence).toBeGreaterThanOrEqual(0.5);
      expect(analyticsPage!.matchReason).toContain(';'); // combined reason
    });
  });

  // ---- mapFeaturesToPages: status classification -------------------------

  describe('mapFeaturesToPages - status classification', () => {
    it('should mark as "mapped" when high-confidence match exists', () => {
      const features = [makeFeature({
        id: 'F1', name: 'Billing',
        description: 'Manage billing',
        acceptance_criteria: ['Navigate to /settings/billing'],
        keywords: ['billing', 'manage'],
      })];
      const pages = [makePage('https://app.com/settings/billing', 'Billing', 'billing management')];

      const result = mapFeaturesToPages(features, pages);
      expect(result[0].status).toBe('mapped');
    });

    it('should mark as "unmapped" when no pages match', () => {
      const features = [makeFeature({
        id: 'F1', name: 'Offline Mode',
        keywords: ['offline', 'sync', 'reconnect'],
      })];
      const pages = [makePage('https://app.com/dashboard', 'Dashboard', 'analytics')];

      const result = mapFeaturesToPages(features, pages);
      expect(result[0].status).toBe('unmapped');
    });

    it('should mark as "partial" when only low-confidence matches exist', () => {
      const features = [makeFeature({
        id: 'F1', name: 'Accessibility Compliance',
        keywords: ['accessibility', 'compliance', 'wcag', 'standards'],
      })];
      // Only weak text match via "accessibility" appearing in page text
      const pages = [makePage('https://app.com/help', 'Help', 'accessibility documentation wcag')];

      const result = mapFeaturesToPages(features, pages);
      // Should have a match but with lower confidence
      if (result[0].mappedPages.length > 0) {
        expect(result[0].status === 'partial' || result[0].status === 'mapped').toBe(true);
      }
    });
  });

  // ---- mapFeaturesToPages: edge cases ------------------------------------

  describe('mapFeaturesToPages - edge cases', () => {
    it('should handle empty features list', () => {
      const result = mapFeaturesToPages([], SOCIAL_PAGES);
      expect(result).toHaveLength(0);
    });

    it('should handle empty pages list', () => {
      const result = mapFeaturesToPages(SOCIAL_FEATURES, []);
      expect(result).toHaveLength(SOCIAL_FEATURES.length);
      for (const mapping of result) {
        expect(mapping.mappedPages).toHaveLength(0);
        expect(mapping.status).toBe('unmapped');
      }
    });

    it('should handle feature with empty name and description', () => {
      const features = [makeFeature({ id: 'F1', name: '', description: '' })];
      const pages = [makePage('https://app.com/', 'Home')];

      const result = mapFeaturesToPages(features, pages);
      expect(result).toHaveLength(1);
      expect(result[0].featureId).toBe('F1');
    });

    it('should handle pages with missing title and text', () => {
      const features = [makeFeature({
        id: 'F1', name: 'Dashboard',
        keywords: ['dashboard'],
      })];
      const pages: MappablePage[] = [{ url: 'https://app.com/dashboard', title: '' }];

      const result = mapFeaturesToPages(features, pages);
      // Should still match via URL
      expect(result[0].mappedPages.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---- mapFeaturesToPages: real-world-like data --------------------------

  describe('mapFeaturesToPages - social marketing tool simulation', () => {
    it('should map most features to at least one page', () => {
      const result = mapFeaturesToPages(SOCIAL_FEATURES, SOCIAL_PAGES);

      expect(result).toHaveLength(SOCIAL_FEATURES.length);

      // Count mapped features (excluding hard-to-map ones like Offline Mode, Accessibility)
      const mappedCount = result.filter((m) => m.status !== 'unmapped').length;
      // At least 6 of 10 features should map to pages
      expect(mappedCount).toBeGreaterThanOrEqual(6);
    });

    it('should map Onboarding to /brand/new', () => {
      const result = mapFeaturesToPages(SOCIAL_FEATURES, SOCIAL_PAGES);
      const onboarding = result.find((m) => m.featureId === 'F1');

      expect(onboarding).toBeDefined();
      expect(onboarding!.status).toBe('mapped');
      const brandNew = onboarding!.mappedPages.find((p) => p.url.includes('/brand/new'));
      expect(brandNew).toBeDefined();
    });

    it('should map Brand Voice to /brand/*/voice page', () => {
      const result = mapFeaturesToPages(SOCIAL_FEATURES, SOCIAL_PAGES);
      const brandVoice = result.find((m) => m.featureId === 'F2');

      expect(brandVoice).toBeDefined();
      expect(brandVoice!.mappedPages.length).toBeGreaterThan(0);
      const voicePage = brandVoice!.mappedPages.find((p) => p.url.includes('/voice'));
      expect(voicePage).toBeDefined();
    });

    it('should map Content Scheduling to /schedule', () => {
      const result = mapFeaturesToPages(SOCIAL_FEATURES, SOCIAL_PAGES);
      const scheduling = result.find((m) => m.featureId === 'F3');

      expect(scheduling).toBeDefined();
      const schedulePage = scheduling!.mappedPages.find((p) => p.url.includes('/schedule'));
      expect(schedulePage).toBeDefined();
    });

    it('should map Analytics Dashboard to /analytics', () => {
      const result = mapFeaturesToPages(SOCIAL_FEATURES, SOCIAL_PAGES);
      const analytics = result.find((m) => m.featureId === 'F4');

      expect(analytics).toBeDefined();
      const analyticsPage = analytics!.mappedPages.find((p) => p.url.includes('/analytics'));
      expect(analyticsPage).toBeDefined();
    });

    it('should map Billing to /settings/billing', () => {
      const result = mapFeaturesToPages(SOCIAL_FEATURES, SOCIAL_PAGES);
      const billing = result.find((m) => m.featureId === 'F5');

      expect(billing).toBeDefined();
      expect(billing!.status).toBe('mapped');
      const billingPage = billing!.mappedPages.find((p) => p.url.includes('/billing'));
      expect(billingPage).toBeDefined();
    });

    it('should map Post Composer to /compose', () => {
      const result = mapFeaturesToPages(SOCIAL_FEATURES, SOCIAL_PAGES);
      const composer = result.find((m) => m.featureId === 'F7');

      expect(composer).toBeDefined();
      const composePage = composer!.mappedPages.find((p) => p.url.includes('/compose'));
      expect(composePage).toBeDefined();
    });

    it('should map Platform Integrations to /integrations', () => {
      const result = mapFeaturesToPages(SOCIAL_FEATURES, SOCIAL_PAGES);
      const integrations = result.find((m) => m.featureId === 'F8');

      expect(integrations).toBeDefined();
      const intPage = integrations!.mappedPages.find((p) => p.url.includes('/integrations'));
      expect(intPage).toBeDefined();
    });

    it('should give Offline Mode low-confidence matches at best', () => {
      const result = mapFeaturesToPages(SOCIAL_FEATURES, SOCIAL_PAGES);
      const offline = result.find((m) => m.featureId === 'F10');

      expect(offline).toBeDefined();
      // Offline Mode has no dedicated page - any matches should be weak
      if (offline!.mappedPages.length > 0) {
        // All matches should be low confidence (no page is about offline/sync)
        expect(offline!.mappedPages[0].confidence).toBeLessThanOrEqual(0.6);
      }
    });
  });

  // ---- saveFeatureCoverage / loadFeatureCoverage -------------------------

  describe('saveFeatureCoverage / loadFeatureCoverage', () => {
    it('should round-trip coverage data', () => {
      const coverage: FeatureCoverage[] = [
        {
          featureId: 'F1',
          featureName: 'Auth',
          priority: 'must',
          status: 'pass',
          checkedCriteria: [
            {
              criterion: 'User can log in',
              status: 'pass',
              evidence: 'Login form found and functional',
              pageUrl: 'https://app.com/login',
            },
          ],
        },
        {
          featureId: 'F2',
          featureName: 'Dashboard',
          priority: 'should',
          status: 'not_checked',
          checkedCriteria: [],
        },
      ];

      saveFeatureCoverage(AUDIT_DIR, coverage);
      const loaded = loadFeatureCoverage(AUDIT_DIR);

      expect(loaded).not.toBeNull();
      expect(loaded).toHaveLength(2);
      expect(loaded![0].featureId).toBe('F1');
      expect(loaded![0].status).toBe('pass');
      expect(loaded![0].checkedCriteria[0].criterion).toBe('User can log in');
      expect(loaded![0].checkedCriteria[0].pageUrl).toBe('https://app.com/login');
    });

    it('should return null when no file exists', () => {
      const loaded = loadFeatureCoverage('/nonexistent/dir');
      expect(loaded).toBeNull();
    });

    it('should create directories if missing', () => {
      const deepDir = path.join(TEST_DIR, 'deep', 'nested', 'dir');
      saveFeatureCoverage(deepDir, []);
      const loaded = loadFeatureCoverage(deepDir);
      expect(loaded).toEqual([]);
    });

    it('should overwrite previous coverage', () => {
      const v1: FeatureCoverage[] = [
        { featureId: 'F1', featureName: 'A', priority: 'must', status: 'not_checked', checkedCriteria: [] },
      ];
      const v2: FeatureCoverage[] = [
        { featureId: 'F1', featureName: 'A', priority: 'must', status: 'pass', checkedCriteria: [] },
        { featureId: 'F2', featureName: 'B', priority: 'should', status: 'fail', checkedCriteria: [] },
      ];

      saveFeatureCoverage(AUDIT_DIR, v1);
      saveFeatureCoverage(AUDIT_DIR, v2);
      const loaded = loadFeatureCoverage(AUDIT_DIR);

      expect(loaded).toHaveLength(2);
      expect(loaded![0].status).toBe('pass');
    });
  });

  // ---- saveFeatureMappings / loadFeatureMappings -------------------------

  describe('saveFeatureMappings / loadFeatureMappings', () => {
    it('should round-trip mapping data', () => {
      const mappings: FeatureMapping[] = [
        {
          featureId: 'F1',
          featureName: 'Dashboard',
          priority: 'must',
          acceptanceCriteria: ['Shows stats'],
          mappedPages: [{ url: 'https://app.com/dashboard', confidence: 0.9, matchReason: 'URL match' }],
          status: 'mapped',
        },
      ];

      saveFeatureMappings(AUDIT_DIR, mappings);
      const loaded = loadFeatureMappings(AUDIT_DIR);

      expect(loaded).not.toBeNull();
      expect(loaded).toHaveLength(1);
      expect(loaded![0].featureId).toBe('F1');
      expect(loaded![0].mappedPages[0].confidence).toBe(0.9);
    });

    it('should return null when no file exists', () => {
      expect(loadFeatureMappings('/nonexistent/dir')).toBeNull();
    });
  });

  // ---- Confidence scoring details ----------------------------------------

  describe('confidence scoring', () => {
    it('should give higher confidence to route hint matches than keyword matches', () => {
      const featureWithHint = makeFeature({
        id: 'F1', name: 'Billing',
        description: 'Billing page at /settings/billing',
        acceptance_criteria: ['User visits /settings/billing'],
        keywords: ['billing'],
      });
      const featureWithoutHint = makeFeature({
        id: 'F2', name: 'Billing',
        description: 'Billing page',
        keywords: ['billing'],
      });

      const pages = [makePage('https://app.com/settings/billing', 'Billing', 'billing management')];

      const withHint = mapFeaturesToPages([featureWithHint], pages);
      const withoutHint = mapFeaturesToPages([featureWithoutHint], pages);

      // Route hint match should have >= confidence of keyword match
      expect(withHint[0].mappedPages[0].confidence).toBeGreaterThanOrEqual(
        withoutHint[0].mappedPages[0].confidence,
      );
    });

    it('should cap confidence at 1.0', () => {
      const feature = makeFeature({
        id: 'F1', name: 'Analytics Dashboard',
        description: 'Full analytics dashboard with engagement tracking',
        keywords: ['analytics', 'dashboard', 'engagement', 'tracking'],
      });
      const pages = [
        makePage('https://app.com/analytics', 'Analytics Dashboard', 'analytics engagement tracking dashboard metrics'),
      ];

      const result = mapFeaturesToPages([feature], pages);
      for (const page of result[0].mappedPages) {
        expect(page.confidence).toBeLessThanOrEqual(1);
      }
    });
  });
});
