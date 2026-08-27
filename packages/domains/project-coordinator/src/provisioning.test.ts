import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import {
  canonicalizeDomainMainFiniteCapabilityBatchPlan,
  type DomainMainFiniteCapabilityBatchPlan,
  type DomainMainSystemCapabilityInvoker
} from '@sciforge/domain-sdk/host'
import type {
  AuthenticatedCloudResponse,
  AuthenticatedCloudTransport
} from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import type {
  ExternalOperationRecoveryJournalEntry,
  RestResponse
} from '@sciforge/collaboration-contracts'

import {
  projectCoordinatorWorkspaceSchema,
  type ProjectCoordinatorWorkspace
} from './contract.js'
import { createProjectCoordinatorProvisioningPort } from './provisioning.js'

const now = '2026-08-26T01:00:00.000Z'
const projectId = 'prj_Project000001'
const ownerUserId = 'usr_Owner0000001'
const workerUserId = 'usr_Worker000001'
const removedUserId = 'usr_Removed00001'
const providerInstance = {
  schemaVersion: 1 as const,
  type: 'provider_instance_reference' as const,
  providerInstanceRef: 'opencontent.run0'
}
const root = {
  contractVersion: 1 as const,
  kind: 'content-space.container-reference' as const,
  authority: providerInstance.providerInstanceRef,
  identity: { containerId: 'team-root-01' }
}

test('initial provisioning preview binds the complete ordered ordinary Content Space plan', async () => {
  let workspace = workspaceFixture({ root: null, intentKind: 'initial_provisioning' })
  let batchCreated = false
  const port = createProjectCoordinatorProvisioningPort({
    workspace: { readWorkspace: async () => workspace },
    transport: unusedTransport(),
    signing: { signFactualPayload: async () => { throw new Error('unused') } },
    getCapabilities: () => ({
      invoke: async () => { throw new Error('unused') },
      createApprovedBatch: () => {
        batchCreated = true
        throw new Error('unused')
      }
    }),
    attemptId: () => 'attempt_Provisioning01'
  })

  const preview = await port.preview({ projectId })

  assert.equal(preview.rootStrategy, 'create')
  assert.deepEqual(preview.operations.map(({ actionId }) => actionId), [
    'content-space.authorize-provider-administration',
    'content-space.agent-admin-create-space',
    'content-space.agent-admin-observe-space',
    'content-space.agent-admin-list-members',
    'content-space.agent-admin-add-member',
    'content-space.agent-admin-add-member',
    'content-space.agent-admin-list-members'
  ])
  assert.deepEqual(preview.operations.filter(({ kind }) => kind === 'add_member')
    .map(({ userId }) => userId), [ownerUserId, workerUserId])
  assert.match(preview.confirmedPlanDigest, /^[a-f0-9]{64}$/u)
  assert.equal(batchCreated, false)

  workspace = workspaceFixture({
    root: null,
    intentKind: 'initial_provisioning',
    intentRevision: 2,
    containerDisplayName: 'Changed after preview'
  })
  await assert.rejects(
    port.apply(applyInput(preview), 'idem_ProjectProvisioning01'),
    /changed after the provisioning preview/u
  )
  assert.equal(batchCreated, false)
})

test('membership reconcile reauthorizes the exact existing root before any member write', async () => {
  const workspace = workspaceFixture({
    root,
    intentKind: 'membership_change',
    includeRemovalPending: true
  })
  const port = createProjectCoordinatorProvisioningPort({
    workspace: { readWorkspace: async () => workspace },
    transport: unusedTransport(),
    signing: { signFactualPayload: async () => { throw new Error('unused') } },
    getCapabilities: () => unusedCapabilities(),
    attemptId: () => 'attempt_Membership0001'
  })

  const preview = await port.preview({ projectId })

  assert.equal(preview.rootStrategy, 'reauthorize')
  assert.deepEqual(preview.operations.map(({ kind }) => kind), [
    'authorize_root',
    'observe_root',
    'list_members',
    'add_member',
    'add_member',
    'remove_member',
    'list_members'
  ])
  assert.equal(preview.operations.find(({ kind }) => kind === 'remove_member')?.userId, removedUserId)
  assert.equal(preview.currentRootLocator?.identity.containerId, 'team-root-01')
})

