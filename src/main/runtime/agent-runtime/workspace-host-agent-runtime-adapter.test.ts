import { describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_HOST_EVENT_KINDS,
  WORKSPACE_HOST_OPERATIONS,
  type WorkspaceHostEvent,
  type WorkspaceHostPayload,
  type WorkspaceHostSession
} from '@sciforge/domain-sdk/workspace-host'
import {
  createDefaultAgentRuntimeCapabilities,
  type AgentRuntimeCapabilities,
  type AgentRuntimeEvent
} from '../../../shared/agent-runtime-contract'
import type {
  WorkspaceHostConnectionPhase,
  WorkspaceHostConnectionSnapshot
} from '../../../shared/workspace-host-state'
import type { WorkspaceHostSessionPort } from '../../workspace-host/session-manager'
import {
  WORKSPACE_HOST_AGENT_RUNTIME_METHODS,
  createPlacementAwareAgentRuntimeAdapter,
  createWorkspaceHostCodexAgentRuntimeAdapter
} from './workspace-host-agent-runtime-adapter'
import type { AgentRuntimeAdapter } from './adapter'

function session(runtimeAvailable = true): WorkspaceHostSession {
  return {
    protocolVersion: 1,
    serverVersion: '0.1.0',
    serverInstanceId: 'server-1',
    sessionId: 'session-1',
    lifecycleMode: 'persistent-daemon',
    locator: {
      contractVersion: 1,
      hostSessionId: 'session-1',
      path: '/cluster/project'
    },
    platform: {
      os: 'linux',
      architecture: 'x64'
    },
    capabilities: runtimeAvailable
      ? [
          {
            operation: WORKSPACE_HOST_OPERATIONS.runtimeInvoke,
            version: '0.1.0',
            maxRequestBytes: 1024 * 1024,
            maxResponseBytes: 1024 * 1024
          },
          {
            operation: WORKSPACE_HOST_OPERATIONS.runtimeReplayEvents,
            version: '0.1.0',
            maxRequestBytes: 1024 * 1024,
            maxResponseBytes: 1024 * 1024
          }
        ]
      : [],
    contributions: [],
    eventSequence: 0,
    replay: {
      earliestSequence: 0,
      latestSequence: 0
    },
    egress: {
      mode: 'none',
      status: 'disabled'
    }
  }
}

function capabilities(): AgentRuntimeCapabilities {
  const base = createDefaultAgentRuntimeCapabilities({
    runtimeId: 'codex',
    transport: 'jsonrpc_stdio'
  })
  return {
    ...base,
    events: {
      live: true,
      replayable: true,
      sequenced: true,
      delivery: 'async_iterable'
    },
    controls: {
      ...base.controls,
      interrupt: true,
      approval: 'async',
      userInput: 'async'
    }
  }
}

function runtimeResult(
  method: string,
  result: WorkspaceHostPayload
): WorkspaceHostPayload {
  return {
    contractVersion: 1,
    runtimeId: 'codex',
    method,
    result
  }
}

function fakeClient(options: {
  runtimeAvailable?: boolean
  request?: (
    operation: string,
    payload: WorkspaceHostPayload,
    requestOptions?: Record<string, unknown>
  ) => Promise<WorkspaceHostPayload>
} = {}): {
  client: WorkspaceHostSessionPort
  emit: (event: WorkspaceHostEvent) => Promise<void>
  emitConnection: (phase: WorkspaceHostConnectionPhase) => void
  request: ReturnType<typeof vi.fn>
} {
  const listeners = new Set<(event: WorkspaceHostEvent) => void | Promise<void>>()
  const connectionListeners = new Set<
    (snapshot: WorkspaceHostConnectionSnapshot) => void
  >()
  let connectionPhase: WorkspaceHostConnectionPhase = 'connected'
  const request = vi.fn(options.request ?? (async (_operation, payload) => {
    const method = record(payload).method
    return runtimeResult(String(method), null)
  }))
  const connectionSnapshot = (): WorkspaceHostConnectionSnapshot => ({
    providerId: 'remote-ssh',
    ownerId: 'remote-ssh',
    ownerDisplayName: 'Remote SSH',
    locator: session(options.runtimeAvailable).locator,
    session: session(options.runtimeAvailable),
    phase: connectionPhase,
    lastAcknowledgedSequence: 0,
    updatedAt: '2026-07-30T00:00:00.000Z'
  })
  const client = {
    getSession: () => session(options.runtimeAvailable),
    getConnectionSnapshot: connectionSnapshot,
    request,
    subscribe(listener: (event: WorkspaceHostEvent) => void | Promise<void>) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    subscribeConnection(listener: (snapshot: WorkspaceHostConnectionSnapshot) => void) {
      connectionListeners.add(listener)
      listener(connectionSnapshot())
      return () => connectionListeners.delete(listener)
    }
  } as WorkspaceHostSessionPort
  return {
    client,
    request,
    async emit(event) {
      await Promise.all([...listeners].map((listener) => listener(event)))
    },
    emitConnection(phase) {
      connectionPhase = phase
      const snapshot = connectionSnapshot()
      for (const listener of connectionListeners) listener(snapshot)
    }
  }
}

