import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HybridThreadStore } from '../src/adapters/hybrid/index.js'
import { InMemorySessionStore } from '../src/adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../src/adapters/in-memory-thread-store.js'
import { makeUserItem } from '../src/domain/item.js'
import { createThreadRecord } from '../src/domain/thread.js'
import { appendTurnItem, createTurnRecord, startTurn } from '../src/domain/turn.js'
import { UsageService } from '../src/services/usage-service.js'
import {
  createLocalRuntimeServeRuntime,
  resolveModelRouterRuntimeEndpoint,
  seedUsageCarryover,
  startLocalRuntimeServe
} from '../src/server/runtime-factory.js'
import type { UsageSnapshot } from '../src/contracts/usage.js'

afterEach(() => {
  delete process.env.SCIFORGE_CUA_SERVICE_URL
  delete process.env.SCIFORGE_CUA_SERVICE_TOKEN
})

function usage(overrides: Partial<UsageSnapshot>): UsageSnapshot {
  const promptTokens = overrides.promptTokens ?? 10
  const completionTokens = overrides.completionTokens ?? 5
  const cacheHitTokens = overrides.cacheHitTokens ?? 0
  const cacheMissTokens = overrides.cacheMissTokens ?? Math.max(promptTokens - cacheHitTokens, 0)
  const cacheTotal = cacheHitTokens + cacheMissTokens
  return {
    promptTokens,
    completionTokens,
    totalTokens: overrides.totalTokens ?? promptTokens + completionTokens,
    cachedTokens: overrides.cachedTokens ?? cacheHitTokens,
    cacheHitTokens,
    cacheMissTokens,
    cacheHitRate: cacheTotal === 0 ? null : cacheHitTokens / cacheTotal,
    turns: overrides.turns ?? 1,
    ...(overrides.costUsd !== undefined ? { costUsd: overrides.costUsd } : {})
  }
}

describe('runtime factory usage carryover', () => {
  it('seeds runtime usage from the latest persisted cumulative usage event per thread', async () => {
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const usageService = new UsageService()
    await threadStore.upsert(createThreadRecord({
      id: 'thr_seed',
      title: 'Seeded thread',
      workspace: '/tmp/project',
      model: 'deepseek-chat'
    }))
    await sessionStore.appendEvent('thr_seed', {
      kind: 'usage',
      seq: 2,
      timestamp: '2026-06-02T09:00:00.000Z',
      threadId: 'thr_seed',
      usage: usage({ promptTokens: 20, completionTokens: 5, cacheHitTokens: 10, cacheMissTokens: 10, turns: 1 })
    })
    await sessionStore.appendEvent('thr_seed', {
      kind: 'usage',
      seq: 5,
      timestamp: '2026-06-02T09:05:00.000Z',
      threadId: 'thr_seed',
      usage: usage({ promptTokens: 80, completionTokens: 20, cacheHitTokens: 72, cacheMissTokens: 8, turns: 3 })
    })

    await seedUsageCarryover({ threadStore, sessionStore, usageService })

    expect(usageService.forThread('thr_seed')).toMatchObject({
      promptTokens: 80,
      completionTokens: 20,
      totalTokens: 100,
      cacheHitTokens: 72,
      cacheMissTokens: 8,
      turns: 3
    })
    expect(usageService.cacheSnapshot('thr_seed')).toMatchObject({
      hits: 72,
      misses: 8,
      hitRate: 0.9
    })
  })
})

describe('runtime factory model routing', () => {
  it('normalizes local Model Router URLs and forces responses endpoint format', () => {
    expect(resolveModelRouterRuntimeEndpoint({
      ...runtimeOptions(),
      modelRouterBaseUrl: 'http://localhost:4892'
    })).toEqual({
      baseUrl: 'http://localhost:4892/v1'
    })
  })

  it('rejects direct provider URLs', () => {
    expect(() => resolveModelRouterRuntimeEndpoint({
      ...runtimeOptions(),
      modelRouterBaseUrl: 'https://api.deepseek.com/v1'
    })).toThrow(/local Model Router/)
  })
})

describe('local runtime serve startup ordering', () => {
  it('does not reconcile persisted running turns when the requested port is occupied', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-runtime-port-guard-'))
    const busyServer = await listenBusyServer('127.0.0.1')
    const address = busyServer.address()
    if (!address || typeof address === 'string') throw new Error('expected TCP address')
    const timestamp = '2026-06-28T00:00:00.000Z'
    const seededStore = new HybridThreadStore({
      dataDir,
      nowIso: () => timestamp
    })
    await seededStore.ready()
    const userItem = makeUserItem({
      id: 'item_turn_live_user',
      threadId: 'thr_live',
      turnId: 'turn_live',
      text: 'Keep working'
    })
    const liveTurn = startTurn(
      appendTurnItem(
        createTurnRecord({
          id: 'turn_live',
          threadId: 'thr_live',
          prompt: 'Keep working',
          createdAt: timestamp
        }),
        userItem
      ),
      timestamp
    )
    await seededStore.upsert({
      ...createThreadRecord({
        id: 'thr_live',
        title: 'Live work',
        workspace: '/tmp/project',
        model: 'sciforge-router',
        status: 'running',
        createdAt: timestamp
      }),
      turns: [liveTurn]
    })
    seededStore.close()

    try {
      await expect(startLocalRuntimeServe({
        ...runtimeOptions(),
        dataDir,
        port: address.port
      })).rejects.toMatchObject({ code: 'EADDRINUSE' })

      const verifyStore = new HybridThreadStore({
        dataDir,
        nowIso: () => timestamp
      })
      await verifyStore.ready()
      const persisted = await verifyStore.get('thr_live')
      verifyStore.close()
      expect(persisted?.status).toBe('running')
      expect(persisted?.turns[0]?.status).toBe('running')
      expect(persisted?.turns[0]?.error).toBeUndefined()
    } finally {
      await closeServer(busyServer)
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})

describe('runtime factory computer-use capability', () => {
  it('does not expose GUI-Owl computer use from sidecar env alone', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-runtime-cua-'))
    process.env.SCIFORGE_CUA_SERVICE_URL = 'http://127.0.0.1:3900'
    try {
      const runtime = await createLocalRuntimeServeRuntime({
        ...runtimeOptions(),
        dataDir
      })

      expect(runtime.info().capabilities.computerUse).toMatchObject({
        available: false
      })
      await runtime.shutdown?.()
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})

function runtimeOptions(): Parameters<typeof resolveModelRouterRuntimeEndpoint>[0] {
  return {
    host: '127.0.0.1',
    port: 8899,
    dataDir: '/tmp/kun',
    runtimeToken: '',
    apiKey: 'router-key',
    modelRouterBaseUrl: 'http://127.0.0.1:3892/v1',
    model: 'sciforge-router',
    approvalPolicy: 'auto',
    sandboxMode: 'danger-full-access',
    tokenEconomyMode: false,
    insecure: false
  }
}

async function listenBusyServer(host: string): Promise<Server> {
  const server = createServer((_request, response) => {
    response.end('busy')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  return server
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
