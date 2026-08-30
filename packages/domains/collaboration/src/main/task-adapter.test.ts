import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import {
  agentInboxMessageSchema,
  cloudResourceRefSchema,
  createCollaborationError,
  externalOperationRecoveryJournalEntrySchema,
  restRequestSchema,
  restResponseSchema,
  taskOfferSchema,
  taskExecutionPreflightSchema,
  taskExecutionSchema,
  taskResultSubmissionSchema,
  taskSchema,
  type RestRequest,
  type RestResponse,
  type Task,
  type TaskExecution
} from '@sciforge/collaboration-contracts'
import {
  TEST_IDS,
  TEST_HASH,
  TEST_LATER_TIMESTAMP,
  TEST_TIMESTAMP,
  agentInboxMessageFixture,
  agentNodeFixture,
  humanAnswerFixture,
  humanNeededFixture
} from '@sciforge/collaboration-contracts/testing'
import type { DomainMainAgentExecutionHost, DomainMainSystemCapabilityInvoker } from '@sciforge/domain-sdk/host'
import {
  CONTENT_SPACE_SYSTEM_DOWNLOAD_CONTRACT,
  CONTENT_SPACE_SYSTEM_TRANSFER_PREFLIGHT_CONTRACT,
  CONTENT_SPACE_SYSTEM_UPLOAD_NEW_CONTRACT
} from '@sciforge/domain-content-space/contract'
import type { CollaborationConnection } from './connection.js'
import { DurableCloudOutbox } from './outbox.js'
import {
  CollaborationLocalStore,
  type CollaborationLocalState,
  type CollaborationStateBackend
} from './store.js'
import { CollaborationTaskAdapter } from './task-adapter.js'
import { createTestAgentCloudRuntime } from './test-agent-cloud-runtime.js'

const OFFER_ID = 'ofr_Offer0000001'
const SUPERSEDING_EXECUTION_ID = 'exe_Exec00000002'
const FILE_BINDING_REVISION = 3
const INPUT_RESOURCE_ID = 'rrf_InputFile0001'
const OUTPUT_ROOT_RESOURCE_ID = 'rrf_OutputRoot001'
const RECOVERY_OUTPUT_RESOURCE_ID = 'rrf_RecoveryOutput0001'
const RECOVERY_DOWNLOAD_JOURNAL_ID = 'crj_WorkerDownload0001'
const RECOVERY_JOURNAL_ID = 'crj_WorkerJournal9999'
const ROOT_LOCATOR = {
  contractVersion: 1 as const,
  kind: 'content-space.container-reference' as const,
  authority: 'provider.instance.alpha',
  identity: { containerId: 'shared-root-alpha' }
}
const FILE_LOCATOR = {
  contractVersion: 1 as const,
  kind: 'content-space.file-reference' as const,
  authority: 'provider.instance.alpha',
  identity: { fileId: 'input-file-alpha' }
}
const ROOT_LOCATOR_DIGEST = digestFixture(ROOT_LOCATOR)
const FILE_LOCATOR_DIGEST = digestFixture(FILE_LOCATOR)

test('duplicate User offers persist once and a Device dismissal remains local', async () => {
  const cloud = new FakeWorkerCloud()
  const { adapter, store } = await createRunner(cloud)

  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()
  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()

  const [offer] = store.snapshot().pendingTaskOffers
  assert.equal(offer?.state, 'awaiting-manual')
  assert.deepEqual(offer?.preflightReasons, [])
  assert.equal(store.snapshot().tasks[0]?.title, cloud.task.title)
  assert.equal(store.snapshot().pendingTaskOffers.length, 1)
  assert.equal(store.snapshot().taskRuns.length, 0)
  assert.equal(cloud.commands.filter((type) => !type.startsWith('worker.')).length, 0)

  await adapter.decideOffer(OFFER_ID, {
    decision: 'dismiss'
  })
  await adapter.waitForIdle()
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [])
  assert.equal(store.snapshot().pendingTaskOffers[0]?.state, 'dismissed')
  assert.equal(store.snapshot().taskRuns.length, 0)
})

test('manual rejection closes the User offer globally at the exact Task and Offer revisions', async () => {
  const cloud = new FakeWorkerCloud()
  const { adapter, store } = await createRunner(cloud)

  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()
  await adapter.decideOffer(OFFER_ID, { decision: 'reject' })
  await adapter.waitForIdle()

  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'task.offer.reject'
  ])
  const rejection = cloud.requests.find((request) => request.type === 'task.offer.reject')
  assert.deepEqual(rejection && 'expectedTaskRevision' in rejection ? {
    taskOfferId: rejection.taskOfferId,
    taskId: rejection.taskId,
    expectedTaskRevision: rejection.expectedTaskRevision,
    expectedOfferRevision: rejection.expectedOfferRevision
  } : null, {
    taskOfferId: OFFER_ID,
    taskId: TEST_IDS.taskId,
    expectedTaskRevision: 1,
    expectedOfferRevision: 1
  })
  const rejected = store.snapshot().pendingTaskOffers[0]
  assert.deepEqual(rejected ? {
    state: rejected.state,
    currentTaskRevision: rejected.currentTaskRevision,
    offerRevision: rejected.offerRevision,
    error: rejected.error
  } : null, {
    state: 'closed',
    currentTaskRevision: 2,
    offerRevision: 2,
    error: 'The Worker User rejected the Task offer.'
  })
  assert.equal(cloud.offer.reassignmentTaskRevision, 2)
})

test('a rejected offer fanout closes the same User offer on another Device', async () => {
  const cloud = new FakeWorkerCloud()
  const { adapter, store } = await createRunner(cloud)

  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()
  const message = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    inboxMessageId: 'ibx_OfferRejectedFanout1',
    sequence: 2,
    payload: {
      protocolVersion: '1.0',
      type: 'task.offer.closed',
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      taskOfferId: OFFER_ID,
      audience: 'worker',
      outcome: 'rejected',
      taskRevision: 2,
      offerRevision: 2
    }
  })

  await adapter.handleInbox(message)
  await adapter.handleInbox(agentInboxMessageSchema.parse({
    ...message,
    inboxMessageId: 'ibx_OfferRejectedFanout2',
    sequence: 3
  }))

  assert.equal(store.snapshot().pendingTaskOffers[0]?.state, 'closed')
  assert.equal(store.snapshot().pendingTaskOffers[0]?.currentTaskRevision, 2)
  assert.equal(store.snapshot().pendingTaskOffers[0]?.offerRevision, 2)
  assert.equal(store.snapshot().pendingTaskOffers[0]?.error, 'The Worker User rejected the Task offer.')
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [])
})

test('manual acceptance uses the same Device preflight and leaves an unavailable offer unclaimed', async () => {
  const cloud = new FakeWorkerCloud()
  const { adapter, store } = await createRunner(cloud, {
    runtimeReadiness: async () => ({ state: 'unavailable', reason: 'Runtime is unavailable.' }),
    run: async () => { throw new Error('Unavailable Runtime must not execute a Task.') }
  })

  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()
  assert.equal(store.snapshot().pendingTaskOffers[0]?.state, 'awaiting-manual')
  assert.deepEqual(store.snapshot().pendingTaskOffers[0]?.preflightReasons, ['runtime_not_ready'])
  assert.equal(store.snapshot().tasks[0]?.title, cloud.task.title)
  await adapter.decideOffer(OFFER_ID, { decision: 'accept' })
  await adapter.waitForIdle()

  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [])
  assert.equal(store.snapshot().taskRuns.length, 0)
  assert.equal(store.snapshot().pendingTaskOffers[0]?.state, 'awaiting-manual')
  assert.match(store.snapshot().pendingTaskOffers[0]?.error ?? '', /Another Device may still claim/u)
})

test('automatic text execution journals before Agent and uses explicit vNext commands only', async () => {
  const cloud = new FakeWorkerCloud()
  let store!: CollaborationLocalStore
  const directives: string[] = []
  const agentExecution: DomainMainAgentExecutionHost = {
    runtimeReadiness: readyRuntimeReadiness,
    run: async (request) => {
      directives.push(request.clientDirectiveId ?? '')
      const run = store.snapshot().taskRuns[0]
      assert.equal(run?.agentJournal[0]?.state, 'dispatched', 'Agent effect must follow durable dispatch journal')
      assert.deepEqual({
        runtimeId: run?.runtimeId,
        threadId: run?.threadId,
        journalRuntimeId: run?.agentJournal[0]?.runtimeId,
        journalThreadId: run?.agentJournal[0]?.threadId
      }, {
        runtimeId: request.runtimeId,
        threadId: request.threadId,
        journalRuntimeId: request.runtimeId,
        journalThreadId: request.threadId
      }, 'Runtime Session binding must be durable before turn dispatch')
      return {
        runtimeId: 'codex',
        threadId: 'worker-thread-stable',
        turnId: 'worker-turn-stable',
        state: 'completed',
        text: JSON.stringify({ schemaVersion: 1, outcome: 'completed', summary: 'Result ready.' })
      }
    }
  }
  const created = await createRunner(cloud, agentExecution)
  store = created.store
  await store.transact((draft) => {
    draft.workerAcceptancePolicies = [{
      agentId: TEST_IDS.agentId,
      mode: 'automatic',
      updatedAt: TEST_TIMESTAMP
    }]
  })

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()

  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'task.offer.accept',
    'task.execution.start',
    'task.result.submit'
  ])
  assert.equal(cloud.commands.includes('task.transition'), false)
  assert.equal(directives.length, 1)
  assert.equal(store.snapshot().taskRuns[0]?.state, 'completed')
  assert.equal(store.snapshot().taskRuns[0]?.resultSummary, 'Result ready.')

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  assert.equal(directives.length, 1, 'duplicate offer must not replay a completed execution')
})

test('Worker HumanNeeded targets its Worker User and resumes the same execution and Runtime Session', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  initial.workerAcceptancePolicies = [{
    agentId: TEST_IDS.agentId,
    mode: 'automatic',
    updatedAt: TEST_TIMESTAMP
  }]
  const runtimeRequests: Array<Readonly<{
    runtimeId?: string
    threadId?: string
    clientDirectiveId?: string
    prompt: string
  }>> = []
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async (request) => {
      runtimeRequests.push(request)
      if (runtimeRequests.length === 1) {
        return {
          runtimeId: 'codex',
          threadId: 'worker-human-thread',
          turnId: 'worker-human-question-turn',
          state: 'completed',
          text: JSON.stringify({
            schemaVersion: 1,
            outcome: 'needs_human',
            question: 'Should the ambiguous samples remain in the analysis?',
            requiredAssurance: 'verified'
          })
        }
      }
      assert.equal(request.runtimeId, 'codex')
      assert.equal(request.threadId, 'worker-human-thread')
      assert.match(request.prompt, /authenticated Worker User/u)
      assert.match(request.prompt, new RegExp(humanAnswerFixture.answer, 'u'))
      return {
        runtimeId: 'codex',
        threadId: 'worker-human-thread',
        turnId: 'worker-human-answer-turn',
        state: 'completed',
        text: JSON.stringify({
          schemaVersion: 1,
          outcome: 'completed',
        summary: 'The Worker-User-confirmed analysis is complete.'
        })
      }
    }
  }, initial)

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()

  const pending = created.store.snapshot().taskRuns[0]
  assert.equal(pending?.state, 'needs-human')
  assert.equal(pending?.humanRequestId, TEST_IDS.humanRequestId)
  assert.equal(pending?.task?.revision, cloud.task.revision)
  assert.equal(pending?.execution?.revision, cloud.execution.revision)
  assert.equal(pending?.execution?.state, 'needs_human')
  assert.equal(pending?.expectedTaskRevision, cloud.task.revision)
  assert.equal(pending?.expectedExecutionRevision, cloud.execution.revision)
  const humanRequest = cloud.requests.find((request) => request.type === 'human.needed.create')
  assert.equal(humanRequest?.type, 'human.needed.create')
  if (humanRequest?.type !== 'human.needed.create') throw new Error('Missing Worker HumanNeeded command.')
  assert.deepEqual(humanRequest.context, {
    scope: 'worker_execution',
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    expectedTaskRevision: 3,
    expectedExecutionRevision: 2
  })
  assert.equal(humanRequest.targetUserId, TEST_IDS.userId)
  assert.equal(humanRequest.confirmableAction, null)

  await created.store.transact((draft) => {
    const run = draft.taskRuns[0]
    if (!run) throw new Error('Missing local Worker run.')
    run.humanRequestId = null
    draft.outbox.push({
      outboxId: 'obx_WorkerHumanNeeded01',
      idempotencyKey: humanRequest.idempotencyKey,
      kind: 'task.human-needed',
      body: humanRequest,
      state: 'delivered',
      attempts: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP,
      deliveredAt: TEST_TIMESTAMP,
      response: entityResponse(humanRequest, {
        ...humanNeededFixture,
        requiredAssurance: humanRequest.requiredAssurance,
        prompt: humanRequest.prompt,
        expiresAt: humanRequest.expiresAt
      })
    })
  })

  cloud.answerHumanNeeded()
  const answerMessage = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    inboxMessageId: 'ibx_WorkerHumanAnswer1',
    sequence: 2,
    payload: {
      protocolVersion: '1.0',
      type: 'human.answer.received',
      answer: humanAnswerFixture
    }
  })
  await created.adapter.handleInbox(answerMessage)
  await created.adapter.waitForIdle()

  const completed = created.store.snapshot().taskRuns[0]
  assert.equal(completed?.state, 'completed')
  assert.equal(completed?.resultSummary, 'The Worker-User-confirmed analysis is complete.')
  assert.equal(runtimeRequests.length, 2)
  assert.notEqual(runtimeRequests[0]?.clientDirectiveId, runtimeRequests[1]?.clientDirectiveId)
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'task.offer.accept',
    'task.execution.start',
    'human.needed.create',
    'task.result.submit'
  ])
  const reconciliationIndex = cloud.preflightExpectedRevisions.findIndex((revision, index, all) => (
    revision.task === 4 &&
    revision.execution === 3 &&
    all[index + 1]?.task === 5 &&
    all[index + 1]?.execution === 4
  ))
  assert.notEqual(reconciliationIndex, -1)
  assert.equal(cloud.preflightExpectedRevisions.slice(reconciliationIndex + 1).every((revision) => (
    revision.task === 5 && revision.execution === 4
  )), true)

  await created.adapter.handleInbox(agentInboxMessageSchema.parse({
    ...answerMessage,
    inboxMessageId: 'ibx_WorkerHumanAnswerDuplicate',
    sequence: 3
  }))
  await created.adapter.waitForIdle()
  assert.equal(runtimeRequests.length, 2)
  assert.equal(created.store.snapshot().taskRuns[0]?.state, 'completed')
})

