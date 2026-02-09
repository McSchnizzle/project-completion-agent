/**
 * Interactive Tester - Discovers and tests interactive elements on web pages.
 *
 * Uses the BrowserBackend interface to visit pages, discover interactive
 * elements by parsing HTML, and test them by clicking/interacting. Collects
 * console errors, failed network requests, and DOM changes for each interaction.
 *
 * @module interactive-tester
 */

import type {
  BrowserBackend,
  ClickResult,
  FormSubmitResult,
  ConsoleMessage,
  NetworkRequest,
} from './browser-backend.js';
import type { PageData } from './playwright-browser.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InteractiveElementType =
  | 'button'
  | 'link'
  | 'dropdown'
  | 'checkbox'
  | 'radio'
  | 'toggle'
  | 'tab'
  | 'accordion'
  | 'modal-trigger'
  | 'menu-item'
  | 'other';

export interface InteractiveElement {
  selector: string;
  tagName: string;
  elementType: InteractiveElementType;
  text: string;
  visible: boolean;
  enabled: boolean;
  href?: string;
  label?: string;
  /** CSS selector for the parent form, if this element is a submit button inside a form. */
  formParentSelector?: string;
}

export interface InteractionTestResult {
  element: InteractiveElement;
  url: string;
  result: ClickResult | FormSubmitResult;
  hasError: boolean;
  description: string;
  consoleErrors: ConsoleMessage[];
  failedRequests: NetworkRequest[];
  durationMs: number;
  screenshotBefore?: Buffer;
}

export interface PageInteractionResult {
  url: string;
  elementsDiscovered: InteractiveElement[];
  elementsTested: InteractionTestResult[];
  elementsSkipped: Array<{ element: InteractiveElement; reason: string }>;
  totalDurationMs: number;
}

