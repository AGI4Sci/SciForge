import { z } from 'zod'

import {
  agentIdSchema,
  deviceIdSchema,
  displayNameSchema,
  projectIdSchema,
  protocolEnvelopeShape,
  protocolVersionSchema,
  requestIdSchema,
  revisionSchema,
  timestampSchema,
  userIdSchema
} from './core.js'
import {
  agentLifecycleStatusSchema,
  agentNodeTypeSchema,
  humanNeededSchema,
  projectRecordSchema,
  projectSchema,
  taskSchema,
  userStatusSchema
} from './entities.js'
import {
  projectMembershipSchema,
  taskAuthoritySchema,
  workerAvailabilityProjectionSchema
} from './project-coordination.js'
import {
  externalOperationRecoveryJournalEntrySchema,
  projectContentProvisioningAttestationSchema,
  projectContentProvisioningIntentSchema,
  projectContentReadinessSchema,
  projectContentSpaceBindingSchema,
  projectProviderMembershipObservationSchema,
  providerDirectoryPrincipalFactSchema,
  visibleRecoveryActionSchema
} from './project-content.js'
import {
  projectFinalSummarySchema,
  projectPlanSchema,
  taskResultSubmissionSchema,
  taskReviewDecisionSchema
} from './project-review.js'
import { taskExecutionSchema, taskOfferSchema } from './task-execution.js'

/**
 * A cursor is a non-authorizing, service-issued opaque continuation. Services
 * bind it to actor visibility, exact Project/collection and the stable order
 * below; a cursor from another scope is rejected rather than reinterpreted.
 */
export const projectCoordinationCursorSchema = z.string()
  .min(1)
  .max(2_048)
  .refine((value) => value === value.trim(), 'Page cursors must be canonical opaque values.')

export const PROJECT_COORDINATION_MAX_PAGE_SIZE = 250 as const
export const PROJECT_LIST_STABLE_ORDER = ['projectId'] as const

export const projectCoordinationPageLimitSchema = z.number().int().min(1).max(PROJECT_COORDINATION_MAX_PAGE_SIZE)

/** The authenticated OIDC actor is derived by Identity; it is never caller input. */
export const projectListQuerySchema = z.object({
  ...protocolEnvelopeShape,
  type: z.literal('project.list'),
  cursor: projectCoordinationCursorSchema.optional(),
  limit: projectCoordinationPageLimitSchema
}).strict()
export type ProjectListQuery = z.infer<typeof projectListQuerySchema>

export const restProjectPageResponseSchema = z.object({
  protocolVersion: protocolVersionSchema,
  type: z.literal('rest.project_page'),
  requestId: requestIdSchema,
  cursor: projectCoordinationCursorSchema.optional(),
  limit: projectCoordinationPageLimitSchema,
  projects: z.array(projectSchema).max(PROJECT_COORDINATION_MAX_PAGE_SIZE),
  nextCursor: projectCoordinationCursorSchema.optional(),
  observedAt: timestampSchema
}).strict().superRefine((response, context) => {
  const projectIds = response.projects.map(({ projectId }) => projectId)
  if (new Set(projectIds).size !== projectIds.length) {
    context.addIssue({ code: 'custom', path: ['projects'], message: 'A Project page cannot repeat a Project.' })
  }
  if (response.projects.length > response.limit) {
    context.addIssue({ code: 'custom', path: ['projects'], message: 'A Project page cannot exceed its echoed limit.' })
  }
  if (response.projects.length === 0 && response.nextCursor !== undefined) {
    context.addIssue({ code: 'custom', path: ['nextCursor'], message: 'An empty Project page cannot advance its cursor.' })
  }
})
export type RestProjectPageResponse = z.infer<typeof restProjectPageResponseSchema>

export const PROJECT_COORDINATION_COLLECTIONS = [
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

export const projectCoordinationCollectionSchema = z.enum(PROJECT_COORDINATION_COLLECTIONS)
export type ProjectCoordinationCollection = z.infer<typeof projectCoordinationCollectionSchema>

/** Immutable keyset order; cursors retain the same snapshot across continuation. */
export const PROJECT_COORDINATION_COLLECTION_STABLE_ORDER = {
  user_label_facts: ['userId'],
  agent_label_facts: ['agentId'],
  memberships: ['userId'],
  task_authorities: ['userId', 'scope'],
  worker_availability: ['agentId'],
  provider_principal_facts: ['userId'],
  content_readiness: ['userId'],
  provider_membership_observations: ['providerObservationId'],
  plans: ['projectPlanId'],
  tasks: ['taskId'],
  executions: ['executionId'],
  offers: ['taskOfferId'],
  result_submissions: ['resultSubmissionId'],
  review_decisions: ['reviewDecisionId'],
  pending_human_needed: ['humanRequestId'],
  provisioning_intents: ['provisioningIntentId'],
  provisioning_attestations: ['provisioningAttestationId'],
  content_bindings: ['projectContentBindingId'],
  external_operation_journal: ['contentRecoveryJournalEntryId'],
  visible_recovery_actions: ['recoveryActionId'],
  project_records: ['projectRecordId']
} as const satisfies Readonly<Record<ProjectCoordinationCollection, readonly string[]>>

export const projectCoordinationCollectionPageRequestSchema = z.object({
  collection: projectCoordinationCollectionSchema,
  cursor: projectCoordinationCursorSchema.optional(),
  limit: projectCoordinationPageLimitSchema
}).strict()

/**
 * One Project-scoped read port. Each requested canonical fact collection owns
 * its cursor so callers can advance it without fetching an unbounded snapshot.
 */
export const projectCoordinationReadQuerySchema = z.object({
  ...protocolEnvelopeShape,
  type: z.literal('project.coordination.read'),
  projectId: projectIdSchema,
  collections: z.array(projectCoordinationCollectionPageRequestSchema).min(1).max(PROJECT_COORDINATION_COLLECTIONS.length)
}).strict().superRefine((query, context) => {
  const collections = query.collections.map(({ collection }) => collection)
  if (new Set(collections).size !== collections.length) {
    context.addIssue({
      code: 'custom',
      path: ['collections'],
      message: 'Each Project coordination collection may be requested at most once per read.'
    })
  }
})
export type ProjectCoordinationReadQuery = z.infer<typeof projectCoordinationReadQuerySchema>

/**
 * Canonical OIDC read visibility. Provider access loss does not alter this
 * Cloud fact; pending activation and final removal never retain Project reads.
 * Terminal Project status intentionally does not change the rule.
 */
export function canUserReadProjectCoordination(
  project: Readonly<Pick<z.infer<typeof projectSchema>, 'projectId' | 'ownerUserId'>>,
  actorUserId: string,
  membership: Readonly<Pick<z.infer<typeof projectMembershipSchema>, 'projectId' | 'userId' | 'state'>> | null
): boolean {
  if (project.ownerUserId === actorUserId) return true
  return membership?.projectId === project.projectId &&
    membership.userId === actorUserId &&
    (membership.state === 'active' || membership.state === 'membership_removal_pending')
}

/** Human-visible labels only: no OIDC subject, endpoint identity or account material. */
export const projectUserLabelFactSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('project_user_label_fact'),
  projectId: projectIdSchema,
  userId: userIdSchema,
  displayName: displayNameSchema,
  status: userStatusSchema,
  revision: revisionSchema,
  observedAt: timestampSchema
}).strict()
export type ProjectUserLabelFact = z.infer<typeof projectUserLabelFactSchema>

