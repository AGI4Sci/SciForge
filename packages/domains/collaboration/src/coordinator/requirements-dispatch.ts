import { createHash, randomUUID } from 'node:crypto'

import {
  CURRENT_PROTOCOL_VERSION,
  DEFAULT_TASK_OFFER_TTL_MS,
  type TaskOffer
} from '@sciforge/collaboration-contracts'
import { canonicalTaskIdForRequirementsModule } from '@sciforge/collaboration-contracts/node'
import {
  AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
  type AuthenticatedCloudTransport
} from '@sciforge/domain-identity-access/authenticated-cloud-transport'

import type { CoordinatorCloudCommandService } from '../coordinator-cloud-command.js'

import type {
  ProjectCoordinatorProject,
  ProjectCoordinatorWorkspace
} from './contract.js'
import { executeUserCloud } from './ports.js'
import type { ProjectCoordinatorWorkspacePort } from './ports.js'
import { selectRequirementsWorker } from './worker-selection.js'

type CoordinatorCloudCommandClient = Omit<CoordinatorCloudCommandService, 'localAgentId'>

export type ProjectCoordinatorRequirementsDispatchPort = Readonly<{
  reconcileProject(projectId: string): Promise<void>
  reconcileVisibleProjects(): Promise<void>
}>

const REQUIREMENTS_OWNER_TODO_TTL_MS = 7 * 24 * 60 * 60_000
const DISPATCH_FAILURE_STATES = new Set(['rejected', 'timed_out'])

/**
 * Requirements-loop dispatch (design §9.22.2): consumes the confirmed
 * document, promotes ready modules through task.offer.create, re-dispatches
 * once to a different eligible Worker after one rejection/timeout/execution failure, and raises
 * dedup-keyed Owner todos for 待分配 and second-failure modules. All Cloud
 * writes go through the durable Coordinator Agent command service; selection
 * is the deterministic pure rule, never a model call.
 */
