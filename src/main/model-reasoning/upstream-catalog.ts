/**
 * Real upstream catalog observation for reasoning-level discovery.
 *
 * Unlike the local declaration provider (which re-reads the stored binding
 * through Model Router's `/v1/models`), this observer performs an actual
 * network query against the bound upstream's model listing. Rules:
 *
 *  - an upstream listing without capability fields is `unknown`, not
 *    "unsupported" — absence of evidence stays absence of evidence;
 *  - only an explicit negative marker (`supports_reasoning: false`,
 *    `reasoning_supported: false`, `declared_unsupported: true`) is treated as
 *    `declared-unsupported`;
 *  - successful observations are cached (~24h) and keyed by endpoint + model +
 *    a credential fingerprint — the raw key is never persisted, never logged,
 *    and never used as a cache key; two credentials for the same endpoint never
 *    share one conclusion;
 *  - failures back off per key, keep the last valid observation (a failed
 *    re-check never erases good data), mark it `stale` with the failure reason
 *    so the UI can label it, and never block the binding.
 *
 * The ~24h value is a CACHE TTL (a freshness window), not a polling schedule:
 * nothing here runs on a timer and there is no background busy-polling —
 * re-fetching happens on demand, when a query hits an expired entry, and is
 * further rate-limited by the per-key failure backoff.
 */
import { createHash } from 'node:crypto'
import { getModelRouterSettings, type AppSettingsV1 } from '../../shared/app-settings'
import { upstreamOpenAiModelsUrl } from '../../shared/openai-compat-url'
import type {
  ReasoningDiscoveryQuery,
  UpstreamReasoningDeclaration
} from './reasoning-discovery'

export type UpstreamCatalogObserveOptions = Readonly<{
  force?: boolean
  signal?: AbortSignal
}>

export type UpstreamCatalogObserverLike = Readonly<{
  observe: (
    query: ReasoningDiscoveryQuery,
    options?: UpstreamCatalogObserveOptions
  ) => Promise<UpstreamReasoningDeclaration | null>
  clear: () => void
}>

export type UpstreamCatalogObserverOptions = Readonly<{
  loadSettings: () => Promise<AppSettingsV1> | AppSettingsV1
  fetchImpl?: typeof fetch
  now?: () => number
  /** Successful observation TTL. */
  ttlMs?: number
  /** Per-request timeout. */
  timeoutMs?: number
  /** First backoff step after a failure. */
  backoffBaseMs?: number
  /** Backoff cap. */
  backoffMaxMs?: number
}>

export const UPSTREAM_CATALOG_TTL_MS = 24 * 60 * 60 * 1000
export const UPSTREAM_CATALOG_TIMEOUT_MS = 8_000
export const UPSTREAM_CATALOG_BACKOFF_BASE_MS = 5 * 60 * 1000
export const UPSTREAM_CATALOG_BACKOFF_MAX_MS = 60 * 60 * 1000

type CatalogCacheEntry = Readonly<{
  declaration: UpstreamReasoningDeclaration
  observedAt: string
  expiresAtMs: number
}>

function normalizeEndpoint(value: string | null | undefined): string {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\/+$/, '').toLowerCase()
}

function credentialFingerprint(apiKey: string): string {
  // A hash only. The raw key never reaches a cache key, a log line, or disk.
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 32)
}

function catalogCacheKey(query: ReasoningDiscoveryQuery, apiKey: string): string {
  return [
    normalizeEndpoint(query.endpoint),
    query.model.trim().toLowerCase(),
    credentialFingerprint(apiKey)
  ].join('\u0000')
}