/** Safe Agent label/ownership facts omit machine credentials and Runtime configuration. */
export const projectAgentLabelFactSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('project_agent_label_fact'),
  projectId: projectIdSchema,
  agentId: agentIdSchema,
  ownerUserId: userIdSchema,
  deviceId: deviceIdSchema,
  displayName: displayNameSchema,
  nodeType: agentNodeTypeSchema,
  lifecycleStatus: agentLifecycleStatusSchema,
  revision: revisionSchema,
  observedAt: timestampSchema
}).strict()
export type ProjectAgentLabelFact = z.infer<typeof projectAgentLabelFactSchema>

const projectCoordinationPageShape = {
  cursor: projectCoordinationCursorSchema.optional(),
  limit: projectCoordinationPageLimitSchema,
  nextCursor: projectCoordinationCursorSchema.optional()
} as const

const coordinationFactPage = <
  const Collection extends ProjectCoordinationCollection,
  ItemSchema extends z.ZodType
>(collection: Collection, itemSchema: ItemSchema) => z.object({
    collection: z.literal(collection),
    ...projectCoordinationPageShape,
    items: z.array(itemSchema).max(PROJECT_COORDINATION_MAX_PAGE_SIZE)
  }).strict()

const projectUserLabelFactPageSchema = coordinationFactPage('user_label_facts', projectUserLabelFactSchema)
const projectAgentLabelFactPageSchema = coordinationFactPage('agent_label_facts', projectAgentLabelFactSchema)
const projectMembershipPageSchema = coordinationFactPage('memberships', projectMembershipSchema)
const taskAuthorityPageSchema = coordinationFactPage('task_authorities', taskAuthoritySchema)
const workerAvailabilityPageSchema = coordinationFactPage('worker_availability', workerAvailabilityProjectionSchema)
const providerPrincipalFactPageSchema = coordinationFactPage('provider_principal_facts', providerDirectoryPrincipalFactSchema)
const projectContentReadinessPageSchema = coordinationFactPage('content_readiness', projectContentReadinessSchema)
const providerMembershipObservationPageSchema = coordinationFactPage(
  'provider_membership_observations',
  projectProviderMembershipObservationSchema
)
const projectPlanPageSchema = coordinationFactPage('plans', projectPlanSchema)
const taskPageSchema = coordinationFactPage('tasks', taskSchema)
const taskExecutionPageSchema = coordinationFactPage('executions', taskExecutionSchema)
const taskOfferPageSchema = coordinationFactPage('offers', taskOfferSchema)
const taskResultSubmissionPageSchema = coordinationFactPage('result_submissions', taskResultSubmissionSchema)
const taskReviewDecisionPageSchema = coordinationFactPage('review_decisions', taskReviewDecisionSchema)
const pendingHumanNeededSchema = humanNeededSchema.refine(
  ({ status }) => status === 'pending',
  'The Coordinator pending HumanNeeded page cannot contain answered, expired or cancelled requests.'
)
const pendingHumanNeededPageSchema = coordinationFactPage('pending_human_needed', pendingHumanNeededSchema)
const provisioningIntentPageSchema = coordinationFactPage('provisioning_intents', projectContentProvisioningIntentSchema)
const provisioningAttestationPageSchema = coordinationFactPage(
  'provisioning_attestations',
  projectContentProvisioningAttestationSchema
)
const projectContentBindingPageSchema = coordinationFactPage('content_bindings', projectContentSpaceBindingSchema)
const externalOperationJournalPageSchema = coordinationFactPage(
  'external_operation_journal',
  externalOperationRecoveryJournalEntrySchema
)
const visibleRecoveryActionPageSchema = coordinationFactPage('visible_recovery_actions', visibleRecoveryActionSchema)
const projectRecordPageSchema = coordinationFactPage('project_records', projectRecordSchema)

export const projectCoordinationFactPageSchema = z.discriminatedUnion('collection', [
  projectUserLabelFactPageSchema,
  projectAgentLabelFactPageSchema,
  projectMembershipPageSchema,
  taskAuthorityPageSchema,
  workerAvailabilityPageSchema,
  providerPrincipalFactPageSchema,
  projectContentReadinessPageSchema,
  providerMembershipObservationPageSchema,
  projectPlanPageSchema,
  taskPageSchema,
  taskExecutionPageSchema,
  taskOfferPageSchema,
  taskResultSubmissionPageSchema,
  taskReviewDecisionPageSchema,
  pendingHumanNeededPageSchema,
  provisioningIntentPageSchema,
  provisioningAttestationPageSchema,
  projectContentBindingPageSchema,
  externalOperationJournalPageSchema,
  visibleRecoveryActionPageSchema,
  projectRecordPageSchema
])
export type ProjectCoordinationFactPage = z.infer<typeof projectCoordinationFactPageSchema>

