/**
 * Bounded retry policy for one logical upstream model request.
 *
 * Why this exists: a local long-running turn is several sequential model calls.
 * A single transient upstream `429` or connect/stream timeout used to abort the
 * whole turn, because the protocol negotiator only ever advanced to the next
 * *wire protocol* and never re-sent the same request. Provider rate limits and
 * timeouts are exactly the failures that recover on a second attempt.
 *
 * Safety invariant: a retry re-sends the byte-identical prepared request body.
 * The model wire call is the only thing retried — never a tool call, a file
 * write, or any other non-idempotent side effect (this module has no knowledge
 * of tools; the caller retries only the HTTP request it built once). When the
 * earlier attempt already delivered a text/reasoning delta to the client, the
 * call is *not* replayed, because doing so would duplicate streamed output.
 *
 * Budget, in order of precedence:
 *  1. `maxAttempts` (default 3 = the initial attempt plus two retries).
 *  2. An attempt-admission window computed as one full attempt timeout plus
 *     retryBudgetMs (default 300 s + 60 s), checked before backoff. Each admitted
 *     attempt keeps its full timeout, so this is not a hard full-call deadline.
 *     A backoff can reach the admission boundary and the final attempt can finish
 *     after it; callers retain their independent cancellation/operation budgets.
 *  3. An upstream `Retry-After` longer than the remaining budget is honoured by
 *     giving up instead of retrying too early.
 *
 * Delays are equal-jitter exponential backoff: `min(maxDelayMs, baseDelayMs *
 * 2^(n-1))` scaled by a random factor in [0.5, 1]. Concurrent turns therefore
 * spread out instead of retrying in lockstep.
 */

export type UpstreamRetryPolicy = {
  /** Total attempts for one logical call, including the initial attempt. */
  readonly maxAttempts: number;
  /** First backoff delay; doubles per retry. */
  readonly baseDelayMs: number;
  /** Ceiling for the exponential part of the delay. */
  readonly maxDelayMs: number;
  /** Ceiling for a server-provided `Retry-After`. */
  readonly maxRetryAfterMs: number;
  /** Wall-clock budget available to the retry phase after one full attempt. */
  readonly retryBudgetMs: number;
};

export const DEFAULT_UPSTREAM_RETRY_POLICY: UpstreamRetryPolicy = Object.freeze({
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  maxRetryAfterMs: 60_000,
  retryBudgetMs: 60_000,
});

export type UpstreamRetryOptions = {
  policy?: Partial<UpstreamRetryPolicy>;
  now?: () => number;
  random?: () => number;
  sleep?: UpstreamSleep;
};

export type UpstreamSleep = (delayMs: number, signal?: AbortSignal) => Promise<void>;

export function resolveUpstreamRetryPolicy(
  overrides?: Partial<UpstreamRetryPolicy>,
): UpstreamRetryPolicy {
  if (!overrides) return DEFAULT_UPSTREAM_RETRY_POLICY;
  const positive = (value: number | undefined, fallback: number, minimum: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= minimum
      ? Math.floor(value)
      : fallback;
  return {
    maxAttempts: positive(overrides.maxAttempts, DEFAULT_UPSTREAM_RETRY_POLICY.maxAttempts, 1),
    baseDelayMs: positive(overrides.baseDelayMs, DEFAULT_UPSTREAM_RETRY_POLICY.baseDelayMs, 0),
    maxDelayMs: positive(overrides.maxDelayMs, DEFAULT_UPSTREAM_RETRY_POLICY.maxDelayMs, 0),
    maxRetryAfterMs: positive(
      overrides.maxRetryAfterMs,
      DEFAULT_UPSTREAM_RETRY_POLICY.maxRetryAfterMs,
      0,
    ),
    retryBudgetMs: positive(
      overrides.retryBudgetMs,
      DEFAULT_UPSTREAM_RETRY_POLICY.retryBudgetMs,
      0,
    ),
  };
}

/**
 * Transient failures that a byte-identical re-send may resolve: rate limits,
 * request timeouts (408/425), and server-side 5xx. Contract failures
 * (`upstream_invalid_response`, `upstream_error_payload`,
 * `structured_output_invalid`, protocol/capability errors, auth/quota 4xx) are
 * deliberately excluded: repeating them cannot help and wastes the budget.
 */
export function isRetryableUpstreamFailureCode(code: string): boolean {
  if (code === 'upstream_timeout' || code === 'upstream_network_error') return true;
  const match = /^upstream_http_(\d{3})$/u.exec(code);
  if (!match) return false;
  const status = Number(match[1]);
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

/**
 * Parse an HTTP `Retry-After` value: either delta-seconds or an HTTP date.
 * Returns the delay in milliseconds, or `undefined` when absent/unparseable.
 */
export function parseRetryAfterMs(
  value: string | null | undefined,
  nowMs: number,
): number | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  if (/^\d+$/u.test(raw)) {
    const seconds = Number(raw);
    if (!Number.isFinite(seconds)) return undefined;
    return Math.max(0, Math.round(seconds * 1_000));
  }
  const date = Date.parse(raw);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, date - nowMs);
}

export function retryAfterHeaderMs(
  headers: Headers | undefined,
  nowMs: number,
): number | undefined {
  return parseRetryAfterMs(headers?.get('retry-after'), nowMs);
}

export type UpstreamRetryDecision =
  | { readonly retry: true; readonly delayMs: number }
  | {
    readonly retry: false;
    readonly reason: 'attempts-exhausted' | 'deadline-exceeded' | 'retry-after-exceeded';
  };

/**
 * Decide whether one more *identical* attempt may be started, and after how
 * long. `retryNumber` is 1 for the first retry (i.e. the number of attempts
 * already made), and `deadlineMs` is the absolute wall-clock deadline computed
 * once per logical call.
 */
export function planUpstreamRetry(input: {
  retryNumber: number;
  policy: UpstreamRetryPolicy;
  nowMs: number;
  deadlineMs: number;
  retryAfterMs?: number;
  random?: () => number;
}): UpstreamRetryDecision {
  if (input.retryNumber >= input.policy.maxAttempts) {
    return { retry: false, reason: 'attempts-exhausted' };
  }
  const remainingMs = input.deadlineMs - input.nowMs;
  if (remainingMs <= 0) return { retry: false, reason: 'deadline-exceeded' };
  const retryAfterMs = input.retryAfterMs === undefined
    ? undefined
    : Math.min(input.retryAfterMs, input.policy.maxRetryAfterMs);
  if (retryAfterMs !== undefined && retryAfterMs > remainingMs) {
    return { retry: false, reason: 'retry-after-exceeded' };
  }
  const exponentialMs = Math.min(
    input.policy.maxDelayMs,
    input.policy.baseDelayMs * 2 ** (input.retryNumber - 1),
  );
  const jitter = 0.5 + 0.5 * (input.random?.() ?? Math.random());
  const delayMs = retryAfterMs ?? exponentialMs * jitter;
  return { retry: true, delayMs: Math.max(0, Math.round(Math.min(delayMs, remainingMs))) };
}

/**
 * Abort-aware delay. Resolves early — never rejects — when the caller's signal
 * aborts, so the retry loop stays in charge of which error to surface.
 */
export const sleepWithAbort: UpstreamSleep = (delayMs, signal) => new Promise<void>((resolve) => {
  if (delayMs <= 0 || signal?.aborted) {
    resolve();
    return;
  }
  const finish = (): void => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', finish);
    resolve();
  };
  const timer = setTimeout(finish, delayMs);
  signal?.addEventListener('abort', finish, { once: true });
});
