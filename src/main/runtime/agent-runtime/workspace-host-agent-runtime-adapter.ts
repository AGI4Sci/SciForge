import { randomUUID } from 'node:crypto'
import {
  WORKSPACE_HOST_EVENT_KINDS,
  WORKSPACE_HOST_OPERATIONS,
  type WorkspaceHostEvent,
  type WorkspaceHostPayload,
  type WorkspaceHostRuntimeInvokeInput,
  type WorkspaceHostRuntimeMethod
} from '@sciforge/domain-sdk/workspace-host'
import {
  AGENT_RUNTIME_EVENT_KINDS,
  createDefaultAgentRuntimeCapabilities,
  type AgentRuntimeCapabilities,
  type AgentRuntimeEvent,
  type AgentRuntimeId,
  type AgentRuntimeThread,
  type AgentRuntimeThreadPage,
  type AgentRuntimeThreadStatus,
  type AgentRuntimeToolArtifact,
  type AgentRuntimeTransport,
  type AgentRuntimeTurnHandle,
  type AgentRuntimeUsageResponse
} from '../../../shared/agent-runtime-contract'
import type { WorkspaceHostSessionPort } from '../../workspace-host/session-manager'
import type {
  AgentRuntimeAdapter,
  AgentRuntimeAdapterContext,
  AgentRuntimeEventSubscribeInput
} from './adapter'

const REMOTE_RUNTIME_CONTRACT_VERSION = 1 as const

export const WORKSPACE_HOST_AGENT_RUNTIME_METHODS = Object.freeze({
  connect: 'connect',
  capabilities: 'capabilities',
  listThreads: 'listThreads',
  startThread: 'startThread',
  readThreadStatus: 'readThreadStatus',
  readThreadPage: 'readThreadPage',
  readToolArtifact: 'readToolArtifact',
  startTurn: 'startTurn',
  interruptTurn: 'interruptTurn',
  steerTurn: 'steerTurn',
  renameThread: 'renameThread',
  deleteThread: 'deleteThread',
  subscribeEvents: 'subscribeEvents',
  unsubscribeEvents: 'unsubscribeEvents',
  publishSyntheticEvent: 'publishSyntheticEvent',
  updateTurnGovernanceSnapshot: 'updateTurnGovernanceSnapshot',
  resolveApproval: 'resolveApproval',
  resolveUserInput: 'resolveUserInput',
  compactThread: 'compactThread',
  forkThread: 'forkThread',
  resumeSession: 'resumeSession',
  updateThreadRelation: 'updateThreadRelation',
  usage: 'usage',
  auxiliary: 'auxiliary'
} as const satisfies Readonly<Record<string, WorkspaceHostRuntimeMethod>>)

export type WorkspaceHostAgentRuntimeMethod = WorkspaceHostRuntimeMethod

export type WorkspaceHostAgentRuntimePortResolver = (
  context: AgentRuntimeAdapterContext
) => WorkspaceHostSessionPort | Promise<WorkspaceHostSessionPort>

export type WorkspaceHostAgentRuntimeAdapterOptions = Readonly<{
  runtimeId: AgentRuntimeId
  transport: AgentRuntimeTransport
  resolvePort: WorkspaceHostAgentRuntimePortResolver
}>

type RuntimeEventPayload = {
  contractVersion: typeof REMOTE_RUNTIME_CONTRACT_VERSION
  runtimeId: AgentRuntimeId
  threadId: string
  streamId: string
  event: AgentRuntimeEvent
}

type QueuedRuntimeEvent = {
  event: AgentRuntimeEvent
}

type RuntimeEventSubscription = {
  queue: AsyncEventQueue<QueuedRuntimeEvent>
  detach: () => void
  attach: () => Promise<void>
  dispose: () => Promise<void>
}

