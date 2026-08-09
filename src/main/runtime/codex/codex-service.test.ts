import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_MODEL_ROUTER_PROVIDER_ID,
  DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../../shared/app-settings'
import { CodexRuntimeService } from './codex-service'
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
import {
  CAPABILITY_AGENT_TOOL_NAMES,
  createCapabilityAgentToolSurface
} from '../../capabilities/agent-tools'
import { CapabilityBroker } from '../../capabilities/broker'
import { CapabilityRegistry } from '../../capabilities/registry'
import type { AgentRuntimeToolSurface } from '../agent-runtime/agent-tool-surface'

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
      codex: defaultCodexRuntimeSettings()
    },
    modelRouter: configuredModelRouterSettings(),
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    remoteChannel: defaultRemoteChannelSettings(),
    connectPhone: defaultConnectPhoneSettings(),
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
    regions: [{
      regionRef: codexVisualRefs.region,
      label: 'Method overview',
      confidence: 0.98
    }],
    evidence: {
      summary: 'Located the requested figure.',
      claims: [{
        kind: 'observation',
        text: 'The figure is visible.',
        regionRef: codexVisualRefs.region,
        confidence: 0.98
      }],
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
    connect: vi.fn(async () => { throw new Error('app-server offline') }),
    listThreads: vi.fn(async () => { throw new Error('app-server offline') }),
    readThread: vi.fn(async () => { throw new Error('app-server offline') }),
    startThread: vi.fn(async () => { throw new Error('app-server offline') }),
    startTurn: vi.fn(async () => { throw new Error('app-server offline') }),
    renameThread: vi.fn(async () => { throw new Error('app-server offline') }),
    interruptTurn: vi.fn(async () => { throw new Error('app-server offline') }),
    steerTurn: vi.fn(async () => { throw new Error('app-server offline') }),
    request: vi.fn(async () => { throw new Error('app-server offline') }),
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
    listThreads: vi.fn(async () => ({ threads: [] })),
    readThread: vi.fn(async () => ({ thread: { id: 'thread-1', turns: [] } })),
    startThread: vi.fn(async () => ({ thread: { id: 'thread-1' } })),
    startTurn: vi.fn(async () => ({ turn: { id: 'turn-1' } })),
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

function scheduleFirstActivityGuard(
  service: CodexRuntimeService,
  threadId = 'thread-1',
  turnId = 'turn-1'
): void {
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

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'sciforge-codex-service-'))
}

type CodexThreadUpsert = Parameters<CodexThreadStore['upsert']>[0]