test('a dispatched or outcome-unknown create is reconciled and never issued a second time', async () => {
  for (const state of ['dispatched', 'outcome_unknown'] as const) {
    const workspace = withUncertainCreateJournal(
      workspaceFixture({ root: null, intentKind: 'initial_provisioning' }),
      state
    )
    const port = createProjectCoordinatorProvisioningPort({
      workspace: { readWorkspace: async () => workspace },
      transport: unusedTransport(),
      signing: { signFactualPayload: async () => { throw new Error('unused') } },
      getCapabilities: () => unusedCapabilities(),
      attemptId: () => `attempt_CreateRecovery_${state}`
    })

    const preview = await port.preview({ projectId })

    assert.equal(preview.rootStrategy, 'reauthorize')
    assert.equal(preview.operations[0]?.kind, 'authorize_root')
    assert.equal(preview.operations.some(({ kind }) => kind === 'create_shared_container'), false)
  }
})

test('confirmed initial plan journals each Provider operation and submits one Device-signed attestation', async () => {
  const workspace = workspaceFixture({ root: null, intentKind: 'initial_provisioning' })
  const cloud = cloudHarness()
  const invoked: string[] = []
  let capturedPlan: DomainMainFiniteCapabilityBatchPlan | undefined
  const resource = {
    token: `cap_${'a'.repeat(32)}`,
    semanticRevision: 'live:root',
    expiresAt: '2026-08-26T01:15:00.000Z'
  }
  const summary = {
    root,
    label: 'Meeting Project Team',
    contentOwnerUserId: ownerUserId,
    pinned: false
  }
  const directoryMembers = [
    { providerInstanceRef: providerInstance.providerInstanceRef, kind: 'user' as const,
      principalId: principal(ownerUserId).principalId },
    { providerInstanceRef: providerInstance.providerInstanceRef, kind: 'user' as const,
      principalId: principal(workerUserId).principalId }
  ]
  const capabilities = {
    invoke: async () => { throw new Error('unused') },
    createApprovedBatch: (plan: DomainMainFiniteCapabilityBatchPlan) => {
      capturedPlan = plan
      const planDigest = createHash('sha256')
        .update(canonicalizeDomainMainFiniteCapabilityBatchPlan(plan))
        .digest('hex')
      return {
        revision: plan.revision,
        planDigest,
        invoke: async (operationId: string) => {
          invoked.push(operationId)
          if (operationId === 'authorize-provider') {
            return { ok: true, value: {
              providerInstanceRef: providerInstance.providerInstanceRef,
              resource
            } }
          }
          if (operationId === 'create-root') {
            return { ok: true, value: { space: summary, resource } }
          }
          if (operationId === 'observe-root') return { ok: true, value: summary }
          if (operationId === 'list-before') {
            return { ok: true, value: { root, items: [] } }
          }
          if (operationId.startsWith('add-member-')) {
            const index = Number(operationId.slice(-3)) - 1
            return { ok: true, value: { root, member: directoryMembers[index] } }
          }
          if (operationId === 'list-after') {
            return { ok: true, value: {
              root,
              items: directoryMembers.map((member) => ({ member }))
            } }
          }
          throw new Error(`Unexpected batch operation ${operationId}.`)
        },
        discard: () => undefined
      }
    }
  } as unknown as DomainMainSystemCapabilityInvoker
  let signedDigest = ''
  const port = createProjectCoordinatorProvisioningPort({
    workspace: { readWorkspace: async () => workspace },
    transport: cloud.transport,
    signing: {
      signFactualPayload: async (request) => {
        signedDigest = request.factDigest
        return {
          purpose: 'project-content-provisioning-attestation',
          userId: ownerUserId,
          deviceId: 'dev_Device0000001',
          deviceKeyId: 'device-key-1',
          deviceKeyRevision: 1,
          signatureAlgorithm: 'Ed25519',
          canonicalPayloadDigest: request.factDigest,
          factRevision: request.factRevision,
          observedAt: request.observedAt,
          issuedAt: request.observedAt,
          signature: 'A'.repeat(86)
        }
      }
    },
    getCapabilities: () => capabilities,
    now: () => new Date(now),
    attemptId: () => 'attempt_Provisioning02',
    attestationId: () => 'pca_Attestation0001',
    requestId: (() => {
      let ordinal = 0
      return () => `req_Provisioning${String(++ordinal).padStart(4, '0')}`
    })()
  })
  const preview = await port.preview({ projectId })

  await port.apply(applyInput(preview), 'idem_ProjectProvisioning02')

  assert.ok(capturedPlan)
  assert.equal(
    createHash('sha256').update(canonicalizeDomainMainFiniteCapabilityBatchPlan(capturedPlan)).digest('hex'),
    preview.confirmedPlanDigest
  )
  assert.deepEqual(invoked, [
    'authorize-provider',
    'create-root',
    'observe-root',
    'list-before',
    'add-member-001',
    'add-member-002',
    'list-after'
  ])
  assert.deepEqual(cloud.commandTypes, [
    ...journalCommandTypes(6),
    'project.content.attest'
  ])
  assert.equal(cloud.attestation?.deviceSignature.canonicalPayloadDigest, signedDigest)
  assert.deepEqual(cloud.attestation?.memberObservations.map(({ userId, presence }) => ({
    userId,
    presence
  })), [
    { userId: ownerUserId, presence: 'present' },
    { userId: workerUserId, presence: 'present' }
  ])
  const serialized = JSON.stringify(cloud.attestation)
  for (const forbidden of ['accessToken', 'refreshToken', 'credential', 'connectionId', '/Users/']) {
    assert.equal(serialized.includes(forbidden), false)
  }
})

