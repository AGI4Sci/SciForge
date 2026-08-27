import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { DomainMainAgentExecutionHost } from '@sciforge/domain-sdk/agent-execution'
import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'
import {
  AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
  type AuthenticatedCloudTransport
} from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import {
  CURRENT_PROTOCOL_VERSION,
  PROJECT_COORDINATION_COLLECTIONS,
  PROJECT_COORDINATION_MAX_PAGE_SIZE,
  agentInboxMessageSchema,
  projectSchema,
  projectPlanSchema,
  projectPlanTaskSchema,
  humanAnswerSchema,
  humanNeededSchema,
  type Project,
  type AgentInboxMessage,
  type ProjectCoordinationCollection,
  type ProjectContentReadiness,
  type ProjectFinalSummary,
  type ProjectMembership,
  type ProjectPlan,
  type ProjectRecord,
  type ProjectWorkerAvailabilityView,
  type ProviderDirectoryPrincipalFact,
  type RestResponse,
  type Task,
  type TaskAuthority,
  type TaskExecution,
  type TaskOffer,
  type TaskResultSubmission,
  type TaskReviewDecision,
  type WorkerAvailabilityProjection,
  type WorkerDirectoryAgentLabel,
  type WorkerDirectoryUserLabel
} from '@sciforge/collaboration-contracts'
import type {
  CoordinatorCloudCommandService
} from '@sciforge/domain-collaboration/coordinator-cloud-command'
import type {
  DeviceFactAttestationSigningService,
  DeviceFactSignatureMetadata,
  DeviceFactSigningRequest
} from '@sciforge/domain-identity-access/device-fact-attestation-signing'

import {
  projectCoordinatorProjectCreateInputSchema,
  projectCoordinatorProjectCreateResultSchema,
  projectCoordinatorHumanAnswerInputSchema,
  projectCoordinatorHumanNeededCreateInputSchema,
  projectCoordinatorCompleteInputSchema,
  projectCoordinatorResultReviewInputSchema,
  projectCoordinatorTransferFeedbackSchema,
  projectCoordinatorTransferInputSchema,
  projectCoordinatorPlanDraftEditInputSchema,
  projectCoordinatorPlanDraftGenerateInputSchema,
  projectCoordinatorPlanDraftReadInputSchema,
  projectCoordinatorPlanDraftSchema,
  projectCoordinatorPlanDraftSubmitInputSchema,
  projectCoordinatorPlanSubmitResultSchema,
  projectCoordinatorPlanConfirmActivateInputSchema,
  projectCoordinatorWorkspaceReadInputSchema,
  projectCoordinatorWorkspaceSchema,
  type ProjectCoordinatorProject,
  type ProjectCoordinatorProjectCreateInput,
  type ProjectCoordinatorProjectCreateResult,
  type ProjectCoordinatorHumanAnswerInput,
  type ProjectCoordinatorHumanNeededCreateInput,
  type ProjectCoordinatorCompleteInput,
  type ProjectCoordinatorResultReviewInput,
  type ProjectCoordinatorTransferFeedback,
  type ProjectCoordinatorTransferInput,
  type ProjectCoordinatorPlanAssignment,
  type ProjectCoordinatorPlanDraft,
  type ProjectCoordinatorPlanDraftEditInput,
  type ProjectCoordinatorPlanDraftGenerateInput,
  type ProjectCoordinatorPlanDraftReadInput,
  type ProjectCoordinatorPlanDraftSubmitInput,
  type ProjectCoordinatorPlanSubmitResult,
  type ProjectCoordinatorPlanConfirmActivateInput,
  type ProjectCoordinatorWorkspace,
  type ProjectCoordinatorWorkspaceReadInput
} from './contract.js'
import { ProjectCoordinatorStateStore } from './state.js'
import type { ProjectCoordinatorProvisioningPort } from './provisioning.js'
import type { ProjectCoordinatorRecoveryPort } from './recovery.js'
import type { ProjectCoordinatorArtifactReviewPort } from './artifact-review.js'

const PROJECT_COORDINATOR_PROJECT_FACT_COLLECTIONS = PROJECT_COORDINATION_COLLECTIONS.filter(
  (collection) => collection !== 'user_label_facts' &&
    collection !== 'agent_label_facts' &&
    collection !== 'worker_availability'
)

export type ProjectCoordinatorWorkspacePort = Readonly<{
  readWorkspace(input: ProjectCoordinatorWorkspaceReadInput): Promise<ProjectCoordinatorWorkspace>
}>

export type ProjectCoordinatorCloudWorkspacePort = ProjectCoordinatorWorkspacePort & Readonly<{
  createProject(
    input: ProjectCoordinatorProjectCreateInput,
    idempotencyKey: string
  ): Promise<ProjectCoordinatorProjectCreateResult>
}>

export type ProjectCoordinatorPlanPort = Readonly<{
  generateDraft(input: ProjectCoordinatorPlanDraftGenerateInput): Promise<ProjectCoordinatorPlanDraft>
  readDraft(input: ProjectCoordinatorPlanDraftReadInput): Promise<ProjectCoordinatorPlanDraft | null>
  editDraft(input: ProjectCoordinatorPlanDraftEditInput): Promise<ProjectCoordinatorPlanDraft>
  submitDraft(
    input: ProjectCoordinatorPlanDraftSubmitInput,
    idempotencyKey: string
  ): Promise<ProjectCoordinatorPlanSubmitResult>
  confirmAndActivate(
    input: ProjectCoordinatorPlanConfirmActivateInput,
    idempotencyKey: string
  ): Promise<ProjectCoordinatorWorkspace>
}>

export type ProjectCoordinatorActionPort = Readonly<{
  transferCoordinator(
    input: ProjectCoordinatorTransferInput,
    idempotencyKey: string
  ): Promise<ProjectCoordinatorWorkspace>
  createHumanNeeded(
    input: ProjectCoordinatorHumanNeededCreateInput,
    idempotencyKey: string
  ): Promise<ProjectCoordinatorWorkspace>
  answerHumanNeeded(
    input: ProjectCoordinatorHumanAnswerInput,
    idempotencyKey: string
  ): Promise<ProjectCoordinatorWorkspace>
  reviewResult(
    input: ProjectCoordinatorResultReviewInput,
    idempotencyKey: string
  ): Promise<ProjectCoordinatorWorkspace>
  completeProject(
    input: ProjectCoordinatorCompleteInput,
    idempotencyKey: string
  ): Promise<ProjectCoordinatorWorkspace>
  handleInbox(message: AgentInboxMessage): Promise<void>
}>

export type ProjectContentProvisioningAttestationSigningPort = Readonly<{
  signFactualPayload(
    input: Omit<DeviceFactSigningRequest, 'purpose'>
  ): Promise<DeviceFactSignatureMetadata>
}>

export type ProjectCoordinatorMainPorts = Readonly<{
  workspace: ProjectCoordinatorCloudWorkspacePort
  plan: ProjectCoordinatorPlanPort
  artifactReview: ProjectCoordinatorArtifactReviewPort
  provisioningAttestationSigning: ProjectContentProvisioningAttestationSigningPort
  provisioning: ProjectCoordinatorProvisioningPort
  recovery: ProjectCoordinatorRecoveryPort
  coordinatorCloudCommands: CoordinatorCloudCommandService
  actions: ProjectCoordinatorActionPort
}>

