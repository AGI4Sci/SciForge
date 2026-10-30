import { CURRENT_PROTOCOL_VERSION, projectMembershipSchema } from '@sciforge/collaboration-contracts'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import { randomUUID } from 'node:crypto'
import {
  projectCoordinatorMembershipAcceptInputSchema,
  projectCoordinatorMembershipAddInputSchema,
  projectCoordinatorMembershipRemoveInputSchema,
  projectCoordinatorWorkspaceSchema,
  type ProjectCoordinatorMembershipAcceptInput,
  type ProjectCoordinatorMembershipAddInput,
  type ProjectCoordinatorMembershipRemoveInput,
  type ProjectCoordinatorWorkspace
} from './contract.js'
import type { ProjectCoordinatorWorkspacePort } from './ports.js'
import { executeUserCloud } from './ports.js'

export type ProjectCoordinatorMembershipPort = Readonly<{
  addMember(input: ProjectCoordinatorMembershipAddInput, idempotencyKey: string): Promise<ProjectCoordinatorWorkspace>
  acceptInvitation(input: ProjectCoordinatorMembershipAcceptInput, idempotencyKey: string): Promise<ProjectCoordinatorWorkspace>
  removeMember(input: ProjectCoordinatorMembershipRemoveInput, idempotencyKey: string): Promise<ProjectCoordinatorWorkspace>
}>

export function createProjectCoordinatorMembershipPort(options: Readonly<{
  workspace: ProjectCoordinatorWorkspacePort
  transport: AuthenticatedCloudTransport
  requestId?: () => `req_${string}`
}>): ProjectCoordinatorMembershipPort {
  const requestId = options.requestId ?? (() => `req_${randomUUID().replaceAll('-', '')}`)
  const readVisibleProject = async (projectId: string) => {
    const workspace = projectCoordinatorWorkspaceSchema.parse(await options.workspace.readWorkspace({ projectId }))
    if (workspace.connection.state !== 'ready') throw new Error('Project membership requires an authenticated User.')
    const project = workspace.projects.find((view) => view.project.projectId === projectId)
    if (!project) throw new Error('Project is not visible to the current User.')
    return { project, currentUserId: workspace.connection.userId }
  }
  const readOwnerProject = async (projectId: string) => {
    const { project, currentUserId } = await readVisibleProject(projectId)
    if (project.project.ownerUserId !== currentUserId) throw new Error('Only the Project Owner may manage this membership.')
    return project
  }
  return Object.freeze({
    addMember: async (rawInput, baseIdempotencyKey) => {
      const input = projectCoordinatorMembershipAddInputSchema.parse(rawInput)
      const project = await readOwnerProject(input.projectId)
      if (project.project.revision !== input.expectedProjectRevision) {
        throw new Error('Project changed before the member add confirmation.')
      }
      const response = await executeUserCloud(options.transport, {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: requestId(),
        type: 'project.membership.add',
        idempotencyKey: scopedIdempotencyKey(baseIdempotencyKey, 'membership-add'),
        ...input
      })
      const membership = response.type === 'rest.collection'
        ? response.items.map((item) => projectMembershipSchema.safeParse(item))
          .find((parsed) => parsed.success && parsed.data.userId === input.userId)?.data
        : undefined
      if (!membership || membership.projectId !== input.projectId ||
        membership.state !== 'invited') {
        throw new Error('Project member add did not create the canonical OIDC User invitation.')
      }
      return options.workspace.readWorkspace({ projectId: input.projectId })
    },
    acceptInvitation: async (rawInput, baseIdempotencyKey) => {
      const input = projectCoordinatorMembershipAcceptInputSchema.parse(rawInput)
      const { project, currentUserId } = await readVisibleProject(input.projectId)
      const invitation = project.memberships.find(({ projectMembershipId }) => (
        projectMembershipId === input.projectMembershipId
      ))
      if (!invitation || invitation.userId !== currentUserId || invitation.state !== 'invited') {
        throw new Error('Only the exact invited OIDC User may accept this Project invitation.')
      }
      if (project.project.revision !== input.expectedProjectRevision) {
        throw new Error('Project invitation acceptance lost the exact current Project revision.')
      }
      if (!project.confirmedRequirements) {
        throw new Error('Requirements are not confirmed yet.')
      }
      const response = await executeUserCloud(options.transport, {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: requestId(),
        type: 'project.membership.accept',
        idempotencyKey: scopedIdempotencyKey(baseIdempotencyKey, 'membership-accept'),
        ...input
      })
      const membership = response.type === 'rest.collection'
        ? response.items.map((item) => projectMembershipSchema.safeParse(item))
          .find((parsed) => parsed.success && (
            parsed.data.projectMembershipId === input.projectMembershipId
          ))?.data
        : undefined
      const expectedState = 'active'
      if (!membership || membership.userId !== currentUserId || membership.state !== expectedState) {
        throw new Error('Cloud did not return the accepted Project Membership state.')
      }
      return options.workspace.readWorkspace({ projectId: input.projectId })
    },
    removeMember: async (rawInput, baseIdempotencyKey) => {
      const input = projectCoordinatorMembershipRemoveInputSchema.parse(rawInput)
      const project = await readOwnerProject(input.projectId)
      if (project.project.revision !== input.expectedProjectRevision) {
        throw new Error('Project changed before the member removal confirmation.')
      }
      const response = await executeUserCloud(options.transport, {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        requestId: requestId(),
        type: 'project.membership.remove',
        idempotencyKey: scopedIdempotencyKey(baseIdempotencyKey, 'membership-remove'),
        ...input
      })
      const membership = response.type === 'rest.collection'
        ? response.items.map((item) => projectMembershipSchema.safeParse(item))
          .find((parsed) => parsed.success && (
            parsed.data.projectMembershipId === input.projectMembershipId
          ))?.data
        : undefined
      const expectedState = 'removed'
      if (!membership || membership.projectId !== input.projectId ||
        membership.state !== expectedState) {
        throw new Error('Cloud did not remove the exact Project Membership.')
      }
      return options.workspace.readWorkspace({ projectId: input.projectId })
    }
  })
}

function scopedIdempotencyKey(base: string, operation: string): string {
  const key = `${base}.${operation}`
  if (key.length > 128) throw new Error('Membership idempotency key is too long.')
  return key
}
