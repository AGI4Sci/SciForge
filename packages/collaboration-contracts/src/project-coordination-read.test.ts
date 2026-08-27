import { describe, expect, it } from 'vitest'

import { restRequestSchema, restResponseSchema } from './protocol.js'
import {
  PROJECT_COORDINATION_COLLECTION_STABLE_ORDER,
  PROJECT_COORDINATION_MAX_PAGE_SIZE,
  PROJECT_LIST_STABLE_ORDER,
  canUserReadProjectCoordination
} from './project-coordination-read.js'
import {
  TEST_HASH,
  TEST_IDS,
  TEST_LATER_TIMESTAMP,
  TEST_TIMESTAMP,
  humanNeededFixture,
  projectFixture,
  taskFixture
} from './testing.js'

describe('Project Coordinator authoritative read protocol', () => {
  const allCoordinationCollections = [
    'user_label_facts',
    'agent_label_facts',
    'memberships',
    'task_authorities',
    'worker_availability',
    'provider_principal_facts',
    'content_readiness',
    'provider_membership_observations',
    'plans',
    'tasks',
    'executions',
    'offers',
    'result_submissions',
    'review_decisions',
    'pending_human_needed',
    'provisioning_intents',
    'provisioning_attestations',
    'content_bindings',
    'external_operation_journal',
    'visible_recovery_actions',
    'project_records'
  ] as const

  it('keeps Project reads visible only to the Owner or current active/removal-pending members', () => {
    expect(canUserReadProjectCoordination(projectFixture, TEST_IDS.userId, null)).toBe(true)
    for (const state of ['active', 'membership_removal_pending'] as const) {
      expect(canUserReadProjectCoordination(projectFixture, TEST_IDS.secondUserId, {
        projectId: TEST_IDS.projectId,
        userId: TEST_IDS.secondUserId,
        state
      })).toBe(true)
    }
    for (const state of ['pending_membership', 'removed'] as const) {
      expect(canUserReadProjectCoordination(projectFixture, TEST_IDS.secondUserId, {
        projectId: TEST_IDS.projectId,
        userId: TEST_IDS.secondUserId,
        state
      })).toBe(false)
    }
    const terminalProject = { ...projectFixture, status: 'completed' as const }
    expect(canUserReadProjectCoordination(
      terminalProject,
      TEST_IDS.secondUserId,
      { projectId: TEST_IDS.projectId, userId: TEST_IDS.secondUserId, state: 'active' }
    )).toBe(true)
  })

  it('freezes one stable ID seek order and an explicit maximum for every page', () => {
    expect(PROJECT_COORDINATION_MAX_PAGE_SIZE).toBe(250)
    expect(PROJECT_LIST_STABLE_ORDER).toEqual(['projectId'])
    expect(Object.keys(PROJECT_COORDINATION_COLLECTION_STABLE_ORDER)).toEqual(allCoordinationCollections)
    expect(PROJECT_COORDINATION_COLLECTION_STABLE_ORDER.task_authorities).toEqual(['userId', 'scope'])
  })

  it('lists only the authenticated OIDC actor Projects through a bounded stable page', () => {
    const request = {
      protocolVersion: '1.0',
      requestId: TEST_IDS.requestId,
      type: 'project.list',
      limit: 25
    } as const
    expect(restRequestSchema.safeParse(request).success).toBe(true)
    expect(restRequestSchema.safeParse({ ...request, userId: TEST_IDS.userId }).success).toBe(false)

    const response = {
      protocolVersion: '1.0',
      requestId: TEST_IDS.requestId,
      type: 'rest.project_page',
      limit: 25,
      projects: [projectFixture],
      nextCursor: 'project-page-cursor-2',
      observedAt: TEST_TIMESTAMP
    } as const
    expect(restResponseSchema.safeParse(response).success).toBe(true)
    const { limit: _limit, ...unboundedResponse } = response
    expect(restResponseSchema.safeParse(unboundedResponse).success).toBe(false)
    expect(restResponseSchema.safeParse({ ...response, accessToken: 'not-a-read-fact' }).success).toBe(false)
  })

  it('requests independently bounded pages from one exact Project coordination read path', () => {
    const request = {
      protocolVersion: '1.0',
      requestId: TEST_IDS.requestId,
      type: 'project.coordination.read',
      projectId: TEST_IDS.projectId,
      collections: [
        { collection: 'memberships', limit: 100 },
        { collection: 'tasks', cursor: 'tasks-after-100', limit: 50 },
        { collection: 'pending_human_needed', limit: 25 }
      ]
    } as const
    expect(restRequestSchema.safeParse(request).success).toBe(true)
    expect(restRequestSchema.safeParse({
      ...request,
      collections: [...request.collections, { collection: 'tasks', limit: 10 }]
    }).success).toBe(false)
    expect(restRequestSchema.safeParse({ ...request, userId: TEST_IDS.userId }).success).toBe(false)
    expect(restRequestSchema.safeParse({
      ...request,
      collections: [{ collection: 'ui_grouped_workers', limit: 25 }]
    }).success).toBe(false)
  })

  it('returns flat safe label, membership, and global availability facts without per-Agent User duplication', () => {
    const userLabel = {
      schemaVersion: 1,
      type: 'project_user_label_fact',
      projectId: TEST_IDS.projectId,
      userId: TEST_IDS.userId,
      displayName: 'Project Owner',
      status: 'active',
      revision: 1,
      observedAt: TEST_TIMESTAMP
    } as const
    const agentLabel = {
      schemaVersion: 1,
      type: 'project_agent_label_fact',
      projectId: TEST_IDS.projectId,
      agentId: TEST_IDS.agentId,
      ownerUserId: TEST_IDS.userId,
      deviceId: TEST_IDS.deviceId,
      displayName: 'Owner Desktop',
      nodeType: 'desktop',
      lifecycleStatus: 'active',
      revision: 1,
      observedAt: TEST_TIMESTAMP
    } as const
    const membership = {
      schemaVersion: 1,
      type: 'project_membership',
      projectMembershipId: TEST_IDS.projectMembershipId,
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
    } as const
    const availability = {
      schemaVersion: 1,
      type: 'worker_availability_projection',
      userId: TEST_IDS.userId,
      agentId: TEST_IDS.agentId,
      deviceId: TEST_IDS.deviceId,
      agentActive: true,
      deviceActive: true,
      connectionStatus: 'online',
      lastHeartbeatAt: TEST_TIMESTAMP,
      runtimeReadiness: 'ready',
      runtimeCapabilityTags: ['runtime.text'],
      acceptsNewOffers: true,
      activeTaskCount: 0,
      observedAt: TEST_TIMESTAMP,
      expiresAt: '2026-08-15T08:05:00.000Z',
      revision: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP
    } as const
    const response = {
      protocolVersion: '1.0',
      requestId: TEST_IDS.requestId,
      type: 'rest.project_coordination',
      project: projectFixture,
      observedAt: TEST_TIMESTAMP,
      pages: [
        { collection: 'user_label_facts', limit: 100, items: [userLabel] },
        { collection: 'agent_label_facts', limit: 100, items: [agentLabel] },
        { collection: 'memberships', limit: 100, items: [membership] },
        { collection: 'worker_availability', limit: 100, items: [availability] }
      ],
      finalSummary: null
    } as const
    expect(restResponseSchema.safeParse(response).success).toBe(true)
    expect(restResponseSchema.safeParse({
      ...response,
      pages: response.pages.map((page) => page.collection === 'memberships'
        ? { ...page, items: [membership, { ...membership, projectMembershipId: 'pmb_Member000002' }] }
        : page)
    }).success).toBe(false)
    expect(restResponseSchema.safeParse({
      ...response,
      pages: response.pages.map((page) => page.collection === 'agent_label_facts'
        ? { ...page, items: [{ ...agentLabel, email: 'not-part-of-safe-label@example.invalid' }] }
        : page)
    }).success).toBe(false)
    expect(restResponseSchema.safeParse({
      ...response,
      pages: response.pages.map((page) => page.collection === 'worker_availability'
        ? { ...page, items: [{ ...availability, userId: TEST_IDS.secondUserId }] }
        : page)
    }).success).toBe(false)
    expect(restResponseSchema.safeParse({
      ...response,
      pages: response.pages.map((page) => page.collection === 'worker_availability'
        ? { ...page, items: [{ ...availability, agentId: 'agt_OrphanAgent001' }] }
        : page)
    }).success).toBe(false)
    expect(restResponseSchema.safeParse({
      ...response,
      pages: response.pages.map((page) => page.collection === 'user_label_facts'
        ? {
            ...page,
            items: [userLabel, {
              ...userLabel,
              userId: TEST_IDS.secondUserId,
              displayName: 'Unrelated User'
            }]
          }
        : page)
    }).success).toBe(false)
    expect(restResponseSchema.safeParse({
      ...response,
      pages: response.pages.map((page) => page.collection === 'memberships'
        ? {
            ...page,
            items: [membership, {
              ...membership,
              projectMembershipId: 'pmb_Member000002',
              userId: TEST_IDS.secondUserId
            }]
          }
        : page)
    }).success).toBe(false)
  })

  it('pages every canonical Project coordination fact collection instead of returning an unbounded snapshot', () => {
    const request = {
      protocolVersion: '1.0',
      requestId: TEST_IDS.requestId,
      type: 'project.coordination.read',
      projectId: TEST_IDS.projectId,
      collections: allCoordinationCollections.map((collection) => ({
        collection,
        cursor: `after-${collection}`,
        limit: 250
      }))
    } as const
    expect(restRequestSchema.safeParse(request).success).toBe(true)

    const response = {
      protocolVersion: '1.0',
      requestId: TEST_IDS.requestId,
      type: 'rest.project_coordination',
      project: projectFixture,
      observedAt: TEST_TIMESTAMP,
      pages: allCoordinationCollections.map((collection) => ({
        collection,
        cursor: `after-${collection}`,
        limit: 250,
        items: []
      })),
      finalSummary: null
    } as const
    expect(restResponseSchema.safeParse(response).success).toBe(true)
    expect(restResponseSchema.safeParse({
      ...response,
      pages: [{ collection: 'tasks', limit: 1, items: [projectFixture] }]
    }).success).toBe(false)
  })

  it('fences Task, execution, offer, User and Agent references inside a complete coordination page set', () => {
    const workerDeviceId = 'dev_WorkerDevice01'
    const ownerMembership = {
      schemaVersion: 1,
      type: 'project_membership',
      projectMembershipId: TEST_IDS.projectMembershipId,
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
    } as const
    const workerMembership = {
      ...ownerMembership,
      projectMembershipId: 'pmb_Member000002',
      userId: TEST_IDS.secondUserId
    } as const
    const ownerAgentLabel = {
      schemaVersion: 1,
      type: 'project_agent_label_fact',
      projectId: TEST_IDS.projectId,
      agentId: TEST_IDS.agentId,
      ownerUserId: TEST_IDS.userId,
      deviceId: TEST_IDS.deviceId,
      displayName: 'Owner Desktop',
      nodeType: 'desktop',
      lifecycleStatus: 'active',
      revision: 1,
      observedAt: TEST_TIMESTAMP
    } as const
    const workerAgentLabel = {
      ...ownerAgentLabel,
      agentId: TEST_IDS.secondAgentId,
      ownerUserId: TEST_IDS.secondUserId,
      deviceId: workerDeviceId,
      displayName: 'Worker Desktop'
    } as const
    const execution = {
      schemaVersion: 1,
      type: 'task_execution',
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      attempt: 1,
      offeredByCoordinatorAgentId: TEST_IDS.agentId,
      assigneeUserId: TEST_IDS.secondUserId,
      assigneeAgentId: TEST_IDS.secondAgentId,
      assigneeDeviceId: workerDeviceId,
      state: 'accepted',
      stateRevision: 1,
      fence: {
        schemaVersion: 1,
        executionId: TEST_IDS.executionId,
        assigneeUserId: TEST_IDS.secondUserId,
        assigneeAgentId: TEST_IDS.secondAgentId,
        assigneeDeviceId: workerDeviceId,
        assignmentTaskRevision: 1,
        projectExecutionAuthorityEpoch: 1,
        userTaskAuthorityEpoch: 1,
        bindingRevision: null,
        status: 'open',
        reason: null,
        fencedAt: null
      },
      fileIntent: null,
      currentResultSubmissionId: null,
      offeredAt: TEST_TIMESTAMP,
      acceptedAt: TEST_TIMESTAMP,
      startedAt: null,
      terminalAt: null,
      revision: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP
    } as const
    const offer = {
      schemaVersion: 1,
      type: 'task_offer',
      taskOfferId: TEST_IDS.taskOfferId,
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      workerUserId: TEST_IDS.secondUserId,
      offeredByCoordinatorAgentId: TEST_IDS.agentId,
      state: 'accepted',
      offeredAt: TEST_TIMESTAMP,
      expiresAt: TEST_LATER_TIMESTAMP,
      respondedAt: TEST_TIMESTAMP,
      revision: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP
    } as const
    const task = {
      ...taskFixture,
      currentExecutionId: TEST_IDS.executionId,
      currentExecutionState: 'accepted',
      status: 'in_progress',
      executionCount: 1
    } as const
    const response = {
      protocolVersion: '1.0',
      requestId: TEST_IDS.requestId,
      type: 'rest.project_coordination',
      project: projectFixture,
      observedAt: TEST_TIMESTAMP,
      pages: [
        { collection: 'memberships', limit: 10, items: [ownerMembership, workerMembership] },
        { collection: 'agent_label_facts', limit: 10, items: [ownerAgentLabel, workerAgentLabel] },
        { collection: 'tasks', limit: 10, items: [task] },
        { collection: 'executions', limit: 10, items: [execution] },
        { collection: 'offers', limit: 10, items: [offer] }
      ],
      finalSummary: null
    } as const
    expect(restResponseSchema.safeParse(response).success).toBe(true)
    expect(restResponseSchema.safeParse({
      ...response,
      pages: response.pages.map((page) => page.collection === 'offers'
        ? { ...page, items: [{ ...offer, assigneeAgentId: TEST_IDS.agentId }] }
        : page)
    }).success).toBe(false)
    expect(restResponseSchema.safeParse({
      ...response,
      pages: response.pages.map((page) => page.collection === 'tasks'
        ? { ...page, items: [{ ...task, currentExecutionId: 'exe_Exec00000002' }] }
        : page)
    }).success).toBe(false)
  })

  it('keeps Membership, Task Authority, Provider readiness, provisioning and recovery as orthogonal flat facts', () => {
    const providerInstance = {
      schemaVersion: 1,
      type: 'provider_instance_reference',
      providerInstanceRef: 'provider-instance-alpha'
    } as const
    const principal = {
      schemaVersion: 1,
      type: 'provider_directory_principal_reference',
      providerInstance,
      principalKind: 'user',
      principalId: 'principal-owner-alpha'
    } as const
    const rootLocator = {
      contractVersion: 1,
      kind: 'content-space.container-reference',
      authority: 'provider.instance.alpha',
      identity: { containerId: 'shared-root-alpha' }
    } as const
    const membership = {
      schemaVersion: 1,
      type: 'project_membership',
      projectMembershipId: TEST_IDS.projectMembershipId,
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
    } as const
    const textAuthority = {
      schemaVersion: 1,
      type: 'task_authority',
      taskAuthorityId: TEST_IDS.taskAuthorityId,
      projectId: TEST_IDS.projectId,
      userId: TEST_IDS.userId,
      scope: 'text_tasks',
      state: 'eligible',
      authorityEpoch: 1,
      reason: null,
      effectiveAt: TEST_TIMESTAMP,
      revision: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP
    } as const
    const fileAuthority = {
      ...textAuthority,
      taskAuthorityId: 'tau_Authority0002',
      scope: 'file_tasks'
    } as const
    const providerFact = {
      schemaVersion: 1,
      type: 'provider_directory_principal_fact',
      providerPrincipalFactId: TEST_IDS.providerPrincipalFactId,
      userId: TEST_IDS.userId,
      providerPrincipal: principal,
      principalIdentityRevision: 1,
      providerBindingAttestationDigest: TEST_HASH,
      publishedByDeviceId: TEST_IDS.deviceId,
      readiness: 'ready',
      readinessReason: null,
      observedAt: TEST_TIMESTAMP,
      revision: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP
    } as const
    const providerObservation = {
      schemaVersion: 1,
      type: 'project_provider_membership_observation',
      providerObservationId: TEST_IDS.providerObservationId,
      projectId: TEST_IDS.projectId,
      userId: TEST_IDS.userId,
      providerPrincipalFactId: TEST_IDS.providerPrincipalFactId,
      snapshottedFactRevision: 1,
      providerPrincipal: principal,
      bindingRevision: 1,
      provisioningRevision: 2,
      source: 'provisioning_attestation',
      outcome: 'present',
      observerUserId: TEST_IDS.userId,
      observerDeviceId: TEST_IDS.deviceId,
      observerAgentId: null,
      provisioningAttestationId: TEST_IDS.provisioningAttestationId,
      evidenceDigest: TEST_HASH,
      observedAt: TEST_LATER_TIMESTAMP,
      revision: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_LATER_TIMESTAMP
    } as const
    const readiness = {
      schemaVersion: 1,
      type: 'project_content_readiness',
      projectId: TEST_IDS.projectId,
      userId: TEST_IDS.userId,
      providerInstance,
      state: 'ready',
      reason: null,
      providerPrincipalFactId: TEST_IDS.providerPrincipalFactId,
      snapshottedFactRevision: 1,
      providerPrincipal: principal,
      bindingRevision: 1,
      lastObservationId: TEST_IDS.providerObservationId,
      effectiveAt: TEST_LATER_TIMESTAMP,
      revision: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_LATER_TIMESTAMP
    } as const
    const intent = {
      schemaVersion: 1,
      type: 'project_content_provisioning_intent',
      provisioningIntentId: TEST_IDS.provisioningIntentId,
      projectId: TEST_IDS.projectId,
      provisioningRevision: 2,
      kind: 'initial_provisioning',
      state: 'completed',
      createdByOwnerUserId: TEST_IDS.userId,
      contentOwnerUserId: TEST_IDS.userId,
      providerInstance,
      desiredMembers: [{
        userId: TEST_IDS.userId,
        providerPrincipalFactId: TEST_IDS.providerPrincipalFactId,
        snapshottedFactRevision: 1,
        principal
      }],
      containerDisplayName: 'Meeting Project Library',
      currentRootLocator: rootLocator,
      currentBindingRevision: 1,
      intentDigest: TEST_HASH,
      revision: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_LATER_TIMESTAMP
    } as const
    const attestation = {
      schemaVersion: 1,
      type: 'project_content_provisioning_attestation',
      format: 'sciforge.project-content-provisioning-attestation.v1',
      provisioningAttestationId: TEST_IDS.provisioningAttestationId,
      projectId: TEST_IDS.projectId,
      provisioningIntentId: TEST_IDS.provisioningIntentId,
      provisioningRevision: 2,
      ownerUserId: TEST_IDS.userId,
      principalIdentityRevision: 1,
      providerBindingAttestationDigest: TEST_HASH,
      providerInstance,
      rootLocator,
      rootLocatorDigest: TEST_HASH,
      observedOperations: [{
        operationId: 'operation-create-root-01',
        operationRevision: 1,
        kind: 'create_shared_container',
        subjectPrincipal: null,
        requestDigest: TEST_HASH,
        receiptDigest: TEST_HASH,
        outcome: 'observed_success',
        safeFailureCode: null,
        observedAt: TEST_TIMESTAMP
      }],
      memberObservations: [{
        userId: TEST_IDS.userId,
        providerPrincipalFactId: TEST_IDS.providerPrincipalFactId,
        snapshottedFactRevision: 1,
        principal,
        presence: 'present',
        observationDigest: TEST_HASH,
        observedAt: TEST_LATER_TIMESTAMP
      }],
      memberSetDigest: TEST_HASH,
      observationStartedAt: TEST_TIMESTAMP,
      observationCompletedAt: TEST_LATER_TIMESTAMP,
      deviceSignature: {
        purpose: 'project-content-provisioning-attestation',
        userId: TEST_IDS.userId,
        deviceId: TEST_IDS.deviceId,
        deviceKeyId: 'device-key-alpha',
        deviceKeyRevision: 1,
        signatureAlgorithm: 'Ed25519',
        canonicalPayloadDigest: TEST_HASH,
        factRevision: 2,
        observedAt: TEST_LATER_TIMESTAMP,
        issuedAt: '2026-08-15T08:02:00.000Z',
        signature: 'A'.repeat(86)
      },
      revision: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_LATER_TIMESTAMP
    } as const
    const binding = {
      schemaVersion: 1,
      type: 'project_content_space_binding',
      projectContentBindingId: TEST_IDS.projectContentBindingId,
      projectId: TEST_IDS.projectId,
      contentOwnerUserId: TEST_IDS.userId,
      providerInstance,
      rootLocator,
      rootLocatorDigest: TEST_HASH,
      provisioningIntentId: TEST_IDS.provisioningIntentId,
      provisioningRevision: 2,
      attestationId: TEST_IDS.provisioningAttestationId,
      attestationDigest: TEST_HASH,
      status: 'active',
      statusReason: null,
      activatedAt: TEST_LATER_TIMESTAMP,
      degradedAt: null,
      closedAt: null,
      revision: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_LATER_TIMESTAMP
    } as const
    const journal = {
      schemaVersion: 1,
      type: 'external_operation_recovery_journal_entry',
      contentRecoveryJournalEntryId: TEST_IDS.contentRecoveryJournalEntryId,
      scope: 'project_provisioning',
      projectId: TEST_IDS.projectId,
      taskId: null,
      executionId: null,
      preparedTaskRevision: null,
      preparedExecutionRevision: null,
      provisioningIntentId: TEST_IDS.provisioningIntentId,
      provisioningRevision: 2,
      logicalInvocationId: 'create-root-invocation-01',
      operation: 'create_shared_container',
      state: 'observed_success',
      requestDigest: TEST_HASH,
      receiptDigest: TEST_HASH,
      observationDigest: TEST_HASH,
      safeFailureCode: null,
      preparedAt: TEST_TIMESTAMP,
      dispatchedAt: TEST_TIMESTAMP,
      resolvedAt: TEST_LATER_TIMESTAMP,
      revision: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_LATER_TIMESTAMP
    } as const
    const recovery = {
      schemaVersion: 1,
      type: 'visible_recovery_action',
      recoveryActionId: TEST_IDS.recoveryActionId,
      projectId: TEST_IDS.projectId,
      taskId: null,
      executionId: null,
      journalEntryId: TEST_IDS.contentRecoveryJournalEntryId,
      audience: 'owner',
      action: 'resume_provisioning',
      status: 'completed',
      requiresFreshObservation: false,
      safeSummary: 'Provisioning was reconciled from exact observations.',
      availableAt: TEST_TIMESTAMP,
      completedAt: TEST_LATER_TIMESTAMP,
      revision: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_LATER_TIMESTAMP
    } as const
    const response = {
      protocolVersion: '1.0',
      requestId: TEST_IDS.requestId,
      type: 'rest.project_coordination',
      project: { ...projectFixture, contentMode: 'required' },
      observedAt: TEST_LATER_TIMESTAMP,
      pages: [
        { collection: 'memberships', limit: 10, items: [membership] },
        { collection: 'task_authorities', limit: 10, items: [textAuthority, fileAuthority] },
        { collection: 'provider_principal_facts', limit: 10, items: [providerFact] },
        { collection: 'content_readiness', limit: 10, items: [readiness] },
        { collection: 'provider_membership_observations', limit: 10, items: [providerObservation] },
        { collection: 'provisioning_intents', limit: 10, items: [intent] },
        { collection: 'provisioning_attestations', limit: 10, items: [attestation] },
        { collection: 'content_bindings', limit: 10, items: [binding] },
        { collection: 'external_operation_journal', limit: 10, items: [journal] },
        { collection: 'visible_recovery_actions', limit: 10, items: [recovery] }
      ],
      finalSummary: null
    } as const
    expect(restResponseSchema.safeParse(response).success).toBe(true)
    expect(restResponseSchema.safeParse({
      ...response,
      pages: response.pages.map((page) => page.collection === 'task_authorities'
        ? { ...page, items: [textAuthority] }
        : page)
    }).success).toBe(false)
    expect(restResponseSchema.safeParse({
      ...response,
      pages: response.pages.map((page) => page.collection === 'provider_principal_facts'
        ? {
            ...page,
            items: [{
              ...providerFact,
              providerPrincipal: { ...principal, principalId: 'principal-owner-replaced' },
              revision: 2,
              updatedAt: TEST_LATER_TIMESTAMP
            }]
          }
        : page)
    }).success).toBe(true)
    expect(restResponseSchema.safeParse({
      ...response,
      pages: response.pages.map((page) => page.collection === 'task_authorities'
        ? { ...page, items: [textAuthority, { ...textAuthority, taskAuthorityId: 'tau_Authority0002' }] }
        : page)
    }).success).toBe(false)
    expect(restResponseSchema.safeParse({
      ...response,
      pages: response.pages.map((page) => page.collection === 'content_readiness'
        ? { ...page, items: [{ ...readiness, providerPrincipalFactId: 'ppf_Principal00002' }] }
        : page)
    }).success).toBe(false)
    expect(restResponseSchema.safeParse({
      ...response,
      pages: response.pages.map((page) => page.collection === 'provisioning_attestations'
        ? { ...page, items: [{ ...attestation, provisioningIntentId: 'pci_Provision00002' }] }
        : page)
    }).success).toBe(false)
    expect(restResponseSchema.safeParse({
      ...response,
      pages: response.pages.map((page) => page.collection === 'visible_recovery_actions'
        ? { ...page, items: [{ ...recovery, journalEntryId: 'crj_Journal000002' }] }
        : page)
    }).success).toBe(false)
  })

  it('exposes only pending HumanNeeded facts bound to the exact execution and Project Owner', () => {
    const membership = {
      schemaVersion: 1,
      type: 'project_membership',
      projectMembershipId: TEST_IDS.projectMembershipId,
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
    } as const
    const agentLabel = {
      schemaVersion: 1,
      type: 'project_agent_label_fact',
      projectId: TEST_IDS.projectId,
      agentId: TEST_IDS.agentId,
      ownerUserId: TEST_IDS.userId,
      deviceId: TEST_IDS.deviceId,
      displayName: 'Owner Desktop',
      nodeType: 'desktop',
      lifecycleStatus: 'active',
      revision: 1,
      observedAt: TEST_TIMESTAMP
    } as const
    const task = {
      ...taskFixture,
      status: 'needs_human',
      currentExecutionId: TEST_IDS.executionId,
      currentExecutionState: 'needs_human',
      executionCount: 1
    } as const
    const execution = {
      schemaVersion: 1,
      type: 'task_execution',
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      attempt: 1,
      offeredByCoordinatorAgentId: TEST_IDS.agentId,
      assigneeUserId: TEST_IDS.userId,
      assigneeAgentId: TEST_IDS.agentId,
      assigneeDeviceId: TEST_IDS.deviceId,
      state: 'needs_human',
      stateRevision: 3,
      fence: {
        schemaVersion: 1,
        executionId: TEST_IDS.executionId,
        assigneeUserId: TEST_IDS.userId,
        assigneeAgentId: TEST_IDS.agentId,
        assigneeDeviceId: TEST_IDS.deviceId,
        assignmentTaskRevision: 1,
        projectExecutionAuthorityEpoch: 1,
        userTaskAuthorityEpoch: 1,
        bindingRevision: null,
        status: 'open',
        reason: null,
        fencedAt: null
      },
      fileIntent: null,
      currentResultSubmissionId: null,
      offeredAt: TEST_TIMESTAMP,
      acceptedAt: TEST_TIMESTAMP,
      startedAt: TEST_TIMESTAMP,
      terminalAt: null,
      revision: 3,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP
    } as const
    const response = {
      protocolVersion: '1.0',
      requestId: TEST_IDS.requestId,
      type: 'rest.project_coordination',
      project: projectFixture,
      observedAt: TEST_TIMESTAMP,
      pages: [
        { collection: 'memberships', limit: 10, items: [membership] },
        { collection: 'agent_label_facts', limit: 10, items: [agentLabel] },
        { collection: 'tasks', limit: 10, items: [task] },
        { collection: 'executions', limit: 10, items: [execution] },
        { collection: 'pending_human_needed', limit: 10, items: [humanNeededFixture] }
      ],
      finalSummary: null
    } as const
    expect(restResponseSchema.safeParse(response).success).toBe(true)
    expect(restResponseSchema.safeParse({
      ...response,
      pages: response.pages.map((page) => page.collection === 'pending_human_needed'
        ? { ...page, items: [{
            ...humanNeededFixture,
            context: { scope: 'coordinator_project', coordinatorAuthorityEpoch: projectFixture.coordinatorAuthorityEpoch },
            requestedByAgentId: projectFixture.coordinatorAgentId
          }] }
        : page)
    }).success).toBe(true)
    expect(restResponseSchema.safeParse({
      ...response,
      pages: response.pages.map((page) => page.collection === 'pending_human_needed'
        ? { ...page, items: [{ ...humanNeededFixture, targetUserId: TEST_IDS.secondUserId }] }
        : page)
    }).success).toBe(false)
    expect(restResponseSchema.safeParse({
      ...response,
      pages: response.pages.map((page) => page.collection === 'pending_human_needed'
        ? { ...page, items: [{ ...humanNeededFixture, requestedByAgentId: TEST_IDS.secondAgentId }] }
        : page)
    }).success).toBe(false)
  })

  it('links the confirmed plan, immutable result, review decision, records and final summary without integrity gating', () => {
    const metadata = {
      schemaVersion: 1,
      revision: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_LATER_TIMESTAMP
    } as const
    const membership = {
      ...metadata,
      type: 'project_membership',
      projectMembershipId: TEST_IDS.projectMembershipId,
      projectId: TEST_IDS.projectId,
      userId: TEST_IDS.userId,
      state: 'active',
      authorityEpoch: 1,
      activatedAt: TEST_TIMESTAMP,
      removalRequestedAt: null,
      removalRequestedByUserId: null,
      removedAt: null
    } as const
    const agentLabel = {
      schemaVersion: 1,
      type: 'project_agent_label_fact',
      projectId: TEST_IDS.projectId,
      agentId: TEST_IDS.agentId,
      ownerUserId: TEST_IDS.userId,
      deviceId: TEST_IDS.deviceId,
      displayName: 'Owner Desktop',
      nodeType: 'desktop',
      lifecycleStatus: 'active',
      revision: 1,
      observedAt: TEST_TIMESTAMP
    } as const
    const plan = {
      ...metadata,
      type: 'project_plan',
      projectPlanId: TEST_IDS.projectPlanId,
      projectId: TEST_IDS.projectId,
      state: 'confirmed',
      planRevision: 2,
      sourceInputLocators: [],
      tasks: [{
        planItemId: 'item_review0001',
        title: 'Review architecture',
        objective: 'Produce the architecture review.',
        completionCriteria: ['Submit one review'],
        dependencyPlanItemIds: [],
        requiredCapabilityTags: ['runtime.text'],
        fileIntent: null
      }],
      rationale: 'One independently owned review Task.',
      runtimeProvenance: {
        runtimeId: 'runtime-local',
        modelId: null,
        generatedByCoordinatorAgentId: TEST_IDS.agentId,
        generatedAt: TEST_TIMESTAMP
      },
      planDigest: TEST_HASH,
      submittedAt: TEST_TIMESTAMP,
      confirmedByUserId: TEST_IDS.userId,
      confirmedAt: TEST_TIMESTAMP,
      supersededAt: null
    } as const
    const task = {
      ...taskFixture,
      status: 'completed',
      currentExecutionId: TEST_IDS.executionId,
      currentExecutionState: 'completed',
      executionCount: 1,
      completedAt: TEST_LATER_TIMESTAMP,
      revision: 5,
      updatedAt: TEST_LATER_TIMESTAMP
    } as const
    const execution = {
      ...metadata,
      type: 'task_execution',
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      attempt: 1,
      offeredByCoordinatorAgentId: TEST_IDS.agentId,
      assigneeUserId: TEST_IDS.userId,
      assigneeAgentId: TEST_IDS.agentId,
      assigneeDeviceId: TEST_IDS.deviceId,
      state: 'completed',
      stateRevision: 5,
      fence: {
        schemaVersion: 1,
        executionId: TEST_IDS.executionId,
        assigneeUserId: TEST_IDS.userId,
        assigneeAgentId: TEST_IDS.agentId,
        assigneeDeviceId: TEST_IDS.deviceId,
        assignmentTaskRevision: 1,
        projectExecutionAuthorityEpoch: 1,
        userTaskAuthorityEpoch: 1,
        bindingRevision: null,
        status: 'fenced',
        reason: 'completed',
        fencedAt: TEST_LATER_TIMESTAMP
      },
      fileIntent: null,
      currentResultSubmissionId: TEST_IDS.resultSubmissionId,
      offeredAt: TEST_TIMESTAMP,
      acceptedAt: TEST_TIMESTAMP,
      startedAt: TEST_TIMESTAMP,
      terminalAt: TEST_LATER_TIMESTAMP
    } as const
    const result = {
      ...metadata,
      type: 'task_result_submission',
      resultSubmissionId: TEST_IDS.resultSubmissionId,
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      submittedTaskRevision: 4,
      submittedExecutionRevision: 4,
      submittedByUserId: TEST_IDS.userId,
      submittedByAgentId: TEST_IDS.agentId,
      summary: 'Architecture review completed.',
      runtimeProvenance: {
        runtimeId: 'runtime-local',
        modelId: null,
        startedAt: TEST_TIMESTAMP,
        completedAt: TEST_LATER_TIMESTAMP
      },
      outputs: [],
      recoveryJournalEntryIds: [],
      submittedAt: TEST_LATER_TIMESTAMP,
      submissionDigest: TEST_HASH
    } as const
    const acceptedRecord = {
      ...metadata,
      type: 'project_record',
      projectRecordId: TEST_IDS.projectRecordId,
      projectId: TEST_IDS.projectId,
      kind: 'observation',
      status: 'accepted',
      body: 'Accepted architecture review.',
      authorUserId: TEST_IDS.userId,
      authorAgentId: TEST_IDS.agentId,
      sourceTaskId: TEST_IDS.taskId,
      sourceResultSubmissionId: TEST_IDS.resultSubmissionId,
      sourceHumanAnswerId: null,
      sourceRevision: 5,
      acceptedByUserId: TEST_IDS.userId,
      acceptedByAgentId: TEST_IDS.agentId,
      acceptedAt: TEST_LATER_TIMESTAMP
    } as const
    const review = {
      ...metadata,
      type: 'task_review_decision',
      reviewDecisionId: TEST_IDS.reviewDecisionId,
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      resultSubmissionId: TEST_IDS.resultSubmissionId,
      reviewedResultRevision: 1,
      decidedByUserId: TEST_IDS.userId,
      decidedByCoordinatorAgentId: TEST_IDS.agentId,
      decision: 'accept',
      instruction: null,
      acceptedProjectRecordId: TEST_IDS.projectRecordId,
      nextTaskOfferId: null,
      decidedAt: TEST_LATER_TIMESTAMP
    } as const
    const finalRecordId = 'rec_Rec000000002'
    const finalRecord = {
      ...acceptedRecord,
      projectRecordId: finalRecordId,
      kind: 'summary',
      body: 'The design review meeting completed.',
      sourceTaskId: null,
      sourceResultSubmissionId: null,
      sourceHumanAnswerId: null,
      sourceRevision: 1
    } as const
    const finalSummary = {
      ...metadata,
      type: 'project_final_summary',
      projectId: TEST_IDS.projectId,
      projectRecordId: finalRecordId,
      projectPlanId: TEST_IDS.projectPlanId,
      confirmedPlanRevision: 2,
      acceptedResultSubmissionIds: [TEST_IDS.resultSubmissionId],
      summary: 'The design review meeting completed.',
      createdByUserId: TEST_IDS.userId,
      createdByCoordinatorAgentId: TEST_IDS.agentId,
      completedAt: TEST_LATER_TIMESTAMP
    } as const
    const response = {
      protocolVersion: '1.0',
      requestId: TEST_IDS.requestId,
      type: 'rest.project_coordination',
      project: { ...projectFixture, status: 'completed' },
      observedAt: TEST_LATER_TIMESTAMP,
      pages: [
        { collection: 'memberships', limit: 10, items: [membership] },
        { collection: 'agent_label_facts', limit: 10, items: [agentLabel] },
        { collection: 'plans', limit: 10, items: [plan] },
        { collection: 'tasks', limit: 10, items: [task] },
        { collection: 'executions', limit: 10, items: [execution] },
        { collection: 'result_submissions', limit: 10, items: [result] },
        { collection: 'review_decisions', limit: 10, items: [review] },
        { collection: 'project_records', limit: 10, items: [acceptedRecord, finalRecord] }
      ],
      finalSummary
    } as const
    expect(restResponseSchema.safeParse(response).success).toBe(true)
    expect(restResponseSchema.safeParse({
      ...response,
      pages: response.pages.map((page) => page.collection === 'review_decisions'
        ? { ...page, items: [{ ...review, resultSubmissionId: 'rsu_Result000002' }] }
        : page)
    }).success).toBe(false)
    expect(restResponseSchema.safeParse({
      ...response,
      finalSummary: { ...finalSummary, acceptedResultSubmissionIds: ['rsu_Result000002'] }
    }).success).toBe(false)
  })
})