export function defineProjectCoordinatorWorkspacePort(
  input: ProjectCoordinatorWorkspacePort
): ProjectCoordinatorWorkspacePort {
  if (!input || typeof input !== 'object' || typeof input.readWorkspace !== 'function') {
    throw new TypeError('Project Coordinator workspace port is invalid.')
  }
  return Object.freeze({
    readWorkspace: async (request) => projectCoordinatorWorkspaceSchema.parse(
      await input.readWorkspace(projectCoordinatorWorkspaceReadInputSchema.parse(request))
    )
  })
}

export function createProjectCoordinatorCloudWorkspacePort(options: Readonly<{
  transport: AuthenticatedCloudTransport
  readPlanAssignments?: (
    plan: ProjectPlan
  ) => Promise<readonly ProjectCoordinatorPlanAssignment[]>
  readCoordinatorTransferFeedback?: (
    projectId: string
  ) => Promise<ProjectCoordinatorTransferFeedback | null>
  requestId?: () => `req_${string}`
  now?: () => Date
}>): ProjectCoordinatorCloudWorkspacePort {
  const requestId = options.requestId ?? (() => `req_${randomUUID().replaceAll('-', '')}`)
  const now = options.now ?? (() => new Date())

  const readWorkspace = async (
    rawInput: ProjectCoordinatorWorkspaceReadInput
  ): Promise<ProjectCoordinatorWorkspace> => {
    const input = projectCoordinatorWorkspaceReadInputSchema.parse(rawInput)
    const status = options.transport.status()
    const observedAt = now().toISOString()
    if (status.state === 'identity_required') {
      return projectCoordinatorWorkspaceSchema.parse({
        connection: { state: 'identity_required' }, observedAt, availableWorkerGroups: [], projects: []
      })
    }
    if (status.state === 'device_required') {
      return projectCoordinatorWorkspaceSchema.parse({
        connection: { state: 'device_required', reason: status.reason }, observedAt, availableWorkerGroups: [], projects: []
      })
    }
    if (status.state === 'unavailable') {
      return projectCoordinatorWorkspaceSchema.parse({
        connection: { state: 'cloud_unavailable', reason: status.reason }, observedAt, availableWorkerGroups: [], projects: []
      })
    }

    const listed = await listAllProjects(options.transport, requestId)
    const workerDirectory = await readAllWorkerDirectory(options.transport, requestId)
    const focusedProject = input.projectId
      ? listed.projects.find(({ projectId }) => projectId === input.projectId)
      : listed.projects.length === 1
        ? listed.projects[0]
        : undefined
    const facts = focusedProject
      ? await readAllProjectFacts(options.transport, focusedProject, requestId)
      : undefined
    const projects = await Promise.all(listed.projects.map(async (project) => {
      let view = projectCoordinatorProjectView(
        project,
        project.projectId === focusedProject?.projectId ? facts : undefined,
        project.projectId === focusedProject?.projectId ? workerDirectory : undefined
      )
      const transferFeedback = await options.readCoordinatorTransferFeedback?.(project.projectId)
      if (
        transferFeedback &&
        transferFeedback.coordinatorAgentId === project.coordinatorAgentId &&
        transferFeedback.coordinatorAuthorityEpoch === project.coordinatorAuthorityEpoch &&
        transferFeedback.projectRevision <= project.revision
      ) {
        view = { ...view, coordinatorTransferFeedback: transferFeedback }
      }
      if (view.plan && options.readPlanAssignments) {
        view = {
          ...view,
          plan: {
            ...view.plan,
            assignments: [...await options.readPlanAssignments(view.plan.plan)]
          }
        }
      }
      return view
    }))
    return projectCoordinatorWorkspaceSchema.parse({
      connection: { state: 'ready', userId: status.userId, deviceId: status.deviceId },
      observedAt: facts?.observedAt ?? workerDirectory.observedAt ?? listed.observedAt,
      ...(focusedProject ? { focusedProjectId: focusedProject.projectId } : {}),
      availableWorkerGroups: availableWorkerGroups(workerDirectory),
      projects
    })
  }

  return Object.freeze({
    readWorkspace,
    createProject: async (rawInput, idempotencyKey) => {
      const input = projectCoordinatorProjectCreateInputSchema.parse(rawInput)
      const identity = options.transport.status()
      if (identity.state !== 'ready') {
        throw new Error('Project creation requires an authenticated User and Device.')
      }
      const creatorAgent = await readCurrentDeviceAgent(options.transport, requestId)
      const response = await executeUserCloud(options.transport, {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: requestId(),
        type: 'project.create',
        idempotencyKey,
        ...input,
        coordinatorAgentId: creatorAgent.agentId,
        expectedCoordinatorAgentRevision: creatorAgent.revision
      })
      if (response.type !== 'rest.project_created') {
        throw new Error(`Project create returned ${response.type}.`)
      }
      if (
        response.project.ownerUserId !== identity.userId ||
        response.project.coordinatorAgentId !== creatorAgent.agentId
      ) {
        throw new Error(
          'Project create did not preserve the exact current User and Device Agent authority.'
        )
      }
      return projectCoordinatorProjectCreateResultSchema.parse({
        createdProjectId: response.project.projectId,
        workspace: await readWorkspace({ projectId: response.project.projectId })
      })
    }
  })
}

async function readCurrentDeviceAgent(
  transport: AuthenticatedCloudTransport,
  requestId: () => `req_${string}`
) {
  const identity = transport.status()
  if (identity.state !== 'ready') {
    throw new Error('Project creation requires an authenticated User and Cloud Device.')
  }
  // identity.deviceId is the Cloud Device identity from OIDC. It must never be
  // compared with or replaced by the Host installation/execution node ID.
  const response = await executeUserCloud(transport, {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    requestId: requestId(),
    type: 'participant.get',
    userId: identity.userId
  })
  if (response.type !== 'participant.snapshot' || response.user.userId !== identity.userId) {
    throw new Error(`Current Device Agent lookup returned ${response.type}.`)
  }
  const matching = response.agents.filter((agent) => (
    agent.ownerUserId === identity.userId &&
    agent.deviceId === identity.deviceId &&
    agent.lifecycleStatus === 'active'
  ))
  if (matching.length !== 1) {
    throw new Error('The current Cloud Device must have exactly one active Agent Runtime.')
  }
  return matching[0]!
}

const generatedPlanContentSchema = z.object({
  tasks: z.array(projectPlanTaskSchema).min(1).max(1_000),
  rationale: projectCoordinatorPlanDraftSchema.unwrap().shape.rationale
}).strict().readonly()

