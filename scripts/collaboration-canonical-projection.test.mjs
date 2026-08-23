import assert from 'node:assert/strict'
import test from 'node:test'

import {
  TEST_IDS,
  TEST_TIMESTAMP,
  agentInboxMessageFixture,
  agentNodeFixture,
  remoteSessionProjectionFixture
} from '../packages/collaboration-contracts/src/testing.ts'
import {
  CollaborationLocalStore,
  ProjectionCoordinator,
  localProjectionFromRemote
} from '../packages/domains/collaboration/src/main.ts'
import {
  FakeAgentExecutionHost,
  FakeAgentThreadsHost,
  FakeCollaborationStateBackend,
  FakeProjectionOutbox
} from '../test-fixtures/collaboration/fake-adapters.mjs'

async function waitUntil(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.fail(`timed out waiting for ${label}`)
}

async function createProjectionRig({ projection = remoteSessionProjectionFixture } = {}) {
  const backend = new FakeCollaborationStateBackend()
  const store = new CollaborationLocalStore(backend)
  await store.open()
  await store.transact((draft) => {
    draft.agents.push(structuredClone(agentNodeFixture))
    draft.projections.push(localProjectionFromRemote(projection, {
      runtimeId: 'codex',
      threadId: `thread-${projection.projectionId}`,
      workspaceRoot: '/test-only/local-workspace',
      bindingMode: 'existing'
    }))
  })
  const agentExecution = new FakeAgentExecutionHost()
  const agentThreads = new FakeAgentThreadsHost()
  const cloudOutbox = new FakeProjectionOutbox()
  const coordinator = new ProjectionCoordinator({
    store,
    agentExecution,
    agentThreads,
    cloudOutbox,
    localAgentId: () => TEST_IDS.agentId,
    now: () => new Date(TEST_TIMESTAMP)
  })
  return { backend, store, agentExecution, agentThreads, cloudOutbox, coordinator, projection }
}

function completeExecution(rig, { index, text, threadId }) {
  const request = rig.agentExecution.requests[index - 1]
  const resolvedThreadId = threadId ?? request.threadId ?? 'fake-created-thread'
  rig.agentThreads.setTurn({
    runtimeId: request.runtimeId ?? 'fake-runtime',
    threadId: resolvedThreadId,
    turnId: `fake-turn-${index}`,
    messages: [{
      itemId: `assistant-item-${index}`,
      turnId: `fake-turn-${index}`,
      kind: 'assistant-message',
      text,
      occurredAt: TEST_TIMESTAMP
    }]
  })
  rig.agentExecution.completeNext({ text, threadId: resolvedThreadId })
}

function personalMessage({
  projection = remoteSessionProjectionFixture,
  inboxMessageId = TEST_IDS.inboxMessageId,
  sequence = 1,
  providerMessageId = 'provider-message-1',
  senderUserId = TEST_IDS.userId,
  humanEndpointId = TEST_IDS.humanEndpointId,
  text = '从手机发送的测试消息',
  recipientAgentId = TEST_IDS.agentId
} = {}) {
  return {
    ...structuredClone(agentInboxMessageFixture),
    inboxMessageId,
    sequence,
    recipientAgentId,
    payload: {
      ...structuredClone(agentInboxMessageFixture.payload),
      projectionId: projection.projectionId,
      projectionRevision: projection.revision,
      senderUserId,
      humanEndpointId,
      providerMessageId,
      text
    }
  }
}

