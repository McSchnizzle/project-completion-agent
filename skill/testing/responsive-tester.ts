/**
 * Responsive Tester
 * Task 3.3: Responsive Testing Module
 *
 * Tests pages across multiple viewport sizes:
 * - Mobile (375x667)
 * - Tablet (768x1024)
 * - Desktop (1280x800)
 * - Wide (1920x1080)
 */

export interface ViewportConfig {
  name: string;
  width: number;
  height: number;
  deviceScaleFactor?: number;
  isMobile?: boolean;
  hasTouch?: boolean;
}

export interface ResponsiveTestResult {
  viewport: ViewportConfig;
  screenshotId: string | null;
  issues: ResponsiveIssue[];
  navigationAccessible: boolean;
  hasOverflow: boolean;
  loadTime: number;
}

export interface ResponsiveIssue {
  type: 'overflow' | 'hidden_content' | 'small_text' | 'touch_target' | 'layout_break' | 'navigation_hidden';
  severity: 'P2' | 'P3' | 'P4';
  element: string | null;
  description: string;
  details: Record<string, any>;
}

// Standard viewport configurations
export const VIEWPORT_CONFIGS: ViewportConfig[] = [
  {
    name: 'mobile',
    width: 375,
    height: 667,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  },
  {
    name: 'tablet',
    width: 768,
    height: 1024,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  },
  {
    name: 'desktop',
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false
  },
  {
    name: 'wide',
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false
  }
];

// Minimum touch target size (Apple HIG and Material Design guidelines)
const MIN_TOUCH_TARGET_SIZE = 44;

// Minimum readable text size
const MIN_READABLE_TEXT_SIZE = 12;

/**
 * Check page for responsive issues at given viewport
 */
export function analyzeViewport(
  accessibilityTree: any[],
  viewportWidth: number,
  viewportHeight: number,
  isMobile: boolean
): ResponsiveIssue[] {
  const issues: ResponsiveIssue[] = [];

  // Traverse accessibility tree
  function traverse(node: any) {
    // Check for small text
    if (node.style?.fontSize) {
      const fontSize = parseInt(node.style.fontSize, 10);
      if (fontSize < MIN_READABLE_TEXT_SIZE) {
        issues.push({
          type: 'small_text',
          severity: 'P3',
          element: node.ref || null,
          description: `Text is too small (${fontSize}px < ${MIN_READABLE_TEXT_SIZE}px minimum)`,
          details: { fontSize, minRequired: MIN_READABLE_TEXT_SIZE }
        });
      }
    }

    // Check touch targets on mobile
    if (isMobile && isInteractive(node)) {
      const width = node.bounds?.width || 0;
      const height = node.bounds?.height || 0;

      if (width < MIN_TOUCH_TARGET_SIZE || height < MIN_TOUCH_TARGET_SIZE) {
        issues.push({
          type: 'touch_target',
          severity: 'P2',
          element: node.ref || null,
          description: `Touch target too small (${width}x${height}px, minimum ${MIN_TOUCH_TARGET_SIZE}x${MIN_TOUCH_TARGET_SIZE}px)`,
          details: {
            width,
            height,
            minRequired: MIN_TOUCH_TARGET_SIZE,
            role: node.role
          }
        });
      }
    }

    // Check for off-screen content (potential overflow)
    if (node.bounds) {
      const { x, y, width, height } = node.bounds;
      const rightEdge = x + width;
      const bottomEdge = y + height;

      // Element extends beyond viewport
      if (rightEdge > viewportWidth + 10) { // 10px tolerance for scrollbars
        issues.push({
          type: 'overflow',
          severity: 'P3',
          element: node.ref || null,
          description: `Element extends ${Math.round(rightEdge - viewportWidth)}px beyond viewport width`,
          details: {
            elementRight: rightEdge,
            viewportWidth,
            overflow: rightEdge - viewportWidth
          }
        });
      }
    }

    // Recurse into children
    if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }

  for (const node of accessibilityTree) {
    traverse(node);
  }

  return issues;
}

/**
 * Check if element is interactive (button, link, input, etc.)
 */
function isInteractive(node: any): boolean {
  const interactiveRoles = [
    'button', 'link', 'textbox', 'checkbox', 'radio',
    'combobox', 'listbox', 'menuitem', 'option', 'slider',
    'spinbutton', 'switch', 'tab', 'treeitem'
  ];

  return interactiveRoles.includes(node.role?.toLowerCase());
}

/**
 * Check for horizontal overflow via JavaScript execution
 * Returns JS code to run in browser context
 */
export function getOverflowCheckScript(): string {
  return `
    (function() {
      const docWidth = document.documentElement.scrollWidth;
      const viewportWidth = window.innerWidth;
      const hasHorizontalOverflow = docWidth > viewportWidth;

      const overflowingElements = [];
      if (hasHorizontalOverflow) {
        document.querySelectorAll('*').forEach(el => {
          const rect = el.getBoundingClientRect();
          if (rect.right > viewportWidth) {
            overflowingElements.push({
              tag: el.tagName,
              class: el.className,
              id: el.id,
              right: rect.right,
              overflow: rect.right - viewportWidth
            });
          }
        });
      }

      return {
        hasOverflow: hasHorizontalOverflow,
        documentWidth: docWidth,
        viewportWidth: viewportWidth,
        overflowingElements: overflowingElements.slice(0, 10)
      };
    })()
  `;
}

