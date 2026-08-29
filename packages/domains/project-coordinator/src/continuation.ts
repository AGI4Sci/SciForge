import { createHash, randomUUID } from 'node:crypto'

import {
  CURRENT_PROTOCOL_VERSION,
  DEFAULT_TASK_OFFER_TTL_MS,
  type Project,
  type ProjectPlan,
  type ProjectPlanTask,
  type RestRequest,
  type RestResponse,
  type Task,
  type TaskFileDeclaration,
  type TaskFileIntent,
  type TaskOffer
} from '@sciforge/collaboration-contracts'
import { canonicalTaskIdForPlanItem } from '@sciforge/collaboration-contracts/node'
import type {
  CoordinatorCloudCommandService
} from '@sciforge/domain-collaboration/coordinator-cloud-command'

import type {
  ProjectCoordinatorProject,
  ProjectCoordinatorWorkspace
} from './contract.js'
import type { ProjectCoordinatorWorkspacePort } from './ports.js'

export type ProjectContinuationFacts = Readonly<{
  projectStatus: Project['status']
  plan: Pick<ProjectPlan, 'projectPlanId' | 'state' | 'tasks'> | null
  tasks: readonly Pick<Task, 'taskId' | 'status'>[]
}>

export type ProjectCoordinatorContinuationPort = Readonly<{
  reconcileProject(projectId: string): Promise<ProjectCoordinatorWorkspace>
  reconcileVisibleProjects(): Promise<void>
}>

const MAX_EXPIRED_OFFER_RENEWALS_PER_PLAN_ITEM = 3

/**
 * Pure ready-set derivation. Cloud remains authoritative for every write and
 * revalidates dependencies, authority, eligibility, budget, and revisions.
 */
export function deriveReadyPlanItems(
  facts: ProjectContinuationFacts
): readonly ProjectPlanTask[] {
  if (facts.projectStatus !== 'active' || facts.plan?.state !== 'confirmed') return []
  const taskById = new Map(facts.tasks.map((task) => [task.taskId, task]))
  return facts.plan.tasks.filter((item) => {
    const taskId = canonicalTaskIdForPlanItem(facts.plan!.projectPlanId, item.planItemId)
    if (taskById.has(taskId)) return false
    return item.dependencyPlanItemIds.every((dependencyPlanItemId) => (
      taskById.get(canonicalTaskIdForPlanItem(
        facts.plan!.projectPlanId,
        dependencyPlanItemId
      ))?.status === 'completed'
    ))
  })
}

export function createProjectCoordinatorContinuationPort(options: Readonly<{
  workspace: ProjectCoordinatorWorkspacePort
  coordinatorCloudCommands: CoordinatorCloudCommandService
  requestId?: () => `req_${string}`
  now?: () => Date
}>): ProjectCoordinatorContinuationPort {
  const requestId = options.requestId ?? (() => `req_${randomUUID().replaceAll('-', '')}`)
  const now = options.now ?? (() => new Date())
  const tails = new Map<string, Promise<ProjectCoordinatorWorkspace>>()

  const reconcileProjectFacts = async (
    projectId: string
  ): Promise<ProjectCoordinatorWorkspace> => {
    let workspace = await options.workspace.readWorkspace({ projectId })
    let renewalTaskId: string | null = null
    let expiredOfferRenewals = 0
    for (let dispatched = 0; ; dispatched += 1) {
      const project = findOwnedProject(workspace, projectId)
      if (!project || project.project.status !== 'active' || project.plan?.plan.state !== 'confirmed') {
        return workspace
      }
      const plan = project.plan.plan
      const ready = deriveReadyPlanItems({
        projectStatus: project.project.status,
        plan,
        tasks: project.tasks.map(({ task }) => task)
      })
      const item = ready[0]
      if (!item) return workspace
      if (dispatched >= 1_000) {
        throw new Error('Project continuation exceeded the maximum Plan size without converging.')
      }
      const createdTaskId = canonicalTaskIdForPlanItem(plan.projectPlanId, item.planItemId)
      if (renewalTaskId !== createdTaskId) {
        renewalTaskId = createdTaskId
        expiredOfferRenewals = 0
      }
      const offerExpiresAt = new Date(now().getTime() + DEFAULT_TASK_OFFER_TTL_MS).toISOString()
      const commandBody: TaskOfferCreateBusinessBody = {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        type: 'task.offer.create',
        projectId: project.project.projectId,
        expectedProjectRevision: project.project.revision,
        expectedCoordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch,
        expectedExecutionAuthorityEpoch: project.project.executionAuthorityEpoch,
        projectPlanId: plan.projectPlanId,
        expectedPlanRevision: plan.revision,
        planItemId: item.planItemId,
        offerExpiresAt
      }
      const response = await options.coordinatorCloudCommands.execute({
        ...commandBody,
        requestId: requestId(),
        idempotencyKey: continuationIdempotencyKey(commandBody)
      })
      if (isExpiredTaskOfferAttempt(response)) {
        if (expiredOfferRenewals >= MAX_EXPIRED_OFFER_RENEWALS_PER_PLAN_ITEM) {
          assertCreatedTaskOffer(response, project, plan, item, item.workerUserId, offerExpiresAt)
        }
        expiredOfferRenewals += 1
        continue
      }
      assertCreatedTaskOffer(response, project, plan, item, item.workerUserId, offerExpiresAt)
      workspace = await options.workspace.readWorkspace({ projectId })
      const observedProject = findOwnedProject(workspace, projectId)
      if (!observedProject?.tasks.some(({ task }) => task.taskId === createdTaskId)) {
        throw new Error('Project continuation Task offer was not observed in fresh Cloud facts.')
      }
    }
  }

  const reconcileProject = (projectId: string): Promise<ProjectCoordinatorWorkspace> => {
    const previous = tails.get(projectId)
    const run = (previous ?? Promise.resolve(undefined))
      .catch(() => undefined)
      .then(() => reconcileProjectFacts(projectId))
    let tracked!: Promise<ProjectCoordinatorWorkspace>
    tracked = run.finally(() => {
      if (tails.get(projectId) === tracked) tails.delete(projectId)
    })
    tails.set(projectId, tracked)
    return tracked
  }

  return Object.freeze({
    reconcileProject,
    reconcileVisibleProjects: async () => {
      const workspace = await options.workspace.readWorkspace({})
      if (workspace.connection.state !== 'ready') return
      const currentUserId = workspace.connection.userId
      const projectIds = workspace.projects
        .filter(({ project }) => (
          project.ownerUserId === currentUserId &&
          project.status !== 'completed' &&
          project.status !== 'cancelled'
        ))
        .map(({ project }) => project.projectId)
      await Promise.all(projectIds.map(reconcileProject))
    }
  })
}

