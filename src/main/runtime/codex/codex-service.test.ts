import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_MODEL_ROUTER_PROVIDER_ID,
  DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultSkillsSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../../shared/app-settings'
import { CodexRuntimeService, CODEX_SUBSCRIBER_QUEUE_MAX_EVENTS } from './codex-service'
import { CodexEventStore } from './codex-event-store'
import { CodexThreadStore } from './codex-thread-store'
import {
  CODEX_MAIN_IPC_CHANNELS,
  type CodexAppServerClientEvent,
  type CodexAppServerInitializeResponse,
  type CodexAppServerJsonRpcClient,
  type CodexAppServerJsonRpcClientOptions
} from '@sciforge/codex-runtime/app-server'
import type {
  CodexAppServerPendingRequest,
  CodexAppServerPendingRequestRegistryOptions
} from '@sciforge/codex-runtime/app-server'
import type { CodexThreadEventPayload } from './codex-runtime-api'
import { CodexPreToolUseGovernanceBridge } from './codex-pre-tool-use-governance'
import { createExecutionReceipt } from '@sciforge/execution-governance'
import { CAPABILITY_AGENT_TOOL_NAMES, createCapabilityAgentToolSurface } from '../../capabilities/agent-tools'
import { CapabilityBroker } from '../../capabilities/broker'
import { CapabilityRegistry, defineCapability } from '../../capabilities/registry'
import { z } from 'zod'
import { artifactVersionCommitInputV1Schema } from '../../../../packages/domains/artifact-versions/src/contract'
import type { AgentRuntimeToolSurface } from '../agent-runtime/agent-tool-surface'
import type { AgentRuntimeDiscoveryResult } from '../../../shared/agent-runtime-contract'
import { logWarn } from '../../logger'

vi.mock('../../logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../logger')>()),
  logWarn: vi.fn()
}))

const catalogFetch = vi.fn<typeof fetch>()
let testCodexHome: string

beforeEach(async () => {
  testCodexHome = await mkdtemp(join(tmpdir(), 'sciforge-codex-config-test-'))
  catalogFetch.mockReset().mockImplementation(async () => Response.json({
    models: [{ slug: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS, default_reasoning_level: null, supported_reasoning_levels: [] }]
  }))
  vi.stubGlobal('fetch', catalogFetch)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(testCodexHome, { recursive: true, force: true })
})

async function availableTestRuntime(): Promise<AgentRuntimeDiscoveryResult> {
  return {
    runtimeId: 'codex',
    available: true,
    executablePath: process.execPath,
    source: 'user-configured',
    version: 'test-transport',
    protocol: { id: 'app-server', supported: true }
  }
}

function configuredModelRouterSettings() {
  const modelRouter = defaultModelRouterSettings()
  modelRouter.runtimeApiKey = 'local-runtime-router-key'
  modelRouter.profiles.default.textReasoner = {
    baseUrl: 'https://text-provider.example/v1',
    apiKey: 'text-secret',
    model: 'text-model'
  }
  return modelRouter
}

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    activeAgentRuntime: 'codex',
    modelAccess: { mode: 'api', planAdapterId: '' },
    agents: {
      sciforge: defaultLocalRuntimeSettings(),
      codex: { ...defaultCodexRuntimeSettings(), codexHome: testCodexHome }
    },
    modelRouter: configuredModelRouterSettings(),
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: {
      openAtLogin: false,
      startMinimized: false,
      closeToTray: false
    },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    skills: defaultSkillsSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

const codexVisualRefs = {
  source: `res_${'s'.repeat(24)}`,
  snapshot: `snapshot_${'n'.repeat(24)}`,
  region: `region_${'r'.repeat(24)}`,
  proof: `visual_proof_${'p'.repeat(24)}`
} as const

function codexVisualLookOutput() {
  return {
    snapshotRef: codexVisualRefs.snapshot,
    regions: [
      {
        regionRef: codexVisualRefs.region,
        label: 'Method overview',
        confidence: 0.98
      }
    ],
    evidence: {
      summary: 'Located the requested figure.',
      claims: [
        {
          kind: 'observation',
          text: 'The figure is visible.',
          regionRef: codexVisualRefs.region,
          confidence: 0.98
        }
      ],
      uncertainties: []
    },
    proof: {
      schema: 'sciforge.visual-proof.v1',
      kind: 'look',
      status: 'verified',
      proofRef: codexVisualRefs.proof,
      sourceRef: codexVisualRefs.source,
      snapshotRef: codexVisualRefs.snapshot,
      provider: 'model-router',
      attestation: `sha256:${'d'.repeat(64)}`,
      createdAt: '2026-07-26T00:00:00.000Z'
    }
  }
}

function failingClient(): CodexAppServerJsonRpcClient {
  return {
    connect: vi.fn(async () => {
      throw new Error('app-server offline')
    }),
    listThreads: vi.fn(async () => {
      throw new Error('app-server offline')
    }),
    readThread: vi.fn(async () => {
      throw new Error('app-server offline')
    }),
    startThread: vi.fn(async () => {
      throw new Error('app-server offline')
    }),
    startTurn: vi.fn(async () => {
      throw new Error('app-server offline')
    }),
    renameThread: vi.fn(async () => {
      throw new Error('app-server offline')
    }),
    interruptTurn: vi.fn(async () => {
      throw new Error('app-server offline')
    }),
    steerTurn: vi.fn(async () => {
      throw new Error('app-server offline')
    }),
    request: vi.fn(async () => {
      throw new Error('app-server offline')
    }),
    subscribe: vi.fn(() => ({
      async *[Symbol.asyncIterator]() {
        /* empty */
      }
    })),
    stop: vi.fn(async () => undefined)
  } as unknown as CodexAppServerJsonRpcClient
}

function controllableClient(): CodexAppServerJsonRpcClient {
  return {
    connect: vi.fn(async () => ({})),
    listModels: vi.fn(async () => ({ data: [], nextCursor: null })),
    listThreads: vi.fn(async () => ({ threads: [] })),
    readThread: vi.fn(async () => ({ thread: { id: 'thread-1', turns: [] } })),
    startThread: vi.fn(async () => ({ thread: { id: 'thread-1' } })),
    startTurn: vi.fn(async () => ({ turn: { id: 'turn-1' } })),
    compactThread: vi.fn(async () => ({})),
    renameThread: vi.fn(async () => ({})),
    interruptTurn: vi.fn(async () => ({})),
    steerTurn: vi.fn(async () => ({})),
    request: vi.fn(async () => ({})),
    subscribe: vi.fn(() => ({
      async *[Symbol.asyncIterator]() {
        /* empty */
      }
    })),
    stop: vi.fn(async () => undefined)
  } as unknown as CodexAppServerJsonRpcClient
}

function clientWithQueuedEvents(): {
  client: CodexAppServerJsonRpcClient
  push: (event: CodexAppServerClientEvent) => void
  close: () => void
} {
  const events: CodexAppServerClientEvent[] = []
  let wake: (() => void) | null = null
  let closed = false
  const wakeReader = (): void => {
    const current = wake
    wake = null
    current?.()
  }
  async function* stream(): AsyncIterable<CodexAppServerClientEvent> {
    while (!closed || events.length > 0) {
      if (events.length > 0) {
        yield events.shift() as CodexAppServerClientEvent
        continue
      }
      await new Promise<void>((resolve) => {
        wake = resolve
      })
    }
  }
  const client = {
    ...controllableClient(),
    subscribe: vi.fn(() => stream())
  } as unknown as CodexAppServerJsonRpcClient
  return {
    client,
    push: (event) => {
      events.push(event)
      wakeReader()
    },
    close: () => {
      closed = true
      wakeReader()
    }
  }
}

function scheduleFirstActivityGuard(service: CodexRuntimeService, threadId = 'thread-1', turnId = 'turn-1'): void {
  const guarded = service as unknown as {
    scheduleFirstActivityTimeout(threadId: string, turnId: string): void
  }
  guarded.scheduleFirstActivityTimeout(threadId, turnId)
}

function modelDeltaDedupeProbe(service: CodexRuntimeService): {
  readonly states: Map<string, { identities: Set<string> }>
  recordActiveTurn(threadId: string, turnId: string): void
  dedupe(event: CodexThreadEventPayload): CodexThreadEventPayload | null
} {
  const probed = service as unknown as {
    modelDeltaDedupeByTurn: Map<string, { identities: Set<string> }>
    recordActiveTurn(threadId: string, turnId: string): void
    dedupeModelDeltas(event: CodexThreadEventPayload): CodexThreadEventPayload | null
  }
  return {
    states: probed.modelDeltaDedupeByTurn,
    recordActiveTurn: (threadId, turnId) => probed.recordActiveTurn(threadId, turnId),
    dedupe: (event) => probed.dedupeModelDeltas(event)
  }
}

function captureBroadcastEvents(): ReturnType<typeof vi.fn<(event: CodexThreadEventPayload) => void>> {
  const prototype = CodexRuntimeService.prototype as unknown as {
    broadcastEvent(event: CodexThreadEventPayload): void
  }
  if (!vi.isMockFunction(prototype.broadcastEvent)) {
    vi.spyOn(prototype, 'broadcastEvent')
  }
  const broadcast = vi.mocked(prototype.broadcastEvent)
  broadcast.mockClear()
  return broadcast
}

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'sciforge-codex-service-'))
}

type CodexThreadUpsert = Parameters<CodexThreadStore['upsert']>[0]

async function upsertMaterializedThread(store: CodexThreadStore, input: CodexThreadUpsert): Promise<void> {
  await store.upsert({ latestSeq: 1, ...input })
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('CodexRuntimeService model access selection', () => {
  it('reports missing model access as a setup problem before starting Codex', async () => {
    const createClient = vi.fn(() => controllableClient())
    const current = settings()
    delete (current as Partial<AppSettingsV1>).modelAccess
    const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime,
      settings: async () => current,
      createClient
    })

    await expect(service.connect()).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('Model access setup is required')
    })
    expect(createClient).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'API mode selects another runtime',
      settings: { activeAgentRuntime: 'claude' as const }
    },
    {
      name: 'coding-plan adapter does not match the selected runtime',
      settings: {
        activeAgentRuntime: 'claude' as const,
        modelAccess: { mode: 'coding-plan' as const, planAdapterId: 'codex' }
      }
    }
  ])('does not start Codex when $name', async ({ settings: selection }) => {
    const createClient = vi.fn(() => controllableClient())
    const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime,
      settings: async () => ({ ...settings(), ...selection }),
      createClient
    })

    await expect(service.connect()).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('selected Agent runtime')
    })
    expect(createClient).not.toHaveBeenCalled()
  })
})

describe('Codex child summary index', () => {
  it('scans stored child events once and applies later child events incrementally', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await upsertMaterializedThread(threadStore, {
      guiThreadId: 'parent-thread',
      codexThreadId: 'parent-thread',
      title: 'Parent'
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot
    })
    const child = {
      id: 'child-1',
      runtimeId: 'codex' as const,
      parentThreadId: 'parent-thread',
      kind: 'agent' as const,
      status: 'running' as const,
      updatedAt: '2026-08-09T00:00:00.000Z'
    }
    await service.publishSyntheticEvent({
      runtimeId: 'codex',
      threadId: 'parent-thread',
      kind: 'child_event',
      child
    })
    const eventStore = (service as unknown as { eventStore: CodexEventStore }).eventStore
    const readSpy = vi.spyOn(eventStore, 'readLatestChildren')

    await expect(service.listStoredThreadChildren('parent-thread')).resolves.toEqual([child])
    await expect(service.listStoredThreadChildren('parent-thread')).resolves.toEqual([child])
    expect(readSpy).toHaveBeenCalledTimes(1)

    await service.publishSyntheticEvent({
      runtimeId: 'codex',
      threadId: 'parent-thread',
      kind: 'child_event',
      child: {
        ...child,
        status: 'completed',
        summary: 'Done',
        updatedAt: '2026-08-09T00:00:01.000Z'
      }
    })
    await expect(service.listStoredThreadChildren('parent-thread')).resolves.toEqual([
      expect.objectContaining({
        id: 'child-1',
        status: 'completed',
        summary: 'Done'
      })
    ])
    await service.publishSyntheticEvent({
      runtimeId: 'codex',
      threadId: 'parent-thread',
      kind: 'child_event',
      child: {
        ...child,
        status: 'completed',
        metadata: { lifecycleOperation: 'delete' },
        updatedAt: '2026-08-09T00:00:02.000Z'
      }
    })
    await expect(service.listStoredThreadChildren('parent-thread')).resolves.toEqual([])
    expect(readSpy).toHaveBeenCalledTimes(1)
  })
})

describe('Codex native compaction persistence', () => {
  it('persists synthetic compaction events and exposes them in durable pages', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await upsertMaterializedThread(threadStore, {
      guiThreadId: 'thread-1',
      codexThreadId: 'codex-thread-1',
      workspace: '/tmp/workspace',
      title: 'Compaction'
    })
    const service = new CodexRuntimeService({ settings: async () => settings(), storageRoot })

    await expect(service.publishSyntheticEvent({
      kind: 'compaction_event',
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'compact-turn',
      itemId: 'compact-item',
      status: 'success',
      summary: 'Native context was compacted.'
    })).resolves.toMatchObject({
      threadId: 'thread-1',
      compaction: { status: 'success', summary: 'Native context was compacted.' }
    })

    await expect(service.readThreadPage('thread-1')).resolves.toMatchObject({
      ok: true,
      detail: {
        blocks: [expect.objectContaining({
          kind: 'compaction',
          summary: 'Native context was compacted.'
        })]
      }
    })
  })
})

describe('Codex persistent child receipt lifecycle', () => {
  it('does not publish a late child tool fact into an inactive or newer parent turn', async () => {
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot: await tempRoot()
    })
    const probe = service as unknown as {
      activeTurns: Map<string, string>
      publishCodexChildToolFactToParent(
        event: CodexThreadEventPayload,
        input: {
          parentThreadId: string
          parentTurnId: string
          childThreadId: string
          childTurnId: string
        }
      ): Promise<void>
    }
    const event: CodexThreadEventPayload = {
      threadId: 'child-thread',
      turnId: 'child-turn',
      tool: {
        itemId: 'child-tool-call',
        summary: 'Child tool call',
        status: 'success'
      }
    }
    const input = {
      parentThreadId: 'parent-thread',
      parentTurnId: 'parent-turn-old',
      childThreadId: 'child-thread',
      childTurnId: 'child-turn'
    }

    await expect(probe.publishCodexChildToolFactToParent(event, input)).resolves.toBeUndefined()

    probe.activeTurns.set(input.parentThreadId, 'parent-turn-new')
    await expect(probe.publishCodexChildToolFactToParent(event, input)).resolves.toBeUndefined()
  })

  it('still fails closed when the active parent turn has no Host proof ledger', async () => {
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot: await tempRoot()
    })
    const probe = service as unknown as {
      activeTurns: Map<string, string>
      publishCodexChildToolFactToParent(
        event: CodexThreadEventPayload,
        input: {
          parentThreadId: string
          parentTurnId: string
          childThreadId: string
          childTurnId: string
        }
      ): Promise<void>
    }
    const input = {
      parentThreadId: 'parent-thread',
      parentTurnId: 'parent-turn',
      childThreadId: 'child-thread',
      childTurnId: 'child-turn'
    }
    probe.activeTurns.set(input.parentThreadId, input.parentTurnId)

    await expect(
      probe.publishCodexChildToolFactToParent(
        {
          threadId: input.childThreadId,
          turnId: input.childTurnId,
          tool: {
            itemId: 'child-tool-call',
            summary: 'Child tool call',
            status: 'success'
          }
        },
        input
      )
    ).rejects.toThrow('cannot resolve the parent Host proof ledger')
  })
})

