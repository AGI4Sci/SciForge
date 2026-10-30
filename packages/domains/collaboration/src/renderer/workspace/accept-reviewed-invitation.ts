import type { ProjectCoordinatorProject, ProjectCoordinatorWorkspace } from '../../coordinator/contract.js'
import type { ProjectCoordinatorRendererClient } from '../../coordinator/renderer/project-coordinator-capability-client.js'

const updatedMessage = '项目已更新，请查看后再接受'

function isRevisionConflict(cause: unknown): boolean {
  return cause instanceof Error && (
    cause.message.includes('Project invitation acceptance lost the exact current Project revision.') ||
    cause.message.includes('SciForge Cloud request failed: revision_conflict:')
  )
}

function explainInvitationChange(cause: unknown): unknown {
  if (!(cause instanceof Error)) return cause
  if (cause.message.includes('Only the exact invited OIDC User may accept this Project invitation.') ||
    cause.message.includes('Only an invited Project Membership may be accepted.')) {
    return new Error(`${updatedMessage}：本人的邀请记录或当前账户已变化。`)
  }
  if (cause.message.includes('Requirements are not confirmed yet.')) {
    return new Error(`${updatedMessage}：正式需求尚未确认。`)
  }
  if (cause.message.includes('A terminal Project invitation cannot be accepted.') ||
    cause.message.includes('Project is not visible to the current User.')) {
    return new Error(`${updatedMessage}：项目已结束或当前账户已无访问权限。`)
  }
  return cause
}

/** Keep the reviewed facts across one definite rejection; never retry an uncertain write. */
export async function acceptReviewedInvitation(options: Readonly<{
  client: Pick<ProjectCoordinatorRendererClient, 'acceptInvitation' | 'readWorkspace'>
  project: ProjectCoordinatorProject
  membershipId: string
  userId: string
}>): Promise<ProjectCoordinatorWorkspace> {
  const reviewed = structuredClone({
    project: options.project.project,
    confirmedRequirements: options.project.confirmedRequirements,
    membership: options.project.memberships.find((entry) => entry.projectMembershipId === options.membershipId)
  })
  const membership = reviewed.membership
  if (!membership || membership.userId !== options.userId || membership.state !== 'invited') {
    throw new Error(`${updatedMessage}：邀请或当前账户已变化。`)
  }
  const input = {
    projectId: reviewed.project.projectId,
    projectMembershipId: membership.projectMembershipId,
    expectedProjectRevision: reviewed.project.revision,
    expectedMembershipRevision: membership.revision
  }
  try {
    return await options.client.acceptInvitation(input)
  } catch (cause) {
    if (!isRevisionConflict(cause)) throw explainInvitationChange(cause)
  }

  const workspace = await options.client.readWorkspace({ projectId: input.projectId })
  if (workspace.connection.state !== 'ready' || workspace.connection.userId !== options.userId) {
    throw new Error(`${updatedMessage}：当前账户已变化。`)
  }
  const current = workspace.projects.find((entry) => entry.project.projectId === input.projectId)
  const invitation = current?.memberships.find((entry) => entry.projectMembershipId === membership.projectMembershipId)
  if (!invitation || invitation.userId !== options.userId || invitation.state !== 'invited' ||
    invitation.revision !== membership.revision) {
    throw new Error(`${updatedMessage}：本人的邀请记录已变化。`)
  }
  const requirements = reviewed.confirmedRequirements
  const latestRequirements = current?.confirmedRequirements
  if (!requirements || !latestRequirements || latestRequirements.requirementsDocumentId !== requirements.requirementsDocumentId ||
    latestRequirements.revision !== requirements.revision || latestRequirements.documentRevision !== requirements.documentRevision ||
    latestRequirements.contentDigest !== requirements.contentDigest) {
    throw new Error(`${updatedMessage}：正式需求版本或摘要已变化。`)
  }
  // Canonical Project objects have schema-ordered keys. A revision/timestamp
  // change alone is immaterial; all other Project fields must match.
  const projectFacts = (project: ProjectCoordinatorProject['project']) => JSON.stringify({
    ...project, revision: 0, updatedAt: ''
  })
  if (!current || current.project.revision <= reviewed.project.revision ||
    ['completed', 'cancelled'].includes(current.project.status) ||
    projectFacts(current.project) !== projectFacts(reviewed.project)) {
    throw new Error(`${updatedMessage}：项目状态、权限或其他项目信息已变化。`)
  }
  try {
    return await options.client.acceptInvitation({ ...input, expectedProjectRevision: current.project.revision })
  } catch (cause) {
    if (isRevisionConflict(cause)) throw new Error(`${updatedMessage}：重提期间项目再次变化。`)
    throw explainInvitationChange(cause)
  }
}