function isExpiredTaskOfferAttempt(
  response: RestResponse
): boolean {
  return response.type === 'rest.error' &&
    response.error.code === 'expired'
}

function findOwnedProject(
  workspace: ProjectCoordinatorWorkspace,
  projectId: string
): ProjectCoordinatorProject | null {
  if (workspace.connection.state !== 'ready') return null
  const project = workspace.projects.find(({ project }) => project.projectId === projectId)
  if (!project || project.project.ownerUserId !== workspace.connection.userId) return null
  return project
}

function assertCreatedTaskOffer(
  response: RestResponse,
  project: ProjectCoordinatorProject,
  plan: ProjectPlan,
  item: ProjectPlanTask,
  workerUserId: string,
  offerExpiresAt: string
): void {
  if (response.type === 'rest.error') {
    throw new Error(`Project continuation Task offer failed: ${response.error.code}: ${response.error.message}`)
  }
  if (response.type !== 'rest.collection') {
    throw new Error(`Project continuation Task offer returned ${response.type}.`)
  }
  const tasks = response.items.filter((entity): entity is Task => entity.type === 'task')
  const offers = response.items.filter((entity): entity is TaskOffer => entity.type === 'task_offer')
  const task = tasks[0]
  const offer = offers[0]
  const expectedTaskId = canonicalTaskIdForPlanItem(plan.projectPlanId, item.planItemId)
  const expectedDependencyTaskIds = item.dependencyPlanItemIds.map((planItemId) => (
    canonicalTaskIdForPlanItem(plan.projectPlanId, planItemId)
  ))
  const fileIntentMatches = item.fileIntent === null
    ? task?.fileIntent === null
    : task?.fileIntent !== null && task?.fileIntent !== undefined &&
      project.provisioning.binding?.status === 'active' &&
      matchesCreatedFileIntent(item.fileIntent, task.fileIntent, project.provisioning.binding.revision)
  if (
    response.items.length !== 2 ||
    tasks.length !== 1 ||
    offers.length !== 1 ||
    !task ||
    !offer ||
    task.taskId !== expectedTaskId ||
    task.projectId !== project.project.projectId ||
    task.createdByCoordinatorAgentId !== project.project.coordinatorAgentId ||
    task.title !== item.title ||
    task.objective !== item.objective ||
    stableDigest(task.completionCriteria) !== stableDigest(item.completionCriteria) ||
    stableDigest(task.dependencyTaskIds) !== stableDigest(expectedDependencyTaskIds) ||
    stableDigest(task.requiredCapabilityTags) !== stableDigest(item.requiredCapabilityTags) ||
    !fileIntentMatches ||
    task.currentExecutionId !== null ||
    task.currentExecutionState !== null ||
    task.status !== 'offered' ||
    offer.projectId !== task.projectId ||
    offer.taskId !== task.taskId ||
    offer.executionId !== null ||
    offer.workerUserId !== workerUserId ||
    offer.state !== 'pending' ||
    offer.expiresAt !== offerExpiresAt
  ) {
    throw new Error('Project continuation did not return the exact selected Plan Task offer.')
  }
}

function matchesCreatedFileIntent(
  declaration: TaskFileDeclaration,
  intent: TaskFileIntent,
  currentBindingRevision: number
): boolean {
  if (
    intent.bindingRevision !== currentBindingRevision ||
    intent.inputs.length !== declaration.inputs.length + declaration.dependencyInputs.length ||
    stableDigest(intent.inputs.slice(0, declaration.inputs.length)) !== stableDigest(declaration.inputs) ||
    stableDigest(intent.output) !== stableDigest(declaration.output)
  ) {
    return false
  }
  const dependencyInputs = intent.inputs.slice(declaration.inputs.length)
  return dependencyInputs.every((input, index) => (
    input.destinationName === declaration.dependencyInputs[index]?.destinationName
  ))
}

type TaskOfferCreateBusinessBody = Omit<
  Extract<RestRequest, { type: 'task.offer.create' }>,
  'requestId' | 'idempotencyKey'
>

function continuationIdempotencyKey(commandBody: TaskOfferCreateBusinessBody): string {
  const digest = stableDigest(commandBody)
  return `idem_project-continuation.${digest.slice(0, 48)}`
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
