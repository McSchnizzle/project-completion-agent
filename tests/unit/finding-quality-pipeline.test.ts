/**
 * Tests for finding quality gate filters in finding-quality-pipeline.ts
 */

import { describe, it, expect } from 'vitest';
import { filterFindings, resolveUrl } from '../../src/finding-quality-pipeline';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'F-001',
    title: 'Test finding',
    severity: 'P2',
    type: 'functionality',
    url: 'https://example.com/page',
    description: 'A real defect was found.',
    expected_behavior: 'Should work correctly.',
    actual_behavior: 'Does not work correctly.',
    confidence: 80,
    ...overrides,
  };
}

const VISITED_PAGES = [
  'https://example.com/',
  'https://example.com/dashboard',
  'https://example.com/settings',
  'https://example.com/profile',
];

// ---------------------------------------------------------------------------
// Positive Observation Filter
// ---------------------------------------------------------------------------

describe('Positive Observation Filter', () => {
  it('should reject P4 findings with positive language', () => {
    const finding = makeFinding({
      id: 'F-013',
      severity: 'P4',
      title: 'Consistent page load times suggest good performance',
      description: 'Page load times are consistent across all pages, suggesting good performance optimization.',
    });

    const result = filterFindings([finding], VISITED_PAGES);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].filter).toBe('positive-observation');
    expect(result.rejected[0].reason).toContain('positive language');
    expect(result.accepted).toHaveLength(0);
  });

  it('should not reject P4 findings without positive language', () => {
    const finding = makeFinding({
      severity: 'P4',
      title: 'Button alignment off by 2px',
      description: 'The submit button is slightly misaligned from the form container.',
    });

    const result = filterFindings([finding], VISITED_PAGES);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it('should not reject higher-severity findings even with positive language', () => {
    const finding = makeFinding({
      severity: 'P2',
      title: 'Performance is good but CSRF protection missing',
      description: 'While consistent load times suggest good caching, no CSRF tokens found.',
    });

    const result = filterFindings([finding], VISITED_PAGES);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Self-Referential Filter
// ---------------------------------------------------------------------------

describe('Self-Referential Filter', () => {
  it('should reject findings about tool limitations', () => {
    const finding = makeFinding({
      id: 'F-014',
      title: 'No accessibility testing performed',
      description: 'Accessibility was not tested during this audit. No accessibility testing was performed.',
    });

    const result = filterFindings([finding], VISITED_PAGES);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].filter).toBe('self-referential');
    expect(result.rejected[0].reason).toContain('tool limitation');
    expect(result.accepted).toHaveLength(0);
  });

  it('should reject findings saying "not verified by tool"', () => {
    const finding = makeFinding({
      title: 'Security headers not verified by tool',
      description: 'Security headers were not verified by tool during this scan.',
    });

    const result = filterFindings([finding], VISITED_PAGES);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].filter).toBe('self-referential');
  });

  it('should not reject findings about actual app bugs', () => {
    const finding = makeFinding({
      title: 'Form validation missing on email field',
      description: 'The email input accepts invalid email addresses without validation.',
    });

    const result = filterFindings([finding], VISITED_PAGES);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Unverified Route Filter
// ---------------------------------------------------------------------------

describe('Unverified Route Filter', () => {
  it('should reject findings whose only evidence is unvisited routes', () => {
    const finding = makeFinding({
      id: 'F-009',
      url: 'N/A',
      title: 'API health endpoint not accessible',
      description: 'The route /api/health was unvisited and not accessible during the audit.',
    });

    const result = filterFindings([finding], VISITED_PAGES);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].filter).toBe('unverified-route');
    expect(result.rejected[0].reason).toContain('unvisited');
  });

  it('should not reject findings about unvisited routes with concrete evidence', () => {
    const finding = makeFinding({
      url: 'N/A',
      title: 'Route /settings/privacy not accessible',
      description: 'The route was not visited but console errors were observed.',
      evidence: {
        screenshots: [],
        console_errors: ['Error: Route not found'],
        network_requests: [],
      },
      steps_to_reproduce: ['Go to /settings', 'Click privacy tab', 'See error', 'Page blank'],
    });

    const result = filterFindings([finding], VISITED_PAGES);
    expect(result.accepted).toHaveLength(1);
  });

  it('should not reject findings with URLs that were actually visited', () => {
    const finding = makeFinding({
      url: 'https://example.com/dashboard',
      title: 'Dashboard shows stale data',
      description: 'The dashboard page was not accessible for a period during testing.',
    });

    const result = filterFindings([finding], VISITED_PAGES);
    expect(result.accepted).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Vague Observation Filter
// ---------------------------------------------------------------------------

describe('Vague Observation Filter', () => {
  it('should reject vague "minimal functionality" observations without PRD reference', () => {
    const finding = makeFinding({
      id: 'F-008',
      title: 'Dashboard has minimal functionality',
      description: 'The dashboard page has minimal interactivity and limited features.',
      expected_behavior: '',
      actual_behavior: '',
    });

    const result = filterFindings([finding], VISITED_PAGES);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].filter).toBe('vague-observation');
    expect(result.rejected[0].reason).toContain('minimal');
  });

  it('should accept findings about minimal functionality WITH PRD reference', () => {
    const finding = makeFinding({
      title: 'Dashboard has minimal functionality compared to PRD',
      description: 'The dashboard has minimal functionality - missing chart widgets.',
      prd_feature: 'F-DASH-01',
    });

    const result = filterFindings([finding], VISITED_PAGES);
    expect(result.accepted).toHaveLength(1);
  });

  it('should accept findings with concrete expected vs actual', () => {
    const finding = makeFinding({
      title: 'Dashboard has minimal interactivity',
      description: 'The dashboard has minimal interactivity for data exploration.',
      expected_behavior: 'Dashboard should display interactive charts with filtering, sorting, and drill-down capability.',
      actual_behavior: 'Dashboard shows only static text with no interactive elements. No charts, no filters, no sorting controls.',
    });

    const result = filterFindings([finding], VISITED_PAGES);
    expect(result.accepted).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Valid findings pass through
// ---------------------------------------------------------------------------

describe('Valid findings pass through all filters', () => {
  it('should accept a valid responsive design finding with measurements', () => {
    const finding = makeFinding({
      title: 'Navigation menu overflows on mobile viewport',
      severity: 'P2',
      type: 'ui',
      url: 'https://example.com/dashboard',
      description: 'At 375px viewport width, the navigation menu items overflow horizontally, causing a scrollbar.',
      expected_behavior: 'Navigation should collapse into hamburger menu at widths below 768px.',
      actual_behavior: 'All 6 menu items render inline at 375px, extending 200px beyond viewport.',
      confidence: 90,
    });

    const result = filterFindings([finding], VISITED_PAGES);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it('should accept a valid security finding (CSRF)', () => {
    const finding = makeFinding({
      title: 'Missing CSRF token on form submission',
      severity: 'P1',
      type: 'security',
      url: 'https://example.com/settings',
      description: 'The settings form submits without a CSRF token, allowing cross-site request forgery.',
      expected_behavior: 'All state-changing forms should include a CSRF token.',
      actual_behavior: 'POST /api/settings contains no csrf_token parameter.',
      confidence: 95,
    });

    const result = filterFindings([finding], VISITED_PAGES);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it('should accept a valid functionality bug (broken navigation)', () => {
    const finding = makeFinding({
      title: 'Profile link returns 404',
      severity: 'P1',
      type: 'functionality',
      url: 'https://example.com/profile',
      description: 'Clicking the profile link in the nav bar navigates to /profile which returns a 404 error.',
      expected_behavior: 'Profile page should load with user information.',
      actual_behavior: 'Server returns 404 Not Found. Page displays default error template.',
      confidence: 92,
    });

    const result = filterFindings([finding], VISITED_PAGES);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// URL Resolver
// ---------------------------------------------------------------------------

describe('URL Resolver', () => {
  it('should map N/A url to the closest matching visited page', () => {
    const finding = makeFinding({
      url: 'N/A',
      title: 'Dashboard chart not rendering',
      description: 'The dashboard chart component fails to render data correctly.',
    });

    const resolved = resolveUrl(finding, VISITED_PAGES);
    expect(resolved).toBe('https://example.com/dashboard');
  });

  it('should return null when no visited page matches', () => {
    const finding = makeFinding({
      url: 'N/A',
      title: 'Completely unrelated finding',
      description: 'Something about a zebra crossing on Mars.',
    });

    const resolved = resolveUrl(finding, [
      'https://example.com/checkout',
      'https://example.com/cart',
    ]);
    expect(resolved).toBeNull();
  });

  it('should return null for empty visited pages', () => {
    const finding = makeFinding({
      url: 'N/A',
      title: 'Dashboard issue',
      description: 'Problem on dashboard.',
    });

    const resolved = resolveUrl(finding, []);
    expect(resolved).toBeNull();
  });

  it('should update finding url in filterFindings when resolved', () => {
    const finding = makeFinding({
      url: 'N/A',
      title: 'Settings page missing save button',
      description: 'The settings page is missing a save button for profile changes.',
    });

    const result = filterFindings([finding], VISITED_PAGES);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].url).toBe('https://example.com/settings');
  });
});

// ---------------------------------------------------------------------------
// Mixed batch
// ---------------------------------------------------------------------------

describe('Mixed batch filtering', () => {
  it('should correctly partition a mix of valid and invalid findings', () => {
    const findings = [
      makeFinding({
        id: 'F-001',
        title: 'CSRF token missing',
        severity: 'P1',
        type: 'security',
        url: 'https://example.com/settings',
        description: 'No CSRF protection on settings form.',
      }),
      makeFinding({
        id: 'F-002',
        severity: 'P4',
        title: 'Consistent page loads suggest good caching',
        description: 'Pages load consistently, suggesting good backend performance.',
      }),
      makeFinding({
        id: 'F-003',
        title: 'No accessibility testing performed',
        description: 'Accessibility was not tested during this audit run.',
      }),
      makeFinding({
        id: 'F-004',
        url: 'N/A',
        title: 'Unknown route not accessible',
        description: 'A route that was unvisited and not accessible during the audit.',
      }),
      makeFinding({
        id: 'F-005',
        title: 'Navigation link broken on mobile',
        severity: 'P2',
        url: 'https://example.com/dashboard',
        description: 'Hamburger menu does not open on iOS Safari.',
      }),
    ];

    const result = filterFindings(findings, VISITED_PAGES);
    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toHaveLength(3);

    const acceptedIds = result.accepted.map((f) => f.id);
    expect(acceptedIds).toContain('F-001');
    expect(acceptedIds).toContain('F-005');

    const rejectedIds = result.rejected.map((r) => r.finding.id);
    expect(rejectedIds).toContain('F-002');
    expect(rejectedIds).toContain('F-003');
    expect(rejectedIds).toContain('F-004');
  });
});
