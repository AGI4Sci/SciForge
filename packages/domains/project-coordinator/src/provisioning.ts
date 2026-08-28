import { createHash, randomUUID } from 'node:crypto'

import {
  CURRENT_PROTOCOL_VERSION,
  canonicalProjectContentProvisioningFactualPayloadBytes,
  canonicalProvisionedMemberSetBytes,
  externalOperationRecoveryJournalEntrySchema,
  projectContentProvisioningAttestationSchema,
  projectContentProvisioningFactualPayloadSchema,
  projectMembershipSchema,
  projectProviderMembershipObservationSchema,
  type ExternalOperationRecoveryJournalEntry,
  type ProjectContentProvisioningIntent,
  type ProjectContentProvisioningAttestation,
  type ProvisioningObservedOperation,
  type ProvisionedMemberObservation,
  type ProviderDirectoryPrincipalReference,
  type RestResponse
} from '@sciforge/collaboration-contracts'
import {
  AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
  type AuthenticatedCloudTransport
} from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import {
  CONTENT_SPACE_AUTHORIZE_AGENT_ROOT_CONTRACT,
  CONTENT_SPACE_PROVISIONING_BATCH_GRANT_ID,
  type ContentSpaceResult
} from '@sciforge/domain-content-space/contract'
import {
  CONTENT_SPACE_AGENT_ADMIN_ADD_MEMBER_CONTRACT,
  CONTENT_SPACE_AGENT_ADMIN_CREATE_SPACE_CONTRACT,
  CONTENT_SPACE_AGENT_ADMIN_LIST_MEMBERS_CONTRACT,
  CONTENT_SPACE_AGENT_ADMIN_OBSERVE_SPACE_CONTRACT,
  CONTENT_SPACE_AGENT_ADMIN_REMOVE_MEMBER_CONTRACT,
  CONTENT_SPACE_AUTHORIZE_PROVIDER_ADMINISTRATION_CONTRACT,
  type ContentSpaceAgentAdministrationMemberPage,
  type ContentSpaceAgentAdministrationSpaceSummary
} from '@sciforge/domain-content-space/administration-contract'
import {
  canonicalizeDomainMainFiniteCapabilityBatchPlan,
  domainMainFiniteCapabilityBatchPlanSchema,
  type DomainCapabilityContract,
  type DomainMainApprovedCapabilityBatch,
  type DomainMainFiniteCapabilityBatchPlan,
  type DomainMainSystemCapabilityInvoker
} from '@sciforge/domain-sdk/host'

import {
  projectCoordinatorMembershipAddInputSchema,
  projectCoordinatorMembershipAcceptInputSchema,
  projectCoordinatorMembershipRemoveInputSchema,
  projectCoordinatorProvisioningPlanSchema,
  projectCoordinatorWorkflowContinueInputSchema,
  projectCoordinatorWorkflowPlanSchema,
  projectCoordinatorWorkflowPrepareInputSchema,
  projectCoordinatorWorkspaceSchema,
  type ProjectCoordinatorMembershipAddInput,
  type ProjectCoordinatorMembershipAcceptInput,
  type ProjectCoordinatorMembershipRemoveInput,
  type ProjectCoordinatorProject,
  type ProjectCoordinatorProvisioningPlan,
  type ProjectCoordinatorWorkflowContinueInput,
  type ProjectCoordinatorWorkflowPlan,
  type ProjectCoordinatorWorkflowPrepareInput,
  type ProjectCoordinatorWorkspace
} from './contract.js'
import type {
  ProjectContentProvisioningAttestationSigningPort,
  ProjectCoordinatorPlanPort
} from './ports.js'

type WorkspaceReader = Readonly<{
  readWorkspace(input: Readonly<{ projectId?: string }>): Promise<ProjectCoordinatorWorkspace>
}>

export type ProjectCoordinatorProvisioningPort = Readonly<{
  prepareWorkflow(input: ProjectCoordinatorWorkflowPrepareInput): Promise<ProjectCoordinatorWorkflowPlan>
  continueWorkflow(
    input: ProjectCoordinatorWorkflowContinueInput,
    idempotencyKey: string
  ): Promise<ProjectCoordinatorWorkspace>
  addMember(
    input: ProjectCoordinatorMembershipAddInput,
    idempotencyKey: string
  ): Promise<ProjectCoordinatorWorkspace>
  acceptInvitation(
    input: ProjectCoordinatorMembershipAcceptInput,
    idempotencyKey: string
  ): Promise<ProjectCoordinatorWorkspace>
  removeMember(
    input: ProjectCoordinatorMembershipRemoveInput,
    idempotencyKey: string
  ): Promise<ProjectCoordinatorWorkspace>
}>

type ProvisioningOptions = Readonly<{
  workspace: WorkspaceReader
  transport: AuthenticatedCloudTransport
  signing: ProjectContentProvisioningAttestationSigningPort
  activateAndReconcile: ProjectCoordinatorPlanPort['activateAndReconcile']
  getCapabilities(): DomainMainSystemCapabilityInvoker
  now?: () => Date
  attemptId?: () => string
  attestationId?: () => `pca_${string}`
  providerObservationId?: () => `pob_${string}`
  requestId?: () => `req_${string}`
}>

type BuiltProvisioningPlan = Readonly<{
  plan: ProjectCoordinatorProvisioningPlan
  batch: DomainMainFiniteCapabilityBatchPlan
  project: ProjectCoordinatorProject
  intent: ProjectContentProvisioningIntent
  rootResourceOperationId: string
}>

type JournalledResult<Value> = Readonly<{
  value: Value
  observedOperation: ProvisioningObservedOperation
  journal: ExternalOperationRecoveryJournalEntry
}>

