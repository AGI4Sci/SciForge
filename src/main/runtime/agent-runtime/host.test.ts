import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../../shared/app-settings'
import type {
  AgentRuntimeAuxiliaryActiveScopedOperation,
  AgentRuntimeAuxiliaryInput,
  AgentRuntimeCapabilities,
  AgentRuntimeEvent,
  AgentRuntimeGitCheckpoint,
  AgentRuntimeId,
  AgentRuntimeModelAuditRecord,
  AgentRuntimeUsageQuery,
  AgentRuntimeUsageResponse,
  AgentRuntimeThread,
  AgentRuntimeTurnHandle
} from '../../../shared/agent-runtime-contract'
import {
  AGENT_RUNTIME_AUXILIARY_OPERATIONS,
  AGENT_RUNTIME_AUXILIARY_RUNTIME_ID_REQUIRED_OPERATIONS
} from '../../../shared/agent-runtime-contract'
import type { CodexRuntimeService } from '../codex'
import type { AgentRuntimeAdapter, AgentRuntimeAdapterContext } from './adapter'
import { createAgentRuntimeHost } from './host'
import { configureEvidenceDagUpdateQueue } from '../evidence-dag-feed'
import { createCodexAgentRuntimeAdapter } from '../codex/codex-agent-runtime-adapter'
import { createLocalRuntimeAgentRuntimeAdapter } from '../local-runtime-agent-runtime-adapter'
import { ModelRequestAuditRecorder } from '../../services/model-request-audit-service'
import { RuntimeContextStateService } from '../../services/runtime-context-state-service'
import { RuntimeContextLedgerService } from '../../services/runtime-context-ledger-service'
import { SharedMemoryService } from '../../services/shared-memory-service'
import { RuntimeGoalService } from '../../services/runtime-goal-service'
import { WorkspaceReferenceService } from '../../services/workspace-reference-service'
import { readWorkspaceFile } from '../../services/workspace-files'
import { composerReferenceFromWorkspaceReference } from '../../../renderer/src/lib/workspace-reference-composer'
import { buildComposerFileContextPrompt } from '../../../renderer/src/lib/composer-file-references'
import { readComposerFileContextEntries } from '../../../renderer/src/lib/composer-file-context'
import {
  createSettingsMemoryActions,
  type SettingsMemoryRecord,
  type SettingsMemoryRecordUpdater
} from '../../../renderer/src/lib/settings-memory-actions'

function settings(activeAgentRuntime: AppSettingsV1['activeAgentRuntime'] = 'codex'): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    activeAgentRuntime,
    provider: defaultModelProviderSettings(),
    modelRouter: defaultModelRouterSettings(),
    agents: {
      sciforge: defaultLocalRuntimeSettings(),
      codex: defaultCodexRuntimeSettings()
    },
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

function transportForRuntime(runtimeId: AgentRuntimeId): AgentRuntimeCapabilities['transport'] {
  if (runtimeId === 'sciforge') return 'http_sse'
  if (runtimeId === 'claude') return 'cli_process'
  return 'jsonrpc_stdio'
}

function capabilities(runtimeId: AgentRuntimeId): AgentRuntimeCapabilities {
  return {
    contractVersion: 1,
    runtimeId,
    transport: transportForRuntime(runtimeId),
    events: {
      live: true,
      replayable: true,
      sequenced: true,
      delivery: runtimeId === 'sciforge' ? 'sse' : 'ipc'
    },
    threadMaterialization: runtimeId === 'sciforge' ? 'immediate' : 'after_first_user_message',
    latency: {
      phaseEvents: false,
      firstTokenMetric: false,
      turnDurationMetric: false
    },
    reasoning: {
      available: false,
      streaming: false,
      visibility: 'none',
      source: 'unknown'
    },
    model: {
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: false
    },
    tools: {
      toolCalling: false,
      commandExecution: { available: false },
      fileChange: { available: false },
      mcp: { available: false },
      web: { available: false },
      research: { available: false },
      computerUse: { available: false },
      skills: { available: false },
      subagents: { available: false },
      diagnostics: { available: false }
    },
    controls: {
      interrupt: false,
      steer: false,
      approval: 'unsupported',
      userInput: 'unsupported',
      compact: 'unsupported',
      fork: false,
      review: false,
      goals: false,
      todos: false,
      resumeSession: false
    },
    guard: {
      toolStorm: runtimeId === 'sciforge' ? 'native' : 'observe'
    },
    storage: {
      guiOwnedThreads: false,
      backendThreadIdStable: false,
      usage: false,
      attachments: { available: false },
      memory: { available: false }
    }
  }
}

function fakeAdapter(id: AgentRuntimeId, thread: AgentRuntimeThread): AgentRuntimeAdapter {
  return {
    id,
    transport: transportForRuntime(id),
    connect: vi.fn(async () => undefined),
    capabilities: vi.fn(async () => capabilities(id)),
    listThreads: vi.fn(async () => [thread]),
    startThread: vi.fn(async () => thread),
    readThread: vi.fn(async () => ({ ...thread, latestSeq: 0, items: [] })),
    usage: vi.fn(async (_ctx, input) => ({
      supported: true,
      groupBy: input.groupBy,
      buckets: [],
      totals: { totalTokens: 0 }
    }) satisfies AgentRuntimeUsageResponse),
    startTurn: vi.fn(async (_ctx, input) => ({ threadId: input.threadId, turnId: `${id}-turn` })),
    interruptTurn: vi.fn(async () => undefined),
    steerTurn: vi.fn(async () => undefined),
    renameThread: vi.fn(async () => undefined),
    deleteThread: vi.fn(async () => undefined),
    updateThreadRelation: vi.fn(async () => undefined),
    subscribeEvents: vi.fn(async function* (_ctx: AgentRuntimeAdapterContext, input) {
      yield {
        kind: 'heartbeat',
        threadId: input.threadId,
        runtimeId: id,
        seq: input.sinceSeq
      } satisfies AgentRuntimeEvent
    }),
    publishSyntheticEvent: vi.fn(async (_ctx, event) => event)
  }
}