test('Owner root authorization loss records unauthorized and stops before every member write', async () => {
  const workspace = withActiveBinding(workspaceFixture({
    root,
    intentKind: 'membership_change'
  }))
  const cloud = cloudHarness()
  const invoked: string[] = []
  const capabilities = {
    invoke: async () => { throw new Error('unused') },
    createApprovedBatch: (plan: DomainMainFiniteCapabilityBatchPlan) => ({
      revision: plan.revision,
      planDigest: createHash('sha256')
        .update(canonicalizeDomainMainFiniteCapabilityBatchPlan(plan))
        .digest('hex'),
      invoke: async (operationId: string) => {
        invoked.push(operationId)
        if (operationId === 'authorize-root') {
          return {
            ok: false,
            error: {
              code: 'unauthorized',
              message: 'Owner lost Provider root access.',
              retry: 'after-human-action'
            }
          }
        }
        throw new Error(`Operation ${operationId} must remain fenced.`)
      },
      discard: () => undefined
    })
  } as unknown as DomainMainSystemCapabilityInvoker
  const port = createProjectCoordinatorProvisioningPort({
    workspace: { readWorkspace: async () => workspace },
    transport: cloud.transport,
    signing: { signFactualPayload: async () => { throw new Error('must not sign') } },
    getCapabilities: () => capabilities,
    now: () => new Date(now),
    attemptId: () => 'attempt_RootLoss00001',
    providerObservationId: () => 'pob_RootLoss000001',
    requestId: (() => {
      let ordinal = 0
      return () => `req_RootLoss${String(++ordinal).padStart(8, '0')}`
    })()
  })
  const preview = await port.preview({ projectId })

  await assert.rejects(
    port.apply(applyInput(preview), 'idem_ProjectRootLoss0001'),
    /root authorization failed: unauthorized/u
  )

  assert.deepEqual(invoked, ['authorize-root'])
  assert.deepEqual(cloud.commandTypes, [
    'external_operation.prepare',
    'external_operation.dispatch',
    'external_operation.observe',
    'project.content.observation.submit'
  ])
  assert.equal(cloud.rootLossObservation?.outcome, 'unauthorized')
  assert.equal(cloud.rootLossObservation?.userId, ownerUserId)
  assert.equal(cloud.rootLossObservation?.bindingRevision, 1)
  assert.equal(cloud.rootLossObservation?.provisioningRevision, 1)
})

