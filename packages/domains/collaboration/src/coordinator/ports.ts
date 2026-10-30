import {
  CURRENT_PROTOCOL_VERSION,
  PROJECT_COORDINATION_COLLECTIONS,
  PROJECT_COORDINATION_MAX_PAGE_SIZE,
  PROJECT_INVITATION_READ_COLLECTIONS,
  agentInboxMessageSchema,
  humanAnswerSchema,
  humanNeededSchema,
  planItemIdSchema,
  projectMembershipSchema,
  projectPlanHistorySchema,
  projectPlanSchema,
  projectRequirementsDocumentSchema,
  projectRequirementsDocumentSummarySchema,
  projectSchema,
  projectUserLabelFactSchema,
  requirementsAcceptanceCriteriaSchema,
  requirementsAcceptanceCriterionSchema,
  requirementsWorkModuleSchema,
  requirementsWorkModulesSchema,
  taskExecutionHistorySchema,
  taskExecutionSchema,
  taskHistorySchema,
  taskSchema,
  type AgentInboxMessage,
  type Project,
  type ProjectCoordinationCollection,
  type ProjectMembership,
  type ProjectRecord,
  type ProjectRequirementsDocument,
  type ProjectRequirementsDocumentSummary,
  type ProjectWorkerAvailabilityView,
  type RestResponse,
  type TaskAuthority,
  type TaskDeliveryFacts,
  type TaskOffer,
  type WorkerAvailabilityProjection,
  type WorkerDirectoryAgentLabel,
  type WorkerDirectoryUserLabel
} from '@sciforge/collaboration-contracts'
import {
  AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
  type AuthenticatedCloudTransport
} from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import {
  domainMainAgentExecutionOutputSchemaSchema,
  type DomainMainAgentExecutionHost
} from '@sciforge/domain-sdk/agent-execution'
import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { unmetCapabilityTags } from '../capability-requirements.js'
import type {
  CoordinatorCloudCommandService
} from '../coordinator-cloud-command.js'
import type { ProjectCoordinatorRequirementsDispatchPort } from './requirements-dispatch.js'

import {
  projectCoordinatorHumanAnswerInputSchema,
  projectCoordinatorHumanNeededCreateInputSchema,
  projectCoordinatorProjectCreateInputSchema,
  projectCoordinatorProjectCreateReceiptSchema,
  projectCoordinatorProjectDeleteInputSchema,
  projectCoordinatorProjectDeleteResultSchema,
  projectCoordinatorRequirementsCompleteInputSchema,
  projectCoordinatorRequirementsConfirmInputSchema,
  projectCoordinatorRequirementsDraftSaveInputSchema,
  projectCoordinatorTransferFeedbackSchema,
  projectCoordinatorTransferInputSchema,
  projectCoordinatorWorkspaceReadInputSchema,
  projectCoordinatorWorkspaceSchema,
  type ProjectCoordinatorHumanAnswerInput,
  type ProjectCoordinatorHumanNeededCreateInput,
  type ProjectCoordinatorProject,
  type ProjectCoordinatorProjectCreateInput,
  type ProjectCoordinatorProjectCreateReceipt,
  type ProjectCoordinatorProjectDeleteInput,
  type ProjectCoordinatorProjectDeleteResult,
  type ProjectCoordinatorRequirementsCompleteInput,
  type ProjectCoordinatorRequirementsCompletionFailureReason,
  type ProjectCoordinatorRequirementsCompletion,
  type ProjectCoordinatorRequirementsConfirmInput,
  type ProjectCoordinatorRequirementsDraftSaveInput,
  type ProjectCoordinatorTransferFeedback,
  type ProjectCoordinatorTransferInput,
  type ProjectCoordinatorWorkspace,
  type ProjectCoordinatorWorkspaceReadInput
} from './contract.js'
import type { ProjectCoordinatorDeliveryPort } from './delivery.js'
import type { ProjectCoordinatorMembershipPort } from './membership.js'
import { projectCoordinatorSessionTitle } from './session-title.js'
import {
  ProjectCoordinatorStateStore
} from './state.js'

type CoordinatorCloudCommandClient = Omit<CoordinatorCloudCommandService, 'localAgentId'>

// Provider, provisioning, external-operation and legacy result collections are
// read-only history owned by the Cloud; the coordination workspace never
// consumes them for new authority (design §9.21).
const PROJECT_COORDINATOR_PROJECT_FACT_COLLECTIONS = PROJECT_COORDINATION_COLLECTIONS.filter(
  (collection) => ![
    'agent_label_facts',
    'worker_availability',
    'provider_principal_facts',
    'content_readiness',
    'provider_membership_observations',
    'provisioning_intents',
    'provisioning_attestations',
    'content_bindings',
    'external_operation_journal',
    'visible_recovery_actions',
    'result_submissions',
    'review_decisions'
  ].includes(collection)
)

export type ProjectCoordinatorWorkspacePort = Readonly<{
  readWorkspace(input: ProjectCoordinatorWorkspaceReadInput, options?: Readonly<{ signal?: AbortSignal }>): Promise<ProjectCoordinatorWorkspace>
}>

export type ProjectCoordinatorCloudWorkspacePort = ProjectCoordinatorWorkspacePort & Readonly<{
  createProject(input: ProjectCoordinatorProjectCreateInput): Promise<ProjectCoordinatorProjectCreateReceipt>
}>

export type ProjectCoordinatorRequirementsPort = Readonly<{
  saveDraft(
    input: ProjectCoordinatorRequirementsDraftSaveInput,
    idempotencyKey: string
  ): Promise<ProjectRequirementsDocument>
  /**
   * Derives 工作模块/验收标准 in the project-bound Coordinator Runtime Session
   * and writes the exact result back.
   */
  complete(
    input: ProjectCoordinatorRequirementsCompleteInput,
    idempotencyKey?: string
  ): Promise<ProjectRequirementsDocument>
  confirm(
    input: ProjectCoordinatorRequirementsConfirmInput,
    idempotencyKey: string
  ): Promise<ProjectCoordinatorWorkspace>
}>

export type ProjectCoordinatorActionPort = Readonly<{
  deleteProject(
    input: ProjectCoordinatorProjectDeleteInput,
    idempotencyKey: string,
    authorizeFirstAttempt: () => Promise<void>
  ): Promise<ProjectCoordinatorProjectDeleteResult>
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
  handleInbox(message: AgentInboxMessage): Promise<void>
}>

export type ProjectCoordinatorMainPorts = Readonly<{
  workspace: ProjectCoordinatorCloudWorkspacePort
  requirements: ProjectCoordinatorRequirementsPort
  membership: ProjectCoordinatorMembershipPort
  delivery: ProjectCoordinatorDeliveryPort
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
    readWorkspace: async (request, options) => projectCoordinatorWorkspaceSchema.parse(
      await input.readWorkspace(projectCoordinatorWorkspaceReadInputSchema.parse(request), options)
    )
  })
}

