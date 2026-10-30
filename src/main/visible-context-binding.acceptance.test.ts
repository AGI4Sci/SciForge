/**
 * Independent acceptance test for the per-turn canonical-visible-state binding.
 *
 * Owner: verifier (task-4). Write scope: this file only.
 *
 * This test deliberately drives the REAL production path end to end:
 *
 *   renderer publication -> `visibleContext:publish` IPC handler
 *     -> real VisibleContextService (per-window publication map + persisted snapshot)
 *     -> `agentRuntime:startTurn` IPC handler
 *     -> real AgentRuntimeHost.withCanonicalVisibleState
 *     -> real adapter dispatch text (the packet the model receives)
 *
 * Nothing under test is mocked: the IPC dispatcher, the visible-context service,
 * the host and the packet renderer are the shipped implementations. Only the
 * Electron shell, the settings store and the agent runtime *adapter* are fakes,
 * because the adapter is the boundary at which the packet becomes observable.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultSkillsSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import {
  VISIBLE_CONTEXT_BINDING_FAILURE_REASONS,
  VISIBLE_CONTEXT_SCHEMA_VERSION,
  describeVisibleContextBindingFailure,
  type VisibleContextPublishInput,
  type VisibleContextSnapshot
} from '../shared/visible-context'
import type {
  AgentRuntimeCapabilities,
  AgentRuntimeId,
  AgentRuntimeThread
} from '../shared/agent-runtime-contract'
import type { AgentRuntimeAdapter, AgentRuntimeAdapterContext } from './runtime/agent-runtime/adapter'
import { createAgentRuntimeHost } from './runtime/agent-runtime/host'
import { VisibleContextService } from './services/visible-context-service'
import { ControlledProcessService } from './processes/controlled-process-service'
import { WorkspacePlacementRouter } from './services/workspace-placement-router'

const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>()

vi.mock('electron', () => ({
  app: {
    getFileIcon: vi.fn(async () => ({ isEmpty: () => false })),
    quit: vi.fn()
  },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openExternal: vi.fn(async () => undefined) },
  nativeImage: { createEmpty: vi.fn(() => ({ isEmpty: () => true })) },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) => {
      handlers.set(channel, handler)
    })
  }
}))

const RUNTIME_ID = 'codex'
const WINDOW_SENDER_ID = 12
const VISIBLE_WINDOW_ID = `electron:${WINDOW_SENDER_ID}`
const TURN_THREAD_ID = 'thread-a'
const TURN_CALLER_ID = `${RUNTIME_ID}:${TURN_THREAD_ID}`
const RIGHT_SIDEBAR_RESOURCE_REF = 'res_annotationpanel00000000000001'
const RIGHT_SIDEBAR_COMPONENT_ID = 'right-sidebar.file-preview'
const PUBLISHED_AT = '2026-08-18T06:28:16.000Z'
const NOW = (): Date => new Date('2026-08-18T06:28:20.000Z')

/**
 * Every classified cause must be a sentence, never a bare "unavailable"; a bound
 * packet must contain none of them. Derived from the shared contract so a new
 * reason cannot silently escape this suite.
 */
const ALL_CAUSE_LINES = VISIBLE_CONTEXT_BINDING_FAILURE_REASONS.map(
  describeVisibleContextBindingFailure
)

function expectNoCauseLine(packet: string): void {
  for (const cause of ALL_CAUSE_LINES) expect(packet).not.toContain(cause)
}

/** The service contract reports EXACTLY ONE reason on every null return. */
function expectOnlyCauseLine(
  packet: string,
  reason: (typeof VISIBLE_CONTEXT_BINDING_FAILURE_REASONS)[number]
): void {
  expect(packet).toContain(describeVisibleContextBindingFailure(reason))
  for (const other of VISIBLE_CONTEXT_BINDING_FAILURE_REASONS) {
    if (other !== reason) expect(packet).not.toContain(describeVisibleContextBindingFailure(other))
  }
}

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    activeAgentRuntime: 'codex',
    modelRouter: defaultModelRouterSettings(),
    agents: { sciforge: defaultLocalRuntimeSettings() },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    skills: defaultSkillsSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