test('content-free dynamic member add remains directly active without a Provider fact', async () => {
  const workspace = contentFreeWorkspaceFixture()
  const cloud = membershipCloudHarness('active')
  const port = createProjectCoordinatorProvisioningPort({
    workspace: { readWorkspace: async () => workspace },
    transport: cloud.transport,
    signing: { signFactualPayload: async () => { throw new Error('unused') } },
    getCapabilities: () => unusedCapabilities()
  })

  const result = await port.addMember({
    projectId,
    expectedProjectRevision: 3,
    userId: workerUserId,
    providerPrincipalFactId: null,
    expectedProviderPrincipalFactRevision: null
  }, 'idem_ContentFreeMember01')

  assert.equal(result.projects[0]?.project.contentMode, 'none')
  assert.equal(cloud.command?.type, 'project.membership.add')
  assert.equal(cloud.command?.providerPrincipalFactId, null)
})

test('content-required dynamic member add rejects an immediate-active compatibility response', async () => {
  const workspace = workspaceFixture({ root, intentKind: 'membership_change' })
  const cloud = membershipCloudHarness('active')
  const port = createProjectCoordinatorProvisioningPort({
    workspace: { readWorkspace: async () => workspace },
    transport: cloud.transport,
    signing: { signFactualPayload: async () => { throw new Error('unused') } },
    getCapabilities: () => unusedCapabilities()
  })

  await assert.rejects(port.addMember({
    projectId,
    expectedProjectRevision: 3,
    userId: removedUserId,
    providerPrincipalFactId: 'ppf_RemovedFact001',
    expectedProviderPrincipalFactRevision: 1
  }, 'idem_ContentMemberPending1'), /did not enter pending_membership/u)
})

test('content-required member removal accepts only membership_removal_pending', async () => {
  const workspace = workspaceFixture({ root, intentKind: 'initial_provisioning' })
  const pendingCloud = membershipRemovalCloudHarness('membership_removal_pending')
  const port = createProjectCoordinatorProvisioningPort({
    workspace: { readWorkspace: async () => workspace },
    transport: pendingCloud.transport,
    signing: { signFactualPayload: async () => { throw new Error('unused') } },
    getCapabilities: () => unusedCapabilities()
  })

  await port.removeMember({
    projectId,
    projectMembershipId: 'pmb_WorkerMember01',
    expectedProjectRevision: 3,
    expectedMembershipRevision: 1
  }, 'idem_ContentMemberRemove1')

  assert.equal(pendingCloud.command?.type, 'project.membership.remove')

  const immediateCloud = membershipRemovalCloudHarness('removed')
  const rejecting = createProjectCoordinatorProvisioningPort({
    workspace: { readWorkspace: async () => workspace },
    transport: immediateCloud.transport,
    signing: { signFactualPayload: async () => { throw new Error('unused') } },
    getCapabilities: () => unusedCapabilities()
  })
  await assert.rejects(rejecting.removeMember({
    projectId,
    projectMembershipId: 'pmb_WorkerMember01',
    expectedProjectRevision: 3,
    expectedMembershipRevision: 1
  }, 'idem_ContentMemberRemove2'), /did not remain safety-fenced pending/u)
})

