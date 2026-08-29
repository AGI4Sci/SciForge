import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import {
  projectPlanConfirmCommandSchema,
  projectPlanSubmitCommandSchema,
  restRequestSchema,
  restResponseSchema
} from '@sciforge/collaboration-contracts'
import {
  TEST_IDS,
  TEST_TIMESTAMP,
  userPrincipalFixture
} from '@sciforge/collaboration-contracts/testing'
import type { AgentCloudRuntime } from '@sciforge/domain-identity-access/agent-cloud-runtime'
import { DurableCloudOutbox } from './outbox.js'
import {
  CollaborationLocalStore,
  type CollaborationLocalState,
  type CollaborationStateBackend
} from './store.js'

const LEGACY_PLAN_DIGEST = 'b'.repeat(64)

test('upgrades only a definitely-unsent v1 Plan submit and recomputes its digest', async () => {
  const command = legacyPlanSubmit('req_Pending000001', 'idem_plan.submit.pending-1')
  const backend = new MemoryBackend(v2State([outboxEntry({
    outboxId: 'obx_Pending000001',
    command,
    state: 'pending',
    attempts: 0
  })]))

  const state = await new CollaborationLocalStore(backend).open()

  assert.equal(state.schemaVersion, 3)
  assert.equal(state.revision, 7)
  assert.equal(state.lastInboxSequence, 9)
  assert.deepEqual(state.user, userPrincipalFixture)
  assert.equal(backend.writes.length, 1)
  const migrated = state.outbox[0]
  assert.equal(migrated?.state, 'pending')
  assert.equal(migrated?.replayBlockedReason, undefined)
  const request = projectPlanSubmitCommandSchema.parse(migrated?.body)
  assert.deepEqual(request.tasks[0]?.fileIntent, {
    ...legacyFileIntent(),
    schemaVersion: 2,
    dependencyInputs: []
  })
  assert.notEqual(request.planDigest, LEGACY_PLAN_DIGEST)
  assert.equal(request.planDigest, stableDigest(planFacts(request)))
  assert.deepEqual(restRequestSchema.parse(request), request)
  assert.deepEqual(backend.writes[0], state)
})

test('normalizes delivered submit and confirm facts without changing their Cloud digest', async () => {
  const submit = legacyPlanSubmit('req_Deliver000001', 'idem_plan.submit.delivered-1')
  const confirm = projectPlanConfirmCommandSchema.parse({
    protocolVersion: '1.0',
    requestId: 'req_Confirm000001',
    idempotencyKey: 'idem_plan.confirm.delivered-1',
    type: 'project.plan.confirm',
    projectId: TEST_IDS.projectId,
    projectPlanId: TEST_IDS.projectPlanId,
    expectedProjectRevision: 2,
    expectedCoordinatorAuthorityEpoch: 1,
    expectedPlanRevision: 1,
    planDigest: LEGACY_PLAN_DIGEST,
    initialTeam: null
  })
  const backend = new MemoryBackend(v2State([
    outboxEntry({
      outboxId: 'obx_Deliver000001',
      command: submit,
      state: 'delivered',
      attempts: 1,
      response: entityResponse(submit.requestId, legacyProjectPlan('awaiting_confirmation'))
    }),
    outboxEntry({
      outboxId: 'obx_Confirm000001',
      command: confirm,
      state: 'delivered',
      attempts: 1,
      response: entityResponse(confirm.requestId, legacyProjectPlan('confirmed'))
    })
  ]))

  const state = await new CollaborationLocalStore(backend).open()

  for (const entry of state.outbox) {
    const request = restRequestSchema.parse(entry.body)
    const response = restResponseSchema.parse(entry.response)
    assert.equal(response.requestId, request.requestId)
    assert.equal(entry.replayBlockedReason, undefined)
    if (request.type === 'project.plan.submit') {
      assert.equal(request.planDigest, LEGACY_PLAN_DIGEST)
      assert.equal(request.tasks[0]?.fileIntent?.schemaVersion, 2)
      assert.deepEqual(request.tasks[0]?.fileIntent?.dependencyInputs, [])
    }
    if (response.type !== 'rest.entity' || response.entity.type !== 'project_plan') {
      throw new Error('Expected one strict delivered Project Plan response.')
    }
    assert.equal(response.entity.planDigest, LEGACY_PLAN_DIGEST)
    assert.equal(response.entity.tasks[0]?.fileIntent?.schemaVersion, 2)
    assert.deepEqual(response.entity.tasks[0]?.fileIntent?.dependencyInputs, [])
  }
})