export function createProjectCoordinatorCloudWorkspacePort(options: Readonly<{
  transport: AuthenticatedCloudTransport
  coordinatorCloudCommands?: CoordinatorCloudCommandService
  readCoordinatorTransferFeedback?: (
    projectId: string
  ) => Promise<ProjectCoordinatorTransferFeedback | null>
  readRequirementsCompletion?: (input: Readonly<{
    projectId: string
    requirementsDocumentId: string
    expectedRequirementsRevision: number
    coordinatorAuthorityEpoch: number
    contentDigest: string
  }>) => Promise<ProjectCoordinatorRequirementsCompletion | null>
  createIntentState?: Pick<ProjectCoordinatorStateStore, 'resolveProjectCreateIntent'>
  requestId?: () => `req_${string}`
  now?: () => Date
}>): ProjectCoordinatorCloudWorkspacePort {
  const requestId = options.requestId ?? (() => `req_${randomUUID().replaceAll('-', '')}`)
  const now = options.now ?? (() => new Date())

  const readWorkspace = async (
    rawInput: ProjectCoordinatorWorkspaceReadInput,
    executionOptions?: Readonly<{ signal?: AbortSignal }>
  ): Promise<ProjectCoordinatorWorkspace> => {
    const input = projectCoordinatorWorkspaceReadInputSchema.parse(rawInput)
    const status = options.transport.status()
    const observedAt = now().toISOString()
    if (status.state === 'identity_required') {
      return projectCoordinatorWorkspaceSchema.parse({
        connection: { state: 'identity_required' }, observedAt,
        availableWorkerUsers: [], projects: []
      })
    }
    if (status.state === 'device_required') {
      return projectCoordinatorWorkspaceSchema.parse({
        connection: { state: 'device_required', reason: status.reason }, observedAt,
        availableWorkerUsers: [], projects: []
      })
    }
    if (status.state === 'unavailable') {
      return projectCoordinatorWorkspaceSchema.parse({
        connection: { state: 'cloud_unavailable', ...(status.reasonCode ? { reasonCode: status.reasonCode } : {}), reason: status.reason }, observedAt,
        availableWorkerUsers: [], projects: []
      })
    }

    executionOptions?.signal?.throwIfAborted()
    const listed = await listAllProjects(options.transport, requestId, executionOptions)
    const workerDirectory = await readAllWorkerDirectory(options.transport, requestId, executionOptions)
    const focusedProject = input.projectId
      ? listed.projects.find(({ projectId }) => projectId === input.projectId)
      : listed.projects.length === 1
        ? listed.projects[0]
        : undefined
    // The inbox must discover a pending invitation in every listed Project,
    // not only in the selected one. A Project summary carries no Membership,
    // so each non-focused Project contributes exactly the current OIDC User's
    // own Membership fact, read through the same bounded invitation surface an
    // invited User already has.
    const membershipFacts = new Map<string, ProjectFactSnapshot>()
    const [facts] = await Promise.all([
      focusedProject
        ? readAllProjectFacts(options.transport, focusedProject, status.userId, requestId, executionOptions)
        : Promise.resolve(undefined),
      Promise.all(listed.projects
        .filter((project) => project.projectId !== focusedProject?.projectId)
        .map(async (project) => {
          const ownMembership = await readOwnMembershipFacts(
            options.transport,
            project,
            status.userId,
            requestId,
            executionOptions
          )
          if (ownMembership) membershipFacts.set(project.projectId, ownMembership)
        }))
    ])
    const projects = await Promise.all(listed.projects.map(async (project) => {
      const focused = project.projectId === focusedProject?.projectId
      let view = projectCoordinatorProjectView(
        project,
        focused ? facts : membershipFacts.get(project.projectId),
        focused ? workerDirectory : undefined
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
      const draft = view.requirementsDraft
      if (draft && project.ownerUserId === status.userId) {
        const completion = await options.readRequirementsCompletion?.({
          projectId: project.projectId,
          requirementsDocumentId: draft.requirementsDocumentId,
          expectedRequirementsRevision: draft.revision,
          coordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch,
          contentDigest: draft.contentDigest
        })
        if (completion) {
          view = { ...view, requirementsCompletion: completion }
        }
      }
      return view
    }))
    const localAgentId = options.coordinatorCloudCommands?.localAgentId()
    executionOptions?.signal?.throwIfAborted()
    return projectCoordinatorWorkspaceSchema.parse({
      connection: {
        state: 'ready',
        userId: status.userId,
        deviceId: status.deviceId,
        ...(localAgentId ? { localAgentId } : {})
      },
      observedAt: facts?.observedAt ?? workerDirectory.observedAt ?? listed.observedAt,
      ...(focusedProject ? { focusedProjectId: focusedProject.projectId } : {}),
      availableWorkerUsers: availableWorkerUsers(workerDirectory),
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

// Strict structured-output providers require every object key to be required.
// The model therefore always emits capability tags (possibly empty) and the
// canonical contract decides whether to retain an empty list.
const generatedRequirementsModelWorkModuleSchema = z.object({
  planItemId: planItemIdSchema,
  title: requirementsWorkModuleSchema.shape.title,
  objective: requirementsWorkModuleSchema.shape.objective,
  dependencyPlanItemIds: requirementsWorkModuleSchema.shape.dependencyPlanItemIds,
  requiredCapabilityTags: requirementsWorkModuleSchema.shape.requiredCapabilityTags.unwrap()
}).strict()

const generatedRequirementsModelCriterionSchema = z.object({
  target: z.union([planItemIdSchema, z.literal('$project')]),
  criteria: requirementsAcceptanceCriterionSchema.shape.criteria,
  evidenceMethod: requirementsAcceptanceCriterionSchema.shape.evidenceMethod
}).strict()

const generatedRequirementsModelContentSchema = z.object({
  workModules: z.array(generatedRequirementsModelWorkModuleSchema).min(1).max(100),
  acceptanceCriteria: z.array(generatedRequirementsModelCriterionSchema).min(1).max(200)
}).strict().readonly()

function generatedRequirementsOutputJsonSchema() {
  return domainMainAgentExecutionOutputSchemaSchema.parse(z.toJSONSchema(
    generatedRequirementsModelContentSchema,
    {
      target: 'draft-07',
      unrepresentable: 'throw'
    }
  ))
}

// Generated text must contain content before checking the confirm-time coverage
// matrix: known targets, one criterion per module, and one project-level criterion.
function assertRequirementsCompletion(
  modules: readonly Readonly<{ planItemId: string; title: string; objective: string }>[],
  criteria: readonly Readonly<{ target: string; criteria: string; evidenceMethod: string }>[]
): void {
  const generatedTexts = [
    ...modules.flatMap(({ title, objective }) => [title, objective]),
    ...criteria.flatMap(({ criteria, evidenceMethod }) => [criteria, evidenceMethod])
  ]
  if (generatedTexts.some((text) => !/[\p{L}\p{N}]/u.test(text))) {
    throw new ProjectCoordinatorRequirementsCompletionError(
      'placeholder_generated_content',
      'Generated work module titles/objectives and acceptance criteria/evidence methods must each contain at least one Unicode letter or number.'
    )
  }
  const moduleIds = new Set(modules.map(({ planItemId }) => planItemId))
  if (criteria.some(({ target }) => target !== '$project' && !moduleIds.has(target))) {
    throw new Error('Generated acceptance criteria reference an unknown work module.')
  }
  for (const module of modules) {
    if (!criteria.some(({ target }) => target === module.planItemId)) {
      throw new Error(`Generated work module ${module.planItemId} has no acceptance criterion.`)
    }
  }
  if (!criteria.some(({ target }) => target === '$project')) {
    throw new Error('Generated acceptance criteria require at least one project-level criterion.')
  }
}

/** Every known requirements-completion failure is one of these bounded reasons. */
export class ProjectCoordinatorRequirementsCompletionError extends Error {
  readonly reason: ProjectCoordinatorRequirementsCompletionFailureReason

  constructor(
    reason: ProjectCoordinatorRequirementsCompletionFailureReason,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'ProjectCoordinatorRequirementsCompletionError'
    this.reason = reason
  }
}

async function withRuntimeTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('Requirements completion timed out.')
      controller.abort(error)
      reject(error)
    }, timeoutMs)
  })
  try {
    return await Promise.race([run(controller.signal), timeout])
  } finally {
    clearTimeout(timer)
  }
}