test('10.2 canonical ProjectionCoordinator serializes one Session and deduplicates provider retry', async () => {
  const rig = await createProjectionRig()
  const firstMessage = personalMessage()
  const secondMessage = personalMessage({
    inboxMessageId: 'ibx_Inbox0000002',
    sequence: 2,
    providerMessageId: 'provider-message-2',
    text: '第二条手机消息'
  })

  const first = await rig.coordinator.acceptPersonalInbox(firstMessage)
  await waitUntil(() => rig.agentExecution.requests.length === 1, 'first runtime turn')
  const second = await rig.coordinator.acceptPersonalInbox(secondMessage)
  const secondReplay = await rig.coordinator.acceptPersonalInbox(secondMessage)
  assert.equal(first.duplicate, false)
  assert.equal(second.duplicate, false)
  assert.equal(secondReplay.duplicate, true)
  assert.equal(secondReplay.queueItemId, second.queueItemId)
  assert.equal(rig.agentExecution.requests.length, 1)
  assert.equal(rig.agentExecution.requests[0].runtimeId, 'codex')
  assert.equal(rig.agentExecution.requests[0].threadId, `thread-${rig.projection.projectionId}`)
  assert.equal(rig.agentExecution.requests[0].workspaceRoot, '/test-only/local-workspace')
  assert.equal(rig.agentExecution.requests[0].interaction, 'reviewable')
  assert.equal(rig.agentExecution.requests[0].mode, 'agent')

  completeExecution(rig, { index: 1, text: '第一条唯一回复' })
  await waitUntil(() => rig.agentExecution.requests.length === 2, 'second runtime turn')
  assert.equal(rig.agentExecution.requests[1].prompt, '第二条手机消息')
  assert.equal(rig.agentExecution.requests[1].threadId, `thread-${rig.projection.projectionId}`)
  completeExecution(rig, { index: 2, text: '第二条唯一回复' })
  await rig.coordinator.waitForIdle(rig.projection.projectionId)

  const state = rig.store.snapshot()
  const inbound = state.queue.filter((item) => item.direction === 'inbound')
  assert.deepEqual(inbound.map((item) => item.sequence), [1, 2])
  assert.ok(inbound.every((item) => item.state === 'completed'))
  assert.equal(rig.cloudOutbox.deliveries.length, 2)
  assert.deepEqual(
    rig.cloudOutbox.deliveries.map((delivery) => delivery.command.text),
    [
      '【SciForge Agent · 最终报告】\n第一条唯一回复',
      '【SciForge Agent · 最终报告】\n第二条唯一回复'
    ]
  )

  await assert.rejects(
    () => rig.coordinator.acceptPersonalInbox(personalMessage({ text: '同一远端 ID 被替换内容' })),
    /identity was reused with different content/
  )
  assert.equal(rig.agentExecution.requests.length, 2)
})

test('10.2 canonical coordinator mirrors desktop user/final messages once and filters provider self echo', async () => {
  const rig = await createProjectionRig()
  const userEvent = {
    runtimeId: 'codex',
    threadId: `thread-${rig.projection.projectionId}`,
    itemId: 'desktop-item-1',
    kind: 'user-message',
    text: '桌面发给手机的消息',
    occurredAt: TEST_TIMESTAMP
  }
  await rig.coordinator.mirrorDesktopEvent(userEvent)
  await rig.coordinator.mirrorDesktopEvent(userEvent)
  await rig.coordinator.mirrorDesktopEvent({
    ...userEvent,
    itemId: 'assistant-item-1',
    turnId: 'turn-desktop-1',
    kind: 'assistant-message',
    text: '桌面 Session 最终回复'
  })
  assert.deepEqual(
    rig.cloudOutbox.deliveries.map((delivery) => delivery.command.kind),
    ['user_message', 'assistant_final']
  )
  const outboundLocalItemIds = rig.cloudOutbox.deliveries.map((delivery) => (
    delivery.command.localItemId
  ))
  assert.ok(outboundLocalItemIds.every((localItemId) => /^lit_[A-Za-z0-9]{12,64}$/u.test(localItemId)))
  assert.equal(new Set(outboundLocalItemIds).size, 2)

  await rig.store.transact((draft) => {
    const receipt = draft.receipts.find((candidate) => (
      candidate.receiptKey === `desktop:codex:thread-${rig.projection.projectionId}:desktop-item-1`
    ))
    assert.ok(receipt)
    receipt.remoteMessageId = 'provider-self-echo'
  })
  const echo = await rig.coordinator.acceptPersonalInbox(personalMessage({
    inboxMessageId: 'ibx_InboxEcho0001',
    providerMessageId: 'provider-self-echo',
    text: '桌面发给手机的消息'
  }))
  assert.equal(echo.state, 'ignored')
  assert.equal(rig.agentExecution.requests.length, 0)
  assert.equal(rig.store.snapshot().queue.find((item) => item.queueItemId === echo.queueItemId)?.state, 'ignored')
})