/** One right-sidebar annotation-panel component with a capability resource. */
function rightSidebarComponents(componentId = RIGHT_SIDEBAR_COMPONENT_ID) {
  return [{
    id: componentId,
    region: 'right-sidebar',
    component: 'workspace-preview',
    title: 'paper.pdf',
    visible: true,
    updatedAt: PUBLISHED_AT,
    summary: 'Previewing the bound paper with its annotation panel.',
    state: {
      mode: 'file',
      presentation: {
        kind: 'document',
        position: { index: 3, count: 42 },
        visibleContent: { kind: 'text', text: 'VOYAGER current page excerpt' }
      }
    },
    resources: [{
      kind: 'workspaceFile',
      role: 'preview-target',
      title: 'paper.pdf',
      capability: { resourceRef: RIGHT_SIDEBAR_RESOURCE_REF },
      annotationCount: 4,
      openThreadCount: 2
    }]
  }]
}

function publishInput(
  revision: number,
  activeThreadId: string | null,
  route: string,
  componentId = RIGHT_SIDEBAR_COMPONENT_ID
): VisibleContextPublishInput {
  return {
    schemaVersion: VISIBLE_CONTEXT_SCHEMA_VERSION,
    revision,
    publishedAt: PUBLISHED_AT,
    freshness: { stale: false, ageMs: 0, staleAfterMs: 5_000 },
    activeThreadId,
    workspaceRoot: '/tmp/workspace',
    route,
    components: rightSidebarComponents(componentId)
  }
}

function capabilities(runtimeId: AgentRuntimeId): AgentRuntimeCapabilities {
  return {
    contractVersion: 1,
    runtimeId,
    transport: 'jsonrpc_stdio',
    events: { live: true, replayable: true, sequenced: true, delivery: 'ipc' },
    threadMaterialization: 'after_first_user_message',
    latency: { phaseEvents: false, firstTokenMetric: false, turnDurationMetric: false },
    reasoning: { available: false, streaming: false, visibility: 'none', source: 'unknown' },
    model: { inputModalities: ['text'], outputModalities: ['text'], supportsToolCalling: false },
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
    guard: { execution: 'observe' },
    storage: {
      guiOwnedThreads: false,
      backendThreadIdStable: false,
      usage: false,
      attachments: { available: false },
      memory: { available: false }
    }
  }
}

/** Captures exactly what the model would receive, then returns a turn handle. */
function recordingAdapter(thread: AgentRuntimeThread): AgentRuntimeAdapter & {
  dispatched: Array<{ text: string; displayText?: string; owner?: string; raw: Record<string, unknown> }>
} {
  const dispatched: Array<{ text: string; displayText?: string; owner?: string; raw: Record<string, unknown> }> = []
  const adapter = {
    id: RUNTIME_ID,
    transport: 'jsonrpc_stdio' as const,
    probe: vi.fn(async () => ({
      runtimeId: RUNTIME_ID,
      available: false,
      executablePath: null,
      source: null,
      version: null,
      protocol: null,
      failure: { code: 'runtime_probe_unsupported' }
    })),
    connect: vi.fn(async () => undefined),
    capabilities: vi.fn(async () => capabilities(RUNTIME_ID)),
    listThreads: vi.fn(async () => [thread]),
    startThread: vi.fn(async () => thread),
    snapshot: vi.fn(async () => ({ ...thread, latestSeq: 0, items: [] })),
    readThreadStatus: vi.fn(async () => ({ ...thread, latestSeq: 0 })),
    readThreadPage: vi.fn(async () => ({
      runtimeId: RUNTIME_ID,
      threadId: thread.id,
      latestSeq: 0,
      turns: [],
      nextCursor: null
    })),
    readToolArtifact: vi.fn(async (_context: unknown, input: unknown) => ({ ...(input as object), content: '' })),
    usage: vi.fn(async () => ({
      supported: true as const,
      groupBy: 'thread' as const,
      buckets: [],
      totals: { totalTokens: 0 }
    })),
    startTurn: vi.fn(async (
      _context: AgentRuntimeAdapterContext,
      input: { text: string; displayText?: string; visibleContextOwnerThreadId?: string }
    ) => {
      dispatched.push({
        text: input.text,
        ...(input.displayText ? { displayText: input.displayText } : {}),
        ...(input.visibleContextOwnerThreadId ? { owner: input.visibleContextOwnerThreadId } : {}),
        raw: input as unknown as Record<string, unknown>
      })
      return { threadId: thread.id, turnId: `${RUNTIME_ID}-turn-1` }
    }),
    interruptTurn: vi.fn(async () => undefined),
    steerTurn: vi.fn(async () => undefined),
    renameThread: vi.fn(async () => undefined),
    deleteThread: vi.fn(async () => undefined),
    updateThreadRelation: vi.fn(async () => undefined),
    subscribeEvents: vi.fn(async function* () {
      yield { kind: 'heartbeat', threadId: thread.id, runtimeId: RUNTIME_ID, seq: 0 }
    }),
    publishSyntheticEvent: vi.fn(async (_context: unknown, event: unknown) => event),
    dispatched
  }
  return adapter as unknown as AgentRuntimeAdapter & typeof adapter
}