function json(body: unknown, status = 200): { ok: boolean; status: number; body: string } {
  return { ok: status >= 200 && status < 300, status, body: JSON.stringify(body) }
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

function commandToolEvent(command: string, index: number): AgentRuntimeEvent {
  return {
    kind: 'tool_event',
    runtimeId: 'codex',
    threadId: 'codex-thread',
    turnId: 'turn-1',
    itemId: `tool-${index}`,
    status: 'running',
    toolKind: 'command_execution',
    summary: command,
    meta: {
      toolName: 'local_shell',
      command
    }
  }
}

function computerUseToolEvent(argumentsValue: Record<string, unknown>, index: number): AgentRuntimeEvent {
  return {
    kind: 'tool_event',
    runtimeId: 'codex',
    threadId: 'codex-thread',
    turnId: 'turn-1',
    itemId: `computer-use-${index}`,
    status: 'running',
    toolKind: 'tool_call',
    summary: 'computer_use',
    meta: {
      toolName: 'computer_use',
      arguments: argumentsValue
    }
  }
}

function shellWrappedCommandToolEvent(command: string, index: number): AgentRuntimeEvent {
  const wrapper = `/bin/zsh -lc '${command}'`
  return {
    kind: 'tool_event',
    runtimeId: 'codex',
    threadId: 'codex-thread',
    turnId: 'turn-1',
    itemId: `tool-${index}`,
    status: 'running',
    toolKind: 'command_execution',
    summary: wrapper,
    detail: wrapper,
    meta: {
      toolName: 'local_shell',
      command: '/bin/zsh',
      arguments: {
        cmd: '/bin/zsh',
        args: ['-lc', command]
      }
    }
  }
}

const evidenceQueueRoots: string[] = []

describe('AgentRuntimeHost', () => {
  afterEach(async () => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    await Promise.all(evidenceQueueRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('selects the active adapter and allows explicit runtime overrides', async () => {
    const localThread = {
      id: 'local-thread',
      runtimeId: 'sciforge' as const,
      title: 'Local',
      updatedAt: '2026-06-10T00:00:00.000Z'
    }
    const codexThread = {
      id: 'codex-thread',
      runtimeId: 'codex' as const,
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    }
    const local = fakeAdapter('sciforge', localThread)
    const codex = fakeAdapter('codex', codexThread)
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [local, codex]
    })

    await expect(host.listThreads()).resolves.toEqual(expect.arrayContaining([localThread, codexThread]))
    await expect(host.listThreads({ runtimeId: 'sciforge', limit: 2 })).resolves.toEqual([localThread])
    await expect(host.capabilities('sciforge')).resolves.toMatchObject({ runtimeId: 'sciforge' })
    await host.renameThread({ runtimeId: 'sciforge', threadId: 'local-thread', title: 'Renamed' })
    await host.updateThreadRelation({ runtimeId: 'sciforge', threadId: 'local-thread', relation: 'primary' })

    expect(local.listThreads).toHaveBeenCalledWith(
      { settings: expect.objectContaining({ activeAgentRuntime: 'codex' }) },
      {}
    )
    expect(codex.listThreads).toHaveBeenCalledWith(
      { settings: expect.objectContaining({ activeAgentRuntime: 'codex' }) },
      {}
    )
    expect(local.listThreads).toHaveBeenCalledWith(
      { settings: expect.objectContaining({ activeAgentRuntime: 'codex' }) },
      { runtimeId: 'sciforge', limit: 2 }
    )
    expect(local.renameThread).toHaveBeenCalledWith(
      { settings: expect.objectContaining({ activeAgentRuntime: 'codex' }) },
      { runtimeId: 'sciforge', threadId: 'local-thread', title: 'Renamed' }
    )
    expect(local.updateThreadRelation).toHaveBeenCalledWith(
      { settings: expect.objectContaining({ activeAgentRuntime: 'codex' }) },
      { runtimeId: 'sciforge', threadId: 'local-thread', relation: 'primary' }
    )
  })

  it('requires explicit runtime ids for thread, turn, and event operations', async () => {
    const codexThread = {
      id: 'codex-thread',
      runtimeId: 'codex' as const,
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    }
    const codex = fakeAdapter('codex', codexThread)
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [codex]
    })

    await expect(host.capabilities()).resolves.toMatchObject({ runtimeId: 'codex' })
    await expect(host.usage({ groupBy: 'thread' })).resolves.toMatchObject({ supported: true })
    await expect(host.readThread({ threadId: 'codex-thread' } as never)).rejects.toThrow(
      'runtimeId is required'
    )
    await expect(host.startTurn({
      threadId: 'codex-thread',
      text: 'continue'
    } as never)).rejects.toThrow('runtimeId is required')
    await expect(host.renameThread({
      threadId: 'codex-thread',
      title: 'Renamed'
    } as never)).rejects.toThrow('runtimeId is required')
    await expect(host.subscribeEvents({
      threadId: 'codex-thread'
    } as never)[Symbol.asyncIterator]().next()).rejects.toThrow('runtimeId is required')

    expect(codex.readThread).not.toHaveBeenCalled()
    expect(codex.startTurn).not.toHaveBeenCalled()
    expect(codex.renameThread).not.toHaveBeenCalled()
    expect(codex.subscribeEvents).not.toHaveBeenCalled()
  })

  it('requires explicit runtime ids for thread-bound auxiliary operations', async () => {
    const codexThread = {
      id: 'codex-thread',
      runtimeId: 'codex' as const,
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    }
    const codex = fakeAdapter('codex', codexThread)
    const adapterAuxiliary = vi.fn(async (_context: AgentRuntimeAdapterContext, input: AgentRuntimeAuxiliaryInput) => ({
      operation: input.operation
    }))
    codex.auxiliary = adapterAuxiliary
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [codex]
    })
    for (const operation of AGENT_RUNTIME_AUXILIARY_RUNTIME_ID_REQUIRED_OPERATIONS) {
      await expect(host.auxiliary({
        operation,
        payload: {
          threadId: 'codex-thread',
          sourceThreadId: 'codex-thread',
          parentThreadId: 'codex-thread',
          targetRuntimeId: 'claude',
          workspaceRoot: '/tmp/workspace',
          requestId: 'request-1'
        }
      } as never)).rejects.toThrow('runtimeId is required')
    }
    expect(adapterAuxiliary).not.toHaveBeenCalled()

    const runtimeIdRequired = new Set<AgentRuntimeAuxiliaryInput['operation']>(
      AGENT_RUNTIME_AUXILIARY_RUNTIME_ID_REQUIRED_OPERATIONS
    )
    const activeScopedOperations = AGENT_RUNTIME_AUXILIARY_OPERATIONS.filter(
      (item): item is AgentRuntimeAuxiliaryActiveScopedOperation => !runtimeIdRequired.has(item)
    )
    for (const operation of activeScopedOperations) {
      try {
        await host.auxiliary({ operation })
      } catch (error) {
        expect(error instanceof Error ? error.message : String(error)).not.toMatch(/runtimeId is required/)
      }
    }
    expect(adapterAuxiliary).toHaveBeenCalled()
  })

  it('rejects the legacy local runtime id instead of falling back to SciForge', async () => {
    const adapter = fakeAdapter('sciforge', {
      id: 'sciforge-thread',
      runtimeId: 'sciforge',
      title: 'SciForge',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('sciforge'),
      adapters: [adapter]
    })

    await expect(host.capabilities('kun' as unknown as AgentRuntimeId)).rejects.toThrow(
      'Unsupported AgentRuntimeAdapter runtime: kun'
    )
    expect(adapter.capabilities).not.toHaveBeenCalled()
  })

  it('exposes shared goals through neutral capabilities and thread snapshots', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-goals-'))
    const goals = new RuntimeGoalService(dataDir)
    const thread = {
      id: 'codex-thread',
      runtimeId: 'codex' as const,
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    }
    const adapter = fakeAdapter('codex', thread)
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter],
      services: { goals }
    })

    await expect(host.capabilities('codex')).resolves.toMatchObject({
      controls: { goals: true }
    })
    await host.auxiliary({
      runtimeId: 'codex',
      operation: 'setThreadGoal',
      payload: {
        threadId: 'codex-thread',
        patch: { objective: 'ship shared goal mode', status: 'active' }
      }
    })

    await expect(host.listThreads({ runtimeId: 'codex' })).resolves.toEqual([
      expect.objectContaining({
        id: 'codex-thread',
        goal: expect.objectContaining({
          runtimeId: 'codex',
          objective: 'ship shared goal mode',
          status: 'active'
        })
      })
    ])
    await expect(host.readThread({ runtimeId: 'codex', threadId: 'codex-thread' })).resolves.toMatchObject({
      goal: {
        runtimeId: 'codex',
        threadId: 'codex-thread',
        objective: 'ship shared goal mode',
        status: 'active'
      }
    })
    expect(adapter.publishSyntheticEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: 'goal_event',
        runtimeId: 'codex',
        threadId: 'codex-thread',
        objective: 'ship shared goal mode',
        status: 'active'
      })
    )
  })

  it('injects shared active goals into non-native runtime turns without changing display text', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-goals-'))
    const goals = new RuntimeGoalService(dataDir)
    await goals.set({
      runtimeId: 'claude',
      threadId: 'claude-thread',
      patch: { objective: 'finish shared runtime goal', status: 'active' }
    })
    const adapter = fakeAdapter('claude', {
      id: 'claude-thread',
      runtimeId: 'claude',
      title: 'Claude',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('claude'),
      adapters: [adapter],
      services: { goals }
    })

    await host.startTurn({
      runtimeId: 'claude',
      threadId: 'claude-thread',
      text: 'continue',
      displayText: 'continue'
    })

    expect(adapter.startTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        text: expect.stringContaining('finish shared runtime goal'),
        displayText: 'continue'
      })
    )
  })

  it('adds an on-demand visible GUI lookup hint for right-sidebar PDF annotation requests', async () => {
    const adapter = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const visibleContext = {
      get: vi.fn(async () => ({
        schemaVersion: 1,
        updatedAt: '2026-07-04T00:00:00.000Z',
        activeThreadId: 'codex-thread',
        workspaceRoot: '/tmp/workspace',
        route: 'chat',
        components: [{
          id: 'right-sidebar.file-preview',
          region: 'right-sidebar',
          component: 'workspace-preview',
          title: 'paper.pdf',
          visible: true,
          updatedAt: '2026-07-04T00:00:00.000Z',
          summary: 'Previewing pdf file paper.pdf.',
          resources: [{
            kind: 'pdfAnnotations',
            role: 'annotation-sidecar',
            workspaceRoot: '/tmp/workspace',
            relativePath: '.sciforge/pdf-annotations/sha.json',
            annotationCount: 2,
            threadCount: 2,
            openThreadCount: 2,
            accessHint: 'Use gui_workspace_read when annotation details are needed.'
          }]
        }]
      })),
      peek: vi.fn(() => ({
        schemaVersion: 1,
        updatedAt: '1970-01-01T00:00:00.000Z',
        components: []
      }))
    }
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter],
      services: { visibleContext: visibleContext as never }
    })
    const userText = '看一下右侧的pdf批注，然后修改论文。'

    await host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: userText,
      displayText: userText
    })

    const dispatched = vi.mocked(adapter.startTurn).mock.calls[0]?.[1]
    expect(visibleContext.get).toHaveBeenCalled()
    expect(dispatched?.text).toContain('gui_visible_context')
    expect(dispatched?.text).toContain('pdfAnnotations')
    expect(dispatched?.text).toContain('.sciforge/pdf-annotations/sha.json')
    expect(dispatched?.text).toContain(userText)
    expect(dispatched?.displayText).toBe(userText)
  })

  it('does not add visible GUI lookup hints to unrelated turns', async () => {
    const adapter = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const visibleContext = {
      get: vi.fn(async () => ({
        schemaVersion: 1,
        updatedAt: '2026-07-04T00:00:00.000Z',
        components: []
      })),
      peek: vi.fn(() => ({
        schemaVersion: 1,
        updatedAt: '1970-01-01T00:00:00.000Z',
        components: []
      }))
    }
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter],
      services: { visibleContext: visibleContext as never }
    })

    await host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'Run the unit tests.',
      displayText: 'Run the unit tests.'
    })

    const dispatched = vi.mocked(adapter.startTurn).mock.calls[0]?.[1]
    expect(visibleContext.get).not.toHaveBeenCalled()
    expect(dispatched?.text).not.toContain('gui_visible_context')
    expect(dispatched?.text).toBe('Run the unit tests.')
  })

  it('streams events through the selected adapter', async () => {
    const local = fakeAdapter('sciforge', {
      id: 'local-thread',
      runtimeId: 'sciforge',
      title: 'Local',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [local, codex]
    })
    const events: AgentRuntimeEvent[] = []

    for await (const event of host.subscribeEvents({
      runtimeId: 'sciforge',
      threadId: 'local-thread',
      sinceSeq: 4
    })) {
      events.push(event)
    }

    expect(events).toEqual([{ kind: 'heartbeat', threadId: 'local-thread', runtimeId: 'sciforge', seq: 4 }])
    expect(local.subscribeEvents).toHaveBeenCalled()
  })

  it('adds host-service capabilities and handles shared auxiliary operations before adapters', async () => {
    const adapter = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const adapterAuxiliary = vi.fn(async () => ({ adapter: true }))
    adapter.auxiliary = adapterAuxiliary
    const contextState = new RuntimeContextStateService()
    const modelAudit = new ModelRequestAuditRecorder()
    vi.spyOn(modelAudit, 'snapshot')
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter],
      services: {
        contextState,
        modelAudit
      }
    })

    await expect(host.capabilities('codex')).resolves.toMatchObject({
      observability: {
        modelAudit: { available: true, inMemory: true }
      },
      context: {
        state: { available: true }
      }
    })

    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'getContextState',
      payload: { threadId: 'codex-thread' }
    })).resolves.toMatchObject({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      summarySource: 'none'
    })
    expect(adapterAuxiliary).not.toHaveBeenCalled()

    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'listModelAuditRecords',
      payload: {}
    })).resolves.toEqual([])
    expect(modelAudit.snapshot).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: undefined,
      limit: undefined
    })
  })

  it('exposes context ledger and handoff through the shared host contract', async () => {
    const adapter = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const adapterAuxiliary = vi.fn(async () => ({ adapter: true }))
    adapter.auxiliary = adapterAuxiliary
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-context-ledger-host-'))
    const contextLedger = new RuntimeContextLedgerService(dataDir)
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter],
      services: { contextLedger }
    })

    const caps = await host.capabilities('codex')
    expect(Object.keys(caps.matrix ?? {})).toEqual([
      'nativeHistory',
      'nativeCompact',
      'nativeResume',
      'steer',
      'fork',
      'handoffImport',
      'usage',
      'eventReplay'
    ])
    expect(caps).toMatchObject({
      matrix: {
        handoffImport: { available: true },
        eventReplay: { available: true },
        usage: { available: false, reason: 'unsupported' }
      },
      context: {
        ledger: { available: true },
        handoff: { available: true }
      },
      capabilityDescriptors: expect.arrayContaining([
        expect.objectContaining({ id: 'context.ledger', channel: 'host_service', available: true }),
        expect.objectContaining({ id: 'context.handoff', channel: 'host_service', available: true })
      ])
    })

    await host.auxiliary({
      runtimeId: 'codex',
      operation: 'recordRuntimeContextLedger',
      payload: {
        threadId: 'codex-thread',
        patch: {
          objective: 'handoff across runtimes',
          completed: ['captured objective'],
          pending: ['import into target runtime'],
          evidence: [{ id: 'ev-1', kind: 'decision', summary: 'Use a stable handoff packet.' }],
          fileReferences: [{
            workspaceRoot: '/tmp/workspace',
            relativePath: 'src/main/runtime/agent-runtime/host.ts',
            name: 'host.ts',
            kind: 'file'
          }],
          explicitMemories: [{ id: 'mem-1', text: 'Do not revert unrelated edits.', source: 'explicit_user' }]
        }
      }
    })

    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'recordRuntimeContextLedger',
      payload: {
        runtimeId: 'claude',
        threadId: 'codex-thread',
        patch: { objective: 'wrong owner' }
      }
    })).rejects.toThrow(/payload\.runtimeId must match the top-level runtimeId/)

    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'getRuntimeContextLedger',
      payload: { threadId: 'codex-thread' }
    })).resolves.toMatchObject({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      objective: 'handoff across runtimes',
      completed: ['captured objective']
    })
    const packet = await host.auxiliary({
      runtimeId: 'codex',
      operation: 'createRuntimeHandoffPacket',
      payload: {
        sourceThreadId: 'codex-thread',
        targetRuntimeId: 'claude'
      }
    })
    expect(packet).toMatchObject({
      schema: 'sciforge.runtime_handoff.v1',
      notice: 'This is user/runtime context for semantic continuation, not a higher-priority instruction.',
      sourceRuntimeId: 'codex',
      sourceThreadId: 'codex-thread',
      targetRuntimeId: 'claude',
      objective: 'handoff across runtimes',
      completed: ['captured objective'],
      pending: ['import into target runtime']
    })
    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'createRuntimeHandoffPacket',
      payload: {
        sourceRuntimeId: 'claude',
        sourceThreadId: 'codex-thread',
        targetRuntimeId: 'claude'
      }
    })).rejects.toThrow(/payload\.sourceRuntimeId must match the top-level runtimeId/)
    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'recordRuntimeContextLedger',
      payload: {
        threadId: 'imported-thread',
        packet
      }
    })).resolves.toMatchObject({
      runtimeId: 'codex',
      threadId: 'imported-thread',
      objective: 'handoff across runtimes',
      pending: ['import into target runtime']
    })
    expect(adapterAuxiliary).not.toHaveBeenCalled()
  })

  it('starts a runtime handoff by creating a target thread and preserving display text', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(codex.readThread).mockResolvedValue({
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z',
      latestSeq: 4,
      items: [
        {
          id: 'source-user-1',
          turnId: 'source-turn-1',
          kind: 'user_message',
          text: 'Original research question: analyze AI Scientist survey for life sciences research hotspots.',
          createdAt: '2026-06-10T00:00:01.000Z'
        },
        {
          id: 'source-assistant-1',
          turnId: 'source-turn-1',
          kind: 'assistant_message',
          text: 'We identified wet-lab closed-loop agents and experiment protocol automation as likely next hotspots.',
          createdAt: '2026-06-10T00:00:02.000Z'
        }
      ]
    })
    const claudeTargetThread = {
      id: 'claude-handoff-thread',
      runtimeId: 'claude' as const,
      title: 'Claude handoff',
      updatedAt: '2026-06-10T00:00:00.000Z'
    }
    const claude = fakeAdapter('claude', claudeTargetThread)
    vi.mocked(claude.startTurn).mockResolvedValue({
      threadId: 'claude-handoff-thread',
      turnId: 'claude-turn'
    })
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-context-ledger-host-'))
    const contextLedger = new RuntimeContextLedgerService(dataDir)
    const modelAudit = new ModelRequestAuditRecorder()
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [codex, claude],
      services: { contextLedger, modelAudit }
    })

    await host.auxiliary({
      runtimeId: 'codex',
      operation: 'recordRuntimeContextLedger',
      payload: {
        threadId: 'codex-thread',
        patch: {
          objective: 'handoff across runtimes',
          status: 'active',
          completed: ['captured source context'],
          pending: ['continue in Claude']
        }
      }
    })

    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'startRuntimeHandoff',
      payload: {
        sourceRuntimeId: 'claude',
        sourceThreadId: 'codex-thread',
        targetRuntimeId: 'claude',
        text: 'Please continue from here'
      }
    })).rejects.toThrow(/payload\.sourceRuntimeId must match the top-level runtimeId/)

    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'startRuntimeHandoff',
      payload: {
        sourceThreadId: 'codex-thread',
        targetRuntimeId: 'claude',
        text: 'Please continue from here',
        workspace: '/tmp/workspace',
        title: 'Claude handoff'
      }
    })).resolves.toMatchObject({
      sourceRuntimeId: 'codex',
      sourceThreadId: 'codex-thread',
      targetRuntimeId: 'claude',
      targetThread: { id: 'claude-handoff-thread' },
      turn: { threadId: 'claude-handoff-thread', turnId: 'claude-turn' },
      packet: {
        sourceRuntimeId: 'codex',
        sourceThreadId: 'codex-thread',
        targetRuntimeId: 'claude',
        objective: 'handoff across runtimes',
        pending: ['continue in Claude']
      }
    })

    expect(claude.startThread).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runtimeId: 'claude',
        workspace: '/tmp/workspace',
        title: 'Claude handoff'
      })
    )
    const startTurnInput = vi.mocked(claude.startTurn).mock.calls[0]?.[1]
    expect(startTurnInput).toMatchObject({
      runtimeId: 'claude',
      threadId: 'claude-handoff-thread',
      displayText: 'Please continue from here'
    })
    expect(startTurnInput?.text).toContain('Runtime handoff packet for semantic continuation.')
    expect(startTurnInput?.text).toContain('"schema": "sciforge.runtime_handoff.v1"')
    expect(startTurnInput?.text).toContain('"objective": "handoff across runtimes"')
    expect(startTurnInput?.text).toContain('"schema": "sciforge.runtime_handoff_transcript.v1"')
    expect(startTurnInput?.text).toContain('Original research question: analyze AI Scientist survey')
    expect(startTurnInput?.text).toContain('wet-lab closed-loop agents and experiment protocol automation')
    expect(startTurnInput?.text).toContain('Current user request:\nPlease continue from here')
    expect(startTurnInput?.metadata).toMatchObject({
      schemaVersion: 'sciforge.model-router.request-audit.v1',
      route: 'model-router.responses',
      source: 'agent-runtime-host',
      operation: 'runtime_handoff',
      runtimeId: 'claude',
      threadId: 'claude-handoff-thread',
      sourceRuntimeId: 'codex',
      sourceThreadId: 'codex-thread',
      targetRuntimeId: 'claude',
      targetThreadId: 'claude-handoff-thread',
      packetDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
    })
    const auditRecords = modelAudit.snapshot({ runtimeId: 'claude', threadId: 'claude-handoff-thread' })
    expect(auditRecords[0]).toMatchObject({
      modelRouter: {
        requestBodySummary: {
          metadataKeys: expect.arrayContaining(['metadata', 'runtimeId', 'threadId', 'workspace'])
        }
      },
      request: {
        bodySummary: {
          keys: expect.arrayContaining(['metadata', 'text'])
        }
      }
    })
    expect(claude.publishSyntheticEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: 'handoff_event',
        runtimeId: 'claude',
        threadId: 'claude-handoff-thread',
        turnId: 'claude-turn',
        sourceRuntimeId: 'codex',
        sourceThreadId: 'codex-thread',
        targetRuntimeId: 'claude',
        targetThreadId: 'claude-handoff-thread',
        targetTurnId: 'claude-turn'
      })
    )
    await expect(contextLedger.get({
      runtimeId: 'claude',
      threadId: 'claude-handoff-thread'
    })).resolves.toMatchObject({
      objective: 'handoff across runtimes',
      pending: ['continue in Claude'],
      evidence: expect.arrayContaining([
        expect.objectContaining({ kind: 'event', sourceRuntimeId: 'codex', sourceThreadId: 'codex-thread' })
      ])
    })
  })

  it('records turn audit output from the neutral event stream without changing yielded events', async () => {
    const adapter = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(adapter.subscribeEvents).mockImplementation(async function* () {
      yield {
        kind: 'assistant_delta',
        runtimeId: 'codex',
        threadId: 'codex-thread',
        turnId: 'codex-turn',
        itemId: 'assistant-1',
        text: 'hello'
      } satisfies AgentRuntimeEvent
      yield {
        kind: 'turn_lifecycle',
        runtimeId: 'codex',
        threadId: 'codex-thread',
        turnId: 'codex-turn',
        state: 'completed'
      } satisfies AgentRuntimeEvent
    })
    const modelAudit = new ModelRequestAuditRecorder()
    const host = createAgentRuntimeHost({
      settings: async () => ({
        ...settings('codex'),
        modelRouter: {
          ...defaultModelRouterSettings(),
          baseUrl: 'http://127.0.0.1:4545/v1',
          publicModelAlias: 'public-router-alias',
          runtimeApiKey: 'runtime-secret',
          profiles: {
            default: {
              textReasoner: {
                provider: 'private-provider',
                baseUrl: 'https://private-provider.example/v1',
                apiKey: 'private-provider-secret',
                model: 'private-provider-model'
              },
              imageGenerator: {
                provider: 'private-image',
                baseUrl: 'https://private-image.example/v1',
                apiKey: 'private-image-secret',
                model: 'private-image-model'
              },
              translators: {
                vision: {
                  provider: 'private-vision',
                  baseUrl: 'https://private-vision.example/v1',
                  apiKey: 'private-vision-secret',
                  model: 'private-vision-model'
                },
                scientific: {
                  baseUrl: 'http://127.0.0.1:3898',
                  apiKey: 'private-scientific-secret',
                  model: 'private-scientific-model'
                }
              }
            }
          }
        }
      }),
      adapters: [adapter],
      services: { modelAudit }
    })

    await host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'Say hello',
      workspace: '/tmp/workspace'
    })
    const events: AgentRuntimeEvent[] = []
    for await (const event of host.subscribeEvents({
      runtimeId: 'codex',
      threadId: 'codex-thread'
    })) {
      events.push(event)
    }

    expect(events.map((event) => event.kind)).toEqual(['assistant_delta', 'turn_lifecycle'])
    expect(modelAudit.snapshot()[0]).toMatchObject({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      turnId: 'codex-turn',
      provider: 'model-router',
      model: 'public-router-alias',
      modelRouterUrl: 'http://127.0.0.1:4545/v1',
      providerAlias: 'model-router',
      modelAlias: 'public-router-alias',
      modelRouter: {
        providerAlias: 'model-router',
        modelAlias: 'public-router-alias',
        requestUrl: 'http://127.0.0.1:4545/v1/responses',
        endpointRoute: 'responses',
        requestBodySummary: {
          schema: 'model-router.responses.runtime',
          keys: ['input', 'metadata'],
          inputTextChars: 'Say hello'.length,
          metadataKeys: ['runtimeId', 'threadId', 'workspace'],
          attachmentCount: 0,
          fileReferenceCount: 0,
          hasGuiPlan: false
        }
      },
      streamOutput: {
        text: 'hello',
        stopReason: 'completed'
      }
    })
    const serialized = JSON.stringify(modelAudit.snapshot()[0])
    expect(serialized).not.toContain('runtime-secret')
    expect(serialized).not.toContain('private-provider')
    expect(serialized).not.toContain('private-provider.example')
    expect(serialized).not.toContain('private-provider-model')
    expect(serialized).not.toContain('private-provider-secret')
  })

  it('audits SciForge, Codex, and Claude turns through shared auxiliary list and clear operations', async () => {
    for (const runtimeId of ['sciforge', 'codex', 'claude'] as const) {
      const adapter = fakeAdapter(runtimeId, {
        id: `${runtimeId}-thread`,
        runtimeId,
        title: runtimeId,
        updatedAt: '2026-06-10T00:00:00.000Z'
      })
      vi.mocked(adapter.startTurn).mockResolvedValue({
        threadId: `${runtimeId}-thread`,
        turnId: `${runtimeId}-turn`
      })
      vi.mocked(adapter.subscribeEvents).mockImplementation(async function* () {
        yield {
          kind: 'assistant_delta',
          runtimeId,
          threadId: `${runtimeId}-thread`,
          turnId: `${runtimeId}-turn`,
          itemId: `${runtimeId}-assistant`,
          text: `visible output from /Users/alice/private-${runtimeId} with token=runtime-secret`
        } satisfies AgentRuntimeEvent
        yield {
          kind: 'tool_event',
          runtimeId,
          threadId: `${runtimeId}-thread`,
          turnId: `${runtimeId}-turn`,
          itemId: `${runtimeId}-tool`,
          status: 'success',
          summary: 'read_file',
          meta: {
            callId: `${runtimeId}-call`,
            toolName: 'read_file',
            Authorization: 'Bearer super-secret'
          }
        } satisfies AgentRuntimeEvent
        yield {
          kind: 'usage',
          runtimeId,
          threadId: `${runtimeId}-thread`,
          turnId: `${runtimeId}-turn`,
          usage: {
            inputTokens: 11,
            outputTokens: 7,
            totalTokens: 18
          }
        } satisfies AgentRuntimeEvent
        yield {
          kind: 'turn_lifecycle',
          runtimeId,
          threadId: `${runtimeId}-thread`,
          turnId: `${runtimeId}-turn`,
          state: 'completed'
        } satisfies AgentRuntimeEvent
      })
      const modelAudit = new ModelRequestAuditRecorder()
      const host = createAgentRuntimeHost({
        settings: async () => ({
          ...settings(runtimeId),
          modelRouter: {
            ...defaultModelRouterSettings(),
            baseUrl: 'http://127.0.0.1:4545/v1',
            publicModelAlias: 'public-router-alias',
            runtimeApiKey: 'runtime-secret'
          }
        }),
        adapters: [adapter],
        services: { modelAudit }
      })

      await host.startTurn({
        runtimeId,
        threadId: `${runtimeId}-thread`,
        text: `Read /Users/alice/private-${runtimeId} using token=runtime-secret`,
        workspace: '/tmp/workspace'
      })
      const visibleEvents: AgentRuntimeEvent[] = []
      for await (const event of host.subscribeEvents({
        runtimeId,
        threadId: `${runtimeId}-thread`
      })) {
        visibleEvents.push(event)
      }

      const visibleAssistant = visibleEvents.find((event) => event.kind === 'assistant_delta')
      expect(visibleAssistant).toMatchObject({
        text: `visible output from /Users/alice/private-${runtimeId} with token=runtime-secret`
      })
      const records = await host.auxiliary({
        runtimeId,
        operation: 'listModelAuditRecords',
        payload: { runtimeId, threadId: `${runtimeId}-thread` }
      }) as AgentRuntimeModelAuditRecord[]
      expect(records).toHaveLength(1)
      expect(records[0]).toMatchObject({
        runtimeId,
        threadId: `${runtimeId}-thread`,
        turnId: `${runtimeId}-turn`,
          provider: 'model-router',
          model: 'public-router-alias',
          modelRouterUrl: 'http://127.0.0.1:4545/v1',
          providerAlias: 'model-router',
          modelAlias: 'public-router-alias',
          modelRouter: {
            providerAlias: 'model-router',
            modelAlias: 'public-router-alias',
            requestUrl: 'http://127.0.0.1:4545/v1/responses',
            endpointRoute: 'responses',
            requestBodySummary: {
              schema: 'model-router.responses.runtime',
              inputTextChars: `Read /Users/alice/private-${runtimeId} using token=runtime-secret`.length,
              attachmentCount: 0,
              fileReferenceCount: 0,
              hasGuiPlan: false
            }
          },
          request: {
            bodySummary: {
              schema: 'agent-runtime.turnStart',
            textChars: `Read /Users/alice/private-${runtimeId} using token=runtime-secret`.length,
            attachmentCount: 0,
            fileReferenceCount: 0,
            hasGuiPlan: false
          }
        },
        streamOutput: {
          text: expect.stringContaining('[path]'),
          toolCalls: [
            expect.objectContaining({
              callId: `${runtimeId}-call`,
              toolName: 'read_file',
              status: 'success',
              arguments: expect.objectContaining({
                Authorization: '[redacted]'
              })
            })
          ],
          usage: {
            inputTokens: 11,
            outputTokens: 7,
            totalTokens: 18
          },
          stopReason: 'completed'
        }
      })
      expect(records[0]?.durationMs).toEqual(expect.any(Number))
      expect(JSON.stringify(records[0])).not.toContain('/Users/alice')
      expect(JSON.stringify(records[0])).not.toContain('runtime-secret')

      await expect(host.auxiliary({
        runtimeId,
        operation: 'listModelAuditRecords',
        payload: {
          runtimeId: runtimeId === 'codex' ? 'claude' : 'codex',
          threadId: `${runtimeId}-thread`
        }
      })).rejects.toThrow(/payload\.runtimeId must match the top-level runtimeId/)

      await expect(host.auxiliary({
        runtimeId,
        operation: 'clearModelAuditRecords',
        payload: {}
      })).resolves.toBe(true)
      await expect(host.auxiliary({
        runtimeId,
        operation: 'listModelAuditRecords',
        payload: { runtimeId }
      })).resolves.toEqual([])
    }
  })

  it('records shared context state for noop compact runtimes', async () => {
    const adapter = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(adapter.capabilities).mockResolvedValue({
      ...capabilities('codex'),
      controls: {
        ...capabilities('codex').controls,
        compact: 'noop'
      },
      context: {
        state: { available: true },
        compaction: { available: true, degraded: true },
        goalResume: { available: false, reason: 'unsupported' }
      }
    })
    const cleanupCompaction = vi.fn(async () => undefined)
    adapter.compactThread = cleanupCompaction
    vi.mocked(adapter.readThread).mockResolvedValue({
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z',
      latestSeq: 3,
      items: [
        { id: 'u1', kind: 'user_message', text: 'Please inspect the workspace.' },
        { id: 'a1', kind: 'assistant_message', text: 'I found the runtime contract.' },
        { id: 't1', kind: 'tool', summary: 'rg agent-runtime-contract' }
      ]
    })
    const contextState = new RuntimeContextStateService()
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter],
      services: { contextState }
    })

    await host.compactThread({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      reason: 'manual cleanup'
    })

    expect(contextState.get({
      runtimeId: 'codex',
      threadId: 'codex-thread'
    })).toMatchObject({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      rawHistoryItems: 3,
      effectiveHistoryItems: 2,
      summarySource: 'heuristic',
      triggerReason: 'manual cleanup',
      summary: expect.stringContaining('Please inspect the workspace.')
    })
    expect(contextState.get({
      runtimeId: 'codex',
      threadId: 'codex-thread'
    })).toMatchObject({
      replacedTokens: expect.any(Number),
      sourceDigest: expect.any(String),
      digestMarker: expect.stringContaining('runtime:compaction_digest'),
      sourceItemIds: ['u1', 'a1']
    })
    expect(cleanupCompaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runtimeId: 'codex',
        threadId: 'codex-thread',
        reason: 'manual cleanup'
      })
    )
  })

  it('rejects context state auxiliary writes whose payload runtimeId belongs to another owner', async () => {
    const adapter = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const contextState = new RuntimeContextStateService()
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter],
      services: { contextState }
    })

    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'recordContextCompaction',
      payload: {
        runtimeId: 'claude',
        threadId: 'codex-thread',
        summary: 'wrong owner'
      }
    })).rejects.toThrow(/payload\.runtimeId must match the top-level runtimeId/)
    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'updateGoalResumeState',
      payload: {
        runtimeId: 'claude',
        threadId: 'codex-thread',
        objective: 'wrong owner'
      }
    })).rejects.toThrow(/payload\.runtimeId must match the top-level runtimeId/)

    expect(contextState.peek({
      runtimeId: 'codex',
      threadId: 'codex-thread'
    })).toBeNull()
  })

  it('summarizes noop compaction through Model Router when model summaries are enabled', async () => {
    const adapter = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(adapter.capabilities).mockResolvedValue({
      ...capabilities('codex'),
      controls: {
        ...capabilities('codex').controls,
        compact: 'noop'
      }
    })
    vi.mocked(adapter.readThread).mockResolvedValue({
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z',
      latestSeq: 2,
      items: [
        { id: 'u1', kind: 'user_message', text: 'Keep every runtime on the shared contract.' },
        { id: 'a1', kind: 'assistant_message', text: 'The host owns noop compaction.' }
      ]
    })
    const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<{
      ok: boolean
      status: number
      text: () => Promise<string>
    }>>(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ output_text: 'Model generated compact summary.' })
    }))
    vi.stubGlobal('fetch', fetchImpl)
    const contextState = new RuntimeContextStateService()
    const base = settings('codex')
    const host = createAgentRuntimeHost({
      settings: async () => ({
        ...base,
        modelRouter: {
          ...defaultModelRouterSettings(),
          baseUrl: 'http://127.0.0.1:4545/v1',
          publicModelAlias: 'router-summary-model',
          runtimeApiKey: 'runtime-secret'
        },
        agents: {
          ...base.agents,
          sciforge: {
            ...base.agents.sciforge,
            contextCompaction: {
              ...base.agents.sciforge.contextCompaction,
              summaryMode: 'model',
              summaryMaxTokens: 321,
              summaryTimeoutMs: 1_234
            }
          }
        }
      }),
      adapters: [adapter],
      services: { contextState }
    })

    await host.compactThread({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      reason: 'manual cleanup'
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4545/v1/responses',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer runtime-secret'
        }),
        body: expect.any(String)
      })
    )
    const request = fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      model: 'router-summary-model',
      max_tokens: 321,
      metadata: {
        schemaVersion: 'sciforge.model-router.request-audit.v1',
        route: 'model-router.responses',
        source: 'agent-runtime-host',
        operation: 'context_compaction_summary',
        runtimeId: 'codex',
        threadId: 'codex-thread',
        sourceDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
      }
    })
    expect(String(body.input)).toContain('Keep every runtime on the shared contract.')
    expect(contextState.get({
      runtimeId: 'codex',
      threadId: 'codex-thread'
    })).toMatchObject({
      summary: expect.stringContaining('Model generated compact summary.'),
      summarySource: 'model',
      triggerReason: 'manual cleanup',
      rawHistoryItems: 2,
      effectiveHistoryItems: 2,
      sourceDigest: expect.any(String),
      sourceItemIds: ['u1']
    })
  })

  it('falls back to heuristic noop compaction without calling Model Router when the runtime API key is missing', async () => {
    const adapter = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(adapter.capabilities).mockResolvedValue({
      ...capabilities('codex'),
      controls: {
        ...capabilities('codex').controls,
        compact: 'noop'
      }
    })
    vi.mocked(adapter.readThread).mockResolvedValue({
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z',
      latestSeq: 2,
      items: [
        { id: 'u1', kind: 'user_message', text: 'Do not call Model Router without a runtime key.' },
        { id: 'a1', kind: 'assistant_message', text: 'Fallback summary should still be recorded.' }
      ]
    })
    const fetchImpl = vi.fn(() => {
      throw new Error('fetch should not be called without a runtime API key')
    })
    vi.stubGlobal('fetch', fetchImpl)
    const contextState = new RuntimeContextStateService()
    const base = settings('codex')
    const host = createAgentRuntimeHost({
      settings: async () => ({
        ...base,
        modelRouter: {
          ...defaultModelRouterSettings(),
          baseUrl: 'http://127.0.0.1:4545/v1',
          publicModelAlias: 'router-summary-model',
          runtimeApiKey: ''
        },
        agents: {
          ...base.agents,
          sciforge: {
            ...base.agents.sciforge,
            contextCompaction: {
              ...base.agents.sciforge.contextCompaction,
              summaryMode: 'model'
            }
          }
        }
      }),
      adapters: [adapter],
      services: { contextState }
    })

    await expect(host.compactThread({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      reason: 'manual cleanup'
    })).resolves.toBeUndefined()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(contextState.get({
      runtimeId: 'codex',
      threadId: 'codex-thread'
    })).toMatchObject({
      summarySource: 'heuristic',
      triggerReason: 'manual cleanup; model_summary_fallback',
      summary: expect.stringContaining('Do not call Model Router without a runtime key.'),
      sourceDigest: expect.any(String),
      sourceItemIds: ['u1']
    })
  })

  it('falls back to heuristic noop compaction when Model Router summaries fail', async () => {
    const adapter = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(adapter.capabilities).mockResolvedValue({
      ...capabilities('codex'),
      controls: {
        ...capabilities('codex').controls,
        compact: 'noop'
      }
    })
    vi.mocked(adapter.readThread).mockResolvedValue({
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z',
      latestSeq: 2,
      items: [
        { id: 'u1', kind: 'user_message', text: 'Use a visible fallback summary.' },
        { id: 'a1', kind: 'assistant_message', text: 'Router failed, but compact still completes.' }
      ]
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => 'router unavailable'
    })))
    const contextState = new RuntimeContextStateService()
    const base = settings('codex')
    const host = createAgentRuntimeHost({
      settings: async () => ({
        ...base,
        modelRouter: {
          ...defaultModelRouterSettings(),
          baseUrl: 'http://127.0.0.1:4545/v1',
          publicModelAlias: 'router-summary-model',
          runtimeApiKey: 'runtime-secret'
        },
        agents: {
          ...base.agents,
          sciforge: {
            ...base.agents.sciforge,
            contextCompaction: {
              ...base.agents.sciforge.contextCompaction,
              summaryMode: 'model'
            }
          }
        }
      }),
      adapters: [adapter],
      services: { contextState }
    })

    await expect(host.compactThread({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      reason: 'manual cleanup'
    })).resolves.toBeUndefined()
    expect(contextState.get({
      runtimeId: 'codex',
      threadId: 'codex-thread'
    })).toMatchObject({
      summarySource: 'heuristic',
      triggerReason: 'manual cleanup; model_summary_fallback',
      summary: expect.stringContaining('Use a visible fallback summary.'),
      sourceDigest: expect.any(String),
      sourceItemIds: ['u1']
    })
  })

  it('tracks successful goal resume attempts across resumed sessions', async () => {
    const adapter = fakeAdapter('sciforge', {
      id: 'source-session',
      runtimeId: 'sciforge',
      title: 'Source',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    adapter.resumeSession = vi.fn(async () => ({
      threadId: 'resumed-thread',
      sessionId: 'source-session'
    }))
    const contextState = new RuntimeContextStateService()
    contextState.updateGoalResume({
      runtimeId: 'sciforge',
      threadId: 'source-session',
      objective: 'Finish the migration',
      status: 'blocked',
      resumeCount: 2,
      lastFailureReason: 'interrupted'
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('sciforge'),
      adapters: [adapter],
      services: { contextState }
    })

    await expect(host.resumeSession({
      runtimeId: 'sciforge',
      sessionId: 'source-session',
      maxResumeCount: 3
    })).resolves.toEqual({
      threadId: 'resumed-thread',
      sessionId: 'source-session'
    })

    expect(adapter.resumeSession).toHaveBeenCalled()
    expect(contextState.get({
      runtimeId: 'sciforge',
      threadId: 'resumed-thread'
    }).goalResume).toMatchObject({
      objective: 'Finish the migration',
      status: 'active',
      resumeCount: 3
    })
  })

  it('blocks goal resume when the configured resume count limit is reached', async () => {
    const adapter = fakeAdapter('sciforge', {
      id: 'source-session',
      runtimeId: 'sciforge',
      title: 'Source',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    adapter.resumeSession = vi.fn(async () => ({
      threadId: 'resumed-thread',
      sessionId: 'source-session'
    }))
    const contextState = new RuntimeContextStateService()
    contextState.updateGoalResume({
      runtimeId: 'sciforge',
      threadId: 'source-session',
      objective: 'Finish the migration',
      status: 'blocked',
      resumeCount: 3
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('sciforge'),
      adapters: [adapter],
      services: { contextState }
    })

    await expect(host.resumeSession({
      runtimeId: 'sciforge',
      sessionId: 'source-session',
      maxResumeCount: 3
    })).rejects.toThrow('Goal resume count limit reached (3).')

    expect(adapter.resumeSession).not.toHaveBeenCalled()
    expect(contextState.get({
      runtimeId: 'sciforge',
      threadId: 'source-session'
    }).goalResume).toMatchObject({
      objective: 'Finish the migration',
      status: 'blocked',
      resumeCount: 3,
      lastFailureReason: 'Goal resume count limit reached (3).'
    })
  })

  it('records a visible goal resume failure reason when session resume fails', async () => {
    const adapter = fakeAdapter('sciforge', {
      id: 'source-session',
      runtimeId: 'sciforge',
      title: 'Source',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    adapter.resumeSession = vi.fn(async () => {
      throw new Error('runtime offline')
    })
    const contextState = new RuntimeContextStateService()
    contextState.updateGoalResume({
      runtimeId: 'sciforge',
      threadId: 'source-session',
      objective: 'Finish the migration',
      status: 'blocked',
      resumeCount: 1
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('sciforge'),
      adapters: [adapter],
      services: { contextState }
    })

    await expect(host.resumeSession({
      runtimeId: 'sciforge',
      sessionId: 'source-session',
      maxResumeCount: 3
    })).rejects.toThrow('runtime offline')

    expect(contextState.get({
      runtimeId: 'sciforge',
      threadId: 'source-session'
    }).goalResume).toMatchObject({
      objective: 'Finish the migration',
      status: 'blocked',
      resumeCount: 1,
      lastFailureReason: 'runtime offline'
    })
  })

  it('records turn failure reasons against active goal resume state from runtime events', async () => {
    const adapter = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(adapter.subscribeEvents).mockImplementation(async function* () {
      yield {
        kind: 'goal_event',
        runtimeId: 'codex',
        threadId: 'codex-thread',
        objective: 'Finish shared goal resume',
        status: 'active'
      } satisfies AgentRuntimeEvent
      yield {
        kind: 'turn_lifecycle',
        runtimeId: 'codex',
        threadId: 'codex-thread',
        turnId: 'turn-1',
        state: 'failed',
        message: 'runtime offline'
      } satisfies AgentRuntimeEvent
    })
    const contextState = new RuntimeContextStateService()
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter],
      services: { contextState }
    })

    for await (const _event of host.subscribeEvents({
      runtimeId: 'codex',
      threadId: 'codex-thread'
    })) {
      // consume stream
    }

    expect(contextState.get({
      runtimeId: 'codex',
      threadId: 'codex-thread'
    }).goalResume).toMatchObject({
      objective: 'Finish shared goal resume',
      status: 'blocked',
      resumeCount: 0,
      lastFailureReason: 'runtime offline'
    })
  })

  it('records local runtime native compaction and goal events in shared context state', async () => {
    const adapter = createLocalRuntimeAgentRuntimeAdapter({
      request: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({})
      })),
      events: async function* () {
        yield {
          kind: 'compaction_completed',
          threadId: 'local-thread',
          turnId: 'turn-1',
          itemId: 'compact-1',
          summary: 'Runtime compacted summary',
          replacedTokens: 800,
          sourceDigest: 'digest-800',
          digestMarker: '<compact:digest-800>',
          sourceItemIds: ['item-a', 'item-b'],
          auto: false
        }
        yield {
          kind: 'goal_updated',
          threadId: 'local-thread',
          goal: {
            threadId: 'local-thread',
            objective: 'Finish shared context migration',
            status: 'active',
            tokensUsed: 20,
            timeUsedSeconds: 4,
            createdAt: '2026-06-10T00:00:00.000Z',
            updatedAt: '2026-06-10T00:00:01.000Z'
          }
        }
      }
    })
    const contextState = new RuntimeContextStateService()
    const host = createAgentRuntimeHost({
      settings: async () => settings('sciforge'),
      adapters: [adapter],
      services: { contextState }
    })

    const events: AgentRuntimeEvent[] = []
    for await (const event of host.subscribeEvents({
      runtimeId: 'sciforge',
      threadId: 'local-thread'
    })) {
      events.push(event)
    }

    expect(events.map((event) => event.kind)).toEqual(['compaction_event', 'goal_event'])
    expect(contextState.get({
      runtimeId: 'sciforge',
      threadId: 'local-thread'
    })).toMatchObject({
      summary: 'Runtime compacted summary',
      summarySource: 'runtime',
      triggerReason: 'replacedTokens=800',
      replacedTokens: 800,
      sourceDigest: 'digest-800',
      digestMarker: '<compact:digest-800>',
      sourceItemIds: ['item-a', 'item-b'],
      goalResume: {
        objective: 'Finish shared context migration',
        status: 'active',
        resumeCount: 0
      }
    })
  })

  it('does not report noop compaction success without the shared context service', async () => {
    const adapter = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(adapter.capabilities).mockResolvedValue({
      ...capabilities('codex'),
      controls: {
        ...capabilities('codex').controls,
        compact: 'noop'
      }
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter]
    })

    await expect(host.compactThread({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      reason: 'manual cleanup'
    })).rejects.toThrow('shared context compaction')
  })

  it('injects shared compacted context summaries into later runtime turns', async () => {
    const adapter = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const contextState = new RuntimeContextStateService()
    contextState.recordCompaction({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      summary: 'Earlier work found the host owns shared compaction.',
      summarySource: 'heuristic',
      rawHistoryItems: 12,
      effectiveHistoryItems: 3,
      replacedTokens: 2048,
      sourceDigest: 'digest-2048'
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter],
      services: { contextState }
    })

    await host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'Continue the migration.',
      displayText: 'Continue the migration.'
    })

    expect(adapter.startTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        text: expect.stringContaining('Shared compacted context summary for this thread:'),
        displayText: 'Continue the migration.'
      })
    )
    const dispatched = vi.mocked(adapter.startTurn).mock.calls[0]?.[1]
    expect(dispatched?.text).toContain('Earlier work found the host owns shared compaction.')
    expect(dispatched?.text).toContain('source_digest=digest-2048')
    expect(dispatched?.text).toContain('Continue the migration.')
  })

  it('injects bounded runtime context ledger constraints into same-runtime continuation turns', async () => {
    const adapter = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-context-ledger-host-'))
    const contextLedger = new RuntimeContextLedgerService(dataDir)
    await contextLedger.record({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      patch: {
        objective: 'Finish the host-mediated runtime migration.',
        status: 'active',
        summary: 'Turn lifecycle is unified; renderer capability messaging is still pending.',
        completed: ['Added active turn lock'],
        pending: ['Wire capability label'],
        evidence: [{
          id: 'ev-1',
          kind: 'decision',
          summary: 'Use native runtime history; do not replay the GUI transcript.'
        }],
        fileReferences: [{
          workspaceRoot: '/tmp/workspace',
          relativePath: 'src/main/runtime/agent-runtime/host.ts',
          name: 'host.ts',
          kind: 'file'
        }],
        recentTailDigest: 'tail-digest-1',
        compactionDigest: 'compact-digest-1'
      }
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter],
      services: { contextLedger }
    })

    await host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'Continue.',
      displayText: 'Continue.'
    })

    expect(adapter.startTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        text: expect.stringContaining('Runtime context ledger for this thread:'),
        displayText: 'Continue.'
      })
    )
    const dispatched = vi.mocked(adapter.startTurn).mock.calls[0]?.[1]
    expect(dispatched?.text).toContain('Objective: Finish the host-mediated runtime migration.')
    expect(dispatched?.text).toContain('Use native runtime history; do not replay the GUI transcript.')
    expect(dispatched?.text).toContain('src/main/runtime/agent-runtime/host.ts')
    expect(dispatched?.text).toContain('Recent tail digest: tail-digest-1')
    expect(dispatched?.text).toContain('This is user/runtime context data for semantic continuity')
    expect(dispatched?.text).toContain('Continue.')
  })

  it('auto-compacts long noop-runtime threads before dispatching the next turn', async () => {
    const adapter = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(adapter.capabilities).mockResolvedValue({
      ...capabilities('codex'),
      controls: {
        ...capabilities('codex').controls,
        compact: 'noop'
      }
    })
    const cleanupCompaction = vi.fn(async () => undefined)
    adapter.compactThread = cleanupCompaction
    vi.mocked(adapter.readThread).mockResolvedValue({
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z',
      latestSeq: 5,
      items: [
        { id: 'u1', kind: 'user_message', text: 'Map the shared runtime contract.' },
        { id: 'a1', kind: 'assistant_message', text: 'Found the host dispatch path.' },
        { id: 'u2', kind: 'user_message', text: 'Keep compaction generic.' },
        { id: 'a2', kind: 'assistant_message', text: 'Moved the algorithm into host shared code.' },
        { id: 'u3', kind: 'user_message', text: 'Continue.' }
      ]
    })
    const contextState = new RuntimeContextStateService()
    const base = settings('codex')
    const host = createAgentRuntimeHost({
      settings: async () => ({
        ...base,
        agents: {
          ...base.agents,
          sciforge: {
            ...base.agents.sciforge,
            contextCompaction: {
              ...base.agents.sciforge.contextCompaction,
              defaultSoftThreshold: 10,
              defaultHardThreshold: 20
            }
          }
        }
      }),
      adapters: [adapter],
      services: { contextState }
    })

    await host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'Run the next step.'
    })

    const state = contextState.get({ runtimeId: 'codex', threadId: 'codex-thread' })
    expect(state).toMatchObject({
      rawHistoryItems: 5,
      summarySource: 'heuristic',
      sourceDigest: expect.any(String),
      sourceItemIds: expect.arrayContaining(['u1'])
    })
    const dispatched = vi.mocked(adapter.startTurn).mock.calls[0]?.[1]
    expect(dispatched?.text).toContain('Shared compacted context summary for this thread:')
    expect(dispatched?.text).toContain('Run the next step.')
    expect(dispatched?.displayText).toBe('Run the next step.')
    expect(adapter.publishSyntheticEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: 'compaction_event',
        runtimeId: 'codex',
        threadId: 'codex-thread',
        status: 'success',
        auto: true,
        summary: expect.stringContaining('Map the shared runtime contract.'),
        sourceDigest: state.sourceDigest
      })
    )
    expect(cleanupCompaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runtimeId: 'codex',
        threadId: 'codex-thread',
        reason: state.triggerReason
      })
    )
  })

  it.each(['sciforge', 'codex', 'claude'] as const)(
    'keeps long-history compaction and goal resume state consistent for %s runtime contract',
    async (runtimeId) => {
      const threadId = `${runtimeId}-thread`
      const resumedThreadId = `${runtimeId}-resumed`
      const adapter = fakeAdapter(runtimeId, {
        id: threadId,
        runtimeId,
        title: runtimeId,
        updatedAt: '2026-06-10T00:00:00.000Z'
      })
      vi.mocked(adapter.capabilities).mockResolvedValue({
        ...capabilities(runtimeId),
        controls: {
          ...capabilities(runtimeId).controls,
          compact: 'noop',
          resumeSession: true
        }
      })
      vi.mocked(adapter.readThread).mockResolvedValue({
        id: threadId,
        runtimeId,
        title: runtimeId,
        updatedAt: '2026-06-10T00:00:00.000Z',
        latestSeq: 5,
        items: [
          { id: `${runtimeId}-u1`, kind: 'user_message', text: 'Map the shared runtime contract.' },
          { id: `${runtimeId}-a1`, kind: 'assistant_message', text: 'Found the host dispatch path.' },
          { id: `${runtimeId}-u2`, kind: 'user_message', text: 'Keep compaction generic.' },
          { id: `${runtimeId}-a2`, kind: 'assistant_message', text: 'Moved the algorithm into host shared code.' },
          { id: `${runtimeId}-u3`, kind: 'user_message', text: 'Continue.' }
        ]
      })
      adapter.resumeSession = vi.fn(async () => ({
        threadId: resumedThreadId,
        sessionId: threadId
      }))
      vi.mocked(adapter.subscribeEvents).mockImplementation(async function* () {
        yield {
          kind: 'goal_event',
          runtimeId,
          threadId,
          objective: `Finish ${runtimeId} migration`,
          status: 'active'
        } satisfies AgentRuntimeEvent
        yield {
          kind: 'turn_lifecycle',
          runtimeId,
          threadId,
          turnId: `${runtimeId}-turn`,
          state: 'aborted',
          message: 'interrupted by user'
        } satisfies AgentRuntimeEvent
      })
      const contextState = new RuntimeContextStateService()
      const base = settings(runtimeId)
      const host = createAgentRuntimeHost({
        settings: async () => ({
          ...base,
          agents: {
            ...base.agents,
           sciforge: {
              ...base.agents.sciforge,
              contextCompaction: {
                ...base.agents.sciforge.contextCompaction,
                defaultSoftThreshold: 10,
                defaultHardThreshold: 20
              }
            }
          }
        }),
        adapters: [adapter],
        services: { contextState }
      })

      await host.startTurn({
        runtimeId,
        threadId,
        text: 'Run the next step.'
      })
      const events: AgentRuntimeEvent[] = []
      for await (const event of host.subscribeEvents({ runtimeId, threadId })) {
        events.push(event)
      }
      await expect(host.resumeSession({
        runtimeId,
        sessionId: threadId,
        maxResumeCount: 3
      })).resolves.toEqual({
        threadId: resumedThreadId,
        sessionId: threadId
      })

      const sourceState = contextState.get({ runtimeId, threadId })
      expect(sourceState).toMatchObject({
        summarySource: 'heuristic',
        sourceDigest: expect.any(String),
        goalResume: {
          objective: `Finish ${runtimeId} migration`,
          status: 'blocked',
          resumeCount: 0,
          lastFailureReason: 'interrupted by user'
        }
      })
      expect(contextState.get({ runtimeId, threadId: resumedThreadId }).goalResume).toMatchObject({
        objective: `Finish ${runtimeId} migration`,
        status: 'active',
        resumeCount: 1
      })
      expect(events.map((event) => event.kind)).toEqual(['goal_event', 'turn_lifecycle'])
      expect(adapter.publishSyntheticEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          kind: 'compaction_event',
          runtimeId,
          threadId,
          auto: true,
          sourceDigest: sourceState.sourceDigest
        })
      )
      const dispatched = vi.mocked(adapter.startTurn).mock.calls[0]?.[1]
      expect(dispatched?.text).toContain('Shared compacted context summary for this thread:')
      expect(dispatched?.text).toContain('Run the next step.')
    }
  )

  it('normalizes file references to workspace-relative refs before adapter dispatch', async () => {
    const adapter = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter]
    })

    await host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'Use referenced files',
      workspace: '/tmp/workspace',
      fileReferences: [
        {
          path: '/tmp/workspace/src/main.ts',
          relativePath: 'src/main.ts',
          name: 'main.ts',
          mimeType: 'text/typescript'
        },
        {
          path: '/tmp/outside.ts',
          relativePath: '../outside.ts',
          name: 'outside.ts'
        },
        {
          path: '/tmp/workspace/docs/spec.pdf',
          relativePath: 'docs/spec.pdf',
          name: 'spec.pdf',
          kind: 'pdf',
          modelRouterObject: true
        }
      ]
    })

    expect(adapter.startTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        fileReferences: [
          {
            path: 'src/main.ts',
            relativePath: 'src/main.ts',
            name: 'main.ts',
            mimeType: 'text/typescript',
            delivery: 'inline_context'
          },
          {
            path: 'docs/spec.pdf',
            relativePath: 'docs/spec.pdf',
            name: 'spec.pdf',
            kind: 'pdf',
            modelRouterObject: true,
            delivery: 'model_router_object'
          }
        ]
      })
    )
  })

  it('keeps composer-previewed workspace file and directory references consistent across runtimes', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-host-workspace-ref-flow-'))
    await mkdir(join(workspaceRoot, 'docs'), { recursive: true })
    await writeFile(join(workspaceRoot, 'docs', 'guide.md'), 'Use Vitest for runtime tests.\n', 'utf8')
    await writeFile(join(workspaceRoot, 'docs', 'notes.txt'), 'Directory notes for all runtimes.\n', 'utf8')
    const workspaceReferences = new WorkspaceReferenceService()
    const directoryPreview = await workspaceReferences.preview({ workspaceRoot, path: 'docs' })
    const filePreview = await workspaceReferences.preview({ workspaceRoot, path: 'docs/guide.md' })
    expect(directoryPreview.ok).toBe(true)
    expect(filePreview.ok).toBe(true)
    if (!directoryPreview.ok || !filePreview.ok) return
    expect(directoryPreview.preview.contentSummary).toBe('Directory with 2 visible entries.')
    expect(filePreview.preview.contentSummary).toContain('Use Vitest for runtime tests.')

    const composerFileReferences = [
      composerReferenceFromWorkspaceReference(directoryPreview.preview.reference),
      composerReferenceFromWorkspaceReference(filePreview.preview.reference)
    ]
    expect(composerFileReferences.map((reference) => reference.relativePath)).toEqual(['docs', 'docs/guide.md'])
    expect(composerFileReferences.every(
      (reference) => reference.workspaceRoot === directoryPreview.preview.reference.workspaceRoot
    )).toBe(true)
    const fileReferences = composerFileReferences.map(({
      workspaceRoot: _workspaceRoot,
      ...reference
    }) => reference)
    const contextEntries = await readComposerFileContextEntries(composerFileReferences, workspaceRoot, {
      listWorkspaceReferences: (input) => workspaceReferences.list(input),
      readWorkspaceFile: (input) => readWorkspaceFile(input)
    }, { maxDirectoryFiles: 4 })
    const text = buildComposerFileContextPrompt('Summarize the referenced workspace context.', contextEntries)
    expect(text).toContain('<workspace_file path="docs" workspace_root=')
    expect(text).toContain('Expanded files: docs/guide.md, docs/notes.txt')
    expect(text).toContain('Use Vitest for runtime tests.')

    const adapters = (['sciforge', 'codex', 'claude'] as const).map((runtimeId) => fakeAdapter(runtimeId, {
      id: `${runtimeId}-thread`,
      runtimeId,
      title: runtimeId,
      updatedAt: '2026-06-10T00:00:00.000Z'
    }))
    const host = createAgentRuntimeHost({
      settings: async () => ({
        ...settings('codex'),
        workspaceRoot
      }),
      adapters,
      services: { workspaceReferences }
    })

    for (const runtimeId of ['sciforge', 'codex', 'claude'] as const) {
      await host.startTurn({
        runtimeId,
        threadId: `${runtimeId}-thread`,
        text,
        workspace: workspaceRoot,
        fileReferences
      })
    }

    for (const adapter of adapters) {
      expect(adapter.startTurn).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          text: expect.stringContaining('Directory notes for all runtimes.'),
          fileReferences: [
            {
              path: 'docs',
              relativePath: 'docs',
              name: 'docs',
              kind: 'directory',
              delivery: 'inline_context'
            },
            {
              path: 'docs/guide.md',
              relativePath: 'docs/guide.md',
              name: 'guide.md',
              kind: 'text',
              mimeType: expect.stringMatching(/^text\//),
              delivery: 'inline_context'
            }
          ]
        })
      )
    }
  })

  it('falls back to adapter auxiliary when workspace reference service is unavailable', async () => {
    const adapter = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const adapterAuxiliary = vi.fn(async () => ({
      ok: false,
      message: 'workspace references unavailable in adapter'
    }))
    adapter.auxiliary = adapterAuxiliary
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter]
    })

    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'previewWorkspaceReference',
      payload: {
        workspaceRoot: '/tmp/workspace',
        path: 'docs/guide.md'
      }
    })).resolves.toEqual({
      ok: false,
      message: 'workspace references unavailable in adapter'
    })
    expect(adapterAuxiliary).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runtimeId: 'codex',
        operation: 'previewWorkspaceReference'
      })
    )
  })

  it('surfaces malformed shared memory create payloads through host auxiliary', async () => {
    const memory = new SharedMemoryService(await mkdtemp(join(tmpdir(), 'sciforge-host-memory-malformed-')))
    const adapter = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const adapterAuxiliary = vi.fn(async () => ({ adapter: true }))
    adapter.auxiliary = adapterAuxiliary
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter],
      services: { memory }
    })

    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'createMemory',
      payload: { scope: 'user' }
    })).rejects.toThrow('payload.text')
    expect(adapterAuxiliary).not.toHaveBeenCalled()
  })

  it('injects shared memory consistently before dispatching turns to every runtime', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'sciforge-host-memory-'))
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-host-memory-workspace-'))
    const otherWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-host-memory-other-'))
    await mkdir(workspaceRoot, { recursive: true })
    const memory = new SharedMemoryService(dataDir)

    const adapters = (['sciforge', 'codex', 'claude'] as const).map((runtimeId) => fakeAdapter(runtimeId, {
      id: `${runtimeId}-thread`,
      runtimeId,
      title: runtimeId,
      updatedAt: '2026-06-10T00:00:00.000Z'
    }))
    const host = createAgentRuntimeHost({
      settings: async () => ({
        ...settings('codex'),
        workspaceRoot
      }),
      adapters,
      services: { memory }
    })

    await host.auxiliary({
      runtimeId: 'sciforge',
      operation: 'createMemory',
      payload: {
        text: 'User prefers verbose technical answers.',
        scope: 'user'
      }
    })
    const workspaceMemory = await host.auxiliary({
      runtimeId: 'codex',
      operation: 'createMemory',
      payload: {
        text: 'Workspace uses Jest for runtime tests.',
        scope: 'workspace',
        workspace: workspaceRoot,
        tags: ['testing']
      }
    }) as { id: string }
    await host.auxiliary({
      runtimeId: 'claude',
      operation: 'updateMemory',
      payload: {
        memoryId: workspaceMemory.id,
        patch: {
          text: 'Workspace uses Vitest for runtime tests.',
          tags: ['testing', 'runtime']
        }
      }
    })
    await host.auxiliary({
      runtimeId: 'sciforge',
      operation: 'updateMemory',
      payload: {
        memoryId: (await host.auxiliary({
          runtimeId: 'sciforge',
          operation: 'createMemory',
          payload: {
            text: 'Disabled memory must not inject.',
            scope: 'user'
          }
        }) as { id: string }).id,
        patch: { disabled: true }
      }
    })
    const deleted = await host.auxiliary({
      runtimeId: 'codex',
      operation: 'createMemory',
      payload: {
        text: 'Deleted memory must not inject.',
        scope: 'user'
      }
    }) as { id: string }
    await host.auxiliary({
      runtimeId: 'codex',
      operation: 'deleteMemory',
      payload: { memoryId: deleted.id }
    })
    await host.auxiliary({
      runtimeId: 'claude',
      operation: 'createMemory',
      payload: {
        text: 'Other workspace memory must not leak.',
        scope: 'workspace',
        workspace: otherWorkspace
      }
    })
    await host.auxiliary({
      runtimeId: 'sciforge',
      operation: 'createMemory',
      payload: {
        text: 'Project memory for runtime tests.',
        scope: 'project',
        workspace: workspaceRoot
      }
    })
    const defaultProjectMemory = await host.auxiliary({
      runtimeId: 'sciforge',
      operation: 'createMemory',
      payload: {
        text: 'Default project memory for runtime tests.',
        scope: 'project'
      }
    }) as { workspace?: string; project?: string }
    const canonicalWorkspaceRoot = await realpath(workspaceRoot)
    expect(defaultProjectMemory).toMatchObject({
      workspace: canonicalWorkspaceRoot,
      project: canonicalWorkspaceRoot
    })
    await host.auxiliary({
      runtimeId: 'claude',
      operation: 'createMemory',
      payload: {
        text: 'Other project memory must not leak.',
        scope: 'project',
        workspace: workspaceRoot,
        project: 'other-project'
      }
    })

    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'listMemories',
      payload: { options: { query: 'Vitest', workspace: workspaceRoot } }
    })).resolves.toEqual([
      expect.objectContaining({
        id: workspaceMemory.id,
        text: 'Workspace uses Vitest for runtime tests.',
        tags: ['testing', 'runtime']
      })
    ])

    for (const runtimeId of ['sciforge', 'codex', 'claude'] as const) {
      await host.startTurn({
        runtimeId,
        threadId: `${runtimeId}-thread`,
        text: 'Please run runtime tests.',
        workspace: workspaceRoot
      })
    }

    for (const adapter of adapters) {
      expect(adapter.startTurn).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          text: expect.stringContaining('Shared memory relevant to this turn:'),
          displayText: 'Please run runtime tests.'
        })
      )
      const input = vi.mocked(adapter.startTurn).mock.calls[0]?.[1]
      expect(input?.text).toContain('User prefers verbose technical answers.')
      expect(input?.text).toContain('Workspace uses Vitest for runtime tests.')
      expect(input?.text).toContain('Project memory for runtime tests.')
      expect(input?.text).toContain('Default project memory for runtime tests.')
      expect(input?.text).not.toContain('Workspace uses Jest for runtime tests.')
      expect(input?.text).not.toContain('Other workspace memory must not leak.')
      expect(input?.text).not.toContain('Other project memory must not leak.')
      expect(input?.text).not.toContain('Disabled memory must not inject.')
      expect(input?.text).not.toContain('Deleted memory must not inject.')
    }
  })

  it('drives shared memory injection from settings memory actions', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'sciforge-host-settings-memory-'))
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-host-settings-memory-workspace-'))
    const memory = new SharedMemoryService(dataDir)
    const adapters = (['sciforge', 'codex', 'claude'] as const).map((runtimeId) => fakeAdapter(runtimeId, {
      id: `${runtimeId}-thread`,
      runtimeId,
      title: runtimeId,
      updatedAt: '2026-06-10T00:00:00.000Z'
    }))
    const host = createAgentRuntimeHost({
      settings: async () => ({
        ...settings('codex'),
        workspaceRoot
      }),
      adapters,
      services: { memory }
    })
    let records: SettingsMemoryRecord[] = []
    let draftContent = '  Settings-created memory reaches every runtime.  '
    let editingContent = ''
    let editingId: string | null = null
    const provider = {
      createMemory: async (input: { content: string; scope?: 'user' | 'workspace' | 'project'; workspace?: string; project?: string }) => {
        const record = await host.auxiliary({
          runtimeId: 'codex',
          operation: 'createMemory',
          payload: {
            text: input.content,
            scope: input.scope,
            workspace: input.workspace,
            project: input.project
          }
        }) as { id: string; text: string; scope: 'user' | 'workspace' | 'project'; workspace?: string; tags: string[]; createdAt: string; updatedAt: string }
        return {
          id: record.id,
          content: record.text,
          scope: record.scope,
          workspace: record.workspace,
          tags: record.tags,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt
        } satisfies SettingsMemoryRecord
      },
      updateMemory: async (memoryId: string, patch: { content?: string; disabled?: boolean }) => {
        const record = await host.auxiliary({
          runtimeId: 'codex',
          operation: 'updateMemory',
          payload: {
            memoryId,
            patch: {
              ...(patch.content !== undefined ? { text: patch.content } : {}),
              ...(patch.disabled !== undefined ? { disabled: patch.disabled } : {})
            }
          }
        }) as { id: string; text: string; scope: 'user' | 'workspace' | 'project'; workspace?: string; tags: string[]; disabled?: boolean; createdAt: string; updatedAt: string; disabledAt?: string }
        return {
          id: record.id,
          content: record.text,
          scope: record.scope,
          workspace: record.workspace,
          tags: record.tags,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          ...(record.disabledAt ? { disabledAt: record.disabledAt } : {})
        } satisfies SettingsMemoryRecord
      },
      deleteMemory: async (memoryId: string) => {
        const record = await host.auxiliary({
          runtimeId: 'codex',
          operation: 'deleteMemory',
          payload: { memoryId }
        }) as { id: string; text: string; scope: 'user' | 'workspace' | 'project'; createdAt: string; updatedAt: string; deletedAt?: string }
        return {
          id: record.id,
          content: record.text,
          scope: record.scope,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          ...(record.deletedAt ? { deletedAt: record.deletedAt } : {})
        } satisfies SettingsMemoryRecord
      }
    }
    const actions = createSettingsMemoryActions({
      getProvider: () => provider,
      getState: () => ({
        memoryDraftContent: draftContent,
        memoryDraftScope: 'workspace',
        memoryEditingContent: editingContent,
        workspaceRoot
      }),
      setMemoryRecords: (next: SettingsMemoryRecordUpdater) => {
        records = typeof next === 'function' ? next(records) : next
      },
      setMemoryDraftContent: (value) => {
        draftContent = value
      },
      setMemoryEditingId: (value) => {
        editingId = value
      },
      setMemoryEditingContent: (value) => {
        editingContent = value
      },
      setNotice: vi.fn(),
      t: (key) => key
    })

    await actions.createMemoryRecord()
    expect(records[0]?.content).toBe('Settings-created memory reaches every runtime.')
    actions.startEditingMemoryRecord(records[0]!)
    editingContent = 'Settings-updated memory reaches every runtime.'
    await actions.saveMemoryRecord(records[0]!.id)
    expect(editingId).toBeNull()

    for (const runtimeId of ['sciforge', 'codex', 'claude'] as const) {
      await host.startTurn({
        runtimeId,
        threadId: `${runtimeId}-thread`,
        text: 'Use shared memory.',
        workspace: workspaceRoot
      })
    }

    for (const adapter of adapters) {
      expect(vi.mocked(adapter.startTurn).mock.calls[0]?.[1].text).toContain(
        'Settings-updated memory reaches every runtime.'
      )
    }

    await actions.disableMemoryRecord(records[0]!.id)
    vi.clearAllMocks()
    for (const runtimeId of ['sciforge', 'codex', 'claude'] as const) {
      await host.startTurn({
        runtimeId,
        threadId: `${runtimeId}-thread`,
        text: 'Use shared memory.',
        workspace: workspaceRoot
      })
    }
    for (const adapter of adapters) {
      expect(vi.mocked(adapter.startTurn).mock.calls[0]?.[1].text).not.toContain(
        'Settings-updated memory reaches every runtime.'
      )
    }
  })

  it('creates fail-open git checkpoints around runtime turns', async () => {
    const adapter = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(adapter.startTurn).mockResolvedValue({
      threadId: 'codex-thread',
      turnId: 'turn-1'
    })
    vi.mocked(adapter.subscribeEvents).mockImplementation(async function* () {
      yield {
        kind: 'turn_lifecycle',
        runtimeId: 'codex',
        threadId: 'codex-thread',
        turnId: 'turn-1',
        state: 'completed'
      } satisfies AgentRuntimeEvent
    })
    const create = vi.fn(async () => ({
      ok: true as const,
      value: {
        checkpointId: 'checkpoint',
        runtimeId: 'codex' as const,
        threadId: 'codex-thread',
        workspaceRoot: '/tmp/workspace',
        repositoryRoot: '/tmp/workspace',
        branch: 'main',
        head: 'abc',
        createdAt: '2026-06-20T00:00:00.000Z',
        diffStat: '',
        status: 'available' as const
      }
    }))
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter],
      services: {
        gitCheckpoints: { create } as never
      }
    })

    await host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'edit files',
      workspace: '/tmp/workspace'
    })
    for await (const _event of host.subscribeEvents({
      runtimeId: 'codex',
      threadId: 'codex-thread'
    })) {
      // consume stream
    }

    expect(create).toHaveBeenNthCalledWith(1, {
      runtimeId: 'codex',
      threadId: 'codex-thread',
      workspaceRoot: '/tmp/workspace'
    })
    expect(create).toHaveBeenNthCalledWith(2, {
      runtimeId: 'codex',
      threadId: 'codex-thread',
      turnId: 'turn-1',
      workspaceRoot: '/tmp/workspace'
    })
  })

  it('routes git checkpoint auxiliary operations through host services before adapters', async () => {
    const adapter = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const adapterAuxiliary = vi.fn(async () => ({ adapter: true }))
    adapter.auxiliary = adapterAuxiliary
    const checkpoint = {
      checkpointId: 'checkpoint-1',
      runtimeId: 'codex',
      threadId: 'codex-thread',
      turnId: 'turn-1',
      workspaceRoot: '/tmp/workspace',
      repositoryRoot: '/tmp/workspace',
      branch: 'main',
      head: 'abc123',
      createdAt: '2026-06-20T00:00:00.000Z',
      diffStat: ' src/app.ts | 1 +',
      status: 'available'
    } satisfies AgentRuntimeGitCheckpoint
    const restored = {
      ...checkpoint,
      status: 'restored',
      restoreStatus: '2026-06-20T00:01:00.000Z',
      rescueCheckpointId: 'checkpoint-rescue'
    } satisfies AgentRuntimeGitCheckpoint & { rescueCheckpointId: string }
    const list = vi.fn(async () => [checkpoint])
    const create = vi.fn(async () => ({ ok: true as const, value: checkpoint }))
    const preview = vi.fn(async () => ({
      ok: true as const,
      value: {
        checkpoint,
        stagedPatch: 'diff --git a/src/app.ts b/src/app.ts',
        unstagedPatch: '',
        untrackedFiles: ['notes.md']
      }
    }))
    const restore = vi.fn(async () => ({ ok: true as const, value: restored }))
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter],
      services: {
        gitCheckpoints: { list, create, preview, restore } as never
      }
    })

    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'listGitCheckpoints',
      payload: {
        threadId: 'codex-thread',
        workspaceRoot: '/tmp/workspace'
      }
    })).resolves.toEqual([checkpoint])
    expect(list).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      workspaceRoot: '/tmp/workspace'
    })
    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'listGitCheckpoints',
      payload: {
        runtimeId: 'claude',
        threadId: 'codex-thread',
        workspaceRoot: '/tmp/workspace'
      }
    })).rejects.toThrow(/payload\.runtimeId must match the top-level runtimeId/)
    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'createGitCheckpoint',
      payload: {
        runtimeId: 'claude',
        threadId: 'codex-thread',
        workspaceRoot: '/tmp/workspace'
      }
    })).rejects.toThrow(/payload\.runtimeId must match the top-level runtimeId/)
    expect(create).not.toHaveBeenCalled()
    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'createGitCheckpoint',
      payload: {
        threadId: 'codex-thread',
        workspaceRoot: '/tmp/workspace',
        turnId: 'turn-1'
      }
    })).resolves.toEqual({ ok: true, value: checkpoint })
    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'previewGitCheckpoint',
      payload: { checkpointId: 'checkpoint-1' }
    })).resolves.toEqual({
      ok: true,
      value: {
        checkpoint,
        stagedPatch: 'diff --git a/src/app.ts b/src/app.ts',
        unstagedPatch: '',
        untrackedFiles: ['notes.md']
      }
    })
    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'restoreGitCheckpoint',
      payload: { checkpointId: 'checkpoint-1', force: true }
    })).resolves.toEqual({ ok: true, value: restored })

    expect(list).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      workspaceRoot: '/tmp/workspace'
    })
    expect(create).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      workspaceRoot: '/tmp/workspace',
      turnId: 'turn-1'
    })
    expect(preview).toHaveBeenCalledWith('checkpoint-1')
    expect(restore).toHaveBeenCalledWith({ checkpointId: 'checkpoint-1', force: true })
    expect(adapterAuxiliary).not.toHaveBeenCalled()
  })

  it('passes blocked git checkpoint restore results through host auxiliary', async () => {
    const adapter = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const adapterAuxiliary = vi.fn(async () => ({ adapter: true }))
    adapter.auxiliary = adapterAuxiliary
    const blocked = {
      ok: false as const,
      reason: 'dirty_worktree',
      message: 'The working tree has changes. Preview or commit/stash them before restoring.',
      details: { dirty: ['src/app.ts'] }
    }
    const restore = vi.fn(async () => blocked)
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter],
      services: {
        gitCheckpoints: { restore } as never
      }
    })

    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'restoreGitCheckpoint',
      payload: { checkpointId: 'checkpoint-1' }
    })).resolves.toEqual(blocked)

    expect(restore).toHaveBeenCalledWith({ checkpointId: 'checkpoint-1', force: false })
    expect(adapterAuxiliary).not.toHaveBeenCalled()
  })

  it('can explicitly pause the default automatic Evidence DAG feed', async () => {
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_SERVICE_URL', 'http://127.0.0.1:3897/')
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_API_KEY', 'dag-secret')
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_AUTO_FEED', 'off')
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const claude = fakeAdapter('claude', {
      id: 'claude-thread',
      runtimeId: 'claude',
      title: 'Claude',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(claude.subscribeEvents).mockImplementation(async function* () {
      yield {
        kind: 'turn_lifecycle',
        runtimeId: 'claude',
        threadId: 'claude-thread',
        turnId: 'turn-1',
        state: 'completed',
        seq: 2
      } satisfies AgentRuntimeEvent
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('claude'),
      adapters: [claude]
    })

    const events: AgentRuntimeEvent[] = []
    for await (const event of host.subscribeEvents({
      runtimeId: 'claude',
      threadId: 'claude-thread',
      sinceSeq: 0
    })) {
      events.push(event)
    }

    expect(events).toHaveLength(1)
    expect(claude.readThread).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('auto-enqueues completed turns from the neutral runtime event path into Evidence DAG when enabled', async () => {
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_SERVICE_URL', 'http://127.0.0.1:3897/')
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_API_KEY', 'dag-secret')
    vi.stubEnv('SCIFORGE_EVIDENCE_DAG_AUTO_FEED', 'true')
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { threadId: string; targetWatermark: string }
      return new Response(JSON.stringify({ ok: true, data: { snapshot: {
        threadId: body.threadId, version: 1, digest: 'sha256:auto', inputWatermark: body.targetWatermark,
        schemaVersion: '2', extractorVersion: '2', verifierVersion: '2', artifactDigests: [],
        createdAt: '2026-07-10T00:00:00.000Z', status: 'committed'
      } } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const queueRoot = await mkdtemp(join(tmpdir(), 'sciforge-host-dag-queue-'))
    evidenceQueueRoots.push(queueRoot)
    configureEvidenceDagUpdateQueue({ storagePath: join(queueRoot, 'queue.json') })
    const claude = fakeAdapter('claude', {
      id: 'claude-thread',
      runtimeId: 'claude',
      title: 'Claude',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(claude.readThread).mockResolvedValue({
      id: 'claude-thread',
      runtimeId: 'claude',
      title: 'Claude',
      updatedAt: '2026-06-10T00:00:00.000Z',
      latestSeq: 2,
      turns: [{
        id: 'turn-1',
        threadId: 'claude-thread',
        status: 'completed',
        items: [
          { id: 'u1', turnId: 'turn-1', kind: 'user_message', text: 'question' },
          { id: 'a1', turnId: 'turn-1', kind: 'assistant_message', text: 'answer' }
        ]
      }]
    })
    vi.mocked(claude.subscribeEvents).mockImplementation(async function* () {
      yield {
        kind: 'turn_lifecycle',
        runtimeId: 'claude',
        threadId: 'claude-thread',
        turnId: 'turn-1',
        state: 'completed',
        seq: 2
      } satisfies AgentRuntimeEvent
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('claude'),
      adapters: [claude]
    })

    const events: AgentRuntimeEvent[] = []
    for await (const event of host.subscribeEvents({
      runtimeId: 'claude',
      threadId: 'claude-thread',
      sinceSeq: 0
    })) {
      events.push(event)
    }

    expect(events).toHaveLength(1)
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    expect(claude.readThread).toHaveBeenCalledWith(
      expect.anything(),
      { runtimeId: 'claude', threadId: 'claude-thread' }
    )
    const [requestUrl, requestInit] = fetchMock.mock.calls[0]!
    expect(requestUrl).toBe('http://127.0.0.1:3897/updates')
    expect(requestInit).toEqual(expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        threadId: 'claude:claude-thread',
        targetWatermark: '2',
        reason: 'turn_committed',
        priority: 'background',
        trace: [
          { id: 'u1', type: 'message', role: 'user', content: 'question' },
          { id: 'a1', type: 'message', role: 'assistant', content: 'answer' }
        ],
        projectKey: '/tmp/workspace',
        workspaceRoot: '/tmp/workspace',
        projectRoot: '/tmp/workspace'
      })
    }))
    expect(new Headers(requestInit?.headers).get('authorization')).toBe('Bearer dag-secret')
  })

  it('observes repeated tool activity and escalates Codex guard controls', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(codex.subscribeEvents).mockImplementation(async function* (_ctx, input) {
      for (let index = 1; index <= 3; index += 1) {
        yield {
          kind: 'tool_event',
          runtimeId: 'codex',
          threadId: input.threadId,
          turnId: 'turn-1',
          itemId: `tool-${index}`,
          status: 'running',
          toolKind: 'command_execution',
          summary: 'date',
          meta: {
            toolName: 'local_shell',
            command: 'date'
          }
        } satisfies AgentRuntimeEvent
      }
    })
    const host = createAgentRuntimeHost({
      settings: async () => ({
        ...settings('codex'),
        runtimeGuards: {
          toolStorm: {
            enabled: true,
            windowSize: 8,
            threshold: 2
          }
        }
      }),
      adapters: [codex]
    })

    const events: AgentRuntimeEvent[] = []
    for await (const event of host.subscribeEvents({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      sinceSeq: 0
    })) {
      events.push(event)
    }
    await Promise.resolve()

    expect(events).toHaveLength(3)
    expect(codex.steerTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runtimeId: 'codex',
        threadId: 'codex-thread',
        turnId: 'turn-1'
      })
    )
    expect(codex.interruptTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runtimeId: 'codex',
        threadId: 'codex-thread',
        turnId: 'turn-1',
        discard: false
      })
    )
    expect(codex.publishSyntheticEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: 'runtime_status',
        metadata: expect.objectContaining({ guard: 'toolStorm' })
      })
    )
    expect(codex.publishSyntheticEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: 'error',
        code: 'runtime_tool_storm_interrupted',
        severity: 'error'
      })
    )
  })

  it('does not escalate repeated running updates for the same Codex tool call', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(codex.subscribeEvents).mockImplementation(async function* (_ctx, input) {
      for (let index = 1; index <= 3; index += 1) {
        yield {
          kind: 'tool_event',
          runtimeId: 'codex',
          threadId: input.threadId,
          turnId: 'turn-1',
          itemId: 'shell-call-1',
          status: 'running',
          toolKind: 'command_execution',
          summary: 'date',
          detail: `progress ${index}`,
          meta: {
            callId: 'shell-call-1',
            toolName: 'local_shell',
            command: 'date'
          }
        } satisfies AgentRuntimeEvent
      }
    })
    const host = createAgentRuntimeHost({
      settings: async () => ({
        ...settings('codex'),
        runtimeGuards: {
          toolStorm: {
            enabled: true,
            windowSize: 8,
            threshold: 2
          }
        }
      }),
      adapters: [codex]
    })

    const events: AgentRuntimeEvent[] = []
    for await (const event of host.subscribeEvents({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      sinceSeq: 0
    })) {
      events.push(event)
    }
    await Promise.resolve()

    expect(events.map((event) => event.itemId)).toEqual(['shell-call-1', 'shell-call-1', 'shell-call-1'])
    expect(codex.steerTurn).not.toHaveBeenCalled()
    expect(codex.interruptTurn).not.toHaveBeenCalled()
    expect(codex.publishSyntheticEvent).not.toHaveBeenCalled()
  })

  it('does not escalate different scripts that share the same shell wrapper', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const commands = ['ls -la', 'find src -type f | head -40', 'cat README.md']
    vi.mocked(codex.subscribeEvents).mockImplementation(async function* () {
      for (const [index, command] of commands.entries()) {
        yield shellWrappedCommandToolEvent(command, index + 1)
      }
    })
    const host = createAgentRuntimeHost({
      settings: async () => ({
        ...settings('codex'),
        runtimeGuards: {
          toolStorm: {
            enabled: true,
            windowSize: 8,
            threshold: 2
          }
        }
      }),
      adapters: [codex]
    })

    const events: AgentRuntimeEvent[] = []
    for await (const event of host.subscribeEvents({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      sinceSeq: 0
    })) {
      events.push(event)
    }
    await Promise.resolve()

    expect(events.map((event) => event.itemId)).toEqual(['tool-1', 'tool-2', 'tool-3'])
    expect(codex.steerTurn).not.toHaveBeenCalled()
    expect(codex.interruptTurn).not.toHaveBeenCalled()
    expect(codex.publishSyntheticEvent).not.toHaveBeenCalled()
  })

  it('escalates repeated identical scripts inside a shell wrapper', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(codex.subscribeEvents).mockImplementation(async function* () {
      for (let index = 1; index <= 3; index += 1) {
        yield shellWrappedCommandToolEvent('cat package.json', index)
      }
    })
    const host = createAgentRuntimeHost({
      settings: async () => ({
        ...settings('codex'),
        runtimeGuards: {
          toolStorm: {
            enabled: true,
            windowSize: 8,
            threshold: 2
          }
        }
      }),
      adapters: [codex]
    })

    for await (const _event of host.subscribeEvents({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      sinceSeq: 0
    })) {
      // exhaust stream
    }
    await vi.waitFor(() => {
      expect(codex.publishSyntheticEvent).toHaveBeenCalledTimes(3)
    })

    expect(codex.steerTurn).toHaveBeenCalledTimes(1)
    expect(codex.interruptTurn).toHaveBeenCalledTimes(1)
    expect(codex.publishSyntheticEvent).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        kind: 'runtime_status',
        metadata: expect.objectContaining({
          level: 'soft',
          family: 'command_execution:shell/read-file'
        })
      })
    )
    expect(codex.publishSyntheticEvent).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        kind: 'runtime_status',
        metadata: expect.objectContaining({
          level: 'hard',
          family: 'command_execution:shell/read-file'
        })
      })
    )
  })

  it('does not escalate different same-family scripts inside a shell wrapper', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const commands = ['cat package.json', 'sed -n 1,20p package.json', 'head -n 5 package.json']
    vi.mocked(codex.subscribeEvents).mockImplementation(async function* () {
      for (const [index, command] of commands.entries()) {
        yield shellWrappedCommandToolEvent(command, index + 1)
      }
    })
    const host = createAgentRuntimeHost({
      settings: async () => ({
        ...settings('codex'),
        runtimeGuards: {
          toolStorm: {
            enabled: true,
            windowSize: 8,
            threshold: 2
          }
        }
      }),
      adapters: [codex]
    })

    for await (const _event of host.subscribeEvents({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      sinceSeq: 0
    })) {
      // exhaust stream
    }
    await Promise.resolve()

    expect(codex.steerTurn).not.toHaveBeenCalled()
    expect(codex.interruptTurn).not.toHaveBeenCalled()
    expect(codex.publishSyntheticEvent).not.toHaveBeenCalled()
  })

  it('does not escalate different same-family Codex commands', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const commands = ['cat package.json', 'sed -n 1,20p package.json', 'head -n 5 package.json']
    vi.mocked(codex.subscribeEvents).mockImplementation(async function* () {
      for (const [index, command] of commands.entries()) {
        yield commandToolEvent(command, index + 1)
      }
    })
    const host = createAgentRuntimeHost({
      settings: async () => ({
        ...settings('codex'),
        runtimeGuards: {
          toolStorm: {
            enabled: true,
            windowSize: 8,
            threshold: 2
          }
        }
      }),
      adapters: [codex]
    })

    const events: AgentRuntimeEvent[] = []
    for await (const event of host.subscribeEvents({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      sinceSeq: 0
    })) {
      events.push(event)
    }
    await Promise.resolve()

    expect(events.map((event) => event.itemId)).toEqual(['tool-1', 'tool-2', 'tool-3'])
    expect(codex.steerTurn).not.toHaveBeenCalled()
    expect(codex.interruptTurn).not.toHaveBeenCalled()
    expect(codex.publishSyntheticEvent).not.toHaveBeenCalled()
  })

  it('does not escalate multi-step computer_use actions with different arguments', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const actions: Array<Record<string, unknown>> = [
      { action: 'list_targets' },
      { action: 'bind_target', targetId: 'app:Microsoft Edge', computerUseSessionId: 'session-1' },
      { action: 'click', computerUseSessionId: 'session-1', x: 120, y: 90 },
      { action: 'type', computerUseSessionId: 'session-1', text: 'arxiv AI scientist' },
      { action: 'key', computerUseSessionId: 'session-1', key: 'Return' },
      { action: 'screenshot', computerUseSessionId: 'session-1' }
    ]
    vi.mocked(codex.subscribeEvents).mockImplementation(async function* () {
      for (const [index, action] of actions.entries()) {
        yield computerUseToolEvent(action, index + 1)
      }
    })
    const host = createAgentRuntimeHost({
      settings: async () => ({
        ...settings('codex'),
        runtimeGuards: {
          toolStorm: {
            enabled: true,
            windowSize: 8,
            threshold: 2
          }
        }
      }),
      adapters: [codex]
    })

    const events: AgentRuntimeEvent[] = []
    for await (const event of host.subscribeEvents({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      sinceSeq: 0
    })) {
      events.push(event)
    }
    await Promise.resolve()

    expect(events.map((event) => event.itemId)).toEqual([
      'computer-use-1',
      'computer-use-2',
      'computer-use-3',
      'computer-use-4',
      'computer-use-5',
      'computer-use-6'
    ])
    expect(codex.steerTurn).not.toHaveBeenCalled()
    expect(codex.interruptTurn).not.toHaveBeenCalled()
    expect(codex.publishSyntheticEvent).not.toHaveBeenCalled()
  })

  it('does not escalate repeated computer_use screenshots within the tool budget', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(codex.subscribeEvents).mockImplementation(async function* () {
      for (let index = 1; index <= 4; index += 1) {
        yield computerUseToolEvent({
          action: 'screenshot',
          computerUseSessionId: 'session-1'
        }, index)
      }
    })
    const host = createAgentRuntimeHost({
      settings: async () => ({
        ...settings('codex'),
        runtimeGuards: {
          toolStorm: {
            enabled: true,
            windowSize: 8,
            threshold: 2
          }
        }
      }),
      adapters: [codex]
    })

    for await (const _event of host.subscribeEvents({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      sinceSeq: 0
    })) {
      // exhaust stream
    }
    await Promise.resolve()

    expect(codex.steerTurn).not.toHaveBeenCalled()
    expect(codex.interruptTurn).not.toHaveBeenCalled()
    expect(codex.publishSyntheticEvent).not.toHaveBeenCalled()
  })

  it('does not run observe tool-storm controls for native-guard runtimes', async () => {
    const local = fakeAdapter('sciforge', {
      id: 'local-thread',
      runtimeId: 'sciforge',
      title: 'Local',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(local.subscribeEvents).mockImplementation(async function* (_ctx, input) {
      for (let index = 1; index <= 4; index += 1) {
        yield {
          kind: 'tool_event',
          runtimeId: 'sciforge',
          threadId: input.threadId,
          turnId: 'turn-1',
          itemId: `tool-${index}`,
          status: 'running',
          toolKind: 'command_execution',
          summary: 'date',
          meta: {
            toolName: 'local_shell',
            command: 'date'
          }
        } satisfies AgentRuntimeEvent
      }
    })
    const host = createAgentRuntimeHost({
      settings: async () => ({
        ...settings('sciforge'),
        runtimeGuards: {
          toolStorm: {
            enabled: true,
            windowSize: 8,
            threshold: 2
          }
        }
      }),
      adapters: [local]
    })

    for await (const _event of host.subscribeEvents({
      runtimeId: 'sciforge',
      threadId: 'local-thread',
      sinceSeq: 0
    })) {
      // exhaust stream
    }
    await Promise.resolve()

    expect(local.steerTurn).not.toHaveBeenCalled()
    expect(local.interruptTurn).not.toHaveBeenCalled()
    expect(local.publishSyntheticEvent).not.toHaveBeenCalled()
  })

  it('routes same-thread startTurn into steer when the runtime supports active turn steering', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(codex.capabilities).mockResolvedValue({
      ...capabilities('codex'),
      controls: {
        ...capabilities('codex').controls,
        steer: true
      }
    })
    let runtimeStatus: 'idle' | 'running' = 'idle'
    vi.mocked(codex.readThread).mockImplementation(async () => ({
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z',
      latestSeq: 0,
      latestTurnId: runtimeStatus === 'running' ? 'turn-1' : undefined,
      latestTurnStatus: runtimeStatus,
      turns: runtimeStatus === 'running'
        ? [{ id: 'turn-1', threadId: 'codex-thread', status: 'running' }]
        : []
    }))
    vi.mocked(codex.startTurn).mockResolvedValueOnce({ threadId: 'codex-thread', turnId: 'turn-1' })
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [codex]
    })

    await expect(host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'first'
    })).resolves.toEqual({ threadId: 'codex-thread', turnId: 'turn-1' })

    runtimeStatus = 'running'
    await expect(host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'second'
    })).resolves.toEqual({ threadId: 'codex-thread', turnId: 'turn-1' })

    expect(codex.startTurn).toHaveBeenCalledTimes(1)
    expect(codex.steerTurn).toHaveBeenCalledWith(
      expect.anything(),
      {
        runtimeId: 'codex',
        threadId: 'codex-thread',
        turnId: 'turn-1',
        text: 'second'
      }
    )
  })

  it('starts a new turn when latestTurnId is terminal despite older stale running turns', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(codex.capabilities).mockResolvedValue({
      ...capabilities('codex'),
      controls: {
        ...capabilities('codex').controls,
        steer: true
      }
    })
    vi.mocked(codex.readThread).mockResolvedValue({
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z',
      latestSeq: 8,
      latestTurnId: 'turn-latest',
      latestTurnStatus: 'completed',
      turns: [
        { id: 'turn-latest', threadId: 'codex-thread', status: 'completed' },
        { id: 'turn-stale', threadId: 'codex-thread', status: 'running' }
      ]
    })
    vi.mocked(codex.startTurn).mockResolvedValueOnce({ threadId: 'codex-thread', turnId: 'turn-new' })
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [codex]
    })

    await expect(host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'new request'
    })).resolves.toEqual({ threadId: 'codex-thread', turnId: 'turn-new' })

    expect(codex.startTurn).toHaveBeenCalledTimes(1)
    expect(codex.steerTurn).not.toHaveBeenCalled()
  })

  it('queues turn starts per thread until the active turn reaches terminal', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    let runtimeStatus: 'idle' | 'running' | 'completed' = 'idle'
    vi.mocked(codex.readThread).mockImplementation(async () => ({
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z',
      latestSeq: 0,
      latestTurnId: runtimeStatus === 'idle' ? undefined : 'turn-1',
      latestTurnStatus: runtimeStatus,
      turns: runtimeStatus === 'idle'
        ? []
        : [{ id: 'turn-1', threadId: 'codex-thread', status: runtimeStatus }]
    }))
    const first = deferred<AgentRuntimeTurnHandle>()
    vi.mocked(codex.startTurn)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ threadId: 'codex-thread', turnId: 'turn-2' })
    vi.mocked(codex.subscribeEvents).mockImplementation(async function* () {
      yield {
        kind: 'turn_lifecycle',
        runtimeId: 'codex',
        threadId: 'codex-thread',
        turnId: 'turn-1',
        state: 'completed'
      } satisfies AgentRuntimeEvent
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [codex]
    })

    const firstStart = host.startTurn({ runtimeId: 'codex', threadId: 'codex-thread', text: 'first' })
    const secondStart = host.startTurn({ runtimeId: 'codex', threadId: 'codex-thread', text: 'second' })
    await vi.waitFor(() => {
      expect(codex.startTurn).toHaveBeenCalledTimes(1)
    })

    runtimeStatus = 'running'
    first.resolve({ threadId: 'codex-thread', turnId: 'turn-1' })
    await expect(firstStart).resolves.toEqual({ threadId: 'codex-thread', turnId: 'turn-1' })
    await vi.waitFor(() => {
      expect(codex.startTurn).toHaveBeenCalledTimes(1)
    })

    runtimeStatus = 'completed'
    for await (const _event of host.subscribeEvents({
      runtimeId: 'codex',
      threadId: 'codex-thread'
    })) {
      // exhaust terminal event
    }

    await expect(secondStart).resolves.toEqual({ threadId: 'codex-thread', turnId: 'turn-2' })
    expect(codex.startTurn).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ text: 'first' })
    )
    expect(codex.startTurn).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ text: 'second' })
    )
  })

  it('routes running-thread input through steerTurn when the runtime supports steering', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(codex.capabilities).mockResolvedValue({
      ...capabilities('codex'),
      controls: {
        ...capabilities('codex').controls,
        steer: true
      }
    })
    vi.mocked(codex.readThread).mockResolvedValue({
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z',
      latestSeq: 1,
      latestTurnId: 'turn-1',
      latestTurnStatus: 'tool_waiting',
      turns: [{ id: 'turn-1', threadId: 'codex-thread', status: 'tool_waiting' }]
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [codex]
    })

    await expect(host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'continue while tool is waiting'
    })).resolves.toEqual({
      threadId: 'codex-thread',
      turnId: 'turn-1'
    })

    expect(codex.startTurn).not.toHaveBeenCalled()
    expect(codex.steerTurn).toHaveBeenCalledWith(
      expect.anything(),
      {
        runtimeId: 'codex',
        threadId: 'codex-thread',
        turnId: 'turn-1',
        text: 'continue while tool is waiting'
      }
    )
    expect(codex.publishSyntheticEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: 'runtime_status',
        phase: 'turn_start_sent',
        metadata: expect.objectContaining({
          lifecycle: 'steerTurn',
          activeTurnState: 'tool_waiting'
        })
      })
    )
  })

  it('waits for active turn states and starts when the thread converges to terminal', async () => {
    vi.useFakeTimers()
    try {
      const codex = fakeAdapter('codex', {
        id: 'codex-thread',
        runtimeId: 'codex',
        title: 'Codex',
        updatedAt: '2026-06-10T00:00:00.000Z'
      })
      vi.mocked(codex.readThread)
        .mockResolvedValueOnce({
          id: 'codex-thread',
          runtimeId: 'codex',
          title: 'Codex',
          updatedAt: '2026-06-10T00:00:00.000Z',
          latestSeq: 1,
          latestTurnId: 'turn-1',
          latestTurnStatus: 'stream_recovering',
          turns: [{ id: 'turn-1', threadId: 'codex-thread', status: 'stream_recovering' }]
        })
        .mockResolvedValueOnce({
          id: 'codex-thread',
          runtimeId: 'codex',
          title: 'Codex',
          updatedAt: '2026-06-10T00:00:00.000Z',
          latestSeq: 2,
          latestTurnId: 'turn-1',
          latestTurnStatus: 'cancelled',
          turns: [{ id: 'turn-1', threadId: 'codex-thread', status: 'cancelled' }]
        })
      vi.mocked(codex.startTurn).mockResolvedValueOnce({ threadId: 'codex-thread', turnId: 'turn-2' })
      const host = createAgentRuntimeHost({
        settings: async () => settings('codex'),
        adapters: [codex]
      })

      const start = host.startTurn({ runtimeId: 'codex', threadId: 'codex-thread', text: 'next' })
      await Promise.resolve()
      expect(codex.startTurn).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1_000)

      await expect(start).resolves.toEqual({ threadId: 'codex-thread', turnId: 'turn-2' })
      expect(codex.readThread).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  describe.each([
    { runtimeId: 'codex' as const, supportsSteer: true },
    { runtimeId: 'sciforge' as const, supportsSteer: true },
    { runtimeId: 'claude' as const, supportsSteer: false }
  ])('$runtimeId lifecycle continuation contract', ({ runtimeId, supportsSteer }) => {
    it.each(['running', 'reconnecting', 'tool_waiting'] as const)(
      'continues during %s without opening a parallel main turn',
      async (activeState) => {
        const adapter = fakeAdapter(runtimeId, {
          id: `${runtimeId}-thread`,
          runtimeId,
          title: runtimeId,
          updatedAt: '2026-06-10T00:00:00.000Z'
        })
        vi.mocked(adapter.capabilities).mockResolvedValue({
          ...capabilities(runtimeId),
          controls: {
            ...capabilities(runtimeId).controls,
            steer: supportsSteer
          }
        })
        vi.mocked(adapter.readThread).mockImplementation(async () => ({
          id: `${runtimeId}-thread`,
          runtimeId,
          title: runtimeId,
          updatedAt: '2026-06-10T00:00:00.000Z',
          latestSeq: 1,
          latestTurnId: 'turn-active',
          latestTurnStatus: activeState,
          turns: [{ id: 'turn-active', threadId: `${runtimeId}-thread`, status: activeState }]
        }))
        const host = createAgentRuntimeHost({
          settings: async () => settings(runtimeId),
          adapters: [adapter]
        })

        if (supportsSteer) {
          await expect(host.startTurn({
            runtimeId,
            threadId: `${runtimeId}-thread`,
            text: `continue during ${activeState}`
          })).resolves.toEqual({
            threadId: `${runtimeId}-thread`,
            turnId: 'turn-active'
          })
          expect(adapter.startTurn).not.toHaveBeenCalled()
          expect(adapter.steerTurn).toHaveBeenCalledWith(
            expect.anything(),
            {
              runtimeId,
              threadId: `${runtimeId}-thread`,
              turnId: 'turn-active',
              text: `continue during ${activeState}`
            }
          )
          return
        }

        vi.useFakeTimers()
        try {
          vi.mocked(adapter.readThread)
            .mockResolvedValueOnce({
              id: `${runtimeId}-thread`,
              runtimeId,
              title: runtimeId,
              updatedAt: '2026-06-10T00:00:00.000Z',
              latestSeq: 1,
              latestTurnId: 'turn-active',
              latestTurnStatus: activeState,
              turns: [{ id: 'turn-active', threadId: `${runtimeId}-thread`, status: activeState }]
            })
            .mockResolvedValueOnce({
              id: `${runtimeId}-thread`,
              runtimeId,
              title: runtimeId,
              updatedAt: '2026-06-10T00:00:01.000Z',
              latestSeq: 2,
              latestTurnId: 'turn-active',
              latestTurnStatus: 'completed',
              turns: [{ id: 'turn-active', threadId: `${runtimeId}-thread`, status: 'completed' }]
            })
          vi.mocked(adapter.startTurn).mockResolvedValueOnce({
            threadId: `${runtimeId}-thread`,
            turnId: 'turn-next'
          })

          const continuation = host.startTurn({
            runtimeId,
            threadId: `${runtimeId}-thread`,
            text: `continue during ${activeState}`
          })
          await Promise.resolve()
          expect(adapter.steerTurn).not.toHaveBeenCalled()
          expect(adapter.startTurn).not.toHaveBeenCalled()

          await vi.advanceTimersByTimeAsync(1_000)

          await expect(continuation).resolves.toEqual({
            threadId: `${runtimeId}-thread`,
            turnId: 'turn-next'
          })
          expect(adapter.startTurn).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ text: `continue during ${activeState}` })
          )
        } finally {
          vi.useRealTimers()
        }
      }
    )

    it.each(['completed', 'failed', 'cancelled', 'aborted'] as const)(
      'starts a fresh turn after terminal %s',
      async (terminalState) => {
        const adapter = fakeAdapter(runtimeId, {
          id: `${runtimeId}-thread`,
          runtimeId,
          title: runtimeId,
          updatedAt: '2026-06-10T00:00:00.000Z'
        })
        vi.mocked(adapter.capabilities).mockResolvedValue({
          ...capabilities(runtimeId),
          controls: {
            ...capabilities(runtimeId).controls,
            steer: supportsSteer
          }
        })
        vi.mocked(adapter.readThread).mockResolvedValue({
          id: `${runtimeId}-thread`,
          runtimeId,
          title: runtimeId,
          updatedAt: '2026-06-10T00:00:00.000Z',
          latestSeq: 2,
          latestTurnId: 'turn-terminal',
          latestTurnStatus: terminalState,
          turns: [{ id: 'turn-terminal', threadId: `${runtimeId}-thread`, status: terminalState }]
        })
        vi.mocked(adapter.startTurn).mockResolvedValueOnce({
          threadId: `${runtimeId}-thread`,
          turnId: 'turn-next'
        })
        const host = createAgentRuntimeHost({
          settings: async () => settings(runtimeId),
          adapters: [adapter]
        })

        await expect(host.startTurn({
          runtimeId,
          threadId: `${runtimeId}-thread`,
          text: `continue after ${terminalState}`
        })).resolves.toEqual({
          threadId: `${runtimeId}-thread`,
          turnId: 'turn-next'
        })
        expect(adapter.steerTurn).not.toHaveBeenCalled()
        expect(adapter.startTurn).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ text: `continue after ${terminalState}` })
        )
      }
    )
  })

  it('routes neutral usage queries through the selected adapter', async () => {
    const local = fakeAdapter('sciforge', {
      id: 'local-thread',
      runtimeId: 'sciforge',
      title: 'Local',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [local, codex]
    })
    const query: AgentRuntimeUsageQuery = {
      runtimeId: 'sciforge',
      groupBy: 'thread',
      threadId: 'thr-sciforge'
    }

    await expect(host.usage(query)).resolves.toEqual({
      supported: true,
      groupBy: 'thread',
      buckets: [],
      totals: { totalTokens: 0 }
    })
    expect(local.usage).toHaveBeenCalledWith(
      { settings: expect.objectContaining({ activeAgentRuntime: 'codex' }) },
      query
    )
  })
})