export function createProjectCoordinatorProvisioningPort(
  options: ProvisioningOptions
): ProjectCoordinatorProvisioningPort {
  const now = options.now ?? (() => new Date())
  const attemptId = options.attemptId ?? (() => `attempt_${randomUUID().replaceAll('-', '')}`)
  const attestationId = options.attestationId ?? (() => `pca_${randomUUID().replaceAll('-', '')}`)
  const providerObservationId = options.providerObservationId ?? (
    () => `pob_${randomUUID().replaceAll('-', '')}`
  )
  const requestId = options.requestId ?? (() => `req_${randomUUID().replaceAll('-', '')}`)

  const readVisibleProject = async (
    projectId: string
  ): Promise<Readonly<{
    project: ProjectCoordinatorProject
    currentUserId: string
  }>> => {
    const workspace = projectCoordinatorWorkspaceSchema.parse(
      await options.workspace.readWorkspace({ projectId })
    )
    if (workspace.connection.state !== 'ready') {
      throw new Error(`Project workflow is ${workspace.connection.state}.`)
    }
    const project = workspace.projects.find((candidate) => (
      candidate.project.projectId === projectId
    ))
    if (!project) throw new Error('The exact Project is not visible to the current OIDC User.')
    return { project, currentUserId: workspace.connection.userId }
  }

  const readOwnerProject = async (
    projectId: string,
    contentRequired = false
  ): Promise<ProjectCoordinatorProject> => {
    const { project, currentUserId } = await readVisibleProject(projectId)
    if (currentUserId !== project.project.ownerUserId) {
      throw new Error('Only the OIDC Project Owner may manage Project membership or content.')
    }
    if (contentRequired && project.project.contentMode !== 'required') {
      throw new Error('Only a content-required Project has a provisioning plan.')
    }
    return project
  }

  const build = async (
    projectId: string,
    stableAttemptId: string
  ): Promise<BuiltProvisioningPlan> => {
    const project = await readOwnerProject(projectId, true)
    const intent = project.provisioning.intent
    if (!intent || ['completed', 'superseded', 'cancelled'].includes(intent.state)) {
      throw new Error('The Project has no current recoverable provisioning intent.')
    }
    if (intent.contentOwnerUserId !== project.project.ownerUserId) {
      throw new Error('Run-0 provisioning requires the Project Owner as Content Owner.')
    }
    const createJournal = project.provisioning.externalOperationJournal.find((journal) => (
      journal.provisioningIntentId === intent.provisioningIntentId &&
      journal.provisioningRevision === intent.provisioningRevision &&
      journal.operation === 'create_shared_container' &&
      (journal.state === 'dispatched' ||
        journal.state === 'observed_success' ||
        journal.state === 'outcome_unknown')
    ))
    const rootStrategy = intent.currentRootLocator !== null || createJournal
      ? 'reauthorize' as const
      : 'create' as const
    const built = buildFinitePlan(project, intent, stableAttemptId, rootStrategy)
    const confirmedPlanDigest = digestFinitePlan(built.batch)
    return Object.freeze({
      ...built,
      plan: projectCoordinatorProvisioningPlanSchema.parse({
        projectId: project.project.projectId,
        provisioningIntentId: intent.provisioningIntentId,
        expectedProjectRevision: project.project.revision,
        expectedProvisioningRevision: intent.provisioningRevision,
        expectedProvisioningIntentRevision: intent.revision,
        intentDigest: intent.intentDigest,
        attemptId: stableAttemptId,
        rootStrategy,
        providerInstance: intent.providerInstance,
        containerDisplayName: intent.containerDisplayName,
        currentRootLocator: intent.currentRootLocator,
        operations: built.operations,
        confirmedPlanDigest
      })
    })
  }

  const prepareWorkflow = async (
    rawInput: ProjectCoordinatorWorkflowPrepareInput,
    stableAttemptId = attemptId()
  ): Promise<ProjectCoordinatorWorkflowPlan> => {
    const input = projectCoordinatorWorkflowPrepareInputSchema.parse(rawInput)
    const project = await readOwnerProject(input.projectId)
    const plan = project.plan?.plan
    if (!plan || plan.state !== 'confirmed') {
      throw new Error('Project workflow requires the exact current confirmed Plan.')
    }
    if (project.project.status !== 'paused' && project.project.status !== 'active') {
      throw new Error('Only a paused launch or active Team reconcile can prepare a Project workflow.')
    }
    const currentMemberships = project.provisioning.memberships.filter(({ state }) => (
      state !== 'removed'
    ))
    if (currentMemberships.some(({ state }) => state === 'invited')) {
      throw new Error('Every invited OIDC User must accept the confirmed Plan before Team provisioning.')
    }
    const purpose = project.project.status === 'active' ? 'team_reconcile' as const : 'launch' as const
    const intent = project.provisioning.intent
    const needsProvisioning = project.project.contentMode === 'required' && intent !== null &&
      !['completed', 'superseded', 'cancelled'].includes(intent.state)
    const provisioning = needsProvisioning
      ? (await build(input.projectId, stableAttemptId)).plan
      : null
    if (purpose === 'team_reconcile' && provisioning === null) {
      throw new Error('The active Project has no pending Team reconcile workflow.')
    }
    if (
      purpose === 'launch' &&
      project.project.contentMode === 'required' &&
      project.provisioning.binding?.status !== 'active' &&
      provisioning === null
    ) {
      throw new Error('The content-required Project has no executable Team provisioning intent.')
    }
    if (purpose === 'launch' && provisioning === null && currentMemberships.some(({ state }) => (
      state !== 'active'
    ))) {
      throw new Error('Every Project Membership must be active before a content-free launch.')
    }
    const facts = {
      projectId: project.project.projectId,
      projectPlanId: plan.projectPlanId,
      expectedProjectRevision: project.project.revision,
      expectedCoordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch,
      expectedExecutionAuthorityEpoch: project.project.executionAuthorityEpoch,
      expectedPlanRevision: plan.revision,
      planDigest: plan.planDigest,
      purpose,
      provisioning
    }
    return projectCoordinatorWorkflowPlanSchema.parse({
      ...facts,
      workflowDigest: stableDigest(facts)
    })
  }

  return Object.freeze({
    prepareWorkflow,
    continueWorkflow: async (rawInput, baseIdempotencyKey) => {
      const input = projectCoordinatorWorkflowContinueInputSchema.parse(rawInput)
      const current = await prepareWorkflow(
        { projectId: input.projectId },
        input.provisioning?.attemptId
      )
      if (stableDigest(current) !== stableDigest(input)) {
        throw new Error('Cloud facts changed after workflow preparation; confirm a fresh Project workflow.')
      }
      if (input.provisioning !== null) {
        const built = await build(input.projectId, input.provisioning.attemptId)
        assertProvisioningPlanStillCurrent(input.provisioning, built.plan)
        const capabilities = options.getCapabilities()
        const batch = capabilities.createApprovedBatch(built.batch)
        if (batch.planDigest !== input.provisioning.confirmedPlanDigest) {
          batch.discard()
          throw new Error('The Host captured a different Team provisioning plan digest.')
        }
        try {
          await executeProvisioning({
            options,
            requestId,
            now,
            attestationId,
            providerObservationId,
            baseIdempotencyKey: scopedIdempotencyKey(baseIdempotencyKey, 'team'),
            built,
            batch
          })
        } finally {
          batch.discard()
        }
      }
      if (input.purpose === 'launch') {
        return options.activateAndReconcile({
          projectId: input.projectId,
          projectPlanId: input.projectPlanId,
          expectedCoordinatorAuthorityEpoch: input.expectedCoordinatorAuthorityEpoch,
          expectedExecutionAuthorityEpoch: input.expectedExecutionAuthorityEpoch,
          expectedPlanRevision: input.expectedPlanRevision,
          planDigest: input.planDigest
        }, scopedIdempotencyKey(baseIdempotencyKey, 'launch'))
      }
      const workspace = projectCoordinatorWorkspaceSchema.parse(
        await options.workspace.readWorkspace({ projectId: input.projectId })
      )
      const reconciled = workspace.projects.find(({ project }) => project.projectId === input.projectId)
      if (!reconciled || reconciled.project.status !== 'active' ||
        reconciled.provisioning.memberships.some(({ state }) => (
          state !== 'active' && state !== 'removed'
        ))) {
        throw new Error('Team reconcile did not produce fresh active Membership facts.')
      }
      return workspace
    },
    addMember: async (rawInput, baseIdempotencyKey) => {
      const input = projectCoordinatorMembershipAddInputSchema.parse(rawInput)
      const project = await readOwnerProject(input.projectId)
      if (project.project.revision !== input.expectedProjectRevision) {
        throw new Error('Project changed before the member add confirmation.')
      }
      const response = await executeUserCloud(options.transport, {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: requestId(),
        type: 'project.membership.add',
        idempotencyKey: scopedIdempotencyKey(baseIdempotencyKey, 'membership-add'),
        ...input
      })
      const membership = response.type === 'rest.collection'
        ? response.items.map((item) => projectMembershipSchema.safeParse(item))
          .find((parsed) => parsed.success && parsed.data.userId === input.userId)?.data
        : undefined
      if (!membership || membership.projectId !== input.projectId ||
        membership.state !== 'invited') {
        throw new Error('Project member add did not create the canonical OIDC User invitation.')
      }
      return options.workspace.readWorkspace({ projectId: input.projectId })
    },
    acceptInvitation: async (rawInput, baseIdempotencyKey) => {
      const input = projectCoordinatorMembershipAcceptInputSchema.parse(rawInput)
      const { project, currentUserId } = await readVisibleProject(input.projectId)
      const invitation = project.provisioning.memberships.find(({ projectMembershipId }) => (
        projectMembershipId === input.projectMembershipId
      ))
      if (!invitation || invitation.userId !== currentUserId || invitation.state !== 'invited') {
        throw new Error('Only the exact invited OIDC User may accept this Project invitation.')
      }
      if (
        project.project.revision !== input.expectedProjectRevision ||
        project.plan?.plan.projectPlanId !== input.projectPlanId ||
        project.plan.plan.revision !== input.expectedPlanRevision ||
        project.plan.plan.planDigest !== input.planDigest ||
        project.plan.plan.state !== 'confirmed'
      ) {
        throw new Error('Project invitation acceptance lost the exact current confirmed Plan.')
      }
      const response = await executeUserCloud(options.transport, {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: requestId(),
        type: 'project.membership.accept',
        idempotencyKey: scopedIdempotencyKey(baseIdempotencyKey, 'membership-accept'),
        ...input
      })
      const membership = response.type === 'rest.collection'
        ? response.items.map((item) => projectMembershipSchema.safeParse(item))
          .find((parsed) => parsed.success && (
            parsed.data.projectMembershipId === input.projectMembershipId
          ))?.data
        : undefined
      const expectedState = project.project.contentMode === 'required'
        ? 'pending_membership' as const
        : 'active' as const
      if (!membership || membership.userId !== currentUserId || membership.state !== expectedState) {
        throw new Error('Cloud did not return the accepted Project Membership state.')
      }
      return options.workspace.readWorkspace({ projectId: input.projectId })
    },
    removeMember: async (rawInput, baseIdempotencyKey) => {
      const input = projectCoordinatorMembershipRemoveInputSchema.parse(rawInput)
      const project = await readOwnerProject(input.projectId)
      if (project.project.revision !== input.expectedProjectRevision) {
        throw new Error('Project changed before the member removal confirmation.')
      }
      const response = await executeUserCloud(options.transport, {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: requestId(),
        type: 'project.membership.remove',
        idempotencyKey: scopedIdempotencyKey(baseIdempotencyKey, 'membership-remove'),
        ...input
      })
      const membership = response.type === 'rest.collection'
        ? response.items.map((item) => projectMembershipSchema.safeParse(item))
          .find((parsed) => parsed.success && (
            parsed.data.projectMembershipId === input.projectMembershipId
          ))?.data
        : undefined
      const currentMembership = project.provisioning.memberships.find(({ projectMembershipId }) => (
        projectMembershipId === input.projectMembershipId
      ))
      const expectedState = project.project.contentMode === 'required' &&
        currentMembership?.state !== 'invited'
        ? 'membership_removal_pending' as const
        : 'removed' as const
      if (!membership || membership.projectId !== input.projectId ||
        membership.state !== expectedState) {
        throw new Error(expectedState === 'membership_removal_pending'
          ? 'Content-required member removal did not remain safety-fenced pending.'
          : 'The invitation or content-free Membership removal did not complete immediately.')
      }
      return options.workspace.readWorkspace({ projectId: input.projectId })
    }
  })
}

