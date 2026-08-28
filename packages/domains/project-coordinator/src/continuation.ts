import { createHash, randomUUID } from 'node:crypto'

import {
  bindTaskFileDeclaration,
  CURRENT_PROTOCOL_VERSION,
  type Project,
  type ProjectPlan,
  type ProjectPlanTask,
  type RestResponse,
  type Task,
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
      const assignments = project.plan.assignments
      const planItemIds = new Set(plan.tasks.map(({ planItemId }) => planItemId))
      if (
        assignments.length !== plan.tasks.length ||
        new Set(assignments.map(({ planItemId }) => planItemId)).size !== plan.tasks.length ||
        assignments.some(({ planItemId }) => !planItemIds.has(planItemId))
      ) {
        throw new Error('Confirmed Plan continuation requires every durable Worker User assignment.')
      }
      const assignment = assignments.find(({ planItemId }) => planItemId === item.planItemId)
      if (!assignment?.workerUserId) {
        throw new Error(`Plan item ${item.planItemId} has no durable Worker User assignment.`)
      }
      const offerExpiresAt = new Date(now().getTime() + 15 * 60_000).toISOString()
      const response = await options.coordinatorCloudCommands.execute({
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: requestId(),
        type: 'task.offer.create',
        idempotencyKey: continuationIdempotencyKey(project.project, plan, item),
        projectId: project.project.projectId,
        expectedProjectRevision: project.project.revision,
        expectedCoordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch,
        expectedExecutionAuthorityEpoch: project.project.executionAuthorityEpoch,
        projectPlanId: plan.projectPlanId,
        expectedPlanRevision: plan.revision,
        planItemId: item.planItemId,
        workerUserId: assignment.workerUserId,
        offerExpiresAt
      })
      assertCreatedTaskOffer(response, project, plan, item, assignment.workerUserId, offerExpiresAt)
      workspace = await options.workspace.readWorkspace({ projectId })
      const createdTaskId = canonicalTaskIdForPlanItem(plan.projectPlanId, item.planItemId)
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
  const expectedFileIntent = item.fileIntent === null
    ? null
    : project.provisioning.binding?.status === 'active'
      ? bindTaskFileDeclaration(item.fileIntent, project.provisioning.binding.revision)
      : undefined
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
    expectedFileIntent === undefined ||
    stableDigest(task.fileIntent) !== stableDigest(expectedFileIntent) ||
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

function continuationIdempotencyKey(
  project: Project,
  plan: ProjectPlan,
  item: ProjectPlanTask
): string {
  const digest = stableDigest({
    projectId: project.projectId,
    projectPlanId: plan.projectPlanId,
    planDigest: plan.planDigest,
    planItemId: item.planItemId
  })
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
