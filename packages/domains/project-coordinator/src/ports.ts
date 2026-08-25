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
  projectPlanSchema,
  projectPlanTaskSchema,
  type Project,
  type ProjectAgentLabelFact,
  type ProjectCoordinationCollection,
  type ProjectContentReadiness,
  type ProjectMembership,
  type ProjectPlan,
  type ProjectUserLabelFact,
  type ProjectWorkerAvailabilityView,
  type ProviderDirectoryPrincipalFact,
  type RestResponse,
  type TaskAuthority,
  type TaskExecution,
  type TaskResultSubmission,
  type TaskReviewDecision,
  type WorkerAvailabilityProjection
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

export type ProjectContentProvisioningAttestationSigningPort = Readonly<{
  signFactualPayload(
    input: Omit<DeviceFactSigningRequest, 'purpose'>
  ): Promise<DeviceFactSignatureMetadata>
}>

export type ProjectCoordinatorMainPorts = Readonly<{
  workspace: ProjectCoordinatorCloudWorkspacePort
  plan: ProjectCoordinatorPlanPort
  provisioningAttestationSigning: ProjectContentProvisioningAttestationSigningPort
  coordinatorCloudCommands: CoordinatorCloudCommandService
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
        connection: { state: 'identity_required' }, observedAt, projects: []
      })
    }
    if (status.state === 'device_required') {
      return projectCoordinatorWorkspaceSchema.parse({
        connection: { state: 'device_required', reason: status.reason }, observedAt, projects: []
      })
    }
    if (status.state === 'unavailable') {
      return projectCoordinatorWorkspaceSchema.parse({
        connection: { state: 'cloud_unavailable', reason: status.reason }, observedAt, projects: []
      })
    }

    const listed = await listAllProjects(options.transport, requestId)
    const focusedProject = input.projectId
      ? listed.projects.find(({ projectId }) => projectId === input.projectId)
      : listed.projects.length === 1
        ? listed.projects[0]
        : undefined
    const facts = focusedProject
      ? await readAllProjectFacts(options.transport, focusedProject, requestId)
      : undefined
    const projects = await Promise.all(listed.projects.map(async (project) => {
      const view = projectCoordinatorProjectView(
        project,
        project.projectId === focusedProject?.projectId ? facts : undefined
      )
      if (!view.plan || !options.readPlanAssignments) return view
      return {
        ...view,
        plan: {
          ...view.plan,
          assignments: await options.readPlanAssignments(view.plan.plan)
        }
      }
    }))
    return projectCoordinatorWorkspaceSchema.parse({
      connection: { state: 'ready', userId: status.userId, deviceId: status.deviceId },
      observedAt: facts?.observedAt ?? listed.observedAt,
      ...(focusedProject ? { focusedProjectId: focusedProject.projectId } : {}),
      projects
    })
  }

  return Object.freeze({
    readWorkspace,
    createProject: async (rawInput, idempotencyKey) => {
      const input = projectCoordinatorProjectCreateInputSchema.parse(rawInput)
      const response = await executeUserCloud(options.transport, {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: requestId(),
        type: 'project.create',
        idempotencyKey,
        ...input
      })
      if (response.type !== 'rest.project_created') {
        throw new Error(`Project create returned ${response.type}.`)
      }
      return projectCoordinatorProjectCreateResultSchema.parse({
        createdProjectId: response.project.projectId,
        workspace: await readWorkspace({ projectId: response.project.projectId })
      })
    }
  })
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
      const candidates = project.workerGroups.flatMap((group) => group.agents.map((agent) => ({
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
      const visibleAgentIds = new Set(project.workerGroups.flatMap((group) => (
        group.agents.map(({ projectAvailability }) => projectAvailability.agentId)
      )))
      if (input.assignments.some(({ selectedAgentId }) => (
        selectedAgentId !== null && !visibleAgentIds.has(selectedAgentId)
      ))) {
        throw new Error('A Plan assignment must select an exact visible Agent.')
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
      return parsed
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
  }>> = PROJECT_COORDINATION_COLLECTIONS.map((collection) => ({
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
  snapshot?: ProjectFactSnapshot
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
    plan: plan ? { plan, assignments: [] } : null,
    workerGroups: projectWorkerGroups(project, snapshot),
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
    provisioning: {
      intent: intents.at(-1) ?? null,
      attestation: attestations.at(-1) ?? null,
      binding: bindings.at(-1) ?? null,
      recoveryActions: factItems(snapshot, 'visible_recovery_actions')
    }
  }
}

function projectWorkerGroups(
  project: Project,
  snapshot: ProjectFactSnapshot | undefined
): ProjectCoordinatorProject['workerGroups'] {
  const userLabels = factItems<ProjectUserLabelFact>(snapshot, 'user_label_facts')
  const agentLabels = factItems<ProjectAgentLabelFact>(snapshot, 'agent_label_facts')
  const availability = factItems<WorkerAvailabilityProjection>(snapshot, 'worker_availability')
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
