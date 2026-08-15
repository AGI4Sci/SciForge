import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  TEST_IDS,
  TEST_LATER_TIMESTAMP,
  TEST_TIMESTAMP,
  taskFixture
} from '@sciforge/collaboration-contracts/testing'
import type { RestRequest, Task } from '@sciforge/collaboration-contracts'
import type { DomainMainAgentExecutionHost } from '@sciforge/domain-sdk/main'
import type { CollaborationConnection } from './connection.js'
import type { DurableCloudOutbox } from './outbox.js'
import { CollaborationLocalStore, type CollaborationLocalState, type CollaborationStateBackend } from './store.js'
import { CollaborationTaskAdapter } from './task-adapter.js'

test('restart reconciliation resumes an already-running cloud Task without replaying old transitions', async () => {
  let cloudTask: Task = {
    ...taskFixture,
    assigneeAgentId: TEST_IDS.agentId,
    status: 'running',
    revision: 3,
    updatedAt: TEST_LATER_TIMESTAMP
  }
  const directiveId = 'collab-task-stable-recovery'
  const store = new CollaborationLocalStore(new MemoryBackend({
    schemaVersion: 1,
    revision: 1,
    lastInboxSequence: 0,
    endpoints: [],
    endpointLocators: [],
    agents: [],
    projections: [],
    projects: [],
    tasks: [{ ...taskFixture, assigneeAgentId: TEST_IDS.agentId }],
    taskRuns: [{
      task: { ...taskFixture, assigneeAgentId: TEST_IDS.agentId },
      state: 'accepting',
      clientDirectiveId: directiveId,
      updatedAt: TEST_TIMESTAMP
    }],
    queue: [],
    receipts: [],
    outbox: [],
    diagnostics: []
  }))
  await store.open()

  const transitions: string[] = []
  const outbox = {
    enqueue: async (kind: string, request: RestRequest) => {
      assert.equal(request.type, 'task.transition')
      transitions.push(request.status)
      cloudTask = {
        ...cloudTask,
        status: request.status,
        revision: cloudTask.revision + 1,
        updatedAt: TEST_LATER_TIMESTAMP,
        ...(['succeeded', 'failed'].includes(request.status)
          ? { completedAt: TEST_LATER_TIMESTAMP }
          : { completedAt: undefined })
      }
      await store.transact((draft) => {
        draft.outbox.push({
          outboxId: `obx_TaskRecovery${draft.outbox.length + 1}`,
          idempotencyKey: request.idempotencyKey,
          kind: kind as 'task.result',
          body: request,
          state: 'delivered',
          attempts: 1,
          createdAt: TEST_TIMESTAMP,
          updatedAt: TEST_LATER_TIMESTAMP,
          deliveredAt: TEST_LATER_TIMESTAMP
        })
      })
    },
    waitForIdle: async () => undefined
  } as unknown as DurableCloudOutbox
  const connection = {
    executeAsDevice: async (request: RestRequest) => {
      assert.equal(request.type, 'task.get')
      return {
        protocolVersion: '1.0' as const,
        type: 'rest.entity' as const,
        requestId: request.requestId,
        entity: cloudTask
      }
    }
  } as unknown as CollaborationConnection
  const executions: string[] = []
  const agentExecution: DomainMainAgentExecutionHost = {
    run: async (request) => {
      executions.push(request.clientDirectiveId ?? '')
      return {
        runtimeId: 'codex',
        threadId: 'task-thread-stable',
        turnId: 'task-turn-stable',
        state: 'completed',
        text: 'Task result'
      }
    }
  }
  const adapter = new CollaborationTaskAdapter({
    store,
    connection,
    outbox,
    agentExecution,
    localAgentId: () => TEST_IDS.agentId
  })

  await adapter.recover()
  await adapter.waitForIdle()

  assert.deepEqual(executions, [directiveId])
  assert.deepEqual(transitions, ['succeeded'])
  const run = store.snapshot().taskRuns[0]
  assert.equal(run?.state, 'completed', run?.error)
  assert.equal(run?.threadId, 'task-thread-stable')
  assert.equal(run?.localTurnId, 'task-turn-stable')
  assert.equal(run?.task.revision, 4)
})

class MemoryBackend implements CollaborationStateBackend {
  constructor(private value: unknown) {}

  async read(): Promise<unknown> {
    return structuredClone(this.value)
  }

  async write(value: CollaborationLocalState): Promise<void> {
    this.value = structuredClone(value)
  }
}
