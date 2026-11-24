import { randomUUID } from 'node:crypto'
import { CURRENT_PROTOCOL_VERSION, projectSchema, restRequestSchema } from '@sciforge/collaboration-contracts'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import { executeUserCloud, type ProjectCoordinatorWorkspacePort } from './ports.js'
import type { ProjectCoordinatorRequirementsDispatchPort } from './requirements-dispatch.js'
import type { ProjectCoordinatorWorkspace } from './contract.js'

/** User commands share the authenticated Cloud command path and its revision checks. */
export type HumanDirectedCommands = Readonly<{
  retryLeaderProposal(projectId: string): Promise<ProjectCoordinatorWorkspace>
  deferLeaderProposal(projectId: string, key: string): Promise<ProjectCoordinatorWorkspace>
  execute(type: 'project.rename' | 'project.execution_mode.set' | 'project.dispatch.authorize' | 'task.content.update' | 'task.content.decide', input: unknown, idempotencyKey: string, dispatch?: boolean): Promise<ProjectCoordinatorWorkspace>
}>

export function createHumanDirectedCommands(options: Readonly<{
  transport: AuthenticatedCloudTransport
  workspace: ProjectCoordinatorWorkspacePort
  onProjectChanged?(projectId: string): Promise<void>
  retryProposal?(projectId: string): Promise<void>
  deferProposal(projectId: string, key: string): Promise<void>
  dispatch: ProjectCoordinatorRequirementsDispatchPort
}>): HumanDirectedCommands {
  return {
    async retryLeaderProposal(projectId) {
      const workspace = await options.workspace.readWorkspace({ projectId })
      const identity = options.transport.status()
      const project = workspace.projects.find(entry => entry.project.projectId === projectId)
      if (identity.state !== 'ready' || workspace.connection.state !== 'ready' || identity.userId !== workspace.connection.userId || identity.deviceId !== workspace.connection.deviceId ||
          project?.project.ownerUserId !== identity.userId || project.project.executionMode !== 'ai_leader' || !['draft', 'paused', 'active'].includes(project.project.status) || !options.retryProposal) {
        throw new Error('Only the current Owner may retry AI leader planning.')
      }
      await options.retryProposal(projectId)
      return options.workspace.readWorkspace({ projectId })
    },
    async deferLeaderProposal(projectId, key) {
      const workspace = await options.workspace.readWorkspace({ projectId })
      const identity = options.transport.status()
      const project = workspace.projects.find(entry => entry.project.projectId === projectId)
      if (identity.state !== 'ready' || workspace.connection.state !== 'ready' || identity.userId !== workspace.connection.userId ||
          project?.project.ownerUserId !== identity.userId || project.project.executionMode !== 'ai_leader' || project.leaderProposal?.key !== key) {
        throw new Error('Only the current Owner may defer this exact active AI recommendation.')
      }
      await options.deferProposal(projectId, key)
      return options.workspace.readWorkspace({ projectId })
    },
    async execute(type, input, idempotencyKey, dispatch = false) {
      const command = restRequestSchema.parse({ ...(input as Record<string, unknown>), protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: `req_${randomUUID().replaceAll('-', '')}`, type, idempotencyKey })
      const response = await executeUserCloud(options.transport, command)
      if (response.type !== 'rest.entity') throw new Error(`Expected updated entity from ${type}.`)
      const projectId = 'projectId' in response.entity ? String(response.entity.projectId) : undefined
      if (!projectId) throw new Error('Updated entity has no Project identity.')
      const authorizedProject = type === 'project.dispatch.authorize' ? projectSchema.parse(response.entity) : null
      // The committed mode decides whether authorization launches the AI-led batch.
      // Manual authorization only activates; the Owner still issues each offer explicitly.
      const dispatchBatch = dispatch && authorizedProject?.executionMode === 'ai_leader'
      if (authorizedProject && !dispatchBatch) {
        const project = authorizedProject
        if (project.status === 'draft' || project.status === 'paused') {
          const workspace = await options.workspace.readWorkspace({ projectId })
          const view = workspace.projects.find(entry => entry.project.projectId === projectId)
          if (view?.memberships.some(member => member.state === 'invited')) throw new Error('请等待成员接受邀请后再派发任务。')
          await executeUserCloud(options.transport, { protocolVersion: CURRENT_PROTOCOL_VERSION,
            requestId: `req_${randomUUID().replaceAll('-', '')}`, type: 'project.transition',
            idempotencyKey: `${idempotencyKey}.activate`, projectId, expectedRevision: project.revision,
            expectedCoordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch,
            expectedExecutionAuthorityEpoch: project.executionAuthorityEpoch, status: 'active' })
        }
      }
      if (dispatchBatch) await options.dispatch.reconcileProject(projectId)
      await options.onProjectChanged?.(projectId)
      return options.workspace.readWorkspace({ projectId })
    }
  }
}