function registerOptions(overrides: Record<string, unknown> = {}) {
  const workspacePlacement = new WorkspacePlacementRouter({
    sessionManager: {
      portFor: () => {
        throw new Error('Remote Workspace Host is unavailable in this test.')
      }
    },
    localControlledProcesses: new ControlledProcessService()
  })
  return {
    store: { load: vi.fn(async () => settings()) } as never,
    actionGuardEvaluator: { evaluate: vi.fn(async () => ({ allowed: true })) },
    getMainWindow: () => null,
    isTrustedIpcSender: () => true,
    applySettingsPatch: vi.fn(async () => settings()),
    getModelAccessStatus: vi.fn(async () => ({
      setupRequired: false,
      mode: 'api' as const,
      service: 'model-router' as const,
      health: 'healthy' as const,
      adapterId: null,
      credentialState: 'configured' as const,
      protocol: null,
      protocolState: 'pending-first-request' as const,
      traceCaptureReady: true,
      action: 'The wire protocol will be confirmed by the first real request.'
    })),
    fetchUpstreamModels: vi.fn() as never,
    getScheduleRuntime: () => null,
    showTurnCompleteNotification: vi.fn() as never,
    getAppVersion: () => '0.1.0',
    readGuiUpdateState: vi.fn() as never,
    loadGuiUpdaterModule: vi.fn() as never,
    resolveLogDirectory: () => '/tmp/logs',
    logError: vi.fn(),
    workspacePlacement,
    ...overrides
  } as never
}

type Harness = {
  userDataDir: string
  visibleContext: VisibleContextService
  adapter: ReturnType<typeof recordingAdapter>
  host: ReturnType<typeof createAgentRuntimeHost>
  pendingRefreshes: Array<Promise<unknown>>
  publishFromRenderer: (input: VisibleContextPublishInput) => Promise<VisibleContextSnapshot>
  startTurnViaIpc: (payload: Record<string, unknown>) => Promise<unknown>
}

