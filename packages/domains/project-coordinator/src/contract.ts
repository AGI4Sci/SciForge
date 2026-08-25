import { z } from 'zod'
import {
  agentIdSchema,
  deviceIdSchema,
  displayNameSchema,
  projectContentProvisioningAttestationSchema,
  projectContentProvisioningIntentSchema,
  projectContentReadinessSchema,
  projectContentSpaceBindingSchema,
  projectCreateCommandSchema,
  projectIdSchema,
  projectPlanSchema,
  projectPlanRuntimeProvenanceSchema,
  projectPlanTaskSchema,
  projectSchema,
  projectWorkerAvailabilityViewSchema,
  taskExecutionSchema,
  taskResultSubmissionSchema,
  taskReviewDecisionSchema,
  taskSchema,
  timestampSchema,
  userIdSchema,
  visibleRecoveryActionSchema,
  portableContentSpaceLocatorSchema
} from '@sciforge/collaboration-contracts'

const safeReasonSchema = z.string().trim().min(1).max(2_000)

export const PROJECT_COORDINATOR_CAPABILITY_IDS = Object.freeze({
  workspaceRead: 'project-coordinator.workspace.read',
  projectCreate: 'project-coordinator.project.create',
  planDraftRead: 'project-coordinator.plan-draft.read',
  planDraftGenerate: 'project-coordinator.plan-draft.generate',
  planDraftEdit: 'project-coordinator.plan-draft.edit',
  planSubmit: 'project-coordinator.plan.submit',
  planConfirmActivate: 'project-coordinator.plan.confirm-activate'
} as const)

export const projectCoordinatorProjectCreateInputSchema = projectCreateCommandSchema.omit({
  protocolVersion: true,
  requestId: true,
  type: true,
  idempotencyKey: true
}).readonly()

export const projectCoordinatorConnectionSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('ready'),
    userId: userIdSchema,
    deviceId: deviceIdSchema
  }).strict().readonly(),
  z.object({ state: z.literal('identity_required') }).strict().readonly(),
  z.object({
    state: z.literal('device_required'),
    reason: safeReasonSchema
  }).strict().readonly(),
  z.object({
    state: z.literal('cloud_unavailable'),
    reason: safeReasonSchema
  }).strict().readonly()
])

/** UI-only assignment projection; the Plan and Agent facts remain canonical Cloud records. */
export const projectCoordinatorPlanAssignmentSchema = z.object({
  planItemId: projectPlanTaskSchema.shape.planItemId,
  selectedAgentId: agentIdSchema.nullable(),
  recommendationReason: safeReasonSchema.nullable()
}).strict().superRefine((assignment, context) => {
  if ((assignment.selectedAgentId === null) !== (assignment.recommendationReason === null)) {
    context.addIssue({
      code: 'custom',
      path: ['recommendationReason'],
      message: 'A selected exact Agent and its recommendation reason must be projected together.'
    })
  }
}).readonly()

const projectCoordinatorDraftIdSchema = z.string()
  .regex(/^draft_[A-Za-z0-9](?:[A-Za-z0-9_-]{10,95}[A-Za-z0-9])$/u)