function runtimeHostEvent(input: {
  sequence: number
  streamId: string
  event: AgentRuntimeEvent
  runtimeId?: string
  threadId?: string
}): WorkspaceHostEvent {
  return {
    protocolVersion: 1,
    sessionId: 'session-1',
    eventId: `event-${input.sequence}`,
    sequence: input.sequence,
    kind: WORKSPACE_HOST_EVENT_KINDS.runtimeEvent,
    occurredAt: '2026-07-30T00:00:00.000Z',
    payload: {
      contractVersion: 1,
      runtimeId: input.runtimeId ?? 'codex',
      threadId: input.threadId ?? input.event.threadId,
      streamId: input.streamId,
      event: input.event as unknown as WorkspaceHostPayload
    }
  }
}

describe('createWorkspaceHostAgentRuntimeAdapter', () => {
  it('keeps Codex identity while forwarding only bounded runtime context', async () => {
    const remote = fakeClient({
      request: async (operation, payload) => {
        expect(operation).toBe(WORKSPACE_HOST_OPERATIONS.runtimeInvoke)
        const invoke = record(payload)
        expect(invoke.runtimeId).toBe('codex')
        expect(invoke.method).toBe(WORKSPACE_HOST_AGENT_RUNTIME_METHODS.startTurn)
        expect(invoke).not.toHaveProperty('settings')
        expect(invoke.context).toEqual({
          turnGovernanceSnapshot: {
            ownedVisualToolsAvailable: true,
            nativeVisualProofChainPending: true
          }
        })
        return runtimeResult(String(invoke.method), {
          threadId: 'thread-1',
          turnId: 'turn-1',
          userMessageItemId: 'user-1'
        })
      }
    })
    const adapter = createWorkspaceHostCodexAgentRuntimeAdapter(async () => remote.client)

    await expect(adapter.startTurn({
      settings: {
        modelRouter: {
          apiKey: 'must-not-cross-the-workspace-host-boundary'
        }
      } as never,
      turnGovernanceSnapshot: {
        ownedVisualToolsAvailable: true,
        nativeVisualProofChainPending: true
      }
    }, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      text: 'inspect the remote data',
      workspace: '/cluster/project'
    })).resolves.toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
      userMessageItemId: 'user-1'
    })
  })

  it('selects local or Workspace Host placement without creating another runtime ID', async () => {
    const localStartTurn = vi.fn(async (_context, input) => ({
      threadId: input.threadId,
      turnId: 'local-turn'
    }))
    const local = {
      id: 'codex',
      transport: 'jsonrpc_stdio',
      connect: vi.fn(async () => undefined),
      capabilities: vi.fn(async () => capabilities()),
      listThreads: vi.fn(async () => []),
      startThread: vi.fn(async (_context, input) => ({
        id: input.threadId ?? 'local-thread',
        runtimeId: 'codex' as const,
        title: 'Local',
        updatedAt: '2026-07-30T00:00:00.000Z'
      })),
      readThread: vi.fn(async (_context, input) => ({
        id: input.threadId,
        runtimeId: 'codex' as const,
        title: 'Local',
        updatedAt: '2026-07-30T00:00:00.000Z',
        latestSeq: 0
      })),
      startTurn: localStartTurn,
      interruptTurn: vi.fn(async () => undefined),
      steerTurn: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined),
      deleteThread: vi.fn(async () => undefined),
      subscribeEvents: vi.fn(async function* () {
        // No local events are needed by this placement test.
      }),
      usage: vi.fn(async () => ({
        supported: false as const,
        reason: 'test'
      }))
    } satisfies AgentRuntimeAdapter
    const remote = fakeClient({
      request: async (_operation, payload) => {
        const method = String(record(payload).method)
        return runtimeResult(method, {
          threadId: 'thread-1',
          turnId: 'remote-turn'
        })
      }
    })
    const placed = createPlacementAwareAgentRuntimeAdapter(
      local,
      createWorkspaceHostCodexAgentRuntimeAdapter(() => remote.client)
    )
    const input = {
      runtimeId: 'codex' as const,
      threadId: 'thread-1',
      text: 'run here'
    }

    await expect(placed.startTurn({ settings: {} as never }, input)).resolves.toMatchObject({
      turnId: 'local-turn'
    })
    await expect(placed.startTurn({
      settings: {} as never,
      workspaceHost: {
        locator: session().locator,
        session: session()
      }
    }, input)).resolves.toMatchObject({
      turnId: 'remote-turn'
    })

    expect(placed.id).toBe('codex')
    expect(localStartTurn).toHaveBeenCalledTimes(1)
    expect(remote.request).toHaveBeenCalledWith(
      WORKSPACE_HOST_OPERATIONS.runtimeInvoke,
      expect.objectContaining({
        runtimeId: 'codex',
        method: WORKSPACE_HOST_AGENT_RUNTIME_METHODS.startTurn
      }),
      expect.any(Object)
    )
  })

  it('reports remote Codex unavailable when the host has no runtime capability', async () => {
    const remote = fakeClient({ runtimeAvailable: false })
    const adapter = createWorkspaceHostCodexAgentRuntimeAdapter(() => remote.client)

    const result = await adapter.capabilities({ settings: {} as never })

    expect(result.runtimeId).toBe('codex')
    expect(result.transport).toBe('jsonrpc_stdio')
    expect(result.tools.commandExecution).toEqual({
      available: false,
      reason: 'Workspace Host does not advertise remote AgentRuntime support.'
    })
    expect(result.controls.interrupt).toBe(false)
    expect(remote.request).not.toHaveBeenCalled()
  })

  it('rejects a remote response that attempts to change runtime identity', async () => {
    const remote = fakeClient({
      request: async (_operation, payload) => ({
        contractVersion: 1,
        runtimeId: 'claude',
        method: String(record(payload).method),
        result: capabilities() as unknown as WorkspaceHostPayload
      })
    })
    const adapter = createWorkspaceHostCodexAgentRuntimeAdapter(() => remote.client)

    await expect(
      adapter.capabilities({ settings: {} as never })
    ).rejects.toMatchObject({
      code: 'runtime_identity_mismatch'
    })
  })

  it('forwards approval, user input, and interrupt through the same canonical operation', async () => {
    const methods: string[] = []
    const remote = fakeClient({
      request: async (operation, payload) => {
        expect(operation).toBe(WORKSPACE_HOST_OPERATIONS.runtimeInvoke)
        const method = String(record(payload).method)
        methods.push(method)
        return runtimeResult(method, null)
      }
    })
    const adapter = createWorkspaceHostCodexAgentRuntimeAdapter(() => remote.client)
    const context = { settings: {} as never }

    await adapter.resolveApproval?.(context, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      approvalId: 'approval-1',
      decision: 'allowed'
    })
    await adapter.resolveUserInput?.(context, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      requestId: 'input-1',
      answers: [{ id: 'q1', value: 'yes' }]
    })
    await adapter.interruptTurn(context, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1'
    })

    expect(methods).toEqual([
      WORKSPACE_HOST_AGENT_RUNTIME_METHODS.resolveApproval,
      WORKSPACE_HOST_AGENT_RUNTIME_METHODS.resolveUserInput,
      WORKSPACE_HOST_AGENT_RUNTIME_METHODS.interruptTurn
    ])
    for (const [, , requestOptions] of remote.request.mock.calls) {
      expect(requestOptions).toMatchObject({
        idempotencyKey: expect.stringMatching(/^agent-runtime-/)
      })
    }
  })

  it('orders stored replay before live events and filters streams through the managed port', async () => {
    const replayEvent = {
      kind: 'assistant_delta',
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'assistant-1',
      seq: 5,
      text: 'stored'
    } satisfies AgentRuntimeEvent
    const remote = fakeClient({
      request: async (operation, payload) => {
        if (operation === WORKSPACE_HOST_OPERATIONS.runtimeReplayEvents) {
          expect(record(payload)).toMatchObject({
            runtimeId: 'codex',
            threadId: 'thread-1',
            sinceSeq: 4
          })
          return { events: [replayEvent as unknown as WorkspaceHostPayload] }
        }
        const method = String(record(payload).method)
        return runtimeResult(method, null)
      }
    })
    const abort = new AbortController()
    const adapter = createWorkspaceHostCodexAgentRuntimeAdapter(() => remote.client)
    const iterator = adapter.subscribeEvents({ settings: {} as never }, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      sinceSeq: 4,
      signal: abort.signal
    })[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: replayEvent
    })
    const subscribeCall = remote.request.mock.calls.find(
      ([operation, payload]) =>
        operation === WORKSPACE_HOST_OPERATIONS.runtimeInvoke &&
        record(payload).method === WORKSPACE_HOST_AGENT_RUNTIME_METHODS.subscribeEvents
    )
    const streamId = String(record(subscribeCall?.[1]).streamId)
    const liveNext = iterator.next()

    await remote.emit(runtimeHostEvent({
      sequence: 10,
      streamId: 'another-stream',
      event: {
        kind: 'assistant_delta',
        runtimeId: 'codex',
        threadId: 'thread-1',
        itemId: 'ignored',
        seq: 6,
        text: 'ignored'
      }
    }))
    const liveEvent = {
      kind: 'assistant_delta',
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'assistant-1',
      seq: 6,
      text: ' live'
    } satisfies AgentRuntimeEvent
    await remote.emit(runtimeHostEvent({
      sequence: 11,
      streamId,
      event: liveEvent
    }))

    await expect(liveNext).resolves.toEqual({
      done: false,
      value: liveEvent
    })
    abort.abort()
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined
    })
    expect(remote.request).toHaveBeenCalledWith(
      WORKSPACE_HOST_OPERATIONS.runtimeInvoke,
      expect.objectContaining({
        runtimeId: 'codex',
        method: WORKSPACE_HOST_AGENT_RUNTIME_METHODS.unsubscribeEvents,
        streamId
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(/^agent-runtime-/)
      })
    )
  })

  it('reattaches the runtime stream after the manager reports a recovered connection', async () => {
    const recoveredEvent = {
      kind: 'heartbeat',
      runtimeId: 'codex',
      threadId: 'thread-1',
      seq: 8
    } satisfies AgentRuntimeEvent
    let replayCalls = 0
    const remote = fakeClient({
      request: async (operation, payload) => {
        if (operation === WORKSPACE_HOST_OPERATIONS.runtimeReplayEvents) {
          replayCalls += 1
          return replayCalls === 1
            ? { events: [] }
            : { events: [recoveredEvent as unknown as WorkspaceHostPayload] }
        }
        return runtimeResult(String(record(payload).method), null)
      }
    })
    const abort = new AbortController()
    const adapter = createWorkspaceHostCodexAgentRuntimeAdapter(() => remote.client)
    const iterator = adapter.subscribeEvents({ settings: {} as never }, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      sinceSeq: 7,
      signal: abort.signal
    })[Symbol.asyncIterator]()
    const reconnecting = iterator.next()

    await vi.waitFor(() => expect(replayCalls).toBe(1))
    remote.emitConnection('reconnecting')
    await expect(reconnecting).resolves.toMatchObject({
      done: false,
      value: {
        kind: 'runtime_status',
        runtimeId: 'codex',
        threadId: 'thread-1',
        phase: 'reconnecting'
      }
    })

    const replayed = iterator.next()
    remote.emitConnection('connected')
    await expect(replayed).resolves.toEqual({
      done: false,
      value: recoveredEvent
    })
    expect(replayCalls).toBe(2)

    abort.abort()
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined
    })
  })

  it('leaves reconnect and replay-watermark ownership with the session manager port', async () => {
    const remote = fakeClient({
      request: async () => {
        throw Object.assign(new Error('transport closed'), {
          code: 'disconnected'
        })
      }
    })
    const adapter = createWorkspaceHostCodexAgentRuntimeAdapter(() => remote.client)

    await expect(adapter.startTurn({ settings: {} as never }, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      text: 'continue remotely'
    })).rejects.toMatchObject({ code: 'disconnected' })

    expect(remote.request).toHaveBeenCalledTimes(1)
  })
})

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}
