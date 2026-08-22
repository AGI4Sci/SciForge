import {
  agentNodeSchema,
  humanAnswerSchema,
  humanEndpointBindingSchema,
  humanNeededSchema,
  managedProviderContainerSchema,
  inboxMessageSchema,
  participantProfileSchema,
  projectInputSchema,
  projectEndpointBindingSchema,
  projectRecordSchema,
  projectSchema,
  remoteSessionProjectionSchema,
  taskSchema,
  userPrincipalSchema,
  type AgentNode,
  type HumanAnswer,
  type HumanEndpointBinding,
  type HumanNeeded,
  type ManagedProviderContainer,
  type InboxMessage,
  type ParticipantProfile,
  type Project,
  type ProjectInput,
  type ProjectEndpointBinding,
  type ProjectRecord,
  type RemoteSessionProjection,
  type Task,
  type UserPrincipal
} from '@sciforge/collaboration-contracts'

import { stableDigest } from './crypto.js'
import type {
  StoredAgent,
  StoredEndpoint,
  StoredHumanAnswer,
  StoredHumanRequest,
  StoredManagedContainer,
  StoredInboxMessage,
  StoredParticipant,
  StoredProject,
  StoredProjectEndpointBinding,
  StoredProjectInput,
  StoredProjectMember,
  StoredProjectRecord,
  StoredProjection,
  StoredTask,
  StoredUser
} from './model.js'

export function toUserPrincipal(user: StoredUser): UserPrincipal {
  return userPrincipalSchema.parse({ schemaVersion: 1, type: 'user_principal', userId: user.userId,
    displayName: user.displayName, status: user.status, revision: user.revision,
    createdAt: user.createdAt, updatedAt: user.updatedAt })
}

export function toEndpoint(endpoint: StoredEndpoint): HumanEndpointBinding {
  return humanEndpointBindingSchema.parse({ schemaVersion: 1, type: 'human_endpoint_binding',
    humanEndpointId: endpoint.humanEndpointId, userId: endpoint.userId,
    identity: { type: 'provider_identity', provider: endpoint.provider, realmId: endpoint.realmId,
      providerUserId: endpoint.providerUserId, ...(endpoint.displayName ? { displayName: endpoint.displayName } : {}) },
    displayName: endpoint.displayName ?? endpoint.providerUserId, assurance: endpoint.assurance,
    status: endpoint.status, verifiedAt: endpoint.verifiedAt, ...(endpoint.revokedAt ? { revokedAt: endpoint.revokedAt } : {}),
    revision: endpoint.revision, createdAt: endpoint.verifiedAt, updatedAt: endpoint.updatedAt })
}

export function toAgent(agent: StoredAgent): AgentNode {
  return agentNodeSchema.parse({ schemaVersion: 1, type: 'agent_node', agentId: agent.agentId,
    ownerUserId: agent.ownerUserId, installationId: agent.installationId, displayName: agent.displayName,
    nodeType: agent.nodeType, capabilities: agent.capabilities,
    lifecycleStatus: agent.status === 'revoked' ? 'revoked' : 'active', connectionStatus: agent.connectionStatus,
    credentialVersion: agent.credentialGeneration, ...(agent.lastSeenAt ? { lastSeenAt: agent.lastSeenAt } : {}),
    ...(agent.revokedAt ? { revokedAt: agent.revokedAt } : {}), revision: agent.revision,
    createdAt: agent.updatedAt, updatedAt: agent.updatedAt })
}

export function toParticipant(participant: StoredParticipant): ParticipantProfile {
  return participantProfileSchema.parse({ schemaVersion: 1, type: 'participant_profile',
    participantId: `par_${stableDigest(participant.userId).slice(0, 24)}`, userId: participant.userId,
    primaryHumanEndpointId: participant.primaryHumanEndpointId ?? null, primaryAgentId: participant.primaryAgentId ?? null,
    status: participant.status === 'complete' ? 'active' : 'incomplete', revision: participant.revision,
    createdAt: participant.updatedAt, updatedAt: participant.updatedAt })
}

export function toProjection(projection: StoredProjection): RemoteSessionProjection {
  return remoteSessionProjectionSchema.parse({ schemaVersion: 1, type: 'remote_session_projection',
    ...projection })
}