const IDEMPOTENT_MUTATION_METHODS = new Set<WorkspaceHostAgentRuntimeMethod>([
  WORKSPACE_HOST_AGENT_RUNTIME_METHODS.connect,
  WORKSPACE_HOST_AGENT_RUNTIME_METHODS.startThread,
  WORKSPACE_HOST_AGENT_RUNTIME_METHODS.startTurn,
  WORKSPACE_HOST_AGENT_RUNTIME_METHODS.interruptTurn,
  WORKSPACE_HOST_AGENT_RUNTIME_METHODS.steerTurn,
  WORKSPACE_HOST_AGENT_RUNTIME_METHODS.renameThread,
  WORKSPACE_HOST_AGENT_RUNTIME_METHODS.deleteThread,
  WORKSPACE_HOST_AGENT_RUNTIME_METHODS.unsubscribeEvents,
  WORKSPACE_HOST_AGENT_RUNTIME_METHODS.publishSyntheticEvent,
  WORKSPACE_HOST_AGENT_RUNTIME_METHODS.updateTurnGovernanceSnapshot,
  WORKSPACE_HOST_AGENT_RUNTIME_METHODS.resolveApproval,
  WORKSPACE_HOST_AGENT_RUNTIME_METHODS.resolveUserInput,
  WORKSPACE_HOST_AGENT_RUNTIME_METHODS.compactThread,
  WORKSPACE_HOST_AGENT_RUNTIME_METHODS.forkThread,
  WORKSPACE_HOST_AGENT_RUNTIME_METHODS.resumeSession,
  WORKSPACE_HOST_AGENT_RUNTIME_METHODS.updateThreadRelation,
  WORKSPACE_HOST_AGENT_RUNTIME_METHODS.subscribeEvents,
  WORKSPACE_HOST_AGENT_RUNTIME_METHODS.auxiliary
])

/**
 * Adapts the neutral AgentRuntime contract to the Workspace Host multiplexed
 * transport. Runtime identity and placement stay orthogonal: a remote Codex
 * adapter still has id `codex`, and no SSH/runtime-specific transport is added.
 *
 * The resolver is deliberately injected by desktop composition. This module
 * never resolves SSH targets, handles credentials, or interprets a remote path.
 */