export interface InteractiveTesterConfig {
  maxElementsPerPage?: number;
  interactionTimeoutMs?: number;
  testNavigationLinks?: boolean;
  testFormSubmission?: boolean;
  safeMode?: boolean;
  skipSelectors?: string[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Required<InteractiveTesterConfig> = {
  maxElementsPerPage: 20,
  interactionTimeoutMs: 10_000,
  testNavigationLinks: false,
  testFormSubmission: true,
  safeMode: true,
  skipSelectors: [],
};

// ---------------------------------------------------------------------------
// Regex-based HTML element extraction helpers
// ---------------------------------------------------------------------------

/**
 * Destructive-action patterns used in safe mode. Elements whose text content
 * matches any of these will be skipped to avoid unintentional side-effects.
 */
const DESTRUCTIVE_PATTERN =
  /delete|remove|destroy|logout|sign.?out|unsubscribe|cancel.?account/i;

/**
 * Strip HTML tags from a string to extract plain text content.
 */
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Extract an attribute value from a raw HTML opening tag string.
 * Returns undefined if the attribute is not present.
 */
function getAttr(tag: string, attr: string): string | undefined {
  // Matches: attr="value", attr='value', or attr=value (unquoted)
  const re = new RegExp(`${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(\\S+))`, 'i');
  const m = tag.match(re);
  if (!m) return undefined;
  return m[1] ?? m[2] ?? m[3];
}

/**
 * Check whether an opening tag contains the `disabled` attribute (boolean
 * attribute or disabled="disabled" / disabled="true").
 */
function isDisabled(tag: string): boolean {
  // Boolean attribute (just `disabled`) or disabled="..."
  return /\bdisabled(?:\s*=\s*(?:"[^"]*"|'[^']*'|\S+))?/i.test(tag);
}

/**
 * Check whether an opening tag contains a `hidden` attribute, or
 * an inline style that sets `display:none` or `visibility:hidden`.
 */
function isHidden(tag: string): boolean {
  if (/\bhidden\b/i.test(tag) && !/\bhidden\s*=/i.test(tag)) {
    return true;
  }
  // hidden="hidden" or hidden="true"
  const hiddenVal = getAttr(tag, 'hidden');
  if (hiddenVal !== undefined) return true;

  const style = getAttr(tag, 'style') ?? '';
  if (/display\s*:\s*none/i.test(style)) return true;
  if (/visibility\s*:\s*hidden/i.test(style)) return true;

  // aria-hidden="true"
  const ariaHidden = getAttr(tag, 'aria-hidden');
  if (ariaHidden === 'true') return true;

  return false;
}

/**
 * Build a CSS selector from the information available in a tag string.
 * Prefer id, then unique data attributes, falling back to tag + nth-of-type
 * approximation using the provided index.
 */
function buildSelector(
  tagName: string,
  tag: string,
  index: number,
): string {
  const id = getAttr(tag, 'id');
  if (id) return `#${id}`;

  const name = getAttr(tag, 'name');
  const type = getAttr(tag, 'type');
  const className = getAttr(tag, 'class');

  // For inputs, use name + type combination which is usually unique
  if (tagName === 'input' && name) {
    const base = type ? `input[type="${type}"][name="${name}"]` : `input[name="${name}"]`;
    return base;
  }

  // For selects/textareas with name
  if ((tagName === 'select' || tagName === 'textarea') && name) {
    return `${tagName}[name="${name}"]`;
  }

  // Use class if available (first class token only, to keep it short)
  if (className) {
    const firstClass = className.trim().split(/\s+/)[0];
    if (firstClass) {
      return `${tagName}.${firstClass}`;
    }
  }

  // Fallback: tag name + :nth-of-type
  return `${tagName}:nth-of-type(${index + 1})`;
}

/**
 * Determine the InteractiveElementType for an element given its tag, attributes,
 * and optional role attribute.
 */
function classifyElement(
  tagName: string,
  tag: string,
): InteractiveElementType {
  const role = getAttr(tag, 'role')?.toLowerCase();

  if (role === 'button') return 'button';
  if (role === 'tab') return 'tab';
  if (role === 'menuitem') return 'menu-item';

  switch (tagName) {
    case 'button':
      return 'button';
    case 'a':
      return 'link';
    case 'select':
      return 'dropdown';
    case 'input': {
      const type = (getAttr(tag, 'type') ?? 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
      return 'other';
    }
    default:
      return 'other';
  }
}

// ---------------------------------------------------------------------------
// InteractiveTester
// ---------------------------------------------------------------------------

export class InteractiveTester {
  private backend: BrowserBackend;
  private config: Required<InteractiveTesterConfig>;

  constructor(backend: BrowserBackend, config?: InteractiveTesterConfig) {
    this.backend = backend;
    this.config = {
      maxElementsPerPage: config?.maxElementsPerPage ?? DEFAULT_CONFIG.maxElementsPerPage,
      interactionTimeoutMs: config?.interactionTimeoutMs ?? DEFAULT_CONFIG.interactionTimeoutMs,
      testNavigationLinks: config?.testNavigationLinks ?? DEFAULT_CONFIG.testNavigationLinks,
      testFormSubmission: config?.testFormSubmission ?? DEFAULT_CONFIG.testFormSubmission,
      safeMode: config?.safeMode ?? DEFAULT_CONFIG.safeMode,
      skipSelectors: config?.skipSelectors ?? DEFAULT_CONFIG.skipSelectors,
    };
  }

  // -------------------------------------------------------------------------
  // discoverElements
  // -------------------------------------------------------------------------

  /**
   * Visit a page and discover all interactive elements by parsing the returned HTML.
   *
   * Because we cannot execute arbitrary JavaScript through the BrowserBackend
   * interface, we rely on regex-based parsing of PageData.html to find
   * interactive elements.
   */
  async discoverElements(url: string): Promise<InteractiveElement[]> {
    const pageData: PageData = await this.backend.visitPage(url);
    const html = pageData.html;

    const elements: InteractiveElement[] = [];

    // Track indices per tag name for nth-of-type selector fallback
    const tagCounters: Record<string, number> = {};

    // Combined regex that matches opening tags we care about.
    // We capture the full tag and then extract the inner content up to the
    // matching closing tag for non-void elements.
    //
    // Pattern matches:
    //   <button ...>...</button>
    //   <a ...>...</a>
    //   <select ...>...</select>
    //   <input ...> or <input .../>
    //   Any tag with role="button|tab|menuitem"
    const tagPattern =
      /<(button|a|select|input|textarea)\b([^>]*)(?:\/>|>([\s\S]*?)<\/\1>|>)/gi;

    // Also match divs/spans/li with interactive roles
    const rolePattern =
      /<(div|span|li|summary|details)\b([^>]*\brole\s*=\s*(?:"(?:button|tab|menuitem)"|'(?:button|tab|menuitem)')(?:[^>]*))(?:\/>|>([\s\S]*?)<\/\1>|>)/gi;

    // Process standard interactive tags
    let match: RegExpExecArray | null;
    while ((match = tagPattern.exec(html)) !== null) {
      const tagName = match[1].toLowerCase();
      const attrs = match[2];
      const innerContent = match[3] ?? '';
      const fullTag = match[0];

      // Build the full opening tag for attribute extraction
      const openingTag = `<${tagName}${attrs}>`;

      // Count occurrences for selector building
      if (!(tagName in tagCounters)) tagCounters[tagName] = 0;
      const idx = tagCounters[tagName]++;

      // Skip input types that are not interactive (hidden, text, email, etc.)
      if (tagName === 'input') {
        const inputType = (getAttr(openingTag, 'type') ?? 'text').toLowerCase();
        const interactiveInputTypes = [
          'button', 'submit', 'reset', 'checkbox', 'radio',
        ];
        if (!interactiveInputTypes.includes(inputType)) {
          continue;
        }
      }

      // Skip textareas (not really "interactive" in the click-test sense)
      if (tagName === 'textarea') continue;

      const visible = !isHidden(openingTag);
      const enabled = !isDisabled(openingTag);
      const text = tagName === 'input'
        ? (getAttr(openingTag, 'value') ?? getAttr(openingTag, 'aria-label') ?? '').trim()
        : stripTags(innerContent);
      const href = tagName === 'a' ? getAttr(openingTag, 'href') : undefined;
      const ariaLabel = getAttr(openingTag, 'aria-label');
      const label = ariaLabel ?? undefined;

      const selector = buildSelector(tagName, openingTag, idx);
      const elementType = classifyElement(tagName, openingTag);

      // Detect form parent for submit buttons
      let formParentSelector: string | undefined;
      if (
        (tagName === 'button' && (getAttr(openingTag, 'type') ?? '').toLowerCase() === 'submit') ||
        (tagName === 'input' && (getAttr(openingTag, 'type') ?? '').toLowerCase() === 'submit')
      ) {
        // Find the nearest enclosing <form> by scanning backwards in the HTML
        const matchIndex = match.index;
        const beforeMatch = html.substring(0, matchIndex);
        const formOpenRegex = /<form\b([^>]*)>/gi;
        const formCloseRegex = /<\/form>/gi;
        let lastFormOpen = -1;
        let lastFormAttrs = '';
        let formMatch: RegExpExecArray | null;
        while ((formMatch = formOpenRegex.exec(beforeMatch)) !== null) {
          lastFormOpen = formMatch.index;
          lastFormAttrs = formMatch[1];
        }
        if (lastFormOpen >= 0) {
          // Check that no </form> occurs between the form open and this element
          let formClosed = false;
          let closeMatch: RegExpExecArray | null;
          while ((closeMatch = formCloseRegex.exec(beforeMatch)) !== null) {
            if (closeMatch.index > lastFormOpen) {
              formClosed = true;
            }
          }
          if (!formClosed) {
            const formId = getAttr(`<form${lastFormAttrs}>`, 'id');
            const formIdx = (beforeMatch.substring(0, lastFormOpen).match(/<form\b/gi) || []).length;
            formParentSelector = formId
              ? `#${formId}`
              : `form:nth-of-type(${formIdx + 1})`;
          }
        }
      }

      elements.push({
        selector,
        tagName,
        elementType,
        text,
        visible,
        enabled,
        ...(href !== undefined ? { href } : {}),
        ...(label !== undefined ? { label } : {}),
        ...(formParentSelector !== undefined ? { formParentSelector } : {}),
      });
    }

    // Process elements with interactive roles (div, span, li, summary)
    while ((match = rolePattern.exec(html)) !== null) {
      const tagName = match[1].toLowerCase();
      const attrs = match[2];
      const innerContent = match[3] ?? '';

      const openingTag = `<${tagName}${attrs}>`;

      if (!(tagName in tagCounters)) tagCounters[tagName] = 0;
      const idx = tagCounters[tagName]++;

      const role = getAttr(openingTag, 'role')?.toLowerCase();
      if (!role || !['button', 'tab', 'menuitem'].includes(role)) continue;

      const visible = !isHidden(openingTag);
      const enabled = !isDisabled(openingTag);
      const text = stripTags(innerContent);
      const ariaLabel = getAttr(openingTag, 'aria-label');
      const label = ariaLabel ?? undefined;

      const selector = buildSelector(tagName, openingTag, idx);
      const elementType = classifyElement(tagName, openingTag);

      elements.push({
        selector,
        tagName,
        elementType,
        text,
        visible,
        enabled,
        ...(label !== undefined ? { label } : {}),
      });
    }

    // Return elements in page order (they are already in order from regex matching)
    return elements;
  }

  // -------------------------------------------------------------------------
  // testPage
  // -------------------------------------------------------------------------

  /**
   * Discover all interactive elements on a page, then test each one
   * (up to the configured limit). Returns comprehensive results including
   * tested, skipped, and timing information.
   */
  async testPage(url: string): Promise<PageInteractionResult> {
    const startTime = Date.now();

    const discovered = await this.discoverElements(url);
    const tested: InteractionTestResult[] = [];
    const skipped: Array<{ element: InteractiveElement; reason: string }> = [];

    for (let i = 0; i < discovered.length; i++) {
      const element = discovered[i];

      // Enforce the per-page element limit
      if (tested.length >= this.config.maxElementsPerPage) {
        skipped.push({ element, reason: 'Exceeded maxElementsPerPage limit' });
        continue;
      }

      // Check if this element should be skipped
      const skipReason = this.shouldSkip(element);
      if (skipReason !== null) {
        skipped.push({ element, reason: skipReason });
        continue;
      }

      const result = await this.testElement(url, element);
      tested.push(result);
    }

    return {
      url,
      elementsDiscovered: discovered,
      elementsTested: tested,
      elementsSkipped: skipped,
      totalDurationMs: Date.now() - startTime,
    };
  }

  // -------------------------------------------------------------------------
  // testElement
  // -------------------------------------------------------------------------

  /**
   * Test a single interactive element by clicking it and observing the results.
   * Collects console errors and failed network requests that occurred during
   * the interaction.
   */
  async testElement(
    url: string,
    element: InteractiveElement,
  ): Promise<InteractionTestResult> {
    const startTime = Date.now();

    // Capture screenshot before interaction
    let screenshotBefore: Buffer | undefined;
    try {
      screenshotBefore = await this.backend.captureScreenshot();
    } catch {
      // Screenshot capture is best-effort
    }

    let result: ClickResult | FormSubmitResult;
    try {
      // Use fillAndSubmitForm for submit buttons inside forms (safe mode: empty values)
      if (element.formParentSelector && this.config.testFormSubmission) {
        result = await this.backend.fillAndSubmitForm(
          url,
          element.formParentSelector,
          {},
        );
      } else {
        result = await this.backend.clickElement(url, element.selector);
      }
    } catch (err) {
      // If the interaction fails, synthesize a ClickResult indicating failure
      result = {
        success: false,
        urlAfter: url,
        navigated: false,
        domChanges: [],
        consoleMessages: [],
        networkRequests: [],
        error: err instanceof Error ? err.message : String(err),
      } satisfies ClickResult;
    }

    const durationMs = Date.now() - startTime;

    // Extract console errors from the result
    const consoleErrors = result.consoleMessages.filter(
      (msg) => msg.type === 'error' || msg.type === 'warning',
    );

    // Extract failed network requests from the result
    const failedRequests = result.networkRequests.filter(
      (req) => req.isError,
    );

    // Determine whether the interaction produced an error
    const hasError =
      !result.success ||
      consoleErrors.some((msg) => msg.type === 'error') ||
      failedRequests.length > 0;

    const description = this.describeResult(element, result as ClickResult);

    return {
      element,
      url,
      result,
      hasError,
      description,
      consoleErrors,
      failedRequests,
      durationMs,
      screenshotBefore,
    };
  }

  // -------------------------------------------------------------------------
  // shouldSkip
  // -------------------------------------------------------------------------

  /**
   * Determine whether an element should be skipped and return the reason,
   * or null if the element should be tested.
   */
  shouldSkip(element: InteractiveElement): string | null {
    // Not visible
    if (!element.visible) {
      return 'Element is not visible';
    }

    // Not enabled
    if (!element.enabled) {
      return 'Element is disabled';
    }

    // Link elements when testNavigationLinks is off
    if (element.elementType === 'link' && !this.config.testNavigationLinks) {
      return 'Navigation links testing is disabled';
    }

    // Safe mode: skip destructive-looking actions
    if (this.config.safeMode && DESTRUCTIVE_PATTERN.test(element.text)) {
      return `Safe mode: text matches destructive pattern ("${element.text}")`;
    }

    if (
      this.config.safeMode &&
      element.label &&
      DESTRUCTIVE_PATTERN.test(element.label)
    ) {
      return `Safe mode: label matches destructive pattern ("${element.label}")`;
    }

    // Skip selectors from config
    for (const skipSelector of this.config.skipSelectors) {
      if (element.selector === skipSelector || element.selector.includes(skipSelector)) {
        return `Matches skip selector: ${skipSelector}`;
      }
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // describeResult
  // -------------------------------------------------------------------------

  /**
   * Build a human-readable description of what happened when an element was
   * clicked.
   */
  describeResult(
    element: InteractiveElement,
    result: ClickResult,
  ): string {
    const elementLabel = element.text
      ? `${element.elementType} '${element.text}'`
      : `${element.elementType} (${element.selector})`;

    const parts: string[] = [`Clicked ${elementLabel}`];

    if (result.error) {
      parts.push(`- error: ${result.error}`);
      return parts.join(' ');
    }

    if (result.navigated) {
      parts.push(`- navigated to ${result.urlAfter}`);
    }

    if (result.domChanges && result.domChanges.length > 0) {
      parts.push(`- ${result.domChanges.length} DOM change${result.domChanges.length !== 1 ? 's' : ''}`);
    }

    const errorCount = result.consoleMessages.filter(
      (m) => m.type === 'error',
    ).length;
    if (errorCount > 0) {
      parts.push(`- ${errorCount} console error${errorCount !== 1 ? 's' : ''}`);
    }

    const failedReqs = result.networkRequests.filter((r) => r.isError).length;
    if (failedReqs > 0) {
      parts.push(`- ${failedReqs} failed request${failedReqs !== 1 ? 's' : ''}`);
    }

    if (!result.navigated && (!result.domChanges || result.domChanges.length === 0) && !result.error) {
      parts.push('- no visible effect');
    }

    return parts.join(' ');
  }
}