export function createProjectCoordinatorPlanPort(options: Readonly<{
  settings: DomainMainPackageSettingsHost
  state?: ProjectCoordinatorStateStore
  workspace: ProjectCoordinatorWorkspacePort
  getAgentExecution(): DomainMainAgentExecutionHost | undefined
  coordinatorCloudCommands?: CoordinatorCloudCommandService
  transport?: AuthenticatedCloudTransport
  now?: () => Date
  draftId?: () => `draft_${string}`
  requestId?: () => `req_${string}`
}>): ProjectCoordinatorPlanPort {
  const state = options.state ?? new ProjectCoordinatorStateStore(options.settings)
  const now = options.now ?? (() => new Date())
  const draftId = options.draftId ?? (() => `draft_${randomUUID().replaceAll('-', '')}`)
  const requestId = options.requestId ?? (() => `req_${randomUUID().replaceAll('-', '')}`)
  const readProject = async (projectId: string) => {
    const workspace = await options.workspace.readWorkspace({ projectId })
    if (workspace.connection.state !== 'ready') {
      throw new Error(`Project coordination is ${workspace.connection.state}.`)
    }
    const project = workspace.projects.find((candidate) => candidate.project.projectId === projectId)
    if (!project) throw new Error('The exact Project is not visible to the current OIDC User.')
    return project
  }

  return Object.freeze({
    generateDraft: async (rawInput) => {
      const input = projectCoordinatorPlanDraftGenerateInputSchema.parse(rawInput)
      const project = await readProject(input.projectId)
      const agentExecution = options.getAgentExecution()
      if (!agentExecution) throw new Error('The local Agent Runtime is unavailable.')
      const candidates = project.workerGroups.flatMap((group) => group.agents
        .filter(({ projectAvailability }) => projectAvailability.membership?.state === 'active')
        .map((agent) => ({
          userId: group.userId,
          agentId: agent.projectAvailability.agentId,
          displayName: agent.displayName,
          runtimeCapabilityTags: agent.projectAvailability.availability.runtimeCapabilityTags,
          acceptsNewOffers: agent.projectAvailability.availability.acceptsNewOffers
        })))
      const generated = await agentExecution.run({
        clientDirectiveId: `project-plan:${project.project.projectId}:${project.project.revision}`,
        prompt: [
          `Project: ${project.project.displayName}`,
          `Goal: ${project.project.goal}`,
          `Owner instruction: ${input.instruction}`,
          `Budget: ${JSON.stringify(project.project.budget)}`,
          `Exact Worker candidates: ${JSON.stringify(candidates)}`,
          'Return only strict JSON with {tasks,rationale}. Each task must use a stable item_* ID and canonical Project Plan Task fields.'
        ].join('\n'),
        ...(input.modelId ? { model: input.modelId } : {}),
        interaction: 'reviewable',
        mode: 'plan'
      })
      if (generated.state !== 'completed') {
        throw new Error(`Local Plan Runtime ended in ${generated.state}.`)
      }
      let decoded: unknown
      try {
        decoded = JSON.parse(generated.text)
      } catch (cause) {
        throw new Error('Local Plan Runtime returned non-JSON output.', { cause })
      }
      const content = generatedPlanContentSchema.parse(decoded)
      const timestamp = now().toISOString()
      const next = projectCoordinatorPlanDraftSchema.parse({
        draftId: draftId(),
        draftRevision: 1,
        projectId: project.project.projectId,
        expectedProjectRevision: project.project.revision,
        expectedCoordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch,
        supersedesProjectPlanId: project.plan?.plan.projectPlanId ?? null,
        sourceInputLocators: input.sourceInputLocators,
        tasks: content.tasks,
        rationale: content.rationale,
        runtimeProvenance: {
          runtimeId: generated.runtimeId,
          modelId: input.modelId,
          generatedByCoordinatorAgentId: project.project.coordinatorAgentId,
          generatedAt: timestamp
        },
        assignments: content.tasks.map(({ planItemId }) => ({
          planItemId,
          selectedAgentId: null,
          recommendationReason: null
        })),
        createdAt: timestamp,
        updatedAt: timestamp
      })
      return state.writeDraft(next, null)
    },
    readDraft: async (rawInput) => {
      const input = projectCoordinatorPlanDraftReadInputSchema.parse(rawInput)
      return state.readDraft(input.projectId)
    },
    editDraft: async (rawInput) => {
      const input = projectCoordinatorPlanDraftEditInputSchema.parse(rawInput)
      const current = await state.readDraft(input.projectId)
      if (!current || current.draftId !== input.draftId) throw new Error('Plan draft was not found.')
      if (current.draftRevision !== input.expectedDraftRevision) {
        throw new Error('Plan draft revision conflict.')
      }
      const project = await readProject(input.projectId)
      const projectMemberAgentIds = new Set(project.workerGroups.flatMap((group) => (
        group.agents
          .filter(({ projectAvailability }) => projectAvailability.membership?.state === 'active')
          .map(({ projectAvailability }) => projectAvailability.agentId)
      )))
      if (input.assignments.some(({ selectedAgentId }) => (
        selectedAgentId !== null && !projectMemberAgentIds.has(selectedAgentId)
      ))) {
        throw new Error('A Plan assignment must select an exact Agent of an active Project member.')
      }
      const next = projectCoordinatorPlanDraftSchema.parse({
        ...current,
        draftRevision: current.draftRevision + 1,
        tasks: input.tasks,
        rationale: input.rationale,
        assignments: input.assignments,
        updatedAt: now().toISOString()
      })
      return state.writeDraft(next, current.draftRevision)
    },
    submitDraft: async (rawInput, idempotencyKey) => {
      const input = projectCoordinatorPlanDraftSubmitInputSchema.parse(rawInput)
      const draft = await state.readDraft(input.projectId)
      if (!draft || draft.draftId !== input.draftId) throw new Error('Plan draft was not found.')
      if (draft.draftRevision !== input.expectedDraftRevision) {
        throw new Error('Plan draft revision conflict.')
      }
      if (draft.assignments.some(({ selectedAgentId }) => selectedAgentId === null)) {
        throw new Error('Every Plan item requires an exact Worker Agent before submit.')
      }
      if (!options.coordinatorCloudCommands) {
        throw new Error('Coordinator Agent Cloud command mediation is unavailable.')
      }
      const planFacts = {
        projectId: draft.projectId,
        expectedProjectRevision: draft.expectedProjectRevision,
        expectedCoordinatorAuthorityEpoch: draft.expectedCoordinatorAuthorityEpoch,
        supersedesProjectPlanId: draft.supersedesProjectPlanId,
        sourceInputLocators: draft.sourceInputLocators,
        tasks: draft.tasks,
        rationale: draft.rationale,
        runtimeProvenance: draft.runtimeProvenance
      }
      const planDigest = stableDigest(planFacts)
      const response = await options.coordinatorCloudCommands.execute({
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: requestId(),
        type: 'project.plan.submit',
        idempotencyKey,
        ...planFacts,
        planDigest
      })
      if (response.type === 'rest.error') {
        throw new Error(`Plan submit failed: ${response.error.code}: ${response.error.message}`)
      }
      if (response.type !== 'rest.entity') {
        throw new Error(`Plan submit returned ${response.type}.`)
      }
      const plan = projectPlanFromEntity(response.entity)
      if (plan.projectId !== draft.projectId || plan.planDigest !== planDigest) {
        throw new Error('Plan submit did not return the exact submitted Plan facts.')
      }
      const assignments = await state.commitSubmittedDraft(plan, draft.draftRevision)
      const workspace = attachPlanAssignments(
        await options.workspace.readWorkspace({ projectId: draft.projectId }),
        plan,
        assignments
      )
      return projectCoordinatorPlanSubmitResultSchema.parse({ plan, workspace })
    },
    confirmAndActivate: async (rawInput, idempotencyKey) => {
      const input = projectCoordinatorPlanConfirmActivateInputSchema.parse(rawInput)
      if (!options.transport) throw new Error('OIDC Cloud transport is unavailable.')
      const confirmed = await executeUserCloud(options.transport, {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: requestId(),
        type: 'project.plan.confirm',
        idempotencyKey: scopedIdempotencyKey(idempotencyKey, 'confirm'),
        projectId: input.projectId,
        projectPlanId: input.projectPlanId,
        expectedProjectRevision: input.expectedProjectRevision,
        expectedCoordinatorAuthorityEpoch: input.expectedCoordinatorAuthorityEpoch,
        expectedPlanRevision: input.expectedPlanRevision,
        planDigest: input.planDigest
      })
      if (confirmed.type !== 'rest.entity') {
        throw new Error(`Plan confirmation returned ${confirmed.type}.`)
      }
      const confirmedPlan = projectPlanFromEntity(confirmed.entity)
      if (
        confirmedPlan.projectId !== input.projectId ||
        confirmedPlan.projectPlanId !== input.projectPlanId ||
        confirmedPlan.planDigest !== input.planDigest ||
        confirmedPlan.state !== 'confirmed'
      ) {
        throw new Error('Plan confirmation did not return the exact confirmed Plan.')
      }
      let workspace = await options.workspace.readWorkspace({ projectId: input.projectId })
      const projectView = requireReadyProject(workspace, input.projectId)
      if (projectView.project.status !== 'active') {
        if (projectView.project.contentMode === 'required' &&
            projectView.provisioning.binding?.status !== 'active') {
          throw new Error('Content-required Project cannot activate before its exact binding is active.')
        }
        const transitioned = await executeUserCloud(options.transport, {
          protocolVersion: CURRENT_PROTOCOL_VERSION,
          requestId: requestId(),
          type: 'project.transition',
          idempotencyKey: scopedIdempotencyKey(idempotencyKey, 'activate'),
          projectId: input.projectId,
          expectedRevision: projectView.project.revision,
          expectedCoordinatorAuthorityEpoch: projectView.project.coordinatorAuthorityEpoch,
          expectedExecutionAuthorityEpoch: projectView.project.executionAuthorityEpoch,
          status: 'active'
        })
        if (transitioned.type !== 'rest.entity') {
          throw new Error(`Project activation returned ${transitioned.type}.`)
        }
        workspace = await options.workspace.readWorkspace({ projectId: input.projectId })
      }
      const parsed = projectCoordinatorWorkspaceSchema.parse(workspace)
      if (requireReadyProject(parsed, input.projectId).project.status !== 'active') {
        throw new Error('Project activation was not observed in fresh Cloud facts.')
      }
      if (!options.coordinatorCloudCommands) {
        throw new Error('Coordinator Agent Cloud command mediation is unavailable.')
      }
      return dispatchInitialPlanOffers({
        workspace: options.workspace,
        coordinatorCloudCommands: options.coordinatorCloudCommands,
        state,
        requestId,
        now
      }, confirmedPlan, idempotencyKey, parsed)
    }
  })
}

