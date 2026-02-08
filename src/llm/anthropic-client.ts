/**
 * Anthropic Client - SDK wrapper that replaces the broken `claude --print` subprocess.
 *
 * Provides a clean `LLMClient` interface with:
 * - Non-streaming `complete()` for structured phase output
 * - Streaming `stream()` for long-running phases with progress feedback
 * - Automatic retry on 429/500 (max 2 retries with exponential backoff)
 * - Token/cost tracking (returns input/output token counts per call)
 * - JSON response validation when `responseFormat` is "json"
 *
 * @module llm/anthropic-client
 */

import Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LLMClient {
  complete(prompt: string, options?: CompletionOptions): Promise<LLMResponse>;
  stream(prompt: string, options?: CompletionOptions): AsyncIterable<StreamChunk>;
}

export interface CompletionOptions {
  /** Model to use (default: claude-sonnet-4-5-20250929). */
  model?: string;
  /** Maximum output tokens (default: 8192). */
  maxTokens?: number;
  /** System prompt injected as system message. */
  systemPrompt?: string;
  /** Sampling temperature (default: 0 for deterministic audit work). */
  temperature?: number;
  /** Response format: "text" or "json" (default: "text"). */
  responseFormat?: 'text' | 'json';
}

export interface LLMResponse {
  /** The text content returned by the model. */
  content: string;
  /** Number of input tokens consumed. */
  inputTokens: number;
  /** Number of output tokens consumed. */
  outputTokens: number;
  /** Model ID used for the completion. */
  model: string;
  /** Reason the model stopped generating. */
  stopReason: string;
}

export interface StreamChunk {
  /** Type of stream event. */
  type: 'text' | 'done';
  /** Text content (for 'text' chunks). */
  text?: string;
  /** Final response metadata (for 'done' chunks). */
  response?: LLMResponse;
}

export interface AnthropicClientConfig {
  /** API key. Defaults to ANTHROPIC_API_KEY env var. */
  apiKey?: string;
  /** Default model. Defaults to claude-sonnet-4-5-20250929. */
  model?: string;
  /** Max retries on 429/500 errors (default: 2). */
  maxRetries?: number;
  /** Request timeout in milliseconds (default: 120000). */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_TEMPERATURE = 0;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 2;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an LLMClient backed by the Anthropic TypeScript SDK.
 *
 * @param config - Client configuration.
 * @returns An object conforming to the LLMClient interface.
 */
export function createAnthropicClient(config: AnthropicClientConfig = {}): LLMClient {
  const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is required. Set it as an environment variable or pass it in config.apiKey.',
    );
  }

  const defaultModel = config.model ?? DEFAULT_MODEL;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const client = new Anthropic({
    apiKey,
    maxRetries,
    timeout: timeoutMs,
  });

  return {
    complete: (prompt, options) =>
      completeWithRetry(client, prompt, defaultModel, options),
    stream: (prompt, options) =>
      streamResponse(client, prompt, defaultModel, options),
  };
}

// ---------------------------------------------------------------------------
// Complete (non-streaming)
// ---------------------------------------------------------------------------

async function completeWithRetry(
  client: Anthropic,
  prompt: string,
  defaultModel: string,
  options?: CompletionOptions,
): Promise<LLMResponse> {
  const model = options?.model ?? defaultModel;
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const temperature = options?.temperature ?? DEFAULT_TEMPERATURE;
  const systemPrompt = options?.systemPrompt;
  const isJson = options?.responseFormat === 'json';

  // Build the user message, adding JSON instruction if needed
  let userContent = prompt;
  if (isJson) {
    userContent += '\n\nIMPORTANT: Respond with valid JSON only. No markdown fences, no explanatory text.';
  }

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: [{ role: 'user', content: userContent }],
  };

  if (systemPrompt) {
    params.system = systemPrompt;
  }

  const message = await client.messages.create(params);

  const content = extractTextContent(message);
  const response: LLMResponse = {
    content,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    model: message.model,
    stopReason: message.stop_reason ?? 'unknown',
  };

  // Validate JSON if requested
  if (isJson) {
    validateJsonResponse(response.content);
  }

  return response;
}

// ---------------------------------------------------------------------------
// Stream
// ---------------------------------------------------------------------------

async function* streamResponse(
  client: Anthropic,
  prompt: string,
  defaultModel: string,
  options?: CompletionOptions,
): AsyncIterable<StreamChunk> {
  const model = options?.model ?? defaultModel;
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const temperature = options?.temperature ?? DEFAULT_TEMPERATURE;
  const systemPrompt = options?.systemPrompt;
  const isJson = options?.responseFormat === 'json';

  let userContent = prompt;
  if (isJson) {
    userContent += '\n\nIMPORTANT: Respond with valid JSON only. No markdown fences, no explanatory text.';
  }

  const params: Anthropic.MessageCreateParamsStreaming = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: [{ role: 'user', content: userContent }],
    stream: true,
  };

  if (systemPrompt) {
    params.system = systemPrompt;
  }

  const stream = client.messages.stream(params);

  let fullContent = '';

  for await (const event of stream) {
    if (event.type === 'content_block_delta') {
      const delta = event.delta;
      if ('text' in delta) {
        fullContent += delta.text;
        yield { type: 'text', text: delta.text };
      }
    }
  }

  const finalMessage = await stream.finalMessage();

  if (isJson) {
    validateJsonResponse(fullContent);
  }

  yield {
    type: 'done',
    response: {
      content: fullContent,
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
      model: finalMessage.model,
      stopReason: finalMessage.stop_reason ?? 'unknown',
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract text content from a Message response.
 */
function extractTextContent(message: Anthropic.Message): string {
  const textBlocks = message.content.filter(
    (block): block is Anthropic.TextBlock => block.type === 'text',
  );
  return textBlocks.map((b) => b.text).join('');
}

/**
 * Validate that a string is valid JSON. Strips markdown fences if present.
 * Throws if the content cannot be parsed as JSON.
 */
function validateJsonResponse(content: string): void {
  const cleaned = stripMarkdownFences(content);
  try {
    JSON.parse(cleaned);
  } catch {
    throw new Error(
      `LLM returned invalid JSON. First 200 chars: ${cleaned.slice(0, 200)}`,
    );
  }
}

/**
 * Strip markdown code fences (```json ... ```) from content.
 */
function stripMarkdownFences(content: string): string {
  const trimmed = content.trim();
  // Remove ```json ... ``` wrapping
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

// Export for testing
export { stripMarkdownFences, validateJsonResponse };