export function createProjectCoordinatorRequirementsPort(options: Readonly<{
  workspace: ProjectCoordinatorWorkspacePort
  coordinatorCloudCommands?: CoordinatorCloudCommandClient
  transport?: AuthenticatedCloudTransport
  settings?: DomainMainPackageSettingsHost
  state?: ProjectCoordinatorStateStore
  getAgentExecution?: () => DomainMainAgentExecutionHost | undefined
  requestId?: () => `req_${string}`
  now?: () => Date
  generationTimeoutMs?: number
}>): ProjectCoordinatorRequirementsPort {
  const requestId = options.requestId ?? (() => `req_${randomUUID().replaceAll('-', '')}`)
  const now = options.now ?? (() => new Date())
  const state = options.state ?? (options.settings
    ? new ProjectCoordinatorStateStore(options.settings)
    : undefined)
  const generationTimeoutMs = options.generationTimeoutMs ?? 180_000
  const readProject = async (projectId: string) => {
    const workspace = await options.workspace.readWorkspace({ projectId })
    if (workspace.connection.state !== 'ready') {
      throw new ProjectCoordinatorRequirementsCompletionError(
        'unexpected_failure',
        `Project coordination is ${workspace.connection.state}.`
      )
    }
    const project = workspace.projects.find((candidate) => (
      candidate.project.projectId === projectId
    ))
    if (!project) {
      throw new ProjectCoordinatorRequirementsCompletionError(
        'draft_unavailable',
        'The exact Project is not visible to the current OIDC User.'
      )
    }
    return project
  }

  const writeCompletion = async (input: Readonly<{
    projectId: string
    expectedProjectRevision: number
    expectedCoordinatorAuthorityEpoch: number
    requirementsDocumentId: string
    expectedRequirementsRevision: number
    contentDigest: string
    workModules: ReturnType<typeof requirementsWorkModulesSchema.parse>
    acceptanceCriteria: ReturnType<typeof requirementsAcceptanceCriteriaSchema.parse>
    clientDirectiveId: string
  }>): Promise<ProjectRequirementsDocument> => {
    if (!options.coordinatorCloudCommands) {
      throw new ProjectCoordinatorRequirementsCompletionError(
        'write_failed',
        'Coordinator Agent Cloud command mediation is unavailable.'
      )
    }
    let expectedProjectRevision = input.expectedProjectRevision
    for (let retry = 0; ; retry += 1) {
      const commandBody = {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        type: 'project.requirements.completion.save' as const,
        projectId: input.projectId,
        expectedProjectRevision,
        expectedCoordinatorAuthorityEpoch: input.expectedCoordinatorAuthorityEpoch,
        expectedRequirementsRevision: input.expectedRequirementsRevision,
        workModules: input.workModules,
        acceptanceCriteria: input.acceptanceCriteria
      }
      // A changed CAS baseline is a new command. The outbox freezes each
      // command's key/body for delivery replay; failed Runtime retries also
      // retain their own directive identity.
      const digest = createHash('sha256').update(JSON.stringify({
        clientDirectiveId: input.clientDirectiveId,
        commandBody
      })).digest('hex')
      let response: Awaited<ReturnType<CoordinatorCloudCommandClient['execute']>>
      try {
        response = await options.coordinatorCloudCommands.execute({
          ...commandBody,
          requestId: requestId(),
          idempotencyKey: `idem_requirements-completion.${digest.slice(0, 48)}`
        })
      } catch (cause) {
        throw new ProjectCoordinatorRequirementsCompletionError(
          'write_failed',
          'Requirements completion could not be written to Cloud.',
          { cause }
        )
      }
      if (response.type === 'rest.error') {
        if (response.error.code === 'revision_conflict') {
          if (retry < 3) {
            const current = await readProject(input.projectId)
            const draft = current.requirementsDraft
            if (
              draft?.requirementsDocumentId === input.requirementsDocumentId &&
              draft.revision === input.expectedRequirementsRevision &&
              draft.contentDigest === input.contentDigest &&
              current.project.coordinatorAuthorityEpoch === input.expectedCoordinatorAuthorityEpoch &&
              !isTerminalProject(current) &&
              current.project.revision > expectedProjectRevision
            ) {
              expectedProjectRevision = current.project.revision
              continue
            }
          }
          throw new ProjectCoordinatorRequirementsCompletionError(
            'revision_conflict',
            'The requirements draft or Coordinator authority changed, or Project revision retries were exhausted.'
          )
        }
        throw new ProjectCoordinatorRequirementsCompletionError(
          'write_failed',
          `Requirements completion failed: ${response.error.code}: ${response.error.message}`
        )
      }
      if (response.type !== 'rest.entity') {
        throw new ProjectCoordinatorRequirementsCompletionError(
          'write_failed',
          `Requirements completion returned ${response.type}.`
        )
      }
      const document = projectRequirementsDocumentSchema.parse(response.entity)
      if (
        document.projectId !== input.projectId ||
        document.requirementsDocumentId !== input.requirementsDocumentId ||
        document.revision !== input.expectedRequirementsRevision + 1 ||
        document.state !== 'draft'
      ) {
        throw new ProjectCoordinatorRequirementsCompletionError(
          'write_failed',
          'Requirements completion did not return the exact current draft.'
        )
      }
      return document
    }
  }

  const completeFacts = async (
    project: Awaited<ReturnType<typeof readProject>>,
    draft: NonNullable<Awaited<ReturnType<typeof readProject>>['requirementsDraft']>,
    attempt: NonNullable<Awaited<
      ReturnType<ProjectCoordinatorStateStore['readRequirementsCompletionAttempt']>
    >>
  ): Promise<ProjectRequirementsDocument> => {
    const runtime = state!
    const fail = async (
      reason: ProjectCoordinatorRequirementsCompletionFailureReason,
      message: string,
      errorOptions?: ErrorOptions
    ) => {
      await runtime.recordRequirementsCompletionFailure(attempt, {
        reason,
        failedAt: now().toISOString()
      }).catch(() => undefined)
      return new ProjectCoordinatorRequirementsCompletionError(reason, message, errorOptions)
    }
    const agentExecution = options.getAgentExecution?.()
    if (!agentExecution) {
      throw await fail('runtime_unavailable', 'The local Agent Runtime is unavailable.')
    }
    const outputSchema = generatedRequirementsOutputJsonSchema()
    // Requirements completion may only name executable tags that at least one
    // currently visible Worker runtime actually reports. The Workspace is the
    // same availability source the Plan prompt and Worker selection consume.
    const capabilityCatalog = [...new Set(project.workerGroups.flatMap(({ agents }) => (
      agents.flatMap(({ projectAvailability }) => (
        projectAvailability.availability.agentActive &&
        projectAvailability.availability.deviceActive
          ? projectAvailability.availability.runtimeCapabilityTags
          : []
      ))
    )))].sort()
    const sessionTitle = projectCoordinatorSessionTitle(
      project.project.displayName,
      '需求补全',
      draft.documentRevision + 1
    )
    const bindings = await runtime.readCoordinatorSessionBindings()
    let binding = bindings.find((candidate) => (
      candidate.projectId === project.project.projectId &&
      candidate.principalUserId === project.project.ownerUserId &&
      candidate.coordinatorAgentId === project.project.coordinatorAgentId &&
      candidate.coordinatorAuthorityEpoch === project.project.coordinatorAuthorityEpoch
    ))
    if (!binding) {
      if (!agentExecution.prepareSession) {
        throw await fail(
          'runtime_unavailable',
          'The Project has no bound Coordinator Runtime and the Host cannot prepare one.'
        )
      }
      try {
        const prepared = await withRuntimeTimeout(
          () => agentExecution.prepareSession!({
            title: sessionTitle,
            interaction: 'reviewable',
            mode: 'plan'
          }),
          generationTimeoutMs
        )
        binding = await runtime.persistCoordinatorSessionBinding({
          schemaVersion: 1,
          role: 'coordinator',
          projectId: project.project.projectId,
          principalUserId: project.project.ownerUserId,
          coordinatorAgentId: project.project.coordinatorAgentId,
          coordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch,
          runtimeId: prepared.runtimeId,
          threadId: prepared.threadId,
          boundAt: now().toISOString()
        })
      } catch (cause) {
        throw await fail(
          'runtime_execution_failed',
          'The local Coordinator Runtime could not prepare a completion Session.',
          { cause }
        )
      }
    }
    const clientDirectiveId = attempt.retryOrdinal
      ? `${attempt.clientDirectiveId}:retry:${attempt.retryOrdinal}`
      : attempt.clientDirectiveId
    let generated: Awaited<ReturnType<DomainMainAgentExecutionHost['run']>>
    try {
      generated = await withRuntimeTimeout((signal) => agentExecution.run({
        title: sessionTitle,
        clientDirectiveId,
        signal,
        runtimeId: binding.runtimeId,
        threadId: binding.threadId,
        prompt: [
          `Project: ${project.project.displayName}`,
          `Project goal: ${project.project.goal}`,
          `Owner goals and deliverables: ${draft.goalsDeliverables}`,
          `Owner inputs and boundaries: ${draft.inputsBoundaries}`,
          `Exact input references: ${JSON.stringify(draft.inputReferences)}`,
          `Current requirements draft revision: ${draft.revision}`,
          'Derive only 工作模块 (workModules) and 验收标准 (acceptanceCriteria) from these Owner parts. Do not rewrite the Owner parts and do not assign or select Workers.',
          'The final response is constrained by the supplied JSON Schema. Return exactly one object with workModules and acceptanceCriteria, with no Markdown or code fences.',
          'Use a unique stable item_* planItemId for every work module. dependencyPlanItemIds must reference another work module in this same response and must not form a cycle. Use [] when there is no dependency.',
          `Worker capability catalog: ${JSON.stringify(capabilityCatalog)}`,
          'Every work module requires title, objective and requiredCapabilityTags. Capability tags are executable requirements, not topical labels. Copy every requiredCapabilityTags value character-for-character from the Worker capability catalog; never invent tags such as public-data-selection, single-cell-rna-seq, quality-control, or documentation. If a work module needs no additional capability beyond the catalogued runtime profiles, use an empty requiredCapabilityTags array.',
          'Every work module requires at least one acceptance criterion whose target is its exact planItemId. Include at least one project-level criterion whose target is the literal "$project". Criteria and evidenceMethod must be concrete and verifiable.',
          'Acceptance criteria targets may only be one of this response\'s planItemIds or "$project". Do not emit id, status, assignee, task, execution or digest fields.'
        ].join('\n'),
        outputSchema,
        interaction: 'reviewable',
        mode: 'plan'
      }), generationTimeoutMs)
    } catch (cause) {
      throw await fail(
        'runtime_execution_failed',
        'The local Coordinator Runtime could not complete the requirements turn.',
        { cause }
      )
    }
    if (
      generated.runtimeId !== binding.runtimeId ||
      generated.threadId !== binding.threadId
    ) {
      throw await fail(
        'runtime_execution_failed',
        'The local Coordinator Runtime returned a different Session than the project-bound Coordinator Session.'
      )
    }
    if (generated.state !== 'completed') {
      throw await fail(
        'runtime_execution_failed',
        `Local Coordinator Runtime ended in ${generated.state}.`
      )
    }
    if (!generated.text.trim()) {
      throw await fail(
        'runtime_execution_failed',
        'The local Coordinator Runtime completed without requirements output.'
      )
    }
    let decoded: unknown
    try {
      decoded = JSON.parse(generated.text)
    } catch (cause) {
      throw await fail(
        'invalid_structured_output',
        'Local Coordinator Runtime returned non-JSON structured output.',
        { cause }
      )
    }
    const parsedModelContent = generatedRequirementsModelContentSchema.safeParse(decoded)
    if (!parsedModelContent.success) {
      throw await fail(
        'invalid_structured_output',
        'Local Coordinator Runtime returned output that violates the structured generation contract.',
        { cause: parsedModelContent.error }
      )
    }
    let workModules: ReturnType<typeof requirementsWorkModulesSchema.parse>
    let acceptanceCriteria: ReturnType<typeof requirementsAcceptanceCriteriaSchema.parse>
    try {
      workModules = requirementsWorkModulesSchema.parse(parsedModelContent.data.workModules)
      acceptanceCriteria = requirementsAcceptanceCriteriaSchema.parse(
        parsedModelContent.data.acceptanceCriteria
      )
      assertRequirementsCompletion(workModules, acceptanceCriteria)
    } catch (cause) {
      throw await fail(
        cause instanceof ProjectCoordinatorRequirementsCompletionError
          ? cause.reason
          : 'invalid_structured_output',
        'Local Coordinator Runtime returned work modules or acceptance criteria that cannot be confirmed.',
        { cause }
      )
    }
    const unavailableTags = [...new Set(workModules.flatMap(({ requiredCapabilityTags }) => (
      unmetCapabilityTags(requiredCapabilityTags ?? [], capabilityCatalog)
    )))]
    if (unavailableTags.length > 0) {
      throw await fail(
        'invalid_structured_output',
        `Local Coordinator Runtime returned capability tags that no visible Worker runtime provides: ${unavailableTags.join(', ')}. Retry requirements completion with tags from the Worker capability catalog.`
      )
    }
    const document = await writeCompletion({
      projectId: project.project.projectId,
      expectedProjectRevision: project.project.revision,
      expectedCoordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch,
      expectedRequirementsRevision: draft.revision,
      workModules,
      acceptanceCriteria,
      requirementsDocumentId: draft.requirementsDocumentId,
      contentDigest: draft.contentDigest,
      clientDirectiveId
    }).catch(async (cause: unknown) => {
      if (cause instanceof ProjectCoordinatorRequirementsCompletionError) {
        await runtime.recordRequirementsCompletionFailure(attempt, {
          reason: cause.reason,
          failedAt: now().toISOString()
        }).catch(() => undefined)
        throw cause
      }
      throw await fail(
        'unexpected_failure',
        'Requirements completion failed with an unexpected error.',
        { cause }
      )
    })
    // This receipt is recorded only after the existing Cloud write succeeded.
    // Without a durable receipt readers retain errors instead of inferring success.
    await runtime.recordRequirementsCompletionSuccess(attempt, document).catch(() => undefined)
    return document
  }

  const complete: ProjectCoordinatorRequirementsPort['complete'] = async (
    rawInput,
    // The capability broker consumes this key at the public boundary. Durable
    // completion attempts and the command digest own Runtime/Cloud retry
    // identity so direct port retries use the same canonical record.
    _idempotencyKey
  ) => {
    const input = projectCoordinatorRequirementsCompleteInputSchema.parse(rawInput)
    const project = await readProject(input.projectId)
    const draft = project.requirementsDraft
    if (!draft) {
      throw new ProjectCoordinatorRequirementsCompletionError(
        'draft_unavailable',
        'The Project has no current requirements draft to complete.'
      )
    }
    if (
      input.expectedRequirementsRevision !== undefined &&
      input.expectedRequirementsRevision !== draft.revision
    ) {
      throw new ProjectCoordinatorRequirementsCompletionError(
        'revision_conflict',
        'The requirements draft changed before Coordinator completion started.'
      )
    }
    if (!state) {
      throw new ProjectCoordinatorRequirementsCompletionError(
        'runtime_unavailable',
        'The durable Coordinator completion state is unavailable.'
      )
    }
    const directiveDigest = createHash('sha256').update(JSON.stringify({
      projectId: project.project.projectId,
      requirementsDocumentId: draft.requirementsDocumentId,
      expectedRequirementsRevision: draft.revision,
      contentDigest: draft.contentDigest,
      coordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch
    })).digest('hex')
    const startedAt = now()
    const claim = await state.claimRequirementsCompletionAttempt({
      projectId: project.project.projectId,
      requirementsDocumentId: draft.requirementsDocumentId,
      expectedRequirementsRevision: draft.revision,
      contentDigest: draft.contentDigest,
      coordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch,
      clientDirectiveId: `project-requirements:${directiveDigest}`,
      startedAt: startedAt.toISOString(),
      leaseExpiresAt: new Date(
        startedAt.getTime() + generationTimeoutMs * 2 + 30_000
      ).toISOString()
    })
    if (!claim.claimed) {
      throw new ProjectCoordinatorRequirementsCompletionError(
        claim.attempt.state === 'completed' ? 'revision_conflict' : 'completion_in_progress',
        'This exact draft already has a running or completed Coordinator completion.'
      )
    }
    // The boundary guarantees a typed failure for every known completion
    // problem; nothing untyped reaches the requirements card.
    try {
      return await completeFacts(project, draft, claim.attempt)
    } catch (cause) {
      if (cause instanceof ProjectCoordinatorRequirementsCompletionError) throw cause
      throw new ProjectCoordinatorRequirementsCompletionError(
        'unexpected_failure',
        'Requirements completion failed with an unexpected error.',
        { cause }
      )
    }
  }

  return Object.freeze({
    saveDraft: async (rawInput, idempotencyKey) => {
      const input = projectCoordinatorRequirementsDraftSaveInputSchema.parse(rawInput)
      if (!options.transport) throw new Error('OIDC Cloud transport is unavailable.')
      const response = await executeUserCloud(options.transport, {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: requestId(),
        type: 'project.requirements.draft.save',
        idempotencyKey,
        ...input
      })
      if (response.type !== 'rest.entity') {
        throw new Error(`Requirements draft save returned ${response.type}.`)
      }
      const document = projectRequirementsDocumentSchema.parse(response.entity)
      if (document.projectId !== input.projectId) {
        throw new Error('Requirements draft save did not return the exact Project document.')
      }
      return document
    },
    complete,
    confirm: async (rawInput, idempotencyKey) => {
      const input = projectCoordinatorRequirementsConfirmInputSchema.parse(rawInput)
      if (!options.transport) throw new Error('OIDC Cloud transport is unavailable.')
      const workspace = await options.workspace.readWorkspace({ projectId: input.projectId })
      const projectView = requireReadyProject(workspace, input.projectId)
      const draft = projectView.requirementsDraft
      if (
        !draft ||
        draft.requirementsDocumentId !== input.requirementsDocumentId ||
        draft.revision !== input.expectedRequirementsRevision ||
        draft.contentDigest !== input.contentDigest
      ) {
        throw new Error('Requirements confirmation requires the exact current requirements draft.')
      }
      const response = await executeUserCloud(options.transport, {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: requestId(),
        type: 'project.requirements.confirm',
        idempotencyKey,
        ...input
      })
      if (response.type !== 'rest.entity') {
        throw new Error(`Requirements confirmation returned ${response.type}.`)
      }
      const confirmed = projectRequirementsDocumentSchema.parse(response.entity)
      if (
        confirmed.projectId !== input.projectId ||
        confirmed.requirementsDocumentId !== input.requirementsDocumentId ||
        confirmed.contentDigest !== input.contentDigest ||
        confirmed.state !== 'confirmed'
      ) {
        throw new Error('Requirements confirmation did not return the exact confirmed version.')
      }
      return projectCoordinatorWorkspaceSchema.parse(
        await options.workspace.readWorkspace({ projectId: input.projectId })
      )
    }
  })
}

