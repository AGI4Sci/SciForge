import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DomainMainAfterTurnEvent,
  DomainMainRuntimeLifecycleContribution,
  DomainMainTurnLifecycleEvent
} from '@sciforge/domain-sdk/host'
import { createDomainMainEntry } from './main'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('Computer Use domain lifecycle', () => {
  it('enables the managed MCP server for supported local runtimes', () => {
    vi.stubEnv('SCIFORGE_CUA_SERVICE_URL', 'http://127.0.0.1:3900')
    const entry = createDomainMainEntry({
      getUserDataDir: () => '/tmp/sciforge',
      getAppRoot: () => '/workspace/SciForge',
      getExecutablePath: () => '/workspace/electron',
      isPackaged: () => false,
      defineCapability: (value) => value
    })
    const contribution = entry.contributions.find(
      (candidate) => candidate.kind === 'main.runtime-mcp-server'
    )?.value as { createConfig: (settings: unknown) => { id: string } | null; isRuntimeEnabled: (settings: unknown, runtimeId: string) => boolean }
    const settings = {
      computerUse: {
        enabled: true,
        runtimeEnabled: { codex: true, claude: false, dsh: true }
      }
    }

    expect(contribution.createConfig(settings)?.id).toBe('gui_owl_computer_use')
    expect(contribution.isRuntimeEnabled(settings, 'codex')).toBe(true)
    expect(contribution.isRuntimeEnabled(settings, 'claude')).toBe(false)
    expect(contribution.isRuntimeEnabled(settings, 'dsh')).toBe(false)
  })

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
    await listener?.({
      kind: 'after-persistent-child-turn', state: 'cancelled', runtimeId: 'codex',
      threadId: 'child-thread', turnId: 'child-turn', childId: 'child-1',
      parentThreadId: 'parent-thread', parentTurnId: 'parent-turn',
      occurredAt: '2026-08-16T00:00:01.000Z'
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const childRequest = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect(JSON.parse(String(childRequest.body))).toEqual({
      runtimeId: 'codex', threadId: 'child-thread', turnId: 'child-turn', reason: 'turn_cancelled'
    })
    fetchMock.mockRejectedValueOnce(new Error('cleanup unavailable'))
    await expect(listener?.({
      kind: 'after-persistent-child-turn', state: 'completed', runtimeId: 'codex',
      threadId: 'retry-child-thread', turnId: 'retry-child-turn', childId: 'child-2',
      parentThreadId: 'parent-thread', parentTurnId: 'parent-turn',
      occurredAt: '2026-08-16T00:00:02.000Z'
    })).rejects.toThrow('cleanup unavailable')
    fetchMock.mockRejectedValueOnce(new Error('ordinary turn cleanup unavailable'))
    await expect(listener?.(event)).resolves.toBeUndefined()
    await dispose?.()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
