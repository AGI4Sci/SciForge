import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  agentInboxMessageSchema,
  type RestRequest
} from '@sciforge/collaboration-contracts'
import {
  TEST_IDS,
  TEST_TIMESTAMP,
  agentInboxMessageFixture,
  agentNodeFixture,
  remoteSessionProjectionFixture
} from '@sciforge/collaboration-contracts/testing'
import type {
  DomainMainRemoteCapabilityApprovalHost,
  DomainRemoteCapabilityApproval
} from '@sciforge/domain-sdk/remote-approval'

import { localProjectionFromRemote } from './projection-coordinator.js'
import { RemoteApprovalCoordinator } from './remote-approval-coordinator.js'
import {
  CollaborationLocalStore,
  type CollaborationLocalState,
  type CollaborationStateBackend,
  type CollaborationOutboxEntry
} from './store.js'

test('remote approval coordinator binds one exact fixed Session and reports the canonical Broker outcome once', async () => {
  const store = await approvalStore()
  const writes: Array<{ kind: CollaborationOutboxEntry['kind']; request: RestRequest }> = []
  let listener: ((approval: DomainRemoteCapabilityApproval) => void | Promise<void>) | undefined
  const decisions: unknown[] = []
  const host: DomainMainRemoteCapabilityApprovalHost = {
    subscribe: (next) => {
      listener = next
      return () => { listener = undefined }
    },
    decide: async (input) => {
      decisions.push(structuredClone(input))
      return 'applied'
    }
  }
  const coordinator = new RemoteApprovalCoordinator({
    store,
    host,
    outbox: {
      enqueue: async (kind, request) => {
        if (!writes.some((entry) => (
          'idempotencyKey' in entry.request
          && 'idempotencyKey' in request
          && entry.request.idempotencyKey === request.idempotencyKey
        ))) writes.push({ kind, request })
      }
    },
    localAgentId: () => TEST_IDS.agentId,
    now: () => new Date(TEST_TIMESTAMP)
  })
  coordinator.subscribe()
  const pending: DomainRemoteCapabilityApproval = {
    approvalId: 'capability-approval-fixture',
    runtimeId: 'codex',
    threadId: 'fixed-thread-1',
    turnId: 'runtime-turn-fixture',
    capabilityRequestId: 'capability-request-fixture',
    actionId: 'fixture.workspace.write',
    invocationId: 'capability-request-fixture',
    safeSummary: '写入脱敏测试结果',
    effect: 'workspace-write',
    remoteEligible: true,
    createdAt: TEST_TIMESTAMP,
    expiresAt: '2026-08-15T00:05:00.000Z',
    state: 'pending'
  }
  await listener?.(pending)
  await listener?.(pending)
  assert.equal(store.snapshot().remoteApprovals.length, 1)
  assert.equal(writes.length, 1)
  assert.equal(writes[0]?.kind, 'capability.approval.create')
  const createRequest = writes[0]?.request
  assert.equal(createRequest?.type, 'capability.approval.create')
  if (createRequest?.type !== 'capability.approval.create') throw new Error('Expected create request')
  assert.deepEqual(createRequest, {
    protocolVersion: '1.0',
    requestId: createRequest.requestId,
    type: 'capability.approval.create',
    idempotencyKey: createRequest.idempotencyKey,
    projectionId: TEST_IDS.projectionId,
    runtimeId: 'codex',
    threadId: 'fixed-thread-1',
    turnId: 'runtime-turn-fixture',
    capabilityRequestId: 'capability-request-fixture',
    desktopApprovalId: 'capability-approval-fixture',
    safeSummary: '写入脱敏测试结果',
    effect: 'workspace-write',
    remoteEligible: true,
    expiresAt: '2026-08-15T00:05:00.000Z'
  })

  await store.transact((draft) => {
    draft.remoteApprovals[0]!.remoteApprovalId = 'rap_abcdefghijkl'
    draft.remoteApprovals[0]!.state = 'pending'
  })
  const decision = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    payload: {
      protocolVersion: '1.0',
      type: 'capability.approval.decision',
      remoteApprovalId: 'rap_abcdefghijkl',
      desktopApprovalId: 'capability-approval-fixture',
      projectionId: TEST_IDS.projectionId,
      runtimeId: 'codex',
      threadId: 'fixed-thread-1',
      turnId: 'runtime-turn-fixture',
      capabilityRequestId: 'capability-request-fixture',
      decisionId: 'decision-fixture',
      decision: 'allow_once'
    }
  })
  await coordinator.handleInbox(decision)
  await coordinator.handleInbox(decision)
  assert.equal(decisions.length, 1)
  assert.equal(writes.length, 2)
  assert.equal(writes[1]?.kind, 'capability.approval.result')
  assert.equal(store.snapshot().remoteApprovals[0]?.outcome, 'applied')
})