function buildFinitePlan(
  project: ProjectCoordinatorProject,
  intent: ProjectContentProvisioningIntent,
  attemptId: string,
  rootStrategy: 'create' | 'reauthorize'
): Readonly<{
  batch: DomainMainFiniteCapabilityBatchPlan
  operations: ProjectCoordinatorProvisioningPlan['operations']
  project: ProjectCoordinatorProject
  intent: ProjectContentProvisioningIntent
  rootResourceOperationId: string
}> {
  const operations: Array<DomainMainFiniteCapabilityBatchPlan['operations'][number]> = []
  const summaries: Array<ProjectCoordinatorProvisioningPlan['operations'][number]> = []
  const add = (
    operation: DomainMainFiniteCapabilityBatchPlan['operations'][number],
    summary: ProjectCoordinatorProvisioningPlan['operations'][number]
  ) => {
    operations.push(operation)
    summaries.push(summary)
  }
  let rootResourceOperationId: string
  if (rootStrategy === 'create') {
    add({
      operationId: 'authorize-provider',
      actionId: CONTENT_SPACE_AUTHORIZE_PROVIDER_ADMINISTRATION_CONTRACT.actionId,
      idempotencyKey: operationIdempotencyKey(attemptId, 'authorize-provider'),
      input: { providerInstanceRef: intent.providerInstance.providerInstanceRef }
    }, {
      operationId: 'authorize-provider',
      actionId: CONTENT_SPACE_AUTHORIZE_PROVIDER_ADMINISTRATION_CONTRACT.actionId,
      kind: 'authorize_provider',
      userId: null
    })
    rootResourceOperationId = 'create-root'
    add({
      operationId: rootResourceOperationId,
      actionId: CONTENT_SPACE_AGENT_ADMIN_CREATE_SPACE_CONTRACT.actionId,
      idempotencyKey: operationIdempotencyKey(attemptId, rootResourceOperationId),
      input: { label: intent.containerDisplayName },
      resource: {
        kind: 'operation-output',
        operationId: 'authorize-provider',
        path: ['value', 'resource']
      }
    }, {
      operationId: rootResourceOperationId,
      actionId: CONTENT_SPACE_AGENT_ADMIN_CREATE_SPACE_CONTRACT.actionId,
      kind: 'create_shared_container',
      userId: null
    })
  } else {
    rootResourceOperationId = 'authorize-root'
    add({
      operationId: rootResourceOperationId,
      actionId: CONTENT_SPACE_AUTHORIZE_AGENT_ROOT_CONTRACT.actionId,
      idempotencyKey: operationIdempotencyKey(attemptId, rootResourceOperationId),
      input: {
        providerInstanceRef: intent.providerInstance.providerInstanceRef,
        scope: 'shared',
        label: intent.containerDisplayName
      }
    }, {
      operationId: rootResourceOperationId,
      actionId: CONTENT_SPACE_AUTHORIZE_AGENT_ROOT_CONTRACT.actionId,
      kind: 'authorize_root',
      userId: null
    })
  }
  const rootResource = {
    kind: 'operation-output' as const,
    operationId: rootResourceOperationId,
    path: ['value', 'resource']
  }
  add({
    operationId: 'observe-root',
    actionId: CONTENT_SPACE_AGENT_ADMIN_OBSERVE_SPACE_CONTRACT.actionId,
    input: {},
    resource: rootResource
  }, {
    operationId: 'observe-root',
    actionId: CONTENT_SPACE_AGENT_ADMIN_OBSERVE_SPACE_CONTRACT.actionId,
    kind: 'observe_root',
    userId: null
  })
  add({
    operationId: 'list-before',
    actionId: CONTENT_SPACE_AGENT_ADMIN_LIST_MEMBERS_CONTRACT.actionId,
    input: { page: { limit: 200 } },
    resource: rootResource
  }, {
    operationId: 'list-before',
    actionId: CONTENT_SPACE_AGENT_ADMIN_LIST_MEMBERS_CONTRACT.actionId,
    kind: 'list_members',
    userId: null
  })
  intent.desiredMembers.forEach((member, index) => {
    const operationId = `add-member-${String(index + 1).padStart(3, '0')}`
    add({
      operationId,
      actionId: CONTENT_SPACE_AGENT_ADMIN_ADD_MEMBER_CONTRACT.actionId,
      idempotencyKey: operationIdempotencyKey(attemptId, operationId),
      input: { member: directoryUser(member.principal) },
      resource: rootResource
    }, {
      operationId,
      actionId: CONTENT_SPACE_AGENT_ADMIN_ADD_MEMBER_CONTRACT.actionId,
      kind: 'add_member',
      userId: member.userId
    })
  })
  const removals = project.provisioning.memberships.filter(({ state }) => (
    state === 'membership_removal_pending'
  ))
  removals.forEach((membership, index) => {
    const readiness = project.provisioning.contentReadiness.find(({ userId }) => (
      userId === membership.userId
    ))
    if (!readiness?.providerPrincipal) {
      throw new Error(`Removal-pending User ${membership.userId} lacks an exact Provider snapshot.`)
    }
    const operationId = `remove-member-${String(index + 1).padStart(3, '0')}`
    add({
      operationId,
      actionId: CONTENT_SPACE_AGENT_ADMIN_REMOVE_MEMBER_CONTRACT.actionId,
      idempotencyKey: operationIdempotencyKey(attemptId, operationId),
      input: { member: directoryUser(readiness.providerPrincipal) },
      resource: rootResource
    }, {
      operationId,
      actionId: CONTENT_SPACE_AGENT_ADMIN_REMOVE_MEMBER_CONTRACT.actionId,
      kind: 'remove_member',
      userId: membership.userId
    })
  })
  add({
    operationId: 'list-after',
    actionId: CONTENT_SPACE_AGENT_ADMIN_LIST_MEMBERS_CONTRACT.actionId,
    input: { page: { limit: 200 } },
    resource: rootResource
  }, {
    operationId: 'list-after',
    actionId: CONTENT_SPACE_AGENT_ADMIN_LIST_MEMBERS_CONTRACT.actionId,
    kind: 'list_members',
    userId: null
  })
  const batch = domainMainFiniteCapabilityBatchPlanSchema.parse({
    requiredSystemCapabilityGrant: CONTENT_SPACE_PROVISIONING_BATCH_GRANT_ID,
    revision: `project-content:${project.project.projectId}:${intent.provisioningIntentId}:${intent.provisioningRevision}:${attemptId}`,
    operations
  })
  return Object.freeze({
    batch,
    operations: projectCoordinatorProvisioningPlanSchema.unwrap().shape.operations.parse(summaries),
    project,
    intent,
    rootResourceOperationId
  })
}