export function createWorkspaceHostAgentRuntimeAdapter(
  options: WorkspaceHostAgentRuntimeAdapterOptions
): AgentRuntimeAdapter {
  const resolvePort = async (
    context: AgentRuntimeAdapterContext
  ): Promise<WorkspaceHostSessionPort> => {
    const port = await options.resolvePort(context)
    const session = port.getSession()
    if (session.protocolVersion !== REMOTE_RUNTIME_CONTRACT_VERSION) {
      throw new WorkspaceHostAgentRuntimeError(
        'compatibility-error',
        `Workspace Host protocol ${session.protocolVersion} cannot run AgentRuntime contract ${REMOTE_RUNTIME_CONTRACT_VERSION}.`
      )
    }
    return port
  }

  const invoke = async <Result>(
    context: AgentRuntimeAdapterContext,
    method: WorkspaceHostAgentRuntimeMethod,
    input?: unknown,
    request: {
      signal?: AbortSignal
      streamId?: string
      includeGovernance?: boolean
    } = {}
  ): Promise<Result> => {
    const client = await resolvePort(context)
    ensureRuntimeCapability(client)
    const payload: WorkspaceHostRuntimeInvokeInput = {
      contractVersion: REMOTE_RUNTIME_CONTRACT_VERSION,
      runtimeId: options.runtimeId,
      method,
      ...(input === undefined ? {} : { input: toWorkspaceHostPayload(input) }),
      ...(request.streamId ? { streamId: request.streamId } : {}),
      ...(request.includeGovernance && context.turnGovernanceSnapshot
        ? {
            context: {
              turnGovernanceSnapshot: {
                ownedVisualToolsAvailable:
                  context.turnGovernanceSnapshot.ownedVisualToolsAvailable,
                nativeVisualProofChainPending:
                  context.turnGovernanceSnapshot.nativeVisualProofChainPending
              }
            }
          }
        : {})
    }
    const requestOptions = {
      ...(request.signal ? { signal: request.signal } : {}),
      ...(IDEMPOTENT_MUTATION_METHODS.has(method)
        ? { idempotencyKey: `agent-runtime-${randomUUID()}` }
        : {})
    }
    const response = await client.request(
      WORKSPACE_HOST_OPERATIONS.runtimeInvoke,
      payload,
      requestOptions
    )
    return unwrapRuntimeResult<Result>(response, options.runtimeId, method)
  }

  return {
    id: options.runtimeId,
    transport: options.transport,

    async connect(context) {
      await invoke(context, WORKSPACE_HOST_AGENT_RUNTIME_METHODS.connect)
    },

    async capabilities(context) {
      const client = await resolvePort(context)
      if (!hasRuntimeCapability(client)) {
        return unavailableRemoteCapabilities(
          options.runtimeId,
          options.transport,
          'Workspace Host does not advertise remote AgentRuntime support.'
        )
      }
      try {
        const capabilities = await invoke<AgentRuntimeCapabilities>(
          context,
          WORKSPACE_HOST_AGENT_RUNTIME_METHODS.capabilities
        )
        assertCapabilities(capabilities, options.runtimeId, options.transport)
        return withWorkspaceHostRuntimeCapabilities(capabilities, client)
      } catch (error) {
        if (failureCode(error) !== 'unsupported-operation') throw error
        return unavailableRemoteCapabilities(
          options.runtimeId,
          options.transport,
          `Workspace Host does not provide remote ${options.runtimeId}.`
        )
      }
    },

    async listThreads(context, input) {
      const threads = await invoke<AgentRuntimeThread[]>(
        context,
        WORKSPACE_HOST_AGENT_RUNTIME_METHODS.listThreads,
        input
      )
      assertThreads(threads, options.runtimeId)
      return threads
    },

    async startThread(context, input) {
      const thread = await invoke<AgentRuntimeThread>(
        context,
        WORKSPACE_HOST_AGENT_RUNTIME_METHODS.startThread,
        input
      )
      assertThread(thread, options.runtimeId)
      return thread
    },

    async readThreadStatus(context, input) {
      const status = await invoke<AgentRuntimeThreadStatus>(
        context,
        WORKSPACE_HOST_AGENT_RUNTIME_METHODS.readThreadStatus,
        input
      )
      assertThreadStatus(status, options.runtimeId)
      return status
    },

    async readThreadPage(context, input) {
      const page = await invoke<AgentRuntimeThreadPage>(
        context,
        WORKSPACE_HOST_AGENT_RUNTIME_METHODS.readThreadPage,
        input
      )
      assertRuntimeIdentity(page.runtimeId, options.runtimeId, 'thread page')
      return page
    },

    async readToolArtifact(context, input) {
      const artifact = await invoke<AgentRuntimeToolArtifact>(
        context,
        WORKSPACE_HOST_AGENT_RUNTIME_METHODS.readToolArtifact,
        input
      )
      assertRuntimeIdentity(artifact.runtimeId, options.runtimeId, 'tool artifact')
      return artifact
    },

    async startTurn(context, input) {
      return invoke<AgentRuntimeTurnHandle>(
        context,
        WORKSPACE_HOST_AGENT_RUNTIME_METHODS.startTurn,
        input,
        { includeGovernance: true }
      )
    },

    async interruptTurn(context, input) {
      await invoke(context, WORKSPACE_HOST_AGENT_RUNTIME_METHODS.interruptTurn, input)
    },

    async steerTurn(context, input) {
      await invoke(context, WORKSPACE_HOST_AGENT_RUNTIME_METHODS.steerTurn, input)
    },

    async renameThread(context, input) {
      await invoke(context, WORKSPACE_HOST_AGENT_RUNTIME_METHODS.renameThread, input)
    },

    async deleteThread(context, input) {
      await invoke(context, WORKSPACE_HOST_AGENT_RUNTIME_METHODS.deleteThread, input)
    },

    async *subscribeEvents(context, input) {
      const client = await resolvePort(context)
      ensureRuntimeCapability(client)
      if ((input.sinceSeq ?? 0) > 0 && !hasRuntimeReplayCapability(client)) {
        throw new WorkspaceHostAgentRuntimeError(
          'capability_unavailable',
          'Workspace Host cannot replay remote AgentRuntime events.'
        )
      }
      const subscription = createRuntimeEventSubscription({
        client,
        runtimeId: options.runtimeId,
        input,
        attach: async (streamId, sinceSeq) => {
          await invoke(
            context,
            WORKSPACE_HOST_AGENT_RUNTIME_METHODS.subscribeEvents,
            {
              runtimeId: options.runtimeId,
              threadId: input.threadId,
              sinceSeq
            },
            {
              signal: input.signal,
              streamId
            }
          )
          return hasRuntimeReplayCapability(client)
            ? requestRuntimeReplayEvents(
                client,
                {
                  contractVersion: REMOTE_RUNTIME_CONTRACT_VERSION,
                  runtimeId: options.runtimeId,
                  threadId: input.threadId,
                  sinceSeq,
                  streamId
                },
                input.signal
              )
            : { events: [] }
        },
        detach: (streamId) => invoke(
          context,
          WORKSPACE_HOST_AGENT_RUNTIME_METHODS.unsubscribeEvents,
          {
            runtimeId: options.runtimeId,
            threadId: input.threadId
          },
          { streamId }
        )
      })

      try {
        await subscription.attach()
        for await (const queued of subscription.queue) {
          if (input.signal?.aborted) return
          yield queued.event
        }
      } finally {
        await subscription.dispose()
      }
    },

    async publishSyntheticEvent(context, event) {
      return invoke<AgentRuntimeEvent>(
        context,
        WORKSPACE_HOST_AGENT_RUNTIME_METHODS.publishSyntheticEvent,
        event
      )
    },

    async updateTurnGovernanceSnapshot(context, input) {
      await invoke(
        context,
        WORKSPACE_HOST_AGENT_RUNTIME_METHODS.updateTurnGovernanceSnapshot,
        input
      )
    },

    async resolveApproval(context, input) {
      await invoke(context, WORKSPACE_HOST_AGENT_RUNTIME_METHODS.resolveApproval, input)
    },

    async resolveUserInput(context, input) {
      await invoke(context, WORKSPACE_HOST_AGENT_RUNTIME_METHODS.resolveUserInput, input)
    },

    async compactThread(context, input) {
      await invoke(context, WORKSPACE_HOST_AGENT_RUNTIME_METHODS.compactThread, input)
    },

    async forkThread(context, input) {
      const thread = await invoke<AgentRuntimeThread>(
        context,
        WORKSPACE_HOST_AGENT_RUNTIME_METHODS.forkThread,
        input
      )
      assertThread(thread, options.runtimeId)
      return thread
    },

    async resumeSession(context, input) {
      return invoke(
        context,
        WORKSPACE_HOST_AGENT_RUNTIME_METHODS.resumeSession,
        input
      )
    },

    async updateThreadRelation(context, input) {
      await invoke(context, WORKSPACE_HOST_AGENT_RUNTIME_METHODS.updateThreadRelation, input)
    },

    async usage(context, input) {
      return invoke<AgentRuntimeUsageResponse>(
        context,
        WORKSPACE_HOST_AGENT_RUNTIME_METHODS.usage,
        input
      )
    },

    async auxiliary(context, input) {
      return invoke(
        context,
        WORKSPACE_HOST_AGENT_RUNTIME_METHODS.auxiliary,
        input
      )
    }
  }
}