test('isolates a malformed delivered Plan replay while preserving unrelated local state', async () => {
  const submit = legacyPlanSubmit('req_Damaged000001', 'idem_plan.submit.damaged-1')
  const damaged = outboxEntry({
    outboxId: 'obx_Damaged000001',
    command: submit,
    state: 'delivered',
    attempts: 1,
    response: entityResponse('req_Another000001', legacyProjectPlan('awaiting_confirmation'))
  })
  const unrelated = {
    outboxId: 'obx_Unrelated0001',
    idempotencyKey: 'idem_worker.availability.preserved-1',
    kind: 'worker.availability',
    body: { sentinel: 'preserved' },
    state: 'pending',
    attempts: 0,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP
  }
  const state = await new CollaborationLocalStore(new MemoryBackend(
    v2State([damaged, unrelated])
  )).open()

  assert.equal(state.schemaVersion, 3)
  assert.equal(state.lastInboxSequence, 9)
  assert.deepEqual(state.user, userPrincipalFixture)
  const blocked = state.outbox[0]
  assert.equal(blocked?.state, 'failed')
  assert.equal(blocked?.replayBlockedReason, 'legacy_plan_v1_not_safely_upgradable')
  assert.equal(blocked?.deliveredAt, undefined)
  assert.equal(blocked?.response, undefined)
  assert.deepEqual(blocked?.body, damaged.body)
  assert.deepEqual(state.outbox[1], unrelated)
  assert.equal(state.diagnostics.at(-1)?.recoverable, false)
})

test('preserves undelivered Plan confirm commands for exact receipt replay', async () => {
  const pending = projectPlanConfirmCommandSchema.parse({
    protocolVersion: '1.0',
    requestId: 'req_Confirm000002',
    idempotencyKey: 'idem_plan.confirm.pending-1',
    type: 'project.plan.confirm',
    projectId: TEST_IDS.projectId,
    projectPlanId: TEST_IDS.projectPlanId,
    expectedProjectRevision: 2,
    expectedCoordinatorAuthorityEpoch: 1,
    expectedPlanRevision: 1,
    planDigest: LEGACY_PLAN_DIGEST,
    initialTeam: null
  })
  const reconciling = {
    ...pending,
    requestId: 'req_Confirm000003',
    idempotencyKey: 'idem_plan.confirm.reconcile-1'
  }
  const entries = [
    outboxEntry({
      outboxId: 'obx_Confirm000002',
      command: pending,
      state: 'pending',
      attempts: 0
    }),
    outboxEntry({
      outboxId: 'obx_Confirm000003',
      command: reconciling,
      state: 'reconciling',
      attempts: 1
    })
  ]
  const originalBodies = entries.map(({ body }) => body)
  const state = await new CollaborationLocalStore(new MemoryBackend(v2State(entries))).open()

  assert.deepEqual(state.outbox.map(({ body }) => body), originalBodies)
  assert.deepEqual(state.outbox.map(({ state: outboxState }) => outboxState), [
    'pending',
    'reconciling'
  ])
  assert.ok(state.outbox.every(({ replayBlockedReason }) => replayBlockedReason === undefined))
  state.outbox.forEach(({ body }) => projectPlanConfirmCommandSchema.parse(body))
})