test('a replay resumes a persisted decision after restart and reports the canonical Broker outcome', async () => {
  const store = await approvalStore()
  await store.transact((draft) => {
    draft.remoteApprovals.push(persistedDecision({ state: 'deciding' }))
  })
  const writes: Array<{ kind: CollaborationOutboxEntry['kind']; request: RestRequest }> = []
  let decisions = 0
  const coordinator = new RemoteApprovalCoordinator({
    store,
    host: {
      subscribe: () => () => undefined,
      decide: async () => { decisions += 1; return 'not_pending' }
    },
    outbox: { enqueue: async (kind, request) => { writes.push({ kind, request }) } },
    localAgentId: () => TEST_IDS.agentId
  })
  await coordinator.handleInbox(approvalDecisionMessage())
  assert.equal(decisions, 1)
  assert.equal(writes.length, 1)
  assert.equal(writes[0]?.request.type, 'capability.approval.result')
  assert.equal(store.snapshot().remoteApprovals[0]?.outcome, 'not_pending')
  assert.equal(store.snapshot().remoteApprovals[0]?.state, 'reporting')
})

test('a replay requeues a persisted Broker outcome without applying the decision again', async () => {
  const store = await approvalStore()
  await store.transact((draft) => {
    draft.remoteApprovals.push(persistedDecision({ state: 'reporting', outcome: 'applied' }))
  })
  const writes: Array<{ kind: CollaborationOutboxEntry['kind']; request: RestRequest }> = []
  let decisions = 0
  const coordinator = new RemoteApprovalCoordinator({
    store,
    host: {
      subscribe: () => () => undefined,
      decide: async () => { decisions += 1; return 'already_terminal' }
    },
    outbox: { enqueue: async (kind, request) => { writes.push({ kind, request }) } },
    localAgentId: () => TEST_IDS.agentId
  })
  await coordinator.handleInbox(approvalDecisionMessage())
  assert.equal(decisions, 0)
  assert.equal(writes.length, 1)
  assert.equal(writes[0]?.request.type, 'capability.approval.result')
  if (writes[0]?.request.type === 'capability.approval.result') {
    assert.equal(writes[0].request.outcome, 'applied')
  }
})

test('remote approval coordinator rejects every cross-Session identity mismatch before touching the Broker', async () => {
  const store = await approvalStore()
  await store.transact((draft) => {
    draft.remoteApprovals.push({
      desktopApprovalId: 'capability-approval-fixture',
      remoteApprovalId: 'rap_abcdefghijkl',
      projectionId: TEST_IDS.projectionId,
      runtimeId: 'codex',
      threadId: 'fixed-thread-1',
      turnId: 'runtime-turn-fixture',
      capabilityRequestId: 'capability-request-fixture',
      safeSummary: '安全摘要',
      effect: 'workspace-write',
      remoteEligible: true,
      expiresAt: '2026-08-15T00:05:00.000Z',
      state: 'pending',
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP
    })
  })
  let called = false
  const coordinator = new RemoteApprovalCoordinator({
    store,
    host: {
      subscribe: () => () => undefined,
      decide: async () => { called = true; return 'applied' }
    },
    outbox: { enqueue: async () => undefined },
    localAgentId: () => TEST_IDS.agentId
  })
  for (const mismatch of [
    { projectionId: 'rsp_zyxwvutsrqpo' },
    { runtimeId: 'another-runtime' },
    { threadId: 'wrong-thread' },
    { turnId: 'wrong-turn' },
    { capabilityRequestId: 'wrong-capability-request' }
  ]) {
    const message = approvalDecisionMessage()
    await assert.rejects(coordinator.handleInbox(agentInboxMessageSchema.parse({
      ...message,
      payload: { ...message.payload, ...mismatch, decision: 'deny_once' }
    })), /does not match/u)
  }
  assert.equal(called, false)
})