export function createWorkspaceHostCodexAgentRuntimeAdapter(
  resolvePort: WorkspaceHostAgentRuntimePortResolver
): AgentRuntimeAdapter {
  return createWorkspaceHostAgentRuntimeAdapter({
    runtimeId: 'codex',
    transport: 'jsonrpc_stdio',
    resolvePort
  })
}

/**
 * Keeps one runtime registration while selecting its placement from the
 * resolved workspace context. The intersection rule for optional methods keeps
 * the public adapter truthful across both placements; runtime capabilities
 * still report the finer-grained support for the selected side.
 */
export function createPlacementAwareAgentRuntimeAdapter(
  local: AgentRuntimeAdapter,
  workspaceHost: AgentRuntimeAdapter
): AgentRuntimeAdapter {
  if (local.id !== workspaceHost.id) {
    throw new WorkspaceHostAgentRuntimeError(
      'runtime_identity_mismatch',
      `Placement adapters must share one runtime ID (${local.id} !== ${workspaceHost.id}).`
    )
  }
  if (local.transport !== workspaceHost.transport) {
    throw new WorkspaceHostAgentRuntimeError(
      'compatibility-error',
      `Placement adapters for ${local.id} must report one runtime transport.`
    )
  }

  const selected = (context: AgentRuntimeAdapterContext): AgentRuntimeAdapter =>
    context.workspaceHost ? workspaceHost : local

  return {
    id: local.id,
    transport: local.transport,
    ...(local.subagents || workspaceHost.subagents
      ? {
          subagents: {
            spawn: (context, input) => requireSubagentAdapter(selected(context)).spawn(context, input),
            resume: (context, input) => requireSubagentAdapter(selected(context)).resume(context, input),
            inspect: (context, input) => requireSubagentAdapter(selected(context)).inspect(context, input),
            message: (context, input) => requireSubagentAdapter(selected(context)).message(context, input),
            cancel: (context, input) => requireSubagentAdapter(selected(context)).cancel(context, input),
            delete: (context, input) => requireSubagentAdapter(selected(context)).delete(context, input)
          }
        }
      : {}),
    connect: (context) => selected(context).connect(context),
    capabilities: (context) => selected(context).capabilities(context),
    listThreads: (context, input) => selected(context).listThreads(context, input),
    startThread: (context, input) => selected(context).startThread(context, input),
    readThreadStatus: (context, input) => selected(context).readThreadStatus(context, input),
    readThreadPage: (context, input) => selected(context).readThreadPage(context, input),
    readToolArtifact: (context, input) => selected(context).readToolArtifact(context, input),
    startTurn: (context, input) => selected(context).startTurn(context, input),
    interruptTurn: (context, input) => selected(context).interruptTurn(context, input),
    steerTurn: (context, input) => selected(context).steerTurn(context, input),
    renameThread: (context, input) => selected(context).renameThread(context, input),
    deleteThread: (context, input) => selected(context).deleteThread(context, input),
    subscribeEvents: (context, input) => selected(context).subscribeEvents(context, input),
    usage: (context, input) => selected(context).usage(context, input),
    ...(local.publishSyntheticEvent && workspaceHost.publishSyntheticEvent
      ? {
          publishSyntheticEvent: (context, event) =>
            selected(context).publishSyntheticEvent!(context, event)
        }
      : {}),
    ...(local.updateTurnGovernanceSnapshot && workspaceHost.updateTurnGovernanceSnapshot
      ? {
          updateTurnGovernanceSnapshot: (context, input) =>
            selected(context).updateTurnGovernanceSnapshot!(context, input)
        }
      : {}),
    ...(local.resolveApproval && workspaceHost.resolveApproval
      ? {
          resolveApproval: (context, input) =>
            selected(context).resolveApproval!(context, input)
        }
      : {}),
    ...(local.resolveUserInput && workspaceHost.resolveUserInput
      ? {
          resolveUserInput: (context, input) =>
            selected(context).resolveUserInput!(context, input)
        }
      : {}),
    ...(local.compactThread && workspaceHost.compactThread
      ? {
          compactThread: (context, input) =>
            selected(context).compactThread!(context, input)
        }
      : {}),
    ...(local.forkThread && workspaceHost.forkThread
      ? {
          forkThread: (context, input) =>
            selected(context).forkThread!(context, input)
        }
      : {}),
    ...(local.resumeSession && workspaceHost.resumeSession
      ? {
          resumeSession: (context, input) =>
            selected(context).resumeSession!(context, input)
        }
      : {}),
    ...(local.updateThreadRelation && workspaceHost.updateThreadRelation
      ? {
          updateThreadRelation: (context, input) =>
            selected(context).updateThreadRelation!(context, input)
        }
      : {}),
    ...(local.auxiliary && workspaceHost.auxiliary
      ? {
          auxiliary: (context, input) =>
            selected(context).auxiliary!(context, input)
        }
      : {})
  }
}

