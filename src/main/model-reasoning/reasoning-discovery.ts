/**
 * Reasoning-level discovery for a bound model API.
 *
 * Order of evidence (strongest first):
 *   1. upstream declaration  — the provider/model listing that the binding talks to;
 *   2. vocabulary (词表)      — dated repository evidence, see ./reasoning-levels;
 *   3. `unknown`             — no evidence; callers must not attach a reasoning
 *                              parameter and must not report "unsupported".
 *
 * Hard rules:
 *  - an upstream `declared-unsupported` is final: the vocabulary never overrides it;
 *  - a failed check degrades to `unknown` and never blocks or fails the binding;
 *  - failures are not cached, so the next attempt retries;
 *  - cached outcomes are keyed by binding (provider + model + protocol + endpoint),
 *    so two credentials for the same model never share one conclusion;
 *  - active probing is opt-in, bounded, cancellable, and yields acceptance evidence
 *    only — it never rewrites the vocabulary and never fills the declared-levels cache.
 */
import {
  lookupReasoningLevels,
  REASONING_LEVEL_TABLE,
  type ReasoningLevelCompleteness,
  type ReasoningLevelTable
} from './reasoning-levels'

export type UpstreamReasoningDeclaration =
  | Readonly<{
      kind: 'declared'
      levels: readonly Readonly<{ id: string; isDefault?: boolean }>[]
      /** True when the declaration is known to be a subset of the real ladder. */
      partial?: boolean
      /** ISO date the declaration was observed, when the caller knows it. */
      observedAt?: string
      /**
       * True when this is a *cached* observation served after a failed/blocked
       * re-check: the data is the last valid result and may be outdated. The UI
       * must label it instead of presenting it as freshly verified.
       */
      stale?: boolean
      /** Human-readable reason the re-check failed (shown next to `stale`). */
      refreshError?: string
    }>
  | Readonly<{
      kind: 'declared-unsupported'
      observedAt?: string
      stale?: boolean
      refreshError?: string
    }>
  | Readonly<{ kind: 'unknown'; stale?: boolean; refreshError?: string }>

export type ReasoningDiscoveryQuery = Readonly<{
  provider: string
  model: string
  protocol: string
  endpoint?: string | null
}>

export type ReasoningDiscoveryState = 'known' | 'unsupported' | 'unknown'

export type ReasoningDiscoverySource = 'upstream' | 'catalog' | 'vocabulary' | 'cache' | 'none'

export type ReasoningDiscoveryOutcome = Readonly<{
  state: ReasoningDiscoveryState
  levels: readonly string[]
  /**
   * `complete` when the evidence enumerated every level, `partial` when only some
   * levels are verified, `null` when there is nothing to enumerate. Callers must
   * not present a `partial` list as exhaustive, and must keep letting the user
   * choose levels outside it.
   */
  completeness: ReasoningLevelCompleteness | null
  defaultLevel: string | null
  source: ReasoningDiscoverySource
  verifiedAt: string | null
  /** Cached last-valid observation served after a failed/blocked re-check. */
  stale?: boolean
  /** Human-readable refresh failure attached to a `stale` observation. */
  refreshError?: string
  checkedAt: string
  /** Convenience flag: only `known` with levels may attach a reasoning parameter. */
  attachEffort: boolean
}>

export type DeclarationProvider = (query: ReasoningDiscoveryQuery) => Promise<UpstreamReasoningDeclaration>

/**
 * A real upstream catalog observation (network). Returns `null` when no
 * observation is available — the discovery chain then falls through to the
 * vocabulary, exactly like a failed declaration check.
 */
export type CatalogDeclarationProvider = (
  query: ReasoningDiscoveryQuery,
  options?: Readonly<{ force?: boolean; signal?: AbortSignal }>
) => Promise<UpstreamReasoningDeclaration | null>

export type ReasoningLevelProbe = (input: {
  level: string
  query: ReasoningDiscoveryQuery
  signal?: AbortSignal
}) => Promise<{ accepted: boolean }>

export type ReasoningProbeReport = Readonly<{
  acceptedLevels: readonly string[]
  rejectedLevels: readonly string[]
  skippedLevels: readonly string[]
  truncated: boolean
  cancelled: boolean
  errors: readonly string[]
  /** Acceptance is not proof that deeper thinking happened — callers must say so. */
  meaning: 'parameter-accepted-only'
}>