async function executeProvisioning(input: Readonly<{
  options: ProvisioningOptions
  requestId(): `req_${string}`
  now(): Date
  attestationId(): `pca_${string}`
  providerObservationId(): `pob_${string}`
  baseIdempotencyKey: string
  built: BuiltProvisioningPlan
  batch: DomainMainApprovedCapabilityBatch
}>): Promise<ProjectCoordinatorWorkspace> {
  const { options, built, batch } = input
  const observedOperations: ProvisioningObservedOperation[] = []
  const startedAt = input.now().toISOString()
  if (built.plan.rootStrategy === 'create') {
    const authorization = await batch.invoke(
      'authorize-provider',
      CONTENT_SPACE_AUTHORIZE_PROVIDER_ADMINISTRATION_CONTRACT
    )
    requireContentSuccess(authorization, 'Provider administration authorization')
    const created = await executeJournalledOperation({
      ...input,
      operationId: 'create-root',
      operation: 'create_shared_container',
      subjectPrincipal: null,
      contract: CONTENT_SPACE_AGENT_ADMIN_CREATE_SPACE_CONTRACT,
      receipt: (value) => value.space
    })
    observedOperations.push(created.observedOperation)
  }

  const rootObservation = await executeRootObservation(input)
  const rootSummary: ContentSpaceAgentAdministrationSpaceSummary = rootObservation.value
  observedOperations.push(rootObservation.observedOperation)

  const before = await executeJournalledOperation({
    ...input,
    operationId: 'list-before',
    operation: 'list_members',
    subjectPrincipal: null,
    contract: CONTENT_SPACE_AGENT_ADMIN_LIST_MEMBERS_CONTRACT,
    receipt: (value) => value
  })
  requireCompleteMemberPage(before.value)
  observedOperations.push(before.observedOperation)

  for (const [index, member] of built.intent.desiredMembers.entries()) {
    const result = await executeJournalledOperation({
      ...input,
      operationId: `add-member-${String(index + 1).padStart(3, '0')}`,
      operation: 'add_member',
      subjectPrincipal: member.principal,
      contract: CONTENT_SPACE_AGENT_ADMIN_ADD_MEMBER_CONTRACT,
      receipt: (value) => value
    })
    observedOperations.push(result.observedOperation)
  }

  const removals = built.project.provisioning.memberships.filter(({ state }) => (
    state === 'membership_removal_pending'
  ))
  for (const [index, membership] of removals.entries()) {
    const readiness = requiredReadiness(built.project, membership.userId)
    const result = await executeJournalledOperation({
      ...input,
      operationId: `remove-member-${String(index + 1).padStart(3, '0')}`,
      operation: 'remove_member',
      subjectPrincipal: readiness.providerPrincipal!,
      contract: CONTENT_SPACE_AGENT_ADMIN_REMOVE_MEMBER_CONTRACT,
      receipt: (value) => value
    })
    observedOperations.push(result.observedOperation)
  }

  const after = await executeJournalledOperation({
    ...input,
    operationId: 'list-after',
    operation: 'list_members',
    subjectPrincipal: null,
    contract: CONTENT_SPACE_AGENT_ADMIN_LIST_MEMBERS_CONTRACT,
    receipt: (value) => value
  })
  requireCompleteMemberPage(after.value)
  observedOperations.push(after.observedOperation)

  const completedAt = after.journal.resolvedAt ?? input.now().toISOString()
  const memberObservations = buildMemberObservations(
    built.project,
    built.intent,
    after.value,
    completedAt
  )
  const ownerSnapshot = built.intent.desiredMembers.find(({ userId }) => (
    userId === built.intent.contentOwnerUserId
  ))
  if (!ownerSnapshot) throw new Error('Provisioning intent lacks the exact Content Owner snapshot.')
  const ownerFact = built.project.provisioning.providerPrincipalFacts.find((fact) => (
    fact.userId === ownerSnapshot.userId &&
    fact.providerPrincipalFactId === ownerSnapshot.providerPrincipalFactId &&
    fact.revision === ownerSnapshot.snapshottedFactRevision
  ))
  if (!ownerFact || ownerFact.readiness !== 'ready') {
    throw new Error('The exact Content Owner Provider fact is no longer ready.')
  }
  const factual = projectContentProvisioningFactualPayloadSchema.parse({
    format: 'sciforge.project-content-provisioning-attestation.v1',
    provisioningAttestationId: input.attestationId(),
    projectId: built.project.project.projectId,
    provisioningIntentId: built.intent.provisioningIntentId,
    provisioningRevision: built.intent.provisioningRevision,
    ownerUserId: built.intent.contentOwnerUserId,
    principalIdentityRevision: ownerFact.principalIdentityRevision,
    providerBindingAttestationDigest: ownerFact.providerBindingAttestationDigest,
    providerInstance: built.intent.providerInstance,
    rootLocator: rootSummary.root,
    rootLocatorDigest: stableDigest(rootSummary.root),
    observedOperations,
    memberObservations,
    memberSetDigest: sha256(canonicalProvisionedMemberSetBytes(memberObservations)),
    observationStartedAt: startedAt,
    observationCompletedAt: completedAt
  })
  const factualDigest = sha256(canonicalProjectContentProvisioningFactualPayloadBytes(factual))
  const deviceSignature = await options.signing.signFactualPayload({
    factDigest: factualDigest,
    factRevision: factual.provisioningRevision,
    observedAt: factual.observationCompletedAt
  })
  const attestation = projectContentProvisioningAttestationSchema.parse({
    schemaVersion: 1,
    type: 'project_content_provisioning_attestation',
    ...factual,
    deviceSignature,
    revision: 1,
    createdAt: factual.observationCompletedAt,
    updatedAt: factual.observationCompletedAt
  })
  const response = await executeUserCloud(options.transport, {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    requestId: input.requestId(),
    type: 'project.content.attest',
    idempotencyKey: scopedIdempotencyKey(input.baseIdempotencyKey, 'attest'),
    projectId: built.project.project.projectId,
    expectedProjectRevision: built.project.project.revision,
    expectedProvisioningRevision: built.intent.provisioningRevision,
    attestation
  })
  const returned = response.type === 'rest.collection'
    ? response.items.map((item) => projectContentProvisioningAttestationSchema.safeParse(item))
      .find((parsed) => parsed.success && (
        parsed.data.provisioningAttestationId === attestation.provisioningAttestationId
      ))?.data
    : undefined
  if (!returned || stableDigest(returned) !== stableDigest(attestation)) {
    throw new Error('Cloud did not return the exact Device-signed provisioning attestation.')
  }
  return options.workspace.readWorkspace({ projectId: built.project.project.projectId })
}

