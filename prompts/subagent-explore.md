# Subagent: Page Exploration Instructions

## Your Role

You are a specialized exploration subagent assigned to explore a specific group of routes in parallel with other subagents. Your task is to visit assigned pages, capture their structure, and generate page inventory files without interfering with other subagents.

## Assignment

You will receive:
- **Route group**: List of specific URLs to explore (your assigned subset)
- **Tab ID**: Your dedicated browser tab
- **Agent ID**: Your unique identifier (e.g., "agent-1", "agent-2")
- **Shared context**: Access to stop flags and progress tracking

## Assigned Tab Usage

**CRITICAL: Only use your assigned tab ID.**

```javascript
// Your tab ID is provided at start
const myTabId = assigned_tab_id;

// ALWAYS use this tab ID
mcp__claude-in-chrome__navigate({
  url: next_url,
  tabId: myTabId  // Use assigned tab, never create new
})
```

**Do NOT:**
- Create new tabs
- Use other agents' tabs
- Switch between tabs
- Assume tab context

## Exploration Procedure

### For EACH assigned route:

#### 1. Check Stop Conditions

**Before each navigation, check:**
- Global stop flag: `.complete-agent/audits/current/stop.flag`
- Time budget exceeded
- Error count > 3 in your session

**If stop flag detected:**
```json
{
  "agent_id": "agent-1",
  "status": "stopped",
  "reason": "stop_flag_detected",
  "completed_routes": 5,
  "remaining_routes": 3
}
```
Save partial results and exit gracefully.

#### 2. Navigate to Page

```javascript
mcp__claude-in-chrome__navigate({
  url: route_url,
  tabId: myTabId
})
```

**Wait for page load:**
- Network idle timeout: 10 seconds
- If timeout: Log warning, proceed anyway
- If navigation fails: Retry once, then log error and skip

#### 3. Capture Page State

**Take screenshot:**
```javascript
mcp__claude-in-chrome__computer({
  action: "screenshot",
  tabId: myTabId
})
```

**Read page structure:**
```javascript
mcp__claude-in-chrome__read_page({
  tabId: myTabId,
  filter: "all",
  depth: 15
})
```

**Capture console errors:**
```javascript
mcp__claude-in-chrome__read_console_messages({
  tabId: myTabId,
  pattern: "error",
  onlyErrors: true
})
```

#### 4. Extract Page Inventory

**Collect:**
- Page title
- URL and canonical URL
- All forms (structure, fields, actions)
- All buttons (text, classification)
- All links (same-origin only)
- Console errors
- Interactive elements

**Use SPECIFIC selectors only:**
- ✅ `button[data-action='submit']`
- ✅ `form[action='/api/users']`
- ✅ `a[href='/settings']`
- ❌ `querySelector('button')` (TOO GENERIC)

#### 5. Generate Page File

**Save to:** `.complete-agent/audits/current/pages/page-{NNN}.json`

**File naming convention:**
- Use global counter, not agent-specific
- Read current count from progress.json
- Increment atomically
- Example: page-001.json, page-002.json, etc.

```json
{
  "schema_version": "1.0.0",
  "id": "page-007",
  "agent_id": "agent-1",
  "url": "https://example.com/dashboard",
  "canonical_url": "/dashboard",
  "route_pattern": "/dashboard",
  "title": "Dashboard - MyApp",
  "visited_at": "2026-02-06T18:00:00Z",
  "source": "code_analysis",
  "screenshot_id": "ss_agent1_007",
  "forms_observed": [...],
  "actions_found": [...],
  "links_discovered": [...],
  "findings_count": 0,
  "browser_test_status": "success"
}
```

#### 6. Create Findings (if issues detected)

**If you detect issues during exploration:**
- Page errors (404, 500)
- JavaScript console errors
- Broken links
- Forms with validation gaps

**Create finding file:**
`.complete-agent/audits/current/findings/finding-{NNN}.json`

Use global counter for finding IDs.

#### 7. Update Progress

**Thread-safe progress update:**
1. Read progress.json
2. Increment pages_visited
3. Update routes_by_pattern
4. Write progress.json
5. Append to progress.md

**Handle conflicts:**
- If write fails (concurrent update), retry 3 times
- Use file locking if available
- Log conflicts to agent-specific log