describe('CodexRuntimeService storage fallback', () => {
  it('lists stored Codex threads when app-server list is unavailable', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await upsertMaterializedThread(threadStore, {
      guiThreadId: 'codex-thread-1',
      codexThreadId: 'codex-thread-1',
      workspace: '/tmp/workspace',
      title: 'Stored Codex'
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => failingClient()
    })

    await expect(service.listThreads()).resolves.toEqual({
      ok: true,
      threads: [
        expect.objectContaining({
          id: 'codex-thread-1',
          title: 'Stored Codex',
          workspace: '/tmp/workspace'
        })
      ]
    })
  })

  it('includes archived stored Codex threads when requested', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await upsertMaterializedThread(threadStore, {
      guiThreadId: 'codex-active',
      codexThreadId: 'codex-active',
      workspace: '/tmp/workspace',
      title: 'Active Codex'
    })
    await upsertMaterializedThread(threadStore, {
      guiThreadId: 'codex-archived',
      codexThreadId: 'codex-archived',
      workspace: '/tmp/workspace',
      title: 'Archived Codex',
      archived: true
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => failingClient()
    })

    await expect(service.listThreads()).resolves.toEqual({
      ok: true,
      threads: [expect.objectContaining({ id: 'codex-active', archived: false })]
    })
    await expect(service.listThreads({ includeArchived: true })).resolves.toEqual({
      ok: true,
      threads: expect.arrayContaining([
        expect.objectContaining({ id: 'codex-active', archived: false }),
        expect.objectContaining({ id: 'codex-archived', archived: true })
      ])
    })
  })

  it('resolves one stored Codex thread by exact identity while search stays free text', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await upsertMaterializedThread(threadStore, {
      guiThreadId: '019eedab-0ef6-7941-8730-09271e5cd03f',
      codexThreadId: '019eedab-0ef6-7941-8730-09271e5cd03f',
      workspace: '/tmp/exact-workspace',
      title: 'Durable research session'
    })
    // A never-used session is not materialized and never appears in discovery.
    await threadStore.upsert({
      guiThreadId: 'codex-thread-empty',
      codexThreadId: 'codex-thread-empty',
      workspace: '/tmp/empty-workspace',
      title: 'Empty session'
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => failingClient()
    })

    await expect(service.listThreads({
      search: '019eedab-0ef6-7941-8730-09271e5cd03f'
    })).resolves.toEqual({ ok: true, threads: [] })
    await expect(service.listThreads({})).resolves.toEqual({
      ok: true,
      threads: [expect.objectContaining({ id: '019eedab-0ef6-7941-8730-09271e5cd03f' })]
    })
    await expect(service.listThreads({
      threadId: '019eedab-0ef6-7941-8730-09271e5cd03f'
    })).resolves.toEqual({
      ok: true,
      threads: [expect.objectContaining({
        id: '019eedab-0ef6-7941-8730-09271e5cd03f',
        workspace: '/tmp/exact-workspace'
      })]
    })
    await expect(service.listThreads({ threadId: 'codex-thread-empty' })).resolves.toEqual({
      ok: true,
      threads: [expect.objectContaining({ id: 'codex-thread-empty', workspace: '/tmp/empty-workspace' })]
    })
  })

  it('omits stored side and child Codex threads unless side threads are requested', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await upsertMaterializedThread(threadStore, {
      guiThreadId: 'codex-primary',
      codexThreadId: 'codex-primary',
      workspace: '/tmp/workspace',
      title: 'Primary Codex'
    })
    await upsertMaterializedThread(threadStore, {
      guiThreadId: 'codex-side',
      codexThreadId: 'codex-side',
      workspace: '/tmp/workspace',
      title: 'Side Codex',
      relation: 'side'
    })
    await upsertMaterializedThread(threadStore, {
      guiThreadId: 'codex-subagent',
      codexThreadId: 'codex-subagent',
      workspace: '/tmp/workspace',
      title: 'Reviewer',
      threadSource: 'subagent',
      parentThreadId: 'codex-primary',
      parentTurnId: 'turn-1'
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => failingClient()
    })

    await expect(service.listThreads({ includeArchived: true })).resolves.toEqual({
      ok: true,
      threads: [
        expect.objectContaining({
          id: 'codex-primary',
          title: 'Primary Codex'
        })
      ]
    })

    const withSide = await service.listThreads({
      includeArchived: true,
      includeSide: true
    })
    expect(withSide).toMatchObject({ ok: true })
    if (withSide.ok) {
      expect(withSide.threads.map((thread) => thread.id).sort()).toEqual([
        'codex-primary',
        'codex-side',
        'codex-subagent'
      ])
      expect(withSide.threads.find((thread) => thread.id === 'codex-subagent')).toMatchObject({
        relation: 'side',
        threadSource: 'subagent',
        parentThreadId: 'codex-primary',
        parentTurnId: 'turn-1'
      })
    }
  })

  it('omits empty placeholder Codex threads from stored lists', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await upsertMaterializedThread(threadStore, {
      guiThreadId: 'empty-codex-thread',
      codexThreadId: 'empty-codex-thread',
      workspace: '/tmp/workspace',
      title: 'Codex thread'
    })
    await upsertMaterializedThread(threadStore, {
      guiThreadId: 'real-codex-thread',
      codexThreadId: 'real-codex-thread',
      workspace: '/tmp/workspace',
      title: 'Real work'
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => failingClient()
    })

    await expect(service.listThreads({ includeArchived: true })).resolves.toEqual({
      ok: true,
      threads: [
        expect.objectContaining({
          id: 'real-codex-thread',
          title: 'Real work'
        })
      ]
    })
  })

  it('keeps an explicitly main empty placeholder Codex thread visible without a user message', async () => {
    const storageRoot = await tempRoot()
    const client = controllableClient()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    const started = await service.startThread({
      threadId: 'coordinator-session',
      relation: 'side',
      threadSource: 'domain-runtime',
      sidebarVisibility: 'main'
    })
    expect(started).toMatchObject({
      ok: true,
      thread: {
        id: 'coordinator-session',
        title: 'Codex thread',
        relation: 'side',
        threadSource: 'domain-runtime',
        sidebarVisibility: 'main',
        hasUserMessage: false
      }
    })
    await expect(service.listThreads({ includeArchived: true })).resolves.toMatchObject({
      ok: true,
      threads: [{
        id: 'coordinator-session',
        title: 'Codex thread',
        relation: 'side',
        threadSource: 'domain-runtime',
        sidebarVisibility: 'main',
        hasUserMessage: false
      }]
    })
  })

  it('bounds huge app-server thread previews before returning list summaries', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    const threadCount = 24
    await threadStore.upsertMany(
      Array.from({ length: threadCount }, (_, index) => ({
        guiThreadId: `codex-live-${index}`,
        codexThreadId: `codex-live-${index}`,
        workspace: '/tmp/workspace',
        title: `Live thread ${index}`,
        latestSeq: 1
      }))
    )
    const hugePreview = '🧪'.repeat(100_000)
    const client = controllableClient()
    vi.mocked(client.listThreads).mockResolvedValue({
      threads: Array.from({ length: threadCount }, (_, index) => ({
        id: `codex-live-${index}`,
        name: `Live thread ${index}`,
        updatedAt: 1780272000 + index,
        cwd: '/tmp/workspace',
        preview: hugePreview
      }))
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    const result = await service.listThreads({ includeArchived: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.threads).toHaveLength(threadCount)
    for (const thread of result.threads) {
      expect(Buffer.byteLength(thread.preview ?? '', 'utf8')).toBeLessThanOrEqual(4_096)
    }
    expect(Buffer.byteLength(JSON.stringify(result.threads), 'utf8')).toBeLessThan(120_000)
  })

  it('persists app-server thread updatedAt without replacing it with read time', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await upsertMaterializedThread(threadStore, {
      guiThreadId: 'codex-live-thread',
      codexThreadId: 'codex-live-thread',
      workspace: '/tmp/workspace',
      title: 'Live thread'
    })
    const client = controllableClient()
    vi.mocked(client.listThreads).mockResolvedValue({
      threads: [
        {
          id: 'codex-live-thread',
          name: 'Live thread',
          updatedAt: 1780272000,
          cwd: '/tmp/workspace'
        }
      ]
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.listThreads()).resolves.toMatchObject({
      ok: true,
      threads: [
        expect.objectContaining({
          id: 'codex-live-thread',
          updatedAt: '2026-06-01T00:00:00.000Z'
        })
      ]
    })
    await expect(new CodexThreadStore({ rootDir: storageRoot }).get('codex-live-thread')).resolves.toMatchObject({
      updatedAt: '2026-06-01T00:00:00.000Z'
    })
  })

  it('preserves durable latest turn metadata when a live thread summary omits turns', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await upsertMaterializedThread(threadStore, {
      guiThreadId: 'codex-live-thread',
      codexThreadId: 'codex-live-thread',
      workspace: '/tmp/workspace',
      title: 'Live thread',
      latestTurnId: 'turn-completed',
      latestTurnStatus: 'completed'
    })
    const client = controllableClient()
    vi.mocked(client.listThreads).mockResolvedValue({
      threads: [{
        id: 'codex-live-thread',
        name: 'Live thread',
        updatedAt: 1780272000,
        cwd: '/tmp/workspace',
        turns: []
      }]
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.listThreads()).resolves.toMatchObject({
      ok: true,
      threads: [expect.objectContaining({
        id: 'codex-live-thread',
        latestTurnId: 'turn-completed',
        latestTurnStatus: 'completed'
      })]
    })
    await expect(threadStore.get('codex-live-thread')).resolves.toMatchObject({
      latestTurnId: 'turn-completed',
      latestTurnStatus: 'completed'
    })
  })

  it('does not materialize unknown app-server threads from live lists', async () => {
    const storageRoot = await tempRoot()
    const client = controllableClient()
    vi.mocked(client.listThreads).mockResolvedValue({
      threads: [
        {
          id: 'codex-orphan-live-thread',
          name: 'Runtime-only thread',
          updatedAt: 1780272000,
          cwd: '/tmp/workspace'
        }
      ]
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.listThreads({ includeArchived: true })).resolves.toEqual({
      ok: true,
      threads: []
    })
    await expect(new CodexThreadStore({ rootDir: storageRoot }).get('codex-orphan-live-thread')).resolves.toBeNull()
  })

  it('omits live side and native child Codex threads unless side threads are requested', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await threadStore.upsertMany([
      {
        guiThreadId: 'codex-primary',
        codexThreadId: 'codex-primary',
        workspace: '/tmp/workspace',
        title: 'Primary Codex',
        latestSeq: 1
      },
      {
        guiThreadId: 'codex-side',
        codexThreadId: 'codex-side',
        workspace: '/tmp/workspace',
        title: 'Side Codex',
        latestSeq: 1
      },
      {
        guiThreadId: 'codex-subagent',
        codexThreadId: 'codex-subagent',
        workspace: '/tmp/workspace',
        title: 'Reviewer',
        latestSeq: 1
      },
      {
        guiThreadId: 'codex-workflow',
        codexThreadId: 'codex-workflow',
        workspace: '/tmp/workspace',
        title: 'Workflow',
        latestSeq: 1
      },
      {
        guiThreadId: 'codex-local-workflow',
        codexThreadId: 'codex-local-workflow',
        workspace: '/tmp/workspace',
        title: 'Local workflow',
        latestSeq: 1
      }
    ])
    const client = controllableClient()
    vi.mocked(client.listThreads).mockResolvedValue({
      threads: [
        {
          id: 'codex-primary',
          name: 'Primary Codex',
          updatedAt: 1780272000,
          cwd: '/tmp/workspace'
        },
        {
          id: 'codex-side',
          name: 'Side Codex',
          relation: 'side',
          updatedAt: 1780272001,
          cwd: '/tmp/workspace'
        },
        {
          id: 'codex-subagent',
          name: 'Reviewer',
          threadSource: 'subagent',
          parentThreadId: 'codex-primary',
          parentTurnId: 'turn-1',
          updatedAt: 1780272002,
          cwd: '/tmp/workspace'
        },
        {
          id: 'codex-workflow',
          name: 'Workflow',
          source: { type: 'workflow', parentThreadId: 'codex-primary' },
          updatedAt: 1780272003,
          cwd: '/tmp/workspace'
        },
        {
          id: 'codex-local-workflow',
          name: 'Local workflow',
          threadSource: 'local_workflow',
          updatedAt: 1780272004,
          cwd: '/tmp/workspace'
        }
      ]
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.listThreads({ includeArchived: true })).resolves.toEqual({
      ok: true,
      threads: [
        expect.objectContaining({
          id: 'codex-primary',
          title: 'Primary Codex'
        })
      ]
    })

    const withSide = await service.listThreads({
      includeArchived: true,
      includeSide: true
    })
    expect(withSide).toMatchObject({ ok: true })
    if (withSide.ok) {
      expect(withSide.threads.map((thread) => thread.id).sort()).toEqual([
        'codex-local-workflow',
        'codex-primary',
        'codex-side',
        'codex-subagent',
        'codex-workflow'
      ])
      expect(withSide.threads.find((thread) => thread.id === 'codex-side')).toMatchObject({
        relation: 'side'
      })
      expect(withSide.threads.find((thread) => thread.id === 'codex-subagent')).toMatchObject({
        relation: 'side',
        threadSource: 'subagent',
        parentThreadId: 'codex-primary',
        parentTurnId: 'turn-1'
      })
    }
  })

  it('does not derive app-server thread titles from preview text', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await upsertMaterializedThread(threadStore, {
      guiThreadId: 'codex-live-thread',
      codexThreadId: 'codex-live-thread',
      workspace: '/tmp/workspace',
      title: 'Codex thread'
    })
    const client = controllableClient()
    vi.mocked(client.listThreads).mockResolvedValue({
      threads: [
        {
          id: 'codex-live-thread',
          name: 'New chat',
          preview: 'Summarize AlphaFold benchmark results in a table.',
          updatedAt: 1780272000,
          cwd: '/tmp/workspace'
        }
      ]
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.listThreads()).resolves.toMatchObject({
      ok: true,
      threads: [
        expect.objectContaining({
          id: 'codex-live-thread',
          title: 'Codex thread',
          preview: 'Summarize AlphaFold benchmark results in a table.',
          titleSource: 'fallback'
        })
      ]
    })
    await expect(new CodexThreadStore({ rootDir: storageRoot }).get('codex-live-thread')).resolves.toMatchObject({
      title: 'Codex thread'
    })
  })

  it('keeps user-renamed stored titles when app-server only reports a fallback title', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await upsertMaterializedThread(threadStore, {
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-1',
      workspace: '/tmp/workspace',
      title: '靶点发现',
      titleSource: 'user'
    })
    const client = controllableClient()
    vi.mocked(client.listThreads).mockResolvedValue({
      threads: [
        {
          id: 'codex-thread-1',
          name: 'New chat',
          preview: '针对非小细胞肺癌等 EGFR 相关疾病，能否从文献证据中确定一个可成药、结构可用的靶点？',
          updatedAt: 1780272000,
          cwd: '/tmp/workspace'
        }
      ]
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.listThreads()).resolves.toMatchObject({
      ok: true,
      threads: [
        expect.objectContaining({
          id: 'gui-thread-1',
          codexThreadId: 'codex-thread-1',
          title: '靶点发现',
          preview: '针对非小细胞肺癌等 EGFR 相关疾病，能否从文献证据中确定一个可成药、结构可用的靶点？',
          titleSource: 'user'
        })
      ]
    })
    await expect(new CodexThreadStore({ rootDir: storageRoot }).get('gui-thread-1')).resolves.toMatchObject({
      title: '靶点发现',
      titleSource: 'user'
    })
  })

  it('hides Codex child threads from default thread lists unless side threads are requested', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await threadStore.upsertMany([
      {
        guiThreadId: 'codex-main-thread',
        codexThreadId: 'codex-main-thread',
        workspace: '/tmp/workspace',
        title: 'Main thread',
        latestSeq: 1
      },
      {
        guiThreadId: 'codex-child-thread',
        codexThreadId: 'codex-child-thread',
        workspace: '/tmp/workspace',
        title: 'Child worker',
        latestSeq: 1
      }
    ])
    const client = controllableClient()
    vi.mocked(client.listThreads).mockResolvedValue({
      threads: [
        {
          id: 'codex-main-thread',
          name: 'Main thread',
          updatedAt: 1780272000,
          cwd: '/tmp/workspace'
        },
        {
          id: 'codex-child-thread',
          name: 'Child worker',
          updatedAt: 1780272100,
          cwd: '/tmp/workspace',
          threadSource: 'subagent',
          parentThreadId: 'codex-main-thread'
        }
      ]
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.listThreads()).resolves.toMatchObject({
      ok: true,
      threads: [expect.objectContaining({ id: 'codex-main-thread' })]
    })
    await expect(service.listThreads({ includeSide: true })).resolves.toMatchObject({
      ok: true,
      threads: expect.arrayContaining([
        expect.objectContaining({ id: 'codex-main-thread' }),
        expect.objectContaining({
          id: 'codex-child-thread',
          relation: 'side',
          parentThreadId: 'codex-main-thread'
        })
      ])
    })
  })

  it('prioritizes structured sidebar visibility when filtering Codex thread lists', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await threadStore.upsertMany([
      {
        guiThreadId: 'codex-primary',
        codexThreadId: 'codex-primary',
        workspace: '/tmp/workspace',
        title: 'Primary thread',
        latestSeq: 1
      },
      {
        guiThreadId: 'codex-main-override',
        codexThreadId: 'codex-main-override',
        workspace: '/tmp/workspace',
        title: 'Main override',
        latestSeq: 1
      },
      {
        guiThreadId: 'codex-hidden-override',
        codexThreadId: 'codex-hidden-override',
        workspace: '/tmp/workspace',
        title: 'Hidden override',
        latestSeq: 1
      },
      {
        guiThreadId: 'codex-legacy-child',
        codexThreadId: 'codex-legacy-child',
        workspace: '/tmp/workspace',
        title: 'Legacy child',
        latestSeq: 1
      }
    ])
    const client = controllableClient()
    vi.mocked(client.listThreads).mockResolvedValue({
      threads: [
        {
          id: 'codex-primary',
          name: 'Primary thread',
          updatedAt: 1780272000,
          cwd: '/tmp/workspace'
        },
        {
          id: 'codex-main-override',
          name: 'Main override',
          relation: 'side',
          sidebarVisibility: 'visible',
          updatedAt: 1780272001,
          cwd: '/tmp/workspace'
        },
        {
          id: 'codex-hidden-override',
          name: 'Hidden override',
          relation: 'primary',
          sidebarVisibility: 'hide',
          updatedAt: 1780272002,
          cwd: '/tmp/workspace'
        },
        {
          id: 'codex-legacy-child',
          name: 'Legacy child',
          parentThreadId: 'codex-primary',
          updatedAt: 1780272003,
          cwd: '/tmp/workspace'
        }
      ]
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    const defaultList = await service.listThreads({ includeArchived: true })
    expect(defaultList).toMatchObject({ ok: true })
    if (defaultList.ok) {
      expect(defaultList.threads.map((thread) => thread.id).sort()).toEqual(['codex-main-override', 'codex-primary'])
      expect(defaultList.threads.find((thread) => thread.id === 'codex-main-override')).toMatchObject({
        relation: 'side',
        sidebarVisibility: 'main'
      })
    }

    const withSide = await service.listThreads({
      includeArchived: true,
      includeSide: true
    })
    expect(withSide).toMatchObject({ ok: true })
    if (withSide.ok) {
      expect(withSide.threads.map((thread) => thread.id).sort()).toEqual([
        'codex-hidden-override',
        'codex-legacy-child',
        'codex-main-override',
        'codex-primary'
      ])
      expect(withSide.threads.find((thread) => thread.id === 'codex-hidden-override')).toMatchObject({
        relation: 'primary',
        sidebarVisibility: 'hidden'
      })
      expect(withSide.threads.find((thread) => thread.id === 'codex-legacy-child')).toMatchObject({
        relation: 'side',
        parentThreadId: 'codex-primary'
      })
    }
  })

  it('bulk persists app-server thread lists without per-thread store upserts', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await threadStore.upsertMany([
      {
        guiThreadId: 'codex-active-1',
        codexThreadId: 'codex-active-1',
        workspace: '/tmp/workspace',
        title: 'Active Codex 1',
        latestSeq: 1
      },
      {
        guiThreadId: 'codex-active-2',
        codexThreadId: 'codex-active-2',
        workspace: '/tmp/workspace',
        title: 'Active Codex 2',
        latestSeq: 1
      },
      {
        guiThreadId: 'codex-archived-live',
        codexThreadId: 'codex-archived-live',
        workspace: '/tmp/workspace',
        title: 'Archived live Codex',
        archived: true,
        latestSeq: 1,
        updatedAt: '2026-06-01T00:00:00.000Z'
      }
    ])
    const client = controllableClient()
    vi.mocked(client.listThreads).mockResolvedValue({
      threads: [
        {
          id: 'codex-active-1',
          name: 'Active Codex 1',
          updatedAt: 1780358400,
          cwd: '/tmp/workspace'
        },
        {
          id: 'codex-active-2',
          name: 'Active Codex 2',
          updatedAt: 1780444800,
          cwd: '/tmp/workspace'
        },
        {
          id: 'codex-archived-live',
          name: 'Archived live Codex',
          updatedAt: 1780531200,
          cwd: '/tmp/workspace'
        }
      ]
    })
    const upsertSpy = vi.spyOn(CodexThreadStore.prototype, 'upsert')
    const upsertManySpy = vi.spyOn(CodexThreadStore.prototype, 'upsertMany')
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    try {
      await expect(service.listThreads()).resolves.toEqual({
        ok: true,
        threads: [
          expect.objectContaining({
            id: 'codex-active-2',
            title: 'Active Codex 2',
            archived: false
          }),
          expect.objectContaining({
            id: 'codex-active-1',
            title: 'Active Codex 1',
            archived: false
          })
        ]
      })
      expect(upsertManySpy).toHaveBeenCalledTimes(1)
      expect(upsertManySpy.mock.calls[0]?.[0]).toEqual([
        expect.objectContaining({
          codexThreadId: 'codex-active-1',
          preserveArchived: true,
          updatedAt: '2026-06-02T00:00:00.000Z'
        }),
        expect.objectContaining({
          codexThreadId: 'codex-active-2',
          preserveArchived: true,
          updatedAt: '2026-06-03T00:00:00.000Z'
        })
      ])
      expect(upsertSpy).not.toHaveBeenCalled()
    } finally {
      upsertSpy.mockRestore()
      upsertManySpy.mockRestore()
    }

    const raw = JSON.parse(await readFile(join(storageRoot, 'threads.json'), 'utf8')) as {
      threads: Array<{ codexThreadId: string; archived: boolean }>
    }
    expect(raw.threads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          codexThreadId: 'codex-active-1',
          archived: false
        }),
        expect.objectContaining({
          codexThreadId: 'codex-active-2',
          archived: false
        }),
        expect.objectContaining({
          codexThreadId: 'codex-archived-live',
          archived: true
        })
      ])
    )
  })

  it('replays stored normalized events as chat blocks when app-server read is unavailable', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    const eventStore = new CodexEventStore({ rootDir: storageRoot })
    await upsertMaterializedThread(threadStore, {
      guiThreadId: 'codex-thread-1',
      codexThreadId: 'codex-thread-1',
      workspace: '/tmp/workspace',
      title: 'Stored Codex'
    })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      userMessage: {
        itemId: 'user-1',
        text: 'hello'
      }
    })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      deltas: [{ kind: 'agent_message', text: 'hi there' }]
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => failingClient()
    })

    await expect(service.readThreadPage('codex-thread-1')).resolves.toMatchObject({
      ok: true,
      detail: expect.objectContaining({
        latestSeq: 2,
        blocks: [
          expect.objectContaining({
            kind: 'user',
            id: 'user-1',
            text: 'hello'
          }),
          expect.objectContaining({ kind: 'assistant', text: 'hi there' })
        ]
      })
    })
  })

  it('does not request an app-server full transcript for paginated history', async () => {
    const client = controllableClient()
    vi.mocked(client.readThread).mockResolvedValue({
      thread: {
        id: 'codex-thread-1',
        latestTurnId: 'turn-latest',
        turns: [
          {
            id: 'turn-latest',
            status: 'completed',
            items: [
              {
                id: 'assistant-latest',
                type: 'agentMessage',
                text: 'done'
              }
            ]
          },
          {
            id: 'turn-stale',
            status: 'running',
            items: [
              {
                id: 'tool-stale',
                type: 'commandExecution',
                status: 'running',
                command: 'old command'
              }
            ]
          }
        ]
      }
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.readThreadPage('codex-thread-1')).resolves.toMatchObject({
      ok: true,
      detail: { blocks: [], latestSeq: 0 }
    })
    expect(client.readThread).not.toHaveBeenCalled()
  })

  it('does not serialize app-server tool snapshots into paginated history replies', async () => {
    const client = controllableClient()
    vi.mocked(client.readThread).mockResolvedValue({
      thread: {
        id: 'codex-thread-1',
        latestTurnId: 'turn-1',
        turns: [
          {
            id: 'turn-1',
            status: 'completed',
            items: [
              {
                id: 'cmd-1',
                type: 'commandExecution',
                status: 'running',
                command: 'npm test',
                cwd: '/tmp/workspace'
              },
              {
                id: 'cmd-1',
                type: 'commandExecution',
                status: 'completed',
                command: 'npm test',
                cwd: '/tmp/workspace',
                aggregatedOutput: 'ok',
                exitCode: 0
              }
            ]
          }
        ]
      }
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.readThreadPage('codex-thread-1')).resolves.toMatchObject({
      ok: true,
      detail: { blocks: [], latestSeq: 0 }
    })
    expect(client.readThread).not.toHaveBeenCalled()
  })

  it('deduplicates stored assistant snapshots within the same turn', async () => {
    const storageRoot = await tempRoot()
    const eventStore = new CodexEventStore({ rootDir: storageRoot })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      turnId: 'turn-1',
      userMessage: {
        itemId: 'user-1',
        turnId: 'turn-1',
        text: 'hello'
      }
    })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      turnId: 'turn-1',
      deltas: [{ kind: 'agent_message', text: 'hi', snapshot: true }]
    })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      turnId: 'turn-1',
      deltas: [{ kind: 'agent_message', text: ' hi ', snapshot: true }]
    })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      turnId: 'turn-2',
      userMessage: {
        itemId: 'user-2',
        turnId: 'turn-2',
        text: 'again'
      }
    })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      turnId: 'turn-2',
      deltas: [{ kind: 'agent_message', text: 'hi', snapshot: true }]
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => failingClient()
    })

    await expect(service.readThreadPage('codex-thread-1')).resolves.toMatchObject({
      ok: true,
      detail: expect.objectContaining({
        latestSeq: 5,
        blocks: [
          expect.objectContaining({
            kind: 'user',
            id: 'user-1',
            turnId: 'turn-1',
            text: 'hello'
          }),
          expect.objectContaining({
            kind: 'assistant',
            turnId: 'turn-1',
            text: 'hi'
          }),
          expect.objectContaining({
            kind: 'user',
            id: 'user-2',
            turnId: 'turn-2',
            text: 'again'
          }),
          expect.objectContaining({
            kind: 'assistant',
            turnId: 'turn-2',
            text: 'hi'
          })
        ]
      })
    })
  })

  it('projects streamed assistant deltas as one message and lets the final snapshot replace them', async () => {
    const storageRoot = await tempRoot()
    const eventStore = new CodexEventStore({ rootDir: storageRoot })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      turnId: 'turn-1',
      userMessage: {
        itemId: 'user-1',
        turnId: 'turn-1',
        text: 'hello'
      }
    })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      turnId: 'turn-1',
      deltas: [{ kind: 'agent_message', text: 'Hello' }]
    })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      turnId: 'turn-1',
      deltas: [{ kind: 'agent_message', text: '. How' }]
    })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      turnId: 'turn-1',
      deltas: [{ kind: 'agent_message', text: ' can I help?' }]
    })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      turnId: 'turn-1',
      deltas: [
        {
          kind: 'agent_message',
          text: 'Hello. How can I help?',
          snapshot: true
        }
      ]
    })

    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => failingClient()
    })

    await expect(service.readThreadPage('codex-thread-1')).resolves.toMatchObject({
      ok: true,
      detail: expect.objectContaining({
        blocks: [
          expect.objectContaining({
            kind: 'user',
            id: 'user-1',
            text: 'hello'
          }),
          expect.objectContaining({
            kind: 'assistant',
            text: 'Hello. How can I help?',
            snapshot: true
          })
        ]
      })
    })
  })

  it('keeps distinct assistant snapshot messages in the same turn instead of overwriting the previous one', async () => {
    const storageRoot = await tempRoot()
    const eventStore = new CodexEventStore({ rootDir: storageRoot })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      turnId: 'turn-1',
      userMessage: {
        itemId: 'user-1',
        turnId: 'turn-1',
        text: 'hello'
      }
    })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      turnId: 'turn-1',
      deltas: [{ kind: 'agent_message', text: 'The actual answer.', snapshot: true }]
    })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      turnId: 'turn-1',
      deltas: [{ kind: 'agent_message', text: '⚠️ 已清理 1 张超限图片：tool result image x (0.3MB)', snapshot: true }]
    })

    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => failingClient()
    })

    await expect(service.readThreadPage('codex-thread-1')).resolves.toMatchObject({
      ok: true,
      detail: expect.objectContaining({
        blocks: [
          expect.objectContaining({ kind: 'user', id: 'user-1', text: 'hello' }),
          expect.objectContaining({
            kind: 'assistant',
            turnId: 'turn-1',
            text: 'The actual answer.',
            snapshot: true
          }),
          expect.objectContaining({
            kind: 'assistant',
            turnId: 'turn-1',
            text: '⚠️ 已清理 1 张超限图片：tool result image x (0.3MB)',
            snapshot: true
          })
        ]
      })
    })
  })

  it('deduplicates stored transient reconnect errors that reused the turn id', async () => {
    const storageRoot = await tempRoot()
    const eventStore = new CodexEventStore({ rootDir: storageRoot })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      turnId: 'turn-1',
      userMessage: {
        itemId: 'user-1',
        turnId: 'turn-1',
        text: 'hello'
      }
    })
    for (const attempt of [1, 2, 3]) {
      await eventStore.append('codex-thread-1', {
        threadId: 'codex-thread-1',
        turnId: 'turn-1',
        runtimeError: {
          itemId: 'turn-1',
          message: `Reconnecting... ${attempt}/5`,
          severity: 'error'
        }
      })
    }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => failingClient()
    })

    await expect(service.readThreadPage('codex-thread-1')).resolves.toMatchObject({
      ok: true,
      detail: expect.objectContaining({
        latestSeq: 4,
        blocks: [
          expect.objectContaining({
            kind: 'user',
            id: 'user-1',
            turnId: 'turn-1',
            text: 'hello'
          }),
          expect.objectContaining({
            kind: 'system',
            id: 'codex-runtime-status-turn-1-reconnecting',
            turnId: 'turn-1',
            text: 'Reconnecting... 3/5',
            severity: 'warning'
          })
        ]
      })
    })
  })

  it('does not scan and rewrite stored history during a page read', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-06-30T10:00:00.000Z'))
      const storageRoot = await tempRoot()
      const eventStore = new CodexEventStore({ rootDir: storageRoot })
      await eventStore.append('codex-thread-1', {
        threadId: 'codex-thread-1',
        turnId: 'turn-1',
        userMessage: {
          itemId: 'user-1',
          turnId: 'turn-1',
          text: 'hello'
        }
      })
      const service = new CodexRuntimeService({
        settings: async () => settings(),
        storageRoot,
        probeRuntime: availableTestRuntime,
        createClient: () => failingClient()
      })
      vi.setSystemTime(new Date('2026-06-30T10:02:00.000Z'))

      await expect(service.readThreadPage('codex-thread-1')).resolves.toMatchObject({
        ok: true,
        detail: expect.objectContaining({
          latestSeq: 1,
          latestTurnId: 'turn-1',
          threadStatus: 'running',
          blocks: [
            expect.objectContaining({
              kind: 'user',
              id: 'user-1',
              turnId: 'turn-1',
              text: 'hello'
            })
          ]
        })
      })
      await expect(eventStore.read('codex-thread-1', { includeAll: true })).resolves.toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not merge an app-server full transcript into a stored page', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-06-30T10:00:00.000Z'))
      const storageRoot = await tempRoot()
      const eventStore = new CodexEventStore({ rootDir: storageRoot })
      await eventStore.append('codex-thread-1', {
        threadId: 'codex-thread-1',
        turnId: 'turn-1',
        userMessage: {
          itemId: 'user-1',
          turnId: 'turn-1',
          text: 'hello'
        }
      })
      const client = controllableClient()
      vi.mocked(client.readThread).mockResolvedValue({
        thread: {
          id: 'codex-thread-1',
          turns: [
            {
              id: 'turn-1',
              status: 'running',
              items: [
                {
                  id: 'user-1',
                  type: 'userMessage',
                  content: [{ type: 'text', text: 'hello' }]
                }
              ]
            }
          ]
        }
      })
      const service = new CodexRuntimeService({
        settings: async () => settings(),
        storageRoot,
        probeRuntime: availableTestRuntime,
        createClient: () => client
      })
      vi.setSystemTime(new Date('2026-06-30T10:02:00.000Z'))

      await expect(service.readThreadPage('codex-thread-1')).resolves.toMatchObject({
        ok: true,
        detail: expect.objectContaining({
          latestSeq: 1,
          latestTurnId: 'turn-1',
          threadStatus: 'running',
          blocks: [
            expect.objectContaining({
              kind: 'user',
              id: 'user-1',
              turnId: 'turn-1',
              text: 'hello'
            })
          ]
        })
      })
      expect(client.readThread).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not repair fresh user-only turns while they may still produce output', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-06-30T10:00:00.000Z'))
      const storageRoot = await tempRoot()
      const eventStore = new CodexEventStore({ rootDir: storageRoot })
      await eventStore.append('codex-thread-1', {
        threadId: 'codex-thread-1',
        turnId: 'turn-1',
        userMessage: {
          itemId: 'user-1',
          turnId: 'turn-1',
          text: 'hello'
        }
      })
      const client = controllableClient()
      vi.mocked(client.readThread).mockResolvedValue({
        thread: {
          id: 'codex-thread-1',
          turns: [
            {
              id: 'turn-1',
              status: 'running',
              items: [
                {
                  id: 'user-1',
                  type: 'userMessage',
                  content: [{ type: 'text', text: 'hello' }]
                }
              ]
            }
          ]
        }
      })
      const service = new CodexRuntimeService({
        settings: async () => settings(),
        storageRoot,
        probeRuntime: availableTestRuntime,
        createClient: () => client
      })
      vi.setSystemTime(new Date('2026-06-30T10:00:10.000Z'))

      await expect(service.readThreadPage('codex-thread-1')).resolves.toMatchObject({
        ok: true,
        detail: expect.objectContaining({
          latestSeq: 1,
          latestTurnId: 'turn-1',
          threadStatus: 'running',
          blocks: [
            expect.objectContaining({
              kind: 'user',
              id: 'user-1',
              text: 'hello'
            })
          ]
        })
      })
      await expect(eventStore.read('codex-thread-1', { includeAll: true })).resolves.toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('prefers stored terminal turn state when app-server live read still reports running', async () => {
    const storageRoot = await tempRoot()
    const eventStore = new CodexEventStore({ rootDir: storageRoot })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      turnId: 'turn-1',
      userMessage: {
        itemId: 'user-1',
        turnId: 'turn-1',
        text: 'hello'
      }
    })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      turnId: 'turn-1',
      turnComplete: true
    })
    const client = controllableClient()
    vi.mocked(client.readThread).mockResolvedValue({
      thread: {
        id: 'codex-thread-1',
        turns: [
          {
            id: 'turn-1',
            status: 'running',
            items: [
              {
                id: 'user-1',
                type: 'userMessage',
                content: [{ type: 'text', text: 'hello' }]
              }
            ]
          }
        ]
      }
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.readThreadPage('codex-thread-1')).resolves.toMatchObject({
      ok: true,
      detail: expect.objectContaining({
        latestSeq: 2,
        latestTurnId: 'turn-1',
        threadStatus: 'completed',
        blocks: [
          expect.objectContaining({
            kind: 'user',
            id: 'user-1',
            turnId: 'turn-1',
            text: 'hello'
          })
        ]
      })
    })
  })

  it('prefers stored visible events when app-server live detail is behind', async () => {
    const storageRoot = await tempRoot()
    const eventStore = new CodexEventStore({ rootDir: storageRoot })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      turnId: 'turn-1',
      userMessage: {
        itemId: 'user-1',
        turnId: 'turn-1',
        text: 'hello'
      }
    })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      turnId: 'turn-1',
      tool: {
        itemId: 'tool-1',
        summary: 'Run command',
        status: 'success',
        toolKind: 'command_execution',
        detail: 'done'
      }
    })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      turnId: 'turn-1',
      deltas: [{ kind: 'agent_message', text: 'hi there' }]
    })
    const client = controllableClient()
    vi.mocked(client.readThread).mockResolvedValue({
      thread: {
        id: 'codex-thread-1',
        status: 'running',
        turns: [
          {
            id: 'turn-1',
            status: 'running',
            items: [
              {
                id: 'user-1',
                type: 'userMessage',
                content: [{ type: 'text', text: 'hello' }]
              }
            ]
          }
        ]
      }
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.readThreadPage('codex-thread-1')).resolves.toMatchObject({
      ok: true,
      detail: expect.objectContaining({
        latestSeq: 3,
        latestTurnId: 'turn-1',
        blocks: [
          expect.objectContaining({
            kind: 'user',
            id: 'user-1',
            turnId: 'turn-1',
            text: 'hello'
          }),
          expect.objectContaining({
            kind: 'tool',
            id: 'tool-1',
            turnId: 'turn-1',
            detail: 'done'
          }),
          expect.objectContaining({
            kind: 'assistant',
            turnId: 'turn-1',
            text: 'hi there'
          })
        ]
      })
    })
  })

  it('returns an empty stored detail for an unmaterialized Codex thread', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await threadStore.upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-1',
      workspace: '/tmp/workspace',
      title: 'Draft Codex thread'
    })
    const client = controllableClient()
    vi.mocked(client.readThread).mockRejectedValue(
      new Error('thread codex-thread-1 is not materialized yet; includeTurns is unavailable before first user message')
    )
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.readThreadPage('gui-thread-1')).resolves.toMatchObject({
      ok: true,
      detail: { blocks: [], latestSeq: 0 }
    })
    expect(client.readThread).not.toHaveBeenCalled()
  })

  it('returns empty detail for empty stored threads when the app-server client is stopped', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await threadStore.upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-1',
      workspace: '/tmp/workspace',
      title: 'Codex thread'
    })
    const client = controllableClient()
    vi.mocked(client.readThread).mockRejectedValue(new Error('Codex app-server client stopped.'))
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.readThreadPage('gui-thread-1')).resolves.toMatchObject({
      ok: true,
      detail: { blocks: [], latestSeq: 0 }
    })
  })

  it('keeps the app-server client alive when readThread falls back during an active turn', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await threadStore.upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-1',
      workspace: '/tmp/workspace',
      title: 'Active Codex'
    })
    const client = controllableClient()
    vi.mocked(client.startTurn).mockResolvedValue({
      turn: { id: 'turn-1', userMessageItemId: 'user-1' }
    })
    vi.mocked(client.readThread).mockRejectedValue(
      new Error('thread codex-thread-1 is not materialized yet; includeTurns is unavailable while the turn is starting')
    )
    const abortTurn = vi.fn(() => 1)
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      capabilityAgentTools: {
        tools: () => [],
        call: vi.fn(async () => ({ tool: 'unused', value: null })),
        abortTurn
      },
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(
      service.startTurn({
        threadId: 'gui-thread-1',
        text: 'hello from IM'
      })
    ).resolves.toMatchObject({
      ok: true,
      threadId: 'gui-thread-1',
      turnId: 'turn-1'
    })
    await expect(service.readThreadPage('gui-thread-1')).resolves.toMatchObject({
      ok: true,
      detail: expect.objectContaining({
        latestSeq: expect.any(Number),
        latestTurnId: 'turn-1',
        blocks: expect.arrayContaining([
          expect.objectContaining({
            kind: 'user',
            id: 'user-1',
            text: 'hello from IM'
          })
        ])
      })
    })
    expect(client.stop).not.toHaveBeenCalled()

    await expect(service.interruptTurn('gui-thread-1', 'turn-1')).resolves.toMatchObject({ ok: true })
    expect(client.interruptTurn).toHaveBeenCalledWith({
      threadId: 'codex-thread-1',
      turnId: 'turn-1'
    })
    expect(abortTurn).toHaveBeenCalledWith(
      {
        runtimeId: 'codex',
        threadId: 'gui-thread-1',
        turnId: 'turn-1'
      },
      'user_stop'
    )
  })

  it('replays stored normalized events without starting app-server JSON-RPC', async () => {
    const storageRoot = await tempRoot()
    const eventStore = new CodexEventStore({ rootDir: storageRoot })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      deltas: [{ kind: 'agent_message', text: 'one' }]
    })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      turnComplete: true
    })
    const createClient = vi.fn(() => failingClient())
    const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime,
      settings: async () => settings(),
      storageRoot,
      createClient
    })

    await expect(service.readStoredEvents('codex-thread-1', 1)).resolves.toEqual([
      expect.objectContaining({
        threadId: 'codex-thread-1',
        seq: 2,
        turnComplete: true,
        createdAt: expect.any(String)
      })
    ])
    expect(createClient).not.toHaveBeenCalled()
  })
})