test('Worker HumanNeeded preserves an answer received while its Cloud revisions are refreshing', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  initial.workerAcceptancePolicies = [{
    agentId: TEST_IDS.agentId,
    mode: 'automatic',
    updatedAt: TEST_TIMESTAMP
  }]
  const refreshStarted = deferred<void>()
  const releaseRefresh = deferred<void>()
  cloud.delayNextPreflight('needs_human', refreshStarted.resolve, releaseRefresh.promise)
  let runtimeRuns = 0
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      runtimeRuns += 1
      if (runtimeRuns === 1) {
        return {
          runtimeId: 'codex',
          threadId: 'worker-human-race-thread',
          turnId: 'worker-human-race-question',
          state: 'completed',
          text: JSON.stringify({
            schemaVersion: 1,
            outcome: 'needs_human',
            question: 'Continue after the revision refresh?',
            requiredAssurance: 'verified'
          })
        }
      }
      return {
        runtimeId: 'codex',
        threadId: 'worker-human-race-thread',
        turnId: 'worker-human-race-answer',
        state: 'completed',
        text: JSON.stringify({
          schemaVersion: 1,
          outcome: 'completed',
          summary: 'The concurrent HumanNeeded answer resumed the Worker.'
        })
      }
    }
  }, initial)

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await refreshStarted.promise
  cloud.answerHumanNeeded()
  await created.adapter.handleInbox(agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    inboxMessageId: 'ibx_WorkerHumanAnswerDuringRefresh',
    sequence: 2,
    payload: {
      protocolVersion: '1.0',
      type: 'human.answer.received',
      answer: humanAnswerFixture
    }
  }))
  releaseRefresh.resolve()
  await created.adapter.waitForIdle()

  const completed = created.store.snapshot().taskRuns[0]
  assert.equal(runtimeRuns, 2)
  assert.equal(completed?.state, 'completed')
  assert.equal(completed?.resultSummary, 'The concurrent HumanNeeded answer resumed the Worker.')
})

test('Worker recovery refreshes a durable needs-human run without restarting its Runtime', async () => {
  const cloud = new FakeWorkerCloud('running')
  const legacyRun = durableTaskRun(cloud, {
    state: 'needs-human',
    runtimeId: 'codex',
    threadId: 'worker-human-thread',
    humanRequestId: TEST_IDS.humanRequestId
  })
  cloud.enterHumanNeeded()
  const initial = emptyState()
  if (!legacyRun.task) throw new Error('Missing legacy Worker Task.')
  initial.tasks = [legacyRun.task]
  initial.taskRuns = [legacyRun]
  let agentRuns = 0
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      agentRuns += 1
      throw new Error('A pending HumanNeeded recovery must not restart the Worker Runtime.')
    }
  }, initial)

  await created.adapter.recover()
  await created.adapter.waitForIdle()

  const recovered = created.store.snapshot().taskRuns[0]
  assert.equal(agentRuns, 0)
  assert.equal(recovered?.state, 'needs-human')
  assert.equal(recovered?.humanRequestId, TEST_IDS.humanRequestId)
  assert.equal(recovered?.task?.revision, cloud.task.revision)
  assert.equal(recovered?.execution?.revision, cloud.execution.revision)
  assert.equal(recovered?.execution?.state, 'needs_human')
  assert.equal(recovered?.expectedTaskRevision, cloud.task.revision)
  assert.equal(recovered?.expectedExecutionRevision, cloud.execution.revision)
})

test('Worker recovery does not rerun a needs-human journal while its Cloud transition is pending', async () => {
  const cloud = new FakeWorkerCloud('running')
  const pendingRun = durableTaskRun(cloud, {
    state: 'needs-human',
    runtimeId: 'codex',
    threadId: 'worker-human-thread',
    humanRequestId: null
  })
  const initial = emptyState()
  if (!pendingRun.task) throw new Error('Missing pending Worker Task.')
  initial.tasks = [pendingRun.task]
  initial.taskRuns = [pendingRun]
  let agentRuns = 0
  const created = await createRunner(cloud, {
    runtimeReadiness: async () => ({
      state: 'unavailable',
      reason: 'Runtime remains unavailable while the HumanNeeded transition is pending.'
    }),
    run: async () => {
      agentRuns += 1
      throw new Error('Recovery must not rerun a Worker awaiting its HumanNeeded transition.')
    }
  }, initial)

  await created.adapter.recover()
  await created.adapter.waitForIdle()

  const recovered = created.store.snapshot().taskRuns[0]
  assert.equal(agentRuns, 0)
  assert.equal(recovered?.state, 'needs-human')
  assert.equal(recovered?.execution?.state, 'running')
  assert.equal(cloud.commands.includes('task.result.submit'), false)
  assert.equal(cloud.commands.includes('task.execution.fail'), false)
})

test('post-claim Cloud authority denial closes the execution through the canonical failure command', async () => {
  const cloud = new FakeWorkerCloud('running')
  cloud.denyPreflight()
  const initial = emptyState()
  initial.tasks = [cloud.task]
  initial.taskRuns = [durableTaskRun(cloud, {
    expectedTaskRevision: 1,
    expectedExecutionRevision: 1
  })]
  let agentRuns = 0
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      agentRuns += 1
      throw new Error('Denied authority must not reach Runtime.')
    }
  }, initial)

  await created.adapter.recover()
  await created.adapter.waitForIdle()

  assert.equal(agentRuns, 0)
  assert.deepEqual(cloud.preflightExpectedRevisions, [{ task: 1, execution: 1 }])
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), ['task.execution.fail'])
  assert.equal(created.store.snapshot().taskRuns[0]?.state, 'failed')
})

test('membership-removal Cloud denial reaches neither Provider DownloadCheck nor upload-new', async () => {
  const cloud = new FakeWorkerCloud('running', true)
  cloud.denyPreflight('membership_removal')
  const initial = emptyState()
  initial.tasks = [cloud.task]
  initial.taskRuns = [durableTaskRun(cloud, {
    expectedTaskRevision: cloud.task.revision,
    expectedExecutionRevision: cloud.execution.revision
  })]
  const systemCapabilityCalls: string[] = []
  let agentRuns = 0
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      agentRuns += 1
      throw new Error('A removed member must not reach Runtime or Provider transfer.')
    }
  }, initial, capabilityInvoker(async (contract) => {
    systemCapabilityCalls.push(contract.actionId)
    throw new Error(`Removed membership reached ${contract.actionId}.`)
  }))

  await created.adapter.recover()
  await created.adapter.waitForIdle()

  assert.equal(agentRuns, 0)
  assert.deepEqual(systemCapabilityCalls, [])
  assert.deepEqual(cloud.preflight().decision, {
    outcome: 'denied',
    reasons: ['membership_not_active', 'user_authority_not_eligible', 'execution_fenced']
  })
  assert.equal(cloud.commands.includes('external_operation.prepare'), false)
  assert.equal(cloud.commands.includes('task.result.submit'), false)
})

test('an unavailable Device leaves the User offer unclaimed without rejecting it globally', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  initial.workerAcceptancePolicies = [{
    agentId: TEST_IDS.agentId,
    mode: 'automatic',
    updatedAt: TEST_TIMESTAMP
  }]
  const { adapter, store } = await createRunner(cloud, {
    runtimeReadiness: async () => ({
      state: 'unavailable',
      reason: 'The configured Runtime is temporarily unavailable.'
    }),
    run: async () => { throw new Error('Unavailable Runtime must not execute a Task.') }
  }, initial)

  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()

  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [])
  assert.equal(store.snapshot().taskRuns.length, 0)
  assert.equal(store.snapshot().pendingTaskOffers[0]?.state, 'failed')
  assert.match(store.snapshot().pendingTaskOffers[0]?.error ?? '', /Another Device may still claim/u)
})

test('a terminal AgentRuntime failure is journaled and fails only the current execution', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  initial.workerAcceptancePolicies = [{
    agentId: TEST_IDS.agentId,
    mode: 'automatic',
    updatedAt: TEST_TIMESTAMP
  }]
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => ({
      runtimeId: 'codex',
      threadId: 'worker-failed-thread',
      turnId: 'worker-failed-turn',
      state: 'failed',
      text: 'Bounded Runtime failure.'
    })
  }, initial)

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()

  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'task.offer.accept',
    'task.execution.start',
    'task.execution.fail'
  ])
  const run = created.store.snapshot().taskRuns[0]
  assert.equal(run?.state, 'failed')
  assert.equal(run?.execution?.state, 'failed')
  assert.equal(run?.agentJournal.length, 1)
  assert.equal(run?.agentJournal[0]?.state, 'observed_failure')
  assert.equal(run?.agentJournal[0]?.runtimeId, 'codex')
  assert.equal(run?.agentJournal[0]?.threadId, 'worker-failed-thread')
  assert.equal(run?.agentJournal[0]?.turnId, 'worker-failed-turn')
  assert.equal(run?.agentJournal[0]?.runtimeState, 'failed')
  assert.equal(run?.lateOutcomes.length, 0)
})

test('file Provider denial leaves the User offer unclaimed after generic token-free preflight', async () => {
  const cloud = new FakeWorkerCloud('offered', true)
  const capabilityCalls: string[] = []
  const capabilities = capabilityInvoker(
    async (contract) => {
      capabilityCalls.push(contract.actionId)
      throw new Error('No current Provider binding is available.')
    }
  )
  const initial = emptyState()
  initial.workerAcceptancePolicies = [{
    agentId: TEST_IDS.agentId,
    mode: 'automatic',
    updatedAt: TEST_TIMESTAMP
  }]
  const { adapter, store } = await createRunner(cloud, neverAgent(), initial, capabilities)

  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle()

  assert.deepEqual(capabilityCalls, [CONTENT_SPACE_SYSTEM_TRANSFER_PREFLIGHT_CONTRACT.actionId])
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [])
  assert.equal(store.snapshot().taskRuns.length, 0)
  assert.equal(store.snapshot().pendingTaskOffers[0]?.state, 'failed')
  assert.match(store.snapshot().pendingTaskOffers[0]?.error ?? '', /Provider session is not ready/u)
})

test('operation-time Provider denial fails the accepted execution without Runtime or a result', async () => {
  const cloud = new FakeWorkerCloud('offered', true)
  const initial = emptyState()
  initial.workerAcceptancePolicies = [{
    agentId: TEST_IDS.agentId,
    mode: 'automatic',
    updatedAt: TEST_TIMESTAMP
  }]
  let invocationOrdinal = 0
  let agentRuns = 0
  const capabilities = capabilityInvoker(async (contract, input, options) => {
    invocationOrdinal += 1
    if (contract.actionId === CONTENT_SPACE_SYSTEM_TRANSFER_PREFLIGHT_CONTRACT.actionId) {
      return contract.outputSchema.parse(contentPreflightResult(
        invocationOrdinal,
        options?.workspaceId ?? '',
        input
      ))
    }
    if (contract.actionId === CONTENT_SPACE_SYSTEM_DOWNLOAD_CONTRACT.actionId) {
      return contract.outputSchema.parse({
        ok: false,
        error: {
          code: 'unauthorized',
          message: 'The current Provider session failed DownloadCheck.',
          retry: 'after-human-action'
        }
      })
    }
    throw new Error(`Unexpected system capability ${contract.actionId}.`)
  })
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      agentRuns += 1
      throw new Error('Runtime must not see an unauthorized input file.')
    }
  }, initial, capabilities)

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()

  const run = created.store.snapshot().taskRuns[0]
  assert.equal(agentRuns, 0)
  assert.equal(run?.state, 'failed')
  assert.equal(run?.externalJournal[0]?.state, 'observed_failure')
  assert.equal(run?.externalJournal[0]?.safeFailureCode, 'unauthorized')
  assert.equal(run?.outputs.length, 0)
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'task.offer.accept',
    'task.execution.start',
    'external_operation.prepare',
    'external_operation.dispatch',
    'external_operation.observe',
    'task.execution.fail'
  ])
  const failure = cloud.requests.find((request) => request.type === 'task.execution.fail')
  assert.equal(failure?.type === 'task.execution.fail' ? failure.safeFailureCode : null, 'provider_not_ready')
  assert.equal(cloud.commands.includes('task.result.submit'), false)
})