test('permanently blocks outcome-unknown v1 submits from resume, retry, and drain', async () => {
  const unsafe = [
    ['obx_Sending000001', 'req_Sending000001', 'idem_plan.submit.sending-1', 'sending', 1],
    ['obx_Reconciling01', 'req_Reconcile00001', 'idem_plan.submit.reconcile-1', 'reconciling', 1],
    ['obx_Failed0000001', 'req_Failed0000001', 'idem_plan.submit.failed-1', 'failed', 1]
  ] as const
  const entries = unsafe.map(([outboxId, requestId, idempotencyKey, state, attempts]) => outboxEntry({
    outboxId,
    command: legacyPlanSubmit(requestId, idempotencyKey),
    state,
    attempts,
    ...(state === 'failed' ? { error: 'Original failure diagnostic.' } : {})
  }))
  const originalBodies = entries.map(({ body }) => structuredClone(body))
  const store = new CollaborationLocalStore(new MemoryBackend(v2State(entries)))
  const state = await store.open()

  assert.equal(state.outbox.length, unsafe.length)
  state.outbox.forEach((entry, index) => {
    assert.equal(entry.state, 'failed')
    assert.equal(entry.replayBlockedReason, 'legacy_plan_v1_delivery_outcome_unknown')
    assert.deepEqual(entry.body, originalBodies[index])
  })
  assert.equal(state.outbox[2]?.error, 'Original failure diagnostic.')
  assert.equal(
    state.diagnostics.filter(({ code }) => (
      code === 'collaboration.outbox.legacy_plan_v1_replay_blocked'
    )).length,
    unsafe.length
  )

  let executeCalls = 0
  const outbox = new DurableCloudOutbox({
    store,
    localAgentId: () => TEST_IDS.agentId,
    agentCloudRuntime: {
      authorityStatus: async () => ({ state: 'ready', userId: TEST_IDS.userId }),
      execute: async () => {
        executeCalls += 1
        throw new Error('Blocked legacy work reached Cloud execution.')
      }
    } as unknown as AgentCloudRuntime
  })
  for (const entry of state.outbox) {
    await assert.rejects(
      outbox.resumeAndWait('coordinator.command', entry.idempotencyKey, () => undefined),
      /replay is permanently blocked/u
    )
    await assert.rejects(outbox.retry(entry.outboxId), /replay is permanently blocked/u)
  }
  await outbox.retry()
  outbox.start()
  await outbox.waitForIdle()
  assert.equal(executeCalls, 0)
  assert.ok(store.snapshot().outbox.every((entry) => (
    entry.state === 'failed' && entry.replayBlockedReason !== undefined
  )))
})

test('fails closed when a never-sent v1 submit cannot become a strict current command', async () => {
  const command = legacyPlanSubmit('req_Invalid000001', 'idem_plan.submit.invalid-1')
  const malformed = {
    ...command,
    tasks: [{
      ...command.tasks[0],
      fileIntent: { ...command.tasks[0]?.fileIntent, unexpectedLegacyFact: true }
    }]
  }
  const state = await new CollaborationLocalStore(new MemoryBackend(v2State([
    outboxEntry({
      outboxId: 'obx_Invalid000001',
      command: malformed,
      state: 'pending',
      attempts: 0
    })
  ]))).open()

  assert.equal(state.outbox[0]?.state, 'failed')
  assert.equal(
    state.outbox[0]?.replayBlockedReason,
    'legacy_plan_v1_not_safely_upgradable'
  )
  assert.deepEqual(state.outbox[0]?.body, malformed)
})

function legacyPlanSubmit(requestId: string, idempotencyKey: string) {
  return {
    protocolVersion: '1.0',
    requestId,
    idempotencyKey,
    type: 'project.plan.submit',
    projectId: TEST_IDS.projectId,
    expectedProjectRevision: 1,
    expectedCoordinatorAuthorityEpoch: 1,
    supersedesProjectPlanId: null,
    sourceInputLocators: [],
    tasks: [legacyPlanTask()],
    rationale: 'Generate one report.',
    runtimeProvenance: {
      runtimeId: 'codex',
      modelId: null,
      generatedByCoordinatorAgentId: TEST_IDS.agentId,
      generatedAt: TEST_TIMESTAMP
    },
    planDigest: LEGACY_PLAN_DIGEST
  }
}

function legacyPlanTask() {
  return {
    planItemId: 'item_report',
    title: 'Write report',
    objective: 'Write the final report.',
    completionCriteria: ['A report file exists.'],
    dependencyPlanItemIds: [],
    requiredCapabilityTags: [],
    workerUserId: TEST_IDS.userId,
    fileIntent: legacyFileIntent()
  }
}

