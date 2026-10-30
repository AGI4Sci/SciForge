/**
 * Reasoning-level discovery contract.
 *
 * Behaviour required by the redesign spec:
 *  - upstream declaration wins over the vocabulary, always;
 *  - an upstream "this model exposes no levels" is never overridden by the table;
 *  - a discovery failure degrades to `unknown` and never blocks the binding;
 *  - `unknown` means "do not attach a reasoning parameter", not "unsupported";
 *  - cached results are keyed by endpoint + model + protocol and never leak
 *    across bindings;
 *  - partial evidence stays partial: it is never presented as the full ladder.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  ReasoningDiscovery,
  type ReasoningLevelProbe,
  type ReasoningDiscoveryQuery,
  type UpstreamReasoningDeclaration
} from './reasoning-discovery'
import type { ReasoningLevelTable } from './reasoning-levels'

const TABLE: ReasoningLevelTable = {
  schemaVersion: 1,
  entries: [
    {
      provider: 'fixture',
      model: 'table-only',
      protocol: '*',
      levels: ['low', 'high'],
      completeness: 'complete',
      defaultLevel: 'high',
      source: 'fixture-table',
      verifiedAt: '2026-02-01'
    },
    {
      provider: 'fixture',
      model: 'table-partial',
      protocol: '*',
      levels: ['high'],
      completeness: 'partial',
      source: 'fixture-table',
      verifiedAt: '2026-02-03'
    },
    {
      provider: 'fixture',
      model: 'table-unsupported',
      protocol: '*',
      declaredUnsupported: true,
      source: 'fixture-table',
      verifiedAt: '2026-02-02'
    }
  ]
}

type DeclarationCall = ReasoningDiscoveryQuery

function harness(
  declaration: (call: DeclarationCall) => Promise<UpstreamReasoningDeclaration> | UpstreamReasoningDeclaration,
  options: { now?: () => number; ttlMs?: number } = {}
) {
  const calls: DeclarationCall[] = []
  const declarationProvider = vi.fn(async (call: DeclarationCall) => {
    calls.push(call)
    return declaration(call)
  })
  const discovery = new ReasoningDiscovery({
    declarationProvider,
    table: TABLE,
    now: options.now ?? (() => Date.parse('2026-03-01T00:00:00Z')),
    ttlMs: options.ttlMs ?? 60_000
  })
  return { discovery, calls, declarationProvider }
}

const QUERY = {
  provider: 'fixture',
  model: 'table-only',
  protocol: 'chat-completions',
  endpoint: 'https://api.example.com/v1'
}

describe('reasoning level discovery', () => {
  it('prefers the upstream declaration over the vocabulary', async () => {
    const { discovery } = harness(() => ({ kind: 'declared', levels: [{ id: 'xhigh' }] }))
    const outcome = await discovery.discover(QUERY)
    expect(outcome.state).toBe('known')
    expect(outcome.levels).toEqual(['xhigh'])
    expect(outcome.source).toBe('upstream')
  })

  it('keeps an upstream "unsupported" even when the vocabulary claims levels', async () => {
    const { discovery } = harness(() => ({ kind: 'declared-unsupported' }))
    const outcome = await discovery.discover(QUERY)
    expect(outcome.state).toBe('unsupported')
    expect(outcome.levels).toEqual([])
    expect(outcome.completeness).toBeNull()
    expect(outcome.source).toBe('upstream')
  })

  it('records an upstream declaration as complete unless it says otherwise', async () => {
    const complete = await harness(() => ({ kind: 'declared', levels: [{ id: 'low' }] })).discovery.discover(QUERY)
    const partial = await harness(() => ({ kind: 'declared', levels: [{ id: 'low' }], partial: true })).discovery.discover(QUERY)
    expect(complete.completeness).toBe('complete')
    expect(partial.completeness).toBe('partial')
  })

  it('falls back to the vocabulary only when upstream declares nothing', async () => {
    const { discovery } = harness(() => ({ kind: 'unknown' }))
    const outcome = await discovery.discover(QUERY)
    expect(outcome.state).toBe('known')
    expect(outcome.levels).toEqual(['low', 'high'])
    expect(outcome.completeness).toBe('complete')
    expect(outcome.defaultLevel).toBe('high')
    expect(outcome.source).toBe('vocabulary')
    expect(outcome.verifiedAt).toBe('2026-02-01')
  })

  it('keeps vocabulary evidence partial when it is partial', async () => {
    const { discovery } = harness(() => ({ kind: 'unknown' }))
    const outcome = await discovery.discover({ ...QUERY, model: 'table-partial' })
    expect(outcome.state).toBe('known')
    expect(outcome.levels).toEqual(['high'])
    expect(outcome.completeness).toBe('partial')
    // Partial evidence must flow as "known" so the UI can still show the levels,
    // but the marker keeps it from reading as the full ladder.
    expect(outcome.attachEffort).toBe(true)
  })

  it('reports vocabulary-declared unsupported without inventing levels', async () => {
    const { discovery } = harness(() => ({ kind: 'unknown' }))
    const outcome = await discovery.discover({ ...QUERY, model: 'table-unsupported' })
    expect(outcome.state).toBe('unsupported')
    expect(outcome.levels).toEqual([])
    expect(outcome.source).toBe('vocabulary')
  })

  it('degrades to unknown when there is no evidence anywhere', async () => {
    const { discovery } = harness(() => ({ kind: 'unknown' }))
    const outcome = await discovery.discover({ ...QUERY, model: 'never-heard-of' })
    expect(outcome.state).toBe('unknown')
    expect(outcome.levels).toEqual([])
    expect(outcome.completeness).toBeNull()
    expect(outcome.defaultLevel).toBeNull()
    expect(outcome.source).toBe('none')
    // Unknown must translate to "no reasoning parameter", never to "unsupported".
    expect(outcome.attachEffort).toBe(false)
    expect(outcome.state).not.toBe('unsupported')
  })

  it('never blocks the binding when the upstream check fails', async () => {
    const { discovery } = harness(() => {
      throw new Error('upstream unreachable')
    })
    const outcome = await discovery.discover(QUERY)
    expect(outcome.state).toBe('unknown')
    expect(outcome.source).toBe('none')
    expect(outcome.attachEffort).toBe(false)
  })

  it('serves a cached outcome within the TTL without re-asking upstream', async () => {
    let now = 1_000
    const { discovery, declarationProvider } = harness(
      () => ({ kind: 'declared', levels: [{ id: 'high', isDefault: true }] }),
      { now: () => now, ttlMs: 5_000 }
    )
    const first = await discovery.discover(QUERY)
    now += 4_000
    const second = await discovery.discover(QUERY)
    expect(declarationProvider).toHaveBeenCalledTimes(1)
    expect(first.source).toBe('upstream')
    expect(second.source).toBe('cache')
    expect(second.levels).toEqual(['high'])
    expect(second.defaultLevel).toBe('high')
    now += 2_000
    const third = await discovery.discover(QUERY)
    expect(declarationProvider).toHaveBeenCalledTimes(2)
    expect(third.source).toBe('upstream')
  })

  it('does not cache a failure, so the next binding attempt retries', async () => {
    let attempts = 0
    const { discovery, declarationProvider } = harness(() => {
      attempts += 1
      if (attempts === 1) throw new Error('temporary')
      return { kind: 'declared', levels: [{ id: 'low' }] }
    })
    expect((await discovery.discover(QUERY)).state).toBe('unknown')
    expect((await discovery.discover(QUERY)).state).toBe('known')
    expect(declarationProvider).toHaveBeenCalledTimes(2)
  })

  it('keys cached outcomes by endpoint, model and protocol', async () => {
    const { discovery, declarationProvider } = harness(() => ({ kind: 'declared', levels: [{ id: 'low' }] }))
    await discovery.discover(QUERY)
    await discovery.discover({ ...QUERY, model: 'table-only-other' })
    await discovery.discover({ ...QUERY, protocol: 'responses' })
    await discovery.discover({ ...QUERY, endpoint: 'https://api.example.com/v2' })
    expect(declarationProvider).toHaveBeenCalledTimes(4)
  })

  it('exposes explicit invalidation and forced refresh', async () => {
    const { discovery, declarationProvider } = harness(() => ({ kind: 'declared', levels: [{ id: 'low' }] }))
    await discovery.discover(QUERY)
    discovery.invalidate(QUERY)
    await discovery.discover(QUERY)
    expect(declarationProvider).toHaveBeenCalledTimes(2)
    await discovery.discover(QUERY, { force: true })
    expect(declarationProvider).toHaveBeenCalledTimes(3)
  })

  it('probes only when asked, reports acceptance only, and never rewrites the table', async () => {
    const probe: ReasoningLevelProbe = vi.fn(async ({ level }) => ({ accepted: level === 'high' }))
    const tableBefore = JSON.stringify(TABLE)
    const { discovery } = harness(() => ({ kind: 'unknown' }))
    const result = await discovery.probeLevels(QUERY, ['low', 'high'], probe, { maxLevels: 2 })
    expect(result.acceptedLevels).toEqual(['high'])
    expect(result.rejectedLevels).toEqual(['low'])
    expect(result.meaning).toBe('parameter-accepted-only')
    expect(result.cancelled).toBe(false)
    expect(probe).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(TABLE)).toBe(tableBefore)
    // Probing must not populate the declared-levels cache: it is weaker evidence.
    const outcome = await discovery.discover({ ...QUERY, model: 'never-heard-of' })
    expect(outcome.state).toBe('unknown')
  })

  it('bounds probe work and reports the cap honestly', async () => {
    const probe: ReasoningLevelProbe = vi.fn(async () => ({ accepted: true }))
    const { discovery } = harness(() => ({ kind: 'unknown' }))
    const result = await discovery.probeLevels(QUERY, ['a', 'b', 'c', 'd'], probe, { maxLevels: 2 })
    expect(probe).toHaveBeenCalledTimes(2)
    expect(result.skippedLevels).toEqual(['c', 'd'])
    expect(result.truncated).toBe(true)
    expect(result.cancelled).toBe(false)
  })

  it('surfaces probe failures as rejections instead of throwing', async () => {
    const probe: ReasoningLevelProbe = vi.fn(async () => {
      throw new Error('network down')
    })
    const { discovery } = harness(() => ({ kind: 'unknown' }))
    const result = await discovery.probeLevels(QUERY, ['high'], probe, { maxLevels: 1 })
    expect(result.acceptedLevels).toEqual([])
    expect(result.rejectedLevels).toEqual(['high'])
    expect(result.errors).toHaveLength(1)
  })

  it('stops probing when the caller aborts, and never starts after an abort', async () => {
    const probe: ReasoningLevelProbe = vi.fn(async ({ level }) => ({ accepted: level === 'high' }))
    const { discovery } = harness(() => ({ kind: 'unknown' }))

    const alreadyAborted = new AbortController()
    alreadyAborted.abort()
    const skippedRun = await discovery.probeLevels(QUERY, ['low', 'high'], probe, {
      maxLevels: 2,
      signal: alreadyAborted.signal
    })
    expect(probe).not.toHaveBeenCalled()
    expect(skippedRun.cancelled).toBe(true)
    expect(skippedRun.acceptedLevels).toEqual([])
    expect(skippedRun.skippedLevels).toEqual(['low', 'high'])

    // Abort raised by the probe itself must stop the loop before the next level.
    const controller = new AbortController()
    const abortingProbe: ReasoningLevelProbe = vi.fn(async ({ level }) => {
      if (level === 'low') controller.abort()
      return { accepted: false }
    })
    const midRun = await discovery.probeLevels(QUERY, ['low', 'high'], abortingProbe, {
      maxLevels: 2,
      signal: controller.signal
    })
    expect(abortingProbe).toHaveBeenCalledTimes(1)
    expect(midRun.cancelled).toBe(true)
    expect(midRun.skippedLevels).toEqual(['high'])
    expect(midRun.truncated).toBe(false)
  })

  it('bounds a single attempt with timeoutMs when the probe honours the signal', async () => {
    const hangingProbe: ReasoningLevelProbe = vi.fn(
      async ({ signal }) =>
        await new Promise<{ accepted: boolean }>((_, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('timed out')))
        })
    )
    const { discovery } = harness(() => ({ kind: 'unknown' }))
    const result = await discovery.probeLevels(QUERY, ['high'], hangingProbe, {
      maxLevels: 1,
      timeoutMs: 20
    })
    expect(result.acceptedLevels).toEqual([])
    expect(result.rejectedLevels).toEqual(['high'])
    expect(result.errors).toHaveLength(1)
  })

  it('gives the probe a signal even when the caller did not pass one', async () => {
    let sawSignal = false
    const probe: ReasoningLevelProbe = vi.fn(async ({ signal }) => {
      sawSignal = signal !== undefined
      return { accepted: true }
    })
    const { discovery } = harness(() => ({ kind: 'unknown' }))
    const result = await discovery.probeLevels(QUERY, ['high'], probe, { maxLevels: 1, timeoutMs: 1_000 })
    expect(sawSignal).toBe(true)
    expect(result.acceptedLevels).toEqual(['high'])
  })
})

describe('real upstream catalog chain', () => {
  type CatalogCallOptions = { force?: boolean }

  function catalogHarness(
    declaration: (call: DeclarationCall) => Promise<UpstreamReasoningDeclaration> | UpstreamReasoningDeclaration,
    catalog: (call: DeclarationCall) => Promise<UpstreamReasoningDeclaration | null>
  ) {
    const catalogCalls: Array<{ query: DeclarationCall; force?: boolean }> = []
    const declarationProvider = vi.fn(async (call: DeclarationCall) => declaration(call))
    const catalogProvider = vi.fn(
      async (call: DeclarationCall, options?: CatalogCallOptions) => {
        catalogCalls.push({ query: call, ...(options?.force ? { force: true } : {}) })
        return catalog(call)
      }
    )
    const discovery = new ReasoningDiscovery({
      declarationProvider,
      catalogProvider,
      table: TABLE,
      now: () => Date.parse('2026-03-01T00:00:00Z'),
      ttlMs: 60_000
    })
    return { discovery, catalogCalls, catalogProvider }
  }

  it('consults the real catalog after an empty declaration and labels the source', async () => {
    const { discovery } = catalogHarness(
      () => ({ kind: 'unknown' }),
      async () => ({
        kind: 'declared',
        levels: [{ id: 'high', isDefault: true }],
        observedAt: '2026-10-26T00:00:00.000Z'
      })
    )
    const outcome = await discovery.discover(QUERY)
    expect(outcome.source).toBe('catalog')
    expect(outcome.state).toBe('known')
    expect(outcome.levels).toEqual(['high'])
    expect(outcome.defaultLevel).toBe('high')
    expect(outcome.verifiedAt).toBe('2026-10-26T00:00:00.000Z')
    expect(outcome.attachEffort).toBe(true)
  })

  it('a catalog declared-unsupported is final and outranks the vocabulary', async () => {
    const { discovery } = catalogHarness(
      () => ({ kind: 'unknown' }),
      async () => ({ kind: 'declared-unsupported', observedAt: '2026-10-26T00:00:00.000Z' })
    )
    // `table-only` would otherwise be known through the vocabulary.
    const outcome = await discovery.discover(QUERY)
    expect(outcome.state).toBe('unsupported')
    expect(outcome.levels).toEqual([])
    expect(outcome.source).toBe('catalog')
  })

  it('a missing or failing catalog observation falls back to the vocabulary', async () => {
    const missing = catalogHarness(
      () => ({ kind: 'unknown' }),
      async () => null
    )
    expect((await missing.discovery.discover(QUERY)).source).toBe('vocabulary')

    const failing = catalogHarness(
      () => ({ kind: 'unknown' }),
      async () => {
        throw new Error('catalog down')
      }
    )
    expect((await failing.discovery.discover(QUERY)).source).toBe('vocabulary')
  })

  it('never touches the catalog when the local declaration already has levels', async () => {
    const { discovery, catalogProvider } = catalogHarness(
      () => ({ kind: 'declared', levels: [{ id: 'xhigh' }] }),
      async () => null
    )
    const outcome = await discovery.discover(QUERY)
    expect(outcome.source).toBe('upstream')
    expect(catalogProvider).not.toHaveBeenCalled()
  })

  it('force propagates to the catalog query, and the outcome cache still serves repeats', async () => {
    const { discovery, catalogCalls } = catalogHarness(
      () => ({ kind: 'unknown' }),
      async () => ({ kind: 'declared', levels: [{ id: 'high' }], observedAt: 't' })
    )
    await discovery.discover(QUERY)
    await discovery.discover(QUERY) // served by the outcome cache; catalog not consulted again
    await discovery.discover(QUERY, { force: true })
    expect(catalogCalls.map((call) => Boolean(call.force))).toEqual([false, true])
  })

  it('labels a stale catalog observation with its refresh failure instead of faking freshness', async () => {
    const { discovery } = catalogHarness(
      () => ({ kind: 'unknown' }),
      async () => ({
        kind: 'declared',
        levels: [{ id: 'high' }],
        observedAt: '2026-10-25T00:00:00.000Z',
        stale: true,
        refreshError: 'upstream catalog request failed (503); showing the last valid observation from 2026-10-25T00:00:00.000Z'
      })
    )
    const outcome = await discovery.discover(QUERY)
    expect(outcome.source).toBe('catalog')
    expect(outcome.state).toBe('known')
    expect(outcome.stale).toBe(true)
    expect(String(outcome.refreshError)).toContain('503')
  })
})