test('file execution journals Cloud and local dispatch before one real generic download and upload', async () => {
  const cloud = new FakeWorkerCloud('offered', true)
  const transferCalls: Array<Readonly<{
    actionId: string
    input: unknown
    options: unknown
  }>> = []
  let store!: CollaborationLocalStore
  let invocationOrdinal = 0
  const invokeSystemCapability: DomainMainSystemCapabilityInvoker['invoke'] = async (
    contract,
    input,
    options
  ) => {
      invocationOrdinal += 1
      if (contract.actionId === CONTENT_SPACE_SYSTEM_TRANSFER_PREFLIGHT_CONTRACT.actionId) {
        assert.equal(Object.hasOwn(options ?? {}, 'idempotencyKey'), false)
        return contract.outputSchema.parse(contentPreflightResult(
          invocationOrdinal,
          options?.workspaceId ?? '',
          input
        ))
      }
      transferCalls.push({ actionId: contract.actionId, input, options })
      const run = store.snapshot().taskRuns[0]
      const journal = run?.externalJournal.find(({ state }) => state === 'effect_dispatched')
      assert.equal(journal?.cloudJournal?.state, 'dispatched')
      assert.equal(typeof options?.idempotencyKey, 'string')
      if (contract.actionId === CONTENT_SPACE_SYSTEM_DOWNLOAD_CONTRACT.actionId) {
        return contract.outputSchema.parse(contentDownloadResult(
          invocationOrdinal,
          options?.workspaceId ?? ''
        ))
      }
      if (contract.actionId === CONTENT_SPACE_SYSTEM_UPLOAD_NEW_CONTRACT.actionId) {
        return contract.outputSchema.parse(contentUploadResult(
          invocationOrdinal,
          options?.workspaceId ?? ''
        ))
      }
      throw new Error(`Unexpected system capability ${contract.actionId}.`)
  }
  const capabilities = capabilityInvoker(invokeSystemCapability)
  const initial = emptyState()
  initial.workerAcceptancePolicies = [{
    agentId: TEST_IDS.agentId,
    mode: 'automatic',
    updatedAt: TEST_TIMESTAMP
  }]
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async (request) => {
      const run = store.snapshot().taskRuns[0]
      assert.equal(
        run?.externalJournal.filter(({ operation, state }) => (
          operation === 'download' && state === 'observed_success'
        )).length,
        1,
        'Agent may start only after the exact input download was durably observed.'
      )
      assert.equal(request.workspaceRoot, run?.workspaceRoot)
      assert.match(request.clientDirectiveId ?? '', /^collab-worker-[a-f0-9]{48}$/u)
      assert.equal(request.interaction, 'reviewable')
      assert.equal(request.mode, 'agent')
      assert.equal(request.runtimeId, 'codex')
      assert.equal(request.threadId, 'worker-thread-stable')
      assert.deepEqual(request.metadata, {
        source: 'collaboration.worker-task',
        projectId: TEST_IDS.projectId,
        taskId: TEST_IDS.taskId,
        executionId: TEST_IDS.executionId,
        taskRevision: run?.expectedTaskRevision,
        executionRevision: run?.expectedExecutionRevision
      })
      assert.match(request.prompt, /input\.csv/u)
      assert.match(request.prompt, /analysis\.md/u)
      return {
        runtimeId: request.runtimeId!,
        threadId: request.threadId!,
        turnId: 'worker-file-turn',
        state: 'completed',
        text: JSON.stringify({
          schemaVersion: 1,
          outcome: 'completed',
          summary: 'File analysis is ready.'
        })
      }
    }
  }, initial, capabilities)
  store = created.store

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()

  assert.deepEqual(transferCalls.map(({ actionId }) => actionId), [
    CONTENT_SPACE_SYSTEM_DOWNLOAD_CONTRACT.actionId,
    CONTENT_SPACE_SYSTEM_UPLOAD_NEW_CONTRACT.actionId
  ])
  for (const call of transferCalls) {
    assert.equal(JSON.stringify(call.input).includes('/tmp/'), false)
    const options = call.options as Readonly<{
      workspaceId?: string
      idempotencyKey?: string
      systemExecutionContext?: unknown
      signal?: AbortSignal
    }> | undefined
    assert.equal(options?.workspaceId, `/tmp/sciforge-worker-${TEST_IDS.executionId}`)
    assert.match(options?.idempotencyKey ?? '', /^content_[a-f0-9]{48}$/u)
    assert.deepEqual(options?.systemExecutionContext, {
      contractVersion: 1,
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      executionRevision: 2
    })
    assert.equal(options?.signal?.aborted, false)
  }
  const run = store.snapshot().taskRuns[0]
  assert.equal(run?.state, 'completed')
  assert.equal(run?.agentJournal.length, 1)
  assert.equal(run?.agentJournal[0]?.state, 'observed_success')
  assert.equal(run?.agentJournal[0]?.runtimeId, 'codex')
  assert.equal(run?.agentJournal[0]?.threadId, 'worker-thread-stable')
  assert.equal(run?.agentJournal[0]?.turnId, 'worker-file-turn')
  assert.equal(run?.agentJournal[0]?.runtimeState, 'completed')
  assert.deepEqual(run?.externalJournal.map(({ state }) => state), [
    'observed_success',
    'observed_success'
  ])
  assert.equal(run?.outputs.length, 1)
  assert.equal(run?.recoveryJournalEntryIds.length, 2)
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'task.offer.accept',
    'task.execution.start',
    'external_operation.prepare',
    'external_operation.dispatch',
    'external_operation.observe',
    'external_operation.prepare',
    'external_operation.dispatch',
    'external_operation.observe',
    'task.result.submit'
  ])
  const submission = cloud.requests.find((request) => request.type === 'task.result.submit')
  assert.equal(submission?.type, 'task.result.submit')
  if (submission?.type !== 'task.result.submit') throw new Error('Missing strict Task result submission.')
  const outputReference = {
    contractVersion: 1 as const,
    kind: 'content-space.file-reference' as const,
    authority: ROOT_LOCATOR.authority,
    identity: { fileId: 'analysis-output-alpha' }
  }
  assert.deepEqual(submission.runtimeProvenance, {
    runtimeId: 'codex',
    modelId: null,
    startedAt: TEST_LATER_TIMESTAMP,
    completedAt: TEST_LATER_TIMESTAMP
  })
  assert.deepEqual(submission.outputs, [{
    executionId: TEST_IDS.executionId,
    assignmentTaskRevision: 2,
    locator: outputReference,
    locatorDigest: digestFixture(outputReference),
    rootLocatorDigest: ROOT_LOCATOR_DIGEST,
    bindingRevision: FILE_BINDING_REVISION,
    transferReceiptDigest: '8'.repeat(64),
    observationDigest: '9'.repeat(64),
    preflightObservationDigest: '3'.repeat(64)
  }])
  assert.equal(submission.summary, 'File analysis is ready.')
  assert.equal(submission.submissionDigest, digestFixture({
    taskId: submission.taskId,
    executionId: submission.executionId,
    expectedTaskRevision: submission.expectedTaskRevision,
    expectedExecutionRevision: submission.expectedExecutionRevision,
    summary: submission.summary,
    runtimeProvenance: submission.runtimeProvenance,
    outputs: submission.outputs,
    recoveryJournalEntryIds: submission.recoveryJournalEntryIds
  }))
})

test('a late Provider upload success after Device fencing remains journal-only and is never submitted', async () => {
  const cloud = new FakeWorkerCloud('offered', true)
  const uploadStarted = deferred<void>()
  const releaseUpload = deferred<void>()
  let invocationOrdinal = 0
  const capabilities = capabilityInvoker(async (contract, input, options) => {
    invocationOrdinal += 1
    if (contract.actionId === CONTENT_SPACE_SYSTEM_TRANSFER_PREFLIGHT_CONTRACT.actionId) {
      return contract.outputSchema.parse(contentPreflightResult(
        invocationOrdinal,
        options?.workspaceId ?? '',
        input
      ))
    }
    if (contract.actionId === CONTENT_SPACE_SYSTEM_DOWNLOAD_CONTRACT.actionId) {
      return contract.outputSchema.parse(contentDownloadResult(
        invocationOrdinal,
        options?.workspaceId ?? ''
      ))
    }
    if (contract.actionId === CONTENT_SPACE_SYSTEM_UPLOAD_NEW_CONTRACT.actionId) {
      uploadStarted.resolve()
      await releaseUpload.promise
      return contract.outputSchema.parse(contentUploadResult(
        invocationOrdinal,
        options?.workspaceId ?? ''
      ))
    }
    throw new Error(`Unexpected system capability ${contract.actionId}.`)
  })
  const initial = emptyState()
  initial.workerAcceptancePolicies = [{
    agentId: TEST_IDS.agentId,
    mode: 'automatic',
    updatedAt: TEST_TIMESTAMP
  }]
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => ({
      runtimeId: 'codex',
      threadId: 'worker-late-upload-thread',
      turnId: 'worker-late-upload-turn',
      state: 'completed',
      text: JSON.stringify({
        schemaVersion: 1,
        outcome: 'completed',
        summary: 'The upload can begin.'
      })
    })
  }, initial, capabilities)

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await uploadStarted.promise
  await created.adapter.fenceLocalAgent(TEST_IDS.agentId, 'Device authority was revoked.')
  releaseUpload.resolve()
  await created.adapter.waitForIdle()

  const run = created.store.snapshot().taskRuns[0]
  const upload = run?.externalJournal.find(({ operation }) => operation === 'upload_new')
  assert.equal(run?.state, 'fenced')
  assert.equal(upload?.state, 'late_outcome')
  assert.ok(upload?.receiptDigest)
  assert.ok(upload.observationDigest)
  assert.equal(run?.outputs.length, 0)
  assert.deepEqual(run?.lateOutcomes.map(({ source, outcome }) => ({ source, outcome })), [{
    source: 'content_space',
    outcome: 'completed_after_fence'
  }])
  assert.equal(cloud.requests.some((request) => (
    request.type === 'external_operation.observe' &&
    request.journalEntryId === upload?.cloudJournal?.contentRecoveryJournalEntryId
  )), false)
  assert.equal(cloud.commands.includes('task.result.submit'), false)
})

test('restart after Provider dispatch records outcome unknown and requires manual recovery', async () => {
  const cloud = new FakeWorkerCloud('running', true)
  const cloudJournal = externalOperationRecoveryJournalEntrySchema.parse({
    schemaVersion: 1,
    type: 'external_operation_recovery_journal_entry',
    contentRecoveryJournalEntryId: 'crj_WorkerJournal9999',
    scope: 'task_content_transfer',
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    preparedTaskRevision: cloud.task.revision,
    preparedExecutionRevision: cloud.execution.revision,
    provisioningIntentId: null,
    provisioningRevision: null,
    logicalInvocationId: `download.${TEST_IDS.executionId}.restart`,
    operation: 'download',
    state: 'dispatched',
    requestDigest: TEST_HASH,
    receiptDigest: null,
    observationDigest: null,
    safeFailureCode: null,
    preparedAt: TEST_TIMESTAMP,
    dispatchedAt: TEST_LATER_TIMESTAMP,
    resolvedAt: null,
    revision: 2,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP
  })
  cloud.seedRecoveryJournal(cloudJournal)
  const initial = emptyState()
  initial.tasks = [cloud.task]
  initial.taskRuns = [{
    offer: offerJournal(),
    task: cloud.task,
    execution: cloud.execution,
    latestPreflight: {
      cloud: cloud.preflight(),
      outcome: 'allowed',
      reasons: [],
      contentTransferReadiness: [],
      evaluatedAt: TEST_TIMESTAMP
    },
    decision: { decision: 'accept', decidedAt: TEST_TIMESTAMP },
    expectedTaskRevision: cloud.task.revision,
    expectedExecutionRevision: cloud.execution.revision,
    state: 'running',
    workspaceRoot: '/tmp/sciforge-worker-provider-restart',
    runtimeId: null,
    threadId: null,
    humanRequestId: null,
    humanAnswer: null,
    resources: fileResources(cloud.execution.fence.assignmentTaskRevision),
    agentJournal: [],
    externalJournal: [{
      logicalInvocationId: cloudJournal.logicalInvocationId,
      operation: 'download',
      workspaceRelativePath: 'input.csv',
      requestDigest: cloudJournal.requestDigest,
      state: 'effect_dispatched',
      cloudJournal,
      receiptDigest: null,
      observationDigest: null,
      preparedAt: TEST_TIMESTAMP,
      effectDispatchedAt: TEST_LATER_TIMESTAMP,
      observedAt: null,
      safeFailureCode: null,
      safeError: null
    }],
    outputs: [],
    recoveryJournalEntryIds: [],
    resultSummary: null,
    lateOutcomes: [],
    startedAt: TEST_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP,
    completedAt: null,
    error: null
  }]
  const created = await createRunner(cloud, neverAgent(), initial)

  await created.adapter.recover()
  await created.adapter.waitForIdle()

  const recovered = created.store.snapshot().taskRuns[0]
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'external_operation.observe'
  ])
  assert.deepEqual(cloud.requests.filter((request) => (
    request.type === 'worker.availability.publish'
  )).map((request) => request.type === 'worker.availability.publish'
    ? request.activeTaskCount
    : -1), [0])
  assert.equal(recovered?.state, 'manual-recovery')
  assert.equal(recovered?.externalJournal[0]?.state, 'outcome_unknown')
  assert.equal(recovered?.lateOutcomes[0]?.outcome, 'outcome_unknown')
})

test('a linked exact Provider observation submits the preserved Worker result without rerunning Runtime or upload', async () => {
  const cloud = new FakeWorkerCloud('running', true)
  const recovery = manualRecoveryFixture(cloud)
  let agentRuns = 0
  let contentInvocations = 0
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      agentRuns += 1
      throw new Error('Human-linked recovery must not rerun Agent Runtime.')
    }
  }, recovery.initial, capabilityInvoker(async () => {
    contentInvocations += 1
    throw new Error('Human-linked recovery must not repeat a Provider transfer.')
  }))

  await created.adapter.handleInbox(recovery.linkedMessage)

  const recovered = created.store.snapshot().taskRuns[0]
  assert.equal(agentRuns, 0)
  assert.equal(contentInvocations, 0)
  assert.equal(recovered?.state, 'completed')
  const uploadJournal = recovered?.externalJournal.find(({ operation }) => operation === 'upload_new')
  assert.equal(uploadJournal?.state, 'observed_success')
  assert.equal(uploadJournal?.cloudJournal?.state, 'observed_success')
  assert.equal(
    uploadJournal?.cloudJournal?.revision,
    recovery.linkedMessage.payload.type === 'task.recovery.output_linked'
      ? recovery.linkedMessage.payload.journalRevision
      : -1
  )
  assert.deepEqual(recovered?.outputs, [recovery.output])
  assert.deepEqual(recovered?.recoveryJournalEntryIds, [
    RECOVERY_DOWNLOAD_JOURNAL_ID,
    RECOVERY_JOURNAL_ID
  ])
  assert.equal(
    recovered?.resources.some(({ resourceRefId }) => resourceRefId === RECOVERY_OUTPUT_RESOURCE_ID),
    true
  )
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'task.result.submit'
  ])

  await created.adapter.handleInbox(agentInboxMessageSchema.parse({
    ...recovery.linkedMessage,
    inboxMessageId: 'ibx_RecoveryLinkedDuplicate',
    sequence: recovery.linkedMessage.sequence + 1
  }))
  assert.equal(agentRuns, 0)
  assert.equal(contentInvocations, 0)
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'task.result.submit'
  ])
})

test('a recovery link is rejected after the exact execution has been superseded', async () => {
  const cloud = new FakeWorkerCloud('running', true)
  const recovery = manualRecoveryFixture(cloud)
  cloud.supersedeManualRecovery()
  const created = await createRunner(cloud, neverAgent(), recovery.initial)

  await assert.rejects(
    created.adapter.handleInbox(recovery.linkedMessage),
    /exact current manual-recovery execution/u
  )

  assert.equal(created.store.snapshot().taskRuns[0]?.state, 'manual-recovery')
  assert.equal(cloud.commands.includes('task.result.submit'), false)
})

test('an exact recovery abandonment fences the local Worker journal without Runtime, Provider, or result writes', async () => {
  const cloud = new FakeWorkerCloud('running', true)
  const recovery = manualRecoveryFixture(cloud)
  const abandoned = cloud.abandonManualRecovery()
  let agentRuns = 0
  let contentInvocations = 0
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      agentRuns += 1
      throw new Error('Abandoned recovery must not rerun Agent Runtime.')
    }
  }, recovery.initial, capabilityInvoker(async () => {
    contentInvocations += 1
    throw new Error('Abandoned recovery must not invoke Content Space.')
  }))
  const message = recoveryAbandonedMessage(abandoned.task, abandoned.execution)

  await created.adapter.handleInbox(message)
  await created.adapter.handleInbox(agentInboxMessageSchema.parse({
    ...message,
    inboxMessageId: 'ibx_RecoveryAbandonedDuplicate',
    sequence: message.sequence + 1
  }))

  const run = created.store.snapshot().taskRuns[0]
  assert.equal(agentRuns, 0)
  assert.equal(contentInvocations, 0)
  assert.equal(run?.state, 'fenced')
  assert.equal(run?.task?.status, 'revision_requested')
  assert.equal(run?.execution?.state, 'cancelled')
  assert.equal(run?.execution?.fence.reason, 'manual_recovery_abandoned')
  assert.equal(cloud.commands.includes('task.result.submit'), false)
})

