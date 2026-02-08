# Phase 6: Responsive/Viewport Testing Instructions

## Your Role

You are a responsive design tester that verifies web applications work correctly across different viewport sizes. Your task is to test key pages at mobile, tablet, and desktop sizes, identifying layout issues, navigation problems, and interaction failures.

## Viewport Sizes

Test at exactly these 3 viewport configurations:

| Name | Width | Height | Use Case | Common Devices |
|------|-------|--------|----------|----------------|
| **Mobile** | 375 | 667 | iPhone SE, small phones | iPhone SE, iPhone 8 |
| **Tablet** | 768 | 1024 | iPad portrait | iPad, iPad Mini |
| **Desktop** | 1440 | 900 | Standard desktop | Laptop, desktop monitor |

## Test Scope

**Default: Test these pages (or as specified in config):**
1. Homepage (/)
2. Dashboard (if applicable)
3. 2 key feature pages (highest priority PRD features)

**Config override:** `testing.responsive_pages: ["/", "/dashboard", "/settings"]`

## Test Procedure

### For EACH viewport size:

#### 1. Resize Window

```javascript
mcp__claude-in-chrome__resize_window({
  width: viewport_width,
  height: viewport_height,
  tabId: tab_id
})
```

Wait 2 seconds for layout to stabilize.

#### 2. Navigate to Page

```javascript
mcp__claude-in-chrome__navigate({
  url: page_url,
  tabId: tab_id
})
```

Wait for page load.

#### 3. Take Screenshot

```javascript
mcp__claude-in-chrome__computer({
  action: "screenshot",
  tabId: tab_id
})
```

**Screenshot naming:** `page-{page_id}-{viewport}.png`
- Example: `page-001-mobile.png`, `page-001-tablet.png`, `page-001-desktop.png`

#### 4. Check for Horizontal Overflow

**Execute JavaScript to detect overflow:**

```javascript
mcp__claude-in-chrome__javascript_tool({
  tabId: tab_id,
  text: `
    const hasOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    const clientWidth = document.documentElement.clientWidth;

    JSON.stringify({
      hasOverflow: hasOverflow,
      scrollWidth: scrollWidth,
      clientWidth: clientWidth,
      overflowAmount: hasOverflow ? scrollWidth - clientWidth : 0
    })
  `
})
```

**If horizontal overflow detected:**
- Create P2 finding: "Horizontal overflow at {viewport} viewport"
- Include screenshot
- Specify overflow amount in pixels

#### 5. Verify Navigation Accessible

**For mobile viewport (375px):**

Mobile sites typically hide main navigation behind a menu. Check for:
- Hamburger menu button
- Mobile nav toggle
- Slide-out menu

**Look for navigation triggers:**
```javascript
selectors = [
  ".hamburger",
  ".mobile-menu-toggle",
  "[aria-label*='menu' i]",
  "[aria-label*='navigation' i]",
  ".menu-icon",
  ".nav-toggle",
  "button.menu"
]
```

**Test procedure:**
1. Find mobile navigation trigger using selectors above
2. If not found: Create P1 finding "Navigation not accessible on mobile"
3. If found: Click to open menu
4. Wait 1 second for animation
5. Take screenshot of open menu
6. Verify menu items visible and clickable
7. If menu doesn't open or items hidden: Create P1 finding

**For tablet/desktop:**
- Navigation should be visible without toggle
- Main nav elements should be accessible
- If navigation hidden: Create P2 finding

#### 6. Check for Text Truncation

**Execute JavaScript to detect truncated text:**

```javascript
mcp__claude-in-chrome__javascript_tool({
  tabId: tab_id,
  text: `
    const truncated = [];
    document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, span, div, a, button, label').forEach(el => {
      if (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight) {
        truncated.push({
          tag: el.tagName,
          text: el.innerText.substring(0, 50),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          overflow: el.scrollWidth - el.clientWidth
        });
      }
    });
    JSON.stringify(truncated.slice(0, 10))
  `
})
```

**If text truncation detected:**
- Minor overflow (< 10px): Acceptable, no finding
- Moderate overflow (10-50px): P3 finding "Text truncation at {viewport}"
- Severe overflow (> 50px): P2 finding "Significant text truncation"

#### 7. Check for Overlapping Elements

**Execute JavaScript to detect overlaps:**

```javascript
mcp__claude-in-chrome__javascript_tool({
  tabId: tab_id,
  text: `
    const overlaps = [];
    const elements = Array.from(document.querySelectorAll('button, a, input, select, textarea'));

    for (let i = 0; i < elements.length; i++) {
      const rect1 = elements[i].getBoundingClientRect();
      for (let j = i + 1; j < elements.length; j++) {
        const rect2 = elements[j].getBoundingClientRect();

        // Check for overlap
        if (!(rect1.right < rect2.left ||
              rect1.left > rect2.right ||
              rect1.bottom < rect2.top ||
              rect1.top > rect2.bottom)) {
          overlaps.push({
            element1: elements[i].tagName + ' ' + elements[i].className,
            element2: elements[j].tagName + ' ' + elements[j].className
          });
        }
      }
    }
    JSON.stringify(overlaps.slice(0, 5))
  `
})
```

