import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createExecutionReceipt } from '@sciforge/execution-governance'
import {
  WORKSPACE_HOST_PROTOCOL_VERSION,
  type WorkspaceLocator
} from '@sciforge/domain-sdk/workspace-host'
import {
  sanitizeTraceTextChunks,
  type TraceEvent,
  type TraceEventInput
} from '@sciforge/full-trace'
import {
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
import type {
  AgentRuntimeAuxiliaryActiveScopedOperation,
  AgentRuntimeAuxiliaryInput,
  AgentRuntimeCapabilities,
  AgentRuntimeExecutionIntent,
  AgentRuntimeEvent,
  AgentRuntimeId,
  AgentRuntimeUsageQuery,
  AgentRuntimeUsageResponse,
  AgentRuntimeThread,
  AgentRuntimeThreadPage,
  AgentRuntimeThreadSnapshot,
  AgentRuntimeThreadStatus,
  AgentRuntimeThreadStatusInput,
  AgentRuntimeTurnHandle
} from '../../../shared/agent-runtime-contract'
import {
  AGENT_RUNTIME_AUXILIARY_OPERATIONS,
  AGENT_RUNTIME_AUXILIARY_RUNTIME_ID_REQUIRED_OPERATIONS
} from '../../../shared/agent-runtime-contract'
import { CodexRuntimeService } from '../codex'
import { CodexThreadStore } from '../codex/codex-thread-store'
import type { AgentRuntimeAdapter, AgentRuntimeAdapterContext } from './adapter'
import { createAgentRuntimeHost } from './host'
import {
  EXECUTION_INTEGRITY_POLICY_METADATA_KEY,
  EXECUTION_INTEGRITY_POLICY_VERSION,
  EXECUTION_PUBLICATION_COMMITTED_CODE,
  EXECUTION_PUBLICATION_PENDING_CODE
} from './execution-integrity-guard'
import { createCodexAgentRuntimeAdapter } from '../codex/codex-agent-runtime-adapter'
import { AgentRuntimeTraceRecorder } from '../../services/agent-runtime-trace-service'
import { RuntimeContextStateService } from '../../services/runtime-context-state-service'
import { RuntimeContextLedgerService } from '../../services/runtime-context-ledger-service'
import { SharedMemoryService } from '../../services/shared-memory-service'
import { RuntimeGoalService } from '../../services/runtime-goal-service'
import { WorkspaceReferenceService } from '../../services/workspace-reference-service'
import type {
  PendingTurnArtifactStart,
  PendingTurnArtifactWatch,
  TurnArtifactIntent,
  TurnArtifactReplayIntent,
  TurnArtifactStart,
  TurnArtifactWatch
} from '../../services/turn-artifact-outbox'
import type { TurnArtifactIntentPublisher } from '../../services/turn-artifact-handoff-service'
import { readWorkspaceFile } from '../../services/workspace-files'
import { composerReferenceFromWorkspaceReference } from '../../../renderer/src/lib/workspace-reference-composer'
import { buildComposerFileContextPrompt } from '../../../renderer/src/lib/composer-file-references'
import { readComposerFileContextEntries } from '../../../renderer/src/lib/composer-file-context'
import {
  createSettingsMemoryActions,
  type SettingsMemoryRecord,
  type SettingsMemoryRecordUpdater
} from '../../../renderer/src/lib/settings-memory-actions'
import type { WorkspaceHostPlacement } from '../../../shared/workspace-host-state'

function visualExecutionIntent(requiresRegionRef = true): AgentRuntimeExecutionIntent {
  return {
    mode: 'execute',
    requirements: [
      { id: 'visual-look-locate', receiptKind: 'visual.look' },
      {
        id: 'visual-capture',
        receiptKind: 'visual.capture',
        ...(requiresRegionRef ? { requiresRegionRef: true } : {}),
        dependsOn: ['visual-look-locate']
      },
      {
        id: 'visual-look-final',
        receiptKind: 'visual.look',
        dependsOn: ['visual-capture']
      }
    ]
  }
}

function settings(activeAgentRuntime: AppSettingsV1['activeAgentRuntime'] = 'codex'): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    activeAgentRuntime,
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

function fakeTraceRecorder(): {
  recorder: AgentRuntimeTraceRecorder
  append: ReturnType<typeof vi.fn<(input: TraceEventInput<'agent_event'>) => Promise<TraceEvent>>>
} {
  const append = vi.fn(async (input: TraceEventInput<'agent_event'>) => input as unknown as TraceEvent)
  return {
    recorder: new AgentRuntimeTraceRecorder({
      append,
      appendMany: async (inputs) => Promise.all(inputs.map((input) => append(input))),
      sanitizeTextChunks: (chunks) => sanitizeTraceTextChunks(chunks)
    }),
    append
  }
}

function fakeTurnArtifactPublisher(
  publish: TurnArtifactIntentPublisher['publish'] = vi.fn(async () => undefined)
): TurnArtifactIntentPublisher {
  let lifecycleConsumer: ((event: import('@sciforge/domain-sdk/host').DomainMainAfterTurnEvent) => Promise<void>) | undefined
  let nextOrdinal = 1
  const deliveredLifecycle = new Set<string>()
  return {
    registerStart: vi.fn(async (draft) => {
      const ordinal = nextOrdinal++
      const issuerEpoch = 'issuer-00000000000000000000000000000000'
      const deliveryAttemptId = `delivery-attempt:${issuerEpoch}:${ordinal}:00000000000000000000000000000000`
      return Object.freeze({
        ...draft,
        issuerEpoch,
        deliveryAttemptOrdinal: ordinal,
        deliveryAttemptId,
        boundaryLeaseId: `turn-boundary:${deliveryAttemptId}`,
        key: `start:${ordinal}`,
        registeredAt: '2026-08-15T00:00:00.000Z'
      })
    }),
    bindStart: vi.fn(async () => true),
    rejectStart: vi.fn(async () => true),
    pendingStarts: vi.fn(async () => []),
    pending: vi.fn(async () => []),
    appendFilePatchReceipts: vi.fn(async () => undefined),
    publish,
    publishLifecycleSettlement: vi.fn(async (event) => {
      if (deliveredLifecycle.has(event.boundaryLeaseId)) return
      deliveredLifecycle.add(event.boundaryLeaseId)
      await lifecycleConsumer?.(event)
    }),
    attachLifecycleSettlementConsumer: (consumer) => { lifecycleConsumer = consumer },
    readDurableTurnBoundarySnapshot: vi.fn(async () => ({
      issuerEpoch: 'issuer-00000000000000000000000000000000',
      nextDeliveryAttemptOrdinal: nextOrdinal,
      retiredThroughOrdinal: 0,
      retiredOrdinalRanges: [],
      owners: []
    })),
    flushThread: vi.fn(async () => undefined)
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
      execution: runtimeId === 'sciforge' ? 'native' : 'observe'
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

type TestThreadSnapshot = Omit<AgentRuntimeThreadSnapshot, 'turns'> & {
  turns?: AgentRuntimeThreadSnapshot['turns']
  items?: import('../../../shared/agent-runtime-contract').AgentRuntimeItem[]
}

type TestAgentRuntimeAdapter = AgentRuntimeAdapter & {
  snapshot: ReturnType<typeof vi.fn<(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeThreadStatusInput
  ) => Promise<TestThreadSnapshot>>>
}

function fakeAdapter(id: AgentRuntimeId, thread: AgentRuntimeThread): TestAgentRuntimeAdapter {
  let adapter!: TestAgentRuntimeAdapter
  adapter = {
    id,
    transport: transportForRuntime(id),
    connect: vi.fn(async () => undefined),
    capabilities: vi.fn(async () => capabilities(id)),
    listThreads: vi.fn(async () => [thread]),
    startThread: vi.fn(async () => thread),
    snapshot: vi.fn(async () => ({ ...thread, latestSeq: 0, items: [] })),
    readThreadStatus: vi.fn(async (context, input): Promise<AgentRuntimeThreadStatus> => {
      const { turns: _turns, items: _items, ...status } = await adapter.snapshot(context, input)
      return status
    }),
    readThreadPage: vi.fn(async (context, input): Promise<AgentRuntimeThreadPage> => {
      const snapshot = await adapter.snapshot(context, input)
      const turns: AgentRuntimeThreadPage['turns'] = snapshot.turns ?? (snapshot.items?.length
        ? [{
            id: snapshot.latestTurnId ?? 'turn-1',
            threadId: snapshot.id,
            status: (snapshot.latestTurnStatus ?? 'completed') as AgentRuntimeThreadPage['turns'][number]['status'],
            items: snapshot.items
          }]
        : [])
      return {
        runtimeId: id,
        threadId: snapshot.id,
        latestSeq: snapshot.latestSeq,
        turns,
        nextCursor: null
      }
    }),
    readToolArtifact: vi.fn(async (_context, input) => ({ ...input, content: '' })),
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
  } satisfies TestAgentRuntimeAdapter
  return adapter
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

  it('projects bounded list summaries and keeps status polling minimal', async () => {
    const hugeText = '🧪'.repeat(100_000)
    const adapter = fakeAdapter('codex', {
      id: 'bounded-thread-0',
      runtimeId: 'codex',
      title: hugeText,
      updatedAt: '2026-08-09T00:00:00.000Z',
      preview: hugeText,
      privateTranscript: hugeText
    } as never)
    vi.mocked(adapter.listThreads).mockResolvedValue(Array.from({ length: 24 }, (_, index) => ({
      id: `bounded-thread-${index}`,
      runtimeId: 'codex' as const,
      title: hugeText,
      updatedAt: '2026-08-09T00:00:00.000Z',
      preview: hugeText,
      privateTranscript: hugeText
    } as never)))
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter]
    })

    const summaries = await host.listThreads({ runtimeId: 'codex' })
    expect(summaries).toHaveLength(24)
    for (const summary of summaries) {
      expect(Buffer.byteLength(summary.preview ?? '', 'utf8')).toBeLessThanOrEqual(4_096)
      expect(summary).not.toHaveProperty('privateTranscript')
    }
    expect(Buffer.byteLength(JSON.stringify(summaries), 'utf8')).toBeLessThan(120_000)

    const status = await host.readThreadStatus({ runtimeId: 'codex', threadId: 'bounded-thread-0' })
    expect(status).toEqual({
      id: 'bounded-thread-0',
      runtimeId: 'codex',
      latestSeq: 0
    })
    expect(status).not.toHaveProperty('title')
    expect(status).not.toHaveProperty('preview')
  })

  it('owns subagent tools and dispatches provider controls through the selected adapter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-runtime-subagents-'))
    const adapter = fakeAdapter('claude', {
      id: 'parent-thread',
      runtimeId: 'claude',
      title: 'Parent',
      updatedAt: '2026-08-02T00:00:00.000Z'
    })
    const subagents: NonNullable<AgentRuntimeAdapter['subagents']> = {
      spawn: vi.fn(async (_context, input) => {
        await input.onSpawned({ runtime: 'claude', threadId: 'child-thread', turnId: 'child-turn' })
        return {
          summary: 'child complete',
          threadRef: { runtime: 'claude', threadId: 'child-thread', turnId: 'child-turn' }
        }
      }),
      inspect: vi.fn(async () => ({ state: 'active' as const, observedAt: '2026-08-02T00:00:00.000Z' })),
      message: vi.fn(async () => ({ established: true })),
      cancel: vi.fn(async () => undefined)
    }
    adapter.subagents = subagents
    const host = createAgentRuntimeHost({
      settings: async () => settings('claude'),
      adapters: [adapter],
      subagentStoreRoot: root
    })
    const tools = host.subagentTools()
    expect(tools?.tools().map((tool) => tool.name)).toContain('delegate_task')
    const started = await tools!.call({
      name: 'delegate_task',
      arguments: { prompt: 'Run a focused review.' },
      context: {
        requestId: 'spawn-1',
        runtimeId: 'claude',
        threadId: 'parent-thread',
        turnId: 'parent-turn'
      }
    })
    const childId = (started.value as { childId: string }).childId
    await expect(tools!.call({
      name: 'subagent_wait',
      arguments: { childId, timeoutMs: 1_000 },
      context: {
        requestId: 'wait-1',
        runtimeId: 'claude',
        threadId: 'parent-thread',
        turnId: 'parent-turn'
      }
    })).resolves.toMatchObject({
      value: { status: 'completed', terminal: true }
    })
    expect(subagents.spawn).toHaveBeenCalledOnce()
    expect(adapter.publishSyntheticEvent).toHaveBeenCalledWith(
      expect.objectContaining({ settings: expect.objectContaining({ activeAgentRuntime: 'claude' }) }),
      expect.objectContaining({
        kind: 'child_event',
        runtimeId: 'claude',
        child: expect.objectContaining({ runtimeId: 'claude', summary: 'child complete' })
      })
    )
  })

  it('runs host-owned Codex delegation through the real synthetic child publisher', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-runtime-codex-delegation-'))
    evidenceQueueRoots.push(root)
    const codexStorageRoot = join(root, 'codex-runtime')
    await new CodexThreadStore({ rootDir: codexStorageRoot }).upsert({
      guiThreadId: 'parent-thread',
      codexThreadId: 'parent-thread',
      workspace: '/tmp/workspace',
      title: 'Parent',
      latestSeq: 1,
      latestTurnId: 'parent-turn'
    })
    const service = new CodexRuntimeService({
      settings: async () => settings('codex'),
      storageRoot: codexStorageRoot
    })
    const adapter = createCodexAgentRuntimeAdapter(service)
    const spawn = vi.fn<NonNullable<AgentRuntimeAdapter['subagents']>['spawn']>(async (_context, input) => {
      const threadRef = {
        runtime: 'codex',
        threadId: 'child-thread',
        turnId: 'child-turn'
      }
      await input.onSpawned(threadRef)
      return { summary: 'Codex child completed', threadRef }
    })
    adapter.subagents = {
      spawn,
      inspect: vi.fn(async () => ({ state: 'missing' as const, observedAt: '2026-08-02T00:00:00.000Z' })),
      message: vi.fn(async () => ({ established: false })),
      cancel: vi.fn(async () => undefined)
    }
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter],
      subagentStoreRoot: join(root, 'subagents')
    })
    const tools = host.subagentTools()!
    const subscriptionAbort = new AbortController()
    const subscription = host.subscribeEvents({
      runtimeId: 'codex',
      threadId: 'parent-thread',
      sinceSeq: 0,
      signal: subscriptionAbort.signal
    })[Symbol.asyncIterator]()
    const firstSubscribedEvent = subscription.next()

    const started = await tools.call({
      name: 'delegate_task',
      arguments: { prompt: 'Read one paper.' },
      context: {
        requestId: 'spawn-codex-1',
        runtimeId: 'codex',
        threadId: 'parent-thread',
        turnId: 'parent-turn'
      }
    })
    const childId = (started.value as { childId: string }).childId
    await expect(tools.call({
      name: 'subagent_wait',
      arguments: { childId, timeoutMs: 1_000 },
      context: {
        requestId: 'wait-codex-1',
        runtimeId: 'codex',
        threadId: 'parent-thread',
        turnId: 'parent-turn'
      }
    })).resolves.toMatchObject({
      value: { status: 'completed', terminal: true, summary: 'Codex child completed' }
    })

    expect(spawn).toHaveBeenCalledOnce()
    const storedEvents = await service.readStoredEvents('parent-thread')
    expect(storedEvents.filter((event) => event.child?.id === childId).map((event) => event.child?.status)).toEqual([
      'queued',
      'running',
      'running',
      'completed'
    ])
    const subscribedStatuses: string[] = []
    let subscribed = await firstSubscribedEvent
    for (let index = 0; index < 8 && !subscribed.done; index += 1) {
      if (subscribed.value.kind === 'child_event' && subscribed.value.child.id === childId) {
        subscribedStatuses.push(subscribed.value.child.status)
        if (subscribed.value.child.status === 'completed') break
      }
      subscribed = await subscription.next()
    }
    expect(subscribedStatuses).toEqual(['queued', 'running', 'running', 'completed'])
    subscriptionAbort.abort()
    host.dispose()
  })

  it('coordinates capability confirmations through neutral approval events and resolution', async () => {
    const thread = {
      id: 'codex-thread',
      runtimeId: 'codex' as const,
      title: 'Codex',
      updatedAt: '2026-07-22T00:00:00.000Z'
    }
    const adapter = fakeAdapter('codex', thread)
    adapter.snapshot = vi.fn(async () => ({
      ...thread,
      latestSeq: 0,
      latestTurnId: 'turn-1',
      latestTurnStatus: 'running',
      turns: [{ id: 'turn-1', threadId: thread.id, status: 'running', items: [] }]
    }))
    adapter.subscribeEvents = vi.fn(async function* (_context, input) {
      await new Promise<void>((resolve) => input.signal?.addEventListener('abort', () => resolve(), { once: true }))
      if (!input.signal?.aborted) {
        yield { kind: 'heartbeat', runtimeId: 'codex', threadId: input.threadId } satisfies AgentRuntimeEvent
      }
    })
    const host = createAgentRuntimeHost({ settings: async () => settings('codex'), adapters: [adapter] })
    const subscriptionAbort = new AbortController()
    const events = host.subscribeEvents({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      signal: subscriptionAbort.signal
    })[Symbol.asyncIterator]()
    const remoteScript = `echo begin\n${'x'.repeat(6_000)}`
    const decision = host.requestCapabilityApproval({
      context: {
        requestId: 'request-1',
        runtimeId: 'codex',
        threadId: 'codex-thread',
        turnId: 'turn-1',
        callId: 'call-1',
        workspaceId: '/tmp/workspace'
      },
      actionId: 'remote-ssh.command.execute',
      invocationId: 'agent_inv_abcdefghijklmnopqrstuvwxyz',
      mode: 'confirmation',
      title: 'Run remote command',
      description: 'Runs a command on a registered SSH target.',
      effect: 'external-write',
      input: {
        password: 'do-not-persist',
        privateKey: '-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----',
        script: remoteScript
      },
      resourceRef: 'res_remote_target_abcdefghijklmnop',
      resourceLabel: 'Lab A GPU 01'
    })

    const requested = await events.next()
    expect(requested.value).toMatchObject({
      kind: 'approval_requested',
      runtimeId: 'codex',
      threadId: 'codex-thread',
      turnId: 'turn-1',
      approvalId: expect.stringMatching(/^capability-approval-/u),
      toolName: 'remote-ssh.command.execute',
      meta: {
        source: 'sciforge-capability-broker',
        actionId: 'remote-ssh.command.execute',
        invocationId: 'agent_inv_abcdefghijklmnopqrstuvwxyz',
        callId: 'call-1',
        effect: 'external-write',
        approvalMode: 'confirmation',
        inputPreviewBytes: expect.any(Number),
        inputPreviewTruncated: true,
        resourceRef: 'res_remote_target_abcdefghijklmnop'
      }
    })
    const approvalSummary = String((requested.value as Extract<AgentRuntimeEvent, {
      kind: 'approval_requested'
    }>).summary)
    const inputPreview = approvalSummary.split('Requested input:\n')[1] ?? ''
    expect(Buffer.byteLength(inputPreview, 'utf8')).toBeLessThanOrEqual(4 * 1_024)
    expect(approvalSummary).toContain('echo begin')
    expect(approvalSummary).toContain('Lab A GPU 01')
    expect(approvalSummary).toContain('<redacted>')
    expect(approvalSummary).not.toContain('do-not-persist')
    expect(approvalSummary).not.toContain('abc123')
    expect((requested.value as Extract<AgentRuntimeEvent, { kind: 'approval_requested' }>).meta)
      .not.toHaveProperty('inputPreview')
    const approvalId = (requested.value as Extract<AgentRuntimeEvent, { kind: 'approval_requested' }>).approvalId
    await expect(host.readThreadSnapshot({
      runtimeId: 'codex',
      threadId: 'codex-thread'
    })).resolves.toMatchObject({
      turns: [{
        id: 'turn-1',
        items: [expect.objectContaining({
          id: approvalId,
          turnId: 'turn-1',
          kind: 'approval',
          status: 'pending',
          meta: expect.objectContaining({ approvalId })
        })]
      }]
    })
    await host.resolveApproval({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      approvalId,
      decision: 'allowed'
    })
    await expect(decision).resolves.toBe('allowed')
    await expect(events.next()).resolves.toMatchObject({
      value: { kind: 'approval_resolved', approvalId, decision: 'allowed' }
    })

    const replayAbort = new AbortController()
    const replay = host.subscribeEvents({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      signal: replayAbort.signal
    })[Symbol.asyncIterator]()
    await expect(replay.next()).resolves.toMatchObject({
      value: { kind: 'approval_requested', approvalId }
    })
    await expect(replay.next()).resolves.toMatchObject({
      value: { kind: 'approval_resolved', approvalId, decision: 'allowed' }
    })
    subscriptionAbort.abort()
    replayAbort.abort()
    await Promise.all([events.return?.(), replay.return?.()])
    host.dispose()
  })

  it('cancels pending capability confirmations on abort, terminal turns, and disposal', async () => {
    const thread = {
      id: 'claude-thread',
      runtimeId: 'claude' as const,
      title: 'Claude',
      updatedAt: '2026-07-22T00:00:00.000Z'
    }
    const adapter = fakeAdapter('claude', thread)
    adapter.subscribeEvents = vi.fn(async function* (_context, input) {
      yield {
        kind: 'turn_lifecycle',
        runtimeId: 'claude',
        threadId: 'claude-thread',
        turnId: 'turn-terminal',
        state: 'aborted'
      } satisfies AgentRuntimeEvent
      await new Promise<void>((resolve) => input.signal?.addEventListener('abort', () => resolve(), { once: true }))
    })
    const host = createAgentRuntimeHost({ settings: async () => settings('claude'), adapters: [adapter] })
    const request = (turnId: string, callId: string, signal?: AbortSignal) => host.requestCapabilityApproval({
      context: {
        requestId: callId,
        runtimeId: 'claude',
        threadId: 'claude-thread',
        turnId,
        callId
      },
      actionId: 'remote-ssh.command.execute',
      invocationId: `agent_inv_${callId.padEnd(20, 'x')}`,
      mode: 'confirmation',
      title: 'Run remote command',
      description: 'Runs a command on a registered SSH target.',
      effect: 'external-write',
      input: { script: callId }
    }, signal ? { signal } : {})

    const abort = new AbortController()
    const aborted = request('turn-abort', 'abort-call', abort.signal)
    abort.abort()
    await expect(aborted).resolves.toBe('cancelled')

    const surfaceCancelled = request('turn-surface', 'surface-call')
    expect(host.cancelCapabilityApprovalTurn({
      runtimeId: 'claude',
      threadId: 'claude-thread',
      turnId: 'turn-surface'
    }, 'user_stop')).toBe(1)
    await expect(surfaceCancelled).resolves.toBe('cancelled')

    const terminal = request('turn-terminal', 'terminal-call')
    const subscriptionAbort = new AbortController()
    const streamed: AgentRuntimeEvent[] = []
    const events = host.subscribeEvents({
      runtimeId: 'claude',
      threadId: 'claude-thread',
      signal: subscriptionAbort.signal
    })[Symbol.asyncIterator]()
    let terminalApprovalId = ''
    while (true) {
      const next = await events.next()
      if (next.done) break
      streamed.push(next.value)
      if (next.value.kind === 'approval_requested' && next.value.turnId === 'turn-terminal') {
        terminalApprovalId = next.value.approvalId
      }
      if (
        next.value.kind === 'approval_resolved'
        && terminalApprovalId
        && next.value.approvalId === terminalApprovalId
      ) break
    }
    subscriptionAbort.abort()
    await events.return?.()
    await expect(terminal).resolves.toBe('cancelled')
    expect(streamed).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'approval_resolved', approvalId: terminalApprovalId, decision: 'error' }),
      expect.objectContaining({ kind: 'turn_lifecycle', state: 'aborted' })
    ]))

    const disposed = Array.from({ length: 64 }, (_, index) => (
      request(`turn-dispose-${index}`, `dispose-call-${index}`)
    ))
    await expect(request('turn-overflow', 'overflow-call')).resolves.toBe('cancelled')
    host.dispose()
    await expect(Promise.all(disposed)).resolves.toEqual(Array.from({ length: 64 }, () => 'cancelled'))
  })

  it('returns an empty list when the active runtime is healthy and an inactive runtime is unavailable', async () => {
    const thread = {
      id: 'unused-thread',
      runtimeId: 'codex' as const,
      title: 'Unused',
      updatedAt: '2026-06-10T00:00:00.000Z'
    }
    const local = fakeAdapter('sciforge', { ...thread, runtimeId: 'sciforge' })
    const codex = fakeAdapter('codex', thread)
    vi.mocked(local.listThreads).mockRejectedValue(new Error('inactive local runtime unavailable'))
    vi.mocked(codex.listThreads).mockResolvedValue([])
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [local, codex]
    })

    await expect(host.listThreads()).resolves.toEqual([])
  })

  it('surfaces the active runtime failure when every runtime returns no threads', async () => {
    const thread = {
      id: 'unused-thread',
      runtimeId: 'codex' as const,
      title: 'Unused',
      updatedAt: '2026-06-10T00:00:00.000Z'
    }
    const local = fakeAdapter('sciforge', { ...thread, runtimeId: 'sciforge' })
    const codex = fakeAdapter('codex', thread)
    vi.mocked(local.listThreads).mockResolvedValue([])
    vi.mocked(codex.listThreads).mockRejectedValue(new Error('active codex runtime unavailable'))
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [local, codex]
    })

    await expect(host.listThreads()).rejects.toThrow('active codex runtime unavailable')
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
    await expect(host.usage({ groupBy: 'thread' } as never)).rejects.toThrow('runtimeId is required')
    await expect(host.readThreadSnapshot({ threadId: 'codex-thread' } as never)).rejects.toThrow(
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

    expect(codex.snapshot).not.toHaveBeenCalled()
    expect(codex.usage).not.toHaveBeenCalled()
    expect(codex.startTurn).not.toHaveBeenCalled()
    expect(codex.renameThread).not.toHaveBeenCalled()
    expect(codex.subscribeEvents).not.toHaveBeenCalled()
  })

  it('coalesces concurrent reads of the same runtime thread', async () => {
    const thread = {
      id: 'codex-thread',
      runtimeId: 'codex' as const,
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    }
    const adapter = fakeAdapter('codex', thread)
    const readResolvers: Array<(detail: TestThreadSnapshot) => void> = []
    vi.mocked(adapter.snapshot).mockImplementation(() => new Promise<TestThreadSnapshot>((resolve) => {
      readResolvers.push(resolve)
    }))
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter]
    })

    const first = host.readThreadStatus({ runtimeId: 'codex', threadId: 'codex-thread' })
    const second = host.readThreadStatus({ runtimeId: 'codex', threadId: 'codex-thread' })
    await vi.waitFor(() => expect(adapter.snapshot).toHaveBeenCalledTimes(1))

    readResolvers.shift()?.({ ...thread, latestSeq: 0, items: [] })
    await expect(Promise.all([first, second])).resolves.toEqual([
      { id: 'codex-thread', runtimeId: 'codex', latestSeq: 0 },
      { id: 'codex-thread', runtimeId: 'codex', latestSeq: 0 }
    ])

    const third = host.readThreadStatus({ runtimeId: 'codex', threadId: 'codex-thread' })
    await vi.waitFor(() => expect(adapter.snapshot).toHaveBeenCalledTimes(2))
    readResolvers.shift()?.({ ...thread, latestSeq: 0, items: [] })
    await expect(third).resolves.toMatchObject({ id: 'codex-thread' })
  })

  it('coalesces and briefly caches child-agent tree reads', async () => {
    const thread = {
      id: 'codex-thread',
      runtimeId: 'codex' as const,
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    }
    const adapter = fakeAdapter('codex', thread)
    const resolvers: Array<(value: unknown) => void> = []
    const auxiliary = vi.fn(() => new Promise<unknown>((resolve) => {
      resolvers.push(resolve)
    }))
    adapter.auxiliary = auxiliary
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter]
    })
    const input = {
      runtimeId: 'codex' as const,
      operation: 'listThreadChildren' as const,
      payload: { threadId: 'codex-thread', limit: 80 }
    }

    const first = host.auxiliary(input)
    const second = host.auxiliary(input)
    await vi.waitFor(() => expect(auxiliary).toHaveBeenCalledTimes(1))

    const response = { children: [], degraded: false }
    resolvers.shift()?.(response)
    await expect(Promise.all([first, second])).resolves.toEqual([response, response])
    await expect(host.auxiliary(input)).resolves.toBe(response)
    expect(auxiliary).toHaveBeenCalledTimes(1)
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
    await expect(host.readThreadSnapshot({ runtimeId: 'codex', threadId: 'codex-thread' })).resolves.toMatchObject({
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

  it('atomically binds every user turn and injects a bounded left-center-right component catalog', async () => {
    const adapter = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const snapshot = {
      schemaVersion: 3,
      windowId: 'main-window',
      revision: 12,
      publishedAt: '2026-07-04T00:00:00.000Z',
      freshness: { stale: false, ageMs: 0, staleAfterMs: 5_000 },
      activeThreadId: 'codex-thread',
      workspaceRoot: '/tmp/workspace',
      route: 'chat',
      components: [
        {
          id: 'left-sidebar.sessions',
          region: 'left-sidebar',
          component: 'session-list',
          title: 'Sessions',
          visible: true,
          updatedAt: '2026-07-04T00:00:00.000Z',
          summary: 'The current workspace session list.',
          state: { selectedThreadId: 'codex-thread', count: 4, nested: { filter: 'local', ignored: { deep: true } } },
          resources: []
        },
        {
          id: 'center.conversation',
          region: 'center',
          component: 'conversation',
          title: 'Codex',
          visible: true,
          updatedAt: '2026-07-04T00:00:00.000Z',
          summary: 'The active agent conversation.',
          state: { running: false, messageCount: 9 },
          resources: [{
            kind: 'conversation',
            capability: { resourceRef: 'res_centerabcdefghijklmnopqrstuvwxyz', operations: [] }
          }]
        },
        {
          id: 'right-sidebar.file-preview',
          region: 'right-sidebar',
          component: 'workspace-preview',
          title: 'paper.pdf',
          visible: true,
          updatedAt: '2026-07-04T00:00:00.000Z',
          summary: 'Previewing the bound paper.',
          state: {
            presentation: {
              kind: 'document',
              position: { index: 3, count: 42 },
              visibleContent: { kind: 'text', text: 'VOYAGER current page excerpt' }
            }
          },
          resources: [{
            kind: 'workspaceFile',
            role: 'preview-target',
            capability: { resourceRef: 'res_rightabcdefghijklmnopqrstuvwxyz', operations: [] }
          }]
        }
      ]
    }
    const visibleContext = {
      bindSurface: vi.fn(async () => snapshot)
    }
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter],
      services: { visibleContext: visibleContext as never }
    })
    const userText = 'Run the unit tests.'

    await host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-side-thread',
      visibleContextOwnerThreadId: 'codex-thread',
      visibleContextSurfaceId: 'browser:1',
      text: userText,
      displayText: userText
    })

    const dispatched = vi.mocked(adapter.startTurn).mock.calls[0]?.[1]
    expect(visibleContext.bindSurface).toHaveBeenCalledWith(
      'codex:codex-side-thread',
      'codex-thread',
      'browser:1'
    )
    expect(dispatched?.text).toContain('Canonical visible state bound atomically for this turn:')
    expect(dispatched?.text).toContain('"region": "left-sidebar"')
    expect(dispatched?.text).toContain('"region": "center"')
    expect(dispatched?.text).toContain('"region": "right-sidebar"')
    expect(dispatched?.text).toContain('"selectedThreadId": "codex-thread"')
    expect(dispatched?.text).toContain('"resourceRef": [')
    expect(dispatched?.text).toContain('sciforge_observe')
    expect(dispatched?.text).toContain('sciforge_invoke')
    expect(dispatched?.text).toContain('res_centerabcdefghijklmnopqrstuvwxyz')
    expect(dispatched?.text).toContain('res_rightabcdefghijklmnopqrstuvwxyz')
    expect(dispatched?.text).toContain('VOYAGER current page excerpt')
    expect(dispatched?.text).toContain('"index": 3')
    expect(dispatched?.text).toContain(userText)
    expect(dispatched?.displayText).toBe(userText)
  })

  it('claims the prepared question-time surface instead of rebinding the later UI surface', async () => {
    const adapter = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const questionTimeSnapshot = {
      schemaVersion: 3 as const,
      windowId: 'browser:1',
      revision: 7,
      publishedAt: '2026-07-31T00:00:00.000Z',
      freshness: { stale: false, ageMs: 0, staleAfterMs: 5_000 },
      activeThreadId: 'codex-thread',
      route: '/question-time',
      components: []
    }
    const visibleContext = {
      boundSurface: vi.fn(() => null),
      claimSurfaceBinding: vi.fn(() => questionTimeSnapshot),
      bindSurface: vi.fn()
    }
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter],
      services: { visibleContext: visibleContext as never }
    })

    await host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'Inspect the paper I was viewing.',
      visibleContextSurfaceId: 'browser:1',
      visibleContextBindingId: 'bound_surface_question_time'
    })

    expect(visibleContext.claimSurfaceBinding).toHaveBeenCalledWith(
      'codex:codex-thread',
      'bound_surface_question_time'
    )
    expect(visibleContext.bindSurface).not.toHaveBeenCalled()
    expect(vi.mocked(adapter.startTurn).mock.calls[0]?.[1].text).toContain('/question-time')
    expect(vi.mocked(adapter.startTurn).mock.calls[0]?.[1]).not.toHaveProperty('visibleContextBindingId')
  })

  it('does not fall back to newer UI state when submission-time binding was unavailable', async () => {
    const adapter = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const visibleContext = {
      boundSurface: vi.fn(() => null),
      bindSurface: vi.fn()
    }
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter],
      services: { visibleContext: visibleContext as never }
    })

    await host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'Inspect what I submitted.',
      visibleContextSurfaceId: 'browser:1',
      visibleContextBindingAttempted: true
    })

    expect(visibleContext.bindSurface).not.toHaveBeenCalled()
    expect(vi.mocked(adapter.startTurn).mock.calls[0]?.[1].text)
      .toContain('Canonical visible state for this turn: unavailable.')
  })

  it('fails closed when canonical visible state cannot be bound', async () => {
    const adapter = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const visibleContext = {
      bindSurface: vi.fn(async () => { throw new Error('renderer unavailable') }),
      get: vi.fn(),
      peek: vi.fn()
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
      displayText: 'Run the unit tests.',
      executionIntent: {
        mode: 'execute',
        requirements: [{ effectClass: 'command_execution' }]
      }
    })

    const dispatched = vi.mocked(adapter.startTurn).mock.calls[0]?.[1]
    expect(visibleContext.bindSurface).not.toHaveBeenCalled()
    expect(visibleContext.get).not.toHaveBeenCalled()
    expect(visibleContext.peek).not.toHaveBeenCalled()
    expect(dispatched?.text).toContain('Canonical visible state for this turn: unavailable.')
    expect(dispatched?.text).toContain('Do not guess from file paths, mtimes, recent files, workspace scans')
    expect(dispatched?.text).not.toContain('surface.current')
    expect(dispatched?.text).toContain('Runtime-enforced execution integrity gate')
    expect(dispatched?.displayText).toBe('Run the unit tests.')
  })

  it('binds concurrent same-thread starts to their immutable sender surfaces inside the turn queue', async () => {
    const adapter = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const firstHandle = deferred<AgentRuntimeTurnHandle>()
    vi.mocked(adapter.startTurn)
      .mockReturnValueOnce(firstHandle.promise)
      .mockResolvedValueOnce({ threadId: 'codex-thread', turnId: 'turn-2' })
    const visibleContext = {
      bindSurface: vi.fn(async (
        _callerId: string,
        activeThreadId: string,
        windowId: string
      ) => ({
        schemaVersion: 3 as const,
        windowId,
        revision: 1,
        publishedAt: '2026-07-31T00:00:00.000Z',
        freshness: { stale: false, ageMs: 0, staleAfterMs: 5_000 },
        activeThreadId,
        route: `/${windowId}`,
        components: []
      }))
    }
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter],
      services: { visibleContext: visibleContext as never }
    })

    const browserStart = host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'from browser',
      visibleContextSurfaceId: 'browser:1'
    })
    const electronStart = host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'from electron',
      visibleContextSurfaceId: 'electron:9'
    })
    await vi.waitFor(() => {
      expect(visibleContext.bindSurface).toHaveBeenCalledTimes(1)
      expect(adapter.startTurn).toHaveBeenCalledTimes(1)
    })
    expect(visibleContext.bindSurface).toHaveBeenNthCalledWith(
      1,
      'codex:codex-thread',
      'codex-thread',
      'browser:1'
    )

    firstHandle.resolve({ threadId: 'codex-thread', turnId: 'turn-1' })
    await expect(browserStart).resolves.toEqual({
      threadId: 'codex-thread',
      turnId: 'turn-1'
    })
    await expect(electronStart).resolves.toEqual({
      threadId: 'codex-thread',
      turnId: 'turn-2'
    })

    expect(visibleContext.bindSurface).toHaveBeenNthCalledWith(
      2,
      'codex:codex-thread',
      'codex-thread',
      'electron:9'
    )
    const firstInput = vi.mocked(adapter.startTurn).mock.calls[0]?.[1]
    const secondInput = vi.mocked(adapter.startTurn).mock.calls[1]?.[1]
    expect(firstInput?.text).toContain('"route": "/browser:1"')
    expect(secondInput?.text).toContain('"route": "/electron:9"')
    expect(firstInput).not.toHaveProperty('visibleContextSurfaceId')
    expect(secondInput).not.toHaveProperty('visibleContextSurfaceId')
  })

  it.each(['sciforge', 'codex', 'claude'] as const)(
    'enforces verified visual execution before %s can complete',
    async (runtimeId) => {
      const threadId = `${runtimeId}-thread`
      const turnId = `${runtimeId}-turn`
      const adapter = fakeAdapter(runtimeId, {
        id: threadId,
        runtimeId,
        title: runtimeId,
        updatedAt: '2026-07-13T00:00:00.000Z'
      })
      adapter.subscribeEvents = vi.fn(async function* () {
        yield {
          kind: 'assistant_delta',
          runtimeId,
          threadId,
          turnId,
          itemId: 'unverified-answer',
          text: '已完成并保存了准确裁剪的图片。'
        } satisfies AgentRuntimeEvent
        yield {
          kind: 'turn_lifecycle',
          runtimeId,
          threadId,
          turnId,
          state: 'completed'
        } satisfies AgentRuntimeEvent
        yield {
          kind: 'assistant_delta',
          runtimeId,
          threadId,
          turnId,
          itemId: 'late-unverified-answer',
          text: '这条终态后的成功消息也不应显示。'
        } satisfies AgentRuntimeEvent
      })
      adapter.snapshot = vi.fn(async () => ({
        id: threadId,
        runtimeId,
        title: runtimeId,
        updatedAt: '2026-07-13T00:00:00.000Z',
        latestTurnId: turnId,
        latestTurnStatus: 'completed',
        latestSeq: 1,
        turns: [{
          id: turnId,
          threadId,
          status: 'completed',
          items: [{
            id: 'unverified-answer',
            turnId,
            kind: 'assistant_message',
            text: '已完成并保存了准确裁剪的图片。'
          }]
        }],
        items: [{
          id: 'unverified-answer',
          turnId,
          kind: 'assistant_message',
          text: '已完成并保存了准确裁剪的图片。'
        }]
      } satisfies TestThreadSnapshot))
      const host = createAgentRuntimeHost({
        settings: async () => settings(runtimeId),
        adapters: [adapter]
      })
      const text = '按照任务模板生成报告。'

      await host.startTurn({
        runtimeId,
        threadId,
        text,
        displayText: text,
        executionIntent: visualExecutionIntent()
      })
      const events: AgentRuntimeEvent[] = []
      for await (const event of host.subscribeEvents({ runtimeId, threadId })) events.push(event)
      const replayedEvents: AgentRuntimeEvent[] = []
      for await (const event of host.subscribeEvents({ runtimeId, threadId })) {
        replayedEvents.push(event)
      }

      expect(adapter.startTurn).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          text: expect.stringContaining('Runtime-enforced visual completion gate'),
          displayText: text,
          executionIntent: visualExecutionIntent()
        })
      )
      expect(events).toContainEqual(expect.objectContaining({
        kind: 'turn_lifecycle',
        state: 'failed',
        message: expect.stringContaining('verified visual inspection did not execute')
      }))
      expect(events.some((event) => event.kind === 'assistant_delta')).toBe(false)
      expect(replayedEvents.some((event) => event.kind === 'assistant_delta')).toBe(false)
      expect(replayedEvents).toContainEqual(expect.objectContaining({
        kind: 'turn_lifecycle',
        state: 'failed'
      }))
      expect(adapter.publishSyntheticEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          kind: 'error',
          code: 'runtime_visual_execution_missing',
          threadId,
          turnId
        })
      )
      await expect(host.readThreadSnapshot({ runtimeId, threadId })).resolves.toMatchObject({
        latestTurnStatus: 'failed',
        turns: [{ id: turnId, status: 'failed', items: [] }]
      })
    }
  )

  it('filters persisted rejected and terminal-late assistant answers when a thread is refreshed', async () => {
    const threadId = 'codex-thread'
    const rejectedTurnId = 'turn-rejected'
    const lateTurnId = 'turn-late'
    const rejectedAnswer = {
      id: 'rejected-answer',
      turnId: rejectedTurnId,
      kind: 'assistant_message' as const,
      text: 'Unverified answer'
    }
    const violation = {
      id: 'visual-violation',
      turnId: rejectedTurnId,
      kind: 'system' as const,
      text: 'Visual execution missing',
      meta: { code: 'runtime_visual_execution_missing' }
    }
    const lateAnswer = {
      id: 'late-answer',
      turnId: lateTurnId,
      kind: 'assistant_message' as const,
      text: 'Published after terminal',
      createdAt: '2026-07-13T00:00:02.000Z'
    }
    const adapter = fakeAdapter('codex', {
      id: threadId,
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-07-13T00:00:02.000Z'
    })
    adapter.snapshot = vi.fn(async () => ({
      id: threadId,
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-07-13T00:00:02.000Z',
      latestSeq: 4,
      latestTurnId: lateTurnId,
      latestTurnStatus: 'completed',
      turns: [
        {
          id: rejectedTurnId,
          threadId,
          status: 'completed',
          items: [rejectedAnswer, violation]
        },
        {
          id: lateTurnId,
          threadId,
          status: 'completed',
          completedAt: '2026-07-13T00:00:01.000Z',
          items: [lateAnswer]
        }
      ],
      items: [rejectedAnswer, violation, lateAnswer]
    } satisfies TestThreadSnapshot))
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter]
    })

    await expect(host.readThreadSnapshot({ runtimeId: 'codex', threadId })).resolves.toMatchObject({
      turns: [
        { id: rejectedTurnId, status: 'failed', items: [violation] },
        { id: lateTurnId, status: 'completed', items: [] }
      ]
    })
  })

  it('fails closed on a raw completed snapshot until its durable publication commit exists', async () => {
    const threadId = 'codex-thread'
    const turnId = 'turn-validated'
    const user = {
      id: 'user',
      turnId,
      kind: 'user_message' as const,
      text: 'Inspect the figure',
      meta: {
        [EXECUTION_INTEGRITY_POLICY_METADATA_KEY]: EXECUTION_INTEGRITY_POLICY_VERSION
      },
      createdAt: '2026-07-13T00:00:00.000Z'
    }
    const answer = {
      id: 'answer',
      turnId,
      kind: 'assistant_message' as const,
      text: 'Verified answer',
      createdAt: '2026-07-13T00:00:01.000Z'
    }
    const commit = {
      id: 'publication-commit',
      turnId,
      kind: 'system' as const,
      text: 'Publication committed',
      meta: { code: EXECUTION_PUBLICATION_COMMITTED_CODE },
      createdAt: '2026-07-13T00:00:02.000Z'
    }
    const lateAnswer = {
      id: 'late-answer',
      turnId,
      kind: 'assistant_message' as const,
      text: 'Late answer',
      createdAt: '2026-07-13T00:00:03.000Z'
    }
    let committed = false
    const adapter = fakeAdapter('codex', {
      id: threadId,
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-07-13T00:00:03.000Z'
    })
    adapter.snapshot = vi.fn(async () => {
      const items = committed
        ? [user, answer, commit, lateAnswer]
        : [user, answer]
      return {
        id: threadId,
        runtimeId: 'codex',
        title: 'Codex',
        updatedAt: '2026-07-13T00:00:03.000Z',
        latestSeq: items.length,
        latestTurnId: turnId,
        latestTurnStatus: 'completed',
        turns: [{ id: turnId, threadId, status: 'completed', items }],
        items
      } satisfies TestThreadSnapshot
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter]
    })

    await expect(host.readThreadSnapshot({ runtimeId: 'codex', threadId })).resolves.toMatchObject({
      latestTurnStatus: 'failed',
      turns: [{ id: turnId, status: 'failed', items: [user] }]
    })

    committed = true
    await expect(host.readThreadSnapshot({ runtimeId: 'codex', threadId })).resolves.toMatchObject({
      latestTurnStatus: 'completed',
      turns: [{ id: turnId, status: 'completed', items: [user, answer] }]
    })
  })

  it('uses a durable pending marker when a native visual plan is declared after turn start', async () => {
    const threadId = 'codex-thread'
    const turnId = 'turn-native-visual'
    const pending = {
      id: 'publication-pending',
      turnId,
      kind: 'system' as const,
      text: 'Publication pending',
      meta: { code: EXECUTION_PUBLICATION_PENDING_CODE },
      createdAt: '2026-07-13T00:00:00.000Z'
    }
    const answer = {
      id: 'answer',
      turnId,
      kind: 'assistant_message' as const,
      text: 'Unverified visual answer',
      createdAt: '2026-07-13T00:00:01.000Z'
    }
    const adapter = fakeAdapter('codex', {
      id: threadId,
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-07-13T00:00:01.000Z'
    })
    adapter.snapshot = vi.fn(async () => ({
      id: threadId,
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-07-13T00:00:01.000Z',
      latestSeq: 2,
      latestTurnId: turnId,
      latestTurnStatus: 'completed',
      turns: [{ id: turnId, threadId, status: 'completed', items: [pending, answer] }],
      items: [pending, answer]
    } satisfies TestThreadSnapshot))
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter]
    })

    await expect(host.readThreadSnapshot({ runtimeId: 'codex', threadId })).resolves.toMatchObject({
      latestTurnStatus: 'failed',
      turns: [{ id: turnId, status: 'failed', items: [] }]
    })
  })

  it('hides an adapter-persisted assistant candidate while its turn is still active', async () => {
    const threadId = 'codex-thread'
    const turnId = 'turn-running'
    const adapter = fakeAdapter('codex', {
      id: threadId,
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-07-13T00:00:00.000Z'
    })
    adapter.snapshot = vi.fn(async () => ({
      id: threadId,
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-07-13T00:00:00.000Z',
      latestSeq: 1,
      latestTurnId: turnId,
      latestTurnStatus: 'running',
      turns: [{
        id: turnId,
        threadId,
        status: 'running',
        items: [{
          id: 'candidate',
          turnId,
          kind: 'assistant_message',
          text: 'Not committed yet'
        }]
      }],
      items: [{
        id: 'candidate',
        turnId,
        kind: 'assistant_message',
        text: 'Not committed yet'
      }]
    } satisfies TestThreadSnapshot))
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter]
    })

    await expect(host.readThreadSnapshot({ runtimeId: 'codex', threadId })).resolves.toMatchObject({
      turns: [{ id: turnId, status: 'running', items: [] }]
    })
  })

  it.each(['sciforge', 'codex', 'claude'] as const)(
    'enforces executor receipts before explicit %s execution can complete',
    async (runtimeId) => {
      const threadId = `${runtimeId}-receipt-thread`
      const turnId = `${runtimeId}-turn`
      const adapter = fakeAdapter(runtimeId, {
        id: threadId,
        runtimeId,
        title: runtimeId,
        updatedAt: '2026-07-13T00:00:00.000Z'
      })
      adapter.subscribeEvents = vi.fn(async function* () {
        yield {
          kind: 'turn_lifecycle',
          runtimeId,
          threadId,
          turnId,
          state: 'completed'
        } satisfies AgentRuntimeEvent
      })
      const host = createAgentRuntimeHost({
        settings: async () => settings(runtimeId),
        adapters: [adapter]
      })

      await host.startTurn({
        runtimeId,
        threadId,
        text: 'Run the unit tests.',
        executionIntent: {
          mode: 'execute',
          requirements: [{ effectClass: 'command_execution' }]
        }
      })
      const events: AgentRuntimeEvent[] = []
      for await (const event of host.subscribeEvents({ runtimeId, threadId })) events.push(event)

      expect(events.at(-1)).toMatchObject({ kind: 'turn_lifecycle', state: 'failed' })
      expect(adapter.publishSyntheticEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ code: 'runtime_execution_incomplete', threadId, turnId })
      )
    }
  )

  it.each(['sciforge', 'codex', 'claude'] as const)(
    'publishes the verified %s visual answer only after the native receipt chain',
    async (runtimeId) => {
      const threadId = `${runtimeId}-visual-success-thread`
      const turnId = `${runtimeId}-visual-success-turn`
      const snapshotRef = 'snapshot_aaaaaaaaaaaaaaaaaaaa'
      const finalSnapshotRef = 'snapshot_bbbbbbbbbbbbbbbbbbbb'
      const regionRef = 'region_aaaaaaaaaaaaaaaaaaaa'
      const artifactRef = 'artifact_aaaaaaaaaaaaaaaaaaaa'
      const locateProofRef = 'visual_proof_aaaaaaaaaaaaaaaaaaaa'
      const captureProofRef = 'visual_proof_bbbbbbbbbbbbbbbbbbbb'
      const finalProofRef = 'visual_proof_cccccccccccccccccccc'
      const createdAt = '2026-07-13T00:00:00.000Z'
      const adapter = fakeAdapter(runtimeId, {
        id: threadId,
        runtimeId,
        title: runtimeId,
        updatedAt: createdAt
      })
      adapter.updateTurnGovernanceSnapshot = vi.fn(async () => undefined)
      vi.mocked(adapter.startTurn).mockResolvedValue({ threadId, turnId })
      adapter.subscribeEvents = vi.fn(async function* () {
        yield {
          kind: 'tool_event',
          runtimeId,
          threadId,
          turnId,
          itemId: 'look-locate',
          seq: 1,
          callId: 'look-locate',
          toolName: 'sciforge_look',
          status: 'success',
          receipt: createExecutionReceipt({ status: 'success' }),
          phase: 'succeeded',
          factSource: 'executor_result',
          evidenceStrength: 'executor_receipt',
          effects: ['read'],
          meta: { arguments: { intent: 'locate', capture: 'region' } },
          completionReceipts: [{
            contractVersion: 'completion-receipt.v1',
            receiptId: locateProofRef,
            kind: 'visual.look',
            status: 'satisfied',
            issuer: 'sciforge.agent-visual',
            callId: 'look-locate',
            subjectRef: snapshotRef,
            relatedRefs: [snapshotRef, regionRef],
            attestation: `sha256:${'a'.repeat(64)}`,
            createdAt
          }]
        } satisfies AgentRuntimeEvent
        yield {
          kind: 'tool_event',
          runtimeId,
          threadId,
          turnId,
          itemId: 'capture-region',
          seq: 2,
          callId: 'capture-region',
          toolName: 'sciforge_capture',
          status: 'success',
          receipt: createExecutionReceipt({ status: 'success' }),
          phase: 'succeeded',
          factSource: 'executor_result',
          evidenceStrength: 'executor_receipt',
          effects: ['local_write'],
          completionReceipts: [{
            contractVersion: 'completion-receipt.v1',
            receiptId: captureProofRef,
            kind: 'visual.capture',
            status: 'satisfied',
            issuer: 'sciforge.agent-visual',
            callId: 'capture-region',
            subjectRef: artifactRef,
            relatedRefs: [artifactRef, regionRef],
            parentReceiptIds: [locateProofRef],
            sha256: 'b'.repeat(64),
            createdAt
          }]
        } satisfies AgentRuntimeEvent
        yield {
          kind: 'tool_event',
          runtimeId,
          threadId,
          turnId,
          itemId: 'look-final',
          seq: 3,
          callId: 'look-final',
          toolName: 'sciforge_look',
          status: 'success',
          receipt: createExecutionReceipt({ status: 'success' }),
          phase: 'succeeded',
          factSource: 'executor_result',
          evidenceStrength: 'executor_receipt',
          effects: ['read'],
          completionReceipts: [{
            contractVersion: 'completion-receipt.v1',
            receiptId: finalProofRef,
            kind: 'visual.look',
            status: 'satisfied',
            issuer: 'sciforge.agent-visual',
            callId: 'look-final',
            subjectRef: artifactRef,
            relatedRefs: [finalSnapshotRef],
            parentReceiptIds: [captureProofRef],
            attestation: `sha256:${'c'.repeat(64)}`,
            createdAt
          }]
        } satisfies AgentRuntimeEvent
        yield {
          kind: 'assistant_delta',
          runtimeId,
          threadId,
          turnId,
          itemId: 'verified-answer',
          seq: 4,
          text: '已准确裁剪并复核方法总览图。'
        } satisfies AgentRuntimeEvent
        yield {
          kind: 'usage',
          runtimeId,
          threadId,
          turnId,
          seq: 5,
          usage: {
            inputTokens: 10,
            outputTokens: 6,
            totalTokens: 16
          }
        } satisfies AgentRuntimeEvent
        yield {
          kind: 'turn_lifecycle',
          runtimeId,
          threadId,
          turnId,
          seq: 6,
          state: 'completed'
        } satisfies AgentRuntimeEvent
      })
      const host = createAgentRuntimeHost({
        settings: async () => settings(runtimeId),
        adapters: [adapter]
      })
      const text = '准确截取论文中的方法总览图。'

      await host.startTurn({
        runtimeId,
        threadId,
        text,
        displayText: text
      })
      const events: AgentRuntimeEvent[] = []
      for await (const event of host.subscribeEvents({ runtimeId, threadId })) events.push(event)

      expect(events.map((event) => event.kind)).toEqual([
        'tool_event',
        'tool_event',
        'tool_event',
        'usage',
        'assistant_delta',
        'turn_lifecycle'
      ])
      expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 5, undefined, 6])
      expect(events.filter((event) => (
        event.kind === 'assistant_delta' && event.itemId === 'verified-answer'
      ))).toHaveLength(1)
      expect(adapter.publishSyntheticEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          code: EXECUTION_PUBLICATION_PENDING_CODE,
          severity: 'info',
          threadId,
          turnId
        })
      )
      expect(adapter.publishSyntheticEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          code: EXECUTION_PUBLICATION_COMMITTED_CODE,
          severity: 'info',
          threadId,
          turnId
        })
      )
      expect(adapter.updateTurnGovernanceSnapshot).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          runtimeId,
          threadId,
          turnId,
          snapshot: expect.objectContaining({
            nativeVisualProofChainPending: true
          })
        })
      )
      expect(adapter.updateTurnGovernanceSnapshot).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({
          snapshot: expect.objectContaining({
            nativeVisualProofChainPending: false
          })
        })
      )
      expect(events.at(-1)).toMatchObject({ kind: 'turn_lifecycle', state: 'completed' })
    }
  )

  it.each(['sciforge', 'codex', 'claude'] as const)(
    'accepts correlated %s executor receipts',
    async (runtimeId) => {
      const threadId = `${runtimeId}-receipt-ok-thread`
      const turnId = `${runtimeId}-turn`
      const adapter = fakeAdapter(runtimeId, {
        id: threadId,
        runtimeId,
        title: runtimeId,
        updatedAt: '2026-07-13T00:00:00.000Z'
      })
      adapter.subscribeEvents = vi.fn(async function* () {
        yield {
          kind: 'tool_event',
          runtimeId,
          threadId,
          turnId,
          itemId: 'call-1',
          callId: 'call-1',
          toolName: 'local_shell',
          toolKind: 'command_execution',
          status: 'running',
          phase: 'requested',
          factSource: 'model_output',
          evidenceStrength: 'intent'
        } satisfies AgentRuntimeEvent
        yield {
          kind: 'tool_event',
          runtimeId,
          threadId,
          turnId,
          itemId: 'call-1-result',
          callId: 'call-1',
          toolName: 'local_shell',
          toolKind: 'command_execution',
          status: 'success',
          receipt: createExecutionReceipt({ status: 'success' }),
          phase: 'succeeded',
          factSource: 'executor_result',
          evidenceStrength: 'executor_receipt'
        } satisfies AgentRuntimeEvent
        yield {
          kind: 'turn_lifecycle',
          runtimeId,
          threadId,
          turnId,
          state: 'completed'
        } satisfies AgentRuntimeEvent
      })
      const host = createAgentRuntimeHost({
        settings: async () => settings(runtimeId),
        adapters: [adapter]
      })

      await host.startTurn({
        runtimeId,
        threadId,
        text: 'Run the unit tests.',
        executionIntent: {
          mode: 'execute',
          requirements: [{ effectClass: 'command_execution' }]
        }
      })
      const events: AgentRuntimeEvent[] = []
      for await (const event of host.subscribeEvents({ runtimeId, threadId })) events.push(event)

      expect(events.at(-1)).toMatchObject({ kind: 'turn_lifecycle', state: 'completed' })
      expect(adapter.publishSyntheticEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          kind: 'error',
          code: EXECUTION_PUBLICATION_COMMITTED_CODE,
          severity: 'info',
          threadId,
          turnId
        })
      )
    }
  )

  it.each(['sciforge', 'codex', 'claude'] as const)(
    'does not retroactively reject unmarked stored %s thread detail',
    async (runtimeId) => {
      const threadId = `${runtimeId}-stored-thread`
      const turnId = `${runtimeId}-stored-turn`
      const adapter = fakeAdapter(runtimeId, {
        id: threadId,
        runtimeId,
        title: runtimeId,
        updatedAt: '2026-07-13T00:00:00.000Z'
      })
      adapter.snapshot = vi.fn(async () => ({
        id: threadId,
        runtimeId,
        title: runtimeId,
        updatedAt: '2026-07-13T00:00:00.000Z',
        latestTurnId: turnId,
        latestTurnStatus: 'completed',
        latestSeq: 3,
        turns: [{
          id: turnId,
          threadId,
          status: 'completed',
          items: [{
            id: 'stored-user-message',
            turnId,
            kind: 'user_message',
            text: '需要用视觉能力看一下排版后的表格图像，优化排版。'
          }]
        }],
        items: []
      } satisfies TestThreadSnapshot))
      const host = createAgentRuntimeHost({
        settings: async () => settings(runtimeId),
        adapters: [adapter]
      })

      await expect(host.readThreadSnapshot({ runtimeId, threadId })).resolves.toMatchObject({
        latestTurnStatus: 'completed',
        turns: [{ id: turnId, status: 'completed' }]
      })
    }
  )

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
    const { recorder: trace } = fakeTraceRecorder()
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter],
      services: {
        contextState,
        trace
      }
    })

    await expect(host.capabilities('codex')).resolves.toMatchObject({
      observability: {
        fullTrace: { available: true, durable: true }
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

    expect((await host.capabilities('codex')).capabilityDescriptors).toContainEqual(
      expect.objectContaining({ id: 'fullTrace.agentEvents', available: true })
    )
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
    vi.mocked(codex.snapshot).mockResolvedValue({
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
    await contextLedger.acceptDirective({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      id: 'directive-source-task',
      text: 'Preserve the source task requirements across runtime handoff.'
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [codex, claude],
      services: { contextLedger }
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
    expect(startTurnInput?.text).toContain('Preserve the source task requirements across runtime handoff.')
    expect(startTurnInput?.text).toContain('"schema": "sciforge.runtime_handoff.v1"')
    expect(startTurnInput?.text).toContain('"objective": "handoff across runtimes"')
    expect(startTurnInput?.text).toContain('"schema": "sciforge.runtime_handoff_transcript.v1"')
    expect(startTurnInput?.text).toContain('Original research question: analyze AI Scientist survey')
    expect(startTurnInput?.text).toContain('wet-lab closed-loop agents and experiment protocol automation')
    expect(startTurnInput?.text).toContain('Current user request:\nPlease continue from here')
    expect(startTurnInput?.metadata).toMatchObject({
      schemaVersion: 'sciforge.trace.correlation.v1',
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

  it('records durable normalized Agent events without changing yielded events', async () => {
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
    const { recorder: trace, append } = fakeTraceRecorder()
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter],
      services: { trace }
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
    expect(append).toHaveBeenCalledTimes(2)
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      source: 'agent-runtime',
      kind: 'agent_event',
      runtimeId: 'codex',
      threadId: 'codex-thread',
      turnId: 'codex-turn',
      payload: {
        eventKind: 'assistant',
        event: expect.objectContaining({ kind: 'assistant_delta', text: 'hello' })
      }
    }))
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        eventKind: 'lifecycle',
        event: expect.objectContaining({ kind: 'turn_lifecycle', state: 'completed' })
      }
    }))
  })

  it('captures a turn when no renderer subscribes to runtime events', async () => {
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
        text: 'background capture'
      } satisfies AgentRuntimeEvent
      yield {
        kind: 'turn_lifecycle',
        runtimeId: 'codex',
        threadId: 'codex-thread',
        turnId: 'codex-turn',
        state: 'completed'
      } satisfies AgentRuntimeEvent
    })
    const { recorder: trace, append } = fakeTraceRecorder()
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter],
      services: { trace }
    })

    await host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'Capture this without a renderer.'
    })

    await vi.waitFor(() => expect(append).toHaveBeenCalledTimes(2))
  })

  it('keeps durable capture on one authoritative writer across renderer subscriptions', async () => {
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
        seq: 1,
        text: 'one event'
      } satisfies AgentRuntimeEvent
      yield {
        kind: 'turn_lifecycle',
        runtimeId: 'codex',
        threadId: 'codex-thread',
        turnId: 'codex-turn',
        seq: 2,
        state: 'completed'
      } satisfies AgentRuntimeEvent
    })
    const { recorder: trace, append } = fakeTraceRecorder()
    const observeEvent = vi.spyOn(trace, 'observeEvent')
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter],
      services: { trace }
    })
    await host.startTurn({ runtimeId: 'codex', threadId: 'codex-thread', text: 'Observe twice.' })
    await vi.waitFor(() => expect(append).toHaveBeenCalledTimes(2))

    const consume = async (): Promise<void> => {
      for await (const _event of host.subscribeEvents({
        runtimeId: 'codex',
        threadId: 'codex-thread'
      })) {
        // Consume the complete bounded test stream.
      }
    }
    await Promise.all([consume(), consume()])

    expect(append).toHaveBeenCalledTimes(2)
    expect(observeEvent).toHaveBeenCalledTimes(2)
  })

  it('does not replay historical turns into a newly started turn trace', async () => {
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
        turnId: 'historical-turn',
        itemId: 'historical-assistant',
        text: 'old output'
      } satisfies AgentRuntimeEvent
      yield {
        kind: 'assistant_delta',
        runtimeId: 'codex',
        threadId: 'codex-thread',
        turnId: 'codex-turn',
        itemId: 'current-assistant',
        text: 'current output'
      } satisfies AgentRuntimeEvent
      yield {
        kind: 'turn_lifecycle',
        runtimeId: 'codex',
        threadId: 'codex-thread',
        turnId: 'codex-turn',
        state: 'completed'
      } satisfies AgentRuntimeEvent
    })
    const { recorder: trace, append } = fakeTraceRecorder()
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [adapter],
      services: { trace }
    })

    await host.startTurn({ runtimeId: 'codex', threadId: 'codex-thread', text: 'New turn.' })
    await vi.waitFor(() => expect(append).toHaveBeenCalledTimes(2))

    expect(append).not.toHaveBeenCalledWith(expect.objectContaining({ turnId: 'historical-turn' }))
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      turnId: 'codex-turn',
      payload: expect.objectContaining({
        event: expect.objectContaining({ text: 'current output' })
      })
    }))
  })

  it('captures SciForge, Codex, and Claude events through the same durable trace recorder', async () => {
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
          receipt: createExecutionReceipt({ status: 'success' }),
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
      const { recorder: trace, append } = fakeTraceRecorder()
      const host = createAgentRuntimeHost({
        settings: async () => settings(runtimeId),
        adapters: [adapter],
        services: { trace }
      })

      const requestText = `Read /Users/alice/private-${runtimeId} using token=runtime-secret`
      await host.startTurn({
        runtimeId,
        threadId: `${runtimeId}-thread`,
        text: requestText,
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
      expect(append).toHaveBeenCalledTimes(4)
      expect(append.mock.calls.map(([event]) => event.payload.eventKind).sort()).toEqual([
        'assistant',
        'lifecycle',
        'tool',
        'usage'
      ])
      expect(append).toHaveBeenCalledWith(expect.objectContaining({
        runtimeId,
        threadId: `${runtimeId}-thread`,
        turnId: `${runtimeId}-turn`
      }))
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
    vi.mocked(adapter.snapshot).mockResolvedValue({
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
    vi.mocked(adapter.snapshot).mockResolvedValue({
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
        schemaVersion: 'sciforge.trace.correlation.v1',
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
    vi.mocked(adapter.snapshot).mockResolvedValue({
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
    vi.mocked(adapter.snapshot).mockResolvedValue({
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
    vi.mocked(adapter.snapshot).mockResolvedValue({
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
    const dataDir = await mkdtemp(join(tmpdir(), 'runtime-context-ledger-host-'))
    const contextLedger = new RuntimeContextLedgerService(dataDir)
    await contextLedger.acceptDirective({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      id: 'directive-before-compaction',
      text: 'Modify the document using only the resources currently visible.'
    })
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
      services: { contextState, contextLedger }
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
    expect(dispatched?.text).toContain('Modify the document using only the resources currently visible.')
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
      vi.mocked(adapter.snapshot).mockResolvedValue({
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

  it('does not materialize completed turns when no artifact consumer is installed', async () => {
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
        state: 'success',
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
    expect(claude.snapshot).not.toHaveBeenCalled()
  })

  it('does not retroactively publish replayed completed turns without an accepted durable watch', async () => {
    const claude = fakeAdapter('claude', {
      id: 'claude-thread',
      runtimeId: 'claude',
      title: 'Claude',
      workspace: '/workspace/thread',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(claude.snapshot).mockResolvedValue({
      id: 'claude-thread',
      runtimeId: 'claude',
      title: 'Claude',
      workspace: '/workspace/thread',
      updatedAt: '2026-06-10T00:00:00.000Z',
      latestSeq: 7,
      turns: [{
        id: 'turn-1',
        threadId: 'claude-thread',
        status: 'completed',
        completedAt: '2026-07-26T09:00:00.000Z',
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
        state: 'success',
        seq: 7,
        createdAt: '2026-07-26T09:00:00.000Z'
      } satisfies AgentRuntimeEvent
    })
    const publish = vi.fn(async (_intent: TurnArtifactIntent) => undefined)
    const host = createAgentRuntimeHost({
      settings: async () => settings('claude'),
      adapters: [claude],
      turnArtifacts: fakeTurnArtifactPublisher(publish)
    })

    for (let replay = 0; replay < 2; replay += 1) {
      for await (const _event of host.subscribeEvents({
        runtimeId: 'claude',
        threadId: 'claude-thread',
        sinceSeq: 0
      })) {
        // Drain the runtime stream so its completion event is recorded.
      }
    }

    expect(publish).not.toHaveBeenCalled()
    expect(claude.snapshot).not.toHaveBeenCalled()

    const intent: TurnArtifactReplayIntent = {
      runtimeId: 'claude',
      threadId: 'claude-thread',
      turnId: 'turn-1',
      sequence: 7,
      occurredAt: '2026-07-26T09:00:00.000Z'
    }

    vi.mocked(claude.snapshot).mockRejectedValueOnce(new Error('thread still materializing'))
    await expect(host.materializeCompletedTurnArtifact(
      intent
    )).rejects.toThrow('thread still materializing')
    const materialized = await host.materializeCompletedTurnArtifact(intent)
    expect(claude.snapshot).toHaveBeenCalledTimes(3)
    expect(claude.readThreadStatus).toHaveBeenCalledTimes(2)
    expect(claude.readThreadPage).toHaveBeenCalledTimes(1)
    expect(materialized).toEqual({
      contractVersion: 1,
      kind: 'turn-completed',
      runtimeId: 'claude',
      threadId: 'claude-thread',
      turnId: 'turn-1',
      targetWatermark: '7',
      sequence: 7,
      workspaceRoot: '/workspace/thread',
      occurredAt: '2026-07-26T09:00:00.000Z',
      artifacts: [
        { id: 'u1', turnId: 'turn-1', kind: 'user_message', text: 'question' },
        { id: 'a1', turnId: 'turn-1', kind: 'assistant_message', text: 'answer' }
      ]
    })
  })

  it('fails closed when a completed-turn intent is partial or crosses workspaces', async () => {
    const claude = fakeAdapter('claude', {
      id: 'claude-thread',
      runtimeId: 'claude',
      title: 'Claude',
      workspace: '/workspace/authoritative',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('claude'),
      adapters: [claude],
      turnArtifacts: fakeTurnArtifactPublisher()
    })
    const intent: TurnArtifactReplayIntent = {
      runtimeId: 'claude',
      threadId: 'claude-thread',
      turnId: 'turn-1',
      sequence: 7,
      workspaceRoot: '/workspace/claimed',
      occurredAt: '2026-07-26T09:00:00.000Z'
    }
    const partialSnapshot = {
      id: 'claude-thread',
      runtimeId: 'claude',
      title: 'Claude',
      workspace: '/workspace/authoritative',
      updatedAt: '2026-06-10T00:00:00.000Z',
      latestSeq: 6,
      latestTurnId: 'turn-1',
      latestTurnStatus: 'running',
      turns: [{
        id: 'turn-1',
        threadId: 'claude-thread',
        status: 'running',
        items: [{ id: 'a1', turnId: 'turn-1', kind: 'assistant_message', text: 'partial' }]
      }]
    } satisfies TestThreadSnapshot
    vi.mocked(claude.snapshot)
      .mockResolvedValueOnce(partialSnapshot)
      .mockResolvedValueOnce(partialSnapshot)
    await expect(host.materializeCompletedTurnArtifact(intent)).rejects.toThrow(
      'not durably completed yet'
    )

    const completedSnapshot = {
      id: 'claude-thread',
      runtimeId: 'claude',
      title: 'Claude',
      workspace: '/workspace/authoritative',
      updatedAt: '2026-06-10T00:00:00.000Z',
      latestSeq: 7,
      turns: [{
        id: 'turn-1',
        threadId: 'claude-thread',
        status: 'completed',
        items: [{ id: 'a1', turnId: 'turn-1', kind: 'assistant_message', text: 'done' }]
      }]
    } satisfies TestThreadSnapshot
    vi.mocked(claude.snapshot)
      .mockResolvedValueOnce(completedSnapshot)
      .mockResolvedValueOnce(completedSnapshot)
    await expect(host.materializeCompletedTurnArtifact(intent)).rejects.toThrow(
      'changed workspace before materialization'
    )
  })

  it('does not publish a replayed completion that lacks an authoritative durable timestamp', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      workspace: '/tmp/workspace',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(codex.subscribeEvents).mockImplementation(async function* () {
      yield {
        kind: 'turn_lifecycle',
        runtimeId: 'codex',
        threadId: 'codex-thread',
        turnId: 'turn-without-time',
        state: 'completed',
        seq: 9
      } satisfies AgentRuntimeEvent
    })
    const publish = vi.fn(async (_intent: TurnArtifactIntent) => undefined)
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [codex],
      turnArtifacts: fakeTurnArtifactPublisher(publish)
    })

    for (let replay = 0; replay < 2; replay += 1) {
      for await (const _event of host.subscribeEvents({
        runtimeId: 'codex',
        threadId: 'codex-thread',
        sinceSeq: 0
      })) {
        // Drain both identical adapter replays.
      }
    }

    expect(publish).not.toHaveBeenCalled()
  })

  it('steers repeated tool activity once before interrupting the next exact repeat', async () => {
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
          execution: {
            enabled: true,
            windowSize: 8,
            exactRepeatThreshold: 2
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
    await vi.waitFor(() => {
      expect(codex.publishSyntheticEvent).toHaveBeenCalledTimes(3)
    })

    expect(events).toHaveLength(3)
    expect(codex.steerTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runtimeId: 'codex',
        threadId: 'codex-thread',
        turnId: 'turn-1'
      })
    )
    expect(codex.steerTurn).toHaveBeenCalledTimes(1)
    expect(codex.interruptTurn).toHaveBeenCalledTimes(1)
    expect(codex.publishSyntheticEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: 'runtime_status',
        metadata: expect.objectContaining({ guard: 'execution' })
      })
    )
    expect(codex.publishSyntheticEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: 'runtime_status',
        metadata: expect.objectContaining({ level: 'hard', code: 'exact_repeat' })
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
          execution: {
            enabled: true,
            windowSize: 8,
            exactRepeatThreshold: 2
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
          execution: {
            enabled: true,
            windowSize: 8,
            exactRepeatThreshold: 2
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
          execution: {
            enabled: true,
            windowSize: 8,
            exactRepeatThreshold: 2
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
          code: 'exact_repeat',
          family: 'command_execution:shell/read-file'
        })
      })
    )
    expect(codex.publishSyntheticEvent).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      expect.objectContaining({ kind: 'error', code: 'runtime_execution_interrupted' })
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
          execution: {
            enabled: true,
            windowSize: 8,
            exactRepeatThreshold: 2
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
          execution: {
            enabled: true,
            windowSize: 8,
            exactRepeatThreshold: 2
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
          execution: {
            enabled: true,
            windowSize: 8,
            exactRepeatThreshold: 2
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
          execution: {
            enabled: true,
            windowSize: 8,
            exactRepeatThreshold: 2
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

  it('does not run observe execution-governance controls for native-guard runtimes', async () => {
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
          execution: {
            enabled: true,
            windowSize: 8,
            exactRepeatThreshold: 2
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

  it('uses native visual tool availability to deny Codex OS GUI automation', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(codex.subscribeEvents).mockImplementation(async function* (_context, input) {
      yield {
        kind: 'tool_event',
        runtimeId: 'codex',
        threadId: input.threadId,
        turnId: 'turn-1',
        itemId: 'shell-gui-fallback',
        status: 'running',
        toolKind: 'command_execution',
        toolName: 'exec_command',
        meta: {
          callId: 'shell-gui-fallback',
          toolName: 'exec_command',
          arguments: { command: 'screencapture -x /tmp/sciforge.png' }
        }
      } satisfies AgentRuntimeEvent
    })
    const nativeVisualToolsAvailable = vi.fn(() => true)
    const host = createAgentRuntimeHost({
      settings: async () => ({
        ...settings('codex'),
        runtimeGuards: {
          execution: { enabled: true, windowSize: 8, exactRepeatThreshold: 2 }
        }
      }),
      adapters: [codex],
      nativeVisualToolsAvailable
    })

    for await (const _event of host.subscribeEvents({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      sinceSeq: 0
    })) {
      // exhaust stream
    }
    await Promise.resolve()

    expect(nativeVisualToolsAvailable).toHaveBeenCalledWith()
    expect(codex.interruptTurn).toHaveBeenCalled()
    expect(codex.publishSyntheticEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: 'error',
        code: 'runtime_execution_policy_denied',
        detail: expect.stringContaining('sciforge_look')
      })
    )
    expect(codex.publishSyntheticEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        detail: expect.stringContaining('sciforge_capture')
      })
    )
    const policyEvent = vi.mocked(codex.publishSyntheticEvent!).mock.calls
      .map(([, event]) => event)
      .find((event) => event.kind === 'error' && event.code === 'runtime_execution_policy_denied')
    expect(policyEvent?.kind === 'error' ? policyEvent.detail : undefined).not.toContain('sciforge_discover')
    expect(policyEvent?.kind === 'error' ? policyEvent.detail : undefined).not.toContain('surface.inspect')
  })

  it('denies command execution while the native visual proof chain is pending', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(codex.startTurn).mockResolvedValue({
      threadId: 'codex-thread',
      turnId: 'turn-1'
    })
    vi.mocked(codex.subscribeEvents).mockImplementation(async function* () {
      yield commandToolEvent('python3 render_visual.py', 1)
    })
    const host = createAgentRuntimeHost({
      settings: async () => ({
        ...settings('codex'),
        runtimeGuards: {
          execution: {
            enabled: true,
            windowSize: 8,
            exactRepeatThreshold: 2
          }
        }
      }),
      adapters: [codex],
      nativeVisualToolsAvailable: () => true
    })

    await host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: '按照任务模板处理当前页面。',
      executionIntent: visualExecutionIntent()
    })
    for await (const _event of host.subscribeEvents({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      sinceSeq: 0
    })) {
      // exhaust stream
    }
    await Promise.resolve()

    expect(codex.interruptTurn).toHaveBeenCalled()
    expect(codex.publishSyntheticEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: 'error',
        code: 'runtime_execution_policy_denied',
        detail: expect.stringContaining('sciforge_look')
      })
    )
  })

  it('rejects a required native visual turn before runtime dispatch when the tools are unavailable', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [codex],
      nativeVisualToolsAvailable: () => false
    })

    await expect(host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'Inspect the current visual resource.',
      executionIntent: visualExecutionIntent()
    })).rejects.toMatchObject({
      name: 'AgentRuntimeTurnPreflightError',
      code: 'runtime_visual_capability_unavailable',
      failureClass: 'capability_unavailable',
      retryable: false
    })
    expect(codex.startTurn).not.toHaveBeenCalled()
  })

  it('does not deny OS GUI automation when native visual tools are unavailable', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(codex.subscribeEvents).mockImplementation(async function* (_context, input) {
      yield {
        kind: 'tool_event',
        runtimeId: 'codex',
        threadId: input.threadId,
        turnId: 'turn-1',
        itemId: 'shell-gui-fallback',
        status: 'running',
        toolKind: 'command_execution',
        toolName: 'exec_command',
        meta: {
          callId: 'shell-gui-fallback',
          toolName: 'exec_command',
          arguments: { command: 'screencapture -x /tmp/sciforge.png' }
        }
      } satisfies AgentRuntimeEvent
    })
    const nativeVisualToolsAvailable = vi.fn(() => false)
    const host = createAgentRuntimeHost({
      settings: async () => ({
        ...settings('codex'),
        runtimeGuards: {
          execution: { enabled: true, windowSize: 8, exactRepeatThreshold: 2 }
        }
      }),
      adapters: [codex],
      nativeVisualToolsAvailable
    })

    for await (const _event of host.subscribeEvents({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      sinceSeq: 0
    })) {
      // exhaust stream
    }
    await Promise.resolve()

    expect(nativeVisualToolsAvailable).toHaveBeenCalledWith()
    expect(codex.interruptTurn).not.toHaveBeenCalled()
    expect(codex.publishSyntheticEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: 'error',
        code: 'runtime_execution_policy_denied'
      })
    )
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
    vi.mocked(codex.snapshot).mockImplementation(async () => ({
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

  it('publishes a pending native visual snapshot before steering a visual request into an active turn', async () => {
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
    vi.mocked(codex.snapshot).mockImplementation(async () => ({
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
    vi.mocked(codex.startTurn).mockResolvedValueOnce({
      threadId: 'codex-thread',
      turnId: 'turn-1'
    })
    codex.updateTurnGovernanceSnapshot = vi.fn(async () => undefined)
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [codex],
      nativeVisualToolsAvailable: () => true
    })

    await host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'first'
    })
    runtimeStatus = 'running'
    await host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: '按照任务模板生成报告',
      executionIntent: visualExecutionIntent()
    })

    expect(codex.updateTurnGovernanceSnapshot).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        runtimeId: 'codex',
        threadId: 'codex-thread',
        turnId: 'turn-1',
        snapshot: {
          ownedVisualToolsAvailable: true,
          nativeVisualProofChainPending: true
        }
      })
    )
    const snapshotOrder = vi.mocked(codex.updateTurnGovernanceSnapshot)
      .mock.invocationCallOrder.at(-1) ?? 0
    const steerOrder = vi.mocked(codex.steerTurn).mock.invocationCallOrder.at(-1) ?? 0
    expect(snapshotOrder).toBeLessThan(steerOrder)
  })

  it('dispatches the canonical native visual snapshot with the first adapter start call', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    let dispatchedContext: AgentRuntimeAdapterContext | undefined
    codex.startTurn = vi.fn(async (context, input) => {
      dispatchedContext = context
      return { threadId: input.threadId, turnId: 'turn-1' }
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [codex],
      nativeVisualToolsAvailable: () => true
    })

    await host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: '按照任务模板生成报告',
      executionIntent: visualExecutionIntent()
    })

    expect(dispatchedContext?.turnGovernanceSnapshot).toEqual({
      ownedVisualToolsAvailable: true,
      nativeVisualProofChainPending: true
    })
  })

  it('routes direct visual steer through the same execution requirement and snapshot path', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    codex.startTurn = vi.fn(async (_context, input) => ({
      threadId: input.threadId,
      turnId: 'turn-1'
    }))
    codex.updateTurnGovernanceSnapshot = vi.fn(async () => undefined)
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [codex],
      nativeVisualToolsAvailable: () => true
    })
    await host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'first'
    })

    await host.steerTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      turnId: 'turn-1',
      text: '按照任务模板继续生成报告',
      executionIntent: visualExecutionIntent()
    })

    expect(codex.steerTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        text: expect.stringContaining('Runtime-enforced visual completion gate')
      })
    )
    expect(codex.updateTurnGovernanceSnapshot).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        snapshot: {
          ownedVisualToolsAvailable: true,
          nativeVisualProofChainPending: true
        }
      })
    )
  })

  it('rolls back visual obligations and their snapshot when direct steer delivery fails', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    codex.startTurn = vi.fn(async (_context, input) => ({
      threadId: input.threadId,
      turnId: 'turn-1'
    }))
    codex.updateTurnGovernanceSnapshot = vi.fn(async () => undefined)
    codex.steerTurn = vi.fn(async () => {
      throw new Error('steer rejected')
    })
    codex.subscribeEvents = vi.fn(async function* () {
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
      adapters: [codex],
      nativeVisualToolsAvailable: () => true
    })
    await host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'first'
    })

    await expect(host.steerTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      turnId: 'turn-1',
      text: '按照任务模板继续生成报告',
      executionIntent: visualExecutionIntent()
    })).rejects.toThrow('steer rejected')

    const snapshots = vi.mocked(codex.updateTurnGovernanceSnapshot).mock.calls
      .map((call) => call[1].snapshot.nativeVisualProofChainPending)
    expect(snapshots).toEqual([false, true, false])
    const events: AgentRuntimeEvent[] = []
    for await (const event of host.subscribeEvents({
      runtimeId: 'codex',
      threadId: 'codex-thread'
    })) {
      events.push(event)
    }
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'turn_lifecycle',
      state: 'completed'
    }))
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
    vi.mocked(codex.snapshot).mockResolvedValue({
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
    vi.mocked(codex.snapshot).mockImplementation(async () => ({
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

  it('uses the context ledger as the single persisted delivery path for start and steer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-host-directives-'))
    evidenceQueueRoots.push(root)
    const contextLedger = new RuntimeContextLedgerService(root)
    await contextLedger.acceptDirective({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      id: 'directive-old',
      text: 'Use every annotation from the earlier set.'
    })
    await contextLedger.beginDirectiveDelivery({ runtimeId: 'codex', threadId: 'codex-thread', id: 'directive-old' })
    await contextLedger.finishDirectiveDelivery({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      id: 'directive-old',
      delivery: 'delivered',
      turnId: 'turn-old'
    })
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [codex],
      services: { contextLedger }
    })
    const correction = 'The earlier set is stale; use only the annotations currently visible.'

    await host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: correction,
      displayText: correction,
      clientDirectiveId: 'directive-current'
    })
    await host.steerTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      turnId: 'turn-active',
      text: 'Continue until the requested changes are verified.',
      clientDirectiveId: 'directive-steer'
    })

    const started = vi.mocked(codex.startTurn).mock.calls[0]?.[1]
    expect(started?.text).toContain('later directives override conflicting earlier directives')
    expect(started?.text).toContain('Use every annotation from the earlier set.')
    expect(started?.text).toContain(correction)
    expect(started?.displayText).toBe(correction)
    const steered = vi.mocked(codex.steerTurn).mock.calls[0]?.[1]
    expect(steered?.text).toContain('Use every annotation from the earlier set.')
    expect(steered?.text).toContain(correction)
    expect(steered?.text).toContain('Continue until the requested changes are verified.')
    await expect(contextLedger.get({ runtimeId: 'codex', threadId: 'codex-thread' }))
      .resolves.toMatchObject({
        directives: [
          { id: 'directive-old', delivery: 'delivered' },
          { id: 'directive-current', delivery: 'delivered' },
          { id: 'directive-steer', delivery: 'delivered' }
        ]
      })
  })

  it('does not dispatch a delivered directive id twice', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-host-directives-'))
    evidenceQueueRoots.push(root)
    const contextLedger = new RuntimeContextLedgerService(root)
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(codex.startTurn).mockResolvedValue({ threadId: 'codex-thread', turnId: 'turn-1' })
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [codex],
      services: { contextLedger }
    })
    const input = {
      runtimeId: 'codex' as const,
      threadId: 'codex-thread',
      text: 'Modify the document.',
      clientDirectiveId: 'directive-once'
    }

    await expect(host.startTurn(input)).resolves.toEqual({ threadId: 'codex-thread', turnId: 'turn-1' })
    await expect(host.startTurn(input)).resolves.toEqual({ threadId: 'codex-thread', turnId: 'turn-1' })
    expect(codex.startTurn).toHaveBeenCalledTimes(1)
  })

  it('records ambiguous adapter failures as uncertain and refuses a blind retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-host-directives-'))
    evidenceQueueRoots.push(root)
    const contextLedger = new RuntimeContextLedgerService(root)
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(codex.startTurn).mockRejectedValue(new Error('connection closed after dispatch'))
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [codex],
      services: { contextLedger }
    })
    const input = {
      runtimeId: 'codex' as const,
      threadId: 'codex-thread',
      text: 'Modify the document.',
      clientDirectiveId: 'directive-uncertain'
    }

    await expect(host.startTurn(input)).rejects.toThrow('connection closed after dispatch')
    await expect(host.startTurn(input)).rejects.toThrow(/uncertain delivery/)
    expect(codex.startTurn).toHaveBeenCalledTimes(1)
    await expect(contextLedger.get({ runtimeId: 'codex', threadId: 'codex-thread' }))
      .resolves.toMatchObject({ directives: [{ id: 'directive-uncertain', delivery: 'uncertain' }] })
  })

  it('keeps an ambiguous pending start durable without scanning matching historical text', async () => {
    const issuerEpoch = 'issuer-00000000000000000000000000000000'
    const deliveryAttemptId = `delivery-attempt:${issuerEpoch}:1:00000000000000000000000000000000`
    const start: PendingTurnArtifactStart = Object.freeze({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      clientDirectiveId: 'directive-ambiguous-recovery',
      issuerEpoch,
      deliveryAttemptOrdinal: 1,
      deliveryAttemptId,
      boundaryLeaseId: `turn-boundary:${deliveryAttemptId}`,
      inputDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      workspaceRoot: '/tmp/workspace',
      key: 'start-1',
      registeredAt: '2026-08-15T00:00:00.000Z'
    })
    const publisher = fakeTurnArtifactPublisher()
    vi.mocked(publisher.pendingStarts).mockResolvedValue([start])
    const codex = fakeAdapter('codex', {
      id: 'codex-thread', runtimeId: 'codex', title: 'Codex', workspace: '/tmp/workspace',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(codex.snapshot).mockResolvedValue({
      id: 'codex-thread', runtimeId: 'codex', title: 'Codex', workspace: '/tmp/workspace',
      updatedAt: '2026-06-10T00:00:00.000Z', latestSeq: 2,
      latestTurnId: 'turn-matching', latestTurnStatus: 'completed', turns: [{
        id: 'turn-matching', threadId: 'codex-thread', status: 'completed',
        items: [{ id: 'user-matching', kind: 'user_message', text: 'Modify the document.' }]
      }]
    })
    const recovered = createAgentRuntimeHost({
      settings: async () => settings('codex'), adapters: [codex], turnArtifacts: publisher
    })
    await expect(recovered.recoverCompletedTurnArtifacts()).resolves.toBe(1)
    expect(publisher.bindStart).not.toHaveBeenCalled()
    expect(codex.readThreadPage).not.toHaveBeenCalled()
    await recovered.dispose()
  })

  it('durably audits explicit pending-start resolution and release', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread', runtimeId: 'codex', title: 'Codex', workspace: '/tmp/workspace',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(codex.snapshot).mockResolvedValue({
      id: 'codex-thread', runtimeId: 'codex', title: 'Codex', workspace: '/tmp/workspace',
      updatedAt: '2026-06-10T00:00:00.000Z', latestSeq: 4,
      latestTurnId: 'turn-explicit', latestTurnStatus: 'running', turns: [{
        id: 'turn-explicit', threadId: 'codex-thread', status: 'running',
        items: [{ id: 'user-explicit', kind: 'user_message', text: 'Modify the document.' }]
      }]
    })
    const issuerEpoch = 'issuer-00000000000000000000000000000000'
    const deliveryAttemptId = `delivery-attempt:${issuerEpoch}:1:00000000000000000000000000000000`
    const start: PendingTurnArtifactStart = {
      runtimeId: 'codex',
      threadId: 'codex-thread',
      clientDirectiveId: 'directive-explicit',
      issuerEpoch,
      deliveryAttemptOrdinal: 1,
      deliveryAttemptId,
      boundaryLeaseId: `turn-boundary:${deliveryAttemptId}`,
      inputDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      workspaceRoot: '/tmp/workspace',
      key: 'start-explicit',
      registeredAt: '2026-08-15T00:00:00.000Z'
    }
    const turnArtifacts = fakeTurnArtifactPublisher()
    vi.mocked(turnArtifacts.pendingStarts).mockResolvedValue([start])
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'), adapters: [codex], turnArtifacts
    })

    await expect(host.resolvePendingTurnArtifactStart({
      boundaryLeaseId: start.boundaryLeaseId,
      runtimeId: 'codex',
      threadId: 'codex-thread',
      turnId: 'turn-explicit',
      workspaceRoot: '/tmp/workspace',
      userMessageItemId: 'user-explicit'
    })).resolves.toBe(true)
    expect(turnArtifacts.bindStart).toHaveBeenCalledWith(start, expect.objectContaining({
      turnId: 'turn-explicit',
      providerUserMessageItemId: 'user-explicit',
      bindingSource: 'explicit-resolution'
    }))

    vi.mocked(turnArtifacts.pendingStarts).mockResolvedValue([start])
    await expect(host.releasePendingTurnArtifactStart({
      boundaryLeaseId: start.boundaryLeaseId,
      runtimeId: 'codex',
      threadId: 'codex-thread',
      workspaceRoot: '/tmp/workspace'
    })).resolves.toBe(true)
    expect(turnArtifacts.rejectStart).toHaveBeenCalledWith(
      start,
      expect.objectContaining({
        state: 'rejected',
        boundaryLeaseId: start.boundaryLeaseId,
        settlementSource: 'explicit-pending-start-release'
      })
    )
    await host.dispose()
  })

  it('governs pending starts through the canonical Host-owned auxiliary surface', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread', runtimeId: 'codex', title: 'Codex', workspace: '/tmp/workspace',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(codex.snapshot).mockResolvedValue({
      id: 'codex-thread', runtimeId: 'codex', title: 'Codex', workspace: '/tmp/workspace',
      updatedAt: '2026-06-10T00:00:00.000Z', latestSeq: 4,
      latestTurnId: 'turn-governed', latestTurnStatus: 'running', turns: [{
        id: 'turn-governed', threadId: 'codex-thread', status: 'running',
        items: [{ id: 'user-governed', kind: 'user_message', text: 'Modify the document.' }]
      }]
    })
    const issuerEpoch = 'issuer-00000000000000000000000000000000'
    const deliveryAttemptId = `delivery-attempt:${issuerEpoch}:1:00000000000000000000000000000000`
    const start: PendingTurnArtifactStart = {
      runtimeId: 'codex',
      threadId: 'codex-thread',
      clientDirectiveId: 'directive-governed',
      issuerEpoch,
      deliveryAttemptId,
      deliveryAttemptOrdinal: 1,
      boundaryLeaseId: `turn-boundary:${deliveryAttemptId}`,
      inputDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      workspaceRoot: '/tmp/workspace',
      key: 'start-governed',
      registeredAt: '2026-08-15T00:00:00.000Z'
    }
    const turnArtifacts = fakeTurnArtifactPublisher()
    vi.mocked(turnArtifacts.pendingStarts).mockResolvedValue([start])
    vi.mocked(turnArtifacts.readDurableTurnBoundarySnapshot).mockResolvedValue({
      issuerEpoch,
      nextDeliveryAttemptOrdinal: 3,
      retiredThroughOrdinal: 0,
      retiredOrdinalRanges: [],
      owners: [{
        issuerEpoch: start.issuerEpoch,
        deliveryAttemptOrdinal: start.deliveryAttemptOrdinal,
        boundaryLeaseId: start.boundaryLeaseId,
        deliveryAttemptId: start.deliveryAttemptId,
        runtimeId: start.runtimeId,
        threadId: start.threadId,
        clientDirectiveId: start.clientDirectiveId,
        workspaceRoot: start.workspaceRoot,
        phase: 'pending-start',
        occurredAt: start.registeredAt
      },
      {
        issuerEpoch,
        deliveryAttemptOrdinal: 2,
        boundaryLeaseId: `turn-boundary:delivery-attempt:${issuerEpoch}:2:11111111111111111111111111111111`,
        deliveryAttemptId: `delivery-attempt:${issuerEpoch}:2:11111111111111111111111111111111`,
        runtimeId: 'codex',
        threadId: 'codex-thread',
        clientDirectiveId: 'directive-watching',
        workspaceRoot: '/tmp/workspace',
        phase: 'watching',
        turnId: 'turn-watching',
        occurredAt: start.registeredAt
      }]
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'), adapters: [codex], turnArtifacts
    })

    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'listPendingTurnStarts',
      payload: { threadId: 'codex-thread', workspaceRoot: '/tmp/workspace' }
    })).resolves.toEqual([
      expect.objectContaining({ boundaryLeaseId: start.boundaryLeaseId, phase: 'pending-start' })
    ])

    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'resolvePendingTurnStart',
      payload: {
        boundaryLeaseId: start.boundaryLeaseId,
        threadId: start.threadId,
        turnId: 'turn-governed',
        workspaceRoot: start.workspaceRoot,
        userMessageItemId: 'user-governed'
      }
    })).resolves.toEqual({
      action: 'resolve',
      boundaryLeaseId: start.boundaryLeaseId,
      applied: true
    })
    expect(turnArtifacts.bindStart).toHaveBeenCalledWith(start, expect.objectContaining({
      turnId: 'turn-governed',
      providerUserMessageItemId: 'user-governed',
      bindingSource: 'explicit-resolution'
    }))

    vi.mocked(turnArtifacts.bindStart).mockResolvedValueOnce(false)
    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'resolvePendingTurnStart',
      payload: {
        boundaryLeaseId: start.boundaryLeaseId,
        threadId: start.threadId,
        turnId: 'turn-governed',
        workspaceRoot: start.workspaceRoot,
        userMessageItemId: 'user-governed'
      }
    })).resolves.toEqual({
      action: 'resolve',
      boundaryLeaseId: start.boundaryLeaseId,
      applied: false
    })

    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'releasePendingTurnStart',
      payload: {
        boundaryLeaseId: start.boundaryLeaseId,
        threadId: start.threadId,
        workspaceRoot: '/tmp/other-workspace'
      }
    })).rejects.toThrow('scope does not match')
    expect(turnArtifacts.rejectStart).not.toHaveBeenCalled()

    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'releasePendingTurnStart',
      payload: {
        boundaryLeaseId: start.boundaryLeaseId,
        threadId: start.threadId,
        workspaceRoot: start.workspaceRoot
      }
    })).resolves.toEqual({
      action: 'release-as-rejected',
      boundaryLeaseId: start.boundaryLeaseId,
      applied: true
    })
    expect(turnArtifacts.rejectStart).toHaveBeenCalledWith(
      start,
      expect.objectContaining({
        boundaryLeaseId: start.boundaryLeaseId,
        settlementSource: 'explicit-pending-start-release'
      })
    )
    vi.mocked(turnArtifacts.rejectStart).mockResolvedValueOnce(false)
    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'releasePendingTurnStart',
      payload: {
        boundaryLeaseId: start.boundaryLeaseId,
        threadId: start.threadId,
        workspaceRoot: start.workspaceRoot
      }
    })).resolves.toEqual({
      action: 'release-as-rejected',
      boundaryLeaseId: start.boundaryLeaseId,
      applied: false
    })
    await host.dispose()
  })

  it('governs pending starts against the exact Workspace Host and provider page scope', async () => {
    const ownerLocator: WorkspaceLocator = {
      contractVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      hostSessionId: 'workspace-session-owner',
      path: '/cluster/project'
    }
    const otherSessionLocator: WorkspaceLocator = {
      ...ownerLocator,
      hostSessionId: 'workspace-session-other'
    }
    const codex = fakeAdapter('codex', {
      id: 'codex-thread', runtimeId: 'codex', title: 'Codex', workspace: ownerLocator.path,
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const issuerEpoch = 'issuer-00000000000000000000000000000000'
    const deliveryAttemptId = `delivery-attempt:${issuerEpoch}:1:00000000000000000000000000000000`
    const start: PendingTurnArtifactStart = {
      runtimeId: 'codex',
      threadId: 'codex-thread',
      clientDirectiveId: 'directive-exact-workspace',
      issuerEpoch,
      deliveryAttemptId,
      deliveryAttemptOrdinal: 1,
      boundaryLeaseId: `turn-boundary:${deliveryAttemptId}`,
      inputDigest: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      workspaceRoot: ownerLocator.path,
      workspaceLocator: ownerLocator,
      key: 'start-exact-workspace',
      registeredAt: '2026-08-15T00:00:00.000Z'
    }
    const turnArtifacts = fakeTurnArtifactPublisher()
    vi.mocked(turnArtifacts.pendingStarts).mockResolvedValue([start])
    const resolvePlacement = vi.fn(async (locator: WorkspaceLocator): Promise<WorkspaceHostPlacement> => ({
      locator,
      session: {
        protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
        serverVersion: '1.0.0',
        serverInstanceId: 'server-exact-workspace',
        sessionId: locator.hostSessionId,
        lifecycleMode: 'persistent-daemon',
        locator,
        platform: { os: 'linux', architecture: 'x64' },
        capabilities: [],
        contributions: [],
        eventSequence: 0,
        replay: { earliestSequence: 0, latestSequence: 0 },
        egress: { mode: 'none', status: 'disabled' }
      }
    }))
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [codex],
      turnArtifacts,
      services: { workspaceHosts: { resolvePlacement } }
    })

    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'listPendingTurnStarts',
      workspaceLocator: ownerLocator,
      payload: { threadId: start.threadId, workspaceRoot: start.workspaceRoot }
    })).resolves.toEqual([
      expect.objectContaining({
        boundaryLeaseId: start.boundaryLeaseId,
        workspaceLocator: ownerLocator
      })
    ])
    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'listPendingTurnStarts',
      workspaceLocator: otherSessionLocator,
      payload: { threadId: start.threadId, workspaceRoot: start.workspaceRoot }
    })).resolves.toEqual([])
    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'listPendingTurnStarts',
      payload: { threadId: start.threadId, workspaceRoot: start.workspaceRoot }
    })).resolves.toEqual([])

    const resolutionPayload = {
      boundaryLeaseId: start.boundaryLeaseId,
      threadId: start.threadId,
      turnId: 'turn-exact-workspace',
      workspaceRoot: start.workspaceRoot,
      userMessageItemId: 'user-exact-workspace'
    }
    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'resolvePendingTurnStart',
      workspaceLocator: otherSessionLocator,
      payload: resolutionPayload
    })).rejects.toThrow('scope does not match')
    await expect(host.auxiliary({
      runtimeId: 'codex',
      operation: 'releasePendingTurnStart',
      payload: {
        boundaryLeaseId: start.boundaryLeaseId,
        threadId: start.threadId,
        workspaceRoot: start.workspaceRoot
      }
    })).rejects.toThrow('scope does not match')

    for (const page of [{
      runtimeId: 'claude' as const,
      threadId: start.threadId
    }, {
      runtimeId: 'codex' as const,
      threadId: 'wrong-thread'
    }]) {
      vi.mocked(codex.readThreadPage).mockResolvedValueOnce({
        ...page,
        latestSeq: 1,
        turns: [{
          id: 'turn-exact-workspace',
          threadId: page.threadId,
          status: 'running',
          items: [{ id: 'user-exact-workspace', kind: 'user_message' }]
        }],
        nextCursor: null
      })
      await expect(host.auxiliary({
        runtimeId: 'codex',
        operation: 'resolvePendingTurnStart',
        workspaceLocator: ownerLocator,
        payload: resolutionPayload
      })).rejects.toThrow('provider page scope does not match')
    }
    expect(turnArtifacts.bindStart).not.toHaveBeenCalled()
    expect(turnArtifacts.rejectStart).not.toHaveBeenCalled()
    expect(turnArtifacts.publishLifecycleSettlement).not.toHaveBeenCalled()
    await host.dispose()
  })

  it.each([
    ['required preflight failure', 'preflight'],
    ['artifact preflight failure', 'artifact'],
    ['definite provider rejection', 'provider']
  ] as const)('releases the durable turn boundary after %s', async (_label, failurePoint) => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    if (failurePoint === 'provider') {
      vi.mocked(codex.startTurn).mockRejectedValue(
        Object.assign(new Error('provider rejected input'), { code: 'validation_error' })
      )
    }
    const turnArtifacts = fakeTurnArtifactPublisher()
    if (failurePoint === 'artifact') {
      vi.mocked(turnArtifacts.registerStart).mockRejectedValue(new Error('artifact preflight unavailable'))
    }
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [codex],
      turnArtifacts
    })
    const required: Array<import('@sciforge/domain-sdk/host').DomainMainBeforeTurnEvent> = []
    const lifecycle: Array<import('@sciforge/domain-sdk/host').DomainMainTurnLifecycleEvent> = []
    host.subscribeRequiredBeforeTurn(async (event) => {
      required.push(event)
      if (failurePoint === 'preflight') throw new Error('checkpoint store unavailable')
    })
    host.subscribeTurnLifecycle((event) => { lifecycle.push(event) })

    await expect(host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'Create the result.',
      workspace: '/tmp/workspace',
      clientDirectiveId: `directive-${failurePoint}`
    })).rejects.toThrow()

    if (failurePoint === 'artifact') {
      expect(required).toEqual([])
      expect(lifecycle.filter((event) => event.kind === 'after-turn')).toEqual([])
    } else {
      expect(required).toEqual([
        expect.objectContaining({
          kind: 'before-turn',
          boundaryLeaseId: expect.stringMatching(/^turn-boundary:delivery-attempt:issuer-/u),
          clientDirectiveId: `directive-${failurePoint}`
        })
      ])
      expect(lifecycle.filter((event) => event.kind === 'after-turn')).toEqual([
        expect.objectContaining({
          kind: 'after-turn',
          state: 'rejected',
          boundaryLeaseId: required[0]?.boundaryLeaseId,
          clientDirectiveId: `directive-${failurePoint}`
        })
      ])
    }
    expect(codex.startTurn).toHaveBeenCalledTimes(failurePoint === 'provider' ? 1 : 0)
  })

  it('mints a new delivery attempt when the same directive retries after definite rejection', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread', runtimeId: 'codex', title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(codex.startTurn)
      .mockRejectedValueOnce(Object.assign(new Error('provider rejected input'), {
        code: 'validation_error'
      }))
      .mockResolvedValueOnce({ threadId: 'codex-thread', turnId: 'turn-retry' })
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [codex],
      turnArtifacts: fakeTurnArtifactPublisher()
    })
    const acquired: Array<import('@sciforge/domain-sdk/host').DomainMainBeforeTurnEvent> = []
    host.subscribeRequiredBeforeTurn((event) => { acquired.push(event) })
    const input = {
      runtimeId: 'codex' as const,
      threadId: 'codex-thread',
      text: 'Create the result.',
      workspace: '/tmp/workspace',
      clientDirectiveId: 'directive-retry'
    }

    await expect(host.startTurn(input)).rejects.toThrow('provider rejected input')
    await expect(host.startTurn(input)).resolves.toEqual({
      threadId: 'codex-thread',
      turnId: 'turn-retry'
    })

    expect(acquired).toHaveLength(2)
    expect(acquired[0]?.deliveryAttemptId).not.toBe(acquired[1]?.deliveryAttemptId)
    expect(acquired[0]?.boundaryLeaseId).toBe(`turn-boundary:${acquired[0]?.deliveryAttemptId}`)
    expect(acquired[1]?.boundaryLeaseId).toBe(`turn-boundary:${acquired[1]?.deliveryAttemptId}`)
  })

  it.each(['completed', 'failed', 'cancelled'] as const)(
    'settles the accepted turn boundary for a %s turn',
    async (state) => {
      const codex = fakeAdapter('codex', {
        id: 'codex-thread',
        runtimeId: 'codex',
        title: 'Codex',
        updatedAt: '2026-06-10T00:00:00.000Z'
      })
      vi.mocked(codex.startTurn).mockResolvedValue({ threadId: 'codex-thread', turnId: 'turn-terminal' })
      vi.mocked(codex.subscribeEvents).mockImplementation(async function* () {
        yield {
          kind: 'turn_lifecycle',
          runtimeId: 'codex',
          threadId: 'codex-thread',
          turnId: 'turn-terminal',
          state,
          seq: 2,
          createdAt: '2026-08-15T10:00:00.000Z'
        } satisfies AgentRuntimeEvent
      })
      const host = createAgentRuntimeHost({
        settings: async () => settings('codex'),
        adapters: [codex],
        turnArtifacts: fakeTurnArtifactPublisher()
      })
      const lifecycle: Array<import('@sciforge/domain-sdk/host').DomainMainTurnLifecycleEvent> = []
      host.subscribeTurnLifecycle((event) => { lifecycle.push(event) })
      await host.startTurn({
        runtimeId: 'codex',
        threadId: 'codex-thread',
        text: 'Create the result.',
        workspace: '/tmp/workspace',
        clientDirectiveId: `directive-${state}`
      })
      for await (const _event of host.subscribeEvents({
        runtimeId: 'codex',
        threadId: 'codex-thread',
        sinceSeq: 0
      })) {
        // Drain the exact terminal event.
      }

      expect(lifecycle.filter((event) => event.kind === 'after-turn')).toEqual([
        expect.objectContaining({
          kind: 'after-turn',
          state,
          turnId: 'turn-terminal',
          boundaryLeaseId: expect.stringMatching(/^turn-boundary:delivery-attempt:issuer-/u),
          clientDirectiveId: `directive-${state}`
        })
      ])
    }
  )

  it('settles a terminal event published before the provider returns its turn handle', async () => {
    const emitTerminal = deferred<void>()
    const boundarySettled = deferred<void>()
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(codex.startTurn).mockImplementation(async () => {
      emitTerminal.resolve(undefined)
      await boundarySettled.promise
      return { threadId: 'codex-thread', turnId: 'turn-fast-terminal' }
    })
    vi.mocked(codex.subscribeEvents).mockImplementation(async function* () {
      await emitTerminal.promise
      yield {
        kind: 'turn_lifecycle',
        runtimeId: 'codex',
        threadId: 'codex-thread',
        turnId: 'turn-fast-terminal',
        state: 'failed',
        seq: 2,
        createdAt: '2026-08-15T10:00:00.000Z'
      } satisfies AgentRuntimeEvent
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [codex],
      turnArtifacts: fakeTurnArtifactPublisher()
    })
    const lifecycle: Array<import('@sciforge/domain-sdk/host').DomainMainTurnLifecycleEvent> = []
    host.subscribeTurnLifecycle((event) => {
      lifecycle.push(event)
      if (event.kind === 'after-turn') boundarySettled.resolve(undefined)
    })
    const drain = (async () => {
      for await (const _event of host.subscribeEvents({
        runtimeId: 'codex',
        threadId: 'codex-thread',
        sinceSeq: 0
      })) {
        // Drain the terminal event while startTurn is still awaiting its handle.
      }
    })()

    await expect(host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'Create the result.',
      workspace: '/tmp/workspace',
      clientDirectiveId: 'directive-fast-terminal'
    })).resolves.toEqual({ threadId: 'codex-thread', turnId: 'turn-fast-terminal' })
    await drain

    expect(lifecycle.filter((event) => event.kind === 'after-turn')).toEqual([
      expect.objectContaining({
        state: 'failed',
        turnId: 'turn-fast-terminal',
        boundaryLeaseId: expect.stringMatching(/^turn-boundary:delivery-attempt:issuer-/u),
        clientDirectiveId: 'directive-fast-terminal'
      })
    ])
  })

  it('releases a boundary when restart recovery observes failure without a terminal event', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    vi.mocked(codex.startTurn).mockResolvedValue({ threadId: 'codex-thread', turnId: 'turn-recovered-failure' })
    vi.mocked(codex.snapshot).mockResolvedValue({
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z',
      latestSeq: 3,
      latestTurnId: 'turn-recovered-failure',
      latestTurnStatus: 'failed',
      turns: [{ id: 'turn-recovered-failure', threadId: 'codex-thread', status: 'failed' }]
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [codex],
      turnArtifacts: fakeTurnArtifactPublisher()
    })
    const lifecycle: Array<import('@sciforge/domain-sdk/host').DomainMainTurnLifecycleEvent> = []
    host.subscribeTurnLifecycle((event) => { lifecycle.push(event) })
    await host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'Create the result.',
      workspace: '/tmp/workspace',
      clientDirectiveId: 'directive-recovered-failure'
    })

    await vi.waitFor(() => {
      expect(lifecycle.filter((event) => event.kind === 'after-turn')).toEqual([
        expect.objectContaining({
          state: 'failed',
          turnId: 'turn-recovered-failure',
          boundaryLeaseId: expect.stringMatching(/^turn-boundary:delivery-attempt:issuer-/u)
        })
      ])
    })
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
    vi.mocked(codex.snapshot).mockResolvedValue({
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
      vi.mocked(codex.snapshot)
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
      expect(codex.snapshot).toHaveBeenCalledTimes(2)
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
        vi.mocked(adapter.snapshot).mockImplementation(async () => ({
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
          vi.mocked(adapter.snapshot)
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
        vi.mocked(adapter.snapshot).mockResolvedValue({
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

  it('passes placement-neutral Workspace Host metadata without changing runtime identity', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-07-30T00:00:00.000Z'
    })
    const locator = {
      contractVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      hostSessionId: 'workspace-session-1',
      path: '/cluster/project'
    }
    const placement: WorkspaceHostPlacement = {
      locator,
      session: {
        protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
        serverVersion: '1.0.0',
        serverInstanceId: 'server-instance-1',
        sessionId: 'workspace-session-1',
        lifecycleMode: 'persistent-daemon',
        locator,
        platform: { os: 'linux', architecture: 'x64' },
        capabilities: [],
        contributions: [],
        eventSequence: 0,
        replay: { earliestSequence: 0, latestSequence: 0 },
        egress: { mode: 'none', status: 'disabled' }
      }
    }
    const resolvePlacement = vi.fn(async () => placement)
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [codex],
      services: {
        workspaceHosts: { resolvePlacement }
      }
    })

    await expect(host.listThreads({
      runtimeId: 'codex',
      workspaceLocator: locator
    })).resolves.toEqual([
      expect.objectContaining({
        workspace: locator.path,
        workspaceLocator: locator
      })
    ])
    await expect(host.startThread({
      runtimeId: 'codex',
      workspace: '/must/not-select-local-placement',
      workspaceLocator: locator
    })).resolves.toEqual(expect.objectContaining({
      workspace: locator.path,
      workspaceLocator: locator
    }))
    await expect(host.readThreadSnapshot({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      workspaceLocator: locator
    })).resolves.toEqual(expect.objectContaining({
      workspace: locator.path,
      workspaceLocator: locator
    }))
    await host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'Inspect the remote workspace.',
      workspaceLocator: locator
    })

    expect(resolvePlacement).toHaveBeenCalledWith(locator)
    expect(codex.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceHost: placement }),
      expect.objectContaining({
        runtimeId: 'codex',
        workspace: '/cluster/project',
        workspaceLocator: locator
      })
    )
  })

  it('fails closed when a Workspace Host locator has no session manager', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-07-30T00:00:00.000Z'
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [codex]
    })

    await expect(host.startTurn({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'Do not run locally.',
      workspaceLocator: {
        contractVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
        hostSessionId: 'workspace-session-1',
        path: '/cluster/project'
      }
    })).rejects.toThrow(/attached Workspace Host session manager/u)
    expect(codex.startTurn).not.toHaveBeenCalled()
  })

  it('restores explicit Workspace Host placement on every thread-scoped operation', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-07-30T00:00:00.000Z'
    })
    codex.resolveApproval = vi.fn(async () => undefined)
    codex.resolveUserInput = vi.fn(async () => undefined)
    codex.compactThread = vi.fn(async () => undefined)
    codex.auxiliary = vi.fn(async () => ({ ok: true }))
    codex.forkThread = vi.fn(async () => ({
      id: 'fork-thread',
      runtimeId: 'codex' as const,
      title: 'Fork',
      updatedAt: '2026-07-30T00:00:00.000Z'
    }))
    codex.capabilities = vi.fn(async () => ({
      ...capabilities('codex'),
      controls: {
        ...capabilities('codex').controls,
        compact: 'native' as const
      }
    }))
    const locator = {
      contractVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      hostSessionId: 'workspace-session-restored',
      path: '/cluster/restored'
    }
    const placement: WorkspaceHostPlacement = {
      locator,
      session: {
        protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
        serverVersion: '1.0.0',
        serverInstanceId: 'server-restored',
        sessionId: locator.hostSessionId,
        lifecycleMode: 'persistent-daemon',
        locator,
        platform: { os: 'linux', architecture: 'x64' },
        capabilities: [],
        contributions: [],
        eventSequence: 0,
        replay: { earliestSequence: 0, latestSequence: 0 },
        egress: { mode: 'none', status: 'disabled' }
      }
    }
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [codex],
      services: {
        workspaceHosts: {
          resolvePlacement: vi.fn(async () => placement)
        }
      }
    })
    const threadInput = { runtimeId: 'codex' as const, threadId: 'codex-thread', workspaceLocator: locator }

    await host.readThreadSnapshot(threadInput)
    await host.readThreadStatus(threadInput)
    await host.readThreadPage({ ...threadInput, limit: 20 })
    await host.interruptTurn({ ...threadInput, turnId: 'turn-1' })
    const events = host.subscribeEvents(threadInput)[Symbol.asyncIterator]()
    await events.next()
    await events.return?.()
    await host.resolveApproval({ ...threadInput, approvalId: 'approval-1', decision: 'allowed' })
    await host.resolveUserInput({ ...threadInput, requestId: 'request-1', answers: [] })
    await host.renameThread({ ...threadInput, title: 'Renamed' })
    await host.compactThread(threadInput)
    await host.forkThread(threadInput)
    await host.updateThreadRelation({ ...threadInput, relation: 'primary' })
    await host.auxiliary({
      runtimeId: 'codex',
      operation: 'reviewThread',
      payload: { threadId: 'codex-thread' },
      workspaceLocator: locator
    })
    await host.deleteThread(threadInput)

    const calledWithPlacedContext = (mock: ReturnType<typeof vi.fn>) =>
      expect(mock).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceHost: placement }),
        expect.objectContaining({ workspaceLocator: locator })
      )
    calledWithPlacedContext(vi.mocked(codex.snapshot))
    calledWithPlacedContext(vi.mocked(codex.interruptTurn))
    calledWithPlacedContext(vi.mocked(codex.resolveApproval))
    calledWithPlacedContext(vi.mocked(codex.resolveUserInput))
    calledWithPlacedContext(vi.mocked(codex.renameThread))
    calledWithPlacedContext(vi.mocked(codex.compactThread))
    calledWithPlacedContext(vi.mocked(codex.forkThread!))
    calledWithPlacedContext(vi.mocked(codex.updateThreadRelation!))
    calledWithPlacedContext(vi.mocked(codex.auxiliary!))
    calledWithPlacedContext(vi.mocked(codex.deleteThread))
    expect(codex.subscribeEvents).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceHost: placement }),
      expect.objectContaining({ workspaceLocator: locator })
    )
  })

  it('rejects an oversized adapter page before it reaches the Electron delivery boundary', async () => {
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-07-30T00:00:00.000Z'
    })
    codex.readThreadPage = vi.fn(async () => ({
      runtimeId: 'codex' as const,
      threadId: 'codex-thread',
      latestSeq: 1,
      turns: [{
        id: 'turn-1',
        threadId: 'codex-thread',
        status: 'completed' as const,
        items: [{
          id: 'assistant-1',
          kind: 'assistant_message' as const,
          text: 'x'.repeat(5 * 1024 * 1024)
        }]
      }],
      nextCursor: null
    }))
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [codex]
    })

    await expect(host.readThreadPage({
      runtimeId: 'codex',
      threadId: 'codex-thread'
    })).rejects.toMatchObject({
      code: 'agent_runtime_thread_page_too_large',
      maxBytes: 4 * 1024 * 1024
    })
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
      readThreadStatus: vi.fn(async () => ({
        ok: true as const,
        thread: {
          id: 'codex-thread',
          title: 'Codex',
          updatedAt: '2026-06-10T00:00:00.000Z',
          model: 'gpt-5',
          mode: 'agent',
          latestTurnId: 'turn-1'
        },
        latestSeq: 3
      })),
      readThreadPage: vi.fn(async () => ({
        ok: true as const,
        nextCursor: null,
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
      readToolArtifact: vi.fn(async () => ({ ok: true as const, content: '' })),
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
      subscribeEvents: vi.fn(async function* () {
        for (const event of [
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
        ]) yield event
      })
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
    await expect(adapter.usage(ctx, {
      runtimeId: 'codex',
      groupBy: 'thread',
      threadId: 'codex-thread'
    })).resolves.toEqual({
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
    await expect(adapter.readThreadPage(ctx, { runtimeId: 'codex', threadId: 'codex-thread' })).resolves.toMatchObject({
      threadId: 'codex-thread',
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
    vi.mocked(service.readThreadPage).mockResolvedValueOnce({
      ok: true as const,
      nextCursor: null,
      detail: {
        latestSeq: 1,
        threadStatus: 'running',
        blocks: []
      }
    })
    const emptyDetail = await adapter.readThreadPage(ctx, { runtimeId: 'codex', threadId: 'empty-codex-thread' })
    expect(emptyDetail).toMatchObject({
      threadId: 'empty-codex-thread',
      runtimeId: 'codex',
      latestSeq: 1,
      turns: []
    })
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
      workspace: undefined,
      fileReferences: undefined,
      ownedVisualToolsAvailable: false,
      nativeVisualProofChainPending: false
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
        itemId: 'agent_message-5-0'
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