function workspaceFixture(input: Readonly<{
  root: typeof root | null
  intentKind: 'initial_provisioning' | 'membership_change'
  intentRevision?: number
  containerDisplayName?: string
  includeRemovalPending?: boolean
}>): ProjectCoordinatorWorkspace {
  const ownerPrincipal = principal(ownerUserId)
  const workerPrincipal = principal(workerUserId)
  const desiredMembers = [
    desiredMember(ownerUserId, 'ppf_OwnerFact00001', ownerPrincipal),
    desiredMember(workerUserId, 'ppf_WorkerFact0001', workerPrincipal)
  ]
  const intentRevision = input.intentRevision ?? 1
  const memberships = [
    membership(ownerUserId, 'pmb_OwnerMember001', 'active'),
    membership(workerUserId, 'pmb_WorkerMember01', input.intentKind === 'membership_change'
      ? 'pending_membership'
      : 'active'),
    ...(input.includeRemovalPending
      ? [membership(removedUserId, 'pmb_RemovedMember1', 'membership_removal_pending')]
      : [])
  ]
  const providerPrincipalFacts = [
    principalFact(ownerUserId, 'ppf_OwnerFact00001', ownerPrincipal),
    principalFact(workerUserId, 'ppf_WorkerFact0001', workerPrincipal),
    ...(input.includeRemovalPending
      ? [principalFact(removedUserId, 'ppf_RemovedFact001', principal(removedUserId))]
      : [])
  ]
  const contentReadiness = providerPrincipalFacts.map((fact) => ({
    schemaVersion: 1 as const,
    type: 'project_content_readiness' as const,
    projectId,
    userId: fact.userId,
    providerInstance,
    state: 'pending' as const,
    reason: 'provisioning_pending' as const,
    providerPrincipalFactId: fact.providerPrincipalFactId,
    snapshottedFactRevision: fact.revision,
    providerPrincipal: fact.providerPrincipal,
    bindingRevision: input.root ? 1 : null,
    lastObservationId: null,
    effectiveAt: now,
    revision: 1,
    createdAt: now,
    updatedAt: now
  }))
  return projectCoordinatorWorkspaceSchema.parse({
    connection: { state: 'ready', userId: ownerUserId, deviceId: 'dev_Device0000001' },
    observedAt: now,
    focusedProjectId: projectId,
    availableWorkerGroups: [],
    projects: [{
      project: {
        schemaVersion: 1,
        type: 'project',
        projectId,
        ownerUserId,
        displayName: 'Meeting Project',
        goal: 'Run one multi-user meeting.',
        coordinatorAgentId: 'agt_Coordinator01',
        coordinatorAuthorityEpoch: 1,
        executionAuthorityEpoch: 1,
        contentMode: 'required',
        status: 'paused',
        budget: {
          maxTasks: 8,
          maxTasksPerRound: 4,
          maxTaskRetries: 2,
          maxCoordinationRounds: 3
        },
        revision: 3,
        createdAt: now,
        updatedAt: now
      },
      plan: null,
      workerGroups: [],
      tasks: [],
      reviews: [],
      pendingHumanNeeded: [],
      records: [],
      finalSummary: null,
      provisioning: {
        intent: {
          schemaVersion: 1,
          type: 'project_content_provisioning_intent',
          provisioningIntentId: 'pci_Provisioning01',
          projectId,
          provisioningRevision: 2,
          kind: input.intentKind,
          state: 'pending',
          createdByOwnerUserId: ownerUserId,
          contentOwnerUserId: ownerUserId,
          providerInstance,
          desiredMembers,
          containerDisplayName: input.containerDisplayName ?? 'Meeting Project Team',
          currentRootLocator: input.root,
          currentBindingRevision: input.root ? 1 : null,
          intentDigest: intentRevision === 1 ? 'a'.repeat(64) : 'c'.repeat(64),
          revision: intentRevision,
          createdAt: now,
          updatedAt: now
        },
        attestation: null,
        binding: null,
        memberships,
        providerPrincipalFacts,
        contentReadiness,
        providerMembershipObservations: [],
        externalOperationJournal: [],
        recoveryActions: []
      }
    }]
  })
}

function withActiveBinding(workspace: ProjectCoordinatorWorkspace): ProjectCoordinatorWorkspace {
  const project = workspace.projects[0]
  if (!project?.provisioning.intent) throw new Error('Fixture requires a provisioning intent.')
  const binding = {
    schemaVersion: 1,
    type: 'project_content_space_binding',
    projectContentBindingId: 'pcb_Binding0000001',
    projectId,
    contentOwnerUserId: ownerUserId,
    providerInstance,
    rootLocator: root,
    rootLocatorDigest: 'e'.repeat(64),
    provisioningIntentId: project.provisioning.intent.provisioningIntentId,
    provisioningRevision: 1,
    attestationId: 'pca_Previous000001',
    attestationDigest: 'f'.repeat(64),
    status: 'active',
    statusReason: null,
    activatedAt: now,
    degradedAt: null,
    closedAt: null,
    revision: 1,
    createdAt: now,
    updatedAt: now
  }
  return projectCoordinatorWorkspaceSchema.parse({
    ...workspace,
    projects: workspace.projects.map((candidate, index) => index === 0
      ? { ...candidate, provisioning: { ...candidate.provisioning, binding } }
      : candidate)
  })
}