export const projectCoordinatorPlanDraftSchema = z.object({
  draftId: projectCoordinatorDraftIdSchema,
  draftRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  projectId: projectIdSchema,
  expectedProjectRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  expectedCoordinatorAuthorityEpoch: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  supersedesProjectPlanId: projectPlanSchema.shape.projectPlanId.nullable(),
  sourceInputLocators: z.array(portableContentSpaceLocatorSchema).max(100),
  tasks: z.array(projectPlanTaskSchema).min(1).max(1_000),
  rationale: safeReasonSchema,
  runtimeProvenance: projectPlanRuntimeProvenanceSchema,
  assignments: z.array(projectCoordinatorPlanAssignmentSchema).min(1).max(1_000),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).strict().superRefine((draft, context) => {
  const taskIds = draft.tasks.map(({ planItemId }) => planItemId)
  const assignmentIds = draft.assignments.map(({ planItemId }) => planItemId)
  if (
    taskIds.length !== assignmentIds.length ||
    new Set(assignmentIds).size !== assignmentIds.length ||
    taskIds.some((planItemId) => !assignmentIds.includes(planItemId))
  ) {
    context.addIssue({
      code: 'custom',
      path: ['assignments'],
      message: 'A Plan draft retains exactly one assignment choice for every Plan item.'
    })
  }
  if (Date.parse(draft.updatedAt) < Date.parse(draft.createdAt)) {
    context.addIssue({ code: 'custom', path: ['updatedAt'], message: 'Draft update cannot precede creation.' })
  }
}).readonly()

export const projectCoordinatorPlanDraftGenerateInputSchema = z.object({
  projectId: projectIdSchema,
  instruction: safeReasonSchema,
  sourceInputLocators: z.array(portableContentSpaceLocatorSchema).max(100),
  modelId: z.string().trim().min(1).max(256).nullable()
}).strict().readonly()

export const projectCoordinatorPlanDraftReadInputSchema = z.object({
  projectId: projectIdSchema
}).strict().readonly()

export const projectCoordinatorPlanDraftEditInputSchema = z.object({
  projectId: projectIdSchema,
  draftId: projectCoordinatorDraftIdSchema,
  expectedDraftRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  tasks: z.array(projectPlanTaskSchema).min(1).max(1_000),
  rationale: safeReasonSchema,
  assignments: z.array(projectCoordinatorPlanAssignmentSchema).min(1).max(1_000)
}).strict().readonly()

export const projectCoordinatorPlanDraftSubmitInputSchema = z.object({
  projectId: projectIdSchema,
  draftId: projectCoordinatorDraftIdSchema,
  expectedDraftRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
}).strict().readonly()

export const projectCoordinatorPlanConfirmActivateInputSchema = z.object({
  projectId: projectIdSchema,
  projectPlanId: projectPlanSchema.shape.projectPlanId,
  expectedProjectRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  expectedCoordinatorAuthorityEpoch: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  expectedPlanRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  planDigest: projectPlanSchema.shape.planDigest
}).strict().readonly()

export const projectCoordinatorPlanViewSchema = z.object({
  plan: projectPlanSchema,
  assignments: z.array(projectCoordinatorPlanAssignmentSchema).max(1_000)
}).strict().superRefine((view, context) => {
  const planItemIds = new Set(view.plan.tasks.map(({ planItemId }) => planItemId))
  const assignmentIds = view.assignments.map(({ planItemId }) => planItemId)
  if (new Set(assignmentIds).size !== assignmentIds.length) {
    context.addIssue({ code: 'custom', path: ['assignments'], message: 'Plan assignments must be unique.' })
  }
  view.assignments.forEach((assignment, index) => {
    if (planItemIds.has(assignment.planItemId)) return
    context.addIssue({
      code: 'custom',
      path: ['assignments', index, 'planItemId'],
      message: 'Every assignment must reference an item in the exact Plan revision.'
    })
  })
}).readonly()

export const projectCoordinatorWorkerAgentSchema = z.object({
  displayName: displayNameSchema,
  projectAvailability: projectWorkerAvailabilityViewSchema
}).strict().readonly()

/** User is the grouping key; availability and selection remain exact Agent facts. */
export const projectCoordinatorWorkerGroupSchema = z.object({
  userId: userIdSchema,
  displayName: displayNameSchema,
  agents: z.array(projectCoordinatorWorkerAgentSchema).max(64)
}).strict().superRefine((group, context) => {
  const agentIds = group.agents.map(({ projectAvailability }) => projectAvailability.agentId)
  if (new Set(agentIds).size !== agentIds.length) {
    context.addIssue({ code: 'custom', path: ['agents'], message: 'Worker Agent IDs must be unique per User.' })
  }
  group.agents.forEach((agent, index) => {
    if (agent.projectAvailability.userId === group.userId) return
    context.addIssue({
      code: 'custom',
      path: ['agents', index, 'projectAvailability', 'userId'],
      message: 'Project availability User must match its group.'
    })
  })
}).readonly()

export const projectCoordinatorTaskViewSchema = z.object({
  task: taskSchema,
  executions: z.array(taskExecutionSchema).max(101)
}).strict().superRefine((view, context) => {
  const executionIds = view.executions.map(({ executionId }) => executionId)
  if (new Set(executionIds).size !== executionIds.length) {
    context.addIssue({ code: 'custom', path: ['executions'], message: 'Task execution IDs must be unique.' })
  }
  view.executions.forEach((execution, index) => {
    if (execution.projectId === view.task.projectId && execution.taskId === view.task.taskId) return
    context.addIssue({
      code: 'custom',
      path: ['executions', index],
      message: 'Every execution must belong to the exact Task.'
    })
  })
  if (
    view.task.currentExecutionId !== null &&
    !view.executions.some(({ executionId }) => executionId === view.task.currentExecutionId)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['executions'],
      message: 'The current execution must be present in the Task execution history.'
    })
  }
}).readonly()