test('restart after accept starts and completes the same execution without accepting it twice', async () => {
  const cloud = new FakeWorkerCloud('accepted')
  const initial = emptyState()
  initial.tasks = [cloud.task]
  initial.taskRuns = [durableTaskRun(cloud, {
    state: 'accepting',
    startedAt: null
  })]
  let agentRuns = 0
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      agentRuns += 1
      return {
        runtimeId: 'codex',
        threadId: 'worker-accepted-restart-thread',
        turnId: 'worker-accepted-restart-turn',
        state: 'completed',
        text: JSON.stringify({ schemaVersion: 1, outcome: 'completed', summary: 'Recovered.' })
      }
    }
  }, initial)

  await created.adapter.recover()
  await created.adapter.waitForIdle()

  assert.equal(agentRuns, 1)
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'task.execution.start',
    'task.result.submit'
  ])
  assert.equal(created.store.snapshot().taskRuns[0]?.offer.executionId, TEST_IDS.executionId)
  assert.equal(created.store.snapshot().taskRuns[0]?.state, 'completed')
})

test('a response lost after the Cloud offer claim resumes its durable receipt into the original execution', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  initial.workerAcceptancePolicies = [{
    agentId: TEST_IDS.agentId,
    mode: 'automatic',
    updatedAt: TEST_TIMESTAMP
  }]
  const backend = new MemoryBackend(initial)
  const acceptedRequests: RestRequest[] = []
  let acceptedResponse: RestResponse | undefined
  let acceptAttempts = 0
  let businessCommits = 0
  let loseFirstResponse = true
  const outboxFactory = (store: CollaborationLocalStore) => new DurableCloudOutbox({
    store,
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: async (agentId) => ({
        state: 'ready',
        agentId,
        userId: agentNodeFixture.ownerUserId,
        deviceId: agentNodeFixture.deviceId!,
        generation: agentNodeFixture.credentialVersion,
        runtimeId: 'codex',
        capabilityTags: ['agent-runtime.codex', 'model-access.api']
      }),
      execute: async (_agentId, request) => {
        if (request.type === 'worker.availability.publish') {
          return entityResponse(request, agentNodeFixture)
        }
        if (request.type !== 'task.offer.accept') {
          return cloud.outbox().enqueueAndWait('task.progress', request)
        }
        acceptAttempts += 1
        acceptedRequests.push(structuredClone(request))
        if (!acceptedResponse) {
          acceptedResponse = await cloud.outbox().enqueueAndWait('task.offer-decision', request)
          businessCommits += 1
        }
        if (loseFirstResponse) {
          loseFirstResponse = false
          throw new Error('response lost after canonical Cloud claim commit')
        }
        return acceptedResponse
      }
    }),
    localAgentId: () => TEST_IDS.agentId,
    now: () => new Date(TEST_TIMESTAMP)
  })
  const interrupted = await createRunner(
    cloud,
    neverAgent(),
    initial,
    noContentCapabilities(),
    backend,
    outboxFactory
  )

  await interrupted.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await interrupted.adapter.waitForIdle()

  assert.equal(interrupted.store.snapshot().pendingTaskOffers[0]?.state, 'claiming')
  assert.equal(interrupted.store.snapshot().taskRuns.length, 0)
  assert.equal(interrupted.store.snapshot().outbox[0]?.state, 'failed')
  assert.equal(acceptAttempts, 1)
  assert.equal(businessCommits, 1)
  await interrupted.adapter.handleInbox(agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    inboxMessageId: 'ibx_SelfClaimAfterLostResponse1',
    sequence: 2,
    payload: {
      protocolVersion: '1.0',
      type: 'task.offer.claimed',
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      taskOfferId: OFFER_ID,
      claimedByAgentId: TEST_IDS.agentId,
      executionId: TEST_IDS.executionId,
      offerRevision: 2
    }
  }))
  assert.equal(interrupted.store.snapshot().pendingTaskOffers[0]?.state, 'claiming')
  interrupted.adapter.stop()
  interrupted.outbox.stop()

  let agentRuns = 0
  const resumed = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      agentRuns += 1
      return {
        runtimeId: 'codex',
        threadId: 'worker-claim-response-loss-thread',
        turnId: 'worker-claim-response-loss-turn',
        state: 'completed',
        text: JSON.stringify({
          schemaVersion: 1,
          outcome: 'completed',
          summary: 'Recovered the original accepted execution.'
        })
      }
    }
  }, initial, noContentCapabilities(), backend, outboxFactory)

  await resumed.adapter.recover()
  await resumed.adapter.waitForIdle()
  await resumed.outbox.waitForIdle()

  assert.equal(acceptAttempts, 2)
  assert.equal(businessCommits, 1)
  assert.deepEqual(acceptedRequests[1], acceptedRequests[0])
  assert.equal(agentRuns, 1)
  assert.equal(resumed.store.snapshot().pendingTaskOffers.length, 0)
  assert.equal(resumed.store.snapshot().taskRuns.length, 1)
  assert.equal(resumed.store.snapshot().taskRuns[0]?.offer.executionId, TEST_IDS.executionId)
  assert.equal(resumed.store.snapshot().taskRuns[0]?.state, 'completed')
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'task.offer.accept',
    'task.execution.start',
    'task.result.submit'
  ])
})

test('an offer claim remains resumable when its outbox retry is already reconciling', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  initial.workerAcceptancePolicies = [{
    agentId: TEST_IDS.agentId,
    mode: 'automatic',
    updatedAt: TEST_TIMESTAMP
  }]
  const outboxFactory = (store: CollaborationLocalStore) => ({
    enqueueAndWait: async (kind: string, rawRequest: RestRequest): Promise<RestResponse> => {
      const request = restRequestSchema.parse(rawRequest)
      assert.equal(kind, 'task.offer-decision')
      assert.equal(request.type, 'task.offer.accept')
      if (request.type !== 'task.offer.accept') throw new Error('Invalid claim race fixture.')
      await store.transact((draft) => {
        draft.outbox.push({
          outboxId: 'obx_WorkerClaimReconciling1',
          idempotencyKey: request.idempotencyKey,
          kind: 'task.offer-decision',
          body: request,
          state: 'reconciling',
          attempts: 1,
          createdAt: TEST_TIMESTAMP,
          updatedAt: TEST_LATER_TIMESTAMP
        })
      })
      throw new Error('response outcome is still being reconciled')
    }
  }) as unknown as DurableCloudOutbox
  const created = await createRunner(
    cloud,
    neverAgent(),
    initial,
    noContentCapabilities(),
    new MemoryBackend(initial),
    outboxFactory
  )

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()

  assert.equal(created.store.snapshot().outbox[0]?.state, 'reconciling')
  assert.equal(created.store.snapshot().pendingTaskOffers[0]?.state, 'claiming')
  assert.equal(created.store.snapshot().taskRuns.length, 0)
})

test('a strict Cloud offer-claim conflict is terminal locally and is not retried', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  initial.workerAcceptancePolicies = [{
    agentId: TEST_IDS.agentId,
    mode: 'automatic',
    updatedAt: TEST_TIMESTAMP
  }]
  let claimAttempts = 0
  const outboxFactory = (store: CollaborationLocalStore) => new DurableCloudOutbox({
    store,
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: async (agentId) => ({
        state: 'ready',
        agentId,
        userId: agentNodeFixture.ownerUserId,
        deviceId: agentNodeFixture.deviceId!,
        generation: agentNodeFixture.credentialVersion,
        runtimeId: 'codex',
        capabilityTags: ['agent-runtime.codex', 'model-access.api']
      }),
      execute: async (_agentId, request) => {
        assert.equal(request.type, 'task.offer.accept')
        claimAttempts += 1
        return restResponseSchema.parse({
          protocolVersion: '1.0',
          type: 'rest.error',
          requestId: request.requestId,
          error: createCollaborationError(
            'revision_conflict',
            'Another Device already claimed this User offer.'
          )
        })
      }
    }),
    localAgentId: () => TEST_IDS.agentId,
    now: () => new Date(TEST_TIMESTAMP)
  })
  const created = await createRunner(
    cloud,
    neverAgent(),
    initial,
    noContentCapabilities(),
    new MemoryBackend(initial),
    outboxFactory
  )

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await created.adapter.waitForIdle()
  await created.adapter.recover()
  await created.adapter.waitForIdle()

  assert.equal(claimAttempts, 1)
  assert.equal(created.store.snapshot().pendingTaskOffers[0]?.state, 'failed')
  assert.equal(created.store.snapshot().taskRuns.length, 0)
  assert.equal(created.store.snapshot().outbox[0]?.state, 'delivered')
})

test('restart after a durable offer claim receipt persists and runs the same Cloud execution', async () => {
  const cloud = new FakeWorkerCloud()
  const offeredTask = structuredClone(cloud.task)
  const requestFacts = {
    taskOfferId: OFFER_ID,
    taskId: TEST_IDS.taskId,
    expectedTaskRevision: 1,
    expectedOfferRevision: 1
  }
  const claimRequest = restRequestSchema.parse({
    protocolVersion: '1.0',
    requestId: 'req_WorkerClaimCrash01',
    type: 'task.offer.accept',
    idempotencyKey: `idem_task.offer.accept.${digestFixture(requestFacts).slice(0, 48)}`,
    ...requestFacts
  })
  if (claimRequest.type !== 'task.offer.accept') throw new Error('Invalid claim fixture.')
  const claimResponse = await cloud.outbox().enqueueAndWait('task.offer-decision', claimRequest)
  const initial = emptyState()
  initial.tasks = [offeredTask]
  initial.workerAcceptancePolicies = [{
    agentId: TEST_IDS.agentId,
    mode: 'automatic',
    updatedAt: TEST_TIMESTAMP
  }]
  initial.pendingTaskOffers = [{
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    taskOfferId: OFFER_ID,
    workerUserId: TEST_IDS.userId,
    currentTaskRevision: 1,
    offerRevision: 1,
    recipientAgentId: TEST_IDS.agentId,
    receivedAt: TEST_TIMESTAMP,
    preflightReasons: [],
    state: 'claiming',
    updatedAt: TEST_TIMESTAMP,
    completedAt: null,
    error: null
  }]
  initial.outbox = [{
    outboxId: 'obx_WorkerClaimCrash01',
    idempotencyKey: claimRequest.idempotencyKey,
    kind: 'task.offer-decision',
    body: claimRequest,
    state: 'delivered',
    attempts: 1,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP,
    deliveredAt: TEST_LATER_TIMESTAMP,
    response: claimResponse
  }]
  const backend = new FailOnceTaskRunBackend(initial)
  const interrupted = await createRunner(cloud, neverAgent(), initial, noContentCapabilities(), backend)

  await interrupted.adapter.recover()
  await interrupted.adapter.waitForIdle()

  assert.equal(interrupted.store.snapshot().pendingTaskOffers[0]?.state, 'claiming')
  assert.equal(interrupted.store.snapshot().taskRuns.length, 0)
  assert.equal(cloud.commands.filter((type) => type === 'task.offer.accept').length, 1)
  interrupted.adapter.stop()

  let agentRuns = 0
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      agentRuns += 1
      return {
        runtimeId: 'codex',
        threadId: 'worker-claim-crash-thread',
        turnId: 'worker-claim-crash-turn',
        state: 'completed',
        text: JSON.stringify({ schemaVersion: 1, outcome: 'completed', summary: 'Recovered claim.' })
      }
    }
  }, initial, noContentCapabilities(), backend)

  await created.adapter.recover()
  await created.adapter.waitForIdle()

  assert.equal(agentRuns, 1)
  assert.equal(created.store.snapshot().pendingTaskOffers.length, 0)
  assert.equal(created.store.snapshot().taskRuns.length, 1)
  assert.equal(created.store.snapshot().taskRuns[0]?.offer.executionId, TEST_IDS.executionId)
  assert.equal(created.store.snapshot().taskRuns[0]?.state, 'completed')
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'task.offer.accept',
    'task.execution.start',
    'task.result.submit'
  ])
})

test('restart after the delivered execution start restores its Cloud timestamp before result submission', async () => {
  const cloud = new FakeWorkerCloud('accepted')
  const initial = emptyState()
  initial.tasks = [cloud.task]
  initial.taskRuns = [durableTaskRun(cloud, {
    state: 'accepting',
    startedAt: null
  })]
  const backend = new FailOnceStartedRunBackend(initial)
  let startBusinessCommits = 0
  const outboxFactory = (store: CollaborationLocalStore) => new DurableCloudOutbox({
    store,
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: async (agentId) => ({
        state: 'ready',
        agentId,
        userId: agentNodeFixture.ownerUserId,
        deviceId: agentNodeFixture.deviceId!,
        generation: agentNodeFixture.credentialVersion,
        runtimeId: 'codex',
        capabilityTags: ['agent-runtime.codex', 'model-access.api']
      }),
      execute: async (_agentId, request) => {
        if (request.type === 'worker.availability.publish') {
          return entityResponse(request, agentNodeFixture)
        }
        if (request.type === 'task.execution.start') startBusinessCommits += 1
        return cloud.outbox().enqueueAndWait('task.progress', request)
      }
    }),
    localAgentId: () => TEST_IDS.agentId,
    now: () => new Date(TEST_TIMESTAMP)
  })
  const interrupted = await createRunner(
    cloud,
    neverAgent(),
    initial,
    noContentCapabilities(),
    backend,
    outboxFactory
  )

  await interrupted.adapter.recover()
  await interrupted.adapter.waitForIdle()
  await interrupted.outbox.waitForIdle()

  const interruptedRun = interrupted.store.snapshot().taskRuns[0]
  assert.equal(interruptedRun?.state, 'accepting')
  assert.equal(interruptedRun?.startedAt, TEST_LATER_TIMESTAMP)
  assert.equal(startBusinessCommits, 1)
  assert.equal(interrupted.store.snapshot().outbox.find(({ kind }) => kind === 'task.progress')?.state, 'delivered')
  interrupted.adapter.stop()
  interrupted.outbox.stop()

  let agentRuns = 0
  const resumed = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      agentRuns += 1
      return {
        runtimeId: 'codex',
        threadId: 'worker-start-checkpoint-thread',
        turnId: 'worker-start-checkpoint-turn',
        state: 'completed',
        text: JSON.stringify({
          schemaVersion: 1,
          outcome: 'completed',
          summary: 'Completed after restoring the Cloud start provenance.'
        })
      }
    }
  }, initial, noContentCapabilities(), backend, outboxFactory)

  await resumed.adapter.recover()
  await resumed.adapter.waitForIdle()
  await resumed.outbox.waitForIdle()

  const startRequest = cloud.requests.find((request) => request.type === 'task.execution.start')
  const resultRequest = cloud.requests.find((request) => request.type === 'task.result.submit')
  assert.equal(startRequest?.type, 'task.execution.start')
  assert.equal(resultRequest?.type, 'task.result.submit')
  assert.equal(
    resultRequest?.type === 'task.result.submit' ? resultRequest.runtimeProvenance.startedAt : null,
    startRequest?.type === 'task.execution.start' ? startRequest.startedAt : null
  )
  assert.equal(startBusinessCommits, 1)
  assert.equal(agentRuns, 1)
  assert.equal(resumed.store.snapshot().taskRuns.length, 1)
  assert.equal(resumed.store.snapshot().taskRuns[0]?.state, 'completed')
  assert.equal(cloud.commands.includes('task.execution.fail'), false)
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'task.execution.start',
    'task.result.submit'
  ])
})