function requireSubagentAdapter(adapter: AgentRuntimeAdapter): NonNullable<AgentRuntimeAdapter['subagents']> {
  if (!adapter.subagents) {
    throw new WorkspaceHostAgentRuntimeError(
      'compatibility-error',
      `AgentRuntimeAdapter ${adapter.id} does not support subagent controls for this placement.`
    )
  }
  return adapter.subagents
}

export class WorkspaceHostAgentRuntimeError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'WorkspaceHostAgentRuntimeError'
    this.code = code
  }
}

function createRuntimeEventSubscription(options: {
  client: WorkspaceHostSessionPort
  runtimeId: AgentRuntimeId
  input: AgentRuntimeEventSubscribeInput
  attach: (streamId: string, sinceSeq: number) => Promise<unknown>
  detach: (streamId: string) => Promise<unknown>
}): RuntimeEventSubscription {
  const queue = new AsyncEventQueue<QueuedRuntimeEvent>()
  const streamId = options.input.streamId?.trim() || `runtime-stream-${randomUUID()}`
  let latestRuntimeSequence = options.input.sinceSeq ?? 0
  let attachInFlight: Promise<void> | undefined
  let attachBuffer: QueuedRuntimeEvent[] = []
  let disposed = false

  const enqueue = (queued: QueuedRuntimeEvent): void => {
    if (
      queued.event.threadId !== options.input.threadId ||
      (
        queued.event.runtimeId !== undefined &&
        queued.event.runtimeId !== options.runtimeId
      )
    ) {
      queue.fail(new WorkspaceHostAgentRuntimeError(
        'runtime_identity_mismatch',
        'Remote AgentRuntime event does not belong to the subscribed runtime thread.'
      ))
      return
    }
    const sequence = queued.event.seq
    if (sequence !== undefined && sequence <= latestRuntimeSequence) return
    if (sequence !== undefined && sequence !== latestRuntimeSequence + 1) {
      queue.fail(new WorkspaceHostAgentRuntimeError(
        'replay-gap',
        `Remote AgentRuntime event sequence expected ${
          latestRuntimeSequence + 1
        }, received ${sequence}.`
      ))
      return
    }
    if (sequence !== undefined) latestRuntimeSequence = sequence
    queue.push(queued)
  }

  const flush = (events: QueuedRuntimeEvent[]): void => {
    events
      .map((queued, index) => ({ queued, index }))
      .sort((left, right) => {
        const leftSequence = left.queued.event.seq
        const rightSequence = right.queued.event.seq
        if (leftSequence === undefined && rightSequence === undefined) {
          return left.index - right.index
        }
        if (leftSequence === undefined) return 1
        if (rightSequence === undefined) return -1
        return leftSequence - rightSequence
      })
      .forEach(({ queued }) => enqueue(queued))
  }

  const attach = (): Promise<void> => {
    if (disposed) return Promise.resolve()
    if (attachInFlight) return attachInFlight
    const sinceSeq = latestRuntimeSequence
    attachBuffer = []
    attachInFlight = options.attach(streamId, sinceSeq)
      .then((result) => {
        const replay = runtimeEventsFromAttachResult(result)
        flush([
          ...replay.map((event) => ({ event })),
          ...attachBuffer
        ])
      })
      .finally(() => {
        attachBuffer = []
        attachInFlight = undefined
      })
    return attachInFlight
  }

  const detachListener = options.client.subscribe((hostEvent) => {
    if (hostEvent.kind === WORKSPACE_HOST_EVENT_KINDS.runtimeEvent) {
      const payload = runtimeEventPayload(hostEvent)
      if (
        !payload ||
        payload.runtimeId !== options.runtimeId ||
        payload.threadId !== options.input.threadId ||
        (payload.streamId !== undefined && payload.streamId !== streamId)
      ) {
        return
      }
      const queued = {
        event: payload.event
      }
      if (attachInFlight) attachBuffer.push(queued)
      else enqueue(queued)
    }
  })
  let previousConnectionPhase = options.client.getConnectionSnapshot().phase
  const detachConnectionListener = options.client.subscribeConnection((snapshot) => {
    const prior = previousConnectionPhase
    previousConnectionPhase = snapshot.phase
    if (snapshot.phase === 'connected' && prior === 'reconnecting') {
      void attach().catch((error) => queue.fail(error))
      return
    }
    if (snapshot.phase === 'reconnecting') {
      enqueue({
        event: {
          kind: 'runtime_status',
          runtimeId: options.runtimeId,
          threadId: options.input.threadId,
          phase: 'reconnecting',
          message: 'Workspace Host connection is recovering.'
        }
      })
      return
    }
    if (snapshot.phase === 'replay-required') {
      queue.fail(new WorkspaceHostAgentRuntimeError(
        'replay-gap',
        snapshot.failure?.message ??
          'Workspace Host replay window has a gap; refresh the authoritative thread state.'
      ))
      return
    }
    if (snapshot.phase === 'failed' || snapshot.phase === 'closed') {
      queue.fail(new WorkspaceHostAgentRuntimeError(
        'disconnected',
        snapshot.failure?.message ??
          `Workspace Host session is ${snapshot.phase}.`
      ))
    }
  })

  const closeOnAbort = (): void => queue.close()
  options.input.signal?.addEventListener('abort', closeOnAbort, { once: true })
  if (options.input.signal?.aborted) queue.close()

  return {
    queue,
    detach: detachListener,
    attach,
    async dispose() {
      if (disposed) return
      disposed = true
      options.input.signal?.removeEventListener('abort', closeOnAbort)
      detachListener()
      detachConnectionListener()
      queue.close()
      try {
        await options.detach(streamId)
      } catch {
        // A dead connection or already-disposed remote stream needs no second
        // cleanup path. Session/server lease disposal remains authoritative.
      }
    }
  }
}

