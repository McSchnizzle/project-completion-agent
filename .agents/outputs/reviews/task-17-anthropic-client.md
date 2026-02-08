# Review: Task #17 - Anthropic SDK Client (LLM Module)

**Reviewer:** reviewer agent
**Date:** 2026-02-08
**Verdict:** APPROVED
**Owner:** discovery-engineer

---

## Files Reviewed

| File | Lines | Purpose |
|------|-------|---------|
| `src/llm/anthropic-client.ts` | 278 | SDK wrapper with complete/stream interface |
| `src/llm/prompt-loader.ts` | 131 | Template loading with `{{variable}}` interpolation |
| `src/llm/schema-validator.ts` | 212 | Zod + AJV dual validation for LLM output |

## Tests

| Test File | Count | Status |
|-----------|-------|--------|
| `tests/llm/anthropic-client.test.ts` | 23 | All passing |
| `tests/llm/prompt-loader.test.ts` | 17 | All passing |
| `tests/llm/schema-validator.test.ts` | 21 | All passing |

**Total: 61 tests, all passing**

## Dependencies

- `@anthropic-ai/sdk`: ^0.73.0 (present in package.json)
- `ajv`: ^8.12.0 (present in package.json)
- `zod`: already present from finding-schema.ts

## Architecture Alignment

- All 3 modules correctly placed in `src/llm/` per ARCHITECTURE-V2.md Section 3
- Clean `LLMClient` interface matching the spec exactly (complete + stream)
- Default model correctly set to `claude-sonnet-4-5-20250929`

## API Reference

### LLMClient Interface

```typescript
interface LLMClient {
  complete(prompt: string, options?: CompletionOptions): Promise<LLMResponse>;
  stream(prompt: string, options?: CompletionOptions): AsyncIterable<StreamChunk>;
}
```

### CompletionOptions

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| model | string | claude-sonnet-4-5-20250929 | Model ID |
| maxTokens | number | 8192 | Max output tokens |
| systemPrompt | string | - | System message |
| temperature | number | 0 | Sampling temperature |
| responseFormat | 'text' \| 'json' | 'text' | Enables JSON validation |

### Factory

```typescript
const client = createAnthropicClient({
  apiKey?: string,      // defaults to ANTHROPIC_API_KEY env var
  model?: string,       // default model for all calls
  maxRetries?: number,  // default: 2 (SDK built-in retry on 429/500)
  timeoutMs?: number,   // default: 120000
});
```

## Strengths

1. Clean interface design - `LLMClient` with just `complete` and `stream` makes swapping backends easy
2. Retry delegated to SDK's built-in `maxRetries` - no custom retry loop needed
3. Markdown fence stripping handles common LLM output quirks (`\`\`\`json ... \`\`\``)
4. Dual validation: Zod for typed schemas, AJV for raw JSON Schema - covers both use cases
5. Prompt loader's `findProjectRoot()` walks up to package.json - robust path resolution
6. Tests properly save/restore ANTHROPIC_API_KEY env var (client test lines 64-79)

## Issues Found

### MINOR - Duplicate fence stripping

`anthropic-client.ts:252-274` and `schema-validator.ts:197-202` both implement `stripFences`/`stripMarkdownFences` independently with the same regex pattern. Should share one implementation, but non-blocking.

### MINOR - AJV schema caching (`schema-validator.ts:109`)

`ajv.compile(jsonSchema)` is called on every validation. AJV supports caching compiled schemas via `$id`. For repeated validations of the same schema, this adds overhead. Low practical impact since phase output schemas are validated once per phase.

### INFO - `__dirname` in ESM (`prompt-loader.ts:120`)

`__dirname` is used in `findProjectRoot()`. This works in CJS but would break if the project migrated to pure ESM (would need `import.meta.url` + `fileURLToPath`). Current tsconfig targets CJS so this is fine.

## Notes for Downstream Consumers

- `createAnthropicClient()` throws if no API key available - catch this in verify/audit flows
- When `responseFormat: 'json'`, the client appends a JSON instruction to the user message and validates the response
- `loadPrompt(path, { variables })` resolves relative paths against `prompts/` directory
- `validateWithZod(jsonString, schema)` and `validateWithJsonSchema(jsonString, schema)` both strip markdown fences before parsing
- `parseAndValidate(jsonString, optionalZodSchema)` is the convenience one-stop function