async function executeRootObservation(input: Parameters<typeof executeProvisioning>[0]): Promise<
  JournalledResult<ContentSpaceAgentAdministrationSpaceSummary>
> {
  const prepared = await prepareAndDispatch(input, 'observe-root', 'observe_root', null)
  try {
    if (input.built.plan.rootStrategy === 'reauthorize') {
      const authorized = await input.batch.invoke(
        'authorize-root',
        CONTENT_SPACE_AUTHORIZE_AGENT_ROOT_CONTRACT
      )
      if (!authorized.ok) {
        await observeFailure(input, prepared, authorized.error.code)
        if (authorized.error.code === 'unauthorized') {
          await submitOwnerRootLossObservation(input, authorized.error.code)
        }
        throw provisioningFailure(`Content root authorization failed: ${authorized.error.code}.`)
      }
    }
    const observed = await input.batch.invoke(
      'observe-root',
      CONTENT_SPACE_AGENT_ADMIN_OBSERVE_SPACE_CONTRACT
    )
    if (!observed.ok) {
      await observeFailure(input, prepared, observed.error.code)
      if (observed.error.code === 'unauthorized') {
        await submitOwnerRootLossObservation(input, observed.error.code)
      }
      throw provisioningFailure(`Content root observation failed: ${observed.error.code}.`)
    }
    if (input.built.intent.currentRootLocator !== null &&
      stableDigest(observed.value.root) !== stableDigest(
        input.built.intent.currentRootLocator
      )) {
      await observeFailure(input, prepared, 'invalid_target')
      throw provisioningFailure(
        'The live Provider root differs from the exact Cloud provisioning intent root.'
      )
    }
    return observeSuccess(input, prepared, observed.value, null)
  } catch (error) {
    if (prepared.state === 'dispatched' && !isKnownProvisioningFailure(error)) {
      await observeFailure(input, prepared, 'outcome_unknown')
    }
    throw error
  }
}