async function createHarness(options: {
  /** Pre-existing publication, as if the renderer had already published. */
  initialPublish?: VisibleContextPublishInput
  /**
   * What the renderer answers each `onRefreshRequested` with, in order. A live
   * renderer answers every refresh with a strictly higher revision, which is what
   * lets the service's bounded polling loop resolve immediately instead of
   * waiting for its 1s per-attempt timeout.
   */
  onRefresh?: (refreshIndex: number) => VisibleContextPublishInput | undefined
  /** Reuse a directory to model a renderer reload against a fresh in-memory map. */
  userDataDir?: string
  /** Injected production binding hook; used to reach the broker-not-ready path. */
  retainResourceRefs?: () => () => void
  /**
   * Injects a REJECTED preparation at the service boundary (the IPC handler and
   * the Host stay real). Used to verify that a rejected preparation is
   * classified instead of degrading into a bare "unavailable".
   */
  rejectSurfacePreparation?: boolean
} = {}): Promise<Harness> {
  const userDataDir = options.userDataDir ?? mkdtempSync(join(tmpdir(), 'sciforge-visible-context-acceptance-'))
  if (!options.userDataDir) tempDirs.push(userDataDir)
  const pendingRefreshes: Array<Promise<unknown>> = []
  let refreshIndex = 0
  let publishFromRenderer!: (input: VisibleContextPublishInput) => Promise<VisibleContextSnapshot>
  const visibleContext = new VisibleContextService(userDataDir, {
    surfaceCaptureProvider: { capture: vi.fn() },
    now: NOW,
    ...(options.retainResourceRefs ? { retainResourceRefs: options.retainResourceRefs } : {}),
    requestSurfaceRefresh: () => {
      // Emulates the renderer answering `onRefreshRequested` during a turn start.
      const answer = options.onRefresh?.(refreshIndex)
      refreshIndex += 1
      if (answer) pendingRefreshes.push(publishFromRenderer(answer))
    }
  })
  const thread: AgentRuntimeThread = {
    id: TURN_THREAD_ID,
    runtimeId: RUNTIME_ID,
    title: 'Thread A',
    updatedAt: PUBLISHED_AT
  }
  const adapter = recordingAdapter(thread)
  // The IPC handler and the Host are the shipped implementations in every case;
  // only the binding service can be swapped for a rejecting stub in cases h)/j).
  const bindingService: never = (options.rejectSurfacePreparation
    ? {
        prepareSurfaceBinding: vi.fn(async () => {
          throw new Error('CapabilityBrokerError: invalid_resource_handle')
        }),
        bindSurface: vi.fn(async () => {
          throw new Error('CapabilityBrokerError: invalid_resource_handle')
        }),
        publish: visibleContext.publish.bind(visibleContext)
      }
    : visibleContext) as never
  const host = createAgentRuntimeHost({
    settings: async () => settings(),
    adapters: [adapter],
    services: { visibleContext: bindingService }
  })
  const { registerAppIpcHandlers } = await import('./ipc/register-app-ipc-handlers')
  registerAppIpcHandlers(registerOptions({ agentRuntime: host, visibleContext: bindingService }))
  const sender = { id: WINDOW_SENDER_ID, capturePage: vi.fn(async () => undefined) }

  publishFromRenderer = async (input: VisibleContextPublishInput): Promise<VisibleContextSnapshot> =>
    await handlers.get('visibleContext:publish')?.({ sender }, input) as VisibleContextSnapshot

  if (options.initialPublish) await publishFromRenderer(options.initialPublish)

  return {
    userDataDir,
    visibleContext,
    adapter,
    host,
    pendingRefreshes,
    publishFromRenderer,
    startTurnViaIpc: async (payload) => handlers.get('agentRuntime:startTurn')?.({ sender }, payload)
  }
}

const tempDirs: string[] = []
let harness: Harness | null = null

beforeEach(() => {
  handlers.clear()
  vi.clearAllMocks()
})

afterEach(async () => {
  if (harness) await Promise.allSettled(harness.pendingRefreshes)
  harness?.host.dispose()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  harness = null
})