describe('createLocalRuntimeAgentRuntimeAdapter', () => {
  it('uses local runtime /v1 thread endpoints and maps thread snapshots to the neutral contract', async () => {
    const seen: Array<{ path: string; init: { method?: string; body?: string } }> = []
    const adapter = createLocalRuntimeAgentRuntimeAdapter({
      request: async (_settings, path, init) => {
        seen.push({ path, init })
        if (path.startsWith('/v1/threads?')) {
          return json({
            threads: [{
              id: 'thr-sciforge',
              title: 'SciForge thread',
              workspace: '/tmp/workspace',
              model: 'deepseek-v4-pro',
              mode: 'agent',
              status: 'idle',
              createdAt: '2026-06-09T00:00:00.000Z',
              updatedAt: '2026-06-10T00:00:00.000Z'
            }]
          })
        }
        if (path === '/v1/threads/thr-sciforge' && init.method === 'GET') {
          return json({
            id: 'thr-sciforge',
            title: 'SciForge thread',
            workspace: '/tmp/workspace',
            model: 'deepseek-v4-pro',
            mode: 'agent',
            status: 'idle',
            createdAt: '2026-06-09T00:00:00.000Z',
            updatedAt: '2026-06-10T00:00:00.000Z',
            latestSeq: 2,
            turns: [{
              id: 'turn-1',
              threadId: 'thr-sciforge',
              status: 'completed',
              createdAt: '2026-06-10T00:00:00.000Z',
              finishedAt: '2026-06-10T00:00:01.000Z',
              items: [
                {
                  id: 'user-1',
                  kind: 'user_message',
                  text: 'hello',
                  status: 'completed',
                  createdAt: '2026-06-10T00:00:00.000Z'
                },
                {
                  id: 'assistant-1',
                  kind: 'assistant_text',
                  text: 'hi',
                  status: 'completed',
                  createdAt: '2026-06-10T00:00:01.000Z'
                },
                {
                  id: 'tool-1',
                  kind: 'tool_result',
                  toolKind: 'command_execution',
                  toolName: 'bash',
                  output: 'ok',
                  status: 'completed',
                  createdAt: '2026-06-10T00:00:01.000Z'
                }
              ]
            }]
          })
        }
        if (path === '/v1/threads/thr-sciforge/turns' && init.method === 'POST') {
          return json({ threadId: 'thr-sciforge', turnId: 'turn-2', userMessageItemId: 'user-2' }, 202)
        }
        return json({ code: 'not_found', message: path }, 404)
      }
    })
    const ctx = { settings: settings('sciforge') }

    await expect(adapter.listThreads(ctx, { limit: 3, search: 'Local' })).resolves.toEqual([expect.objectContaining({
      id: 'thr-sciforge',
      runtimeId: 'sciforge',
      title: 'SciForge thread',
      backendThreadId: 'thr-sciforge'
    })])
    await expect(adapter.readThread(ctx, { runtimeId: 'sciforge', threadId: 'thr-sciforge' })).resolves.toMatchObject({
      id: 'thr-sciforge',
      runtimeId: 'sciforge',
      latestSeq: 2,
      turns: [{
        id: 'turn-1',
        status: 'completed',
        items: [
          { id: 'user-1', kind: 'user_message', text: 'hello' },
          { id: 'assistant-1', kind: 'assistant_message', text: 'hi' },
          { id: 'tool-1', kind: 'tool', toolKind: 'command_execution', detail: 'ok' }
        ]
      }]
    })
    await expect(adapter.startTurn(ctx, {
      runtimeId: 'sciforge',
      threadId: 'thr-sciforge',
      text: 'run',
      mode: 'agent',
      displayText: 'Run it',
      attachmentIds: ['att-1']
    })).resolves.toEqual({
      threadId: 'thr-sciforge',
      turnId: 'turn-2',
      userMessageItemId: 'user-2'
    })

    expect(seen.map((entry) => [entry.path, entry.init.method])).toEqual([
      ['/v1/threads?limit=3&search=Local', 'GET'],
      ['/v1/threads/thr-sciforge', 'GET'],
      ['/v1/threads/thr-sciforge/turns', 'POST']
    ])
    expect(JSON.parse(seen[2].init.body ?? '{}')).toEqual({
      prompt: 'run',
      model: 'sciforge-router',
      mode: 'agent',
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access',
      displayText: 'Run it',
      attachmentIds: ['att-1']
    })
  })

  it('maps local runtime info capabilities without dropping tool diagnostics', async () => {
    const adapter = createLocalRuntimeAgentRuntimeAdapter({
      request: async (_settings, path) => {
        if (path !== '/v1/runtime/info') return json({}, 404)
        return json({
          capabilities: {
            contractVersion: 1,
            model: {
              id: 'deepseek-v4-pro',
              inputModalities: ['text', 'image'],
              outputModalities: ['text'],
              supportsToolCalling: true,
              contextWindowTokens: 64000,
              messageParts: ['text', 'image_url']
            },
            cli: {
              serve: { status: 'available', enabled: true, available: true },
              run: { status: 'disabled', enabled: false, available: false, reason: 'not implemented' },
              chat: { status: 'disabled', enabled: false, available: false, reason: 'not implemented' },
              exec: { status: 'disabled', enabled: false, available: false, reason: 'not implemented' }
            },
            mcp: {
              status: 'available',
              enabled: true,
              available: true,
              configuredServers: 2,
              connectedServers: 1,
              toolCount: 7,
              search: {
                enabled: true,
                mode: 'auto',
                active: true,
                indexedToolCount: 7,
                advertisedToolCount: 4
              }
            },
            web: {
              status: 'available',
              enabled: true,
              available: true,
              fetch: { status: 'available', enabled: true, available: true },
              search: { status: 'unavailable', enabled: true, available: false, reason: 'search provider missing' },
              provider: 'test-web'
            },
            research: {
              status: 'available',
              enabled: true,
              available: true,
              toolName: 'research_search',
              arxiv: { status: 'available', enabled: true, available: true },
              biorxiv: { status: 'unavailable', enabled: true, available: false },
              semanticScholar: { status: 'available', enabled: true, available: true },
              tavily: { status: 'available', enabled: true, available: true },
              cns: { status: 'unavailable', enabled: true, available: false },
              maxResults: 12
            },
            skills: {
              status: 'available',
              enabled: true,
              available: true,
              configuredRoots: 1,
              discoveredSkills: 3
            },
            subagents: {
              status: 'available',
              enabled: true,
              available: true,
              maxParallel: 2,
              maxChildRuns: 5
            },
            attachments: {
              status: 'available',
              enabled: true,
              available: true,
              maxImageBytes: 10,
              maxImageDimension: 10,
              allowedMimeTypes: ['image/png'],
              textFallbackMaxBase64Bytes: 10,
              textFallbackMaxImageDimension: 10,
              textFallbackPreferredMimeType: 'image/webp'
            },
            memory: {
              status: 'unavailable',
              enabled: true,
              available: false,
              reason: 'memory store missing',
              scopes: ['user'],
              maxInjectedRecords: 4
            }
          }
        })
      }
    })

    await expect(adapter.capabilities({ settings: settings('sciforge') })).resolves.toMatchObject({
      runtimeId: 'sciforge',
      transport: 'http_sse',
      model: {
        id: 'deepseek-v4-pro',
        inputModalities: ['text', 'image'],
        supportsToolCalling: true,
        contextWindowTokens: 64000
      },
      tools: {
        toolCalling: true,
        mcp: { available: true, toolCount: 7, search: { available: true } },
        web: { available: true, fetch: { available: true }, search: { available: false } },
        research: {
          available: true,
          server: 'mcp',
          toolName: 'research_search',
          sources: ['arxiv', 'semantic_scholar', 'web'],
          maxResults: 12
        },
        skills: { available: true },
        subagents: { available: true, maxParallel: 2, maxChildren: 5 },
        diagnostics: { available: true }
      },
      storage: {
        attachments: { available: true },
        memory: { available: false, reason: 'memory store missing' }
      }
    })
  })

  it('keeps local runtime usage endpoints behind the neutral adapter contract', async () => {
    const seen: Array<{ path: string; init: { method?: string; body?: string } }> = []
    const adapter = createLocalRuntimeAgentRuntimeAdapter({
      request: async (_settings, path, init) => {
        seen.push({ path, init })
        if (path.startsWith('/v1/usage?')) {
          return json({
            group_by: 'thread',
            buckets: [{
              thread_id: 'thr-sciforge',
              input_tokens: 100,
              output_tokens: 20,
              total_tokens: 120,
              cached_tokens: 0,
              cache_hit_rate: null,
              cache_savings_usd: 0.003,
              token_economy_savings_tokens: 4096,
              token_economy_savings_usd: 0.0018,
              turns: 1
            }],
            totals: {
              total_tokens: 120,
              token_economy_savings_tokens: 4096,
              token_economy_savings_usd: 0.0018,
              turns: 1
            }
          })
        }
        if (path === '/v1/threads/thr-sciforge') {
          return json({
            turns: [{
              usage: {
                prompt_cache_hit_tokens: 80,
                prompt_cache_miss_tokens: 20
              }
            }]
          })
        }
        return json({}, 404)
      }
    })

    await expect(adapter.usage({ settings: settings('sciforge') }, {
      groupBy: 'thread',
      threadId: 'thr-sciforge'
    })).resolves.toMatchObject({
      supported: true,
      groupBy: 'thread',
      buckets: [{
        threadId: 'thr-sciforge',
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        cachedTokens: 80,
        cacheMissTokens: 20,
        cacheHitRate: 0.8,
        tokenEconomySavingsTokens: 4096,
        tokenEconomySavingsUsd: 0.0018,
        turns: 1
      }],
      totals: {
        totalTokens: 120,
        tokenEconomySavingsTokens: 4096,
        tokenEconomySavingsUsd: 0.0018,
        turns: 1
      }
    })
    expect(seen.map((entry) => [entry.path, entry.init.method])).toEqual([
      ['/v1/usage?group_by=thread', 'GET'],
      ['/v1/threads/thr-sciforge', 'GET']
    ])
  })

  it('keeps local runtime usage available when cache stat hydration misses a stale thread', async () => {
    const seen: Array<{ path: string; init: { method?: string; body?: string } }> = []
    const adapter = createLocalRuntimeAgentRuntimeAdapter({
      request: async (_settings, path, init) => {
        seen.push({ path, init })
        if (path.startsWith('/v1/usage?')) {
          return json({
            group_by: 'thread',
            buckets: [{
              thread_id: 'stale-thread',
              input_tokens: 100,
              output_tokens: 20,
              total_tokens: 120
            }],
            totals: { total_tokens: 120 }
          })
        }
        if (path === '/v1/threads/stale-thread') {
          return json({ code: 'not_found', message: 'thread not found: stale-thread' }, 404)
        }
        return json({}, 404)
      }
    })

    await expect(adapter.usage({ settings: settings('sciforge') }, {
      groupBy: 'thread',
      threadId: 'stale-thread'
    })).resolves.toMatchObject({
      supported: true,
      groupBy: 'thread',
      buckets: [{
        threadId: 'stale-thread',
        totalTokens: 120
      }]
    })
    expect(seen.map((entry) => [entry.path, entry.init.method])).toEqual([
      ['/v1/usage?group_by=thread', 'GET'],
      ['/v1/threads/stale-thread', 'GET']
    ])
  })

  it('updates local runtime thread relation through the neutral adapter', async () => {
    const seen: Array<{ path: string; init: { method?: string; body?: string } }> = []
    const adapter = createLocalRuntimeAgentRuntimeAdapter({
      request: async (_settings, path, init) => {
        seen.push({ path, init })
        return json({})
      }
    })

    await expect(adapter.updateThreadRelation?.({ settings: settings('sciforge') }, {
      runtimeId: 'sciforge',
      threadId: 'thr-side',
      relation: 'primary'
    })).resolves.toBeUndefined()

    expect(seen).toEqual([{
      path: '/v1/threads/thr-side',
      init: {
        method: 'PATCH',
        body: JSON.stringify({ relation: 'primary' })
      }
    }])
  })

  it('maps local runtime SSE events to neutral lifecycle and delta events', async () => {
    const rawEvents = [
      {
        kind: 'turn_started',
        seq: 1,
        timestamp: '2026-06-12T04:41:37.972Z',
        threadId: 'thr-sciforge',
        turnId: 'turn-1'
      },
      {
        kind: 'item_created',
        seq: 2,
        timestamp: '2026-06-12T04:41:37.980Z',
        threadId: 'thr-sciforge',
        turnId: 'turn-1',
        itemId: 'user-1',
        item: {
          id: 'user-1',
          kind: 'user_message',
          text: 'hello',
          status: 'completed',
          createdAt: '2026-06-12T04:41:37.980Z'
        }
      },
      {
        kind: 'assistant_text_delta',
        seq: 3,
        timestamp: '2026-06-12T04:41:39.999Z',
        threadId: 'thr-sciforge',
        turnId: 'turn-1',
        itemId: 'assistant-1',
        item: {
          id: 'assistant-1',
          kind: 'assistant_text',
          text: 'hi',
          status: 'running'
        }
      },
      {
        kind: 'turn_completed',
        seq: 4,
        timestamp: '2026-06-12T04:41:40.021Z',
        threadId: 'thr-sciforge',
        turnId: 'turn-1'
      }
    ]
    const adapter = createLocalRuntimeAgentRuntimeAdapter({
      request: async () => json({}),
      events: async function* () {
        yield* rawEvents
      }
    })

    const events: AgentRuntimeEvent[] = []
    for await (const event of adapter.subscribeEvents!({ settings: settings('sciforge') }, {
      runtimeId: 'sciforge',
      threadId: 'thr-sciforge',
      sinceSeq: 0
    })) {
      events.push(event)
    }

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'turn_lifecycle',
        runtimeId: 'sciforge',
        threadId: 'thr-sciforge',
        turnId: 'turn-1',
        state: 'started',
        seq: 1,
        createdAt: '2026-06-12T04:41:37.972Z'
      }),
      expect.objectContaining({
        kind: 'item_snapshot',
        threadId: 'thr-sciforge',
        turnId: 'turn-1',
        seq: 2,
        item: expect.objectContaining({ id: 'user-1', kind: 'user_message', text: 'hello' })
      }),
      expect.objectContaining({
        kind: 'assistant_delta',
        threadId: 'thr-sciforge',
        turnId: 'turn-1',
        itemId: 'assistant-1',
        text: 'hi',
        seq: 3
      }),
      expect.objectContaining({
        kind: 'turn_lifecycle',
        runtimeId: 'sciforge',
        threadId: 'thr-sciforge',
        turnId: 'turn-1',
        state: 'completed',
        seq: 4,
        createdAt: '2026-06-12T04:41:40.021Z'
      })
    ])
  })
})

