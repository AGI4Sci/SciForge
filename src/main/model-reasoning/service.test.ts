/**
 * Main-process service contract for `modelReasoning:*`.
 *
 * These tests use a mock probe runner and a mock declaration provider — the spec
 * forbids calling paid upstreams from automated tests.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  ModelReasoningService,
  PROBE_ALREADY_RUNNING_ERROR,
  UNCONFIGURED_PROBE_RUNNER_ERROR
} from './service'
import { ReasoningDiscovery, type ReasoningLevelProbe } from './reasoning-discovery'
import { REASONING_LEVEL_TABLE, type ReasoningLevelTable } from './reasoning-levels'

const QUERY = {
  provider: 'intern',
  model: 'deepseek-v4-flash-0731',
  protocol: 'chat-completions',
  endpoint: 'https://api.example.com/v1'
}

const TABLE: ReasoningLevelTable = {
  schemaVersion: 1,
  entries: [
    {
      provider: 'fixture',
      model: 'table-model',
      protocol: '*',
      levels: ['low'],
      completeness: 'complete',
      source: 'fixture-table',
      verifiedAt: '2026-02-01'
    }
  ]
}

function serviceWith(
  options: {
    declaration?: (query: unknown) => Promise<unknown>
    probeRunner?: ReasoningLevelProbe
    table?: ReasoningLevelTable
    now?: () => number
  } = {}
) {
  const declarationProvider = vi.fn(async (query: unknown) => {
    if (options.declaration) return (await options.declaration(query)) as never
    return { kind: 'unknown' as const }
  })
  const discovery = new ReasoningDiscovery({
    declarationProvider: declarationProvider as never,
    table: options.table ?? TABLE,
    now: options.now
  })
  const service = new ModelReasoningService({ discovery, probeRunner: options.probeRunner })
  return { service, declarationProvider }
}

describe('model reasoning service', () => {
  it('resolves vocabulary evidence for a binding and keeps partial markers', async () => {
    // Uses the shipped table on purpose: this test guards what the app really ships.
    const { service } = serviceWith({ table: REASONING_LEVEL_TABLE })
    const outcome = await service.discover(QUERY)
    expect(outcome.state).toBe('known')
    expect(outcome.levels).toEqual(['high'])
    expect(outcome.completeness).toBe('partial')
    expect(outcome.source).toBe('vocabulary')
    expect(outcome.attachEffort).toBe(true)
  })

  it('never throws and reports unknown when the upstream check fails', async () => {
    const { service } = serviceWith({
      declaration: async () => {
        throw new Error('upstream unreachable')
      }
    })
    const outcome = await service.discover(QUERY)
    expect(outcome.state).toBe('unknown')
    expect(outcome.attachEffort).toBe(false)
  })

  it('does not attach an effort for an unknown model', async () => {
    const { service } = serviceWith()
    const outcome = await service.discover({ ...QUERY, model: 'unheard-of-model' })
    expect(outcome.state).toBe('unknown')
    expect(outcome.levels).toEqual([])
    expect(outcome.attachEffort).toBe(false)
  })

  it('refreshes on demand: invalidate then discover asks upstream again', async () => {
    const { service, declarationProvider } = serviceWith()
    await service.discover(QUERY)
    await service.discover(QUERY)
    expect(declarationProvider).toHaveBeenCalledTimes(1)
    service.invalidate(QUERY)
    await service.discover(QUERY)
    expect(declarationProvider).toHaveBeenCalledTimes(2)
  })

  it('clearCache drops every cached conclusion after a binding change', async () => {
    const { service, declarationProvider } = serviceWith()
    await service.discover(QUERY)
    await service.discover(QUERY)
    expect(declarationProvider).toHaveBeenCalledTimes(1)
    service.clearCache()
    await service.discover(QUERY)
    expect(declarationProvider).toHaveBeenCalledTimes(2)
  })

  it('declares probing unavailable instead of pretending to probe', async () => {
    const { service } = serviceWith()
    const report = await service.probe({
      requestId: 'req-1',
      query: QUERY,
      levels: ['low', 'high']
    })
    expect(report.acceptedLevels).toEqual([])
    expect(report.skippedLevels).toEqual(['low', 'high'])
    expect(report.errors).toEqual([UNCONFIGURED_PROBE_RUNNER_ERROR])
    expect(report.meaning).toBe('parameter-accepted-only')
  })

  it('reports acceptance only, with a mock runner', async () => {
    const runner: ReasoningLevelProbe = vi.fn(async ({ level }) => ({ accepted: level === 'high' }))
    const { service } = serviceWith({ probeRunner: runner })
    const report = await service.probe({ requestId: 'req-2', query: QUERY, levels: ['low', 'high'] })
    expect(report.acceptedLevels).toEqual(['high'])
    expect(report.rejectedLevels).toEqual(['low'])
    expect(report.cancelled).toBe(false)
    expect(report.errors).toEqual([])
    expect(report.meaning).toBe('parameter-accepted-only')
  })

  it('cancels an in-flight probe by request id', async () => {
    let started: () => void = () => {}
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const runner: ReasoningLevelProbe = vi.fn(async ({ signal }) => {
      started()
      return await new Promise<{ accepted: boolean }>((_, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted by caller')))
      })
    })
    const { service } = serviceWith({ probeRunner: runner })
    const probePromise = service.probe({ requestId: 'req-3', query: QUERY, levels: ['low', 'high'] })
    await startedPromise
    expect(service.cancelProbe('req-3')).toEqual({ cancelled: true })
    const report = await probePromise
    expect(report.cancelled).toBe(true)
    expect(report.acceptedLevels).toEqual([])
    expect(report.skippedLevels).toEqual(['low', 'high'])
    expect(service.cancelProbe('req-3')).toEqual({ cancelled: false })
  })

  it('refuses a concurrent probe instead of stacking requests', async () => {
    let started: () => void = () => {}
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const runner: ReasoningLevelProbe = vi.fn(async ({ signal }) => {
      started()
      return await new Promise<{ accepted: boolean }>((_, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    })
    const { service } = serviceWith({ probeRunner: runner })
    const first = service.probe({ requestId: 'req-4', query: QUERY, levels: ['low'] })
    await startedPromise
    const second = await service.probe({ requestId: 'req-5', query: QUERY, levels: ['low'] })
    expect(second.errors).toEqual([PROBE_ALREADY_RUNNING_ERROR])
    expect(runner).toHaveBeenCalledTimes(1)
    service.dispose()
    const firstReport = await first
    expect(firstReport.cancelled).toBe(true)
  })

  it('ships a vocabulary table that passes its own invariants', () => {
    // Guards the file the app actually ships, not a fixture.
    expect(REASONING_LEVEL_TABLE.entries.length).toBeGreaterThan(0)
    expect(REASONING_LEVEL_TABLE.entries.every((entry) => entry.source.length > 0)).toBe(true)
  })
})