export function createProjectCoordinatorActionPort(options: Readonly<{
  workspace: ProjectCoordinatorWorkspacePort
  coordinatorCloudCommands: CoordinatorCloudCommandClient
  transport: AuthenticatedCloudTransport
  state: ProjectCoordinatorStateStore
  requirementsDispatch: Pick<ProjectCoordinatorRequirementsDispatchPort, 'reconcileProject'>
  log?(entry: Readonly<{ level: 'info' | 'warn'; message: string }>): void
  requestId?: () => `req_${string}`
}>): ProjectCoordinatorActionPort {
  const requestId = options.requestId ?? (() => `req_${randomUUID().replaceAll('-', '')}`)
  return Object.freeze({
    deleteProject: async (rawInput, idempotencyKey, authorizeFirstAttempt) => {
      const input = projectCoordinatorProjectDeleteInputSchema.parse(rawInput)
      const identity = options.transport.status()
      if (identity.state !== 'ready') {
        throw new Error('Project deletion requires the current authenticated User and Device.')
      }
      let intent = await options.state.readProjectDeleteIntent(
        identity.userId,
        input.projectId,
        idempotencyKey
      )
      const isDurableReplay = intent !== null
      if (!intent) {
        const workspace = await options.workspace.readWorkspace({ projectId: input.projectId })
        const projectView = requireReadyProject(workspace, input.projectId)
        if (
          workspace.connection.state !== 'ready' ||
          workspace.connection.userId !== identity.userId ||
          projectView.project.ownerUserId !== identity.userId
        ) {
          throw new Error('Only the current Project Owner may delete this Project.')
        }
        await authorizeFirstAttempt()
        intent = await options.state.beginProjectDelete({
          projectId: input.projectId,
          principalUserId: identity.userId,
          idempotencyKey,
          expectedRevision: projectView.project.revision,
          expectedCoordinatorAuthorityEpoch: projectView.project.coordinatorAuthorityEpoch,
          expectedExecutionAuthorityEpoch: projectView.project.executionAuthorityEpoch
        })
      }
      if (intent.state === 'succeeded') {
        return projectCoordinatorProjectDeleteResultSchema.parse({
          projectId: input.projectId,
          deleted: true
        })
      }
      const completeDelete = async (): Promise<ProjectCoordinatorProjectDeleteResult> => {
        await options.state.completeProjectDelete(
          identity.userId,
          input.projectId,
          intent.idempotencyKey
        )
        return projectCoordinatorProjectDeleteResultSchema.parse({
          projectId: input.projectId,
          deleted: true
        })
      }

      const command = {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: requestId(),
        type: 'project.delete' as const,
        idempotencyKey: intent.idempotencyKey,
        projectId: intent.projectId,
        expectedRevision: intent.expectedRevision,
        expectedCoordinatorAuthorityEpoch: intent.expectedCoordinatorAuthorityEpoch,
        expectedExecutionAuthorityEpoch: intent.expectedExecutionAuthorityEpoch
      }
      const response = await options.transport.execute({
        contractVersion: 1,
        operationId: AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
        payload: command
      })
      if (
        isDurableReplay &&
        response.status === 404 &&
        response.body.type === 'rest.error' &&
        response.body.requestId === command.requestId &&
        response.body.error.code === 'not_found' &&
        response.body.error.httpStatus === 404
      ) {
        return completeDelete()
      }
      if (response.status >= 400 || response.body.type === 'rest.error') {
        if (response.status < 500) {
          await options.state.abandonProjectDelete(
            identity.userId,
            input.projectId,
            intent.idempotencyKey
          )
        }
        const detail = response.body.type === 'rest.error'
          ? `${response.body.error.code}: ${response.body.error.message}`
          : `HTTP ${response.status}`
        throw new Error(`SciForge Cloud request failed: ${detail}`)
      }
      if (
        response.body.type !== 'rest.receipt' ||
        response.body.requestId !== command.requestId ||
        response.body.receipt.type !== 'operation.receipt' ||
        response.body.receipt.idempotencyKey !== intent.idempotencyKey ||
        response.body.receipt.status !== 'succeeded' ||
        response.body.receipt.actor.actorType !== 'user' ||
        response.body.receipt.actor.userId !== identity.userId
      ) {
        throw new Error(`Project delete returned ${response.body.type}.`)
      }
      return completeDelete()
    },
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
    handleInbox: async (rawMessage) => {
      const message = agentInboxMessageSchema.parse(rawMessage)
      if (message.payload.type === 'project.deleted') {
        await options.state.clearProjectLocalState(message.payload.projectId)
        return
      }
      if (message.payload.type === 'project.started') {
        const started = message.payload
        const workspace = await options.workspace.readWorkspace({ projectId: started.projectId })
        const project = requireVisibleProject(workspace, started.projectId)
        if (message.recipientAgentId !== project.project.coordinatorAgentId) return
        if (project.project.revision < started.revision) {
          throw new Error('Project start notification does not match current Cloud authority.')
        }

        return
      }
      if (message.payload.type === 'project.plan.confirmed') {
        const confirmed = message.payload
        const workspace = await options.workspace.readWorkspace({ projectId: confirmed.projectId })
        const project = requireVisibleProject(workspace, confirmed.projectId)
        if (message.recipientAgentId !== project.project.coordinatorAgentId) return
        // These notifications are historical facts, including superseded and
        // pre-object-storage Plans. Validate their exact retained identity;
        // consuming them neither requires write authority nor dispatches work.
        const plan = [project.plan?.plan, ...project.legacyHistory.plans]
          .find((candidate) => candidate?.projectPlanId === confirmed.projectPlanId)
        if (
          !plan ||
          plan.planDigest !== confirmed.planDigest ||
          plan.revision < confirmed.revision ||
          plan.confirmedByUserId === null ||
          plan.confirmedAt === null
        ) {
          throw new Error('Plan confirmation notification does not match retained Cloud facts.')
        }

        return
      }
      if (message.payload.type === 'project.requirements.confirmed') {
        // The only dispatch trigger of the requirements loop (design §9.22.2).
        // Fresh facts must carry the exact confirmed version; a failed
        // consumption rejects the handler so the message stays un-acked and
        // the next pull retries.
        const confirmed = message.payload
        const workspace = await options.workspace.readWorkspace({ projectId: confirmed.projectId })
        const project = requireReadyProject(workspace, confirmed.projectId)
        if (message.recipientAgentId !== project.project.coordinatorAgentId) return
        const document = project.confirmedRequirements
        if (
          document?.requirementsDocumentId !== confirmed.requirementsDocumentId ||
          document.documentRevision !== confirmed.documentRevision ||
          document.contentDigest !== confirmed.contentDigest
        ) {
          // A confirmation fact can be superseded while the Coordinator is
          // offline. Once the fresh read model has a newer confirmed version,
          // the older trigger is already subsumed and may be acknowledged.
          if (document && document.documentRevision > confirmed.documentRevision) return
          throw new Error('Requirements confirmation does not match fresh Cloud facts.')
        }
        await options.requirementsDispatch.reconcileProject(confirmed.projectId)
        return
      }
      if (message.payload.type === 'project.membership.changed') {
        const changed = message.payload
        const workspace = await options.workspace.readWorkspace({ projectId: changed.projectId })
        const project = requireReadyProject(workspace, changed.projectId)
        if (message.recipientAgentId !== project.project.coordinatorAgentId) return
        if (!project.confirmedRequirements) return
        await options.requirementsDispatch.reconcileProject(changed.projectId)
        return
      }
      if (message.payload.type === 'task.delivery.sealed') {
        const sealed = message.payload
        const workspace = await options.workspace.readWorkspace({ projectId: sealed.projectId })
        // Runtime already ACKs Inbox messages for a Project that Cloud reports
        // deleted (project.get not_found). A ready read that still omits the
        // Project is a transient contradiction: keep the message unACKed.
        const project = requireReadyProject(workspace, sealed.projectId)
        if (isTerminalProject(project)) return
        if (message.recipientAgentId !== project.project.coordinatorAgentId) return
        const taskView = project.tasks.find(({ task }) => task.taskId === sealed.taskId)
        const manifest = taskView?.delivery?.manifest
        if (
          manifest?.projectId === sealed.projectId &&
          manifest.taskId === sealed.taskId &&
          manifest.deliveryManifestId === sealed.deliveryManifestId &&
          // Cloud may omit resultRevision on a manifest; ids alone then match.
          (manifest.resultRevision === undefined || manifest.resultRevision === sealed.resultRevision)
        ) return
        if (isExpiredDeliveryNotification(taskView, sealed.deliveryManifestId, sealed.resultRevision)) return
        throw new Error('Sealed Task Delivery does not match fresh Cloud facts.')
      }
      if (message.payload.type === 'task.delivery.adopted') {
        const adopted = message.payload
        const workspace = await options.workspace.readWorkspace({ projectId: adopted.projectId })
        const project = requireReadyProject(workspace, adopted.projectId)
        if (isTerminalProject(project)) return
        if (message.recipientAgentId !== project.project.coordinatorAgentId) return
        const taskView = project.tasks.find(({ task }) => task.taskId === adopted.taskId)
        if (!taskView) {
          if (project.legacyHistory.tasks.some(({ taskId }) => taskId === adopted.taskId)) {
            options.log?.({
              level: 'info',
              message: `Task Delivery adoption names the historical Task ${adopted.taskId} in ${adopted.projectId}; acknowledging the wake-up.`
            })
            return
          }
          throw new Error('Task Delivery adoption does not match fresh Cloud facts.')
        }
        const delivery = taskView.delivery
        const receipt = delivery?.receipt
        const exact = (
          delivery?.taskId === adopted.taskId &&
          delivery.manifest?.projectId === adopted.projectId &&
          delivery.manifest.taskId === adopted.taskId &&
          delivery.manifest.deliveryManifestId === adopted.deliveryManifestId &&
          receipt?.projectId === adopted.projectId &&
          receipt.taskId === adopted.taskId &&
          receipt.deliveryManifestId === adopted.deliveryManifestId &&
          receipt.disposition === adopted.disposition
        )
        if (!exact) {
          // Adoption is only a wake-up signal: whether dependent work unlocks
          // is decided by dispatch from fresh Cloud facts, and dispatch is
          // idempotent. A notification that names an older Delivery therefore
          // must not throw and stall the single Inbox cursor.
          options.log?.({
            level: 'info',
            message: `Task Delivery adoption for ${adopted.projectId}/${adopted.taskId} names ${
              adopted.deliveryManifestId
            }; current manifest ${delivery?.manifest?.deliveryManifestId ?? 'none'} and receipt ${
              receipt?.deliveryManifestId ?? 'none'
            }. Processing it as a wake-up signal.`
          })
        }
        if (adopted.disposition === 'adopted') {
          // Only confirmed requirements unlock dependent work.
          if (project.confirmedRequirements) {
            await options.requirementsDispatch.reconcileProject(adopted.projectId)
          }
        }
        return
      }
      if (message.payload.type === 'task.offer.closed') {
        const closed = message.payload
        if (closed.audience !== 'coordinator') {
          throw new Error('Project Coordinator received a Worker-only Task offer closure.')
        }
        const workspace = await options.workspace.readWorkspace({ projectId: closed.projectId })
        const project = requireReadyProject(workspace, closed.projectId)
        if (isTerminalProject(project)) return
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
          if (isExpiredOfferClosure(project, task, offer, closed)) return
          throw new Error('Task offer closure does not match fresh Cloud Task facts.')
        }
        await options.requirementsDispatch.reconcileProject(closed.projectId)
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
        await options.requirementsDispatch?.reconcileProject(failed.projectId)
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

        return
      }
      if (message.payload.type === 'project.result.published') {
        const published = message.payload
        const workspace = await options.workspace.readWorkspace({ projectId: published.projectId })
        const project = requireReadyProject(workspace, published.projectId)
        if (message.recipientAgentId !== project.project.coordinatorAgentId) return
        if (!project.deliveryDrive?.projectResults.some((result) => (
          result.projectResultId === published.projectResultId &&
          result.deliveryManifestId === published.deliveryManifestId
        ))) throw new Error('Published Project Result is absent from fresh Cloud facts.')

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
      const answerMembership = project.memberships.find(({ userId }) => (
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

export async function executeUserCloud(
  transport: AuthenticatedCloudTransport,
  payload: Parameters<AuthenticatedCloudTransport['execute']>[0]['payload'],
  options?: Readonly<{ signal?: AbortSignal }>
): Promise<RestResponse> {
  options?.signal?.throwIfAborted()
  const response = await transport.execute({
    contractVersion: 1,
    operationId: AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
    payload
  }, options)
  options?.signal?.throwIfAborted()
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
  requestId: () => `req_${string}`,
  options?: Readonly<{ signal?: AbortSignal }>
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
    }, options)
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
  requestId: () => `req_${string}`,
  options?: Readonly<{ signal?: AbortSignal }>
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
    }, options)
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
  deliveryDrive?: Extract<RestResponse, { type: 'rest.delivery.drive' }>['drive']
  taskDeliveries?: ReadonlyMap<string, TaskDeliveryFacts>
}>

async function readAllProjectFacts(
  transport: AuthenticatedCloudTransport,
  project: Project,
  currentUserId: string,
  requestId: () => `req_${string}`,
  options?: Readonly<{ signal?: AbortSignal }>
): Promise<ProjectFactSnapshot> {
  if (project.ownerUserId === currentUserId) {
    return readProjectFactCollections(
      transport,
      project,
      PROJECT_COORDINATOR_PROJECT_FACT_COLLECTIONS,
      requestId,
      options
    )
  }
  const invitationSnapshot = await readProjectFactCollections(
    transport,
    project,
    PROJECT_INVITATION_READ_COLLECTIONS,
    requestId,
    options
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
    requestId,
    options
  )
}

/**
 * A listed Project that is not the current selection still has to prove
 * whether this User is invited to it. The bounded invitation read is the only
 * fact surface that is valid for both invited and active Members, so the
 * workspace keeps nothing else from it.
 */
async function readOwnMembershipFacts(
  transport: AuthenticatedCloudTransport,
  project: Project,
  currentUserId: string,
  requestId: () => `req_${string}`,
  options?: Readonly<{ signal?: AbortSignal }>
): Promise<ProjectFactSnapshot | undefined> {
  if (project.ownerUserId === currentUserId) return undefined
  const snapshot = await readProjectFactCollections(
    transport,
    project,
    PROJECT_INVITATION_READ_COLLECTIONS,
    requestId,
    options
  )
  const membership = factItems<unknown>(snapshot, 'memberships')
    .map((item) => projectMembershipSchema.safeParse(item))
    .find((parsed) => parsed.success && parsed.data.userId === currentUserId)
  if (!membership?.success) return undefined
  const label = factItems<unknown>(snapshot, 'user_label_facts')
    .map((item) => projectUserLabelFactSchema.safeParse(item))
    .find((parsed) => parsed.success && parsed.data.userId === currentUserId)
  const pages = new Map<ProjectCoordinationCollection, readonly unknown[]>()
  pages.set('memberships', [membership.data])
  if (label?.success) pages.set('user_label_facts', [label.data])
  return Object.freeze({ observedAt: snapshot.observedAt, pages, finalSummary: null })
}

async function readProjectFactCollections(
  transport: AuthenticatedCloudTransport,
  project: Project,
  collections: readonly ProjectCoordinationCollection[],
  requestId: () => `req_${string}`,
  options?: Readonly<{ signal?: AbortSignal }>
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
    }, options)
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
  // Invitations disclose only the bounded invitation facts; sealed Drive reads
  // require current membership on the Cloud gateway on every request.
  const deliveryDrive = collections === PROJECT_INVITATION_READ_COLLECTIONS ? undefined
    : await executeUserCloud(transport, {
      protocolVersion: CURRENT_PROTOCOL_VERSION, requestId: requestId(),
      type: 'delivery.drive.list', projectId: project.projectId
    }, options)
  if (deliveryDrive && deliveryDrive.type !== 'rest.delivery.drive') {
    throw new Error('Project Drive read did not return its canonical view.')
  }
  const taskDeliveries = new Map<string, TaskDeliveryFacts>()
  for (const rawTask of pages.get('tasks') ?? []) {
    const task = rawTask as { taskId: string }
    const response = await executeUserCloud(transport, {
      protocolVersion: CURRENT_PROTOCOL_VERSION, requestId: requestId(),
      type: 'delivery.task.get', taskId: task.taskId
    }, options)
    if (response.type !== 'rest.task.delivery' || response.facts.taskId !== task.taskId) {
      throw new Error('Task Delivery facts do not match the requested Task.')
    }
    taskDeliveries.set(task.taskId, response.facts)
  }
  return Object.freeze({ observedAt, pages, finalSummary, taskDeliveries,
    ...(deliveryDrive?.type === 'rest.delivery.drive' ? { deliveryDrive: deliveryDrive.drive } : {}) })
}

