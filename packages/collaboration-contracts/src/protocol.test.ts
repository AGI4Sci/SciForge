import { describe, expect, it } from 'vitest'
import {
  decodePairingBindCode,
  encodePairingBindCode,
  capabilityInputSchema,
  capabilityOutputSchema,
  agentInboxPayloadSchema,
  humanAnswerCommandSchema,
  inboxMessageSchema,
  projectTransferCoordinatorCommandSchema,
  receiptSchema,
  restRequestSchema,
  restResponseSchema,
  webSocketMessageSchema
} from './protocol.js'
import {
  humanEndpointProviderContractSchema,
  providerDiagnosticSchema,
  providerDirectRecipientSchema,
  providerEventSchema,
  providerLocatorListRequestSchema,
  providerManagedContainerRequestSchema,
  providerManagedContainerResultSchema,
  providerSendRequestSchema
} from './provider.js'
import {
  REDACTED_VALUE,
  redactedJsonSchema
} from './core.js'
import {
  TEST_IDS,
  TEST_TIMESTAMP,
  agentEnsuredResponseFixture,
  agentInboxMessageFixture,
  chineseProviderLocatorFixture,
  collaborationFixtures,
  invalidTestOnlyValue,
  providerIdentityFixture,
  providerEventFixture,
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

  it('publishes one exact Owner-only Project recovery abandon command', () => {
    expect(restRequestSchema.parse({
      protocolVersion: '1.0',
      type: 'project.content.recovery.abandon',
      requestId: TEST_IDS.requestId,
      idempotencyKey: 'idem_project_recovery_abandon_01',
      projectId: TEST_IDS.projectId,
      provisioningIntentId: TEST_IDS.provisioningIntentId,
      recoveryActionId: TEST_IDS.recoveryActionId,
      journalEntryId: TEST_IDS.contentRecoveryJournalEntryId,
      expectedProjectRevision: 3,
      expectedProvisioningRevision: 2,
      expectedProvisioningIntentRevision: 4,
      expectedRecoveryActionRevision: 1,
      expectedJournalRevision: 3,
      reason: 'The Owner has chosen to stop this exact provisioning attempt.'
    }).type).toBe('project.content.recovery.abandon')
  })

  it('links Task recovery only from one exact Content Space observation', () => {
    const rootLocator = {
      contractVersion: 1 as const,
      kind: 'content-space.container-reference' as const,
      authority: 'opencontent.run0',
      identity: { containerId: 'project-recovery-root' }
    }
    const locator = {
      contractVersion: 1 as const,
      kind: 'content-space.file-reference' as const,
      authority: rootLocator.authority,
      identity: { fileId: 'observed-recovery-output' }
    }
    const observation = {
      schemaVersion: 1 as const,
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      assignmentTaskRevision: 4,
      bindingRevision: 2,
      logicalInvocationId: `upload.${TEST_IDS.executionId}.output`,
      requestDigest: '1'.repeat(64),
      rootLocator,
      rootLocatorDigest: '2'.repeat(64),
      expectedName: 'meeting-minutes.recovery-1.md',
      locator,
      locatorDigest: '3'.repeat(64),
      contentObservationReceiptDigest: '4'.repeat(64),
      observationDigest: '5'.repeat(64),
      providerObservationDigest: '6'.repeat(64),
      observedAt: TEST_TIMESTAMP
    }
    const command = {
      protocolVersion: '1.0' as const,
      type: 'task.recovery.link_observed_output' as const,
      requestId: TEST_IDS.requestId,
      idempotencyKey: 'idem_task_recovery_link_observed_01',
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      recoveryActionId: TEST_IDS.recoveryActionId,
      journalEntryId: TEST_IDS.contentRecoveryJournalEntryId,
      expectedTaskRevision: 5,
      expectedExecutionRevision: 6,
      expectedRecoveryActionRevision: 1,
      expectedCoordinatorAuthorityEpoch: 2,
      observation
    }

    expect(restRequestSchema.parse(command)).toEqual(command)
    expect(restRequestSchema.safeParse({
      ...command,
      observation: undefined,
      output: {
        executionId: TEST_IDS.executionId,
        assignmentTaskRevision: 4,
        locator,
        locatorDigest: '3'.repeat(64),
        rootLocatorDigest: '2'.repeat(64),
        bindingRevision: 2,
        transferReceiptDigest: '4'.repeat(64),
        observationDigest: '5'.repeat(64),
        preflightObservationDigest: '6'.repeat(64)
      },
      humanObservationDigest: '5'.repeat(64)
    }).success).toBe(false)
    expect(restRequestSchema.safeParse({
      ...command,
      type: 'task.recovery.mark_success'
    }).success).toBe(false)
  })

  it('delivers exact linked-output and abandonment recovery facts to the Worker Inbox', () => {
    const output = {
      executionId: TEST_IDS.executionId,
      assignmentTaskRevision: 4,
      locator: {
        contractVersion: 1 as const,
        kind: 'content-space.file-reference' as const,
        authority: 'opencontent.run0',
        identity: { fileId: 'observed-recovery-output' }
      },
      locatorDigest: '3'.repeat(64),
      rootLocatorDigest: '2'.repeat(64),
      bindingRevision: 2,
      transferReceiptDigest: '4'.repeat(64),
      observationDigest: '5'.repeat(64),
      preflightObservationDigest: '6'.repeat(64)
    }
    const linked = {
      protocolVersion: '1.0' as const,
      type: 'task.recovery.output_linked' as const,
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      recoveryActionId: TEST_IDS.recoveryActionId,
      journalEntryId: TEST_IDS.contentRecoveryJournalEntryId,
      logicalInvocationId: `upload.${TEST_IDS.executionId}.output`,
      resourceRefId: TEST_IDS.resourceRefId,
      taskRevision: 5,
      executionRevision: 6,
      journalRevision: 4,
      output
    }
    const abandoned = {
      protocolVersion: '1.0' as const,
      type: 'task.recovery.abandoned' as const,
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      recoveryActionId: TEST_IDS.recoveryActionId,
      taskRevision: 6,
      executionRevision: 7,
      reason: 'The exact observed output was absent; retry under a new execution and name.'
    }

    expect(agentInboxPayloadSchema.parse(linked)).toEqual(linked)
    expect(agentInboxPayloadSchema.parse(abandoned)).toEqual(abandoned)
    expect(agentInboxPayloadSchema.safeParse({
      ...linked,
      output: undefined,
      markSuccess: true
    }).success).toBe(false)
  })

  it('exports named strict Owner workflow commands without caller-authored identity fields', () => {
    const transfer = {
      protocolVersion: '1.0',
      type: 'project.transfer_coordinator',
      requestId: TEST_IDS.requestId,
      idempotencyKey: 'idem_transfer_coord_001',
      projectId: TEST_IDS.projectId,
      expectedRevision: 4,
      expectedCoordinatorAuthorityEpoch: 4,
      coordinatorAgentId: TEST_IDS.secondAgentId,
      expectedCoordinatorAvailabilityRevision: 7
    } as const
    const answer = {
      protocolVersion: '1.0',
      type: 'human.answer',
      requestId: TEST_IDS.requestId,
      idempotencyKey: 'idem_human_answer_001',
      humanRequestId: TEST_IDS.humanRequestId,
      requestRevision: 1,
      answer: 'Use the exact current Project evidence.'
    } as const

    expect(projectTransferCoordinatorCommandSchema.parse(transfer)).toEqual(transfer)
    expect(humanAnswerCommandSchema.parse(answer)).toEqual(answer)
    expect(projectTransferCoordinatorCommandSchema.safeParse({
      ...transfer,
      ownerUserId: TEST_IDS.userId
    }).success).toBe(false)
    expect(humanAnswerCommandSchema.safeParse({
      ...answer,
      answeredByUserId: TEST_IDS.userId
    }).success).toBe(false)
  })

  it('reserves Project completion for the atomic final-summary command', () => {
    const transition = {
      protocolVersion: '1.0',
      type: 'project.transition',
      requestId: TEST_IDS.requestId,
      idempotencyKey: 'idem_project_transition_001',
      projectId: TEST_IDS.projectId,
      expectedRevision: 4,
      expectedCoordinatorAuthorityEpoch: 2,
      expectedExecutionAuthorityEpoch: 3
    } as const

    expect(restRequestSchema.safeParse({ ...transition, status: 'cancelled' }).success).toBe(true)
    expect(restRequestSchema.safeParse({ ...transition, status: 'completed' }).success).toBe(false)
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
  it('defines a strict provider-neutral managed private container contract', () => {
    const policy = {
      version: 1 as const,
      visibility: 'private' as const,
      history: 'protected' as const,
      membership: 'owner_and_message_bot' as const,
      memberManagement: 'provisioning_service_only' as const,
      channelManagement: 'provisioning_service_only' as const,
      ownerCanSend: true as const,
      ownerCanCreateTopics: true as const,
      messageBotCanSend: true as const,
      messageBotCreatesProjectTopics: false as const
    }
    expect(providerManagedContainerRequestSchema.parse({
      protocolVersion: '1.0',
      type: 'provider.managed_container.ensure',
      realmId: 'realm-hong-kong',
      ownerIdentity: providerIdentityFixture,
      stableKey: 'managed-owner-realm',
      displayName: 'sciforge-user123',
      policy
    }).type).toBe('provider.managed_container.ensure')
    expect(restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: 'req_ManagedInspect001',
      type: 'managed_container.inspect',
      idempotencyKey: 'idem_managed_inspect_01',
      managedContainerId: 'mco_123456789012',
      agentId: 'agt_123456789012',
      expectedRevision: 2
    }).type).toBe('managed_container.inspect')
    expect(providerManagedContainerResultSchema.parse({
      protocolVersion: '1.0',
      type: 'provider.managed_container.result',
      container: { type: 'provider_managed_container_ref', provider: providerIdentityFixture.provider,
        realmId: providerIdentityFixture.realmId, containerId: '123' },
      displayName: 'sciforge-user123', status: 'active', policyVersion: 1,
      checks: { private: true, protectedHistory: true, exactMembership: true, ownerCanSend: true,
        messageBotCanSend: true, ownerCanCreateTopics: true, memberManagementRestricted: true,
        channelManagementRestricted: true },
      safeIssueCodes: [], observedAt: TEST_TIMESTAMP
    }).status).toBe('active')
    expect(providerLocatorListRequestSchema.parse({
      protocolVersion: '1.0',
      type: 'provider.locator.list',
      realmId: providerIdentityFixture.realmId,
      container: {
        type: 'provider_managed_container_ref',
        provider: providerIdentityFixture.provider,
        realmId: providerIdentityFixture.realmId,
        containerId: '123'
      },
      containerDisplayName: 'sciforge-user123',
      limit: 50
    }).container?.containerId).toBe('123')
    expect(providerLocatorListRequestSchema.safeParse({
      protocolVersion: '1.0', type: 'provider.locator.list',
      realmId: providerIdentityFixture.realmId, limit: 50
    }).success).toBe(true)
    expect(providerManagedContainerRequestSchema.safeParse({
      protocolVersion: '1.0', type: 'provider.managed_container.ensure', realmId: 'realm-hong-kong',
      ownerIdentity: providerIdentityFixture, stableKey: 'managed-owner-realm', displayName: 'sciforge-user123',
      policy: { ...policy, visibility: 'public' }
    }).success).toBe(false)
  })
  it('binds an endpoint challenge to the authenticated User and exact provider identity', () => {
    const request = restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: TEST_IDS.requestId,
      type: 'endpoint.challenge.create',
      idempotencyKey: 'idem_pairing_begin_0001',
      expectedIdentity: { provider: 'example-im', realmId: 'realm-hong-kong', providerUserId: 'provider-user-01' }
    })
    expect(request).not.toHaveProperty('userId')
    expect(request).not.toHaveProperty('bootstrapToken')
  })

  it('returns only a challenge code and never a polling or User credential', () => {
    expect(restResponseSchema.safeParse({
      protocolVersion: '1.0',
      requestId: TEST_IDS.requestId,
      type: 'endpoint.challenge.created',
      challengeId: TEST_IDS.challengeId,
      challengeCode: invalidTestOnlyValue('CODE'),
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
    expect(restRequestSchema.safeParse({ ...base, kind: 'assistant_progress' }).success).toBe(true)
    expect(restRequestSchema.safeParse({ ...base, kind: 'assistant_final', localTurnId: TEST_IDS.turnId }).success).toBe(true)
    expect(restRequestSchema.safeParse({ ...base, kind: 'stream_delta' }).success).toBe(false)
  })

  it('ensures a Device-owned Agent without accepting a renderer display name', () => {
    expect(restRequestSchema.safeParse({
      protocolVersion: '1.0',
      requestId: TEST_IDS.requestId,
      type: 'agent.ensure',
      idempotencyKey: 'idem_agent_ensure_01',
      deviceId: TEST_IDS.deviceId,
      capabilities: ['agent.execute'],
      credentialBootstrapPublicKey: { kty: 'OKP', crv: 'X25519',
        x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }
    }).success).toBe(true)
    expect(restRequestSchema.safeParse({
      protocolVersion: '1.0',
      requestId: TEST_IDS.requestId,
      type: 'agent.ensure',
      idempotencyKey: 'idem_agent_ensure_02',
      deviceId: TEST_IDS.deviceId,
      displayName: 'Renderer-controlled name',
      capabilities: ['agent.execute'],
      credentialBootstrapPublicKey: { kty: 'OKP', crv: 'X25519',
        x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }
    }).success).toBe(false)
    expect(restResponseSchema.safeParse(agentEnsuredResponseFixture).success).toBe(true)
    expect(restResponseSchema.safeParse({
      ...agentEnsuredResponseFixture,
      sealedCredential: undefined
    }).success).toBe(true)
    expect(JSON.stringify(agentEnsuredResponseFixture)).not.toMatch(/deviceCredential|userCredential|privateKey/u)
  })
})

describe('provider-neutral contract', () => {
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
    expect(providerEventSchema.safeParse({
      protocolVersion: '1.0',
      type: 'provider.human_answer.candidate',
      provider: 'example-im',
      eventId: 'provider-event-answer-1',
      eventCursor: 'cursor-3',
      occurredAt: TEST_TIMESTAMP,
      identity: providerIdentityFixture,
      locator: chineseProviderLocatorFixture,
      providerMessageId: 'provider-message-answer-1',
      humanRequestId: TEST_IDS.humanRequestId,
      requestRevision: 2,
      answer: '采用已确认的冻结边界。'
    }).success).toBe(true)
    expect(providerEventSchema.safeParse({
      protocolVersion: '1.0',
      type: 'provider.human_answer.candidate',
      provider: 'example-im',
      eventId: 'provider-event-answer-2',
      eventCursor: 'cursor-4',
      occurredAt: TEST_TIMESTAMP,
      locator: chineseProviderLocatorFixture,
      providerMessageId: 'provider-message-answer-2',
      humanRequestId: TEST_IDS.humanRequestId,
      requestRevision: 2,
      answer: '不得接受缺少 Provider identity 的文本。'
    }).success).toBe(false)
  })

  it('uses provider-neutral send requests without a provider ID branch', () => {
    expect(providerSendRequestSchema.safeParse({
      protocolVersion: '1.0',
      type: 'provider.send.message',
      locator: chineseProviderLocatorFixture,
      clientMessageId: 'client-message-1',
      text: '中间进展',
      presentation: { disposition: 'collapsible', summary: '中间进展' }
    }).success).toBe(true)
    const directRecipient = providerDirectRecipientSchema.parse({
      type: 'provider_direct_recipient',
      provider: 'example-im',
      realmId: 'realm-1',
      providerUserId: 'user-42'
    })
    expect(providerSendRequestSchema.parse({
      protocolVersion: '1.0',
      type: 'provider.send.message',
      recipient: directRecipient,
      clientMessageId: 'client-message-direct-1',
      text: '绑定成功'
    })).toEqual(expect.objectContaining({ recipient: directRecipient }))
    expect(providerDirectRecipientSchema.safeParse({
      type: 'provider_direct_recipient',
      provider: 'example-im',
      realmId: 'realm-1',
      providerUserId: ''
    }).success).toBe(false)
  })

  it('keeps remote approval message actions provider-neutral and exact-message scoped', () => {
    const event = {
      protocolVersion: '1.0',
      provider: 'example-im',
      type: 'provider.message.action',
      eventId: 'provider-event-action-1',
      eventCursor: 'cursor-action-1',
      occurredAt: TEST_TIMESTAMP,
      identity: providerIdentityFixture,
      providerMessageId: 'provider-card-31415',
      operation: 'add',
      action: 'allow_once'
    }
    expect(providerEventSchema.parse(event)).toEqual(event)
    expect(providerEventSchema.safeParse({ ...event, emojiCode: '1f44d' }).success).toBe(false)
    expect(providerEventSchema.safeParse({ ...event, providerMessageId: '' }).success).toBe(false)
    expect(providerSendRequestSchema.parse({
      protocolVersion: '1.0',
      type: 'provider.ensure.message_action',
      locator: chineseProviderLocatorFixture,
      providerMessageId: 'provider-card-31415',
      clientMessageId: 'client-action-allow',
      action: 'allow_once'
    })).toEqual(expect.objectContaining({ action: 'allow_once' }))
  })

  it('round-trips the strict versioned SF1 bind code', () => {
    const challengeId = `chl_${'a'.repeat(32)}`
    const challengeCode = 'Abc_123-xYz0'
    const code = encodePairingBindCode({ challengeId, challengeCode })
    expect(code).toBe(`SF1.${'a'.repeat(32)}.${challengeCode}`)
    expect(decodePairingBindCode(code)).toEqual({ challengeId, challengeResponse: challengeCode })
    expect(() => decodePairingBindCode(`SF2.${'a'.repeat(32)}.${challengeCode}`)).toThrow()
  })

  it('requires contract capabilities and strictly redacted diagnostics', () => {
    const contract = {
      protocolVersion: '1.0',
      type: 'human_endpoint_provider_contract' as const,
      provider: 'example-im',
      displayName: 'Example IM',
      capabilities: {
        textMessages: true,
        stableLocators: true,
        eventCursor: true,
        locatorRename: true,
        locatorMove: true,
        locatorDiscovery: true,
        identityChallenge: true,
        directMessages: true,
        managedContainers: false,
        privateContainerDiscovery: true,
        messageActions: true
      },
      onboarding: {
        realmLabel: '组织',
        accountLabel: '用户',
        containerLabel: '频道',
        topicLabel: '话题'
      },
      limits: { maxTextLength: 10_000, maxLocatorDisplayLength: 200 }
    }
    const parsedContract = humanEndpointProviderContractSchema.parse(contract)
    expect(parsedContract.capabilities.privateContainerDiscovery).toBe(true)
    expect(parsedContract.capabilities.messageActions).toBe(true)
    const {
      managedContainers: _managedContainers,
      privateContainerDiscovery: _privateContainerDiscovery,
      messageActions: _messageActions,
      ...legacyCapabilities
    } = contract.capabilities
    const legacyContract = humanEndpointProviderContractSchema.parse({
      ...contract,
      capabilities: legacyCapabilities
    })
    expect(legacyContract.capabilities.managedContainers).toBeUndefined()
    expect(legacyContract.capabilities.privateContainerDiscovery).toBeUndefined()
    expect(legacyContract.capabilities.messageActions).toBeUndefined()
    expect(humanEndpointProviderContractSchema.safeParse({
      ...contract,
      capabilities: { ...contract.capabilities, directMessages: false }
    }).success).toBe(false)
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