function contentFreeWorkspaceFixture(): ProjectCoordinatorWorkspace {
  const required = workspaceFixture({ root: null, intentKind: 'initial_provisioning' })
  return projectCoordinatorWorkspaceSchema.parse({
    ...required,
    projects: required.projects.map((project) => ({
      ...project,
      project: { ...project.project, contentMode: 'none' },
      provisioning: {
        intent: null,
        attestation: null,
        binding: null,
        memberships: [membership(ownerUserId, 'pmb_OwnerMember001', 'active')],
        providerPrincipalFacts: [],
        contentReadiness: [],
        providerMembershipObservations: [],
        externalOperationJournal: [],
        recoveryActions: []
      }
    }))
  })
}

function principal(userId: string) {
  return {
    schemaVersion: 1 as const,
    type: 'provider_directory_principal_reference' as const,
    providerInstance,
    principalKind: 'user' as const,
    principalId: `principal-${userId}`
  }
}

function desiredMember(
  userId: string,
  providerPrincipalFactId: string,
  providerPrincipal: ReturnType<typeof principal>
) {
  return {
    userId,
    providerPrincipalFactId,
    snapshottedFactRevision: 1,
    principal: providerPrincipal
  }
}

function principalFact(
  userId: string,
  providerPrincipalFactId: string,
  providerPrincipal: ReturnType<typeof principal>
) {
  return {
    schemaVersion: 1 as const,
    type: 'provider_directory_principal_fact' as const,
    providerPrincipalFactId,
    userId,
    providerPrincipal,
    principalIdentityRevision: 1,
    providerBindingAttestationDigest: 'd'.repeat(64),
    publishedByDeviceId: 'dev_Device0000001',
    readiness: 'ready' as const,
    readinessReason: null,
    observedAt: now,
    revision: 1,
    createdAt: now,
    updatedAt: now
  }
}

function membership(
  userId: string,
  projectMembershipId: string,
  state: 'active' | 'pending_membership' | 'membership_removal_pending'
) {
  return {
    schemaVersion: 1 as const,
    type: 'project_membership' as const,
    projectMembershipId,
    projectId,
    userId,
    state,
    authorityEpoch: 1,
    activatedAt: state === 'pending_membership' ? null : now,
    removalRequestedAt: state === 'membership_removal_pending' ? now : null,
    removalRequestedByUserId: state === 'membership_removal_pending' ? ownerUserId : null,
    removedAt: null,
    revision: 1,
    createdAt: now,
    updatedAt: now
  }
}

function withUncertainCreateJournal(
  workspace: ProjectCoordinatorWorkspace,
  state: 'dispatched' | 'outcome_unknown'
): ProjectCoordinatorWorkspace {
  const project = workspace.projects[0]!
  const intent = project.provisioning.intent!
  return projectCoordinatorWorkspaceSchema.parse({
    ...workspace,
    projects: [{
      ...project,
      provisioning: {
        ...project.provisioning,
        externalOperationJournal: [{
          schemaVersion: 1,
          type: 'external_operation_recovery_journal_entry',
          contentRecoveryJournalEntryId: 'crj_CreateUncertain1',
          scope: 'project_provisioning',
          projectId,
          taskId: null,
          executionId: null,
          preparedTaskRevision: null,
          preparedExecutionRevision: null,
          provisioningIntentId: intent.provisioningIntentId,
          provisioningRevision: intent.provisioningRevision,
          logicalInvocationId: 'create-root-crash-window-001',
          operation: 'create_shared_container',
          state,
          requestDigest: 'a'.repeat(64),
          receiptDigest: null,
          observationDigest: null,
          safeFailureCode: state === 'outcome_unknown' ? 'transport_interrupted' : null,
          preparedAt: now,
          dispatchedAt: now,
          resolvedAt: null,
          revision: 2,
          createdAt: now,
          updatedAt: now
        }]
      }
    }]
  })
}

