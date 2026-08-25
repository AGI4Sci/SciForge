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
  projectContentProvisioningIntentSchema,
  projectContentProvisioningAttestationSchema,
  projectMembershipSchema,
  taskAuthoritySchema,
  projectContentReadinessSchema,
  projectWorkerAvailabilityViewSchema,
  providerDirectoryPrincipalFactSchema,
  workerAvailabilityProjectionSchema,
  projectPlanSchema,
  taskExecutionSchema,
  taskOfferSchema,
  taskResultSubmissionSchema,
  taskReviewDecisionSchema,
  projectContentSpaceBindingSchema,
  projectProviderMembershipObservationSchema,
  externalOperationRecoveryJournalEntrySchema,
  visibleRecoveryActionSchema,
  projectFinalSummarySchema,
  cloudResourceRefSchema,
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
  type ProjectContentProvisioningIntent,
  type ProjectContentProvisioningAttestation,
  type ProjectMembership,
  type TaskAuthority,
  type ProjectContentReadiness,
  type ProjectWorkerAvailabilityView,
  type ProviderDirectoryPrincipalFact,
  type WorkerAvailabilityProjection,
  type ProjectPlan,
  type TaskExecution,
  type TaskOffer,
  type TaskResultSubmission,
  type TaskReviewDecision,
  type ProjectContentSpaceBinding,
  type ProjectProviderMembershipObservation,
  type ExternalOperationRecoveryJournalEntry,
  type VisibleRecoveryAction,
  type ProjectFinalSummary,
  type CloudResourceRef,
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
  StoredProjectContentProvisioningIntent,
  StoredProjectContentProvisioningAttestation,
  StoredProjectContentSpaceBinding,
  StoredProjectProviderMembershipObservation,
  StoredCloudResourceRef,
  StoredProjectEndpointBinding,
  StoredProjectInput,
  StoredProjectMember,
  StoredTaskAuthority,
  StoredProjectContentReadiness,
  StoredProviderDirectoryPrincipalFact,
  StoredProjectRecord,
  StoredProjection,
  StoredTask,
  StoredTaskExecution,
  StoredTaskOffer,
  StoredProjectPlan,
  StoredTaskResultSubmission,
  StoredTaskResultReview,
  StoredWorkerAvailability,
  StoredUser,
  StoredExternalOperationJournal,
  StoredVisibleRecoveryAction,
  StoredProjectFinalSummary
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
    deviceId: agent.deviceId, ownerUserId: agent.ownerUserId,
    displayName: agent.displayName,
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

export function toProject(project: StoredProject): Project {
  return projectSchema.parse({ schemaVersion: 1, type: 'project', projectId: project.projectId,
    ownerUserId: project.ownerUserId, displayName: project.displayName, goal: project.goal,
    coordinatorAgentId: project.coordinatorAgentId,
    coordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch,
    executionAuthorityEpoch: project.executionAuthorityEpoch,
    contentMode: project.contentMode,
    status: project.status,
    budget: project.budget,
    revision: project.revision,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt })
}

export function toTask(task: StoredTask): Task {
  return taskSchema.parse({ schemaVersion: 1, type: 'task', taskId: task.taskId, projectId: task.projectId,
    createdByCoordinatorAgentId: task.createdByCoordinatorAgentId,
    title: task.title, objective: task.objective, completionCriteria: task.completionCriteria,
    dependencyTaskIds: task.dependencyTaskIds, fileIntent: task.fileIntent,
    currentExecutionId: task.currentExecutionId,
    currentExecutionState: task.currentExecutionState,
    status: task.status,
    executionCount: task.executionCount,
    maxRetries: task.maxRetries,
    completedAt: task.completedAt,
    revision: task.revision,
    createdAt: task.createdAt, updatedAt: task.updatedAt })
}

export function toProviderDirectoryPrincipalFact(
  fact: StoredProviderDirectoryPrincipalFact
): ProviderDirectoryPrincipalFact {
  return providerDirectoryPrincipalFactSchema.parse({
    schemaVersion: 1,
    type: 'provider_directory_principal_fact',
    ...fact
  })
}

export function toProjectMembership(membership: StoredProjectMember): ProjectMembership {
  return projectMembershipSchema.parse({
    schemaVersion: 1,
    type: 'project_membership',
    ...membership
  })
}

export function toTaskAuthority(authority: StoredTaskAuthority): TaskAuthority {
  return taskAuthoritySchema.parse({ schemaVersion: 1, type: 'task_authority', ...authority })
}

export function toProjectContentReadiness(
  readiness: StoredProjectContentReadiness
): ProjectContentReadiness {
  return projectContentReadinessSchema.parse({
    schemaVersion: 1,
    type: 'project_content_readiness',
    ...readiness
  })
}