async function upsertMaterializedThread(
  store: CodexThreadStore,
  input: CodexThreadUpsert
): Promise<void> {
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
      settings: async () => current,
      sink: { send: vi.fn() },
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
      settings: async () => ({ ...settings(), ...selection }),
      sink: { send: vi.fn() },
      createClient
    })

    await expect(service.connect()).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('selected Agent runtime')
    })
    expect(createClient).not.toHaveBeenCalled()
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
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => failingClient()
    })

    await expect(service.listThreads()).resolves.toEqual({
      ok: true,
      threads: [expect.objectContaining({
        id: 'codex-thread-1',
        title: 'Stored Codex',
        workspace: '/tmp/workspace'
      })]
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
      sink: { send: vi.fn() },
      storageRoot,
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
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => failingClient()
    })

    await expect(service.listThreads({ includeArchived: true })).resolves.toEqual({
      ok: true,
      threads: [expect.objectContaining({ id: 'codex-primary', title: 'Primary Codex' })]
    })

    const withSide = await service.listThreads({ includeArchived: true, includeSide: true })
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
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => failingClient()
    })

    await expect(service.listThreads({ includeArchived: true })).resolves.toEqual({
      ok: true,
      threads: [expect.objectContaining({ id: 'real-codex-thread', title: 'Real work' })]
    })
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
      threads: [{
        id: 'codex-live-thread',
        name: 'Live thread',
        updatedAt: 1780272000,
        cwd: '/tmp/workspace'
      }]
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.listThreads()).resolves.toMatchObject({
      ok: true,
      threads: [expect.objectContaining({
        id: 'codex-live-thread',
        updatedAt: '2026-06-01T00:00:00.000Z'
      })]
    })
    await expect(new CodexThreadStore({ rootDir: storageRoot }).get('codex-live-thread')).resolves.toMatchObject({
      updatedAt: '2026-06-01T00:00:00.000Z'
    })
  })

  it('does not materialize unknown app-server threads from live lists', async () => {
    const storageRoot = await tempRoot()
    const client = controllableClient()
    vi.mocked(client.listThreads).mockResolvedValue({
      threads: [{
        id: 'codex-orphan-live-thread',
        name: 'Runtime-only thread',
        updatedAt: 1780272000,
        cwd: '/tmp/workspace'
      }]
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
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
      { guiThreadId: 'codex-primary', codexThreadId: 'codex-primary', workspace: '/tmp/workspace', title: 'Primary Codex', latestSeq: 1 },
      { guiThreadId: 'codex-side', codexThreadId: 'codex-side', workspace: '/tmp/workspace', title: 'Side Codex', latestSeq: 1 },
      { guiThreadId: 'codex-subagent', codexThreadId: 'codex-subagent', workspace: '/tmp/workspace', title: 'Reviewer', latestSeq: 1 },
      { guiThreadId: 'codex-workflow', codexThreadId: 'codex-workflow', workspace: '/tmp/workspace', title: 'Workflow', latestSeq: 1 },
      { guiThreadId: 'codex-local-workflow', codexThreadId: 'codex-local-workflow', workspace: '/tmp/workspace', title: 'Local workflow', latestSeq: 1 }
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
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.listThreads({ includeArchived: true })).resolves.toEqual({
      ok: true,
      threads: [expect.objectContaining({ id: 'codex-primary', title: 'Primary Codex' })]
    })

    const withSide = await service.listThreads({ includeArchived: true, includeSide: true })
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
      threads: [{
        id: 'codex-live-thread',
        name: 'New chat',
        preview: 'Summarize AlphaFold benchmark results in a table.',
        updatedAt: 1780272000,
        cwd: '/tmp/workspace'
      }]
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.listThreads()).resolves.toMatchObject({
      ok: true,
      threads: [expect.objectContaining({
        id: 'codex-live-thread',
        title: 'Codex thread',
        preview: 'Summarize AlphaFold benchmark results in a table.',
        titleSource: 'fallback'
      })]
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
      threads: [{
        id: 'codex-thread-1',
        name: 'New chat',
        preview: '针对非小细胞肺癌等 EGFR 相关疾病，能否从文献证据中确定一个可成药、结构可用的靶点？',
        updatedAt: 1780272000,
        cwd: '/tmp/workspace'
      }]
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.listThreads()).resolves.toMatchObject({
      ok: true,
      threads: [expect.objectContaining({
        id: 'gui-thread-1',
        codexThreadId: 'codex-thread-1',
        title: '靶点发现',
        preview: '针对非小细胞肺癌等 EGFR 相关疾病，能否从文献证据中确定一个可成药、结构可用的靶点？',
        titleSource: 'user'
      })]
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
      { guiThreadId: 'codex-main-thread', codexThreadId: 'codex-main-thread', workspace: '/tmp/workspace', title: 'Main thread', latestSeq: 1 },
      { guiThreadId: 'codex-child-thread', codexThreadId: 'codex-child-thread', workspace: '/tmp/workspace', title: 'Child worker', latestSeq: 1 }
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
      sink: { send: vi.fn() },
      storageRoot,
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
      { guiThreadId: 'codex-primary', codexThreadId: 'codex-primary', workspace: '/tmp/workspace', title: 'Primary thread', latestSeq: 1 },
      { guiThreadId: 'codex-main-override', codexThreadId: 'codex-main-override', workspace: '/tmp/workspace', title: 'Main override', latestSeq: 1 },
      { guiThreadId: 'codex-hidden-override', codexThreadId: 'codex-hidden-override', workspace: '/tmp/workspace', title: 'Hidden override', latestSeq: 1 },
      { guiThreadId: 'codex-legacy-child', codexThreadId: 'codex-legacy-child', workspace: '/tmp/workspace', title: 'Legacy child', latestSeq: 1 }
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
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    const defaultList = await service.listThreads({ includeArchived: true })
    expect(defaultList).toMatchObject({ ok: true })
    if (defaultList.ok) {
      expect(defaultList.threads.map((thread) => thread.id).sort()).toEqual([
        'codex-main-override',
        'codex-primary'
      ])
      expect(defaultList.threads.find((thread) => thread.id === 'codex-main-override')).toMatchObject({
        relation: 'side',
        sidebarVisibility: 'main'
      })
    }

    const withSide = await service.listThreads({ includeArchived: true, includeSide: true })
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
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    try {
      await expect(service.listThreads()).resolves.toEqual({
        ok: true,
        threads: [
          expect.objectContaining({ id: 'codex-active-2', title: 'Active Codex 2', archived: false }),
          expect.objectContaining({ id: 'codex-active-1', title: 'Active Codex 1', archived: false })
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
    expect(raw.threads).toEqual(expect.arrayContaining([
      expect.objectContaining({ codexThreadId: 'codex-active-1', archived: false }),
      expect.objectContaining({ codexThreadId: 'codex-active-2', archived: false }),
      expect.objectContaining({ codexThreadId: 'codex-archived-live', archived: true })
    ]))
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
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => failingClient()
    })

    await expect(service.readThread('codex-thread-1')).resolves.toEqual({
      ok: true,
      detail: expect.objectContaining({
        latestSeq: 2,
        blocks: [
          expect.objectContaining({ kind: 'user', id: 'user-1', text: 'hello' }),
          expect.objectContaining({ kind: 'assistant', text: 'hi there' })
        ]
      })
    })
  })

  it('uses explicit latestTurnId when app-server read returns turns out of order', async () => {
    const client = controllableClient()
    vi.mocked(client.readThread).mockResolvedValue({
      thread: {
        id: 'codex-thread-1',
        latestTurnId: 'turn-latest',
        turns: [
          {
            id: 'turn-latest',
            status: 'completed',
            items: [{
              id: 'assistant-latest',
              type: 'agentMessage',
              text: 'done'
            }]
          },
          {
            id: 'turn-stale',
            status: 'running',
            items: [{
              id: 'tool-stale',
              type: 'commandExecution',
              status: 'running',
              command: 'old command'
            }]
          }
        ]
      }
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      createClient: () => client
    })

    await expect(service.readThread('codex-thread-1')).resolves.toEqual({
      ok: true,
      detail: expect.objectContaining({
        latestTurnId: 'turn-latest',
        threadStatus: 'completed',
        blocks: expect.arrayContaining([
          expect.objectContaining({ kind: 'assistant', id: 'assistant-latest', turnId: 'turn-latest', text: 'done' }),
          expect.objectContaining({ kind: 'tool', id: 'tool-stale', turnId: 'turn-stale', status: 'running' })
        ])
      })
    })
  })

  it('dedupes repeated tool snapshots from app-server thread reads', async () => {
    const client = controllableClient()
    vi.mocked(client.readThread).mockResolvedValue({
      thread: {
        id: 'codex-thread-1',
        latestTurnId: 'turn-1',
        turns: [{
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
        }]
      }
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      createClient: () => client
    })

    await expect(service.readThread('codex-thread-1')).resolves.toEqual({
      ok: true,
      detail: expect.objectContaining({
        blocks: [
          expect.objectContaining({
            kind: 'tool',
            id: 'cmd-1',
            turnId: 'turn-1',
            status: 'success',
            detail: 'ok',
            meta: expect.objectContaining({ exitCode: 0 })
          })
        ]
      })
    })
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
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => failingClient()
    })

    await expect(service.readThread('codex-thread-1')).resolves.toEqual({
      ok: true,
      detail: expect.objectContaining({
        latestSeq: 5,
        blocks: [
          expect.objectContaining({ kind: 'user', id: 'user-1', turnId: 'turn-1', text: 'hello' }),
          expect.objectContaining({ kind: 'assistant', turnId: 'turn-1', text: 'hi' }),
          expect.objectContaining({ kind: 'user', id: 'user-2', turnId: 'turn-2', text: 'again' }),
          expect.objectContaining({ kind: 'assistant', turnId: 'turn-2', text: 'hi' })
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
      deltas: [{ kind: 'agent_message', text: 'Hello. How can I help?', snapshot: true }]
    })

    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => failingClient()
    })

    await expect(service.readThread('codex-thread-1')).resolves.toEqual({
      ok: true,
      detail: expect.objectContaining({
        blocks: [
          expect.objectContaining({ kind: 'user', id: 'user-1', text: 'hello' }),
          expect.objectContaining({ kind: 'assistant', text: 'Hello. How can I help?', snapshot: true })
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
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => failingClient()
    })

    await expect(service.readThread('codex-thread-1')).resolves.toEqual({
      ok: true,
      detail: expect.objectContaining({
        latestSeq: 4,
        blocks: [
          expect.objectContaining({ kind: 'user', id: 'user-1', turnId: 'turn-1', text: 'hello' }),
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

  it('treats stored turns without an active runtime as failed after restart', async () => {
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
        sink: { send: vi.fn() },
        storageRoot,
        createClient: () => failingClient()
      })
      vi.setSystemTime(new Date('2026-06-30T10:02:00.000Z'))

      await expect(service.readThread('codex-thread-1')).resolves.toEqual({
        ok: true,
        detail: expect.objectContaining({
          latestSeq: 3,
          latestTurnId: 'turn-1',
          threadStatus: 'failed',
          blocks: [
            expect.objectContaining({ kind: 'user', id: 'user-1', turnId: 'turn-1', text: 'hello' }),
            expect.objectContaining({
              kind: 'system',
              turnId: 'turn-1',
              code: 'runtime_disconnected',
              severity: 'error'
            })
          ]
        })
      })
      await expect(eventStore.read('codex-thread-1', { includeAll: true })).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: expect.objectContaining({
              runtimeError: expect.objectContaining({ code: 'runtime_disconnected' })
            })
          }),
          expect.objectContaining({
            event: expect.objectContaining({
              runtimeStatus: expect.objectContaining({ phase: 'turn_done' })
            })
          })
        ])
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('repairs stored user-only turns when live read still reports them running after restart', async () => {
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
          turns: [{
            id: 'turn-1',
            status: 'running',
            items: [{
              id: 'user-1',
              type: 'userMessage',
              content: [{ type: 'text', text: 'hello' }]
            }]
          }]
        }
      })
      const service = new CodexRuntimeService({
        settings: async () => settings(),
        sink: { send: vi.fn() },
        storageRoot,
        createClient: () => client
      })
      vi.setSystemTime(new Date('2026-06-30T10:02:00.000Z'))

      await expect(service.readThread('codex-thread-1')).resolves.toEqual({
        ok: true,
        detail: expect.objectContaining({
          latestSeq: 3,
          latestTurnId: 'turn-1',
          threadStatus: 'failed',
          blocks: expect.arrayContaining([
            expect.objectContaining({ kind: 'user', id: 'user-1', turnId: 'turn-1', text: 'hello' }),
            expect.objectContaining({
              kind: 'system',
              turnId: 'turn-1',
              code: 'runtime_disconnected',
              severity: 'error'
            })
          ])
        })
      })
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
          turns: [{
            id: 'turn-1',
            status: 'running',
            items: [{
              id: 'user-1',
              type: 'userMessage',
              content: [{ type: 'text', text: 'hello' }]
            }]
          }]
        }
      })
      const service = new CodexRuntimeService({
        settings: async () => settings(),
        sink: { send: vi.fn() },
        storageRoot,
        createClient: () => client
      })
      vi.setSystemTime(new Date('2026-06-30T10:00:10.000Z'))

      await expect(service.readThread('codex-thread-1')).resolves.toEqual({
        ok: true,
        detail: expect.objectContaining({
          latestSeq: 1,
          latestTurnId: 'turn-1',
          threadStatus: 'running',
          blocks: [expect.objectContaining({ kind: 'user', id: 'user-1', text: 'hello' })]
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
        turns: [{
          id: 'turn-1',
          status: 'running',
          items: [{
            id: 'user-1',
            type: 'userMessage',
            content: [{ type: 'text', text: 'hello' }]
          }]
        }]
      }
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.readThread('codex-thread-1')).resolves.toEqual({
      ok: true,
      detail: expect.objectContaining({
        latestSeq: 2,
        latestTurnId: 'turn-1',
        threadStatus: 'completed',
        blocks: [expect.objectContaining({ kind: 'user', id: 'user-1', turnId: 'turn-1', text: 'hello' })]
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
        turns: [{
          id: 'turn-1',
          status: 'running',
          items: [{
            id: 'user-1',
            type: 'userMessage',
            content: [{ type: 'text', text: 'hello' }]
          }]
        }]
      }
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.readThread('codex-thread-1')).resolves.toEqual({
      ok: true,
      detail: expect.objectContaining({
        latestSeq: 3,
        latestTurnId: 'turn-1',
        blocks: [
          expect.objectContaining({ kind: 'user', id: 'user-1', turnId: 'turn-1', text: 'hello' }),
          expect.objectContaining({ kind: 'tool', id: 'tool-1', turnId: 'turn-1', detail: 'done' }),
          expect.objectContaining({ kind: 'assistant', turnId: 'turn-1', text: 'hi there' })
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
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.readThread('gui-thread-1')).resolves.toEqual({
      ok: true,
      detail: { blocks: [], latestSeq: 0 }
    })
    expect(client.readThread).toHaveBeenCalledWith({ threadId: 'codex-thread-1', includeTurns: true })
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
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.readThread('gui-thread-1')).resolves.toEqual({
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
      sink: { send: vi.fn() },
      storageRoot,
      capabilityAgentTools: {
        tools: () => [],
        call: vi.fn(async () => ({ tool: 'unused', value: null })),
        abortTurn
      },
      createClient: () => client
    })

    await expect(service.startTurn({
      threadId: 'gui-thread-1',
      text: 'hello from IM'
    })).resolves.toMatchObject({
      ok: true,
      threadId: 'gui-thread-1',
      turnId: 'turn-1'
    })
    await expect(service.readThread('gui-thread-1')).resolves.toEqual({
      ok: true,
      detail: expect.objectContaining({
        latestSeq: expect.any(Number),
        latestTurnId: 'turn-1',
        blocks: expect.arrayContaining([
          expect.objectContaining({ kind: 'user', id: 'user-1', text: 'hello from IM' })
        ])
      })
    })
    expect(client.stop).not.toHaveBeenCalled()

    await expect(service.interruptTurn('gui-thread-1', 'turn-1')).resolves.toMatchObject({ ok: true })
    expect(client.interruptTurn).toHaveBeenCalledWith({
      threadId: 'codex-thread-1',
      turnId: 'turn-1'
    })
    expect(abortTurn).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'gui-thread-1',
      turnId: 'turn-1'
    }, 'user_stop')
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
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient
    })

    await expect(service.readStoredEvents('codex-thread-1', 1)).resolves.toEqual([
      { threadId: 'codex-thread-1', seq: 2, turnComplete: true }
    ])
    expect(createClient).not.toHaveBeenCalled()
  })
})

describe('CodexRuntimeService compatibility operations', () => {
  it('shares in-flight app-server client creation across concurrent connects', async () => {
    const settingsGate = deferred<AppSettingsV1>()
    const firstClient = controllableClient()
    const secondClient = controllableClient()
    const createClient = vi.fn()
      .mockReturnValueOnce(firstClient)
      .mockReturnValueOnce(secondClient)
    const service = new CodexRuntimeService({
      settings: () => settingsGate.promise,
      sink: { send: vi.fn() },
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
      settings: async () => settings(),
      sink: { send: vi.fn() },
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
    const createClient = vi.fn()
      .mockReturnValueOnce(firstClient)
      .mockReturnValueOnce(secondClient)
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
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
      sink: { send: vi.fn() },
      createClient: () => failingClient()
    })

    await expect(service.connect()).resolves.toEqual({
      ok: false,
      message: 'app-server offline',
      recoverable: true
    })
  })

  it('recreates the app-server client after a recoverable failure', async () => {
    const firstClient = failingClient()
    const secondClient = controllableClient()
    const createClient = vi.fn()
      .mockReturnValueOnce(firstClient)
      .mockReturnValueOnce(secondClient)
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      createClient
    })

    await expect(service.connect()).resolves.toEqual({
      ok: false,
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
    const createClient = vi.fn()
      .mockReturnValueOnce(first.client)
      .mockReturnValueOnce(secondClient)
    const sink = { send: vi.fn() }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
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
      expect(sink.send).toHaveBeenCalledWith(CODEX_MAIN_IPC_CHANNELS.closed, { reason: 'error' })
    })

    await expect(service.connect()).resolves.toEqual({ ok: true, info: {} })
    expect(createClient).toHaveBeenCalledTimes(2)
    expect(secondClient.connect).toHaveBeenCalled()
  })

  it('marks active turns failed when the app-server event stream closes', async () => {
    const queued = clientWithQueuedEvents()
    const sink = { send: vi.fn() }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
      createClient: () => queued.client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    sink.send.mockClear()

    queued.push({
      type: 'closed',
      channel: CODEX_MAIN_IPC_CHANNELS.closed,
      reason: 'error'
    })

    await vi.waitFor(() => {
      expect(sink.send).toHaveBeenCalledWith(CODEX_MAIN_IPC_CHANNELS.event, {
        event: expect.objectContaining({
          threadId: 'thread-1',
          turnId: 'turn-1',
          runtimeError: expect.objectContaining({
            code: 'runtime_disconnected',
            severity: 'error'
          })
        })
      })
    })
    expect(sink.send).toHaveBeenCalledWith(CODEX_MAIN_IPC_CHANNELS.event, {
      event: expect.objectContaining({
        threadId: 'thread-1',
        turnId: 'turn-1',
        runtimeStatus: expect.objectContaining({ phase: 'turn_done' })
      })
    })
    expect(sink.send).toHaveBeenCalledWith(CODEX_MAIN_IPC_CHANNELS.closed, { reason: 'error' })
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
    const sink = { send: vi.fn() }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
      storageRoot,
      createClient: () => client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    sink.send.mockClear()

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
    expect(sink.send).toHaveBeenCalledWith(CODEX_MAIN_IPC_CHANNELS.event, {
      event: expect.objectContaining({
        threadId: 'thread-1',
        turnId: 'turn-1',
        runtimeError: expect.objectContaining({ code: 'runtime_stopped' })
      })
    })
  })

  it('keeps active stored turns running when readThread sees a stopped client', async () => {
    const storageRoot = await tempRoot()
    const eventStore = new CodexEventStore({ rootDir: storageRoot })
    const client = controllableClient()
    vi.mocked(client.readThread).mockRejectedValue(new Error('Codex app-server client stopped.'))
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })

    await expect(service.readThread('thread-1')).resolves.toEqual({
      ok: true,
      detail: expect.objectContaining({
        latestTurnId: 'turn-1',
        blocks: expect.arrayContaining([
          expect.objectContaining({ kind: 'user', id: expect.stringMatching(/^codex-user-/), text: 'hello' })
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
      sink: { send: vi.fn() },
      storageRoot,
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
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.archiveThread('gui-thread-1', true)).resolves.toEqual({ ok: true })
    await expect(threadStore.get('gui-thread-1')).resolves.toMatchObject({ archived: true })
    expect(client.request).toHaveBeenCalledWith('thread/archive', { threadId: 'codex-thread-missing' })
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
      sink: { send: vi.fn() },
      storageRoot,
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
      threads: [{
        id: 'codex-thread-1',
        name: 'Archived Codex',
        cwd: '/tmp/workspace',
        status: 'idle'
      }]
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.listThreads()).resolves.toEqual({ ok: true, threads: [] })
    await expect(service.listThreads({ includeArchived: true })).resolves.toEqual({
      ok: true,
      threads: [expect.objectContaining({ id: 'codex-thread-1', archived: true })]
    })
  })

  it('initializes the app-server session before thread operations', async () => {
    const client = controllableClient()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      createClient: () => client
    })

    await expect(service.startThread({ title: 'Direct UI thread' })).resolves.toMatchObject({
      ok: true,
      thread: expect.objectContaining({ id: 'thread-1' })
    })

    expect(client.connect).toHaveBeenCalled()
    expect(client.startThread).toHaveBeenCalled()
    expect(vi.mocked(client.connect).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(client.startThread).mock.invocationCallOrder[0]
    )
  })

  it('returns the persisted GUI thread with resolved workspace after starting a thread', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'codex-runtime-service-'))
    const client = controllableClient()
    vi.mocked(client.startThread).mockResolvedValue({ thread: { id: 'codex-thread-new' } })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
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

  it('persists side-thread visibility metadata after starting a Codex thread', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'codex-runtime-service-'))
    const client = controllableClient()
    vi.mocked(client.startThread).mockResolvedValue({ thread: { id: 'codex-thread-new' } })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.startThread({
      title: 'PDF: selected text',
      relation: 'side',
      threadSource: 'pdf_annotation',
      sidebarVisibility: 'hidden'
    })).resolves.toMatchObject({
      ok: true,
      thread: {
        id: 'codex-thread-new',
        relation: 'side',
        threadSource: 'pdf_annotation',
        sidebarVisibility: 'hidden'
      }
    })
    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      relation: 'side',
      threadSource: 'pdf_annotation',
      sidebarVisibility: 'hidden',
      source: expect.objectContaining({
        type: 'pdf_annotation',
        relation: 'side',
        sidebarVisibility: 'hidden'
      })
    }))
  })

  it('advertises only Host-allowed capability tools and routes them with trusted thread workspace context', async () => {
    const storageRoot = await tempRoot()
    const client = controllableClient()
    let pendingServerRequests: CodexAppServerPendingRequestRegistryOptions | undefined
    const broker = new CapabilityBroker(new CapabilityRegistry())
    const discover = vi.spyOn(broker, 'discover')
    const resolveCaller = vi.fn((toolContext: {
      requestId: string | number
      runtimeId?: string
      threadId?: string
      workspaceId?: string
    }) => ({
      audience: 'agent' as const,
      callerId: toolContext.threadId ?? String(toolContext.requestId),
      workspaceId: toolContext.workspaceId,
      approvals: []
    }))
    const capabilityAgentTools = createCapabilityAgentToolSurface({ broker, resolveCaller })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      capabilityAgentTools,
      createClient: (options) => {
        pendingServerRequests = options.pendingServerRequests as CodexAppServerPendingRequestRegistryOptions
        return client
      }
    })

    await expect(service.startThread({
      title: 'Capability thread',
      workspace: '/tmp/capability-workspace',
      allowedTools: [CAPABILITY_AGENT_TOOL_NAMES.discover]
    })).resolves.toMatchObject({ ok: true })

    const startParams = vi.mocked(client.startThread).mock.calls[0]?.[0] as {
      dynamicTools?: Array<{ name: string }>
    }
    const dynamicTools = startParams.dynamicTools ?? []
    expect(dynamicTools.map((tool) => tool.name)).toEqual([
      CAPABILITY_AGENT_TOOL_NAMES.discover
    ])

    await expect(pendingServerRequests?.onToolCallRequest?.({
      requestId: 'capability-request-1',
      callId: 'capability-call-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {}
    })).resolves.toMatchObject({
      success: false,
      errorCode: 'capability_discovery_empty',
      contentItems: [{
        type: 'inputText',
        text: expect.stringContaining('No capability matched the discovery request')
      }]
    })
    expect(resolveCaller).toHaveBeenCalledWith({
      requestId: 'capability-request-1',
      runtimeId: 'codex',
      callId: 'capability-call-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      workspaceId: '/tmp/capability-workspace'
    })
    expect(discover).toHaveBeenCalledWith({
      audience: 'agent',
      callerId: 'thread-1',
      workspaceId: '/tmp/capability-workspace',
      approvals: []
    }, { limit: 8 }, { context: expect.objectContaining({ runtimeId: 'codex', threadId: 'thread-1' }) })
  })

  it('mints completion receipts only for strict in-process native visual results', async () => {
    const storageRoot = await tempRoot()
    const client = controllableClient()
    let pendingServerRequests: CodexAppServerPendingRequestRegistryOptions | undefined
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
      call: async () => ({
        tool: 'sciforge_look',
        value: output
      })
    }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      capabilityAgentTools: surface,
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
      completionReceipts: [{
        kind: 'visual.look',
        callId: 'native-call',
        receiptId: codexVisualRefs.proof
      }]
    })
    expect(ordinaryResult).not.toHaveProperty('completionReceipts')
  })

  it('preserves structured native visual recovery metadata in Codex tool receipts', async () => {
    const storageRoot = await tempRoot()
    const client = controllableClient()
    const sink = { send: vi.fn() }
    let pendingServerRequests: CodexAppServerPendingRequestRegistryOptions | undefined
    const surface: AgentRuntimeToolSurface = {
      tools: () => [{
        type: 'function',
        name: 'sciforge_look',
        description: 'Look.',
        inputSchema: { type: 'object', properties: {} }
      }],
      call: async () => {
        throw Object.assign(new Error('The bound surface is hidden.'), {
          code: 'visual_layout_owner_changed',
          failureClass: 'layout_unavailable',
          retryable: false,
          providerStage: 'visual_surface_binding',
          resourceIdentity: 'visual:current',
          recovery: {
            action: 'restore_bound_surface',
            instruction: 'Restore the task-bound surface before starting a new visual call.'
          }
        })
      }
    }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
      storageRoot,
      capabilityAgentTools: surface,
      createClient: (options) => {
        pendingServerRequests = options.pendingServerRequests as CodexAppServerPendingRequestRegistryOptions
        return client
      }
    })

    await service.startThread({
      title: 'Native visual failure',
      workspace: '/tmp/capability-workspace'
    })
    await expect(pendingServerRequests?.onToolCallRequest?.({
      requestId: 'native-failure-request',
      callId: 'native-failure-call',
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: 'sciforge_look',
      arguments: {}
    })).resolves.toMatchObject({
      success: false,
      errorCode: 'visual_layout_owner_changed',
      failureClass: 'layout_unavailable',
      retryable: false,
      recoveryGuidance: 'Restore the task-bound surface before starting a new visual call.',
      providerStage: 'visual_surface_binding',
      resourceIdentity: 'visual:current'
    })
    expect(sink.send).toHaveBeenCalledWith(CODEX_MAIN_IPC_CHANNELS.event, {
      event: expect.objectContaining({
        tool: expect.objectContaining({
          status: 'error',
          meta: expect.objectContaining({
            errorCode: 'visual_layout_owner_changed',
            retryable: false,
            recoveryGuidance: 'Restore the task-bound surface before starting a new visual call.',
            providerStage: 'visual_surface_binding'
          })
        })
      })
    })
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
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => queued.client
    })
    await service.startThread({ threadId: 'parent-thread', title: 'Parent' })
    await service.startTurn({ threadId: 'parent-thread', text: 'Delegate this task.' })

    const spawned = vi.fn()
    const controller = new AbortController()
    const completion = service.spawnSubagent({
      childId: 'child-1',
      parentThreadId: 'parent-thread',
      parentTurnId: 'parent-turn',
      label: 'Reviewer',
      prompt: 'Review the repository.',
      signal: controller.signal,
      appendTranscript: vi.fn(async () => undefined),
      onSpawned: spawned
    })
    await vi.waitFor(() => expect(spawned).toHaveBeenCalledWith({
      runtime: 'codex',
      threadId: expect.any(String),
      turnId: 'child-turn'
    }))
    await expect(service.inspectSubagent({
      childId: 'child-1',
      parentThreadId: 'parent-thread',
      parentTurnId: 'parent-turn',
      signal: new AbortController().signal
    })).resolves.toMatchObject({ state: 'active' })
    await expect(service.messageSubagent({
      childId: 'child-1',
      parentThreadId: 'parent-thread',
      parentTurnId: 'parent-turn',
      message: 'Report progress.',
      signal: new AbortController().signal
    })).resolves.toEqual({ established: true })
    expect(queued.client.steerTurn).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'child-codex-thread',
      expectedTurnId: 'child-turn'
    }), expect.any(AbortSignal))

    await service.cancelSubagent({
      childId: 'child-1',
      parentThreadId: 'parent-thread',
      parentTurnId: 'parent-turn',
      reason: 'parent_cancel',
      signal: new AbortController().signal
    })
    expect(queued.client.interruptTurn).toHaveBeenCalledWith({
      threadId: 'child-codex-thread',
      turnId: 'child-turn'
    }, expect.any(AbortSignal))
    controller.abort()
    await expect(completion).rejects.toThrow('aborted')
    await expect(service.inspectSubagent({
      childId: 'child-1',
      parentThreadId: 'parent-thread',
      parentTurnId: 'parent-turn',
      signal: new AbortController().signal
    })).resolves.toMatchObject({ state: 'missing' })
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
      sink: { send: vi.fn() },
      createClient: () => client
    })

    await expect(service.startThread({
      title: 'Router-only thread',
      model: 'external-payload-model',
      modelProvider: 'external-payload-provider',
      profile: 'external-payload-profile',
      baseUrl: 'https://payload.external-provider.test/v1',
      apiKey: 'sk-payload'
    } as unknown as Parameters<CodexRuntimeService['startThread']>[0])).resolves.toMatchObject({
      ok: true
    })

    const params = vi.mocked(client.startThread).mock.calls[0]?.[0] ?? {}
    expect(params).toEqual(expect.objectContaining({
      model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
      modelProvider: DEFAULT_MODEL_ROUTER_PROVIDER_ID
    }))
    expect(params).not.toEqual(expect.objectContaining({
      profile: expect.anything(),
      baseUrl: expect.anything(),
      apiKey: expect.anything()
    }))
    expect(params).not.toEqual(expect.objectContaining({
      model: 'external-payload-model',
      modelProvider: 'external-payload-provider'
    }))
    expect(params).not.toEqual(expect.objectContaining({
      model: 'external-runtime-model',
      modelProvider: 'external-runtime-provider'
    }))
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
      sink: { send: vi.fn() },
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
    const client = controllableClient()
    vi.mocked(client.connect).mockResolvedValue({
      userAgent: 'sciforge/development (Mac OS 15.7.4; arm64) xterm-256color (sciforge; 0.1.0)',
      codexHome: managedCodexHome,
      platformFamily: 'unix',
      platformOs: 'macos'
    })
    let trusted = false
    client.listHooks = vi.fn(async (cwds) => {
      const sourcePath = await realpath(join(managedCodexHome, 'hooks.json'))
      const hookConfig = JSON.parse(
        await readFile(join(managedCodexHome, 'hooks.json'), 'utf8')
      ) as {
        hooks: {
          PreToolUse: Array<{
            hooks: Array<{ command: string; commandWindows: string }>
          }>
        }
      }
      const handler = hookConfig.hooks.PreToolUse[0].hooks[0]
      return {
        data: [{
          cwd: cwds[0],
          hooks: [{
            key: `${sourcePath}:pre_tool_use:0:0`,
            eventName: 'preToolUse',
            handlerType: 'command',
            matcher: null,
            command: process.platform === 'win32'
              ? handler.commandWindows
              : handler.command,
            timeoutSec: 10,
            statusMessage: 'Checking SciForge visual execution policy',
            sourcePath,
            source: 'user',
            pluginId: null,
            displayOrder: 0,
            enabled: true,
            isManaged: false,
            currentHash: `sha256:${'a'.repeat(64)}`,
            trustStatus: trusted ? 'trusted' as const : 'untrusted' as const
          }],
          warnings: [],
          errors: []
        }]
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
      sink: { send: vi.fn() },
      managedCodexHome,
      storageRoot: root,
      preToolUseHookLaunch: {
        appPath,
        execPath: process.execPath,
        isPackaged: false
      },
      createClient: () => client
    })

    await expect(service.connect()).resolves.toMatchObject({ ok: true })
    expect(client.listHooks).toHaveBeenCalledTimes(2)
    expect(client.writeConfigBatch).toHaveBeenCalledOnce()
    const trustWrite = vi.mocked(client.writeConfigBatch).mock.calls[0]?.[0]
    expect(trustWrite).toMatchObject({
      edits: [{
        keyPath: 'hooks.state',
        mergeStrategy: 'upsert'
      }],
      filePath: join(managedCodexHome, 'config.toml'),
      reloadUserConfig: true
    })
    const trustedState = trustWrite?.edits[0]?.value as Record<string, unknown>
    expect(Object.entries(trustedState)).toEqual([[
      expect.stringContaining(':pre_tool_use:0:0'),
      {
        enabled: true,
        trusted_hash: `sha256:${'a'.repeat(64)}`
      }
    ]])
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
      sink: { send: vi.fn() },
      createClient: () => client
    })

    await expect(service.startTurn({
      threadId: 'thread-1',
      text: 'hello',
      model: 'external-payload-model',
      profile: 'external-payload-profile',
      baseUrl: 'https://payload.external-provider.test/v1',
      apiKey: 'sk-payload'
    } as unknown as Parameters<CodexRuntimeService['startTurn']>[0])).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })

    const params = vi.mocked(client.startTurn).mock.calls[0]?.[0] ?? {}
    expect(params).toEqual(expect.objectContaining({
      model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
    }))
    expect(params).not.toHaveProperty('modelProvider')
    expect(params).not.toEqual(expect.objectContaining({
      profile: expect.anything(),
      baseUrl: expect.anything(),
      apiKey: expect.anything()
    }))
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
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(Promise.all([
      service.startTurn({ threadId: 'gui-thread-a', text: 'alpha' }),
      service.startTurn({ threadId: 'gui-thread-b', text: 'beta' })
    ])).resolves.toEqual([
      expect.objectContaining({ ok: true, threadId: 'gui-thread-a' }),
      expect.objectContaining({ ok: true, threadId: 'gui-thread-b' })
    ])

    const calls = vi.mocked(client.startTurn).mock.calls.map(([params]) => params)
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        responsesapiClientMetadata: { runtime_id: 'codex', gui_thread_id: 'gui-thread-a' }
      }),
      expect.objectContaining({
        responsesapiClientMetadata: { runtime_id: 'codex', gui_thread_id: 'gui-thread-b' }
      })
    ]))
  })

  it('stops a warm Codex client and fails closed when Model Router settings drift invalid', async () => {
    const client = controllableClient()
    const current = settings()
    const service = new CodexRuntimeService({
      settings: async () => current,
      sink: { send: vi.fn() },
      createClient: () => client
    })

    await expect(service.connect()).resolves.toMatchObject({ ok: true })
    current.modelRouter = {
      ...current.modelRouter!,
      publicModelAlias: 'deepseek-v4-pro'
    }
    await expect(service.startTurn({
      threadId: 'thread-1',
      text: 'hello after settings drift'
    })).resolves.toMatchObject({
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
    vi.mocked(queued.client.startThread).mockResolvedValue({ thread: { id: 'replacement-codex-thread', cwd: '/tmp/workspace' } })
    vi.mocked(queued.client.startTurn)
      .mockResolvedValueOnce({ turn: { id: 'turn-old', userMessageItemId: 'user-old' } })
      .mockResolvedValueOnce({ turn: { id: 'turn-retry', userMessageItemId: 'user-retry' } })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => queued.client
    })

    await expect(service.startTurn({
      threadId: 'gui-thread-1',
      text: 'hello',
      nativeVisualProofChainPending: true
    })).resolves.toMatchObject({
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
          item: { id: 'assistant-old', type: 'agentMessage', text: 'partial answer' }
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
            message: 'stream disconnected before completion: Model Router requests must use the public router model alias.'
          }
        }
      }
    })

    await vi.waitFor(() => {
      expect(queued.client.startTurn).toHaveBeenCalledTimes(2)
      expect(modelDeltaDedupeProbe(service).states.size).toBe(0)
    })
    await expect(new CodexPreToolUseGovernanceBridge({ storageRoot }).evaluate({
      hook_event_name: 'PreToolUse',
      session_id: 'replacement-codex-thread',
      turn_id: 'turn-retry-not-materialized-yet',
      tool_name: 'Bash',
      tool_use_id: 'call-retry-before-start-response',
      tool_input: { command: 'python inspect.py' },
      cwd: '/tmp/workspace'
    })).resolves.toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining(
          'native_visual_proof_chain_required'
        )
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

    expect(queued.client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/tmp/workspace',
      model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
      modelProvider: DEFAULT_MODEL_ROUTER_PROVIDER_ID
    }))
    expect(queued.client.startTurn).toHaveBeenNthCalledWith(1, expect.objectContaining({
      threadId: 'stale-codex-thread',
      model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
    }))
    expect(queued.client.startTurn).toHaveBeenNthCalledWith(2, expect.objectContaining({
      threadId: 'replacement-codex-thread',
      model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
    }))
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
    expect(events.some((item) =>
      item.event.runtimeError?.message.includes('public router model alias')
    )).toBe(false)
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
    vi.mocked(client.startThread).mockResolvedValue({ thread: { id: 'codex-thread-new', cwd: '/tmp/workspace' } })
    vi.mocked(client.startTurn)
      .mockRejectedValueOnce(new Error('thread not found: codex-thread-old'))
      .mockResolvedValueOnce({ turn: { id: 'turn-1', userMessageItemId: 'user-1' } })
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
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.startTurn({
      threadId: 'gui-thread-1',
      text: 'hello',
      model: 'external-payload-model'
    })).resolves.toMatchObject({
      ok: true,
      threadId: 'gui-thread-1',
      turnId: 'turn-1'
    })

    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
      modelProvider: DEFAULT_MODEL_ROUTER_PROVIDER_ID
    }))
    expect(client.startThread).not.toHaveBeenCalledWith(expect.objectContaining({
      model: 'external-runtime-model',
      modelProvider: 'external-runtime-provider'
    }))
    expect(client.startTurn).toHaveBeenNthCalledWith(1, expect.objectContaining({
      threadId: 'codex-thread-old',
      model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
    }))
    expect(client.startTurn).toHaveBeenNthCalledWith(2, expect.objectContaining({
      threadId: 'codex-thread-new',
      model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
    }))
    expect(vi.mocked(client.startTurn).mock.calls[0]?.[0]).not.toHaveProperty('modelProvider')
    expect(vi.mocked(client.startTurn).mock.calls[1]?.[0]).not.toHaveProperty('modelProvider')
    expect(vi.mocked(client.startTurn).mock.calls[1]?.[0].responsesapiClientMetadata).toEqual(
      vi.mocked(client.startTurn).mock.calls[0]?.[0].responsesapiClientMetadata
    )
  })

  it('passes explicit app-server reasoning params through thread and turn starts', async () => {
    const client = controllableClient()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      createClient: () => client
    })

    await expect(service.startThread({ title: 'Reasoning thread' })).resolves.toMatchObject({
      ok: true
    })
    await expect(service.startTurn({
      threadId: 'thread-1',
      text: 'think carefully',
      reasoningEffort: 'high'
    })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })

    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      config: {
        model_reasoning_effort: 'medium',
        show_raw_agent_reasoning: true,
        model_reasoning_summary: 'detailed'
      }
    }))
    expect(client.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      effort: 'high',
      summary: 'detailed'
    }))
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
    vi.mocked(client.startThread).mockResolvedValue({ thread: { id: 'codex-thread-new', cwd: '/tmp/workspace' } })
    vi.mocked(client.startTurn)
      .mockRejectedValueOnce(new Error('thread not found: codex-thread-old'))
      .mockResolvedValueOnce({ turn: { id: 'turn-1', userMessageItemId: 'user-1' } })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.startTurn({ threadId: 'gui-thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      threadId: 'gui-thread-1',
      turnId: 'turn-1'
    })

    expect(client.startTurn).toHaveBeenNthCalledWith(1, expect.objectContaining({ threadId: 'codex-thread-old' }))
    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/tmp/workspace',
      serviceName: 'SciForge',
      ephemeral: false
    }))
    expect(client.startTurn).toHaveBeenNthCalledWith(2, expect.objectContaining({ threadId: 'codex-thread-new' }))
    await expect(threadStore.get('gui-thread-1')).resolves.toMatchObject({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-new'
    })
    vi.mocked(client.listThreads).mockResolvedValueOnce({
      threads: [{
        id: 'codex-thread-new',
        name: 'Recovered Codex',
        cwd: '/tmp/workspace',
        status: 'idle'
      }]
    })
    await expect(service.listThreads({ includeArchived: true })).resolves.toMatchObject({
      ok: true,
      threads: [expect.objectContaining({
        id: 'gui-thread-1',
        codexThreadId: 'codex-thread-new',
        title: 'Recovered Codex'
      })]
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
    vi.mocked(client.startThread).mockResolvedValue({ thread: { id: 'codex-thread-new', cwd: '/tmp/workspace' } })
    vi.mocked(client.startTurn)
      .mockRejectedValueOnce(new Error('thread not found: codex-thread-old'))
      .mockResolvedValueOnce({ turn: { id: 'turn-1', userMessageItemId: 'user-1' } })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.startTurn({ threadId: 'gui-thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      threadId: 'gui-thread-1',
      turnId: 'turn-1',
      userMessageItemId: 'user-1'
    })

    expect(client.startTurn).toHaveBeenNthCalledWith(1, expect.objectContaining({ threadId: 'codex-thread-old' }))
    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/tmp/workspace',
      serviceName: 'SciForge',
      ephemeral: false
    }))
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
    vi.mocked(client.startThread).mockResolvedValue({ thread: { id: 'codex-thread-new', cwd: '/tmp/workspace' } })
    vi.mocked(client.startTurn)
      .mockRejectedValueOnce(new Error('thread not found: gui-thread-1'))
      .mockResolvedValueOnce({ turn: { id: 'turn-1', userMessageItemId: 'user-1' } })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.startTurn({ threadId: 'gui-thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      threadId: 'gui-thread-1',
      turnId: 'turn-1'
    })

    expect(client.startTurn).toHaveBeenNthCalledWith(1, expect.objectContaining({ threadId: 'gui-thread-1' }))
    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/tmp/workspace',
      serviceName: 'SciForge',
      ephemeral: false
    }))
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
    vi.mocked(client.startThread).mockResolvedValue({ thread: { id: 'codex-thread-new', cwd: '/tmp/workspace' } })
    vi.mocked(client.startTurn)
      .mockRejectedValueOnce(new Error('thread not found: codex-thread-old'))
      .mockResolvedValueOnce({ turn: { id: 'turn-1', userMessageItemId: 'user-1' } })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.startTurn({ threadId: 'gui-thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      threadId: 'gui-thread-1',
      turnId: 'turn-1',
      userMessageItemId: 'user-1'
    })

    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/tmp/workspace',
      serviceName: 'SciForge',
      ephemeral: false
    }))
    await expect(threadStore.get('gui-thread-1')).resolves.toMatchObject({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-new'
    })
    const events = await new CodexEventStore({ rootDir: storageRoot }).read('gui-thread-1', { includeAll: true })
    expect(events.map((item) => item.event.userMessage?.text).filter(Boolean)).toEqual([
      'previous context',
      'hello'
    ])
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
      vi.mocked(client.startThread).mockResolvedValue({ thread: { id: 'codex-thread-new', cwd: '/tmp/workspace' } })
      vi.mocked(client.startTurn)
        .mockRejectedValueOnce(new Error('thread not found: codex-thread-old'))
        .mockResolvedValueOnce({ turn: { id: 'turn-1', userMessageItemId: 'user-1' } })
      const service = new CodexRuntimeService({
        settings: async () => settings(),
        sink: { send: vi.fn() },
        storageRoot,
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
    vi.mocked(client.startThread).mockResolvedValue({ thread: { id: 'codex-thread-new', cwd: '/tmp/workspace' } })
    vi.mocked(client.startTurn)
      .mockRejectedValueOnce(new Error('thread not found: gui-thread-1'))
      .mockResolvedValueOnce({ turn: { id: 'turn-1', userMessageItemId: 'user-1' } })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
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
      sink: { send: vi.fn() },
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
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.startTurn({
      threadId: 'thread-1',
      text: 'expanded runtime prompt',
      displayText: 'short user prompt'
    })).resolves.toMatchObject({
      ok: true,
      threadId: 'thread-1',
      turnId: 'turn-1'
    })

    expect(client.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      input: [
        {
          type: 'text',
          text: 'expanded runtime prompt',
          text_elements: []
        }
      ]
    }))
    expect(vi.mocked(client.startTurn).mock.calls[0]?.[0]).not.toHaveProperty('displayText')
    const events = await new CodexEventStore({ rootDir: storageRoot }).read('thread-1', { includeAll: true })
    expect(events.at(-1)?.event.userMessage).toMatchObject({
      itemId: 'user-1',
      text: 'expanded runtime prompt',
      displayText: 'short user prompt'
    })
    await expect(service.readThread('thread-1')).resolves.toEqual({
      ok: true,
      detail: expect.objectContaining({
        blocks: [
          expect.objectContaining({
            kind: 'user',
            id: 'user-1',
            text: 'expanded runtime prompt',
            displayText: 'short user prompt'
          })
        ]
      })
    })
  })

  it('encodes structured workspace references with Codex-supported input variants', async () => {
    const client = controllableClient()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      createClient: () => client
    })

    await expect(service.startTurn({
      threadId: 'thread-1',
      text: 'Analyze the references',
      workspace: '/tmp/workspace',
      fileReferences: [
        {
          path: 'papers/large.pdf',
          relativePath: 'papers/large.pdf',
          name: 'large.pdf',
          kind: 'pdf',
          mimeType: 'application/pdf',
          modelRouterObject: true
        },
        {
          path: 'figures/cell.png',
          relativePath: 'figures/cell.png',
          name: 'cell.png',
          kind: 'image',
          mimeType: 'image/png',
          modelRouterObject: true
        }
      ]
    })).resolves.toMatchObject({ ok: true })

    expect(client.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      input: [
        {
          type: 'text',
          text: 'Analyze the references',
          text_elements: []
        },
        {
          type: 'mention',
          name: 'large.pdf',
          path: 'papers/large.pdf'
        },
        {
          type: 'localImage',
          path: 'figures/cell.png'
        }
      ]
    }))
  })

  it('treats compact as an explicit no-op without starting app-server JSON-RPC', async () => {
    const createClient = vi.fn(() => controllableClient())
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      createClient
    })

    await expect(service.compactThread('thread-1')).resolves.toEqual({ ok: true })

    expect(createClient).not.toHaveBeenCalled()
  })

  it('rematerializes persistent backend threads during compact', async () => {
    const storageRoot = await tempRoot()
    await new CodexThreadStore({ rootDir: storageRoot }).upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-old',
      workspace: '/tmp/workspace',
      title: 'Long Codex thread'
    })
    const client = controllableClient()
    vi.mocked(client.startThread).mockResolvedValue({
      thread: { id: 'codex-thread-new', cwd: '/tmp/workspace' }
    })
    const createClient = vi.fn(() => client)
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient
    })

    await expect(service.compactThread('gui-thread-1', 'auto context compaction')).resolves.toEqual({ ok: true })

    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/tmp/workspace',
      serviceName: 'SciForge',
      ephemeral: false,
      model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
      modelProvider: DEFAULT_MODEL_ROUTER_PROVIDER_ID
    }))
    expect(client.startTurn).not.toHaveBeenCalled()
    await expect(new CodexThreadStore({ rootDir: storageRoot }).get('gui-thread-1')).resolves.toMatchObject({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-new',
      workspace: '/tmp/workspace',
      title: 'Long Codex thread'
    })
  })

  it('fails fork and resume closed with structured recoverable errors', async () => {
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      createClient: () => controllableClient()
    })

    await expect(service.forkThread('thread-1')).resolves.toEqual({
      ok: false,
      code: 'capability_unavailable',
      message: 'Codex thread fork is not supported yet.',
      recoverable: true
    })
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
      sink: { send: vi.fn() },
      createClient: () => client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    await expect(service.interruptTurn('thread-1', 'turn-1', { discard: true })).resolves.toEqual({ ok: true })

    expect(client.interruptTurn).toHaveBeenCalledWith({ threadId: 'thread-1', turnId: 'turn-1' })
    expect(client.stop).toHaveBeenCalled()
  })

  it('rejects stale Codex control targets before calling app-server', async () => {
    const client = controllableClient()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
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
    await expect(service.steerTurn({
      threadId: 'thread-1',
      turnId: 'old-turn',
      text: 'continue'
    })).resolves.toEqual({
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
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })
    const bridge = new CodexPreToolUseGovernanceBridge({ storageRoot })

    await expect(service.startTurn({
      threadId: 'thread-1',
      text: 'inspect the visual',
      ownedVisualToolsAvailable: true
    })).resolves.toMatchObject({ ok: true, turnId: 'turn-1' })
    await expect(service.updateTurnGovernanceSnapshot({
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      snapshot: {
        ownedVisualToolsAvailable: true,
        nativeVisualProofChainPending: true
      }
    })).resolves.toEqual({ ok: true })
    await expect(bridge.evaluate({
      hook_event_name: 'PreToolUse',
      session_id: 'session-1',
      turn_id: 'turn-1',
      tool_name: 'Bash',
      tool_use_id: 'call-1',
      tool_input: { command: 'python inspect.py' },
      cwd: '/tmp/workspace'
    })).resolves.toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('native_visual_proof_chain_required')
      }
    })

    await service.stop()
    await expect(bridge.evaluate({
      hook_event_name: 'PreToolUse',
      session_id: 'session-1',
      turn_id: 'turn-1',
      tool_name: 'Bash',
      tool_use_id: 'call-2',
      tool_input: { command: 'python inspect.py' },
      cwd: '/tmp/workspace'
    })).resolves.toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining(
          'native_visual_governance_unavailable'
        )
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
      sink: { send: vi.fn() },
      storageRoot,
      capabilityAgentTools: {} as AgentRuntimeToolSurface,
      createClient: () => client
    })

    await expect(service.startTurn({
      threadId: 'thread-1',
      text: 'inspect the visual',
      ownedVisualToolsAvailable: true
    })).resolves.toMatchObject({ ok: true, turnId: 'turn-1' })
    expect(preDispatchDecision).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('owned_visual_policy_denied')
      }
    })
  })

  it('clears the active Codex turn after a terminal runtime event', async () => {
    const queued = clientWithQueuedEvents()
    const sink = { send: vi.fn() }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
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
      expect(sink.send).toHaveBeenCalledWith(CODEX_MAIN_IPC_CHANNELS.event, {
        event: { threadId: 'thread-1', turnId: 'turn-1', turnComplete: true }
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
    const sink = { send: vi.fn() }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
      createClient: () => queued.client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    sink.send.mockClear()
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
      expect(sink.send).toHaveBeenCalledWith(CODEX_MAIN_IPC_CHANNELS.event, {
        event: expect.objectContaining({
          threadId: 'thread-1',
          turnId: 'turn-1',
          runtimeStatus: expect.objectContaining({
            phase: 'stream_recovering',
            message: 'stream recovering'
          })
        })
      })
    })

    expect(sink.send.mock.calls.some((call) =>
      call[1]?.event?.runtimeError?.code === 'stream_recovering'
    )).toBe(false)
    expect(sink.send.mock.calls.some((call) =>
      call[1]?.event?.runtimeStatus?.phase === 'turn_done'
    )).toBe(false)
    await expect(service.interruptTurn('thread-1', 'turn-1')).resolves.toEqual({ ok: true })
    expect(queued.client.interruptTurn).toHaveBeenCalled()
    queued.close()
  })

  it('defers Codex turn completion until pending command execution items finish', async () => {
    const queued = clientWithQueuedEvents()
    const sink = { send: vi.fn() }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
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
      expect(sink.send.mock.calls.some((call) =>
        call[1]?.event?.tool?.itemId === 'cmd-1' &&
        call[1]?.event?.tool?.status === 'running'
      )).toBe(true)
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
    expect(sink.send.mock.calls.some((call) =>
      call[1]?.event?.turnComplete === true
    )).toBe(false)

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
      expect(sink.send.mock.calls.some((call) =>
        call[1]?.event?.turnComplete === true
      )).toBe(true)
    })
    const sentEvents = sink.send.mock.calls.map((call) => call[1]?.event)
    const failedToolIndex = sentEvents.findIndex((event) =>
      event?.tool?.itemId === 'cmd-1' &&
      event.tool.status === 'error' &&
      event.tool.meta?.exitCode === 28
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
      const sink = { send: vi.fn() }
      const service = new CodexRuntimeService({
        settings: async () => settings(),
        sink,
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
        expect(sink.send.mock.calls.some((call) =>
          call[1]?.event?.tool?.itemId === 'cmd-1' &&
          call[1]?.event?.tool?.status === 'running'
        )).toBe(true)
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
      expect(sink.send.mock.calls.some((call) =>
        call[1]?.event?.turnComplete === true
      )).toBe(false)

      await vi.advanceTimersByTimeAsync(1)

      expect(sink.send.mock.calls.some((call) =>
        call[1]?.event?.turnComplete === true
      )).toBe(false)
      expect(sink.send.mock.calls.some((call) =>
        call[1]?.event?.runtimeError?.code === 'tool_execution_unresolved' &&
        call[1]?.event?.runtimeError?.severity === 'error' &&
        call[1]?.event?.runtimeError?.details?.pendingCallIds?.includes('cmd-1')
      )).toBe(true)
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
    const sink = { send: vi.fn() }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink
    })

    await expect(service.publishSyntheticEvent({
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
    })).resolves.toMatchObject({
      runtimeError: {
        itemId: 'runtime-guard-execution-governance-turn-1',
        code: 'runtime_execution_interrupted',
        severity: 'error'
      }
    })

    expect(sink.send).toHaveBeenCalledWith(
      CODEX_MAIN_IPC_CHANNELS.event,
      {
        event: expect.objectContaining({
          runtimeError: expect.objectContaining({
            message: expect.stringContaining('Runtime guard stopped this turn')
          })
        })
      }
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
    const sink = { send: vi.fn() }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
      storageRoot,
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
    await expect(service.readThread('thread-1')).resolves.toMatchObject({
      ok: true,
      detail: { latestTurnId: 'turn-newer' }
    })
    expect(sink.send).toHaveBeenCalledWith(
      CODEX_MAIN_IPC_CHANNELS.event,
      {
        event: expect.objectContaining({
          child: expect.objectContaining({ id: 'child-1', status: 'running' })
        })
      }
    )
  })

  it('emits latency phase runtime status events around a Codex turn', async () => {
    const queued = clientWithQueuedEvents()
    const sink = { send: vi.fn() }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
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
      const phases = sink.send.mock.calls
        .map((call) => call[1]?.event?.runtimeStatus?.phase)
        .filter(Boolean)
      expect(phases).toEqual(expect.arrayContaining([
        'process_start',
        'initialize_start',
        'initialize_done',
        'turn_start_sent',
        'first_delta',
        'turn_done'
      ]))
    })
    const firstDelta = sink.send.mock.calls.find((call) => call[1]?.event?.runtimeStatus?.phase === 'first_delta')
    const turnDone = sink.send.mock.calls.find((call) => call[1]?.event?.runtimeStatus?.phase === 'turn_done')
    expect(firstDelta?.[1].event.runtimeStatus.latencyMs).toEqual(expect.any(Number))
    expect(turnDone?.[1].event.runtimeStatus.latencyMs).toEqual(expect.any(Number))
    const sentEvents = sink.send.mock.calls
      .map((call) => call[1]?.event)
      .filter(Boolean)
    const assistantDeltaIndex = sentEvents.findIndex((event) =>
      event?.deltas?.some((delta: NonNullable<CodexThreadEventPayload['deltas']>[number]) =>
        delta.kind === 'agent_message' && delta.text === 'hi'
      )
    )
    const firstDeltaStatusIndex = sentEvents.findIndex((event) =>
      event?.runtimeStatus?.phase === 'first_delta'
    )
    const turnCompleteIndex = sentEvents.findIndex((event) => event?.turnComplete === true)
    const turnDoneStatusIndex = sentEvents.findIndex((event) =>
      event?.runtimeStatus?.phase === 'turn_done'
    )
    expect(firstDeltaStatusIndex).toBeGreaterThan(assistantDeltaIndex)
    expect(turnDoneStatusIndex).toBeGreaterThan(turnCompleteIndex)
    queued.close()
  })

  it('deduplicates redelivered sequence identities without suppressing equal incremental text', async () => {
    const queued = clientWithQueuedEvents()
    const sink = { send: vi.fn() }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
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
          params: { threadId: 'thread-1', turnId: 'turn-1', seq, delta: 'same increment' }
        }
      })
    }

    await vi.waitFor(() => {
      const deltaEvents = sink.send.mock.calls
        .map((call) => call[1]?.event)
        .filter((event) => event?.deltas?.some((delta: { text: string }) => delta.text === 'same increment'))
      expect(deltaEvents).toHaveLength(2)
    })
    const identities = [...modelDeltaDedupeProbe(service).states.values()]
      .flatMap((state) => [...state.identities])
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

  it('bounds per-turn delta identities and stores only fixed-size snapshot digests', () => {
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      createClient: () => controllableClient()
    })
    const probe = modelDeltaDedupeProbe(service)
    probe.recordActiveTurn('thread-1', 'turn-1')

    const snapshotText = `private snapshot ${'x'.repeat(4_096)}`
    expect(probe.dedupe({
      threadId: 'thread-1',
      turnId: 'turn-1',
      deltas: [{ kind: 'agent_message', text: snapshotText, snapshot: true }]
    })).not.toBeNull()
    expect(probe.dedupe({
      threadId: 'thread-1',
      turnId: 'turn-1',
      deltas: [{ kind: 'agent_message', text: snapshotText, snapshot: true }]
    })).toBeNull()

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
    { method: 'turn/failed', params: { error: { message: 'provider failed' } } }
  ])('clears delta dedupe state on terminal $method events', async ({ method, params }) => {
    const queued = clientWithQueuedEvents()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
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
      sink: { send: vi.fn() },
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
    const sink = { send: vi.fn() }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
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
      expect(sink.send.mock.calls.some((call) =>
        call[1]?.event?.turnComplete === true
      )).toBe(true)
    })
    const deltaEvents = sink.send.mock.calls
      .map((call) => call[1]?.event)
      .filter((event) => event?.deltas?.some((delta: { text: string }) => delta.text === finalText))
    expect(deltaEvents).toHaveLength(1)

    queued.close()
  })

  it('deduplicates short completed assistant snapshots after streamed text', async () => {
    const queued = clientWithQueuedEvents()
    const sink = { send: vi.fn() }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
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
      expect(sink.send.mock.calls.some((call) =>
        call[1]?.event?.turnComplete === true
      )).toBe(true)
    })
    const deltaEvents = sink.send.mock.calls
      .map((call) => call[1]?.event)
      .filter((event) => event?.deltas?.some((delta: { text: string }) => delta.text === finalText))
    expect(deltaEvents).toHaveLength(1)

    queued.close()
  })

  it('fails and stops a Codex turn that produces no model activity', async () => {
    vi.useFakeTimers()
    const queued = clientWithQueuedEvents()
    try {
      const sink = { send: vi.fn() }
      const service = new CodexRuntimeService({
        settings: async () => settings(),
        sink,
        createClient: () => queued.client
      })

      await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
        ok: true,
        turnId: 'turn-1'
      })
      scheduleFirstActivityGuard(service)

      await vi.advanceTimersByTimeAsync(75_000)

      await vi.waitFor(() => {
        expect(sink.send).toHaveBeenCalledWith(CODEX_MAIN_IPC_CHANNELS.event, {
          event: expect.objectContaining({
            threadId: 'thread-1',
            turnId: 'turn-1',
            runtimeError: expect.objectContaining({
              code: 'first_activity_timeout',
              severity: 'error'
            })
          })
        })
      })
      expect(sink.send.mock.calls.some((call) =>
        call[1]?.event?.runtimeStatus?.phase === 'turn_done'
      )).toBe(true)
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

  it('leaves Model Router request deadlines to the API gateway', async () => {
    vi.useFakeTimers()
    const queued = clientWithQueuedEvents()
    try {
      const sink = { send: vi.fn() }
      const service = new CodexRuntimeService({
        settings: async () => settings(),
        sink,
        createClient: () => queued.client
      })

      await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
        ok: true,
        turnId: 'turn-1'
      })

      await vi.advanceTimersByTimeAsync(75_000)

      expect(sink.send.mock.calls.some((call) =>
        call[1]?.event?.runtimeError?.code === 'first_activity_timeout'
      )).toBe(false)
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
    const startTurn = vi.fn()
      .mockResolvedValueOnce({ turn: { id: 'turn-1' } })
      .mockResolvedValueOnce({ turn: { id: 'turn-2' } })
    queued.client.startTurn = startTurn
    try {
      const sink = { send: vi.fn() }
      const service = new CodexRuntimeService({
        settings: async () => settings(),
        sink,
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
        expect(sink.send.mock.calls.some((call) =>
          call[1]?.event?.runtimeStatus?.phase === 'first_delta' &&
          call[1]?.event?.threadId === 'thread-2'
        )).toBe(true)
      })

      await vi.advanceTimersByTimeAsync(75_000)

      expect(queued.client.interruptTurn).toHaveBeenCalledWith(
        { threadId: 'thread-1', turnId: 'turn-1' },
        expect.any(AbortSignal)
      )
      expect(queued.client.stop).not.toHaveBeenCalled()
      expect(sink.send.mock.calls.some((call) =>
        call[1]?.event?.threadId === 'thread-2' &&
        call[1]?.event?.runtimeError?.code === 'runtime_disconnected'
      )).toBe(false)

      queued.push({
        type: 'event',
        channel: CODEX_MAIN_IPC_CHANNELS.event,
        payload: {
          method: 'turn/completed',
          params: { threadId: 'thread-2', turnId: 'turn-2' }
        }
      })
      await vi.waitFor(() => {
        expect(sink.send.mock.calls.some((call) =>
          call[1]?.event?.threadId === 'thread-2' && call[1]?.event?.turnComplete === true
        )).toBe(true)
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
      const sink = { send: vi.fn() }
      const createClient = vi.fn((options: CodexAppServerJsonRpcClientOptions) => {
        onPendingRequest = (
          options.pendingServerRequests as { onPendingRequest?: (request: CodexAppServerPendingRequest) => void }
        )?.onPendingRequest
        return queued.client
      })
      const service = new CodexRuntimeService({
        settings: async () => settings(),
        sink,
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
        expect(sink.send).toHaveBeenCalledWith(CODEX_MAIN_IPC_CHANNELS.event, {
          event: expect.objectContaining({
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
        })
      })
      sink.send.mockClear()

      await vi.advanceTimersByTimeAsync(75_000)

      expect(sink.send.mock.calls.some((call) =>
        call[1]?.event?.runtimeError?.code === 'first_activity_timeout'
      )).toBe(false)
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
    const sink = { send: vi.fn() }
    const createClient = vi.fn((options: CodexAppServerJsonRpcClientOptions) => {
      onPendingRequest = (
        options.pendingServerRequests as { onPendingRequest?: (request: CodexAppServerPendingRequest) => void }
      )?.onPendingRequest
      return queued.client
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
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
        params: { command: 'npm test' }
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
        expect(sink.send).toHaveBeenCalledWith(CODEX_MAIN_IPC_CHANNELS.event, {
          event: expect.objectContaining({
            threadId: 'thread-1',
            turnId: 'turn-1',
            tool: expect.objectContaining({
              itemId: 'cmd-approval-1',
              summary: 'Command approval requested',
              toolKind: 'command_execution'
            })
          })
        })
        expect(sink.send).toHaveBeenCalledWith(CODEX_MAIN_IPC_CHANNELS.event, {
          event: expect.objectContaining({
            threadId: 'thread-1',
            turnId: 'turn-1',
            tool: expect.objectContaining({
              itemId: 'patch-approval-1',
              summary: 'File change approval requested',
              toolKind: 'file_change'
            })
          })
        })
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
      const sink = { send: vi.fn() }
      const createClient = vi.fn((options: CodexAppServerJsonRpcClientOptions) => {
        onPendingRequest = (
          options.pendingServerRequests as { onPendingRequest?: (request: CodexAppServerPendingRequest) => void }
        )?.onPendingRequest
        return queued.client
      })
      const service = new CodexRuntimeService({
        settings: async () => settings(),
        sink,
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
          questions: [{
            id: 'q1',
            header: 'Confirm',
            question: 'Continue?',
            options: []
          }]
        }
      })

      await vi.waitFor(() => {
        expect(sink.send).toHaveBeenCalledWith(CODEX_MAIN_IPC_CHANNELS.event, {
          event: expect.objectContaining({
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
        })
      })
      sink.send.mockClear()

      await vi.advanceTimersByTimeAsync(75_000)

      expect(sink.send.mock.calls.some((call) =>
        call[1]?.event?.runtimeError?.code === 'first_activity_timeout'
      )).toBe(false)
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
    const sink = { send: vi.fn() }
    const createClient = vi.fn((options: CodexAppServerJsonRpcClientOptions) => {
      onPendingRequest = (
        options.pendingServerRequests as { onPendingRequest?: (request: CodexAppServerPendingRequest) => void }
      )?.onPendingRequest
      return queued.client
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
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
      expect(sink.send.mock.calls.some((call) =>
        call[1]?.event?.turnComplete === true
      )).toBe(true)
    })
    queued.close()
  })

  it.each([
    {
      name: 'task_started event_msg',
      payload: {
        type: 'event_msg',
        payload: { type: 'task_started', turn_id: 'turn-1', started_at: 1781413091 }
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
        payload: { type: 'task_complete', turn_id: 'turn-1', last_agent_message: 'visible answer' }
      },
      expectedEvent: {
        turnComplete: true
      }
    }
  ])('treats new app-server $name as first activity for the active turn', async ({ payload, expectedEvent }) => {
    vi.useFakeTimers()
    const queued = clientWithQueuedEvents()
    try {
      const sink = { send: vi.fn() }
      const service = new CodexRuntimeService({
        settings: async () => settings(),
        sink,
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
        expect(sink.send).toHaveBeenCalledWith(CODEX_MAIN_IPC_CHANNELS.event, {
          event: expect.objectContaining({
            threadId: 'thread-1',
            turnId: 'turn-1',
            ...expectedEvent
          })
        })
      })
      sink.send.mockClear()

      await vi.advanceTimersByTimeAsync(75_000)

      expect(sink.send.mock.calls.some((call) =>
        call[1]?.event?.runtimeError?.code === 'first_activity_timeout'
      )).toBe(false)
      expect(queued.client.interruptTurn).not.toHaveBeenCalled()
    } finally {
      queued.close()
      vi.useRealTimers()
    }
  })

  it('correlates terminal function call output with the original Codex tool identity', async () => {
    const queued = clientWithQueuedEvents()
    const sink = { send: vi.fn() }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
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
      expect(sink.send).toHaveBeenCalledWith(CODEX_MAIN_IPC_CHANNELS.event, {
        event: expect.objectContaining({
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
      })
    })
    queued.close()
  })

  it('records Codex token usage notifications for cache-aware usage summaries', async () => {
    const queued = clientWithQueuedEvents()
    const rootDir = await tempRoot()
    const sink = { send: vi.fn() }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
      storageRoot: rootDir,
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
      await expect(service.usage({
        runtimeId: 'codex',
        groupBy: 'thread',
        threadId: 'thread-1',
        timezone: 'UTC'
      })).resolves.toMatchObject({
        supported: true,
        groupBy: 'thread',
        buckets: [{
          threadId: 'thread-1',
          inputTokens: 120,
          outputTokens: 20,
          reasoningTokens: 5,
          cachedTokens: 90,
          cacheMissTokens: 30,
          totalTokens: 145,
          turns: 1,
          cacheHitRate: 0.75
        }]
      })
    })

    await expect(service.readThread('thread-1')).resolves.toMatchObject({
      ok: true,
      detail: {
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
    const usageRecords = rawUsageRecords.trim().split('\n').map((line) => JSON.parse(line) as { totalTokens: number })
    expect(usageRecords).toHaveLength(1)
    expect(usageRecords[0]?.totalTokens).toBe(145)
    queued.close()
  })

  it('records completed Codex turns as usage activity when token usage is unavailable', async () => {
    const queued = clientWithQueuedEvents()
    const rootDir = await tempRoot()
    const sink = { send: vi.fn() }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
      storageRoot: rootDir,
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
      await expect(service.usage({
        runtimeId: 'codex',
        groupBy: 'thread',
        threadId: 'thread-1',
        timezone: 'UTC'
      })).resolves.toMatchObject({
        supported: true,
        groupBy: 'thread',
        buckets: [{
          threadId: 'thread-1',
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          turns: 1
        }],
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
      sink: { send: vi.fn() },
      storageRoot: rootDir,
      createClient: () => controllableClient()
    })

    await expect(service.usage({
      runtimeId: 'codex',
      groupBy: 'thread',
      threadId: 'gui-thread-1',
      timezone: 'UTC'
    })).resolves.toMatchObject({
      supported: true,
      groupBy: 'thread',
      buckets: [{
        threadId: 'gui-thread-1',
        totalTokens: 0,
        turns: 1
      }],
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
      sink: { send: vi.fn() },
      storageRoot: rootDir,
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
    const sink = { send: vi.fn() }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
      createClient: () => client
    })

    await expect(service.connect()).resolves.toMatchObject({ ok: true })
    vi.mocked(client.connect).mockClear()
    sink.send.mockClear()

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })

    expect(client.connect).not.toHaveBeenCalled()
    const phases = sink.send.mock.calls
      .map((call) => call[1]?.event?.runtimeStatus?.phase)
      .filter(Boolean)
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
      sink: { send: vi.fn() },
      storageRoot,
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
        options.pendingServerRequests as { onPendingRequest?: (request: CodexAppServerPendingRequest) => void }
      )?.onPendingRequest
      return client
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
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
      sink: { send: vi.fn() },
      createClient: () => client
    })

    await service.connect()

    expect(service.pendingServerRequests()).toEqual([
      expect.objectContaining({ requestId: 'approval-1', kind: 'approval' }),
      expect.objectContaining({ requestId: 'input-1', kind: 'user_input' })
    ])
    await expect(service.resolveApproval({
      requestId: 'approval-1',
      decision: 'denied'
    })).resolves.toEqual({ ok: true })
    await expect(service.resolveUserInput({
      requestId: 'input-1',
      answers: [{ id: 'q1', value: 'A' }]
    })).resolves.toEqual({ ok: true })

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
      account: { type: 'chatgpt' as const, email: 'user@example.com', planType: 'plus' as const },
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
        primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1_800_000_000 },
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
      sink: { send: vi.fn() },
      managedCodexHome: await tempRoot(),
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1' },
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
    await expect(service.logoutCodingPlanAccount()).resolves.toEqual({ ok: true })
    expect(startAccountLogin).toHaveBeenCalledWith({ type: 'chatgpt' })
    expect(logoutAccount).toHaveBeenCalledTimes(1)
    expect(queued.client.startThread).not.toHaveBeenCalled()
    expect(queued.client.startTurn).not.toHaveBeenCalled()
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
        account: { type: 'chatgpt' as const, email: 'user@example.com', planType: 'plus' as const },
        requiresOpenaiAuth: true
      }))
    })
    const current = settings()
    const service = new CodexRuntimeService({
      settings: async () => current,
      sink: { send: vi.fn() },
      managedCodexHome: await tempRoot(),
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1' },
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
    await expect(completion).resolves.toMatchObject({ ok: true, success: true })

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
      sink: { send: vi.fn() },
      managedCodexHome: await tempRoot(),
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1' },
      createClient: () => client
    })

    await expect(service.startCodingPlanLogin({ method: 'device' })).resolves.toEqual({
      ok: true,
      method: 'device',
      loginId: 'device-login-1',
      verificationUrl: 'https://auth.example/device',
      userCode: 'ABCD-EFGH'
    })
    expect(client.startAccountLogin).toHaveBeenCalledWith({ type: 'chatgptDeviceCode' })
    expect(client.startTurn).not.toHaveBeenCalled()
  })

  it('fails coding-plan model use when managed CODEX_HOME has no ChatGPT account', async () => {
    const startThread = vi.fn(async () => ({ thread: { id: 'thread-1' } }))
    const client = {
      ...controllableClient(),
      readAccount: vi.fn(async () => ({ account: null, requiresOpenaiAuth: true })),
      startThread
    } as unknown as CodexAppServerJsonRpcClient
    const service = new CodexRuntimeService({
      settings: async () => ({
        ...settings(),
        modelAccess: { mode: 'coding-plan', planAdapterId: 'codex' }
      }),
      sink: { send: vi.fn() },
      managedCodexHome: await tempRoot(),
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1' },
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
        account: { type: 'chatgpt' as const, email: 'user@example.com', planType: 'plus' as const },
        requiresOpenaiAuth: true
      }))
    })
    const service = new CodexRuntimeService({
      settings: async () => ({
        ...settings(),
        modelAccess: { mode: 'coding-plan', planAdapterId: 'codex' }
      }),
      sink: { send: vi.fn() },
      managedCodexHome: await tempRoot(),
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1' },
      createClient: () => queued.client
    })

    await expect(service.startTurn({
      threadId: 'gui-thread-1',
      text: 'hello',
      workspace: '/tmp/workspace'
    })).resolves.toMatchObject({ ok: true, turnId: 'turn-1' })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'turn/failed',
        params: {
          threadId: 'gui-thread-1',
          turnId: 'turn-1',
          error: { message: 'Model Router requests must use the public router model alias.' }
        }
      }
    })
    await vi.waitFor(() => expect(startTurn).toHaveBeenCalledTimes(1))

    expect(startTurn).toHaveBeenCalledTimes(1)
    expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({
      responsesapiClientMetadata: {
        runtime_id: 'codex',
        gui_thread_id: 'gui-thread-1'
      }
    }))
    expect(startTurn.mock.calls[0]?.[0]).not.toHaveProperty('modelProvider')
    expect(startThread).not.toHaveBeenCalled()
    queued.close()
  })

  it('restarts a warm managed app-server when the billing access path changes', async () => {
    let current = settings()
    const first = controllableClient()
    const second = controllableClient()
    const createClient = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
    const service = new CodexRuntimeService({
      settings: async () => current,
      sink: { send: vi.fn() },
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
})