export function createProjectCoordinatorRequirementsDispatchPort(options: Readonly<{
  workspace: ProjectCoordinatorWorkspacePort
  coordinatorCloudCommands: CoordinatorCloudCommandClient
  transport?: AuthenticatedCloudTransport
  requestId?: () => `req_${string}`
  now?: () => Date
}>): ProjectCoordinatorRequirementsDispatchPort {
  const requestId = options.requestId ?? (() => `req_${randomUUID().replaceAll('-', '')}`)
  const now = options.now ?? (() => new Date())
  const tails = new Map<string, Promise<void>>()

  const readProject = async (projectId: string) => {
    const workspace = await options.workspace.readWorkspace({ projectId })
    if (workspace.connection.state !== 'ready') {
      throw new Error(`Project coordination is ${workspace.connection.state}.`)
    }
    const project = workspace.projects.find((candidate) => candidate.project.projectId === projectId)
    if (!project) throw new Error('The exact Project is not visible to the current OIDC User.')
    return { workspace, project }
  }

  const activateIfReady = async (project: ProjectCoordinatorProject): Promise<boolean> => {
    if (project.project.status === 'active') return true
    if (project.project.status !== 'paused' && project.project.status !== 'draft') return false
    if (!options.transport) throw new Error('OIDC Cloud transport is unavailable.')
    if (project.memberships.some(({ state }) => state === 'invited')) return false
    if (!project.confirmedRequirements) return false
    const transitioned = await executeUserCloud(options.transport, {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      requestId: requestId(),
      type: 'project.transition',
      idempotencyKey: `idem_requirements-activation.${stableDigest({
        projectId: project.project.projectId,
        requirementsDocumentId: project.confirmedRequirements.requirementsDocumentId
      }).slice(0, 48)}`,
      projectId: project.project.projectId,
      expectedRevision: project.project.revision,
      expectedCoordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch,
      expectedExecutionAuthorityEpoch: project.project.executionAuthorityEpoch,
      status: 'active'
    })
    if (transitioned.type !== 'rest.entity') {
      throw new Error(`Project activation returned ${transitioned.type}.`)
    }
    return true
  }

  const pendingOwnerTodo = (
    project: ProjectCoordinatorProject,
    requirementsDocumentId: string,
    planItemId: string,
    dedupReason: string
  ): boolean => project.pendingHumanNeeded.some((request) => (
    request.status === 'pending' &&
    request.context.scope === 'coordinator_project' &&
    request.context.requirementsDocumentId === requirementsDocumentId &&
    request.context.planItemId === planItemId &&
    request.context.dedupReason === dedupReason
  ))

  const raiseOwnerTodo = async (
    project: ProjectCoordinatorProject,
    planItemId: string,
    dedupReason: 'worker_missing' | 'dispatch_failed',
    prompt: string,
    attemptKey: string
  ): Promise<boolean> => {
    const requirementsDocumentId = project.confirmedRequirements!.requirementsDocumentId
    if (pendingOwnerTodo(project, requirementsDocumentId, planItemId, dedupReason)) return false
    try {
      const response = await options.coordinatorCloudCommands.execute({
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: requestId(),
        type: 'human.needed.create',
        idempotencyKey: `idem_requirements-dispatch.${stableDigest({
          projectId: project.project.projectId, requirementsDocumentId, planItemId, dedupReason, attemptKey
        }).slice(0, 48)}`,
        projectId: project.project.projectId,
        targetUserId: project.project.ownerUserId,
        context: {
          scope: 'coordinator_project',
          expectedProjectRevision: project.project.revision,
          expectedCoordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch,
          requirementsDocumentId,
          planItemId,
          dedupReason
        },
        requiredAssurance: 'verified',
        prompt,
        expiresAt: new Date(now().getTime() + REQUIREMENTS_OWNER_TODO_TTL_MS).toISOString()
      })
      if (response.type === 'rest.error') {
        if (isKnownIdempotencyReuse(response.error.code, response.error.message)) return false
        throw new Error(`Owner todo failed: ${response.error.code}: ${response.error.message}`)
      }
      return true
    } catch (error) {
      if (isKnownIdempotencyReuseError(error)) return false
      throw error
    }
  }

  const dependenciesUnlocked = (
    project: ProjectCoordinatorProject,
    dependencyTaskIds: readonly string[],
    tasksById: Map<string, ProjectCoordinatorProject['tasks'][number]>
  ): boolean => dependencyTaskIds.every((dependencyTaskId) => {
    const dependency = tasksById.get(dependencyTaskId)
    return dependency?.task.status === 'completed' && dependency.delivery?.receipt?.disposition === 'adopted'
  })

  const reconcileProjectFacts = async (projectId: string): Promise<void> => {
    for (let step = 0; step < 100; step += 1) {
      const { project } = await readProject(projectId)
      const document = project.confirmedRequirements
      if (!document) return
      if (!(await activateIfReady(project))) return
      const { project: active } = await readProject(projectId)
      const tasksById = new Map(active.tasks.map((taskView) => [taskView.task.taskId, taskView]))
      const offersByTaskId = new Map<string, TaskOffer[]>()
      const pendingOfferCounts = new Map<string, number>()
      const failedExecutionOffer = (offer: TaskOffer): boolean => offer.state === 'accepted' &&
        offer.executionId !== null && Boolean(tasksById.get(offer.taskId)?.executions.some((execution) => (
          execution.executionId === offer.executionId && execution.state === 'failed' &&
          execution.fence.status === 'fenced' && execution.fence.reason === 'execution_failed'
        )))
      for (const offer of active.offers) {
        offersByTaskId.set(offer.taskId, [...(offersByTaskId.get(offer.taskId) ?? []), offer])
        if (offer.state === 'pending' || (offer.state === 'accepted' && !failedExecutionOffer(offer))) {
          pendingOfferCounts.set(offer.workerUserId, (pendingOfferCounts.get(offer.workerUserId) ?? 0) + 1)
        }
      }

      // Re-dispatch: exactly one retry to a different eligible Worker after
      // one rejection/timeout; a second failure (or no alternate) becomes an
      // Owner todo, dedup-keyed per module per confirmed version.
      let acted = false
      for (const module of document.workModules) {
        const taskId = canonicalTaskIdForRequirementsModule(
          document.requirementsDocumentId, module.planItemId
        )
        const taskView = tasksById.get(taskId)
        const task = taskView?.task
        if (!task || task.status === 'completed' || task.status === 'cancelled') continue
        const offers = offersByTaskId.get(taskId) ?? []
        if (offers.some((offer) => offer.state === 'pending' || (offer.state === 'accepted' && !failedExecutionOffer(offer)))) continue
        const failures = offers.filter((offer) => (
          DISPATCH_FAILURE_STATES.has(offer.state) || failedExecutionOffer(offer)
        ))
        const latestFailure = failures.find((offer) => task.currentExecutionId !== null && offer.executionId === task.currentExecutionId) ?? failures
          .slice()
          .sort((left, right) => right.revision - left.revision)[0]
        const attemptKey = latestFailure?.taskOfferId ?? `${document.requirementsDocumentId}:${module.planItemId}`
        const withdrawn = offers
          .filter((offer) => offer.state === 'withdrawn' && offer.reassignmentTaskRevision === task.revision)
          .sort((left, right) => right.revision - left.revision)[0]
        if (failures.length === 0 && !withdrawn) continue
        const requirementsDocumentId = document.requirementsDocumentId
        if (failures.length >= 2) {
          if (!pendingOwnerTodo(active, requirementsDocumentId, module.planItemId, 'dispatch_failed')) {
            acted = await raiseOwnerTodo(active, module.planItemId, 'dispatch_failed',
              `模块 ${module.planItemId} 两次派单失败，请人工指派。`, attemptKey)
          }
          continue
        }
        // A pending dispatch_failed escalation pauses retry while the Owner decides.
        if (pendingOwnerTodo(active, requirementsDocumentId, module.planItemId, 'dispatch_failed')) continue
        const next = withdrawn && failures.length === 0 && withdrawn.workerUserId !== active.project.ownerUserId
          ? selectRequirementsWorker(
            active.workerGroups,
            active.project.ownerUserId,
            module.requiredCapabilityTags ?? [],
            active.workerGroups
              .map(({ userId }) => userId)
              .filter((userId) => userId !== withdrawn.workerUserId),
            pendingOfferCounts
          ) ?? selectRequirementsWorker(active.workerGroups, active.project.ownerUserId, module.requiredCapabilityTags ?? [], [], pendingOfferCounts)
          : selectRequirementsWorker(
            active.workerGroups,
            active.project.ownerUserId,
            module.requiredCapabilityTags ?? [],
            failures.map((offer) => offer.workerUserId),
            pendingOfferCounts
          )
        if (next === null) {
          const reason = failures.length === 0 ? 'worker_missing' : 'dispatch_failed'
          if (!pendingOwnerTodo(active, requirementsDocumentId, module.planItemId, reason)) {
            acted = await raiseOwnerTodo(active, module.planItemId, reason,
              failures.length === 0
                ? `模块 ${module.planItemId} 没有合格 Worker，待分配。`
                : `模块 ${module.planItemId} 派单失败且没有其他合格 Worker，请人工处理。`, attemptKey)
          }
          continue
        }
        if (task.status !== 'revision_requested') continue
        const previous = withdrawn ?? offers
          .filter((offer) => offer.reassignmentTaskRevision === task.revision ||
            (offer.executionId === task.currentExecutionId && failedExecutionOffer(offer)))
          .sort((left, right) => right.revision - left.revision)[0]
        if (!previous) continue
        const commandBody = {
          protocolVersion: CURRENT_PROTOCOL_VERSION,
          type: 'task.offer.reassign' as const,
          expectedProjectRevision: active.project.revision,
          expectedCoordinatorAuthorityEpoch: active.project.coordinatorAuthorityEpoch,
          expectedExecutionAuthorityEpoch: active.project.executionAuthorityEpoch,
          taskId: task.taskId,
          expectedTaskRevision: task.revision,
          previousTaskOfferId: previous.taskOfferId,
          expectedPreviousOfferRevision: previous.revision,
          workerUserId: next,
          nextFileIntent: task.fileIntent,
          offerExpiresAt: new Date(now().getTime() + DEFAULT_TASK_OFFER_TTL_MS).toISOString()
        }
        const response = await options.coordinatorCloudCommands.execute({
          ...commandBody,
          requestId: requestId(),
          idempotencyKey: requirementsAttemptIdempotencyKey('redispatch', commandBody)
        })
        if (response.type === 'rest.error') {
          // A rejected re-dispatch must not block the single Inbox cursor.
          // Revision conflicts are transient: re-read and retry. Retryable
          // Cloud failures keep the message un-ACKed so the Inbox retries with
          // fresh facts. Every other rejection is a durable Cloud decision.
          if (response.error.code === 'revision_conflict') {
            acted = true
            break
          }
          if (response.error.retryable) {
            throw new Error(`Module re-dispatch failed: ${response.error.code}: ${response.error.message}`)
          }
          acted = await raiseOwnerTodo(
            active,
            module.planItemId,
            'dispatch_failed',
            `模块 ${module.planItemId} 派单被云端拒绝（${response.error.code}），请人工处理。`,
            attemptKey
          )
          continue
        }
        pendingOfferCounts.set(next, (pendingOfferCounts.get(next) ?? 0) + 1)
        acted = true
        break
      }
      if (acted) continue

      // First dispatch: promote every ready un-promoted module.
      for (const module of document.workModules) {
        const taskId = canonicalTaskIdForRequirementsModule(
          document.requirementsDocumentId, module.planItemId
        )
        if (tasksById.has(taskId)) continue
        // A pending dispatch_failed escalation pauses retry while the Owner
        // decides, exactly like the re-dispatch path above.
        if (pendingOwnerTodo(
          active, document.requirementsDocumentId, module.planItemId, 'dispatch_failed'
        )) continue
        const dependencyTaskIds = module.dependencyPlanItemIds.map((planItemId) => (
          canonicalTaskIdForRequirementsModule(document.requirementsDocumentId, planItemId)
        ))
        if (!dependenciesUnlocked(active, dependencyTaskIds, tasksById)) continue
        const worker = selectRequirementsWorker(
          active.workerGroups, active.project.ownerUserId, module.requiredCapabilityTags ?? [], [], pendingOfferCounts
        )
        if (worker === null) {
          if (!pendingOwnerTodo(
            active, document.requirementsDocumentId, module.planItemId, 'worker_missing'
          )) {
            acted = await raiseOwnerTodo(active, module.planItemId, 'worker_missing',
              `模块 ${module.planItemId} 没有合格 Worker，待分配。`,
              `${document.requirementsDocumentId}:${module.planItemId}`)
          }
          continue
        }
        const commandBody = {
          protocolVersion: CURRENT_PROTOCOL_VERSION,
          type: 'task.offer.create' as const,
          projectId: active.project.projectId,
          expectedProjectRevision: active.project.revision,
          expectedCoordinatorAuthorityEpoch: active.project.coordinatorAuthorityEpoch,
          expectedExecutionAuthorityEpoch: active.project.executionAuthorityEpoch,
          requirementsDocumentId: document.requirementsDocumentId,
          requirementsDocumentRevision: document.documentRevision,
          requirementsContentDigest: document.contentDigest,
          planItemId: module.planItemId,
          workerUserId: worker,
          offerExpiresAt: new Date(now().getTime() + DEFAULT_TASK_OFFER_TTL_MS).toISOString()
        }
        const response = await options.coordinatorCloudCommands.execute({
          ...commandBody,
          requestId: requestId(),
          idempotencyKey: requirementsAttemptIdempotencyKey('dispatch', commandBody)
        })
        if (response.type === 'rest.error') {
          // First dispatch follows the same rejection policy as re-dispatch so
          // one durable Cloud rejection cannot jam every later Inbox message.
          if (response.error.code === 'revision_conflict') {
            acted = true
            break
          }
          if (response.error.retryable) {
            throw new Error(`Module promotion failed: ${response.error.code}: ${response.error.message}`)
          }
          acted = await raiseOwnerTodo(
            active,
            module.planItemId,
            'dispatch_failed',
            `模块 ${module.planItemId} 派单被云端拒绝（${response.error.code}），请人工处理。`,
            `${document.requirementsDocumentId}:${module.planItemId}`
          )
          continue
        }
        pendingOfferCounts.set(worker, (pendingOfferCounts.get(worker) ?? 0) + 1)
        acted = true
        break
      }
      if (!acted) return
    }
    throw new Error('Requirements dispatch did not converge within the step budget.')
  }

  const reconcileProject = (projectId: string): Promise<void> => {
    const previous = tails.get(projectId)
    const run = (previous ?? Promise.resolve(undefined))
      .catch(() => undefined)
      .then(() => reconcileProjectFacts(projectId))
    let tracked!: Promise<void>
    tracked = run.finally(() => {
      if (tails.get(projectId) === tracked) tails.delete(projectId)
    })
    tails.set(projectId, tracked)
    return tracked
  }

  return Object.freeze({
    reconcileProject,
    reconcileVisibleProjects: async () => {
      const workspace: ProjectCoordinatorWorkspace = await options.workspace.readWorkspace({})
      if (workspace.connection.state !== 'ready') return
      const currentUserId = workspace.connection.userId
      const projectIds = workspace.projects
        .filter(({ project, confirmedRequirements }) => (
          confirmedRequirements !== null &&
          project.ownerUserId === currentUserId &&
          project.status !== 'completed' &&
          project.status !== 'cancelled'
        ))
        .map(({ project }) => project.projectId)
      await Promise.all(projectIds.map(reconcileProject))
    }
  })
}

/**
 * One dispatch attempt is exactly the command body the durable outbox freezes:
 * the CAS baseline (expected Project/Task/Offer revisions) and the concrete
 * Offer window. Including both in the key means a fresh fact baseline (for
 * example after a revision_conflict) or a fresh retry round is a new outbox
 * identity, while a delivery retry of this same attempt keeps one key and one
 * body. Reusing the old key after the facts moved would either be rejected
 * locally as an idempotency conflict or replay a cached Cloud rejection.
 */
function requirementsAttemptIdempotencyKey(
  kind: 'dispatch' | 'redispatch',
  commandBody: Readonly<Record<string, unknown>>
): string {
  return `idem_requirements-${kind}.${stableDigest(commandBody).slice(0, 48)}`
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

function isKnownIdempotencyReuse(code: string, message: string): boolean {
  return code === 'idempotency_conflict' &&
    message === 'The idempotency key was already used for a different request.'
}

function isKnownIdempotencyReuseError(error: unknown): boolean {
  return error instanceof Error && (
    error.message === 'Outbox idempotency key was reused for a different command.' ||
    error.message === 'The idempotency key was already used for a different request.'
  )
}