describe('CodexRuntimeService compatibility operations', () => {
  it('shares in-flight app-server client creation across concurrent connects', async () => {
    const settingsGate = deferred<AppSettingsV1>()
    const firstClient = controllableClient()
    const secondClient = controllableClient()
    const createClient = vi.fn().mockReturnValueOnce(firstClient).mockReturnValueOnce(secondClient)
    const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime,
      settings: () => settingsGate.promise,
      createClient
    })

    const firstConnect = service.connect()
    const secondConnect = service.connect()
    await Promise.resolve()
    expect(createClient).not.toHaveBeenCalled()

    settingsGate.resolve(settings())

    await expect(Promise.all([firstConnect, secondConnect])).resolves.toEqual([
      { ok: true, info: {} },
      { ok: true, info: {} }
    ])
    expect(createClient).toHaveBeenCalledTimes(1)
    expect(firstClient.subscribe).toHaveBeenCalledTimes(1)
    expect(secondClient.subscribe).not.toHaveBeenCalled()
  })

  it('shares the complete app-server readiness handshake across concurrent connects', async () => {
    const initialize = deferred<CodexAppServerInitializeResponse>()
    const client = controllableClient()
    vi.mocked(client.connect).mockImplementation(() => initialize.promise)
    const createClient = vi.fn(() => client)
    const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime,
      settings: async () => settings(),
      createClient
    })

    const firstConnect = service.connect()
    const secondConnect = service.connect()
    await vi.waitFor(() => {
      expect(client.connect).toHaveBeenCalledOnce()
    })
    expect(createClient).toHaveBeenCalledOnce()

    const initializeInfo: CodexAppServerInitializeResponse = {
      userAgent: 'Codex Desktop/0.141.0 (test)',
      codexHome: '/tmp/codex-home',
      platformFamily: 'unix',
      platformOs: 'macos'
    }
    initialize.resolve(initializeInfo)
    await expect(Promise.all([firstConnect, secondConnect])).resolves.toEqual([
      { ok: true, info: initializeInfo },
      { ok: true, info: initializeInfo }
    ])
    expect(client.connect).toHaveBeenCalledOnce()
    expect(client.subscribe).toHaveBeenCalledOnce()
  })

  it('finishes failed readiness cleanup before creating a retry client', async () => {
    const initialize = deferred<CodexAppServerInitializeResponse>()
    const stopped = deferred<void>()
    const firstClient = controllableClient()
    vi.mocked(firstClient.connect).mockImplementation(() => initialize.promise)
    vi.mocked(firstClient.stop).mockImplementation(() => stopped.promise)
    const secondClient = controllableClient()
    const createClient = vi.fn().mockReturnValueOnce(firstClient).mockReturnValueOnce(secondClient)
    const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime,
      settings: async () => settings(),
      createClient
    })

    const failedConnect = service.connect()
    await vi.waitFor(() => {
      expect(firstClient.connect).toHaveBeenCalledOnce()
    })
    initialize.reject(new Error('initialize failed'))
    await vi.waitFor(() => {
      expect(firstClient.stop).toHaveBeenCalledOnce()
    })

    const retryConnect = service.connect()
    await Promise.resolve()
    expect(createClient).toHaveBeenCalledOnce()

    stopped.resolve()
    await expect(failedConnect).resolves.toMatchObject({
      ok: false,
      message: 'initialize failed'
    })
    await expect(retryConnect).resolves.toEqual({ ok: true, info: {} })
    expect(createClient).toHaveBeenCalledTimes(2)
    expect(secondClient.stop).not.toHaveBeenCalled()
  })

  it('returns recoverable failures when app-server requests fail', async () => {
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => failingClient()
    })

    await expect(service.connect()).resolves.toEqual({
      ok: false,
      code: 'runtime_start_failed',
      message: 'app-server offline',
      recoverable: true
    })
  })

  it('classifies authentication failures separately from runtime startup failures', async () => {
    const client = failingClient()
    vi.mocked(client.connect).mockRejectedValue(new Error('401 Unauthorized: sign in required'))
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.connect()).resolves.toMatchObject({
      ok: false,
      code: 'runtime_authentication_failed',
      recoverable: true
    })
  })

  it('recreates the app-server client after a recoverable failure', async () => {
    const firstClient = failingClient()
    const secondClient = controllableClient()
    const createClient = vi.fn().mockReturnValueOnce(firstClient).mockReturnValueOnce(secondClient)
    const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime,
      settings: async () => settings(),
      createClient
    })

    await expect(service.connect()).resolves.toEqual({
      ok: false,
      code: 'runtime_start_failed',
      message: 'app-server offline',
      recoverable: true
    })
    await expect(service.connect()).resolves.toEqual({ ok: true, info: {} })

    expect(createClient).toHaveBeenCalledTimes(2)
    expect(firstClient.stop).toHaveBeenCalled()
  })

  it('recreates the app-server client after the event stream closes asynchronously', async () => {
    const first = clientWithQueuedEvents()
    const secondClient = controllableClient()
    const createClient = vi.fn().mockReturnValueOnce(first.client).mockReturnValueOnce(secondClient)
    const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime,
      settings: async () => settings(),
      createClient
    })

    await expect(service.connect()).resolves.toEqual({ ok: true, info: {} })
    first.push({
      type: 'closed',
      channel: CODEX_MAIN_IPC_CHANNELS.closed,
      reason: 'error'
    })
    first.close()
    await vi.waitFor(() => {
      expect(first.client.stop).toHaveBeenCalled()
    })

    await expect(service.connect()).resolves.toEqual({ ok: true, info: {} })
    expect(createClient).toHaveBeenCalledTimes(2)
    expect(secondClient.connect).toHaveBeenCalled()
  })

  it('marks active turns failed when the app-server event stream closes', async () => {
    const queued = clientWithQueuedEvents()
    const broadcast = captureBroadcastEvents()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => queued.client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    broadcast.mockClear()

    queued.push({
      type: 'closed',
      channel: CODEX_MAIN_IPC_CHANNELS.closed,
      reason: 'error'
    })

    await vi.waitFor(() => {
      expect(broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: 'thread-1',
          turnId: 'turn-1',
          runtimeError: expect.objectContaining({
            code: 'runtime_disconnected',
            severity: 'error'
          })
        })
      )
    })
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        turnId: 'turn-1',
        runtimeStatus: expect.objectContaining({ phase: 'turn_done' })
      })
    )
    await expect(service.interruptTurn('thread-1', 'turn-1')).resolves.toMatchObject({
      ok: false,
      code: 'turn_not_running'
    })
    queued.close()
  })

  it('persists terminal errors for active turns before stopping the runtime', async () => {
    const storageRoot = await tempRoot()
    const eventStore = new CodexEventStore({ rootDir: storageRoot })
    const client = controllableClient()
    const broadcast = captureBroadcastEvents()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    broadcast.mockClear()

    await service.stop()

    await expect(eventStore.read('thread-1', { includeAll: true })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({
            runtimeError: expect.objectContaining({
              code: 'runtime_stopped',
              severity: 'error'
            })
          })
        }),
        expect.objectContaining({
          event: expect.objectContaining({
            runtimeStatus: expect.objectContaining({ phase: 'turn_done' })
          })
        })
      ])
    )
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        turnId: 'turn-1',
        runtimeError: expect.objectContaining({ code: 'runtime_stopped' })
      })
    )
  })

  it('keeps active stored turns running when readThread sees a stopped client', async () => {
    const storageRoot = await tempRoot()
    const eventStore = new CodexEventStore({ rootDir: storageRoot })
    const client = controllableClient()
    vi.mocked(client.readThread).mockRejectedValue(new Error('Codex app-server client stopped.'))
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })

    await expect(service.readThreadPage('thread-1')).resolves.toMatchObject({
      ok: true,
      detail: expect.objectContaining({
        latestTurnId: 'turn-1',
        blocks: expect.arrayContaining([
          expect.objectContaining({
            kind: 'user',
            id: expect.stringMatching(/^codex-user-/),
            text: 'hello'
          })
        ])
      })
    })
    const events = await eventStore.read('thread-1', { includeAll: true })
    expect(events.some((item) => item.event.runtimeError?.code === 'runtime_disconnected')).toBe(false)
    expect(client.stop).not.toHaveBeenCalled()
  })

  it('keeps active turns alive when sidebar list refresh fails', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await threadStore.upsert({
      guiThreadId: 'thread-1',
      codexThreadId: 'thread-1',
      workspace: '/tmp/workspace',
      title: 'Active Codex'
    })
    const client = controllableClient()
    vi.mocked(client.listThreads).mockRejectedValue(new Error('Codex app-server client stopped.'))
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })

    await expect(service.listThreads({ includeArchived: true })).resolves.toMatchObject({
      ok: true,
      threads: [expect.objectContaining({ id: 'thread-1', title: 'Active Codex' })]
    })
    expect(client.stop).not.toHaveBeenCalled()
  })

  it('archives local Codex thread state when app-server cannot find the rollout', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await threadStore.upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-missing',
      workspace: '/tmp/workspace',
      title: 'Stale Codex'
    })
    const client = controllableClient()
    vi.mocked(client.request).mockRejectedValueOnce(new Error('no rollout found for thread id codex-thread-missing'))
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.archiveThread('gui-thread-1', true)).resolves.toEqual({
      ok: true
    })
    await expect(threadStore.get('gui-thread-1')).resolves.toMatchObject({
      archived: true
    })
    expect(client.request).toHaveBeenCalledWith('thread/archive', {
      threadId: 'codex-thread-missing'
    })
  })

  it('renames materialized Codex threads through the app-server rename method', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await threadStore.upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-1',
      workspace: '/tmp/workspace',
      title: 'Old title'
    })
    const client = controllableClient()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.renameThread('gui-thread-1', '靶点发现')).resolves.toEqual({ ok: true })

    expect(client.renameThread).toHaveBeenCalledWith({
      threadId: 'codex-thread-1',
      title: '靶点发现'
    })
    expect(client.request).not.toHaveBeenCalledWith(
      'thread/name/set',
      expect.objectContaining({ threadId: 'codex-thread-1' })
    )
    await expect(threadStore.get('gui-thread-1')).resolves.toMatchObject({
      title: '靶点发现',
      titleSource: 'user'
    })
  })

  it('keeps locally archived live Codex threads out of the active list', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await upsertMaterializedThread(threadStore, {
      guiThreadId: 'codex-thread-1',
      codexThreadId: 'codex-thread-1',
      workspace: '/tmp/workspace',
      title: 'Archived Codex',
      archived: true
    })
    const client = controllableClient()
    vi.mocked(client.listThreads).mockResolvedValue({
      threads: [
        {
          id: 'codex-thread-1',
          name: 'Archived Codex',
          cwd: '/tmp/workspace',
          status: 'idle'
        }
      ]
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.listThreads()).resolves.toEqual({
      ok: true,
      threads: []
    })
    await expect(service.listThreads({ includeArchived: true })).resolves.toEqual({
      ok: true,
      threads: [expect.objectContaining({ id: 'codex-thread-1', archived: true })]
    })
  })

  it('initializes the app-server session before thread operations', async () => {
    const client = controllableClient()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.startThread({ title: 'Direct UI thread' })).resolves.toMatchObject({
      ok: true,
      thread: expect.objectContaining({ id: 'thread-1' })
    })

    expect(client.connect).toHaveBeenCalled()
    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      developerInstructions: expect.stringContaining('A progress message must be accompanied by an actual tool call')
    }))
    expect(vi.mocked(client.connect).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(client.startThread).mock.invocationCallOrder[0]
    )
  })

  it('returns the persisted GUI thread with resolved workspace after starting a thread', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'codex-runtime-service-'))
    const client = controllableClient()
    vi.mocked(client.startThread).mockResolvedValue({
      thread: { id: 'codex-thread-new' }
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.startThread({ title: 'Direct UI thread' })).resolves.toMatchObject({
      ok: true,
      thread: {
        id: 'codex-thread-new',
        title: 'Direct UI thread',
        workspace: '/tmp/workspace'
      }
    })
  })

  it('forwards only runtime-supported frozen model settings to thread and turn starts', async () => {
    const client = controllableClient()
    vi.mocked(client.listModels).mockResolvedValue({
      data: [{
        id: 'runtime-alpha',
        model: 'runtime-alpha',
        displayName: 'Runtime Alpha',
        description: 'Discovered at runtime',
        hidden: false,
        isDefault: true,
        supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }],
        defaultReasoningEffort: 'medium',
        inputModalities: ['text'],
        serviceTiers: [{ id: 'priority', name: 'Fast', description: 'Faster queue' }],
        defaultServiceTier: 'default'
      }],
      nextCursor: null
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.startThread({
      model: 'runtime-alpha',
      reasoningEffort: 'ultra',
      serviceTier: 'priority'
    })).resolves.toMatchObject({ ok: true })
    await expect(service.startTurn({
      threadId: 'thread-1',
      text: 'use the frozen selection',
      model: 'runtime-alpha',
      reasoningEffort: 'ultra',
      serviceTier: 'priority'
    })).resolves.toMatchObject({ ok: true })

    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      model: 'runtime-alpha',
      serviceTier: 'priority'
    }))
    expect(client.startThread).toHaveBeenCalledWith(expect.not.objectContaining({
      config: expect.objectContaining({ model_reasoning_effort: expect.anything() })
    }))
    expect(client.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      model: 'runtime-alpha',
      serviceTier: 'priority'
    }))
    expect(client.startTurn).toHaveBeenCalledWith(expect.not.objectContaining({
      effort: expect.anything()
    }))
  })

  it('persists side-thread visibility metadata after starting a Codex thread', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'codex-runtime-service-'))
    const client = controllableClient()
    vi.mocked(client.startThread).mockResolvedValue({
      thread: { id: 'codex-thread-new' }
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(
      service.startThread({
        title: 'PDF: selected text',
        relation: 'side',
        threadSource: 'pdf_annotation',
        sidebarVisibility: 'hidden'
      })
    ).resolves.toMatchObject({
      ok: true,
      thread: {
        id: 'codex-thread-new',
        relation: 'side',
        threadSource: 'pdf_annotation',
        sidebarVisibility: 'hidden'
      }
    })
    expect(client.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        relation: 'side',
        threadSource: 'pdf_annotation',
        sidebarVisibility: 'hidden',
        source: expect.objectContaining({
          type: 'pdf_annotation',
          relation: 'side',
          sidebarVisibility: 'hidden'
        })
      })
    )
  })

  it('advertises only Host-allowed capability tools and routes them with trusted thread workspace context', async () => {
    const storageRoot = await tempRoot()
    const client = controllableClient()
    let pendingServerRequests: CodexAppServerPendingRequestRegistryOptions | undefined
    const broker = new CapabilityBroker(new CapabilityRegistry())
    const discover = vi.spyOn(broker, 'discover')
    const resolveCaller = vi.fn(
      (toolContext: { requestId: string | number; runtimeId?: string; threadId?: string; workspaceId?: string }) => ({
        audience: 'agent' as const,
        callerId: toolContext.threadId ?? String(toolContext.requestId),
        workspaceId: toolContext.workspaceId,
        approvals: []
      })
    )
    const capabilityAgentTools = createCapabilityAgentToolSurface({
      broker,
      resolveCaller
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      capabilityAgentTools,
      probeRuntime: availableTestRuntime,
      createClient: (options) => {
        pendingServerRequests = options.pendingServerRequests as CodexAppServerPendingRequestRegistryOptions
        return client
      }
    })

    await expect(
      service.startThread({
        title: 'Capability thread',
        workspace: '/tmp/capability-workspace',
        allowedTools: [CAPABILITY_AGENT_TOOL_NAMES.discover]
      })
    ).resolves.toMatchObject({ ok: true })

    const startParams = vi.mocked(client.startThread).mock.calls[0]?.[0] as {
      dynamicTools?: Array<{ name: string }>
    }
    const dynamicTools = startParams.dynamicTools ?? []
    expect(dynamicTools.map((tool) => tool.name)).toEqual([CAPABILITY_AGENT_TOOL_NAMES.discover])

    await expect(
      pendingServerRequests?.onToolCallRequest?.({
        requestId: 'capability-request-1',
        callId: 'capability-call-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        tool: CAPABILITY_AGENT_TOOL_NAMES.discover,
        arguments: {}
      })
    ).resolves.toMatchObject({
      success: false,
      errorCode: 'capability_discovery_empty',
      contentItems: [
        {
          type: 'inputText',
          text: expect.stringContaining('No capability matched the discovery request')
        }
      ]
    })
    expect(resolveCaller).toHaveBeenCalledWith({
      requestId: 'capability-request-1',
      runtimeId: 'codex',
      callId: 'capability-call-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      workspaceId: '/tmp/capability-workspace'
    })
    expect(discover).toHaveBeenCalledWith(
      {
        audience: 'agent',
        callerId: 'thread-1',
        workspaceId: '/tmp/capability-workspace',
        approvals: []
      },
      { limit: 8 },
      {
        context: expect.objectContaining({
          runtimeId: 'codex',
          threadId: 'thread-1'
        })
      }
    )
  })

  it('revalidates the turn Principal after terminal fact I/O without publishing capability payloads', async () => {
    const storageRoot = await tempRoot()
    const client = controllableClient()
    const broadcast = captureBroadcastEvents()
    let pendingServerRequests: CodexAppServerPendingRequestRegistryOptions | undefined
    let principalCurrent = true
    let deliveryEffect: 'read' | 'external-write' = 'external-write'
    const call = vi.fn(async () => ({
      tool: 'sciforge_invoke',
      deliveryEffect,
      value: {
        capabilityId: 'content-space.create-folder',
        operationRef: `op_${'a'.repeat(24)}`,
        output: { ok: true },
        changed: false,
        replayed: false,
        completedAt: '2026-08-17T00:00:00.000Z'
      }
    }))
    const capabilityAgentTools: AgentRuntimeToolSurface = {
      tools: () => [{
        type: 'function',
        name: 'sciforge_invoke',
        description: 'Invoke a capability.',
        inputSchema: { type: 'object', properties: {} }
      }],
      assertPrincipalLease: () => {
        if (!principalCurrent) {
          throw Object.assign(new Error('The captured Principal changed.'), {
            code: 'principal_changed'
          })
        }
      },
      call
    }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      capabilityAgentTools,
      probeRuntime: availableTestRuntime,
      createClient: (options) => {
        pendingServerRequests = options.pendingServerRequests as CodexAppServerPendingRequestRegistryOptions
        return client
      }
    })

    await service.startThread({
      threadId: 'principal-terminal-thread',
      title: 'Principal terminal barrier',
      workspace: '/tmp/capability-workspace'
    })
    broadcast.mockImplementation((event) => {
      if (event.tool?.meta?.phase === 'succeeded') principalCurrent = false
    })
    try {
      await expect(pendingServerRequests?.onToolCallRequest?.({
        requestId: 'principal-terminal-request',
        callId: 'principal-terminal-call',
        threadId: 'principal-terminal-thread',
        turnId: 'turn-1',
        tool: 'sciforge_invoke',
        arguments: { secretTarget: 'must-not-enter-terminal-fact' }
      })).resolves.toMatchObject({
        success: false,
        errorCode: 'outcome_unknown',
        retryable: false
      })

      principalCurrent = true
      deliveryEffect = 'read'
      await expect(pendingServerRequests?.onToolCallRequest?.({
        requestId: 'principal-terminal-read-request',
        callId: 'principal-terminal-read-call',
        threadId: 'principal-terminal-thread',
        turnId: 'turn-1',
        tool: 'sciforge_invoke',
        arguments: { operationRef: 'read-only-operation' }
      })).resolves.toMatchObject({
        success: false,
        errorCode: 'principal_changed',
        retryable: false
      })

      const factsBeforeRejectedPreflight = broadcast.mock.calls.length
      principalCurrent = false
      const rejectedPreflight = await pendingServerRequests?.onToolCallRequest?.({
        requestId: 'principal-preflight-rejected-request',
        callId: 'principal-preflight-rejected-call',
        threadId: 'principal-terminal-thread',
        turnId: 'turn-1',
        tool: 'sciforge_invoke',
        arguments: { secretTarget: 'must-not-enter-dispatched-fact' }
      })
      expect(rejectedPreflight).toMatchObject({
        success: false,
        errorCode: 'principal_changed',
        failureClass: 'authorization_changed',
        retryable: false
      })
      expect(JSON.parse((rejectedPreflight?.contentItems[0] as { text: string }).text)).toMatchObject({
        tool: 'sciforge_invoke',
        status: 'failed',
        error: {
          code: 'principal_changed',
          failureClass: 'authorization_changed',
          retryable: false,
          recovery: { action: 'start_new_turn', instruction: expect.stringContaining('same conversation') }
        }
      })
      const preflightFacts = broadcast.mock.calls.slice(factsBeforeRejectedPreflight).map(([event]) => event)
      expect(preflightFacts).toHaveLength(1)
      expect(preflightFacts[0]?.tool).toMatchObject({
        status: 'error',
        meta: {
          phase: 'failed',
          factSource: 'executor_result',
          errorCode: 'principal_changed',
          failureClass: 'authorization_changed',
          retryable: false,
          recoveryGuidance: expect.stringContaining('same conversation')
        }
      })
      expect(preflightFacts[0]?.tool?.meta).not.toHaveProperty('arguments')
      expect(preflightFacts[0]?.tool?.meta).not.toHaveProperty('structuredContent')
      expect(createExecutionReceipt({
        status: 'error',
        metadata: preflightFacts[0]?.tool?.meta
      })).toMatchObject({
        errorCode: 'principal_changed',
        failureClass: 'authorization_changed',
        retryable: false,
        recoveryGuidance: expect.stringContaining('same conversation')
      })

      principalCurrent = true
      const factsBeforeDispatchedBarrier = broadcast.mock.calls.length
      broadcast.mockImplementation((event) => {
        if (event.tool?.meta?.phase === 'dispatched') principalCurrent = false
      })
      await expect(pendingServerRequests?.onToolCallRequest?.({
        requestId: 'principal-dispatched-barrier-request',
        callId: 'principal-dispatched-barrier-call',
        threadId: 'principal-terminal-thread',
        turnId: 'turn-1',
        tool: 'sciforge_invoke',
        arguments: { secretTarget: 'must-not-cross-dispatched-barrier' }
      })).resolves.toMatchObject({
        success: false,
        errorCode: 'principal_changed',
        retryable: false
      })
      expect(call).toHaveBeenCalledTimes(2)
      const dispatchedBarrierFacts = broadcast.mock.calls
        .slice(factsBeforeDispatchedBarrier)
        .map(([event]) => event)
      expect(dispatchedBarrierFacts.map((event) => event.tool?.meta?.phase)).toEqual([
        'dispatched',
        'failed'
      ])
      for (const event of dispatchedBarrierFacts) {
        expect(event.tool?.meta).not.toHaveProperty('arguments')
        expect(event.tool?.meta).not.toHaveProperty('structuredContent')
      }

      const terminal = broadcast.mock.calls
        .map(([event]) => event)
        .find((event) => event.tool?.meta?.phase === 'succeeded')
      expect(terminal?.tool?.detail).toBe('Dynamic tool completed successfully.')
      expect(terminal?.tool?.meta?.capabilityIdentity).toEqual({
        operationRef: `op_${'a'.repeat(24)}`,
        capabilityId: 'content-space.create-folder'
      })
      expect(terminal?.tool?.meta).not.toHaveProperty('arguments')
      expect(terminal?.tool?.meta).not.toHaveProperty('structuredContent')
    } finally {
      broadcast.mockRestore()
    }

    expect(call).toHaveBeenCalledTimes(2)
  })

  it('records Host-resolved capability identity on failed dynamic tool facts', async () => {
    const storageRoot = await tempRoot()
    const client = controllableClient()
    let pendingServerRequests: CodexAppServerPendingRequestRegistryOptions | undefined
    const broadcast = captureBroadcastEvents()
    const capabilityIdentity = {
      operationRef: `op_${'f'.repeat(24)}`,
      capabilityId: 'paper-radar.search'
    }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      capabilityAgentTools: {
        tools: () => [{
          type: 'function',
          name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
          description: 'Invoke.',
          inputSchema: { type: 'object', properties: {} }
        }],
        call: async () => {
          throw Object.assign(new Error('Capability output must be JSON serializable.'), {
            code: 'non_serializable_output',
            ...capabilityIdentity
          })
        }
      },
      probeRuntime: availableTestRuntime,
      createClient: (options) => {
        pendingServerRequests = options.pendingServerRequests as CodexAppServerPendingRequestRegistryOptions
        return client
      }
    })

    await expect(service.startThread({
      threadId: 'failed-identity-thread',
      title: 'Failed identity',
      workspace: '/tmp/capability-workspace'
    })).resolves.toMatchObject({ ok: true })

    await expect(pendingServerRequests?.onToolCallRequest?.({
      requestId: 'failed-identity-request',
      callId: 'failed-identity-call',
      threadId: 'failed-identity-thread',
      turnId: 'turn-1',
      tool: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef: capabilityIdentity.operationRef, input: {} }
    })).resolves.toMatchObject({
      success: false,
      errorCode: 'non_serializable_output',
      capabilityIdentity
    })

    expect(broadcast.mock.calls.map(([event]) => event)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tool: expect.objectContaining({
          status: 'error',
          meta: expect.objectContaining({
            phase: 'failed',
            capabilityIdentity,
            errorCode: 'non_serializable_output'
          })
        })
      })
    ]))
    broadcast.mockRestore()
  })

  it('uses a stable Host JSON-RPC identity when legacy tool calls omit provider callId', async () => {
    const storageRoot = await tempRoot()
    const managedCodexHome = await tempRoot()
    const client = controllableClient()
    let pendingServerRequests: CodexAppServerPendingRequestRegistryOptions | undefined
    const observedCallIds: Array<string | undefined> = []
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      managedCodexHome,
      capabilityAgentTools: {
        tools: () => [{
          type: 'function',
          name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
          description: 'Invoke.',
          inputSchema: { type: 'object', properties: {} }
        }],
        call: async (request) => {
          observedCallIds.push(request.context.callId)
          return {
            tool: CAPABILITY_AGENT_TOOL_NAMES.invoke,
            value: { changed: false }
          }
        }
      },
      probeRuntime: availableTestRuntime,
      createClient: (options) => {
        pendingServerRequests = options.pendingServerRequests as CodexAppServerPendingRequestRegistryOptions
        return client
      }
    })

    await expect(service.startTurn({
      threadId: 'thread-legacy-call-id',
      text: 'invoke',
      workspace: '/tmp/capability-workspace'
    })).resolves.toMatchObject({ ok: true, turnId: 'turn-1' })

    const invoke = (requestId: string, callId?: string) => pendingServerRequests?.onToolCallRequest?.({
      requestId,
      threadId: 'thread-legacy-call-id',
      turnId: 'turn-1',
      ...(callId ? { callId } : {}),
      tool: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef: 'op_legacy' }
    })
    await invoke('rpc-request-stable')
    await invoke('rpc-request-stable')
    await invoke('rpc-request-distinct')
    await invoke('rpc-request-explicit', 'provider-call-id')

    expect(observedCallIds[0]).toMatch(/^codex_rpc_[a-f0-9]{64}$/u)
    expect(observedCallIds[1]).toBe(observedCallIds[0])
    expect(observedCallIds[2]).toMatch(/^codex_rpc_[a-f0-9]{64}$/u)
    expect(observedCallIds[2]).not.toBe(observedCallIds[0])
    expect(observedCallIds[3]).toBe('provider-call-id')
  })

  it('mints completion receipts only for strict in-process native visual results', async () => {
    const storageRoot = await tempRoot()
    const client = controllableClient()
    let pendingServerRequests: CodexAppServerPendingRequestRegistryOptions | undefined
    const longArtifactPath = `/private/var/folders/${'a'.repeat(180)}/selected.jsonl`
    const output = codexVisualLookOutput()
    const surface: AgentRuntimeToolSurface = {
      tools: () => [
        {
          type: 'function',
          name: 'sciforge_look',
          description: 'Look.',
          inputSchema: { type: 'object', properties: {} }
        },
        {
          type: 'function',
          name: 'ordinary_structured_tool',
          description: 'Return structured data.',
          inputSchema: { type: 'object', properties: {} }
        }
      ],
      call: async (request) => ({
        tool: request.name,
        value: request.name === 'ordinary_structured_tool'
          ? {
              capabilityId: 'ordinary_structured_tool',
              operationRef: `op_${'o'.repeat(24)}`,
              output: {
                path: longArtifactPath,
                artifactRef: `artifact_${'a'.repeat(24)}`,
                records: Array.from({ length: 100 }, (_, index) => ({ index, value: 'x'.repeat(100) }))
              },
              completedAt: '2026-09-17T00:00:00.000Z'
            }
          : output
      })
    }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      capabilityAgentTools: surface,
      probeRuntime: availableTestRuntime,
      createClient: (options) => {
        pendingServerRequests = options.pendingServerRequests as CodexAppServerPendingRequestRegistryOptions
        return client
      }
    })

    await service.startThread({
      title: 'Native visual receipts',
      workspace: '/tmp/capability-workspace'
    })
    const nativeResult = await pendingServerRequests?.onToolCallRequest?.({
      requestId: 'native-request',
      callId: 'native-call',
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: 'sciforge_look',
      arguments: {}
    })
    const ordinaryResult = await pendingServerRequests?.onToolCallRequest?.({
      requestId: 'ordinary-request',
      callId: 'ordinary-call',
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: 'ordinary_structured_tool',
      arguments: {}
    })

    expect(nativeResult).toMatchObject({
      effects: ['read'],
      completionReceipts: [
        {
          kind: 'visual.look',
          callId: 'native-call',
          receiptId: codexVisualRefs.proof
        }
      ]
    })
    expect(ordinaryResult).not.toHaveProperty('completionReceipts')
    const ordinaryText = ordinaryResult?.contentItems?.[0]?.type === 'inputText'
      ? ordinaryResult.contentItems[0].text
      : ''
    expect(Buffer.byteLength(ordinaryText, 'utf8')).toBeLessThanOrEqual(4 * 1_024)
    expect(() => JSON.parse(ordinaryText)).not.toThrow()
    expect(JSON.parse(ordinaryText)).toMatchObject({
      capabilityId: 'ordinary_structured_tool',
      operationRef: `op_${'o'.repeat(24)}`,
      output: {
        path: longArtifactPath,
        artifactRef: `artifact_${'a'.repeat(24)}`
      }
    })
  })

  it('roundtrips a complete small byte result through the model-visible production boundary', async () => {
    const bytes = Buffer.from(Array.from({ length: 175 }, (_, index) => index))
    const value = { output: { result: { bytes: bytes.toString('base64'), byteLength: bytes.length } } }
    const client = controllableClient()
    let pending: CodexAppServerPendingRequestRegistryOptions | undefined
    const service = new CodexRuntimeService({
      settings: async () => settings(), storageRoot: await tempRoot(),
      capabilityAgentTools: {
        tools: () => [{ type: 'function', name: 'read_bytes', description: 'Read bytes.', inputSchema: { type: 'object' } }],
        call: async () => ({ tool: 'read_bytes', value })
      },
      probeRuntime: availableTestRuntime,
      createClient: (options) => { pending = options.pendingServerRequests as CodexAppServerPendingRequestRegistryOptions; return client }
    })
    await service.startThread({ title: 'Lossless bytes', workspace: '/tmp/capability-workspace' })
    const response = await pending?.onToolCallRequest?.({ requestId: 'bytes-request', callId: 'bytes-call', threadId: 'thread-1', turnId: 'turn-1', tool: 'read_bytes', arguments: {} })
    expect(response?.success).toBe(true)
    const item = response?.contentItems[0]
    if (item?.type !== 'inputText') throw new Error('Missing model text')
    const visible = JSON.parse(item.text)
    expect(visible).toEqual(value)
    expect(Buffer.from(visible.output.result.bytes, 'base64')).toEqual(bytes)
    expect(Buffer.byteLength(item.text)).toBeLessThanOrEqual(4 * 1_024)
  })

  it('expands the real Artifact commit nested union using the existing operationRef discovery path', async () => {
    const capability = defineCapability({
      id: 'artifact-versions.commit', version: '1', title: 'Commit artifact versions',
      description: 'Commit a candidate batch.', audiences: ['agent'], scope: 'workspace',
      effect: 'read', approval: 'none', concurrency: { revision: 'none', idempotency: 'none' },
      inputSchema: artifactVersionCommitInputV1Schema,
      outputSchema: z.object({ candidateIds: z.array(z.string()) }).strict(),
      handler: async (input) => ({ output: { candidateIds: input.candidates.map((item) => item.candidateId) } })
    })
    const surface = createCapabilityAgentToolSurface({
      broker: new CapabilityBroker(new CapabilityRegistry([capability])),
      resolveCaller: () => ({ audience: 'agent', callerId: 'thread-1', workspaceId: '/tmp/capability-workspace', approvals: [] })
    })
    const client = controllableClient()
    let pending: CodexAppServerPendingRequestRegistryOptions | undefined
    let fullResult: unknown
    const service = new CodexRuntimeService({
      settings: async () => settings(), storageRoot: await tempRoot(),
      capabilityAgentTools: {
        tools: () => surface.tools(),
        call: async (request) => {
          const result = await surface.call(request)
          fullResult = result.value
          return result
        }
      },
      probeRuntime: availableTestRuntime,
      createClient: (options) => { pending = options.pendingServerRequests as CodexAppServerPendingRequestRegistryOptions; return client }
    })
    await service.startThread({ title: 'Commit schema expansion', workspace: '/tmp/capability-workspace' })
    const call = async (tool: string, args: Record<string, unknown>) => {
      const response = await pending?.onToolCallRequest?.({ requestId: `request-${tool}`, callId: `call-${tool}`, threadId: 'thread-1', turnId: 'turn-1', tool, arguments: args })
      expect(response?.success).toBe(true)
      const item = response?.contentItems[0]
      if (item?.type !== 'inputText') throw new Error('Missing model text')
      expect(Buffer.byteLength(item.text)).toBeLessThanOrEqual(4 * 1_024)
      return JSON.parse(item.text)
    }
    const [operation] = await call(CAPABILITY_AGENT_TOOL_NAMES.discover, { text: 'commit' })
    const [expanded] = await call(CAPABILITY_AGENT_TOOL_NAMES.discover, { operationRef: operation.operationRef, includeSchema: true })
    expect([expanded]).toEqual(fullResult)
    const content = expanded.inputShape.properties.candidates.items.properties.content
    expect(content).toEqual({
      type: 'union', required: true,
      variants: [
        { type: 'object', properties: {
          mode: { type: 'string', const: 'snapshot', required: true },
          dataBase64: { type: 'string', maxLength: 134217728, pattern: '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$', required: true },
          mediaType: { type: 'string', pattern: '^[^\\s/]+\\/[^\\s/]+$', maxLength: 256, required: false }
        }, additionalProperties: false },
        { type: 'object', properties: {
          mode: { type: 'string', const: 'reference', required: true },
          locator: { type: 'string', minLength: 1, maxLength: 8192, required: true },
          contentDigest: { type: 'string', pattern: '^[a-f0-9]{64}$', required: true },
          byteLength: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER, required: true },
          mediaType: { type: 'string', pattern: '^[^\\s/]+\\/[^\\s/]+$', maxLength: 256, required: false },
          availability: { type: 'string', enum: ['available', 'missing', 'remote'], required: false }
        }, additionalProperties: false }
      ]
    })
    const candidates = Array.from({ length: 4 }, (_, index) => ({ candidateId: `candidate-${index}`, expectedCurrentVersionId: null, kind: 'text', intent: 'observe', content: { mode: 'snapshot', dataBase64: Buffer.from(Array.from({ length: 175 }, (_, byte) => byte)).toString('base64') } }))
    const result = await call(CAPABILITY_AGENT_TOOL_NAMES.invoke, { operationRef: operation.operationRef, input: { idempotencyKey: 'commit-boundary-test', candidates } })
    expect(result.output.candidateIds).toEqual(candidates.map((item) => item.candidateId))
  })

  it.each([false, true])('keeps discovery schemas atomic under the byte budget (oversize=%s)', async (oversize) => {
    const shape = { type: 'object', properties: { entries: { type: 'array', items: { type: 'object', properties: { payload: { type: 'string', pattern: oversize ? 'x'.repeat(5000) : 'x'.repeat(200) } }, additionalProperties: false } } }, additionalProperties: false }
    const descriptors = Array.from({ length: 2 }, (_, index) => ({ operationRef: `op_${index}${'o'.repeat(24)}`, schemaRef: `schema_${index}${'s'.repeat(24)}`, title: `Candidate ${index}`, description: 'verbose '.repeat(1000), inputShape: shape }))
    const client = controllableClient()
    let pending: CodexAppServerPendingRequestRegistryOptions | undefined
    const service = new CodexRuntimeService({
      settings: async () => settings(), storageRoot: await tempRoot(),
      capabilityAgentTools: {
        tools: () => [{ type: 'function', name: CAPABILITY_AGENT_TOOL_NAMES.discover, description: 'Discover.', inputSchema: { type: 'object' } }],
        call: async () => ({ tool: CAPABILITY_AGENT_TOOL_NAMES.discover, value: descriptors })
      }, probeRuntime: availableTestRuntime,
      createClient: (options) => { pending = options.pendingServerRequests as CodexAppServerPendingRequestRegistryOptions; return client }
    })
    await service.startThread({ title: 'Atomic discovery shapes', workspace: '/tmp/capability-workspace' })
    const response = await pending?.onToolCallRequest?.({ requestId: 'atomic-request', callId: 'atomic-call', threadId: 'thread-1', turnId: 'turn-1', tool: CAPABILITY_AGENT_TOOL_NAMES.discover, arguments: { includeSchema: true } })
    const item = response?.contentItems[0]
    if (item?.type !== 'inputText') throw new Error('Missing model text')
    expect(Buffer.byteLength(item.text)).toBeLessThanOrEqual(4096)
    const visible = JSON.parse(item.text)
    expect(visible).toHaveLength(2)
    for (const [index, descriptor] of visible.entries()) {
      expect(descriptor.operationRef).toBe(descriptors[index].operationRef)
      if (oversize) {
        expect(descriptor).not.toHaveProperty('inputShape')
        expect(descriptor.schemaOmitted).toContain('Do not invoke')
      } else {
        expect(descriptor.inputShape).toEqual(shape)
      }
    }
  })

  it('keeps discovery references visible when several descriptors exceed the model result budget', async () => {
    const storageRoot = await tempRoot()
    const client = controllableClient()
    let pendingServerRequests: CodexAppServerPendingRequestRegistryOptions | undefined
    const surface: AgentRuntimeToolSurface = {
      tools: () => [{
        type: 'function',
        name: CAPABILITY_AGENT_TOOL_NAMES.discover,
        description: 'Discover SciForge operations.',
        inputSchema: { type: 'object', properties: {} }
      }],
      call: async () => ({
        tool: CAPABILITY_AGENT_TOOL_NAMES.discover,
        value: Array.from({ length: 5 }, (_, index) => ({
          operationRef: `op_${String(index).padStart(2, '0')}${'o'.repeat(22)}`,
          schemaRef: `schema_${String(index).padStart(2, '0')}${'s'.repeat(22)}`,
          title: `Biology Room operation ${index}`,
          description: 'A deliberately verbose operation description '.repeat(20),
          scope: 'workspace',
          effect: 'read',
          approval: 'none',
          providerFamily: 'native',
          acceptedResourceKinds: [],
          producedResourceKinds: [],
          tags: ['biology-room', 'workspace', 'evaluation'],
          ...(index === 0
            ? { inputShape: { type: 'object', properties: { roomId: { type: 'string', required: true } } } }
            : {})
        }))
      })
    }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      capabilityAgentTools: surface,
      probeRuntime: availableTestRuntime,
      createClient: (options) => {
        pendingServerRequests = options.pendingServerRequests as CodexAppServerPendingRequestRegistryOptions
        return client
      }
    })

    await service.startThread({ title: 'Discovery result budget', workspace: '/tmp/capability-workspace' })
    const result = await pendingServerRequests?.onToolCallRequest?.({
      requestId: 'discovery-request',
      callId: 'discovery-call',
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { text: 'biology room', limit: 5 }
    })
    const text = result?.contentItems?.[0]?.type === 'inputText'
      ? result.contentItems[0].text
      : ''
    const payload = JSON.parse(text) as Array<{ operationRef?: string; title?: string }>
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(4 * 1_024)
    expect(payload).toHaveLength(5)
    expect(payload.every((item) => item.operationRef && item.title)).toBe(true)
    expect(payload[0]).toHaveProperty('inputShape')
    expect(text).not.toContain('Capability result exceeded the model-visible result boundary.')
  })

  it('preserves short primitive lists in capability handoffs', async () => {
    const storageRoot = await tempRoot()
    const client = controllableClient()
    let pendingServerRequests: CodexAppServerPendingRequestRegistryOptions | undefined
    const surface: AgentRuntimeToolSurface = {
      tools: () => [{
        type: 'function',
        name: 'ordinary_status_tool',
        description: 'Return a bounded status.',
        inputSchema: { type: 'object', properties: {} }
      }],
      call: async () => ({
        tool: 'ordinary_status_tool',
        value: {
          capabilityId: 'ordinary_status_tool',
          operationRef: `op_${'s'.repeat(24)}`,
          output: {
            provider: 'local-fixture',
            scenarios: ['success', 'blocked', 'rerun', 'human-interaction']
          }
        }
      })
    }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      capabilityAgentTools: surface,
      probeRuntime: availableTestRuntime,
      createClient: (options) => {
        pendingServerRequests = options.pendingServerRequests as CodexAppServerPendingRequestRegistryOptions
        return client
      }
    })

    await service.startThread({ title: 'Primitive list result', workspace: '/tmp/capability-workspace' })
    const result = await pendingServerRequests?.onToolCallRequest?.({
      requestId: 'primitive-list-request',
      callId: 'primitive-list-call',
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: 'ordinary_status_tool',
      arguments: {}
    })
    const text = result?.contentItems?.[0]?.type === 'inputText'
      ? result.contentItems[0].text
      : ''
    expect(JSON.parse(text)).toMatchObject({
      output: {
        scenarios: ['success', 'blocked', 'rerun', 'human-interaction']
      }
    })
  })

  it('marks structured lists that are shortened in oversized capability handoffs', async () => {
    const storageRoot = await tempRoot()
    const client = controllableClient()
    let pendingServerRequests: CodexAppServerPendingRequestRegistryOptions | undefined
    const surface: AgentRuntimeToolSurface = {
      tools: () => [{
        type: 'function',
        name: 'ordinary_records_tool',
        description: 'Return bounded records.',
        inputSchema: { type: 'object', properties: {} }
      }],
      call: async () => ({
        tool: 'ordinary_records_tool',
        value: {
          output: {
            records: [
              { id: 'record-1', status: 'ready', payload: 'x'.repeat(2000) },
              { id: 'record-2', status: 'ready', payload: 'x'.repeat(2000) },
              { id: 'record-3', status: 'ready', payload: 'x'.repeat(2000) },
              { id: 'record-4', status: 'ready', payload: 'x'.repeat(2000) }
            ]
          }
        }
      })
    }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      capabilityAgentTools: surface,
      probeRuntime: availableTestRuntime,
      createClient: (options) => {
        pendingServerRequests = options.pendingServerRequests as CodexAppServerPendingRequestRegistryOptions
        return client
      }
    })

    await service.startThread({ title: 'Structured list truncation', workspace: '/tmp/capability-workspace' })
    const result = await pendingServerRequests?.onToolCallRequest?.({
      requestId: 'structured-list-request',
      callId: 'structured-list-call',
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: 'ordinary_records_tool',
      arguments: {}
    })
    const text = result?.contentItems?.[0]?.type === 'inputText'
      ? result.contentItems[0].text
      : ''
    expect(JSON.parse(text)).toMatchObject({
      output: {
        records: [
          { id: 'record-1', status: 'ready' },
          { id: 'record-2', status: 'ready' },
          { id: 'record-3', status: 'ready' },
          { _truncated: true }
        ]
      }
    })
  })

  it('preserves nested artifact refs needed by multi-step capability handoffs', async () => {
    const storageRoot = await tempRoot()
    const client = controllableClient()
    let pendingServerRequests: CodexAppServerPendingRequestRegistryOptions | undefined
    const surface: AgentRuntimeToolSurface = {
      tools: () => [{
        type: 'function',
        name: 'scientific_plot_render',
        description: 'Render a scientific plot.',
        inputSchema: { type: 'object', properties: {} }
      }],
      call: async () => ({
        tool: 'scientific_plot_render',
        value: {
          status: 'rendered',
          versionCommit: {
            candidateIds: { figure: 'plot-figure:eval', recipe: 'plot-recipe:eval' },
            result: {
              ok: true,
              value: {
                versions: [{
                  candidateId: 'plot-figure:eval',
                  ref: { artifactId: 'artifact:figure', versionId: 'artifact-version:figure' }
                }, {
                  candidateId: 'plot-recipe:eval',
                  ref: { artifactId: 'artifact:recipe', versionId: 'artifact-version:recipe' }
                }]
              }
            }
          }
        }
      })
    }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      capabilityAgentTools: surface,
      probeRuntime: availableTestRuntime,
      createClient: (options) => {
        pendingServerRequests = options.pendingServerRequests as CodexAppServerPendingRequestRegistryOptions
        return client
      }
    })

    await service.startThread({ title: 'Nested artifact refs', workspace: '/tmp/capability-workspace' })
    const result = await pendingServerRequests?.onToolCallRequest?.({
      requestId: 'nested-artifact-ref-request',
      callId: 'nested-artifact-ref-call',
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: 'scientific_plot_render',
      arguments: {}
    })
    const text = result?.contentItems?.[0]?.type === 'inputText'
      ? result.contentItems[0].text
      : ''
    expect(JSON.parse(text)).toMatchObject({
      versionCommit: {
        result: {
          value: {
            versions: [{
              ref: { artifactId: 'artifact:figure', versionId: 'artifact-version:figure' }
            }, {
              ref: { artifactId: 'artifact:recipe', versionId: 'artifact-version:recipe' }
            }]
          }
        }
      }
    })
  })

  it('preserves the adaptive visual timeout through Codex tool receipts', async () => {
    const storageRoot = await tempRoot()
    const client = controllableClient()
    const broadcast = captureBroadcastEvents()
    let pendingServerRequests: CodexAppServerPendingRequestRegistryOptions | undefined
    const surface: AgentRuntimeToolSurface = {
      tools: () => [
        {
          type: 'function',
          name: 'sciforge_look',
          description: 'Look.',
          inputSchema: { type: 'object', properties: {} }
        }
      ],
      call: async () => {
        throw Object.assign(new Error('Visual inspection exceeded the configured 180000 ms end-to-end deadline.'), {
          code: 'visual_inspection_timeout',
          failureClass: 'timeout',
          retryable: true,
          providerStage: 'model_router_deadline',
          resourceIdentity: 'visual:current',
          recovery: {
            action: 'retry_visual_inspection',
            instruction: 'Retry sciforge_look once with the same source and task using timeoutMs=270000.'
          }
        })
      }
    }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      capabilityAgentTools: surface,
      probeRuntime: availableTestRuntime,
      createClient: (options) => {
        pendingServerRequests = options.pendingServerRequests as CodexAppServerPendingRequestRegistryOptions
        return client
      }
    })

    await service.startThread({
      title: 'Native visual failure',
      workspace: '/tmp/capability-workspace'
    })
    await expect(
      pendingServerRequests?.onToolCallRequest?.({
        requestId: 'native-failure-request',
        callId: 'native-failure-call',
        threadId: 'thread-1',
        turnId: 'turn-1',
        tool: 'sciforge_look',
        arguments: {}
      })
    ).resolves.toMatchObject({
      success: false,
      contentItems: [{
        type: 'inputText',
        text: expect.stringContaining('timeoutMs=270000')
      }],
      errorCode: 'visual_inspection_timeout',
      failureClass: 'timeout',
      retryable: true,
      recoveryGuidance: 'Retry sciforge_look once with the same source and task using timeoutMs=270000.',
      providerStage: 'model_router_deadline',
      resourceIdentity: 'visual:current'
    })
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: expect.objectContaining({
          status: 'error',
          meta: expect.objectContaining({
            errorCode: 'visual_inspection_timeout',
            retryable: true,
            recoveryGuidance: 'Retry sciforge_look once with the same source and task using timeoutMs=270000.',
            providerStage: 'model_router_deadline'
          })
        })
      })
    )
  })

  it.each(['interrupted', 'failed'])('polls durable child status and unblocks a lost %s event', async (status) => {
    const queued = clientWithQueuedEvents()
    vi.mocked(queued.client.startThread)
      .mockResolvedValueOnce({ thread: { id: 'parent-codex-thread' } })
      .mockResolvedValueOnce({ thread: { id: 'child-codex-thread' } })
    vi.mocked(queued.client.startTurn)
      .mockResolvedValueOnce({ turn: { id: 'parent-turn' } })
      .mockResolvedValueOnce({ turn: { id: 'child-turn' } })
    const service = new CodexRuntimeService({
      settings: async () => settings(), storageRoot: await tempRoot(),
      probeRuntime: availableTestRuntime, createClient: () => queued.client
    })
    await service.startThread({ threadId: 'parent-thread' })
    await service.startTurn({ threadId: 'parent-thread', text: 'Delegate' })
    const spawned = vi.fn()
    const execution = service.spawnSubagent({
      childId: 'child', parentThreadId: 'parent-thread', parentTurnId: 'parent-turn',
      prompt: 'Write report', signal: new AbortController().signal,
      appendTranscript: vi.fn(), onThreadBound: vi.fn(), onSpawned: spawned
    })
    const failed = expect(execution).rejects.toMatchObject({ retryable: true })
    await vi.waitFor(() => expect(spawned).toHaveBeenCalled())
    const target = { childId: 'child', parentThreadId: 'parent-thread', parentTurnId: 'parent-turn', signal: new AbortController().signal }
    vi.mocked(queued.client.readThread).mockRejectedValueOnce(new Error('network unavailable'))
    await expect(service.inspectSubagent(target)).resolves.toMatchObject({ state: 'unknown' })
    vi.mocked(queued.client.readThread).mockResolvedValue({ thread: { id: 'child-codex-thread', turns: [{ id: 'child-turn', status }] } })
    await service.inspectSubagent(target)
    await failed
    await expect(service.inspectSubagent(target)).resolves.toMatchObject({ state: 'missing' })
    queued.close()
  })

  it('implements the Codex spawn, inspect, message, and cancel adapter contract', async () => {
    const queued = clientWithQueuedEvents()
    const storageRoot = await tempRoot()
    vi.mocked(queued.client.startThread)
      .mockResolvedValueOnce({ thread: { id: 'parent-codex-thread' } })
      .mockResolvedValueOnce({ thread: { id: 'child-codex-thread' } })
    vi.mocked(queued.client.startTurn)
      .mockResolvedValueOnce({ turn: { id: 'parent-turn' } })
      .mockResolvedValueOnce({ turn: { id: 'child-turn' } })
      .mockResolvedValueOnce({ turn: { id: 'child-resumed-turn' } })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => queued.client
    })
    await service.startThread({ threadId: 'parent-thread', title: 'Parent' })
    await service.startTurn({
      threadId: 'parent-thread',
      text: 'Delegate this task.'
    })

    const spawned = vi.fn()
    const threadBound = vi.fn(async () => {
      expect(queued.client.startTurn).toHaveBeenCalledTimes(1)
    })
    const controller = new AbortController()
    const completion = service.spawnSubagent({
      childId: 'child-1',
      parentThreadId: 'parent-thread',
      parentTurnId: 'parent-turn',
      label: 'Reviewer',
      prompt: 'Review the repository.',
      signal: controller.signal,
      appendTranscript: vi.fn(async () => undefined),
      onThreadBound: threadBound,
      onSpawned: spawned
    })
    await vi.waitFor(() =>
      expect(spawned).toHaveBeenCalledWith({
        runtime: 'codex',
        threadId: expect.any(String),
        turnId: 'child-turn'
      })
    )
    expect(threadBound).toHaveBeenCalledWith({
      runtime: 'codex',
      threadId: expect.any(String)
    })
    expect(queued.client.startTurn).toHaveBeenNthCalledWith(2, expect.objectContaining({
      collaborationMode: {
        mode: 'default',
        settings: { model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS, reasoning_effort: null, developer_instructions: null }
      }
    }))
    // Children do not get delegation tools, but still need the same shell guidance.
    expect(queued.client.startThread).toHaveBeenNthCalledWith(2, expect.objectContaining({
      developerInstructions: expect.stringContaining('Command execution reliability:')
    }))
    vi.mocked(queued.client.readThread).mockResolvedValue({ thread: { id: 'child-codex-thread', turns: [{ id: 'child-turn', status: 'inProgress' }] } })
    await expect(
      service.inspectSubagent({
        childId: 'child-1',
        parentThreadId: 'parent-thread',
        parentTurnId: 'parent-turn',
        signal: new AbortController().signal
      })
    ).resolves.toMatchObject({ state: 'active' })
    await expect(
      service.messageSubagent({
        childId: 'child-1',
        parentThreadId: 'parent-thread',
        parentTurnId: 'parent-turn',
        message: 'Report progress.',
        signal: new AbortController().signal
      })
    ).resolves.toEqual({ established: true })
    expect(queued.client.steerTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'child-codex-thread',
        expectedTurnId: 'child-turn'
      }),
      expect.any(AbortSignal)
    )

    await service.cancelSubagent({
      childId: 'child-1',
      parentThreadId: 'parent-thread',
      parentTurnId: 'parent-turn',
      reason: 'parent_cancel',
      signal: new AbortController().signal
    })
    expect(queued.client.interruptTurn).toHaveBeenCalledWith(
      {
        threadId: 'child-codex-thread',
        turnId: 'child-turn'
      },
      expect.any(AbortSignal)
    )
    controller.abort()
    await expect(completion).rejects.toThrow('aborted')
    await expect(
      service.inspectSubagent({
        childId: 'child-1',
        parentThreadId: 'parent-thread',
        parentTurnId: 'parent-turn',
        signal: new AbortController().signal
      })
    ).resolves.toMatchObject({ state: 'missing' })

    const resumedSpawned = vi.fn()
    const resumedThreadBound = vi.fn(async () => {
      expect(queued.client.startTurn).toHaveBeenCalledTimes(2)
    })
    const resumedCompletion = service.resumeSubagent({
      childId: 'child-1',
      parentThreadId: 'parent-thread',
      parentTurnId: 'parent-turn',
      prompt: 'Continue the interrupted review.',
      threadRef: {
        runtime: 'codex',
        threadId: 'child-codex-thread',
        turnId: 'child-turn'
      },
      signal: new AbortController().signal,
      appendTranscript: vi.fn(async () => undefined),
      onThreadBound: resumedThreadBound,
      onSpawned: resumedSpawned
    })
    await vi.waitFor(() => expect(resumedSpawned).toHaveBeenCalledWith({
      runtime: 'codex',
      threadId: 'child-codex-thread',
      turnId: 'child-resumed-turn'
    }))
    expect(resumedThreadBound).toHaveBeenCalledWith({
      runtime: 'codex',
      threadId: 'child-codex-thread'
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'turn/completed',
        params: { threadId: 'child-codex-thread', turnId: 'child-resumed-turn' }
      }
    })
    await expect(resumedCompletion).resolves.toMatchObject({
      threadRef: {
        runtime: 'codex',
        threadId: 'child-codex-thread',
        turnId: 'child-resumed-turn'
      }
    })
    await service.deleteSubagent({
      childId: 'child-1',
      parentThreadId: 'parent-thread',
      parentTurnId: 'parent-turn',
      threadRef: { runtime: 'codex', threadId: 'child-codex-thread' },
      signal: new AbortController().signal
    })
    expect(queued.client.request).toHaveBeenCalledWith('thread/archive', {
      threadId: 'child-codex-thread'
    })
    queued.close()
  })

  it('forces Codex thread starts through the managed Model Router provider', async () => {
    const client = controllableClient()
    const service = new CodexRuntimeService({
      settings: async () => ({
        ...settings(),
        agents: {
          ...settings().agents,
          codex: {
            ...defaultCodexRuntimeSettings(),
            profile: 'external-profile',
            model: 'external-runtime-model',
            modelProvider: 'external-runtime-provider'
          }
        }
      }),
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(
      service.startThread({
        title: 'Router-only thread',
        model: 'external-payload-model',
        modelProvider: 'external-payload-provider',
        profile: 'external-payload-profile',
        baseUrl: 'https://payload.external-provider.test/v1',
        apiKey: 'sk-payload'
      } as unknown as Parameters<CodexRuntimeService['startThread']>[0])
    ).resolves.toMatchObject({
      ok: true
    })

    const params = vi.mocked(client.startThread).mock.calls[0]?.[0] ?? {}
    expect(params).toEqual(
      expect.objectContaining({
        model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
        modelProvider: DEFAULT_MODEL_ROUTER_PROVIDER_ID
      })
    )
    expect(params).not.toEqual(
      expect.objectContaining({
        profile: expect.anything(),
        baseUrl: expect.anything(),
        apiKey: expect.anything()
      })
    )
    expect(params).not.toEqual(
      expect.objectContaining({
        model: 'external-payload-model',
        modelProvider: 'external-payload-provider'
      })
    )
    expect(params).not.toEqual(
      expect.objectContaining({
        model: 'external-runtime-model',
        modelProvider: 'external-runtime-provider'
      })
    )
  })

  it('launches Codex app-server with the managed Codex home rather than settings codexHome', async () => {
    const managedCodexHome = await mkdtemp(join(tmpdir(), 'service-managed-codex-home-'))
    const persistedCodexHome = await mkdtemp(join(tmpdir(), 'service-global-codex-home-'))
    const launches: CodexAppServerJsonRpcClientOptions[] = []
    const createClient = vi.fn((options: CodexAppServerJsonRpcClientOptions) => {
      launches.push(options)
      return controllableClient()
    })
    const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime,
      settings: async () => ({
        ...settings(),
        agents: {
          ...settings().agents,
          codex: {
            ...defaultCodexRuntimeSettings(),
            codexHome: persistedCodexHome
          }
        }
      }),
      managedCodexHome,
      createClient
    })

    await expect(service.connect()).resolves.toMatchObject({ ok: true })

    const launch = launches[0]
    expect(launch?.env?.CODEX_HOME).toBe(managedCodexHome)
    expect(launch?.env?.CODEX_HOME).not.toBe(persistedCodexHome)
  })

  it('trusts only the exact app-owned matcher-free PreToolUse hook without a version gate', async () => {
    const root = await tempRoot()
    const managedCodexHome = join(root, 'codex-home')
    const workspace = join(root, 'workspace')
    const appPath = join(root, 'SciForge App')
    const probeMarker = join(root, 'hook-probe-complete')
    await mkdir(workspace, { recursive: true })
    await mkdir(join(appPath, 'out/main'), { recursive: true })
    await writeFile(join(appPath, 'package.json'), '{"type":"module"}\n', 'utf8')
    await writeFile(
      join(appPath, 'out/main/codex-pre-tool-use-governance-node-entry.js'),
      `
import { writeFileSync } from 'node:fs'
const chunks = []
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
writeFileSync(${JSON.stringify(probeMarker)}, 'denied\\n')
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: 'sciforge_hook_deny_challenge:' + input.tool_input.nonce
  }
}))
`,
      'utf8'
    )
    const current = settings()
    current.workspaceRoot = workspace
    current.modelAccess = { mode: 'coding-plan', planAdapterId: 'codex' }
    const client = controllableClient()
    client.readAccount = vi.fn(async () => ({
      account: null,
      requiresOpenaiAuth: true
    }))
    vi.mocked(client.connect).mockResolvedValue({
      userAgent: 'sciforge/development (Mac OS 15.7.4; arm64) xterm-256color (sciforge; 0.1.0)',
      codexHome: managedCodexHome,
      platformFamily: 'unix',
      platformOs: 'macos'
    })
    let trusted = false
    client.listHooks = vi.fn(async (cwds) => {
      const sourcePath = await realpath(join(managedCodexHome, 'hooks.json'))
      const hookConfig = JSON.parse(await readFile(join(managedCodexHome, 'hooks.json'), 'utf8')) as {
        hooks: {
          PreToolUse: Array<{
            hooks: Array<{ command: string; commandWindows: string }>
          }>
        }
      }
      const handler = hookConfig.hooks.PreToolUse[0].hooks[0]
      return {
        data: [
          {
            cwd: cwds[0],
            hooks: [
              {
                key: `${sourcePath}:pre_tool_use:0:0`,
                eventName: 'preToolUse',
                handlerType: 'command',
                matcher: null,
                command: process.platform === 'win32' ? handler.commandWindows : handler.command,
                timeoutSec: 10,
                statusMessage: 'Checking SciForge visual execution policy',
                sourcePath,
                source: 'user',
                pluginId: null,
                displayOrder: 0,
                enabled: true,
                isManaged: false,
                currentHash: `sha256:${'a'.repeat(64)}`,
                trustStatus: trusted ? ('trusted' as const) : ('untrusted' as const)
              }
            ],
            warnings: [],
            errors: []
          }
        ]
      }
    })
    client.writeConfigBatch = vi.fn(async () => {
      await expect(readFile(probeMarker, 'utf8')).resolves.toBe('denied\n')
      trusted = true
      return {
        status: 'ok',
        version: '2',
        filePath: join(managedCodexHome, 'config.toml'),
        overriddenMetadata: null
      }
    })
    const service = new CodexRuntimeService({
      settings: async () => current,
      managedCodexHome,
      storageRoot: root,
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1' },
      preToolUseHookLaunch: {
        appPath,
        execPath: process.execPath,
        isPackaged: false
      },
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.getCodingPlanAccount()).resolves.toMatchObject({ ok: true })
    expect(client.listHooks).not.toHaveBeenCalled()
    expect(service.isClientWarm()).toBe(false)
    await expect(service.connect()).resolves.toMatchObject({ ok: true })
    expect(client.listHooks).toHaveBeenCalledTimes(2)
    expect(client.writeConfigBatch).toHaveBeenCalledOnce()
    expect(service.isClientWarm()).toBe(true)
    const trustWrite = vi.mocked(client.writeConfigBatch).mock.calls[0]?.[0]
    expect(trustWrite).toMatchObject({
      edits: [
        {
          keyPath: 'hooks.state',
          mergeStrategy: 'upsert'
        }
      ],
      filePath: join(managedCodexHome, 'config.toml'),
      reloadUserConfig: true
    })
    const trustedState = trustWrite?.edits[0]?.value as Record<string, unknown>
    expect(Object.entries(trustedState)).toEqual([
      [
        expect.stringContaining(':pre_tool_use:0:0'),
        {
          enabled: true,
          trusted_hash: `sha256:${'a'.repeat(64)}`
        }
      ]
    ])
  })

  it('forces Codex turns through the managed Model Router alias', async () => {
    const client = controllableClient()
    const service = new CodexRuntimeService({
      settings: async () => ({
        ...settings(),
        agents: {
          ...settings().agents,
          codex: {
            ...defaultCodexRuntimeSettings(),
            profile: 'external-profile',
            model: 'external-runtime-model',
            modelProvider: 'external-runtime-provider'
          }
        }
      }),
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(
      service.startTurn({
        threadId: 'thread-1',
        text: 'hello',
        model: 'external-payload-model',
        profile: 'external-payload-profile',
        baseUrl: 'https://payload.external-provider.test/v1',
        apiKey: 'sk-payload'
      } as unknown as Parameters<CodexRuntimeService['startTurn']>[0])
    ).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })

    const params = vi.mocked(client.startTurn).mock.calls[0]?.[0] ?? {}
    expect(params).toEqual(
      expect.objectContaining({
        model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
      })
    )
    expect(params).not.toHaveProperty('modelProvider')
    expect(params).not.toEqual(
      expect.objectContaining({
        profile: expect.anything(),
        baseUrl: expect.anything(),
        apiKey: expect.anything()
      })
    )
    expect(params).not.toEqual(expect.objectContaining({ model: 'external-payload-model' }))
    expect(params).not.toEqual(expect.objectContaining({ model: 'external-runtime-model' }))
  })

  it('correlates concurrent Codex turns by GUI thread without adding synthetic turn ids', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await Promise.all([
      threadStore.upsert({
        guiThreadId: 'gui-thread-a',
        codexThreadId: 'codex-thread-a',
        workspace: '/tmp/workspace',
        title: 'Thread A'
      }),
      threadStore.upsert({
        guiThreadId: 'gui-thread-b',
        codexThreadId: 'codex-thread-b',
        workspace: '/tmp/workspace',
        title: 'Thread B'
      })
    ])
    const client = controllableClient()
    vi.mocked(client.startTurn)
      .mockResolvedValueOnce({ turn: { id: 'native-turn-a' } })
      .mockResolvedValueOnce({ turn: { id: 'native-turn-b' } })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(
      Promise.all([
        service.startTurn({ threadId: 'gui-thread-a', text: 'alpha' }),
        service.startTurn({ threadId: 'gui-thread-b', text: 'beta' })
      ])
    ).resolves.toEqual([
      expect.objectContaining({ ok: true, threadId: 'gui-thread-a' }),
      expect.objectContaining({ ok: true, threadId: 'gui-thread-b' })
    ])

    const calls = vi.mocked(client.startTurn).mock.calls.map(([params]) => params)
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          responsesapiClientMetadata: {
            runtime_id: 'codex',
            gui_thread_id: 'gui-thread-a'
          }
        }),
        expect.objectContaining({
          responsesapiClientMetadata: {
            runtime_id: 'codex',
            gui_thread_id: 'gui-thread-b'
          }
        })
      ])
    )
  })

  it('stops a warm Codex client and fails closed when Model Router settings drift invalid', async () => {
    const client = controllableClient()
    const current = settings()
    const service = new CodexRuntimeService({
      settings: async () => current,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.connect()).resolves.toMatchObject({ ok: true })
    current.modelRouter = {
      ...current.modelRouter!,
      publicModelAlias: 'deepseek-v4-pro'
    }
    await expect(
      service.startTurn({
        threadId: 'thread-1',
        text: 'hello after settings drift'
      })
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('model must be')
    })

    expect(client.stop).toHaveBeenCalledTimes(1)
    expect(client.startTurn).not.toHaveBeenCalled()
  })

  it('rematerializes and retries a turn when an old Codex thread uses a stale Model Router alias', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await threadStore.upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'stale-codex-thread',
      workspace: '/tmp/workspace',
      title: 'Stale Codex'
    })
    const queued = clientWithQueuedEvents()
    vi.mocked(queued.client.startThread).mockResolvedValue({
      thread: { id: 'replacement-codex-thread', cwd: '/tmp/workspace' }
    })
    vi.mocked(queued.client.startTurn)
      .mockResolvedValueOnce({
        turn: { id: 'turn-old', userMessageItemId: 'user-old' }
      })
      .mockResolvedValueOnce({
        turn: { id: 'turn-retry', userMessageItemId: 'user-retry' }
      })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => queued.client
    })

    await expect(
      service.startTurn({
        threadId: 'gui-thread-1',
        text: 'hello',
        nativeVisualProofChainPending: true
      })
    ).resolves.toMatchObject({
      ok: true,
      threadId: 'gui-thread-1',
      turnId: 'turn-old'
    })

    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'item/completed',
        params: {
          threadId: 'stale-codex-thread',
          turnId: 'turn-old',
          item: {
            id: 'assistant-old',
            type: 'agentMessage',
            text: 'partial answer'
          }
        }
      }
    })
    await vi.waitFor(() => {
      expect(modelDeltaDedupeProbe(service).states.size).toBe(1)
    })

    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'turn/failed',
        params: {
          threadId: 'stale-codex-thread',
          turnId: 'turn-old',
          error: {
            message:
              'stream disconnected before completion: Model Router requests must use the public router model alias.'
          }
        }
      }
    })

    await vi.waitFor(() => {
      expect(queued.client.startTurn).toHaveBeenCalledTimes(2)
      expect(modelDeltaDedupeProbe(service).states.size).toBe(0)
    })
    await expect(
      new CodexPreToolUseGovernanceBridge({ storageRoot }).evaluate({
        hook_event_name: 'PreToolUse',
        session_id: 'replacement-codex-thread',
        turn_id: 'turn-retry-not-materialized-yet',
        tool_name: 'Bash',
        tool_use_id: 'call-retry-before-start-response',
        tool_input: { command: 'python inspect.py' },
        cwd: '/tmp/workspace'
      })
    ).resolves.toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('native_visual_proof_chain_required')
      }
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'turn/completed',
        params: { threadId: 'replacement-codex-thread', turnId: 'turn-retry' }
      }
    })
    await vi.waitFor(async () => {
      const events = await new CodexEventStore({ rootDir: storageRoot }).read('gui-thread-1', { includeAll: true })
      expect(events.some((item) => item.event.turnComplete === true && item.event.turnId === 'turn-retry')).toBe(true)
    })
    queued.close()

    expect(queued.client.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/tmp/workspace',
        model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
        modelProvider: DEFAULT_MODEL_ROUTER_PROVIDER_ID
      })
    )
    expect(queued.client.startTurn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        threadId: 'stale-codex-thread',
        model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
      })
    )
    expect(queued.client.startTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        threadId: 'replacement-codex-thread',
        model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
      })
    )
    expect(vi.mocked(queued.client.startTurn).mock.calls[0]?.[0]).not.toHaveProperty('modelProvider')
    expect(vi.mocked(queued.client.startTurn).mock.calls[1]?.[0]).not.toHaveProperty('modelProvider')
    expect(vi.mocked(queued.client.startTurn).mock.calls[0]?.[0].responsesapiClientMetadata).toEqual({
      runtime_id: 'codex',
      gui_thread_id: 'gui-thread-1'
    })
    expect(vi.mocked(queued.client.startTurn).mock.calls[1]?.[0].responsesapiClientMetadata).toEqual(
      vi.mocked(queued.client.startTurn).mock.calls[0]?.[0].responsesapiClientMetadata
    )
    await expect(threadStore.get('gui-thread-1')).resolves.toMatchObject({
      codexThreadId: 'replacement-codex-thread'
    })
    const events = await new CodexEventStore({ rootDir: storageRoot }).read('gui-thread-1', { includeAll: true })
    expect(events.map((item) => item.event.runtimeStatus?.message).filter(Boolean)).toEqual(
      expect.arrayContaining([
        'Codex thread used a stale Model Router alias; rebuilding the thread and retrying this turn.',
        'Codex turn retried with the managed Model Router alias.'
      ])
    )
    expect(events.some((item) => item.event.runtimeError?.message.includes('public router model alias'))).toBe(false)
  })

  it('forces rematerialized Codex threads through the managed Model Router provider', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await threadStore.upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-old',
      workspace: '/tmp/workspace',
      title: 'Recovered Codex'
    })
    const client = controllableClient()
    vi.mocked(client.startThread).mockResolvedValue({
      thread: { id: 'codex-thread-new', cwd: '/tmp/workspace' }
    })
    vi.mocked(client.startTurn)
      .mockRejectedValueOnce(new Error('thread not found: codex-thread-old'))
      .mockResolvedValueOnce({
        turn: { id: 'turn-1', userMessageItemId: 'user-1' }
      })
    const service = new CodexRuntimeService({
      settings: async () => ({
        ...settings(),
        agents: {
          ...settings().agents,
          codex: {
            ...defaultCodexRuntimeSettings(),
            model: 'external-runtime-model',
            modelProvider: 'external-runtime-provider'
          }
        }
      }),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(
      service.startTurn({
        threadId: 'gui-thread-1',
        text: 'hello',
        model: 'external-payload-model'
      })
    ).resolves.toMatchObject({
      ok: true,
      threadId: 'gui-thread-1',
      turnId: 'turn-1'
    })

    expect(client.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
        modelProvider: DEFAULT_MODEL_ROUTER_PROVIDER_ID
      })
    )
    expect(client.startThread).not.toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'external-runtime-model',
        modelProvider: 'external-runtime-provider'
      })
    )
    expect(client.startTurn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        threadId: 'codex-thread-old',
        model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
      })
    )
    expect(client.startTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        threadId: 'codex-thread-new',
        model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
      })
    )
    expect(vi.mocked(client.startTurn).mock.calls[0]?.[0]).not.toHaveProperty('modelProvider')
    expect(vi.mocked(client.startTurn).mock.calls[1]?.[0]).not.toHaveProperty('modelProvider')
    expect(vi.mocked(client.startTurn).mock.calls[1]?.[0].responsesapiClientMetadata).toEqual(
      vi.mocked(client.startTurn).mock.calls[0]?.[0].responsesapiClientMetadata
    )
  })

  it('passes explicit app-server reasoning params through thread and turn starts', async () => {
    const client = controllableClient()
    vi.mocked(client.listModels).mockResolvedValue({
      data: [{
        id: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
        model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
        displayName: 'Runtime Default',
        description: 'Discovered at runtime',
        hidden: false,
        isDefault: true,
        supportedReasoningEfforts: [
          { reasoningEffort: 'medium', description: 'Balanced' },
          { reasoningEffort: 'high', description: 'Deep' }
        ],
        defaultReasoningEffort: 'medium',
        inputModalities: ['text'],
        serviceTiers: [],
        defaultServiceTier: null
      }],
      nextCursor: null
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.startThread({
      title: 'Reasoning thread',
      reasoningEffort: 'medium'
    })).resolves.toMatchObject({
      ok: true
    })
    await expect(
      service.startTurn({
        threadId: 'thread-1',
        text: 'think carefully',
        reasoningEffort: 'high',
        outputSchema: {
          type: 'object',
          properties: { answer: { type: 'string' } },
          required: ['answer'],
          additionalProperties: false
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })

    expect(client.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        config: {
          model_reasoning_effort: 'medium',
          show_raw_agent_reasoning: true,
          model_reasoning_summary: 'detailed'
        }
      })
    )
    expect(client.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        effort: 'high',
        summary: 'detailed',
        outputSchema: {
          type: 'object',
          properties: { answer: { type: 'string' } },
          required: ['answer'],
          additionalProperties: false
        }
      })
    )
  })

  it('rematerializes an empty stored GUI thread when its app-server thread is missing', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await threadStore.upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-old',
      workspace: '/tmp/workspace',
      title: 'Recovered Codex'
    })
    const client = controllableClient()
    vi.mocked(client.startThread).mockResolvedValue({
      thread: { id: 'codex-thread-new', cwd: '/tmp/workspace' }
    })
    vi.mocked(client.startTurn)
      .mockRejectedValueOnce(new Error('thread not found: codex-thread-old'))
      .mockResolvedValueOnce({
        turn: { id: 'turn-1', userMessageItemId: 'user-1' }
      })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    const outputSchema = {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false
    }
    await expect(service.startTurn({
      threadId: 'gui-thread-1',
      text: 'hello',
      outputSchema
    })).resolves.toMatchObject({
      ok: true,
      threadId: 'gui-thread-1',
      turnId: 'turn-1'
    })

    expect(client.startTurn).toHaveBeenNthCalledWith(1, expect.objectContaining({
      threadId: 'codex-thread-old',
      outputSchema
    }))
    expect(client.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/tmp/workspace',
        serviceName: 'SciForge',
        ephemeral: false
      })
    )
    expect(client.startTurn).toHaveBeenNthCalledWith(2, expect.objectContaining({
      threadId: 'codex-thread-new',
      outputSchema
    }))
    await expect(threadStore.get('gui-thread-1')).resolves.toMatchObject({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-new'
    })
    vi.mocked(client.listThreads).mockResolvedValueOnce({
      threads: [
        {
          id: 'codex-thread-new',
          name: 'Recovered Codex',
          cwd: '/tmp/workspace',
          status: 'idle'
        }
      ]
    })
    await expect(service.listThreads({ includeArchived: true })).resolves.toMatchObject({
      ok: true,
      threads: [
        expect.objectContaining({
          id: 'gui-thread-1',
          codexThreadId: 'codex-thread-new',
          title: 'Recovered Codex'
        })
      ]
    })
    const events = await new CodexEventStore({ rootDir: storageRoot }).read('gui-thread-1', { includeAll: true })
    expect(events.map((item) => item.event.runtimeStatus?.phase).filter(Boolean)).toEqual([
      'process_start',
      'initialize_start',
      'initialize_done',
      'turn_start_sent'
    ])
    expect(events.at(-1)?.event).toMatchObject({
      threadId: 'gui-thread-1',
      userMessage: {
        itemId: 'user-1',
        text: 'hello'
      }
    })
  })

  it('rematerializes an empty stored GUI thread with only runtime status history', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await threadStore.upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-old',
      workspace: '/tmp/workspace',
      title: 'Status-only Codex'
    })
    await new CodexEventStore({ rootDir: storageRoot }).append('gui-thread-1', {
      threadId: 'gui-thread-1',
      runtimeStatus: {
        itemId: 'status-1',
        phase: 'thread_start_done',
        message: 'Codex thread ready'
      }
    })
    await threadStore.updateLatestSeq('gui-thread-1', 1)
    const client = controllableClient()
    vi.mocked(client.startThread).mockResolvedValue({
      thread: { id: 'codex-thread-new', cwd: '/tmp/workspace' }
    })
    vi.mocked(client.startTurn)
      .mockRejectedValueOnce(new Error('thread not found: codex-thread-old'))
      .mockResolvedValueOnce({
        turn: { id: 'turn-1', userMessageItemId: 'user-1' }
      })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.startTurn({ threadId: 'gui-thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      threadId: 'gui-thread-1',
      turnId: 'turn-1',
      userMessageItemId: 'user-1'
    })

    expect(client.startTurn).toHaveBeenNthCalledWith(1, expect.objectContaining({ threadId: 'codex-thread-old' }))
    expect(client.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/tmp/workspace',
        serviceName: 'SciForge',
        ephemeral: false
      })
    )
    expect(client.startTurn).toHaveBeenNthCalledWith(2, expect.objectContaining({ threadId: 'codex-thread-new' }))
    await expect(threadStore.get('gui-thread-1')).resolves.toMatchObject({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-new'
    })
  })

  it('materializes a missing GUI thread mapping when app-server rejects the optimistic thread id', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    const client = controllableClient()
    vi.mocked(client.startThread).mockResolvedValue({
      thread: { id: 'codex-thread-new', cwd: '/tmp/workspace' }
    })
    vi.mocked(client.startTurn)
      .mockRejectedValueOnce(new Error('thread not found: gui-thread-1'))
      .mockResolvedValueOnce({
        turn: { id: 'turn-1', userMessageItemId: 'user-1' }
      })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.startTurn({ threadId: 'gui-thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      threadId: 'gui-thread-1',
      turnId: 'turn-1'
    })

    expect(client.startTurn).toHaveBeenNthCalledWith(1, expect.objectContaining({ threadId: 'gui-thread-1' }))
    expect(client.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/tmp/workspace',
        serviceName: 'SciForge',
        ephemeral: false
      })
    )
    expect(client.startTurn).toHaveBeenNthCalledWith(2, expect.objectContaining({ threadId: 'codex-thread-new' }))
    await expect(threadStore.get('gui-thread-1')).resolves.toMatchObject({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-new'
    })
  })

  it('rematerializes a stored GUI thread in place when local event history is non-empty', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await threadStore.upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-old',
      workspace: '/tmp/workspace',
      title: 'Existing Codex'
    })
    await new CodexEventStore({ rootDir: storageRoot }).append('gui-thread-1', {
      threadId: 'gui-thread-1',
      userMessage: {
        itemId: 'user-existing',
        turnId: 'turn-existing',
        createdAt: '2026-06-11T00:00:00.000Z',
        text: 'previous context'
      }
    })
    const client = controllableClient()
    vi.mocked(client.startThread).mockResolvedValue({
      thread: { id: 'codex-thread-new', cwd: '/tmp/workspace' }
    })
    vi.mocked(client.startTurn)
      .mockRejectedValueOnce(new Error('thread not found: codex-thread-old'))
      .mockResolvedValueOnce({
        turn: { id: 'turn-1', userMessageItemId: 'user-1' }
      })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.startTurn({ threadId: 'gui-thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      threadId: 'gui-thread-1',
      turnId: 'turn-1',
      userMessageItemId: 'user-1'
    })

    expect(client.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/tmp/workspace',
        serviceName: 'SciForge',
        ephemeral: false
      })
    )
    expect(client.startTurn).toHaveBeenNthCalledWith(2, expect.objectContaining({
      input: [expect.objectContaining({ text: expect.stringContaining('previous context') })]
    }))
    await expect(threadStore.get('gui-thread-1')).resolves.toMatchObject({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-new'
    })
    const events = await new CodexEventStore({ rootDir: storageRoot }).read('gui-thread-1', { includeAll: true })
    expect(events.map((item) => item.event.userMessage?.text).filter(Boolean)).toEqual(['previous context', 'hello'])
  })

  it('resumes a persisted native Codex thread before rebuilding it', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await threadStore.upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-old',
      workspace: '/tmp/workspace',
      title: 'Existing Codex'
    })
    const client = controllableClient()
    const resumeThread = vi.fn(async () => ({ thread: { id: 'codex-thread-old' } }))
    client.resumeThread = resumeThread
    vi.mocked(client.startTurn)
      .mockRejectedValueOnce(new Error('thread not found: codex-thread-old'))
      .mockResolvedValueOnce({ turn: { id: 'turn-1', userMessageItemId: 'user-1' } })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.startTurn({ threadId: 'gui-thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })

    expect(resumeThread).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'codex-thread-old'
    }))
    expect(client.startThread).not.toHaveBeenCalled()
    expect(client.startTurn).toHaveBeenNthCalledWith(2, expect.objectContaining({
      threadId: 'codex-thread-old'
    }))
  })

  it.each([
    {
      name: 'assistant delta',
      event: {
        threadId: 'gui-thread-1',
        deltas: [{ kind: 'agent_message' as const, text: 'previous response' }]
      }
    },
    {
      name: 'tool event',
      event: {
        threadId: 'gui-thread-1',
        tool: {
          itemId: 'tool-existing',
          summary: 'Previous tool',
          status: 'success' as const
        }
      }
    },
    {
      name: 'runtime error',
      event: {
        threadId: 'gui-thread-1',
        runtimeError: {
          itemId: 'error-existing',
          message: 'previous failure'
        }
      }
    }
  ] satisfies Array<{ name: string; event: CodexThreadEventPayload }>)(
    'rematerializes a stored GUI thread when local $name history is non-empty',
    async ({ event }) => {
      const storageRoot = await tempRoot()
      const threadStore = new CodexThreadStore({ rootDir: storageRoot })
      await threadStore.upsert({
        guiThreadId: 'gui-thread-1',
        codexThreadId: 'codex-thread-old',
        workspace: '/tmp/workspace',
        title: 'Existing Codex'
      })
      await new CodexEventStore({ rootDir: storageRoot }).append('gui-thread-1', event)
      const client = controllableClient()
      vi.mocked(client.startThread).mockResolvedValue({
        thread: { id: 'codex-thread-new', cwd: '/tmp/workspace' }
      })
      vi.mocked(client.startTurn)
        .mockRejectedValueOnce(new Error('thread not found: codex-thread-old'))
        .mockResolvedValueOnce({
          turn: { id: 'turn-1', userMessageItemId: 'user-1' }
        })
      const service = new CodexRuntimeService({
        settings: async () => settings(),
        storageRoot,
        probeRuntime: availableTestRuntime,
        createClient: () => client
      })

      await expect(service.startTurn({ threadId: 'gui-thread-1', text: 'hello' })).resolves.toMatchObject({
        ok: true,
        threadId: 'gui-thread-1',
        turnId: 'turn-1'
      })

      expect(client.startThread).toHaveBeenCalled()
      await expect(threadStore.get('gui-thread-1')).resolves.toMatchObject({
        guiThreadId: 'gui-thread-1',
        codexThreadId: 'codex-thread-new'
      })
    }
  )

  it('materializes a missing GUI thread mapping when local event history is non-empty', async () => {
    const storageRoot = await tempRoot()
    await new CodexEventStore({ rootDir: storageRoot }).append('gui-thread-1', {
      threadId: 'gui-thread-1',
      userMessage: {
        itemId: 'user-existing',
        turnId: 'turn-existing',
        createdAt: '2026-06-11T00:00:00.000Z',
        text: 'previous context'
      }
    })
    const client = controllableClient()
    vi.mocked(client.startThread).mockResolvedValue({
      thread: { id: 'codex-thread-new', cwd: '/tmp/workspace' }
    })
    vi.mocked(client.startTurn)
      .mockRejectedValueOnce(new Error('thread not found: gui-thread-1'))
      .mockResolvedValueOnce({
        turn: { id: 'turn-1', userMessageItemId: 'user-1' }
      })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.startTurn({ threadId: 'gui-thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      threadId: 'gui-thread-1',
      turnId: 'turn-1'
    })

    expect(client.startThread).toHaveBeenCalled()
    await expect(new CodexThreadStore({ rootDir: storageRoot }).get('gui-thread-1')).resolves.toMatchObject({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-new'
    })
  })

  it('returns the app-server user message item id from Codex turn start', async () => {
    const client = controllableClient()
    vi.mocked(client.startTurn).mockResolvedValueOnce({
      turn: { id: 'turn-1', userMessageItemId: 'user-from-app-server' }
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      threadId: 'thread-1',
      turnId: 'turn-1',
      userMessageItemId: 'user-from-app-server'
    })
  })

  it('persists display text separately from expanded Codex turn input', async () => {
    const storageRoot = await tempRoot()
    const client = controllableClient()
    vi.mocked(client.startTurn).mockResolvedValueOnce({
      turn: { id: 'turn-1', userMessageItemId: 'user-1' }
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(
      service.startTurn({
        threadId: 'thread-1',
        text: 'expanded runtime prompt',
        displayText: 'short user prompt',
        metadata: {
          source: 'collaboration.remote-session-projection',
          sourceLabel: '手机 Zulip · 私人 Channel / Topic 22'
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      threadId: 'thread-1',
      turnId: 'turn-1'
    })

    expect(client.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        input: [
          {
            type: 'text',
            text: 'expanded runtime prompt',
            text_elements: []
          }
        ]
      })
    )
    expect(vi.mocked(client.startTurn).mock.calls[0]?.[0]).not.toHaveProperty('displayText')
    const events = await new CodexEventStore({ rootDir: storageRoot }).read('thread-1', { includeAll: true })
    expect(events.at(-1)?.event.userMessage).toMatchObject({
      itemId: 'user-1',
      text: 'expanded runtime prompt',
      displayText: 'short user prompt',
      metadata: {
        source: 'collaboration.remote-session-projection',
        sourceLabel: '手机 Zulip · 私人 Channel / Topic 22'
      }
    })
    await expect(service.readThreadPage('thread-1')).resolves.toMatchObject({
      ok: true,
      detail: expect.objectContaining({
        blocks: [
          expect.objectContaining({
            kind: 'user',
            id: 'user-1',
            text: 'expanded runtime prompt',
            displayText: 'short user prompt',
            meta: {
              source: 'collaboration.remote-session-projection',
              sourceLabel: '手机 Zulip · 私人 Channel / Topic 22'
            }
          })
        ]
      })
    })
  })

  it('encodes structured workspace references with Codex-supported input variants', async () => {
    const client = controllableClient()
    const workspace = await realpath(await tempRoot())
    await mkdir(join(workspace, 'papers'), { recursive: true })
    await mkdir(join(workspace, 'figures'), { recursive: true })
    await writeFile(join(workspace, 'papers', 'notes.md'), 'notes')
    await writeFile(join(workspace, 'papers', 'large.pdf'), '%PDF fixture')
    await writeFile(join(workspace, 'figures', 'cell.png'), 'image fixture')
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(
      service.startTurn({
        threadId: 'thread-1',
        text: 'Analyze the references',
        workspace,
        fileReferences: [
          {
            path: 'papers',
            relativePath: 'papers',
            name: 'papers',
            kind: 'directory'
          },
          {
            path: 'papers/notes.md',
            relativePath: 'papers/notes.md',
            name: 'notes.md',
            kind: 'text',
            mimeType: 'text/markdown'
          },
          {
            path: 'papers/large.pdf',
            relativePath: 'papers/large.pdf',
            name: 'large.pdf',
            kind: 'pdf',
            mimeType: 'application/pdf'
          },
          {
            path: 'figures/cell.png',
            relativePath: 'figures/cell.png',
            name: 'cell.png',
            kind: 'image',
            mimeType: 'image/png'
          }
        ]
      })
    ).resolves.toMatchObject({ ok: true })

    const turnInputs = vi.mocked(client.startTurn).mock.calls[0]?.[0].input ?? []
    expect(turnInputs[0]).toEqual({
      type: 'text',
      text: 'Analyze the references',
      text_elements: []
    })
    expect(turnInputs[1]).toEqual(expect.objectContaining({
      type: 'text',
      text: expect.stringContaining('"relativePath":"papers/notes.md"')
    }))
    expect(turnInputs[2]).toEqual({
      type: 'localImage',
      path: join(workspace, 'figures', 'cell.png')
    })
    expect(turnInputs.some((item) => item.type === 'mention')).toBe(false)
  })

  it('uses native Codex compaction for a persisted thread', async () => {
    const storageRoot = await tempRoot()
    await new CodexThreadStore({ rootDir: storageRoot }).upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-1',
      workspace: '/tmp/workspace',
      title: 'Long Codex thread'
    })
    const client = controllableClient()
    const createClient = vi.fn(() => client)
    const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime,
      settings: async () => settings(),
      storageRoot,
      createClient
    })

    await expect(service.compactThread('gui-thread-1')).resolves.toEqual({
      ok: true
    })

    expect(client.compactThread).toHaveBeenCalledWith({ threadId: 'codex-thread-1' })
    expect(client.startThread).not.toHaveBeenCalled()
  })

  it('reports unsupported native compact instead of rebuilding the backend thread', async () => {
    const storageRoot = await tempRoot()
    await new CodexThreadStore({ rootDir: storageRoot }).upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-old',
      workspace: '/tmp/workspace',
      title: 'Long Codex thread'
    })
    const client = controllableClient()
    vi.mocked(client.compactThread).mockRejectedValue(new Error('Method not found: thread/compact/start'))
    const createClient = vi.fn(() => client)
    const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime,
      settings: async () => settings(),
      storageRoot,
      createClient
    })

    await expect(service.compactThread('gui-thread-1', 'auto context compaction')).resolves.toMatchObject({
      ok: false,
      code: 'not_implemented'
    })
    expect(client.startThread).not.toHaveBeenCalled()
    expect(client.startTurn).not.toHaveBeenCalled()
    await expect(new CodexThreadStore({ rootDir: storageRoot }).get('gui-thread-1')).resolves.toMatchObject({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-old',
      workspace: '/tmp/workspace',
      title: 'Long Codex thread'
    })
  })

  it('edits history in the same durable session and forks before the replaced turn', async () => {
    const storageRoot = await tempRoot()
    const threadId = 'stable-session'
    const store = new CodexThreadStore({ rootDir: storageRoot })
    const journal = new CodexEventStore({ rootDir: storageRoot })
    for (const index of [1, 2, 3]) {
      await journal.append(threadId, {
        threadId, turnId: `turn-${index}`,
        userMessage: { itemId: `user-${index}`, turnId: `turn-${index}`, text: `question-${index}` }
      })
      await journal.append(threadId, {
        threadId, turnId: `turn-${index}`,
        deltas: [{ kind: 'agent_message', text: `answer-${index}` }]
      })
    }
    await store.upsert({
      guiThreadId: threadId, codexThreadId: 'backend-original',
      title: 'Keep my title', workspace: '/tmp/workspace',
      latestSeq: 6, latestTurnId: 'turn-3', latestUserMessageId: 'user-3', latestTurnStatus: 'completed'
    })
    const client = controllableClient()
    vi.mocked(client.request).mockResolvedValue({ thread: { id: 'backend-edited' } })
    const service = new CodexRuntimeService({
      settings: async () => settings(), storageRoot, probeRuntime: availableTestRuntime, createClient: () => client
    })
    await expect(service.forkThread(threadId, { replaceFromUserMessageId: 'user-2' })).resolves.toMatchObject({
      ok: true, thread: { id: threadId, title: 'Keep my title', codexThreadId: 'backend-edited' }
    })
    expect(client.request).toHaveBeenCalledWith('thread/fork', expect.objectContaining({
      threadId: 'backend-original', beforeTurnId: 'turn-2', deferGoalContinuation: true
    }))
    expect(client.startThread).not.toHaveBeenCalled()
    const restarted = new CodexRuntimeService({
      settings: async () => settings(), storageRoot, probeRuntime: availableTestRuntime, createClient: () => client
    })
    await expect(restarted.readThreadPage(threadId)).resolves.toMatchObject({
      ok: true, detail: { latestSeq: 7, blocks: [
        expect.objectContaining({ kind: 'user', text: 'question-1' }),
        expect.objectContaining({ kind: 'assistant', text: 'answer-1' })
      ] }
    })
    expect(await new CodexThreadStore({ rootDir: storageRoot }).list()).toHaveLength(1)
    const revision = join(storageRoot, 'history-revisions', Buffer.from(threadId).toString('base64url'),
      `${Buffer.from('backend-edited').toString('base64url')}.jsonl`)
    expect(await readFile(revision, 'utf8')).toContain('question-3')
    // Re-edit the first question after a restart: retain no previous dialogue.
    vi.mocked(client.request).mockResolvedValue({ thread: { id: 'backend-edited-again' } })
    await expect(restarted.forkThread(threadId, { replaceFromUserMessageId: 'user-1' })).resolves.toMatchObject({
      ok: true, thread: { id: threadId, title: 'Keep my title' }
    })
    expect(client.request).toHaveBeenLastCalledWith('thread/fork', expect.objectContaining({
      threadId: 'backend-edited', beforeTurnId: 'turn-1'
    }))
    await expect(restarted.readThreadPage(threadId)).resolves.toMatchObject({ ok: true, detail: { blocks: [] } })
    const next = await new CodexEventStore({ rootDir: storageRoot }).append(threadId, {
      threadId, userMessage: { itemId: 'edited', text: 'new question' }
    })
    expect(next.seq).toBeGreaterThan(7)
  })

  it('leaves session history intact when native context forking fails', async () => {
    const storageRoot = await tempRoot()
    const store = new CodexThreadStore({ rootDir: storageRoot })
    const journal = new CodexEventStore({ rootDir: storageRoot })
    await store.upsert({ guiThreadId: 'session', codexThreadId: 'original', title: 'Original' })
    await journal.append('session', { threadId: 'session', turnId: 'turn',
      userMessage: { itemId: 'user', text: 'Original question' } })
    const before = await journal.read('session', { includeAll: true })
    const client = controllableClient()
    vi.mocked(client.request).mockRejectedValue(new Error('Fork failed'))
    const service = new CodexRuntimeService({
      settings: async () => settings(), storageRoot, probeRuntime: availableTestRuntime, createClient: () => client
    })
    await expect(service.forkThread('session', { replaceFromUserMessageId: 'user' })).resolves.toMatchObject({ ok: false })
    expect(await new CodexEventStore({ rootDir: storageRoot }).read('session', { includeAll: true })).toEqual(before)
    expect(await new CodexThreadStore({ rootDir: storageRoot }).get('session')).toMatchObject({ codexThreadId: 'original' })
  })

  it('rebuilds a native context when the edited turn was discarded by compaction', async () => {
    const storageRoot = await tempRoot()
    const store = new CodexThreadStore({ rootDir: storageRoot })
    const journal = new CodexEventStore({ rootDir: storageRoot })
    await store.upsert({
      guiThreadId: 'session', codexThreadId: 'materialized-after-compaction',
      title: 'Original', workspace: '/tmp/workspace', latestSeq: 4,
      latestTurnId: 'turn-2', latestTurnStatus: 'completed'
    })
    await journal.append('session', {
      threadId: 'session', turnId: 'turn-1',
      userMessage: { itemId: 'user-1', turnId: 'turn-1', text: 'full prompt', displayText: 'Remember MAPLE17' }
    })
    await journal.append('session', {
      threadId: 'session', turnId: 'turn-1',
      deltas: [{ kind: 'agent_message', text: 'Acknowledged.' }]
    })
    await journal.append('session', {
      threadId: 'session', turnId: 'turn-2',
      userMessage: { itemId: 'user-2', turnId: 'turn-2', text: 'old prompt', displayText: 'Remember RED42' }
    })
    await journal.append('session', {
      threadId: 'session', turnId: 'turn-2',
      deltas: [{ kind: 'agent_message', text: 'Old answer.' }]
    })
    const client = controllableClient()
    vi.mocked(client.request).mockRejectedValue(new Error("beforeTurnId 'turn-1' was not found in the source thread"))
    vi.mocked(client.startThread).mockResolvedValue({ thread: { id: 'rebuilt-native' } })
    vi.mocked(client.startTurn).mockResolvedValue({ turn: { id: 'turn-edited' } })
    const service = new CodexRuntimeService({
      settings: async () => settings(), storageRoot, probeRuntime: availableTestRuntime, createClient: () => client
    })

    await expect(service.forkThread('session', { replaceFromUserMessageId: 'user-2' }))
      .resolves.toMatchObject({ ok: true, thread: { id: 'session', codexThreadId: 'rebuilt-native' } })
    await expect(service.startTurn({ threadId: 'session', text: 'What is the code?', displayText: 'What is the code?' }))
      .resolves.toMatchObject({ ok: true, turnId: 'turn-edited' })
    const request = vi.mocked(client.startTurn).mock.calls[0]?.[0]
    const inputText = (request?.input as Array<{ type?: string; text?: string }>)
      .find((item) => item.type === 'text')?.text ?? ''
    expect(inputText).toContain('full prompt')
    expect(inputText).toContain('What is the code?')
    expect(inputText).toContain('Prior conversation context')
  })

  it('persists staged history replays on disk and consumes them exactly once across service restarts', async () => {
    const storageRoot = await tempRoot()
    const store = new CodexThreadStore({ rootDir: storageRoot })
    const journal = new CodexEventStore({ rootDir: storageRoot })
    await store.upsert({
      guiThreadId: 'session', codexThreadId: 'materialized-after-compaction',
      title: 'Original', workspace: '/tmp/workspace', latestSeq: 4,
      latestTurnId: 'turn-2', latestTurnStatus: 'completed'
    })
    await journal.append('session', {
      threadId: 'session', turnId: 'turn-1',
      userMessage: { itemId: 'user-1', turnId: 'turn-1', text: 'full prompt', displayText: 'Remember MAPLE17' }
    })
    await journal.append('session', {
      threadId: 'session', turnId: 'turn-1',
      deltas: [{ kind: 'agent_message', text: 'Acknowledged.' }]
    })
    await journal.append('session', {
      threadId: 'session', turnId: 'turn-2',
      userMessage: { itemId: 'user-2', turnId: 'turn-2', text: 'old prompt', displayText: 'Remember RED42' }
    })
    await journal.append('session', {
      threadId: 'session', turnId: 'turn-2',
      deltas: [{ kind: 'agent_message', text: 'Old answer.' }]
    })
    const client = controllableClient()
    vi.mocked(client.request).mockRejectedValue(new Error("beforeTurnId 'turn-1' was not found in the source thread"))
    vi.mocked(client.startThread).mockResolvedValue({ thread: { id: 'rebuilt-native' } })
    vi.mocked(client.startTurn).mockResolvedValue({ turn: { id: 'turn-edited' } })
    const service = new CodexRuntimeService({
      settings: async () => settings(), storageRoot, probeRuntime: availableTestRuntime, createClient: () => client
    })

    await expect(service.forkThread('session', { replaceFromUserMessageId: 'user-2' }))
      .resolves.toMatchObject({ ok: true, thread: { id: 'session', codexThreadId: 'rebuilt-native' } })
    const pendingPath = join(
      storageRoot,
      'pending-history-replays',
      `${Buffer.from('session').toString('base64url')}.txt`
    )
    await expect(readFile(pendingPath, 'utf8')).resolves.toContain('full prompt')

    const restarted = new CodexRuntimeService({
      settings: async () => settings(), storageRoot, probeRuntime: availableTestRuntime, createClient: () => client
    })
    await expect(restarted.startTurn({ threadId: 'session', text: 'What is the code?', displayText: 'What is the code?' }))
      .resolves.toMatchObject({ ok: true, turnId: 'turn-edited' })
    const request = vi.mocked(client.startTurn).mock.calls.at(-1)?.[0]
    const inputText = (request?.input as Array<{ type?: string; text?: string }>)
      .find((item) => item.type === 'text')?.text ?? ''
    expect(inputText).toContain('full prompt')
    expect(inputText).toContain('Prior conversation context')
    await expect(readFile(pendingPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    await expect(restarted.startTurn({ threadId: 'session', text: 'Next question', displayText: 'Next question' }))
      .resolves.toMatchObject({ ok: true, turnId: 'turn-edited' })
    const nextRequest = vi.mocked(client.startTurn).mock.calls.at(-1)?.[0]
    const nextInputText = (nextRequest?.input as Array<{ type?: string; text?: string }>)
      .find((item) => item.type === 'text')?.text ?? ''
    expect(nextInputText).not.toContain('full prompt')
    expect(nextInputText).not.toContain('Prior conversation context')
  })

  it('supports fork and keeps resume closed with structured recoverable errors', async () => {
    const client = controllableClient()
    vi.mocked(client.request).mockResolvedValue({ thread: { id: 'native-fork' } })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.forkThread('thread-1', {
      relation: 'fork',
      parentTurnId: 'turn-older',
      title: 'Edited branch'
    })).resolves.toMatchObject({
      ok: true,
      thread: {
        relation: 'fork',
        parentThreadId: 'thread-1',
        parentTurnId: 'turn-older',
        title: 'Edited branch'
      }
    })
    expect(client.request).toHaveBeenCalledWith('thread/fork', expect.objectContaining({
      threadId: 'thread-1',
      lastTurnId: 'turn-older'
    }))
    expect(client.startThread).not.toHaveBeenCalled()
    await expect(service.resumeSession('session-1')).resolves.toEqual({
      ok: false,
      code: 'not_implemented',
      message: 'Codex session resume is not supported yet.',
      recoverable: true
    })
  })

  it('interrupts then closes the app-server session when discard is requested', async () => {
    const client = controllableClient()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    await expect(service.interruptTurn('thread-1', 'turn-1', { discard: true })).resolves.toEqual({ ok: true })

    expect(client.interruptTurn).toHaveBeenCalledWith({
      threadId: 'thread-1',
      turnId: 'turn-1'
    })
    expect(client.stop).toHaveBeenCalled()
  })

  it('rejects stale Codex control targets before calling app-server', async () => {
    const client = controllableClient()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    vi.mocked(client.interruptTurn).mockClear()
    vi.mocked(client.steerTurn).mockClear()

    await expect(service.interruptTurn('thread-1', 'old-turn')).resolves.toEqual({
      ok: false,
      code: 'turn_not_running',
      message: 'Codex turn old-turn is not the active turn for thread thread-1.',
      recoverable: true
    })
    await expect(
      service.steerTurn({
        threadId: 'thread-1',
        turnId: 'old-turn',
        text: 'continue'
      })
    ).resolves.toEqual({
      ok: false,
      code: 'turn_not_running',
      message: 'Codex turn old-turn is not the active turn for thread thread-1.',
      recoverable: true
    })

    expect(client.interruptTurn).not.toHaveBeenCalled()
    expect(client.steerTurn).not.toHaveBeenCalled()
  })

  it('persists active turn governance for the Codex pre-tool bridge and removes it on stop', async () => {
    const storageRoot = await tempRoot()
    const client = controllableClient()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })
    const bridge = new CodexPreToolUseGovernanceBridge({ storageRoot })

    await expect(
      service.startTurn({
        threadId: 'thread-1',
        text: 'inspect the visual',
        ownedVisualToolsAvailable: true
      })
    ).resolves.toMatchObject({ ok: true, turnId: 'turn-1' })
    await expect(
      service.updateTurnGovernanceSnapshot({
        runtimeId: 'codex',
        threadId: 'thread-1',
        turnId: 'turn-1',
        snapshot: {
          ownedVisualToolsAvailable: true,
          nativeVisualProofChainPending: true
        }
      })
    ).resolves.toEqual({ ok: true })
    await expect(
      bridge.evaluate({
        hook_event_name: 'PreToolUse',
        session_id: 'session-1',
        turn_id: 'turn-1',
        tool_name: 'Bash',
        tool_use_id: 'call-1',
        tool_input: { command: 'python inspect.py' },
        cwd: '/tmp/workspace'
      })
    ).resolves.toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('native_visual_proof_chain_required')
      }
    })

    await service.stop()
    await expect(
      bridge.evaluate({
        hook_event_name: 'PreToolUse',
        session_id: 'session-1',
        turn_id: 'turn-1',
        tool_name: 'Bash',
        tool_use_id: 'call-2',
        tool_input: { command: 'python inspect.py' },
        cwd: '/tmp/workspace'
      })
    ).resolves.toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('native_visual_governance_unavailable')
      }
    })
  })

  it('seeds owned visual policy before the first Codex tool can run', async () => {
    const storageRoot = await tempRoot()
    const client = controllableClient()
    const bridge = new CodexPreToolUseGovernanceBridge({ storageRoot })
    let preDispatchDecision: Awaited<ReturnType<typeof bridge.evaluate>> | undefined
    vi.mocked(client.startTurn).mockImplementation(async (params) => {
      preDispatchDecision = await bridge.evaluate({
        hook_event_name: 'PreToolUse',
        session_id: params.threadId,
        turn_id: 'turn-not-materialized-yet',
        tool_name: 'Bash',
        tool_use_id: 'call-before-start-response',
        tool_input: { command: 'screencapture -x /tmp/window.png' },
        cwd: '/tmp/workspace'
      })
      return { turn: { id: 'turn-1' } }
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      capabilityAgentTools: {} as AgentRuntimeToolSurface,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(
      service.startTurn({
        threadId: 'thread-1',
        text: 'inspect the visual',
        ownedVisualToolsAvailable: true
      })
    ).resolves.toMatchObject({ ok: true, turnId: 'turn-1' })
    expect(preDispatchDecision).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('owned_visual_policy_denied')
      }
    })
  })

  it('clears the active Codex turn after a terminal runtime event', async () => {
    const queued = clientWithQueuedEvents()
    const broadcast = captureBroadcastEvents()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => queued.client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'turn/completed',
        params: { threadId: 'thread-1', turnId: 'turn-1' }
      }
    })
    await vi.waitFor(() => {
      expect(broadcast).toHaveBeenCalledWith({
        threadId: 'thread-1',
        turnId: 'turn-1',
        turnComplete: true,
        turnDiagnostics: { source: 'codex_app_server' }
      })
    })
    vi.mocked(queued.client.interruptTurn).mockClear()

    await expect(service.interruptTurn('thread-1', 'turn-1')).resolves.toEqual({
      ok: false,
      code: 'turn_not_running',
      message: 'No active Codex turn is running for thread thread-1.',
      recoverable: true
    })
    expect(queued.client.interruptTurn).not.toHaveBeenCalled()
    queued.close()
  })

  it('keeps the active Codex turn open for transient recovery runtime errors', async () => {
    const queued = clientWithQueuedEvents()
    const broadcast = captureBroadcastEvents()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => queued.client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    broadcast.mockClear()
    vi.mocked(queued.client.interruptTurn).mockClear()

    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'error',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          error: {
            message: 'stream recovering',
            code: 'stream_recovering'
          }
        }
      }
    })
    await vi.waitFor(() => {
      expect(broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: 'thread-1',
          turnId: 'turn-1',
          runtimeStatus: expect.objectContaining({
            phase: 'stream_recovering',
            message: 'stream recovering'
          })
        })
      )
    })

    expect(broadcast.mock.calls.some((call) => call[0]?.runtimeError?.code === 'stream_recovering')).toBe(false)
    expect(broadcast.mock.calls.some((call) => call[0]?.runtimeStatus?.phase === 'turn_done')).toBe(false)
    await expect(service.interruptTurn('thread-1', 'turn-1')).resolves.toEqual({
      ok: true
    })
    expect(queued.client.interruptTurn).toHaveBeenCalled()
    queued.close()
  })

  it('defers Codex turn completion until pending command execution items finish', async () => {
    const queued = clientWithQueuedEvents()
    const broadcast = captureBroadcastEvents()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => queued.client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'download pdf' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'item/started',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          item: {
            id: 'cmd-1',
            type: 'commandExecution',
            command: 'curl --max-time 45 https://arxiv.org/pdf/2605.26340v1',
            status: 'inProgress'
          }
        }
      }
    })
    await vi.waitFor(() => {
      expect(
        broadcast.mock.calls.some((call) => call[0]?.tool?.itemId === 'cmd-1' && call[0]?.tool?.status === 'running')
      ).toBe(true)
    })

    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        type: 'event_msg',
        payload: {
          type: 'task_complete',
          turn_id: 'turn-1'
        }
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(broadcast.mock.calls.some((call) => call[0]?.turnComplete === true)).toBe(false)

    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'item/completed',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          item: {
            id: 'cmd-1',
            type: 'commandExecution',
            command: 'curl --max-time 45 https://arxiv.org/pdf/2605.26340v1',
            status: 'failed',
            exitCode: 28,
            aggregatedOutput: ''
          }
        }
      }
    })

    await vi.waitFor(() => {
      expect(broadcast.mock.calls.some((call) => call[0]?.turnComplete === true)).toBe(true)
    })
    const sentEvents = broadcast.mock.calls.map((call) => call[0])
    const failedToolIndex = sentEvents.findIndex(
      (event) => event?.tool?.itemId === 'cmd-1' && event.tool.status === 'error' && event.tool.meta?.exitCode === 28
    )
    const turnCompleteIndex = sentEvents.findIndex((event) => event?.turnComplete === true)
    expect(failedToolIndex).toBeGreaterThanOrEqual(0)
    expect(turnCompleteIndex).toBeGreaterThan(failedToolIndex)
    queued.close()
  })

  it('fails closed after a grace period when a Codex tool completion is missing', async () => {
    vi.useFakeTimers()
    const queued = clientWithQueuedEvents()
    try {
      const broadcast = captureBroadcastEvents()
      const service = new CodexRuntimeService({
        settings: async () => settings(),
        probeRuntime: availableTestRuntime,
        createClient: () => queued.client
      })
      const barrierState = service as unknown as {
        deferredTurnCompleteEvents: Map<string, CodexThreadEventPayload>
      }

      await expect(service.startTurn({ threadId: 'thread-1', text: 'download pdf' })).resolves.toMatchObject({
        ok: true,
        turnId: 'turn-1'
      })
      queued.push({
        type: 'event',
        channel: CODEX_MAIN_IPC_CHANNELS.event,
        payload: {
          method: 'item/started',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            item: {
              id: 'cmd-1',
              type: 'commandExecution',
              command: 'curl --max-time 45 https://arxiv.org/pdf/2605.26340v1',
              status: 'inProgress'
            }
          }
        }
      })
      await vi.waitFor(() => {
        expect(
          broadcast.mock.calls.some((call) => call[0]?.tool?.itemId === 'cmd-1' && call[0]?.tool?.status === 'running')
        ).toBe(true)
      })

      queued.push({
        type: 'event',
        channel: CODEX_MAIN_IPC_CHANNELS.event,
        payload: {
          type: 'event_msg',
          payload: {
            type: 'task_complete',
            turn_id: 'turn-1'
          }
        }
      })
      for (let index = 0; index < 10 && barrierState.deferredTurnCompleteEvents.size === 0; index += 1) {
        await Promise.resolve()
      }
      expect(barrierState.deferredTurnCompleteEvents.size).toBe(1)
      await vi.advanceTimersByTimeAsync(4_999)
      expect(broadcast.mock.calls.some((call) => call[0]?.turnComplete === true)).toBe(false)

      await vi.advanceTimersByTimeAsync(1)

      expect(broadcast.mock.calls.some((call) => call[0]?.turnComplete === true)).toBe(false)
      expect(
        broadcast.mock.calls.some(
          (call) =>
            call[0]?.runtimeError?.code === 'tool_execution_unresolved' &&
            call[0]?.runtimeError?.severity === 'error' &&
            (call[0]?.runtimeError?.details as { pendingCallIds?: string[] } | undefined)?.pendingCallIds?.includes('cmd-1')
        )
      ).toBe(true)
      await expect(service.interruptTurn('thread-1', 'turn-1')).resolves.toMatchObject({
        ok: false,
        code: 'turn_not_running'
      })
    } finally {
      queued.close()
      vi.useRealTimers()
    }
  })

  it('publishes synthetic runtime guard errors as runtime error events', async () => {
    const broadcast = captureBroadcastEvents()
    const service = new CodexRuntimeService({
      settings: async () => settings()
    })

    await expect(
      service.publishSyntheticEvent({
        kind: 'error',
        runtimeId: 'codex',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'runtime-guard-execution-governance-turn-1',
        recoverable: true,
        severity: 'error',
        code: 'runtime_execution_interrupted',
        message: 'Runtime guard stopped this turn after repeated command_execution:shell/fetch tool activity.',
        detail: 'The runtime interrupted the turn to prevent a repeated tool-call loop.'
      })
    ).resolves.toMatchObject({
      runtimeError: {
        itemId: 'runtime-guard-execution-governance-turn-1',
        code: 'runtime_execution_interrupted',
        severity: 'error'
      }
    })

    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeError: expect.objectContaining({
          message: expect.stringContaining('Runtime guard stopped this turn')
        })
      })
    )
  })

  it('persists and broadcasts synthetic child events for host-owned delegation', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await upsertMaterializedThread(threadStore, {
      guiThreadId: 'thread-1',
      codexThreadId: 'thread-1',
      workspace: '/tmp/workspace',
      title: 'Parent thread',
      latestTurnId: 'turn-newer'
    })
    await new CodexEventStore({ rootDir: storageRoot }).append('thread-1', {
      threadId: 'thread-1',
      turnId: 'turn-newer',
      userMessage: {
        itemId: 'user-newer',
        turnId: 'turn-newer',
        text: 'Newer parent turn'
      },
      turnComplete: true
    })
    const broadcast = captureBroadcastEvents()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => failingClient()
    })
    const subscriptionAbort = new AbortController()
    const subscription = service.subscribeEvents('thread-1', 1, subscriptionAbort.signal)[Symbol.asyncIterator]()
    const nextSubscribedEvent = subscription.next()

    const published = await service.publishSyntheticEvent({
      kind: 'child_event',
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-older',
      child: {
        runtimeId: 'codex',
        parentThreadId: 'thread-1',
        parentTurnId: 'turn-older',
        id: 'child-1',
        kind: 'agent',
        label: 'Paper reader',
        status: 'running',
        updatedAt: '2026-08-02T08:13:32.000Z'
      }
    })
    await expect(nextSubscribedEvent).resolves.toMatchObject({
      done: false,
      value: { child: { id: 'child-1', status: 'running' } }
    })
    subscriptionAbort.abort()

    expect(published).toMatchObject({
      threadId: 'thread-1',
      turnId: 'turn-older',
      child: {
        id: 'child-1',
        runtimeId: 'codex',
        status: 'running'
      }
    })
    await expect(service.readStoredEvents('thread-1')).resolves.toEqual([
      expect.objectContaining({
        turnId: 'turn-newer',
        userMessage: expect.objectContaining({ itemId: 'user-newer' }),
        turnComplete: true
      }),
      expect.objectContaining({
        child: expect.objectContaining({ id: 'child-1', status: 'running' })
      })
    ])
    await expect(threadStore.get('thread-1')).resolves.toMatchObject({
      latestTurnId: 'turn-newer'
    })
    await expect(service.readThreadPage('thread-1')).resolves.toMatchObject({
      ok: true,
      detail: { latestTurnId: 'turn-newer' }
    })
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        child: expect.objectContaining({ id: 'child-1', status: 'running' })
      })
    )
  })

  it('emits latency phase runtime status events around a Codex turn', async () => {
    const queued = clientWithQueuedEvents()
    const broadcast = captureBroadcastEvents()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => queued.client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'item/agentMessage/delta',
        params: { threadId: 'thread-1', turnId: 'turn-1', delta: 'hi' }
      }
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'turn/completed',
        params: { threadId: 'thread-1', turnId: 'turn-1' }
      }
    })

    await vi.waitFor(() => {
      const phases = broadcast.mock.calls.map((call) => call[0]?.runtimeStatus?.phase).filter(Boolean)
      expect(phases).toEqual(
        expect.arrayContaining([
          'process_start',
          'initialize_start',
          'initialize_done',
          'turn_start_sent',
          'first_delta',
          'turn_done'
        ])
      )
    })
    const firstDelta = broadcast.mock.calls.find((call) => call[0]?.runtimeStatus?.phase === 'first_delta')
    const turnDone = broadcast.mock.calls.find((call) => call[0]?.runtimeStatus?.phase === 'turn_done')
    expect(firstDelta?.[0].runtimeStatus?.latencyMs).toEqual(expect.any(Number))
    expect(turnDone?.[0].runtimeStatus?.latencyMs).toEqual(expect.any(Number))
    const sentEvents = broadcast.mock.calls.map((call) => call[0]).filter(Boolean)
    const assistantDeltaIndex = sentEvents.findIndex((event) =>
      event?.deltas?.some(
        (delta: NonNullable<CodexThreadEventPayload['deltas']>[number]) =>
          delta.kind === 'agent_message' && delta.text === 'hi'
      )
    )
    const firstDeltaStatusIndex = sentEvents.findIndex((event) => event?.runtimeStatus?.phase === 'first_delta')
    const turnCompleteIndex = sentEvents.findIndex((event) => event?.turnComplete === true)
    const turnDoneStatusIndex = sentEvents.findIndex((event) => event?.runtimeStatus?.phase === 'turn_done')
    expect(firstDeltaStatusIndex).toBeGreaterThan(assistantDeltaIndex)
    expect(turnDoneStatusIndex).toBeGreaterThan(turnCompleteIndex)
    queued.close()
  })

  it('keeps completed turn status terminal after turn_done and repairs stale running metadata', async () => {
    const queued = clientWithQueuedEvents()
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => queued.client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'turn/completed',
        params: { threadId: 'thread-1', turnId: 'turn-1' }
      }
    })

    await vi.waitFor(async () => {
      await expect(service.readThreadStatus('thread-1')).resolves.toMatchObject({
        ok: true,
        status: {
          latestTurnId: 'turn-1',
          latestTurnStatus: 'completed',
          status: 'completed'
        }
      })
    })
    await expect(threadStore.get('thread-1')).resolves.toMatchObject({
      latestTurnId: 'turn-1',
      latestTurnStatus: 'completed'
    })

    vi.mocked(queued.client.listThreads).mockResolvedValue({
      threads: [{
        id: 'thread-1',
        name: 'Thread 1',
        cwd: '/tmp/workspace',
        updatedAt: 1_786_233_600,
        latestTurnId: 'turn-1',
        turns: [{ id: 'turn-1', status: 'running' }]
      }]
    })
    await expect(service.listThreads({ includeArchived: true })).resolves.toMatchObject({
      ok: true,
      threads: [expect.objectContaining({
        id: 'thread-1',
        latestTurnId: 'turn-1',
        latestTurnStatus: 'completed',
        status: 'completed'
      })]
    })
    await expect(threadStore.get('thread-1')).resolves.toMatchObject({
      latestTurnId: 'turn-1',
      latestTurnStatus: 'completed'
    })

    const stored = await threadStore.get('thread-1')
    if (!stored) throw new Error('Expected persisted Codex thread metadata.')
    await writeFile(join(storageRoot, 'threads.json'), `${JSON.stringify({
      version: 1,
      threads: [{
        ...stored,
        latestTurnId: 'legacy-stale-turn-id',
        latestTurnStatus: 'stream_recovering'
      }]
    }, null, 2)}\n`, 'utf8')

    const restarted = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => failingClient()
    })
    await expect(restarted.readThreadStatus('thread-1')).resolves.toMatchObject({
      ok: true,
      status: {
        latestTurnId: 'turn-1',
        latestTurnStatus: 'completed',
        status: 'completed'
      }
    })
    await expect(threadStore.get('thread-1')).resolves.toMatchObject({
      latestTurnStatus: 'completed'
    })
    queued.close()
  })

  it('replays a provider-completed terminal boundary that was missed before restart', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    const eventStore = new CodexEventStore({ rootDir: storageRoot })
    await threadStore.upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-1',
      workspace: '/tmp/workspace',
      title: 'Interrupted event stream',
      latestTurnId: 'turn-1',
      latestTurnStatus: 'running'
    })
    await eventStore.append('gui-thread-1', {
      threadId: 'gui-thread-1',
      turnId: 'turn-1',
      userMessage: {
        itemId: 'user-1',
        turnId: 'turn-1',
        text: 'finish the work'
      }
    })
    const client = controllableClient()
    vi.mocked(client.readThread).mockResolvedValue({
      thread: {
        id: 'codex-thread-1',
        cwd: '/tmp/workspace',
        updatedAt: 1_787_304_000,
        turns: [{ id: 'turn-1', status: 'completed' }]
      }
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    const replayed: CodexThreadEventPayload[] = []
    for await (const event of service.subscribeEvents(
      'gui-thread-1',
      0,
      AbortSignal.timeout(1_000)
    )) {
      replayed.push(event)
      if (event.turnComplete) break
    }

    expect(client.readThread).toHaveBeenCalledWith({
      threadId: 'codex-thread-1',
      includeTurns: true
    })
    expect(replayed).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'gui-thread-1',
        turnId: 'turn-1',
        turnComplete: true,
        seq: 2,
        createdAt: expect.any(String)
      })
    ]))
    await expect(threadStore.get('gui-thread-1')).resolves.toMatchObject({
      latestSeq: 2,
      latestTurnId: 'turn-1',
      latestTurnStatus: 'completed'
    })
  })

  it('recovers a terminal boundary after the thread was rebound to an empty backend session', async () => {
    const storageRoot = await tempRoot()
    const eventStore = new CodexEventStore({ rootDir: storageRoot })
    await eventStore.append('gui-thread-1', {
      threadId: 'gui-thread-1',
      turnId: 'turn-before-rebind',
      userMessage: {
        itemId: 'user-before-rebind',
        turnId: 'turn-before-rebind',
        text: 'finish before the backend is rebound'
      }
    })
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await threadStore.upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'replacement-codex-thread',
      workspace: '/tmp/workspace',
      title: 'Rebound thread',
      latestSeq: 1,
      latestTurnStatus: 'completed'
    })
    const client = controllableClient()
    vi.mocked(client.readThread).mockRejectedValue(
      new Error('replacement backend has no turns')
    )
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    const replayed: CodexThreadEventPayload[] = []
    for await (const event of service.subscribeEvents(
      'gui-thread-1',
      0,
      AbortSignal.timeout(1_000)
    )) {
      replayed.push(event)
      if (event.turnComplete) break
    }

    expect(client.readThread).not.toHaveBeenCalled()
    expect(replayed).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'gui-thread-1',
        turnId: 'turn-before-rebind',
        turnComplete: true,
        seq: 2,
        createdAt: expect.any(String)
      })
    ]))
    await expect(threadStore.get('gui-thread-1')).resolves.toMatchObject({
      codexThreadId: 'replacement-codex-thread',
      latestSeq: 2,
      latestTurnId: 'turn-before-rebind',
      latestTurnStatus: 'completed'
    })
  })

  it('deduplicates redelivered sequence identities without suppressing equal incremental text', async () => {
    const queued = clientWithQueuedEvents()
    const broadcast = captureBroadcastEvents()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => queued.client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    for (const seq of [1, 2, 2]) {
      queued.push({
        type: 'event',
        channel: CODEX_MAIN_IPC_CHANNELS.event,
        payload: {
          method: 'item/agentMessage/delta',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            seq,
            delta: 'same increment'
          }
        }
      })
    }

    await vi.waitFor(() => {
      const deltaEvents = broadcast.mock.calls
        .map((call) => call[0])
        .filter((event) => event?.deltas?.some((delta: { text: string }) => delta.text === 'same increment'))
      expect(deltaEvents).toHaveLength(2)
    })
    const identities = [...modelDeltaDedupeProbe(service).states.values()].flatMap((state) => [...state.identities])
    expect(identities).toHaveLength(2)
    expect(identities.every((identity) => !identity.includes('same increment'))).toBe(true)

    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'turn/completed',
        params: { threadId: 'thread-1', turnId: 'turn-1' }
      }
    })
    await vi.waitFor(() => {
      expect(modelDeltaDedupeProbe(service).states.size).toBe(0)
    })
    queued.close()
  })

  it('drops a repeated completed reasoning snapshot but keeps distinct or later-turn reasoning', () => {
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => controllableClient()
    })
    const probe = modelDeltaDedupeProbe(service)
    probe.recordActiveTurn('thread-1', 'turn-1')
    const reasoning = (text: string, turnId = 'turn-1') => ({
      threadId: 'thread-1',
      turnId,
      deltas: [{ kind: 'agent_reasoning' as const, text, snapshot: true }]
    })

    expect(probe.dedupe(reasoning('Work out 17 times 23 step by step.'))).not.toBeNull()
    // The same completed reasoning item arriving through a second event shape must not render twice.
    expect(probe.dedupe(reasoning('Work out 17 times 23 step by step.'))).toBeNull()
    // Reasoning with different content in the same turn is still delivered.
    expect(probe.dedupe(reasoning('Then double-check the product.'))).not.toBeNull()

    probe.recordActiveTurn('thread-1', 'turn-2')
    expect(probe.dedupe(reasoning('Work out 17 times 23 step by step.', 'turn-2'))).not.toBeNull()
  })

  it('bounds per-turn delta identities and stores only fixed-size snapshot digests', () => {
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => controllableClient()
    })
    const probe = modelDeltaDedupeProbe(service)
    probe.recordActiveTurn('thread-1', 'turn-1')

    const snapshotText = `private snapshot ${'x'.repeat(4_096)}`
    expect(
      probe.dedupe({
        threadId: 'thread-1',
        turnId: 'turn-1',
        deltas: [{ kind: 'agent_message', text: snapshotText, snapshot: true }]
      })
    ).not.toBeNull()
    expect(
      probe.dedupe({
        threadId: 'thread-1',
        turnId: 'turn-1',
        deltas: [{ kind: 'agent_message', text: snapshotText, snapshot: true }]
      })
    ).toBeNull()

    for (let seq = 1; seq <= 4_200; seq += 1) {
      probe.dedupe({
        threadId: 'thread-1',
        turnId: 'turn-1',
        seq,
        deltas: [{ kind: 'agent_message', text: `increment-${seq}` }]
      })
    }
    const [state] = probe.states.values()
    expect(state?.identities.size).toBe(4_096)
    expect([...state!.identities].every((identity) => identity.length < 128)).toBe(true)
    expect([...state!.identities].every((identity) => !identity.includes(snapshotText))).toBe(true)

    for (let turnIndex = 2; turnIndex <= 70; turnIndex += 1) {
      const turnId = `turn-${turnIndex}`
      probe.recordActiveTurn(`thread-${turnIndex}`, turnId)
      probe.dedupe({
        threadId: `thread-${turnIndex}`,
        turnId,
        seq: 1,
        deltas: [{ kind: 'agent_message', text: 'increment' }]
      })
    }
    expect(probe.states.size).toBe(64)
  })

  it.each([
    { method: 'turn/cancelled', params: { reason: 'user interrupted' } },
    {
      method: 'turn/failed',
      params: { error: { message: 'provider failed' } }
    }
  ])('clears delta dedupe state on terminal $method events', async ({ method, params }) => {
    const queued = clientWithQueuedEvents()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => queued.client
    })
    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'item/completed',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          item: { id: 'assistant-1', type: 'agentMessage', text: 'answer' }
        }
      }
    })
    await vi.waitFor(() => {
      expect(modelDeltaDedupeProbe(service).states.size).toBe(1)
    })

    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method,
        params: { threadId: 'thread-1', turnId: 'turn-1', ...params }
      }
    })
    await vi.waitFor(() => {
      expect(modelDeltaDedupeProbe(service).states.size).toBe(0)
    })
    queued.close()
  })

  it('clears delta dedupe state when the runtime disconnects', async () => {
    const queued = clientWithQueuedEvents()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => queued.client
    })
    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'item/completed',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          item: { id: 'assistant-1', type: 'agentMessage', text: 'answer' }
        }
      }
    })
    await vi.waitFor(() => {
      expect(modelDeltaDedupeProbe(service).states.size).toBe(1)
    })

    queued.close()
    await vi.waitFor(() => {
      expect(modelDeltaDedupeProbe(service).states.size).toBe(0)
    })
  })

  it('deduplicates final assistant messages from multiple app-server event shapes', async () => {
    const queued = clientWithQueuedEvents()
    const broadcast = captureBroadcastEvents()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => queued.client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    const finalText = 'hi'
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'rawResponseItem/completed',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          item: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: finalText }]
          }
        }
      }
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'item/completed',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          item: {
            id: 'agent-message-1',
            type: 'agentMessage',
            text: finalText
          }
        }
      }
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        type: 'event_msg',
        payload: {
          type: 'task_complete',
          turn_id: 'turn-1',
          last_agent_message: finalText
        }
      }
    })

    await vi.waitFor(() => {
      expect(broadcast.mock.calls.some((call) => call[0]?.turnComplete === true)).toBe(true)
    })
    const deltaEvents = broadcast.mock.calls
      .map((call) => call[0])
      .filter((event) => event?.deltas?.some((delta: { text: string }) => delta.text === finalText))
    expect(deltaEvents).toHaveLength(1)

    queued.close()
  })

  it('deduplicates short completed assistant snapshots after streamed text', async () => {
    const queued = clientWithQueuedEvents()
    const broadcast = captureBroadcastEvents()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => queued.client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    const finalText = 'OK'
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'item/agentMessage/delta',
        params: { threadId: 'thread-1', turnId: 'turn-1', delta: finalText }
      }
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'item/completed',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          item: {
            id: 'agent-message-1',
            type: 'agentMessage',
            text: finalText
          }
        }
      }
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'turn/completed',
        params: { threadId: 'thread-1', turnId: 'turn-1' }
      }
    })

    await vi.waitFor(() => {
      expect(broadcast.mock.calls.some((call) => call[0]?.turnComplete === true)).toBe(true)
    })
    const deltaEvents = broadcast.mock.calls
      .map((call) => call[0])
      .filter((event) => event?.deltas?.some((delta: { text: string }) => delta.text === finalText))
    expect(deltaEvents).toHaveLength(1)

    queued.close()
  })

  it('fails and stops a Codex turn that produces no model activity', async () => {
    vi.useFakeTimers()
    const queued = clientWithQueuedEvents()
    try {
      const broadcast = captureBroadcastEvents()
      const service = new CodexRuntimeService({
        settings: async () => settings(),
        probeRuntime: availableTestRuntime,
        createClient: () => queued.client
      })

      await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
        ok: true,
        turnId: 'turn-1'
      })
      scheduleFirstActivityGuard(service)

      await vi.advanceTimersByTimeAsync(75_000)

      await vi.waitFor(() => {
        expect(broadcast).toHaveBeenCalledWith(
          expect.objectContaining({
            threadId: 'thread-1',
            turnId: 'turn-1',
            runtimeError: expect.objectContaining({
              code: 'first_activity_timeout',
              severity: 'error'
            })
          })
        )
      })
      expect(broadcast.mock.calls.some((call) => call[0]?.runtimeStatus?.phase === 'turn_done')).toBe(true)
      expect(queued.client.interruptTurn).toHaveBeenCalledWith(
        { threadId: 'thread-1', turnId: 'turn-1' },
        expect.any(AbortSignal)
      )
      expect(queued.client.stop).toHaveBeenCalled()
    } finally {
      queued.close()
      vi.useRealTimers()
    }
  })

  it('stops the timed-out provider even when turn_done publication fails', async () => {
    const queued = clientWithQueuedEvents()
    const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime, settings: async () => settings(), createClient: () => queued.client })
    const probe = service as unknown as {
      persistEvent(threadId: string, event: CodexThreadEventPayload): Promise<null>
      failTurnWithoutFirstActivity(threadId: string, turnId: string): Promise<void>
    }
    const persistedCodes: string[] = []
    vi.spyOn(probe, 'persistEvent').mockImplementation(async (_threadId, event) => {
      if (event.runtimeError?.code) persistedCodes.push(event.runtimeError.code)
      if (event.runtimeStatus?.phase === 'turn_done') throw new Error('turn_done storage failure')
      return null
    })
    try {
      await expect(service.startTurn({ threadId: 'thread-1', text: 'Plan' })).resolves.toMatchObject({ ok: true })
      await probe.failTurnWithoutFirstActivity('thread-1', 'turn-1').catch(() => undefined)
      expect(persistedCodes).toContain('first_activity_timeout')
      expect(queued.client.interruptTurn).toHaveBeenCalledWith(
        { threadId: 'thread-1', turnId: 'turn-1' }, expect.any(AbortSignal)
      )
      expect(queued.client.stop).toHaveBeenCalledOnce()
    } finally {
      queued.close()
    }
  })

  it.each(['timeout-cleanup', 'already-cancelled-cleanup'] as const)(
    'fails closed when interrupt and stop both fail during %s', async (cleanupPath) => {
      const first = clientWithQueuedEvents()
      const replacement = clientWithQueuedEvents()
      first.client.interruptTurn = vi.fn(async () => { throw new Error('interrupt unavailable') })
      first.client.stop = vi.fn(async () => { throw new Error('stop unavailable') })
      const createClient = vi.fn().mockReturnValueOnce(first.client).mockReturnValue(replacement.client)
      const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime, settings: async () => settings(), createClient })
      const probe = service as unknown as {
        persistEvent(threadId: string, event: CodexThreadEventPayload): Promise<null>
        emitRuntimeError(event: { code: string }): Promise<unknown>
        failTurnWithoutFirstActivity(threadId: string, turnId: string): Promise<void>
        firstActivityRecoveries: Map<string, Promise<void>>
      }
      const persistedCodes: string[] = []
      vi.spyOn(probe, 'persistEvent').mockImplementation(async (_threadId, event) => {
        if (event.runtimeError?.code) persistedCodes.push(event.runtimeError.code)
        return null
      })
      if (cleanupPath === 'already-cancelled-cleanup') {
        const emit = probe.emitRuntimeError.bind(probe)
        vi.spyOn(probe, 'emitRuntimeError').mockImplementation(async (event) => {
          if (event.code === 'first_activity_timeout') {
            // A concurrent user interrupt has already exhausted best-effort cleanup.
            await expect(service.interruptTurn('thread-1', 'turn-1')).resolves.toMatchObject({ ok: false })
          }
          return emit(event)
        })
      }
      try {
        await expect(service.startTurn({ threadId: 'thread-1', text: 'Plan' })).resolves.toMatchObject({ ok: true })
        const recoveryError = await probe.failTurnWithoutFirstActivity('thread-1', 'turn-1')
          .then(() => null, (error: unknown) => error)
        expect.soft(recoveryError).toBeInstanceOf(Error)
        expect.soft(persistedCodes).toContain('first_activity_timeout')
        expect.soft(persistedCodes.at(-1)).toBe('first_activity_recovery_unconfirmed')
        expect.soft(probe.firstActivityRecoveries.has('thread-1')).toBe(true)
        await expect.soft(service.readThreadPage('thread-1')).resolves.toMatchObject({ ok: false })
        await expect.soft(service.startTurn({ threadId: 'thread-1', text: 'Must not retry' })).resolves.toMatchObject({ ok: false })
        expect.soft(first.client.interruptTurn).toHaveBeenCalledOnce()
        expect.soft(first.client.stop).toHaveBeenCalledOnce()
        expect.soft(first.client.startTurn).toHaveBeenCalledOnce()
        expect.soft(createClient).toHaveBeenCalledOnce()
        expect.soft(replacement.client.startTurn).not.toHaveBeenCalled()
        expect.soft(replacement.client.stop).not.toHaveBeenCalled()
      } finally {
        first.close()
        replacement.close()
      }
    }
  )

  it('keeps failed timeout recovery fenced without stopping unrelated active work', async () => {
    const queued = clientWithQueuedEvents()
    queued.client.startTurn = vi.fn()
      .mockResolvedValueOnce({ turn: { id: 'turn-1' } })
      .mockResolvedValueOnce({ turn: { id: 'turn-2' } })
    queued.client.interruptTurn = vi.fn(async () => { throw new Error('interrupt unavailable') })
    const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime, settings: async () => settings(), createClient: () => queued.client })
    const probe = service as unknown as {
      persistEvent(threadId: string, event: CodexThreadEventPayload): Promise<null>
      failTurnWithoutFirstActivity(threadId: string, turnId: string): Promise<void>
    }
    vi.spyOn(probe, 'persistEvent').mockImplementation(async (_threadId, event) => {
      if (event.runtimeStatus?.phase === 'turn_done' || event.runtimeError?.code === 'first_activity_recovery_unconfirmed') {
        throw new Error('terminal storage unavailable')
      }
      return null
    })
    try {
      await service.startTurn({ threadId: 'thread-1', text: 'Plan' })
      await service.startTurn({ threadId: 'thread-2', text: 'Other work' })
      await expect(probe.failTurnWithoutFirstActivity('thread-1', 'turn-1')).rejects.toThrow('terminal storage unavailable')
      await expect(service.readThreadPage('thread-1')).resolves.toMatchObject({ ok: false })
      await expect(service.startTurn({ threadId: 'thread-1', text: 'Must not retry' })).resolves.toMatchObject({ ok: false })
      expect(queued.client.startTurn).toHaveBeenCalledTimes(2)
      expect(queued.client.stop).not.toHaveBeenCalled()
    } finally {
      queued.close()
    }
  })

  it('rejects a prepared turn whose client was replaced during no-activity cleanup', async () => {
    const first = clientWithQueuedEvents()
    const replacement = clientWithQueuedEvents()
    const createClient = vi.fn().mockReturnValueOnce(first.client).mockReturnValue(replacement.client)
    const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime, settings: async () => settings(), createClient })
    const probe = service as unknown as {
      prepareCodexTurnGovernance(input: { sessionId: string }): Promise<unknown>
      failTurnWithoutFirstActivity(threadId: string, turnId: string): Promise<void>
    }
    const entered = deferred<void>()
    const release = deferred<void>()
    const prepare = probe.prepareCodexTurnGovernance.bind(probe)
    vi.spyOn(probe, 'prepareCodexTurnGovernance').mockImplementation(async (input) => {
      const prepared = await prepare(input)
      if (input.sessionId === 'thread-preparing') {
        entered.resolve()
        await release.promise
      }
      return prepared
    })
    try {
      await expect(service.startTurn({ threadId: 'thread-1', text: 'Plan' })).resolves.toMatchObject({ ok: true })
      const pending = service.startTurn({ threadId: 'thread-preparing', text: 'Waiting at governance' })
      await entered.promise
      await probe.failTurnWithoutFirstActivity('thread-1', 'turn-1')
      expect(first.client.stop).toHaveBeenCalledOnce()
      await expect(service.startTurn({ threadId: 'thread-new', text: 'Other user work' })).resolves.toMatchObject({ ok: true })
      release.resolve()
      await expect(pending).resolves.toMatchObject({ ok: false })
      expect(first.client.startTurn).toHaveBeenCalledOnce()
      expect(replacement.client.startTurn).toHaveBeenCalledOnce()
      expect(replacement.client.stop).not.toHaveBeenCalled()
      expect(replacement.client.interruptTurn).not.toHaveBeenCalled()
    } finally {
      release.resolve()
      first.close()
      replacement.close()
    }
  })

  it('does not tear down a client while another dispatched turn awaits acknowledgement', async () => {
    const queued = clientWithQueuedEvents()
    const entered = deferred<void>()
    const acknowledgement = deferred<unknown>()
    queued.client.startTurn = vi.fn()
      .mockResolvedValueOnce({ turn: { id: 'turn-1' } })
      .mockImplementationOnce(() => { entered.resolve(); return acknowledgement.promise })
    const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime, settings: async () => settings(), createClient: () => queued.client })
    const probe = service as unknown as {
      failTurnWithoutFirstActivity(threadId: string, turnId: string): Promise<void>
    }
    try {
      await service.startTurn({ threadId: 'thread-1', text: 'Plan' })
      const pending = service.startTurn({ threadId: 'thread-2', text: 'Other user work' })
      await entered.promise
      await probe.failTurnWithoutFirstActivity('thread-1', 'turn-1')
      expect(queued.client.stop).not.toHaveBeenCalled()
      expect(queued.client.interruptTurn).toHaveBeenCalledWith(
        { threadId: 'thread-1', turnId: 'turn-1' }, expect.any(AbortSignal)
      )
      acknowledgement.resolve({ turn: { id: 'turn-2' } })
      await expect(pending).resolves.toMatchObject({ ok: true, turnId: 'turn-2' })
    } finally {
      acknowledgement.resolve({ turn: { id: 'turn-2' } })
      queued.close()
    }
  })

  it('keeps timeout cleanup scoped to the session that owned the failed turn', async () => {
    const first = clientWithQueuedEvents()
    const replacement = clientWithQueuedEvents()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: vi.fn().mockReturnValueOnce(first.client).mockReturnValue(replacement.client)
    })
    const probe = service as unknown as {
      emitRuntimeError(event: { code: string }): Promise<unknown>
      failTurnWithoutFirstActivity(threadId: string, turnId: string): Promise<void>
    }
    const published = deferred<void>()
    const release = deferred<void>()
    const emit = probe.emitRuntimeError.bind(probe)
    vi.spyOn(probe, 'emitRuntimeError').mockImplementation(async (event) => {
      const result = await emit(event)
      if (event.code === 'first_activity_timeout') {
        published.resolve()
        await release.promise
      }
      return result
    })
    try {
      await service.startTurn({ threadId: 'thread-1', text: 'Plan' })
      const recovery = probe.failTurnWithoutFirstActivity('thread-1', 'turn-1')
      await published.promise
      await service.stop()
      await expect(service.connect()).resolves.toMatchObject({ ok: true })
      release.resolve()
      await recovery
      expect(replacement.client.interruptTurn).not.toHaveBeenCalled()
      expect(replacement.client.stop).not.toHaveBeenCalled()
      expect(first.client.stop).toHaveBeenCalledOnce()
    } finally {
      release.resolve()
      first.close()
      replacement.close()
    }
  })

  it('preserves the no-activity failure when its internal interrupt emits a late aborted event', async () => {
    const queued = clientWithQueuedEvents()
    queued.client.startTurn = vi.fn()
      .mockResolvedValueOnce({ turn: { id: 'turn-1' } })
      .mockResolvedValueOnce({ turn: { id: 'turn-2' } })
    const storageRoot = await tempRoot()
    const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime, settings: async () => settings(), storageRoot, createClient: () => queued.client })
    const probe = service as unknown as {
      publishClientEvent(event: CodexThreadEventPayload): Promise<unknown>
      failTurnWithoutFirstActivity(threadId: string, turnId: string): Promise<void>
    }
    try {
      await service.startTurn({ threadId: 'thread-1', text: 'Plan' })
      await service.startTurn({ threadId: 'thread-2', text: 'Other work' })
      await probe.failTurnWithoutFirstActivity('thread-1', 'turn-1')
      await probe.publishClientEvent({
        threadId: 'thread-1', turnId: 'turn-1',
        runtimeError: { itemId: 'internal-abort', code: 'aborted', message: 'Turn interrupted', severity: 'error' }
      })
      const events = await new CodexEventStore({ rootDir: storageRoot }).read('thread-1', { includeAll: true })
      expect(events.filter(({ event }) => event.runtimeError).at(-1)?.event.runtimeError?.code)
        .toBe('first_activity_timeout')
      await expect(service.readThreadPage('thread-1')).resolves.toMatchObject({
        ok: true, detail: { latestTurnId: 'turn-1' }
      })
      expect(await new CodexThreadStore({ rootDir: storageRoot }).list()).toContainEqual(expect.objectContaining({
        guiThreadId: 'thread-1', latestTurnId: 'turn-1', latestTurnStatus: 'failed'
      }))
      expect(queued.client.stop).not.toHaveBeenCalled()
    } finally {
      queued.close()
    }
  })

  it.each(['user-cancel', 'user-cancel-during-publication', 'unknown-stop'] as const)('does not reclassify %s as an internal timeout interruption', async (intervention) => {
    const queued = clientWithQueuedEvents()
    queued.client.startTurn = vi.fn()
      .mockResolvedValueOnce({ turn: { id: 'turn-1' } })
      .mockResolvedValueOnce({ turn: { id: 'turn-2' } })
    const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime, settings: async () => settings(), createClient: () => queued.client })
    const probe = service as unknown as {
      publishClientEvent(event: CodexThreadEventPayload): Promise<CodexThreadEventPayload>
      emitRuntimeError(event: { code: string }): Promise<unknown>
      failTurnWithoutFirstActivity(threadId: string, turnId: string): Promise<void>
    }
    if (intervention === 'user-cancel-during-publication') {
      const emit = probe.emitRuntimeError.bind(probe)
      vi.spyOn(probe, 'emitRuntimeError').mockImplementation(async (event) => {
        const published = await emit(event)
        if (event.code === 'first_activity_timeout') await service.interruptTurn('thread-1', 'turn-1')
        return published
      })
    }
    try {
      await service.startTurn({ threadId: 'thread-1', text: 'Plan' })
      await service.startTurn({ threadId: 'thread-2', text: 'Other work' })
      await probe.failTurnWithoutFirstActivity('thread-1', 'turn-1')
      if (intervention === 'user-cancel') await service.interruptTurn('thread-1', 'turn-1')
      else if (intervention === 'unknown-stop') await probe.publishClientEvent({
        threadId: 'thread-1', turnId: 'turn-1',
        runtimeError: { itemId: 'unknown-stop', code: 'runtime_disconnected', message: 'Unknown stop', severity: 'error' }
      })
      await expect(probe.publishClientEvent({
        threadId: 'thread-1', turnId: 'turn-1',
        runtimeError: { itemId: 'later-abort', code: 'aborted', message: 'Turn interrupted', severity: 'error' }
      })).resolves.toMatchObject({ runtimeError: { code: 'aborted' } })
      expect(queued.client.stop).not.toHaveBeenCalled()
    } finally {
      queued.close()
    }
  })

  it('waits for no-activity interruption and teardown before admitting a replacement turn', async () => {
    vi.useFakeTimers()
    const first = clientWithQueuedEvents()
    const replacement = clientWithQueuedEvents()
    let releaseInterrupt!: () => void
    first.client.interruptTurn = vi.fn(() => new Promise<void>((resolve) => { releaseInterrupt = resolve }))
    replacement.client.startTurn = vi.fn(async () => ({ turn: { id: 'turn-replacement' } }))
    const createClient = vi.fn().mockReturnValueOnce(first.client).mockReturnValue(replacement.client)
    try {
      const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime, settings: async () => settings(), createClient })
      await service.startTurn({ threadId: 'thread-1', text: 'Plan' })
      scheduleFirstActivityGuard(service)
      await vi.advanceTimersByTimeAsync(75_000)
      expect(first.client.interruptTurn).toHaveBeenCalledOnce()
      const retry = service.startTurn({ threadId: 'thread-1', text: 'Regenerate Plan' })
      let historyReturned = false
      const history = service.readThreadPage('thread-1').then(() => { historyReturned = true })
      await vi.advanceTimersByTimeAsync(0)
      expect(first.client.startTurn).toHaveBeenCalledOnce()
      expect(replacement.client.startTurn).not.toHaveBeenCalled()
      expect(historyReturned).toBe(false)
      releaseInterrupt()
      await expect(retry).resolves.toMatchObject({ ok: true, turnId: 'turn-replacement' })
      await history
      expect(first.client.stop).toHaveBeenCalledOnce()
      expect(replacement.client.startTurn).toHaveBeenCalledOnce()
    } finally {
      releaseInterrupt?.()
      first.close()
      replacement.close()
      vi.useRealTimers()
    }
  })

  it('does not advertise automatic recovery when interruption is unconfirmed and another turn is active', async () => {
    vi.useFakeTimers()
    const queued = clientWithQueuedEvents()
    queued.client.startTurn = vi.fn()
      .mockResolvedValueOnce({ turn: { id: 'turn-1' } })
      .mockResolvedValueOnce({ turn: { id: 'turn-2' } })
    queued.client.interruptTurn = vi.fn(async () => { throw new Error('Transport unavailable') })
    try {
      const broadcast = captureBroadcastEvents()
      const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime, settings: async () => settings(), createClient: () => queued.client })
      await service.startTurn({ threadId: 'thread-1', text: 'Plan' })
      await service.startTurn({ threadId: 'thread-2', text: 'Other user work' })
      scheduleFirstActivityGuard(service)
      await vi.advanceTimersByTimeAsync(75_000)
      const errors = broadcast.mock.calls.map(([event]) => event)
        .filter((event) => event.threadId === 'thread-1' && event.runtimeError)
      expect(errors.at(-1)?.runtimeError?.code).toBe('first_activity_recovery_unconfirmed')
      expect(queued.client.stop).not.toHaveBeenCalled()
    } finally {
      queued.close()
      vi.useRealTimers()
    }
  })

  it('leaves Model Router request deadlines to the API gateway', async () => {
    vi.useFakeTimers()
    const queued = clientWithQueuedEvents()
    try {
      const broadcast = captureBroadcastEvents()
      const service = new CodexRuntimeService({
        settings: async () => settings(),
        probeRuntime: availableTestRuntime,
        createClient: () => queued.client
      })

      await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
        ok: true,
        turnId: 'turn-1'
      })

      await vi.advanceTimersByTimeAsync(75_000)

      expect(broadcast.mock.calls.some((call) => call[0]?.runtimeError?.code === 'first_activity_timeout')).toBe(false)
      expect(queued.client.interruptTurn).not.toHaveBeenCalled()
      expect(queued.client.stop).not.toHaveBeenCalled()
    } finally {
      queued.close()
      vi.useRealTimers()
    }
  })

  it('does not disconnect another active turn when one thread has no model activity', async () => {
    vi.useFakeTimers()
    const queued = clientWithQueuedEvents()
    const startTurn = vi
      .fn()
      .mockResolvedValueOnce({ turn: { id: 'turn-1' } })
      .mockResolvedValueOnce({ turn: { id: 'turn-2' } })
    queued.client.startTurn = startTurn
    try {
      const broadcast = captureBroadcastEvents()
      const service = new CodexRuntimeService({
        settings: async () => settings(),
        probeRuntime: availableTestRuntime,
        createClient: () => queued.client
      })

      await expect(service.startTurn({ threadId: 'thread-1', text: 'first' })).resolves.toMatchObject({
        ok: true,
        turnId: 'turn-1'
      })
      await expect(service.startTurn({ threadId: 'thread-2', text: 'second' })).resolves.toMatchObject({
        ok: true,
        turnId: 'turn-2'
      })
      scheduleFirstActivityGuard(service, 'thread-1', 'turn-1')
      scheduleFirstActivityGuard(service, 'thread-2', 'turn-2')
      queued.push({
        type: 'event',
        channel: CODEX_MAIN_IPC_CHANNELS.event,
        payload: {
          method: 'item/agentMessage/delta',
          params: { threadId: 'thread-2', turnId: 'turn-2', delta: 'working' }
        }
      })
      await vi.waitFor(() => {
        expect(
          broadcast.mock.calls.some(
            (call) => call[0]?.runtimeStatus?.phase === 'first_delta' && call[0]?.threadId === 'thread-2'
          )
        ).toBe(true)
      })

      await vi.advanceTimersByTimeAsync(75_000)

      expect(queued.client.interruptTurn).toHaveBeenCalledWith(
        { threadId: 'thread-1', turnId: 'turn-1' },
        expect.any(AbortSignal)
      )
      expect(queued.client.stop).not.toHaveBeenCalled()
      expect(
        broadcast.mock.calls.some(
          (call) => call[0]?.threadId === 'thread-2' && call[0]?.runtimeError?.code === 'runtime_disconnected'
        )
      ).toBe(false)

      queued.push({
        type: 'event',
        channel: CODEX_MAIN_IPC_CHANNELS.event,
        payload: {
          method: 'turn/completed',
          params: { threadId: 'thread-2', turnId: 'turn-2' }
        }
      })
      await vi.waitFor(() => {
        expect(
          broadcast.mock.calls.some((call) => call[0]?.threadId === 'thread-2' && call[0]?.turnComplete === true)
        ).toBe(true)
      })
    } finally {
      queued.close()
      vi.useRealTimers()
    }
  })

  it('treats pending approval requests as first activity for the active turn', async () => {
    vi.useFakeTimers()
    const queued = clientWithQueuedEvents()
    let onPendingRequest: ((request: CodexAppServerPendingRequest) => void) | undefined
    try {
      const broadcast = captureBroadcastEvents()
      const createClient = vi.fn((options: CodexAppServerJsonRpcClientOptions) => {
        onPendingRequest = (
          options.pendingServerRequests as {
            onPendingRequest?: (request: CodexAppServerPendingRequest) => void
          }
        )?.onPendingRequest
        return queued.client
      })
      const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime,
        settings: async () => settings(),
        createClient
      })

      await expect(service.startTurn({ threadId: 'thread-1', text: 'run tests' })).resolves.toMatchObject({
        ok: true,
        turnId: 'turn-1'
      })
      scheduleFirstActivityGuard(service)
      expect(onPendingRequest).toEqual(expect.any(Function))
      onPendingRequest?.({
        requestId: 'approval-1',
        method: 'item/commandExecution/requestApproval',
        kind: 'approval',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'cmd-approval-1',
        summary: 'Command approval requested',
        params: { command: 'npm test' }
      })

      await vi.waitFor(() => {
        expect(broadcast).toHaveBeenCalledWith(
          expect.objectContaining({
            threadId: 'thread-1',
            turnId: 'turn-1',
            tool: expect.objectContaining({
              itemId: 'cmd-approval-1',
              status: 'running',
              meta: expect.objectContaining({
                codexRequestId: 'approval-1',
                codexRequestKind: 'approval'
              })
            })
          })
        )
      })
      broadcast.mockClear()

      await vi.advanceTimersByTimeAsync(75_000)

      expect(broadcast.mock.calls.some((call) => call[0]?.runtimeError?.code === 'first_activity_timeout')).toBe(false)
      expect(queued.client.interruptTurn).not.toHaveBeenCalled()
      expect(queued.client.stop).not.toHaveBeenCalled()
    } finally {
      queued.close()
      vi.useRealTimers()
    }
  })

  it('classifies current app-server approval methods as command and file-change tools', async () => {
    const queued = clientWithQueuedEvents()
    let onPendingRequest: ((request: CodexAppServerPendingRequest) => void) | undefined
    const broadcast = captureBroadcastEvents()
    const createClient = vi.fn((options: CodexAppServerJsonRpcClientOptions) => {
      onPendingRequest = (
        options.pendingServerRequests as {
          onPendingRequest?: (request: CodexAppServerPendingRequest) => void
        }
      )?.onPendingRequest
      return queued.client
    })
    const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime,
      settings: async () => settings(),
      createClient
    })

    try {
      await expect(service.startTurn({ threadId: 'thread-1', text: 'review changes' })).resolves.toMatchObject({
        ok: true,
        turnId: 'turn-1'
      })
      onPendingRequest?.({
        requestId: 'approval-exec',
        method: 'execCommandApproval',
        kind: 'approval',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'cmd-approval-1',
        summary: 'Command approval requested',
        params: { command: 'npm test', cwd: '/workspace/project', reason: 'Verify changes' }
      })
      onPendingRequest?.({
        requestId: 'approval-patch',
        method: 'applyPatchApproval',
        kind: 'approval',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'patch-approval-1',
        summary: 'File change approval requested',
        params: {}
      })

      await vi.waitFor(() => {
        expect(broadcast).toHaveBeenCalledWith(
          expect.objectContaining({
            threadId: 'thread-1',
            turnId: 'turn-1',
            tool: expect.objectContaining({
              itemId: 'cmd-approval-1',
              summary: 'npm test',
              detail: expect.stringContaining('/workspace/project'),
              meta: expect.objectContaining({
                approval: expect.objectContaining({
                  command: 'npm test', cwd: '/workspace/project', reason: 'Verify changes'
                })
              }),
              toolKind: 'command_execution'
            })
          })
        )
        expect(broadcast).toHaveBeenCalledWith(
          expect.objectContaining({
            threadId: 'thread-1',
            turnId: 'turn-1',
            tool: expect.objectContaining({
              itemId: 'patch-approval-1',
              summary: 'File change approval requested',
              toolKind: 'file_change'
            })
          })
        )
      })
    } finally {
      queued.close()
    }
  })

  it('treats pending user input requests as first activity for the active turn', async () => {
    vi.useFakeTimers()
    const queued = clientWithQueuedEvents()
    let onPendingRequest: ((request: CodexAppServerPendingRequest) => void) | undefined
    try {
      const broadcast = captureBroadcastEvents()
      const createClient = vi.fn((options: CodexAppServerJsonRpcClientOptions) => {
        onPendingRequest = (
          options.pendingServerRequests as {
            onPendingRequest?: (request: CodexAppServerPendingRequest) => void
          }
        )?.onPendingRequest
        return queued.client
      })
      const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime,
        settings: async () => settings(),
        createClient
      })

      await expect(service.startTurn({ threadId: 'thread-1', text: 'ask me' })).resolves.toMatchObject({
        ok: true,
        turnId: 'turn-1'
      })
      scheduleFirstActivityGuard(service)
      onPendingRequest?.({
        requestId: 'input-1',
        method: 'item/tool/requestUserInput',
        kind: 'user_input',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'input-item-1',
        summary: 'User input requested',
        params: {
          questions: [
            {
              id: 'q1',
              header: 'Confirm',
              question: 'Continue?',
              options: []
            }
          ]
        }
      })

      await vi.waitFor(() => {
        expect(broadcast).toHaveBeenCalledWith(
          expect.objectContaining({
            threadId: 'thread-1',
            turnId: 'turn-1',
            tool: expect.objectContaining({
              itemId: 'input-item-1',
              status: 'running',
              meta: expect.objectContaining({
                codexRequestId: 'input-1',
                codexRequestKind: 'user_input'
              })
            })
          })
        )
      })
      broadcast.mockClear()

      await vi.advanceTimersByTimeAsync(75_000)

      expect(broadcast.mock.calls.some((call) => call[0]?.runtimeError?.code === 'first_activity_timeout')).toBe(false)
      expect(queued.client.interruptTurn).not.toHaveBeenCalled()
      expect(queued.client.stop).not.toHaveBeenCalled()
    } finally {
      queued.close()
      vi.useRealTimers()
    }
  })

  it('does not defer turn completion behind pending approval prompts', async () => {
    const queued = clientWithQueuedEvents()
    let onPendingRequest: ((request: CodexAppServerPendingRequest) => void) | undefined
    const broadcast = captureBroadcastEvents()
    const createClient = vi.fn((options: CodexAppServerJsonRpcClientOptions) => {
      onPendingRequest = (
        options.pendingServerRequests as {
          onPendingRequest?: (request: CodexAppServerPendingRequest) => void
        }
      )?.onPendingRequest
      return queued.client
    })
    const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime,
      settings: async () => settings(),
      createClient
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'run tests' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    onPendingRequest?.({
      requestId: 'approval-1',
      method: 'item/commandExecution/requestApproval',
      kind: 'approval',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'cmd-approval-1',
      summary: 'Command approval requested',
      params: { command: 'npm test' }
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'turn/completed',
        params: { threadId: 'thread-1', turnId: 'turn-1' }
      }
    })

    await vi.waitFor(() => {
      expect(broadcast.mock.calls.some((call) => call[0]?.turnComplete === true)).toBe(true)
    })
    queued.close()
  })

  it.each([
    {
      name: 'task_started event_msg',
      payload: {
        type: 'event_msg',
        payload: {
          type: 'task_started',
          turn_id: 'turn-1',
          started_at: 1781413091
        }
      },
      expectedEvent: {
        runtimeStatus: expect.objectContaining({ phase: 'tool_running' })
      }
    },
    {
      name: 'response_item function_call',
      payload: {
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: '{"cmd":"pwd"}',
          call_id: 'call-1'
        }
      },
      expectedEvent: {
        tool: expect.objectContaining({
          itemId: 'call-1',
          status: 'running',
          toolKind: 'command_execution',
          meta: expect.objectContaining({
            toolName: 'exec_command',
            command: 'pwd',
            arguments: expect.objectContaining({ cmd: 'pwd' })
          })
        })
      }
    },
    {
      name: 'response_item local shell call',
      payload: {
        type: 'response_item',
        payload: {
          type: 'local_shell_call',
          call_id: 'shell-1',
          status: 'in_progress',
          action: { command: 'sed -n 1,20p package.json' }
        }
      },
      expectedEvent: {
        tool: expect.objectContaining({
          itemId: 'shell-1',
          status: 'running',
          toolKind: 'command_execution',
          meta: expect.objectContaining({
            toolName: 'local_shell',
            callId: 'shell-1',
            command: 'sed -n 1,20p package.json'
          })
        })
      }
    },
    {
      name: 'response_item assistant message',
      payload: {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'visible answer' }]
        }
      },
      expectedEvent: {
        deltas: [{ kind: 'agent_message', text: 'visible answer', snapshot: true }]
      }
    },
    {
      name: 'rawResponseItem completed function call',
      payload: {
        method: 'rawResponseItem/completed',
        params: {
          item: {
            type: 'function_call',
            name: 'exec_command',
            arguments: '{"cmd":"pwd"}',
            call_id: 'call-1'
          }
        }
      },
      expectedEvent: {
        tool: expect.objectContaining({
          itemId: 'call-1',
          status: 'running',
          toolKind: 'command_execution',
          meta: expect.objectContaining({
            toolName: 'exec_command',
            command: 'pwd',
            arguments: expect.objectContaining({ cmd: 'pwd' })
          })
        })
      }
    },
    {
      name: 'item started command execution',
      payload: {
        method: 'item/started',
        params: {
          item: {
            type: 'commandExecution',
            id: 'cmd-1',
            command: 'pwd',
            cwd: '/tmp/workspace',
            status: 'inProgress',
            aggregatedOutput: null,
            exitCode: null
          }
        }
      },
      expectedEvent: {
        tool: expect.objectContaining({
          itemId: 'cmd-1',
          status: 'running',
          toolKind: 'command_execution',
          meta: expect.objectContaining({
            command: 'pwd',
            cwd: '/tmp/workspace'
          })
        })
      }
    },
    {
      name: 'task_complete event_msg',
      payload: {
        type: 'event_msg',
        payload: {
          type: 'task_complete',
          turn_id: 'turn-1',
          last_agent_message: 'visible answer'
        }
      },
      expectedEvent: {
        turnComplete: true
      }
    }
  ])('treats new app-server $name as first activity for the active turn', async ({ payload, expectedEvent }) => {
    vi.useFakeTimers()
    const queued = clientWithQueuedEvents()
    try {
      const broadcast = captureBroadcastEvents()
      const service = new CodexRuntimeService({
        settings: async () => settings(),
        probeRuntime: availableTestRuntime,
        createClient: () => queued.client
      })

      await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
        ok: true,
        turnId: 'turn-1'
      })
      scheduleFirstActivityGuard(service)

      queued.push({
        type: 'event',
        channel: CODEX_MAIN_IPC_CHANNELS.event,
        payload
      })

      await vi.waitFor(() => {
        expect(broadcast).toHaveBeenCalledWith(
          expect.objectContaining({
            threadId: 'thread-1',
            turnId: 'turn-1',
            ...expectedEvent
          })
        )
      })
      broadcast.mockClear()

      await vi.advanceTimersByTimeAsync(75_000)

      expect(broadcast.mock.calls.some((call) => call[0]?.runtimeError?.code === 'first_activity_timeout')).toBe(false)
      expect(queued.client.interruptTurn).not.toHaveBeenCalled()
    } finally {
      queued.close()
      vi.useRealTimers()
    }
  })

  it('correlates terminal function call output with the original Codex tool identity', async () => {
    const queued = clientWithQueuedEvents()
    const broadcast = captureBroadcastEvents()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => queued.client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'run tests' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: '{"cmd":"npm test"}',
          call_id: 'call-1'
        }
      }
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'call-1',
          success: true,
          output: 'ok'
        }
      }
    })

    await vi.waitFor(() => {
      expect(broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: expect.objectContaining({
            itemId: 'call-1',
            summary: 'exec_command',
            status: 'success',
            toolKind: 'command_execution',
            meta: expect.objectContaining({
              callId: 'call-1',
              toolName: 'exec_command',
              phase: 'succeeded',
              factSource: 'executor_result',
              evidenceStrength: 'executor_receipt',
              success: true
            })
          })
        })
      )
    })
    queued.close()
  })

  it('records Codex token usage notifications for cache-aware usage summaries', async () => {
    const queued = clientWithQueuedEvents()
    const rootDir = await tempRoot()
    const broadcast = captureBroadcastEvents()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot: rootDir,
      probeRuntime: availableTestRuntime,
      createClient: () => queued.client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'thread/tokenUsage/updated',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          tokenUsage: {
            total: {
              inputTokens: 120,
              cachedInputTokens: 90,
              outputTokens: 20,
              reasoningOutputTokens: 5,
              totalTokens: 145
            },
            last: {
              inputTokens: 120,
              cachedInputTokens: 90,
              outputTokens: 20,
              reasoningOutputTokens: 5,
              totalTokens: 145
            },
            modelContextWindow: 128000
          }
        }
      }
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'turn/completed',
        params: { threadId: 'thread-1', turnId: 'turn-1' }
      }
    })

    await vi.waitFor(async () => {
      await expect(
        service.usage({
          runtimeId: 'codex',
          groupBy: 'thread',
          threadId: 'thread-1',
          timezone: 'UTC'
        })
      ).resolves.toMatchObject({
        supported: true,
        groupBy: 'thread',
        buckets: [
          {
            threadId: 'thread-1',
            inputTokens: 120,
            outputTokens: 20,
            reasoningTokens: 5,
            cachedTokens: 90,
            cacheMissTokens: 30,
            totalTokens: 145,
            turns: 1,
            cacheHitRate: 0.75
          }
        ]
      })
    })

    await expect(service.readThreadStatus('thread-1')).resolves.toMatchObject({
      ok: true,
      status: {
        usage: {
          inputTokens: 120,
          outputTokens: 20,
          reasoningTokens: 5,
          totalTokens: 145,
          cacheReadTokens: 90,
          cacheWriteTokens: 30
        }
      }
    })
    const rawUsageRecords = await readFile(join(rootDir, 'usage', 'codex-usage.jsonl'), 'utf8')
    const usageRecords = rawUsageRecords
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { totalTokens: number })
    expect(usageRecords).toHaveLength(1)
    expect(usageRecords[0]?.totalTokens).toBe(145)
    queued.close()
  })

  it('records completed Codex turns as usage activity when token usage is unavailable', async () => {
    const queued = clientWithQueuedEvents()
    const rootDir = await tempRoot()
    const broadcast = captureBroadcastEvents()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot: rootDir,
      probeRuntime: availableTestRuntime,
      createClient: () => queued.client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'turn/completed',
        params: { threadId: 'thread-1', turnId: 'turn-1' }
      }
    })

    await vi.waitFor(async () => {
      await expect(
        service.usage({
          runtimeId: 'codex',
          groupBy: 'thread',
          threadId: 'thread-1',
          timezone: 'UTC'
        })
      ).resolves.toMatchObject({
        supported: true,
        groupBy: 'thread',
        buckets: [
          {
            threadId: 'thread-1',
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            turns: 1
          }
        ],
        totals: {
          totalTokens: 0,
          turns: 1,
          activeDays: 1
        }
      })
    })
    queued.close()
  })

  it('backfills usage activity from stored Codex turn events', async () => {
    const rootDir = await tempRoot()
    await new CodexThreadStore({ rootDir }).upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-1',
      workspace: '/tmp/workspace',
      title: 'Stored Codex'
    })
    await new CodexEventStore({ rootDir }).append('gui-thread-1', {
      threadId: 'gui-thread-1',
      turnId: 'turn-1',
      turnComplete: true
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot: rootDir,
      probeRuntime: availableTestRuntime,
      createClient: () => controllableClient()
    })

    await expect(
      service.usage({
        runtimeId: 'codex',
        groupBy: 'thread',
        threadId: 'gui-thread-1',
        timezone: 'UTC'
      })
    ).resolves.toMatchObject({
      supported: true,
      groupBy: 'thread',
      buckets: [
        {
          threadId: 'gui-thread-1',
          totalTokens: 0,
          turns: 1
        }
      ],
      totals: {
        totalTokens: 0,
        turns: 1,
        activeDays: 1
      }
    })

    const usagePath = join(rootDir, 'usage', 'codex-usage.jsonl')
    const rowsAfterFirstBackfill = (await readFile(usagePath, 'utf8')).trim().split('\n')
    expect(rowsAfterFirstBackfill).toHaveLength(1)

    const restartedService = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot: rootDir,
      probeRuntime: availableTestRuntime,
      createClient: () => controllableClient()
    })
    await restartedService.usage({
      runtimeId: 'codex',
      groupBy: 'thread',
      threadId: 'gui-thread-1',
      timezone: 'UTC'
    })
    const rowsAfterRestartedBackfill = (await readFile(usagePath, 'utf8')).trim().split('\n')
    expect(rowsAfterRestartedBackfill).toHaveLength(1)
  })

  it('omits app-server startup status events when a Codex turn starts after prewarm', async () => {
    const client = controllableClient()
    const broadcast = captureBroadcastEvents()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.connect()).resolves.toMatchObject({ ok: true })
    vi.mocked(client.connect).mockClear()
    broadcast.mockClear()

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })

    expect(client.connect).not.toHaveBeenCalled()
    const phases = broadcast.mock.calls.map((call) => call[0]?.runtimeStatus?.phase).filter(Boolean)
    expect(phases).toEqual(['turn_start_sent'])
  })

  it('streams replayed and live Codex events through a neutral async iterable', async () => {
    const storageRoot = await tempRoot()
    const eventStore = new CodexEventStore({ rootDir: storageRoot })
    await eventStore.append('thread-1', {
      threadId: 'thread-1',
      deltas: [{ kind: 'agent_message', text: 'stored' }]
    })
    const queued = clientWithQueuedEvents()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => queued.client
    })
    const abort = new AbortController()
    const seen: CodexThreadEventPayload[] = []

    const consume = (async () => {
      for await (const event of service.subscribeEvents('thread-1', 0, abort.signal)) {
        seen.push(event)
        if (event.deltas?.some((delta) => delta.text === 'live')) abort.abort()
      }
    })()

    await service.connect()
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'item/agentMessage/delta',
        params: { threadId: 'thread-1', turnId: 'turn-1', delta: 'live' }
      }
    })

    await vi.waitFor(() => {
      expect(seen.map((event) => event.deltas?.[0]?.text).filter(Boolean)).toEqual(['stored', 'live'])
    })
    await consume
    queued.close()
  })

  it('terminates a stalled event subscriber once its queue overflows instead of growing it without bound', async () => {
    const storageRoot = await tempRoot()
    // controllableClient connects successfully, so the orphaned-turn probe in
    // subscribeEvents returns without discarding clients (a failing client
    // would close all subscribers via discardClientAfterFailure). Without a
    // stored thread the journal stays empty and persistEvent short-circuits,
    // keeping every publish on the in-memory broadcast path: the 2_001
    // publishes below must not depend on disk I/O or event-loop timing.
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      storageRoot,
      probeRuntime: availableTestRuntime,
      createClient: () => controllableClient()
    })
    const publishStatus = () => service.publishSyntheticEvent({
      kind: 'runtime_status',
      threadId: 'thread-1',
      turnId: 'turn-1',
      phase: 'turn_start_sent'
    })
    const abort = new AbortController()
    const stalled = service.subscribeEvents('thread-1', 0, abort.signal)[Symbol.asyncIterator]()
    // The first broadcast parks the generator at its yield; every later event
    // accumulates in the subscriber queue because the consumer never pulls.
    const firstDelivery = stalled.next()
    await publishStatus()
    await expect(firstDelivery).resolves.toMatchObject({ done: false })

    for (let index = 0; index <= CODEX_SUBSCRIBER_QUEUE_MAX_EVENTS; index += 1) {
      await publishStatus()
    }

    // The next pull observes the terminated subscriber: the stream ends so the
    // client resubscribes and replays the journaled tail.
    await expect(stalled.next()).resolves.toMatchObject({ done: true })
    expect(logWarn).toHaveBeenCalledWith(
      'codex-runtime',
      expect.stringContaining('slow Codex event subscriber'),
      expect.objectContaining({ threadId: 'thread-1' })
    )

    // Terminating one subscriber does not poison later subscriptions.
    const resyncAbort = new AbortController()
    const resynced = service.subscribeEvents('thread-1', 0, resyncAbort.signal)[Symbol.asyncIterator]()
    const resyncedDelivery = resynced.next()
    await publishStatus()
    await expect(resyncedDelivery).resolves.toMatchObject({
      done: false,
      value: expect.objectContaining({ threadId: 'thread-1' })
    })
    resyncAbort.abort()
    abort.abort()
  }, 15_000)

  it('routes pending app-server requests from backend thread ids to GUI thread subscribers', async () => {
    const storageRoot = await tempRoot()
    await new CodexThreadStore({ rootDir: storageRoot }).upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-new',
      workspace: '/tmp/workspace',
      title: 'Rematerialized Codex'
    })
    let onPendingRequest: ((request: CodexAppServerPendingRequest) => void) | undefined
    const client = controllableClient()
    const createClient = vi.fn((options: CodexAppServerJsonRpcClientOptions) => {
      onPendingRequest = (
        options.pendingServerRequests as {
          onPendingRequest?: (request: CodexAppServerPendingRequest) => void
        }
      )?.onPendingRequest
      return client
    })
    const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime,
      settings: async () => settings(),
      storageRoot,
      createClient
    })
    const abort = new AbortController()
    const seen: CodexThreadEventPayload[] = []

    const consume = (async () => {
      for await (const event of service.subscribeEvents('gui-thread-1', 0, abort.signal)) {
        seen.push(event)
        if (event.tool?.meta?.codexRequestId === 'approval-1') abort.abort()
      }
    })()

    await service.connect()
    expect(onPendingRequest).toEqual(expect.any(Function))
    onPendingRequest?.({
      requestId: 'approval-1',
      method: 'item/fileChange/requestApproval',
      kind: 'approval',
      threadId: 'codex-thread-new',
      turnId: 'turn-1',
      itemId: 'file-1',
      summary: 'File change approval requested',
      params: {}
    })

    await vi.waitFor(() => {
      expect(seen).toEqual([
        expect.objectContaining({
          threadId: 'gui-thread-1',
          turnId: 'turn-1',
          tool: expect.objectContaining({
            itemId: 'file-1',
            status: 'running',
            toolKind: 'file_change',
            meta: expect.objectContaining({
              codexRequestId: 'approval-1',
              codexRequestKind: 'approval'
            })
          })
        })
      ])
    })
    await vi.waitFor(async () => {
      await expect(service.readStoredEvents('gui-thread-1', 0)).resolves.toEqual([
        expect.objectContaining({
          threadId: 'gui-thread-1',
          turnId: 'turn-1',
          tool: expect.objectContaining({
            itemId: 'file-1',
            status: 'running',
            meta: expect.objectContaining({
              codexRequestId: 'approval-1',
              codexRequestKind: 'approval'
            })
          })
        })
      ])
    })
    await consume
  })

  it('exposes pending app-server requests and resolves approvals and user input by request id', async () => {
    const client = {
      ...controllableClient(),
      pendingServerRequests: vi.fn(() => [
        {
          requestId: 'approval-1',
          method: 'item/fileChange/requestApproval',
          kind: 'approval',
          threadId: 'thread-1',
          turnId: 'turn-1',
          itemId: 'file-1',
          summary: 'File change approval requested',
          params: {}
        },
        {
          requestId: 'input-1',
          method: 'item/tool/requestUserInput',
          kind: 'user_input',
          threadId: 'thread-1',
          turnId: 'turn-1',
          itemId: 'input-1',
          summary: 'User input requested',
          params: {}
        }
      ]),
      resolveApproval: vi.fn(),
      resolveUserInput: vi.fn()
    } as unknown as CodexAppServerJsonRpcClient
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await service.connect()

    expect(service.pendingServerRequests()).toEqual([
      expect.objectContaining({ requestId: 'approval-1', kind: 'approval' }),
      expect.objectContaining({ requestId: 'input-1', kind: 'user_input' })
    ])
    await expect(
      service.resolveApproval({
        requestId: 'approval-1',
        decision: 'denied'
      })
    ).resolves.toEqual({ ok: true })
    await expect(
      service.resolveUserInput({
        requestId: 'input-1',
        answers: [{ id: 'q1', value: 'A' }]
      })
    ).resolves.toEqual({ ok: true })

    expect(client.resolveApproval).toHaveBeenCalledWith({
      requestId: 'approval-1',
      decision: 'denied'
    })
    expect(client.resolveUserInput).toHaveBeenCalledWith({
      requestId: 'input-1',
      answers: [{ id: 'q1', value: 'A' }]
    })
  })

  it('handles browser login completion, account state, rate limits, and logout through app-server', async () => {
    const queued = clientWithQueuedEvents()
    const readAccount = vi.fn(async () => ({
      account: {
        type: 'chatgpt' as const,
        email: 'user@example.com',
        planType: 'plus' as const
      },
      requiresOpenaiAuth: true
    }))
    const startAccountLogin = vi.fn(async () => ({
      type: 'chatgpt' as const,
      loginId: 'login-1',
      authUrl: 'https://auth.example/login'
    }))
    const readAccountRateLimits = vi.fn(async () => ({
      rateLimits: {
        limitId: 'codex',
        limitName: 'Codex',
        primary: {
          usedPercent: 20,
          windowDurationMins: 300,
          resetsAt: 1_800_000_000
        },
        secondary: null,
        credits: null,
        individualLimit: null,
        planType: 'plus' as const,
        rateLimitReachedType: null
      },
      rateLimitsByLimitId: null,
      rateLimitResetCredits: null
    }))
    const logoutAccount = vi.fn(async () => ({}))
    Object.assign(queued.client, {
      readAccount,
      startAccountLogin,
      readAccountRateLimits,
      logoutAccount
    })
    const current = settings()
    const service = new CodexRuntimeService({
      settings: async () => current,
      managedCodexHome: await tempRoot(),
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1' },
      probeRuntime: availableTestRuntime,
      createClient: () => queued.client
    })

    await expect(service.startCodingPlanLogin({ method: 'browser' })).resolves.toMatchObject({
      ok: true,
      method: 'browser',
      loginId: 'login-1',
      authUrl: 'https://auth.example/login'
    })
    const completion = service.waitForCodingPlanLogin('login-1')
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'account/login/completed',
        params: { loginId: 'login-1', success: true, error: null }
      }
    })
    await expect(completion).resolves.toMatchObject({
      ok: true,
      success: true,
      account: { type: 'chatgpt', planType: 'plus' },
      planType: 'plus'
    })
    await expect(service.getCodingPlanRateLimits()).resolves.toMatchObject({
      ok: true,
      rateLimits: { limitId: 'codex', planType: 'plus' }
    })
    await expect(service.logoutCodingPlanAccount()).resolves.toEqual({
      ok: true
    })
    expect(startAccountLogin).toHaveBeenCalledWith({ type: 'chatgpt' })
    expect(logoutAccount).toHaveBeenCalledTimes(1)
    expect(queued.client.startThread).not.toHaveBeenCalled()
    expect(queued.client.startTurn).not.toHaveBeenCalled()
    queued.close()
  })

  it('does not gate coding-plan account login on runtime-only hook verification', async () => {
    const root = await tempRoot()
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    const client = {
      ...controllableClient(),
      listHooks: vi.fn(async () => {
        throw new Error('runtime governance probe unavailable')
      }),
      startAccountLogin: vi.fn(async () => ({
        type: 'chatgpt' as const,
        loginId: 'account-only-login-1',
        authUrl: 'https://auth.example/login'
      }))
    } as unknown as CodexAppServerJsonRpcClient
    const current = settings()
    current.workspaceRoot = workspace
    const service = new CodexRuntimeService({
      settings: async () => current,
      managedCodexHome: join(root, 'codex-home'),
      storageRoot: root,
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1' },
      preToolUseHookLaunch: {
        appPath: join(root, 'missing-app'),
        execPath: process.execPath,
        isPackaged: false
      },
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.startCodingPlanLogin({ method: 'browser' })).resolves.toMatchObject({
      ok: true,
      method: 'browser',
      loginId: 'account-only-login-1'
    })
    expect(client.listHooks).not.toHaveBeenCalled()
    expect(client.startAccountLogin).toHaveBeenCalledOnce()
  })

  it('keeps an account refresh alive while persisted runtime access differs', async () => {
    const accountRead = deferred<{
      account: null
      requiresOpenaiAuth: boolean
    }>()
    const client = {
      ...controllableClient(),
      readAccount: vi.fn(() => accountRead.promise)
    } as unknown as CodexAppServerJsonRpcClient
    const current = settings()
    delete (current as Partial<AppSettingsV1>).modelAccess
    const service = new CodexRuntimeService({
      settings: async () => current,
      managedCodexHome: await tempRoot(),
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1' },
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    const account = service.getCodingPlanAccount({ refreshToken: true })
    await vi.waitFor(() => expect(client.readAccount).toHaveBeenCalledOnce())
    await expect(service.listThreads()).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('sign-in is still in progress')
    })
    expect(client.stop).not.toHaveBeenCalled()
    await service.synchronizeModelAccess()
    expect(client.stop).not.toHaveBeenCalled()

    accountRead.resolve({ account: null, requiresOpenaiAuth: true })
    await expect(account).resolves.toMatchObject({ ok: true })
  })

  it('keeps account login alive when concurrent runtime hook verification fails', async () => {
    const runtimeHook = deferred<void>()
    const loginStart = deferred<{
      type: 'chatgpt'
      loginId: string
      authUrl: string
    }>()
    const client = {
      ...controllableClient(),
      startAccountLogin: vi.fn(() => loginStart.promise)
    } as unknown as CodexAppServerJsonRpcClient
    const service = new CodexRuntimeService({
      settings: async () => ({
        ...settings(),
        modelAccess: { mode: 'coding-plan', planAdapterId: 'codex' }
      }),
      managedCodexHome: await tempRoot(),
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1' },
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })
    const runtimeReadiness = service as unknown as {
      ensureCodexPreToolUseHookTrusted(): Promise<void>
    }
    const hookTrust = vi.spyOn(runtimeReadiness, 'ensureCodexPreToolUseHookTrusted')
      .mockImplementation(() => runtimeHook.promise)

    const connect = service.connect()
    await vi.waitFor(() => expect(hookTrust).toHaveBeenCalledOnce())
    const login = service.startCodingPlanLogin({ method: 'browser' })
    await vi.waitFor(() => expect(client.startAccountLogin).toHaveBeenCalledOnce())

    runtimeHook.reject(new Error('runtime hook probe timed out'))
    await expect(connect).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('runtime hook probe timed out')
    })
    expect(client.stop).not.toHaveBeenCalled()

    loginStart.resolve({
      type: 'chatgpt',
      loginId: 'concurrent-login-1',
      authUrl: 'https://auth.example/login'
    })
    await expect(login).resolves.toMatchObject({
      ok: true,
      loginId: 'concurrent-login-1'
    })
  })

  it('fails account login closed when the app-server transport disconnects', async () => {
    const queued = clientWithQueuedEvents()
    Object.assign(queued.client, {
      startAccountLogin: vi.fn(async () => ({
        type: 'chatgpt' as const,
        loginId: 'disconnected-login-1',
        authUrl: 'https://auth.example/login'
      }))
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      managedCodexHome: await tempRoot(),
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1' },
      probeRuntime: availableTestRuntime,
      createClient: () => queued.client
    })

    await expect(service.startCodingPlanLogin({ method: 'browser' })).resolves.toMatchObject({
      ok: true,
      loginId: 'disconnected-login-1'
    })
    const completion = service.waitForCodingPlanLogin('disconnected-login-1')
    queued.push({
      type: 'closed',
      channel: CODEX_MAIN_IPC_CHANNELS.closed,
      reason: 'error'
    })

    await expect(completion).resolves.toMatchObject({
      ok: true,
      success: false,
      error: expect.stringContaining('disconnected before login completed')
    })
    await vi.waitFor(() => expect(queued.client.stop).toHaveBeenCalledOnce())
    expect(service.isClientWarm()).toBe(false)
    queued.close()
  })

  it('keeps the OAuth callback app-server alive while persisted model access still differs', async () => {
    const queued = clientWithQueuedEvents()
    const loginStart = deferred<{
      type: 'chatgpt'
      loginId: string
      authUrl: string
    }>()
    Object.assign(queued.client, {
      startAccountLogin: vi.fn(() => loginStart.promise),
      readAccount: vi.fn(async () => ({
        account: {
          type: 'chatgpt' as const,
          email: 'user@example.com',
          planType: 'plus' as const
        },
        requiresOpenaiAuth: true
      }))
    })
    const current = settings()
    const service = new CodexRuntimeService({
      settings: async () => current,
      managedCodexHome: await tempRoot(),
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1' },
      probeRuntime: availableTestRuntime,
      createClient: () => queued.client
    })

    const login = service.startCodingPlanLogin({ method: 'browser' })
    await vi.waitFor(() => expect(queued.client.startAccountLogin).toHaveBeenCalledTimes(1))
    await service.synchronizeModelAccess()
    expect(queued.client.stop).not.toHaveBeenCalled()

    loginStart.resolve({
      type: 'chatgpt',
      loginId: 'login-lease-1',
      authUrl: 'https://auth.example/login'
    })
    await expect(login).resolves.toMatchObject({
      ok: true,
      loginId: 'login-lease-1'
    })

    await service.synchronizeModelAccess()
    expect(queued.client.stop).not.toHaveBeenCalled()
    await expect(service.connect()).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('sign-in is still in progress')
    })
    expect(queued.client.stop).not.toHaveBeenCalled()

    const completion = service.waitForCodingPlanLogin('login-lease-1')
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'account/login/completed',
        params: { loginId: 'login-lease-1', success: true, error: null }
      }
    })
    await expect(completion).resolves.toMatchObject({
      ok: true,
      success: true
    })

    await service.synchronizeModelAccess()
    expect(queued.client.stop).toHaveBeenCalledTimes(1)
    queued.close()
  })

  it('starts Codex device-code login through the same managed account client', async () => {
    const client = {
      ...controllableClient(),
      startAccountLogin: vi.fn(async () => ({
        type: 'chatgptDeviceCode' as const,
        loginId: 'device-login-1',
        verificationUrl: 'https://auth.example/device',
        userCode: 'ABCD-EFGH'
      }))
    } as unknown as CodexAppServerJsonRpcClient
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      managedCodexHome: await tempRoot(),
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1' },
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.startCodingPlanLogin({ method: 'device' })).resolves.toEqual({
      ok: true,
      method: 'device',
      loginId: 'device-login-1',
      verificationUrl: 'https://auth.example/device',
      userCode: 'ABCD-EFGH'
    })
    expect(client.startAccountLogin).toHaveBeenCalledWith({
      type: 'chatgptDeviceCode'
    })
    expect(client.startTurn).not.toHaveBeenCalled()
  })

  it('fails coding-plan model use when managed CODEX_HOME has no ChatGPT account', async () => {
    const startThread = vi.fn(async () => ({ thread: { id: 'thread-1' } }))
    const client = {
      ...controllableClient(),
      readAccount: vi.fn(async () => ({
        account: null,
        requiresOpenaiAuth: true
      })),
      startThread
    } as unknown as CodexAppServerJsonRpcClient
    const service = new CodexRuntimeService({
      settings: async () => ({
        ...settings(),
        modelAccess: { mode: 'coding-plan', planAdapterId: 'codex' }
      }),
      managedCodexHome: await tempRoot(),
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1' },
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(service.startThread({ workspace: '/tmp/workspace' })).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('requires a ChatGPT account')
    })
    expect(startThread).not.toHaveBeenCalled()
  })

  it('does not retry a coding-plan failure through the API Model Router provider', async () => {
    const queued = clientWithQueuedEvents()
    const startThread = vi.mocked(queued.client.startThread)
    const startTurn = vi.mocked(queued.client.startTurn)
    Object.assign(queued.client, {
      readAccount: vi.fn(async () => ({
        account: {
          type: 'chatgpt' as const,
          email: 'user@example.com',
          planType: 'plus' as const
        },
        requiresOpenaiAuth: true
      }))
    })
    const service = new CodexRuntimeService({
      settings: async () => ({
        ...settings(),
        modelAccess: { mode: 'coding-plan', planAdapterId: 'codex' }
      }),
      managedCodexHome: await tempRoot(),
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1' },
      probeRuntime: availableTestRuntime,
      createClient: () => queued.client
    })

    await expect(
      service.startTurn({
        threadId: 'gui-thread-1',
        text: 'hello',
        workspace: '/tmp/workspace'
      })
    ).resolves.toMatchObject({ ok: true, turnId: 'turn-1' })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'turn/failed',
        params: {
          threadId: 'gui-thread-1',
          turnId: 'turn-1',
          error: {
            message: 'Model Router requests must use the public router model alias.'
          }
        }
      }
    })
    await vi.waitFor(() => expect(startTurn).toHaveBeenCalledTimes(1))

    expect(startTurn).toHaveBeenCalledTimes(1)
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        responsesapiClientMetadata: {
          runtime_id: 'codex',
          gui_thread_id: 'gui-thread-1'
        }
      })
    )
    expect(startTurn.mock.calls[0]?.[0]).not.toHaveProperty('modelProvider')
    expect(startThread).not.toHaveBeenCalled()
    queued.close()
  })

  it('restarts a warm managed app-server when the billing access path changes', async () => {
    let current = settings()
    const first = controllableClient()
    const second = controllableClient()
    const createClient = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime,
      settings: async () => current,
      managedCodexHome: await tempRoot(),
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1' },
      createClient
    })

    await expect(service.connect()).resolves.toMatchObject({ ok: true })
    current = {
      ...current,
      modelAccess: { mode: 'coding-plan', planAdapterId: 'codex' }
    }
    await service.synchronizeModelAccess()
    expect(first.stop).toHaveBeenCalledTimes(1)
    expect(service.isClientWarm()).toBe(false)
    await expect(service.connect()).resolves.toMatchObject({ ok: true })
    expect(createClient).toHaveBeenCalledTimes(2)
  })

  it('restarts a warm app-server when the explicitly selected executable changes', async () => {
    let current = settings()
    const first = controllableClient()
    const second = controllableClient()
    const createClient = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    const service = new CodexRuntimeService({
      probeRuntime: availableTestRuntime,
      settings: async () => current,
      createClient
    })

    await expect(service.connect()).resolves.toMatchObject({ ok: true })
    current = {
      ...current,
      agents: {
        ...current.agents,
        codex: {
          ...defaultCodexRuntimeSettings(),
          ...current.agents.codex,
          command: '/Applications/ChatGPT.app/Contents/Resources/codex'
        }
      }
    }
    await service.synchronizeModelAccess()
    expect(first.stop).toHaveBeenCalledTimes(1)
    await expect(service.connect()).resolves.toMatchObject({ ok: true })
    expect(createClient).toHaveBeenCalledTimes(2)
  })

  it('passes explicit levels through for provider-routed models that are not in the runtime catalog', async () => {
    const client = controllableClient()
    vi.mocked(client.listModels).mockResolvedValue({
      data: [
        {
          id: 'runtime-default',
          model: 'runtime-default',
          displayName: 'Runtime Default',
          description: 'Discovered at runtime',
          hidden: false,
          isDefault: true,
          supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }],
          defaultReasoningEffort: 'medium',
          inputModalities: ['text'],
          serviceTiers: [],
          defaultServiceTier: null
        }
      ],
      nextCursor: null
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(
      service.startThread({
        title: 'Router thread',
        model: 'sciforge-router',
        reasoningEffort: 'high'
      })
    ).resolves.toMatchObject({ ok: true })
    expect(client.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'sciforge-router',
        config: expect.objectContaining({ model_reasoning_effort: 'high' })
      })
    )

    await expect(
      service.startTurn({
        threadId: 'thread-1',
        text: 'go',
        model: 'sciforge-router',
        reasoningEffort: 'high'
      })
    ).resolves.toMatchObject({ ok: true, turnId: 'turn-1' })
    expect(client.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'sciforge-router', effort: 'high' })
    )
  })

  it('limits catalog-known models to their declared list and forces the alias for everything else', async () => {
    const client = controllableClient()
    vi.mocked(client.listModels).mockResolvedValue({
      data: [
        {
          id: 'plain-model',
          model: 'plain-model',
          displayName: 'Plain',
          description: '',
          hidden: false,
          isDefault: true,
          supportedReasoningEfforts: [],
          defaultReasoningEffort: '',
          inputModalities: ['text'],
          serviceTiers: [],
          defaultServiceTier: null
        }
      ],
      nextCursor: null
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => client
    })

    await expect(
      service.startTurn({
        threadId: 'thread-1',
        text: 'go',
        model: 'plain-model',
        reasoningEffort: 'high'
      })
    ).resolves.toMatchObject({ ok: true, turnId: 'turn-1' })
    const params = vi.mocked(client.startTurn).mock.calls[0]?.[0]
    expect(params).toBeDefined()
    expect(params).toMatchObject({ model: 'plain-model' })
    expect(params).not.toHaveProperty('effort')

    // Unavailable catalog: the model is forced to the managed alias and the
    // explicit level still passes through — the provider side (which enforces
    // exact-or-refuse) is the one that decides, not a silent drop.
    const offlineClient = controllableClient()
    vi.mocked(offlineClient.listModels).mockRejectedValue(new Error('catalog offline'))
    const offlineService = new CodexRuntimeService({
      settings: async () => settings(),
      probeRuntime: availableTestRuntime,
      createClient: () => offlineClient
    })
    await expect(
      offlineService.startTurn({
        threadId: 'thread-2',
        text: 'go',
        model: 'plain-model',
        reasoningEffort: 'high'
      })
    ).resolves.toMatchObject({ ok: true, turnId: 'turn-1' })
    const offlineParams = vi.mocked(offlineClient.startTurn).mock.calls[0]?.[0]
    expect(offlineParams).toBeDefined()
    expect(offlineParams).toMatchObject({
      model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
      effort: 'high'
    })
  })
})