function legacyFileIntent() {
  return {
    schemaVersion: 1,
    inputs: [],
    output: {
      kind: 'content-space.output-new',
      target: 'project-binding-root',
      mode: 'upload-new',
      fileName: 'report.md',
      mediaType: 'text/markdown',
      maxBytes: 1_000_000
    }
  }
}

function legacyProjectPlan(state: 'awaiting_confirmation' | 'confirmed') {
  return {
    schemaVersion: 1,
    type: 'project_plan',
    projectPlanId: TEST_IDS.projectPlanId,
    projectId: TEST_IDS.projectId,
    state,
    planRevision: 1,
    sourceInputLocators: [],
    tasks: [legacyPlanTask()],
    rationale: 'Generate one report.',
    runtimeProvenance: {
      runtimeId: 'codex',
      modelId: null,
      generatedByCoordinatorAgentId: TEST_IDS.agentId,
      generatedAt: TEST_TIMESTAMP
    },
    planDigest: LEGACY_PLAN_DIGEST,
    submittedAt: TEST_TIMESTAMP,
    confirmedByUserId: state === 'confirmed' ? TEST_IDS.userId : null,
    confirmedAt: state === 'confirmed' ? TEST_TIMESTAMP : null,
    supersededAt: null,
    revision: state === 'confirmed' ? 2 : 1,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP
  }
}

function entityResponse(requestId: string, entity: unknown) {
  return { protocolVersion: '1.0', type: 'rest.entity', requestId, entity }
}

function outboxEntry(input: Readonly<{
  outboxId: string
  command: Record<string, unknown>
  state: 'pending' | 'sending' | 'reconciling' | 'delivered' | 'failed'
  attempts: number
  response?: Record<string, unknown>
  error?: string
}>) {
  return {
    outboxId: input.outboxId,
    idempotencyKey: String(input.command.idempotencyKey),
    kind: 'coordinator.command',
    body: input.command,
    state: input.state,
    attempts: input.attempts,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP,
    ...(input.state === 'delivered' ? { deliveredAt: TEST_TIMESTAMP } : {}),
    ...(input.response ? { response: input.response } : {}),
    ...(input.error ? { error: input.error } : {})
  }
}

function v2State(outbox: readonly Record<string, unknown>[]) {
  return {
    schemaVersion: 2,
    revision: 7,
    lastInboxSequence: 9,
    user: userPrincipalFixture,
    endpoints: [],
    endpointLocators: [],
    managedContainers: [],
    agents: [],
    projections: [],
    projects: [],
    tasks: [],
    taskRuns: [],
    pendingTaskOffers: [],
    workerAcceptancePolicies: [],
    queue: [],
    receipts: [],
    outbox,
    diagnostics: [{
      code: 'existing-diagnostic',
      severity: 'info',
      message: 'Preserve unrelated local state.',
      occurredAt: TEST_TIMESTAMP,
      recoverable: true
    }],
    remoteApprovals: []
  }
}

function planFacts(request: ReturnType<typeof projectPlanSubmitCommandSchema.parse>) {
  return {
    projectId: request.projectId,
    expectedProjectRevision: request.expectedProjectRevision,
    expectedCoordinatorAuthorityEpoch: request.expectedCoordinatorAuthorityEpoch,
    supersedesProjectPlanId: request.supersedesProjectPlanId,
    sourceInputLocators: request.sourceInputLocators,
    tasks: request.tasks,
    rationale: request.rationale,
    runtimeProvenance: request.runtimeProvenance
  }
}

function stableDigest(value: unknown): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex')
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  )).join(',')}}`
}

class MemoryBackend implements CollaborationStateBackend {
  readonly writes: CollaborationLocalState[] = []

  constructor(private value: unknown) {}

  async read(): Promise<unknown> {
    return structuredClone(this.value)
  }

  async write(value: CollaborationLocalState): Promise<void> {
    this.value = structuredClone(value)
    this.writes.push(structuredClone(value))
  }
}
