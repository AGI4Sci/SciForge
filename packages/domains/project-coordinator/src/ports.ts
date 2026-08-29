import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  domainMainAgentExecutionOutputSchemaSchema,
  type DomainMainAgentExecutionHost
} from '@sciforge/domain-sdk/agent-execution'
import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'
import {
  AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
  type AuthenticatedCloudTransport
} from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import {
  CURRENT_PROTOCOL_VERSION,
  PROJECT_COORDINATION_COLLECTIONS,
  PROJECT_INVITATION_READ_COLLECTIONS,
  PROJECT_COORDINATION_MAX_PAGE_SIZE,
  agentInboxMessageSchema,
  projectSchema,
  projectPlanSchema,
  projectPlanTaskDeclarationSchema,
  projectPlanTaskDeclarationsSchema,
  projectMembershipSchema,
  taskFileDestinationNameSchema,
  humanAnswerSchema,
  humanNeededSchema,
  type Project,
  type AgentInboxMessage,
  type ProjectCoordinationCollection,
  type ProjectContentReadiness,
  type ProjectFinalSummary,
  type ProjectMembership,
  type ProjectPlan,
  type ProjectPlanTaskDeclaration,
  type ProjectRecord,
  type ProjectWorkerAvailabilityView,
  type ProviderDirectoryPrincipalFact,
  type RestResponse,
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
  projectCoordinatorProjectCreateReceiptSchema,
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
  projectCoordinatorPlanConfirmInputSchema,
  projectCoordinatorWorkspaceReadInputSchema,
  projectCoordinatorWorkspaceSchema,
  type ProjectCoordinatorProject,
  type ProjectCoordinatorProjectCreateInput,
  type ProjectCoordinatorProjectCreateReceipt,
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
  type ProjectCoordinatorPlanDraftGenerateFailureReason,
  type ProjectCoordinatorPlanDraftReadInput,
  type ProjectCoordinatorPlanDraftSubmitInput,
  type ProjectCoordinatorPlanSubmitResult,
  type ProjectCoordinatorPlanConfirmInput,
  type ProjectCoordinatorWorkflowPlan,
  type ProjectCoordinatorWorkspace,
  type ProjectCoordinatorWorkspaceReadInput
} from './contract.js'
import { ProjectCoordinatorStateStore } from './state.js'
import {
  projectCoordinatorPlanningRuntimeReadiness,
  projectCoordinatorPlanningTaskReadiness
} from './plan-readiness.js'
import type { ProjectCoordinatorProvisioningPort } from './provisioning.js'
import type { ProjectCoordinatorRecoveryPort } from './recovery.js'
import type { ProjectCoordinatorArtifactReviewPort } from './artifact-review.js'
import type { ProjectCoordinatorContinuationPort } from './continuation.js'

const PROJECT_COORDINATOR_PROJECT_FACT_COLLECTIONS = PROJECT_COORDINATION_COLLECTIONS.filter(
  (collection) => collection !== 'agent_label_facts' &&
    collection !== 'worker_availability'
)

export type ProjectCoordinatorWorkspacePort = Readonly<{
  readWorkspace(input: ProjectCoordinatorWorkspaceReadInput): Promise<ProjectCoordinatorWorkspace>
}>

export type ProjectCoordinatorCloudWorkspacePort = ProjectCoordinatorWorkspacePort & Readonly<{
  createProject(input: ProjectCoordinatorProjectCreateInput): Promise<ProjectCoordinatorProjectCreateReceipt>
}>