test('8.3 canonical coordinator rejects wrong Agent, revision and non-allowlisted sender before runtime', async () => {
  const rig = await createProjectionRig()
  const deniedMessages = [
    personalMessage({ providerMessageId: 'provider-denied-recipient', recipientAgentId: TEST_IDS.secondAgentId }),
    personalMessage({ providerMessageId: 'provider-denied-sender', senderUserId: TEST_IDS.secondUserId })
  ]
  for (const [index, message] of deniedMessages.entries()) {
    await assert.rejects(
      () => rig.coordinator.acceptPersonalInbox(message),
      undefined,
      `permission denial case ${index + 1}`
    )
  }
  await assert.rejects(() => rig.coordinator.acceptPersonalInbox({
    ...personalMessage(),
    payload: { ...personalMessage().payload, projectionRevision: 2 }
  }))
  assert.equal(rig.agentExecution.requests.length, 0)
  assert.ok(rig.store.snapshot().diagnostics.some((entry) => entry.code === 'collaboration.recipient_mismatch'))
})

test('6.5 shared allowlist accepts B source endpoint but keeps execution on A fixed Agent and thread', async () => {
  const sharedProjection = {
    ...structuredClone(remoteSessionProjectionFixture),
    allowedSenderUserIds: [TEST_IDS.userId, TEST_IDS.secondUserId]
  }
  const rig = await createProjectionRig({ projection: sharedProjection })
  const accepted = await rig.coordinator.acceptPersonalInbox(personalMessage({
    projection: sharedProjection,
    providerMessageId: 'provider-shared-sender-b',
    senderUserId: TEST_IDS.secondUserId,
    humanEndpointId: 'hep_Endp00000002',
    text: 'B 在 A 显式共享的 Session 发言'
  }))
  assert.equal(accepted.duplicate, false)
  await waitUntil(() => rig.agentExecution.requests.length === 1, 'shared Session runtime turn')
  assert.equal(rig.agentExecution.requests[0].threadId, `thread-${sharedProjection.projectionId}`)
  assert.equal(rig.store.snapshot().queue[0].senderUserId, TEST_IDS.secondUserId)
  assert.equal(rig.store.snapshot().queue[0].senderHumanEndpointId, 'hep_Endp00000002')
  completeExecution(rig, { index: 1, text: 'A 的 Agent 对共享消息的回复' })
  await rig.coordinator.waitForIdle(sharedProjection.projectionId)
})

