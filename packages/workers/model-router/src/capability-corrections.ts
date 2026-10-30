/**
 * Temporary negative capability results learned from explicit upstream rejections.
 *
 * Design (“错误纠偏”): when the upstream explicitly says a reasoning level is not
 * supported, remember it briefly so the next request fails fast instead of
 * repeating the mistake. Hard rules:
 *  - only HTTP 400/422 responses whose body explicitly rejects the reasoning
 *    level may record a result — auth failures, rate limits, timeouts, and
 *    protocol-level rejections never do;
 *  - results are keyed by model + endpoint + protocol + level and always expire
 *    (default TTL 24h); they never modify the seed vocabulary and never rewrite
 *    the user's declarations;
 *  - a success with the same level clears its negative result: the upstream
 *    accepting the level again is the recovery signal, alongside TTL expiry.
 */

export type CapabilityCorrectionQuery = Readonly<{
  model: string;
  baseUrl: string;
  protocol: string;
  level: string;
}>;

export type CapabilityCorrection = Readonly<{
  model: string;
  baseUrl: string;
  protocol: string;
  level: string;
  recordedAt: number;
  expiresAt: number;
  reason: string;
  upstreamStatus: number;
}>;

export const CAPABILITY_CORRECTION_TTL_MS = 24 * 60 * 60 * 1000;
export const CAPABILITY_CORRECTION_MAX_ENTRIES = 256;

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/u, '').toLowerCase();
}

function correctionKey(query: CapabilityCorrectionQuery): string {
  return [
    query.model.trim().toLowerCase(),
    normalizeBaseUrl(query.baseUrl),
    query.protocol.trim().toLowerCase(),
    query.level.trim().toLowerCase(),
  ].join('\u0000');
}

const REASONING_LEVEL_REJECTION_PATTERNS: readonly RegExp[] = [
  /\bunsupported reasoning\b/iu,
  /\breasoning[ _-]?(?:effort|level)\b[^.]{0,60}\b(?:not[ _-]?supported|unsupported|invalid|unknown)\b/isu,
  /\b(?:not[ _-]?supported|unsupported|invalid)\b[^.]{0,60}\breasoning[ _-]?(?:effort|level)\b/isu,
  /\bthinking\b[^.]{0,60}\b(?:not[ _-]?supported|unsupported)\b/isu,
  /不支持[^。；]{0,24}(?:思考|推理)/u,
  /(?:思考|推理)[^。；]{0,24}不支持/u,
];

/**
 * Extracts explicit rejection evidence from an upstream error response, or null
 * when the response is not an explicit “this reasoning level is not supported”
 * statement. Conservative by design: no match means the event is NOT treated as
 * a capability change.
 */
export function reasoningLevelRejectionEvidence(input: {
  status: number;
  body: string;
  requestedEffort: string;
}): string | null {
  const status = Math.floor(input.status);
  if (status !== 400 && status !== 422) return null;
  const level = input.requestedEffort.trim();
  if (!level) return null;
  const body = input.body.slice(0, 4000);
  if (!body) return null;
  const matched = REASONING_LEVEL_REJECTION_PATTERNS.some((pattern) => pattern.test(body));
  if (!matched) return null;
  const mentionsLevel = body.toLowerCase().includes(level.toLowerCase());
  return mentionsLevel
    ? `Upstream explicitly rejected reasoning level "${level}".`
    : 'Upstream rejected the request citing an unsupported reasoning level.';
}

export class CapabilityCorrections {
  readonly #entries = new Map<string, CapabilityCorrection>();
  readonly #now: () => number;
  readonly #ttlMs: number;

  constructor(options: { now?: () => number; ttlMs?: number } = {}) {
    this.#now = options.now ?? (() => Date.now());
    const ttlMs = options.ttlMs;
    this.#ttlMs = typeof ttlMs === 'number' && Number.isFinite(ttlMs) && ttlMs > 0
      ? Math.floor(ttlMs)
      : CAPABILITY_CORRECTION_TTL_MS;
  }

  ttlMs(): number {
    return this.#ttlMs;
  }

  /** Records a negative result. Callers must only use explicit rejection evidence. */
  record(
    query: CapabilityCorrectionQuery,
    evidence: { reason: string; upstreamStatus: number },
  ): CapabilityCorrection {
    const now = this.#now();
    const entry: CapabilityCorrection = {
      model: query.model.trim(),
      baseUrl: normalizeBaseUrl(query.baseUrl),
      protocol: query.protocol.trim().toLowerCase(),
      level: query.level.trim(),
      recordedAt: now,
      expiresAt: now + this.#ttlMs,
      reason: evidence.reason,
      upstreamStatus: Math.floor(evidence.upstreamStatus),
    };
    const key = correctionKey(query);
    // Re-recording an existing key refreshes it (and its expiry).
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    while (this.#entries.size > CAPABILITY_CORRECTION_MAX_ENTRIES) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    return entry;
  }

  /** Returns the active negative result for a key, or null (expired entries are dropped). */
  negative(query: CapabilityCorrectionQuery): CapabilityCorrection | null {
    const key = correctionKey(query);
    const entry = this.#entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.#now()) {
      this.#entries.delete(key);
      return null;
    }
    return entry;
  }

  /** Recovery path: a success with this level clears its negative result. */
  clear(query: CapabilityCorrectionQuery): boolean {
    return this.#entries.delete(correctionKey(query));
  }

  clearAll(): void {
    this.#entries.clear();
  }

  /** Active entries (expired ones are dropped) — diagnostics and tests. */
  list(): readonly CapabilityCorrection[] {
    const now = this.#now();
    const alive: CapabilityCorrection[] = [];
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt <= now) {
        this.#entries.delete(key);
        continue;
      }
      alive.push(entry);
    }
    return alive;
  }
}