async function requestRuntimeReplayEvents(
  client: WorkspaceHostSessionPort,
  payload: {
    contractVersion: 1
    runtimeId: string
    threadId: string
    sinceSeq: number
    streamId?: string
  },
  signal?: AbortSignal
): Promise<WorkspaceHostPayload> {
  return client.request(
    WORKSPACE_HOST_OPERATIONS.runtimeReplayEvents,
    payload,
    signal ? { signal } : undefined
  )
}

function ensureRuntimeCapability(client: WorkspaceHostSessionPort): void {
  if (hasRuntimeCapability(client)) return
  throw new WorkspaceHostAgentRuntimeError(
    'capability_unavailable',
    'Workspace Host does not advertise workspace.runtime.invoke.'
  )
}

function hasRuntimeCapability(client: WorkspaceHostSessionPort): boolean {
  return client.getSession().capabilities.some(
    (capability) => capability.operation === WORKSPACE_HOST_OPERATIONS.runtimeInvoke
  )
}

function hasRuntimeReplayCapability(client: WorkspaceHostSessionPort): boolean {
  return client.getSession().capabilities.some(
    (capability) =>
      capability.operation === WORKSPACE_HOST_OPERATIONS.runtimeReplayEvents
  )
}

function withWorkspaceHostRuntimeCapabilities(
  capabilities: AgentRuntimeCapabilities,
  client: WorkspaceHostSessionPort
): AgentRuntimeCapabilities {
  if (hasRuntimeReplayCapability(client)) return capabilities
  const unavailable = {
    available: false as const,
    reason: 'Workspace Host does not advertise AgentRuntime event replay.'
  }
  return {
    ...capabilities,
    events: {
      ...capabilities.events,
      replayable: false
    },
    ...(capabilities.matrix
      ? {
          matrix: {
            ...capabilities.matrix,
            eventReplay: unavailable
          }
        }
      : {})
  }
}