function applyInput(preview: Awaited<ReturnType<
  ReturnType<typeof createProjectCoordinatorProvisioningPort>['preview']
>>) {
  return {
    projectId: preview.projectId,
    provisioningIntentId: preview.provisioningIntentId,
    expectedProjectRevision: preview.expectedProjectRevision,
    expectedProvisioningRevision: preview.expectedProvisioningRevision,
    expectedProvisioningIntentRevision: preview.expectedProvisioningIntentRevision,
    intentDigest: preview.intentDigest,
    attemptId: preview.attemptId,
    confirmedPlanDigest: preview.confirmedPlanDigest
  }
}

function unusedTransport(): AuthenticatedCloudTransport {
  return {
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud.invalid/',
      userId: ownerUserId,
      deviceId: 'dev_Device0000001'
    }),
    execute: async () => { throw new Error('No Cloud write is expected.') }
  }
}

function unusedCapabilities(): DomainMainSystemCapabilityInvoker {
  return {
    invoke: async () => { throw new Error('unused') },
    createApprovedBatch: () => { throw new Error('unused') }
  }
}

function cloudHarness(): Readonly<{
  transport: AuthenticatedCloudTransport
  commandTypes: string[]
  readonly attestation: import('@sciforge/collaboration-contracts').ProjectContentProvisioningAttestation | undefined
  readonly rootLossObservation: import('@sciforge/collaboration-contracts').ProjectProviderMembershipObservation | undefined
}> {
  const commandTypes: string[] = []
  const journals = new Map<string, ExternalOperationRecoveryJournalEntry>()
  let journalOrdinal = 0
  let attestation: import('@sciforge/collaboration-contracts').ProjectContentProvisioningAttestation | undefined
  let rootLossObservation: import('@sciforge/collaboration-contracts').ProjectProviderMembershipObservation | undefined
  const transport: AuthenticatedCloudTransport = {
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud.invalid/',
      userId: ownerUserId,
      deviceId: 'dev_Device0000001'
    }),
    execute: async (request): Promise<AuthenticatedCloudResponse> => {
      const payload = request.payload
      commandTypes.push(payload.type)
      if (payload.type === 'external_operation.prepare') {
        const journal: ExternalOperationRecoveryJournalEntry = {
          schemaVersion: 1,
          type: 'external_operation_recovery_journal_entry',
          contentRecoveryJournalEntryId:
            `crj_Journal${String(++journalOrdinal).padStart(7, '0')}`,
          scope: payload.scope,
          projectId: payload.projectId,
          taskId: payload.taskId,
          executionId: payload.executionId,
          preparedTaskRevision: payload.preparedTaskRevision,
          preparedExecutionRevision: payload.preparedExecutionRevision,
          provisioningIntentId: payload.provisioningIntentId,
          provisioningRevision: payload.provisioningRevision,
          logicalInvocationId: payload.logicalInvocationId,
          operation: payload.operation,
          state: 'prepared',
          requestDigest: payload.requestDigest,
          receiptDigest: null,
          observationDigest: null,
          safeFailureCode: null,
          preparedAt: now,
          dispatchedAt: null,
          resolvedAt: null,
          revision: 1,
          createdAt: now,
          updatedAt: now
        }
        journals.set(journal.contentRecoveryJournalEntryId, journal)
        return cloudResponse({
          protocolVersion: '1.0', type: 'rest.entity', requestId: payload.requestId,
          entity: journal
        })
      }
      if (payload.type === 'external_operation.dispatch') {
        const current = journals.get(payload.journalEntryId)
        if (!current) throw new Error('Missing prepared journal.')
        const journal = {
          ...current,
          state: 'dispatched' as const,
          dispatchedAt: now,
          revision: current.revision + 1,
          updatedAt: now
        }
        journals.set(journal.contentRecoveryJournalEntryId, journal)
        return cloudResponse({
          protocolVersion: '1.0', type: 'rest.entity', requestId: payload.requestId,
          entity: journal
        })
      }
      if (payload.type === 'external_operation.observe') {
        const current = journals.get(payload.journalEntryId)
        if (!current) throw new Error('Missing dispatched journal.')
        const journal: ExternalOperationRecoveryJournalEntry = {
          ...current,
          state: payload.outcome,
          receiptDigest: payload.receiptDigest,
          observationDigest: payload.observationDigest,
          safeFailureCode: payload.safeFailureCode,
          resolvedAt: payload.outcome === 'outcome_unknown' ? null : now,
          revision: current.revision + 1,
          updatedAt: now
        }
        journals.set(journal.contentRecoveryJournalEntryId, journal)
        return cloudResponse({
          protocolVersion: '1.0', type: 'rest.collection', requestId: payload.requestId,
          items: [journal]
        })
      }
      if (payload.type === 'project.content.attest') {
        attestation = payload.attestation
        return cloudResponse({
          protocolVersion: '1.0', type: 'rest.collection', requestId: payload.requestId,
          items: [payload.attestation]
        })
      }
      if (payload.type === 'project.content.observation.submit') {
        rootLossObservation = payload.observation
        return cloudResponse({
          protocolVersion: '1.0', type: 'rest.collection', requestId: payload.requestId,
          items: [payload.observation]
        })
      }
      throw new Error(`Unexpected Cloud command ${payload.type}.`)
    }
  }
  return Object.freeze({
    transport,
    commandTypes,
    get attestation() { return attestation },
    get rootLossObservation() { return rootLossObservation }
  })
}