export type ProjectCoordinatorPlanPort = Readonly<{
  generateDraft(input: ProjectCoordinatorPlanDraftGenerateInput): Promise<ProjectCoordinatorPlanDraft>
  readDraft(input: ProjectCoordinatorPlanDraftReadInput): Promise<ProjectCoordinatorPlanDraft | null>
  editDraft(input: ProjectCoordinatorPlanDraftEditInput): Promise<ProjectCoordinatorPlanDraft>
  submitDraft(
    input: ProjectCoordinatorPlanDraftSubmitInput,
    idempotencyKey: string
  ): Promise<ProjectCoordinatorPlanSubmitResult>
  confirm(
    input: ProjectCoordinatorPlanConfirmInput,
    idempotencyKey: string
  ): Promise<ProjectCoordinatorWorkspace>
  activateAndReconcile(
    input: Pick<ProjectCoordinatorWorkflowPlan,
      'projectId' | 'projectPlanId' | 'expectedCoordinatorAuthorityEpoch' |
      'expectedExecutionAuthorityEpoch' | 'expectedPlanRevision' | 'planDigest'>,
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
  coordinatorCloudCommands?: CoordinatorCloudCommandService
  readCoordinatorTransferFeedback?: (
    projectId: string
  ) => Promise<ProjectCoordinatorTransferFeedback | null>
  createIntentState?: Pick<ProjectCoordinatorStateStore, 'resolveProjectCreateIntent'>
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
        connection: { state: 'identity_required' }, observedAt,
        availableWorkerUsers: [], providerPrincipalFacts: [], projects: []
      })
    }
    if (status.state === 'device_required') {
      return projectCoordinatorWorkspaceSchema.parse({
        connection: { state: 'device_required', reason: status.reason }, observedAt,
        availableWorkerUsers: [], providerPrincipalFacts: [], projects: []
      })
    }
    if (status.state === 'unavailable') {
      return projectCoordinatorWorkspaceSchema.parse({
        connection: { state: 'cloud_unavailable', reason: status.reason }, observedAt,
        availableWorkerUsers: [], providerPrincipalFacts: [], projects: []
      })
    }

    const listed = await listAllProjects(options.transport, requestId)
    const workerDirectory = await readAllWorkerDirectory(options.transport, requestId)
    const providerPrincipalFacts = await readAllProviderPrincipalFacts(
      options.transport,
      [...new Set([
        status.userId,
        ...workerDirectory.availability.map(({ userId }) => userId)
      ])],
      requestId
    )
    const focusedProject = input.projectId
      ? listed.projects.find(({ projectId }) => projectId === input.projectId)
      : listed.projects.length === 1
        ? listed.projects[0]
        : undefined
    const facts = focusedProject
      ? await readAllProjectFacts(options.transport, focusedProject, status.userId, requestId)
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
      return view
    }))
    return projectCoordinatorWorkspaceSchema.parse({
      connection: { state: 'ready', userId: status.userId, deviceId: status.deviceId },
      observedAt: facts?.observedAt ?? workerDirectory.observedAt ?? listed.observedAt,
      ...(focusedProject ? { focusedProjectId: focusedProject.projectId } : {}),
      availableWorkerUsers: availableWorkerUsers(workerDirectory),
      providerPrincipalFacts,
      projects
    })
  }

  return Object.freeze({
    readWorkspace,
    createProject: async (rawInput) => {
      const input = projectCoordinatorProjectCreateInputSchema.parse(rawInput)
      const identity = options.transport.status()
      if (identity.state !== 'ready') {
        throw new Error('Project creation requires an authenticated User and Device.')
      }
      if (!options.coordinatorCloudCommands) {
        throw new Error('Project creation requires the current Device Agent command service.')
      }
      const createIntentId = options.createIntentState
        ? await options.createIntentState.resolveProjectCreateIntent(identity.userId, input)
        : input.createIntentId
      const canonicalInput = projectCoordinatorProjectCreateInputSchema.parse({
        ...input,
        createIntentId
      })
      const response = await options.coordinatorCloudCommands.execute({
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: requestId(),
        type: 'project.create',
        idempotencyKey: projectCreateIdempotencyKey(identity.userId, createIntentId),
        ...canonicalInput
      })
      if (response.type !== 'rest.project_created') {
        throw new Error(`Project create returned ${response.type}.`)
      }
      if (response.project.ownerUserId !== identity.userId) {
        throw new Error('Project create did not preserve the current Agent owner authority.')
      }
      return projectCoordinatorProjectCreateReceiptSchema.parse({
        createIntentId,
        createdProjectId: response.project.projectId,
        workspace: await readWorkspace({ projectId: response.project.projectId })
      })
    }
  })
}

const generatedPlanContentSchema = z.object({
  tasks: projectPlanTaskDeclarationsSchema,
  rationale: projectCoordinatorPlanDraftSchema.unwrap().shape.rationale
}).strict().readonly()

const generatedPlanFileIntentSelectionSchema = z.object({
  inputs: z.array(z.object({
    sourceInputIndex: z.number().int().min(0).max(99),
    destinationName: taskFileDestinationNameSchema,
    expectedSemanticRevision: z.string().trim().min(1).max(256).nullable(),
    expectedMediaType: z.string().trim().min(1).max(256).nullable()
  }).strict()).max(100),
  dependencyInputs: z.array(z.object({
    planItemId: projectPlanTaskDeclarationSchema.shape.planItemId,
    outputIndex: z.number().int().min(0).max(99),
    destinationName: taskFileDestinationNameSchema
  }).strict()).max(100),
  output: z.object({
    fileName: taskFileDestinationNameSchema,
    mediaType: z.string().trim().min(1).max(256),
    maxBytes: z.number().int().min(1).max(1_073_741_824)
  }).strict()
}).strict()

const generatedPlanModelTaskShape = {
  planItemId: projectPlanTaskDeclarationSchema.shape.planItemId,
  title: projectPlanTaskDeclarationSchema.shape.title,
  objective: projectPlanTaskDeclarationSchema.shape.objective,
  completionCriteria: projectPlanTaskDeclarationSchema.shape.completionCriteria,
  dependencyPlanItemIds: projectPlanTaskDeclarationSchema.shape.dependencyPlanItemIds,
  requiredCapabilityTags: projectPlanTaskDeclarationSchema.shape.requiredCapabilityTags
}