export type ReasoningDiscoveryOptions = Readonly<{
  declarationProvider: DeclarationProvider
  /** Optional real upstream catalog observation, consulted when the local declaration has no levels. */
  catalogProvider?: CatalogDeclarationProvider
  table?: ReasoningLevelTable
  now?: () => number
  ttlMs?: number
}>

const DEFAULT_TTL_MS = 10 * 60 * 1000

function normalizeToken(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeEndpoint(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.replace(/\/+$/, '')
}

function cacheKey(query: ReasoningDiscoveryQuery): string {
  return [
    normalizeToken(query.provider),
    normalizeToken(query.model),
    normalizeToken(query.protocol),
    normalizeEndpoint(query.endpoint) ?? ''
  ].join('\u0000')
}

function toIso(now: () => number): string {
  return new Date(now()).toISOString()
}

const unknownOutcome = (checkedAt: string): ReasoningDiscoveryOutcome => ({
  state: 'unknown',
  levels: [],
  completeness: null,
  defaultLevel: null,
  source: 'none',
  verifiedAt: null,
  checkedAt,
  attachEffort: false
})

/**
 * Carries stale/refresh-failure markers from a declaration into the outcome so
 * a cached-but-unrefreshable observation is labeled in the UI instead of being
 * presented as freshly verified.
 */
function observationFlags(declaration: {
  stale?: boolean
  refreshError?: string
}): { stale?: boolean; refreshError?: string } {
  const flags: { stale?: boolean; refreshError?: string } = {}
  if (declaration.stale) flags.stale = true
  const refreshError = declaration.refreshError?.trim()
  if (refreshError) flags.refreshError = refreshError.slice(0, 300)
  return flags
}

export class ReasoningDiscovery {
  readonly #declarationProvider: DeclarationProvider
  readonly #catalogProvider: CatalogDeclarationProvider | undefined
  readonly #table: ReasoningLevelTable
  readonly #now: () => number
  readonly #ttlMs: number
  readonly #cache = new Map<string, { outcome: ReasoningDiscoveryOutcome; expiresAt: number }>()

  constructor(options: ReasoningDiscoveryOptions) {
    this.#declarationProvider = options.declarationProvider
    this.#catalogProvider = options.catalogProvider
    this.#table = options.table ?? REASONING_LEVEL_TABLE
    this.#now = options.now ?? (() => Date.now())
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  }

  async discover(
    query: ReasoningDiscoveryQuery,
    options: { force?: boolean } = {}
  ): Promise<ReasoningDiscoveryOutcome> {
    const key = cacheKey(query)
    const checkedAt = toIso(this.#now)

    if (!options.force) {
      const cached = this.#cache.get(key)
      if (cached && cached.expiresAt > this.#now()) {
        return { ...cached.outcome, source: 'cache', checkedAt }
      }
      if (cached) this.#cache.delete(key)
    }

    const outcome = await this.#resolve(query, checkedAt, options.force === true)
    // Only successful checks are cached: a failure must be retried next time.
    if (outcome !== null) {
      this.#cache.set(key, { outcome, expiresAt: this.#now() + this.#ttlMs })
      return outcome
    }
    return unknownOutcome(checkedAt)
  }

  invalidate(query: ReasoningDiscoveryQuery): void {
    this.#cache.delete(cacheKey(query))
  }

  clearCache(): void {
    this.#cache.clear()
  }

  async #resolve(
    query: ReasoningDiscoveryQuery,
    checkedAt: string,
    force: boolean
  ): Promise<ReasoningDiscoveryOutcome | null> {
    let declaration: UpstreamReasoningDeclaration
    try {
      declaration = await this.#declarationProvider(query)
    } catch {
      // Discovery must never break the binding: degrade to unknown and stay uncached.
      return null
    }

    if (declaration.kind === 'declared-unsupported') {
      return {
        state: 'unsupported',
        levels: [],
        completeness: null,
        defaultLevel: null,
        source: 'upstream',
        verifiedAt: declaration.observedAt?.trim() || null,
        checkedAt,
        attachEffort: false,
        ...observationFlags(declaration)
      }
    }

    if (declaration.kind === 'declared') {
      const levels = declaration.levels.map(({ id }) => id.trim()).filter((id) => id.length > 0)
      if (levels.length > 0) {
        const defaultLevel = declaration.levels.find(({ isDefault }) => isDefault)?.id.trim() ?? null
        return {
          state: 'known',
          levels,
          completeness: declaration.partial ? 'partial' : 'complete',
          defaultLevel,
          source: 'upstream',
          verifiedAt: declaration.observedAt?.trim() || null,
          checkedAt,
          attachEffort: true,
          ...observationFlags(declaration)
        }
      }
      // An empty upstream declaration is no evidence, not a negative one.
    }

    // The local declaration had no levels: consult the real upstream catalog
    // (network observation with its own ~24h cache) before the dated vocabulary.
    if (this.#catalogProvider) {
      let catalog: UpstreamReasoningDeclaration | null = null
      try {
        catalog = await this.#catalogProvider(query, force ? { force: true } : undefined)
      } catch {
        catalog = null // never block the binding on an observation failure
      }
      if (catalog?.kind === 'declared-unsupported') {
        return {
          state: 'unsupported',
          levels: [],
          completeness: null,
          defaultLevel: null,
          source: 'catalog',
          verifiedAt: catalog.observedAt?.trim() || null,
          checkedAt,
          attachEffort: false,
          ...observationFlags(catalog)
        }
      }
      if (catalog?.kind === 'declared') {
        const catalogLevels = catalog.levels.map(({ id }) => id.trim()).filter((id) => id.length > 0)
        if (catalogLevels.length > 0) {
          return {
            state: 'known',
            levels: catalogLevels,
            completeness: catalog.partial ? 'partial' : 'complete',
            defaultLevel: catalog.levels.find(({ isDefault }) => isDefault)?.id.trim() ?? null,
            source: 'catalog',
            verifiedAt: catalog.observedAt?.trim() || null,
            checkedAt,
            attachEffort: true,
            ...observationFlags(catalog)
          }
        }
      }
    }

    const evidence = lookupReasoningLevels(query, this.#table)
    if (evidence.kind === 'declared') {
      return {
        state: 'known',
        levels: evidence.levels,
        completeness: evidence.completeness,
        defaultLevel: evidence.defaultLevel,
        source: 'vocabulary',
        verifiedAt: evidence.verifiedAt,
        checkedAt,
        attachEffort: true
      }
    }
    if (evidence.kind === 'declared-unsupported') {
      return {
        state: 'unsupported',
        levels: [],
        completeness: null,
        defaultLevel: null,
        source: 'vocabulary',
        verifiedAt: evidence.verifiedAt,
        checkedAt,
        attachEffort: false
      }
    }
    return unknownOutcome(checkedAt)
  }

  /**
   * Active probe: only ever called on an explicit user action (the UI warns about
   * cost). Each attempt sends one request per level and records whether upstream
   * accepted the parameter — never that the level "works".
   *
   * `signal` cancels between attempts; `timeoutMs` bounds a single attempt.
   */
  async probeLevels(
    query: ReasoningDiscoveryQuery,
    levels: readonly string[],
    probe: ReasoningLevelProbe,
    options: { maxLevels?: number; signal?: AbortSignal; timeoutMs?: number } = {}
  ): Promise<ReasoningProbeReport> {
    const maxLevels = Math.max(0, options.maxLevels ?? 6)
    const attempted = levels.slice(0, maxLevels)
    const skipped = levels.slice(attempted.length)
    const acceptedLevels: string[] = []
    const rejectedLevels: string[] = []
    const errors: string[] = []
    let cancelled = false

    for (const [index, level] of attempted.entries()) {
      if (options.signal?.aborted) {
        cancelled = true
        skipped.unshift(...attempted.slice(index))
        break
      }
      try {
        const attemptSignal = combineSignal(options.signal, options.timeoutMs)
        const { accepted } = await probe({ level, query, ...(attemptSignal ? { signal: attemptSignal } : {}) })
        if (accepted) acceptedLevels.push(level)
        else rejectedLevels.push(level)
      } catch (error) {
        if (options.signal?.aborted) {
          cancelled = true
          skipped.unshift(...attempted.slice(index))
          break
        }
        errors.push(`${level}: ${error instanceof Error ? error.message : String(error)}`)
        rejectedLevels.push(level)
      }
    }

    return {
      acceptedLevels,
      rejectedLevels,
      skippedLevels: skipped,
      truncated: skipped.length > 0 && !cancelled,
      cancelled,
      errors,
      meaning: 'parameter-accepted-only'
    }
  }
}

function combineSignal(signal: AbortSignal | undefined, timeoutMs: number | undefined): AbortSignal | undefined {
  const timeoutSignal =
    typeof timeoutMs === 'number' && timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined
  if (signal && timeoutSignal) return AbortSignal.any([signal, timeoutSignal])
  return signal ?? timeoutSignal
}