test('10.2 canonical store recovers queued/reconciling work with the stable directive and fixed thread', async () => {
  const rig = await createProjectionRig()
  rig.coordinator.stop()
  const accepted = await rig.coordinator.acceptPersonalInbox(personalMessage({
    providerMessageId: 'provider-recovery-message',
    text: '重启恢复消息'
  }))
  let stableDirective
  await rig.store.transact((draft) => {
    const item = draft.queue.find((candidate) => candidate.queueItemId === accepted.queueItemId)
    assert.ok(item)
    item.state = 'executing'
    item.attempts = 1
    stableDirective = item.clientDirectiveId
    const receipt = draft.receipts.find((candidate) => candidate.queueItemId === accepted.queueItemId)
    assert.ok(receipt)
    receipt.status = 'processing'
    receipt.attempts = 1
  })

  const reopenedStore = new CollaborationLocalStore(rig.backend)
  await reopenedStore.open()
  assert.equal(
    reopenedStore.snapshot().queue.find((item) => item.queueItemId === accepted.queueItemId)?.state,
    'reconciling'
  )
  const recoveredExecution = new FakeAgentExecutionHost()
  const recoveredThreads = new FakeAgentThreadsHost()
  const recoveredOutbox = new FakeProjectionOutbox()
  const recoveredCoordinator = new ProjectionCoordinator({
    store: reopenedStore,
    agentExecution: recoveredExecution,
    agentThreads: recoveredThreads,
    cloudOutbox: recoveredOutbox,
    localAgentId: () => TEST_IDS.agentId,
    now: () => new Date(TEST_TIMESTAMP)
  })
  await recoveredCoordinator.recover()
  await waitUntil(() => recoveredExecution.requests.length === 1, 'recovered runtime turn')
  assert.equal(recoveredExecution.requests[0].clientDirectiveId, stableDirective)
  assert.equal(recoveredExecution.requests[0].threadId, `thread-${rig.projection.projectionId}`)
  recoveredThreads.setTurn({
    runtimeId: 'codex',
    threadId: `thread-${rig.projection.projectionId}`,
    turnId: 'fake-turn-1',
    messages: [{
      itemId: 'assistant-item-recovered',
      turnId: 'fake-turn-1',
      kind: 'assistant-message',
      text: '恢复后的唯一回复',
      occurredAt: TEST_TIMESTAMP
    }]
  })
  recoveredExecution.completeNext({ text: '恢复后的唯一回复' })
  await recoveredCoordinator.waitForIdle(rig.projection.projectionId)
  const final = reopenedStore.snapshot()
  assert.equal(final.queue.find((item) => item.queueItemId === accepted.queueItemId)?.attempts, 2)
  assert.equal(recoveredOutbox.deliveries.length, 1)
  assert.equal(
    recoveredOutbox.deliveries[0].command.text,
    '【SciForge Agent · 最终报告】\n恢复后的唯一回复'
  )
})

test('10.2 different canonical projections can execute concurrently without retargeting either Session', async () => {
  const secondProjection = {
    ...structuredClone(remoteSessionProjectionFixture),
    projectionId: 'rsp_Proj00000002',
    displayName: '第二个中文 Session',
    locator: {
      ...structuredClone(remoteSessionProjectionFixture.locator),
      topicId: 'topic-stable-200',
      topicDisplayName: '第二个中文 Session'
    }
  }
  const rig = await createProjectionRig()
  await rig.store.transact((draft) => {
    draft.projections.push(localProjectionFromRemote(secondProjection, {
      runtimeId: 'codex',
      threadId: `thread-${secondProjection.projectionId}`,
      bindingMode: 'existing'
    }))
  })
  await Promise.all([
    rig.coordinator.acceptPersonalInbox(personalMessage({ text: '投影一消息' })),
    rig.coordinator.acceptPersonalInbox(personalMessage({
      projection: secondProjection,
      inboxMessageId: 'ibx_Inbox0000002',
      providerMessageId: 'provider-message-second-projection',
      text: '投影二消息'
    }))
  ])
  await waitUntil(() => rig.agentExecution.requests.length === 2, 'parallel projection turns')
  assert.deepEqual(
    new Set(rig.agentExecution.requests.map((request) => request.threadId)),
    new Set([`thread-${rig.projection.projectionId}`, `thread-${secondProjection.projectionId}`])
  )
  const firstThread = rig.agentExecution.requests[0].threadId
  const secondThread = rig.agentExecution.requests[1].threadId
  completeExecution(rig, { index: 1, text: '投影一回复', threadId: firstThread })
  completeExecution(rig, { index: 2, text: '投影二回复', threadId: secondThread })
  await rig.coordinator.waitForIdle()
})