async function executeJournalledOperation<Input, Value>(input: Readonly<
  Parameters<typeof executeProvisioning>[0] & {
    operationId: string
    operation: 'create_shared_container' | 'list_members' | 'add_member' | 'remove_member'
    subjectPrincipal: ProviderDirectoryPrincipalReference | null
    contract: DomainCapabilityContract<Input, ContentSpaceResult<Value>>
    receipt(value: Value): unknown
  }
>): Promise<JournalledResult<Value>> {
  const prepared = await prepareAndDispatch(
    input,
    input.operationId,
    input.operation,
    input.subjectPrincipal
  )
  try {
    const result = await input.batch.invoke(input.operationId, input.contract)
    if (!result.ok) {
      await observeFailure(input, prepared, result.error.code)
      throw provisioningFailure(
        `Content Space ${input.operation} failed: ${result.error.code}.`
      )
    }
    return observeSuccess(input, prepared, input.receipt(result.value), input.subjectPrincipal, result.value)
  } catch (error) {
    if (!isKnownProvisioningFailure(error)) {
      await observeFailure(input, prepared, 'outcome_unknown')
    }
    throw error
  }
}

async function prepareAndDispatch(
  input: Parameters<typeof executeProvisioning>[0],
  operationId: string,
  operation: 'create_shared_container' | 'observe_root' | 'list_members' | 'add_member' | 'remove_member',
  subjectPrincipal: ProviderDirectoryPrincipalReference | null
): Promise<ExternalOperationRecoveryJournalEntry> {
  const logicalInvocationId = `pcp:${stableDigest({
    attemptId: input.built.plan.attemptId,
    operationId
  }).slice(0, 48)}`
  const requestDigest = stableDigest({
    planDigest: input.built.plan.confirmedPlanDigest,
    operationId,
    operation,
    subjectPrincipal,
    intentDigest: input.built.intent.intentDigest
  })
  const scope = input.built.intent.kind === 'membership_change'
    ? 'project_membership' as const
    : 'project_provisioning' as const
  const preparedResponse = await executeUserCloud(input.options.transport, {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    requestId: input.requestId(),
    type: 'external_operation.prepare',
    idempotencyKey: operationIdempotencyKey(input.baseIdempotencyKey, `${operationId}:prepare`),
    scope,
    projectId: input.built.project.project.projectId,
    taskId: null,
    executionId: null,
    preparedTaskRevision: null,
    preparedExecutionRevision: null,
    provisioningIntentId: input.built.intent.provisioningIntentId,
    provisioningRevision: input.built.intent.provisioningRevision,
    logicalInvocationId,
    operation,
    requestDigest
  })
  if (preparedResponse.type !== 'rest.entity') {
    throw new Error(`External operation prepare returned ${preparedResponse.type}.`)
  }
  const prepared = externalOperationRecoveryJournalEntrySchema.parse(preparedResponse.entity)
  if (prepared.logicalInvocationId !== logicalInvocationId || prepared.state !== 'prepared') {
    throw new Error('External operation prepare did not return the exact fresh journal entry.')
  }
  const dispatchedResponse = await executeUserCloud(input.options.transport, {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    requestId: input.requestId(),
    type: 'external_operation.dispatch',
    idempotencyKey: operationIdempotencyKey(input.baseIdempotencyKey, `${operationId}:dispatch`),
    journalEntryId: prepared.contentRecoveryJournalEntryId,
    expectedJournalRevision: prepared.revision
  })
  if (dispatchedResponse.type !== 'rest.entity') {
    throw new Error(`External operation dispatch returned ${dispatchedResponse.type}.`)
  }
  const dispatched = externalOperationRecoveryJournalEntrySchema.parse(dispatchedResponse.entity)
  if (dispatched.contentRecoveryJournalEntryId !== prepared.contentRecoveryJournalEntryId ||
    dispatched.state !== 'dispatched') {
    throw new Error('External operation dispatch did not return the exact journal entry.')
  }
  return dispatched
}