async function dispatchInitialPlanOffers(options: Readonly<{
  workspace: ProjectCoordinatorWorkspacePort
  coordinatorCloudCommands: CoordinatorCloudCommandService
  state: ProjectCoordinatorStateStore
  requestId(): `req_${string}`
  now(): Date
}>, confirmedPlan: ProjectPlan, idempotencyKey: string,
initialWorkspace: ProjectCoordinatorWorkspace): Promise<ProjectCoordinatorWorkspace> {
  const initialProject = requireReadyProject(initialWorkspace, confirmedPlan.projectId)
  if (initialProject.project.status !== 'active') {
    throw new Error('Initial Task offers require an active Project.')
  }
  const rootItems = confirmedPlan.tasks.filter(({ dependencyPlanItemIds }) => (
    dependencyPlanItemIds.length === 0
  ))
  if (rootItems.length === 0) {
    throw new Error('A confirmed Plan must expose at least one dependency-free initial Task.')
  }
  const assignments = await options.state.readPlanAssignments(
    confirmedPlan.projectPlanId,
    confirmedPlan.planDigest
  )
  const assignmentByItem = new Map(assignments.map((assignment) => (
    [assignment.planItemId, assignment] as const
  )))
  if (
    assignments.length !== confirmedPlan.tasks.length ||
    confirmedPlan.tasks.some(({ planItemId }) => !assignmentByItem.has(planItemId))
  ) {
    throw new Error('Confirmed Plan Task dispatch requires its exact durable Agent assignments.')
  }

  let workspace = initialWorkspace
  const offeredTaskIds = new Set<string>()

  for (const item of rootItems) {
    workspace = await options.workspace.readWorkspace({ projectId: confirmedPlan.projectId })
    const project = requireReadyProject(workspace, confirmedPlan.projectId)
    if (
      project.project.status !== 'active' ||
      project.plan?.plan.projectPlanId !== confirmedPlan.projectPlanId ||
      project.plan.plan.planDigest !== confirmedPlan.planDigest ||
      project.plan.plan.state !== 'confirmed'
    ) {
      throw new Error('Initial Task dispatch lost the exact active Project and confirmed Plan.')
    }
    const assignment = assignmentByItem.get(item.planItemId)
    if (!assignment?.selectedAgentId) {
      throw new Error('Every initial Plan item requires an exact Worker Agent assignment.')
    }
    const candidate = project.workerGroups.flatMap(({ agents }) => agents).find(({ projectAvailability }) => (
      projectAvailability.agentId === assignment.selectedAgentId
    ))
    if (!candidate) throw new Error('The selected Worker Agent is no longer visible in Cloud.')
    const view = candidate.projectAvailability
    const availability = view.availability
    const requiredScope = item.fileIntent ? 'file_tasks' : 'text_tasks'
    if (
      view.membership?.state !== 'active' ||
      !view.taskAuthorities?.some(({ scope, state }) => (
        scope === requiredScope && state === 'eligible'
      )) ||
      !availability.agentActive ||
      !availability.deviceActive ||
      availability.connectionStatus !== 'online' ||
      availability.runtimeReadiness !== 'ready' ||
      !availability.acceptsNewOffers ||
      Date.parse(availability.expiresAt) <= Date.parse(view.observedAt) ||
      item.requiredCapabilityTags.some((tag) => (
        !availability.runtimeCapabilityTags.includes(tag)
      )) ||
      (item.fileIntent !== null && view.contentReadiness?.state !== 'ready')
    ) {
      throw new Error('The selected Worker Agent is not currently eligible for this initial Task.')
    }
    const offerExpiresAt = new Date(options.now().getTime() + 15 * 60_000).toISOString()
    const response = await options.coordinatorCloudCommands.execute({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      requestId: options.requestId(),
      type: 'task.offer.create',
      idempotencyKey: scopedIdempotencyKey(
        idempotencyKey,
        `offer-${stableDigest({
          projectPlanId: confirmedPlan.projectPlanId,
          planItemId: item.planItemId
        }).slice(0, 24)}`
      ),
      projectId: project.project.projectId,
      expectedProjectRevision: project.project.revision,
      expectedCoordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch,
      expectedExecutionAuthorityEpoch: project.project.executionAuthorityEpoch,
      projectPlanId: confirmedPlan.projectPlanId,
      expectedPlanRevision: project.plan.plan.revision,
      planItemId: item.planItemId,
      assigneeAgentId: assignment.selectedAgentId,
      expectedAvailabilityRevision: availability.revision,
      offerExpiresAt
    })
    if (response.type === 'rest.error') {
      throw new Error(`Initial Task offer failed: ${response.error.code}: ${response.error.message}`)
    }
    if (response.type !== 'rest.collection') {
      throw new Error(`Initial Task offer returned ${response.type}.`)
    }
    const tasks = response.items.filter((entity): entity is Task => entity.type === 'task')
    const executions = response.items.filter((entity): entity is TaskExecution => (
      entity.type === 'task_execution'
    ))
    const offers = response.items.filter((entity): entity is TaskOffer => entity.type === 'task_offer')
    const task = tasks[0]
    const execution = executions[0]
    const offer = offers[0]
    if (
      response.items.length !== 3 ||
      tasks.length !== 1 ||
      executions.length !== 1 ||
      offers.length !== 1 ||
      !task || !execution || !offer ||
      task.projectId !== project.project.projectId ||
      task.createdByCoordinatorAgentId !== project.project.coordinatorAgentId ||
      task.title !== item.title ||
      task.objective !== item.objective ||
      stableDigest(task.completionCriteria) !== stableDigest(item.completionCriteria) ||
      task.dependencyTaskIds.length !== 0 ||
      stableDigest(task.fileIntent) !== stableDigest(item.fileIntent) ||
      execution.projectId !== task.projectId ||
      execution.taskId !== task.taskId ||
      execution.offeredByCoordinatorAgentId !== project.project.coordinatorAgentId ||
      execution.assigneeAgentId !== assignment.selectedAgentId ||
      execution.assigneeDeviceId !== availability.deviceId ||
      offer.projectId !== task.projectId ||
      offer.taskId !== task.taskId ||
      offer.executionId !== execution.executionId ||
      offer.assigneeAgentId !== assignment.selectedAgentId ||
      offer.assigneeDeviceId !== availability.deviceId ||
      offer.state !== 'pending' ||
      offer.expiresAt !== offerExpiresAt
    ) {
      throw new Error('Initial Task offer did not return the exact selected Agent assignment.')
    }
    offeredTaskIds.add(task.taskId)
  }

  workspace = await options.workspace.readWorkspace({ projectId: confirmedPlan.projectId })
  const observed = requireReadyProject(workspace, confirmedPlan.projectId)
  if ([...offeredTaskIds].some((taskId) => (
    !observed.tasks.some(({ task }) => task.taskId === taskId)
  ))) {
    throw new Error('Initial Task offers were not observed in fresh Cloud facts.')
  }
  return workspace
}