describe('canonical visible-state binding (acceptance, end to end through IPC)', () => {
  it('a) binds a turn to its own published session and ships the right-sidebar resource catalog', async () => {
    harness = await createHarness({
      initialPublish: publishInput(1, TURN_THREAD_ID, '/electron:12/initial'),
      onRefresh: () => publishInput(2, TURN_THREAD_ID, '/electron:12/after-submit')
    })

    await expect(harness.startTurnViaIpc({
      runtimeId: RUNTIME_ID,
      threadId: TURN_THREAD_ID,
      text: 'read the right-side annotations'
    })).resolves.toMatchObject({ threadId: TURN_THREAD_ID })

    expect(harness.adapter.dispatched).toHaveLength(1)
    const packet = harness.adapter.dispatched[0]!.text

    expect(packet).toContain('Canonical visible state bound atomically for this turn:')
    expect(packet).not.toContain('Canonical visible state for this turn: unavailable.')
    expect(packet).toContain(`"windowId": "${VISIBLE_WINDOW_ID}"`)
    expect(packet).toContain(`"activeThreadId": "${TURN_THREAD_ID}"`)
    expect(packet).toContain('"region": "right-sidebar"')

    // d) the annotation-panel resource the agent must be able to discover.
    expect(packet).toContain(RIGHT_SIDEBAR_COMPONENT_ID)
    expect(packet).toContain(RIGHT_SIDEBAR_RESOURCE_REF)
    expect(packet).toContain('"kind": "workspaceFile"')
    expect(packet).toContain('VOYAGER current page excerpt')

    // The binding is retained for the turn, not merely rendered.
    expect(harness.visibleContext.boundSurface(TURN_CALLER_ID)).not.toBeNull()

    // Internal binding plumbing must never reach the runtime adapter.
    const dispatchedInput = harness.adapter.dispatched[0]!.raw
    expect(dispatchedInput).not.toHaveProperty('visibleContextSurfaceId')
    expect(dispatchedInput).not.toHaveProperty('visibleContextBindingId')
    expect(dispatchedInput).not.toHaveProperty('visibleContextBindingAttempted')
    expect(dispatchedInput).not.toHaveProperty('visibleContextBindingFailure')
  })

  it('b) binds when the renderer forwards a BLANK owner thread (blank owner must not kill the turn)', async () => {
    harness = await createHarness({
      initialPublish: publishInput(1, TURN_THREAD_ID, '/electron:12/initial'),
      onRefresh: () => publishInput(2, TURN_THREAD_ID, '/electron:12/after-submit')
    })

    await expect(harness.startTurnViaIpc({
      runtimeId: RUNTIME_ID,
      threadId: TURN_THREAD_ID,
      text: 'read the right-side annotations',
      visibleContextOwnerThreadId: '   '
    })).resolves.toMatchObject({ threadId: TURN_THREAD_ID })

    const packet = harness.adapter.dispatched[0]!.text
    expect(packet).toContain('Canonical visible state bound atomically for this turn:')
    expect(packet).toContain(RIGHT_SIDEBAR_RESOURCE_REF)
    expect(harness.visibleContext.boundSurface(TURN_CALLER_ID)).not.toBeNull()
  })

  it('c) never claims another session`s publication and reports a precise cause', async () => {
    // A live renderer answers every refresh with a strictly higher revision, so
    // the bounded polling loop resolves in milliseconds for the whole budget.
    harness = await createHarness({
      initialPublish: publishInput(1, 'thread-other', '/electron:12/other-session', 'right-sidebar.other-session-secret'),
      onRefresh: (index) =>
        publishInput(2 + index, 'thread-other', '/electron:12/other-session', 'right-sidebar.other-session-secret')
    })

    await expect(harness.startTurnViaIpc({
      runtimeId: RUNTIME_ID,
      threadId: TURN_THREAD_ID,
      text: 'read the right-side annotations'
    })).resolves.toMatchObject({ threadId: TURN_THREAD_ID })

    const packet = harness.adapter.dispatched[0]!.text
    expect(packet).not.toContain('Canonical visible state bound atomically for this turn:')
    expect(packet).not.toContain('right-sidebar.other-session-secret')
    expect(packet).not.toContain('"activeThreadId": "thread-other"')
    // Not a bare "unavailable": the cause must be precise and non-silent.
    expect(packet).toContain('Canonical visible state for this turn: unavailable.')
    expectOnlyCauseLine(packet, 'thread_mismatch')
    expect(harness.visibleContext.boundSurface(TURN_CALLER_ID)).toBeNull()
    // The cause is consumed by the packet renderer, never forwarded to the adapter.
    expect(harness.adapter.dispatched[0]!.raw).not.toHaveProperty('visibleContextBindingFailure')
  })

  it('d) does not credit a window that never published, and says so', async () => {
    harness = await createHarness()

    // A silent window cannot answer the refresh, so the turn must observe the
    // full bounded polling budget before it reports the cause. Drive that budget
    // with fake timers instead of lengthening the test timeout.
    vi.useFakeTimers()
    try {
      const turn = harness.startTurnViaIpc({
        runtimeId: RUNTIME_ID,
        threadId: TURN_THREAD_ID,
        text: 'read the right-side annotations'
      })
      await vi.advanceTimersByTimeAsync(20_000)
      await expect(turn).resolves.toMatchObject({ threadId: TURN_THREAD_ID })
    } finally {
      vi.useRealTimers()
    }

    const packet = harness.adapter.dispatched[0]!.text
    expect(packet).not.toContain('Canonical visible state bound atomically for this turn:')
    expect(packet).toContain('Canonical visible state for this turn: unavailable.')
    expectOnlyCauseLine(packet, 'window_unpublished')
    expect(harness.visibleContext.boundSurface(TURN_CALLER_ID)).toBeNull()
  })

  it('d2) still binds when the window switches to the turn`s session during the bounded wait (self-heal)', async () => {
    // The renderer's shell can switch sessions tens of ms after the send: the
    // first refresh still belongs to another session, the next one belongs to
    // this turn. A single observed mismatch must not end the loop.
    harness = await createHarness({
      onRefresh: (index) => index === 0
        ? publishInput(1, 'thread-other', '/electron:12/other-session', 'right-sidebar.other-session-secret')
        : publishInput(2 + index, TURN_THREAD_ID, '/electron:12/self-healed')
    })

    await expect(harness.startTurnViaIpc({
      runtimeId: RUNTIME_ID,
      threadId: TURN_THREAD_ID,
      text: 'read the right-side annotations'
    })).resolves.toMatchObject({ threadId: TURN_THREAD_ID })

    const packet = harness.adapter.dispatched[0]!.text
    expect(packet).toContain('Canonical visible state bound atomically for this turn:')
    expect(packet).toContain(RIGHT_SIDEBAR_RESOURCE_REF)
    expect(packet).toContain(`"activeThreadId": "${TURN_THREAD_ID}"`)
    expect(packet).not.toContain('right-sidebar.other-session-secret')
    expectNoCauseLine(packet)
    expect(harness.visibleContext.boundSurface(TURN_CALLER_ID)).not.toBeNull()
  })

  it('e) binds from the persisted publication when this process holds no live one (renderer reload)', async () => {
    const first = await createHarness({
      initialPublish: publishInput(7, TURN_THREAD_ID, '/electron:12/persisted')
    })
    const sharedDir = first.userDataDir
    first.host.dispose()

    // Fresh service and host over the same user data directory: the in-memory
    // per-window publication map is empty, exactly as after a renderer reload,
    // and the reloaded window stays silent for the whole bounded budget.
    harness = await createHarness({ userDataDir: sharedDir })
    expect(harness.visibleContext.peek().windowId).toBe('unavailable')

    vi.useFakeTimers()
    try {
      const turn = harness.startTurnViaIpc({
        runtimeId: RUNTIME_ID,
        threadId: TURN_THREAD_ID,
        text: 'read the right-side annotations'
      })
      await vi.advanceTimersByTimeAsync(20_000)
      await expect(turn).resolves.toMatchObject({ threadId: TURN_THREAD_ID })
    } finally {
      vi.useRealTimers()
    }

    const packet = harness.adapter.dispatched[0]!.text
    expect(packet).toContain('Canonical visible state bound atomically for this turn:')
    expect(packet).toContain(RIGHT_SIDEBAR_RESOURCE_REF)
  })

  it('f) applies the SAME owner rule on a direct host turn (no second owner-resolution rule)', async () => {
    harness = await createHarness({
      initialPublish: publishInput(1, TURN_THREAD_ID, '/electron:12/initial'),
      onRefresh: () => publishInput(2, TURN_THREAD_ID, '/electron:12/after-submit')
    })

    // Host-direct path (no IPC): a blank declared owner must resolve exactly like
    // the IPC path — to the turn's own thread — and still bind.
    await harness.host.startTurn({
      runtimeId: RUNTIME_ID,
      threadId: TURN_THREAD_ID,
      text: 'read the right-side annotations',
      visibleContextOwnerThreadId: '  ',
      visibleContextSurfaceId: VISIBLE_WINDOW_ID
    })

    const packet = harness.adapter.dispatched[0]!.text
    expect(packet).toContain('Canonical visible state bound atomically for this turn:')
    expect(packet).toContain(RIGHT_SIDEBAR_RESOURCE_REF)
  })
})

