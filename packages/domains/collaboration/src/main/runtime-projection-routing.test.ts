import assert from 'node:assert/strict'
import test from 'node:test'
import {
  remoteSessionProjectionSchema
} from '@sciforge/collaboration-contracts'
import {
  agentNodeFixture,
  humanEndpointBindingFixture,
  remoteSessionProjectionFixture
} from '@sciforge/collaboration-contracts/testing'
import type {
  DomainMainRuntimeLifecycleContext
} from '@sciforge/domain-sdk/host'
import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import { localProjectionFromRemote } from './projection-coordinator.js'
import {
  CollaborationRuntime,
  activeProjectionBindingsForSession
} from './runtime.js'
import {
  EMPTY_COLLABORATION_LOCAL_STATE,
  type CollaborationLocalState,
  type CollaborationStateBackend
} from './store.js'
import { createTestAgentCloudRuntime } from './test-agent-cloud-runtime.js'

test('a closed Topic history does not block outbound mirroring for the active Topic on the same Session', () => {
  const active = localProjectionFromRemote(remoteSessionProjectionFixture, {
    runtimeId: 'codex',
    threadId: 'fixed-thread-1',
    bindingMode: 'existing'
  })
  const closed = localProjectionFromRemote(remoteSessionProjectionSchema.parse({
    ...remoteSessionProjectionFixture,
    projectionId: 'rsp_123456789012',
    status: 'closed',
    revision: 2
  }), {
    runtimeId: 'codex',
    threadId: 'fixed-thread-1',
    bindingMode: 'existing'
  })

  assert.deepEqual(
    activeProjectionBindingsForSession([closed, active], 'codex', 'fixed-thread-1'),
    [active]
  )
})

test('the active runtime mirrors completed assistant progress before after-turn finalization', async () => {
  const backend = new MemoryBackend({
    ...EMPTY_COLLABORATION_LOCAL_STATE,
    revision: 1,
    agents: [agentNodeFixture],
    projections: [localProjectionFromRemote(remoteSessionProjectionFixture, {
      runtimeId: 'codex',
      threadId: 'fixed-thread-1',
      bindingMode: 'existing'
    })]
  })
  const settings: DomainMainPackageSettingsHost = {
    read: async () => ({ revision: 0, value: null }),
    write: async () => { throw new Error('Settings writes are not expected.') },
    clear: async () => { throw new Error('Settings writes are not expected.') }
  }
  const runtime = new CollaborationRuntime({
    statePath: 'unused',
    packageSettings: settings,
    authenticatedCloudTransport: unusedAuthenticatedCloudTransport(),
    agentCloudRuntime: createTestAgentCloudRuntime({}),
    stateBackend: backend
  })
  const abortController = new AbortController()
  const context = {
    agentExecution: {
      run: async () => { throw new Error('Transcript mirroring must not execute an Agent turn.') }
    },
    agentThreads: {
      read: async () => ({
        runtimeId: 'codex',
        threadId: 'fixed-thread-1',
        title: 'Fixed Session',
        updatedAt: '2026-08-21T00:00:00.000Z',
        watermark: '0',
        turns: [],
        artifacts: []
      }),
      subscribeMessages: async function* (input: Readonly<{ signal?: AbortSignal }>) {
        yield {
          runtimeId: 'codex',
          threadId: 'fixed-thread-1',
          turnId: 'turn-live-progress',
          sequence: 1,
          itemId: 'assistant-progress-live',
          kind: 'assistant-progress' as const,
          text: '已完成第一阶段核查。'
        }
        await waitForAbort(input.signal)
      },
      list: async () => [],
      hasActiveTurns: () => false
    },
    turnEvents: {
      subscribe: () => async () => undefined,
      subscribeRequiredBeforeTurn: () => async () => undefined,
      readDurableTurnBoundarySnapshot: async () => ({ issuerEpoch: 'test', boundaries: [] })
    },
    signal: abortController.signal
  } as unknown as DomainMainRuntimeLifecycleContext

  const dispose = await runtime.activate(context)
  try {
    await waitFor(() => {
      const state = backend.snapshot()
      return state.queue.length === 1 && state.outbox.some((entry) => (
        entry.body.type === 'projection.message.publish'
      ))
    })
    const state = backend.snapshot()
    const projectionOutbox = state.outbox.filter((entry) => (
      entry.body.type === 'projection.message.publish'
    ))
    assert.equal(state.queue[0]?.kind, 'assistant-progress')
    assert.equal(state.queue[0]?.text, '已完成第一阶段核查。')
    assert.equal(projectionOutbox.length, 1)
    assert.equal(projectionOutbox[0]?.body.kind, 'assistant_progress')
  } finally {
    abortController.abort()
    await dispose()
  }
})