test('a lost execution-start response replays one receipt and resumes with the original Cloud start provenance', async () => {
  const cloud = new FakeWorkerCloud('accepted')
  const initial = emptyState()
  initial.tasks = [cloud.task]
  initial.taskRuns = [durableTaskRun(cloud, {
    state: 'accepting',
    startedAt: null
  })]
  const backend = new MemoryBackend(initial)
  const startAttempts: RestRequest[] = []
  let startResponse: RestResponse | undefined
  let startBusinessCommits = 0
  let loseFirstResponse = true
  const outboxFactory = (store: CollaborationLocalStore) => new DurableCloudOutbox({
    store,
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: async (agentId) => ({
        state: 'ready',
        agentId,
        userId: agentNodeFixture.ownerUserId,
        deviceId: agentNodeFixture.deviceId!,
        generation: agentNodeFixture.credentialVersion,
        runtimeId: 'codex',
        capabilityTags: ['agent-runtime.codex', 'model-access.api']
      }),
      execute: async (_agentId, request) => {
        if (request.type === 'worker.availability.publish') {
          return entityResponse(request, agentNodeFixture)
        }
        if (request.type !== 'task.execution.start') {
          return cloud.outbox().enqueueAndWait('task.result', request)
        }
        startAttempts.push(structuredClone(request))
        if (!startResponse) {
          startResponse = await cloud.outbox().enqueueAndWait('task.progress', request)
          startBusinessCommits += 1
        }
        if (loseFirstResponse) {
          loseFirstResponse = false
          throw new Error('response lost after canonical Cloud execution start')
        }
        return startResponse
      }
    }),
    localAgentId: () => TEST_IDS.agentId,
    now: () => new Date(TEST_TIMESTAMP)
  })
  const interrupted = await createRunner(
    cloud,
    neverAgent(),
    initial,
    noContentCapabilities(),
    backend,
    outboxFactory
  )

  await interrupted.adapter.recover()
  await interrupted.adapter.waitForIdle()

  const failedStart = interrupted.store.snapshot().outbox.find(({ kind }) => kind === 'task.progress')
  assert.equal(failedStart?.state, 'failed')
  assert.equal(interrupted.store.snapshot().taskRuns[0]?.startedAt, TEST_LATER_TIMESTAMP)
  assert.equal(startBusinessCommits, 1)
  assert.ok(failedStart)
  await interrupted.outbox.retry(failedStart.idempotencyKey)
  await interrupted.outbox.waitForIdle()
  assert.equal(interrupted.store.snapshot().outbox.find(({ kind }) => kind === 'task.progress')?.state, 'delivered')
  assert.equal(startAttempts.length, 2)
  assert.deepEqual(startAttempts[1], startAttempts[0])
  assert.equal(startBusinessCommits, 1)
  interrupted.adapter.stop()
  interrupted.outbox.stop()

  let agentRuns = 0
  const resumed = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      agentRuns += 1
      return {
        runtimeId: 'codex',
        threadId: 'worker-start-response-loss-thread',
        turnId: 'worker-start-response-loss-turn',
        state: 'completed',
        text: JSON.stringify({
          schemaVersion: 1,
          outcome: 'completed',
          summary: 'Completed after the execution-start response was recovered.'
        })
      }
    }
  }, initial, noContentCapabilities(), backend, outboxFactory)

  await resumed.adapter.recover()
  await resumed.adapter.waitForIdle()
  await resumed.outbox.waitForIdle()

  const resultRequest = cloud.requests.find((request) => request.type === 'task.result.submit')
  assert.equal(resultRequest?.type, 'task.result.submit')
  assert.equal(
    resultRequest?.type === 'task.result.submit' ? resultRequest.runtimeProvenance.startedAt : null,
    startAttempts[0]?.type === 'task.execution.start' ? startAttempts[0].startedAt : null
  )
  assert.equal(startBusinessCommits, 1)
  assert.equal(agentRuns, 1)
  assert.equal(resumed.store.snapshot().taskRuns[0]?.state, 'completed')
  assert.equal(cloud.commands.includes('task.execution.fail'), false)
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'task.execution.start',
    'task.result.submit'
  ])
})

test('a terminal execution event aborts the active Runtime and journals its fenced late outcome', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  initial.workerAcceptancePolicies = [{
    agentId: TEST_IDS.agentId,
    mode: 'automatic',
    updatedAt: TEST_TIMESTAMP
  }]
  const runtimeStarted = deferred<void>()
  const runtimeAborted = deferred<void>()
  const releaseRuntime = deferred<void>()
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async (request) => {
      runtimeStarted.resolve()
      const signal = request.signal
      const aborted = new Promise<void>((resolve) => {
        if (signal?.aborted) resolve()
        else signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      await Promise.race([aborted, releaseRuntime.promise])
      if (signal?.aborted) {
        runtimeAborted.resolve()
        throw new Error('Runtime stopped after the execution fence.')
      }
      return {
        runtimeId: 'codex',
        threadId: 'worker-fenced-thread',
        turnId: 'worker-fenced-turn',
        state: 'completed',
        text: JSON.stringify({ schemaVersion: 1, outcome: 'completed', summary: 'Too late.' })
      }
    }
  }, initial)

  await created.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await runtimeStarted.promise
  cloud.denyPreflight()
  await created.adapter.handleInbox(agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    inboxMessageId: 'ibx_ExecutionFence1',
    sequence: 2,
    payload: {
      protocolVersion: '1.0',
      type: 'collaboration.state.changed',
      event: {
        protocolVersion: '1.0',
        eventId: 'evt_ExecutionFence1',
        causedByRequestId: TEST_IDS.requestId,
        occurredAt: TEST_LATER_TIMESTAMP,
        type: 'task.execution.changed',
        projectId: TEST_IDS.projectId,
        taskId: TEST_IDS.taskId,
        executionId: TEST_IDS.executionId,
        state: 'superseded',
        revision: cloud.execution.revision
      }
    }
  }))
  const abortedBeforeRelease = await Promise.race([
    runtimeAborted.promise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 25))
  ])
  releaseRuntime.resolve()
  await created.adapter.waitForIdle()

  const run = created.store.snapshot().taskRuns[0]
  assert.equal(abortedBeforeRelease, true)
  assert.equal(run?.state, 'fenced')
  assert.equal(run?.agentJournal[0]?.state, 'late_outcome')
  assert.equal(run?.lateOutcomes[0]?.outcome, 'failed_after_fence')
  assert.equal(cloud.commands.includes('task.result.submit'), false)
})

test('membership removal fences the matching recovered execution before Runtime resumes', async () => {
  const cloud = new FakeWorkerCloud('running')
  const initial = emptyState()
  initial.tasks = [cloud.task]
  initial.taskRuns = [durableTaskRun(cloud)]
  let agentRuns = 0
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => {
      agentRuns += 1
      throw new Error('A membership-fenced execution must not resume Runtime work.')
    }
  }, initial)

  await created.adapter.handleInbox(agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    inboxMessageId: 'ibx_MembershipFence1',
    sequence: 3,
    payload: {
      protocolVersion: '1.0',
      type: 'collaboration.state.changed',
      event: {
        protocolVersion: '1.0',
        eventId: 'evt_MembershipFence1',
        causedByRequestId: TEST_IDS.requestId,
        occurredAt: TEST_LATER_TIMESTAMP,
        type: 'project.membership.changed',
        projectId: TEST_IDS.projectId,
        projectMembershipId: TEST_IDS.projectMembershipId,
        userId: TEST_IDS.userId,
        state: 'membership_removal_pending',
        revision: 2,
        authorityEpoch: 2
      }
    }
  }))
  await created.adapter.waitForIdle()

  assert.equal(agentRuns, 0)
  assert.equal(created.store.snapshot().taskRuns[0]?.state, 'fenced')
  assert.equal(cloud.commands.includes('task.result.submit'), false)
})

test('restart resumes the same dispatched Agent directive instead of creating another execution', async () => {
  const cloud = new FakeWorkerCloud('running')
  cloud.execution = taskExecutionSchema.parse({
    ...cloud.execution,
    startedAt: TEST_TIMESTAMP
  })
  const stableDirective = 'collab-worker-stable-restart'
  const initial = emptyState()
  initial.workerAcceptancePolicies = [{
    agentId: TEST_IDS.agentId,
    mode: 'automatic',
    updatedAt: TEST_TIMESTAMP
  }]
  initial.tasks = [cloud.task]
  initial.taskRuns = [{
    offer: offerJournal(),
    task: cloud.task,
    execution: cloud.execution,
    latestPreflight: {
      cloud: cloud.preflight(),
      outcome: 'allowed',
      reasons: [],
      contentTransferReadiness: [],
      evaluatedAt: TEST_TIMESTAMP
    },
    decision: { decision: 'accept', decidedAt: TEST_TIMESTAMP },
    expectedTaskRevision: cloud.task.revision,
    expectedExecutionRevision: cloud.execution.revision,
    state: 'running',
    workspaceRoot: '/tmp/sciforge-worker-restart',
    runtimeId: 'codex',
    threadId: 'worker-thread-stable',
    humanRequestId: null,
    humanAnswer: null,
    resources: [],
    agentJournal: [{
      logicalInvocationId: `agent.${TEST_IDS.executionId}.1`,
      clientDirectiveId: stableDirective,
      state: 'dispatched',
      preparedAt: TEST_TIMESTAMP,
      dispatchedAt: TEST_TIMESTAMP,
      observedAt: null,
      runtimeId: 'codex',
      threadId: 'worker-thread-stable',
      turnId: null,
      runtimeState: null,
      safeResultText: null,
      safeError: null
    }],
    externalJournal: [],
    outputs: [],
    recoveryJournalEntryIds: [],
    resultSummary: null,
    lateOutcomes: [],
    startedAt: cloud.execution.startedAt,
    updatedAt: TEST_TIMESTAMP,
    completedAt: null,
    error: null
  }]
  const directives: string[] = []
  const created = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async (request) => {
      directives.push(request.clientDirectiveId ?? '')
      return {
        runtimeId: 'codex',
        threadId: 'worker-thread-stable',
        turnId: 'worker-turn-recovered',
        state: 'completed',
        text: JSON.stringify({ schemaVersion: 1, outcome: 'completed', summary: 'Recovered.' })
      }
    }
  }, initial)

  await created.adapter.recover()
  await created.adapter.waitForIdle()
  assert.deepEqual(directives, [stableDirective])
  assert.equal(created.store.snapshot().taskRuns[0]?.agentJournal.length, 1)
  assert.equal(created.store.snapshot().taskRuns[0]?.state, 'completed')
})

test('Desktop restart reconciles one persisted Session/directive without a second Runtime turn', async () => {
  const cloud = new FakeWorkerCloud()
  const initial = emptyState()
  initial.workerAcceptancePolicies = [{
    agentId: TEST_IDS.agentId,
    mode: 'automatic',
    updatedAt: TEST_TIMESTAMP
  }]
  const firstRunStarted = deferred<void>()
  const directives: string[] = []
  const sessions: string[] = []
  let hostRunAttempts = 0
  let providerTurns = 0
  const delivered = new Map<string, Readonly<{
    runtimeId: string
    threadId: string
    turnId: string
    state: 'completed'
    text: string
  }>>()
  const result = {
    runtimeId: 'codex',
    threadId: 'worker-shutdown-recovery-thread',
    turnId: 'worker-shutdown-recovery-turn',
    state: 'completed' as const,
    text: JSON.stringify({ schemaVersion: 1, outcome: 'completed', summary: 'Reconciled.' })
  }
  const first = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    prepareSession: async () => ({
      runtimeId: result.runtimeId,
      threadId: result.threadId
    }),
    run: async (request) => {
      hostRunAttempts += 1
      directives.push(request.clientDirectiveId ?? '')
      sessions.push(`${request.runtimeId}:${request.threadId}`)
      const key = `${request.runtimeId}:${request.threadId}:${request.clientDirectiveId}`
      const reconciled = delivered.get(key)
      if (reconciled) return reconciled
      providerTurns += 1
      delivered.set(key, result)
      firstRunStarted.resolve()
      await new Promise<void>((resolve) => {
        if (request.signal?.aborted) resolve()
        else request.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      throw new Error('Desktop stopped while the Agent Host request was in flight.')
    }
  }, initial)

  await first.adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await firstRunStarted.promise
  first.adapter.stop()
  await first.adapter.waitForIdle()

  const stoppedState = first.store.snapshot()
  assert.equal(stoppedState.taskRuns[0]?.agentJournal[0]?.state, 'dispatched')
  assert.deepEqual({
    runtimeId: stoppedState.taskRuns[0]?.runtimeId,
    threadId: stoppedState.taskRuns[0]?.threadId,
    journalRuntimeId: stoppedState.taskRuns[0]?.agentJournal[0]?.runtimeId,
    journalThreadId: stoppedState.taskRuns[0]?.agentJournal[0]?.threadId
  }, {
    runtimeId: result.runtimeId,
    threadId: result.threadId,
    journalRuntimeId: result.runtimeId,
    journalThreadId: result.threadId
  })
  const second = await createRunner(cloud, {
    runtimeReadiness: readyRuntimeReadiness,
    run: async (request) => {
      hostRunAttempts += 1
      directives.push(request.clientDirectiveId ?? '')
      sessions.push(`${request.runtimeId}:${request.threadId}`)
      const key = `${request.runtimeId}:${request.threadId}:${request.clientDirectiveId}`
      const reconciled = delivered.get(key)
      if (!reconciled) throw new Error('Restart attempted a second Runtime turn.')
      return reconciled
    }
  }, stoppedState)

  await second.adapter.recover()
  await second.adapter.waitForIdle()

  assert.equal(hostRunAttempts, 2)
  assert.equal(providerTurns, 1)
  assert.equal(directives[0], directives[1])
  assert.deepEqual(sessions, [
    `${result.runtimeId}:${result.threadId}`,
    `${result.runtimeId}:${result.threadId}`
  ])
  assert.equal(second.store.snapshot().taskRuns[0]?.agentJournal.length, 1)
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), [
    'task.offer.accept',
    'task.execution.start',
    'task.result.submit'
  ])
})