export function toProjectWorkerAvailabilityView(input: Readonly<{
  projectId: string
  availability: StoredWorkerAvailability
  membership: StoredProjectMember | null
  taskAuthorities: StoredTaskAuthority[]
  providerPrincipalFact: StoredProviderDirectoryPrincipalFact | null
  providerPrincipalSnapshotStatus: ProjectWorkerAvailabilityView['providerPrincipalSnapshotStatus']
  contentReadiness: StoredProjectContentReadiness | null
  observedAt: string
}>): ProjectWorkerAvailabilityView {
  return projectWorkerAvailabilityViewSchema.parse({
    schemaVersion: 1,
    type: 'project_worker_availability_view',
    projectId: input.projectId,
    userId: input.availability.userId,
    agentId: input.availability.agentId,
    revision: input.availability.revision,
    availability: toWorkerAvailability(input.availability),
    membership: input.membership === null ? null : toProjectMembership(input.membership),
    taskAuthorities: input.taskAuthorities.map(toTaskAuthority),
    providerPrincipalFact: input.providerPrincipalFact === null
      ? null
      : toProviderDirectoryPrincipalFact(input.providerPrincipalFact),
    providerPrincipalSnapshotStatus: input.providerPrincipalSnapshotStatus,
    contentReadiness: input.contentReadiness === null
      ? null
      : toProjectContentReadiness(input.contentReadiness),
    observedAt: input.observedAt
  })
}

export function toProjectContentProvisioningIntent(
  intent: StoredProjectContentProvisioningIntent
): ProjectContentProvisioningIntent {
  return projectContentProvisioningIntentSchema.parse({
    schemaVersion: 1,
    type: 'project_content_provisioning_intent',
    ...intent
  })
}

export function toProjectContentProvisioningAttestation(
  attestation: StoredProjectContentProvisioningAttestation
): ProjectContentProvisioningAttestation {
  return projectContentProvisioningAttestationSchema.parse({
    schemaVersion: 1,
    type: 'project_content_provisioning_attestation',
    ...attestation
  })
}

export function toProjectProviderMembershipObservation(
  observation: StoredProjectProviderMembershipObservation
): ProjectProviderMembershipObservation {
  return projectProviderMembershipObservationSchema.parse({
    schemaVersion: 1,
    type: 'project_provider_membership_observation',
    ...observation
  })
}

export function toExternalOperationRecoveryJournalEntry(
  journal: StoredExternalOperationJournal
): ExternalOperationRecoveryJournalEntry {
  return externalOperationRecoveryJournalEntrySchema.parse({
    schemaVersion: 1,
    type: 'external_operation_recovery_journal_entry',
    ...journal
  })
}

export function toVisibleRecoveryAction(action: StoredVisibleRecoveryAction): VisibleRecoveryAction {
  return visibleRecoveryActionSchema.parse({
    schemaVersion: 1,
    type: 'visible_recovery_action',
    ...action
  })
}

export function toProjectFinalSummary(summary: StoredProjectFinalSummary): ProjectFinalSummary {
  return projectFinalSummarySchema.parse({
    schemaVersion: 1,
    type: 'project_final_summary',
    ...summary
  })
}

export function toWorkerAvailability(
  availability: StoredWorkerAvailability
): WorkerAvailabilityProjection {
  return workerAvailabilityProjectionSchema.parse({
    schemaVersion: 1,
    type: 'worker_availability_projection',
    ...availability
  })
}

export function toProjectPlan(plan: StoredProjectPlan): ProjectPlan {
  const { coordinatorAuthorityEpoch: _coordinatorAuthorityEpoch, ...publicPlan } = plan
  return projectPlanSchema.parse({ schemaVersion: 1, type: 'project_plan', ...publicPlan })
}

export function toTaskExecution(execution: StoredTaskExecution): TaskExecution {
  return taskExecutionSchema.parse({ schemaVersion: 1, type: 'task_execution', ...execution })
}

export function toTaskOffer(offer: StoredTaskOffer): TaskOffer {
  return taskOfferSchema.parse({ schemaVersion: 1, type: 'task_offer', ...offer })
}

export function toTaskResultSubmission(submission: StoredTaskResultSubmission): TaskResultSubmission {
  return taskResultSubmissionSchema.parse({ schemaVersion: 1, type: 'task_result_submission', ...submission })
}

export function toTaskReviewDecision(review: StoredTaskResultReview): TaskReviewDecision {
  const { coordinatorAuthorityEpoch: _coordinatorAuthorityEpoch, ...publicReview } = review
  return taskReviewDecisionSchema.parse({ schemaVersion: 1, type: 'task_review_decision', ...publicReview })
}

export function toProjectContentSpaceBinding(
  binding: StoredProjectContentSpaceBinding
): ProjectContentSpaceBinding {
  return projectContentSpaceBindingSchema.parse({
    schemaVersion: 1,
    type: 'project_content_space_binding',
    ...binding
  })
}

export function toCloudResourceRef(resource: StoredCloudResourceRef): CloudResourceRef {
  return cloudResourceRefSchema.parse({
    schemaVersion: 1,
    type: 'resource_ref',
    ...resource,
    invalidatedAt: resource.invalidatedAt ?? null
  })
}

export function toProjectRecord(record: StoredProjectRecord): ProjectRecord {
  return projectRecordSchema.parse({ schemaVersion: 1, type: 'project_record',
    projectRecordId: record.projectRecordId, projectId: record.projectId, kind: record.kind,
    status: record.status, body: record.summary,
    authorUserId: record.authorUserId, authorAgentId: record.authorAgentId,
    sourceTaskId: record.sourceTaskId ?? null,
    sourceResultSubmissionId: record.sourceResultSubmissionId ?? null,
    sourceHumanAnswerId: record.sourceHumanAnswerId ?? null,
    sourceRevision: record.sourceRevision ?? 1,
    acceptedByUserId: record.acceptedByUserId, acceptedByAgentId: record.acceptedByAgentId,
    acceptedAt: record.acceptedAt, revision: record.revision,
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