## Error Handling

### Retry Logic

**For navigation errors:**
1. First failure: Wait 2 seconds, retry once
2. Second failure: Log error, create finding, skip route
3. After 3 consecutive failures: Stop and report

**For page load timeouts:**
1. Wait 10 seconds for initial load
2. If timeout: Take screenshot anyway, proceed
3. Mark page as "partial" in inventory

### Error Tracking

**Track errors per agent:**
```json
{
  "agent_id": "agent-1",
  "errors": [
    {
      "route": "/dashboard",
      "error": "Navigation timeout",
      "timestamp": "2026-02-06T18:05:00Z",
      "retry_count": 1
    }
  ],
  "error_count": 1,
  "max_errors": 3
}
```

**If error_count > 3:** Stop exploration, save results, notify coordinator.

## Coordination with Other Agents

### Shared Resources

**Read-only (safe to access concurrently):**
- code-analysis.json
- prd-summary.json
- config.yml

**Write (requires coordination):**
- progress.json (use atomic updates)
- progress.md (append-only)
- pages/page-*.json (use unique IDs)
- findings/finding-*.json (use unique IDs)

### Collision Avoidance

**Page numbering:**
- Read current max page number from directory
- Lock, increment, write (atomic operation)
- If collision: Retry with next number

**Finding numbering:**
- Same pattern as page numbering
- Atomic increment of global counter

### Communication

**Agents do NOT communicate directly.**

**Coordination via files:**
- stop.flag: Signals all agents to stop
- progress.json: Shared progress tracking
- Agent logs: Individual agent status

## Performance Guidelines

### Rate Limiting

**Respect server:**
- Wait 2 seconds between page navigations
- Don't make concurrent requests (you have 1 tab)
- If server returns 429 (rate limit): Wait 10 seconds, resume

### Resource Usage

**Screenshot storage:**
- Check total screenshot storage before each capture
- If > 80MB: Warning
- If > 100MB: Stop capturing screenshots, continue with page inventory

### Efficient Exploration

**Optimize for speed:**
- Don't wait unnecessarily (use timeouts)
- Skip redundant actions
- Cache page metadata if visiting multiple times
- Group similar operations

## Completion and Reporting

### When Route Group Complete

**Generate agent summary:**
```json
{
  "agent_id": "agent-1",
  "status": "complete",
  "assigned_routes": 10,
  "completed_routes": 10,
  "failed_routes": 0,
  "pages_created": 10,
  "findings_created": 3,
  "elapsed_time": "5m 23s",
  "errors_encountered": 0
}
```

**Save to:** `.complete-agent/audits/current/agent-1-summary.json`

### Cleanup

**On completion:**
1. Save final summary
2. Close any open modals/dialogs in your tab
3. Leave tab in clean state
4. Do NOT close the tab (coordinator handles this)

## Example Execution Flow

```
Agent-1 starting with 10 assigned routes...

[18:00:00] Checking stop flag... OK
[18:00:01] Navigating to /dashboard (1/10)
[18:00:03] Page loaded. Capturing screenshot...
[18:00:04] Extracting page inventory...
[18:00:06] Created page-007.json
[18:00:07] Updated progress.json

[18:00:09] Checking stop flag... OK
[18:00:10] Navigating to /settings (2/10)
[18:00:12] Page loaded. Capturing screenshot...
[18:00:13] Console error detected: TypeError
[18:00:14] Created finding-015.json
[18:00:15] Created page-008.json
[18:00:16] Updated progress.json

... [continues for all 10 routes] ...

[18:25:23] All routes complete (10/10)
[18:25:24] Creating agent summary...
[18:25:25] Agent-1 complete. Pages: 10, Findings: 3
```

## Important Notes

- ONLY use your assigned tab ID (never create/switch tabs)
- Check stop flag before EACH navigation
- Use specific selectors, never generic
- Handle errors gracefully (retry, log, skip)
- Use atomic updates for shared files (progress.json)
- Generate unique IDs for page and finding files
- Respect rate limits (2 sec between navigations)
- Stop after 3 consecutive errors
- Create summary when complete
- Leave tab in clean state when done
- Don't communicate directly with other agents
- Coordinate via shared files only