/**
 * Check navigation accessibility via JavaScript
 * Returns JS code to run in browser context
 */
export function getNavigationCheckScript(): string {
  return `
    (function() {
      // Find navigation elements
      const navElements = [
        ...document.querySelectorAll('nav'),
        ...document.querySelectorAll('[role="navigation"]'),
        ...document.querySelectorAll('header'),
        document.querySelector('.nav'),
        document.querySelector('.navbar'),
        document.querySelector('.menu'),
        document.querySelector('#nav'),
        document.querySelector('#menu')
      ].filter(Boolean);

      const results = navElements.map(nav => {
        const style = getComputedStyle(nav);
        const rect = nav.getBoundingClientRect();

        return {
          tag: nav.tagName,
          visible: style.display !== 'none' && style.visibility !== 'hidden',
          inViewport: rect.top >= 0 && rect.left >= 0 &&
                      rect.bottom <= window.innerHeight &&
                      rect.right <= window.innerWidth,
          links: nav.querySelectorAll('a').length,
          height: rect.height
        };
      });

      // Check for hamburger menu
      const hamburger = document.querySelector(
        '[class*="hamburger"], [class*="menu-toggle"], [aria-label*="menu"], button[class*="nav"]'
      );

      return {
        navigationElements: results,
        hasHamburgerMenu: !!hamburger,
        hamburgerVisible: hamburger ?
          getComputedStyle(hamburger).display !== 'none' : false
      };
    })()
  `;
}

/**
 * Generate viewport test commands
 */
export function generateViewportTests(
  pageUrl: string,
  viewports: ViewportConfig[] = VIEWPORT_CONFIGS.slice(0, 3) // Default to mobile, tablet, desktop
): Array<{
  viewport: ViewportConfig;
  steps: string[];
}> {
  return viewports.map(viewport => ({
    viewport,
    steps: [
      `Resize window to ${viewport.width}x${viewport.height}`,
      'Wait for layout to settle (1s)',
      'Run overflow check script',
      'Run navigation check script',
      'Analyze accessibility tree for issues',
      'Take screenshot',
      'Record results'
    ]
  }));
}

/**
 * Prioritize pages for responsive testing
 */
export function prioritizePagesForResponsiveTesting(
  pages: Array<{ url: string; title: string | null; formsCount: number }>
): string[] {
  // Prioritize pages that are most likely to have responsive issues
  const scored = pages.map(page => {
    let score = 0;

    // Home/landing pages
    if (page.url.endsWith('/') || /\/(home|index)$/i.test(page.url)) {
      score += 10;
    }

    // Navigation-heavy pages
    if (/\/(menu|nav|dashboard)/i.test(page.url)) {
      score += 8;
    }

    // Pages with forms
    score += page.formsCount * 3;

    // Content pages
    if (/\/(about|contact|pricing|features)/i.test(page.url)) {
      score += 5;
    }

    // Data/table pages
    if (/\/(list|table|data|report)/i.test(page.url)) {
      score += 6;
    }

    return { url: page.url, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Return top pages (limit to reasonable number)
  return scored.slice(0, 10).map(p => p.url);
}

/**
 * Summarize responsive test results
 */
export function summarizeResponsiveResults(
  results: ResponsiveTestResult[]
): {
  totalIssues: number;
  issuesByViewport: Record<string, number>;
  issuesBySeverity: Record<string, number>;
  criticalIssues: ResponsiveIssue[];
  recommendations: string[];
} {
  const issuesByViewport: Record<string, number> = {};
  const issuesBySeverity: Record<string, number> = { P2: 0, P3: 0, P4: 0 };
  const allIssues: ResponsiveIssue[] = [];

  for (const result of results) {
    issuesByViewport[result.viewport.name] = result.issues.length;

    for (const issue of result.issues) {
      issuesBySeverity[issue.severity]++;
      allIssues.push(issue);
    }
  }

  // Generate recommendations
  const recommendations: string[] = [];

  const touchIssues = allIssues.filter(i => i.type === 'touch_target').length;
  if (touchIssues > 3) {
    recommendations.push(`Increase touch target sizes for ${touchIssues} interactive elements (minimum 44x44px)`);
  }

  const overflowIssues = allIssues.filter(i => i.type === 'overflow').length;
  if (overflowIssues > 0) {
    recommendations.push('Fix horizontal overflow issues - consider using max-width and overflow-x: hidden');
  }

  const smallTextIssues = allIssues.filter(i => i.type === 'small_text').length;
  if (smallTextIssues > 0) {
    recommendations.push('Increase font sizes for better readability (minimum 12px, recommend 16px for body)');
  }

  const mobileNavIssues = results
    .filter(r => r.viewport.isMobile && !r.navigationAccessible)
    .length;
  if (mobileNavIssues > 0) {
    recommendations.push('Ensure navigation is accessible on mobile devices (hamburger menu or visible links)');
  }

  return {
    totalIssues: allIssues.length,
    issuesByViewport,
    issuesBySeverity,
    criticalIssues: allIssues.filter(i => i.severity === 'P2'),
    recommendations
  };
}