function unwrapRuntimeResult<Result>(
  response: WorkspaceHostPayload,
  runtimeId: AgentRuntimeId,
  method: WorkspaceHostAgentRuntimeMethod
): Result {
  if (!isRecord(response)) {
    throw invalidRemoteResult(method, 'response must be an object')
  }
  if (response.contractVersion !== REMOTE_RUNTIME_CONTRACT_VERSION) {
    throw invalidRemoteResult(method, 'contract version is incompatible')
  }
  assertRuntimeIdentity(response.runtimeId, runtimeId, `${method} response`)
  if (response.method !== method) {
    throw invalidRemoteResult(method, `received method ${String(response.method)}`)
  }
  if (!Object.prototype.hasOwnProperty.call(response, 'result')) {
    throw invalidRemoteResult(method, 'response is missing result')
  }
  return response.result as Result
}

function runtimeEventsFromAttachResult(result: unknown): AgentRuntimeEvent[] {
  if (Array.isArray(result)) return result.filter(isAgentRuntimeEvent)
  if (!isRecord(result) || !Array.isArray(result.events)) return []
  return result.events.filter(isAgentRuntimeEvent)
}

function runtimeEventPayload(hostEvent: WorkspaceHostEvent): RuntimeEventPayload | null {
  const payload = hostEvent.payload
  if (
    !isRecord(payload) ||
    payload.contractVersion !== REMOTE_RUNTIME_CONTRACT_VERSION ||
    typeof payload.runtimeId !== 'string' ||
    typeof payload.threadId !== 'string' ||
    (payload.streamId !== undefined && typeof payload.streamId !== 'string') ||
    !isAgentRuntimeEvent(payload.event)
  ) {
    return null
  }
  return payload as unknown as RuntimeEventPayload
}

function isAgentRuntimeEvent(value: unknown): value is AgentRuntimeEvent {
  if (!isRecord(value)) return false
  return (
    typeof value.threadId === 'string' &&
    typeof value.kind === 'string' &&
    (AGENT_RUNTIME_EVENT_KINDS as readonly string[]).includes(value.kind)
  )
}

function assertCapabilities(
  capabilities: AgentRuntimeCapabilities,
  runtimeId: AgentRuntimeId,
  transport: AgentRuntimeTransport
): void {
  if (!isRecord(capabilities)) {
    throw invalidRemoteResult('capabilities', 'capabilities must be an object')
  }
  if (capabilities.contractVersion !== 1) {
    throw invalidRemoteResult('capabilities', 'AgentRuntime contract version is incompatible')
  }
  assertRuntimeIdentity(capabilities.runtimeId, runtimeId, 'capabilities')
  if (capabilities.transport !== transport) {
    throw invalidRemoteResult(
      'capabilities',
      `remote transport ${String(capabilities.transport)} does not match ${transport}`
    )
  }
}