const generatedPlanModelContentSchema = z.object({
  tasks: z.array(z.object({
    ...generatedPlanModelTaskShape,
    fileIntent: generatedPlanFileIntentSelectionSchema.nullable()
  }).strict()).min(1).max(1_000),
  rationale: projectCoordinatorPlanDraftSchema.unwrap().shape.rationale
}).strict().readonly()

function generatedPlanOutputJsonSchema() {
  return domainMainAgentExecutionOutputSchemaSchema.parse(z.toJSONSchema(
    generatedPlanModelContentSchema,
    {
      target: 'draft-07',
      unrepresentable: 'throw'
    }
  ))
}

function generatedTaskFileIntent(options: Readonly<{
  selection: z.infer<typeof generatedPlanFileIntentSelectionSchema>
  fileSourceInputs: readonly Readonly<{
    sourceInputIndex: number
    locator: ProjectCoordinatorPlanDraftGenerateInput['sourceInputLocators'][number]
  }>[]
}>) {
  return {
    schemaVersion: 2 as const,
    inputs: options.selection.inputs.map((input) => {
      const source = options.fileSourceInputs.find(
        ({ sourceInputIndex }) => sourceInputIndex === input.sourceInputIndex
      )
      if (!source) {
        throw new Error('Generated file intent selected an unavailable exact input locator.')
      }
      return {
        kind: 'content-space.input-file' as const,
        locator: source.locator,
        destinationName: input.destinationName,
        expectedSemanticRevision: input.expectedSemanticRevision,
        expectedMediaType: input.expectedMediaType
      }
    }),
    dependencyInputs: options.selection.dependencyInputs,
    output: {
      kind: 'content-space.output-new' as const,
      target: 'project-binding-root' as const,
      mode: 'upload-new' as const,
      fileName: options.selection.output.fileName,
      mediaType: options.selection.output.mediaType,
      maxBytes: options.selection.output.maxBytes
    }
  }
}

export class ProjectCoordinatorPlanGenerationError extends Error {
  readonly reason: ProjectCoordinatorPlanDraftGenerateFailureReason

  constructor(
    reason: ProjectCoordinatorPlanDraftGenerateFailureReason,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'ProjectCoordinatorPlanGenerationError'
    this.reason = reason
  }
}

function workerGroupCanPlanTask(
  project: ProjectCoordinatorProject,
  group: ProjectCoordinatorProject['workerGroups'][number],
  task: ProjectPlanTaskDeclaration,
  observedAt: string
): boolean {
  return group.agents.some(({ projectAvailability }) => (
    projectCoordinatorPlanningTaskReadiness(
      project,
      projectAvailability,
      task,
      observedAt
    ).eligible
  ))
}

function assertTasksHavePlanningCandidate(
  project: ProjectCoordinatorProject,
  tasks: readonly ProjectPlanTaskDeclaration[],
  observedAt: string
): void {
  for (const task of tasks) {
    if (project.workerGroups.some((group) => (
      workerGroupCanPlanTask(project, group, task, observedAt)
    ))) continue
    throw new Error(`Plan item ${task.planItemId} has no planning-ready Runtime with one complete capability profile.`)
  }
}

function assertAssignmentsHavePlanningRuntime(
  project: ProjectCoordinatorProject,
  tasks: readonly ProjectPlanTaskDeclaration[],
  assignments: readonly ProjectCoordinatorPlanAssignment[],
  observedAt: string
): void {
  const tasksById = new Map(tasks.map((task) => [task.planItemId, task]))
  const groupsByUserId = new Map(project.workerGroups.map((group) => [group.userId, group]))
  for (const assignment of assignments) {
    if (assignment.workerUserId === null) continue
    const task = tasksById.get(assignment.planItemId)
    const group = groupsByUserId.get(assignment.workerUserId)
    if (!task || !group) {
      throw new Error('A Plan assignment must select a visible Worker User.')
    }
    if (!workerGroupCanPlanTask(project, group, task, observedAt)) {
      throw new Error(`Plan item ${task.planItemId} requires one planning-ready Runtime owned by the selected Worker User.`)
    }
  }
}

