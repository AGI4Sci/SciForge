import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import {
  cloudResourceRefSchema,
  externalOperationRecoveryJournalEntrySchema,
  taskExecutionPreflightSchema,
  taskExecutionSchema,
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
  agentNodeFixture
} from '@sciforge/collaboration-contracts/testing'
import type { DomainMainAgentExecutionHost, DomainMainSystemCapabilityInvoker } from '@sciforge/domain-sdk/host'
import {
  CONTENT_SPACE_SYSTEM_DOWNLOAD_CONTRACT,
  CONTENT_SPACE_SYSTEM_TRANSFER_PREFLIGHT_CONTRACT,
  CONTENT_SPACE_SYSTEM_UPLOAD_NEW_CONTRACT
} from '@sciforge/domain-content-space/contract'
import type { CollaborationConnection } from './connection.js'
import type { DurableCloudOutbox } from './outbox.js'
import {
  CollaborationLocalStore,
  type CollaborationLocalState,
  type CollaborationStateBackend
} from './store.js'
import { CollaborationTaskAdapter } from './task-adapter.js'

const OFFER_ID = 'ofr_Offer0000001'
const FILE_BINDING_REVISION = 3
const INPUT_RESOURCE_ID = 'rrf_InputFile0001'
const OUTPUT_ROOT_RESOURCE_ID = 'rrf_OutputRoot001'
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

test('duplicate inbox offers persist once and manual mode sends no acceptance before HCI', async () => {
  const cloud = new FakeWorkerCloud()
  const { adapter, store } = await createRunner(cloud)

  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle(TEST_IDS.executionId)
  await adapter.acceptOffer(offerPayload(), TEST_IDS.agentId)
  await adapter.waitForIdle(TEST_IDS.executionId)

  const [run] = store.snapshot().taskRuns
  assert.equal(run?.state, 'awaiting-manual')
  assert.equal(store.snapshot().taskRuns.length, 1)
  assert.equal(cloud.commands.length, 0)

  await adapter.decideOffer(TEST_IDS.executionId, {
    decision: 'reject',
    reason: 'human_rejected'
  })
  await adapter.waitForIdle(TEST_IDS.executionId)
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), ['task.offer.reject'])
  assert.equal(store.snapshot().taskRuns[0]?.state, 'rejected')
})

