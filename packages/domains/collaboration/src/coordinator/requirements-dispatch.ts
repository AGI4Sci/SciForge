import { createHash, randomUUID } from 'node:crypto'
import { CURRENT_PROTOCOL_VERSION, DEFAULT_TASK_OFFER_TTL_MS } from '@sciforge/collaboration-contracts'
import { canonicalTaskIdForRequirementsModule } from '@sciforge/collaboration-contracts/node'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import type { CoordinatorCloudCommandService } from '../coordinator-cloud-command.js'
import { executeUserCloud, type ProjectCoordinatorWorkspacePort } from './ports.js'

export type ProjectCoordinatorRequirementsDispatchPort = Readonly<{
  reconcileProject(projectId: string): Promise<void>
  reconcileVisibleProjects(): Promise<void>
}>

/** Only an exact, unexpired human-approved batch can create background offers.
 * Rejection, timeout and return require a new human decision; never auto-reassign.
 */
export function createProjectCoordinatorRequirementsDispatchPort(options: Readonly<{
  workspace: ProjectCoordinatorWorkspacePort
  coordinatorCloudCommands: Omit<CoordinatorCloudCommandService, 'localAgentId'>
  transport?: AuthenticatedCloudTransport
  requestId?: () => `req_${string}`
  now?: () => Date
}>): ProjectCoordinatorRequirementsDispatchPort {
  const requestId = options.requestId ?? (() => `req_${randomUUID().replaceAll('-', '')}`)
  const now = options.now ?? (() => new Date())
  const tails = new Map<string, Promise<void>>()
  const reconcile = async (projectId: string): Promise<void> => {
    for (let step = 0; step < 101; step += 1) {
      const workspace = await options.workspace.readWorkspace({ projectId })
      if (workspace.connection.state !== 'ready') return
      const view = workspace.projects.find(entry => entry.project.projectId === projectId)
      if (!view || view.project.ownerUserId !== workspace.connection.userId) return
      const project = view.project
      const grant = project.dispatchAuthorization
      const document = view.confirmedRequirements
      if (project.executionMode !== 'ai_leader' || !grant || !document ||
          grant.expiresAt <= now().toISOString() || grant.approvedByUserId !== project.ownerUserId ||
          grant.coordinatorAuthorityEpoch !== project.coordinatorAuthorityEpoch ||
          grant.executionAuthorityEpoch !== project.executionAuthorityEpoch ||
          grant.requirementsDocumentId !== document.requirementsDocumentId ||
          grant.requirementsDocumentRevision !== document.documentRevision ||
          grant.requirementsContentDigest !== document.contentDigest ||
          view.memberships.some(member => member.state === 'invited')) return
      if (project.status === 'draft' || project.status === 'paused') {
        if (!options.transport) return
        await executeUserCloud(options.transport, { protocolVersion: CURRENT_PROTOCOL_VERSION, requestId: requestId(),
          type: 'project.transition', idempotencyKey: digestKey({ projectId, revision: project.revision, approvedAt: grant.approvedAt }),
          projectId, expectedRevision: project.revision, expectedCoordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch,
          expectedExecutionAuthorityEpoch: project.executionAuthorityEpoch, status: 'active' })
        continue
      }
      if (project.status !== 'active') return
      const assignment = grant.assignments.find(candidate => {
        const module = document.workModules.find(item => item.planItemId === candidate.planItemId)
        if (!module) return false
        const taskId = canonicalTaskIdForRequirementsModule(document.requirementsDocumentId, module.planItemId)
        if (view.tasks.some(item => item.task.taskId === taskId) || view.offers.some(item => item.taskId === taskId)) return false
        return module.dependencyPlanItemIds.every(id => {
          const dependencyId = canonicalTaskIdForRequirementsModule(document.requirementsDocumentId, id)
          return view.tasks.some(item => item.task.taskId === dependencyId && item.task.status === 'completed' && item.delivery?.receipt?.disposition === 'adopted')
        })
      })
      if (!assignment) return
      const command = { protocolVersion: CURRENT_PROTOCOL_VERSION, type: 'task.offer.create' as const,
        projectId, expectedProjectRevision: project.revision, expectedCoordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch,
        expectedExecutionAuthorityEpoch: project.executionAuthorityEpoch, requirementsDocumentId: document.requirementsDocumentId,
        requirementsDocumentRevision: document.documentRevision, requirementsContentDigest: document.contentDigest,
        planItemId: assignment.planItemId, workerUserId: assignment.workerUserId,
        offerExpiresAt: new Date(Math.min(Date.parse(grant.expiresAt), now().getTime() + DEFAULT_TASK_OFFER_TTL_MS)).toISOString() }
      const response = await options.coordinatorCloudCommands.execute({ ...command, requestId: requestId(), idempotencyKey: digestKey(command) })
      if (response.type === 'rest.error') {
        if (response.error.code === 'revision_conflict') continue
        throw new Error(`Authorized dispatch failed: ${response.error.code}: ${response.error.message}`)
      }
    }
    throw new Error('Authorized dispatch exceeded its batch budget.')
  }
  const reconcileProject = (projectId: string): Promise<void> => {
    const operation = (tails.get(projectId) ?? Promise.resolve()).catch(() => undefined).then(() => reconcile(projectId))
    const tracked = operation.finally(() => { if (tails.get(projectId) === tracked) tails.delete(projectId) })
    tails.set(projectId, tracked)
    return tracked
  }
  return {
    reconcileProject,
    async reconcileVisibleProjects() {
      const workspace = await options.workspace.readWorkspace({})
      if (workspace.connection.state !== 'ready') return
      const userId = workspace.connection.userId
      await Promise.all(workspace.projects.filter(view => view.project.ownerUserId === userId && view.project.executionMode === 'ai_leader')
        .map(view => reconcileProject(view.project.projectId)))
    }
  }
}

function digestKey(value: unknown): string {
  return `idem_authorized-dispatch.${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 48)}`
}
