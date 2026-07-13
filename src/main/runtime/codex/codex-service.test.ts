import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
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
  defaultModelProviderSettings,
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
  type CodexAppServerJsonRpcClient,
  type CodexAppServerJsonRpcClientOptions
} from './app-server/json-rpc-client'
import type {
  CodexAppServerPendingRequest,
  CodexAppServerPendingRequestRegistryOptions
} from './app-server/request-registry'
import type { CodexThreadEventPayload } from './codex-runtime-api'
import type { CodexDynamicMcpClient } from './codex-dynamic-mcp-tools'
import { FileMultiAgentStore } from '../../../../packages/workers/multi-agent/src'

function configuredModelRouterSettings() {
  const modelRouter = defaultModelRouterSettings()
  modelRouter.runtimeApiKey = 'local-runtime-router-key'
  modelRouter.profiles.default.textReasoner = {
    provider: 'openai-compatible',
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
    provider: defaultModelProviderSettings(),
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
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
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

  it('advertises managed MCP tools as Codex dynamic tools and routes their calls', async () => {
    const client = controllableClient()
    const sink = { send: vi.fn() }
    let pendingServerRequests: CodexAppServerPendingRequestRegistryOptions | undefined
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'search-ok' }],
      structuredContent: { resultCount: 1 }
    }))
    const mcpClient: CodexDynamicMcpClient = {
      listTools: vi.fn(async () => ({
        tools: [{
          name: 'research.search',
          description: 'Search research papers.',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } }
        }]
      })),
      callTool,
      close: vi.fn(async () => undefined)
    }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
      managedMcpServers: [{ id: 'research', command: '/bin/research-mcp' }],
      mcpClientFactory: async () => mcpClient,
      createClient: (options) => {
        pendingServerRequests = options.pendingServerRequests as CodexAppServerPendingRequestRegistryOptions
        return client
      }
    })

    await expect(service.startThread({ title: 'MCP thread' })).resolves.toMatchObject({
      ok: true
    })

    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      dynamicTools: expect.arrayContaining([{
        type: 'function',
        name: 'research_search',
        description: 'Search research papers.',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } }
      }]),
      developerInstructions: expect.stringContaining('specialized MCP tools')
    }))
    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      dynamicTools: expect.arrayContaining([
        expect.objectContaining({ name: 'delegate_task' })
      ]),
      developerInstructions: expect.stringContaining('delegate_task')
    }))
    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      developerInstructions: expect.stringContaining('stream to a `.part` file')
    }))
    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      developerInstructions: expect.stringContaining('explicitly asks to use the system proxy')
    }))
    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      developerInstructions: expect.stringContaining('call `visual_generate` first')
    }))
    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      developerInstructions: expect.stringContaining('When `visual_generate` returns `needs_context`')
    }))
    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      developerInstructions: expect.stringContaining('Choose route `code`')
    }))
    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      developerInstructions: expect.stringContaining('run `visual_artifact_review` even when the result cannot be publication-ready')
    }))
    await expect(pendingServerRequests?.onToolCallRequest?.({
      requestId: 'tool-request-1',
      callId: 'call-research-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: 'research_search',
      arguments: { query: 'agentic RL' }
    })).resolves.toEqual({
      contentItems: [
        { type: 'inputText', text: 'search-ok' },
        { type: 'inputText', text: 'structuredContent:\n{\n  "resultCount": 1\n}' }
      ],
      success: true
    })
    expect(callTool).toHaveBeenCalledWith(
      { name: 'research.search', arguments: { query: 'agentic RL' } },
      expect.objectContaining({ signal: expect.any(AbortSignal), timeout: 30_000 })
    )
    const executionFacts = sink.send.mock.calls
      .map((call) => call[1]?.event?.tool)
      .filter((tool) => tool?.meta?.callId === 'call-research-1')
    expect(executionFacts).toEqual([
      expect.objectContaining({
        itemId: 'call-research-1',
        status: 'running',
        meta: expect.objectContaining({
          callId: 'call-research-1',
          toolName: 'research_search',
          phase: 'dispatched',
          factSource: 'runtime_lifecycle',
          evidenceStrength: 'runtime_lifecycle'
        })
      }),
      expect.objectContaining({
        itemId: 'call-research-1',
        status: 'success',
        meta: expect.objectContaining({
          callId: 'call-research-1',
          toolName: 'research_search',
          phase: 'succeeded',
          factSource: 'executor_result',
          evidenceStrength: 'executor_receipt',
          success: true
        })
      })
    ])
  })

  it('advertises and executes Codex multi-agent dynamic spawn calls as child threads', async () => {
    const queued = clientWithQueuedEvents()
    const storageRoot = await tempRoot()
    const sink = { send: vi.fn() }
    let pendingServerRequests: CodexAppServerPendingRequestRegistryOptions | undefined
    vi.mocked(queued.client.startThread)
      .mockResolvedValueOnce({ thread: { id: 'parent-codex-thread' } })
      .mockResolvedValueOnce({ thread: { id: 'child-codex-thread' } })
    vi.mocked(queued.client.startTurn).mockResolvedValueOnce({ turn: { id: 'child-turn' } })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
      storageRoot,
      createClient: (options) => {
        pendingServerRequests = options.pendingServerRequests as CodexAppServerPendingRequestRegistryOptions
        return queued.client
      }
    })

    await expect(service.startThread({ threadId: 'parent-gui-thread', title: 'Parent' })).resolves.toMatchObject({
      ok: true,
      thread: expect.objectContaining({ id: 'parent-gui-thread' })
    })
    expect(queued.client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      dynamicTools: expect.arrayContaining([
        expect.objectContaining({ name: 'delegate_task' })
      ]),
      developerInstructions: expect.stringContaining('delegate_task')
    }))

    const pending = pendingServerRequests?.onToolCallRequest?.({
      requestId: 'multi-agent-request-1',
      threadId: 'parent-codex-thread',
      turnId: 'parent-turn',
      tool: 'delegate_task',
      arguments: {
        label: 'Reviewer',
        prompt: 'Return child-ok only.',
        model: 'deepseek-v4-pro'
      }
    })
    await vi.waitFor(() => {
      expect(queued.client.startTurn).toHaveBeenCalledWith(expect.objectContaining({
        threadId: 'child-codex-thread',
        model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
        modelProvider: DEFAULT_MODEL_ROUTER_PROVIDER_ID,
        input: expect.arrayContaining([
          expect.objectContaining({ text: 'Return child-ok only.' })
        ])
      }))
    })
    const childStartThreadParams = vi.mocked(queued.client.startThread).mock.calls[1]?.[0] as {
      dynamicTools?: Array<{ name?: string }>
      developerInstructions?: string
    }
    expect(childStartThreadParams.dynamicTools ?? []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'delegate_task' })
    ]))
    expect(childStartThreadParams.developerInstructions ?? '').not.toContain('delegate_task')
    expect(queued.client.startTurn).not.toHaveBeenCalledWith(expect.objectContaining({
      model: 'deepseek-v4-pro'
    }))
    await expect(pendingServerRequests?.onToolCallRequest?.({
      requestId: 'nested-multi-agent-request',
      threadId: 'child-codex-thread',
      turnId: 'child-turn',
      tool: 'delegate_task',
      arguments: {
        label: 'Nested',
        prompt: 'This should not run.'
      }
    })).resolves.toEqual({
      contentItems: [{ type: 'inputText', text: 'delegate_task is disabled inside child agents.' }],
      success: false
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'item/agentMessage/delta',
        params: {
          threadId: 'child-codex-thread',
          turnId: 'child-turn',
          text: 'child-ok'
        }
      }
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'turn/completed',
        params: {
          threadId: 'child-codex-thread',
          turnId: 'child-turn'
        }
      }
    })

    await expect(pending).resolves.toMatchObject({
      success: true,
      contentItems: [{ type: 'inputText', text: 'child-ok' }]
    })
    await vi.waitFor(() => {
      expect(sink.send).toHaveBeenCalledWith(CODEX_MAIN_IPC_CHANNELS.event, {
        event: expect.objectContaining({
          threadId: 'parent-gui-thread',
          turnId: 'parent-turn',
          child: expect.objectContaining({
            id: expect.any(String),
            label: 'Reviewer',
            status: 'completed',
            summary: 'child-ok',
            openAsThreadRef: expect.objectContaining({
              runtimeId: 'codex',
              threadId: 'child-codex-thread'
            })
          })
        })
      })
    })
    queued.close()
  })

  it('replays a persisted multi-agent app-server request after service restart without creating another child', async () => {
    const client = controllableClient()
    const storageRoot = await tempRoot()
    const store = new FileMultiAgentStore(join(storageRoot, 'multi-agent-child-runs'))
    await store.upsert({
      contractVersion: 1,
      id: 'persisted-child',
      parentThreadId: 'parent-thread',
      parentTurnId: 'parent-turn',
      requestId: 'persisted-app-server-request',
      prompt: 'Run once before restart',
      status: 'completed',
      summary: 'persisted child result',
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      transcript: [],
      createdAt: '2026-07-12T00:00:00.000Z',
      startedAt: '2026-07-12T00:00:01.000Z',
      updatedAt: '2026-07-12T00:00:02.000Z',
      finishedAt: '2026-07-12T00:00:02.000Z'
    })
    let pendingServerRequests: CodexAppServerPendingRequestRegistryOptions | undefined
    const restartedService = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: (options) => {
        pendingServerRequests = options.pendingServerRequests as CodexAppServerPendingRequestRegistryOptions
        return client
      }
    })

    await expect(restartedService.connect()).resolves.toMatchObject({ ok: true })
    await expect(pendingServerRequests?.onToolCallRequest?.({
      requestId: 'persisted-app-server-request',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: 'delegate_task',
      arguments: { prompt: 'Run once before restart' }
    })).resolves.toEqual({
      contentItems: [{ type: 'inputText', text: 'persisted child result' }],
      success: true
    })
    expect(client.startThread).not.toHaveBeenCalled()
    expect(await store.list()).toHaveLength(1)
  })

  it('keeps delegate_task disabled in persisted Codex child threads after restart', async () => {
    const client = controllableClient()
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await threadStore.upsert({
      guiThreadId: 'child-gui-thread',
      codexThreadId: 'child-codex-thread',
      workspace: '/tmp/workspace',
      title: 'Persisted child',
      threadSource: 'subagent',
      relation: 'side',
      parentThreadId: 'parent-gui-thread',
      parentTurnId: 'parent-turn'
    })
    let pendingServerRequests: CodexAppServerPendingRequestRegistryOptions | undefined
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: (options) => {
        pendingServerRequests = options.pendingServerRequests as CodexAppServerPendingRequestRegistryOptions
        return client
      }
    })

    await expect(service.connect()).resolves.toMatchObject({ ok: true })
    await expect(pendingServerRequests?.onToolCallRequest?.({
      requestId: 'nested-after-restart',
      threadId: 'child-codex-thread',
      turnId: 'child-turn',
      tool: 'delegate_task',
      arguments: {
        label: 'Nested',
        prompt: 'This should still be blocked after restart.'
      }
    })).resolves.toEqual({
      contentItems: [{ type: 'inputText', text: 'delegate_task is disabled inside child agents.' }],
      success: false
    })
    expect(client.startThread).not.toHaveBeenCalled()
  })

  it('injects the thread workspace into workspace-intel dynamic MCP calls', async () => {
    const client = controllableClient()
    const storageRoot = await tempRoot()
    let pendingServerRequests: CodexAppServerPendingRequestRegistryOptions | undefined
    const seenServers: unknown[] = []
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'read-ok' }]
    }))
    const mcpClient: CodexDynamicMcpClient = {
      listTools: vi.fn(async () => ({
        tools: [{
          name: 'gui_workspace_read',
          description: 'Read workspace file.',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              workspaceRoot: { type: 'string' }
            }
          }
        }]
      })),
      callTool,
      close: vi.fn(async () => undefined)
    }
    const service = new CodexRuntimeService({
      settings: async () => ({
        ...settings(),
        workspaceRoot: '/tmp/settings-workspace'
      }),
      sink: { send: vi.fn() },
      storageRoot,
      workspaceIntelMcpLaunch: {
        appPath: '/tmp/sciforge-test-app',
        execPath: '/tmp/sciforge-test-app/SciForge',
        isPackaged: false
      },
      mcpClientFactory: async (server) => {
        seenServers.push(server)
        return mcpClient
      },
      createClient: (options) => {
        pendingServerRequests = options.pendingServerRequests as CodexAppServerPendingRequestRegistryOptions
        return client
      }
    })

    await expect(service.startThread({
      title: 'Workspace intel thread',
      workspace: '/tmp/awesome-ai-scientist'
    })).resolves.toMatchObject({
      ok: true
    })
    expect(seenServers).toEqual([
      expect.objectContaining({
        id: 'gui_workspace_intel',
        args: [
          '/tmp/sciforge-test-app/out/main/workspace-intel-mcp-node-entry.js',
          '--gui-workspace-intel-mcp-server',
          '--include-global-skills'
        ]
      })
    ])

    await expect(pendingServerRequests?.onToolCallRequest?.({
      requestId: 'tool-request-1',
      threadId: 'thread-1',
      tool: 'gui_workspace_read',
      arguments: { path: 'docs/research/single_cell/smoke_test_plan.md' }
    })).resolves.toMatchObject({
      contentItems: [{ type: 'inputText', text: 'read-ok' }],
      success: true
    })
    expect(callTool).toHaveBeenCalledWith(
      {
        name: 'gui_workspace_read',
        arguments: {
          path: 'docs/research/single_cell/smoke_test_plan.md',
          workspaceRoot: '/tmp/awesome-ai-scientist'
        }
      },
      expect.objectContaining({ signal: expect.any(AbortSignal), timeout: 120_000 })
    )
  })

  it('advertises the workspace patch tool, requests approval in workspace mode, and auto-applies in full access', async () => {
    const client = controllableClient()
    const storageRoot = await tempRoot()
    const workspaceRoot = join(storageRoot, 'workspace')
    await mkdir(workspaceRoot, { recursive: true })
    await writeFile(join(workspaceRoot, 'notes.txt'), 'alpha\nbeta\ngamma\n', 'utf8')
    let pendingServerRequests: CodexAppServerPendingRequestRegistryOptions | undefined
    const mcpClient: CodexDynamicMcpClient = {
      listTools: vi.fn(async () => ({
        tools: [{
          name: 'gui_workspace_read',
          description: 'Read workspace file.',
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' }, workspaceRoot: { type: 'string' } },
            required: ['path']
          }
        }]
      })),
      callTool: vi.fn(async ({ arguments: args }) => ({
        content: [{ type: 'text', text: 'read-ok' }],
        structuredContent: {
          ok: true,
          kind: 'text',
          workspaceRoot: args.workspaceRoot,
          relativePath: args.path,
          content: await readFile(join(String(args.workspaceRoot), String(args.path)), 'utf8'),
          truncated: false
        }
      })),
      close: vi.fn(async () => undefined)
    }
    let serviceSettings = { ...settings(), workspaceRoot }
    const service = new CodexRuntimeService({
      settings: async () => serviceSettings,
      sink: { send: vi.fn() },
      storageRoot,
      managedMcpServers: [{ id: 'gui_workspace_intel', command: '/bin/workspace-intel' }],
      mcpClientFactory: async () => mcpClient,
      createClient: (options) => {
        pendingServerRequests = options.pendingServerRequests as CodexAppServerPendingRequestRegistryOptions
        return client
      }
    })

    await expect(service.startThread({ threadId: 'gui-thread', workspace: workspaceRoot })).resolves.toMatchObject({ ok: true })
    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      dynamicTools: expect.arrayContaining([expect.objectContaining({
        name: 'gui_workspace_apply_patch',
        inputSchema: {
          type: 'object',
          properties: { path: expect.any(Object), patch: expect.any(Object) },
          required: ['path', 'patch'],
          additionalProperties: false
        }
      })]),
      developerInstructions: expect.stringContaining('instead of Python')
    }))

    await expect(pendingServerRequests?.onToolCallRequest?.({
      requestId: 'read-before-patch',
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: 'gui_workspace_read',
      arguments: { path: 'notes.txt' }
    })).resolves.toMatchObject({ success: true })

    const patchResult = pendingServerRequests?.onToolCallRequest?.({
      requestId: 'patch-request',
      callId: 'patch-call',
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: 'gui_workspace_apply_patch',
      arguments: {
        path: 'notes.txt',
        patch: '*** Begin Patch\n*** Update File: notes.txt\n@@\n alpha\n-beta\n+beta edited\n gamma\n*** End Patch'
      }
    })
    await vi.waitFor(() => expect(service.pendingServerRequests()).toEqual([
      expect.objectContaining({ kind: 'approval', method: 'item/fileChange/requestApproval' })
    ]))
    const approvalId = service.pendingServerRequests()[0]!.requestId
    await expect(service.resolveApproval({ requestId: approvalId, decision: 'allowed' })).resolves.toEqual({ ok: true })
    await expect(patchResult).resolves.toMatchObject({ success: true })
    await expect(readFile(join(workspaceRoot, 'notes.txt'), 'utf8')).resolves.toBe('alpha\nbeta edited\ngamma\n')

    await expect(pendingServerRequests?.onToolCallRequest?.({
      requestId: 'patch-without-reread',
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: 'gui_workspace_apply_patch',
      arguments: { path: 'notes.txt', patch: '@@\n-beta edited\n+beta twice' }
    })).resolves.toMatchObject({
      success: false,
      contentItems: [expect.objectContaining({ text: expect.stringContaining('read-before-edit guard') })]
    })

    await pendingServerRequests?.onToolCallRequest?.({
      requestId: 'read-before-denied-patch',
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: 'gui_workspace_read',
      arguments: { path: 'notes.txt' }
    })
    const deniedPatch = pendingServerRequests?.onToolCallRequest?.({
      requestId: 'denied-patch',
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: 'gui_workspace_apply_patch',
      arguments: { path: 'notes.txt', patch: '@@\n-beta edited\n+must not be written' }
    })
    await vi.waitFor(() => expect(service.pendingServerRequests()).toHaveLength(1))
    await service.resolveApproval({
      requestId: service.pendingServerRequests()[0]!.requestId,
      decision: 'denied'
    })
    await expect(deniedPatch).resolves.toMatchObject({ success: false })
    await expect(readFile(join(workspaceRoot, 'notes.txt'), 'utf8')).resolves.toBe('alpha\nbeta edited\ngamma\n')

    serviceSettings = {
      ...serviceSettings,
      agents: {
        ...serviceSettings.agents,
        codex: {
          ...defaultCodexRuntimeSettings(),
          ...serviceSettings.agents.codex,
          sandboxMode: 'danger-full-access',
          approvalPolicy: 'on-request'
        }
      }
    }
    await expect(pendingServerRequests?.onToolCallRequest?.({
      requestId: 'full-access-patch',
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: 'gui_workspace_apply_patch',
      arguments: {
        path: 'notes.txt',
        patch: '*** Begin Patch\n*** Update File: notes.txt\n@@\n alpha\n-beta edited\n+beta full access\n gamma\n*** End Patch'
      }
    })).resolves.toMatchObject({ success: true })
    expect(service.pendingServerRequests()).toEqual([])
    await expect(readFile(join(workspaceRoot, 'notes.txt'), 'utf8')).resolves.toBe('alpha\nbeta full access\ngamma\n')
  })

  it('does not inject a workspace root into visible-context or visual-capture dynamic MCP calls', async () => {
    const client = controllableClient()
    const storageRoot = await tempRoot()
    let pendingServerRequests: CodexAppServerPendingRequestRegistryOptions | undefined
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: '{"ok":true,"components":[]}' }]
    }))
    const mcpClient: CodexDynamicMcpClient = {
      listTools: vi.fn(async () => ({
        tools: [
          {
            name: 'gui_visible_context',
            description: 'Inspect current visible GUI context.',
            inputSchema: {
              type: 'object',
              properties: {
                region: { type: 'string' },
                componentId: { type: 'string' },
                includeHidden: { type: 'boolean' }
              },
              additionalProperties: false
            }
          },
          {
            name: 'gui_visual_capture',
            description: 'Capture one published visual target.',
            inputSchema: {
              type: 'object',
              properties: {
                scope: { type: 'string' },
                componentId: { type: 'string' },
                targetId: { type: 'string' }
              },
              additionalProperties: false
            }
          }
        ]
      })),
      callTool,
      close: vi.fn(async () => undefined)
    }
    const service = new CodexRuntimeService({
      settings: async () => ({
        ...settings(),
        workspaceRoot: '/tmp/settings-workspace'
      }),
      sink: { send: vi.fn() },
      storageRoot,
      workspaceIntelMcpLaunch: {
        appPath: '/tmp/sciforge-test-app',
        execPath: '/tmp/sciforge-test-app/SciForge',
        isPackaged: false
      },
      mcpClientFactory: async () => mcpClient,
      createClient: (options) => {
        pendingServerRequests = options.pendingServerRequests as CodexAppServerPendingRequestRegistryOptions
        return client
      }
    })

    await expect(service.startThread({
      title: 'Visible context thread',
      workspace: '/tmp/awesome-ai-scientist'
    })).resolves.toMatchObject({
      ok: true
    })

    await expect(pendingServerRequests?.onToolCallRequest?.({
      requestId: 'visible-context-request-1',
      threadId: 'thread-1',
      tool: 'gui_visible_context',
      arguments: { region: 'right-sidebar' }
    })).resolves.toMatchObject({
      contentItems: [{ type: 'inputText', text: '{"ok":true,"components":[]}' }],
      success: true
    })
    expect(callTool).toHaveBeenCalledWith(
      {
        name: 'gui_visible_context',
        arguments: {
          region: 'right-sidebar'
        }
      },
      expect.objectContaining({ signal: expect.any(AbortSignal), timeout: 120_000 })
    )

    await expect(pendingServerRequests?.onToolCallRequest?.({
      requestId: 'visual-capture-request-1',
      threadId: 'thread-1',
      tool: 'gui_visual_capture',
      arguments: {
        scope: 'target',
        componentId: 'right-sidebar.file-preview',
        targetId: 'current-page'
      }
    })).resolves.toMatchObject({ success: true })
    expect(callTool).toHaveBeenLastCalledWith(
      {
        name: 'gui_visual_capture',
        arguments: {
          scope: 'target',
          componentId: 'right-sidebar.file-preview',
          targetId: 'current-page'
        }
      },
      expect.objectContaining({ signal: expect.any(AbortSignal), timeout: 120_000 })
    )
  })

  it('aborts active dynamic MCP worker requests when a Codex turn is interrupted', async () => {
    const client = controllableClient()
    let pendingServerRequests: CodexAppServerPendingRequestRegistryOptions | undefined
    const started = deferred<void>()
    const callTool: CodexDynamicMcpClient['callTool'] = vi.fn((_input, options) => {
      started.resolve()
      return new Promise((_, reject) => {
        options?.signal?.addEventListener('abort', () => {
          reject(options.signal?.reason ?? new Error('aborted'))
        }, { once: true })
      })
    })
    const mcpClient: CodexDynamicMcpClient = {
      listTools: vi.fn(async () => ({
        tools: [{
          name: 'slow_tool',
          description: 'Slow worker request.',
          inputSchema: { type: 'object', properties: {} }
        }]
      })),
      callTool,
      close: vi.fn(async () => undefined)
    }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      managedMcpServers: [{ id: 'research', command: '/bin/research-mcp' }],
      mcpClientFactory: async () => mcpClient,
      createClient: (options) => {
        pendingServerRequests = options.pendingServerRequests as CodexAppServerPendingRequestRegistryOptions
        return client
      }
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'run slow tool' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    const pendingTool = pendingServerRequests?.onToolCallRequest?.({
      requestId: 'tool-request-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: 'slow_tool',
      arguments: {}
    })
    await started.promise

    await expect(service.interruptTurn('thread-1', 'turn-1')).resolves.toEqual({ ok: true })
    await expect(pendingTool).resolves.toMatchObject({ success: false })
    expect(client.interruptTurn).toHaveBeenCalledWith({ threadId: 'thread-1', turnId: 'turn-1' })
  })

  it('advertises the shared schedule MCP server as Codex dynamic tools', async () => {
    const client = controllableClient()
    const codexHome = await tempRoot()
    const seenServers: Array<{ id: string; command: string; args?: string[]; env?: Record<string, string> }> = []
    const mcpClient: CodexDynamicMcpClient = {
      listTools: vi.fn(async () => ({
        tools: [{
          name: 'gui_schedule_list',
          description: 'List schedule tasks.',
          inputSchema: { type: 'object', properties: {} }
        }]
      })),
      callTool: vi.fn(async () => ({
        content: [{ type: 'text', text: 'schedule-ok' }]
      })),
      close: vi.fn(async () => undefined)
    }
    const service = new CodexRuntimeService({
      settings: async () => ({
        ...settings(),
        schedule: {
          ...defaultScheduleSettings(),
          internal: { port: 9797, secret: 'schedule-secret' }
        }
      }),
      sink: { send: vi.fn() },
      managedCodexHome: codexHome,
      scheduleMcpLaunch: {
        appPath: '/tmp/sciforge-test-app',
        execPath: '/tmp/sciforge-test-app/SciForge',
        isPackaged: false
      },
      mcpClientFactory: async (server) => {
        seenServers.push(server)
        return mcpClient
      },
      createClient: () => client
    })

    await expect(service.startThread({ title: 'Schedule MCP thread' })).resolves.toMatchObject({
      ok: true
    })

    expect(seenServers).toEqual([
      expect.objectContaining({
        id: 'gui_schedule',
        command: '/tmp/sciforge-test-app/SciForge',
        args: [
          '/tmp/sciforge-test-app/out/main/schedule-mcp-node-entry.js',
          '--gui-schedule-mcp-server',
          '--base-url',
          'http://127.0.0.1:9797'
        ],
        env: expect.objectContaining({
          ELECTRON_RUN_AS_NODE: '1',
          GUI_SCHEDULE_INTERNAL_SECRET: 'schedule-secret'
        })
      })
    ])
    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    expect(config).not.toContain('[mcp_servers.gui_schedule]')
    expect(config).not.toContain('schedule-mcp-node-entry')
    expect(config).not.toContain('schedule-secret')
    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      dynamicTools: expect.arrayContaining([{
        type: 'function',
        name: 'gui_schedule_list',
        description: 'List schedule tasks.',
        inputSchema: { type: 'object', properties: {} }
      }]),
      developerInstructions: expect.stringContaining('specialized MCP tools')
    }))
  })

  it('advertises shared workflow and workspace intel MCP servers as Codex dynamic tools', async () => {
    const client = controllableClient()
    const codexHome = await tempRoot()
    const seenServers: Array<{
      id: string
      command: string
      args?: string[]
      enabledTools?: string[]
      env?: Record<string, string>
    }> = []
    const service = new CodexRuntimeService({
      settings: async () => ({
        ...settings(),
        workspaceRoot: '/tmp/codex-workspace',
        workflow: {
          ...defaultWorkflowSettings(),
          enabled: true,
          webhookPort: 9898,
          webhookSecret: 'workflow-secret'
        }
      }),
      sink: { send: vi.fn() },
      managedCodexHome: codexHome,
      workflowMcpLaunch: {
        appPath: '/tmp/sciforge-test-app',
        execPath: '/tmp/sciforge-test-app/SciForge',
        isPackaged: false
      },
      workspaceIntelMcpLaunch: {
        appPath: '/tmp/sciforge-test-app',
        execPath: '/tmp/sciforge-test-app/SciForge',
        isPackaged: false
      },
      mcpClientFactory: async (server) => {
        seenServers.push(server)
        return {
          listTools: vi.fn(async () => ({
            tools: server.id === 'gui_workflow'
              ? [{
                  name: 'gui_workflow_list',
                  description: 'List callable workflows.',
                  inputSchema: { type: 'object', properties: {} }
                }]
              : [{
                  name: 'gui_workspace_preview',
                  description: 'Preview workspace content.',
                  inputSchema: { type: 'object', properties: { path: { type: 'string' } } }
                }]
          })),
          callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] })),
          close: vi.fn(async () => undefined)
        }
      },
      createClient: () => client
    })

    await expect(service.startThread({ title: 'Workflow workspace MCP thread' })).resolves.toMatchObject({
      ok: true
    })

    expect(seenServers).toEqual([
      expect.objectContaining({
        id: 'gui_workflow',
        args: [
          '/tmp/sciforge-test-app/out/main/workflow-mcp-node-entry.js',
          '--gui-workflow-mcp-server',
          '--base-url',
          'http://127.0.0.1:9898'
        ],
        env: expect.objectContaining({
          ELECTRON_RUN_AS_NODE: '1',
          GUI_WORKFLOW_INTERNAL_SECRET: 'workflow-secret'
        }),
        enabledTools: expect.arrayContaining(['gui_workflow_list', 'gui_workflow_run'])
      }),
      expect.objectContaining({
        id: 'gui_workspace_intel',
        args: [
          '/tmp/sciforge-test-app/out/main/workspace-intel-mcp-node-entry.js',
          '--gui-workspace-intel-mcp-server',
          '--include-global-skills'
        ],
        enabledTools: expect.arrayContaining(['gui_workspace_list', 'gui_workspace_preview'])
      })
    ])
    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    expect(config).not.toContain('[mcp_servers.gui_workflow]')
    expect(config).not.toContain('[mcp_servers.gui_workspace_intel]')
    expect(config).not.toContain('workflow-secret')
    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      dynamicTools: expect.arrayContaining([
        expect.objectContaining({ name: 'gui_workflow_list' }),
        expect.objectContaining({ name: 'gui_workspace_preview' })
      ]),
      developerInstructions: expect.stringContaining('specialized MCP tools')
    }))
  })

  it('forces Codex thread starts through the managed Model Router provider', async () => {
    const client = controllableClient()
    const service = new CodexRuntimeService({
      settings: async () => ({
        ...settings(),
        provider: {
          apiKey: 'sk-user-provider',
          baseUrl: 'https://api.external-provider.test/v1',
          providers: [{
            id: 'external-provider',
            name: 'External Provider',
            apiKey: 'sk-profile',
            baseUrl: 'https://profile.external-provider.test/v1',
            models: ['external-model']
          }]
        },
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
      model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
      modelProvider: DEFAULT_MODEL_ROUTER_PROVIDER_ID
    }))
    expect(params).not.toEqual(expect.objectContaining({
      profile: expect.anything(),
      baseUrl: expect.anything(),
      apiKey: expect.anything()
    }))
    expect(params).not.toEqual(expect.objectContaining({ model: 'external-payload-model' }))
    expect(params).not.toEqual(expect.objectContaining({ model: 'external-runtime-model' }))
  })

  it('keeps warm Codex clients on the managed Model Router alias when settings drift', async () => {
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
      ok: true,
      turnId: 'turn-1'
    })

    expect(client.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
      modelProvider: DEFAULT_MODEL_ROUTER_PROVIDER_ID
    }))
    expect(client.startTurn).not.toHaveBeenCalledWith(expect.objectContaining({
      model: 'deepseek-v4-pro'
    }))
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

    await expect(service.startTurn({ threadId: 'gui-thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      threadId: 'gui-thread-1',
      turnId: 'turn-old'
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
      model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
      modelProvider: DEFAULT_MODEL_ROUTER_PROVIDER_ID
    }))
    expect(queued.client.startTurn).toHaveBeenNthCalledWith(2, expect.objectContaining({
      threadId: 'replacement-codex-thread',
      model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
      modelProvider: DEFAULT_MODEL_ROUTER_PROVIDER_ID
    }))
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
      model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
      modelProvider: DEFAULT_MODEL_ROUTER_PROVIDER_ID
    }))
    expect(client.startTurn).toHaveBeenNthCalledWith(2, expect.objectContaining({
      threadId: 'codex-thread-new',
      model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
      modelProvider: DEFAULT_MODEL_ROUTER_PROVIDER_ID
    }))
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
      displayText: 'short user prompt',
      input: [
        {
          type: 'text',
          text: 'expanded runtime prompt',
          text_elements: []
        }
      ]
    }))
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
      itemId: 'runtime-guard-tool-storm-turn-1',
      recoverable: true,
      severity: 'error',
      code: 'runtime_tool_storm_interrupted',
      message: 'Runtime guard stopped this turn after repeated command_execution:shell/fetch tool activity.',
      detail: 'The runtime interrupted the turn to prevent a repeated tool-call loop.'
    })).resolves.toMatchObject({
      runtimeError: {
        itemId: 'runtime-guard-tool-storm-turn-1',
        code: 'runtime_tool_storm_interrupted',
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
})