test('a Desktop terminal transition durably supersedes an already-published phone approval', async () => {
  const store = await approvalStore()
  await store.transact((draft) => {
    draft.remoteApprovals.push({
      desktopApprovalId: 'capability-approval-fixture', remoteApprovalId: 'rap_abcdefghijkl',
      projectionId: TEST_IDS.projectionId, runtimeId: 'codex', threadId: 'fixed-thread-1',
      turnId: 'runtime-turn-fixture', capabilityRequestId: 'capability-request-fixture',
      safeSummary: '安全摘要', effect: 'workspace-write', remoteEligible: true,
      expiresAt: '2026-08-15T00:05:00.000Z', state: 'pending',
      createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP
    })
  })
  const writes: Array<{ kind: CollaborationOutboxEntry['kind']; request: RestRequest }> = []
  let listener: ((approval: DomainRemoteCapabilityApproval) => void | Promise<void>) | undefined
  const coordinator = new RemoteApprovalCoordinator({
    store,
    host: { subscribe: (next) => { listener = next; return () => undefined }, decide: async () => 'applied' },
    outbox: { enqueue: async (kind, request) => { writes.push({ kind, request }) } },
    localAgentId: () => TEST_IDS.agentId
  })
  coordinator.subscribe()
  await listener?.({
    approvalId: 'capability-approval-fixture', runtimeId: 'codex', threadId: 'fixed-thread-1',
    turnId: 'runtime-turn-fixture', capabilityRequestId: 'capability-request-fixture',
    actionId: 'fixture.workspace.write', invocationId: 'capability-request-fixture', safeSummary: '安全摘要',
    effect: 'workspace-write', remoteEligible: true, createdAt: TEST_TIMESTAMP,
    expiresAt: '2026-08-15T00:05:00.000Z', state: 'cancelled'
  })
  assert.equal(writes.length, 1)
  assert.equal(writes[0]?.kind, 'capability.approval.withdraw')
  assert.equal(writes[0]?.request.type, 'capability.approval.withdraw')
})

function approvalDecisionMessage() {
  return agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    payload: {
      protocolVersion: '1.0',
      type: 'capability.approval.decision',
      remoteApprovalId: 'rap_abcdefghijkl',
      desktopApprovalId: 'capability-approval-fixture',
      projectionId: TEST_IDS.projectionId,
      runtimeId: 'codex',
      threadId: 'fixed-thread-1',
      turnId: 'runtime-turn-fixture',
      capabilityRequestId: 'capability-request-fixture',
      decisionId: 'decision-fixture',
      decision: 'allow_once'
    }
  })
}

function persistedDecision(overrides: {
  state: 'deciding' | 'reporting'
  outcome?: 'applied' | 'already_terminal' | 'not_pending' | 'not_eligible'
}) {
  return {
    desktopApprovalId: 'capability-approval-fixture',
    remoteApprovalId: 'rap_abcdefghijkl',
    projectionId: TEST_IDS.projectionId,
    runtimeId: 'codex',
    threadId: 'fixed-thread-1',
    turnId: 'runtime-turn-fixture',
    capabilityRequestId: 'capability-request-fixture',
    safeSummary: '安全摘要',
    effect: 'workspace-write' as const,
    remoteEligible: true,
    expiresAt: '2026-08-15T00:05:00.000Z',
    decisionId: 'decision-fixture',
    decision: 'allow_once' as const,
    ...overrides,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP
  }
}

async function approvalStore(): Promise<CollaborationLocalStore> {
  const store = new CollaborationLocalStore(new MemoryBackend({
    schemaVersion: 3,
    revision: 1,
    lastInboxSequence: 0,
    endpoints: [],
    endpointLocators: [],
    agents: [agentNodeFixture],
    projections: [localProjectionFromRemote(remoteSessionProjectionFixture, {
      runtimeId: 'codex',
      threadId: 'fixed-thread-1',
      bindingMode: 'existing'
    })],
    projects: [],
    tasks: [],
    taskRuns: [],
    queue: [],
    receipts: [],
    outbox: [],
    diagnostics: [],
    remoteApprovals: []
  }))
  await store.open()
  return store
}

class MemoryBackend implements CollaborationStateBackend {
  constructor(private value: unknown) {}
  async read(): Promise<unknown> { return structuredClone(this.value) }
  async write(value: CollaborationLocalState): Promise<void> { this.value = structuredClone(value) }
}
