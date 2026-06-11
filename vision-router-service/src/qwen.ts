import type { VisionImageInput, VisionTranslation } from './types.js';

export interface QwenConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Per-attempt timeout. Qwen3.7 vision can be slow, so wait generously. */
  timeoutMs: number;
  /** Max attempts (>= 1). Transient failures are retried — see translateImage. */
  maxAttempts: number;
  /** Exponential backoff base between attempts (ms). */
  retryBaseMs: number;
}

const MAX_BACKOFF_MS = 15_000;

// Translate-only system prompt. Mirrors the SciForge Model Router vision-translator
// contract: describe the visual, do NOT reason, plan, or claim task completion.
const SYSTEM_PROMPT = [
  'You are a SciForge vision translator.',
  'Convert the provided image into concise, faithful textual evidence for another agent.',
  'Report visible text, salient fields, objects, layout/spatial relationships, and any uncertainty.',
  'Describe only what is visible. Do not reason about the task, answer the user, give advice,',
  'draw conclusions, or claim task completion. You translate pixels into words — nothing more.',
].join(' ');

export class ProviderError extends Error {
  constructor(message: string, readonly httpStatus: number) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Raised when the HTTP caller disconnects mid-translation; stops retrying immediately. */
export class ClientAbortError extends Error {
  constructor() {
    super('vision translation aborted by caller');
    this.name = 'ClientAbortError';
  }
}

/**
 * Translate one image to text via Qwen (OpenAI-compatible chat/completions), retrying transient
 * failures (timeout / 5xx / 429 / network) with exponential backoff. The downstream main agent has
 * no vision, so there is no useful fallback — this service is the authority on "keep trying until
 * Qwen answers". The only non-retryable outcomes are auth failures (401/403) and a caller abort.
 */
export async function translateImage(
  config: QwenConfig,
  image: VisionImageInput,
  instruction: string | undefined,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<VisionTranslation> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    if (signal?.aborted) throw new ClientAbortError();
    try {
      return await translateOnce(config, image, instruction, fetchImpl, signal);
    } catch (error) {
      if (signal?.aborted) throw new ClientAbortError();
      lastError = error;
      if (attempt >= config.maxAttempts || !isRetryable(error)) throw error;
      await delay(backoffMs(attempt, config.retryBaseMs), signal);
    }
  }
  throw lastError ?? new ProviderError('vision provider call failed', 502);
}

function isRetryable(error: unknown): boolean {
  // Auth won't fix itself by retrying; everything else (timeout, 5xx, 429, network) might.
  if (error instanceof ProviderError) return error.httpStatus !== 401 && error.httpStatus !== 403;
  return true;
}

/** One Qwen call with a per-attempt timeout. Throws ProviderError / AbortError. */
async function translateOnce(
  config: QwenConfig,
  image: VisionImageInput,
  instruction: string | undefined,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<VisionTranslation> {
  const userText = [
    instruction?.trim() ? `Context for what matters: ${instruction.trim()}` : '',
    'Translate this image into textual evidence.',
  ].filter(Boolean).join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: userText },
              { type: 'image_url', image_url: { url: imageUrl(image) } },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }

  if (!response.ok) {
    throw new ProviderError(`vision provider returned HTTP ${response.status}`, response.status);
  }
  const payload = (await response.json()) as unknown;
  const summary = extractText(payload).trim();
  if (!summary) throw new ProviderError('vision provider returned empty content', 502);
  return { summary, model: config.model };
}

function imageUrl(image: VisionImageInput): string {
  if (image.url) return image.url;
  if (image.base64) return `data:${image.mime ?? 'image/png'};base64,${image.base64}`;
  throw new Error('image requires either `url` or `base64`');
}

/** Exponential backoff (base, 2×, 4×, …) capped at MAX_BACKOFF_MS. */
function backoffMs(attempt: number, base: number): number {
  return Math.min(base * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

/** Sleep that rejects (ClientAbortError) the moment the caller disconnects. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ClientAbortError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ClientAbortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function extractText(payload: unknown): string {
  const choices = isRecord(payload) && Array.isArray(payload.choices) ? payload.choices : [];
  const message = isRecord(choices[0]) && isRecord(choices[0].message) ? choices[0].message : {};
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (isRecord(part) ? (asString(part.text) ?? asString(part.content) ?? '') : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
