import { describe, expect, it } from 'vitest'
import {
  capabilityInputSchema,
  capabilityOutputSchema,
  agentInboxPayloadSchema,
  inboxMessageSchema,
  receiptSchema,
  restRequestSchema,
  restResponseSchema,
  webSocketMessageSchema
} from './protocol.js'
import {
  humanEndpointProviderContractSchema,
  providerDiagnosticSchema,
  providerEventSchema,
  providerSendRequestSchema
} from './provider.js'
import {
  REDACTED_VALUE,
  redactedJsonSchema,
  redactCredentials
} from './core.js'
import {
  TEST_IDS,
  TEST_TIMESTAMP,
  agentOwnerTransferredResponseFixture,
  agentInboxMessageFixture,
  chineseProviderLocatorFixture,
  collaborationFixtures,
  invalidTestOnlyValue,
  providerIdentityFixture,
  providerEventFixture,
  providerHumanAnswerEventFixture,
  projectionUpdatedPayloadFixture,
  remoteSessionProjectionFixture,
  restRequestFixture,
  taskFixture,
  webSocketMessageFixture
} from './testing.js'

describe('discriminated transport unions', () => {
  it('accepts shared REST, WebSocket, provider event, inbox, and receipt fixtures', () => {
    expect(restRequestSchema.parse(restRequestFixture).type).toBe('project.get')
    expect(webSocketMessageSchema.parse(webSocketMessageFixture).type).toBe('inbox.available')
    expect(providerEventSchema.parse(providerEventFixture).type).toBe('provider.message.created')
    expect(inboxMessageSchema.parse(agentInboxMessageFixture).recipientType).toBe('agent')
    expect(receiptSchema.parse(collaborationFixtures.operationReceipt).type).toBe('operation.receipt')
  })

  it('rejects unknown discriminators and unknown fields in every protocol family', () => {
    expect(restRequestSchema.safeParse({ ...restRequestFixture, type: 'project.guess' }).success).toBe(false)
    expect(webSocketMessageSchema.safeParse({ ...webSocketMessageFixture, fullPayload: {} }).success).toBe(false)
    expect(providerEventSchema.safeParse({ ...providerEventFixture, accessToken: invalidTestOnlyValue('VALUE') }).success).toBe(false)
    expect(inboxMessageSchema.safeParse({ ...agentInboxMessageFixture, recipientUserId: TEST_IDS.userId }).success).toBe(false)
  })

  it('rejects nested unknown fields instead of silently stripping them', () => {
    expect(providerEventSchema.safeParse({
      ...providerEventFixture,
      locator: { ...chineseProviderLocatorFixture, workspaceId: 'guessed-target' }
    }).success).toBe(false)
    expect(inboxMessageSchema.safeParse({
      ...agentInboxMessageFixture,
      payload: { ...agentInboxMessageFixture.payload, runtimeId: 'wrong-layer' }
    }).success).toBe(false)
  })

  it('orders locator refresh before later personal messages without exposing the locator', () => {
    expect(agentInboxPayloadSchema.parse(projectionUpdatedPayloadFixture)).toEqual({
      protocolVersion: '1.0',
      type: 'projection.updated',
      projectionId: TEST_IDS.projectionId,
      revision: 2
    })
    expect(agentInboxPayloadSchema.safeParse({
      ...projectionUpdatedPayloadFixture,
      locator: chineseProviderLocatorFixture
    }).success).toBe(false)
  })
})

describe('canonical pairing and bidirectional Session commands', () => {
  it('supports unauthenticated pairing begin without bootstrap identity', () => {
    const request = restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: TEST_IDS.requestId,
      type: 'pairing.begin',
      idempotencyKey: 'idem_pairing_begin_0001',
      provider: 'example-im',
      realmId: 'realm-hong-kong',
      requestedDisplayName: '测试用户'
    })
    expect(request).not.toHaveProperty('userId')
    expect(request).not.toHaveProperty('bootstrapToken')
  })

  it('models one-time pairing material only in dedicated wire variants', () => {
    expect(restResponseSchema.safeParse({
      protocolVersion: '1.0',
      requestId: TEST_IDS.requestId,
      type: 'pairing.begun',
      challengeId: TEST_IDS.challengeId,
      challengeCode: invalidTestOnlyValue('CODE'),
      pollSecret: invalidTestOnlyValue('POLL_VALUE').padEnd(40, '0'),
      expiresAt: TEST_TIMESTAMP
    }).success).toBe(true)
    expect(JSON.stringify(collaborationFixtures)).not.toContain('pollSecret')
    expect(JSON.stringify(collaborationFixtures)).not.toContain('userCredential')
  })

  it('uses one publish command for desktop user mirrors and final assistant replies', () => {
    const base = {
      protocolVersion: '1.0',
      requestId: TEST_IDS.requestId,
      type: 'projection.message.publish',
      idempotencyKey: 'idem_projection_publish_01',
      projectionId: TEST_IDS.projectionId,
      projectionRevision: 1,
      localItemId: TEST_IDS.localItemId,
      text: '同步消息',
      occurredAt: TEST_TIMESTAMP
    }
    expect(restRequestSchema.safeParse({ ...base, kind: 'user_message' }).success).toBe(true)
    expect(restRequestSchema.safeParse({ ...base, kind: 'assistant_final', localTurnId: TEST_IDS.turnId }).success).toBe(true)
    expect(restRequestSchema.safeParse({ ...base, kind: 'stream_delta' }).success).toBe(false)
  })

  it('transfers Agent ownership with optimistic concurrency and a one-time rotated credential', () => {
    expect(restRequestSchema.safeParse({
      protocolVersion: '1.0',
      requestId: TEST_IDS.requestId,
      type: 'agent.owner.transfer',
      idempotencyKey: 'idem_agent_owner_transfer_01',
      agentId: TEST_IDS.agentId,
      targetUserId: TEST_IDS.secondUserId,
      expectedRevision: 1
    }).success).toBe(true)
    expect(restResponseSchema.safeParse(agentOwnerTransferredResponseFixture).success).toBe(true)
    const sanitized = JSON.stringify(redactCredentials(agentOwnerTransferredResponseFixture))
    expect(sanitized).not.toContain(['INVALID', 'TEST', 'ONLY'].join('_'))
  })
})