export function toManagedContainer(container: StoredManagedContainer): ManagedProviderContainer {
  return managedProviderContainerSchema.parse({
    schemaVersion: 1,
    type: 'managed_provider_container',
    managedContainerId: container.managedContainerId,
    ownerUserId: container.ownerUserId,
    humanEndpointId: container.humanEndpointId,
    provider: container.provider,
    realmId: container.realmId,
    stableKey: container.stableKey,
    displayName: container.displayName,
    container: container.externalContainerId
      ? {
          type: 'provider_managed_container_ref',
          provider: container.provider,
          realmId: container.realmId,
          containerId: container.externalContainerId
        }
      : null,
    policy: container.policy,
    checks: container.observedChecks ?? null,
    status: container.status,
    lastVerifiedAt: container.lastVerifiedAt ?? null,
    safeErrorCode: container.safeErrorCode ?? null,
    revision: container.revision,
    createdAt: container.createdAt,
    updatedAt: container.updatedAt
  })
}

export function toProject(project: StoredProject, members: StoredProjectMember[]): Project {
  return projectSchema.parse({ schemaVersion: 1, type: 'project', projectId: project.projectId,
    ownerUserId: project.ownerUserId, displayName: project.displayName, goal: project.goal,
    memberUserIds: members.filter((member) => member.active).map((member) => member.userId),
    coordinatorAgentId: project.coordinatorAgentId,
    status: project.status === 'failed' ? 'cancelled' : project.status,
    budget: project.budgets, revision: project.revision, createdAt: project.createdAt, updatedAt: project.updatedAt })
}

export function toTask(task: StoredTask): Task {
  const status = task.status === 'in_progress' ? 'running' : task.status === 'completed' ? 'succeeded' : task.status
  return taskSchema.parse({ schemaVersion: 1, type: 'task', taskId: task.taskId, projectId: task.projectId,
    createdByCoordinatorAgentId: task.createdByAgentId, assigneeAgentId: task.assigneeAgentId,
    title: task.title, objective: task.objective, completionCriteria: task.completionCriteria,
    dependencyTaskIds: task.dependencyTaskIds, status, attempt: task.retryCount + 1, maxRetries: task.maxRetries,
    ...(task.activeTurnId ? { activeTurnId: task.activeTurnId } : {}),
    ...(task.completedAt ? { completedAt: task.completedAt } : {}), revision: task.revision,
    createdAt: task.createdAt, updatedAt: task.updatedAt })
}

export function toProjectRecord(record: StoredProjectRecord): ProjectRecord {
  return projectRecordSchema.parse({ schemaVersion: 1, type: 'project_record',
    projectRecordId: record.projectRecordId, projectId: record.projectId, kind: record.kind,
    status: record.status === 'candidate' ? 'proposed' : record.status, body: record.summary,
    authorUserId: record.authorUserId, authorAgentId: record.authorAgentId ?? null,
    sourceTaskId: record.sourceTaskId ?? null, sourceRevision: record.sourceRevision ?? 1,
    acceptedByUserId: record.acceptedByUserId ?? null, acceptedByAgentId: record.acceptedByAgentId ?? null,
    acceptedAt: record.acceptedAt ?? null, revision: record.revision,
    createdAt: record.createdAt, updatedAt: record.updatedAt })
}

export function toProjectInput(input: StoredProjectInput): ProjectInput {
  return projectInputSchema.parse({ schemaVersion: 1, type: 'project_input', ...input })
}

export function toProjectEndpointBinding(binding: StoredProjectEndpointBinding): ProjectEndpointBinding {
  return projectEndpointBindingSchema.parse({ schemaVersion: 1, type: 'project_endpoint_binding', ...binding })
}

export function toHumanNeeded(request: StoredHumanRequest): HumanNeeded {
  return humanNeededSchema.parse({ schemaVersion: 1, type: 'human_needed', ...request })
}

export function toHumanAnswer(answer: StoredHumanAnswer): HumanAnswer {
  return humanAnswerSchema.parse({ schemaVersion: 1, type: 'human_answer', ...answer })
}

export function toInboxMessage(message: StoredInboxMessage): InboxMessage {
  const payload = { ...message.payload, type: message.messageType }
  return inboxMessageSchema.parse({ schemaVersion: 1, type: 'inbox_message', inboxMessageId: message.messageId,
    sequence: message.sequence, status: 'pending', createdAt: message.createdAt, expiresAt: message.expiresAt,
    ...(message.recipient.kind === 'agent'
      ? { recipientType: 'agent', recipientAgentId: message.recipient.id }
      : { recipientType: 'user', recipientUserId: message.recipient.id }),
    payload })
}