export function createProjectCoordinatorActionPort(options: Readonly<{
  workspace: ProjectCoordinatorWorkspacePort
  coordinatorCloudCommands: CoordinatorCloudCommandService
  transport: AuthenticatedCloudTransport
  state: ProjectCoordinatorStateStore
  requestId?: () => `req_${string}`
}>): ProjectCoordinatorActionPort {
  const requestId = options.requestId ?? (() => `req_${randomUUID().replaceAll('-', '')}`)
  return Object.freeze({
    transferCoordinator: async (rawInput, idempotencyKey) => {
      const input = projectCoordinatorTransferInputSchema.parse(rawInput)
      const workspace = await options.workspace.readWorkspace({ projectId: input.projectId })
      const projectView = requireReadyProject(workspace, input.projectId)
      if (workspace.connection.state !== 'ready' ||
          workspace.connection.userId !== projectView.project.ownerUserId) {
        throw new Error('Only the current Project Owner may transfer Coordinator authority.')
      }
      if (projectView.project.status === 'completed' || projectView.project.status === 'cancelled') {
        throw new Error('A terminal Project cannot transfer Coordinator authority.')
      }
      if (input.coordinatorAgentId === projectView.project.coordinatorAgentId) {
        throw new Error('Coordinator transfer requires another exact Owner Agent.')
      }
      const ownerGroup = projectView.workerGroups.find(({ userId }) => (
        userId === projectView.project.ownerUserId
      ))
      const successor = ownerGroup?.agents.find(({ projectAvailability }) => (
        projectAvailability.agentId === input.coordinatorAgentId
      ))
      if (!successor || successor.projectAvailability.userId !== projectView.project.ownerUserId) {
        throw new Error('Coordinator successor must be an exact Agent owned by the Project Owner.')
      }
      const candidate = successor.projectAvailability
      const availability = candidate.availability
      if (
        candidate.membership?.state !== 'active' ||
        !availability.agentActive ||
        !availability.deviceActive ||
        availability.connectionStatus !== 'online' ||
        availability.runtimeReadiness !== 'ready' ||
        Date.parse(availability.expiresAt) <= Date.parse(workspace.observedAt)
      ) {
        throw new Error('Coordinator successor is not currently active, online, and Runtime-ready.')
      }
      const response = await executeUserCloud(options.transport, {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: requestId(),
        type: 'project.transfer_coordinator',
        idempotencyKey,
        projectId: input.projectId,
        expectedRevision: projectView.project.revision,
        expectedCoordinatorAuthorityEpoch: projectView.project.coordinatorAuthorityEpoch,
        coordinatorAgentId: input.coordinatorAgentId,
        expectedCoordinatorAvailabilityRevision: availability.revision
      })
      if (response.type !== 'rest.entity') {
        throw new Error(`Coordinator transfer returned ${response.type}.`)
      }
      const transferred = projectSchema.parse(response.entity)
      if (
        transferred.projectId !== projectView.project.projectId ||
        transferred.ownerUserId !== projectView.project.ownerUserId ||
        transferred.coordinatorAgentId !== input.coordinatorAgentId ||
        transferred.coordinatorAuthorityEpoch !==
          projectView.project.coordinatorAuthorityEpoch + 1 ||
        transferred.revision !== projectView.project.revision + 1
      ) {
        throw new Error('Coordinator transfer did not return the exact successor authority.')
      }
      const fresh = await options.workspace.readWorkspace({ projectId: input.projectId })
      const observed = requireReadyProject(fresh, input.projectId)
      if (
        observed.project.coordinatorAgentId !== transferred.coordinatorAgentId ||
        observed.project.coordinatorAuthorityEpoch !== transferred.coordinatorAuthorityEpoch ||
        observed.project.revision < transferred.revision
      ) {
        throw new Error('Coordinator transfer was not observed in fresh Cloud facts.')
      }
      return fresh
    },
    createHumanNeeded: async (rawInput, idempotencyKey) => {
      const input = projectCoordinatorHumanNeededCreateInputSchema.parse(rawInput)
      const response = await options.coordinatorCloudCommands.execute({
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: requestId(),
        type: 'human.needed.create',
        idempotencyKey,
        projectId: input.projectId,
        context: {
          scope: 'coordinator_project',
          expectedProjectRevision: input.expectedProjectRevision,
          expectedCoordinatorAuthorityEpoch: input.expectedCoordinatorAuthorityEpoch
        },
        requiredAssurance: input.requiredAssurance,
        prompt: input.prompt,
        confirmableAction: null,
        expiresAt: input.expiresAt
      })
      if (response.type === 'rest.error') {
        throw new Error(`HumanNeeded create failed: ${response.error.code}: ${response.error.message}`)
      }
      if (response.type !== 'rest.entity') {
        throw new Error(`HumanNeeded create returned ${response.type}.`)
      }
      const needed = humanNeededSchema.parse(response.entity)
      if (
        needed.projectId !== input.projectId ||
        needed.context.scope !== 'coordinator_project' ||
        needed.context.coordinatorAuthorityEpoch !== input.expectedCoordinatorAuthorityEpoch
      ) {
        throw new Error('HumanNeeded create did not return the exact Coordinator Project request.')
      }
      return options.workspace.readWorkspace({ projectId: input.projectId })
    },
    answerHumanNeeded: async (rawInput, idempotencyKey) => {
      const input = projectCoordinatorHumanAnswerInputSchema.parse(rawInput)
      const response = await executeUserCloud(options.transport, {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: requestId(),
        type: 'human.answer',
        idempotencyKey,
        humanRequestId: input.humanRequestId,
        requestRevision: input.requestRevision,
        answer: input.answer,
        ...(input.decision ? { decision: input.decision } : {})
      })
      if (response.type !== 'rest.entity') {
        throw new Error(`HumanAnswer returned ${response.type}.`)
      }
      const answer = humanAnswerSchema.parse(response.entity)
      if (answer.projectId !== input.projectId || answer.humanRequestId !== input.humanRequestId) {
        throw new Error('HumanAnswer did not return the exact Project request answer.')
      }
      return options.workspace.readWorkspace({ projectId: input.projectId })
    },
    reviewResult: async (rawInput, idempotencyKey) => {
      const input = projectCoordinatorResultReviewInputSchema.parse(rawInput)
      const response = await options.coordinatorCloudCommands.execute({
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: requestId(),
        type: 'task.result.review',
        idempotencyKey,
        ...input
      })
      if (response.type === 'rest.error') {
        throw new Error(`Task result review failed: ${response.error.code}: ${response.error.message}`)
      }
      if (response.type !== 'rest.collection') {
        throw new Error(`Task result review returned ${response.type}.`)
      }
      const review = response.items.find((item): item is TaskReviewDecision => (
        item.type === 'task_review_decision'
      ))
      if (
        !review ||
        review.projectId !== input.projectId ||
        review.taskId !== input.taskId ||
        review.executionId !== input.executionId ||
        review.resultSubmissionId !== input.resultSubmissionId ||
        review.decision !== input.decision
      ) {
        throw new Error('Task result review did not return the exact immutable submission decision.')
      }
      return options.workspace.readWorkspace({ projectId: input.projectId })
    },
    completeProject: async (rawInput, idempotencyKey) => {
      const input = projectCoordinatorCompleteInputSchema.parse(rawInput)
      const response = await options.coordinatorCloudCommands.execute({
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: requestId(),
        type: 'project.final_summary.submit',
        idempotencyKey,
        ...input
      })
      if (response.type === 'rest.error') {
        throw new Error(`Project completion failed: ${response.error.code}: ${response.error.message}`)
      }
      if (response.type !== 'rest.collection') {
        throw new Error(`Project completion returned ${response.type}.`)
      }
      const project = response.items.find((item): item is Project => (
        item.type === 'project' && item.projectId === input.projectId
      ))
      const finalSummary = response.items.find((item): item is ProjectFinalSummary => (
        item.type === 'project_final_summary'
      ))
      if (
        project?.status !== 'completed' ||
        !finalSummary ||
        finalSummary.projectId !== input.projectId ||
        finalSummary.projectPlanId !== input.projectPlanId ||
        finalSummary.confirmedPlanRevision !== input.confirmedPlanRevision ||
        finalSummary.summary !== input.summary ||
        finalSummary.acceptedResultSubmissionIds.length !== input.acceptedResultSubmissionIds.length ||
        finalSummary.acceptedResultSubmissionIds.some((id, index) => (
          id !== input.acceptedResultSubmissionIds[index]
        ))
      ) {
        throw new Error('Project completion did not return the exact final summary and terminal Project.')
      }
      const workspace = await options.workspace.readWorkspace({ projectId: input.projectId })
      const observed = requireReadyProject(workspace, input.projectId)
      if (
        observed.project.status !== 'completed' ||
        observed.finalSummary?.projectRecordId !== finalSummary.projectRecordId
      ) {
        throw new Error('Project completion was not observed in fresh Cloud facts.')
      }
      return workspace
    },
    handleInbox: async (rawMessage) => {
      const message = agentInboxMessageSchema.parse(rawMessage)
      if (message.payload.type === 'coordinator.transferred') {
        const transfer = message.payload
        if (
          message.recipientAgentId !== transfer.previousCoordinatorAgentId &&
          message.recipientAgentId !== transfer.coordinatorAgentId
        ) {
          throw new Error('Coordinator transfer feedback targets an unrelated Agent.')
        }
        const workspace = await options.workspace.readWorkspace({ projectId: transfer.projectId })
        const project = requireReadyProject(workspace, transfer.projectId)
        if (
          project.project.coordinatorAuthorityEpoch < transfer.coordinatorAuthorityEpoch ||
          project.project.revision < transfer.revision ||
          (
            project.project.coordinatorAuthorityEpoch === transfer.coordinatorAuthorityEpoch &&
            project.project.coordinatorAgentId !== transfer.coordinatorAgentId
          )
        ) {
          throw new Error('Coordinator transfer feedback does not match Cloud authority.')
        }
        await options.state.recordCoordinatorTransferFeedback(
          projectCoordinatorTransferFeedbackSchema.parse({
            projectId: transfer.projectId,
            inboxMessageId: message.inboxMessageId,
            recipientAgentId: message.recipientAgentId,
            previousCoordinatorAgentId: transfer.previousCoordinatorAgentId,
            coordinatorAgentId: transfer.coordinatorAgentId,
            coordinatorAuthorityEpoch: transfer.coordinatorAuthorityEpoch,
            projectRevision: transfer.revision,
            disposition: message.recipientAgentId === transfer.previousCoordinatorAgentId
              ? 'authority_transferred_out'
              : 'authority_transferred_in',
            observedAt: message.createdAt
          })
        )
        return
      }
      if (message.payload.type !== 'human.answer.received') {
        throw new Error('Project Coordinator received an unsupported Agent Inbox message.')
      }
      const answer = message.payload.answer
      if (answer.context.scope !== 'coordinator_project') {
        throw new Error('Project Coordinator received an unsupported Agent Inbox message.')
      }
      const workspace = await options.workspace.readWorkspace({ projectId: answer.projectId })
      const project = requireReadyProject(workspace, answer.projectId)
      if (
        message.recipientAgentId !== project.project.coordinatorAgentId ||
        answer.answeredByUserId !== project.project.ownerUserId ||
        answer.context.coordinatorAuthorityEpoch !== project.project.coordinatorAuthorityEpoch
      ) {
        throw new Error('HumanAnswer does not match the current Project Coordinator authority.')
      }
      const existing = project.records.find((record) => (
        record.kind === 'decision' && record.sourceHumanAnswerId === answer.humanAnswerId
      ))
      if (existing) {
        if (
          existing.authorAgentId !== project.project.coordinatorAgentId ||
          existing.authorUserId !== project.project.ownerUserId ||
          existing.body !== answer.answer
        ) {
          throw new Error('The existing Project decision does not match this HumanAnswer.')
        }
        return
      }
      if (project.project.status === 'completed' || project.project.status === 'cancelled') {
        throw new Error('A terminal Project cannot consume an unrecorded HumanAnswer.')
      }
      const idempotencyKey = `idem_project-decision.${stableDigest({
        projectId: answer.projectId,
        humanRequestId: answer.humanRequestId,
        humanAnswerId: answer.humanAnswerId
      }).slice(0, 48)}`
      const response = await options.coordinatorCloudCommands.execute({
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: requestId(),
        type: 'project.decision.submit',
        idempotencyKey,
        projectId: answer.projectId,
        humanRequestId: answer.humanRequestId,
        humanAnswerId: answer.humanAnswerId,
        expectedProjectRevision: project.project.revision,
        expectedCoordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch,
        expectedHumanRequestRevision: answer.requestRevision + 1,
        expectedHumanAnswerRevision: answer.revision,
        decision: answer.answer
      })
      if (response.type === 'rest.error') {
        throw new Error(`Project decision failed: ${response.error.code}: ${response.error.message}`)
      }
      if (response.type !== 'rest.collection') {
        throw new Error(`Project decision returned ${response.type}.`)
      }
      const decision = response.items.find((item): item is ProjectRecord => (
        item.type === 'project_record' && item.kind === 'decision'
      ))
      if (
        !decision ||
        decision.projectId !== answer.projectId ||
        decision.sourceHumanAnswerId !== answer.humanAnswerId ||
        decision.authorAgentId !== project.project.coordinatorAgentId ||
        decision.authorUserId !== project.project.ownerUserId ||
        decision.body !== answer.answer
      ) {
        throw new Error('Project decision did not return the exact Coordinator-authored HumanAnswer record.')
      }
    }
  })
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

async function listAllProjects(
  transport: AuthenticatedCloudTransport,
  requestId: () => `req_${string}`
): Promise<Readonly<{ projects: Project[]; observedAt: string }>> {
  const projects: Project[] = []
  let cursor: string | undefined
  let observedAt = new Date(0).toISOString()
  do {
    const response = await executeUserCloud(transport, {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      requestId: requestId(),
      type: 'project.list',
      ...(cursor ? { cursor } : {}),
      limit: PROJECT_COORDINATION_MAX_PAGE_SIZE
    })
    if (response.type !== 'rest.project_page') {
      throw new Error(`Project list returned ${response.type}.`)
    }
    projects.push(...response.projects)
    observedAt = response.observedAt
    cursor = response.nextCursor
    if (projects.length > 1_000) throw new Error('Project list exceeds the Desktop workspace limit.')
  } while (cursor)
  return Object.freeze({ projects, observedAt })
}

type WorkerDirectorySnapshot = Readonly<{
  observedAt: string
  availability: readonly WorkerAvailabilityProjection[]
  userLabels: readonly WorkerDirectoryUserLabel[]
  agentLabels: readonly WorkerDirectoryAgentLabel[]
}>

async function readAllWorkerDirectory(
  transport: AuthenticatedCloudTransport,
  requestId: () => `req_${string}`
): Promise<WorkerDirectorySnapshot> {
  const availability: WorkerAvailabilityProjection[] = []
  const userLabels = new Map<string, WorkerDirectoryUserLabel>()
  const agentLabels = new Map<string, WorkerDirectoryAgentLabel>()
  let afterAgentId: string | undefined
  let observedAt = new Date(0).toISOString()
  let pageCount = 0
  do {
    const response = await executeUserCloud(transport, {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      requestId: requestId(),
      type: 'worker.availability.list',
      ...(afterAgentId ? { afterAgentId } : {}),
      limit: 500
    })
    if (response.type !== 'rest.worker_availability_page') {
      throw new Error(`Worker directory returned ${response.type}.`)
    }
    availability.push(...response.items)
    for (const label of response.userLabels) userLabels.set(label.userId, label)
    for (const label of response.agentLabels) agentLabels.set(label.agentId, label)
    observedAt = response.observedAt
    afterAgentId = response.nextAgentId
    pageCount += 1
    if (pageCount > 1_000 || availability.length > 500_000) {
      throw new Error('Worker directory exceeds the Desktop workspace limit.')
    }
  } while (afterAgentId)
  return Object.freeze({
    observedAt,
    availability: Object.freeze(availability),
    userLabels: Object.freeze([...userLabels.values()]),
    agentLabels: Object.freeze([...agentLabels.values()])
  })
}

type ProjectFactSnapshot = Readonly<{
  observedAt: string
  pages: ReadonlyMap<ProjectCoordinationCollection, readonly unknown[]>
  finalSummary: Extract<RestResponse, { type: 'rest.project_coordination' }>['finalSummary']
}>

async function readAllProjectFacts(
  transport: AuthenticatedCloudTransport,
  project: Project,
  requestId: () => `req_${string}`
): Promise<ProjectFactSnapshot> {
  const pages = new Map<ProjectCoordinationCollection, unknown[]>()
  let pending: Array<Readonly<{
    collection: ProjectCoordinationCollection
    cursor?: string
    limit: number
  }>> = PROJECT_COORDINATOR_PROJECT_FACT_COLLECTIONS.map((collection) => ({
    collection,
    limit: PROJECT_COORDINATION_MAX_PAGE_SIZE
  }))
  let finalSummary: ProjectFactSnapshot['finalSummary'] = null
  let observedAt = project.updatedAt
  while (pending.length > 0) {
    const response = await executeUserCloud(transport, {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      requestId: requestId(),
      type: 'project.coordination.read',
      projectId: project.projectId,
      collections: pending
    })
    if (response.type !== 'rest.project_coordination') {
      throw new Error(`Project coordination read returned ${response.type}.`)
    }
    observedAt = response.observedAt
    finalSummary = response.finalSummary
    pending = response.pages.flatMap((page) => {
      const values = pages.get(page.collection) ?? []
      values.push(...page.items)
      pages.set(page.collection, values)
      return page.nextCursor
        ? [{ collection: page.collection, cursor: page.nextCursor, limit: page.limit }]
        : []
    })
  }
  return Object.freeze({ observedAt, pages, finalSummary })
}

function projectCoordinatorProjectView(
  project: Project,
  snapshot?: ProjectFactSnapshot,
  workerDirectory?: WorkerDirectorySnapshot
): ProjectCoordinatorProject {
  const plans = factItems<ProjectPlan>(snapshot, 'plans')
  const currentPlans = plans.filter(({ state }) => state !== 'superseded')
  if (currentPlans.length > 1) {
    throw new Error('Project coordination returned more than one current Plan.')
  }
  const plan = currentPlans[0]
  const executions = factItems<TaskExecution>(snapshot, 'executions')
  const submissions = factItems<TaskResultSubmission>(snapshot, 'result_submissions')
  const decisions = factItems<TaskReviewDecision>(snapshot, 'review_decisions')
  const intents = factItems<ProjectCoordinatorProject['provisioning']['intent']>(
    snapshot,
    'provisioning_intents'
  ).filter((item): item is NonNullable<typeof item> => item !== null)
  const attestations = factItems<ProjectCoordinatorProject['provisioning']['attestation']>(
    snapshot,
    'provisioning_attestations'
  ).filter((item): item is NonNullable<typeof item> => item !== null)
  const bindings = factItems<ProjectCoordinatorProject['provisioning']['binding']>(
    snapshot,
    'content_bindings'
  ).filter((item): item is NonNullable<typeof item> => item !== null)
  return {
    project,
    coordinatorTransferFeedback: null,
    plan: plan ? { plan, assignments: [] } : null,
    workerGroups: projectWorkerGroups(project, snapshot, workerDirectory),
    tasks: factItems<ProjectCoordinatorProject['tasks'][number]['task']>(snapshot, 'tasks')
      .map((task) => ({
        task,
        executions: executions.filter((execution) => execution.taskId === task.taskId)
      })),
    reviews: submissions.map((submission) => ({
      submission,
      decision: decisions.find(({ resultSubmissionId }) => (
        resultSubmissionId === submission.resultSubmissionId
      )) ?? null
    })),
    pendingHumanNeeded: factItems(snapshot, 'pending_human_needed'),
    records: factItems(snapshot, 'project_records'),
    finalSummary: snapshot?.finalSummary ?? null,
    provisioning: {
      intent: intents.at(-1) ?? null,
      attestation: attestations.at(-1) ?? null,
      binding: bindings.at(-1) ?? null,
      memberships: factItems(snapshot, 'memberships'),
      providerPrincipalFacts: factItems(snapshot, 'provider_principal_facts'),
      contentReadiness: factItems(snapshot, 'content_readiness'),
      providerMembershipObservations: factItems(snapshot, 'provider_membership_observations'),
      externalOperationJournal: factItems(snapshot, 'external_operation_journal'),
      recoveryActions: factItems(snapshot, 'visible_recovery_actions')
    }
  }
}

function projectWorkerGroups(
  project: Project,
  snapshot: ProjectFactSnapshot | undefined,
  workerDirectory: WorkerDirectorySnapshot | undefined
): ProjectCoordinatorProject['workerGroups'] {
  const userLabels = workerDirectory?.userLabels ?? []
  const agentLabels = workerDirectory?.agentLabels ?? []
  const availability = workerDirectory?.availability ?? []
  const memberships = factItems<ProjectMembership>(snapshot, 'memberships')
  const authorities = factItems<TaskAuthority>(snapshot, 'task_authorities')
  const readiness = factItems<ProjectContentReadiness>(snapshot, 'content_readiness')
  const providerFacts = factItems<ProviderDirectoryPrincipalFact>(
    snapshot,
    'provider_principal_facts'
  )
  const grouped = new Map<string, ProjectWorkerAvailabilityView[]>()
  for (const fact of availability) {
    const userLabel = userLabels.find(({ userId }) => userId === fact.userId)
    const agentLabel = agentLabels.find(({ agentId }) => agentId === fact.agentId)
    if (!userLabel || !agentLabel || agentLabel.ownerUserId !== fact.userId) {
      throw new Error(`Worker availability ${fact.agentId} lacks exact Project label facts.`)
    }
    const contentReadiness = readiness.find(({ userId }) => userId === fact.userId) ?? null
    const providerPrincipalFact = contentReadiness === null
      ? null
      : providerFacts.find(({ userId }) => userId === fact.userId) ?? null
    const providerPrincipalSnapshotStatus = contentReadiness === null
      ? 'not_applicable' as const
      : providerPrincipalFact === null
        ? 'missing' as const
        : contentReadiness.providerPrincipalFactId === providerPrincipalFact.providerPrincipalFactId &&
            contentReadiness.snapshottedFactRevision === providerPrincipalFact.revision
          ? 'match' as const
          : 'stale' as const
    const membership = memberships.find(({ userId }) => userId === fact.userId) ?? null
    const taskAuthorities = authorities.filter(({ userId }) => userId === fact.userId)
    const revision = Math.max(
      fact.revision,
      membership?.revision ?? 1,
      contentReadiness?.revision ?? 1,
      providerPrincipalFact?.revision ?? 1,
      ...taskAuthorities.map(({ revision: authorityRevision }) => authorityRevision)
    )
    const view: ProjectWorkerAvailabilityView = {
      schemaVersion: 1,
      type: 'project_worker_availability_view',
      projectId: project.projectId,
      userId: fact.userId,
      agentId: fact.agentId,
      revision,
      availability: fact,
      membership,
      taskAuthorities,
      providerPrincipalFact,
      providerPrincipalSnapshotStatus,
      contentReadiness,
      observedAt: snapshot?.observedAt ?? fact.observedAt
    }
    const group = grouped.get(fact.userId) ?? []
    group.push(view)
    grouped.set(fact.userId, group)
  }
  return [...grouped.entries()].map(([userId, projectAvailability]) => {
    const userLabel = userLabels.find((candidate) => candidate.userId === userId)
    if (!userLabel) throw new Error(`Worker User ${userId} lacks an exact Project label fact.`)
    return {
      userId,
      displayName: userLabel.displayName,
      agents: projectAvailability.map((availabilityView) => {
        const label = agentLabels.find(({ agentId }) => agentId === availabilityView.agentId)
        if (!label) throw new Error(`Worker Agent ${availabilityView.agentId} lacks an exact label fact.`)
        return { displayName: label.displayName, projectAvailability: availabilityView }
      })
    }
  })
}

function availableWorkerGroups(
  workerDirectory: WorkerDirectorySnapshot
): ProjectCoordinatorWorkspace['availableWorkerGroups'] {
  const grouped = new Map<string, Array<Readonly<{
    displayName: string
    availability: WorkerAvailabilityProjection
  }>>>()
  for (const availability of workerDirectory.availability) {
    const agentLabel = workerDirectory.agentLabels.find(({ agentId }) => (
      agentId === availability.agentId
    ))
    if (!agentLabel ||
        agentLabel.ownerUserId !== availability.userId ||
        agentLabel.deviceId !== availability.deviceId) {
      throw new Error(`Worker availability ${availability.agentId} lacks its exact Cloud Agent label.`)
    }
    const agents = grouped.get(availability.userId) ?? []
    agents.push({ displayName: agentLabel.displayName, availability })
    grouped.set(availability.userId, agents)
  }
  return [...grouped.entries()].map(([userId, agents]) => {
    const userLabel = workerDirectory.userLabels.find((label) => label.userId === userId)
    if (!userLabel) throw new Error(`Worker User ${userId} lacks its exact Cloud label.`)
    return { userId, displayName: userLabel.displayName, agents }
  })
}

function factItems<T>(
  snapshot: ProjectFactSnapshot | undefined,
  collection: ProjectCoordinationCollection
): T[] {
  return [...(snapshot?.pages.get(collection) ?? [])] as T[]
}

function projectPlanFromEntity(entity: unknown): ProjectPlan {
  return projectPlanSchema.parse(entity)
}

function requireReadyProject(
  workspace: ProjectCoordinatorWorkspace,
  projectId: string
): ProjectCoordinatorProject {
  if (workspace.connection.state !== 'ready') {
    throw new Error(`Project coordination is ${workspace.connection.state}.`)
  }
  const project = workspace.projects.find((candidate) => candidate.project.projectId === projectId)
  if (!project) throw new Error('The exact Project is not visible to the current OIDC User.')
  return project
}

function attachPlanAssignments(
  workspace: ProjectCoordinatorWorkspace,
  plan: ProjectPlan,
  assignments: readonly ProjectCoordinatorPlanAssignment[]
): ProjectCoordinatorWorkspace {
  return projectCoordinatorWorkspaceSchema.parse({
    ...workspace,
    projects: workspace.projects.map((project) => (
      project.project.projectId === plan.projectId &&
      project.plan?.plan.projectPlanId === plan.projectPlanId &&
      project.plan.plan.planDigest === plan.planDigest
        ? { ...project, plan: { ...project.plan, assignments } }
        : project
    ))
  })
}

function scopedIdempotencyKey(base: string, operation: string): string {
  const scoped = `${base}.${operation}`
  if (!/^idem_[A-Za-z0-9._:-]{11,123}$/u.test(scoped) || scoped.length > 128) {
    throw new Error('The Host invocation idempotency key cannot be scoped safely.')
  }
  return scoped
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

/**
 * Purpose-locked delegation to Identity. Device keys and signature operations
 * remain entirely inside the Identity service owner.
 */
export function createProjectContentProvisioningAttestationSigningPort(
  service: DeviceFactAttestationSigningService
): ProjectContentProvisioningAttestationSigningPort {
  return Object.freeze({
    signFactualPayload: (input) => service.signDeviceFact({
      ...input,
      purpose: 'project-content-provisioning-attestation'
    })
  })
}