describe('Codex model catalog reasoning admission', () => {
  function model(id: string, efforts: string[] = []) {
    return {
      id, model: id, displayName: id, description: '', hidden: false, isDefault: true,
      supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
      defaultReasoningEffort: '', inputModalities: ['text'], serviceTiers: [], defaultServiceTier: null
    }
  }

  it('keeps provider-owned explicit levels when the runtime catalog contains the managed alias', async () => {
    const client = controllableClient()
    vi.mocked(client.listModels).mockResolvedValue({ data: [model(DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS)], nextCursor: null })
    const service = new CodexRuntimeService({ settings: async () => settings(), probeRuntime: availableTestRuntime, createClient: () => client })
    try {
      await expect(service.startThread({ reasoningEffort: 'high' })).resolves.toMatchObject({ ok: true })
      await expect(service.startTurn({ threadId: 'thread-1', text: 'explicit provider level', reasoningEffort: 'high' })).resolves.toMatchObject({ ok: true })
      expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
        model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
        config: expect.objectContaining({ model_reasoning_effort: 'high' })
      }))
      expect(client.startTurn).toHaveBeenCalledWith(expect.objectContaining({
        model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS, effort: 'high'
      }))
    } finally { await service.stop() }
  })

  it('omits effort for ordinary and automatically delegated turns when the model declares no levels', async () => {
    const client = controllableClient()
    vi.mocked(client.listModels).mockResolvedValue({ data: [model(DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS)], nextCursor: null })
    const service = new CodexRuntimeService({ settings: async () => settings(), probeRuntime: availableTestRuntime, createClient: () => client })
    try {
      await expect(service.startThread({})).resolves.toMatchObject({ ok: true })
      await expect(service.startTurn({ threadId: 'thread-1', text: 'ordinary' })).resolves.toMatchObject({ ok: true })
      await expect(service.startThread({ relation: 'side', parentThreadId: 'parent' })).resolves.toMatchObject({ ok: true })
      await expect(service.startTurn({ threadId: 'thread-1', text: 'automatic collaboration' })).resolves.toMatchObject({ ok: true })
      for (const [params] of vi.mocked(client.startThread).mock.calls) expect(params.config).toBeUndefined()
      for (const [params] of vi.mocked(client.startTurn).mock.calls) {
        expect(params).not.toHaveProperty('effort')
        expect(params.collaborationMode).toEqual({ mode: 'default', settings: {
          model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS, reasoning_effort: null, developer_instructions: null
        } })
      }
    } finally { await service.stop() }
  })


})
