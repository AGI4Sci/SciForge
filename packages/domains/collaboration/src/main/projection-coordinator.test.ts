import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  TEST_IDS,
  TEST_LATER_TIMESTAMP,
  agentInboxMessageFixture,
  agentNodeFixture,
  remoteSessionProjectionFixture
} from '@sciforge/collaboration-contracts/testing'
import {
  agentInboxMessageSchema,
  remoteSessionProjectionSchema
} from '@sciforge/collaboration-contracts'
import type {
  DomainMainAgentExecutionHost,
  DomainMainAgentExecutionRequest
} from '@sciforge/domain-sdk/main'
import {
  ProjectionCoordinator,
  localProjectionFromRemote,
  type ProjectionCloudOutbox
} from './projection-coordinator.js'
import {
  CollaborationLocalStore,
  type CollaborationLocalState,
  type CollaborationStateBackend
} from './store.js'

test('projection.updated refreshes the remote revision before the next message executes once on the fixed thread', async () => {
  const store = await projectionStore()
  const executions: DomainMainAgentExecutionRequest[] = []
  const agentExecution: DomainMainAgentExecutionHost = {
    run: async (request) => {
      executions.push(request)
      return {
        runtimeId: request.runtimeId!,
        threadId: request.threadId!,
        turnId: 'runtime-turn-after-rename',
        state: 'completed',
        text: '完成'
      }
    }
  }
  const coordinator = new ProjectionCoordinator({
    store,
    agentExecution,
    cloudOutbox: NOOP_OUTBOX,
    localAgentId: () => TEST_IDS.agentId
  })
  const renamed = remoteSessionProjectionSchema.parse({
    ...remoteSessionProjectionFixture,
    locator: {
      ...remoteSessionProjectionFixture.locator,
      topicDisplayName: '重命名后的会话'
    },
    displayName: '重命名后的会话',
    revision: 2,
    updatedAt: TEST_LATER_TIMESTAMP
  })

  await coordinator.applyRemoteProjectionUpdate(renamed, 2)
  const refreshed = store.snapshot().projections[0]!
  assert.equal(refreshed.projection.revision, 2)
  assert.equal(refreshed.threadId, 'fixed-thread-1')
  assert.equal(refreshed.runtimeId, 'codex')
  assert.equal(refreshed.workspaceRoot, '/workspace/fixed')

  await coordinator.acceptPersonalInbox(agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    sequence: 2,
    payload: {
      ...agentInboxMessageFixture.payload,
      projectionRevision: 2,
      providerMessageId: 'provider-message-after-rename',
      text: '继续原会话'
    }
  }))
  await coordinator.waitForIdle(TEST_IDS.projectionId)

  assert.equal(executions.length, 1)
  assert.equal(executions[0]?.runtimeId, 'codex')
  assert.equal(executions[0]?.threadId, 'fixed-thread-1')
  assert.equal(executions[0]?.workspaceRoot, '/workspace/fixed')
  assert.deepEqual(executions[0]?.metadata, {
    source: 'collaboration.remote-session-projection',
    projectionId: TEST_IDS.projectionId,
    senderUserId: TEST_IDS.userId,
    senderHumanEndpointId: TEST_IDS.humanEndpointId,
    providerMessageId: 'provider-message-after-rename'
  })
})

test('projection.updated fails closed for an unknown projection or changed security identity', async () => {
  const store = await projectionStore()
  const coordinator = new ProjectionCoordinator({
    store,
    agentExecution: {
      run: async () => { throw new Error('Execution must not run for a rejected refresh.') }
    },
    cloudOutbox: NOOP_OUTBOX,
    localAgentId: () => TEST_IDS.agentId
  })

  await assert.rejects(
    coordinator.applyRemoteProjectionUpdate(remoteSessionProjectionSchema.parse({
      ...remoteSessionProjectionFixture,
      projectionId: 'rsp_Proj00000002',
      revision: 2,
      updatedAt: TEST_LATER_TIMESTAMP
    }), 2),
    /not found/u
  )
  await assert.rejects(
    coordinator.applyRemoteProjectionUpdate(remoteSessionProjectionSchema.parse({
      ...remoteSessionProjectionFixture,
      agentId: TEST_IDS.secondAgentId,
      revision: 2,
      updatedAt: TEST_LATER_TIMESTAMP
    }), 2),
    /security identity/u
  )
  assert.equal(store.snapshot().projections[0]?.projection.revision, 1)
})