export const restProjectCoordinationResponseSchema = z.object({
  protocolVersion: protocolVersionSchema,
  type: z.literal('rest.project_coordination'),
  requestId: requestIdSchema,
  project: projectSchema,
  observedAt: timestampSchema,
  pages: z.array(projectCoordinationFactPageSchema).min(1).max(PROJECT_COORDINATION_COLLECTIONS.length),
  finalSummary: projectFinalSummarySchema.nullable()
}).strict().superRefine((response, context) => {
  const collections = response.pages.map(({ collection }) => collection)
  if (new Set(collections).size !== collections.length) {
    context.addIssue({ code: 'custom', path: ['pages'], message: 'Each coordination fact collection may appear at most once.' })
  }
  for (const [pageIndex, page] of response.pages.entries()) {
    if (page.items.length > page.limit) {
      context.addIssue({ code: 'custom', path: ['pages', pageIndex, 'items'], message: 'A fact page cannot exceed its echoed limit.' })
    }
    if (page.items.length === 0 && page.nextCursor !== undefined) {
      context.addIssue({ code: 'custom', path: ['pages', pageIndex, 'nextCursor'], message: 'An empty fact page cannot advance its cursor.' })
    }
  }

  const userLabels = response.pages.flatMap((page) => page.collection === 'user_label_facts' ? page.items : [])
  const agentLabels = response.pages.flatMap((page) => page.collection === 'agent_label_facts' ? page.items : [])
  const memberships = response.pages.flatMap((page) => page.collection === 'memberships' ? page.items : [])
  const availability = response.pages.flatMap((page) => page.collection === 'worker_availability' ? page.items : [])
  const tasks = response.pages.flatMap((page) => page.collection === 'tasks' ? page.items : [])
  const executions = response.pages.flatMap((page) => page.collection === 'executions' ? page.items : [])
  const offers = response.pages.flatMap((page) => page.collection === 'offers' ? page.items : [])
  const taskAuthorities = response.pages.flatMap((page) => page.collection === 'task_authorities' ? page.items : [])
  const providerPrincipalFacts = response.pages.flatMap((page) => page.collection === 'provider_principal_facts' ? page.items : [])
  const contentReadiness = response.pages.flatMap((page) => page.collection === 'content_readiness' ? page.items : [])
  const providerObservations = response.pages.flatMap((page) => page.collection === 'provider_membership_observations' ? page.items : [])
  const provisioningIntents = response.pages.flatMap((page) => page.collection === 'provisioning_intents' ? page.items : [])
  const provisioningAttestations = response.pages.flatMap((page) => page.collection === 'provisioning_attestations' ? page.items : [])
  const contentBindings = response.pages.flatMap((page) => page.collection === 'content_bindings' ? page.items : [])
  const externalJournal = response.pages.flatMap((page) => page.collection === 'external_operation_journal' ? page.items : [])
  const recoveryActions = response.pages.flatMap((page) => page.collection === 'visible_recovery_actions' ? page.items : [])
  const pendingHumanNeeded = response.pages.flatMap((page) => page.collection === 'pending_human_needed' ? page.items : [])
  const plans = response.pages.flatMap((page) => page.collection === 'plans' ? page.items : [])
  const resultSubmissions = response.pages.flatMap((page) => page.collection === 'result_submissions' ? page.items : [])
  const reviewDecisions = response.pages.flatMap((page) => page.collection === 'review_decisions' ? page.items : [])
  const projectRecords = response.pages.flatMap((page) => page.collection === 'project_records' ? page.items : [])
  const projectId = response.project.projectId
  const completeCollections = new Set(response.pages
    .filter(({ cursor, nextCursor }) => cursor === undefined && nextCursor === undefined)
    .map(({ collection }) => collection))

  if (userLabels.some((fact) => fact.projectId !== projectId) ||
      agentLabels.some((fact) => fact.projectId !== projectId) ||
      memberships.some((fact) => fact.projectId !== projectId) ||
      tasks.some((fact) => fact.projectId !== projectId) ||
      executions.some((fact) => fact.projectId !== projectId) ||
      offers.some((fact) => fact.projectId !== projectId) ||
      taskAuthorities.some((fact) => fact.projectId !== projectId) ||
      contentReadiness.some((fact) => fact.projectId !== projectId) ||
      providerObservations.some((fact) => fact.projectId !== projectId) ||
      provisioningIntents.some((fact) => fact.projectId !== projectId) ||
      provisioningAttestations.some((fact) => fact.projectId !== projectId) ||
      contentBindings.some((fact) => fact.projectId !== projectId) ||
      externalJournal.some((fact) => fact.projectId !== projectId) ||
      recoveryActions.some((fact) => fact.projectId !== projectId) ||
      pendingHumanNeeded.some((fact) => fact.projectId !== projectId) ||
      plans.some((fact) => fact.projectId !== projectId) ||
      resultSubmissions.some((fact) => fact.projectId !== projectId) ||
      reviewDecisions.some((fact) => fact.projectId !== projectId) ||
      projectRecords.some((fact) => fact.projectId !== projectId)) {
    context.addIssue({ code: 'custom', path: ['pages'], message: 'Every Project-scoped fact must belong to the exact returned Project.' })
  }

  const uniqueKeys = (
    values: readonly string[],
    path: readonly (string | number)[],
    message: string
  ): void => {
    if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', path: [...path], message })
  }
  uniqueKeys(userLabels.map(({ userId }) => userId), ['pages'], 'A User label fact may appear only once.')
  uniqueKeys(agentLabels.map(({ agentId }) => agentId), ['pages'], 'An Agent label fact may appear only once.')
  uniqueKeys(memberships.map(({ userId }) => userId), ['pages'], 'Project Membership is one User-level fact, never repeated per Agent.')
  uniqueKeys(memberships.map(({ projectMembershipId }) => projectMembershipId), ['pages'], 'Project Membership IDs must be unique.')
  uniqueKeys(availability.map(({ agentId }) => agentId), ['pages'], 'Global Worker Availability is one fact per Agent.')
  uniqueKeys(tasks.map(({ taskId }) => taskId), ['pages'], 'A Task fact may appear only once.')
  uniqueKeys(executions.map(({ executionId }) => executionId), ['pages'], 'A Task execution fact may appear only once.')
  uniqueKeys(offers.map(({ taskOfferId }) => taskOfferId), ['pages'], 'A Task offer fact may appear only once.')
  uniqueKeys(offers.map(({ executionId }) => executionId), ['pages'], 'One execution can have only one canonical Task offer.')
  uniqueKeys(taskAuthorities.map(({ taskAuthorityId }) => taskAuthorityId), ['pages'], 'Task Authority IDs must be unique.')
  uniqueKeys(
    taskAuthorities.map(({ userId, scope }) => `${userId}\u0000${scope}`),
    ['pages'],
    'Task Authority is one User-level fact per exact text/file scope, never repeated per Agent.'
  )
  uniqueKeys(providerPrincipalFacts.map(({ providerPrincipalFactId }) => providerPrincipalFactId), ['pages'], 'Current Provider principal fact IDs must be unique.')
  uniqueKeys(providerPrincipalFacts.map(({ userId }) => userId), ['pages'], 'The Project Provider Instance has at most one current principal fact per User.')
  uniqueKeys(contentReadiness.map(({ userId }) => userId), ['pages'], 'Project Content Readiness is one User-level fact, never repeated per Agent.')
  uniqueKeys(providerObservations.map(({ providerObservationId }) => providerObservationId), ['pages'], 'Provider membership observation IDs must be unique.')
  uniqueKeys(provisioningIntents.map(({ provisioningIntentId }) => provisioningIntentId), ['pages'], 'Provisioning intent IDs must be unique.')
  uniqueKeys(provisioningAttestations.map(({ provisioningAttestationId }) => provisioningAttestationId), ['pages'], 'Provisioning attestation IDs must be unique.')
  uniqueKeys(contentBindings.map(({ projectContentBindingId }) => projectContentBindingId), ['pages'], 'Project Content Binding IDs must be unique.')
  uniqueKeys(externalJournal.map(({ contentRecoveryJournalEntryId }) => contentRecoveryJournalEntryId), ['pages'], 'External recovery journal IDs must be unique.')
  uniqueKeys(externalJournal.map(({ logicalInvocationId }) => logicalInvocationId), ['pages'], 'External recovery logical invocation IDs must be unique inside a Project.')
  uniqueKeys(recoveryActions.map(({ recoveryActionId }) => recoveryActionId), ['pages'], 'Visible recovery action IDs must be unique.')
  uniqueKeys(pendingHumanNeeded.map(({ humanRequestId }) => humanRequestId), ['pages'], 'Pending HumanNeeded request IDs must be unique.')
  uniqueKeys(plans.map(({ projectPlanId }) => projectPlanId), ['pages'], 'Project Plan IDs must be unique.')
  uniqueKeys(resultSubmissions.map(({ resultSubmissionId }) => resultSubmissionId), ['pages'], 'Task result submission IDs must be unique.')
  uniqueKeys(reviewDecisions.map(({ reviewDecisionId }) => reviewDecisionId), ['pages'], 'Task review decision IDs must be unique.')
  uniqueKeys(reviewDecisions.map(({ resultSubmissionId }) => resultSubmissionId), ['pages'], 'One immutable result submission can have only one canonical review decision.')
  uniqueKeys(projectRecords.map(({ projectRecordId }) => projectRecordId), ['pages'], 'Project Record IDs must be unique.')

  const agentLabelsById = new Map(agentLabels.map((fact) => [fact.agentId, fact]))
  const membershipsByUserId = new Map(memberships.map((fact) => [fact.userId, fact]))
  const tasksById = new Map(tasks.map((fact) => [fact.taskId, fact]))
  const executionsById = new Map(executions.map((fact) => [fact.executionId, fact]))
  const providerFactsById = new Map(providerPrincipalFacts.map((fact) => [fact.providerPrincipalFactId, fact]))
  const observationsById = new Map(providerObservations.map((fact) => [fact.providerObservationId, fact]))
  const intentsById = new Map(provisioningIntents.map((fact) => [fact.provisioningIntentId, fact]))
  const attestationsById = new Map(provisioningAttestations.map((fact) => [fact.provisioningAttestationId, fact]))
  const journalById = new Map(externalJournal.map((fact) => [fact.contentRecoveryJournalEntryId, fact]))
  const plansById = new Map(plans.map((fact) => [fact.projectPlanId, fact]))
  const resultsById = new Map(resultSubmissions.map((fact) => [fact.resultSubmissionId, fact]))
  const reviewsByResultId = new Map(reviewDecisions.map((fact) => [fact.resultSubmissionId, fact]))
  const recordsById = new Map(projectRecords.map((fact) => [fact.projectRecordId, fact]))

  const requireCompleteReference = (
    collection: ProjectCoordinationCollection,
    resolved: unknown,
    path: readonly (string | number)[],
    message: string
  ): void => {
    if (resolved === undefined && completeCollections.has(collection)) {
      context.addIssue({ code: 'custom', path: [...path], message })
    }
  }

  for (const [index, fact] of availability.entries()) {
    const label = agentLabelsById.get(fact.agentId)
    requireCompleteReference(
      'agent_label_facts',
      label,
      ['pages', index, 'agentId'],
      'Worker Availability must resolve its exact safe Agent label fact.'
    )
    requireCompleteReference(
      'memberships',
      membershipsByUserId.get(fact.userId),
      ['pages', index, 'userId'],
      'Worker Availability User must resolve to one Project Membership fact.'
    )
    if (label !== undefined && (label.ownerUserId !== fact.userId || label.deviceId !== fact.deviceId)) {
      context.addIssue({
        code: 'custom',
        path: ['pages', index],
        message: 'Worker Availability must identify the same User and Device as the exact Agent label fact.'
      })
    }
  }

  for (const [index, label] of userLabels.entries()) {
    requireCompleteReference(
      'memberships',
      membershipsByUserId.get(label.userId),
      ['pages', index, 'userId'],
      'Every safe User label must resolve to one Project Membership fact.'
    )
  }

  for (const [index, membership] of memberships.entries()) {
    requireCompleteReference(
      'user_label_facts',
      userLabels.find(({ userId }) => userId === membership.userId),
      ['pages', index, 'userId'],
      'Every Project Membership must resolve to one safe User label fact.'
    )
    if (completeCollections.has('memberships') && completeCollections.has('task_authorities')) {
      const scopes = taskAuthorities
        .filter(({ userId }) => userId === membership.userId)
        .map(({ scope }) => scope)
      if (scopes.length !== 2 || !scopes.includes('text_tasks') || !scopes.includes('file_tasks')) {
        context.addIssue({
          code: 'custom',
          path: ['pages', index, 'userId'],
          message: 'A complete Project read retains exactly one text and one file Task Authority per User.'
        })
      }
    }
  }

  requireCompleteReference(
    'memberships',
    membershipsByUserId.get(response.project.ownerUserId),
    ['project', 'ownerUserId'],
    'The Project Owner must resolve to the unique User-level Membership fact.'
  )
  requireCompleteReference(
    'agent_label_facts',
    agentLabelsById.get(response.project.coordinatorAgentId),
    ['project', 'coordinatorAgentId'],
    'The exact Coordinator Agent must resolve to one safe Agent label fact.'
  )

  for (const [index, label] of agentLabels.entries()) {
    requireCompleteReference(
      'memberships',
      membershipsByUserId.get(label.ownerUserId),
      ['pages', index, 'ownerUserId'],
      'Every Project Agent label owner must resolve to one User-level Membership fact.'
    )
  }

  for (const [index, task] of tasks.entries()) {
    requireCompleteReference(
      'agent_label_facts',
      agentLabelsById.get(task.createdByCoordinatorAgentId),
      ['pages', index, 'createdByCoordinatorAgentId'],
      'A Task creator must resolve to an exact Project Agent label fact.'
    )
    for (const dependencyTaskId of task.dependencyTaskIds) {
      requireCompleteReference(
        'tasks',
        tasksById.get(dependencyTaskId),
        ['pages', index, 'dependencyTaskIds'],
        'A Task dependency must resolve inside a complete Task fact collection.'
      )
    }
    if (task.currentExecutionId !== null) {
      const execution = executionsById.get(task.currentExecutionId)
      requireCompleteReference(
        'executions',
        execution,
        ['pages', index, 'currentExecutionId'],
        'A current Task execution must resolve inside a complete execution fact collection.'
      )
      if (execution !== undefined && (
        execution.projectId !== projectId ||
        execution.taskId !== task.taskId ||
        execution.state !== task.currentExecutionState
      )) {
        context.addIssue({
          code: 'custom',
          path: ['pages', index, 'currentExecutionId'],
          message: 'The Task current execution projection must match the exact execution identity and state.'
        })
      }
    }
  }

  for (const [index, execution] of executions.entries()) {
    const task = tasksById.get(execution.taskId)
    requireCompleteReference(
      'tasks',
      task,
      ['pages', index, 'taskId'],
      'An execution must resolve to its exact Task inside a complete Task fact collection.'
    )
    const assigneeAgent = agentLabelsById.get(execution.assigneeAgentId)
    requireCompleteReference(
      'agent_label_facts',
      assigneeAgent,
      ['pages', index, 'assigneeAgentId'],
      'An execution assignee must resolve to the exact Agent label fact.'
    )
    if (assigneeAgent !== undefined && (
      assigneeAgent.ownerUserId !== execution.assigneeUserId ||
      assigneeAgent.deviceId !== execution.assigneeDeviceId
    )) {
      context.addIssue({
        code: 'custom',
        path: ['pages', index, 'assigneeAgentId'],
        message: 'Execution User, Agent and Device references must identify one immutable assignee.'
      })
    }
    requireCompleteReference(
      'memberships',
      membershipsByUserId.get(execution.assigneeUserId),
      ['pages', index, 'assigneeUserId'],
      'An execution assignee User must resolve to the unique Project Membership fact.'
    )
    requireCompleteReference(
      'agent_label_facts',
      agentLabelsById.get(execution.offeredByCoordinatorAgentId),
      ['pages', index, 'offeredByCoordinatorAgentId'],
      'The Agent that offered an execution must resolve to a safe Project Agent label fact.'
    )
  }

  for (const [index, offer] of offers.entries()) {
    const execution = executionsById.get(offer.executionId)
    requireCompleteReference(
      'executions',
      execution,
      ['pages', index, 'executionId'],
      'A Task offer must resolve to its exact execution inside a complete execution fact collection.'
    )
    if (execution !== undefined && (
      offer.projectId !== execution.projectId ||
      offer.taskId !== execution.taskId ||
      offer.assigneeUserId !== execution.assigneeUserId ||
      offer.assigneeAgentId !== execution.assigneeAgentId ||
      offer.assigneeDeviceId !== execution.assigneeDeviceId
    )) {
      context.addIssue({
        code: 'custom',
        path: ['pages', index, 'executionId'],
        message: 'Task offer references must match the immutable execution assignee and Task identity.'
      })
    }
  }

  const sameProviderInstance = (
    left: { authority: string, instanceId: string },
    right: { authority: string, instanceId: string }
  ): boolean => left.authority === right.authority && left.instanceId === right.instanceId
  const sameProviderPrincipal = (
    left: { providerInstance: { authority: string, instanceId: string }, principalKind: string, principalId: string },
    right: { providerInstance: { authority: string, instanceId: string }, principalKind: string, principalId: string }
  ): boolean => sameProviderInstance(left.providerInstance, right.providerInstance) &&
    left.principalKind === right.principalKind && left.principalId === right.principalId

  for (const [index, authority] of taskAuthorities.entries()) {
    requireCompleteReference(
      'memberships',
      membershipsByUserId.get(authority.userId),
      ['pages', index, 'userId'],
      'Each User-level Task Authority must resolve to one Project Membership fact.'
    )
  }

  for (const [index, fact] of providerPrincipalFacts.entries()) {
    requireCompleteReference(
      'memberships',
      membershipsByUserId.get(fact.userId),
      ['pages', index, 'userId'],
      'A Project-selected current Provider principal fact must belong to one Project Member User.'
    )
  }

  for (const [index, readiness] of contentReadiness.entries()) {
    requireCompleteReference(
      'memberships',
      membershipsByUserId.get(readiness.userId),
      ['pages', index, 'userId'],
      'Project Content Readiness must resolve to one Project Member User.'
    )
    if (readiness.providerPrincipalFactId !== null) {
      const fact = providerFactsById.get(readiness.providerPrincipalFactId)
      requireCompleteReference(
        'provider_principal_facts',
        fact,
        ['pages', index, 'providerPrincipalFactId'],
        'Content Readiness must resolve its current/snapshotted Provider principal fact.'
      )
      if (fact !== undefined && (
        fact.userId !== readiness.userId ||
        !sameProviderInstance(fact.providerPrincipal.providerInstance, readiness.providerInstance) ||
        fact.revision < (readiness.snapshottedFactRevision ?? 0) ||
        (fact.revision === readiness.snapshottedFactRevision && readiness.providerPrincipal !== null &&
          !sameProviderPrincipal(fact.providerPrincipal, readiness.providerPrincipal))
      )) {
        context.addIssue({
          code: 'custom',
          path: ['pages', index, 'providerPrincipalFactId'],
          message: 'Content Readiness Provider identity must match the exact User, Instance and snapshotted fact revision.'
        })
      }
    }
    if (readiness.lastObservationId !== null) {
      const observation = observationsById.get(readiness.lastObservationId)
      requireCompleteReference(
        'provider_membership_observations',
        observation,
        ['pages', index, 'lastObservationId'],
        'Content Readiness must resolve its latest exact Provider observation.'
      )
      if (observation !== undefined && (
        observation.userId !== readiness.userId ||
        observation.providerPrincipalFactId !== readiness.providerPrincipalFactId ||
        observation.bindingRevision !== readiness.bindingRevision
      )) {
        context.addIssue({
          code: 'custom',
          path: ['pages', index, 'lastObservationId'],
          message: 'Content Readiness must reference an observation for the same User, Provider fact and binding revision.'
        })
      }
    }
    if (readiness.bindingRevision !== null) {
      const binding = contentBindings.find(({ revision }) => revision === readiness.bindingRevision)
      requireCompleteReference(
        'content_bindings',
        binding,
        ['pages', index, 'bindingRevision'],
        'Content Readiness binding revision must resolve inside a complete binding fact collection.'
      )
      if (binding !== undefined && !sameProviderInstance(binding.providerInstance, readiness.providerInstance)) {
        context.addIssue({
          code: 'custom',
          path: ['pages', index, 'bindingRevision'],
          message: 'Content Readiness and its binding must use the exact same Provider Instance.'
        })
      }
    }
  }

  for (const [index, observation] of providerObservations.entries()) {
    const fact = providerFactsById.get(observation.providerPrincipalFactId)
    requireCompleteReference(
      'provider_principal_facts',
      fact,
      ['pages', index, 'providerPrincipalFactId'],
      'A Provider observation must resolve its exact principal fact.'
    )
    if (fact !== undefined && (
      fact.userId !== observation.userId ||
      fact.revision < observation.snapshottedFactRevision ||
      (fact.revision === observation.snapshottedFactRevision &&
        !sameProviderPrincipal(fact.providerPrincipal, observation.providerPrincipal))
    )) {
      context.addIssue({
        code: 'custom',
        path: ['pages', index, 'providerPrincipalFactId'],
        message: 'A Provider observation must match the exact User and snapshotted Provider principal fact.'
      })
    }
    if (observation.provisioningAttestationId !== null) {
      requireCompleteReference(
        'provisioning_attestations',
        attestationsById.get(observation.provisioningAttestationId),
        ['pages', index, 'provisioningAttestationId'],
        'An attestation-sourced Provider observation must resolve its exact attestation.'
      )
    }
  }

  for (const [index, intent] of provisioningIntents.entries()) {
    if (intent.createdByOwnerUserId !== response.project.ownerUserId) {
      context.addIssue({
        code: 'custom',
        path: ['pages', index, 'createdByOwnerUserId'],
        message: 'A Project provisioning intent must retain the exact Project Owner who created it.'
      })
    }
    requireCompleteReference(
      'memberships',
      membershipsByUserId.get(intent.contentOwnerUserId),
      ['pages', index, 'contentOwnerUserId'],
      'The content owner must resolve to one Project Membership fact.'
    )
    for (const [memberIndex, member] of intent.desiredMembers.entries()) {
      requireCompleteReference(
        'memberships',
        membershipsByUserId.get(member.userId),
        ['pages', index, 'desiredMembers', memberIndex, 'userId'],
        'Every desired Provider member must resolve to one Project Membership fact.'
      )
      const fact = providerFactsById.get(member.providerPrincipalFactId)
      requireCompleteReference(
        'provider_principal_facts',
        fact,
        ['pages', index, 'desiredMembers', memberIndex, 'providerPrincipalFactId'],
        'Every desired Provider member must resolve its exact current principal fact.'
      )
      if (fact !== undefined && (
        fact.userId !== member.userId ||
        fact.revision < member.snapshottedFactRevision ||
        (fact.revision === member.snapshottedFactRevision &&
          !sameProviderPrincipal(fact.providerPrincipal, member.principal)) ||
        !sameProviderInstance(intent.providerInstance, fact.providerPrincipal.providerInstance)
      )) {
        context.addIssue({
          code: 'custom',
          path: ['pages', index, 'desiredMembers', memberIndex],
          message: 'A provisioning intent desired member must preserve the exact selected User and Provider fact revision.'
        })
      }
    }
  }

  for (const [index, attestation] of provisioningAttestations.entries()) {
    const intent = intentsById.get(attestation.provisioningIntentId)
    requireCompleteReference(
      'provisioning_intents',
      intent,
      ['pages', index, 'provisioningIntentId'],
      'A provisioning attestation must resolve its exact intent.'
    )
    if (intent !== undefined && (
      attestation.provisioningRevision !== intent.provisioningRevision ||
      attestation.ownerUserId !== intent.contentOwnerUserId ||
      !sameProviderInstance(attestation.providerInstance, intent.providerInstance)
    )) {
      context.addIssue({
        code: 'custom',
        path: ['pages', index, 'provisioningIntentId'],
        message: 'A provisioning attestation must match its intent revision, content owner and Provider Instance.'
      })
    }
    if (intent !== undefined) {
      const desiredByUser = new Map(intent.desiredMembers.map((member) => [member.userId, member]))
      for (const [memberIndex, member] of attestation.memberObservations.entries()) {
        const desired = desiredByUser.get(member.userId)
        if (desired === undefined ||
            desired.providerPrincipalFactId !== member.providerPrincipalFactId ||
            desired.snapshottedFactRevision !== member.snapshottedFactRevision ||
            !sameProviderPrincipal(desired.principal, member.principal)) {
          context.addIssue({
            code: 'custom',
            path: ['pages', index, 'memberObservations', memberIndex],
            message: 'Attested member observations must match the exact desired Provider fact snapshot.'
          })
        }
      }
    }
  }

  for (const [index, binding] of contentBindings.entries()) {
    const intent = intentsById.get(binding.provisioningIntentId)
    requireCompleteReference(
      'provisioning_intents',
      intent,
      ['pages', index, 'provisioningIntentId'],
      'A Project Content Binding must resolve its exact provisioning intent.'
    )
    if (intent !== undefined && (
      binding.provisioningRevision !== intent.provisioningRevision ||
      binding.contentOwnerUserId !== intent.contentOwnerUserId ||
      !sameProviderInstance(binding.providerInstance, intent.providerInstance)
    )) {
      context.addIssue({
        code: 'custom',
        path: ['pages', index, 'provisioningIntentId'],
        message: 'A Project Content Binding must match its intent revision, content owner and Provider Instance.'
      })
    }
    if (binding.attestationId !== null) {
      const attestation = attestationsById.get(binding.attestationId)
      requireCompleteReference(
        'provisioning_attestations',
        attestation,
        ['pages', index, 'attestationId'],
        'An attested Project Content Binding must resolve the exact factual attestation.'
      )
      if (attestation !== undefined && (
        attestation.provisioningIntentId !== binding.provisioningIntentId ||
        attestation.provisioningRevision !== binding.provisioningRevision ||
        attestation.ownerUserId !== binding.contentOwnerUserId
      )) {
        context.addIssue({
          code: 'custom',
          path: ['pages', index, 'attestationId'],
          message: 'A Project Content Binding attestation must match the exact intent, revision and content owner.'
        })
      }
    }
  }

  for (const [index, entry] of externalJournal.entries()) {
    if (entry.taskId !== null) {
      requireCompleteReference(
        'tasks',
        tasksById.get(entry.taskId),
        ['pages', index, 'taskId'],
        'A Task-scoped external journal entry must resolve its exact Task.'
      )
      requireCompleteReference(
        'executions',
        entry.executionId === null ? undefined : executionsById.get(entry.executionId),
        ['pages', index, 'executionId'],
        'A Task-scoped external journal entry must resolve its exact execution.'
      )
    }
    if (entry.provisioningIntentId !== null) {
      const intent = intentsById.get(entry.provisioningIntentId)
      requireCompleteReference(
        'provisioning_intents',
        intent,
        ['pages', index, 'provisioningIntentId'],
        'A provisioning journal entry must resolve its exact intent.'
      )
      if (intent !== undefined && entry.provisioningRevision !== intent.provisioningRevision) {
        context.addIssue({
          code: 'custom',
          path: ['pages', index, 'provisioningRevision'],
          message: 'An external journal entry must retain the exact provisioning intent revision.'
        })
      }
    }
  }

  for (const [index, action] of recoveryActions.entries()) {
    const journal = journalById.get(action.journalEntryId)
    requireCompleteReference(
      'external_operation_journal',
      journal,
      ['pages', index, 'journalEntryId'],
      'A visible recovery action must resolve its exact external operation journal entry.'
    )
    if (journal !== undefined && (
      journal.projectId !== action.projectId ||
      journal.taskId !== action.taskId ||
      journal.executionId !== action.executionId
    )) {
      context.addIssue({
        code: 'custom',
        path: ['pages', index, 'journalEntryId'],
        message: 'A visible recovery action must match its journal Project, Task and execution scope.'
      })
    }
  }

  for (const [index, humanNeeded] of pendingHumanNeeded.entries()) {
    const task = tasksById.get(humanNeeded.taskId)
    const execution = executionsById.get(humanNeeded.executionId)
    requireCompleteReference(
      'tasks',
      task,
      ['pages', index, 'taskId'],
      'A pending HumanNeeded fact must resolve its exact Task.'
    )
    requireCompleteReference(
      'executions',
      execution,
      ['pages', index, 'executionId'],
      'A pending HumanNeeded fact must resolve its exact execution.'
    )
    if (humanNeeded.targetUserId !== response.project.ownerUserId) {
      context.addIssue({
        code: 'custom',
        path: ['pages', index, 'targetUserId'],
        message: 'Run-0 HumanNeeded is addressed only to the exact Project Owner User.'
      })
    }
    if (execution !== undefined && (
      execution.taskId !== humanNeeded.taskId ||
      execution.assigneeAgentId !== humanNeeded.requestedByAgentId ||
      execution.state !== 'needs_human'
    )) {
      context.addIssue({
        code: 'custom',
        path: ['pages', index, 'executionId'],
        message: 'Pending HumanNeeded must belong to the exact needs-human execution and its assignee Agent.'
      })
    }
  }

  for (const [index, plan] of plans.entries()) {
    requireCompleteReference(
      'agent_label_facts',
      agentLabelsById.get(plan.runtimeProvenance.generatedByCoordinatorAgentId),
      ['pages', index, 'runtimeProvenance', 'generatedByCoordinatorAgentId'],
      'A Project Plan must resolve the exact Coordinator Agent that generated it.'
    )
    if (plan.confirmedByUserId !== null) {
      requireCompleteReference(
        'memberships',
        membershipsByUserId.get(plan.confirmedByUserId),
        ['pages', index, 'confirmedByUserId'],
        'A confirmed Project Plan must resolve the authenticated confirming Project Member User.'
      )
    }
  }

  for (const [index, result] of resultSubmissions.entries()) {
    const task = tasksById.get(result.taskId)
    const execution = executionsById.get(result.executionId)
    requireCompleteReference(
      'tasks',
      task,
      ['pages', index, 'taskId'],
      'A Task result submission must resolve its exact Task.'
    )
    requireCompleteReference(
      'executions',
      execution,
      ['pages', index, 'executionId'],
      'A Task result submission must resolve its exact execution.'
    )
    if (execution !== undefined && (
      execution.taskId !== result.taskId ||
      execution.assigneeUserId !== result.submittedByUserId ||
      execution.assigneeAgentId !== result.submittedByAgentId ||
      execution.currentResultSubmissionId !== result.resultSubmissionId
    )) {
      context.addIssue({
        code: 'custom',
        path: ['pages', index, 'executionId'],
        message: 'A Task result must match the exact execution assignee and immutable current result reference.'
      })
    }
    for (const journalEntryId of result.recoveryJournalEntryIds) {
      requireCompleteReference(
        'external_operation_journal',
        journalById.get(journalEntryId),
        ['pages', index, 'recoveryJournalEntryIds'],
        'Every result recovery reference must resolve to an exact external journal fact.'
      )
    }
  }

  for (const [index, review] of reviewDecisions.entries()) {
    const result = resultsById.get(review.resultSubmissionId)
    const execution = executionsById.get(review.executionId)
    requireCompleteReference(
      'result_submissions',
      result,
      ['pages', index, 'resultSubmissionId'],
      'A review decision must resolve the exact immutable result submission.'
    )
    requireCompleteReference(
      'executions',
      execution,
      ['pages', index, 'executionId'],
      'A review decision must resolve the exact reviewed execution.'
    )
    if (result !== undefined && (
      result.taskId !== review.taskId ||
      result.executionId !== review.executionId ||
      result.revision !== review.reviewedResultRevision
    )) {
      context.addIssue({
        code: 'custom',
        path: ['pages', index, 'resultSubmissionId'],
        message: 'A review decision must match the exact Task, execution and result revision.'
      })
    }
    const coordinatorLabel = agentLabelsById.get(review.decidedByCoordinatorAgentId)
    requireCompleteReference(
      'agent_label_facts',
      coordinatorLabel,
      ['pages', index, 'decidedByCoordinatorAgentId'],
      'A review decision must resolve the exact Coordinator Agent label fact.'
    )
    if (coordinatorLabel !== undefined && coordinatorLabel.ownerUserId !== review.decidedByUserId) {
      context.addIssue({
        code: 'custom',
        path: ['pages', index, 'decidedByUserId'],
        message: 'Review decision User and Coordinator Agent must identify one authenticated Agent owner.'
      })
    }
    requireCompleteReference(
      'memberships',
      membershipsByUserId.get(review.decidedByUserId),
      ['pages', index, 'decidedByUserId'],
      'A review decision User must resolve to one Project Membership fact.'
    )
    if (review.acceptedProjectRecordId !== null) {
      const record = recordsById.get(review.acceptedProjectRecordId)
      requireCompleteReference(
        'project_records',
        record,
        ['pages', index, 'acceptedProjectRecordId'],
        'An accepted review must resolve its accepted Project Record.'
      )
      if (record !== undefined && (record.sourceTaskId !== review.taskId || record.status !== 'accepted')) {
        context.addIssue({
          code: 'custom',
          path: ['pages', index, 'acceptedProjectRecordId'],
          message: 'An accepted review Project Record must be accepted and sourced from the exact Task.'
        })
      }
    }
    if (review.nextExecutionId !== null) {
      const nextExecution = executionsById.get(review.nextExecutionId)
      requireCompleteReference(
        'executions',
        nextExecution,
        ['pages', index, 'nextExecutionId'],
        'A request-revision decision must resolve its newly fenced execution attempt.'
      )
      if (nextExecution !== undefined && nextExecution.taskId !== review.taskId) {
        context.addIssue({
          code: 'custom',
          path: ['pages', index, 'nextExecutionId'],
          message: 'A revision execution must belong to the exact reviewed Task.'
        })
      }
    }
  }

  for (const [index, record] of projectRecords.entries()) {
    if (record.sourceTaskId !== null) {
      requireCompleteReference(
        'tasks',
        tasksById.get(record.sourceTaskId),
        ['pages', index, 'sourceTaskId'],
        'A Task-sourced Project Record must resolve its exact Task.'
      )
    }
    requireCompleteReference(
      'memberships',
      membershipsByUserId.get(record.authorUserId),
      ['pages', index, 'authorUserId'],
      'A Project Record author must resolve to one Project Membership fact.'
    )
    if (record.authorAgentId !== null) {
      const agent = agentLabelsById.get(record.authorAgentId)
      requireCompleteReference(
        'agent_label_facts',
        agent,
        ['pages', index, 'authorAgentId'],
        'A Project Record Agent author must resolve to one exact Agent label fact.'
      )
      if (agent !== undefined && agent.ownerUserId !== record.authorUserId) {
        context.addIssue({
          code: 'custom',
          path: ['pages', index, 'authorAgentId'],
          message: 'A Project Record User and Agent author must identify one Agent owner.'
        })
      }
    }
  }

  const projectContentFactsPresent = contentReadiness.length > 0 || providerObservations.length > 0 ||
    provisioningIntents.length > 0 || provisioningAttestations.length > 0 || contentBindings.length > 0
  if (response.project.contentMode === 'none' && projectContentFactsPresent) {
    context.addIssue({
      code: 'custom',
      path: ['project', 'contentMode'],
      message: 'A content-free Project cannot expose Project-scoped provisioning, binding or readiness facts.'
    })
  }

  if (response.finalSummary !== null && response.finalSummary.projectId !== projectId) {
    context.addIssue({ code: 'custom', path: ['finalSummary'], message: 'The final summary must belong to the exact returned Project.' })
  }
  if (response.finalSummary !== null) {
    const summary = response.finalSummary
    if (response.project.status !== 'completed') {
      context.addIssue({ code: 'custom', path: ['project', 'status'], message: 'A final Project summary requires the completed Project state.' })
    }
    const plan = plansById.get(summary.projectPlanId)
    requireCompleteReference(
      'plans',
      plan,
      ['finalSummary', 'projectPlanId'],
      'The final summary must resolve its exact confirmed Project Plan.'
    )
    if (plan !== undefined && (plan.state !== 'confirmed' || plan.planRevision !== summary.confirmedPlanRevision)) {
      context.addIssue({
        code: 'custom',
        path: ['finalSummary', 'confirmedPlanRevision'],
        message: 'The final summary must name the exact confirmed Plan revision.'
      })
    }
    for (const resultSubmissionId of summary.acceptedResultSubmissionIds) {
      const result = resultsById.get(resultSubmissionId)
      requireCompleteReference(
        'result_submissions',
        result,
        ['finalSummary', 'acceptedResultSubmissionIds'],
        'Every final summary result must resolve to an immutable result submission.'
      )
      const review = reviewsByResultId.get(resultSubmissionId)
      requireCompleteReference(
        'review_decisions',
        review,
        ['finalSummary', 'acceptedResultSubmissionIds'],
        'Every final summary result must resolve to its canonical review decision.'
      )
      if (review !== undefined && review.decision !== 'accept') {
        context.addIssue({
          code: 'custom',
          path: ['finalSummary', 'acceptedResultSubmissionIds'],
          message: 'A final summary may include only explicitly accepted Task results.'
        })
      }
    }
    const finalRecord = recordsById.get(summary.projectRecordId)
    requireCompleteReference(
      'project_records',
      finalRecord,
      ['finalSummary', 'projectRecordId'],
      'The final summary must resolve its accepted summary Project Record.'
    )
    if (finalRecord !== undefined && (finalRecord.kind !== 'summary' || finalRecord.status !== 'accepted')) {
      context.addIssue({
        code: 'custom',
        path: ['finalSummary', 'projectRecordId'],
        message: 'The final summary Project Record must be an accepted summary fact.'
      })
    }
    const coordinatorAgent = agentLabelsById.get(summary.createdByCoordinatorAgentId)
    requireCompleteReference(
      'agent_label_facts',
      coordinatorAgent,
      ['finalSummary', 'createdByCoordinatorAgentId'],
      'The final summary must resolve its exact Coordinator Agent label fact.'
    )
    if (coordinatorAgent !== undefined && coordinatorAgent.ownerUserId !== summary.createdByUserId) {
      context.addIssue({
        code: 'custom',
        path: ['finalSummary', 'createdByUserId'],
        message: 'Final summary User and Coordinator Agent must identify one authenticated Agent owner.'
      })
    }
  }
})
export type RestProjectCoordinationResponse = z.infer<typeof restProjectCoordinationResponseSchema>