function cloudResponse(body: RestResponse): AuthenticatedCloudResponse {
  return { contractVersion: 1, status: 200, body }
}

function journalCommandTypes(operationCount: number): string[] {
  return Array.from({ length: operationCount }, () => [
    'external_operation.prepare',
    'external_operation.dispatch',
    'external_operation.observe'
  ]).flat()
}

function membershipCloudHarness(state: 'active' | 'pending_membership'): Readonly<{
  transport: AuthenticatedCloudTransport
  readonly command: Extract<
    import('@sciforge/collaboration-contracts').CloudStateCommand,
    { type: 'project.membership.add' }
  > | undefined
}> {
  let command: Extract<
    import('@sciforge/collaboration-contracts').CloudStateCommand,
    { type: 'project.membership.add' }
  > | undefined
  const transport: AuthenticatedCloudTransport = {
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud.invalid/',
      userId: ownerUserId,
      deviceId: 'dev_Device0000001'
    }),
    execute: async (request) => {
      if (request.payload.type !== 'project.membership.add') {
        throw new Error(`Unexpected command ${request.payload.type}.`)
      }
      command = request.payload
      return cloudResponse({
        protocolVersion: '1.0',
        type: 'rest.collection',
        requestId: command.requestId,
        items: [{
          ...membership(command.userId, 'pmb_DynamicMember01', state),
          state,
          activatedAt: state === 'active' ? now : null
        }]
      })
    }
  }
  return Object.freeze({ transport, get command() { return command } })
}

function membershipRemovalCloudHarness(
  state: 'membership_removal_pending' | 'removed'
): Readonly<{
  transport: AuthenticatedCloudTransport
  readonly command: Extract<
    import('@sciforge/collaboration-contracts').CloudStateCommand,
    { type: 'project.membership.remove' }
  > | undefined
}> {
  let command: Extract<
    import('@sciforge/collaboration-contracts').CloudStateCommand,
    { type: 'project.membership.remove' }
  > | undefined
  const transport: AuthenticatedCloudTransport = {
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud.invalid/',
      userId: ownerUserId,
      deviceId: 'dev_Device0000001'
    }),
    execute: async (request) => {
      if (request.payload.type !== 'project.membership.remove') {
        throw new Error(`Unexpected command ${request.payload.type}.`)
      }
      command = request.payload
      return cloudResponse({
        protocolVersion: '1.0',
        type: 'rest.collection',
        requestId: command.requestId,
        items: [{
          ...membership(workerUserId, command.projectMembershipId, 'membership_removal_pending'),
          state,
          removedAt: state === 'removed' ? now : null
        }]
      })
    }
  }
  return Object.freeze({ transport, get command() { return command } })
}