describe('binding failures are never silent', () => {
  it('g) still binds when resource retention throws (broker rejects a retired/unknown resourceRef)', async () => {
    // `src/main/index.ts:1237-1239` wires retainResourceRefs so that it THROWS
    // when the capability broker is not ready, and broker.retainResourceRefs
    // throws for a resourceRef that is no longer authorized (the user's live log
    // shows `invalid_resource_handle` while their failing turn ran). Retention is
    // best effort: the same-window same-session snapshot must still bind, with no
    // release function and no binding failure.
    harness = await createHarness({
      initialPublish: publishInput(1, TURN_THREAD_ID, '/electron:12/initial'),
      onRefresh: (index) => publishInput(2 + index, TURN_THREAD_ID, '/electron:12/after-submit'),
      retainResourceRefs: () => {
        throw new Error('CapabilityBrokerError: invalid_resource_handle')
      }
    })

    await expect(harness.startTurnViaIpc({
      runtimeId: RUNTIME_ID,
      threadId: TURN_THREAD_ID,
      text: 'read the right-side annotations'
    })).resolves.toMatchObject({ threadId: TURN_THREAD_ID })

    const packet = harness.adapter.dispatched[0]!.text
    // The user-visible root-cause fix: the turn still sees the right sidebar.
    expect(packet).toContain('Canonical visible state bound atomically for this turn:')
    expect(packet).toContain(RIGHT_SIDEBAR_COMPONENT_ID)
    expect(packet).toContain(RIGHT_SIDEBAR_RESOURCE_REF)
    expect(packet).not.toContain('Canonical visible state for this turn: unavailable.')
    expectNoCauseLine(packet)
    expect(harness.visibleContext.boundSurface(TURN_CALLER_ID)).not.toBeNull()
  })

  it('h) classifies a REJECTED preparation as binding_error instead of a bare "unavailable"', async () => {
    harness = await createHarness({
      initialPublish: publishInput(1, TURN_THREAD_ID, '/electron:12/initial'),
      rejectSurfacePreparation: true
    })

    await expect(harness.startTurnViaIpc({
      runtimeId: RUNTIME_ID,
      threadId: TURN_THREAD_ID,
      text: 'read the right-side annotations'
    })).resolves.toMatchObject({ threadId: TURN_THREAD_ID })

    const packet = harness.adapter.dispatched[0]!.text
    expect(packet).toContain('Canonical visible state for this turn: unavailable.')
    expect(packet).not.toContain('Canonical visible state bound atomically for this turn:')
    // The rejection is classified, not swallowed by the IPC `.catch(() => null)`.
    expect(packet).toContain(describeVisibleContextBindingFailure('binding_error'))
    // The turn is degraded, never lost.
    expect(harness.adapter.dispatched).toHaveLength(1)
  })

  it('j) classifies a REJECTED host-direct bindSurface as binding_error too', async () => {
    harness = await createHarness({ rejectSurfacePreparation: true })

    // Host-initiated turn (no IPC preparation): the host calls bindSurface itself.
    await harness.host.startTurn({
      runtimeId: RUNTIME_ID,
      threadId: TURN_THREAD_ID,
      text: 'read the right-side annotations',
      visibleContextSurfaceId: VISIBLE_WINDOW_ID
    })

    const packet = harness.adapter.dispatched[0]!.text
    expect(packet).toContain('Canonical visible state for this turn: unavailable.')
    expect(packet).not.toContain('Canonical visible state bound atomically for this turn:')
    expectOnlyCauseLine(packet, 'binding_error')
  })

  it('i) reports no cause line on a turn that bound', async () => {
    harness = await createHarness({
      initialPublish: publishInput(1, TURN_THREAD_ID, '/electron:12/initial'),
      onRefresh: () => publishInput(2, TURN_THREAD_ID, '/electron:12/after-submit')
    })

    await expect(harness.startTurnViaIpc({
      runtimeId: RUNTIME_ID,
      threadId: TURN_THREAD_ID,
      text: 'read the right-side annotations'
    })).resolves.toMatchObject({ threadId: TURN_THREAD_ID })

    expectNoCauseLine(harness.adapter.dispatched[0]!.text)
  })
})

describe('owner resolution rule is single-sourced', () => {
  it('resolves blank owners to the turn thread and keeps explicit owners', async () => {
    const { resolveVisibleContextOwnerThreadId } = await import('../shared/visible-context')
    expect(resolveVisibleContextOwnerThreadId(undefined, 'thread-a')).toBe('thread-a')
    expect(resolveVisibleContextOwnerThreadId(null, 'thread-a')).toBe('thread-a')
    expect(resolveVisibleContextOwnerThreadId('', 'thread-a')).toBe('thread-a')
    expect(resolveVisibleContextOwnerThreadId('   ', 'thread-a')).toBe('thread-a')
    expect(resolveVisibleContextOwnerThreadId(' other ', 'thread-a')).toBe('other')
  })
})