async function createRunner(
  cloud: FakeWorkerCloud,
  agentExecution: DomainMainAgentExecutionHost = neverAgent(),
  initial: CollaborationLocalState = emptyState(),
  capabilities: DomainMainSystemCapabilityInvoker = noContentCapabilities(),
  backend: CollaborationStateBackend = new MemoryBackend(initial),
  outboxFactory?: (store: CollaborationLocalStore) => DurableCloudOutbox
) {
  const store = new CollaborationLocalStore(backend)
  await store.open()
  cloud.store = store
  const outbox = outboxFactory?.(store) ?? cloud.outbox()
  const adapter = new CollaborationTaskAdapter({
    store,
    connection: cloud.connection(),
    outbox,
    agentExecution: {
      ...agentExecution,
      prepareSession: agentExecution.prepareSession ?? (async (request) => ({
        runtimeId: request.runtimeId ?? 'codex',
        threadId: 'worker-thread-stable'
      }))
    },
    capabilities,
    localAgentId: () => TEST_IDS.agentId,
    workspaceRootForExecution: (executionId) => `/tmp/sciforge-worker-${executionId}`,
    now: () => new Date(TEST_TIMESTAMP)
  })
  return { adapter, store, outbox }
}

function manualRecoveryFixture(cloud: FakeWorkerCloud) {
  const localTask = structuredClone(cloud.task)
  const localExecution = structuredClone(cloud.execution)
  const localCloudPreflight = cloud.preflight()
  const fileIntent = localExecution.fileIntent
  if (!fileIntent) throw new Error('Manual recovery fixture requires a file execution.')
  const outputLocator = {
    contractVersion: 1 as const,
    kind: 'content-space.file-reference' as const,
    authority: ROOT_LOCATOR.authority,
    identity: { fileId: 'analysis-output-recovered' }
  }
  const output = {
    executionId: localExecution.executionId,
    assignmentTaskRevision: fileIntent.assignmentTaskRevision,
    locator: outputLocator,
    locatorDigest: digestFixture(outputLocator),
    rootLocatorDigest: ROOT_LOCATOR_DIGEST,
    bindingRevision: FILE_BINDING_REVISION,
    transferReceiptDigest: '8'.repeat(64),
    observationDigest: '9'.repeat(64),
    preflightObservationDigest: '3'.repeat(64)
  }
  const resource = cloudResourceRefSchema.parse({
    schemaVersion: 1,
    type: 'resource_ref',
    resourceRefId: RECOVERY_OUTPUT_RESOURCE_ID,
    projectId: localTask.projectId,
    taskId: localTask.taskId,
    executionId: localExecution.executionId,
    assignmentTaskRevision: fileIntent.assignmentTaskRevision,
    bindingRevision: FILE_BINDING_REVISION,
    intentDigest: fileIntent.declarationDigest,
    role: 'output-file',
    ordinal: 2,
    locator: outputLocator,
    locatorDigest: output.locatorDigest,
    status: 'available',
    invalidatedAt: null,
    revision: 1,
    createdAt: TEST_LATER_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP
  })
  const downloadCloudJournal = externalOperationRecoveryJournalEntrySchema.parse({
    schemaVersion: 1,
    type: 'external_operation_recovery_journal_entry',
    contentRecoveryJournalEntryId: RECOVERY_DOWNLOAD_JOURNAL_ID,
    scope: 'task_content_transfer',
    projectId: localTask.projectId,
    taskId: localTask.taskId,
    executionId: localExecution.executionId,
    preparedTaskRevision: localTask.revision,
    preparedExecutionRevision: localExecution.revision,
    provisioningIntentId: null,
    provisioningRevision: null,
    logicalInvocationId: `download.${localExecution.executionId}.recovered-input`,
    operation: 'download',
    state: 'observed_success',
    requestDigest: 'a'.repeat(64),
    receiptDigest: '4'.repeat(64),
    observationDigest: '5'.repeat(64),
    safeFailureCode: null,
    preparedAt: TEST_TIMESTAMP,
    dispatchedAt: TEST_TIMESTAMP,
    resolvedAt: TEST_TIMESTAMP,
    revision: 3,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP
  })
  const uploadCloudJournal = externalOperationRecoveryJournalEntrySchema.parse({
    schemaVersion: 1,
    type: 'external_operation_recovery_journal_entry',
    contentRecoveryJournalEntryId: RECOVERY_JOURNAL_ID,
    scope: 'task_content_transfer',
    projectId: localTask.projectId,
    taskId: localTask.taskId,
    executionId: localExecution.executionId,
    preparedTaskRevision: localTask.revision,
    preparedExecutionRevision: localExecution.revision,
    provisioningIntentId: null,
    provisioningRevision: null,
    logicalInvocationId: `upload.${localExecution.executionId}.output`,
    operation: 'upload_new',
    state: 'outcome_unknown',
    requestDigest: TEST_HASH,
    receiptDigest: null,
    observationDigest: null,
    safeFailureCode: 'provider_outcome_unknown',
    preparedAt: TEST_TIMESTAMP,
    dispatchedAt: TEST_TIMESTAMP,
    resolvedAt: null,
    revision: 3,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP
  })

  cloud.enterManualRecovery(resource)
  const initial = emptyState()
  initial.tasks = [localTask]
  initial.taskRuns = [durableTaskRun(cloud, {
    task: localTask,
    execution: localExecution,
    latestPreflight: {
      cloud: localCloudPreflight,
      outcome: 'allowed',
      reasons: [],
      contentTransferReadiness: [],
      evaluatedAt: TEST_TIMESTAMP
    },
    expectedTaskRevision: localTask.revision,
    expectedExecutionRevision: localExecution.revision,
    state: 'manual-recovery',
    resources: fileResources(fileIntent.assignmentTaskRevision),
    agentJournal: [{
      logicalInvocationId: `agent.${localExecution.executionId}.1`,
      clientDirectiveId: 'collab-worker-recovery-preserved-runtime',
      state: 'observed_success',
      preparedAt: TEST_TIMESTAMP,
      dispatchedAt: TEST_TIMESTAMP,
      observedAt: TEST_TIMESTAMP,
      runtimeId: 'codex',
      threadId: 'worker-recovery-thread',
      turnId: 'worker-recovery-turn',
      runtimeState: 'completed',
      safeResultText: JSON.stringify({
        schemaVersion: 1,
        outcome: 'completed',
        summary: 'Recovered file analysis is ready.'
      }),
      safeError: null
    }],
    externalJournal: [{
      logicalInvocationId: downloadCloudJournal.logicalInvocationId,
      operation: 'download',
      workspaceRelativePath: 'input.csv',
      requestDigest: downloadCloudJournal.requestDigest,
      state: 'observed_success',
      cloudJournal: downloadCloudJournal,
      receiptDigest: downloadCloudJournal.receiptDigest,
      observationDigest: downloadCloudJournal.observationDigest,
      preparedAt: TEST_TIMESTAMP,
      effectDispatchedAt: TEST_TIMESTAMP,
      observedAt: TEST_TIMESTAMP,
      safeFailureCode: null,
      safeError: null
    }, {
      logicalInvocationId: uploadCloudJournal.logicalInvocationId,
      operation: 'upload_new',
      workspaceRelativePath: 'analysis.md',
      requestDigest: uploadCloudJournal.requestDigest,
      state: 'outcome_unknown',
      cloudJournal: uploadCloudJournal,
      receiptDigest: null,
      observationDigest: null,
      preparedAt: TEST_TIMESTAMP,
      effectDispatchedAt: TEST_TIMESTAMP,
      observedAt: TEST_LATER_TIMESTAMP,
      safeFailureCode: 'provider_outcome_unknown',
      safeError: 'Provider outcome is unknown.',
    }],
    outputs: [],
    recoveryJournalEntryIds: [RECOVERY_DOWNLOAD_JOURNAL_ID],
    resultSummary: 'Recovered file analysis is ready.',
    startedAt: TEST_TIMESTAMP,
    completedAt: TEST_LATER_TIMESTAMP,
    error: 'Provider outcome is unknown; manual recovery is required.'
  })]
  const linkedMessage = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    inboxMessageId: 'ibx_RecoveryLinked0001',
    sequence: 20,
    payload: {
      protocolVersion: '1.0',
      type: 'task.recovery.output_linked',
      projectId: localTask.projectId,
      taskId: localTask.taskId,
      executionId: localExecution.executionId,
      recoveryActionId: TEST_IDS.recoveryActionId,
      journalEntryId: uploadCloudJournal.contentRecoveryJournalEntryId,
      logicalInvocationId: uploadCloudJournal.logicalInvocationId,
      resourceRefId: resource.resourceRefId,
      taskRevision: cloud.task.revision,
      executionRevision: cloud.execution.revision,
      journalRevision: uploadCloudJournal.revision + 1,
      output
    }
  })
  return { initial, linkedMessage, output }
}

function recoveryAbandonedMessage(task: Task, execution: TaskExecution) {
  return agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    inboxMessageId: 'ibx_RecoveryAbandoned01',
    sequence: 30,
    payload: {
      protocolVersion: '1.0',
      type: 'task.recovery.abandoned',
      projectId: task.projectId,
      taskId: task.taskId,
      executionId: execution.executionId,
      recoveryActionId: TEST_IDS.recoveryActionId,
      taskRevision: task.revision,
      executionRevision: execution.revision,
      reason: 'The exact Provider output could not be observed.'
    }
  })
}

function durableTaskRun(
  cloud: FakeWorkerCloud,
  overrides: Partial<CollaborationLocalState['taskRuns'][number]> = {}
): CollaborationLocalState['taskRuns'][number] {
  return {
    offer: offerJournal(),
    task: cloud.task,
    execution: cloud.execution,
    latestPreflight: {
      cloud: cloud.preflight(),
      outcome: 'allowed',
      reasons: [],
      contentTransferReadiness: [],
      evaluatedAt: TEST_TIMESTAMP
    },
    decision: { decision: 'accept', decidedAt: TEST_TIMESTAMP },
    expectedTaskRevision: cloud.task.revision,
    expectedExecutionRevision: cloud.execution.revision,
    state: 'running',
    workspaceRoot: `/tmp/sciforge-worker-${TEST_IDS.executionId}`,
    runtimeId: null,
    threadId: null,
    humanRequestId: null,
    humanAnswer: null,
    resources: [],
    agentJournal: [],
    externalJournal: [],
    outputs: [],
    recoveryJournalEntryIds: [],
    resultSummary: null,
    lateOutcomes: [],
    startedAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP,
    completedAt: null,
    error: null,
    ...overrides
  }
}

type FakeWorkerExecutionState = 'accepted' | 'running' | 'needs_human' | 'failed'
type FakeWorkerTaskState = 'offered' | FakeWorkerExecutionState

class FakeWorkerCloud {
  task: Task
  execution: TaskExecution
  offer: ReturnType<typeof taskOfferSchema.parse>
  commands: string[] = []
  requests: RestRequest[] = []
  preflightExpectedRevisions: Array<Readonly<{ task: number; execution: number }>> = []
  store: CollaborationLocalStore | null = null
  private readonly recoveryJournals = new Map<string, ReturnType<
    typeof externalOperationRecoveryJournalEntrySchema.parse
  >>()
  private recoveryJournalOrdinal = 0
  private preflightDenial: 'none' | 'execution_fenced' | 'membership_removal' = 'none'
  private preflightDelay: Readonly<{
    state: FakeWorkerExecutionState
    started: () => void
    release: Promise<void>
  }> | null = null
  private readonly recoveryResources = new Map<string, ReturnType<typeof cloudResourceRefSchema.parse>>()

  constructor(
    state: 'offered' | 'accepted' | 'running' = 'offered',
    private readonly fileMode = false
  ) {
    this.task = makeTask(state, state === 'offered' ? 1 : 3, fileMode)
    this.execution = makeExecution(
      state === 'offered' ? 'accepted' : state,
      this.task.revision,
      fileMode,
      state === 'offered' ? 2 : 1
    )
    this.offer = taskOfferSchema.parse({
      schemaVersion: 1,
      type: 'task_offer',
      taskOfferId: OFFER_ID,
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: state === 'offered' ? null : TEST_IDS.executionId,
      workerUserId: TEST_IDS.userId,
      offeredByCoordinatorAgentId: TEST_IDS.secondAgentId,
      state: state === 'offered' ? 'pending' : 'accepted',
      reassignmentTaskRevision: null,
      offeredAt: TEST_TIMESTAMP,
      expiresAt: TEST_LATER_TIMESTAMP,
      respondedAt: state === 'offered' ? null : TEST_TIMESTAMP,
      revision: state === 'offered' ? 1 : 2,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP
    })
  }

  preflight(
    requestedTaskRevision = this.task.revision,
    requestedExecutionRevision = this.execution.revision
  ) {
    const membershipRemoved = this.preflightDenial === 'membership_removal'
    const decisionReasons = [
      ...(membershipRemoved
        ? [
            'membership_not_active' as const,
            'user_authority_not_eligible' as const,
            'execution_fenced' as const
          ]
        : this.preflightDenial === 'execution_fenced' || this.execution.fence.status === 'fenced'
          ? ['execution_fenced' as const]
        : []),
      ...(this.task.currentExecutionId === this.execution.executionId
        ? []
        : ['execution_not_current' as const]),
      ...(requestedTaskRevision === this.task.revision ? [] : ['task_revision_mismatch' as const]),
      ...(requestedExecutionRevision === this.execution.revision
        ? []
        : ['execution_revision_mismatch' as const])
    ]
    return taskExecutionPreflightSchema.parse({
      schemaVersion: 1,
      type: 'task_execution_preflight',
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      currentExecutionId: TEST_IDS.executionId,
      taskKind: this.fileMode ? 'file' : 'text',
      projectStatus: 'active',
      projectRevision: 1,
      projectExecutionAuthorityEpoch: 1,
      requestedTaskRevision,
      currentTaskRevision: this.task.revision,
      requestedExecutionRevision,
      membership: {
        schemaVersion: 1,
        type: 'project_membership',
        projectMembershipId: 'pmb_Member000001',
        projectId: TEST_IDS.projectId,
        userId: TEST_IDS.userId,
        state: membershipRemoved ? 'membership_removal_pending' : 'active',
        authorityEpoch: membershipRemoved ? 2 : 1,
        activatedAt: TEST_TIMESTAMP,
        removalRequestedAt: membershipRemoved ? TEST_LATER_TIMESTAMP : null,
        removalRequestedByUserId: membershipRemoved ? TEST_IDS.secondUserId : null,
        removedAt: null,
        revision: membershipRemoved ? 2 : 1,
        createdAt: TEST_TIMESTAMP,
        updatedAt: TEST_TIMESTAMP
      },
      taskAuthorities: [{
        schemaVersion: 1,
        type: 'task_authority',
        taskAuthorityId: 'tau_Authority001',
        projectId: TEST_IDS.projectId,
        userId: TEST_IDS.userId,
        scope: this.fileMode ? 'file_tasks' : 'text_tasks',
        state: membershipRemoved ? 'fenced' : 'eligible',
        authorityEpoch: membershipRemoved ? 2 : 1,
        reason: membershipRemoved ? 'membership_removal_pending' : null,
        effectiveAt: TEST_TIMESTAMP,
        revision: 1,
        createdAt: TEST_TIMESTAMP,
        updatedAt: TEST_TIMESTAMP
      }],
      device: {
        deviceId: TEST_IDS.deviceId,
        userId: TEST_IDS.userId,
        revision: 1,
        status: 'active'
      },
      agent: {
        agentId: TEST_IDS.agentId,
        ownerUserId: TEST_IDS.userId,
        deviceId: TEST_IDS.deviceId,
        revision: 1,
        lifecycleStatus: 'active',
        connectionStatus: 'online'
      },
      contentReadiness: this.fileMode ? fileContentReadiness() : null,
      contentBinding: this.fileMode ? fileContentBinding() : null,
      execution: this.execution,
      decision: decisionReasons.length > 0
        ? { outcome: 'denied', reasons: decisionReasons }
        : { outcome: 'allowed', reasons: [] },
      evaluatedAt: TEST_TIMESTAMP
    })
  }