describe('provider-neutral contract', () => {
  it('normalizes a bounded HumanAnswer with its verified source locator and no guessed target identity', () => {
    expect(providerEventSchema.parse(providerHumanAnswerEventFixture)).toMatchObject({
      type: 'provider.human_answer.responded',
      humanRequestId: TEST_IDS.humanRequestId,
      requestRevision: 1
    })
    expect(providerEventSchema.safeParse({
      ...providerHumanAnswerEventFixture,
      locator: undefined
    }).success).toBe(false)
    expect(providerEventSchema.safeParse({
      ...providerHumanAnswerEventFixture,
      targetUserId: TEST_IDS.secondUserId
    }).success).toBe(false)
    expect(providerEventSchema.safeParse({
      ...providerHumanAnswerEventFixture,
      answer: ''
    }).success).toBe(false)
  })

  it('accepts stable Chinese locators and append-only unsupported provider events', () => {
    expect(chineseProviderLocatorFixture.topicDisplayName).toBe('蛋白质结构分析（上海样本）')
    expect(providerEventSchema.safeParse({
      protocolVersion: '1.0',
      type: 'provider.message.edited',
      provider: 'example-im',
      eventId: 'provider-event-edit-1',
      eventCursor: 'cursor-2',
      occurredAt: TEST_TIMESTAMP,
      identity: providerIdentityFixture,
      locator: chineseProviderLocatorFixture,
      providerMessageId: 'provider-message-1',
      replacementText: '更正内容'
    }).success).toBe(true)
  })

  it('uses provider-neutral send requests without a provider ID branch', () => {
    expect(providerSendRequestSchema.safeParse({
      protocolVersion: '1.0',
      type: 'provider.send.message',
      locator: chineseProviderLocatorFixture,
      clientMessageId: 'client-message-1',
      text: '最终回复'
    }).success).toBe(true)
  })

  it('requires contract capabilities and strictly redacted diagnostics', () => {
    expect(humanEndpointProviderContractSchema.safeParse({
      protocolVersion: '1.0',
      type: 'human_endpoint_provider_contract',
      provider: 'example-im',
      displayName: 'Example IM',
      capabilities: {
        textMessages: true,
        stableLocators: true,
        eventCursor: true,
        locatorRename: true,
        locatorMove: true,
        locatorDiscovery: true,
        identityChallenge: true
      },
      onboarding: {
        realmLabel: '组织',
        accountLabel: '用户',
        containerLabel: '频道',
        topicLabel: '话题'
      },
      limits: { maxTextLength: 10_000, maxLocatorDisplayLength: 200 }
    }).success).toBe(true)
    expect(providerDiagnosticSchema.safeParse({
      protocolVersion: '1.0',
      type: 'provider.diagnostic',
      provider: 'example-im',
      status: 'degraded',
      checkedAt: TEST_TIMESTAMP,
      safeSummary: 'Connection unavailable.',
      details: { deviceToken: invalidTestOnlyValue('VALUE') }
    }).success).toBe(false)
    expect(redactedJsonSchema.safeParse({ deviceToken: REDACTED_VALUE }).success).toBe(true)
  })
})

describe('capability contracts', () => {
  it('strictly validates the canonical personal and Task execution inputs', () => {
    expect(capabilityInputSchema.safeParse({
      protocolVersion: '1.0',
      type: 'collaboration.task.execute',
      task: taskFixture
    }).success).toBe(true)
    expect(capabilityInputSchema.safeParse({
      protocolVersion: '1.0',
      type: 'collaboration.personal.execute',
      projectionId: TEST_IDS.projectionId,
      projectionRevision: 1,
      runtimeId: 'runtime-local',
      threadId: 'thread-local',
      projection: remoteSessionProjectionFixture
    }).success).toBe(false)
  })

  it('does not synthesize mobile approval in execution output', () => {
    expect(capabilityOutputSchema.safeParse({
      protocolVersion: '1.0',
      type: 'collaboration.execution.needs_approval',
      localTurnId: TEST_IDS.turnId,
      approvalId: 'approval-1',
      requiresDesktop: true,
      safeSummary: 'Desktop approval is required.'
    }).success).toBe(true)
    expect(capabilityOutputSchema.safeParse({
      protocolVersion: '1.0',
      type: 'collaboration.execution.needs_approval',
      localTurnId: TEST_IDS.turnId,
      approvalId: 'approval-1',
      requiresDesktop: true,
      safeSummary: 'Desktop approval is required.',
      approvedByPhone: true
    }).success).toBe(false)
  })
})