test('startup transcript reconciliation preserves an existing receipt when historical text changes', async () => {
  const store = await projectionStore()
  const deliveries: Array<{ command: unknown; idempotencyKey: string }> = []
  const coordinator = new ProjectionCoordinator({
    store,
    agentExecution: {
      run: async () => { throw new Error('Desktop transcript mirroring must not execute an Agent turn.') }
    },
    cloudOutbox: {
      enqueueProjectionDelivery: async (command, idempotencyKey) => {
        deliveries.push({ command, idempotencyKey })
      }
    },
    localAgentId: () => TEST_IDS.agentId
  })
  const original = {
    runtimeId: 'codex',
    threadId: 'fixed-thread-1',
    turnId: 'turn-existing',
    itemId: 'assistant-existing',
    kind: 'assistant-message' as const,
    text: 'original delivered reply',
    occurredAt: TEST_LATER_TIMESTAMP
  }

  await coordinator.mirrorDesktopEvent(original)
  assert.equal(deliveries.length, 1)
  assert.equal(store.snapshot().queue.length, 1)
  await store.transact((draft) => {
    draft.queue[0]!.state = 'completed'
    draft.queue[0]!.updatedAt = TEST_LATER_TIMESTAMP
    draft.queue[0]!.completedAt = TEST_LATER_TIMESTAMP
    draft.receipts[0]!.status = 'delivered'
    draft.receipts[0]!.updatedAt = TEST_LATER_TIMESTAMP
  })
  assert.equal(store.snapshot().receipts[0]?.status, 'delivered')

  await coordinator.reconcileCanonicalTurn({
    runtimeId: original.runtimeId,
    threadId: original.threadId,
    turnId: original.turnId,
    messages: [{
      itemId: original.itemId,
      turnId: original.turnId,
      kind: original.kind,
      text: 'historical runtime projection changed after delivery',
      occurredAt: TEST_LATER_TIMESTAMP
    }]
  })

  assert.equal(deliveries.length, 1)
  assert.equal(store.snapshot().queue.length, 1)
  assert.equal(store.snapshot().queue[0]?.text, original.text)
  await assert.rejects(
    coordinator.mirrorDesktopEvent({
      ...original,
      text: 'a live event reused the same identity with different content'
    }),
    /identity collision/u
  )
})

const NOOP_OUTBOX: ProjectionCloudOutbox = {
  enqueueProjectionDelivery: async () => undefined
}

async function projectionStore(): Promise<CollaborationLocalStore> {
  const store = new CollaborationLocalStore(new MemoryBackend({
    schemaVersion: 1,
    revision: 1,
    lastInboxSequence: 0,
    endpoints: [],
    endpointLocators: [],
    agents: [agentNodeFixture],
    projections: [localProjectionFromRemote(remoteSessionProjectionFixture, {
      runtimeId: 'codex',
      threadId: 'fixed-thread-1',
      workspaceRoot: '/workspace/fixed',
      bindingMode: 'existing'
    })],
    projects: [],
    tasks: [],
    taskRuns: [],
    queue: [],
    receipts: [],
    outbox: [],
    diagnostics: []
  }))
  await store.open()
  return store
}

class MemoryBackend implements CollaborationStateBackend {
  constructor(private value: unknown) {}

  async read(): Promise<unknown> {
    return structuredClone(this.value)
  }

  async write(value: CollaborationLocalState): Promise<void> {
    this.value = structuredClone(value)
  }
}