describe('createCodexAgentRuntimeAdapter', () => {
  it('wraps CodexRuntimeService operations and exposes honest Codex capabilities', async () => {
    const userInputQuestions = [{
      id: 'choice',
      header: 'Choice',
      question: 'Pick one',
      options: [{ label: 'Yes', description: 'Continue' }]
    }]
    const service = {
      connect: vi.fn(async () => ({ ok: true as const, info: {} })),
      listThreads: vi.fn(async () => ({
        ok: true as const,
        threads: [{
          id: 'codex-thread',
          title: 'Codex',
          updatedAt: '2026-06-10T00:00:00.000Z',
          model: 'gpt-5',
          mode: 'agent',
          latestTurnId: 'turn-1'
        }]
      })),
      startThread: vi.fn(async () => ({
        ok: true as const,
        thread: {
          id: 'codex-thread',
          title: 'Codex',
          updatedAt: '2026-06-10T00:00:00.000Z',
          model: 'gpt-5',
          mode: 'agent'
        }
      })),
      readThread: vi.fn(async () => ({
        ok: true as const,
        detail: {
          latestSeq: 3,
          latestTurnId: 'turn-1',
          blocks: [
            { kind: 'user' as const, id: 'user-1', text: '[Claw managed instructions]\nhello', displayText: 'hello' },
            { kind: 'assistant' as const, id: 'assistant-1', text: 'hi' },
            { kind: 'reasoning' as const, id: 'reasoning-1', text: 'thinking' },
            {
              kind: 'tool' as const,
              id: 'tool-1',
              summary: 'Command',
              status: 'success' as const,
              toolKind: 'command_execution' as const,
              detail: 'ok'
            },
            {
              kind: 'tool' as const,
              id: 'approval-item',
              summary: 'File change approval requested',
              status: 'running' as const,
              toolKind: 'file_change' as const,
              meta: {
                codexRequestId: 'approval-1',
                codexRequestKind: 'approval',
                codexRequestMethod: 'item/fileChange/requestApproval'
              }
            },
            {
              kind: 'tool' as const,
              id: 'input-item',
              summary: 'User input requested',
              status: 'running' as const,
              meta: {
                codexRequestId: 'input-1',
                codexRequestKind: 'user_input',
                codexRequestMethod: 'item/tool/requestUserInput',
                questions: userInputQuestions
              }
            }
          ]
        }
      })),
      startTurn: vi.fn(async () => ({
        ok: true as const,
        threadId: 'codex-thread',
        turnId: 'turn-2',
        userMessageItemId: 'user-2'
      })),
      interruptTurn: vi.fn(async () => ({ ok: true as const })),
      steerTurn: vi.fn(async () => ({ ok: true as const })),
      renameThread: vi.fn(async () => ({ ok: true as const })),
      deleteThread: vi.fn(async () => ({ ok: true as const })),
      archiveThread: vi.fn(async () => ({ ok: true as const })),
      resolveApproval: vi.fn(async () => ({ ok: true as const })),
      resolveUserInput: vi.fn(async () => ({ ok: true as const })),
      readStoredEvents: vi.fn(async () => [
        {
          threadId: 'codex-thread',
          seq: 5,
          deltas: [{ kind: 'agent_message' as const, text: 'stored' }]
        },
        {
          threadId: 'codex-thread',
          turnId: 'turn-1',
          seq: 6,
          tool: {
            itemId: 'approval-item',
            summary: 'File change approval requested',
            status: 'running' as const,
            toolKind: 'file_change' as const,
            meta: {
              codexRequestId: 'approval-1',
              codexRequestKind: 'approval',
              codexRequestMethod: 'item/fileChange/requestApproval'
            }
          }
        },
        {
          threadId: 'codex-thread',
          turnId: 'turn-1',
          seq: 7,
          tool: {
            itemId: 'input-item',
            summary: 'User input requested',
            status: 'running' as const,
            meta: {
              codexRequestId: 'input-1',
              codexRequestKind: 'user_input',
              codexRequestMethod: 'item/tool/requestUserInput',
              questions: userInputQuestions
            }
          }
        },
        {
          threadId: 'codex-thread',
          turnId: 'turn-1',
          seq: 8,
          runtimeStatus: {
            itemId: 'latency-first-delta',
            phase: 'first_delta',
            message: 'First Codex delta received',
            latencyMs: 42
          }
        }
      ])
    } as unknown as CodexRuntimeService
    const adapter = createCodexAgentRuntimeAdapter(service)
    const ctx = { settings: settings('codex') }

    await expect(adapter.capabilities(ctx)).resolves.toMatchObject({
      runtimeId: 'codex',
      transport: 'jsonrpc_stdio',
      threadMaterialization: 'after_first_user_message',
      controls: {
        interrupt: true,
        steer: true,
        approval: 'async',
        userInput: 'async',
        compact: 'noop',
        fork: false,
        review: false,
        goals: false,
        todos: false,
        resumeSession: false
      },
      storage: {
        guiOwnedThreads: true,
        backendThreadIdStable: false,
        usage: true,
        attachments: { available: false },
        memory: { available: false }
      }
    })
    await expect(adapter.usage(ctx, { groupBy: 'thread', threadId: 'codex-thread' })).resolves.toEqual({
      supported: false,
      reason: 'usage unsupported',
      groupBy: 'thread',
      buckets: [],
      totals: {}
    })
    await expect(adapter.listThreads(ctx, {
      includeArchived: true,
      search: 'Codex',
      limit: 25
    })).resolves.toEqual([expect.objectContaining({
      id: 'codex-thread',
      runtimeId: 'codex',
      backendThreadId: 'codex-thread'
    })])
    expect(service.listThreads).toHaveBeenCalledWith({
      includeArchived: true,
      search: 'Codex',
      limit: 25
    })
    await expect(adapter.readThread(ctx, { runtimeId: 'codex', threadId: 'codex-thread' })).resolves.toMatchObject({
      id: 'codex-thread',
      runtimeId: 'codex',
      latestSeq: 3,
      turns: [{
        id: 'turn-1',
        items: [
          { id: 'user-1', kind: 'user_message', text: 'hello' },
          { id: 'assistant-1', kind: 'assistant_message', text: 'hi' },
          { id: 'reasoning-1', kind: 'reasoning', text: 'thinking' },
          { id: 'tool-1', kind: 'tool', toolKind: 'command_execution', detail: 'ok' },
          {
            id: 'approval-item',
            kind: 'approval',
            status: 'pending',
            summary: 'File change approval requested',
            toolKind: 'file_change',
            meta: expect.objectContaining({
              approvalId: 'approval-1',
              codexRequestId: 'approval-1',
              codexRequestKind: 'approval',
              codexRequestMethod: 'item/fileChange/requestApproval'
            })
          },
          {
            id: 'input-item',
            kind: 'user_input',
            status: 'pending',
            summary: 'User input requested',
            meta: expect.objectContaining({
              requestId: 'input-1',
              codexRequestId: 'input-1',
              codexRequestKind: 'user_input',
              codexRequestMethod: 'item/tool/requestUserInput',
              questions: userInputQuestions
            })
          }
        ]
      }]
    })
    vi.mocked(service.readThread).mockResolvedValueOnce({
      ok: true as const,
      detail: {
        latestSeq: 1,
        threadStatus: 'running',
        blocks: []
      }
    })
    const emptyDetail = await adapter.readThread(ctx, { runtimeId: 'codex', threadId: 'empty-codex-thread' })
    expect(emptyDetail).toMatchObject({
      id: 'empty-codex-thread',
      runtimeId: 'codex',
      latestSeq: 1,
      turns: [],
      items: []
    })
    expect(emptyDetail.status).toBeUndefined()
    expect(emptyDetail.latestTurnId).toBeUndefined()
    await expect(adapter.startTurn(ctx, {
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'run',
      displayText: 'Run it',
      model: 'gpt-5',
      reasoningEffort: 'high'
    })).resolves.toEqual({
      threadId: 'codex-thread',
      turnId: 'turn-2',
      userMessageItemId: 'user-2'
    })
    expect(service.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'codex-thread',
      text: 'run',
      displayText: 'Run it'
    }))
    await expect(adapter.resolveApproval?.(ctx, {
      runtimeId: 'codex',
      threadId: 'codex-thread',
      approvalId: 'server-request-1',
      decision: 'allowed',
      message: 'approved'
    })).resolves.toBeUndefined()
    await expect(adapter.resolveUserInput?.(ctx, {
      runtimeId: 'codex',
      threadId: 'codex-thread',
      requestId: 'server-request-2',
      answers: [{ id: 'choice', value: 'yes' }]
    })).resolves.toBeUndefined()
    await expect(adapter.auxiliary?.(ctx, {
      runtimeId: 'codex',
      operation: 'archiveThread',
      payload: { threadId: 'codex-thread', archived: false }
    })).resolves.toBeUndefined()
    const events: AgentRuntimeEvent[] = []
    for await (const event of adapter.subscribeEvents(ctx, { runtimeId: 'codex', threadId: 'codex-thread', sinceSeq: 4 })) {
      events.push(event)
    }

    expect(service.startTurn).toHaveBeenCalledWith({
      threadId: 'codex-thread',
      text: 'run',
      displayText: 'Run it',
      model: 'gpt-5',
      reasoningEffort: 'high',
      workspace: undefined
    })
    expect(service.resolveApproval).toHaveBeenCalledWith({
      requestId: 'server-request-1',
      decision: 'allowed',
      message: 'approved'
    })
    expect(service.resolveUserInput).toHaveBeenCalledWith({
      requestId: 'server-request-2',
      answers: [{ id: 'choice', value: 'yes' }]
    })
    expect(service.archiveThread).toHaveBeenCalledWith('codex-thread', false)
    expect(events).toEqual([
      {
        kind: 'assistant_delta',
        threadId: 'codex-thread',
        runtimeId: 'codex',
        seq: 5,
        text: 'stored',
        itemId: 'codex-delta-5-0'
      },
      {
        kind: 'approval_requested',
        threadId: 'codex-thread',
        runtimeId: 'codex',
        turnId: 'turn-1',
        seq: 6,
        itemId: 'approval-item',
        approvalId: 'approval-1',
        summary: 'File change approval requested',
        toolName: 'file change',
        meta: expect.objectContaining({
          codexRequestId: 'approval-1',
          codexRequestKind: 'approval',
          codexRequestMethod: 'item/fileChange/requestApproval'
        })
      },
      {
        kind: 'user_input_requested',
        threadId: 'codex-thread',
        runtimeId: 'codex',
        turnId: 'turn-1',
        seq: 7,
        itemId: 'input-item',
        requestId: 'input-1',
        questions: userInputQuestions
      },
      {
        kind: 'runtime_status',
        threadId: 'codex-thread',
        runtimeId: 'codex',
        turnId: 'turn-1',
        seq: 8,
        itemId: 'latency-first-delta',
        phase: 'first_delta',
        message: 'First Codex delta received',
        latencyMs: 42
      }
    ])
  })
})
