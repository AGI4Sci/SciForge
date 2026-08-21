import assert from 'node:assert/strict'
import test from 'node:test'
import {
  remoteSessionProjectionSchema
} from '@sciforge/collaboration-contracts'
import {
  agentNodeFixture,
  remoteSessionProjectionFixture
} from '@sciforge/collaboration-contracts/testing'
import type {
  DomainMainRuntimeLifecycleContext
} from '@sciforge/domain-sdk/host'
import type {
  DomainMainPackageSecretStoreHost,
  DomainMainPackageSettingsHost
} from '@sciforge/domain-sdk/package-storage'
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
  const secrets: DomainMainPackageSecretStoreHost = {
    has: async () => false,
    read: async () => null,
    write: async () => { throw new Error('Secret writes are not expected.') },
    remove: async () => undefined
  }
  const runtime = new CollaborationRuntime({
    statePath: 'unused',
    packageSettings: settings,
    packageSecrets: secrets,
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
      return state.queue.length === 1 && state.outbox.length === 1
    })
    const state = backend.snapshot()
    assert.equal(state.queue[0]?.kind, 'assistant-progress')
    assert.equal(state.queue[0]?.text, '已完成第一阶段核查。')
    assert.equal(state.outbox.length, 1)
    assert.equal(state.outbox[0]?.body.kind, 'assistant_progress')
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
