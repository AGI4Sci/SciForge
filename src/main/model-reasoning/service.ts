/**
 * Main-process service behind the `modelReasoning:*` IPC surface.
 *
 * It owns three things the renderer must not:
 *  - the discovery cache (keyed per binding, see ./reasoning-discovery);
 *  - the user-triggered probe registry, so a probe can actually be cancelled;
 *  - the hard guarantee that nothing here can block a binding or a chat turn.
 *
 * The probe runner is injected. When no runner is configured (the default in this
 * build) probing reports `probe runner is not configured in this build` instead
 * of pretending to have sent anything.
 */
import type {
  ModelReasoningOutcome,
  ModelReasoningProbeInput,
  ModelReasoningProbeReport,
  ModelReasoningQuery
} from '../../shared/model-reasoning'

import {
  ReasoningDiscovery,
  type DeclarationProvider,
  type ReasoningLevelProbe
} from './reasoning-discovery'
import type { UpstreamCatalogObserverLike } from './upstream-catalog'

export const UNCONFIGURED_PROBE_RUNNER_ERROR = 'probe runner is not configured in this build'
export const PROBE_ALREADY_RUNNING_ERROR = 'another reasoning-level probe is already running'
export const PROBE_TIMEOUT_MS = 20_000
export const PROBE_MAX_LEVELS = 6

export type ModelReasoningServiceOptions = Readonly<{
  discovery?: ReasoningDiscovery
  /** Injected declaration source (runtime catalog first, if the caller has one). */
  declarationProvider?: DeclarationProvider
  /** Optional real upstream catalog observer; consulted when the declaration has no levels. */
  catalogObserver?: UpstreamCatalogObserverLike
  /** Injected probe runner; omitted means probing is unavailable in this build. */
  probeRunner?: ReasoningLevelProbe
}>

export class ModelReasoningService {
  readonly #discovery: ReasoningDiscovery
  readonly #probeRunner: ReasoningLevelProbe | undefined
  readonly #catalogObserver: UpstreamCatalogObserverLike | undefined
  readonly #inFlight = new Map<string, AbortController>()

  constructor(options: ModelReasoningServiceOptions = {}) {
    this.#catalogObserver = options.catalogObserver
    this.#discovery =
      options.discovery ??
      new ReasoningDiscovery({
        // No declaration source wired yet: upstream stays silent until a caller
        // provides one, and the vocabulary decides. This is the safe default.
        declarationProvider: options.declarationProvider ?? (async () => ({ kind: 'unknown' })),
        ...(options.catalogObserver
          ? {
              catalogProvider: (query, observeOptions) =>
                options.catalogObserver!.observe(query, observeOptions)
            }
          : {})
      })
    this.#probeRunner = options.probeRunner
  }

  /** Never throws: a lookup failure is reported as `unknown`, not as a rejection. */
  async discover(input: ModelReasoningQuery & { force?: boolean }): Promise<ModelReasoningOutcome> {
    const query = {
      provider: input.provider,
      model: input.model,
      protocol: input.protocol,
      endpoint: input.endpoint ?? null
    }
    try {
      const outcome = await this.#discovery.discover(query, input.force ? { force: true } : {})
      return { ...outcome, levels: [...outcome.levels] }
    } catch {
      return {
        state: 'unknown',
        levels: [],
        completeness: null,
        defaultLevel: null,
        source: 'none',
        verifiedAt: null,
        checkedAt: new Date().toISOString(),
        attachEffort: false
      }
    }
  }

  /** Force-refresh a binding: drop the cached outcome so the next check re-runs. */
  invalidate(input: ModelReasoningQuery): void {
    this.#discovery.invalidate({
      provider: input.provider,
      model: input.model,
      protocol: input.protocol,
      endpoint: input.endpoint ?? null
    })
  }

  async probe(input: ModelReasoningProbeInput): Promise<ModelReasoningProbeReport> {
    if (!this.#probeRunner) {
      return {
        requestId: input.requestId,
        acceptedLevels: [],
        rejectedLevels: [],
        skippedLevels: [...input.levels],
        truncated: false,
        cancelled: false,
        errors: [UNCONFIGURED_PROBE_RUNNER_ERROR],
        meaning: 'parameter-accepted-only'
      }
    }
    if (this.#inFlight.size > 0) {
      return {
        requestId: input.requestId,
        acceptedLevels: [],
        rejectedLevels: [],
        skippedLevels: [...input.levels],
        truncated: false,
        cancelled: false,
        errors: [PROBE_ALREADY_RUNNING_ERROR],
        meaning: 'parameter-accepted-only'
      }
    }

    const controller = new AbortController()
    this.#inFlight.set(input.requestId, controller)
    try {
      const report = await this.#discovery.probeLevels(
        {
          provider: input.query.provider,
          model: input.query.model,
          protocol: input.query.protocol,
          endpoint: input.query.endpoint ?? null
        },
        input.levels,
        this.#probeRunner,
        {
          maxLevels: input.maxLevels ?? PROBE_MAX_LEVELS,
          signal: controller.signal,
          timeoutMs: PROBE_TIMEOUT_MS
        }
      )
      return {
        requestId: input.requestId,
        acceptedLevels: [...report.acceptedLevels],
        rejectedLevels: [...report.rejectedLevels],
        skippedLevels: [...report.skippedLevels],
        truncated: report.truncated,
        cancelled: report.cancelled,
        errors: [...report.errors],
        meaning: report.meaning
      }
    } finally {
      this.#inFlight.delete(input.requestId)
    }
  }

  cancelProbe(requestId: string): { cancelled: boolean } {
    const controller = this.#inFlight.get(requestId)
    if (!controller) return { cancelled: false }
    controller.abort()
    return { cancelled: true }
  }

  /** Drop every cached conclusion; called when the binding settings change. */
  clearCache(): void {
    this.#discovery.clearCache()
    this.#catalogObserver?.clear()
  }

  /** Bound for tests and shutdown: abort every in-flight probe. */
  dispose(): void {
    for (const controller of this.#inFlight.values()) controller.abort()
    this.#inFlight.clear()
  }
}