test('automatic text execution journals before Agent and uses explicit vNext commands only', async () => {
  const cloud = new FakeWorkerCloud()
  let store!: CollaborationLocalStore
  const directives: string[] = []
  const agentExecution: DomainMainAgentExecutionHost = {
    run: async (request) => {
      directives.push(request.clientDirectiveId ?? '')
      const run = store.snapshot().taskRuns[0]
      assert.equal(run?.agentJournal[0]?.state, 'dispatched', 'Agent effect must follow durable dispatch journal')
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
  await created.adapter.waitForIdle(TEST_IDS.executionId)

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
  await created.adapter.waitForIdle(TEST_IDS.executionId)
  assert.equal(directives.length, 1, 'duplicate offer must not replay a completed execution')
})

test('file offer uses the generic token-free Content preflight and rejects provider-not-ready closed', async () => {
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
  await adapter.waitForIdle(TEST_IDS.executionId)

  const fileRun = store.snapshot().taskRuns[0]
  assert.equal(fileRun?.resources.length, 2)
  assert.deepEqual(capabilityCalls, [CONTENT_SPACE_SYSTEM_TRANSFER_PREFLIGHT_CONTRACT.actionId])
  assert.deepEqual(cloud.commands.filter((type) => !type.startsWith('worker.')), ['task.offer.reject'])
  assert.equal(store.snapshot().taskRuns[0]?.decision?.decision, 'reject')
  assert.equal(store.snapshot().taskRuns[0]?.state, 'rejected')
  assert.deepEqual(store.snapshot().taskRuns[0]?.latestPreflight?.reasons, ['provider_not_ready'])
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
    run: async () => {
      const run = store.snapshot().taskRuns[0]
      assert.equal(
        run?.externalJournal.filter(({ operation, state }) => (
          operation === 'download' && state === 'observed_success'
        )).length,
        1,
        'Agent may start only after the exact input download was durably observed.'
      )
      return {
        runtimeId: 'codex',
        threadId: 'worker-file-thread',
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
  await created.adapter.waitForIdle(TEST_IDS.executionId)

  assert.deepEqual(transferCalls.map(({ actionId }) => actionId), [
    CONTENT_SPACE_SYSTEM_DOWNLOAD_CONTRACT.actionId,
    CONTENT_SPACE_SYSTEM_UPLOAD_NEW_CONTRACT.actionId
  ])
  const run = store.snapshot().taskRuns[0]
  assert.equal(run?.state, 'completed')
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
  await created.adapter.waitForIdle(TEST_IDS.executionId)

  const recovered = created.store.snapshot().taskRuns[0]
  assert.deepEqual(cloud.commands, ['external_operation.observe'])
  assert.equal(recovered?.state, 'manual-recovery')
  assert.equal(recovered?.externalJournal[0]?.state, 'outcome_unknown')
  assert.equal(recovered?.lateOutcomes[0]?.outcome, 'outcome_unknown')
})

test('restart resumes the same dispatched Agent directive instead of creating another execution', async () => {
  const cloud = new FakeWorkerCloud('running')
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
    runtimeId: null,
    threadId: null,
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
      runtimeId: null,
      threadId: null,
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
    startedAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP,
    completedAt: null,
    error: null
  }]
  const directives: string[] = []
  const created = await createRunner(cloud, {
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
  await created.adapter.waitForIdle(TEST_IDS.executionId)
  assert.deepEqual(directives, [stableDirective])
  assert.equal(created.store.snapshot().taskRuns[0]?.agentJournal.length, 1)
  assert.equal(created.store.snapshot().taskRuns[0]?.state, 'completed')
})

async function createRunner(
  cloud: FakeWorkerCloud,
  agentExecution: DomainMainAgentExecutionHost = neverAgent(),
  initial: CollaborationLocalState = emptyState(),
  capabilities: DomainMainSystemCapabilityInvoker = noContentCapabilities()
) {
  const store = new CollaborationLocalStore(new MemoryBackend(initial))
  await store.open()
  cloud.store = store
  const adapter = new CollaborationTaskAdapter({
    store,
    connection: cloud.connection(),
    outbox: cloud.outbox(),
    agentExecution,
    capabilities,
    localAgentId: () => TEST_IDS.agentId,
    workspaceRootForExecution: (executionId) => `/tmp/sciforge-worker-${executionId}`,
    now: () => new Date(TEST_TIMESTAMP)
  })
  return { adapter, store }
}

class FakeWorkerCloud {
  task: Task
  execution: TaskExecution
  commands: string[] = []
  store: CollaborationLocalStore | null = null
  private readonly recoveryJournals = new Map<string, ReturnType<
    typeof externalOperationRecoveryJournalEntrySchema.parse
  >>()
  private recoveryJournalOrdinal = 0

  constructor(
    state: 'offered' | 'running' = 'offered',
    private readonly fileMode = false
  ) {
    this.task = makeTask(state, state === 'offered' ? 1 : 3)
    this.execution = makeExecution(state, this.task.revision, fileMode)
  }

  preflight() {
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
      requestedTaskRevision: this.task.revision,
      currentTaskRevision: this.task.revision,
      requestedExecutionRevision: this.execution.revision,
      membership: {
        schemaVersion: 1,
        type: 'project_membership',
        projectMembershipId: 'pmb_Member000001',
        projectId: TEST_IDS.projectId,
        userId: TEST_IDS.userId,
        state: 'active',
        authorityEpoch: 1,
        activatedAt: TEST_TIMESTAMP,
        removalRequestedAt: null,
        removalRequestedByUserId: null,
        removedAt: null,
        revision: 1,
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
        state: 'eligible',
        authorityEpoch: 1,
        reason: null,
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
      decision: { outcome: 'allowed', reasons: [] },
      evaluatedAt: TEST_TIMESTAMP
    })
  }

  connection(): CollaborationConnection {
    return {
      executeAsAgent: async (request: RestRequest) => {
        if (request.type === 'task.execution.preflight.get') {
          assert.equal(request.expectedTaskRevision, this.task.revision)
          assert.equal(request.expectedExecutionRevision, this.execution.revision)
          return {
            protocolVersion: '1.0',
            type: 'rest.task_execution_preflight',
            requestId: request.requestId,
            preflight: this.preflight()
          }
        }
        if (request.type === 'resource.get' && this.fileMode) {
          const resource = fileResources(this.execution.fence.assignmentTaskRevision).find(({ resourceRefId }) => (
            resourceRefId === request.resourceRefId
          ))
          if (!resource) throw new Error('Unknown ResourceRef.')
          return entityResponse(request, resource)
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
        this.commands.push(request.type)
      },
      enqueueAndWait: async (_kind: string, request: RestRequest): Promise<RestResponse> => {
        this.commands.push(request.type)
        if (request.type === 'task.offer.accept') {
          this.advance('accepted')
          return entityResponse(request, this.execution)
        }
        if (request.type === 'task.offer.reject') {
          this.advance('rejected')
          return entityResponse(request, this.execution)
        }
        if (request.type === 'task.execution.start') {
          this.advance('running')
          return entityResponse(request, this.execution)
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
          return entityResponse(request, entry)
        }
        if (request.type === 'task.result.submit') {
          assert.equal(request.outputs.length, this.fileMode ? 1 : 0)
          assert.equal(request.recoveryJournalEntryIds.length, this.fileMode ? 2 : 0)
          return entityResponse(request, {
            type: 'task_result_submission',
            resultSubmissionId: 'rsu_Result000001'
          })
        }
        throw new Error(`Unexpected command ${request.type}.`)
      }
    } as unknown as DurableCloudOutbox
  }

  seedRecoveryJournal(
    entry: ReturnType<typeof externalOperationRecoveryJournalEntrySchema.parse>
  ): void {
    this.recoveryJournals.set(entry.contentRecoveryJournalEntryId, entry)
  }

  private advance(state: 'accepted' | 'rejected' | 'running'): void {
    const taskRevision = this.task.revision + 1
    const assignmentTaskRevision = this.execution.fence.assignmentTaskRevision
    const terminal = state === 'rejected'
    this.execution = taskExecutionSchema.parse({
      ...this.execution,
      state,
      stateRevision: this.execution.stateRevision + 1,
      revision: this.execution.revision + 1,
      updatedAt: TEST_LATER_TIMESTAMP,
      acceptedAt: state === 'rejected' ? null : TEST_LATER_TIMESTAMP,
      startedAt: state === 'running' ? TEST_LATER_TIMESTAMP : null,
      terminalAt: terminal ? TEST_LATER_TIMESTAMP : null,
      fence: {
        ...this.execution.fence,
        assignmentTaskRevision,
        status: terminal ? 'fenced' : 'open',
        reason: terminal ? 'offer_rejected' : null,
        fencedAt: terminal ? TEST_LATER_TIMESTAMP : null
      },
      fileIntent: this.fileMode ? fileExecutionIntent(assignmentTaskRevision) : null
    })
    this.task = makeTask(state, taskRevision)
  }

  private requireRecoveryJournal(journalEntryId: string) {
    const entry = this.recoveryJournals.get(journalEntryId)
    if (!entry) throw new Error('Recovery journal was not prepared.')
    return entry
  }
}

function makeTask(state: 'offered' | 'accepted' | 'rejected' | 'running', revision: number): Task {
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
    fileIntent: null,
    currentExecutionId: TEST_IDS.executionId,
    currentExecutionState: state,
    status: state === 'running' || state === 'accepted' ? 'in_progress' : 'offered',
    executionCount: 1,
    maxRetries: 2,
    completedAt: null,
    revision,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP
  })
}

function makeExecution(
  state: 'offered' | 'accepted' | 'rejected' | 'running',
  taskRevision: number,
  fileMode = false,
  assignmentTaskRevision = 1
): TaskExecution {
  const terminal = state === 'rejected'
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
    stateRevision: state === 'offered' ? 1 : 3,
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
      status: terminal ? 'fenced' : 'open',
      reason: terminal ? 'offer_rejected' : null,
      fencedAt: terminal ? TEST_LATER_TIMESTAMP : null
    },
    fileIntent: fileMode ? fileExecutionIntent(assignmentTaskRevision) : null,
    currentResultSubmissionId: null,
    offeredAt: TEST_TIMESTAMP,
    acceptedAt: state === 'accepted' || state === 'running' ? TEST_LATER_TIMESTAMP : null,
    startedAt: state === 'running' ? TEST_LATER_TIMESTAMP : null,
    terminalAt: terminal ? TEST_LATER_TIMESTAMP : null,
    revision: state === 'offered' ? 1 : 3,
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
    executionId: TEST_IDS.executionId,
    taskOfferId: OFFER_ID,
    currentTaskRevision: 1,
    currentExecutionRevision: 1,
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
      authority: 'provider.instance.alpha',
      instanceId: 'instance-alpha'
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
        authority: 'provider.instance.alpha',
        instanceId: 'instance-alpha'
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
      authority: 'provider.instance.alpha',
      instanceId: 'instance-alpha'
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
      authorization: 'not_granted' as const,
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
      execution: contentExecutionBinding(ordinal, workspaceId),
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
      execution: contentExecutionBinding(ordinal, workspaceId),
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
    schemaVersion: 1,
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

function neverAgent(): DomainMainAgentExecutionHost {
  return { run: async () => { throw new Error('Agent Runtime must not run.') } }
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
    beginApprovedBatch: () => {
      throw new Error('Approved batch execution is not configured in this test.')
    },
    executeApprovedBatchOperation: async () => {
      throw new Error('Approved batch execution is not configured in this test.')
    },
    invoke
  }
}

class MemoryBackend implements CollaborationStateBackend {
  constructor(private value: unknown) {}
  async read(): Promise<unknown> { return structuredClone(this.value) }
  async write(value: CollaborationLocalState): Promise<void> { this.value = structuredClone(value) }
}