export const projectCoordinatorReviewViewSchema = z.object({
  submission: taskResultSubmissionSchema,
  decision: taskReviewDecisionSchema.nullable()
}).strict().superRefine((view, context) => {
  if (!view.decision) return
  if (
    view.decision.projectId !== view.submission.projectId ||
    view.decision.taskId !== view.submission.taskId ||
    view.decision.executionId !== view.submission.executionId ||
    view.decision.resultSubmissionId !== view.submission.resultSubmissionId
  ) {
    context.addIssue({
      code: 'custom',
      path: ['decision'],
      message: 'Review decision must reference the exact immutable result submission.'
    })
  }
}).readonly()

export const projectCoordinatorProvisioningViewSchema = z.object({
  intent: projectContentProvisioningIntentSchema.nullable(),
  attestation: projectContentProvisioningAttestationSchema.nullable(),
  binding: projectContentSpaceBindingSchema.nullable(),
  recoveryActions: z.array(visibleRecoveryActionSchema).max(1_000)
}).strict().readonly()

export const projectCoordinatorProjectSchema = z.object({
  project: projectSchema,
  plan: projectCoordinatorPlanViewSchema.nullable(),
  workerGroups: z.array(projectCoordinatorWorkerGroupSchema).max(1_000),
  tasks: z.array(projectCoordinatorTaskViewSchema).max(10_000),
  reviews: z.array(projectCoordinatorReviewViewSchema).max(10_000),
  provisioning: projectCoordinatorProvisioningViewSchema
}).strict().superRefine((view, context) => {
  const projectId = view.project.projectId
  if (view.plan && view.plan.plan.projectId !== projectId) {
    context.addIssue({ code: 'custom', path: ['plan'], message: 'Plan must belong to this Project.' })
  }
  const userIds = view.workerGroups.map(({ userId }) => userId)
  if (new Set(userIds).size !== userIds.length) {
    context.addIssue({ code: 'custom', path: ['workerGroups'], message: 'Worker groups must be unique by User.' })
  }
  const agentIds = view.workerGroups.flatMap((group) =>
    group.agents.map(({ projectAvailability }) => projectAvailability.agentId)
  )
  if (new Set(agentIds).size !== agentIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['workerGroups'],
      message: 'Each Agent must occur in exactly one User group.'
    })
  }
  const candidateIds = new Set(agentIds)
  view.plan?.assignments.forEach((assignment, index) => {
    if (assignment.selectedAgentId === null || candidateIds.has(assignment.selectedAgentId)) return
    context.addIssue({
      code: 'custom',
      path: ['plan', 'assignments', index, 'selectedAgentId'],
      message: 'A selected Worker must reference an exact Agent in the User-grouped candidate projection.'
    })
  })
  view.workerGroups.forEach((group, index) => {
    if (group.agents.every(({ projectAvailability }) => (
      projectAvailability.projectId === projectId
    ))) return
    context.addIssue({
      code: 'custom',
      path: ['workerGroups', index],
      message: 'Every Worker project availability view must belong to this Project.'
    })
  })
  view.tasks.forEach((task, index) => {
    if (task.task.projectId === projectId) return
    context.addIssue({ code: 'custom', path: ['tasks', index], message: 'Task must belong to this Project.' })
  })
  view.reviews.forEach((review, index) => {
    if (review.submission.projectId === projectId) return
    context.addIssue({ code: 'custom', path: ['reviews', index], message: 'Review must belong to this Project.' })
  })
  const { intent, attestation, binding, recoveryActions } = view.provisioning
  if (intent && intent.projectId !== projectId) {
    context.addIssue({ code: 'custom', path: ['provisioning', 'intent'], message: 'Intent must belong to this Project.' })
  }
  if (binding && binding.projectId !== projectId) {
    context.addIssue({ code: 'custom', path: ['provisioning', 'binding'], message: 'Binding must belong to this Project.' })
  }
  if (attestation && attestation.projectId !== projectId) {
    context.addIssue({
      code: 'custom',
      path: ['provisioning', 'attestation'],
      message: 'Attestation must belong to this Project.'
    })
  }
  if (
    attestation && intent &&
    attestation.provisioningIntentId !== intent.provisioningIntentId
  ) {
    context.addIssue({
      code: 'custom',
      path: ['provisioning', 'attestation', 'provisioningIntentId'],
      message: 'Attestation must bind the exact visible provisioning intent.'
    })
  }
  recoveryActions.forEach((action, index) => {
    if (action.projectId === projectId) return
    context.addIssue({
      code: 'custom',
      path: ['provisioning', 'recoveryActions', index],
      message: 'Recovery action must belong to this Project.'
    })
  })
}).readonly()