function assertThreads(threads: AgentRuntimeThread[], runtimeId: AgentRuntimeId): void {
  if (!Array.isArray(threads)) {
    throw invalidRemoteResult('listThreads', 'threads must be an array')
  }
  for (const thread of threads) assertThread(thread, runtimeId)
}

function assertThread(thread: AgentRuntimeThread, runtimeId: AgentRuntimeId): void {
  if (!isRecord(thread) || typeof thread.id !== 'string') {
    throw invalidRemoteResult('thread', 'thread must have an id')
  }
  assertRuntimeIdentity(thread.runtimeId, runtimeId, `thread ${thread.id}`)
}

function assertThreadStatus(status: AgentRuntimeThreadStatus, runtimeId: AgentRuntimeId): void {
  if (!isRecord(status) || typeof status.id !== 'string' || !Number.isSafeInteger(status.latestSeq)) {
    throw invalidRemoteResult('thread status', 'thread status must have an id and latestSeq')
  }
  assertRuntimeIdentity(status.runtimeId, runtimeId, `thread status ${status.id}`)
}

function assertRuntimeIdentity(
  actual: unknown,
  expected: AgentRuntimeId,
  source: string
): void {
  if (actual === expected) return
  throw new WorkspaceHostAgentRuntimeError(
    'runtime_identity_mismatch',
    `Remote ${source} belongs to runtime ${String(actual)}, expected ${expected}.`
  )
}

function unavailableRemoteCapabilities(
  runtimeId: AgentRuntimeId,
  transport: AgentRuntimeTransport,
  reason: string
): AgentRuntimeCapabilities {
  const capabilities = createDefaultAgentRuntimeCapabilities({ runtimeId, transport })
  const unavailable = { available: false, reason }
  return {
    ...capabilities,
    matrix: capabilities.matrix
      ? Object.fromEntries(
          Object.keys(capabilities.matrix).map((key) => [key, unavailable])
        ) as AgentRuntimeCapabilities['matrix']
      : undefined,
    tools: {
      ...capabilities.tools,
      commandExecution: unavailable,
      fileChange: unavailable,
      mcp: { ...unavailable, search: unavailable },
      web: { ...unavailable, fetch: unavailable, search: unavailable },
      research: unavailable,
      computerUse: unavailable,
      skills: unavailable,
      subagents: unavailable,
      diagnostics: unavailable
    },
    context: {
      state: unavailable,
      compaction: unavailable,
      goalResume: unavailable,
      ledger: unavailable,
      handoff: unavailable
    },
    storage: {
      ...capabilities.storage,
      attachments: unavailable,
      memory: unavailable,
      checkpoints: unavailable,
      workspaceReferences: unavailable
    }
  }
}

function toWorkspaceHostPayload(value: unknown): WorkspaceHostPayload {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) return null
    return JSON.parse(serialized) as WorkspaceHostPayload
  } catch (error) {
    throw new WorkspaceHostAgentRuntimeError(
      'invalid-request',
      `AgentRuntime payload is not JSON serializable: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

function failureCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined
  if (typeof error.code === 'string') return error.code
  if (isRecord(error.failure) && typeof error.failure.code === 'string') {
    return error.failure.code
  }
  if (isRecord(error.cause)) return failureCode(error.cause)
  return undefined
}

function invalidRemoteResult(
  method: string,
  detail: string
): WorkspaceHostAgentRuntimeError {
  return new WorkspaceHostAgentRuntimeError(
    'invalid_remote_runtime_result',
    `Invalid remote AgentRuntime ${method} result: ${detail}.`
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = []
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<T>) => void
    reject: (error: unknown) => void
  }> = []
  private ended = false
  private error: unknown

  push(value: T): void {
    if (this.ended) return
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter.resolve({ done: false, value })
      return
    }
    this.values.push(value)
  }

  close(): void {
    if (this.ended) return
    this.ended = true
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ done: true, value: undefined })
    }
  }

  fail(error: unknown): void {
    if (this.ended) return
    this.ended = true
    this.error = error
    for (const waiter of this.waiters.splice(0)) waiter.reject(error)
  }

  async next(): Promise<IteratorResult<T>> {
    const value = this.values.shift()
    if (value !== undefined) return { done: false, value }
    if (this.error !== undefined) throw this.error
    if (this.ended) return { done: true, value: undefined }
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.waiters.push({ resolve, reject })
    })
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this
  }
}