async function observeSuccess<Value>(
  input: Parameters<typeof executeProvisioning>[0],
  dispatched: ExternalOperationRecoveryJournalEntry,
  portableReceipt: unknown,
  subjectPrincipal: ProviderDirectoryPrincipalReference | null,
  value?: Value
): Promise<JournalledResult<Value>> {
  const receiptDigest = stableDigest(portableReceipt)
  const observationDigest = stableDigest({
    operation: dispatched.operation,
    receipt: portableReceipt
  })
  const response = await executeUserCloud(input.options.transport, {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    requestId: input.requestId(),
    type: 'external_operation.observe',
    idempotencyKey: operationIdempotencyKey(
      input.baseIdempotencyKey,
      `${dispatched.logicalInvocationId}:success`
    ),
    journalEntryId: dispatched.contentRecoveryJournalEntryId,
    expectedJournalRevision: dispatched.revision,
    outcome: 'observed_success',
    receiptDigest,
    observationDigest,
    safeFailureCode: null
  })
  const observed = collectionJournal(response, dispatched.contentRecoveryJournalEntryId)
  if (observed.state !== 'observed_success' || !observed.resolvedAt) {
    throw new Error('Cloud did not persist the exact successful external observation.')
  }
  return Object.freeze({
    value: (value ?? portableReceipt) as Value,
    journal: observed,
    observedOperation: Object.freeze({
      operationId: observed.logicalInvocationId,
      operationRevision: observed.revision,
      kind: observed.operation === 'download' ? 'download_check' : observed.operation,
      subjectPrincipal,
      requestDigest: observed.requestDigest,
      receiptDigest: observed.receiptDigest,
      outcome: 'observed_success',
      safeFailureCode: null,
      observedAt: observed.resolvedAt
    })
  })
}

async function observeFailure(
  input: Parameters<typeof executeProvisioning>[0],
  dispatched: ExternalOperationRecoveryJournalEntry,
  rawCode: string
): Promise<void> {
  const outcome = rawCode === 'outcome_unknown' ? 'outcome_unknown' : 'observed_failure'
  await executeUserCloud(input.options.transport, {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    requestId: input.requestId(),
    type: 'external_operation.observe',
    idempotencyKey: operationIdempotencyKey(
      input.baseIdempotencyKey,
      `${dispatched.logicalInvocationId}:${outcome}`
    ),
    journalEntryId: dispatched.contentRecoveryJournalEntryId,
    expectedJournalRevision: dispatched.revision,
    outcome,
    receiptDigest: null,
    observationDigest: null,
    safeFailureCode: safeFailureCode(rawCode)
  })
}

async function submitOwnerRootLossObservation(
  input: Parameters<typeof executeProvisioning>[0],
  failureCode: string
): Promise<void> {
  const binding = input.built.project.provisioning.binding
  if (!binding || binding.status !== 'active') return
  const ownerUserId = input.built.project.project.ownerUserId
  const readiness = requiredReadiness(input.built.project, ownerUserId)
  if (!readiness.providerPrincipal || !readiness.providerPrincipalFactId ||
    readiness.snapshottedFactRevision === null) return
  const workspace = await input.options.workspace.readWorkspace({
    projectId: input.built.project.project.projectId
  })
  if (workspace.connection.state !== 'ready') return
  const observedAt = input.now().toISOString()
  const observation = projectProviderMembershipObservationSchema.parse({
    schemaVersion: 1,
    type: 'project_provider_membership_observation',
    providerObservationId: input.providerObservationId(),
    projectId: input.built.project.project.projectId,
    userId: ownerUserId,
    providerPrincipalFactId: readiness.providerPrincipalFactId,
    snapshottedFactRevision: readiness.snapshottedFactRevision,
    providerPrincipal: readiness.providerPrincipal,
    bindingRevision: binding.revision,
    provisioningRevision: binding.provisioningRevision,
    source: 'explicit_reconcile',
    outcome: 'unauthorized',
    observerUserId: ownerUserId,
    observerDeviceId: workspace.connection.deviceId,
    observerAgentId: null,
    provisioningAttestationId: null,
    evidenceDigest: stableDigest({
      root: binding.rootLocator,
      failureCode,
      observedAt
    }),
    observedAt,
    revision: 1,
    createdAt: observedAt,
    updatedAt: observedAt
  })
  await executeUserCloud(input.options.transport, {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    requestId: input.requestId(),
    type: 'project.content.observation.submit',
    idempotencyKey: scopedIdempotencyKey(input.baseIdempotencyKey, 'owner-root-loss'),
    projectId: input.built.project.project.projectId,
    expectedProjectRevision: input.built.project.project.revision,
    observation
  })
}