  connection(): CollaborationConnection {
    return {
      executeAsAgent: async (request: RestRequest) => {
        if (request.type === 'task.execution.preflight.get') {
          const delay = this.preflightDelay
          if (delay?.state === this.execution.state) {
            this.preflightDelay = null
            delay.started()
            await delay.release
          }
          this.preflightExpectedRevisions.push({
            task: request.expectedTaskRevision,
            execution: request.expectedExecutionRevision
          })
          return {
            protocolVersion: '1.0',
            type: 'rest.task_execution_preflight',
            requestId: request.requestId,
            preflight: this.preflight(
              request.expectedTaskRevision,
              request.expectedExecutionRevision
            )
          }
        }
        if (request.type === 'resource.get' && this.fileMode) {
          const resource = this.recoveryResources.get(request.resourceRefId) ??
            fileResources(this.execution.fence.assignmentTaskRevision).find(({ resourceRefId }) => (
              resourceRefId === request.resourceRefId
            ))
          if (!resource) throw new Error('Unknown ResourceRef.')
          return entityResponse(request, resource)
        }
        if (request.type === 'project.content.binding.get' && this.fileMode) {
          return entityResponse(request, fileContentBinding())
        }
        assert.equal(request.type, 'task.get')
        return {
          protocolVersion: '1.0',
          type: 'rest.entity',
          requestId: request.requestId,
          entity: this.task
        }
      }
    } as unknown as CollaborationConnection
  }

  outbox(): DurableCloudOutbox {
    return {
      enqueue: async (_kind: string, request: RestRequest) => {
        this.requests.push(request)
        this.commands.push(request.type)
      },
      enqueueAndWait: async (_kind: string, request: RestRequest): Promise<RestResponse> => {
        this.requests.push(request)
        this.commands.push(request.type)
        if (request.type === 'task.offer.reject') {
          assert.equal(request.taskOfferId, this.offer.taskOfferId)
          assert.equal(request.expectedTaskRevision, this.task.revision)
          assert.equal(request.expectedOfferRevision, this.offer.revision)
          this.task = taskSchema.parse({
            ...this.task,
            status: 'revision_requested',
            currentExecutionId: null,
            currentExecutionState: null,
            completedAt: null,
            revision: this.task.revision + 1,
            updatedAt: TEST_LATER_TIMESTAMP
          })
          this.offer = taskOfferSchema.parse({
            ...this.offer,
            state: 'rejected',
            reassignmentTaskRevision: this.task.revision,
            respondedAt: TEST_LATER_TIMESTAMP,
            revision: this.offer.revision + 1,
            updatedAt: TEST_LATER_TIMESTAMP
          })
          return collectionResponse(request, [this.task, this.offer])
        }
        if (request.type === 'task.offer.accept') {
          assert.equal(request.taskOfferId, this.offer.taskOfferId)
          assert.equal(request.expectedTaskRevision, this.task.revision)
          assert.equal(request.expectedOfferRevision, this.offer.revision)
          this.task = makeTask('accepted', this.task.revision + 1, this.fileMode)
          this.execution = taskExecutionSchema.parse({
            ...makeExecution('accepted', this.task.revision, this.fileMode, this.task.revision),
            stateRevision: 1,
            revision: 1,
            createdAt: TEST_LATER_TIMESTAMP,
            updatedAt: TEST_LATER_TIMESTAMP
          })
          this.offer = taskOfferSchema.parse({
            ...this.offer,
            executionId: this.execution.executionId,
            state: 'accepted',
            respondedAt: TEST_LATER_TIMESTAMP,
            revision: this.offer.revision + 1,
            updatedAt: TEST_LATER_TIMESTAMP
          })
          return collectionResponse(request, [this.task, this.execution, this.offer])
        }
        if (request.type === 'task.execution.start') {
          this.advance('running', request.startedAt)
          return collectionResponse(request, [this.task, this.execution])
        }
        if (request.type === 'task.execution.fail') {
          this.advance('failed')
          return collectionResponse(request, [this.task, this.execution])
        }
        if (request.type === 'external_operation.prepare') {
          this.recoveryJournalOrdinal += 1
          const entry = externalOperationRecoveryJournalEntrySchema.parse({
            schemaVersion: 1,
            type: 'external_operation_recovery_journal_entry',
            contentRecoveryJournalEntryId: `crj_WorkerJournal${String(this.recoveryJournalOrdinal).padStart(4, '0')}`,
            scope: request.scope,
            projectId: request.projectId,
            taskId: request.taskId,
            executionId: request.executionId,
            preparedTaskRevision: request.preparedTaskRevision,
            preparedExecutionRevision: request.preparedExecutionRevision,
            provisioningIntentId: request.provisioningIntentId,
            provisioningRevision: request.provisioningRevision,
            logicalInvocationId: request.logicalInvocationId,
            operation: request.operation,
            state: 'prepared',
            requestDigest: request.requestDigest,
            receiptDigest: null,
            observationDigest: null,
            safeFailureCode: null,
            preparedAt: TEST_TIMESTAMP,
            dispatchedAt: null,
            resolvedAt: null,
            revision: 1,
            createdAt: TEST_TIMESTAMP,
            updatedAt: TEST_TIMESTAMP
          })
          this.recoveryJournals.set(entry.contentRecoveryJournalEntryId, entry)
          return entityResponse(request, entry)
        }
        if (request.type === 'external_operation.dispatch') {
          const current = this.requireRecoveryJournal(request.journalEntryId)
          assert.equal(request.expectedJournalRevision, current.revision)
          const entry = externalOperationRecoveryJournalEntrySchema.parse({
            ...current,
            state: 'dispatched',
            dispatchedAt: TEST_LATER_TIMESTAMP,
            revision: current.revision + 1,
            updatedAt: TEST_LATER_TIMESTAMP
          })
          this.recoveryJournals.set(entry.contentRecoveryJournalEntryId, entry)
          return entityResponse(request, entry)
        }
        if (request.type === 'external_operation.observe') {
          const current = this.requireRecoveryJournal(request.journalEntryId)
          assert.equal(request.expectedJournalRevision, current.revision)
          const entry = externalOperationRecoveryJournalEntrySchema.parse({
            ...current,
            state: request.outcome,
            receiptDigest: request.receiptDigest,
            observationDigest: request.observationDigest,
            safeFailureCode: request.safeFailureCode,
            resolvedAt: request.outcome === 'outcome_unknown' ? null : TEST_LATER_TIMESTAMP,
            revision: current.revision + 1,
            updatedAt: TEST_LATER_TIMESTAMP
          })
          this.recoveryJournals.set(entry.contentRecoveryJournalEntryId, entry)
          return collectionResponse(request, [entry])
        }
        if (request.type === 'human.needed.create') {
          assert.deepEqual(request.context, {
            scope: 'worker_execution',
            taskId: TEST_IDS.taskId,
            executionId: TEST_IDS.executionId,
            expectedTaskRevision: this.task.revision,
            expectedExecutionRevision: this.execution.revision
          })
          this.advance('needs_human')
          return entityResponse(request, {
            ...humanNeededFixture,
            requiredAssurance: request.requiredAssurance,
            prompt: request.prompt,
            expiresAt: request.expiresAt
          })
        }
        if (request.type === 'task.result.submit') {
          assert.equal(request.outputs.length, this.fileMode ? 1 : 0)
          assert.equal(request.recoveryJournalEntryIds.length, this.fileMode ? 2 : 0)
          const submitted = this.submitResult(request)
          return collectionResponse(request, [this.task, this.execution, submitted])
        }
        throw new Error(`Unexpected command ${request.type}.`)
      },
      resumeAndWait: async (
        kind: string,
        idempotencyKey: string,
        validateRequest: (request: RestRequest) => void
      ) => {
        const entry = this.store?.snapshot().outbox.find((candidate) => (
          candidate.idempotencyKey === idempotencyKey
        ))
        if (!entry) return null
        assert.equal(entry.kind, kind)
        assert.equal(entry.state, 'delivered')
        assert.ok(entry.response)
        const request = restRequestSchema.parse(entry.body)
        validateRequest(request)
        return {
          request,
          response: restResponseSchema.parse(entry.response)
        }
      }
    } as unknown as DurableCloudOutbox
  }

  seedRecoveryJournal(
    entry: ReturnType<typeof externalOperationRecoveryJournalEntrySchema.parse>
  ): void {
    this.recoveryJournals.set(entry.contentRecoveryJournalEntryId, entry)
  }

  denyPreflight(reason: 'execution_fenced' | 'membership_removal' = 'execution_fenced'): void {
    this.preflightDenial = reason
  }

  delayNextPreflight(state: FakeWorkerExecutionState, started: () => void, release: Promise<void>): void {
    assert.equal(this.preflightDelay, null)
    this.preflightDelay = { state, started, release }
  }

  enterManualRecovery(resource: ReturnType<typeof cloudResourceRefSchema.parse>): void {
    assert.equal(this.fileMode, true)
    this.execution = taskExecutionSchema.parse({
      ...this.execution,
      state: 'manual_recovery_required',
      stateRevision: this.execution.stateRevision + 1,
      fence: {
        ...this.execution.fence,
        status: 'fenced',
        reason: 'manual_recovery_required',
        fencedAt: TEST_LATER_TIMESTAMP
      },
      terminalAt: TEST_LATER_TIMESTAMP,
      revision: this.execution.revision + 1,
      updatedAt: TEST_LATER_TIMESTAMP
    })
    this.task = taskSchema.parse({
      ...this.task,
      status: 'manual_recovery_required',
      currentExecutionState: 'manual_recovery_required',
      revision: this.task.revision + 1,
      updatedAt: TEST_LATER_TIMESTAMP
    })
    this.recoveryResources.set(resource.resourceRefId, resource)
  }

  supersedeManualRecovery(): void {
    assert.equal(this.execution.state, 'manual_recovery_required')
    this.task = taskSchema.parse({
      ...this.task,
      currentExecutionId: null,
      currentExecutionState: null,
      status: 'offered',
      executionCount: 2,
      revision: this.task.revision + 1,
      updatedAt: TEST_LATER_TIMESTAMP
    })
  }

  abandonManualRecovery(): Readonly<{ task: Task; execution: TaskExecution }> {
    assert.equal(this.execution.state, 'manual_recovery_required')
    this.execution = taskExecutionSchema.parse({
      ...this.execution,
      state: 'cancelled',
      stateRevision: this.execution.stateRevision + 1,
      fence: {
        ...this.execution.fence,
        reason: 'manual_recovery_abandoned'
      },
      revision: this.execution.revision + 1,
      updatedAt: TEST_LATER_TIMESTAMP
    })
    this.task = taskSchema.parse({
      ...this.task,
      status: 'revision_requested',
      currentExecutionState: 'cancelled',
      revision: this.task.revision + 1,
      updatedAt: TEST_LATER_TIMESTAMP
    })
    return { task: this.task, execution: this.execution }
  }

  answerHumanNeeded(): void {
    assert.equal(this.execution.state, 'needs_human')
    this.advance('running')
  }

  enterHumanNeeded(): void {
    assert.equal(this.execution.state, 'running')
    this.advance('needs_human')
  }

  private advance(state: FakeWorkerExecutionState, startedAt = TEST_LATER_TIMESTAMP): void {
    const taskRevision = this.task.revision + 1
    const assignmentTaskRevision = this.execution.fence.assignmentTaskRevision
    const terminal = state === 'failed'
    this.execution = taskExecutionSchema.parse({
      ...this.execution,
      state,
      stateRevision: this.execution.stateRevision + 1,
      revision: this.execution.revision + 1,
      updatedAt: TEST_LATER_TIMESTAMP,
      acceptedAt: this.execution.acceptedAt,
      startedAt: state === 'running' || state === 'needs_human' || state === 'failed'
        ? this.execution.startedAt ?? startedAt
        : null,
      terminalAt: terminal ? TEST_LATER_TIMESTAMP : null,
      fence: {
        ...this.execution.fence,
        assignmentTaskRevision,
        status: terminal ? 'fenced' : 'open',
        reason: state === 'failed' ? 'execution_failed' : null,
        fencedAt: terminal ? TEST_LATER_TIMESTAMP : null
      },
      fileIntent: this.fileMode ? fileExecutionIntent(assignmentTaskRevision) : null
    })
    this.task = makeTask(state, taskRevision, this.fileMode)
  }

  private submitResult(request: Extract<RestRequest, { type: 'task.result.submit' }>) {
    const resultSubmissionId = 'rsu_Result000001'
    this.execution = taskExecutionSchema.parse({
      ...this.execution,
      state: 'result_submitted',
      stateRevision: this.execution.stateRevision + 1,
      currentResultSubmissionId: resultSubmissionId,
      terminalAt: request.runtimeProvenance.completedAt,
      fence: {
        ...this.execution.fence,
        status: 'fenced',
        reason: 'result_submitted',
        fencedAt: request.runtimeProvenance.completedAt
      },
      revision: this.execution.revision + 1,
      updatedAt: TEST_LATER_TIMESTAMP
    })
    this.task = taskSchema.parse({
      ...this.task,
      status: 'awaiting_review',
      currentExecutionState: 'result_submitted',
      revision: this.task.revision + 1,
      updatedAt: TEST_LATER_TIMESTAMP
    })
    return taskResultSubmissionSchema.parse({
      schemaVersion: 1,
      type: 'task_result_submission',
      resultSubmissionId,
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      submittedTaskRevision: request.expectedTaskRevision,
      submittedExecutionRevision: request.expectedExecutionRevision,
      submittedByUserId: TEST_IDS.userId,
      submittedByAgentId: TEST_IDS.agentId,
      summary: request.summary,
      runtimeProvenance: request.runtimeProvenance,
      outputs: request.outputs,
      recoveryJournalEntryIds: request.recoveryJournalEntryIds,
      submittedAt: request.runtimeProvenance.completedAt,
      submissionDigest: request.submissionDigest,
      revision: 1,
      createdAt: TEST_LATER_TIMESTAMP,
      updatedAt: TEST_LATER_TIMESTAMP
    })
  }

  private requireRecoveryJournal(journalEntryId: string) {
    const entry = this.recoveryJournals.get(journalEntryId)
    if (!entry) throw new Error('Recovery journal was not prepared.')
    return entry
  }
}