test('startup reconciles only completed remote turns without an existing final reply', async () => {
  const timestamp = '2026-08-22T11:00:00.000Z'
  const projection = {
    ...localProjectionFromRemote(remoteSessionProjectionFixture, {
      runtimeId: 'codex',
      threadId: 'fixed-thread-1',
      bindingMode: 'existing'
    }),
    nextSequence: 5
  }
  const inbound = (
    queueItemId: string,
    sequence: number,
    turnId: string,
    state: 'completed' | 'failed'
  ) => ({
    queueItemId,
    projectionId: projection.projection.projectionId,
    sequence,
    direction: 'inbound' as const,
    origin: 'human-endpoint' as const,
    kind: 'user-message' as const,
    senderUserId: projection.projection.ownerUserId,
    senderHumanEndpointId: humanEndpointBindingFixture.humanEndpointId,
    providerMessageId: `provider-${sequence}`,
    clientDirectiveId: `directive-${sequence}`,
    contentHash: String(sequence).repeat(64),
    text: `remote message ${sequence}`,
    state,
    attempts: 1,
    turnId,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp,
    ...(state === 'failed' ? { error: 'Agent turn ended in failed.' } : {})
  })
  const completedWithFinal = inbound(
    'lqi_completedold01',
    1,
    'turn-completed-with-final',
    'completed'
  )
  const existingFinal = {
    queueItemId: 'lqi_existingfinal01',
    projectionId: projection.projection.projectionId,
    sequence: 2,
    direction: 'outbound' as const,
    origin: 'agent' as const,
    kind: 'assistant-reply' as const,
    localItemId: 'existing-final-item',
    contentHash: 'a'.repeat(64),
    text: 'already delivered final',
    state: 'completed' as const,
    attempts: 0,
    turnId: completedWithFinal.turnId,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp
  }
  const failed = inbound('lqi_failedremote01', 3, 'turn-failed', 'failed')
  const recoverable = inbound('lqi_recoverable01', 4, 'turn-recoverable', 'completed')
  const backend = new MemoryBackend({
    ...EMPTY_COLLABORATION_LOCAL_STATE,
    revision: 1,
    agents: [agentNodeFixture],
    projections: [projection],
    queue: [completedWithFinal, existingFinal, failed, recoverable],
    receipts: []
  })
  const settings: DomainMainPackageSettingsHost = {
    read: async () => ({ revision: 0, value: null }),
    write: async () => { throw new Error('Settings writes are not expected.') },
    clear: async () => { throw new Error('Settings writes are not expected.') }
  }
  const runtime = new CollaborationRuntime({
    statePath: 'unused',
    packageSettings: settings,
    authenticatedCloudTransport: unusedAuthenticatedCloudTransport(),
    agentCloudRuntime: createTestAgentCloudRuntime({}),
    stateBackend: backend
  })
  const abortController = new AbortController()
  const context = {
    agentExecution: {
      run: async () => { throw new Error('Startup reconciliation must not execute an Agent turn.') }
    },
    agentThreads: {
      read: async () => ({
        runtimeId: 'codex',
        threadId: 'fixed-thread-1',
        title: 'Fixed Session',
        updatedAt: timestamp,
        watermark: '0',
        turns: [
          canonicalTurn(completedWithFinal.turnId, 'late completed output'),
          canonicalTurn(failed.turnId, 'late failed output'),
          canonicalTurn(recoverable.turnId, 'recoverable final output')
        ],
        artifacts: []
      }),
      subscribeMessages: async function* (input: Readonly<{ signal?: AbortSignal }>) {
        yield* []
        await waitForAbort(input.signal)
      },
      list: async () => [],
      hasActiveTurns: () => false
    },
    turnEvents: {
      subscribe: () => async () => undefined,
      subscribeRequiredBeforeTurn: () => async () => undefined,
      readDurableTurnBoundarySnapshot: async () => ({ issuerEpoch: 'test', boundaries: [] })
    },
    signal: abortController.signal
  } as unknown as DomainMainRuntimeLifecycleContext

  const dispose = await runtime.activate(context)
  try {
    await waitFor(() => backend.snapshot().queue.some((item) => (
      item.direction === 'outbound' && item.turnId === recoverable.turnId
    )))
    const reconciledFinals = backend.snapshot().queue.filter((item) => (
      item.direction === 'outbound' && item.kind === 'assistant-reply'
    ))
    assert.deepEqual(
      reconciledFinals.map((item) => item.turnId).sort(),
      [completedWithFinal.turnId, recoverable.turnId].sort()
    )
  } finally {
    abortController.abort()
    await dispose()
  }
})

class MemoryBackend implements CollaborationStateBackend {
  constructor(private value: CollaborationLocalState) {}

  async read(): Promise<unknown> {
    return structuredClone(this.value)
  }

  async write(value: CollaborationLocalState): Promise<void> {
    this.value = structuredClone(value)
  }

  snapshot(): CollaborationLocalState {
    return structuredClone(this.value)
  }
}

async function waitFor(
  predicate: () => boolean,
  timeoutMilliseconds = 2_000
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for live transcript mirroring.')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
  if (!signal || signal.aborted) return Promise.resolve()
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
}

function unusedAuthenticatedCloudTransport(): AuthenticatedCloudTransport {
  return {
    status: () => ({ state: 'unavailable', reason: 'Collaboration is not configured in this test.' }),
    execute: async () => {
      throw new Error('Authenticated Cloud transport is not expected in this test.')
    }
  }
}

function canonicalTurn(turnId: string, text: string) {
  return {
    id: turnId,
    status: 'completed',
    completedAt: '2026-08-22T11:00:00.000Z',
    messages: [{
      itemId: `${turnId}-final`,
      turnId,
      kind: 'assistant-final' as const,
      text,
      occurredAt: '2026-08-22T11:00:00.000Z'
    }],
    artifacts: []
  }
}