export function createProjectCoordinatorPlanPort(options: Readonly<{
  settings: DomainMainPackageSettingsHost
  state?: ProjectCoordinatorStateStore
  workspace: ProjectCoordinatorWorkspacePort
  getAgentExecution(): DomainMainAgentExecutionHost | undefined
  continuation: ProjectCoordinatorContinuationPort
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
    return { project, observedAt: workspace.observedAt }
  }

  return Object.freeze({
    generateDraft: async (rawInput) => {
      const input = projectCoordinatorPlanDraftGenerateInputSchema.parse(rawInput)
      const { project, observedAt } = await readProject(input.projectId)
      const candidates = project.workerGroups
        .map((group) => {
          const profiles = new Map(group.agents.flatMap(({ projectAvailability }) => {
            const readiness = projectCoordinatorPlanningRuntimeReadiness(
              project,
              projectAvailability,
              observedAt
            )
            if (!readiness.eligible) return []
            const profile = {
              eligibleTaskScopes: [...readiness.eligibleTaskScopes].sort(),
              capabilityTags: [...projectAvailability.availability.runtimeCapabilityTags].sort()
            }
            return [[JSON.stringify(profile), profile] as const]
          }))
          return {
            userId: group.userId,
            displayName: group.displayName,
            runtimeProfiles: [...profiles.values()]
          }
        })
        .filter(({ runtimeProfiles }) => runtimeProfiles.length > 0)
      if (candidates.length === 0) {
        throw new ProjectCoordinatorPlanGenerationError(
          'planning_candidates_unavailable',
          'No fresh online Worker User Runtime is available for Project planning.'
        )
      }
      const agentExecution = options.getAgentExecution()
      if (!agentExecution) {
        throw new ProjectCoordinatorPlanGenerationError(
          'runtime_unavailable',
          'The local Agent Runtime is unavailable.'
        )
      }
      const fileSourceInputs = input.sourceInputLocators
        .filter((locator) => locator.kind === 'content-space.file-reference')
        .map((locator, sourceInputIndex) => ({ sourceInputIndex, locator }))
      let generated: Awaited<ReturnType<DomainMainAgentExecutionHost['run']>>
      try {
        generated = await agentExecution.run({
          clientDirectiveId: `project-plan:v2:${project.project.projectId}:${project.project.revision}`,
          prompt: [
            `Project: ${project.project.displayName}`,
            `Goal: ${project.project.goal}`,
            `Owner instruction: ${input.instruction}`,
            `Budget: ${JSON.stringify(project.project.budget)}`,
            `Exact file input choices: ${JSON.stringify(fileSourceInputs)}`,
            `Worker User candidates: ${JSON.stringify(candidates)}`,
            'Each Task must match one runtimeProfiles entry: fileIntent null requires text_tasks in eligibleTaskScopes, a fileIntent requires file_tasks in eligibleTaskScopes, and requiredCapabilityTags must be a subset of that same entry capabilityTags. Never combine fields across Runtime profiles.',
            'The final response is constrained by the supplied JSON Schema. Return exactly one object with tasks and rationale.',
            'Every task must contain only planItemId, title, objective, completionCriteria, dependencyPlanItemIds, requiredCapabilityTags, and fileIntent.',
            'Use a unique stable item_* planItemId. Dependencies must reference another item in this same response. Capability tags must describe actual requirements and use the lowercase tag format.',
            'Do not emit id, description, assignee, dependencies, status, or any other convenience fields. Worker User assignment is a later Human decision.',
            'A fileIntent is a logical Plan declaration selection containing only inputs, dependencyInputs, and output; the host materializes schemaVersion 2. Never include a schemaVersion or bindingRevision; Cloud binds the created Task to the current active Project Content root when its Offer is committed.',
            'A non-null fileIntent selects existing inputs only by sourceInputIndex from Exact file input choices. Never copy or invent a locator identity.',
            'dependencyInputs must be an array, using [] when none are needed. Each entry selects an outputIndex from a direct dependencyPlanItemId whose fileIntent is non-null. Do not select transitive dependencies. Keep all static and dependency destinationName values unique and use at most 100 total inputs.'
          ].join('\n'),
          outputSchema: generatedPlanOutputJsonSchema(),
          ...(input.modelId ? { model: input.modelId } : {}),
          interaction: 'reviewable',
          mode: 'plan'
        })
      } catch (cause) {
        throw new ProjectCoordinatorPlanGenerationError(
          'runtime_execution_failed',
          'The local Plan Runtime could not complete the structured-output turn.',
          { cause }
        )
      }
      if (generated.state !== 'completed') {
        throw new ProjectCoordinatorPlanGenerationError(
          'runtime_execution_failed',
          `Local Plan Runtime ended in ${generated.state}.`
        )
      }
      let decoded: unknown
      try {
        decoded = JSON.parse(generated.text)
      } catch (cause) {
        throw new ProjectCoordinatorPlanGenerationError(
          'invalid_structured_output',
          'Local Plan Runtime returned non-JSON structured output.',
          { cause }
        )
      }
      const parsedModelContent = generatedPlanModelContentSchema.safeParse(decoded)
      if (!parsedModelContent.success) {
        throw new ProjectCoordinatorPlanGenerationError(
          'invalid_structured_output',
          'Local Plan Runtime returned output that violates the structured generation contract.',
          { cause: parsedModelContent.error }
        )
      }
      let canonicalContent: unknown
      try {
        canonicalContent = {
          tasks: parsedModelContent.data.tasks.map((task) => ({
            ...task,
            fileIntent: task.fileIntent === null
              ? null
              : generatedTaskFileIntent({
                  selection: task.fileIntent,
                  fileSourceInputs
                })
          })),
          rationale: parsedModelContent.data.rationale
        }
      } catch (cause) {
        throw new ProjectCoordinatorPlanGenerationError(
          'invalid_structured_output',
          'Local Plan Runtime returned an invalid Project file selection.',
          { cause }
        )
      }
      const parsedContent = generatedPlanContentSchema.safeParse(canonicalContent)
      if (!parsedContent.success) {
        throw new ProjectCoordinatorPlanGenerationError(
          'invalid_structured_output',
          'Local Plan Runtime returned output that violates the Project Plan contract.',
          { cause: parsedContent.error }
        )
      }
      const content = parsedContent.data
      try {
        assertTasksHavePlanningCandidate(project, content.tasks, observedAt)
      } catch (cause) {
        throw new ProjectCoordinatorPlanGenerationError(
          'invalid_structured_output',
          'Local Plan Runtime returned tasks that no current Worker User can accept.',
          { cause }
        )
      }
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
          workerUserId: null,
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
      const { project, observedAt } = await readProject(input.projectId)
      assertAssignmentsHavePlanningRuntime(
        project,
        input.tasks,
        input.assignments,
        observedAt
      )
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
      if (draft.assignments.some(({ workerUserId }) => workerUserId === null)) {
        throw new Error('Every Plan item requires a Worker User before submit.')
      }
      const { project, observedAt } = await readProject(input.projectId)
      assertAssignmentsHavePlanningRuntime(
        project,
        draft.tasks,
        draft.assignments,
        observedAt
      )
      if (!options.coordinatorCloudCommands) {
        throw new Error('Coordinator Agent Cloud command mediation is unavailable.')
      }
      const assignmentsByPlanItemId = new Map(
        draft.assignments.map((assignment) => [assignment.planItemId, assignment])
      )
      const assignedTasks = draft.tasks.map((task) => {
        const assignment = assignmentsByPlanItemId.get(task.planItemId)
        if (!assignment?.workerUserId) {
          throw new Error(`Plan item ${task.planItemId} requires a Worker User before submit.`)
        }
        return { ...task, workerUserId: assignment.workerUserId }
      })
      const planFacts = {
        projectId: draft.projectId,
        expectedProjectRevision: draft.expectedProjectRevision,
        expectedCoordinatorAuthorityEpoch: draft.expectedCoordinatorAuthorityEpoch,
        supersedesProjectPlanId: draft.supersedesProjectPlanId,
        sourceInputLocators: draft.sourceInputLocators,
        tasks: assignedTasks,
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
      await state.completeSubmittedDraft(plan, draft.draftRevision)
      const workspace = await options.workspace.readWorkspace({ projectId: draft.projectId })
      return projectCoordinatorPlanSubmitResultSchema.parse({ plan, workspace })
    },
    confirm: async (rawInput, idempotencyKey) => {
      const input = projectCoordinatorPlanConfirmInputSchema.parse(rawInput)
      if (!options.transport) throw new Error('OIDC Cloud transport is unavailable.')
      const currentWorkspace = await options.workspace.readWorkspace({ projectId: input.projectId })
      const currentProject = requireReadyProject(currentWorkspace, input.projectId)
      const currentPlan = currentProject.plan
      if (
        !currentPlan ||
        currentPlan.plan.projectPlanId !== input.projectPlanId ||
        currentPlan.plan.planDigest !== input.planDigest
      ) {
        throw new Error('Plan confirmation requires the exact current submitted Plan and assignments.')
      }
      if (currentProject.project.status === 'draft') {
        if (input.initialTeam === null) {
          throw new Error('The first confirmed Plan requires one exact initial Team/content configuration.')
        }
        const assignmentUsers = currentPlan.plan.tasks.map(({ workerUserId }) => workerUserId)
        const expectedUsers = new Set([
          currentProject.project.ownerUserId,
          ...assignmentUsers.filter((userId): userId is string => userId !== null)
        ])
        const confirmedUsers = input.initialTeam.members.map(({ userId }) => userId)
        if (
          confirmedUsers.length !== expectedUsers.size ||
          confirmedUsers.some((userId) => !expectedUsers.has(userId))
        ) {
          throw new Error('Initial Team must exactly match the Owner and durable Plan Worker User assignments.')
        }
        if (
          input.initialTeam.mode === 'required' &&
          input.initialTeam.contentOwnerUserId !== currentProject.project.ownerUserId
        ) {
          throw new Error('Initial Project Content ownership is fixed to the authenticated Project Owner.')
        }
      } else if (input.initialTeam !== null) {
        throw new Error('Only a draft Project may establish its initial Team/content configuration.')
      }
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
        planDigest: input.planDigest,
        initialTeam: input.initialTeam
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
      return projectCoordinatorWorkspaceSchema.parse(
        await options.workspace.readWorkspace({ projectId: input.projectId })
      )
    },
    activateAndReconcile: async (input, idempotencyKey) => {
      if (!options.transport) throw new Error('OIDC Cloud transport is unavailable.')
      let workspace = await options.workspace.readWorkspace({ projectId: input.projectId })
      const projectView = requireReadyProject(workspace, input.projectId)
      if (
        projectView.project.coordinatorAuthorityEpoch !== input.expectedCoordinatorAuthorityEpoch ||
        projectView.project.executionAuthorityEpoch !== input.expectedExecutionAuthorityEpoch
      ) {
        throw new Error('Project workflow lost its exact Coordinator or execution authority epoch.')
      }
      const confirmedPlan = projectView.plan?.plan
      if (
        !confirmedPlan ||
        confirmedPlan.projectPlanId !== input.projectPlanId ||
        confirmedPlan.revision !== input.expectedPlanRevision ||
        confirmedPlan.planDigest !== input.planDigest ||
        confirmedPlan.state !== 'confirmed'
      ) {
        throw new Error('Project workflow lost the exact current confirmed Plan.')
      }
      const currentMemberships = projectView.provisioning.memberships.filter(({ state }) => (
        state !== 'removed'
      ))
      if (currentMemberships.some(({ state }) => state !== 'active')) {
        throw new Error('Project workflow cannot activate before every invitation and Team Membership is ready.')
      }
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
      return options.continuation.reconcileProject(confirmedPlan.projectId)
    }
  })
}

export function createProjectCoordinatorActionPort(options: Readonly<{
  workspace: ProjectCoordinatorWorkspacePort
  coordinatorCloudCommands: CoordinatorCloudCommandService
  transport: AuthenticatedCloudTransport
  state: ProjectCoordinatorStateStore
  continuation: Pick<ProjectCoordinatorContinuationPort, 'reconcileProject'>
  onBackgroundContinuationFailure?(projectId: string, error: unknown): void
  requestId?: () => `req_${string}`
}>): ProjectCoordinatorActionPort {
  const requestId = options.requestId ?? (() => `req_${randomUUID().replaceAll('-', '')}`)
  const reconcileInBackground = (projectId: string): void => {
    void options.continuation.reconcileProject(projectId).catch((error: unknown) => {
      options.onBackgroundContinuationFailure?.(projectId, error)
    })
  }
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
        targetUserId: input.targetUserId,
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
        needed.targetUserId !== input.targetUserId ||
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
      const workspace = await options.workspace.readWorkspace({ projectId: input.projectId })
      if (input.decision === 'accept') reconcileInBackground(input.projectId)
      return workspace
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
      if (message.payload.type === 'project.started') {
        const started = message.payload
        const workspace = await options.workspace.readWorkspace({ projectId: started.projectId })
        const project = requireReadyProject(workspace, started.projectId)
        if (message.recipientAgentId !== project.project.coordinatorAgentId) return
        if (project.project.revision < started.revision) {
          throw new Error('Project start notification does not match current Cloud authority.')
        }
        await options.continuation.reconcileProject(started.projectId)
        return
      }
      if (message.payload.type === 'project.plan.confirmed') {
        const confirmed = message.payload
        const workspace = await options.workspace.readWorkspace({ projectId: confirmed.projectId })
        const project = requireReadyProject(workspace, confirmed.projectId)
        const plan = project.plan?.plan
        if (message.recipientAgentId !== project.project.coordinatorAgentId) return
        if (
          plan?.projectPlanId !== confirmed.projectPlanId ||
          plan.planDigest !== confirmed.planDigest ||
          plan.revision < confirmed.revision
        ) return
        await options.continuation.reconcileProject(confirmed.projectId)
        return
      }
      if (message.payload.type === 'task.offer.closed') {
        const closed = message.payload
        if (closed.audience !== 'coordinator') {
          throw new Error('Project Coordinator received a Worker-only Task offer closure.')
        }
        const workspace = await options.workspace.readWorkspace({ projectId: closed.projectId })
        const project = requireReadyProject(workspace, closed.projectId)
        if (message.recipientAgentId !== project.project.coordinatorAgentId) return
        const task = project.tasks.find(({ task }) => task.taskId === closed.taskId)?.task
        const offer = project.offers.find(({ taskOfferId }) => (
          taskOfferId === closed.taskOfferId
        ))
        if (!task || !offer || offer.projectId !== closed.projectId ||
            offer.taskId !== closed.taskId || offer.state !== closed.outcome ||
            offer.executionId !== null || offer.revision !== closed.offerRevision ||
            task.revision < closed.taskRevision ||
            (task.revision === closed.taskRevision && (
              task.status !== 'revision_requested' ||
              task.currentExecutionId !== null ||
              task.currentExecutionState !== null
            ))) {
          throw new Error('Task offer closure does not match fresh Cloud Task facts.')
        }
        return
      }
      if (message.payload.type === 'task.execution.failed') {
        const failed = message.payload
        const workspace = await options.workspace.readWorkspace({ projectId: failed.projectId })
        const project = requireReadyProject(workspace, failed.projectId)
        if (message.recipientAgentId !== project.project.coordinatorAgentId) return
        const taskView = project.tasks.find(({ task }) => task.taskId === failed.taskId)
        const execution = taskView?.executions.find(({ executionId }) => (
          executionId === failed.executionId
        ))
        if (!taskView || !execution || execution.projectId !== failed.projectId ||
            execution.taskId !== failed.taskId || execution.state !== 'failed' ||
            execution.fence.status !== 'fenced' ||
            execution.fence.reason !== 'execution_failed' ||
            execution.revision !== failed.executionRevision ||
            taskView.task.revision < failed.taskRevision ||
            failed.retryable !== (failed.taskStatus === 'revision_requested') ||
            (taskView.task.revision === failed.taskRevision && (
              taskView.task.status !== failed.taskStatus ||
              taskView.task.currentExecutionId !== failed.executionId ||
              taskView.task.currentExecutionState !== 'failed' ||
              (failed.retryable !== (taskView.task.completedAt === null))
            ))) {
          throw new Error('Task execution failure does not match fresh fenced Cloud facts.')
        }
        return
      }
      if (message.payload.type === 'task.execution.started') {
        const started = message.payload
        const workspace = await options.workspace.readWorkspace({ projectId: started.projectId })
        const project = requireReadyProject(workspace, started.projectId)
        if (message.recipientAgentId !== project.project.coordinatorAgentId) return
        const taskView = project.tasks.find(({ task }) => task.taskId === started.taskId)
        const execution = taskView?.executions.find(({ executionId }) => (
          executionId === started.executionId
        ))
        if (!taskView || !execution || execution.projectId !== started.projectId ||
            execution.taskId !== started.taskId || execution.startedAt === null ||
            execution.revision < started.executionRevision ||
            taskView.task.revision < started.taskRevision ||
            (execution.revision === started.executionRevision && execution.state !== 'running') ||
            (taskView.task.revision === started.taskRevision && (
              taskView.task.status !== 'in_progress' ||
              taskView.task.currentExecutionId !== started.executionId ||
              taskView.task.currentExecutionState !== 'running'
            ))) {
          throw new Error('Task execution start does not match fresh Cloud Task facts.')
        }
        await options.continuation.reconcileProject(started.projectId)
        return
      }
      if (message.payload.type === 'task.result.submitted') {
        const submitted = message.payload
        const workspace = await options.workspace.readWorkspace({ projectId: submitted.projectId })
        const project = requireReadyProject(workspace, submitted.projectId)
        if (message.recipientAgentId !== project.project.coordinatorAgentId) return
        const review = project.reviews.find(({ submission }) => (
          submission.resultSubmissionId === submitted.resultSubmissionId
        ))
        const task = project.tasks.find(({ task }) => task.taskId === submitted.taskId)
        const execution = task?.executions.find(({ executionId }) => (
          executionId === submitted.executionId
        ))
        if (
          !review ||
          review.submission.projectId !== submitted.projectId ||
          review.submission.taskId !== submitted.taskId ||
          review.submission.executionId !== submitted.executionId ||
          review.submission.revision < submitted.revision ||
          !execution
        ) {
          throw new Error('Task result notification does not match an immutable Cloud submission.')
        }
        await options.continuation.reconcileProject(submitted.projectId)
        return
      }
      if (message.payload.type === 'project_record.submitted') {
        const submitted = message.payload
        const workspace = await options.workspace.readWorkspace({ projectId: submitted.projectId })
        const project = requireReadyProject(workspace, submitted.projectId)
        if (message.recipientAgentId !== project.project.coordinatorAgentId) return
        const record = project.records.find(({ projectRecordId }) => (
          projectRecordId === submitted.projectRecordId
        ))
        if (!record || record.revision < submitted.revision) {
          throw new Error('ProjectRecord notification does not match a current accepted Cloud fact.')
        }
        await options.continuation.reconcileProject(submitted.projectId)
        return
      }
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
        if (message.recipientAgentId === transfer.coordinatorAgentId) {
          await options.continuation.reconcileProject(transfer.projectId)
        }
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
      const answerMembership = project.provisioning.memberships.find(({ userId }) => (
        userId === answer.answeredByUserId
      ))
      const answerMember = project.memberUsers.find(({ userId }) => userId === answer.answeredByUserId)
      if (
        message.recipientAgentId !== project.project.coordinatorAgentId ||
        answerMembership?.state !== 'active' ||
        answerMember?.status !== 'active' ||
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
        await options.continuation.reconcileProject(answer.projectId)
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
      await options.continuation.reconcileProject(answer.projectId)
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

async function readAllProviderPrincipalFacts(
  transport: AuthenticatedCloudTransport,
  userIds: readonly string[],
  requestId: () => `req_${string}`
): Promise<readonly ProviderDirectoryPrincipalFact[]> {
  const facts: ProviderDirectoryPrincipalFact[] = []
  let afterFactId: string | undefined
  do {
    const response = await executeUserCloud(transport, {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      requestId: requestId(),
      type: 'provider_directory_principal.list',
      userIds: [...userIds],
      includeDegraded: true,
      ...(afterFactId ? { afterFactId } : {}),
      limit: 1_000
    })
    if (response.type !== 'rest.provider_directory_principal_page') {
      throw new Error(`Provider principal directory returned ${response.type}.`)
    }
    facts.push(...response.items)
    afterFactId = response.nextFactId
    if (facts.length > 10_000) {
      throw new Error('Provider principal directory exceeds the Desktop workspace limit.')
    }
  } while (afterFactId)
  return Object.freeze(facts)
}

type ProjectFactSnapshot = Readonly<{
  observedAt: string
  pages: ReadonlyMap<ProjectCoordinationCollection, readonly unknown[]>
  finalSummary: Extract<RestResponse, { type: 'rest.project_coordination' }>['finalSummary']
}>

async function readAllProjectFacts(
  transport: AuthenticatedCloudTransport,
  project: Project,
  currentUserId: string,
  requestId: () => `req_${string}`
): Promise<ProjectFactSnapshot> {
  if (project.ownerUserId === currentUserId) {
    return readProjectFactCollections(
      transport,
      project,
      PROJECT_COORDINATOR_PROJECT_FACT_COLLECTIONS,
      requestId
    )
  }
  const invitationSnapshot = await readProjectFactCollections(
    transport,
    project,
    PROJECT_INVITATION_READ_COLLECTIONS,
    requestId
  )
  const membership = (invitationSnapshot.pages.get('memberships') ?? [])
    .map((item) => projectMembershipSchema.safeParse(item))
    .find((parsed) => parsed.success && parsed.data.userId === currentUserId)?.data
  if (!membership) {
    throw new Error('The current OIDC User has no readable Membership in the listed Project.')
  }
  if (membership.state === 'invited') return invitationSnapshot
  return readProjectFactCollections(
    transport,
    project,
    PROJECT_COORDINATOR_PROJECT_FACT_COLLECTIONS,
    requestId
  )
}

async function readProjectFactCollections(
  transport: AuthenticatedCloudTransport,
  project: Project,
  collections: readonly ProjectCoordinationCollection[],
  requestId: () => `req_${string}`
): Promise<ProjectFactSnapshot> {
  const pages = new Map<ProjectCoordinationCollection, unknown[]>()
  let pending: Array<Readonly<{
    collection: ProjectCoordinationCollection
    cursor?: string
    limit: number
  }>> = collections.map((collection) => ({
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
  const offers = factItems<TaskOffer>(snapshot, 'offers')
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
    plan: plan ? { plan } : null,
    memberUsers: factItems(snapshot, 'user_label_facts'),
    workerGroups: projectWorkerGroups(project, snapshot, workerDirectory),
    tasks: factItems<ProjectCoordinatorProject['tasks'][number]['task']>(snapshot, 'tasks')
      .map((task) => ({
        task,
        executions: executions.filter((execution) => execution.taskId === task.taskId)
      })),
    offers,
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

function availableWorkerUsers(
  workerDirectory: WorkerDirectorySnapshot
): ProjectCoordinatorWorkspace['availableWorkerUsers'] {
  const userIds = new Set<string>()
  for (const availability of workerDirectory.availability) {
    const agentLabel = workerDirectory.agentLabels.find(({ agentId }) => (
      agentId === availability.agentId
    ))
    if (!agentLabel ||
        agentLabel.ownerUserId !== availability.userId ||
        agentLabel.deviceId !== availability.deviceId) {
      throw new Error(`Worker availability ${availability.agentId} lacks its exact Cloud Agent label.`)
    }
    userIds.add(availability.userId)
  }
  return [...userIds].map((userId) => {
    const userLabel = workerDirectory.userLabels.find((label) => label.userId === userId)
    if (!userLabel) throw new Error(`Worker User ${userId} lacks its exact Cloud label.`)
    return { userId, displayName: userLabel.displayName }
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

function scopedIdempotencyKey(base: string, operation: string): string {
  const scoped = `${base}.${operation}`
  if (!/^idem_[A-Za-z0-9._:-]{11,123}$/u.test(scoped) || scoped.length > 128) {
    throw new Error('The Host invocation idempotency key cannot be scoped safely.')
  }
  return scoped
}

function projectCreateIdempotencyKey(ownerUserId: string, createIntentId: string): string {
  return `idem_project.create.${stableDigest({ ownerUserId, createIntentId }).slice(0, 48)}`
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