function projectCoordinatorProjectView(
  project: Project,
  snapshot?: ProjectFactSnapshot,
  workerDirectory?: WorkerDirectorySnapshot
): ProjectCoordinatorProject {
  const planHistory = factItems<unknown>(snapshot, 'plans').map((item) => projectPlanHistorySchema.parse(item))
  const plans = planHistory.flatMap((item) => {
    const parsed = projectPlanSchema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
  const currentPlans = plans.filter(({ state }) => state !== 'superseded')
  if (planHistory.filter(({ state }) => state !== 'superseded').length > 1) {
    throw new Error('Project coordination returned more than one current Plan.')
  }
  const plan = currentPlans[0]
  const rawRequirementsDocuments = factItems<unknown>(snapshot, 'requirements_documents')
  const requirementsDocuments = rawRequirementsDocuments.flatMap((item) => {
    const parsed = projectRequirementsDocumentSchema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
  const requirementsDraftSummary = rawRequirementsDocuments
    .map((item) => projectRequirementsDocumentSummarySchema.safeParse(item))
    .find((parsed): parsed is { success: true; data: ProjectRequirementsDocumentSummary } => parsed.success)?.data ?? null
  const requirementsDrafts = requirementsDocuments.filter(({ state }) => state === 'draft')
  const confirmedRequirementsDocuments = requirementsDocuments.filter(({ state }) => (
    state === 'confirmed'
  ))
  if (requirementsDrafts.length > 1) {
    throw new Error('Project coordination returned more than one current requirements draft.')
  }
  if (confirmedRequirementsDocuments.length > 1) {
    throw new Error('Project coordination returned more than one confirmed requirements version.')
  }
  const executionHistory = factItems<unknown>(snapshot, 'executions').map((item) => taskExecutionHistorySchema.parse(item))
  const taskHistory = factItems<unknown>(snapshot, 'tasks').map((item) => taskHistorySchema.parse(item))
  const legacyTaskIds = new Set(taskHistory.filter((task) => !taskSchema.safeParse(task).success ||
    executionHistory.some((execution) => execution.taskId === task.taskId && !taskExecutionSchema.safeParse(execution).success))
    .map((task) => task.taskId))
  const tasks = taskHistory.filter((task) => !legacyTaskIds.has(task.taskId)).map((task) => taskSchema.parse(task))
  const executions = executionHistory.filter((execution) => !legacyTaskIds.has(execution.taskId))
    .map((execution) => taskExecutionSchema.parse(execution))
  const offers = factItems<TaskOffer>(snapshot, 'offers')
  const legacyHistory = { readOnly: true as const,
    plans: planHistory.filter((item) => item.state === 'superseded' || !projectPlanSchema.safeParse(item).success),
    tasks: taskHistory.filter((task) => legacyTaskIds.has(task.taskId)),
    executions: executionHistory.filter((execution) => legacyTaskIds.has(execution.taskId)) }
  return {
    project,
    coordinatorTransferFeedback: null,
    plan: plan ? { plan } : null,
    requirementsDraft: requirementsDrafts[0] ?? null,
    requirementsDraftSummary,
    confirmedRequirements: confirmedRequirementsDocuments[0] ?? null,
    memberUsers: factItems(snapshot, 'user_label_facts'),
    workerGroups: projectWorkerGroups(project, snapshot, workerDirectory),
    legacyHistory,
    tasks: tasks
      .map((task) => ({
        task,
        delivery: snapshot?.taskDeliveries?.get(task.taskId) ?? null,
        executions: executions.filter((execution) => execution.taskId === task.taskId)
      })),
    offers,
    deliveryDrive: snapshot?.deliveryDrive ?? null,
    pendingHumanNeeded: factItems(snapshot, 'pending_human_needed'),
    records: factItems(snapshot, 'project_records'),
    finalSummary: snapshot?.finalSummary ?? null,
    memberships: factItems(snapshot, 'memberships')
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
  const grouped = new Map<string, ProjectWorkerAvailabilityView[]>()
  for (const fact of availability) {
    const userLabel = userLabels.find(({ userId }) => userId === fact.userId)
    const agentLabel = agentLabels.find(({ agentId }) => agentId === fact.agentId)
    if (!userLabel || !agentLabel || agentLabel.ownerUserId !== fact.userId) {
      throw new Error(`Worker availability ${fact.agentId} lacks exact Project label facts.`)
    }
    const membership = memberships.find(({ userId }) => userId === fact.userId) ?? null
    const taskAuthorities = authorities.filter(({ userId }) => userId === fact.userId)
    const revision = Math.max(
      fact.revision,
      membership?.revision ?? 1,
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

function requireVisibleProject(
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

function requireReadyProject(
  workspace: ProjectCoordinatorWorkspace,
  projectId: string
): ProjectCoordinatorProject {
  const project = requireVisibleProject(workspace, projectId)
  if (project.legacyHistory.plans.some((plan) => plan.state !== 'superseded') ||
    project.legacyHistory.tasks.some((task) => !['completed', 'cancelled'].includes(task.status))) {
    throw new Error('This Project contains current legacy authority and is read-only until a new canonical contract is established.')
  }

  return project
}

function isTerminalProject(project: ProjectCoordinatorProject): boolean {
  return project.project.status === 'completed' || project.project.status === 'cancelled'
}

function isExpiredDeliveryNotification(
  taskView: ProjectCoordinatorProject['tasks'][number] | undefined,
  deliveryManifestId: string,
  resultRevision?: number
): boolean {
  if (!taskView) return true
  const task = taskView.task
  const delivery = taskView.delivery
  if (delivery?.manifest && delivery.manifest.deliveryManifestId !== deliveryManifestId) return true
  if (delivery?.receipt && delivery.receipt.deliveryManifestId !== deliveryManifestId) return true
  if (delivery?.result && delivery.result.deliveryManifestId !== deliveryManifestId) return true
  if (
    resultRevision !== undefined &&
    delivery?.manifest?.deliveryManifestId === deliveryManifestId &&
    (delivery.manifest.resultRevision ?? 0) > resultRevision
  ) return true
  return ['completed', 'cancelled'].includes(task.status)
}

function isExpiredOfferClosure(
  project: ProjectCoordinatorProject,
  task: ProjectCoordinatorProject['tasks'][number]['task'] | undefined,
  offer: ProjectCoordinatorProject['offers'][number] | undefined,
  closed: Extract<AgentInboxMessage['payload'], { type: 'task.offer.closed' }>
): boolean {
  if (isTerminalProject(project) || !task || !offer) return true
  if (offer.revision > closed.offerRevision || task.revision > closed.taskRevision) return true
  return false
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