function textField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function boolField(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

/**
 * Reads a model entry out of an OpenAI-style `/models` payload. Returns the
 * declaration plus whether the entry was found at all (a missing model is a
 * successful observation without evidence, not a failure).
 */
export function reasoningDeclarationFromCatalogPayload(
  payload: unknown,
  model: string,
  observedAt: string
): UpstreamReasoningDeclaration {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
  const entries = record && Array.isArray(record.data) ? record.data : []
  const wanted = model.trim().toLowerCase()
  const entry = entries.find((candidate) => {
    if (!candidate || typeof candidate !== 'object') return false
    return textField((candidate as Record<string, unknown>).id).toLowerCase() === wanted
  }) as Record<string, unknown> | undefined
  if (!entry) return { kind: 'unknown' }

  // Explicit negative markers only. An absent or empty field stays unknown.
  const supportsReasoning = boolField(entry.supports_reasoning)
  const reasoningSupported = boolField(entry.reasoning_supported)
  const declaredUnsupported = boolField(entry.declared_unsupported)
  if (supportsReasoning === false || reasoningSupported === false || declaredUnsupported === true) {
    return { kind: 'declared-unsupported', observedAt }
  }

  const rawLevels = Array.isArray(entry.supported_reasoning_levels)
    ? entry.supported_reasoning_levels
    : []
  const levels: Array<{ id: string; isDefault?: boolean }> = []
  for (const candidate of rawLevels) {
    const id =
      typeof candidate === 'string'
        ? candidate.trim()
        : candidate && typeof candidate === 'object'
          ? textField((candidate as Record<string, unknown>).effort)
        : ''
    if (id && !levels.some((level) => level.id === id)) levels.push({ id })
  }
  if (levels.length === 0) return { kind: 'unknown' }
  const defaultLevel = textField(entry.default_reasoning_level)
  return {
    kind: 'declared',
    levels: levels.map((level) =>
      defaultLevel && level.id === defaultLevel ? { id: level.id, isDefault: true } : level
    ),
    observedAt
  }
}

export class UpstreamCatalogObserver implements UpstreamCatalogObserverLike {
  readonly #options: UpstreamCatalogObserverOptions
  readonly #entries = new Map<string, CatalogCacheEntry>()
  readonly #inFlight = new Map<string, Promise<UpstreamReasoningDeclaration | null>>()
  readonly #now: () => number
  readonly #ttlMs: number
  readonly #timeoutMs: number
  readonly #backoffBaseMs: number
  readonly #backoffMaxMs: number

  constructor(options: UpstreamCatalogObserverOptions) {
    this.#options = options
    this.#now = options.now ?? (() => Date.now())
    this.#ttlMs = options.ttlMs ?? UPSTREAM_CATALOG_TTL_MS
    this.#timeoutMs = options.timeoutMs ?? UPSTREAM_CATALOG_TIMEOUT_MS
    this.#backoffBaseMs = options.backoffBaseMs ?? UPSTREAM_CATALOG_BACKOFF_BASE_MS
    this.#backoffMaxMs = options.backoffMaxMs ?? UPSTREAM_CATALOG_BACKOFF_MAX_MS
  }

  clear(): void {
    this.#entries.clear()
  }

  async observe(
    query: ReasoningDiscoveryQuery,
    options: UpstreamCatalogObserveOptions = {}
  ): Promise<UpstreamReasoningDeclaration | null> {
    let settings: AppSettingsV1
    try {
      settings = await this.#options.loadSettings()
    } catch {
      return null
    }
    const textReasoner = getModelRouterSettings(settings).profiles.default.textReasoner
    const endpoint = normalizeEndpoint(textReasoner.baseUrl)
    const apiKey = textReasoner.apiKey.trim()
    const requestedModel = query.model.trim()
    if (!endpoint || !apiKey || !requestedModel) return null

    const key = catalogCacheKey({ ...query, endpoint }, apiKey)
    const entry = this.#entries.get(key)
    const now = this.#now()
    if (!options.force) {
      if (entry && entry.expiresAtMs > now) return entry.declaration
      // Expired (or no entry yet) while a failure is still recent: keep the last
      // valid observation, labeled stale, and skip the wire until the backoff
      // window closes (no busy re-polling).
      if (this.#recentFailureBlocks(key, now)) return this.#servePriorObservation(key, now)
    }

    const existing = this.#inFlight.get(key)
    if (existing) return existing

    const attempt = this.#fetchObservation({
      key,
      query: { ...query, endpoint },
      model: requestedModel,
      baseUrl: textReasoner.baseUrl,
      apiKey,
      signal: options.signal
    })
    this.#inFlight.set(key, attempt)
    try {
      return await attempt
    } finally {
      this.#inFlight.delete(key)
    }
  }

  readonly #failures = new Map<string, { failureCount: number; nextAttemptAtMs: number; message: string }>()

  #recentFailureBlocks(key: string, now: number): boolean {
    const failure = this.#failures.get(key)
    return failure !== undefined && failure.nextAttemptAtMs > now
  }

  /**
   * Serves the cached observation for this key. An entry that is still fresh
   * (a forced re-check may fail while the cached window is open) is returned
   * as-is; an expired entry is labeled `stale` together with the failure
   * reason, so the UI never presents it as "just verified".
   */
  #servePriorObservation(key: string, now: number): UpstreamReasoningDeclaration | null {
    const entry = this.#entries.get(key)
    if (!entry) return null
    if (entry.expiresAtMs > now) return entry.declaration
    const failure = this.#failures.get(key)
    const message = failure?.message.trim() || 'the re-check did not complete'
    return {
      ...entry.declaration,
      stale: true,
      refreshError: `${message}; showing the last valid observation from ${entry.observedAt}`
    }
  }

  async #fetchObservation(input: {
    key: string
    query: ReasoningDiscoveryQuery
    model: string
    baseUrl: string
    apiKey: string
    signal?: AbortSignal
  }): Promise<UpstreamReasoningDeclaration | null> {
    const now = this.#now()
    const timeoutSignal = AbortSignal.timeout(this.#timeoutMs)
    const signal = input.signal ? AbortSignal.any([input.signal, timeoutSignal]) : timeoutSignal
    try {
      const response = await (this.#options.fetchImpl ?? fetch)(
        upstreamOpenAiModelsUrl(input.baseUrl),
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${input.apiKey}`
          },
          signal
        }
      )
      if (!response.ok) {
        this.#recordFailure(input.key, now, `upstream catalog request failed (${response.status})`)
        return this.#servePriorObservation(input.key, now)
      }
      const payload = (await response.json()) as unknown
      const observedAt = new Date(this.#now()).toISOString()
      const declaration = reasoningDeclarationFromCatalogPayload(payload, input.model, observedAt)
      this.#entries.set(input.key, {
        declaration,
        observedAt,
        expiresAtMs: now + this.#ttlMs
      })
      this.#failures.delete(input.key)
      return declaration
    } catch (error) {
      this.#recordFailure(
        input.key,
        now,
        error instanceof Error ? error.message : 'upstream catalog request failed'
      )
      return this.#servePriorObservation(input.key, now)
    }
  }

  #recordFailure(key: string, now: number, message: string): void {
    const prior = this.#failures.get(key)
    const failureCount = (prior?.failureCount ?? 0) + 1
    const backoff = Math.min(this.#backoffBaseMs * 2 ** (failureCount - 1), this.#backoffMaxMs)
    this.#failures.set(key, {
      failureCount,
      nextAttemptAtMs: now + backoff,
      message
    })
  }
}

export function createUpstreamCatalogObserver(
  options: UpstreamCatalogObserverOptions
): UpstreamCatalogObserverLike {
  return new UpstreamCatalogObserver(options)
}