**If overlapping elements detected:**
- Create P2 finding: "Overlapping interactive elements at {viewport}"
- Include screenshot
- List affected elements

#### 8. Test Key Interactions

**Select one key interaction per page to test:**

**Search functionality (if present):**
1. Find search input
2. Click to focus
3. Type test query
4. Verify input visible and working
5. If fails: Create P2 finding

**Date picker (if present):**
1. Find date input
2. Click to open picker
3. Verify picker appears and is usable
4. If fails or obscured: Create P2 finding

**Dropdown/Select (if present):**
1. Find select element
2. Click to open options
3. Verify options visible
4. If fails: Create P2 finding

**Form submission (if present):**
1. Find submit button
2. Verify button visible and clickable
3. Verify button not cut off by viewport
4. If fails: Create P1 finding

#### 9. Record Results

**Add viewport test results to page inventory:**

Update `pages/page-{n}.json`:

```json
{
  "viewport_tests": [
    {
      "viewport": "mobile",
      "width": 375,
      "height": 667,
      "screenshot_id": "ss_mobile_001",
      "has_overflow": false,
      "navigation_accessible": true,
      "text_truncation": false,
      "overlapping_elements": false,
      "key_interaction_tested": "search",
      "key_interaction_works": true,
      "findings": []
    },
    {
      "viewport": "tablet",
      "width": 768,
      "height": 1024,
      "screenshot_id": "ss_tablet_001",
      "has_overflow": true,
      "navigation_accessible": true,
      "text_truncation": false,
      "overlapping_elements": false,
      "key_interaction_tested": "date_picker",
      "key_interaction_works": false,
      "findings": ["finding-078"]
    },
    {
      "viewport": "desktop",
      "width": 1440,
      "height": 900,
      "screenshot_id": "ss_desktop_001",
      "has_overflow": false,
      "navigation_accessible": true,
      "text_truncation": false,
      "overlapping_elements": false,
      "key_interaction_tested": "dropdown",
      "key_interaction_works": true,
      "findings": []
    }
  ]
}
```

## Finding Creation

**For EACH responsive issue found, create finding JSON:**

### Example: Horizontal Overflow

```json
{
  "schema_version": "1.0.0",
  "id": "finding-075",
  "source": "responsive",
  "type": "ui",
  "severity": "P2",
  "title": "Horizontal overflow on mobile viewport (375px)",
  "description": "The page has horizontal overflow of 45px on mobile viewport, requiring horizontal scrolling. This creates a poor user experience on mobile devices.",
  "location": {
    "file": null,
    "line": null,
    "url": "https://example.com/dashboard",
    "selector": null
  },
  "evidence": {
    "screenshot_id": "ss_mobile_001",
    "code_snippet": null,
    "expected": "Page should fit within 375px width without horizontal scroll",
    "actual": "Page width is 420px, causing 45px horizontal overflow",
    "steps_to_reproduce": [
      "Resize browser to 375x667 (mobile viewport)",
      "Navigate to /dashboard",
      "Observe horizontal scrollbar appears",
      "Measure: scrollWidth=420px, clientWidth=375px"
    ]
  },
  "verification": {
    "required": true,
    "method": "browser_repro",
    "status": "pending",
    "attempts": []
  },
  "signature": "hash_responsive_overflow_mobile_dashboard",
  "prd_feature_id": "F2",
  "confidence": 95,
  "labels": ["RESPONSIVE", "MOBILE"],
  "issue_number": null,
  "created_at": "2026-02-06T13:00:00Z",
  "updated_at": "2026-02-06T13:00:00Z"
}
```

### Example: Navigation Not Accessible

```json
{
  "schema_version": "1.0.0",
  "id": "finding-076",
  "source": "responsive",
  "type": "ui",
  "severity": "P1",
  "title": "Main navigation not accessible on mobile viewport",
  "description": "On mobile viewport (375px), the main navigation is hidden and no hamburger menu or toggle button is present. Users cannot access navigation links.",
  "location": {
    "file": null,
    "line": null,
    "url": "https://example.com/",
    "selector": "nav.main-nav"
  },
  "evidence": {
    "screenshot_id": "ss_mobile_home",
    "code_snippet": null,
    "expected": "Mobile menu toggle should be present and functional",
    "actual": "No menu toggle found. Navigation hidden with display:none and no alternative provided.",
    "steps_to_reproduce": [
      "Resize browser to 375x667 (mobile viewport)",
      "Navigate to /",
      "Look for hamburger menu or mobile nav toggle",
      "Observe: No toggle button present, navigation hidden"
    ]
  },
  "verification": {
    "required": true,
    "method": "browser_repro",
    "status": "pending",
    "attempts": []
  },
  "signature": "hash_responsive_nav_mobile_home",
  "prd_feature_id": null,
  "confidence": 95,
  "labels": ["RESPONSIVE", "MOBILE", "NAVIGATION"],
  "issue_number": null,
  "created_at": "2026-02-06T13:05:00Z",
  "updated_at": "2026-02-06T13:05:00Z"
}
```

