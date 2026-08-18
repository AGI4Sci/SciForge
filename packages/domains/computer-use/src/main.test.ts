import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DomainMainAfterTurnEvent,
  DomainMainRuntimeLifecycleContribution,
  DomainMainTurnLifecycleEvent
} from '@sciforge/domain-sdk/host'
import { createDomainMainEntry } from './main'

afterEach(() => vi.unstubAllGlobals())

describe('Computer Use domain lifecycle', () => {
  it('reclaims only the exact terminal turn through the domain-owned sidecar boundary', async () => {
    let listener: ((event: DomainMainTurnLifecycleEvent) => void | Promise<void>) | undefined
    const unsubscribe = vi.fn()
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ ok: true, data: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }))
    vi.stubGlobal('fetch', fetchMock)
    const entry = createDomainMainEntry({
      getUserDataDir: () => 'C:/tmp',
      defineCapability: (value) => value
    })
    const lifecycle = entry.contributions.find(
      (candidate) => candidate.kind === 'main.runtime-lifecycle'
    )?.value as DomainMainRuntimeLifecycleContribution
    const controller = new AbortController()
    const dispose = await lifecycle.activate({
      environment: {
        SCIFORGE_CUA_SERVICE_URL: 'http://127.0.0.1:3900',
        SCIFORGE_CUA_SERVICE_TOKEN: 'service-token',
        SCIFORGE_CUA_CDP_ADAPTER_URL: 'http://127.0.0.1:3901'
      },
      turnEvents: {
        subscribe: (value: (event: DomainMainTurnLifecycleEvent) => void | Promise<void>) => {
          listener = value
          return unsubscribe
        },
        subscribeRequiredBeforeTurn: () => () => undefined,
        readDurableTurnBoundarySnapshot: async () => ({
          issuerEpoch: 'epoch', nextDeliveryAttemptOrdinal: 1,
          retiredThroughOrdinal: 0, retiredOrdinalRanges: [], owners: []
        })
      },
      signal: controller.signal,
      log: vi.fn()
    } as never)
    const event = {
      kind: 'after-turn', state: 'completed', runtimeId: 'codex',
      threadId: 'thread-1', turnId: 'turn-1'
    } as DomainMainAfterTurnEvent
    await listener?.(event)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3900/computer-use/reclaim-owner')
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(request.body))).toEqual({
      runtimeId: 'codex', threadId: 'thread-1', turnId: 'turn-1', reason: 'turn_completed'
    })
    await dispose?.()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