function buildMemberObservations(
  project: ProjectCoordinatorProject,
  intent: ProjectContentProvisioningIntent,
  page: ContentSpaceAgentAdministrationMemberPage,
  observedAt: string
): ProvisionedMemberObservation[] {
  const present = new Set(page.items.map(({ member }) => (
    `${member.providerInstanceRef}\u0000${member.principalId}`
  )))
  const observations: ProvisionedMemberObservation[] = intent.desiredMembers.map((member) => ({
    userId: member.userId,
    providerPrincipalFactId: member.providerPrincipalFactId,
    snapshottedFactRevision: member.snapshottedFactRevision,
    principal: member.principal,
    presence: present.has(principalKey(member.principal)) ? 'present' as const : 'absent' as const,
    observationDigest: stableDigest({
      root: page.root,
      userId: member.userId,
      principal: member.principal,
      presence: present.has(principalKey(member.principal)) ? 'present' : 'absent',
      observedAt
    }),
    observedAt
  }))
  for (const membership of project.provisioning.memberships.filter(({ state }) => (
    state === 'membership_removal_pending'
  ))) {
    const readiness = requiredReadiness(project, membership.userId)
    if (!readiness.providerPrincipal || !readiness.providerPrincipalFactId ||
      readiness.snapshottedFactRevision === null) {
      throw new Error('Removal-pending member lacks an exact Provider principal snapshot.')
    }
    const presence = present.has(principalKey(readiness.providerPrincipal))
      ? 'present' as const
      : 'absent' as const
    observations.push({
      userId: membership.userId,
      providerPrincipalFactId: readiness.providerPrincipalFactId,
      snapshottedFactRevision: readiness.snapshottedFactRevision,
      principal: readiness.providerPrincipal,
      presence,
      observationDigest: stableDigest({
        root: page.root,
        userId: membership.userId,
        principal: readiness.providerPrincipal,
        presence,
        observedAt
      }),
      observedAt
    })
  }
  const desiredUserIds = new Set(intent.desiredMembers.map(({ userId }) => userId))
  const failed = observations.find(({ userId, presence }) => (
    presence !== (desiredUserIds.has(userId) ? 'present' : 'absent')
  ))
  if (failed) {
    throw new Error(`Provider member verification failed for ${failed.userId}.`)
  }
  return observations
}

function requiredReadiness(project: ProjectCoordinatorProject, userId: string) {
  const readiness = project.provisioning.contentReadiness.find((candidate) => (
    candidate.userId === userId
  ))
  if (!readiness) throw new Error(`User ${userId} lacks Project Content Readiness.`)
  return readiness
}

function requireCompleteMemberPage(page: ContentSpaceAgentAdministrationMemberPage): void {
  if (page.nextCursor) {
    throw new Error('Provider member verification exceeded the bounded complete Run-0 page.')
  }
}

function assertProvisioningPlanStillCurrent(
  input: ProjectCoordinatorProvisioningPlan,
  current: ProjectCoordinatorProvisioningPlan
): void {
  if (
    input.projectId !== current.projectId ||
    input.provisioningIntentId !== current.provisioningIntentId ||
    input.expectedProjectRevision !== current.expectedProjectRevision ||
    input.expectedProvisioningRevision !== current.expectedProvisioningRevision ||
    input.expectedProvisioningIntentRevision !== current.expectedProvisioningIntentRevision ||
    input.intentDigest !== current.intentDigest ||
    input.confirmedPlanDigest !== current.confirmedPlanDigest
  ) {
    throw new Error('Cloud facts changed after workflow preparation; prepare a fresh Project workflow.')
  }
}

function requireContentSuccess<Value>(
  result: ContentSpaceResult<Value>,
  operation: string
): Value {
  if (!result.ok) throw new Error(`${operation} failed: ${result.error.code}.`)
  return result.value
}

function directoryUser(principal: ProviderDirectoryPrincipalReference) {
  return Object.freeze({
    providerInstanceRef: principal.providerInstance.providerInstanceRef,
    kind: 'user' as const,
    principalId: principal.principalId
  })
}

function principalKey(principal: ProviderDirectoryPrincipalReference): string {
  return `${principal.providerInstance.providerInstanceRef}\u0000${principal.principalId}`
}

function digestFinitePlan(plan: DomainMainFiniteCapabilityBatchPlan): string {
  return createHash('sha256')
    .update(canonicalizeDomainMainFiniteCapabilityBatchPlan(plan))
    .digest('hex')
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function stableDigest(value: unknown): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex')
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' ||
    typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (!value || typeof value !== 'object') throw new TypeError('Unsupported canonical value.')
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
}

function operationIdempotencyKey(base: string, operation: string): string {
  return `idem_pcp.${stableDigest({ base, operation }).slice(0, 48)}`
}

function scopedIdempotencyKey(base: string, operation: string): string {
  return `idem_pcp.${stableDigest({ base, operation }).slice(0, 48)}`
}

function safeFailureCode(raw: string): string {
  const canonical = raw.trim().toLowerCase().replaceAll(/[^a-z0-9_.-]/gu, '_').slice(0, 64)
  return /^[a-z][a-z0-9_.-]{0,63}$/u.test(canonical)
    ? canonical
    : 'unclassified_failure'
}

function provisioningFailure(message: string): Error {
  const error = new Error(message)
  Object.defineProperty(error, 'projectProvisioningFailure', { value: true })
  return error
}

function isKnownProvisioningFailure(error: unknown): boolean {
  return error instanceof Error && Boolean(
    (error as Error & { projectProvisioningFailure?: boolean }).projectProvisioningFailure
  )
}

function collectionJournal(
  response: RestResponse,
  journalEntryId: string
): ExternalOperationRecoveryJournalEntry {
  if (response.type !== 'rest.collection') {
    throw new Error(`External operation observation returned ${response.type}.`)
  }
  const parsed = response.items.map((item) => (
    externalOperationRecoveryJournalEntrySchema.safeParse(item)
  )).find((candidate) => candidate.success && (
    candidate.data.contentRecoveryJournalEntryId === journalEntryId
  ))
  if (!parsed?.success) throw new Error('External operation observation omitted its exact journal.')
  return parsed.data
}

async function executeUserCloud(
  transport: AuthenticatedCloudTransport,
  payload: Parameters<AuthenticatedCloudTransport['execute']>[0]['payload']
): Promise<RestResponse> {
  const response = await transport.execute({
    contractVersion: 1,
    operationId: AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
    payload
  })
  if (response.status >= 400 || response.body.type === 'rest.error') {
    const detail = response.body.type === 'rest.error'
      ? `${response.body.error.code}: ${response.body.error.message}`
      : `HTTP ${response.status}`
    throw new Error(`SciForge Cloud request failed: ${detail}`)
  }
  return response.body
}