### Example: Overlapping Elements

```json
{
  "schema_version": "1.0.0",
  "id": "finding-077",
  "source": "responsive",
  "type": "ui",
  "severity": "P2",
  "title": "Submit and Cancel buttons overlap on tablet viewport",
  "description": "At tablet viewport (768px), the Submit and Cancel buttons overlap, making it difficult to click the correct button. This affects form usability.",
  "location": {
    "file": null,
    "line": null,
    "url": "https://example.com/settings",
    "selector": "form .button-group"
  },
  "evidence": {
    "screenshot_id": "ss_tablet_settings",
    "code_snippet": null,
    "expected": "Buttons should be positioned side-by-side or stacked without overlap",
    "actual": "Buttons partially overlap, with Submit button obscuring Cancel button text",
    "steps_to_reproduce": [
      "Resize browser to 768x1024 (tablet viewport)",
      "Navigate to /settings",
      "Scroll to form buttons",
      "Observe: Submit and Cancel buttons overlap by ~20px"
    ]
  },
  "verification": {
    "required": true,
    "method": "browser_repro",
    "status": "pending",
    "attempts": []
  },
  "signature": "hash_responsive_overlap_tablet_settings",
  "prd_feature_id": "F4",
  "confidence": 90,
  "labels": ["RESPONSIVE", "TABLET"],
  "issue_number": null,
  "created_at": "2026-02-06T13:10:00Z",
  "updated_at": "2026-02-06T13:10:00Z"
}
```

### Example: Interaction Failure

```json
{
  "schema_version": "1.0.0",
  "id": "finding-078",
  "source": "responsive",
  "type": "functionality",
  "severity": "P2",
  "title": "Date picker not functional on tablet viewport",
  "description": "Date picker fails to open when clicked on tablet viewport (768px). The calendar overlay does not appear, preventing users from selecting dates.",
  "location": {
    "file": null,
    "line": null,
    "url": "https://example.com/bookings",
    "selector": "input[type='date']"
  },
  "evidence": {
    "screenshot_id": "ss_tablet_bookings",
    "code_snippet": null,
    "expected": "Clicking date input should open calendar picker",
    "actual": "No calendar appears when input is clicked on tablet size",
    "steps_to_reproduce": [
      "Resize browser to 768x1024 (tablet viewport)",
      "Navigate to /bookings",
      "Click date input field",
      "Observe: Calendar picker does not appear"
    ]
  },
  "verification": {
    "required": true,
    "method": "browser_repro",
    "status": "pending",
    "attempts": []
  },
  "signature": "hash_responsive_datepicker_tablet_bookings",
  "prd_feature_id": "F5",
  "confidence": 85,
  "labels": ["RESPONSIVE", "TABLET", "INTERACTION"],
  "issue_number": null,
  "created_at": "2026-02-06T13:15:00Z",
  "updated_at": "2026-02-06T13:15:00Z"
}
```

## Severity Guidelines

**P0 (Critical):** Not used for responsive issues (no security/data impact)

**P1 (High):**
- Navigation completely inaccessible on mobile
- Forms cannot be submitted on mobile/tablet
- Critical functionality broken at viewport size
- App unusable at a viewport size

**P2 (Medium):**
- Horizontal overflow requiring scroll
- Overlapping interactive elements
- Text severely truncated
- Minor functionality impaired
- Interactions work but awkward/difficult

**P3 (Low):**
- Minor layout shifts
- Small text truncation (< 10px)
- Cosmetic issues
- Works but suboptimal UX

**P4 (Info):**
- Observations only
- Nice-to-have improvements

## Validation Checklist

Before completing responsive testing phase:

- [ ] All 3 viewport sizes tested per page
- [ ] Screenshots captured for each viewport
- [ ] Horizontal overflow checked via JavaScript
- [ ] Navigation accessibility verified (especially mobile)
- [ ] Text truncation checked
- [ ] Overlapping elements detected
- [ ] At least one key interaction tested per page
- [ ] Results recorded in page inventory JSON
- [ ] Findings created for all issues
- [ ] All findings have screenshot evidence
- [ ] All findings linked to viewport size in labels

## Important Notes

- Always resize window BEFORE navigating to page
- Wait for layout stabilization after resize (2 seconds)
- Take screenshot AFTER page fully loads
- Mobile navigation is the most critical test
- Horizontal overflow is common and easy to detect
- Interactive element overlaps are P2 severity minimum
- Link findings to PRD features when possible
- Use viewport name in finding labels: [RESPONSIVE], [MOBILE], [TABLET], [DESKTOP]
- Confidence should be high (85-95) for visual/layout issues
- All viewport findings are reproducible by resizing browser