export const projectCoordinatorWorkspaceReadInputSchema = z.object({
  projectId: projectIdSchema.optional()
}).strict().readonly()

export const projectCoordinatorActivationSchema = z.object({
  projectId: projectIdSchema.optional()
}).strict().readonly()

export const projectCoordinatorWorkspaceSchema = z.object({
  connection: projectCoordinatorConnectionSchema,
  observedAt: timestampSchema,
  focusedProjectId: projectIdSchema.optional(),
  projects: z.array(projectCoordinatorProjectSchema).max(1_000)
}).strict().superRefine((workspace, context) => {
  if (workspace.connection.state !== 'ready' && workspace.projects.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['projects'],
      message: 'Unavailable coordination state cannot claim Project data.'
    })
  }
  if (workspace.connection.state !== 'ready' && workspace.focusedProjectId) {
    context.addIssue({
      code: 'custom',
      path: ['focusedProjectId'],
      message: 'Unavailable coordination state cannot focus a Project.'
    })
  }
  if (
    workspace.focusedProjectId &&
    !workspace.projects.some(({ project }) => project.projectId === workspace.focusedProjectId)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['focusedProjectId'],
      message: 'The focused Project must be present in this workspace projection.'
    })
  }
  const projectIds = workspace.projects.map(({ project }) => project.projectId)
  if (new Set(projectIds).size !== projectIds.length) {
    context.addIssue({ code: 'custom', path: ['projects'], message: 'Project IDs must be unique.' })
  }
}).readonly()

export const projectCoordinatorPlanSubmitResultSchema = z.object({
  plan: projectPlanSchema,
  workspace: projectCoordinatorWorkspaceSchema
}).strict().superRefine((result, context) => {
  if (result.plan.state !== 'awaiting_confirmation') {
    context.addIssue({ code: 'custom', path: ['plan', 'state'], message: 'A submitted Plan awaits Owner confirmation.' })
  }
  if (result.workspace.focusedProjectId !== result.plan.projectId) {
    context.addIssue({ code: 'custom', path: ['workspace'], message: 'Plan submit must retain exact Project focus.' })
  }
}).readonly()

export const projectCoordinatorProjectCreateResultSchema = z.object({
  createdProjectId: projectIdSchema,
  workspace: projectCoordinatorWorkspaceSchema
}).strict().superRefine((result, context) => {
  if (result.workspace.focusedProjectId !== result.createdProjectId) {
    context.addIssue({
      code: 'custom',
      path: ['workspace', 'focusedProjectId'],
      message: 'Project creation must focus the exact new Project.'
    })
  }
}).readonly()

export type ProjectCoordinatorConnection = z.infer<typeof projectCoordinatorConnectionSchema>
export type ProjectCoordinatorProject = z.infer<typeof projectCoordinatorProjectSchema>
export type ProjectCoordinatorWorkspace = z.infer<typeof projectCoordinatorWorkspaceSchema>
export type ProjectCoordinatorWorkspaceReadInput = z.infer<
  typeof projectCoordinatorWorkspaceReadInputSchema
>
export type ProjectCoordinatorProjectCreateInput = z.infer<
  typeof projectCoordinatorProjectCreateInputSchema
>
export type ProjectCoordinatorProjectCreateResult = z.infer<
  typeof projectCoordinatorProjectCreateResultSchema
>
export type ProjectCoordinatorPlanDraft = z.infer<typeof projectCoordinatorPlanDraftSchema>
export type ProjectCoordinatorPlanAssignment = z.infer<
  typeof projectCoordinatorPlanAssignmentSchema
>
export type ProjectCoordinatorPlanDraftGenerateInput = z.infer<
  typeof projectCoordinatorPlanDraftGenerateInputSchema
>
export type ProjectCoordinatorPlanDraftReadInput = z.infer<
  typeof projectCoordinatorPlanDraftReadInputSchema
>
export type ProjectCoordinatorPlanDraftEditInput = z.infer<
  typeof projectCoordinatorPlanDraftEditInputSchema
>
export type ProjectCoordinatorPlanDraftSubmitInput = z.infer<
  typeof projectCoordinatorPlanDraftSubmitInputSchema
>
export type ProjectCoordinatorPlanSubmitResult = z.infer<
  typeof projectCoordinatorPlanSubmitResultSchema
>
export type ProjectCoordinatorPlanConfirmActivateInput = z.infer<
  typeof projectCoordinatorPlanConfirmActivateInputSchema
>
export type ProjectCoordinatorActivation = z.infer<typeof projectCoordinatorActivationSchema>