function makeTask(state: FakeWorkerTaskState, revision: number, fileMode = false): Task {
  const unclaimed = state === 'offered'
  return taskSchema.parse({
    schemaVersion: 1,
    type: 'task',
    taskId: TEST_IDS.taskId,
    projectId: TEST_IDS.projectId,
    createdByCoordinatorAgentId: TEST_IDS.secondAgentId,
    title: 'Analyze meeting notes',
    objective: 'Produce the agreed concise result.',
    completionCriteria: ['Return a reviewable summary'],
    dependencyTaskIds: [],
    requiredCapabilityTags: ['agent.execute'],
    fileIntent: fileMode ? taskFileIntent() : null,
    currentExecutionId: unclaimed ? null : TEST_IDS.executionId,
    currentExecutionState: unclaimed ? null : state,
    status: state === 'failed'
      ? 'failed'
      : state === 'needs_human'
        ? 'needs_human'
      : state === 'running' || state === 'accepted'
        ? 'in_progress'
        : 'offered',
    executionCount: unclaimed ? 0 : 1,
    maxRetries: 2,
    completedAt: state === 'failed' ? TEST_LATER_TIMESTAMP : null,
    revision,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP
  })
}

function makeExecution(
  state: 'accepted' | 'running',
  taskRevision: number,
  fileMode = false,
  assignmentTaskRevision = 1
): TaskExecution {
  return taskExecutionSchema.parse({
    schemaVersion: 1,
    type: 'task_execution',
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    attempt: 1,
    offeredByCoordinatorAgentId: TEST_IDS.secondAgentId,
    assigneeUserId: TEST_IDS.userId,
    assigneeAgentId: TEST_IDS.agentId,
    assigneeDeviceId: TEST_IDS.deviceId,
    state,
    stateRevision: 3,
    fence: {
      schemaVersion: 1,
      executionId: TEST_IDS.executionId,
      assigneeUserId: TEST_IDS.userId,
      assigneeAgentId: TEST_IDS.agentId,
      assigneeDeviceId: TEST_IDS.deviceId,
      assignmentTaskRevision,
      projectExecutionAuthorityEpoch: 1,
      userTaskAuthorityEpoch: 1,
      bindingRevision: fileMode ? FILE_BINDING_REVISION : null,
      status: 'open',
      reason: null,
      fencedAt: null
    },
    fileIntent: fileMode ? fileExecutionIntent(assignmentTaskRevision) : null,
    currentResultSubmissionId: null,
    offeredAt: TEST_TIMESTAMP,
    acceptedAt: TEST_LATER_TIMESTAMP,
    startedAt: state === 'running' ? TEST_LATER_TIMESTAMP : null,
    terminalAt: null,
    revision: 3,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP
  })
}

function offerPayload() {
  return {
    protocolVersion: '1.0' as const,
    type: 'task.offered' as const,
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    taskOfferId: OFFER_ID,
    workerUserId: TEST_IDS.userId,
    currentTaskRevision: 1,
    offerRevision: 1
  }
}

function offerJournal() {
  return {
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    taskOfferId: OFFER_ID,
    currentTaskRevision: 1,
    currentExecutionRevision: 1,
    offerRevision: 1,
    recipientAgentId: TEST_IDS.agentId,
    receivedAt: TEST_TIMESTAMP
  }
}

function fileExecutionIntent(assignmentTaskRevision: number) {
  return {
    schemaVersion: 1 as const,
    type: 'task_execution_file_intent' as const,
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    assignmentTaskRevision,
    bindingRevision: FILE_BINDING_REVISION,
    declarationDigest: TEST_HASH,
    inputs: [{ resourceRefId: INPUT_RESOURCE_ID, destinationName: 'input.csv' }],
    output: {
      rootResourceRefId: OUTPUT_ROOT_RESOURCE_ID,
      fileName: 'analysis.md',
      mediaType: 'text/markdown',
      maxBytes: 1_000_000
    }
  }
}

function taskFileIntent() {
  return {
    schemaVersion: 1 as const,
    bindingRevision: FILE_BINDING_REVISION,
    inputs: [{
      kind: 'content-space.input-file' as const,
      locator: FILE_LOCATOR,
      destinationName: 'input.csv',
      expectedSemanticRevision: null,
      expectedMediaType: 'text/csv'
    }],
    output: {
      kind: 'content-space.output-new' as const,
      target: 'project-binding-root' as const,
      mode: 'upload-new' as const,
      fileName: 'analysis.md',
      mediaType: 'text/markdown',
      maxBytes: 1_000_000
    }
  }
}

function fileResources(assignmentTaskRevision: number) {
  const metadata = {
    schemaVersion: 1 as const,
    revision: 1,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP
  }
  return [
    cloudResourceRefSchema.parse({
      ...metadata,
      type: 'resource_ref',
      resourceRefId: INPUT_RESOURCE_ID,
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      assignmentTaskRevision,
      bindingRevision: FILE_BINDING_REVISION,
      intentDigest: TEST_HASH,
      role: 'input-file',
      ordinal: 0,
      locator: FILE_LOCATOR,
      locatorDigest: FILE_LOCATOR_DIGEST,
      status: 'available',
      invalidatedAt: null
    }),
    cloudResourceRefSchema.parse({
      ...metadata,
      type: 'resource_ref',
      resourceRefId: OUTPUT_ROOT_RESOURCE_ID,
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      assignmentTaskRevision,
      bindingRevision: FILE_BINDING_REVISION,
      intentDigest: TEST_HASH,
      role: 'output-container',
      ordinal: 1,
      locator: ROOT_LOCATOR,
      locatorDigest: ROOT_LOCATOR_DIGEST,
      status: 'available',
      invalidatedAt: null
    })
  ]
}

function fileContentReadiness() {
  return {
    schemaVersion: 1 as const,
    type: 'project_content_readiness' as const,
    projectId: TEST_IDS.projectId,
    userId: TEST_IDS.userId,
    providerInstance: {
      schemaVersion: 1 as const,
      type: 'provider_instance_reference' as const,
      providerInstanceRef: FILE_LOCATOR.authority
    },
    state: 'ready' as const,
    reason: null,
    providerPrincipalFactId: TEST_IDS.providerPrincipalFactId,
    snapshottedFactRevision: 1,
    providerPrincipal: {
      schemaVersion: 1 as const,
      type: 'provider_directory_principal_reference' as const,
      providerInstance: {
        schemaVersion: 1 as const,
        type: 'provider_instance_reference' as const,
        providerInstanceRef: FILE_LOCATOR.authority
      },
      principalKind: 'user' as const,
      principalId: 'principal-worker-alpha'
    },
    bindingRevision: FILE_BINDING_REVISION,
    lastObservationId: TEST_IDS.providerObservationId,
    effectiveAt: TEST_TIMESTAMP,
    revision: 1,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP
  }
}

function fileContentBinding() {
  return {
    schemaVersion: 1 as const,
    type: 'project_content_space_binding' as const,
    projectContentBindingId: TEST_IDS.projectContentBindingId,
    projectId: TEST_IDS.projectId,
    contentOwnerUserId: TEST_IDS.userId,
    providerInstance: {
      schemaVersion: 1 as const,
      type: 'provider_instance_reference' as const,
      providerInstanceRef: ROOT_LOCATOR.authority
    },
    rootLocator: ROOT_LOCATOR,
    rootLocatorDigest: ROOT_LOCATOR_DIGEST,
    provisioningIntentId: TEST_IDS.provisioningIntentId,
    provisioningRevision: 1,
    attestationId: TEST_IDS.provisioningAttestationId,
    attestationDigest: 'd'.repeat(64),
    status: 'active' as const,
    statusReason: null,
    activatedAt: TEST_TIMESTAMP,
    degradedAt: null,
    closedAt: null,
    revision: FILE_BINDING_REVISION,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP
  }
}

function contentExecutionBinding(ordinal: number, workspaceId: string) {
  return {
    callerId: 'sciforge.collaboration',
    principal: {
      authority: 'sciforge.oidc',
      subject: TEST_IDS.userId,
      assurance: 'cloud-authenticated' as const,
      deviceId: TEST_IDS.deviceId,
      identityVersion: 1
    },
    principalSnapshotDigest: '1'.repeat(64),
    workspaceId,
    executionContextDigest: '2'.repeat(64),
    invocationId: `contentInvocation${String(ordinal).padStart(4, '0')}`
  }
}

function contentPreflightResult(ordinal: number, workspaceId: string, input: unknown) {
  return {
    ok: true as const,
    value: {
      execution: contentExecutionBinding(ordinal, workspaceId),
      status: 'ready' as const,
      intentDigest: digestFixture(input),
      observationRevision: '3'.repeat(64),
      authorization: ['not', 'granted'].join('_') as 'not_granted',
      cacheable: false as const
    }
  }
}

function contentDownloadResult(ordinal: number, workspaceId: string) {
  const invocationId = `contentInvocation${String(ordinal).padStart(4, '0')}`
  const sha256 = '4'.repeat(64)
  return {
    ok: true as const,
    value: {
      operation: 'download' as const,
      execution: contentExecutionBinding(ordinal, workspaceId),
      root: ROOT_LOCATOR,
      receipt: {
        invocationId,
        reference: {
          providerInstanceRef: FILE_LOCATOR.authority,
          fileId: FILE_LOCATOR.identity.fileId
        },
        bytesWritten: 4,
        digest: { algorithm: 'sha256' as const, value: sha256 }
      },
      readAfterObservation: {
        reference: FILE_LOCATOR,
        bytes: 4,
        sha256
      },
      workspaceRelativePath: 'input.csv',
      observedAt: TEST_TIMESTAMP,
      bytes: 4,
      sha256,
      transferReceiptDigest: '5'.repeat(64),
      observationDigest: '6'.repeat(64),
      providerDigest: {
        status: 'deferred' as const,
        reason: 'provider_digest_not_in_run0_contract' as const
      }
    }
  }
}

function contentUploadResult(ordinal: number, workspaceId: string) {
  const invocationId = `contentInvocation${String(ordinal).padStart(4, '0')}`
  const outputReference = {
    contractVersion: 1 as const,
    kind: 'content-space.file-reference' as const,
    authority: ROOT_LOCATOR.authority,
    identity: { fileId: 'analysis-output-alpha' }
  }
  return {
    ok: true as const,
    value: {
      operation: 'upload-new' as const,
      execution: contentExecutionBinding(ordinal, workspaceId),
      root: ROOT_LOCATOR,
      receipt: {
        invocationId,
        parent: {
          providerInstanceRef: ROOT_LOCATOR.authority,
          containerId: ROOT_LOCATOR.identity.containerId
        },
        name: 'analysis.md',
        sourceSize: 4,
        reference: {
          providerInstanceRef: outputReference.authority,
          fileId: outputReference.identity.fileId
        }
      },
      portableReference: outputReference,
      writeAfterObservation: {
        parent: ROOT_LOCATOR,
        reference: outputReference,
        name: 'analysis.md',
        size: 4
      },
      workspaceRelativePath: 'analysis.md',
      observedAt: TEST_TIMESTAMP,
      bytes: 4,
      sha256: '7'.repeat(64),
      transferReceiptDigest: '8'.repeat(64),
      observationDigest: '9'.repeat(64),
      providerDigest: {
        status: 'deferred' as const,
        reason: 'provider_digest_not_in_run0_contract' as const
      }
    }
  }
}

function digestFixture(input: unknown): string {
  return createHash('sha256').update(canonicalFixture(input)).digest('hex')
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function canonicalFixture(input: unknown): string {
  if (input === null || typeof input === 'boolean' || typeof input === 'number' || typeof input === 'string') {
    return JSON.stringify(input)
  }
  if (Array.isArray(input)) return `[${input.map(canonicalFixture).join(',')}]`
  if (!input || typeof input !== 'object') throw new TypeError('Unsupported canonical fixture.')
  return `{${Object.entries(input as Record<string, unknown>)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${JSON.stringify(key)}:${canonicalFixture(value)}`)
    .join(',')}}`
}

function emptyState(): CollaborationLocalState {
  return {
    schemaVersion: 3,
    revision: 0,
    lastInboxSequence: 0,
    endpoints: [],
    endpointLocators: [],
    managedContainers: [],
    agents: [agentNodeFixture],
    projections: [],
    projects: [],
    tasks: [],
    taskRuns: [],
    pendingTaskOffers: [],
    workerAcceptancePolicies: [],
    queue: [],
    receipts: [],
    outbox: [],
    diagnostics: [],
    remoteApprovals: []
  }
}

function entityResponse(request: RestRequest, entity: unknown): RestResponse {
  return {
    protocolVersion: '1.0',
    type: 'rest.entity',
    requestId: request.requestId,
    entity
  } as unknown as RestResponse
}

function collectionResponse(request: RestRequest, items: unknown[]): RestResponse {
  return {
    protocolVersion: '1.0',
    type: 'rest.collection',
    requestId: request.requestId,
    items
  } as unknown as RestResponse
}

function neverAgent(): DomainMainAgentExecutionHost {
  return {
    runtimeReadiness: readyRuntimeReadiness,
    run: async () => { throw new Error('Agent Runtime must not run.') }
  }
}

async function readyRuntimeReadiness() {
  return {
    state: 'ready' as const,
    runtimeId: 'codex',
    capabilityTags: ['agent-runtime.codex', 'model-access.api']
  }
}

function noContentCapabilities(): DomainMainSystemCapabilityInvoker {
  return capabilityInvoker(async () => {
    throw new Error('Content Space must not run for a text Task.')
  })
}

function capabilityInvoker(
  invoke: DomainMainSystemCapabilityInvoker['invoke']
): DomainMainSystemCapabilityInvoker {
  return {
    invoke,
    createApprovedBatch: () => {
      throw new Error('Finite provisioning approval must not run in Worker transfer tests.')
    }
  }
}

class MemoryBackend implements CollaborationStateBackend {
  constructor(private value: unknown) {}
  async read(): Promise<unknown> { return structuredClone(this.value) }
  async write(value: CollaborationLocalState): Promise<void> { this.value = structuredClone(value) }
}

class FailOnceTaskRunBackend implements CollaborationStateBackend {
  private failed = false

  constructor(private value: unknown) {}

  async read(): Promise<unknown> { return structuredClone(this.value) }

  async write(value: CollaborationLocalState): Promise<void> {
    if (!this.failed && value.taskRuns.length > 0) {
      this.failed = true
      throw new Error('simulated crash before the local TaskRun checkpoint')
    }
    this.value = structuredClone(value)
  }
}

class FailOnceStartedRunBackend implements CollaborationStateBackend {
  private failed = false

  constructor(private value: unknown) {}

  async read(): Promise<unknown> { return structuredClone(this.value) }

  async write(value: CollaborationLocalState): Promise<void> {
    const run = value.taskRuns[0]
    if (!this.failed && run?.state === 'running' && run.startedAt !== null) {
      this.failed = true
      throw new Error('simulated crash before the local execution-start checkpoint')
    }
    this.value = structuredClone(value)
  }
}
