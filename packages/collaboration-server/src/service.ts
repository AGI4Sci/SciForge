import { createHash, createPublicKey, randomBytes, verify as verifySignature } from 'node:crypto'
import {
  canonicalProjectContentProvisioningAttestationFactualPayloadBytes,
  canonicalProjectContentProvisioningAttestationSignatureBytes,
  canonicalProvisionedMemberSetBytes,
  canUserReadProjectCoordination,
  type CloudStateCommand,
  confirmableHumanActionSchema,
  projectCreateIncludesAuthenticatedOwner,
  providerDirectRecipientSchema,
  type AgentCredentialBootstrapPublicKey,
  type AgentCredentialEnvelope,
  type ProviderDirectRecipient,
  type ProviderIdentity,
  type ProjectCoordinationFactPage,
  type ProjectWorkerAvailabilityView,
  type RestRequest,
  type TaskExecutionPreflight,
  type TaskFileIntent,
  type TaskExecutionFileIntent,
  type TaskResultOutput
} from '@sciforge/collaboration-contracts'

import { actorInboxRecipient, type AgentActor, type AuthContext, type HumanEndpointActor, type UserActor } from './actor.js'
import { fenceTaskExecution, revokeAgentAuthorityInTransaction } from './authority-revocation.js'
import { authorize } from './auth.js'
import { sealAgentCredential } from './agent-credential-envelope.js'
import {
  toProjectContentReadiness,
  toProjectContentSpaceBinding,
  toProjectContentProvisioningAttestation,
  toProjectContentProvisioningIntent,
  toProjectFinalSummary,
  toHumanNeeded,
  toProjectMembership,
  toProjectPlan,
  toProjectProviderMembershipObservation,
  toProjectRecord,
  toProviderDirectoryPrincipalFact,
  toTaskAuthority,
  toTaskExecution,
  toTaskOffer,
  toTaskResultSubmission,
  toTaskReviewDecision,
  toTask,
  toWorkerAvailability,
  toExternalOperationRecoveryJournalEntry,
  toVisibleRecoveryAction
} from './contracts.js'
import { digestSecret, issueSecret, newId, safeAuditMetadata, stableDigest } from './crypto.js'
import { CollaborationServiceError, fail } from './errors.js'
import type {
  InboxRecipient,
  ProviderLocatorValue,
  StoredAgent,
  StoredAuditEvent,
  StoredEndpoint,
  StoredInboxMessage,
  StoredManagedContainer,
  StoredManagedContainerJob,
  StoredParticipant,
  StoredProjection,
  StoredProject,
  StoredProjectContentProvisioningIntent,
  StoredProjectContentProvisioningAttestation,
  StoredProjectContentReadiness,
  StoredProjectContentSpaceBinding,
  StoredProjectProviderMembershipObservation,
  StoredProjectEndpointBinding,
  StoredProjectInput,
  StoredProjectMember,
  StoredProjectPlan,
  StoredProjectRecord,
  StoredReceipt,
  StoredTask,
  StoredTaskExecution,
  StoredTaskOffer,
  StoredTaskResultReview,
  StoredTaskResultSubmission,
  StoredWorkerAvailability,
  StoredCloudResourceRef,
  StoredUser,
  StoredHumanRequest,
  StoredHumanAnswer,
  StoredRemoteCapabilityApproval,
  StoredProviderDirectoryPrincipalFact,
  StoredTaskAuthority,
  StoredExternalOperationJournal,
  StoredVisibleRecoveryAction,
  StoredProjectFinalSummary
} from './model.js'
import type { CollaborationReadRepository, CollaborationRepository, CollaborationTransaction } from './repository.js'
import type { CollaborationServiceNotifier } from './runtime-notifier.js'

export type CollaborationServiceOptions = {
  repository: CollaborationRepository
  notifier?: CollaborationServiceNotifier
  now?: () => Date
  endpointChallengeTtlMs?: number
  inboxRetentionMs?: number
  receiptRetentionMs?: number
  remoteApprovalReference?: () => string
}

type CommandResult<T extends Record<string, unknown>> = {
  response: T
  resourceKind?: string
  resourceId?: string
  notifications?: Array<{ recipient: InboxRecipient; sequence: number }>
  receiptResponse?: Record<string, unknown>
  persistReceipt?: boolean
}

type CloudCommand<Type extends CloudStateCommand['type']> = Extract<CloudStateCommand, { type: Type }>
type RestCommand<Type extends RestRequest['type']> = Extract<RestRequest, { type: Type }>
type CoordinationPageRequest = CloudCommand<'project.coordination.read'>['collections'][number]

export class CollaborationService {
  private readonly repository: CollaborationRepository
  private readonly notifier?: CollaborationServiceNotifier
  private readonly now: () => Date
  private readonly endpointChallengeTtlMs: number
  private readonly inboxRetentionMs: number
  private readonly receiptRetentionMs: number
  private readonly remoteApprovalReference: () => string

  constructor(options: CollaborationServiceOptions) {
    this.repository = options.repository
    this.notifier = options.notifier
    this.now = options.now ?? (() => new Date())
    this.endpointChallengeTtlMs = bounded(options.endpointChallengeTtlMs ?? 10 * 60_000, 60_000, 30 * 60_000)
    this.inboxRetentionMs = bounded(options.inboxRetentionMs ?? 30 * 86_400_000, 86_400_000, 90 * 86_400_000)
    this.receiptRetentionMs = bounded(options.receiptRetentionMs ?? 30 * 86_400_000, 86_400_000, 90 * 86_400_000)
    this.remoteApprovalReference = options.remoteApprovalReference ?? issueRemoteApprovalReference
  }

  async createRemoteCapabilityApproval(actor: AgentActor, input: {
    projectionId: string
    runtimeId: string
    threadId: string
    turnId: string
    capabilityRequestId: string
    desktopApprovalId: string
    safeSummary: string
    effect: 'workspace-write' | 'external-write' | 'destructive'
    remoteEligible: boolean
    expiresAt: string
    idempotencyKey: string
  }): Promise<Record<string, unknown>> {
    for (const [name, value] of Object.entries({
      projectionId: input.projectionId,
      runtimeId: input.runtimeId,
      threadId: input.threadId,
      turnId: input.turnId,
      capabilityRequestId: input.capabilityRequestId,
      desktopApprovalId: input.desktopApprovalId,
      safeSummary: input.safeSummary
    })) assertText(value, name, 1, name === 'safeSummary' ? 500 : 512)
    const approvalReference = this.remoteApprovalReference()
    if (!/^AP1-[A-Z2-9]{20}$/u.test(approvalReference)) {
      throw new Error('Remote approval reference generator returned an invalid versioned reference.')
    }
    const result = await this.commit(actor, 'capability.approval.create', input.idempotencyKey, {
      ...input,
      approvalReference: '[REDACTED]'
    }, async (tx, at) => {
      const projection = required(await tx.getProjection(input.projectionId), 'Projection')
      if (projection.status !== 'active' || projection.agentId !== actor.agentId) {
        fail('permission_denied', 'The Agent does not own this active Projection.')
      }
      const agent = required(await tx.getAgent(actor.agentId), 'Agent')
      if (agent.status !== 'active' || agent.ownerUserId !== projection.ownerUserId) {
        fail('credential_revoked', 'The Projection Agent is not active for its owner.')
      }
      const expiresAtMs = Date.parse(input.expiresAt)
      const createdAtMs = Date.parse(at)
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= createdAtMs || expiresAtMs > createdAtMs + 5 * 60_000) {
        fail('validation_failed', 'Remote approval expiry must be within five minutes.')
      }
      const approval: StoredRemoteCapabilityApproval = {
        remoteApprovalId: newId('rap'),
        ownerUserId: projection.ownerUserId,
        agentId: actor.agentId,
        projectionId: projection.projectionId,
        locator: projection.locator,
        locatorRevision: projection.locatorRevision,
        runtimeId: input.runtimeId,
        threadId: input.threadId,
        turnId: input.turnId,
        capabilityRequestId: input.capabilityRequestId,
        desktopApprovalId: input.desktopApprovalId,
        referenceDigest: digestSecret(approvalReference),
        safeSummary: input.safeSummary,
        effect: input.effect,
        remoteEligible: input.remoteEligible,
        status: input.remoteEligible ? 'pending' : 'desktop_only',
        revision: 1,
        expiresAt: input.expiresAt,
        createdAt: at,
        updatedAt: at
      }
      await tx.insertRemoteApproval(approval)
      const cardText = input.remoteEligible
        ? remoteApprovalCard(approval, approvalReference, projection.displayName)
        : remoteApprovalTerminalText('desktop_only')
      const message = await this.appendInbox(tx, { kind: 'human_endpoint', id: projection.humanEndpointId },
        'provider.notification.outbound', {
          protocolVersion: '1.0',
          type: 'provider.notification.outbound',
          notificationKind: 'remote_capability_approval',
          remoteApprovalId: approval.remoteApprovalId,
          locator: approval.locator,
          text: cardText
        }, at)
      return {
        response: { protocolVersion: '1.0', type: 'capability.approval.created', approval: toRemoteApprovalEntity(approval) },
        resourceKind: 'remote_capability_approval',
        resourceId: approval.remoteApprovalId,
        notifications: [{ recipient: message.recipient, sequence: message.sequence }]
      }
    })
    return result
  }

  async decideRemoteCapabilityApproval(actor: HumanEndpointActor, input: {
    approvalReference: string
    decision: 'allow_once' | 'deny_once'
    sourceLocator: ProviderLocatorValue
    providerEventId: string
  }): Promise<Record<string, unknown>> {
    assertText(input.approvalReference, 'approvalReference', 24, 24)
    const idempotencyKey = `idem_remote_approval_${stableDigest(input.providerEventId)}`
    return this.commit(actor, 'capability.approval.decide', idempotencyKey, {
      decision: input.decision,
      providerEventId: input.providerEventId,
      approvalReference: '[REDACTED]',
      sourceLocator: input.sourceLocator
    }, async (tx, at) => {
      const approval = required(
        await tx.getRemoteApprovalByReferenceDigest(digestSecret(input.approvalReference)),
        'Remote approval'
      )
      authorize({
        actor,
        operation: 'capability_approval',
        targetUserId: approval.ownerUserId,
        requiredAssurance: 'verified',
        remoteApprovalAllowed: input.decision === 'deny_once' || approval.remoteEligible
      })
      const projection = required(await tx.getProjection(approval.projectionId), 'Projection')
      if (projection.status !== 'active' || projection.agentId !== approval.agentId) {
        fail('revision_conflict', 'The approval Projection is no longer active for its Agent.')
      }
      if (
        projection.locatorRevision !== approval.locatorRevision
        || !sameLocator(projection.locator, approval.locator)
      ) fail('revision_conflict', 'The approval locator revision is no longer current.')
      if (actor.humanEndpointId !== projection.humanEndpointId) {
        fail('permission_denied', 'The approval belongs to another human endpoint.')
      }
      if (!sameLocator(approval.locator, input.sourceLocator)) {
        fail('permission_denied', 'The approval reply came from another Topic.')
      }
      if (approval.expiresAt <= at) {
        const expired = { ...approval, status: 'expired' as const, revision: approval.revision + 1, updatedAt: at }
        await tx.updateRemoteApproval(expired, approval.revision)
        const notifications = approval.providerCardMessageId
          ? [await this.appendInbox(tx, { kind: 'human_endpoint', id: projection.humanEndpointId },
              'provider.message.update.outbound', {
                protocolVersion: '1.0', type: 'provider.message.update.outbound',
                remoteApprovalId: approval.remoteApprovalId, locator: approval.locator,
                providerMessageId: approval.providerCardMessageId,
                text: remoteApprovalTerminalText('expired'), fallbackText: remoteApprovalTerminalText('expired')
              }, at)]
          : []
        return {
          response: { protocolVersion: '1.0', type: 'rest.entity', entity: toRemoteApprovalEntity(expired) },
          resourceKind: 'remote_capability_approval',
          resourceId: approval.remoteApprovalId,
          notifications: notifications.map((message) => ({ recipient: message.recipient, sequence: message.sequence }))
        }
      }
      if (approval.status !== 'pending') fail('revision_conflict', 'The remote approval is already terminal.')
      const decisionId = `decision-${stableDigest(input.providerEventId)}`
      const updated: StoredRemoteCapabilityApproval = {
        ...approval,
        status: input.decision === 'allow_once' ? 'approved' : 'denied',
        decisionEventId: input.providerEventId,
        decisionId,
        revision: approval.revision + 1,
        updatedAt: at
      }
      await tx.updateRemoteApproval(updated, approval.revision)
      const message = await this.appendInbox(tx, { kind: 'agent', id: approval.agentId },
        'capability.approval.decision', {
          protocolVersion: '1.0',
          type: 'capability.approval.decision',
          remoteApprovalId: approval.remoteApprovalId,
          desktopApprovalId: approval.desktopApprovalId,
          projectionId: approval.projectionId,
          runtimeId: approval.runtimeId,
          threadId: approval.threadId,
          turnId: approval.turnId,
          capabilityRequestId: approval.capabilityRequestId,
          decisionId,
          decision: input.decision
        }, at)
      return {
        response: { protocolVersion: '1.0', type: 'rest.entity', entity: toRemoteApprovalEntity(updated) },
        resourceKind: 'remote_capability_approval',
        resourceId: approval.remoteApprovalId,
        notifications: [{ recipient: message.recipient, sequence: message.sequence }]
      }
    })
  }

  async reportRemoteCapabilityApprovalResult(actor: AgentActor, input: {
    remoteApprovalId: string
    decisionId: string
    outcome: 'applied' | 'already_terminal' | 'not_pending' | 'not_eligible'
    idempotencyKey: string
  }): Promise<Record<string, unknown>> {
    return this.commit(actor, 'capability.approval.result', input.idempotencyKey, input, async (tx, at) => {
      const approval = required(await tx.getRemoteApproval(input.remoteApprovalId), 'Remote approval')
      if (approval.agentId !== actor.agentId || approval.decisionId !== input.decisionId) {
        fail('permission_denied', 'The decision result does not belong to this Agent.')
      }
      if (approval.status !== 'approved' && approval.status !== 'denied') {
        return {
          response: { protocolVersion: '1.0', type: 'rest.entity', entity: toRemoteApprovalEntity(approval) },
          resourceKind: 'remote_capability_approval', resourceId: approval.remoteApprovalId
        }
      }
      const status = input.outcome === 'applied'
        ? 'completed'
        : input.outcome === 'not_eligible' ? 'desktop_only' : 'superseded'
      const terminalTextStatus = input.outcome === 'applied'
        ? approval.status
        : status
      const updated: StoredRemoteCapabilityApproval = {
        ...approval,
        status,
        revision: approval.revision + 1,
        updatedAt: at
      }
      await tx.updateRemoteApproval(updated, approval.revision)
      const notifications = approval.providerCardMessageId
        ? [await this.appendInbox(tx, { kind: 'human_endpoint', id: (
          required(await tx.getProjection(approval.projectionId), 'Projection')
        ).humanEndpointId }, 'provider.message.update.outbound', {
          protocolVersion: '1.0',
          type: 'provider.message.update.outbound',
          remoteApprovalId: approval.remoteApprovalId,
          locator: approval.locator,
          providerMessageId: approval.providerCardMessageId,
          text: remoteApprovalTerminalText(terminalTextStatus),
          fallbackText: remoteApprovalTerminalText(terminalTextStatus)
        }, at)]
        : []
      return {
        response: { protocolVersion: '1.0', type: 'rest.entity', entity: toRemoteApprovalEntity(updated) },
        resourceKind: 'remote_capability_approval',
        resourceId: approval.remoteApprovalId,
        notifications: notifications.map((message) => ({ recipient: message.recipient, sequence: message.sequence }))
      }
    })
  }

  async withdrawRemoteCapabilityApproval(actor: AgentActor, input: {
    remoteApprovalId: string
    desktopApprovalId: string
    idempotencyKey: string
  }): Promise<Record<string, unknown>> {
    return this.commit(actor, 'capability.approval.withdraw', input.idempotencyKey, input, async (tx, at) => {
      const approval = required(await tx.getRemoteApproval(input.remoteApprovalId), 'Remote approval')
      if (approval.agentId !== actor.agentId || approval.desktopApprovalId !== input.desktopApprovalId) {
        fail('permission_denied', 'The remote approval does not belong to this canonical Desktop request.')
      }
      if (approval.status !== 'pending') {
        return { response: { protocolVersion: '1.0', type: 'rest.entity', entity: toRemoteApprovalEntity(approval) } }
      }
      const updated: StoredRemoteCapabilityApproval = {
        ...approval, status: 'superseded', revision: approval.revision + 1, updatedAt: at
      }
      await tx.updateRemoteApproval(updated, approval.revision)
      const notifications = approval.providerCardMessageId
        ? [await this.appendInbox(tx, { kind: 'human_endpoint', id: (
          required(await tx.getProjection(approval.projectionId), 'Projection')
        ).humanEndpointId }, 'provider.message.update.outbound', {
          protocolVersion: '1.0', type: 'provider.message.update.outbound',
          remoteApprovalId: approval.remoteApprovalId, locator: approval.locator,
          providerMessageId: approval.providerCardMessageId,
          text: remoteApprovalTerminalText('superseded'), fallbackText: remoteApprovalTerminalText('superseded')
        }, at)] : []
      return {
        response: { protocolVersion: '1.0', type: 'rest.entity', entity: toRemoteApprovalEntity(updated) },
        resourceKind: 'remote_capability_approval', resourceId: approval.remoteApprovalId,
        notifications: notifications.map((message) => ({ recipient: message.recipient, sequence: message.sequence }))
      }
    })
  }

  async confirmRemoteApprovalCard(remoteApprovalId: string, providerMessageId: string): Promise<void> {
    const notification = await this.repository.transaction(async (tx) => {
      const approval = required(await tx.getRemoteApproval(remoteApprovalId), 'Remote approval')
      if (approval.providerCardMessageId && approval.providerCardMessageId !== providerMessageId) {
        fail('identity_conflict', 'The approval card message reference cannot be replaced.')
      }
      if (approval.providerCardMessageId) return null
      const updated = {
        ...approval,
        providerCardMessageId: providerMessageId,
        revision: approval.revision + 1,
        updatedAt: this.timestamp()
      }
      await tx.updateRemoteApproval(updated, approval.revision)
      if (approval.status === 'pending' || approval.status === 'desktop_only') return null
      const projection = required(await tx.getProjection(approval.projectionId), 'Projection')
      return this.appendInbox(tx, { kind: 'human_endpoint', id: projection.humanEndpointId },
        'provider.message.update.outbound', {
          protocolVersion: '1.0', type: 'provider.message.update.outbound',
          remoteApprovalId: approval.remoteApprovalId, locator: approval.locator,
          providerMessageId, text: remoteApprovalTerminalText(approval.status),
          fallbackText: remoteApprovalTerminalText(approval.status)
        }, updated.updatedAt)
    })
    if (notification) await this.notifier?.notifyInboxAvailable(notification.recipient, notification.sequence)
  }

  async enqueueRemoteApprovalFallback(input: {
    remoteApprovalId: string
    locator: ProviderLocatorValue
    text: string
    idempotencyKey: string
  }): Promise<void> {
    const actor: AuthContext = {
      kind: 'system',
      actorKey: 'provider-runtime:remote-approval-fallback'
    }
    await this.commit(actor, 'capability.approval.fallback', input.idempotencyKey, input, async (tx, at) => {
      const approval = required(await tx.getRemoteApproval(input.remoteApprovalId), 'Remote approval')
      if (!sameLocator(approval.locator, input.locator)) {
        fail('permission_denied', 'The fallback notification locator does not match its approval.')
      }
      const projection = required(await tx.getProjection(approval.projectionId), 'Projection')
      const notification = await this.appendInbox(tx, { kind: 'human_endpoint', id: projection.humanEndpointId },
        'provider.notification.outbound', {
          protocolVersion: '1.0',
          type: 'provider.notification.outbound',
          notificationKind: 'remote_capability_approval_terminal_fallback',
          remoteApprovalId: approval.remoteApprovalId,
          locator: approval.locator,
          text: input.text
        }, at)
      return {
        response: { remoteApprovalId: approval.remoteApprovalId, fallbackQueued: true },
        resourceKind: 'remote_capability_approval',
        resourceId: approval.remoteApprovalId,
        notifications: [{ recipient: notification.recipient, sequence: notification.sequence }]
      }
    })
  }

  async expireRemoteCapabilityApprovals(limit = 100): Promise<number> {
    const at = this.timestamp()
    const expired = await this.repository.listExpiredRemoteApprovals(at, bounded(limit, 1, 500))
    let count = 0
    for (const candidate of expired) {
      const notification = await this.repository.transaction(async (tx) => {
        const approval = await tx.getRemoteApproval(candidate.remoteApprovalId)
        if (!approval || approval.status !== 'pending' || approval.expiresAt > at) return null
        const updated: StoredRemoteCapabilityApproval = {
          ...approval, status: 'expired', revision: approval.revision + 1, updatedAt: at
        }
        await tx.updateRemoteApproval(updated, approval.revision)
        if (!approval.providerCardMessageId) return null
        const projection = required(await tx.getProjection(approval.projectionId), 'Projection')
        return this.appendInbox(tx, { kind: 'human_endpoint', id: projection.humanEndpointId },
          'provider.message.update.outbound', {
            protocolVersion: '1.0', type: 'provider.message.update.outbound',
            remoteApprovalId: approval.remoteApprovalId, locator: approval.locator,
            providerMessageId: approval.providerCardMessageId,
            text: remoteApprovalTerminalText('expired'), fallbackText: remoteApprovalTerminalText('expired')
          }, at)
      })
      count += 1
      if (notification) await this.notifier?.notifyInboxAvailable(notification.recipient, notification.sequence)
    }
    return count
  }

  async createEndpointChallenge(actor: UserActor, input: {
    provider: string
    realmId: string
    expectedProviderUserId: string
    idempotencyKey: string
  }): Promise<Record<string, unknown>> {
    assertText(input.provider, 'provider', 1, 100)
    assertText(input.realmId, 'realmId', 1, 300)
    assertText(input.expectedProviderUserId, 'expectedProviderUserId', 1, 300)
    const challengeCode = randomBytes(9).toString('base64url')
    const result = await this.commit(actor, 'endpoint.challenge.create', input.idempotencyKey, {
      provider: input.provider,
      realmId: input.realmId,
      requestedUserId: actor.userId,
      expectedProviderUserId: input.expectedProviderUserId
    }, async (tx, at) => {
      const user = required(await tx.getUser(actor.userId), 'User')
      if (user.status !== 'active') fail('credential_revoked', 'The requesting OIDC User is not active.')
      const challengeId = newId('chl')
      const expiresAt = new Date(new Date(at).getTime() + this.endpointChallengeTtlMs).toISOString()
      await tx.insertChallenge({
        challengeId,
        requestedUserId: actor.userId,
        provider: input.provider,
        realmId: input.realmId,
        expectedProviderUserId: input.expectedProviderUserId,
        challengeDigest: digestSecret(challengeCode),
        expiresAt,
        createdAt: at
      })
      return {
        response: { protocolVersion: '1.0', type: 'endpoint.challenge.created', challengeId, challengeCode, expiresAt },
        receiptResponse: { protocolVersion: '1.0', type: 'endpoint.challenge.created', challengeId, expiresAt, replayed: true },
        resourceKind: 'endpoint_challenge',
        resourceId: challengeId
      }
    })
    return result
  }

  async getEndpointChallenge(actor: UserActor, challengeId: string): Promise<Record<string, unknown>> {
    const challenge = required(await this.repository.getChallenge(challengeId), 'Endpoint challenge')
    if (challenge.requestedUserId !== actor.userId) {
      fail('permission_denied', 'The endpoint challenge belongs to another OIDC User.')
    }
    const at = this.timestamp()
    if (challenge.expiresAt <= at) {
      return { type: 'endpoint.challenge.expired', challengeId: challenge.challengeId, expiresAt: challenge.expiresAt }
    }
    if (!challenge.verifiedAt || !challenge.verifiedUserId || !challenge.verifiedEndpointId) {
      return { type: 'endpoint.challenge.pending', challengeId: challenge.challengeId,
        expiresAt: challenge.expiresAt, retryAfterSeconds: 3 }
    }
    const endpoint = required(await this.repository.getEndpoint(challenge.verifiedEndpointId), 'Verified human endpoint')
    if (endpoint.userId !== actor.userId || endpoint.status !== 'active') {
      fail('credential_revoked', 'The verified human endpoint is no longer active for this OIDC User.')
    }
    return { type: 'endpoint.challenge.verified', challengeId: challenge.challengeId, userId: actor.userId,
      humanEndpointId: endpoint.humanEndpointId, assurance: endpoint.assurance, verifiedAt: challenge.verifiedAt }
  }

  async verifyEndpointChallengeFromProvider(input: {
    provider: string
    realmId: string
    providerUserId: string
    providerDisplayName?: string
    challengeId?: string
    challengeCode: string
    providerEventId: string
    assurance: 'verified' | 'strong'
  }): Promise<Record<string, unknown>> {
    assertText(input.provider, 'provider', 1, 100)
    assertText(input.realmId, 'realmId', 1, 300)
    assertText(input.providerUserId, 'providerUserId', 1, 300)
    assertText(input.providerEventId, 'providerEventId', 1, 500)
    assertText(input.challengeCode, 'challengeCode', 8, 200)
    const actor: AuthContext = { kind: 'system', actorKey: `provider-event:${input.provider}:${stableDigest(input.providerEventId)}` }
    return this.commit(actor, 'endpoint.challenge.verify', input.providerEventId, {
      provider: input.provider,
      realmId: input.realmId,
      providerUserId: input.providerUserId,
      providerEventId: input.providerEventId
    }, async (tx, at) => {
      const challengeCodeDigest = digestSecret(input.challengeCode)
      const challenge = input.challengeId
        ? await tx.getChallengeForUpdate(input.challengeId)
        : await tx.getChallengeByCodeDigestForUpdate(challengeCodeDigest)
      if (!challenge || challenge.challengeDigest !== challengeCodeDigest ||
          challenge.provider !== input.provider || challenge.realmId !== input.realmId) {
        fail('not_found', 'The endpoint challenge is not valid for this provider realm.')
      }
      if (challenge.expectedProviderUserId !== input.providerUserId) {
        fail('identity_conflict', 'The challenge response came from a different provider identity.')
      }
      if (challenge.expiresAt <= at) fail('request_expired', 'The endpoint challenge has expired.')
      if (challenge.verifiedAt && challenge.verifiedUserId && challenge.verifiedEndpointId) {
        const endpoint = required(await tx.getEndpoint(challenge.verifiedEndpointId), 'Verified human endpoint')
        return {
          response: { protocolVersion: '1.0', type: 'endpoint.challenge.verified', challengeId: challenge.challengeId,
            userId: challenge.verifiedUserId, humanEndpointId: challenge.verifiedEndpointId,
            assurance: endpoint.assurance, verifiedAt: challenge.verifiedAt },
          resourceKind: 'human_endpoint', resourceId: challenge.verifiedEndpointId
        }
      }
      const existing = await tx.getEndpointByProviderIdentity(input.provider, input.realmId, input.providerUserId)
      if (existing && existing.userId !== challenge.requestedUserId && existing.status !== 'revoked') {
        fail('identity_conflict', 'This provider identity belongs to another active user and must be explicitly transferred.')
      }
      const user = required(await tx.getUser(challenge.requestedUserId), 'Requesting OIDC User')
      if (user.status !== 'active') fail('credential_revoked', 'The requesting OIDC User is not active.')
      let endpoint: StoredEndpoint
      if (existing) {
        const expectedRevision = existing.revision
        endpoint = {
          ...existing,
          userId: user.userId,
          displayName: input.providerDisplayName ?? existing.displayName,
          assurance: input.assurance,
          status: 'active',
          revision: expectedRevision + 1,
          verifiedAt: at,
          updatedAt: at,
          revokedAt: undefined
        }
        await tx.updateEndpoint(endpoint, expectedRevision)
      } else {
        endpoint = {
          humanEndpointId: newId('hep'),
          userId: user.userId,
          provider: input.provider,
          realmId: input.realmId,
          providerUserId: input.providerUserId,
          displayName: input.providerDisplayName,
          assurance: input.assurance,
          status: 'active',
          revision: 1,
          verifiedAt: at,
          updatedAt: at
        }
        await tx.insertEndpoint(endpoint)
      }
      const participant = await tx.getParticipant(user.userId)
      const updatedParticipant = completeParticipant({
        userId: user.userId,
        primaryHumanEndpointId: participant?.primaryHumanEndpointId ?? endpoint.humanEndpointId,
        primaryAgentId: participant?.primaryAgentId,
        status: 'incomplete',
        revision: (participant?.revision ?? 0) + 1,
        updatedAt: at
      })
      await tx.upsertParticipant(updatedParticipant, participant?.revision ?? null)
      if (!await tx.verifyChallenge(challenge.challengeId, user.userId, endpoint.humanEndpointId, at)) {
        fail('revision_conflict', 'The endpoint challenge changed while it was being verified.')
      }
      return {
        response: { protocolVersion: '1.0', type: 'endpoint.challenge.verified', challengeId: challenge.challengeId,
          userId: user.userId, humanEndpointId: endpoint.humanEndpointId,
          assurance: endpoint.assurance, verifiedAt: at },
        resourceKind: 'human_endpoint', resourceId: endpoint.humanEndpointId
      }
    })
  }

  async enqueueProviderCommandResult(input: {
    identity: ProviderIdentity
    providerEventId: string
    result: 'success' | 'invalid_or_expired' | 'identity_conflict'
  }): Promise<Record<string, unknown>> {
    assertText(input.providerEventId, 'providerEventId', 1, 500)
    const recipient = providerDirectRecipientSchema.parse({
      type: 'provider_direct_recipient',
      provider: input.identity.provider,
      realmId: input.identity.realmId,
      providerUserId: input.identity.providerUserId
    })
    const recipientId = providerIdentityInboxId(recipient)
    const actor: AuthContext = {
      kind: 'system',
      actorKey: `provider-command-result:${recipientId}`
    }
    return this.commit(actor, 'provider.command.result', input.providerEventId, {
      recipient,
      result: input.result
    }, async (tx, at) => {
      const message = await this.appendInbox(tx, { kind: 'provider_identity', id: recipientId },
        'provider.command.result.outbound', {
          protocolVersion: '1.0',
          type: 'provider.command.result.outbound',
          recipient,
          result: input.result,
          text: providerCommandResultText(input.result)
        }, at)
      return {
        response: {
          protocolVersion: '1.0',
          type: 'provider.command.result.queued',
          inboxMessageId: message.messageId
        },
        resourceKind: 'provider_identity',
        resourceId: recipientId
      }
    })
  }

  async pullProviderIdentityInbox(input: {
    recipientId: string
    limit: number
  }): Promise<{ messages: StoredInboxMessage[]; ackedSequence: number; nextSequence: number }> {
    assertProviderIdentityInboxId(input.recipientId)
    const recipient: InboxRecipient = { kind: 'provider_identity', id: input.recipientId }
    const limit = integer(input.limit, 'limit', 1, 200)
    const cursor = await this.repository.getInboxCursor(recipient)
    const messages = await this.repository.pullInbox(
      recipient,
      cursor?.ackedSequence ?? 0,
      limit,
      this.timestamp()
    )
    return { messages, ackedSequence: cursor?.ackedSequence ?? 0, nextSequence: cursor?.nextSequence ?? 1 }
  }

  async ackProviderIdentityInboxMessage(input: {
    recipientId: string
    inboxMessageId: string
    sequence: number
  }): Promise<{ ackedSequence: number; nextSequence: number }> {
    assertProviderIdentityInboxId(input.recipientId)
    integer(input.sequence, 'sequence', 1, Number.MAX_SAFE_INTEGER)
    const recipient: InboxRecipient = { kind: 'provider_identity', id: input.recipientId }
    const [message] = await this.repository.pullInbox(recipient, input.sequence - 1, 1, this.timestamp())
    if (!message || message.sequence !== input.sequence || message.messageId !== input.inboxMessageId) {
      fail('not_found', 'The provider identity inbox message does not match its recipient and sequence.')
    }
    const actor: AuthContext = { kind: 'system', actorKey: `provider-outbox:${input.recipientId}` }
    const response = await this.commit(actor, 'provider.outbox.ack',
      `ack:${stableDigest(input.inboxMessageId)}`, input, async (tx, at) => {
        const cursor = await tx.ackInbox(recipient, input.sequence, at)
        return {
          response: {
            protocolVersion: '1.0',
            type: 'provider.outbox.acked',
            ackedSequence: cursor.ackedSequence,
            nextSequence: cursor.nextSequence
          },
          resourceKind: 'provider_identity',
          resourceId: input.recipientId
        }
      })
    return { ackedSequence: Number(response.ackedSequence), nextSequence: Number(response.nextSequence) }
  }

  async setUserStatus(actor: AuthContext, input: {
    userId: string
    status: 'active' | 'suspended' | 'revoked'
    expectedRevision: number
    idempotencyKey: string
  }): Promise<StoredUser> {
    if (actor.kind !== 'system' && (actor.kind !== 'user' || actor.userId !== input.userId || actor.assurance !== 'strong')) {
      fail('permission_denied', 'Changing user lifecycle requires system authority or the same strong OIDC User Principal.')
    }
    return this.commit(actor, 'user.status.set', input.idempotencyKey, input, async (tx, at) => {
      const user = required(await tx.getUser(input.userId), 'User')
      expectRevision(user.revision, input.expectedRevision)
      if (user.status === 'revoked' && input.status !== 'revoked') fail('invalid_state_transition', 'A revoked user cannot be reactivated.')
      const updated: StoredUser = { ...user, status: input.status, revision: user.revision + 1, updatedAt: at,
        revokedAt: input.status === 'revoked' ? at : user.revokedAt }
      await tx.updateUser(updated, user.revision)
      return { response: entityResponse('user.updated', updated), resourceKind: 'user', resourceId: user.userId }
    }).then(responseEntity<StoredUser>)
  }

  async getUser(actor: AuthContext, userId: string): Promise<StoredUser> {
    if (actor.kind === 'system' || actor.userId !== userId) fail('permission_denied', 'A UserPrincipal is private to its user.')
    return required(await this.repository.getUser(userId), 'User')
  }

  async updateUser(actor: UserActor, input: {
    userId: string
    displayName?: string
    status?: 'active' | 'suspended' | 'revoked'
    expectedRevision: number
    idempotencyKey: string
  }): Promise<StoredUser> {
    if (actor.userId !== input.userId) fail('permission_denied', 'A user may only update their own principal.')
    if (input.status && input.status !== 'active' && actor.assurance !== 'strong') {
      fail('assurance_insufficient', 'Suspending or revoking a user requires strong assurance.')
    }
    if (input.displayName) assertText(input.displayName, 'displayName', 1, 200)
    return this.commit(actor, 'user.update', input.idempotencyKey, input, async (tx, at) => {
      const user = required(await tx.getUser(input.userId), 'User')
      expectRevision(user.revision, input.expectedRevision)
      if (user.status === 'revoked') fail('invalid_state_transition', 'A revoked user cannot be updated.')
      const status = input.status ?? user.status
      const updated: StoredUser = { ...user, displayName: input.displayName ?? user.displayName, status,
        revokedAt: status === 'revoked' ? at : user.revokedAt, revision: user.revision + 1, updatedAt: at }
      await tx.updateUser(updated, user.revision)
      return { response: entityResponse('user.updated', updated), resourceKind: 'user', resourceId: user.userId }
    }).then(responseEntity<StoredUser>)
  }

  async setEndpointStatus(actor: UserActor, input: {
    humanEndpointId: string
    status: 'active' | 'suspended' | 'revoked'
    expectedRevision: number
    idempotencyKey: string
  }): Promise<StoredEndpoint> {
    return this.commit(actor, 'endpoint.status.set', input.idempotencyKey, input, async (tx, at) => {
      const endpoint = required(await tx.getEndpoint(input.humanEndpointId), 'Human endpoint')
      if (endpoint.userId !== actor.userId) fail('permission_denied', 'The endpoint belongs to another user.')
      expectRevision(endpoint.revision, input.expectedRevision)
      if (endpoint.status === 'revoked' && input.status !== 'revoked') {
        fail('invalid_state_transition', 'A revoked endpoint must be verified again, not reactivated.')
      }
      const updated: StoredEndpoint = { ...endpoint, status: input.status, revision: endpoint.revision + 1,
        updatedAt: at, revokedAt: input.status === 'revoked' ? at : endpoint.revokedAt }
      await tx.updateEndpoint(updated, endpoint.revision)
      const notifications: Array<{ recipient: InboxRecipient; sequence: number }> = []
      const participant = await tx.getParticipant(actor.userId)
      if (participant?.primaryHumanEndpointId === endpoint.humanEndpointId && input.status !== 'active') {
        const changed = completeParticipant({ ...participant, primaryHumanEndpointId: undefined,
          revision: participant.revision + 1, updatedAt: at })
        await tx.upsertParticipant(changed, participant.revision)
      }
      if (input.status !== 'active') {
        notifications.push(...await this.pauseEndpointProjections(tx, endpoint, at, 'human_endpoint_inactive'))
        const container = await tx.getManagedContainerForOwner(actor.userId, endpoint.provider, endpoint.realmId)
        if (container?.humanEndpointId === endpoint.humanEndpointId && container.status !== 'archived') {
          await tx.updateManagedContainer({
            ...container,
            status: 'suspended',
            safeErrorCode: 'human_endpoint_inactive',
            revision: container.revision + 1,
            updatedAt: at
          }, container.revision)
        }
      }
      return { response: entityResponse('endpoint.updated', updated), resourceKind: 'human_endpoint',
        resourceId: endpoint.humanEndpointId, notifications }
    }).then(responseEntity<StoredEndpoint>)
  }

  async transferEndpoint(actor: UserActor, input: {
    humanEndpointId: string
    targetUserId: string
    expectedRevision: number
    idempotencyKey: string
  }): Promise<StoredEndpoint> {
    if (actor.assurance !== 'strong') fail('assurance_insufficient', 'Endpoint transfer requires strong assurance.')
    return this.commit(actor, 'endpoint.transfer', input.idempotencyKey, input, async (tx, at) => {
      const endpoint = required(await tx.getEndpoint(input.humanEndpointId), 'Human endpoint')
      if (endpoint.userId !== actor.userId) fail('permission_denied', 'Only the current endpoint owner may transfer it.')
      expectRevision(endpoint.revision, input.expectedRevision)
      const target = required(await tx.getUser(input.targetUserId), 'Target user')
      if (target.status !== 'active') fail('credential_revoked', 'The target user is not active.')
      const updated: StoredEndpoint = { ...endpoint, userId: target.userId, revision: endpoint.revision + 1, updatedAt: at }
      await tx.updateEndpoint(updated, endpoint.revision)
      const notifications = await this.pauseEndpointProjections(tx, endpoint, at, 'human_endpoint_transferred')
      const container = await tx.getManagedContainerForOwner(actor.userId, endpoint.provider, endpoint.realmId)
      if (container?.humanEndpointId === endpoint.humanEndpointId) {
        await tx.updateManagedContainer({
          ...container,
          ownerUserId: target.userId,
          revision: container.revision + 1,
          updatedAt: at
        }, container.revision)
      }
      for (const userId of [actor.userId, target.userId]) {
        const participant = await tx.getParticipant(userId)
        if (!participant) continue
        const changed = completeParticipant({ ...participant,
          primaryHumanEndpointId: userId === target.userId
            ? participant.primaryHumanEndpointId ?? endpoint.humanEndpointId
            : participant.primaryHumanEndpointId === endpoint.humanEndpointId ? undefined : participant.primaryHumanEndpointId,
          revision: participant.revision + 1, updatedAt: at })
        await tx.upsertParticipant(changed, participant.revision)
      }
      return { response: entityResponse('endpoint.transferred', updated), resourceKind: 'human_endpoint',
        resourceId: endpoint.humanEndpointId, notifications }
    }).then(responseEntity<StoredEndpoint>)
  }

  async registerAgent(actor: UserActor, input: {
    deviceId: string
    displayName: string
    nodeType: string
    capabilities: string[]
    credentialBootstrapPublicKey: AgentCredentialBootstrapPublicKey
    idempotencyKey: string
  }): Promise<{ agent: StoredAgent; sealedCredential?: AgentCredentialEnvelope; replayed?: boolean }> {
    assertText(input.displayName, 'displayName', 1, 200)
    assertText(input.nodeType, 'nodeType', 1, 100)
    const capabilities = uniqueTexts(input.capabilities, 100, 200)
    return this.commit(actor, 'agent.register', input.idempotencyKey, { ...input, capabilities }, async (tx, at) => {
      const device = required(await tx.getDeviceForUpdate(input.deviceId), 'Device')
      if (device.userId !== actor.userId || device.status !== 'active') {
        fail('permission_denied', 'The Agent Device is not active for this User.')
      }
      const existing = (await tx.listAgentsForDevice(device.deviceId)).find((agent) => (
        agent.status === 'active'
      ))
      if (existing) {
        fail('identity_conflict', 'This Device already owns its single Agent identity.')
      }
      const agent: StoredAgent = {
        agentId: newId('agt'), deviceId: device.deviceId, ownerUserId: actor.userId,
        displayName: input.displayName, nodeType: input.nodeType, capabilities, status: 'active',
        connectionStatus: 'offline', credentialGeneration: 1, revision: 1, updatedAt: at
      }
      const deviceCredential = issueSecret('agent')
      let sealedCredential: AgentCredentialEnvelope
      try {
        sealedCredential = sealAgentCredential({ credential: deviceCredential,
          recipientPublicKey: input.credentialBootstrapPublicKey, agentId: agent.agentId,
          deviceId: device.deviceId, credentialGeneration: agent.credentialGeneration, issuedAt: at })
      } catch {
        fail('validation_failed', 'The Agent credential bootstrap public key is invalid.')
      }
      await tx.insertAgent(agent)
      await tx.insertCredential({ credentialId: newId('credential'), kind: 'agent_device', subjectUserId: actor.userId,
        subjectAgentId: agent.agentId, tokenDigest: digestSecret(deviceCredential), assurance: 'device', generation: 1, createdAt: at })
      const participant = await tx.getParticipant(actor.userId)
      const changed = completeParticipant({ userId: actor.userId,
        primaryHumanEndpointId: participant?.primaryHumanEndpointId,
        primaryAgentId: participant?.primaryAgentId ?? agent.agentId,
        status: 'incomplete', revision: (participant?.revision ?? 0) + 1, updatedAt: at })
      await tx.upsertParticipant(changed, participant?.revision ?? null)
      return {
        response: { protocolVersion: '1.0', type: 'agent.registered', agent, sealedCredential },
        receiptResponse: { protocolVersion: '1.0', type: 'agent.registered', agent, replayed: true },
        resourceKind: 'agent', resourceId: agent.agentId
      }
    }).then((response) => ({
      agent: response.agent as StoredAgent,
      ...(response.sealedCredential ? { sealedCredential: response.sealedCredential as AgentCredentialEnvelope } : {}),
      ...(response.replayed === true ? { replayed: true } : {})
    }))
  }

  async heartbeatAgent(actor: AgentActor, input: {
    expectedRevision: number
    connectionStatus?: 'online' | 'offline'
    capabilities?: string[]
    idempotencyKey: string
  }): Promise<StoredAgent> {
    return this.commit(actor, 'agent.heartbeat', input.idempotencyKey, input, async (tx, at) => {
      const agent = required(await tx.getAgent(actor.agentId), 'Agent')
      if (agent.deviceId !== actor.deviceId || actor.credentialGeneration !== agent.credentialGeneration) {
        fail('credential_revoked', 'The Agent machine credential is no longer current.')
      }
      const device = required(await tx.getDeviceForUpdate(actor.deviceId), 'Agent Device')
      if (device.userId !== actor.userId || device.status !== 'active') {
        fail('credential_revoked', 'The Agent Device is no longer active.')
      }
      expectRevision(agent.revision, input.expectedRevision)
      const capabilities = input.capabilities ? uniqueTexts(input.capabilities, 256, 128) : agent.capabilities
      const updated: StoredAgent = { ...agent, connectionStatus: input.connectionStatus ?? 'online', capabilities, lastSeenAt: at,
        revision: agent.revision + 1, updatedAt: at }
      await tx.updateAgent(updated, agent.revision)
      const notifications: Array<{ recipient: InboxRecipient; sequence: number }> = []
      if (updated.connectionStatus === 'offline') {
        for (const project of await tx.listActiveProjectsForCoordinator(agent.agentId)) {
          const paused = { ...project, status: 'paused' as const, revision: project.revision + 1, updatedAt: at }
          await tx.updateProject(paused, project.revision)
          const message = await this.appendInbox(tx, { kind: 'user', id: project.ownerUserId },
            'collaboration.important_failure', { protocolVersion: '1.0', type: 'collaboration.important_failure',
              projectId: project.projectId, safeMessage: 'The Coordinator Agent is offline; the Project was paused and requires explicit resume or transfer.' }, at)
          notifications.push({ recipient: message.recipient, sequence: message.sequence })
        }
      }
      return { response: entityResponse('agent.heartbeat.accepted', updated), resourceKind: 'agent',
        resourceId: agent.agentId, notifications }
    }).then(responseEntity<StoredAgent>)
  }

  async rotateAgentCredential(actor: UserActor, input: {
    agentId: string
    expectedRevision: number
    credentialBootstrapPublicKey: AgentCredentialBootstrapPublicKey
    idempotencyKey: string
  }): Promise<{ agent: StoredAgent; sealedCredential?: AgentCredentialEnvelope; replayed?: boolean }> {
    return this.commit(actor, 'agent.credential.rotate', input.idempotencyKey, input, async (tx, at) => {
      const agent = required(await tx.getAgentForUpdate(input.agentId), 'Agent')
      if (agent.ownerUserId !== actor.userId) fail('permission_denied', 'The Agent belongs to another user.')
      if (!agent.deviceId) fail('credential_revoked', 'The Agent is not bound to a Device.')
      const device = required(await tx.getDeviceForUpdate(agent.deviceId), 'Agent Device')
      if (device.userId !== actor.userId || device.status !== 'active') {
        fail('credential_revoked', 'The Agent Device is no longer active.')
      }
      expectRevision(agent.revision, input.expectedRevision)
      await tx.revokeAgentCredentials(agent.agentId, at)
      const updated: StoredAgent = { ...agent, credentialGeneration: agent.credentialGeneration + 1,
        connectionStatus: 'offline', revision: agent.revision + 1, updatedAt: at }
      const deviceCredential = issueSecret('agent')
      let sealedCredential: AgentCredentialEnvelope
      try {
        sealedCredential = sealAgentCredential({ credential: deviceCredential,
          recipientPublicKey: input.credentialBootstrapPublicKey, agentId: updated.agentId,
          deviceId: device.deviceId, credentialGeneration: updated.credentialGeneration, issuedAt: at })
      } catch {
        fail('validation_failed', 'The Agent credential bootstrap public key is invalid.')
      }
      await tx.updateAgent(updated, agent.revision)
      await tx.insertCredential({ credentialId: newId('credential'), kind: 'agent_device', subjectUserId: actor.userId,
        subjectAgentId: agent.agentId, tokenDigest: digestSecret(deviceCredential), assurance: 'device',
        generation: updated.credentialGeneration, createdAt: at })
      return { response: { protocolVersion: '1.0', type: 'agent.credential_rotated', agent: updated, sealedCredential },
        receiptResponse: { protocolVersion: '1.0', type: 'agent.credential_rotated', agent: updated, replayed: true },
        resourceKind: 'agent', resourceId: agent.agentId }
    }).then((response) => ({ agent: response.agent as StoredAgent,
      ...(response.sealedCredential ? { sealedCredential: response.sealedCredential as AgentCredentialEnvelope } : {}),
      ...(response.replayed === true ? { replayed: true } : {}) }))
  }

  async revokeAgent(actor: UserActor, input: {
    agentId: string
    expectedRevision: number
    idempotencyKey: string
  }): Promise<StoredAgent> {
    const updated = await this.commit(actor, 'agent.revoke', input.idempotencyKey, input, async (tx, at) => {
      const agent = required(await tx.getAgent(input.agentId), 'Agent')
      if (agent.ownerUserId !== actor.userId) fail('permission_denied', 'The Agent belongs to another user.')
      expectRevision(agent.revision, input.expectedRevision)
      const revoked = await revokeAgentAuthorityInTransaction({
        tx,
        agent,
        reason: 'agent_revoked',
        at,
        appendInbox: (recipient, messageType, payload, createdAt) => (
          this.appendInbox(tx, recipient, messageType, payload, createdAt)
        )
      })
      return {
        response: entityResponse('agent.revoked', revoked.agent),
        resourceKind: 'agent',
        resourceId: agent.agentId,
        notifications: revoked.notifications
      }
    }).then(responseEntity<StoredAgent>)
    await Promise.resolve()
      .then(() => this.notifier?.disconnectAgentAuthority?.(updated.agentId))
      .catch(() => undefined)
    return updated
  }

  async selectPrimary(actor: UserActor, input: {
    primaryHumanEndpointId?: string | null
    primaryAgentId?: string | null
    expectedRevision: number | null
    idempotencyKey: string
  }): Promise<StoredParticipant> {
    return this.commit(actor, 'participant.primary.select', input.idempotencyKey, input, async (tx, at) => {
      const existing = await tx.getParticipant(actor.userId)
      if ((existing?.revision ?? null) !== input.expectedRevision) {
        fail('revision_conflict', 'The Participant profile revision changed.', { details: { currentRevision: existing?.revision ?? null } })
      }
      const endpointId = input.primaryHumanEndpointId === null ? undefined
        : input.primaryHumanEndpointId ?? existing?.primaryHumanEndpointId
      const agentId = input.primaryAgentId === null ? undefined : input.primaryAgentId ?? existing?.primaryAgentId
      if (endpointId) {
        const endpoint = required(await tx.getEndpoint(endpointId), 'Human endpoint')
        if (endpoint.userId !== actor.userId || endpoint.status !== 'active') fail('permission_denied', 'Primary endpoint must be active and owned by the user.')
      }
      if (agentId) {
        const agent = required(await tx.getAgent(agentId), 'Agent')
        if (agent.ownerUserId !== actor.userId || agent.status !== 'active') fail('permission_denied', 'Primary Agent must be active and owned by the user.')
      }
      const participant = completeParticipant({ userId: actor.userId, primaryHumanEndpointId: endpointId,
        primaryAgentId: agentId, status: 'incomplete', revision: (existing?.revision ?? 0) + 1, updatedAt: at })
      await tx.upsertParticipant(participant, existing?.revision ?? null)
      return { response: entityResponse('participant.updated', participant), resourceKind: 'participant', resourceId: actor.userId }
    }).then(responseEntity<StoredParticipant>)
  }

  async getParticipantSnapshot(actor: AuthContext, userId: string): Promise<{
    user: StoredUser
    participant: StoredParticipant
    humanEndpoints: StoredEndpoint[]
    agents: StoredAgent[]
  }> {
    if (actor.kind === 'system' || actor.userId !== userId) fail('permission_denied', 'A Participant snapshot is private to its user.')
    const [user, participant, humanEndpoints, agents] = await Promise.all([
      this.repository.getUser(userId), this.repository.getParticipant(userId),
      this.repository.listEndpointsForUser(userId), this.repository.listAgentsForUser(userId)
    ])
    return { user: required(user, 'User'), participant: required(participant, 'Participant'), humanEndpoints, agents }
  }

  async createProjection(actor: UserActor, input: {
    agentId: string
    humanEndpointId: string
    locator: ProviderLocatorValue
    displayName: string
    allowedSenderUserIds: string[]
    idempotencyKey: string
  }): Promise<StoredProjection> {
    assertText(input.displayName, 'displayName', 1, 200)
    const allowed = [...new Set([actor.userId, ...input.allowedSenderUserIds])]
    if (allowed.length > 100) fail('validation_failed', 'A shared Session may allow at most 100 users.')
    if (allowed.length !== 1) {
      fail('permission_denied', 'A personal managed Channel projection may only authorize its owner.')
    }
    return this.commit(actor, 'projection.create', input.idempotencyKey, { ...input, allowedSenderUserIds: allowed }, async (tx, at) => {
      await lockProviderLocator(tx, input.locator)
      const agent = required(await tx.getAgent(input.agentId), 'Projection Agent')
      const endpoint = required(await tx.getEndpoint(input.humanEndpointId), 'Projection endpoint')
      if (agent.ownerUserId !== actor.userId || agent.status !== 'active') fail('permission_denied', 'Projection Agent must be active and owned by the user.')
      if (endpoint.userId !== actor.userId || endpoint.status !== 'active') fail('permission_denied', 'Projection endpoint must be active and owned by the user.')
      if (endpoint.provider !== input.locator.provider || endpoint.realmId !== input.locator.realmId) {
        fail('validation_failed', 'Projection locator must use the bound endpoint provider and realm.')
      }
      await requireOwnedManagedLocator(tx, actor.userId, endpoint, input.locator)
      for (const userId of allowed) required(await tx.getUser(userId), 'Allowed sender')
      if (await tx.getProjectionByLocator(input.locator.provider, input.locator.realmId, input.locator.containerId, input.locator.topicId)) {
        fail('identity_conflict', 'This provider locator already resolves to a personal Session projection.')
      }
      if (await tx.getProjectBindingByLocator(input.locator.provider, input.locator.realmId, input.locator.containerId, input.locator.topicId)) {
        fail('identity_conflict', 'This provider locator already resolves to a Project topic.')
      }
      const projection: StoredProjection = { projectionId: newId('rsp'), ownerUserId: actor.userId,
        agentId: agent.agentId, humanEndpointId: endpoint.humanEndpointId, locator: input.locator, locatorRevision: 1,
        displayName: input.displayName, status: 'active', allowedSenderUserIds: allowed,
        revision: 1, createdAt: at, updatedAt: at }
      await tx.insertProjection(projection)
      return { response: entityResponse('projection.created', projection), resourceKind: 'projection', resourceId: projection.projectionId }
    }).then(responseEntity<StoredProjection>)
  }

  async updateProjection(actor: UserActor, input: {
    projectionId: string
    expectedRevision: number
    displayName?: string
    status?: 'active' | 'paused' | 'closed'
    locator?: ProviderLocatorValue
    locatorRevision?: number
    allowedSenderUserIds?: string[]
    idempotencyKey: string
  }): Promise<StoredProjection> {
    return this.commit(actor, 'projection.update', input.idempotencyKey, input, async (tx, at) => {
      const projection = required(await tx.getProjection(input.projectionId), 'Projection')
      if (projection.ownerUserId !== actor.userId) fail('permission_denied', 'Only the projection owner may update it.')
      expectRevision(projection.revision, input.expectedRevision)
      if (
        projection.status === 'closed' &&
        (
          input.status !== 'paused' ||
          input.displayName !== undefined ||
          input.locator !== undefined ||
          input.allowedSenderUserIds !== undefined
        )
      ) {
        fail('invalid_state_transition', 'A closed projection can only be restored to paused before reactivation.')
      }
      if (input.displayName) assertText(input.displayName, 'displayName', 1, 200)
      let locator = projection.locator
      let locatorRevision = projection.locatorRevision
      if (input.locator) {
        await lockProviderLocator(tx, input.locator)
        if (input.locatorRevision !== projection.locatorRevision) fail('revision_conflict', 'The locator revision is stale.')
        const endpoint = required(await tx.getEndpoint(projection.humanEndpointId), 'Projection endpoint')
        if (endpoint.provider !== input.locator.provider || endpoint.realmId !== input.locator.realmId) {
          fail('validation_failed', 'Updated locator must remain in the verified endpoint provider realm.')
        }
        await requireOwnedManagedLocator(tx, actor.userId, endpoint, input.locator)
        const otherProjection = await tx.getProjectionByLocator(input.locator.provider, input.locator.realmId,
          input.locator.containerId, input.locator.topicId)
        if (otherProjection && otherProjection.projectionId !== projection.projectionId) {
          fail('identity_conflict', 'The provider locator belongs to another personal Session projection.')
        }
        if (await tx.getProjectBindingByLocator(input.locator.provider, input.locator.realmId,
          input.locator.containerId, input.locator.topicId)) {
          fail('identity_conflict', 'The provider locator belongs to a Project topic.')
        }
        locator = input.locator
        locatorRevision += 1
      }
      const allowed = input.allowedSenderUserIds
        ? [...new Set([actor.userId, ...input.allowedSenderUserIds])]
        : projection.allowedSenderUserIds
      if (allowed.length > 100) fail('validation_failed', 'A shared Session may allow at most 100 users.')
      if (allowed.length !== 1) {
        fail('permission_denied', 'A personal managed Channel projection may only authorize its owner.')
      }
      const updated: StoredProjection = { ...projection, locator, locatorRevision,
        displayName: input.displayName ?? projection.displayName, status: input.status ?? projection.status,
        allowedSenderUserIds: allowed, revision: projection.revision + 1, updatedAt: at }
      await tx.updateProjection(updated, projection.revision)
      return { response: entityResponse('projection.updated', updated), resourceKind: 'projection', resourceId: projection.projectionId }
    }).then(responseEntity<StoredProjection>)
  }

  async getProjection(actor: AuthContext, projectionId: string): Promise<StoredProjection> {
    if (actor.kind === 'system') fail('permission_denied', 'System context cannot read a private projection.')
    const projection = required(await this.repository.getProjection(projectionId), 'Projection')
    if (!projection.allowedSenderUserIds.includes(actor.userId)) fail('permission_denied', 'The projection is not shared with this user.')
    return projection
  }

  async listProjections(actor: AuthContext, ownerUserId: string): Promise<StoredProjection[]> {
    if (actor.kind === 'system' || actor.userId !== ownerUserId) fail('permission_denied', 'Only the owner may list private projections.')
    return this.repository.listProjectionsForOwner(ownerUserId)
  }

  async publishProjectionMessage(actor: AgentActor, input: {
    projectionId: string
    projectionRevision: number
    localItemId: string
    localTurnId?: string
    kind: 'user_message' | 'assistant_progress' | 'assistant_final' | 'system_status'
    text: string
    occurredAt: string
    idempotencyKey: string
  }): Promise<Record<string, unknown>> {
    assertText(input.text, 'text', 1, 32_000)
    return this.commit(actor, 'projection.message.publish', input.idempotencyKey, input, async (tx, at) => {
      const projection = required(await tx.getProjection(input.projectionId), 'Projection')
      if (projection.agentId !== actor.agentId || projection.ownerUserId !== actor.userId) {
        fail('permission_denied', 'Only the fixed projection Agent may publish this Session message.')
      }
      expectRevision(projection.revision, input.projectionRevision)
      if (projection.status !== 'active') fail('invalid_state_transition', 'Projection messages require an active projection.')
      const payload = { protocolVersion: '1.0', type: 'projection.message.outbound', projectionId: projection.projectionId,
        projectionRevision: projection.revision, locator: projection.locator, localItemId: input.localItemId,
        ...(input.localTurnId ? { localTurnId: input.localTurnId } : {}), kind: input.kind, text: input.text,
        occurredAt: input.occurredAt }
      const message = await this.appendInbox(tx, { kind: 'human_endpoint', id: projection.humanEndpointId },
        'projection.message.outbound', payload, at)
      return { response: { protocolVersion: '1.0', type: 'projection.message.accepted',
        projectionId: projection.projectionId, localItemId: input.localItemId, inboxSequence: message.sequence },
        resourceKind: 'projection', resourceId: projection.projectionId,
        notifications: [{ recipient: message.recipient, sequence: message.sequence }] }
    })
  }

  async acceptPersonalProviderMessage(actor: HumanEndpointActor, input: {
    locator: ProviderLocatorValue
    providerMessageId: string
    text: string
    occurredAt: string
    providerEventId: string
  }): Promise<Record<string, unknown>> {
    assertText(input.text, 'text', 1, 32_000)
    return this.commit(actor, 'personal.message.receive', `idem_${stableDigest(input.providerEventId)}`, input, async (tx, at) => {
      const projection = await tx.getProjectionByLocator(input.locator.provider, input.locator.realmId,
        input.locator.containerId, input.locator.topicId)
      if (!projection) fail('not_found', 'The provider locator does not uniquely resolve to a personal Session.')
      authorize({ actor, operation: 'personal_message', resourceOwnerUserId: projection.ownerUserId,
        senderAllowedByProjection: projection.allowedSenderUserIds.includes(actor.userId) })
      if (projection.status !== 'active') fail('invalid_state_transition', 'The personal Session projection is not active.')
      const message = await this.appendInbox(tx, { kind: 'agent', id: projection.agentId }, 'personal.message.received', {
        protocolVersion: '1.0', type: 'personal.message.received', projectionId: projection.projectionId,
        projectionRevision: projection.revision, senderUserId: actor.userId, humanEndpointId: actor.humanEndpointId,
        providerMessageId: input.providerMessageId, text: input.text, occurredAt: input.occurredAt
      }, at)
      return { response: { protocolVersion: '1.0', type: 'personal.message.accepted', projectionId: projection.projectionId,
        inboxMessageId: message.messageId, sequence: message.sequence }, resourceKind: 'projection',
        resourceId: projection.projectionId, notifications: [{ recipient: message.recipient, sequence: message.sequence }] }
    })
  }

  async applyProviderLocatorChange(input: {
    previousLocator: ProviderLocatorValue
    currentLocator: ProviderLocatorValue
    providerEventId: string
  }): Promise<{ kind: 'personal_projection' | 'project'; resourceId: string }> {
    if (input.previousLocator.provider !== input.currentLocator.provider ||
        input.previousLocator.realmId !== input.currentLocator.realmId ||
        input.previousLocator.topicId !== input.currentLocator.topicId) {
      fail('validation_failed', 'A provider locator change must preserve provider, realm, and stable topic ID.')
    }
    const actor: AuthContext = { kind: 'system',
      actorKey: `provider-locator:${input.currentLocator.provider}:${stableDigest(input.providerEventId)}` }
    return this.commit(actor, 'provider.locator.changed', `idem_${stableDigest(input.providerEventId)}`, input, async (tx, at) => {
      await lockProviderLocators(tx, [input.previousLocator, input.currentLocator])
      const [projection, projectBinding] = await Promise.all([
        tx.getProjectionByLocator(input.previousLocator.provider, input.previousLocator.realmId,
          input.previousLocator.containerId, input.previousLocator.topicId),
        tx.getProjectBindingByLocator(input.previousLocator.provider, input.previousLocator.realmId,
          input.previousLocator.containerId, input.previousLocator.topicId)
      ])
      const [currentProjection, currentProject] = await Promise.all([
        tx.getProjectionByLocator(input.currentLocator.provider, input.currentLocator.realmId,
          input.currentLocator.containerId, input.currentLocator.topicId),
        tx.getProjectBindingByLocator(input.currentLocator.provider, input.currentLocator.realmId,
          input.currentLocator.containerId, input.currentLocator.topicId)
      ])
      if (projection && projectBinding) {
        fail('identity_conflict', 'The previous locator ambiguously resolves to multiple collaboration targets.')
      }
      if (!projection && !projectBinding) {
        if (Boolean(currentProjection) === Boolean(currentProject)) {
          fail(currentProjection ? 'identity_conflict' : 'not_found', currentProjection
            ? 'The current locator ambiguously resolves to multiple collaboration targets.'
            : 'Neither locator resolves to an active collaboration target.')
        }
        const kind = currentProjection ? 'personal_projection' as const : 'project' as const
        const resourceId = currentProjection ? currentProjection.projectionId : currentProject!.projectId
        return { response: { protocolVersion: '1.0', type: 'provider.locator.applied', kind, resourceId },
          resourceKind: currentProjection ? 'projection' : 'project_endpoint_binding',
          resourceId: currentProjection ? currentProjection.projectionId : currentProject!.projectEndpointBindingId }
      }
      if (projection) {
        if (stableDigest(projection.locator) === stableDigest(input.currentLocator)) {
          return { response: { protocolVersion: '1.0', type: 'provider.locator.applied',
            kind: 'personal_projection', resourceId: projection.projectionId },
          resourceKind: 'projection', resourceId: projection.projectionId }
        }
        if (stableDigest(projection.locator) !== stableDigest(input.previousLocator)) {
          fail('revision_conflict', 'The stored projection locator no longer matches the confirmed previous locator.')
        }
        if ((currentProjection && currentProjection.projectionId !== projection.projectionId) || currentProject) {
          fail('identity_conflict', 'The new locator already belongs to another collaboration target.')
        }
        if (projection.status === 'closed') fail('invalid_state_transition', 'A closed projection cannot move.')
        const endpoint = required(await tx.getEndpoint(projection.humanEndpointId), 'Projection endpoint')
        await requireOwnedManagedLocator(tx, projection.ownerUserId, endpoint, input.currentLocator)
        const updated: StoredProjection = { ...projection, locator: input.currentLocator,
          locatorRevision: projection.locatorRevision + 1, revision: projection.revision + 1,
          lastErrorCode: undefined, updatedAt: at }
        await tx.updateProjection(updated, projection.revision)
        const message = await this.appendInbox(tx, { kind: 'agent', id: projection.agentId }, 'projection.updated', {
          protocolVersion: '1.0', type: 'projection.updated', projectionId: projection.projectionId,
          revision: updated.revision
        }, at)
        return { response: { protocolVersion: '1.0', type: 'provider.locator.applied',
          kind: 'personal_projection', resourceId: projection.projectionId },
        resourceKind: 'projection', resourceId: projection.projectionId,
        notifications: [{ recipient: message.recipient, sequence: message.sequence }] }
      }
      const binding = projectBinding!
      if (stableDigest(binding.locator) === stableDigest(input.currentLocator)) {
        return { response: { protocolVersion: '1.0', type: 'provider.locator.applied',
          kind: 'project', resourceId: binding.projectId },
        resourceKind: 'project_endpoint_binding', resourceId: binding.projectEndpointBindingId }
      }
      if (stableDigest(binding.locator) !== stableDigest(input.previousLocator)) {
        fail('revision_conflict', 'The stored Project locator no longer matches the confirmed previous locator.')
      }
      if (currentProjection || (currentProject && currentProject.projectEndpointBindingId !== binding.projectEndpointBindingId)) {
        fail('identity_conflict', 'The new locator already belongs to another collaboration target.')
      }
      if (binding.status === 'closed') fail('invalid_state_transition', 'A closed Project endpoint binding cannot move.')
      const updated: StoredProjectEndpointBinding = { ...binding, locator: input.currentLocator,
        locatorRevision: binding.locatorRevision + 1, revision: binding.revision + 1,
        lastErrorCode: undefined, updatedAt: at }
      await tx.upsertProjectEndpointBinding(updated, binding.revision)
      const project = required(await tx.getProject(binding.projectId), 'Project')
      const message = await this.appendInbox(tx, { kind: 'agent', id: project.coordinatorAgentId },
        'project.endpoint.updated', {
          protocolVersion: '1.0', type: 'project.endpoint.updated', projectId: binding.projectId,
          projectEndpointBindingId: binding.projectEndpointBindingId, revision: updated.revision,
          locatorRevision: updated.locatorRevision
        }, at)
      return { response: { protocolVersion: '1.0', type: 'provider.locator.applied',
        kind: 'project', resourceId: binding.projectId },
      resourceKind: 'project_endpoint_binding', resourceId: binding.projectEndpointBindingId,
      notifications: [{ recipient: message.recipient, sequence: message.sequence }] }
    }).then((response) => ({ kind: response.kind as 'personal_projection' | 'project', resourceId: String(response.resourceId) }))
  }

  async bindProjectEndpoint(actor: UserActor, input: {
    projectId: string
    locator: ProviderLocatorValue
    expectedRevision: number | null
    idempotencyKey: string
  }): Promise<StoredProjectEndpointBinding> {
    return this.commit(actor, 'project.endpoint.bind', input.idempotencyKey, input, async (tx, at) => {
      await lockProviderLocator(tx, input.locator)
      const project = required(await tx.getProject(input.projectId), 'Project')
      authorize({ actor, operation: 'project_admin',
        projectRole: project.ownerUserId === actor.userId ? 'owner' : undefined })
      const existing = await tx.getProjectEndpointBinding(project.projectId)
      if ((existing?.revision ?? null) !== input.expectedRevision) fail('revision_conflict', 'The Project endpoint binding revision is stale.')
      if (await tx.getProjectionByLocator(input.locator.provider, input.locator.realmId, input.locator.containerId, input.locator.topicId)) {
        fail('identity_conflict', 'The provider locator belongs to a personal Session projection.')
      }
      const otherProject = await tx.getProjectBindingByLocator(input.locator.provider, input.locator.realmId,
        input.locator.containerId, input.locator.topicId)
      if (otherProject && otherProject.projectId !== project.projectId) fail('identity_conflict', 'The provider locator belongs to another Project.')
      const binding: StoredProjectEndpointBinding = existing
        ? { ...existing, locator: input.locator, locatorRevision: existing.locatorRevision + 1,
            status: 'active', lastErrorCode: undefined, revision: existing.revision + 1, updatedAt: at }
        : { projectEndpointBindingId: newId('peb'), projectId: project.projectId, locator: input.locator,
            locatorRevision: 1, status: 'active', revision: 1, createdAt: at, updatedAt: at }
      await tx.upsertProjectEndpointBinding(binding, existing?.revision ?? null)
      return { response: entityResponse('project_endpoint.updated', binding), resourceKind: 'project_endpoint_binding',
        resourceId: binding.projectEndpointBindingId }
    }).then(responseEntity<StoredProjectEndpointBinding>)
  }

  async getProjectEndpointBinding(actor: AuthContext, projectId: string): Promise<StoredProjectEndpointBinding> {
    if (actor.kind === 'system') fail('permission_denied', 'System context cannot read Project bindings.')
    const member = await this.repository.getProjectMember(projectId, actor.userId)
    authorize({ actor, operation: 'project_read', projectMember: member?.state === 'active' })
    return required(await this.repository.getProjectEndpointBinding(projectId), 'Project endpoint binding')
  }

  async updateProjectEndpointBinding(actor: UserActor, input: {
    projectEndpointBindingId: string
    expectedRevision: number
    locator?: ProviderLocatorValue
    locatorRevision?: number
    status?: 'active' | 'closed'
    idempotencyKey: string
  }): Promise<StoredProjectEndpointBinding> {
    return this.commit(actor, 'project.endpoint.update', input.idempotencyKey, input, async (tx, at) => {
      const binding = required(await tx.getProjectEndpointBindingById(input.projectEndpointBindingId),
        'Project endpoint binding')
      const project = required(await tx.getProject(binding.projectId), 'Project')
      authorize({ actor, operation: 'project_admin',
        projectRole: project.ownerUserId === actor.userId ? 'owner' : undefined })
      expectRevision(binding.revision, input.expectedRevision)
      if (binding.status === 'closed' && input.status !== 'closed') {
        fail('invalid_state_transition', 'A closed Project endpoint binding cannot be reopened.')
      }
      let locator = binding.locator
      let locatorRevision = binding.locatorRevision
      if (input.locator) {
        await lockProviderLocator(tx, input.locator)
        if (input.locatorRevision !== binding.locatorRevision) {
          fail('revision_conflict', 'The Project endpoint locator revision is stale.')
        }
        const projection = await tx.getProjectionByLocator(input.locator.provider, input.locator.realmId,
          input.locator.containerId, input.locator.topicId)
        if (projection) fail('identity_conflict', 'The provider locator belongs to a personal Session projection.')
        const otherProject = await tx.getProjectBindingByLocator(input.locator.provider, input.locator.realmId,
          input.locator.containerId, input.locator.topicId)
        if (otherProject && otherProject.projectEndpointBindingId !== binding.projectEndpointBindingId) {
          fail('identity_conflict', 'The provider locator belongs to another Project.')
        }
        locator = input.locator
        locatorRevision += 1
      } else if (input.locatorRevision !== undefined) {
        fail('validation_failed', 'locatorRevision is only valid together with a new locator.')
      }
      if (!input.locator && input.status === undefined) fail('validation_failed', 'Project endpoint update has no changes.')
      const updated: StoredProjectEndpointBinding = { ...binding, locator, locatorRevision,
        status: input.status ?? binding.status, lastErrorCode: undefined,
        revision: binding.revision + 1, updatedAt: at }
      await tx.upsertProjectEndpointBinding(updated, binding.revision)
      return { response: entityResponse('project_endpoint.updated', updated), resourceKind: 'project_endpoint_binding',
        resourceId: updated.projectEndpointBindingId }
    }).then(responseEntity<StoredProjectEndpointBinding>)
  }

  async acceptProjectInput(actor: HumanEndpointActor, input: {
    locator?: ProviderLocatorValue
    projectId?: string
    providerMessageId: string
    text: string
    occurredAt: string
    providerEventId?: string
    idempotencyKey?: string
  }): Promise<StoredProjectInput> {
    assertText(input.text, 'text', 1, 32_000)
    if ((input.locator === undefined) === (input.projectId === undefined)) {
      fail('validation_failed', 'Project input requires exactly one locator or Project ID target.')
    }
    const idempotencyKey = input.idempotencyKey ?? `idem_${stableDigest(required(input.providerEventId ?? null, 'Provider event ID'))}`
    return this.commit(actor, 'project.input.create', idempotencyKey, input, async (tx, at) => {
      const binding = input.locator
        ? await tx.getProjectBindingByLocator(input.locator.provider, input.locator.realmId,
            input.locator.containerId, input.locator.topicId)
        : await tx.getProjectEndpointBinding(input.projectId!)
      if (!binding || binding.status !== 'active') fail('not_found', 'The provider locator does not uniquely resolve to an active Project topic.')
      if (input.projectId && binding.projectId !== input.projectId) fail('not_found', 'The active Project endpoint binding does not match this Project.')
      const project = required(await tx.getProject(binding.projectId), 'Project')
      const member = await tx.getProjectMember(project.projectId, actor.userId)
      authorize({ actor, operation: 'project_input', projectMember: member?.state === 'active' })
      const existing = await tx.getProjectInputByProviderMessage(actor.humanEndpointId, input.providerMessageId)
      if (existing) return { response: entityResponse('project_input.created', existing), resourceKind: 'project_input',
        resourceId: existing.projectInputId }
      const projectInput = await tx.insertProjectInput({ projectInputId: newId('pin'), projectId: project.projectId,
        senderUserId: actor.userId, sourceHumanEndpointId: actor.humanEndpointId,
        providerMessageId: input.providerMessageId, text: input.text, status: 'queued', revision: 1,
        occurredAt: input.occurredAt, createdAt: at, updatedAt: at })
      const message = await this.appendInbox(tx, { kind: 'agent', id: project.coordinatorAgentId }, 'project.input.received', {
        protocolVersion: '1.0', type: 'project.input.received', projectId: project.projectId,
        projectInputId: projectInput.projectInputId, revision: projectInput.revision
      }, at)
      return { response: entityResponse('project_input.created', projectInput), resourceKind: 'project_input',
        resourceId: projectInput.projectInputId, notifications: [{ recipient: message.recipient, sequence: message.sequence }] }
    }).then(responseEntity<StoredProjectInput>)
  }

  async createHumanNeeded(
    actor: AgentActor,
    input: RestCommand<'human.needed.create'>
  ): Promise<StoredHumanRequest> {
    assertText(input.prompt, 'prompt', 1, 32_000)
    const confirmableAction = input.confirmableAction == null
      ? null
      : confirmableHumanActionSchema.parse(input.confirmableAction)
    return this.commit(actor, 'human.needed.create', input.idempotencyKey, input, async (tx, at) => {
      const project = required(await tx.getProjectForUpdate(input.projectId), 'Project')
      const targetUserId = project.ownerUserId
      if (new Date(input.expiresAt).getTime() <= new Date(at).getTime()) fail('request_expired', 'HumanNeeded expiry must be in the future.')
      let context: StoredHumanRequest['context']
      let workerContext: Readonly<{ task: StoredTask; execution: StoredTaskExecution }> | null = null
      if (input.context.scope === 'worker_execution') {
        const task = required(await tx.getTaskForUpdate(input.context.taskId), 'Task')
        if (task.projectId !== project.projectId) fail('validation_failed', 'The Task belongs to another Project.')
        expectRevision(task.revision, input.context.expectedTaskRevision)
        const execution = required(await tx.getTaskExecutionForUpdate(input.context.executionId), 'Task execution')
        expectRevision(execution.revision, input.context.expectedExecutionRevision)
        if (
          task.currentExecutionId !== execution.executionId ||
          execution.taskId !== task.taskId ||
          execution.assigneeAgentId !== actor.agentId ||
          execution.assigneeUserId !== actor.userId ||
          execution.assigneeDeviceId !== actor.deviceId ||
          execution.fence.status !== 'open'
        ) {
          fail('revision_conflict', 'HumanNeeded must target the exact current unfenced Worker execution.')
        }
        const member = await tx.getProjectMember(project.projectId, actor.userId)
        authorize({ actor, operation: 'human_needed', assigneeAgentId: execution.assigneeAgentId,
          projectMember: member?.state === 'active' })
        if (task.status !== 'in_progress' || execution.state !== 'running') {
          fail('invalid_state_transition', 'Worker HumanNeeded requires the exact running Task execution.')
        }
        context = { scope: 'worker_execution', taskId: task.taskId, executionId: execution.executionId }
        workerContext = { task, execution }
      } else {
        await requireActiveCoordinatorAgent(
          tx,
          project,
          actor,
          input.context.expectedProjectRevision,
          input.context.expectedCoordinatorAuthorityEpoch
        )
        if (project.status !== 'active') {
          fail('invalid_state_transition', 'Coordinator HumanNeeded requires an active Project.')
        }
        context = {
          scope: 'coordinator_project',
          coordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch
        }
      }
      const request: StoredHumanRequest = { humanRequestId: newId('hrq'), projectId: project.projectId,
        context,
        targetUserId, requestedByAgentId: actor.agentId,
        requiredAssurance: input.requiredAssurance, prompt: input.prompt, confirmableAction,
        status: 'pending', revision: 1,
        expiresAt: input.expiresAt, createdAt: at, updatedAt: at }
      await tx.insertHumanRequest(request)
      const message = await this.appendInbox(tx, { kind: 'user', id: targetUserId }, 'human.needed', {
        protocolVersion: '1.0', type: 'human.needed', request: toHumanNeededEntity(request)
      }, at)
      const notifications = [{ recipient: message.recipient, sequence: message.sequence }]
      if (workerContext) {
        const { task, execution } = workerContext
        const updatedExecution: StoredTaskExecution = {
          ...execution,
          state: 'needs_human',
          stateRevision: execution.stateRevision + 1,
          revision: execution.revision + 1,
          updatedAt: at
        }
        const updatedTask: StoredTask = {
          ...task,
          status: 'needs_human',
          currentExecutionState: 'needs_human',
          revision: task.revision + 1,
          updatedAt: at
        }
        await tx.updateTaskExecution(updatedExecution, execution.revision)
        await tx.updateTask(updatedTask, task.revision)
        const coordinatorMessage = await this.appendInbox(tx, { kind: 'agent', id: project.coordinatorAgentId }, 'task.updated', {
          protocolVersion: '1.0', type: 'task.updated', projectId: project.projectId, taskId: task.taskId,
          executionId: execution.executionId, revision: updatedTask.revision,
          status: 'needs_human', humanRequestId: request.humanRequestId
        }, at)
        notifications.push({ recipient: coordinatorMessage.recipient, sequence: coordinatorMessage.sequence })
      }
      const [participant, binding] = await Promise.all([
        tx.getParticipant(targetUserId),
        tx.getProjectEndpointBinding(project.projectId)
      ])
      if (participant?.primaryHumanEndpointId && binding?.status === 'active') {
        const endpoint = await tx.getEndpoint(participant.primaryHumanEndpointId)
        if (endpoint?.status === 'active' && endpoint.userId === targetUserId &&
            endpoint.provider === binding.locator.provider && endpoint.realmId === binding.locator.realmId) {
          const providerMessage = await this.appendInbox(tx,
            { kind: 'human_endpoint', id: endpoint.humanEndpointId }, 'provider.notification.outbound', {
              protocolVersion: '1.0', type: 'provider.notification.outbound', locator: binding.locator,
              notificationKind: 'human_needed', text: humanNeededProviderText(request),
              resourceId: request.humanRequestId
            }, at)
          notifications.push({ recipient: providerMessage.recipient, sequence: providerMessage.sequence })
        }
      }
      return { response: entityResponse('human_needed.created', request), resourceKind: 'human_needed',
        resourceId: request.humanRequestId, notifications }
    }).then(responseEntity<StoredHumanRequest>)
  }

  async answerHumanNeeded(
    actor: UserActor | HumanEndpointActor,
    input: RestCommand<'human.answer'> & Readonly<{ sourceLocator?: ProviderLocatorValue }>
  ): Promise<StoredHumanAnswer> {
    assertText(input.answer, 'answer', 1, 32_000)
    return this.commit(actor, 'human.answer', input.idempotencyKey, input, async (tx, at) => {
      const request = required(await tx.getHumanRequest(input.humanRequestId), 'HumanNeeded request')
      authorize({ actor, operation: 'human_answer', targetUserId: request.targetUserId,
        requiredAssurance: request.requiredAssurance })
      const project = required(await tx.getProject(request.projectId), 'Project')
      if (request.targetUserId !== project.ownerUserId || actor.userId !== project.ownerUserId) {
        fail('permission_denied', 'HumanNeeded authority belongs to the current Project Owner.')
      }
      if (actor.kind === 'human_endpoint') {
        const endpoint = required(await tx.getEndpoint(actor.humanEndpointId), 'Human endpoint')
        const binding = required(await tx.getProjectEndpointBinding(project.projectId), 'Project endpoint binding')
        if (
          endpoint.status !== 'active' ||
          endpoint.userId !== project.ownerUserId ||
          endpoint.assurance === 'basic' ||
          input.sourceLocator === undefined ||
          binding.status !== 'active' ||
          !sameLocator(binding.locator, input.sourceLocator) ||
          endpoint.provider !== input.sourceLocator.provider ||
          endpoint.realmId !== input.sourceLocator.realmId
        ) {
          fail('permission_denied', 'The Human Endpoint is not the verified Owner endpoint for this Project location.')
        }
      }
      expectRevision(request.revision, input.requestRevision)
      if (request.status !== 'pending' || request.expiresAt <= at) fail('request_expired', 'The HumanNeeded request is no longer current.')
      if (request.confirmableAction) {
        if (actor.kind !== 'user' || actor.authentication !== 'oidc') {
          fail('permission_denied', 'Confirmable actions require the target User OIDC identity.')
        }
        const authenticationAge = Math.floor(new Date(at).getTime() / 1_000) - actor.authTime
        if (!Number.isSafeInteger(actor.authTime) || authenticationAge < 0 || authenticationAge > 300) {
          fail('assurance_insufficient', 'Recent OIDC authentication is required for a confirmable action.')
        }
        if (input.decision !== 'approve' && input.decision !== 'reject') {
          fail('validation_failed', 'Confirmable actions require an explicit approve or reject decision.')
        }
      } else if (input.decision !== undefined) {
        fail('validation_failed', 'A free-form HumanNeeded answer cannot include an approval decision.')
      }
      let workerContext: Readonly<{ task: StoredTask; execution: StoredTaskExecution }> | null = null
      if (request.context.scope === 'worker_execution') {
        const task = required(await tx.getTaskForUpdate(request.context.taskId), 'Task')
        const execution = required(await tx.getTaskExecutionForUpdate(request.context.executionId), 'Task execution')
        if (
          task.currentExecutionId !== execution.executionId ||
          execution.taskId !== task.taskId ||
          execution.assigneeAgentId !== request.requestedByAgentId ||
          execution.state !== 'needs_human' ||
          execution.fence.status !== 'open' ||
          task.status !== 'needs_human'
        ) {
          fail('revision_conflict', 'The HumanNeeded request belongs to a stale Task execution.')
        }
        workerContext = { task, execution }
      } else if (
        request.requestedByAgentId !== project.coordinatorAgentId ||
        request.context.coordinatorAuthorityEpoch !== project.coordinatorAuthorityEpoch ||
        project.status !== 'active'
      ) {
        fail('revision_conflict', 'The HumanNeeded request belongs to stale Coordinator authority.')
      }
      const existing = await tx.getHumanAnswerForRequest(request.humanRequestId)
      if (existing) return { response: entityResponse('human_answer.created', existing), resourceKind: 'human_answer',
        resourceId: existing.humanAnswerId }
      const answer: StoredHumanAnswer = { humanAnswerId: newId('han'), humanRequestId: request.humanRequestId,
        projectId: request.projectId, context: request.context,
        requestRevision: request.revision,
        answeredByUserId: actor.userId,
        answeredFrom: actor.kind === 'user'
          ? { type: 'oidc_user', oidcIdentityId: actor.identityId }
          : { type: 'human_endpoint', humanEndpointId: actor.humanEndpointId },
        assurance: actor.assurance, answer: input.answer, decision: request.confirmableAction ? input.decision! : null,
        confirmationId: request.confirmableAction ? newId('cfm') : null,
        revision: 1, answeredAt: at, createdAt: at, updatedAt: at }
      await tx.insertHumanAnswer(answer)
      await tx.updateHumanRequest({ ...request, status: 'answered', revision: request.revision + 1, updatedAt: at }, request.revision)
      if (workerContext) {
        const { task, execution } = workerContext
        await tx.updateTaskExecution({
          ...execution,
          state: 'running',
          stateRevision: execution.stateRevision + 1,
          revision: execution.revision + 1,
          updatedAt: at
        }, execution.revision)
        await tx.updateTask({
          ...task,
          status: 'in_progress',
          currentExecutionState: 'running',
          revision: task.revision + 1,
          updatedAt: at
        }, task.revision)
      }
      const notifications: Array<{ recipient: InboxRecipient; sequence: number }> = []
      const recipientAgentIds = request.context.scope === 'worker_execution'
        ? [request.requestedByAgentId, project.coordinatorAgentId]
        : [project.coordinatorAgentId]
      for (const agentId of new Set(recipientAgentIds)) {
        const message = await this.appendInbox(tx, { kind: 'agent', id: agentId }, 'human.answer.received', {
          protocolVersion: '1.0', type: 'human.answer.received', answer: toHumanAnswerEntity(answer)
        }, at)
        notifications.push({ recipient: message.recipient, sequence: message.sequence })
      }
      return { response: entityResponse('human_answer.created', answer), resourceKind: 'human_answer',
        resourceId: answer.humanAnswerId, notifications }
    }).then(responseEntity<StoredHumanAnswer>)
  }

  async publishProviderDirectoryPrincipalFact(
    actor: UserActor,
    input: CloudCommand<'provider_directory_principal.publish'>
  ): Promise<StoredProviderDirectoryPrincipalFact> {
    return this.commit(
      actor,
      'provider_directory_principal.publish',
      input.idempotencyKey,
      input,
      async (tx, at) => {
        const user = required(await tx.getUserForUpdate(actor.userId), 'OIDC User')
        if (user.status !== 'active') {
          fail('credential_revoked', 'The OIDC User is not active.')
        }
        const device = required(await tx.getDeviceForUpdate(input.deviceId), 'Publishing Device')
        if (device.userId !== actor.userId) {
          fail('permission_denied', 'A Provider principal fact may only be published from the current User Device.')
        }
        if (device.status !== 'active') {
          fail('credential_revoked', 'The publishing Device is not ACTIVE.')
        }
        expectRevision(device.revision, input.expectedDeviceRevision)
        requireBoundedObservationTime(input.observedAt, at)

        const slot = await tx.getProviderDirectoryPrincipalFactForSlotForUpdate(
          actor.userId,
          input.providerPrincipal.providerInstance
        )
        let fact: StoredProviderDirectoryPrincipalFact
        if (input.providerPrincipalFactId === null) {
          if (slot !== null) {
            fail('revision_conflict', 'This User and Provider Instance already has a current principal fact.')
          }
          fact = {
            providerPrincipalFactId: newId('ppf'),
            userId: actor.userId,
            providerPrincipal: input.providerPrincipal,
            principalIdentityRevision: input.principalIdentityRevision,
            providerBindingAttestationDigest: input.providerBindingAttestationDigest,
            publishedByDeviceId: device.deviceId,
            readiness: input.readiness,
            readinessReason: input.readinessReason,
            observedAt: input.observedAt,
            revision: 1,
            createdAt: at,
            updatedAt: at
          }
          await tx.insertProviderDirectoryPrincipalFact(fact)
        } else {
          const current = required(
            await tx.getProviderDirectoryPrincipalFactForUpdate(input.providerPrincipalFactId),
            'Provider directory principal fact'
          )
          if (current.userId !== actor.userId || slot?.providerPrincipalFactId !== current.providerPrincipalFactId) {
            fail('permission_denied', 'The Provider principal fact does not belong to this exact User and Provider Instance slot.')
          }
          expectRevision(current.revision, input.expectedFactRevision!)
          fact = {
            ...current,
            providerPrincipal: input.providerPrincipal,
            principalIdentityRevision: input.principalIdentityRevision,
            providerBindingAttestationDigest: input.providerBindingAttestationDigest,
            publishedByDeviceId: device.deviceId,
            readiness: input.readiness,
            readinessReason: input.readinessReason,
            observedAt: input.observedAt,
            revision: current.revision + 1,
            updatedAt: at
          }
          await tx.updateProviderDirectoryPrincipalFact(fact, current.revision)
        }

        const notification = await this.appendInbox(
          tx,
          { kind: 'user', id: actor.userId },
          'provider_directory_principal.changed',
          {
            protocolVersion: '1.0',
            type: 'provider_directory_principal.changed',
            providerPrincipalFactId: fact.providerPrincipalFactId,
            revision: fact.revision,
            readiness: fact.readiness
          },
          at
        )
        return {
          response: entityResponse('provider_directory_principal.changed', fact),
          resourceKind: 'provider_directory_principal_fact',
          resourceId: fact.providerPrincipalFactId,
          notifications: [{ recipient: notification.recipient, sequence: notification.sequence }]
        }
      }
    ).then(responseEntity<StoredProviderDirectoryPrincipalFact>)
  }

  async listProviderDirectoryPrincipalFacts(
    actor: UserActor,
    input: CloudCommand<'provider_directory_principal.list'>
  ): Promise<Readonly<{
    items: StoredProviderDirectoryPrincipalFact[]
    nextFactId?: string
  }>> {
    const user = required(await this.repository.getUser(actor.userId), 'OIDC User')
    if (user.status !== 'active') fail('credential_revoked', 'The OIDC User is not active.')
    const page = await this.repository.listProviderDirectoryPrincipalFacts({
      userIds: input.userIds,
      providerInstance: input.providerInstance ?? null,
      includeDegraded: input.includeDegraded,
      afterFactId: input.afterFactId ?? null,
      limit: input.limit + 1
    })
    const items = page.slice(0, input.limit)
    return {
      items,
      ...(page.length > input.limit && items.length > 0
        ? { nextFactId: items.at(-1)!.providerPrincipalFactId }
        : {})
    }
  }

  async listProjects(
    actor: UserActor,
    input: CloudCommand<'project.list'>
  ): Promise<Readonly<{ projects: StoredProject[]; nextCursor?: string; observedAt: string }>> {
    const cursor = input.cursor === undefined ? null : decodeProjectListCursor(input.cursor, actor.userId)
    const observedAt = cursor?.observedAt ?? this.timestamp()
    const rows = await this.repository.listProjectsForUser(
      actor.userId,
      cursor?.afterProjectId ?? null,
      input.limit + 1
    )
    const projects = rows.slice(0, input.limit)
    return {
      projects,
      ...(rows.length > input.limit && projects.length > 0
        ? { nextCursor: encodeScopedCursor({ version: 1, kind: 'project-list',
          userId: actor.userId, afterProjectId: projects.at(-1)!.projectId, observedAt }) }
        : {}),
      observedAt
    }
  }

  async readProjectCoordination(
    actor: UserActor,
    input: CloudCommand<'project.coordination.read'>
  ): Promise<Readonly<{
    project: StoredProject
    pages: ProjectCoordinationFactPage[]
    finalSummary: StoredProjectFinalSummary | null
    observedAt: string
  }>> {
    const project = await requireProjectReader(this.repository, actor, input.projectId)
    const decodedCursors = input.collections.map((request) => request.cursor === undefined
      ? null
      : decodeProjectCoordinationCursor(request.cursor, actor.userId, project.projectId, request.collection))
    const cursorObservationTimes = [...new Set(decodedCursors.flatMap((cursor) =>
      cursor === null ? [] : [cursor.observedAt]))]
    if (cursorObservationTimes.length > 1) {
      fail('validation_failed', 'All collection continuations in one Project read must belong to the same observation.')
    }
    const observedAt = cursorObservationTimes[0] ?? this.timestamp()
    const pages: ProjectCoordinationFactPage[] = []
    for (const [index, request] of input.collections.entries()) {
      pages.push(await buildProjectCoordinationPage(
        this.repository,
        project,
        request,
        actor.userId,
        observedAt,
        decodedCursors[index]?.after ?? null
      ))
    }
    const finalSummaries = await this.repository.listProjectFinalSummaries(project.projectId)
    return { project, pages, finalSummary: finalSummaries.at(-1) ?? null, observedAt }
  }

  async createProject(
    actor: UserActor,
    input: CloudCommand<'project.create'>
  ): Promise<Readonly<{
    project: StoredProject
    memberships: StoredProjectMember[]
    provisioningIntent: StoredProjectContentProvisioningIntent | null
  }>> {
    if (!projectCreateIncludesAuthenticatedOwner(input, actor.userId)) {
      fail('permission_denied', 'The explicit Project Memberships must include the authenticated OIDC Owner.')
    }
    if (input.content.mode === 'required' && input.content.contentOwnerUserId !== actor.userId) {
      fail('permission_denied', 'The initial Project Content Owner is derived from the authenticated OIDC Owner.')
    }
    const memberUserIds = input.content.members.map(({ userId }) => userId)
    return this.commit(actor, 'project.create', input.idempotencyKey, input, async (tx, at) => {
      for (const userId of [...memberUserIds].sort()) {
        const user = required(await tx.getUserForUpdate(userId), 'Project member')
        if (user.status !== 'active') fail('credential_revoked', 'Every Project member must be active.')
      }

      const coordinator = required(await tx.getAgentForUpdate(input.coordinatorAgentId), 'Coordinator Agent')
      expectRevision(coordinator.revision, input.expectedCoordinatorAgentRevision)
      const coordinatorDevice = required(await tx.getDeviceForUpdate(coordinator.deviceId), 'Coordinator Device')
      if (
        coordinator.status !== 'active' ||
        coordinatorDevice.status !== 'active' ||
        coordinatorDevice.userId !== coordinator.ownerUserId ||
        !memberUserIds.includes(coordinator.ownerUserId)
      ) {
        fail('permission_denied', 'The exact Coordinator Agent and Device must belong to an active Project member.')
      }

      const facts = new Map<string, StoredProviderDirectoryPrincipalFact>()
      if (input.content.mode === 'required') {
        const orderedFactRequests = [...input.content.members]
          .sort((left, right) => left.providerPrincipalFactId.localeCompare(right.providerPrincipalFactId))
        for (const requested of orderedFactRequests) {
          const fact = required(
            await tx.getProviderDirectoryPrincipalFactForUpdate(requested.providerPrincipalFactId),
            'Provider directory principal fact'
          )
          if (
            fact.userId !== requested.userId ||
            fact.readiness !== 'ready' ||
            !sameProviderInstanceReference(fact.providerPrincipal.providerInstance, input.content.providerInstance)
          ) {
            fail('permission_denied', 'Every content member requires its exact ready same-instance Provider principal fact.')
          }
          expectRevision(fact.revision, requested.expectedFactRevision)
          facts.set(fact.providerPrincipalFactId, fact)
        }
      }

      const projectId = newId('prj')
      const project: StoredProject = {
        projectId,
        ownerUserId: actor.userId,
        displayName: input.displayName,
        goal: input.goal,
        contentMode: input.content.mode,
        status: 'paused',
        coordinatorAgentId: coordinator.agentId,
        coordinatorAuthorityEpoch: 1,
        executionAuthorityEpoch: 1,
        contentOwnerUserId: input.content.mode === 'required' ? input.content.contentOwnerUserId : null,
        budget: input.budget,
        coordinationRound: 1,
        revision: 1,
        createdAt: at,
        updatedAt: at
      }
      const memberships: StoredProjectMember[] = memberUserIds.map((userId) => ({
        projectMembershipId: newId('pmb'),
        projectId,
        userId,
        state: 'active',
        authorityEpoch: 1,
        activatedAt: at,
        removalRequestedAt: null,
        removalRequestedByUserId: null,
        removedAt: null,
        revision: 1,
        createdAt: at,
        updatedAt: at
      }))
      await tx.insertProject(project, memberships)

      for (const userId of memberUserIds) {
        if (input.content.mode === 'required') {
          const requestedFact = input.content.members.find((member) => member.userId === userId)!
          const fact = facts.get(requestedFact.providerPrincipalFactId)!
          const readiness: StoredProjectContentReadiness = {
            projectId,
            userId,
            providerInstance: input.content.providerInstance,
            state: 'pending',
            reason: 'provisioning_pending',
            providerPrincipalFactId: fact.providerPrincipalFactId,
            snapshottedFactRevision: fact.revision,
            providerPrincipal: fact.providerPrincipal,
            bindingRevision: null,
            lastObservationId: null,
            effectiveAt: at,
            revision: 1,
            createdAt: at,
            updatedAt: at
          }
          await tx.upsertProjectContentReadiness(readiness, null)
        }
        for (const scope of ['text_tasks', 'file_tasks'] as const) {
          const authority: StoredTaskAuthority = {
            taskAuthorityId: newId('tau'),
            projectId,
            userId,
            scope,
            state: 'suspended',
            authorityEpoch: 1,
            reason: 'project_paused',
            effectiveAt: at,
            revision: 1,
            createdAt: at,
            updatedAt: at
          }
          await tx.upsertTaskAuthority(authority, null)
        }
      }

      let provisioningIntent: StoredProjectContentProvisioningIntent | null = null
      if (input.content.mode === 'required') {
        const desiredMembers = input.content.members.map((member) => {
          const fact = facts.get(member.providerPrincipalFactId)!
          return {
            userId: member.userId,
            providerPrincipalFactId: fact.providerPrincipalFactId,
            snapshottedFactRevision: fact.revision,
            principal: fact.providerPrincipal
          }
        })
        const provisioningIntentId = newId('pci')
        const intentFacts = {
          provisioningIntentId,
          projectId,
          provisioningRevision: 1,
          kind: 'initial_provisioning' as const,
          createdByOwnerUserId: actor.userId,
          contentOwnerUserId: input.content.contentOwnerUserId,
          providerInstance: input.content.providerInstance,
          desiredMembers,
          containerDisplayName: input.content.containerDisplayName,
          currentRootLocator: null,
          currentBindingRevision: null
        }
        provisioningIntent = {
          ...intentFacts,
          state: 'pending',
          intentDigest: stableDigest(intentFacts),
          revision: 1,
          createdAt: at,
          updatedAt: at
        }
        await tx.insertProjectContentProvisioningIntent(provisioningIntent)
        await tx.upsertProjectContentSpaceBinding({
          projectContentBindingId: newId('pcb'),
          projectId,
          contentOwnerUserId: actor.userId,
          providerInstance: input.content.providerInstance,
          rootLocator: null,
          rootLocatorDigest: null,
          provisioningIntentId,
          provisioningRevision: provisioningIntent.provisioningRevision,
          attestationId: null,
          attestationDigest: null,
          status: 'provisioning',
          statusReason: 'provisioning_incomplete',
          activatedAt: null,
          degradedAt: null,
          closedAt: null,
          revision: 1,
          createdAt: at,
          updatedAt: at
        }, null)
      }

      const message = await this.appendInbox(
        tx,
        { kind: 'agent', id: coordinator.agentId },
        'project.created',
        {
          protocolVersion: '1.0',
          type: 'project.created',
          projectId,
          ownerUserId: actor.userId,
          coordinatorAgentId: coordinator.agentId,
          coordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch,
          executionAuthorityEpoch: project.executionAuthorityEpoch,
          status: 'paused',
          contentMode: project.contentMode,
          provisioningIntentId: provisioningIntent?.provisioningIntentId ?? null,
          revision: project.revision
        },
        at
      )
      return {
        response: { protocolVersion: '1.0', type: 'project.created', project, memberships, provisioningIntent },
        resourceKind: 'project',
        resourceId: projectId,
        notifications: [{ recipient: message.recipient, sequence: message.sequence }]
      }
    }).then((response) => ({
      project: response.project as StoredProject,
      memberships: response.memberships as StoredProjectMember[],
      provisioningIntent: response.provisioningIntent as StoredProjectContentProvisioningIntent | null
    }))
  }

  async transferCoordinator(
    actor: UserActor,
    input: RestCommand<'project.transfer_coordinator'>
  ): Promise<StoredProject> {
    return this.commit(actor, 'project.transfer_coordinator', input.idempotencyKey, input, async (tx, at) => {
      const project = required(await tx.getProjectForUpdate(input.projectId), 'Project')
      if (project.ownerUserId !== actor.userId) {
        fail('permission_denied', 'Only the current Project Owner OIDC User may transfer Coordinator authority.')
      }
      expectRevision(project.revision, input.expectedRevision)
      expectRevision(project.coordinatorAuthorityEpoch, input.expectedCoordinatorAuthorityEpoch)
      if (project.status === 'completed' || project.status === 'cancelled') {
        fail('invalid_state_transition', 'A terminal Project cannot transfer Coordinator authority.')
      }
      const availability = required(
        await tx.getWorkerAvailabilityForUpdate(input.coordinatorAgentId),
        'Coordinator availability'
      )
      expectRevision(availability.revision, input.expectedCoordinatorAvailabilityRevision)
      if (
        !availability.agentActive ||
        !availability.deviceActive ||
        availability.connectionStatus !== 'online' ||
        availability.runtimeReadiness !== 'ready' ||
        availability.expiresAt <= at
      ) {
        fail('invalid_state_transition', 'The new Coordinator availability fact is not current and ready.')
      }
      const coordinator = required(await tx.getAgentForUpdate(input.coordinatorAgentId), 'Coordinator Agent')
      if (coordinator.agentId === project.coordinatorAgentId) {
        fail('invalid_state_transition', 'Coordinator transfer requires another exact Owner Agent.')
      }
      if (coordinator.ownerUserId !== project.ownerUserId) {
        fail('permission_denied', 'The new Coordinator Agent must be owned by the current Project Owner.')
      }
      const coordinatorDevice = required(await tx.getDeviceForUpdate(coordinator.deviceId), 'Coordinator Device')
      const coordinatorMember = await tx.getProjectMember(project.projectId, coordinator.ownerUserId)
      if (
        coordinator.status !== 'active' ||
        coordinatorDevice.status !== 'active' ||
        availability.userId !== coordinator.ownerUserId ||
        availability.deviceId !== coordinator.deviceId ||
        coordinatorMember?.state !== 'active'
      ) {
        fail('permission_denied', 'The new Coordinator must belong to an active Project member.')
      }
      const oldCoordinatorAgentId = project.coordinatorAgentId
      const updated: StoredProject = { ...project, coordinatorAgentId: coordinator.agentId,
        coordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch + 1,
        revision: project.revision + 1, updatedAt: at }
      await tx.updateProject(updated, project.revision)
      const notifications: Array<{ recipient: InboxRecipient; sequence: number }> = []
      for (const recipient of [
        { kind: 'agent', id: coordinator.agentId } as InboxRecipient,
        { kind: 'agent', id: oldCoordinatorAgentId } as InboxRecipient
      ]) {
        const message = await this.appendInbox(tx, recipient, 'coordinator.transferred',
          { protocolVersion: '1.0', type: 'coordinator.transferred', projectId: project.projectId,
            previousCoordinatorAgentId: oldCoordinatorAgentId, coordinatorAgentId: coordinator.agentId,
            coordinatorAuthorityEpoch: updated.coordinatorAuthorityEpoch, revision: updated.revision }, at)
        notifications.push({ recipient: message.recipient, sequence: message.sequence })
      }
      return { response: entityResponse('project.updated', updated), resourceKind: 'project', resourceId: project.projectId, notifications }
    }).then(responseEntity<StoredProject>)
  }

  async transitionProject(
    actor: UserActor,
    input: RestCommand<'project.transition'>
  ): Promise<StoredProject> {
    return this.commit(actor, 'project.transition', input.idempotencyKey, input, async (tx, at) => {
      const project = required(await tx.getProjectForUpdate(input.projectId), 'Project')
      if (project.ownerUserId !== actor.userId) {
        fail('permission_denied', 'Only the current Project Owner OIDC User may transition the Project.')
      }
      expectRevision(project.revision, input.expectedRevision)
      expectRevision(project.coordinatorAuthorityEpoch, input.expectedCoordinatorAuthorityEpoch)
      expectRevision(project.executionAuthorityEpoch, input.expectedExecutionAuthorityEpoch)
      if (['completed', 'cancelled'].includes(project.status)) fail('invalid_state_transition', 'A terminal Project cannot transition again.')
      if (input.status === project.status) fail('invalid_state_transition', 'The Project is already in the requested state.')

      const binding = await tx.getProjectContentSpaceBindingForUpdate(project.projectId)
      if (input.status === 'active') {
        const plan = await tx.getCurrentProjectPlan(project.projectId)
        if (plan?.state !== 'confirmed') {
          fail('invalid_state_transition', 'A Project requires its confirmed current plan before activation.')
        }
        if (project.contentMode === 'required' && binding?.status !== 'active') {
          fail('invalid_state_transition', 'A content-required Project requires an active Content binding before activation.')
        }
      }

      const terminal = input.status === 'cancelled'
      const fencesExecutions = input.status === 'paused' || terminal
      const nextExecutionAuthorityEpoch = fencesExecutions
        ? project.executionAuthorityEpoch + 1
        : project.executionAuthorityEpoch
      const members = await tx.listProjectMembers(project.projectId)
      for (const member of members) {
        const readiness = project.contentMode === 'required'
          ? await tx.getProjectContentReadinessForUpdate(project.projectId, member.userId)
          : null
        for (const scope of ['text_tasks', 'file_tasks'] as const) {
          const authority = required(
            await tx.getTaskAuthorityForUpdate(project.projectId, member.userId, scope),
            'Project Task authority'
          )
          const derived = deriveTaskAuthorityTransition({
            projectStatus: input.status,
            contentMode: project.contentMode,
            membership: member,
            scope,
            readiness,
            binding
          })
          await tx.upsertTaskAuthority({
            ...authority,
            ...derived,
            authorityEpoch: authority.authorityEpoch + 1,
            effectiveAt: at,
            revision: authority.revision + 1,
            updatedAt: at
          }, authority.revision)
        }
      }

      const notifications: Array<{ recipient: InboxRecipient; sequence: number }> = []
      if (fencesExecutions) {
        for (const execution of await tx.listCurrentTaskExecutionsForProjectForUpdate(project.projectId)) {
          const task = required(await tx.getTaskForUpdate(execution.taskId), 'Current Task')
          if (task.currentExecutionId !== execution.executionId || execution.fence.status === 'fenced') continue
          const reason = terminal ? 'project_terminal' as const : 'project_paused' as const
          const executionState = 'cancelled' as const
          await tx.updateTaskExecution({
            ...execution,
            state: executionState,
            stateRevision: execution.stateRevision + 1,
            fence: { ...execution.fence, status: 'fenced', reason, fencedAt: at },
            terminalAt: at,
            revision: execution.revision + 1,
            updatedAt: at
          }, execution.revision)
          await tx.updateTask({
            ...task,
            status: terminal ? 'cancelled' : 'revision_requested',
            currentExecutionState: executionState,
            completedAt: terminal ? at : null,
            revision: task.revision + 1,
            updatedAt: at
          }, task.revision)
          if (execution.fileIntent !== null) {
            await tx.invalidateCloudResourceRefs(task.taskId, execution.executionId, at)
          }
          const workerMessage = await this.appendInbox(tx, { kind: 'agent', id: execution.assigneeAgentId },
            'task.execution.fenced', {
              protocolVersion: '1.0', type: 'task.execution.fenced', projectId: project.projectId,
              taskId: task.taskId, executionId: execution.executionId, reason
            }, at)
          notifications.push({ recipient: workerMessage.recipient, sequence: workerMessage.sequence })
        }
      }

      const updated: StoredProject = { ...project, status: input.status,
        executionAuthorityEpoch: nextExecutionAuthorityEpoch,
        revision: project.revision + 1, updatedAt: at }
      await tx.updateProject(updated, project.revision)
      return { response: entityResponse('project.updated', updated), resourceKind: 'project',
        resourceId: project.projectId, notifications }
    }).then(responseEntity<StoredProject>)
  }

  async publishWorkerAvailability(
    actor: AgentActor,
    input: CloudCommand<'worker.availability.publish'>
  ): Promise<StoredWorkerAvailability> {
    if (input.agentId !== actor.agentId) {
      fail('permission_denied', 'An Agent may publish only its own availability fact.')
    }
    return this.commit(actor, 'worker.availability.publish', input.idempotencyKey, input, async (tx, at) => {
      requireBoundedObservationTime(input.observedAt, at)
      const agent = required(await tx.getAgentForUpdate(actor.agentId), 'Worker Agent')
      const device = required(await tx.getDeviceForUpdate(actor.deviceId), 'Worker Device')
      expectRevision(agent.revision, input.expectedAgentRevision)
      if (
        agent.ownerUserId !== actor.userId ||
        agent.deviceId !== actor.deviceId ||
        agent.status !== 'active' ||
        device.userId !== actor.userId ||
        device.status !== 'active'
      ) {
        fail('credential_revoked', 'Availability requires the exact ACTIVE Agent and Device.')
      }
      const heartbeatCapabilityTags = [...new Set(agent.capabilities)].sort()
      const publishedCapabilityTags = [...new Set(input.runtimeCapabilityTags)].sort()
      if (
        input.connectionStatus !== agent.connectionStatus ||
        (input.connectionStatus === 'online' && (
          agent.lastSeenAt === undefined || input.lastHeartbeatAt !== agent.lastSeenAt
        )) ||
        (input.connectionStatus === 'offline' && input.lastHeartbeatAt !== null) ||
        stableDigest(publishedCapabilityTags) !== stableDigest(heartbeatCapabilityTags)
      ) {
        fail(
          'validation_failed',
          'Worker availability must match the exact current Agent heartbeat and Runtime capability tags.'
        )
      }
      if (input.acceptsNewOffers && (
        input.connectionStatus !== 'online' ||
        input.runtimeReadiness !== 'ready'
      )) {
        fail('validation_failed', 'Only an online ready Runtime may accept new offers.')
      }
      const existing = await tx.getWorkerAvailabilityForUpdate(actor.agentId)
      const observedAtMs = Date.parse(input.observedAt)
      const availability: StoredWorkerAvailability = {
        agentId: agent.agentId,
        userId: actor.userId,
        deviceId: device.deviceId,
        agentActive: true,
        deviceActive: true,
        connectionStatus: agent.connectionStatus,
        lastHeartbeatAt: agent.connectionStatus === 'online' ? agent.lastSeenAt! : null,
        runtimeReadiness: input.runtimeReadiness,
        runtimeCapabilityTags: heartbeatCapabilityTags,
        acceptsNewOffers: input.acceptsNewOffers,
        activeTaskCount: input.activeTaskCount,
        observedAt: input.observedAt,
        expiresAt: new Date(observedAtMs + 90_000).toISOString(),
        revision: (existing?.revision ?? 0) + 1,
        createdAt: existing?.createdAt ?? at,
        updatedAt: at
      }
      await tx.upsertWorkerAvailability(availability, existing?.revision ?? null)
      return {
        response: entityResponse('worker.availability.changed', availability),
        resourceKind: 'worker_availability_projection',
        resourceId: availability.agentId
      }
    }).then(responseEntity<StoredWorkerAvailability>)
  }

  async listWorkerAvailability(
    actor: AuthContext,
    input: CloudCommand<'worker.availability.list'>
  ): Promise<Readonly<{
    items: StoredWorkerAvailability[]
    projectItems: Array<Readonly<{
      availability: StoredWorkerAvailability
      membership: StoredProjectMember | null
      taskAuthorities: StoredTaskAuthority[]
      providerPrincipalFact: StoredProviderDirectoryPrincipalFact | null
      providerPrincipalSnapshotStatus: ProjectWorkerAvailabilityView['providerPrincipalSnapshotStatus']
      contentReadiness: StoredProjectContentReadiness | null
      observedAt: string
    }>>
    nextAgentId?: string
  }>> {
    if (actor.kind === 'system') fail('permission_denied', 'System context cannot browse Worker availability.')
    const now = this.timestamp()
    let rows = (await this.repository.listAvailableWorkers(now))
      .sort((left, right) => left.agentId.localeCompare(right.agentId))
    if (input.afterAgentId) rows = rows.filter(({ agentId }) => agentId > input.afterAgentId!)
    const page = rows.slice(0, input.limit + 1)
    const items = page.slice(0, input.limit)
    const projectItems: Array<{
      availability: StoredWorkerAvailability
      membership: StoredProjectMember | null
      taskAuthorities: StoredTaskAuthority[]
      providerPrincipalFact: StoredProviderDirectoryPrincipalFact | null
      providerPrincipalSnapshotStatus: ProjectWorkerAvailabilityView['providerPrincipalSnapshotStatus']
      contentReadiness: StoredProjectContentReadiness | null
      observedAt: string
    }> = []
    if (input.projectId) {
      const callerMembership = await this.repository.getProjectMember(input.projectId, actor.userId)
      if (callerMembership?.state !== 'active') {
        fail('permission_denied', 'Only an active Project member may browse Project-scoped availability.')
      }
      for (const availability of items) {
        const [membership, taskAuthorities, contentReadiness] = await Promise.all([
          this.repository.getProjectMember(input.projectId, availability.userId),
          this.repository.listTaskAuthoritiesForUser(input.projectId, availability.userId),
          this.repository.getProjectContentReadiness(input.projectId, availability.userId)
        ])
        const providerPrincipalFact = contentReadiness === null
          ? null
          : await this.repository.getProviderDirectoryPrincipalFactForSlot(
              availability.userId,
              contentReadiness.providerInstance
            )
        projectItems.push({
          availability,
          membership,
          taskAuthorities,
          providerPrincipalFact,
          providerPrincipalSnapshotStatus: contentReadiness === null
            ? 'not_applicable'
            : providerPrincipalFact === null
              ? 'missing'
              : providerPrincipalFact.providerPrincipalFactId === contentReadiness.providerPrincipalFactId &&
                  providerPrincipalFact.revision === contentReadiness.snapshottedFactRevision
                ? 'match'
                : 'stale',
          contentReadiness,
          observedAt: now
        })
      }
    }
    return {
      items,
      projectItems,
      ...(page.length > input.limit && items.length > 0 ? { nextAgentId: items.at(-1)!.agentId } : {})
    }
  }

  async addProjectMembership(
    actor: UserActor,
    input: CloudCommand<'project.membership.add'>
  ): Promise<Readonly<{
    project: StoredProject
    membership: StoredProjectMember
    taskAuthorities: StoredTaskAuthority[]
    contentReadiness: StoredProjectContentReadiness | null
    provisioningIntent: StoredProjectContentProvisioningIntent | null
  }>> {
    return this.commit(actor, 'project.membership.add', input.idempotencyKey, input, async (tx, at) => {
      const project = required(await tx.getProjectForUpdate(input.projectId), 'Project')
      requireProjectOwner(project, actor)
      expectRevision(project.revision, input.expectedProjectRevision)
      if (project.status === 'completed' || project.status === 'cancelled') {
        fail('invalid_state_transition', 'A terminal Project cannot add a member.')
      }
      const user = required(await tx.getUserForUpdate(input.userId), 'Project member User')
      if (user.status !== 'active') fail('credential_revoked', 'The new Project member User is not active.')
      if (await tx.getProjectMemberForUpdate(project.projectId, input.userId)) {
        fail('revision_conflict', 'The Project already has a Membership for this User.')
      }

      let fact: StoredProviderDirectoryPrincipalFact | null = null
      if (project.contentMode === 'required') {
        if (input.providerPrincipalFactId === null || input.expectedProviderPrincipalFactRevision === null) {
          fail('validation_failed', 'A content-required member needs an exact ready Provider principal fact.')
        }
        fact = required(
          await tx.getProviderDirectoryPrincipalFactForUpdate(input.providerPrincipalFactId),
          'Provider principal fact'
        )
        expectRevision(fact.revision, input.expectedProviderPrincipalFactRevision)
        const binding = await tx.getProjectContentSpaceBindingForUpdate(project.projectId)
        const intent = await tx.getLatestProjectContentProvisioningIntent(project.projectId)
        const providerInstance = binding?.providerInstance ?? intent?.providerInstance
        if (
          fact.userId !== input.userId ||
          fact.readiness !== 'ready' ||
          providerInstance === undefined ||
          !sameProviderInstanceReference(fact.providerPrincipal.providerInstance, providerInstance)
        ) {
          fail('permission_denied', 'The Provider principal fact does not match the new User and Project Provider Instance.')
        }
      } else if (input.providerPrincipalFactId !== null || input.expectedProviderPrincipalFactRevision !== null) {
        fail('validation_failed', 'A content-free Project cannot snapshot a Provider principal fact.')
      }

      const membershipPending = project.contentMode === 'required'
      const membership: StoredProjectMember = {
        projectMembershipId: newId('pmb'), projectId: project.projectId, userId: input.userId,
        state: membershipPending ? 'pending_membership' : 'active',
        authorityEpoch: 1, activatedAt: membershipPending ? null : at,
        removalRequestedAt: null, removalRequestedByUserId: null, removedAt: null,
        revision: 1, createdAt: at, updatedAt: at
      }
      await tx.insertProjectMember(membership)

      let contentReadiness: StoredProjectContentReadiness | null = null
      const binding = project.contentMode === 'required'
        ? await tx.getProjectContentSpaceBindingForUpdate(project.projectId)
        : null
      if (project.contentMode === 'required') {
        const exactFact = required(fact, 'Provider principal fact')
        contentReadiness = {
          projectId: project.projectId, userId: input.userId,
          providerInstance: exactFact.providerPrincipal.providerInstance,
          state: 'pending', reason: 'provisioning_pending',
          providerPrincipalFactId: exactFact.providerPrincipalFactId,
          snapshottedFactRevision: exactFact.revision,
          providerPrincipal: exactFact.providerPrincipal,
          bindingRevision: null, lastObservationId: null,
          effectiveAt: at, revision: 1, createdAt: at, updatedAt: at
        }
        await tx.upsertProjectContentReadiness(contentReadiness, null)
      }

      const taskAuthorities: StoredTaskAuthority[] = []
      for (const scope of ['text_tasks', 'file_tasks'] as const) {
        const derived = deriveTaskAuthorityTransition({ projectStatus: project.status,
          contentMode: project.contentMode, membership, scope, readiness: contentReadiness, binding })
        const authority: StoredTaskAuthority = {
          taskAuthorityId: newId('tau'), projectId: project.projectId, userId: input.userId, scope,
          ...derived, authorityEpoch: 1, effectiveAt: at, revision: 1, createdAt: at, updatedAt: at
        }
        await tx.upsertTaskAuthority(authority, null)
        taskAuthorities.push(authority)
      }

      const provisioningIntent = project.contentMode === 'required'
        ? await createMembershipChangeIntent(tx, project, actor.userId, at, true)
        : null
      const updatedProject: StoredProject = { ...project, revision: project.revision + 1, updatedAt: at }
      await tx.updateProject(updatedProject, project.revision)
      const notifications: Array<{ recipient: InboxRecipient; sequence: number }> = []
      for (const recipient of [
        { kind: 'user', id: input.userId } as InboxRecipient,
        { kind: 'agent', id: project.coordinatorAgentId } as InboxRecipient
      ]) {
        const message = await this.appendInbox(tx, recipient, 'project.membership.changed', {
          protocolVersion: '1.0', type: 'project.membership.changed', projectId: project.projectId,
          projectMembershipId: membership.projectMembershipId, userId: membership.userId,
          state: membership.state, revision: membership.revision, authorityEpoch: membership.authorityEpoch
        }, at)
        notifications.push({ recipient: message.recipient, sequence: message.sequence })
      }
      return { response: { project: updatedProject, membership, taskAuthorities, contentReadiness, provisioningIntent },
        resourceKind: 'project_membership', resourceId: membership.projectMembershipId, notifications }
    }).then((response) => ({
      project: response.project as StoredProject,
      membership: response.membership as StoredProjectMember,
      taskAuthorities: response.taskAuthorities as StoredTaskAuthority[],
      contentReadiness: response.contentReadiness as StoredProjectContentReadiness | null,
      provisioningIntent: response.provisioningIntent as StoredProjectContentProvisioningIntent | null
    }))
  }

  async removeProjectMembership(
    actor: UserActor,
    input: CloudCommand<'project.membership.remove'>
  ): Promise<Readonly<{
    project: StoredProject
    membership: StoredProjectMember
    taskAuthorities: StoredTaskAuthority[]
    provisioningIntent: StoredProjectContentProvisioningIntent | null
  }>> {
    return this.commit(actor, 'project.membership.remove', input.idempotencyKey, input, async (tx, at) => {
      const project = required(await tx.getProjectForUpdate(input.projectId), 'Project')
      requireProjectOwner(project, actor)
      expectRevision(project.revision, input.expectedProjectRevision)
      const candidate = (await tx.listProjectMembers(project.projectId))
        .find(({ projectMembershipId }) => projectMembershipId === input.projectMembershipId)
      const membership = required(candidate ?? null, 'Project Membership')
      const locked = required(await tx.getProjectMemberForUpdate(project.projectId, membership.userId), 'Project Membership')
      expectRevision(locked.revision, input.expectedMembershipRevision)
      if (locked.userId === project.ownerUserId) fail('permission_denied', 'The Project Owner Membership cannot be removed.')
      const coordinator = required(await tx.getAgentForUpdate(project.coordinatorAgentId), 'Coordinator Agent')
      if (coordinator.ownerUserId === locked.userId) {
        fail('invalid_state_transition', 'Transfer Coordinator authority before removing its owning User.')
      }
      if (locked.state !== 'active') fail('invalid_state_transition', 'Only an active Project Membership may be removed.')

      const removalPending = project.contentMode === 'required'
      const updatedMembership: StoredProjectMember = {
        ...locked,
        state: removalPending ? 'membership_removal_pending' : 'removed',
        authorityEpoch: locked.authorityEpoch + 1,
        removalRequestedAt: at,
        removalRequestedByUserId: actor.userId,
        removedAt: removalPending ? null : at,
        revision: locked.revision + 1,
        updatedAt: at
      }
      await tx.updateProjectMember(updatedMembership, locked.revision)

      const taskAuthorities: StoredTaskAuthority[] = []
      for (const authority of await tx.listTaskAuthoritiesForUserForUpdate(project.projectId, locked.userId)) {
        const updated: StoredTaskAuthority = { ...authority, state: 'fenced',
          reason: removalPending ? 'membership_removal_pending' : 'membership_removed',
          authorityEpoch: authority.authorityEpoch + 1, effectiveAt: at,
          revision: authority.revision + 1, updatedAt: at }
        await tx.upsertTaskAuthority(updated, authority.revision)
        taskAuthorities.push(updated)
      }

      const notifications: Array<{ recipient: InboxRecipient; sequence: number }> = []
      for (const execution of await tx.listCurrentTaskExecutionsForProjectUserForUpdate(project.projectId, locked.userId)) {
        if (execution.fence.status === 'fenced') continue
        const task = required(await tx.getTaskForUpdate(execution.taskId), 'Current Task')
        if (task.currentExecutionId !== execution.executionId) continue
        const fenced = fenceTaskExecution(execution, 'cancelled',
          removalPending ? 'membership_removal_pending' : 'membership_removed', at)
        await tx.updateTaskExecution(fenced, execution.revision)
        await tx.updateTask({ ...task, status: 'revision_requested', currentExecutionState: 'cancelled',
          revision: task.revision + 1, updatedAt: at }, task.revision)
        if (execution.fileIntent !== null) await tx.invalidateCloudResourceRefs(task.taskId, execution.executionId, at)
        const workerMessage = await this.appendInbox(tx, { kind: 'agent', id: execution.assigneeAgentId },
          'task.execution.fenced', { protocolVersion: '1.0', type: 'task.execution.fenced',
            projectId: project.projectId, taskId: task.taskId, executionId: execution.executionId,
            reason: fenced.fence.reason }, at)
        notifications.push({ recipient: workerMessage.recipient, sequence: workerMessage.sequence })
      }

      const provisioningIntent = removalPending
        ? await createMembershipChangeIntent(tx, project, actor.userId, at, false)
        : null
      const updatedProject: StoredProject = { ...project, revision: project.revision + 1, updatedAt: at }
      await tx.updateProject(updatedProject, project.revision)
      const coordinatorMessage = await this.appendInbox(tx, { kind: 'agent', id: project.coordinatorAgentId },
        'project.membership.changed', { protocolVersion: '1.0', type: 'project.membership.changed',
          projectId: project.projectId, projectMembershipId: updatedMembership.projectMembershipId,
          userId: updatedMembership.userId, state: updatedMembership.state,
          revision: updatedMembership.revision, authorityEpoch: updatedMembership.authorityEpoch }, at)
      notifications.push({ recipient: coordinatorMessage.recipient, sequence: coordinatorMessage.sequence })
      return { response: { project: updatedProject, membership: updatedMembership,
        taskAuthorities, provisioningIntent }, resourceKind: 'project_membership',
        resourceId: updatedMembership.projectMembershipId, notifications }
    }).then((response) => ({
      project: response.project as StoredProject,
      membership: response.membership as StoredProjectMember,
      taskAuthorities: response.taskAuthorities as StoredTaskAuthority[],
      provisioningIntent: response.provisioningIntent as StoredProjectContentProvisioningIntent | null
    }))
  }

  async listProjectMemberships(
    actor: AuthContext,
    input: CloudCommand<'project.membership.list'>
  ): Promise<StoredProjectMember[]> {
    await requireProjectReader(this.repository, actor, input.projectId)
    return (await this.repository.listProjectMembers(input.projectId))
      .filter(({ state }) => input.includeRemoved || state !== 'removed')
      .sort((left, right) => left.projectMembershipId.localeCompare(right.projectMembershipId))
      .slice(0, input.limit)
  }

  async listProjectTaskAuthorities(
    actor: AuthContext,
    input: CloudCommand<'project.task_authority.list'>
  ): Promise<StoredTaskAuthority[]> {
    await requireProjectReader(this.repository, actor, input.projectId)
    return input.userId
      ? this.repository.listTaskAuthoritiesForUser(input.projectId, input.userId)
      : this.repository.listTaskAuthorities(input.projectId)
  }

  async getProjectContentProvisioningIntent(
    actor: AuthContext,
    input: CloudCommand<'project.content.provisioning_intent.get'>
  ): Promise<StoredProjectContentProvisioningIntent> {
    await requireProjectReader(this.repository, actor, input.projectId)
    const intent = input.provisioningIntentId
      ? await this.repository.getProjectContentProvisioningIntent(input.provisioningIntentId)
      : await this.repository.getLatestProjectContentProvisioningIntent(input.projectId)
    const exact = required(intent, 'Project Content provisioning intent')
    if (exact.projectId !== input.projectId) fail('permission_denied', 'The provisioning intent belongs to another Project.')
    return exact
  }

  async getProjectContentBinding(
    actor: AuthContext,
    input: CloudCommand<'project.content.binding.get'>
  ): Promise<StoredProjectContentSpaceBinding> {
    await requireProjectReader(this.repository, actor, input.projectId)
    return required(await this.repository.getProjectContentSpaceBinding(input.projectId), 'Project Content binding')
  }

  async attestProjectContent(
    actor: UserActor,
    input: CloudCommand<'project.content.attest'>
  ): Promise<Readonly<{
    project: StoredProject
    attestation: StoredProjectContentProvisioningAttestation
    binding: StoredProjectContentSpaceBinding
    observations: StoredProjectProviderMembershipObservation[]
    readiness: StoredProjectContentReadiness[]
    memberships: StoredProjectMember[]
  }>> {
    return this.commit(actor, 'project.content.attest', input.idempotencyKey, input, async (tx, at) => {
      const project = required(await tx.getProjectForUpdate(input.projectId), 'Project')
      requireProjectOwner(project, actor)
      expectRevision(project.revision, input.expectedProjectRevision)
      if (project.contentMode !== 'required' || project.contentOwnerUserId !== actor.userId) {
        fail('permission_denied', 'Only the current Project Content Owner may attest provisioning facts.')
      }
      const attested = input.attestation
      if (attested.projectId !== project.projectId || attested.ownerUserId !== actor.userId) {
        fail('validation_failed', 'The signed attestation must name the exact Project and Content Owner.')
      }
      const intent = required(
        await tx.getProjectContentProvisioningIntentForUpdate(attested.provisioningIntentId),
        'Project Content provisioning intent'
      )
      if (
        intent.projectId !== project.projectId ||
        intent.contentOwnerUserId !== actor.userId ||
        intent.provisioningRevision !== input.expectedProvisioningRevision ||
        attested.provisioningRevision !== intent.provisioningRevision ||
        !sameProviderInstanceReference(attested.providerInstance, intent.providerInstance)
      ) {
        fail('revision_conflict', 'The attestation does not match the exact current provisioning intent revision.')
      }
      if (intent.state !== 'awaiting_attestation') {
        fail('invalid_state_transition', 'Provisioning must finish its external-operation observations before attestation.')
      }
      if (await tx.getProjectContentProvisioningAttestation(attested.provisioningAttestationId)) {
        fail('revision_conflict', 'The provisioning attestation identity already exists.')
      }
      requireBoundedObservationTime(attested.observationCompletedAt, at)
      requireBoundedObservationTime(attested.deviceSignature.issuedAt, at)
      if (stableDigest(attested.rootLocator) !== attested.rootLocatorDigest) {
        fail('validation_failed', 'The attested root locator digest does not match its canonical locator.')
      }
      const memberSetDigest = createHash('sha256')
        .update(canonicalProvisionedMemberSetBytes(attested.memberObservations))
        .digest('hex')
      if (memberSetDigest !== attested.memberSetDigest) {
        fail('validation_failed', 'The attested Provider member-set digest does not match its canonical observations.')
      }
      const factualDigest = createHash('sha256')
        .update(canonicalProjectContentProvisioningAttestationFactualPayloadBytes(attested))
        .digest('hex')
      if (attested.deviceSignature.canonicalPayloadDigest !== factualDigest) {
        fail('validation_failed', 'The Device signature does not bind the canonical provisioning factual payload.')
      }
      const device = required(await tx.getDeviceForUpdate(attested.deviceSignature.deviceId), 'Attesting Device')
      if (
        device.userId !== actor.userId ||
        device.status !== 'active' ||
        device.revision !== attested.deviceSignature.deviceKeyRevision ||
        device.publicKeyJwk.kid !== attested.deviceSignature.deviceKeyId ||
        attested.deviceSignature.userId !== actor.userId ||
        attested.deviceSignature.factRevision !== intent.provisioningRevision ||
        !verifySignature(
          null,
          canonicalProjectContentProvisioningAttestationSignatureBytes(attested),
          createPublicKey({ key: device.publicKeyJwk, format: 'jwk' }),
          Buffer.from(attested.deviceSignature.signature, 'base64url')
        )
      ) {
        fail('permission_denied', 'The provisioning attestation lacks a current valid Project Owner Device signature.')
      }
      const ownerSnapshot = required(
        intent.desiredMembers.find(({ userId }) => userId === actor.userId) ?? null,
        'Content Owner Provider principal snapshot'
      )
      const ownerFact = required(
        await tx.getProviderDirectoryPrincipalFactForUpdate(ownerSnapshot.providerPrincipalFactId),
        'Content Owner Provider principal fact'
      )
      if (
        ownerFact.userId !== actor.userId || ownerFact.revision !== ownerSnapshot.snapshottedFactRevision ||
        ownerFact.readiness !== 'ready' ||
        ownerFact.principalIdentityRevision !== attested.principalIdentityRevision ||
        ownerFact.providerBindingAttestationDigest !== attested.providerBindingAttestationDigest
      ) {
        fail('revision_conflict', 'The Content Owner Provider identity facts changed after the intent snapshot.')
      }

      const intentJournals = (await tx.listExternalOperationJournal(project.projectId)).filter((journal) =>
        journal.provisioningIntentId === intent.provisioningIntentId &&
        journal.provisioningRevision === intent.provisioningRevision)
      for (const operation of attested.observedOperations) {
        const journal = intentJournals.find(({ logicalInvocationId }) => logicalInvocationId === operation.operationId)
        if (
          !journal || journal.state !== 'observed_success' ||
          externalOperationAttestationKind(journal.operation) !== operation.kind ||
          journal.requestDigest !== operation.requestDigest ||
          journal.receiptDigest !== operation.receiptDigest ||
          operation.outcome !== 'observed_success'
        ) {
          fail('revision_conflict', 'Every signed provisioning operation must match one exact observed-success recovery journal invocation.')
        }
      }

      const observedByUser = new Map(attested.memberObservations.map((observation) => [observation.userId, observation]))
      for (const desired of intent.desiredMembers) {
        const observation = required(observedByUser.get(desired.userId) ?? null, 'Desired Provider member observation')
        if (
          observation.presence !== 'present' ||
          observation.providerPrincipalFactId !== desired.providerPrincipalFactId ||
          observation.snapshottedFactRevision !== desired.snapshottedFactRevision ||
          stableDigest(observation.principal) !== stableDigest(desired.principal)
        ) {
          fail('revision_conflict', 'Every desired member must be observed present with the exact snapshotted principal fact.')
        }
      }
      const allMemberships = await tx.listProjectMembers(project.projectId)
      for (const observation of attested.memberObservations) {
        if (intent.desiredMembers.some(({ userId }) => userId === observation.userId)) continue
        const pending = allMemberships.find(({ userId }) => userId === observation.userId)
        const pendingReadiness = await tx.getProjectContentReadinessForUpdate(project.projectId, observation.userId)
        if (
          pending?.state !== 'membership_removal_pending' || observation.presence !== 'absent' ||
          pendingReadiness?.providerPrincipalFactId !== observation.providerPrincipalFactId ||
          pendingReadiness?.snapshottedFactRevision !== observation.snapshottedFactRevision ||
          stableDigest(pendingReadiness?.providerPrincipal) !== stableDigest(observation.principal)
        ) {
          fail('validation_failed', 'Only an exact pending-removal User may appear outside the desired Provider roster.')
        }
      }

      const currentBinding = await tx.getProjectContentSpaceBindingForUpdate(project.projectId)
      if (currentBinding?.status === 'closed') {
        fail('invalid_state_transition', 'A closed Project Content binding is terminal.')
      }
      if (
        currentBinding !== null && intent.kind === 'membership_change' &&
        currentBinding.rootLocator !== null &&
        (currentBinding.rootLocatorDigest !== attested.rootLocatorDigest ||
          stableDigest(currentBinding.rootLocator) !== stableDigest(attested.rootLocator))
      ) {
        fail('revision_conflict', 'A membership change cannot silently replace the Project Content root.')
      }
      const attestation: StoredProjectContentProvisioningAttestation = {
        provisioningAttestationId: attested.provisioningAttestationId,
        provisioningIntentId: intent.provisioningIntentId,
        projectId: project.projectId,
        provisioningRevision: intent.provisioningRevision,
        ownerUserId: actor.userId,
        principalIdentityRevision: attested.principalIdentityRevision,
        providerBindingAttestationDigest: attested.providerBindingAttestationDigest,
        providerInstance: attested.providerInstance,
        rootLocator: attested.rootLocator,
        rootLocatorDigest: attested.rootLocatorDigest,
        observedOperations: attested.observedOperations,
        memberObservations: attested.memberObservations,
        memberSetDigest: attested.memberSetDigest,
        observationStartedAt: attested.observationStartedAt,
        observationCompletedAt: attested.observationCompletedAt,
        deviceSignature: attested.deviceSignature,
        revision: 1, createdAt: at, updatedAt: at
      }
      await tx.insertProjectContentProvisioningAttestation(attestation)
      const attestationDigest = stableDigest(attested)
      const bindingRevision = (currentBinding?.revision ?? 0) + 1
      const binding: StoredProjectContentSpaceBinding = {
        projectContentBindingId: currentBinding?.projectContentBindingId ?? newId('pcb'),
        projectId: project.projectId,
        contentOwnerUserId: actor.userId,
        providerInstance: attested.providerInstance,
        rootLocator: attested.rootLocator,
        rootLocatorDigest: attested.rootLocatorDigest,
        provisioningIntentId: intent.provisioningIntentId,
        provisioningRevision: intent.provisioningRevision,
        attestationId: attestation.provisioningAttestationId,
        attestationDigest,
        status: 'active', statusReason: null,
        activatedAt: currentBinding?.activatedAt ?? at,
        degradedAt: null, closedAt: null,
        revision: bindingRevision,
        createdAt: currentBinding?.createdAt ?? at,
        updatedAt: at
      }
      await tx.upsertProjectContentSpaceBinding(binding, currentBinding?.revision ?? null)

      const observations: StoredProjectProviderMembershipObservation[] = []
      const readinessRows: StoredProjectContentReadiness[] = []
      const memberships: StoredProjectMember[] = []
      for (const observed of attested.memberObservations) {
        const providerObservation: StoredProjectProviderMembershipObservation = {
          providerObservationId: newId('pob'), projectId: project.projectId, userId: observed.userId,
          providerPrincipalFactId: observed.providerPrincipalFactId,
          snapshottedFactRevision: observed.snapshottedFactRevision,
          providerPrincipal: observed.principal,
          bindingRevision: binding.revision, provisioningRevision: intent.provisioningRevision,
          source: 'provisioning_attestation', outcome: observed.presence,
          observerUserId: actor.userId, observerDeviceId: device.deviceId, observerAgentId: null,
          provisioningAttestationId: attestation.provisioningAttestationId,
          evidenceDigest: observed.observationDigest, observedAt: observed.observedAt,
          revision: 1, createdAt: at, updatedAt: at
        }
        await tx.insertProjectProviderMembershipObservation(providerObservation)
        observations.push(providerObservation)
        const currentReadiness = await tx.getProjectContentReadinessForUpdate(project.projectId, observed.userId)
        if (currentReadiness) {
          const readiness: StoredProjectContentReadiness = { ...currentReadiness,
            state: observed.presence === 'present' ? 'ready' : 'degraded',
            reason: observed.presence === 'present' ? null : 'provider_member_absent',
            bindingRevision: binding.revision, lastObservationId: providerObservation.providerObservationId,
            effectiveAt: observed.observedAt, revision: currentReadiness.revision + 1, updatedAt: at }
          await tx.upsertProjectContentReadiness(readiness, currentReadiness.revision)
          readinessRows.push(readiness)
        }
        const currentMembership = await tx.getProjectMemberForUpdate(project.projectId, observed.userId)
        if (currentMembership?.state === 'pending_membership' && observed.presence === 'present') {
          const activated: StoredProjectMember = {
            ...currentMembership,
            state: 'active',
            authorityEpoch: currentMembership.authorityEpoch + 1,
            activatedAt: at,
            revision: currentMembership.revision + 1,
            updatedAt: at
          }
          await tx.updateProjectMember(activated, currentMembership.revision)
          memberships.push(activated)
        } else if (
          currentMembership?.state === 'membership_removal_pending' &&
          observed.presence === 'absent'
        ) {
          const removed: StoredProjectMember = { ...currentMembership, state: 'removed',
            authorityEpoch: currentMembership.authorityEpoch + 1, removedAt: at,
            revision: currentMembership.revision + 1, updatedAt: at }
          await tx.updateProjectMember(removed, currentMembership.revision)
          memberships.push(removed)
        }
      }

      for (const desired of intent.desiredMembers) {
        const membership = required(await tx.getProjectMemberForUpdate(project.projectId, desired.userId), 'Project Membership')
        const readiness = required(await tx.getProjectContentReadinessForUpdate(project.projectId, desired.userId), 'Content readiness')
        for (const scope of ['text_tasks', 'file_tasks'] as const) {
          const authority = required(await tx.getTaskAuthorityForUpdate(project.projectId, desired.userId, scope), 'Task authority')
          const derived = deriveTaskAuthorityTransition({ projectStatus: project.status,
            contentMode: project.contentMode, membership, scope, readiness, binding })
          await tx.upsertTaskAuthority({ ...authority, ...derived,
            authorityEpoch: authority.authorityEpoch + 1, effectiveAt: at,
            revision: authority.revision + 1, updatedAt: at }, authority.revision)
        }
      }
      await tx.updateProjectContentProvisioningIntent({ ...intent, state: 'completed',
        revision: intent.revision + 1, updatedAt: at }, intent.revision)
      const updatedProject: StoredProject = { ...project, revision: project.revision + 1, updatedAt: at }
      await tx.updateProject(updatedProject, project.revision)
      const message = await this.appendInbox(tx, { kind: 'agent', id: project.coordinatorAgentId },
        'project.content.binding.changed', { protocolVersion: '1.0', type: 'project.content.binding.changed',
          projectId: project.projectId, projectContentBindingId: binding.projectContentBindingId,
          status: binding.status, revision: binding.revision }, at)
      return { response: { project: updatedProject, attestation, binding, observations,
        readiness: readinessRows, memberships }, resourceKind: 'project_content_space_binding',
        resourceId: binding.projectContentBindingId,
        notifications: [{ recipient: message.recipient, sequence: message.sequence }] }
    }).then((response) => ({
      project: response.project as StoredProject,
      attestation: response.attestation as StoredProjectContentProvisioningAttestation,
      binding: response.binding as StoredProjectContentSpaceBinding,
      observations: response.observations as StoredProjectProviderMembershipObservation[],
      readiness: response.readiness as StoredProjectContentReadiness[],
      memberships: response.memberships as StoredProjectMember[]
    }))
  }

  async submitProjectContentObservation(
    actor: UserActor,
    input: CloudCommand<'project.content.observation.submit'>
  ): Promise<Readonly<{
    project: StoredProject
    observation: StoredProjectProviderMembershipObservation
    readiness: StoredProjectContentReadiness
    membership: StoredProjectMember
    binding: StoredProjectContentSpaceBinding
  }>> {
    return this.commit(actor, 'project.content.observation.submit', input.idempotencyKey, input, async (tx, at) => {
      const project = required(await tx.getProjectForUpdate(input.projectId), 'Project')
      expectRevision(project.revision, input.expectedProjectRevision)
      if (project.contentMode !== 'required') fail('invalid_state_transition', 'The Project has no Content binding.')
      const source = input.observation
      if (source.projectId !== project.projectId || source.observerUserId !== actor.userId) {
        fail('permission_denied', 'The observation must come from its exact authenticated OIDC observer.')
      }
      if (source.source === 'provisioning_attestation') {
        fail('validation_failed', 'Provisioning-attestation observations are created only by the signed attestation transaction.')
      }
      const observerMembership = await tx.getProjectMemberForUpdate(project.projectId, actor.userId)
      if (project.ownerUserId !== actor.userId && observerMembership?.state !== 'active') {
        fail('permission_denied', 'Only the Owner or an active Project member may submit Provider observations.')
      }
      if (source.source === 'explicit_reconcile' && project.ownerUserId !== actor.userId) {
        fail('permission_denied', 'Only the Project Owner may submit an explicit Provider reconcile observation.')
      }
      if (source.source === 'download_check' || source.source === 'upload_new') {
        if (source.userId !== actor.userId) {
          fail('permission_denied', 'A transfer observation must target the exact authenticated Worker User.')
        }
        if (source.observerAgentId === null) {
          fail('validation_failed', 'A transfer observation requires the exact executing Worker Agent.')
        }
      }
      const observerDevice = required(await tx.getDeviceForUpdate(source.observerDeviceId), 'Observer Device')
      if (observerDevice.userId !== actor.userId || observerDevice.status !== 'active') {
        fail('credential_revoked', 'Provider observation requires the exact active OIDC User Device.')
      }
      if (source.observerAgentId !== null) {
        const observerAgent = required(await tx.getAgentForUpdate(source.observerAgentId), 'Observer Agent')
        if (observerAgent.ownerUserId !== actor.userId || observerAgent.deviceId !== observerDevice.deviceId || observerAgent.status !== 'active') {
          fail('credential_revoked', 'The observation Agent is not active on the exact observer Device.')
        }
      }
      requireBoundedObservationTime(source.observedAt, at)
      if (await tx.getProjectProviderMembershipObservation(source.providerObservationId)) {
        fail('revision_conflict', 'The Provider observation identity already exists.')
      }
      const binding = required(await tx.getProjectContentSpaceBindingForUpdate(project.projectId), 'Project Content binding')
      if (binding.status === 'closed') {
        fail('invalid_state_transition', 'A closed Project Content binding no longer accepts Provider observations.')
      }
      if (source.bindingRevision !== binding.revision || source.provisioningRevision !== binding.provisioningRevision) {
        fail('revision_conflict', 'The Provider observation does not target the exact Content binding and provisioning revision.')
      }
      const readiness = required(await tx.getProjectContentReadinessForUpdate(project.projectId, source.userId), 'Project Content readiness')
      const membership = required(await tx.getProjectMemberForUpdate(project.projectId, source.userId), 'Project Membership')
      if (
        source.providerPrincipalFactId !== readiness.providerPrincipalFactId ||
        source.snapshottedFactRevision !== readiness.snapshottedFactRevision ||
        stableDigest(source.providerPrincipal) !== stableDigest(readiness.providerPrincipal)
      ) {
        fail('revision_conflict', 'The observation does not match the exact Project Provider principal snapshot.')
      }
      if (source.outcome === 'present') {
        const currentFact = await tx.getProviderDirectoryPrincipalFactForSlotForUpdate(source.userId, readiness.providerInstance)
        if (
          currentFact?.providerPrincipalFactId !== source.providerPrincipalFactId ||
          currentFact.revision !== source.snapshottedFactRevision || currentFact.readiness !== 'ready'
        ) {
          fail('revision_conflict', 'A present observation cannot restore readiness from a stale global Provider principal fact.')
        }
      }
      const observation: StoredProjectProviderMembershipObservation = {
        providerObservationId: source.providerObservationId, projectId: source.projectId, userId: source.userId,
        providerPrincipalFactId: source.providerPrincipalFactId,
        snapshottedFactRevision: source.snapshottedFactRevision,
        providerPrincipal: source.providerPrincipal, bindingRevision: source.bindingRevision,
        provisioningRevision: source.provisioningRevision, source: source.source, outcome: source.outcome,
        observerUserId: source.observerUserId, observerDeviceId: source.observerDeviceId,
        observerAgentId: source.observerAgentId, provisioningAttestationId: source.provisioningAttestationId,
        evidenceDigest: source.evidenceDigest, observedAt: source.observedAt,
        revision: 1, createdAt: at, updatedAt: at
      }
      await tx.insertProjectProviderMembershipObservation(observation)
      const nextState = source.outcome === 'present' ? 'ready' as const : 'degraded' as const
      const reason = source.outcome === 'present' ? null
        : source.outcome === 'absent' ? 'provider_member_absent' as const
          : source.outcome === 'unauthorized' ? 'provider_unauthorized' as const
            : 'provider_unavailable' as const
      const updatedReadiness: StoredProjectContentReadiness = { ...readiness, state: nextState, reason,
        bindingRevision: binding.revision, lastObservationId: observation.providerObservationId,
        effectiveAt: source.observedAt, revision: readiness.revision + 1, updatedAt: at }
      await tx.upsertProjectContentReadiness(updatedReadiness, readiness.revision)

      let updatedMembership = membership
      if (membership.state === 'membership_removal_pending' && source.outcome === 'absent') {
        updatedMembership = { ...membership, state: 'removed', authorityEpoch: membership.authorityEpoch + 1,
          removedAt: at, revision: membership.revision + 1, updatedAt: at }
        await tx.updateProjectMember(updatedMembership, membership.revision)
      }
      let updatedBinding = binding
      let rebindIntent: StoredProjectContentProvisioningIntent | null = null
      const ownerLostRoot = source.userId === project.contentOwnerUserId &&
        (source.outcome === 'absent' || source.outcome === 'unauthorized')
      if (ownerLostRoot && binding.status === 'active') {
        updatedBinding = { ...binding, status: 'degraded', statusReason: 'owner_access_lost',
          degradedAt: at, revision: binding.revision + 1, updatedAt: at }
        await tx.upsertProjectContentSpaceBinding(updatedBinding, binding.revision)
        await tx.invalidateCloudResourceRefsForBinding(project.projectId, binding.revision, at)
        rebindIntent = await createOwnerRebindIntent(tx, project, updatedBinding, actor.userId, at)
      }

      const affectedUsers = ownerLostRoot
        ? (await tx.listProjectMembers(project.projectId)).map(({ userId }) => userId)
        : [source.userId]
      const notifications: Array<{ recipient: InboxRecipient; sequence: number }> = []
      if (updatedBinding !== binding) {
        const bindingMessage = await this.appendInbox(tx, { kind: 'agent', id: project.coordinatorAgentId },
          'project.content.binding.changed', { protocolVersion: '1.0', type: 'project.content.binding.changed',
            projectId: project.projectId, projectContentBindingId: updatedBinding.projectContentBindingId,
            status: updatedBinding.status, revision: updatedBinding.revision }, at)
        notifications.push({ recipient: bindingMessage.recipient, sequence: bindingMessage.sequence })
      }
      if (rebindIntent !== null) {
        const intentMessage = await this.appendInbox(tx, { kind: 'agent', id: project.coordinatorAgentId },
          'project.content.provisioning_intent.changed', { protocolVersion: '1.0',
            type: 'project.content.provisioning_intent.changed', projectId: project.projectId,
            provisioningIntentId: rebindIntent.provisioningIntentId,
            provisioningRevision: rebindIntent.provisioningRevision,
            state: rebindIntent.state, revision: rebindIntent.revision }, at)
        notifications.push({ recipient: intentMessage.recipient, sequence: intentMessage.sequence })
      }
      for (const userId of affectedUsers) {
        const userMembership = await tx.getProjectMemberForUpdate(project.projectId, userId)
        const userReadiness = await tx.getProjectContentReadinessForUpdate(project.projectId, userId)
        if (userMembership) {
          const authority = await tx.getTaskAuthorityForUpdate(project.projectId, userId, 'file_tasks')
          if (authority) {
            const derived = deriveTaskAuthorityTransition({ projectStatus: project.status,
              contentMode: project.contentMode, membership: userMembership,
              scope: 'file_tasks', readiness: userReadiness, binding: updatedBinding })
            await tx.upsertTaskAuthority({ ...authority, ...derived,
              authorityEpoch: authority.authorityEpoch + 1, effectiveAt: at,
              revision: authority.revision + 1, updatedAt: at }, authority.revision)
          }
        }
        for (const execution of await tx.listCurrentTaskExecutionsForProjectUserForUpdate(project.projectId, userId)) {
          if (execution.fileIntent === null || execution.fence.status === 'fenced') continue
          const task = required(await tx.getTaskForUpdate(execution.taskId), 'Current file Task')
          if (task.currentExecutionId !== execution.executionId) continue
          const fenced = fenceTaskExecution(execution, 'cancelled', 'execution_cancelled', at)
          await tx.updateTaskExecution(fenced, execution.revision)
          await tx.updateTask({ ...task, status: 'revision_requested', currentExecutionState: 'cancelled',
            revision: task.revision + 1, updatedAt: at }, task.revision)
          await tx.invalidateCloudResourceRefs(task.taskId, execution.executionId, at)
          const message = await this.appendInbox(tx, { kind: 'agent', id: execution.assigneeAgentId },
            'task.execution.fenced', { protocolVersion: '1.0', type: 'task.execution.fenced',
              projectId: project.projectId, taskId: task.taskId, executionId: execution.executionId,
              reason: source.outcome }, at)
          notifications.push({ recipient: message.recipient, sequence: message.sequence })
        }
      }
      const updatedProject: StoredProject = { ...project, revision: project.revision + 1, updatedAt: at }
      await tx.updateProject(updatedProject, project.revision)
      const coordinatorMessage = await this.appendInbox(tx, { kind: 'agent', id: project.coordinatorAgentId },
        'project.content.readiness.changed', { protocolVersion: '1.0', type: 'project.content.readiness.changed',
          projectId: project.projectId, userId: source.userId, state: updatedReadiness.state,
          revision: updatedReadiness.revision }, at)
      notifications.push({ recipient: coordinatorMessage.recipient, sequence: coordinatorMessage.sequence })
      return { response: { project: updatedProject, observation, readiness: updatedReadiness,
        membership: updatedMembership, binding: updatedBinding }, resourceKind: 'project_provider_membership_observation',
        resourceId: observation.providerObservationId, notifications }
    }).then((response) => ({
      project: response.project as StoredProject,
      observation: response.observation as StoredProjectProviderMembershipObservation,
      readiness: response.readiness as StoredProjectContentReadiness,
      membership: response.membership as StoredProjectMember,
      binding: response.binding as StoredProjectContentSpaceBinding
    }))
  }

  async closeProjectContentBinding(
    actor: UserActor,
    input: CloudCommand<'project.content.binding.close'>
  ): Promise<Readonly<{ project: StoredProject; binding: StoredProjectContentSpaceBinding }>> {
    return this.commit(actor, 'project.content.binding.close', input.idempotencyKey, input, async (tx, at) => {
      const project = required(await tx.getProjectForUpdate(input.projectId), 'Project')
      requireProjectOwner(project, actor)
      expectRevision(project.revision, input.expectedProjectRevision)
      const binding = required(await tx.getProjectContentSpaceBindingForUpdate(project.projectId), 'Project Content binding')
      expectRevision(binding.revision, input.expectedBindingRevision)
      if (binding.status === 'closed') fail('invalid_state_transition', 'The Project Content binding is already closed.')
      const closed: StoredProjectContentSpaceBinding = { ...binding, status: 'closed', statusReason: input.reason,
        closedAt: at, revision: binding.revision + 1, updatedAt: at }
      await tx.upsertProjectContentSpaceBinding(closed, binding.revision)
      await tx.invalidateCloudResourceRefsForBinding(project.projectId, binding.revision, at)
      const notifications: Array<{ recipient: InboxRecipient; sequence: number }> = []
      for (const membership of await tx.listProjectMembers(project.projectId)) {
        const authority = await tx.getTaskAuthorityForUpdate(project.projectId, membership.userId, 'file_tasks')
        if (authority) {
          await tx.upsertTaskAuthority({ ...authority, state: 'suspended', reason: 'content_binding_degraded',
            authorityEpoch: authority.authorityEpoch + 1, effectiveAt: at,
            revision: authority.revision + 1, updatedAt: at }, authority.revision)
        }
      }
      for (const execution of await tx.listCurrentTaskExecutionsForProjectForUpdate(project.projectId)) {
        if (execution.fileIntent === null || execution.fence.status === 'fenced') continue
        const task = required(await tx.getTaskForUpdate(execution.taskId), 'Current file Task')
        if (task.currentExecutionId !== execution.executionId) continue
        const fenced = fenceTaskExecution(execution, 'cancelled', 'execution_cancelled', at)
        await tx.updateTaskExecution(fenced, execution.revision)
        await tx.updateTask({ ...task, status: 'revision_requested', currentExecutionState: 'cancelled',
          revision: task.revision + 1, updatedAt: at }, task.revision)
        const message = await this.appendInbox(tx, { kind: 'agent', id: execution.assigneeAgentId },
          'task.execution.fenced', { protocolVersion: '1.0', type: 'task.execution.fenced',
            projectId: project.projectId, taskId: task.taskId, executionId: execution.executionId,
            reason: 'content_binding_closed' }, at)
        notifications.push({ recipient: message.recipient, sequence: message.sequence })
      }
      const updatedProject: StoredProject = { ...project, revision: project.revision + 1, updatedAt: at }
      await tx.updateProject(updatedProject, project.revision)
      const coordinatorMessage = await this.appendInbox(tx, { kind: 'agent', id: project.coordinatorAgentId },
        'project.content.binding.changed', { protocolVersion: '1.0', type: 'project.content.binding.changed',
          projectId: project.projectId, projectContentBindingId: closed.projectContentBindingId,
          status: closed.status, revision: closed.revision }, at)
      notifications.push({ recipient: coordinatorMessage.recipient, sequence: coordinatorMessage.sequence })
      return { response: { project: updatedProject, binding: closed }, resourceKind: 'project_content_space_binding',
        resourceId: closed.projectContentBindingId, notifications }
    }).then((response) => ({ project: response.project as StoredProject,
      binding: response.binding as StoredProjectContentSpaceBinding }))
  }

  async prepareExternalOperation(
    actor: UserActor | AgentActor,
    input: CloudCommand<'external_operation.prepare'>
  ): Promise<StoredExternalOperationJournal> {
    return this.commit(actor, 'external_operation.prepare', input.idempotencyKey, input, async (tx, at) => {
      const project = required(await tx.getProjectForUpdate(input.projectId), 'Project')
      const existing = await tx.getExternalOperationJournalForUpdate(input.logicalInvocationId)
      if (existing) {
        if (stableDigest(externalJournalRequestFacts(existing)) !== stableDigest(externalPrepareRequestFacts(input))) {
          fail('idempotency_conflict', 'The logical external invocation already names different immutable facts.')
        }
        await authorizeExternalJournalActor(tx, actor, existing, at)
        return { response: entityResponse('external_operation.prepared', existing),
          resourceKind: 'external_operation_recovery_journal_entry',
          resourceId: existing.contentRecoveryJournalEntryId }
      }
      assertExternalOperationForScope(input.scope, input.operation)
      if (input.scope === 'task_content_transfer') {
        if (actor.kind !== 'agent_device') fail('permission_denied', 'Task Content operations require the exact Worker Agent.')
        const task = required(await tx.getTaskForUpdate(input.taskId!), 'Task')
        const execution = required(await tx.getTaskExecutionForUpdate(input.executionId!), 'Task execution')
        expectRevision(task.revision, input.preparedTaskRevision!)
        expectRevision(execution.revision, input.preparedExecutionRevision!)
        if (task.projectId !== project.projectId || task.currentExecutionId !== execution.executionId || task.fileIntent === null) {
          fail('revision_conflict', 'The external operation does not target the exact current file Task execution.')
        }
        requireExactAssignee(actor, execution)
        assertOpenCurrentExecution(project, task, execution)
        await requireCurrentExecutionAuthority(tx, project, execution, at)
      } else {
        if (actor.kind !== 'user') fail('permission_denied', 'Project Content administration requires the Project Owner OIDC User.')
        requireProjectOwner(project, actor)
        const intent = required(
          await tx.getProjectContentProvisioningIntentForUpdate(input.provisioningIntentId!),
          'Project Content provisioning intent'
        )
        if (intent.projectId !== project.projectId || intent.provisioningRevision !== input.provisioningRevision) {
          fail('revision_conflict', 'The external operation does not target the exact provisioning intent revision.')
        }
        if (!['pending', 'in_progress', 'awaiting_attestation', 'manual_recovery_required'].includes(intent.state)) {
          fail('invalid_state_transition', 'The provisioning intent cannot dispatch another external operation.')
        }
        if (intent.state !== 'in_progress') {
          await tx.updateProjectContentProvisioningIntent({ ...intent, state: 'in_progress',
            revision: intent.revision + 1, updatedAt: at }, intent.revision)
        }
      }
      const journal: StoredExternalOperationJournal = {
        contentRecoveryJournalEntryId: newId('crj'), scope: input.scope,
        logicalInvocationId: input.logicalInvocationId, projectId: project.projectId,
        taskId: input.taskId, preparedTaskRevision: input.preparedTaskRevision,
        provisioningIntentId: input.provisioningIntentId, provisioningRevision: input.provisioningRevision,
        executionId: input.executionId, preparedExecutionRevision: input.preparedExecutionRevision,
        operation: input.operation, requestDigest: input.requestDigest,
        state: 'prepared', observationDigest: null, receiptDigest: null, safeFailureCode: null,
        preparedAt: at, dispatchedAt: null, resolvedAt: null,
        revision: 1, createdAt: at, updatedAt: at
      }
      await tx.insertExternalOperationJournal(journal)
      return { response: entityResponse('external_operation.prepared', journal),
        resourceKind: 'external_operation_recovery_journal_entry',
        resourceId: journal.contentRecoveryJournalEntryId }
    }).then(responseEntity<StoredExternalOperationJournal>)
  }

  async dispatchExternalOperation(
    actor: UserActor | AgentActor,
    input: CloudCommand<'external_operation.dispatch'>
  ): Promise<StoredExternalOperationJournal> {
    return this.commit(actor, 'external_operation.dispatch', input.idempotencyKey, input, async (tx, at) => {
      const journal = required(
        await tx.getExternalOperationJournalByIdForUpdate(input.journalEntryId),
        'External operation recovery journal entry'
      )
      expectRevision(journal.revision, input.expectedJournalRevision)
      await authorizeExternalJournalActor(tx, actor, journal, at)
      if (journal.state !== 'prepared') fail('invalid_state_transition', 'Only a prepared external operation may be dispatched.')
      const dispatched: StoredExternalOperationJournal = { ...journal, state: 'dispatched',
        dispatchedAt: at, revision: journal.revision + 1, updatedAt: at }
      await tx.updateExternalOperationJournal(dispatched, journal.revision)
      return { response: entityResponse('external_operation.dispatched', dispatched),
        resourceKind: 'external_operation_recovery_journal_entry',
        resourceId: journal.contentRecoveryJournalEntryId }
    }).then(responseEntity<StoredExternalOperationJournal>)
  }

  async observeExternalOperation(
    actor: UserActor | AgentActor,
    input: CloudCommand<'external_operation.observe'>
  ): Promise<Readonly<{
    journal: StoredExternalOperationJournal
    recoveryAction: StoredVisibleRecoveryAction | null
    task: StoredTask | null
    execution: StoredTaskExecution | null
    provisioningIntent: StoredProjectContentProvisioningIntent | null
  }>> {
    return this.commit(actor, 'external_operation.observe', input.idempotencyKey, input, async (tx, at) => {
      const journal = required(
        await tx.getExternalOperationJournalByIdForUpdate(input.journalEntryId),
        'External operation recovery journal entry'
      )
      expectRevision(journal.revision, input.expectedJournalRevision)
      const authority = await authorizeExternalJournalActor(tx, actor, journal, at)
      if (journal.state !== 'dispatched' && journal.state !== 'outcome_unknown') {
        fail('invalid_state_transition', 'Only a dispatched or unresolved external operation may be observed.')
      }
      if (journal.state === 'outcome_unknown' && input.outcome === 'outcome_unknown') {
        fail('invalid_state_transition', 'An unresolved operation requires a fresh success/failure observation or explicit abandonment.')
      }
      const existingRecoveryActions = (await tx.listVisibleRecoveryActionsByProject(journal.projectId))
        .filter((action) => action.journalEntryId === journal.contentRecoveryJournalEntryId && action.status === 'available')
      const resolvedAt = input.outcome === 'outcome_unknown' ? null : at
      const observed: StoredExternalOperationJournal = { ...journal, state: input.outcome,
        receiptDigest: input.receiptDigest, observationDigest: input.observationDigest,
        safeFailureCode: input.safeFailureCode, resolvedAt,
        revision: journal.revision + 1, updatedAt: at }
      await tx.updateExternalOperationJournal(observed, journal.revision)

      let recoveryAction: StoredVisibleRecoveryAction | null = null
      let task: StoredTask | null = authority.task
      let execution: StoredTaskExecution | null = authority.execution
      let provisioningIntent: StoredProjectContentProvisioningIntent | null = authority.intent
      const notifications: Array<{ recipient: InboxRecipient; sequence: number }> = []
      if (input.outcome === 'observed_success') {
        for (const action of existingRecoveryActions) {
          await tx.updateVisibleRecoveryAction({ ...action, status: 'withdrawn',
            completedAt: null, revision: action.revision + 1, updatedAt: at }, action.revision)
        }
        if (authority.intent && authority.intent.state !== 'awaiting_attestation') {
          provisioningIntent = { ...authority.intent, state: 'awaiting_attestation',
            revision: authority.intent.revision + 1, updatedAt: at }
          await tx.updateProjectContentProvisioningIntent(provisioningIntent, authority.intent.revision)
          const message = await this.appendInbox(tx, { kind: 'agent', id: authority.project.coordinatorAgentId },
            'project.content.provisioning_intent.changed', { protocolVersion: '1.0',
              type: 'project.content.provisioning_intent.changed', projectId: authority.project.projectId,
              provisioningIntentId: provisioningIntent.provisioningIntentId,
              provisioningRevision: provisioningIntent.provisioningRevision,
              state: provisioningIntent.state, revision: provisioningIntent.revision }, at)
          notifications.push({ recipient: message.recipient, sequence: message.sequence })
        }
      } else {
        for (const action of existingRecoveryActions) {
          await tx.updateVisibleRecoveryAction({ ...action, status: 'withdrawn',
            completedAt: null, revision: action.revision + 1, updatedAt: at }, action.revision)
        }
        recoveryAction = buildVisibleRecoveryAction(observed, at)
        await tx.insertVisibleRecoveryAction(recoveryAction)
        if (authority.intent && authority.intent.state !== 'manual_recovery_required') {
          provisioningIntent = { ...authority.intent, state: 'manual_recovery_required',
            revision: authority.intent.revision + 1, updatedAt: at }
          await tx.updateProjectContentProvisioningIntent(provisioningIntent, authority.intent.revision)
        }
        if (authority.task && authority.execution) {
          execution = fenceTaskExecution(authority.execution, 'manual_recovery_required', 'manual_recovery_required', at)
          task = { ...authority.task, status: 'manual_recovery_required',
            currentExecutionState: 'manual_recovery_required', revision: authority.task.revision + 1, updatedAt: at }
          await tx.updateTaskExecution(execution, authority.execution.revision)
          await tx.updateTask(task, authority.task.revision)
        }
        if (
          actor.kind === 'agent_device' &&
          authority.execution !== null &&
          input.outcome === 'observed_failure'
        ) {
          notifications.push(...await this.applyTaskTransferProviderFailure(
            tx,
            actor,
            authority.project,
            authority.execution,
            observed,
            at
          ))
        }
        const recipient = recoveryAction.audience === 'owner'
          ? { kind: 'user', id: authority.project.ownerUserId } as InboxRecipient
          : { kind: 'agent', id: authority.project.coordinatorAgentId } as InboxRecipient
        const message = await this.appendInbox(tx, recipient, 'project.recovery.action.changed', {
          protocolVersion: '1.0', type: 'project.recovery.action.changed',
          projectId: authority.project.projectId, recoveryActionId: recoveryAction.recoveryActionId,
          revision: recoveryAction.revision
        }, at)
        notifications.push({ recipient: message.recipient, sequence: message.sequence })
      }
      return { response: { journal: observed, recoveryAction, task, execution, provisioningIntent },
        resourceKind: 'external_operation_recovery_journal_entry',
        resourceId: observed.contentRecoveryJournalEntryId, notifications }
    }).then((response) => ({
      journal: response.journal as StoredExternalOperationJournal,
      recoveryAction: response.recoveryAction as StoredVisibleRecoveryAction | null,
      task: response.task as StoredTask | null,
      execution: response.execution as StoredTaskExecution | null,
      provisioningIntent: response.provisioningIntent as StoredProjectContentProvisioningIntent | null
    }))
  }

  private async applyTaskTransferProviderFailure(
    tx: CollaborationTransaction,
    actor: AgentActor,
    project: StoredProject,
    currentExecution: StoredTaskExecution,
    journal: StoredExternalOperationJournal,
    at: string
  ): Promise<Array<{ recipient: InboxRecipient; sequence: number }>> {
    const outcome = taskTransferProviderObservationOutcome(journal.safeFailureCode)
    if (outcome === null || (journal.operation !== 'download' && journal.operation !== 'upload_new')) return []
    const binding = required(
      await tx.getProjectContentSpaceBindingForUpdate(project.projectId),
      'Project Content binding'
    )
    if (
      binding.status === 'closed' ||
      currentExecution.fence.bindingRevision === null ||
      binding.revision !== currentExecution.fence.bindingRevision
    ) {
      fail('revision_conflict', 'The Provider failure no longer targets the exact current Content binding.')
    }
    const readiness = required(
      await tx.getProjectContentReadinessForUpdate(project.projectId, actor.userId),
      'Worker Project Content readiness'
    )
    const membership = required(
      await tx.getProjectMemberForUpdate(project.projectId, actor.userId),
      'Worker Project Membership'
    )
    if (
      membership.state !== 'active' ||
      readiness.providerPrincipalFactId === null ||
      readiness.snapshottedFactRevision === null ||
      readiness.providerPrincipal === null
    ) {
      fail('revision_conflict', 'The Provider failure lacks the exact active Worker Content snapshot.')
    }
    const providerObservationId = `pob_${stableDigest({
      journalEntryId: journal.contentRecoveryJournalEntryId,
      kind: ['task', 'transfer', 'provider', 'failure'].join('-')
    }).slice(0, 24)}`
    const observation: StoredProjectProviderMembershipObservation = {
      providerObservationId,
      projectId: project.projectId,
      userId: actor.userId,
      providerPrincipalFactId: readiness.providerPrincipalFactId,
      snapshottedFactRevision: readiness.snapshottedFactRevision,
      providerPrincipal: readiness.providerPrincipal,
      bindingRevision: binding.revision,
      provisioningRevision: binding.provisioningRevision,
      source: journal.operation === 'download' ? 'download_check' : 'upload_new',
      outcome,
      observerUserId: actor.userId,
      observerDeviceId: actor.deviceId,
      observerAgentId: actor.agentId,
      provisioningAttestationId: null,
      evidenceDigest: stableDigest({
        journalEntryId: journal.contentRecoveryJournalEntryId,
        journalRevision: journal.revision,
        requestDigest: journal.requestDigest,
        safeFailureCode: journal.safeFailureCode,
        observedAt: at
      }),
      observedAt: at,
      revision: 1,
      createdAt: at,
      updatedAt: at
    }
    await tx.insertProjectProviderMembershipObservation(observation)
    const updatedReadiness: StoredProjectContentReadiness = {
      ...readiness,
      state: 'degraded',
      reason: outcome === 'unauthorized' ? 'provider_unauthorized' : 'provider_unavailable',
      bindingRevision: binding.revision,
      lastObservationId: observation.providerObservationId,
      effectiveAt: at,
      revision: readiness.revision + 1,
      updatedAt: at
    }
    await tx.upsertProjectContentReadiness(updatedReadiness, readiness.revision)

    let updatedBinding = binding
    let rebindIntent: StoredProjectContentProvisioningIntent | null = null
    const ownerLostRoot = actor.userId === project.contentOwnerUserId
    if (ownerLostRoot && binding.status === 'active') {
      updatedBinding = {
        ...binding,
        status: 'degraded',
        statusReason: outcome === 'unauthorized' ? 'owner_access_lost' : 'provider_unavailable',
        degradedAt: at,
        revision: binding.revision + 1,
        updatedAt: at
      }
      await tx.upsertProjectContentSpaceBinding(updatedBinding, binding.revision)
      await tx.invalidateCloudResourceRefsForBinding(project.projectId, binding.revision, at)
      rebindIntent = await createOwnerRebindIntent(tx, project, updatedBinding, actor.userId, at)
    }

    const notifications: Array<{ recipient: InboxRecipient; sequence: number }> = []
    if (updatedBinding !== binding) {
      const message = await this.appendInbox(tx, { kind: 'agent', id: project.coordinatorAgentId },
        'project.content.binding.changed', { protocolVersion: '1.0', type: 'project.content.binding.changed',
          projectId: project.projectId, projectContentBindingId: updatedBinding.projectContentBindingId,
          status: updatedBinding.status, revision: updatedBinding.revision }, at)
      notifications.push({ recipient: message.recipient, sequence: message.sequence })
    }
    if (rebindIntent !== null) {
      const message = await this.appendInbox(tx, { kind: 'agent', id: project.coordinatorAgentId },
        'project.content.provisioning_intent.changed', { protocolVersion: '1.0',
          type: 'project.content.provisioning_intent.changed', projectId: project.projectId,
          provisioningIntentId: rebindIntent.provisioningIntentId,
          provisioningRevision: rebindIntent.provisioningRevision,
          state: rebindIntent.state, revision: rebindIntent.revision }, at)
      notifications.push({ recipient: message.recipient, sequence: message.sequence })
    }
    const affectedUserIds = ownerLostRoot
      ? (await tx.listProjectMembers(project.projectId)).map(({ userId }) => userId)
      : [actor.userId]
    for (const userId of affectedUserIds) {
      const affectedMembership = await tx.getProjectMemberForUpdate(project.projectId, userId)
      const affectedReadiness = await tx.getProjectContentReadinessForUpdate(project.projectId, userId)
      const authority = await tx.getTaskAuthorityForUpdate(project.projectId, userId, 'file_tasks')
      if (affectedMembership !== null && authority !== null) {
        const derived = deriveTaskAuthorityTransition({
          projectStatus: project.status,
          contentMode: project.contentMode,
          membership: affectedMembership,
          scope: 'file_tasks',
          readiness: affectedReadiness,
          binding: updatedBinding
        })
        await tx.upsertTaskAuthority({
          ...authority,
          ...derived,
          authorityEpoch: authority.authorityEpoch + 1,
          effectiveAt: at,
          revision: authority.revision + 1,
          updatedAt: at
        }, authority.revision)
      }
      for (const execution of await tx.listCurrentTaskExecutionsForProjectUserForUpdate(project.projectId, userId)) {
        if (
          execution.executionId === currentExecution.executionId ||
          execution.fileIntent === null ||
          execution.fence.status === 'fenced'
        ) continue
        const task = required(await tx.getTaskForUpdate(execution.taskId), 'Current file Task')
        if (task.currentExecutionId !== execution.executionId) continue
        const fenced = fenceTaskExecution(execution, 'cancelled', 'execution_cancelled', at)
        await tx.updateTaskExecution(fenced, execution.revision)
        await tx.updateTask({
          ...task,
          status: 'revision_requested',
          currentExecutionState: 'cancelled',
          revision: task.revision + 1,
          updatedAt: at
        }, task.revision)
        await tx.invalidateCloudResourceRefs(task.taskId, execution.executionId, at)
        const message = await this.appendInbox(tx, { kind: 'agent', id: execution.assigneeAgentId },
          'task.execution.fenced', { protocolVersion: '1.0', type: 'task.execution.fenced',
            projectId: project.projectId, taskId: task.taskId, executionId: execution.executionId,
            reason: outcome }, at)
        notifications.push({ recipient: message.recipient, sequence: message.sequence })
      }
    }
    await tx.updateProject({ ...project, revision: project.revision + 1, updatedAt: at }, project.revision)
    const readinessMessage = await this.appendInbox(tx, { kind: 'agent', id: project.coordinatorAgentId },
      'project.content.readiness.changed', { protocolVersion: '1.0',
        type: 'project.content.readiness.changed', projectId: project.projectId,
        userId: actor.userId, state: updatedReadiness.state, revision: updatedReadiness.revision }, at)
    notifications.push({ recipient: readinessMessage.recipient, sequence: readinessMessage.sequence })
    return notifications
  }

  async abandonProjectContentRecovery(
    actor: UserActor,
    input: CloudCommand<'project.content.recovery.abandon'>
  ): Promise<Readonly<{
    project: StoredProject
    provisioningIntent: StoredProjectContentProvisioningIntent
    journal: StoredExternalOperationJournal
    recoveryAction: StoredVisibleRecoveryAction
  }>> {
    return this.commit(actor, 'project.content.recovery.abandon', input.idempotencyKey, input, async (tx, at) => {
      const project = required(await tx.getProjectForUpdate(input.projectId), 'Project')
      requireProjectOwner(project, actor)
      expectRevision(project.revision, input.expectedProjectRevision)
      const intent = required(
        await tx.getProjectContentProvisioningIntentForUpdate(input.provisioningIntentId),
        'Project Content provisioning intent'
      )
      expectRevision(intent.provisioningRevision, input.expectedProvisioningRevision)
      expectRevision(intent.revision, input.expectedProvisioningIntentRevision)
      const action = required(
        await tx.getVisibleRecoveryActionForUpdate(input.recoveryActionId),
        'Visible recovery action'
      )
      expectRevision(action.revision, input.expectedRecoveryActionRevision)
      const journal = required(
        await tx.getExternalOperationJournalByIdForUpdate(input.journalEntryId),
        'Recovery journal entry'
      )
      expectRevision(journal.revision, input.expectedJournalRevision)
      requireExactProjectRecoveryTuple(action, journal, project, intent)
      if (
        intent.state !== 'manual_recovery_required' ||
        action.status !== 'available' ||
        (journal.state !== 'outcome_unknown' && journal.state !== 'observed_failure')
      ) {
        fail(
          'invalid_state_transition',
          'Only one available unresolved or observed-failure Project recovery action may be abandoned.'
        )
      }

      const abandonedJournal: StoredExternalOperationJournal = journal.state === 'outcome_unknown'
        ? {
            ...journal,
            state: 'abandoned',
            safeFailureCode: null,
            resolvedAt: at,
            revision: journal.revision + 1,
            updatedAt: at
          }
        : journal
      if (journal.state === 'outcome_unknown') {
        await tx.updateExternalOperationJournal(abandonedJournal, journal.revision)
      }
      const completedAction: StoredVisibleRecoveryAction = {
        ...action,
        status: 'completed',
        completedAt: at,
        revision: action.revision + 1,
        updatedAt: at
      }
      await tx.updateVisibleRecoveryAction(completedAction, action.revision)
      const cancelledIntent: StoredProjectContentProvisioningIntent = {
        ...intent,
        state: 'cancelled',
        revision: intent.revision + 1,
        updatedAt: at
      }
      await tx.updateProjectContentProvisioningIntent(cancelledIntent, intent.revision)

      const currentBinding = await tx.getProjectContentSpaceBindingForUpdate(project.projectId)
      let bindingMessage: StoredInboxMessage | null = null
      if (
        currentBinding?.status === 'provisioning' &&
        currentBinding.provisioningIntentId === intent.provisioningIntentId &&
        currentBinding.provisioningRevision === intent.provisioningRevision
      ) {
        const closedBinding: StoredProjectContentSpaceBinding = {
          ...currentBinding,
          status: 'closed',
          statusReason: 'owner_requested',
          closedAt: at,
          revision: currentBinding.revision + 1,
          updatedAt: at
        }
        await tx.upsertProjectContentSpaceBinding(closedBinding, currentBinding.revision)
        bindingMessage = await this.appendInbox(
          tx,
          { kind: 'agent', id: project.coordinatorAgentId },
          'project.content.binding.changed',
          {
            protocolVersion: '1.0',
            type: 'project.content.binding.changed',
            projectId: project.projectId,
            projectContentBindingId: closedBinding.projectContentBindingId,
            status: closedBinding.status,
            revision: closedBinding.revision
          },
          at
        )
      }

      const intentMessage = await this.appendInbox(
        tx,
        { kind: 'agent', id: project.coordinatorAgentId },
        'project.content.provisioning_intent.changed',
        {
          protocolVersion: '1.0',
          type: 'project.content.provisioning_intent.changed',
          projectId: project.projectId,
          provisioningIntentId: cancelledIntent.provisioningIntentId,
          provisioningRevision: cancelledIntent.provisioningRevision,
          state: cancelledIntent.state,
          revision: cancelledIntent.revision
        },
        at
      )
      const actionMessage = await this.appendInbox(
        tx,
        { kind: 'agent', id: project.coordinatorAgentId },
        'project.recovery.action.changed',
        {
          protocolVersion: '1.0',
          type: 'project.recovery.action.changed',
          projectId: project.projectId,
          recoveryActionId: completedAction.recoveryActionId,
          revision: completedAction.revision
        },
        at
      )
      return {
        response: {
          project,
          provisioningIntent: cancelledIntent,
          journal: abandonedJournal,
          recoveryAction: completedAction
        },
        resourceKind: 'visible_recovery_action',
        resourceId: completedAction.recoveryActionId,
        notifications: [
          { recipient: intentMessage.recipient, sequence: intentMessage.sequence },
          { recipient: actionMessage.recipient, sequence: actionMessage.sequence },
          ...(bindingMessage === null
            ? []
            : [{ recipient: bindingMessage.recipient, sequence: bindingMessage.sequence }])
        ]
      }
    }).then((response) => ({
      project: response.project as StoredProject,
      provisioningIntent: response.provisioningIntent as StoredProjectContentProvisioningIntent,
      journal: response.journal as StoredExternalOperationJournal,
      recoveryAction: response.recoveryAction as StoredVisibleRecoveryAction
    }))
  }

  async linkObservedRecoveryOutput(
    actor: UserActor,
    input: CloudCommand<'task.recovery.link_observed_output'>
  ): Promise<Readonly<{
    task: StoredTask
    execution: StoredTaskExecution
    journal: StoredExternalOperationJournal
    recoveryAction: StoredVisibleRecoveryAction
    resource: StoredCloudResourceRef
  }>> {
    return this.commit(actor, 'task.recovery.link_observed_output', input.idempotencyKey, input, async (tx, at) => {
      const project = required(await tx.getProjectForUpdate(input.projectId), 'Project')
      await requireCoordinatorHuman(tx, project, actor, input.expectedCoordinatorAuthorityEpoch)
      const task = required(await tx.getTaskForUpdate(input.taskId), 'Task')
      const execution = required(await tx.getTaskExecutionForUpdate(input.executionId), 'Task execution')
      expectRevision(task.revision, input.expectedTaskRevision)
      expectRevision(execution.revision, input.expectedExecutionRevision)
      if (
        task.projectId !== project.projectId || task.currentExecutionId !== execution.executionId ||
        execution.state !== 'manual_recovery_required' || task.status !== 'manual_recovery_required'
      ) {
        fail('revision_conflict', 'Recovery must target the exact current manual-recovery execution.')
      }
      const action = required(await tx.getVisibleRecoveryActionForUpdate(input.recoveryActionId), 'Visible recovery action')
      expectRevision(action.revision, input.expectedRecoveryActionRevision)
      const journal = required(await tx.getExternalOperationJournalByIdForUpdate(input.journalEntryId), 'Recovery journal entry')
      requireExactRecoveryTuple(action, journal, project, task, execution)
      if (
        action.status !== 'available' ||
        action.action !== 'link_observed_output' ||
        !action.requiresFreshObservation ||
        journal.state !== 'outcome_unknown'
      ) {
        fail('invalid_state_transition', 'This recovery action cannot link an observed output.')
      }
      const binding = required(await tx.getProjectContentSpaceBindingForUpdate(project.projectId), 'Project Content binding')
      const observation = input.observation
      if (
        task.fileIntent === null ||
        journal.operation !== 'upload_new' ||
        observation.projectId !== project.projectId ||
        observation.taskId !== task.taskId ||
        observation.executionId !== execution.executionId ||
        observation.assignmentTaskRevision !== execution.fence.assignmentTaskRevision ||
        observation.bindingRevision !== binding.revision ||
        binding.status !== 'active' ||
        binding.rootLocator === null ||
        binding.rootLocatorDigest === null ||
        observation.rootLocatorDigest !== binding.rootLocatorDigest ||
        stableDigest(observation.rootLocator) !== observation.rootLocatorDigest ||
        stableDigest(binding.rootLocator) !== binding.rootLocatorDigest ||
        stableDigest(observation.rootLocator) !== stableDigest(binding.rootLocator) ||
        observation.expectedName !== task.fileIntent.output.fileName ||
        observation.logicalInvocationId !== journal.logicalInvocationId ||
        observation.requestDigest !== journal.requestDigest ||
        observation.locator.authority !== observation.rootLocator.authority ||
        stableDigest(observation.locator) !== observation.locatorDigest
      ) {
        fail(
          'validation_failed',
          'The fresh Content Space observation does not match the exact invocation, output name, execution and active root.'
        )
      }
      requireBoundedObservationTime(observation.observedAt, at)
      const output = {
        executionId: execution.executionId,
        assignmentTaskRevision: observation.assignmentTaskRevision,
        locator: observation.locator,
        locatorDigest: observation.locatorDigest,
        rootLocatorDigest: observation.rootLocatorDigest,
        bindingRevision: observation.bindingRevision,
        transferReceiptDigest: observation.contentObservationReceiptDigest,
        observationDigest: observation.observationDigest,
        preflightObservationDigest: observation.providerObservationDigest
      }
      const observedJournal: StoredExternalOperationJournal = { ...journal, state: 'observed_success',
        receiptDigest: output.transferReceiptDigest, observationDigest: output.observationDigest,
        safeFailureCode: null, resolvedAt: at, revision: journal.revision + 1, updatedAt: at }
      await tx.updateExternalOperationJournal(observedJournal, journal.revision)
      const completedAction: StoredVisibleRecoveryAction = { ...action, status: 'completed', completedAt: at,
        revision: action.revision + 1, updatedAt: at }
      await tx.updateVisibleRecoveryAction(completedAction, action.revision)
      const resources = await tx.listCloudResourceRefs(task.taskId, execution.executionId)
      const resource: StoredCloudResourceRef = {
        resourceRefId: `rrf_${stableDigest({ recoveryActionId: action.recoveryActionId,
          locatorDigest: output.locatorDigest }).slice(0, 32)}`,
        projectId: project.projectId, taskId: task.taskId, executionId: execution.executionId,
        assignmentTaskRevision: execution.fence.assignmentTaskRevision,
        bindingRevision: binding.revision, intentDigest: stableDigest(task.fileIntent),
        role: 'output-file', ordinal: resources.length,
        locator: output.locator, locatorDigest: output.locatorDigest,
        status: 'available', invalidatedAt: null, revision: 1, createdAt: at, updatedAt: at
      }
      await tx.insertCloudResourceRefs([resource])
      const message = await this.appendInbox(tx, { kind: 'agent', id: execution.assigneeAgentId },
        'task.recovery.output_linked', { protocolVersion: '1.0', type: 'task.recovery.output_linked',
          projectId: project.projectId, taskId: task.taskId, executionId: execution.executionId,
          recoveryActionId: completedAction.recoveryActionId,
          journalEntryId: observedJournal.contentRecoveryJournalEntryId,
          logicalInvocationId: observedJournal.logicalInvocationId,
          resourceRefId: resource.resourceRefId,
          taskRevision: task.revision,
          executionRevision: execution.revision,
          journalRevision: observedJournal.revision,
          output }, at)
      return { response: { task, execution, journal: observedJournal,
        recoveryAction: completedAction, resource }, resourceKind: 'visible_recovery_action',
        resourceId: completedAction.recoveryActionId,
        notifications: [{ recipient: message.recipient, sequence: message.sequence }] }
    }).then((response) => ({ task: response.task as StoredTask,
      execution: response.execution as StoredTaskExecution,
      journal: response.journal as StoredExternalOperationJournal,
      recoveryAction: response.recoveryAction as StoredVisibleRecoveryAction,
      resource: response.resource as StoredCloudResourceRef }))
  }

  async abandonTaskRecovery(
    actor: UserActor,
    input: CloudCommand<'task.recovery.abandon'>
  ): Promise<Readonly<{
    task: StoredTask
    execution: StoredTaskExecution
    journal: StoredExternalOperationJournal
    recoveryAction: StoredVisibleRecoveryAction
  }>> {
    return this.commit(actor, 'task.recovery.abandon', input.idempotencyKey, input, async (tx, at) => {
      const project = required(await tx.getProjectForUpdate(input.projectId), 'Project')
      await requireCoordinatorHuman(tx, project, actor, input.expectedCoordinatorAuthorityEpoch)
      const task = required(await tx.getTaskForUpdate(input.taskId), 'Task')
      const execution = required(await tx.getTaskExecutionForUpdate(input.executionId), 'Task execution')
      expectRevision(task.revision, input.expectedTaskRevision)
      expectRevision(execution.revision, input.expectedExecutionRevision)
      const action = required(await tx.getVisibleRecoveryActionForUpdate(input.recoveryActionId), 'Visible recovery action')
      expectRevision(action.revision, input.expectedRecoveryActionRevision)
      const journal = required(await tx.getExternalOperationJournalByIdForUpdate(input.journalEntryId), 'Recovery journal entry')
      requireExactRecoveryTuple(action, journal, project, task, execution)
      if (action.status !== 'available' || (journal.state !== 'outcome_unknown' && journal.state !== 'observed_failure')) {
        fail('invalid_state_transition', 'Only an unresolved or observed-failure recovery action may be abandoned.')
      }
      const abandonedJournal: StoredExternalOperationJournal = journal.state === 'outcome_unknown'
        ? { ...journal, state: 'abandoned', resolvedAt: at, revision: journal.revision + 1, updatedAt: at }
        : journal
      if (journal.state === 'outcome_unknown') {
        await tx.updateExternalOperationJournal(abandonedJournal, journal.revision)
      }
      const completedAction: StoredVisibleRecoveryAction = { ...action, status: 'completed', completedAt: at,
        revision: action.revision + 1, updatedAt: at }
      await tx.updateVisibleRecoveryAction(completedAction, action.revision)
      const abandonedExecution = { ...execution, state: 'cancelled' as const,
        stateRevision: execution.stateRevision + 1,
        fence: { ...execution.fence, status: 'fenced' as const,
          reason: 'manual_recovery_abandoned' as const, fencedAt: at },
        terminalAt: at, revision: execution.revision + 1, updatedAt: at }
      const updatedTask: StoredTask = { ...task, status: 'revision_requested',
        currentExecutionState: 'cancelled', revision: task.revision + 1, updatedAt: at }
      await tx.updateTaskExecution(abandonedExecution, execution.revision)
      await tx.updateTask(updatedTask, task.revision)
      await tx.invalidateCloudResourceRefs(task.taskId, execution.executionId, at)
      const payload = { protocolVersion: '1.0' as const, type: 'task.recovery.abandoned' as const,
        projectId: project.projectId, taskId: task.taskId, executionId: execution.executionId,
        recoveryActionId: completedAction.recoveryActionId,
        taskRevision: updatedTask.revision,
        executionRevision: abandonedExecution.revision,
        reason: input.reason }
      const workerMessage = await this.appendInbox(
        tx,
        { kind: 'agent', id: execution.assigneeAgentId },
        'task.recovery.abandoned',
        payload,
        at
      )
      const coordinatorMessage = execution.assigneeAgentId === project.coordinatorAgentId
        ? workerMessage
        : await this.appendInbox(
            tx,
            { kind: 'agent', id: project.coordinatorAgentId },
            'task.recovery.abandoned',
            payload,
            at
          )
      return { response: { task: updatedTask, execution: abandonedExecution,
        journal: abandonedJournal, recoveryAction: completedAction }, resourceKind: 'visible_recovery_action',
        resourceId: completedAction.recoveryActionId,
        notifications: [
          { recipient: workerMessage.recipient, sequence: workerMessage.sequence },
          ...(coordinatorMessage === workerMessage
            ? []
            : [{ recipient: coordinatorMessage.recipient, sequence: coordinatorMessage.sequence }])
        ] }
    }).then((response) => ({ task: response.task as StoredTask,
      execution: response.execution as StoredTaskExecution,
      journal: response.journal as StoredExternalOperationJournal,
      recoveryAction: response.recoveryAction as StoredVisibleRecoveryAction }))
  }

  async submitProjectFinalSummary(
    actor: AgentActor,
    input: CloudCommand<'project.final_summary.submit'>
  ): Promise<Readonly<{
    project: StoredProject
    record: StoredProjectRecord
    finalSummary: StoredProjectFinalSummary
  }>> {
    validateProjectSummary(input.summary)
    return this.commit(actor, 'project.final_summary.submit', input.idempotencyKey, input, async (tx, at) => {
      const project = required(await tx.getProjectForUpdate(input.projectId), 'Project')
      const coordinator = await requireActiveCoordinatorAgent(
        tx,
        project,
        actor,
        input.expectedProjectRevision,
        input.expectedCoordinatorAuthorityEpoch
      )
      expectRevision(project.executionAuthorityEpoch, input.expectedExecutionAuthorityEpoch)
      if (project.status === 'completed' || project.status === 'cancelled') {
        fail('invalid_state_transition', 'A terminal Project cannot accept another final summary.')
      }
      const plan = required(await tx.getProjectPlan(input.projectPlanId), 'Confirmed Project Plan')
      const currentPlan = required(await tx.getCurrentProjectPlan(project.projectId), 'Current Project Plan')
      if (
        plan.projectId !== project.projectId || currentPlan.projectPlanId !== plan.projectPlanId ||
        plan.state !== 'confirmed' || plan.revision !== input.confirmedPlanRevision
      ) {
        fail('revision_conflict', 'The final summary must cite the exact current confirmed Project Plan revision.')
      }
      const acceptedSubmissionIds = [...new Set(input.acceptedResultSubmissionIds)]
      if (acceptedSubmissionIds.length !== input.acceptedResultSubmissionIds.length) {
        fail('validation_failed', 'Accepted Task result submission identities must be unique.')
      }
      const completedTaskIds = new Set<string>()
      for (const resultSubmissionId of acceptedSubmissionIds) {
        const submission = required(await tx.getTaskResultSubmission(resultSubmissionId), 'Task result submission')
        if (submission.projectId !== project.projectId) {
          fail('permission_denied', 'The final summary cannot cite another Project result.')
        }
        const task = required(await tx.getTaskForUpdate(submission.taskId), 'Accepted result Task')
        const reviews = await tx.listTaskResultReviews(submission.resultSubmissionId)
        if (
          task.status !== 'completed' || task.currentExecutionId !== submission.executionId ||
          !reviews.some((review) => review.decision === 'accept' &&
            review.resultSubmissionId === submission.resultSubmissionId && review.acceptedProjectRecordId !== null)
        ) {
          fail('revision_conflict', 'Every cited Task result must be the current Coordinator-accepted completed result.')
        }
        if (completedTaskIds.has(task.taskId)) {
          fail('validation_failed', 'The final summary may cite only one accepted result for each Task.')
        }
        completedTaskIds.add(task.taskId)
      }
      const projectTaskCount = await tx.countProjectTasks(project.projectId)
      if (projectTaskCount !== completedTaskIds.size) {
        fail('invalid_state_transition', 'Every Project Task requires one accepted result before final summary.')
      }
      if ((await tx.listCurrentTaskExecutionsForProjectForUpdate(project.projectId)).length > 0) {
        fail('invalid_state_transition', 'The Project still has a current non-terminal Task execution.')
      }

      const record: StoredProjectRecord = {
        projectRecordId: newId('rec'), projectId: project.projectId, kind: 'summary', status: 'accepted',
        summary: input.summary, authorUserId: actor.userId, authorAgentId: coordinator.agentId,
        sourceResultSubmissionId: undefined, sourceHumanAnswerId: undefined,
        acceptedByUserId: actor.userId, acceptedByAgentId: coordinator.agentId, acceptedAt: at,
        revision: 1, createdAt: at, updatedAt: at
      }
      const finalSummary: StoredProjectFinalSummary = {
        projectId: project.projectId, projectRecordId: record.projectRecordId,
        projectPlanId: plan.projectPlanId, confirmedPlanRevision: plan.revision,
        acceptedResultSubmissionIds: acceptedSubmissionIds, summary: input.summary,
        createdByUserId: actor.userId, createdByCoordinatorAgentId: coordinator.agentId,
        coordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch,
        completedAt: at, revision: 1, createdAt: at, updatedAt: at
      }
      await tx.insertProjectRecord(record)
      await tx.insertProjectFinalSummary(finalSummary)
      for (const membership of await tx.listProjectMembers(project.projectId)) {
        for (const authority of await tx.listTaskAuthoritiesForUserForUpdate(project.projectId, membership.userId)) {
          await tx.upsertTaskAuthority({ ...authority, state: 'fenced', reason: 'project_terminal',
            authorityEpoch: authority.authorityEpoch + 1, effectiveAt: at,
            revision: authority.revision + 1, updatedAt: at }, authority.revision)
        }
      }
      const completedProject: StoredProject = { ...project, status: 'completed',
        executionAuthorityEpoch: project.executionAuthorityEpoch + 1,
        revision: project.revision + 1, updatedAt: at }
      await tx.updateProject(completedProject, project.revision)
      const notifications: Array<{ recipient: InboxRecipient; sequence: number }> = []
      for (const membership of await tx.listProjectMembers(project.projectId)) {
        if (membership.state !== 'active') continue
        const message = await this.appendInbox(tx, { kind: 'user', id: membership.userId },
          'project.final_summary.created', { protocolVersion: '1.0', type: 'project.final_summary.created',
            projectId: project.projectId, projectRecordId: record.projectRecordId,
            revision: finalSummary.revision }, at)
        notifications.push({ recipient: message.recipient, sequence: message.sequence })
      }
      return { response: { project: completedProject, record, finalSummary },
        resourceKind: 'project_final_summary', resourceId: record.projectRecordId, notifications }
    }).then((response) => ({ project: response.project as StoredProject,
      record: response.record as StoredProjectRecord,
      finalSummary: response.finalSummary as StoredProjectFinalSummary }))
  }

  async submitProjectPlan(
    actor: AgentActor,
    input: CloudCommand<'project.plan.submit'>
  ): Promise<StoredProjectPlan> {
    return this.commit(actor, 'project.plan.submit', input.idempotencyKey, input, async (tx, at) => {
      const project = required(await tx.getProjectForUpdate(input.projectId), 'Project')
      requireCoordinatorCommand(project, actor, input.expectedProjectRevision, input.expectedCoordinatorAuthorityEpoch)
      if (project.status === 'completed' || project.status === 'cancelled') {
        fail('invalid_state_transition', 'A terminal Project cannot accept another plan.')
      }
      if (input.runtimeProvenance.generatedByCoordinatorAgentId !== actor.agentId) {
        fail('permission_denied', 'Plan Runtime provenance must name the current Coordinator Agent.')
      }
      requireBoundedObservationTime(input.runtimeProvenance.generatedAt, at)
      const planFacts = {
        projectId: input.projectId,
        expectedProjectRevision: input.expectedProjectRevision,
        expectedCoordinatorAuthorityEpoch: input.expectedCoordinatorAuthorityEpoch,
        supersedesProjectPlanId: input.supersedesProjectPlanId,
        sourceInputLocators: input.sourceInputLocators,
        tasks: input.tasks,
        rationale: input.rationale,
        runtimeProvenance: input.runtimeProvenance
      }
      if (stableDigest(planFacts) !== input.planDigest) {
        fail('validation_failed', 'The Project plan digest does not match its canonical facts.')
      }
      const current = await tx.getCurrentProjectPlan(project.projectId)
      if ((current?.projectPlanId ?? null) !== input.supersedesProjectPlanId) {
        fail('revision_conflict', 'The superseded Project plan is not current.')
      }
      if (current) {
        if (current.state === 'confirmed' && project.status === 'active') {
          fail('invalid_state_transition', 'Pause the Project before replacing its confirmed plan.')
        }
        await tx.updateProjectPlan({
          ...current,
          state: 'superseded',
          supersededAt: at,
          revision: current.revision + 1,
          updatedAt: at
        }, current.revision)
      }
      const plan: StoredProjectPlan = {
        projectPlanId: newId('pln'),
        projectId: project.projectId,
        coordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch,
        state: 'awaiting_confirmation',
        planRevision: (current?.planRevision ?? 0) + 1,
        sourceInputLocators: input.sourceInputLocators,
        tasks: input.tasks,
        rationale: input.rationale,
        runtimeProvenance: input.runtimeProvenance,
        planDigest: input.planDigest,
        submittedAt: at,
        revision: 1,
        confirmedByUserId: null,
        confirmedAt: null,
        supersededAt: null,
        createdAt: at,
        updatedAt: at
      }
      await tx.insertProjectPlan(plan)
      await tx.updateProject({ ...project, revision: project.revision + 1, updatedAt: at }, project.revision)
      const message = await this.appendInbox(tx, { kind: 'user', id: actor.userId }, 'project.plan.awaiting_confirmation', {
        protocolVersion: '1.0', type: 'project.plan.awaiting_confirmation', projectId: project.projectId,
        projectPlanId: plan.projectPlanId, planDigest: plan.planDigest, revision: plan.revision
      }, at)
      return { response: entityResponse('project.plan.submitted', plan), resourceKind: 'project_plan',
        resourceId: plan.projectPlanId, notifications: [{ recipient: message.recipient, sequence: message.sequence }] }
    }).then(responseEntity<StoredProjectPlan>)
  }

  async confirmProjectPlan(
    actor: UserActor,
    input: CloudCommand<'project.plan.confirm'>
  ): Promise<StoredProjectPlan> {
    return this.commit(actor, 'project.plan.confirm', input.idempotencyKey, input, async (tx, at) => {
      const project = required(await tx.getProjectForUpdate(input.projectId), 'Project')
      expectRevision(project.revision, input.expectedProjectRevision)
      expectRevision(project.coordinatorAuthorityEpoch, input.expectedCoordinatorAuthorityEpoch)
      const coordinator = required(await tx.getAgentForUpdate(project.coordinatorAgentId), 'Coordinator Agent')
      if (coordinator.ownerUserId !== actor.userId || coordinator.status !== 'active') {
        fail('permission_denied', 'Only the Human owner of the current Coordinator Agent may confirm its plan.')
      }
      const plan = required(await tx.getProjectPlan(input.projectPlanId), 'Project plan')
      if (plan.projectId !== project.projectId || plan.coordinatorAuthorityEpoch !== project.coordinatorAuthorityEpoch) {
        fail('revision_conflict', 'The Project plan belongs to stale Coordinator authority.')
      }
      expectRevision(plan.revision, input.expectedPlanRevision)
      if (plan.planDigest !== input.planDigest) fail('revision_conflict', 'The Project plan digest changed.')
      if (plan.state !== 'awaiting_confirmation') {
        fail('invalid_state_transition', 'Only the current awaiting-confirmation plan may be confirmed.')
      }
      const confirmed: StoredProjectPlan = {
        ...plan,
        state: 'confirmed',
        confirmedByUserId: actor.userId,
        confirmedAt: at,
        revision: plan.revision + 1,
        updatedAt: at
      }
      await tx.updateProjectPlan(confirmed, plan.revision)
      await tx.updateProject({ ...project, revision: project.revision + 1, updatedAt: at }, project.revision)
      const message = await this.appendInbox(tx, { kind: 'agent', id: project.coordinatorAgentId }, 'project.plan.confirmed', {
        protocolVersion: '1.0', type: 'project.plan.confirmed', projectId: project.projectId,
        projectPlanId: confirmed.projectPlanId, planDigest: confirmed.planDigest, revision: confirmed.revision
      }, at)
      return { response: entityResponse('project.plan.confirmed', confirmed), resourceKind: 'project_plan',
        resourceId: confirmed.projectPlanId, notifications: [{ recipient: message.recipient, sequence: message.sequence }] }
    }).then(responseEntity<StoredProjectPlan>)
  }

  async createTaskOffer(
    actor: AgentActor,
    input: CloudCommand<'task.offer.create'>
  ): Promise<Readonly<{ task: StoredTask; execution: StoredTaskExecution; offer: StoredTaskOffer }>> {
    return this.commit(actor, 'task.offer.create', input.idempotencyKey, input, async (tx, at) => {
      const project = required(await tx.getProjectForUpdate(input.projectId), 'Project')
      requireCoordinatorCommand(project, actor, input.expectedProjectRevision, input.expectedCoordinatorAuthorityEpoch)
      expectRevision(project.executionAuthorityEpoch, input.expectedExecutionAuthorityEpoch)
      if (project.status !== 'active') fail('invalid_state_transition', 'Task offers require an active Project.')
      if (Date.parse(input.offerExpiresAt) <= Date.parse(at)) {
        fail('validation_failed', 'A Task offer expiry must be in the future.')
      }
      const plan = required(await tx.getProjectPlan(input.projectPlanId), 'Project plan')
      expectRevision(plan.revision, input.expectedPlanRevision)
      if (
        plan.projectId !== project.projectId ||
        plan.state !== 'confirmed' ||
        plan.coordinatorAuthorityEpoch !== project.coordinatorAuthorityEpoch
      ) {
        fail('revision_conflict', 'Task creation requires the exact confirmed plan under current Coordinator authority.')
      }
      const item = plan.tasks.find(({ planItemId }) => planItemId === input.planItemId)
      if (!item) fail('not_found', 'The plan item was not found in this confirmed plan revision.')
      const taskId = taskIdForPlanItem(plan.projectPlanId, item.planItemId)
      if (await tx.getTask(taskId)) fail('identity_conflict', 'This confirmed plan item already has its canonical Task.')
      const dependencyTaskIds = item.dependencyPlanItemIds.map((planItemId) => taskIdForPlanItem(plan.projectPlanId, planItemId))
      for (const dependencyTaskId of dependencyTaskIds) {
        const dependency = required(await tx.getTask(dependencyTaskId), 'Dependency Task')
        if (dependency.projectId !== project.projectId || dependency.status !== 'completed') {
          fail('invalid_state_transition', 'Every Task dependency must be completed in the same Project.')
        }
      }
      const totalTasks = await tx.countProjectTasks(project.projectId)
      const roundTasks = await tx.countProjectTasks(project.projectId, project.coordinationRound)
      if (totalTasks >= project.budget.maxTasks || roundTasks >= project.budget.maxTasksPerRound) {
        fail('budget_exhausted', 'The Project Task budget is exhausted.')
      }
      const eligibility = await requireEligibleAssignee({
        tx,
        project,
        assigneeAgentId: input.assigneeAgentId,
        expectedAvailabilityRevision: input.expectedAvailabilityRevision,
        fileIntent: item.fileIntent,
        requiredCapabilityTags: item.requiredCapabilityTags,
        at
      })
      const assignmentTaskRevision = 1
      const executionId = newId('exe')
      const artifacts = deriveAssignmentArtifacts({
        project,
        taskId,
        executionId,
        assignmentTaskRevision,
        fileIntent: item.fileIntent,
        binding: eligibility.binding,
        at
      })
      const execution: StoredTaskExecution = {
        executionId,
        taskId,
        projectId: project.projectId,
        attempt: 1,
        offeredByCoordinatorAgentId: actor.agentId,
        assigneeUserId: eligibility.agent.ownerUserId,
        assigneeAgentId: eligibility.agent.agentId,
        assigneeDeviceId: eligibility.agent.deviceId,
        state: 'offered',
        stateRevision: 1,
        fence: {
          schemaVersion: 1,
          executionId,
          assigneeUserId: eligibility.agent.ownerUserId,
          assigneeAgentId: eligibility.agent.agentId,
          assigneeDeviceId: eligibility.agent.deviceId,
          assignmentTaskRevision,
          projectExecutionAuthorityEpoch: project.executionAuthorityEpoch,
          userTaskAuthorityEpoch: eligibility.authority.authorityEpoch,
          bindingRevision: eligibility.binding?.revision ?? null,
          status: 'open',
          reason: null,
          fencedAt: null
        },
        fileIntent: artifacts.executionFileIntent,
        currentResultSubmissionId: null,
        offeredAt: at,
        acceptedAt: null,
        startedAt: null,
        terminalAt: null,
        revision: 1,
        createdAt: at,
        updatedAt: at
      }
      const offer: StoredTaskOffer = {
        taskOfferId: newId('ofr'),
        executionId,
        taskId,
        projectId: project.projectId,
        assigneeUserId: execution.assigneeUserId,
        assigneeAgentId: execution.assigneeAgentId,
        assigneeDeviceId: execution.assigneeDeviceId,
        state: 'pending',
        offeredAt: at,
        expiresAt: input.offerExpiresAt,
        respondedAt: null,
        rejectionReason: null,
        safeReasonDetail: null,
        revision: 1,
        createdAt: at,
        updatedAt: at
      }
      const task: StoredTask = {
        taskId,
        projectId: project.projectId,
        createdByCoordinatorAgentId: actor.agentId,
        title: item.title,
        objective: item.objective,
        completionCriteria: item.completionCriteria,
        dependencyTaskIds,
        fileIntent: item.fileIntent,
        currentExecutionId: executionId,
        currentExecutionState: 'offered',
        status: 'offered',
        executionCount: 1,
        maxRetries: project.budget.maxTaskRetries,
        coordinationRound: project.coordinationRound,
        revision: 1,
        createdAt: at,
        updatedAt: at,
        completedAt: null
      }
      await tx.insertTask(task)
      await tx.insertTaskExecution(execution)
      await tx.insertTaskOffer(offer)
      if (artifacts.resources.length > 0) await tx.insertCloudResourceRefs(artifacts.resources)
      await tx.updateProject({ ...project, revision: project.revision + 1, updatedAt: at }, project.revision)
      const message = await this.appendInbox(tx, { kind: 'agent', id: execution.assigneeAgentId }, 'task.offer.created', {
        protocolVersion: '1.0', type: 'task.offer.created', projectId: project.projectId,
        taskId, executionId, taskOfferId: offer.taskOfferId,
        expectedTaskRevision: task.revision, expectedExecutionRevision: execution.revision,
        expectedOfferRevision: offer.revision
      }, at)
      return {
        response: { protocolVersion: '1.0', type: 'task.offer.created', task, execution, offer },
        resourceKind: 'task_offer',
        resourceId: offer.taskOfferId,
        notifications: [{ recipient: message.recipient, sequence: message.sequence }]
      }
    }).then(taskOfferBundleResponse)
  }

  async acceptTaskOffer(
    actor: AgentActor,
    input: CloudCommand<'task.offer.accept'>
  ): Promise<Readonly<{ task: StoredTask; execution: StoredTaskExecution; offer: StoredTaskOffer }>> {
    return this.commit(actor, 'task.offer.accept', input.idempotencyKey, input, async (tx, at) => {
      const { project, task, execution, offer } = await requireTaskOfferBundle(tx, input)
      requireExactAssignee(actor, execution)
      assertOpenCurrentExecution(project, task, execution)
      if (offer.state !== 'pending' || offer.expiresAt <= at || execution.state !== 'offered') {
        fail('invalid_state_transition', 'The Task offer is no longer pending and current.')
      }
      await requireCurrentExecutionAuthority(tx, project, execution, at)
      const updatedOffer: StoredTaskOffer = { ...offer, state: 'accepted', respondedAt: at,
        revision: offer.revision + 1, updatedAt: at }
      const updatedExecution: StoredTaskExecution = { ...execution, state: 'accepted',
        stateRevision: execution.stateRevision + 1, acceptedAt: at,
        revision: execution.revision + 1, updatedAt: at }
      const updatedTask: StoredTask = { ...task, status: 'in_progress', currentExecutionState: 'accepted',
        revision: task.revision + 1, updatedAt: at }
      await tx.updateTaskOffer(updatedOffer, offer.revision)
      await tx.updateTaskExecution(updatedExecution, execution.revision)
      await tx.updateTask(updatedTask, task.revision)
      const message = await this.appendInbox(tx, { kind: 'agent', id: project.coordinatorAgentId }, 'task.offer.accepted', {
        protocolVersion: '1.0', type: 'task.offer.accepted', projectId: project.projectId,
        taskId: task.taskId, executionId: execution.executionId, taskOfferId: offer.taskOfferId
      }, at)
      return { response: { protocolVersion: '1.0', type: 'task.offer.accepted',
        task: updatedTask, execution: updatedExecution, offer: updatedOffer }, resourceKind: 'task_offer',
        resourceId: offer.taskOfferId, notifications: [{ recipient: message.recipient, sequence: message.sequence }] }
    }).then(taskOfferBundleResponse)
  }

  /**
   * The sole Task-offer timeout path. The Cloud compares its own current time
   * with the durable Offer expiresAt fact and records the transition through
   * the same Task/Execution/Offer + Inbox + receipt transaction as commands.
   */
  async expireTaskOffers(limit = 100): Promise<number> {
    const at = this.timestamp()
    const candidates = await this.repository.listExpiredTaskOffers(at, bounded(limit, 1, 500))
    const actor: AuthContext = { kind: 'system', actorKey: 'collaboration:task-offer-expiry' }
    let expiredCount = 0
    for (const candidate of candidates) {
      const idempotencyKey = `timeout-${stableDigest({
        taskOfferId: candidate.taskOfferId,
        expectedOfferRevision: candidate.revision,
        expiresAt: candidate.expiresAt
      })}`
      const response = await this.commit(actor, 'task.offer.timeout', idempotencyKey, {
        taskOfferId: candidate.taskOfferId,
        expectedOfferRevision: candidate.revision,
        expiresAt: candidate.expiresAt
      }, async (tx, committedAt) => {
        const offer = required(await tx.getTaskOfferForUpdate(candidate.taskOfferId), 'Task offer')
        if (offer.revision !== candidate.revision || offer.state !== 'pending' || offer.expiresAt > committedAt) {
          return { response: { transitioned: false } }
        }
        const task = required(await tx.getTaskForUpdate(offer.taskId), 'Task')
        const project = required(await tx.getProjectForUpdate(offer.projectId), 'Project')
        const execution = required(await tx.getTaskExecutionForUpdate(offer.executionId), 'Task execution')
        if (
          task.currentExecutionId !== execution.executionId ||
          execution.taskId !== task.taskId ||
          execution.projectId !== project.projectId ||
          execution.state !== 'offered' ||
          execution.fence.status !== 'open'
        ) {
          return { response: { transitioned: false } }
        }
        const updatedOffer: StoredTaskOffer = {
          ...offer,
          state: 'timed_out',
          respondedAt: committedAt,
          revision: offer.revision + 1,
          updatedAt: committedAt
        }
        const updatedExecution = fenceTaskExecution(execution, 'timed_out', 'offer_timed_out', committedAt)
        const updatedTask: StoredTask = {
          ...task,
          status: 'revision_requested',
          currentExecutionState: 'timed_out',
          revision: task.revision + 1,
          updatedAt: committedAt
        }
        await tx.updateTaskOffer(updatedOffer, offer.revision)
        await tx.updateTaskExecution(updatedExecution, execution.revision)
        await tx.updateTask(updatedTask, task.revision)
        if (execution.fileIntent !== null) {
          await tx.invalidateCloudResourceRefs(task.taskId, execution.executionId, committedAt)
        }
        const notifications: Array<{ recipient: InboxRecipient; sequence: number }> = []
        for (const recipient of [
          { kind: 'agent' as const, id: project.coordinatorAgentId },
          { kind: 'agent' as const, id: execution.assigneeAgentId }
        ]) {
          const message = await this.appendInbox(tx, recipient, 'task.updated', {
            protocolVersion: '1.0',
            type: 'task.updated',
            projectId: project.projectId,
            taskId: task.taskId,
            executionId: execution.executionId,
            revision: updatedTask.revision,
            status: 'revision_requested',
            safeFailureCode: 'offer_timed_out'
          }, committedAt)
          notifications.push({ recipient: message.recipient, sequence: message.sequence })
        }
        return {
          response: { transitioned: true },
          resourceKind: 'task_offer',
          resourceId: offer.taskOfferId,
          notifications
        }
      })
      if (response.transitioned === true) expiredCount += 1
    }
    return expiredCount
  }

  async rejectTaskOffer(
    actor: AgentActor,
    input: CloudCommand<'task.offer.reject'>
  ): Promise<Readonly<{ task: StoredTask; execution: StoredTaskExecution; offer: StoredTaskOffer }>> {
    return this.commit(actor, 'task.offer.reject', input.idempotencyKey, input, async (tx, at) => {
      const { project, task, execution, offer } = await requireTaskOfferBundle(tx, input)
      requireExactAssignee(actor, execution)
      assertOpenCurrentExecution(project, task, execution)
      if (offer.state !== 'pending' || execution.state !== 'offered') {
        fail('invalid_state_transition', 'Only the current pending Task offer may be rejected.')
      }
      const updatedOffer: StoredTaskOffer = { ...offer, state: 'rejected', respondedAt: at,
        rejectionReason: input.reason, safeReasonDetail: input.safeReasonDetail,
        revision: offer.revision + 1, updatedAt: at }
      const updatedExecution = fenceTaskExecution(execution, 'rejected', 'offer_rejected', at)
      const updatedTask: StoredTask = { ...task, status: 'revision_requested', currentExecutionState: 'rejected',
        revision: task.revision + 1, updatedAt: at }
      await tx.updateTaskOffer(updatedOffer, offer.revision)
      await tx.updateTaskExecution(updatedExecution, execution.revision)
      await tx.updateTask(updatedTask, task.revision)
      if (execution.fileIntent !== null) await tx.invalidateCloudResourceRefs(task.taskId, execution.executionId, at)
      const message = await this.appendInbox(tx, { kind: 'agent', id: project.coordinatorAgentId }, 'task.offer.rejected', {
        protocolVersion: '1.0', type: 'task.offer.rejected', projectId: project.projectId,
        taskId: task.taskId, executionId: execution.executionId, taskOfferId: offer.taskOfferId,
        reason: input.reason
      }, at)
      return { response: { protocolVersion: '1.0', type: 'task.offer.rejected',
        task: updatedTask, execution: updatedExecution, offer: updatedOffer }, resourceKind: 'task_offer',
        resourceId: offer.taskOfferId, notifications: [{ recipient: message.recipient, sequence: message.sequence }] }
    }).then(taskOfferBundleResponse)
  }

  async withdrawTaskOffer(
    actor: AgentActor,
    input: CloudCommand<'task.offer.withdraw'>
  ): Promise<Readonly<{ task: StoredTask; execution: StoredTaskExecution; offer: StoredTaskOffer }>> {
    return this.commit(actor, 'task.offer.withdraw', input.idempotencyKey, input, async (tx, at) => {
      const { project, task, execution, offer } = await requireTaskOfferBundle(tx, input)
      requireCoordinatorCommand(project, actor, project.revision, input.expectedCoordinatorAuthorityEpoch)
      assertOpenCurrentExecution(project, task, execution)
      if (offer.state !== 'pending' || execution.state !== 'offered') {
        fail('invalid_state_transition', 'Only the current pending Task offer may be withdrawn.')
      }
      const updatedOffer: StoredTaskOffer = { ...offer, state: 'withdrawn', respondedAt: at,
        revision: offer.revision + 1, updatedAt: at }
      const updatedExecution = fenceTaskExecution(execution, 'cancelled', 'offer_withdrawn', at)
      const updatedTask: StoredTask = { ...task, status: 'revision_requested', currentExecutionState: 'cancelled',
        revision: task.revision + 1, updatedAt: at }
      await tx.updateTaskOffer(updatedOffer, offer.revision)
      await tx.updateTaskExecution(updatedExecution, execution.revision)
      await tx.updateTask(updatedTask, task.revision)
      if (execution.fileIntent !== null) await tx.invalidateCloudResourceRefs(task.taskId, execution.executionId, at)
      const message = await this.appendInbox(tx, { kind: 'agent', id: execution.assigneeAgentId }, 'task.offer.withdrawn', {
        protocolVersion: '1.0', type: 'task.offer.withdrawn', projectId: project.projectId,
        taskId: task.taskId, executionId: execution.executionId, taskOfferId: offer.taskOfferId,
        reason: input.reason
      }, at)
      return { response: { protocolVersion: '1.0', type: 'task.offer.withdrawn',
        task: updatedTask, execution: updatedExecution, offer: updatedOffer }, resourceKind: 'task_offer',
        resourceId: offer.taskOfferId, notifications: [{ recipient: message.recipient, sequence: message.sequence }] }
    }).then(taskOfferBundleResponse)
  }

  async reassignTaskOffer(
    actor: AgentActor,
    input: CloudCommand<'task.offer.reassign'>
  ): Promise<Readonly<{ task: StoredTask; execution: StoredTaskExecution; offer: StoredTaskOffer }>> {
    return this.commit(actor, 'task.offer.reassign', input.idempotencyKey, input, async (tx, at) => {
      const task = required(await tx.getTaskForUpdate(input.taskId), 'Task')
      expectRevision(task.revision, input.expectedTaskRevision)
      const project = required(await tx.getProjectForUpdate(task.projectId), 'Project')
      requireCoordinatorCommand(
        project,
        actor,
        input.expectedProjectRevision,
        input.expectedCoordinatorAuthorityEpoch
      )
      expectRevision(project.executionAuthorityEpoch, input.expectedExecutionAuthorityEpoch)
      const previous = required(await tx.getTaskExecutionForUpdate(input.previousExecutionId), 'Previous Task execution')
      expectRevision(previous.revision, input.expectedExecutionRevision)
      if (task.currentExecutionId !== previous.executionId || previous.taskId !== task.taskId) {
        fail('revision_conflict', 'Reassignment must name the exact current Task execution.')
      }
      if (
        task.status !== 'revision_requested' ||
        previous.fence.status !== 'fenced' ||
        !(['rejected', 'failed', 'cancelled', 'timed_out', 'revoked'] as const).includes(
          previous.state as 'rejected' | 'failed' | 'cancelled' | 'timed_out' | 'revoked'
        )
      ) {
        fail('invalid_state_transition', 'Reassignment requires a retryable terminal Task execution fact.')
      }
      if (task.executionCount >= task.maxRetries + 1) fail('budget_exhausted', 'The Task retry budget is exhausted.')
      if (Date.parse(input.offerExpiresAt) <= Date.parse(at)) fail('validation_failed', 'The next Task offer expiry must be in the future.')
      const nextFileIntent = await requireNewlyNamedSuccessorFileIntent(
        tx,
        task,
        input.nextFileIntent
      )
      const eligibility = await requireEligibleAssignee({ tx, project,
        assigneeAgentId: input.assigneeAgentId,
        expectedAvailabilityRevision: input.expectedAvailabilityRevision,
        fileIntent: nextFileIntent,
        requiredCapabilityTags: [], at })
      const assignmentTaskRevision = task.revision + 1
      const executionId = newId('exe')
      const artifacts = deriveAssignmentArtifacts({ project, taskId: task.taskId, executionId,
        assignmentTaskRevision, fileIntent: nextFileIntent, binding: eligibility.binding, at })
      if (previous.fileIntent !== null) await tx.invalidateCloudResourceRefs(task.taskId, previous.executionId, at)
      const execution: StoredTaskExecution = {
        executionId, taskId: task.taskId, projectId: task.projectId, attempt: previous.attempt + 1,
        offeredByCoordinatorAgentId: actor.agentId,
        assigneeUserId: eligibility.agent.ownerUserId, assigneeAgentId: eligibility.agent.agentId,
        assigneeDeviceId: eligibility.agent.deviceId, state: 'offered', stateRevision: 1,
        fence: { schemaVersion: 1, executionId, assigneeUserId: eligibility.agent.ownerUserId,
          assigneeAgentId: eligibility.agent.agentId, assigneeDeviceId: eligibility.agent.deviceId,
          assignmentTaskRevision, projectExecutionAuthorityEpoch: project.executionAuthorityEpoch,
          userTaskAuthorityEpoch: eligibility.authority.authorityEpoch,
          bindingRevision: eligibility.binding?.revision ?? null, status: 'open', reason: null, fencedAt: null },
        fileIntent: artifacts.executionFileIntent, currentResultSubmissionId: null, offeredAt: at,
        acceptedAt: null, startedAt: null, terminalAt: null, revision: 1, createdAt: at, updatedAt: at
      }
      const offer: StoredTaskOffer = {
        taskOfferId: newId('ofr'), executionId, taskId: task.taskId, projectId: task.projectId,
        assigneeUserId: execution.assigneeUserId, assigneeAgentId: execution.assigneeAgentId,
        assigneeDeviceId: execution.assigneeDeviceId, state: 'pending', offeredAt: at,
        expiresAt: input.offerExpiresAt, respondedAt: null, rejectionReason: null, safeReasonDetail: null,
        revision: 1, createdAt: at, updatedAt: at
      }
      const updatedTask: StoredTask = { ...task, currentExecutionId: executionId, currentExecutionState: 'offered',
        status: 'offered', fileIntent: nextFileIntent,
        executionCount: task.executionCount + 1, revision: assignmentTaskRevision,
        completedAt: null, updatedAt: at }
      await tx.insertTaskExecution(execution)
      await tx.insertTaskOffer(offer)
      if (artifacts.resources.length > 0) await tx.insertCloudResourceRefs(artifacts.resources)
      await tx.updateTask(updatedTask, task.revision)
      const message = await this.appendInbox(tx, { kind: 'agent', id: execution.assigneeAgentId }, 'task.offer.created', {
        protocolVersion: '1.0', type: 'task.offer.created', projectId: project.projectId,
        taskId: task.taskId, executionId, taskOfferId: offer.taskOfferId,
        expectedTaskRevision: updatedTask.revision, expectedExecutionRevision: execution.revision,
        expectedOfferRevision: offer.revision
      }, at)
      return { response: { protocolVersion: '1.0', type: 'task.offer.reassigned',
        task: updatedTask, execution, offer }, resourceKind: 'task_offer', resourceId: offer.taskOfferId,
        notifications: [{ recipient: message.recipient, sequence: message.sequence }] }
    }).then(taskOfferBundleResponse)
  }

  async startTaskExecution(
    actor: AgentActor,
    input: CloudCommand<'task.execution.start'>
  ): Promise<Readonly<{ task: StoredTask; execution: StoredTaskExecution }>> {
    return this.commit(actor, 'task.execution.start', input.idempotencyKey, input, async (tx, at) => {
      requireBoundedObservationTime(input.startedAt, at)
      const task = required(await tx.getTaskForUpdate(input.taskId), 'Task')
      expectRevision(task.revision, input.expectedTaskRevision)
      const execution = required(await tx.getTaskExecutionForUpdate(input.executionId), 'Task execution')
      expectRevision(execution.revision, input.expectedExecutionRevision)
      const project = required(await tx.getProjectForUpdate(task.projectId), 'Project')
      requireExactAssignee(actor, execution)
      assertOpenCurrentExecution(project, task, execution)
      await requireCurrentExecutionAuthority(tx, project, execution, at)
      if (execution.state !== 'accepted' || task.status !== 'in_progress') {
        fail('invalid_state_transition', 'Only the accepted current execution may start.')
      }
      if (execution.acceptedAt !== null && input.startedAt < execution.acceptedAt) {
        fail('validation_failed', 'Execution start cannot precede acceptance.')
      }
      const updatedExecution: StoredTaskExecution = { ...execution, state: 'running',
        stateRevision: execution.stateRevision + 1, startedAt: input.startedAt,
        revision: execution.revision + 1, updatedAt: at }
      const updatedTask: StoredTask = { ...task, currentExecutionState: 'running', status: 'in_progress',
        revision: task.revision + 1, updatedAt: at }
      await tx.updateTaskExecution(updatedExecution, execution.revision)
      await tx.updateTask(updatedTask, task.revision)
      const message = await this.appendInbox(tx, { kind: 'agent', id: project.coordinatorAgentId },
        'task.execution.started', {
          protocolVersion: '1.0', type: 'task.execution.started', projectId: project.projectId,
          taskId: task.taskId, executionId: execution.executionId,
          taskRevision: updatedTask.revision, executionRevision: updatedExecution.revision
        }, at)
      return { response: { protocolVersion: '1.0', type: 'task.execution.started',
        task: updatedTask, execution: updatedExecution }, resourceKind: 'task_execution',
        resourceId: execution.executionId,
        notifications: [{ recipient: message.recipient, sequence: message.sequence }] }
    }).then(taskExecutionBundleResponse)
  }

  async failTaskExecution(
    actor: AgentActor,
    input: CloudCommand<'task.execution.fail'>
  ): Promise<Readonly<{ task: StoredTask; execution: StoredTaskExecution }>> {
    return this.commit(actor, 'task.execution.fail', input.idempotencyKey, input, async (tx, at) => {
      requireBoundedObservationTime(input.failedAt, at)
      const task = required(await tx.getTaskForUpdate(input.taskId), 'Task')
      expectRevision(task.revision, input.expectedTaskRevision)
      const execution = required(await tx.getTaskExecutionForUpdate(input.executionId), 'Task execution')
      expectRevision(execution.revision, input.expectedExecutionRevision)
      const project = required(await tx.getProjectForUpdate(task.projectId), 'Project')
      requireExactAssignee(actor, execution)
      assertOpenCurrentExecution(project, task, execution)
      if (!['accepted', 'running', 'needs_human'].includes(execution.state)) {
        fail('invalid_state_transition', 'Only an accepted or running execution may report failure.')
      }
      const updatedExecution = fenceTaskExecution(execution, 'failed', 'execution_failed', input.failedAt)
      const updatedTask: StoredTask = { ...task, currentExecutionState: 'failed', status: 'failed',
        completedAt: input.failedAt, revision: task.revision + 1, updatedAt: at }
      await tx.updateTaskExecution({ ...updatedExecution, updatedAt: at }, execution.revision)
      await tx.updateTask(updatedTask, task.revision)
      if (execution.fileIntent !== null) await tx.invalidateCloudResourceRefs(task.taskId, execution.executionId, at)
      const message = await this.appendInbox(tx, { kind: 'agent', id: project.coordinatorAgentId }, 'task.execution.failed', {
        protocolVersion: '1.0', type: 'task.execution.failed', projectId: project.projectId,
        taskId: task.taskId, executionId: execution.executionId,
        safeFailureCode: input.safeFailureCode, safeMessage: input.safeMessage
      }, at)
      return { response: { protocolVersion: '1.0', type: 'task.execution.failed',
        task: updatedTask, execution: { ...updatedExecution, updatedAt: at } }, resourceKind: 'task_execution',
        resourceId: execution.executionId, notifications: [{ recipient: message.recipient, sequence: message.sequence }] }
    }).then(taskExecutionBundleResponse)
  }

  async getTaskExecutionPreflight(
    actor: AgentActor,
    input: CloudCommand<'task.execution.preflight.get'>
  ): Promise<TaskExecutionPreflight> {
    const task = required(await this.repository.getTask(input.taskId), 'Task')
    const execution = required(await this.repository.getTaskExecution(input.executionId), 'Task execution')
    requireExactAssignee(actor, execution)
    if (execution.taskId !== task.taskId) fail('validation_failed', 'The execution belongs to another Task.')
    const project = required(await this.repository.getProject(task.projectId), 'Project')
    const [membership, taskAuthorities, device, agent, contentReadiness, contentBinding] = await Promise.all([
      this.repository.getProjectMember(project.projectId, execution.assigneeUserId),
      this.repository.listTaskAuthoritiesForUser(project.projectId, execution.assigneeUserId),
      this.repository.getDevice(execution.assigneeDeviceId),
      this.repository.getAgent(execution.assigneeAgentId),
      this.repository.getProjectContentReadiness(project.projectId, execution.assigneeUserId),
      this.repository.getProjectContentSpaceBinding(project.projectId)
    ])
    const exactMembership = required(membership, 'Execution assignee Project Membership')
    const exactDevice = required(device, 'Execution assignee Device')
    const exactAgent = required(agent, 'Execution assignee Agent')
    if (taskAuthorities.length === 0) fail('not_found', 'Execution assignee Task authority was not found.')
    const reasons: TaskExecutionPreflight['decision']['reasons'] = []
    if (project.status !== 'active') reasons.push('project_not_active')
    if (exactMembership.state !== 'active') reasons.push('membership_not_active')
    const neededScope = task.fileIntent === null ? 'text_tasks' : 'file_tasks'
    if (taskAuthorities.find(({ scope }) => scope === neededScope)?.state !== 'eligible') {
      reasons.push('user_authority_not_eligible')
    }
    if (exactDevice.status !== 'active') reasons.push('device_inactive')
    if (exactAgent.status !== 'active') reasons.push('agent_inactive')
    if (task.currentExecutionId !== execution.executionId) reasons.push('execution_not_current')
    if (execution.fence.status !== 'open' ||
        execution.fence.projectExecutionAuthorityEpoch !== project.executionAuthorityEpoch) {
      reasons.push('execution_fenced')
    }
    if (task.revision !== input.expectedTaskRevision) reasons.push('task_revision_mismatch')
    if (execution.revision !== input.expectedExecutionRevision) reasons.push('execution_revision_mismatch')
    if (task.fileIntent !== null) {
      if (contentReadiness?.providerPrincipalFactId === null || contentReadiness === null) {
        reasons.push('content_identity_missing')
      }
      if (contentReadiness?.state !== 'ready') reasons.push('content_not_ready')
      if (contentBinding?.status !== 'active' || contentBinding.revision !== execution.fence.bindingRevision) {
        reasons.push('content_binding_not_active')
      }
    }
    const uniqueReasons = [...new Set(reasons)]
    const agentFact: TaskExecutionPreflight['agent'] = {
      agentId: exactAgent.agentId,
      ownerUserId: exactAgent.ownerUserId,
      deviceId: exactAgent.deviceId,
      revision: exactAgent.revision,
      lifecycleStatus: exactAgent.status === 'active' ? 'active' : 'revoked',
      connectionStatus: exactAgent.connectionStatus
    }
    return {
      schemaVersion: 1,
      type: 'task_execution_preflight',
      projectId: project.projectId,
      taskId: task.taskId,
      executionId: execution.executionId,
      currentExecutionId: task.currentExecutionId,
      taskKind: task.fileIntent === null ? 'text' : 'file',
      projectStatus: project.status,
      projectRevision: project.revision,
      projectExecutionAuthorityEpoch: project.executionAuthorityEpoch,
      requestedTaskRevision: input.expectedTaskRevision,
      currentTaskRevision: task.revision,
      requestedExecutionRevision: input.expectedExecutionRevision,
      membership: toProjectMembership(exactMembership),
      taskAuthorities: taskAuthorities.map(toTaskAuthority),
      device: { deviceId: exactDevice.deviceId, userId: exactDevice.userId,
        revision: exactDevice.revision, status: exactDevice.status },
      agent: agentFact,
      contentReadiness: contentReadiness === null ? null : toProjectContentReadiness(contentReadiness),
      contentBinding: contentBinding === null ? null : toProjectContentSpaceBinding(contentBinding),
      execution: toTaskExecution(execution),
      decision: { outcome: uniqueReasons.length === 0 ? 'allowed' : 'denied', reasons: uniqueReasons },
      evaluatedAt: this.timestamp()
    }
  }

  async submitTaskResult(
    actor: AgentActor,
    input: CloudCommand<'task.result.submit'>
  ): Promise<Readonly<{ task: StoredTask; execution: StoredTaskExecution; submission: StoredTaskResultSubmission }>> {
    return this.commit(actor, 'task.result.submit', input.idempotencyKey, input, async (tx, at) => {
      const submissionFacts = {
        taskId: input.taskId,
        executionId: input.executionId,
        expectedTaskRevision: input.expectedTaskRevision,
        expectedExecutionRevision: input.expectedExecutionRevision,
        summary: input.summary,
        runtimeProvenance: input.runtimeProvenance,
        outputs: input.outputs,
        recoveryJournalEntryIds: input.recoveryJournalEntryIds
      }
      if (stableDigest(submissionFacts) !== input.submissionDigest) {
        fail('validation_failed', 'The Task result digest does not match its canonical facts.')
      }
      const task = required(await tx.getTaskForUpdate(input.taskId), 'Task')
      expectRevision(task.revision, input.expectedTaskRevision)
      const execution = required(await tx.getTaskExecutionForUpdate(input.executionId), 'Task execution')
      expectRevision(execution.revision, input.expectedExecutionRevision)
      const project = required(await tx.getProjectForUpdate(task.projectId), 'Project')
      requireExactAssignee(actor, execution)
      const humanRecovered = execution.state === 'manual_recovery_required' &&
        task.status === 'manual_recovery_required' &&
        execution.fence.status === 'fenced' &&
        execution.fence.reason === 'manual_recovery_required' &&
        task.currentExecutionId === execution.executionId
      if (humanRecovered) {
        requireNonFutureObservationTime(input.runtimeProvenance.completedAt, at)
      } else {
        requireBoundedObservationTime(input.runtimeProvenance.completedAt, at)
      }
      if (!humanRecovered) assertOpenCurrentExecution(project, task, execution)
      await requireCurrentExecutionAuthority(tx, project, execution, at)
      if (!humanRecovered && (execution.state !== 'running' || task.status !== 'in_progress')) {
        fail('invalid_state_transition', 'Only the running or Human-recovered current execution may submit a result.')
      }
      if (task.fileIntent === null) {
        if (input.outputs.length > 0 || input.recoveryJournalEntryIds.length > 0) {
          fail('validation_failed', 'A text Task result cannot claim ContentSpace outputs or recovery operations.')
        }
      } else {
        const binding = required(await tx.getProjectContentSpaceBindingForUpdate(project.projectId), 'Project Content binding')
        if (binding.status !== 'active' || binding.revision !== execution.fence.bindingRevision || binding.rootLocatorDigest === null) {
          fail('revision_conflict', 'The file Task result does not match the active Project Content binding.')
        }
        for (const output of input.outputs) {
          if (
            output.executionId !== execution.executionId ||
            output.assignmentTaskRevision !== execution.fence.assignmentTaskRevision ||
            output.bindingRevision !== binding.revision ||
            output.rootLocatorDigest !== binding.rootLocatorDigest ||
            stableDigest(output.locator) !== output.locatorDigest
          ) {
            fail('validation_failed', 'A Task result output is not bound to the exact execution and Content root.')
          }
        }
        const journals = await tx.listExternalOperationJournal(project.projectId)
        const recoveryActions = humanRecovered
          ? await tx.listVisibleRecoveryActionsByProject(project.projectId)
          : []
        const resources = humanRecovered
          ? await tx.listCloudResourceRefs(task.taskId, execution.executionId)
          : []
        const requestedJournalIds = new Set(input.recoveryJournalEntryIds)
        if (humanRecovered && (requestedJournalIds.size === 0 || input.outputs.length === 0)) {
          fail('validation_failed', 'Human-recovered file results require exact observed outputs and recovery journal references.')
        }
        for (const journalId of requestedJournalIds) {
          const journal = journals.find(({ contentRecoveryJournalEntryId }) => contentRecoveryJournalEntryId === journalId)
          if (
            !journal ||
            journal.scope !== 'task_content_transfer' ||
            journal.taskId !== task.taskId ||
            journal.executionId !== execution.executionId ||
            journal.preparedExecutionRevision === null ||
            journal.state !== 'observed_success'
          ) {
            fail('revision_conflict', 'Every Task result recovery reference must be an observed-success exact execution operation.')
          }
          if (humanRecovered && !recoveryActions.some((action) =>
            action.journalEntryId === journalId && action.taskId === task.taskId &&
            action.executionId === execution.executionId && action.status === 'completed')) {
            fail('permission_denied', 'A manual-recovery journal requires its completed Human recovery action.')
          }
        }
        if (humanRecovered) {
          for (const output of input.outputs) {
            if (!resources.some((resource) => resource.role === 'output-file' &&
              resource.status === 'available' && resource.locatorDigest === output.locatorDigest &&
              resource.bindingRevision === output.bindingRevision &&
              resource.assignmentTaskRevision === output.assignmentTaskRevision)) {
              fail('permission_denied', 'Every Human-recovered output requires its exact durable observed ResourceRef.')
            }
          }
        }
      }
      const submission: StoredTaskResultSubmission = {
        resultSubmissionId: newId('rsu'),
        projectId: project.projectId,
        taskId: task.taskId,
        executionId: execution.executionId,
        submittedByUserId: actor.userId,
        submittedByAgentId: actor.agentId,
        submittedTaskRevision: task.revision,
        submittedExecutionRevision: execution.revision,
        summary: input.summary,
        runtimeProvenance: input.runtimeProvenance,
        outputs: input.outputs,
        recoveryJournalEntryIds: input.recoveryJournalEntryIds,
        submissionDigest: input.submissionDigest,
        revision: 1,
        submittedAt: humanRecovered ? at : input.runtimeProvenance.completedAt,
        createdAt: at,
        updatedAt: at
      }
      const resultTransitionAt = humanRecovered ? at : input.runtimeProvenance.completedAt
      const updatedExecution: StoredTaskExecution = {
        ...fenceTaskExecution(execution, 'result_submitted', 'result_submitted', resultTransitionAt),
        currentResultSubmissionId: submission.resultSubmissionId,
        updatedAt: at
      }
      const updatedTask: StoredTask = { ...task, status: 'awaiting_review',
        currentExecutionState: 'result_submitted', revision: task.revision + 1, updatedAt: at }
      await tx.insertTaskResultSubmission(submission)
      await tx.updateTaskExecution(updatedExecution, execution.revision)
      await tx.updateTask(updatedTask, task.revision)
      if (execution.fileIntent !== null) await tx.invalidateCloudResourceRefs(task.taskId, execution.executionId, at)
      const message = await this.appendInbox(tx, { kind: 'agent', id: project.coordinatorAgentId }, 'task.result.submitted', {
        protocolVersion: '1.0', type: 'task.result.submitted', projectId: project.projectId,
        taskId: task.taskId, executionId: execution.executionId,
        resultSubmissionId: submission.resultSubmissionId, revision: submission.revision
      }, at)
      return { response: { protocolVersion: '1.0', type: 'task.result.submitted',
        task: updatedTask, execution: updatedExecution, submission }, resourceKind: 'task_result_submission',
        resourceId: submission.resultSubmissionId,
        notifications: [{ recipient: message.recipient, sequence: message.sequence }] }
    }).then((response) => ({
      task: response.task as StoredTask,
      execution: response.execution as StoredTaskExecution,
      submission: response.submission as StoredTaskResultSubmission
    }))
  }

  async reviewTaskResult(
    actor: AgentActor,
    input: CloudCommand<'task.result.review'>
  ): Promise<Readonly<{
    task: StoredTask
    execution: StoredTaskExecution
    review: StoredTaskResultReview
    offer: StoredTaskOffer | null
  }>> {
    return this.commit(actor, 'task.result.review', input.idempotencyKey, input, async (tx, at) => {
      const project = required(await tx.getProjectForUpdate(input.projectId), 'Project')
      const coordinator = await requireActiveCoordinatorAgent(
        tx,
        project,
        actor,
        input.expectedProjectRevision,
        input.expectedCoordinatorAuthorityEpoch
      )
      const task = required(await tx.getTaskForUpdate(input.taskId), 'Task')
      expectRevision(task.revision, input.expectedTaskRevision)
      const execution = required(await tx.getTaskExecutionForUpdate(input.executionId), 'Task execution')
      expectRevision(execution.revision, input.expectedExecutionRevision)
      const submission = required(await tx.getTaskResultSubmission(input.resultSubmissionId), 'Task result submission')
      expectRevision(submission.revision, input.expectedResultRevision)
      if (
        task.projectId !== project.projectId ||
        task.currentExecutionId !== execution.executionId ||
        execution.currentResultSubmissionId !== submission.resultSubmissionId ||
        submission.taskId !== task.taskId ||
        submission.executionId !== execution.executionId ||
        execution.state !== 'result_submitted' ||
        task.status !== 'awaiting_review'
      ) {
        fail('revision_conflict', 'Result review must target the exact current immutable submission.')
      }
      const reviewDecisionId = newId('rvw')
      let updatedTask: StoredTask
      let updatedExecution: StoredTaskExecution
      let nextOffer: StoredTaskOffer | null = null
      let acceptedProjectRecordId: string | null = null
      let nextExecutionId: string | null = null
      if (input.decision === 'accept') {
        const record: StoredProjectRecord = {
          projectRecordId: newId('rec'), projectId: project.projectId, kind: 'observation', status: 'accepted',
          summary: submission.summary, authorUserId: coordinator.ownerUserId,
          authorAgentId: coordinator.agentId, sourceTaskId: task.taskId,
          sourceResultSubmissionId: submission.resultSubmissionId,
          sourceHumanAnswerId: undefined,
          sourceRevision: submission.revision, acceptedByUserId: coordinator.ownerUserId,
          acceptedByAgentId: coordinator.agentId, acceptedAt: at,
          revision: 1, createdAt: at, updatedAt: at
        }
        await tx.insertProjectRecord(record)
        acceptedProjectRecordId = record.projectRecordId
        updatedExecution = {
          ...execution,
          state: 'completed',
          stateRevision: execution.stateRevision + 1,
          fence: { ...execution.fence, status: 'fenced', reason: 'completed', fencedAt: at },
          terminalAt: at,
          revision: execution.revision + 1,
          updatedAt: at
        }
        updatedTask = { ...task, status: 'completed', currentExecutionState: 'completed',
          completedAt: at, revision: task.revision + 1, updatedAt: at }
      } else {
        if (task.executionCount >= task.maxRetries + 1) fail('budget_exhausted', 'The Task retry budget is exhausted.')
        const nextFileIntent = await requireNewlyNamedSuccessorFileIntent(
          tx,
          task,
          input.nextFileIntent
        )
        const eligibility = await requireEligibleAssignee({ tx, project,
          assigneeAgentId: input.nextAssigneeAgentId!,
          expectedAvailabilityRevision: input.expectedNextAssigneeAvailabilityRevision!,
          fileIntent: nextFileIntent, requiredCapabilityTags: [], at })
        if (Date.parse(input.nextOfferExpiresAt!) <= Date.parse(at)) {
          fail('validation_failed', 'The revision offer expiry must be in the future.')
        }
        const assignmentTaskRevision = task.revision + 1
        nextExecutionId = newId('exe')
        const artifacts = deriveAssignmentArtifacts({ project, taskId: task.taskId, executionId: nextExecutionId,
          assignmentTaskRevision, fileIntent: nextFileIntent, binding: eligibility.binding, at })
        updatedExecution = {
          ...execution,
          state: 'superseded',
          stateRevision: execution.stateRevision + 1,
          fence: { ...execution.fence, status: 'fenced', reason: 'reassigned', fencedAt: at },
          terminalAt: at,
          revision: execution.revision + 1,
          updatedAt: at
        }
        const nextExecution: StoredTaskExecution = {
          executionId: nextExecutionId, taskId: task.taskId, projectId: task.projectId,
          attempt: execution.attempt + 1, offeredByCoordinatorAgentId: project.coordinatorAgentId,
          assigneeUserId: eligibility.agent.ownerUserId, assigneeAgentId: eligibility.agent.agentId,
          assigneeDeviceId: eligibility.agent.deviceId, state: 'offered', stateRevision: 1,
          fence: { schemaVersion: 1, executionId: nextExecutionId,
            assigneeUserId: eligibility.agent.ownerUserId, assigneeAgentId: eligibility.agent.agentId,
            assigneeDeviceId: eligibility.agent.deviceId, assignmentTaskRevision,
            projectExecutionAuthorityEpoch: project.executionAuthorityEpoch,
            userTaskAuthorityEpoch: eligibility.authority.authorityEpoch,
            bindingRevision: eligibility.binding?.revision ?? null, status: 'open', reason: null, fencedAt: null },
          fileIntent: artifacts.executionFileIntent, currentResultSubmissionId: null,
          offeredAt: at, acceptedAt: null, startedAt: null, terminalAt: null,
          revision: 1, createdAt: at, updatedAt: at
        }
        nextOffer = { taskOfferId: newId('ofr'), executionId: nextExecutionId, taskId: task.taskId,
          projectId: task.projectId, assigneeUserId: nextExecution.assigneeUserId,
          assigneeAgentId: nextExecution.assigneeAgentId, assigneeDeviceId: nextExecution.assigneeDeviceId,
          state: 'pending', offeredAt: at, expiresAt: input.nextOfferExpiresAt!, respondedAt: null,
          rejectionReason: null, safeReasonDetail: null, revision: 1, createdAt: at, updatedAt: at }
        updatedTask = { ...task, status: 'offered', currentExecutionId: nextExecutionId,
          currentExecutionState: 'offered', executionCount: task.executionCount + 1,
          fileIntent: nextFileIntent, revision: assignmentTaskRevision, updatedAt: at }
        await tx.insertTaskExecution(nextExecution)
        await tx.insertTaskOffer(nextOffer)
        if (artifacts.resources.length > 0) await tx.insertCloudResourceRefs(artifacts.resources)
      }
      const review: StoredTaskResultReview = {
        reviewDecisionId,
        resultSubmissionId: submission.resultSubmissionId,
        projectId: project.projectId,
        taskId: task.taskId,
        executionId: execution.executionId,
        reviewedResultRevision: submission.revision,
        decidedByUserId: actor.userId,
        decidedByCoordinatorAgentId: coordinator.agentId,
        coordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch,
        decision: input.decision,
        instruction: input.instruction,
        acceptedProjectRecordId,
        nextExecutionId,
        decidedAt: at,
        revision: 1,
        createdAt: at,
        updatedAt: at
      }
      await tx.insertTaskResultReview(review)
      await tx.updateTaskExecution(updatedExecution, execution.revision)
      await tx.updateTask(updatedTask, task.revision)
      await tx.updateProject({ ...project, revision: project.revision + 1, updatedAt: at }, project.revision)
      const recipient = nextOffer === null ? submission.submittedByAgentId : nextOffer.assigneeAgentId
      const message = await this.appendInbox(tx, { kind: 'agent', id: recipient }, 'task.result.reviewed', {
        protocolVersion: '1.0', type: 'task.result.reviewed', projectId: project.projectId,
        taskId: task.taskId, executionId: execution.executionId,
        resultSubmissionId: submission.resultSubmissionId, reviewDecisionId,
        decision: input.decision, nextExecutionId
      }, at)
      return { response: { protocolVersion: '1.0', type: 'task.result.reviewed',
        task: updatedTask, execution: updatedExecution, review, offer: nextOffer },
        resourceKind: 'task_review_decision', resourceId: reviewDecisionId,
        notifications: [{ recipient: message.recipient, sequence: message.sequence }] }
    }).then((response) => ({
      task: response.task as StoredTask,
      execution: response.execution as StoredTaskExecution,
      review: response.review as StoredTaskResultReview,
      offer: response.offer as StoredTaskOffer | null
    }))
  }

  async getTask(actor: AuthContext, taskId: string): Promise<StoredTask> {
    if (actor.kind === 'system') fail('permission_denied', 'System context cannot read Project Tasks.')
    const task = required(await this.repository.getTask(taskId), 'Task')
    const member = await this.repository.getProjectMember(task.projectId, actor.userId)
    authorize({ actor, operation: 'project_read', projectMember: member?.state === 'active' })
    return task
  }

  async getCloudResourceRef(actor: AuthContext, resourceRefId: string): Promise<StoredCloudResourceRef> {
    if (actor.kind === 'system') fail('permission_denied', 'System context cannot read Cloud ResourceRefs.')
    const resource = required(await this.repository.getCloudResourceRef(resourceRefId), 'Cloud ResourceRef')
    const member = await this.repository.getProjectMember(resource.projectId, actor.userId)
    authorize({ actor, operation: 'project_read', projectMember: member?.state === 'active' })
    return resource
  }

  async advanceCoordinationRound(actor: AgentActor, input: {
    projectId: string
    expectedRevision: number
    idempotencyKey: string
  }): Promise<StoredProject> {
    return this.commit(actor, 'project.round.advance', input.idempotencyKey, input, async (tx, at) => {
      const project = required(await tx.getProject(input.projectId), 'Project')
      authorize({ actor, operation: 'task_create', coordinatorAgentId: project.coordinatorAgentId })
      expectRevision(project.revision, input.expectedRevision)
      if (project.coordinationRound >= project.budget.maxCoordinationRounds) {
        fail('budget_exhausted', 'The Project coordination-round budget is exhausted.')
      }
      const updated: StoredProject = { ...project, coordinationRound: project.coordinationRound + 1,
        revision: project.revision + 1, updatedAt: at }
      await tx.updateProject(updated, project.revision)
      return { response: entityResponse('project.updated', updated), resourceKind: 'project', resourceId: project.projectId }
    }).then(responseEntity<StoredProject>)
  }

  async submitProjectDecision(
    actor: AgentActor,
    input: CloudCommand<'project.decision.submit'>
  ): Promise<Readonly<{ project: StoredProject; record: StoredProjectRecord }>> {
    validateProjectSummary(input.decision)
    return this.commit(actor, 'project.decision.submit', input.idempotencyKey, input, async (tx, at) => {
      const project = required(await tx.getProjectForUpdate(input.projectId), 'Project')
      const coordinator = await requireActiveCoordinatorAgent(
        tx,
        project,
        actor,
        input.expectedProjectRevision,
        input.expectedCoordinatorAuthorityEpoch
      )
      if (project.status === 'completed' || project.status === 'cancelled') {
        fail('invalid_state_transition', 'A terminal Project cannot accept another decision.')
      }
      const request = required(await tx.getHumanRequest(input.humanRequestId), 'HumanNeeded request')
      expectRevision(request.revision, input.expectedHumanRequestRevision)
      const answer = required(await tx.getHumanAnswerForRequest(request.humanRequestId), 'HumanAnswer')
      expectRevision(answer.revision, input.expectedHumanAnswerRevision)
      if (
        answer.humanAnswerId !== input.humanAnswerId ||
        request.projectId !== project.projectId ||
        answer.projectId !== project.projectId ||
        answer.humanRequestId !== request.humanRequestId ||
        stableDigest(answer.context) !== stableDigest(request.context) ||
        request.status !== 'answered' ||
        request.targetUserId !== project.ownerUserId ||
        answer.answeredByUserId !== project.ownerUserId
      ) {
        fail('revision_conflict', 'The decision must cite the exact current Owner HumanAnswer for this Project.')
      }
      if ((await tx.listProjectRecords(project.projectId, true)).some((record) => (
        record.sourceHumanAnswerId === answer.humanAnswerId
      ))) {
        fail('idempotency_conflict', 'This HumanAnswer already has one official Project decision.')
      }
      const record: StoredProjectRecord = {
        projectRecordId: newId('rec'),
        projectId: project.projectId,
        kind: 'decision',
        status: 'accepted',
        summary: input.decision,
        authorUserId: coordinator.ownerUserId,
        authorAgentId: coordinator.agentId,
        sourceTaskId: answer.context.scope === 'worker_execution' ? answer.context.taskId : undefined,
        sourceResultSubmissionId: undefined,
        sourceHumanAnswerId: answer.humanAnswerId,
        sourceRevision: answer.revision,
        acceptedByUserId: coordinator.ownerUserId,
        acceptedByAgentId: coordinator.agentId,
        acceptedAt: at,
        revision: 1,
        createdAt: at,
        updatedAt: at
      }
      await tx.insertProjectRecord(record)
      const updatedProject: StoredProject = {
        ...project,
        revision: project.revision + 1,
        updatedAt: at
      }
      await tx.updateProject(updatedProject, project.revision)
      const notifications: Array<{ recipient: InboxRecipient; sequence: number }> = []
      for (const membership of await tx.listProjectMembers(project.projectId)) {
        if (membership.state !== 'active') continue
        const message = await this.appendInbox(tx, { kind: 'user', id: membership.userId },
          'project_record.submitted', {
            protocolVersion: '1.0',
            type: 'project_record.submitted',
            projectId: project.projectId,
            projectRecordId: record.projectRecordId,
            revision: record.revision
          }, at)
        notifications.push({ recipient: message.recipient, sequence: message.sequence })
      }
      return {
        response: { project: updatedProject, record },
        resourceKind: 'project_record',
        resourceId: record.projectRecordId,
        notifications
      }
    }).then((response) => ({
      project: response.project as StoredProject,
      record: response.record as StoredProjectRecord
    }))
  }

  async getProject(actor: AuthContext, projectId: string): Promise<{
    project: StoredProject
    members: StoredProjectMember[]
    records: StoredProjectRecord[]
  }> {
    if (actor.kind === 'system') fail('permission_denied', 'System context is not an interactive Project member.')
    const project = required(await this.repository.getProject(projectId), 'Project')
    const member = await this.repository.getProjectMember(projectId, actor.userId)
    authorize({ actor, operation: 'project_read', projectMember: member?.state === 'active' })
    const [members, records] = await Promise.all([
      this.repository.listProjectMembers(projectId),
      this.repository.listProjectRecords(projectId, true)
    ])
    return { project, members, records }
  }

  async pullInbox(actor: AuthContext, input: { afterSequence: number; limit: number }): Promise<{
    messages: StoredInboxMessage[]
    ackedSequence: number
    nextSequence: number
  }> {
    const recipient = actorInboxRecipient(actor)
    const afterSequence = integer(input.afterSequence, 'afterSequence', 0, Number.MAX_SAFE_INTEGER)
    const limit = integer(input.limit, 'limit', 1, 200)
    const [messages, cursor] = await Promise.all([
      this.repository.pullInbox(recipient, afterSequence, limit, this.timestamp()),
      this.repository.getInboxCursor(recipient)
    ])
    return { messages, ackedSequence: cursor?.ackedSequence ?? 0, nextSequence: cursor?.nextSequence ?? 1 }
  }

  async ackInbox(actor: AuthContext, input: { throughSequence: number; idempotencyKey: string }): Promise<{
    ackedSequence: number
    nextSequence: number
  }> {
    const recipient = actorInboxRecipient(actor)
    integer(input.throughSequence, 'throughSequence', 0, Number.MAX_SAFE_INTEGER)
    return this.commit(actor, 'inbox.ack', input.idempotencyKey, input, async (tx, at) => {
      const cursor = await tx.ackInbox(recipient, input.throughSequence, at)
      return { response: { protocolVersion: '1.0', type: 'inbox.acked', ackedSequence: cursor.ackedSequence,
        nextSequence: cursor.nextSequence }, resourceKind: 'inbox', resourceId: recipient.id }
    }).then((response) => ({ ackedSequence: Number(response.ackedSequence), nextSequence: Number(response.nextSequence) }))
  }

  async ackInboxMessage(actor: AuthContext, input: {
    inboxMessageId: string
    sequence: number
    idempotencyKey: string
  }): Promise<{ ackedSequence: number; nextSequence: number }> {
    const recipient = actorInboxRecipient(actor)
    integer(input.sequence, 'sequence', 1, Number.MAX_SAFE_INTEGER)
    const [message] = await this.repository.pullInbox(recipient, input.sequence - 1, 1, this.timestamp())
    if (!message || message.sequence !== input.sequence || message.messageId !== input.inboxMessageId) {
      fail('not_found', 'The inbox message does not match this authenticated recipient and sequence.')
    }
    return this.ackInbox(actor, { throughSequence: input.sequence, idempotencyKey: input.idempotencyKey })
  }

  async reconcileReceipt(actor: AuthContext, idempotencyKey: string): Promise<StoredReceipt | null> {
    assertText(idempotencyKey, 'idempotencyKey', 8, 300)
    return this.repository.getReceipt(actor.actorKey, idempotencyKey)
  }

  async ensureManagedContainer(actor: UserActor, input: {
    humanEndpointId: string
    displayName?: string
    policy: StoredManagedContainer['policy']
    idempotencyKey: string
  }): Promise<StoredManagedContainer> {
    const expectedName = `sciforge-${stableDigest(actor.userId).slice(0, 12)}`
    if (input.displayName !== undefined && input.displayName !== expectedName) {
      fail('validation_failed', 'Managed Channel name must use the server-derived stable user handle.')
    }
    const response = await this.commit(actor, 'managed_container.ensure', input.idempotencyKey, input, async (tx, at) => {
      const endpoint = required(await tx.getEndpoint(input.humanEndpointId), 'Human endpoint')
      if (endpoint.userId !== actor.userId || endpoint.status !== 'active') {
        fail('permission_denied', 'Managed Channel requires an active endpoint owned by the authenticated user.')
      }
      const existing = await tx.getManagedContainerForOwner(actor.userId, endpoint.provider, endpoint.realmId)
      if (existing) {
        if (existing.status === 'failed' && !existing.externalContainerId) {
          const retried: StoredManagedContainer = {
            ...existing,
            status: 'requested',
            safeErrorCode: undefined,
            revision: existing.revision + 1,
            updatedAt: at
          }
          await tx.updateManagedContainer(retried, existing.revision)
          await tx.insertManagedContainerJob({
            jobId: newId('mcj'), managedContainerId: retried.managedContainerId, operation: 'ensure',
            desiredRevision: retried.revision, state: 'queued', attemptCount: 0, nextAttemptAt: at,
            createdAt: at, updatedAt: at
          })
          return {
            response: entityResponse('managed_container.ensure_retried', retried),
            resourceKind: 'managed_provider_container',
            resourceId: retried.managedContainerId
          }
        }
        return {
          response: entityResponse('managed_container.ensured', existing),
          resourceKind: 'managed_provider_container',
          resourceId: existing.managedContainerId
        }
      }
      const managedContainerId = newId('mco')
      const container: StoredManagedContainer = {
        managedContainerId,
        ownerUserId: actor.userId,
        humanEndpointId: endpoint.humanEndpointId,
        provider: endpoint.provider,
        realmId: endpoint.realmId,
        ownerProviderUserId: endpoint.providerUserId,
        stableKey: `managed-${stableDigest({ ownerUserId: actor.userId, provider: endpoint.provider, realmId: endpoint.realmId })}`,
        displayName: expectedName,
        policy: input.policy,
        status: 'requested',
        revision: 1,
        createdAt: at,
        updatedAt: at
      }
      const job: StoredManagedContainerJob = {
        jobId: newId('mcj'),
        managedContainerId,
        operation: 'ensure',
        desiredRevision: 1,
        state: 'queued',
        attemptCount: 0,
        nextAttemptAt: at,
        createdAt: at,
        updatedAt: at
      }
      await tx.insertManagedContainer(container)
      await tx.insertManagedContainerJob(job)
      return {
        response: entityResponse('managed_container.ensured', container),
        resourceKind: 'managed_provider_container',
        resourceId: managedContainerId
      }
    })
    const committed = responseEntity<StoredManagedContainer>(response)
    return required(await this.repository.getManagedContainer(committed.managedContainerId), 'Managed container')
  }

  async getManagedContainer(actor: AuthContext, managedContainerId: string): Promise<StoredManagedContainer> {
    const container = required(await this.repository.getManagedContainer(managedContainerId), 'Managed container')
    if (actor.kind === 'system' || actor.userId !== container.ownerUserId) {
      fail('permission_denied', 'Managed Channel belongs to another user.')
    }
    return container
  }

  async listManagedContainers(actor: UserActor): Promise<StoredManagedContainer[]> {
    return this.repository.listManagedContainersForOwner(actor.userId)
  }

  async inspectManagedContainer(actor: UserActor, input: {
    managedContainerId: string
    expectedRevision: number
    idempotencyKey: string
  }): Promise<StoredManagedContainer> {
    const response = await this.commit(actor, 'managed_container.inspect', input.idempotencyKey, input, async (tx, at) => {
      const current = required(await tx.getManagedContainer(input.managedContainerId), 'Managed container')
      await requireManagedContainerOwner(tx, actor.userId, current)
      if (current.revision !== input.expectedRevision) fail('revision_conflict', 'Managed Channel revision changed.')
      if (!current.externalContainerId) fail('validation_failed', 'Managed Channel has not completed initial provisioning.')
      if (!['active', 'drifted', 'failed'].includes(current.status)) {
        fail('invalid_state_transition', 'Managed Channel cannot be inspected during this lifecycle state.')
      }
      await tx.insertManagedContainerJob({
        jobId: newId('mcj'), managedContainerId: current.managedContainerId, operation: 'inspect',
        desiredRevision: current.revision, state: 'queued', attemptCount: 0, nextAttemptAt: at,
        createdAt: at, updatedAt: at
      })
      return {
        response: entityResponse('managed_container.inspect_requested', current),
        resourceKind: 'managed_provider_container',
        resourceId: current.managedContainerId
      }
    })
    return responseEntity<StoredManagedContainer>(response)
  }

  async reconcileManagedContainer(actor: UserActor, input: {
    managedContainerId: string
    expectedRevision: number
    idempotencyKey: string
  }): Promise<StoredManagedContainer> {
    const response = await this.commit(actor, 'managed_container.reconcile', input.idempotencyKey, input, async (tx, at) => {
      const current = required(await tx.getManagedContainer(input.managedContainerId), 'Managed container')
      await requireManagedContainerOwner(tx, actor.userId, current)
      if (current.revision !== input.expectedRevision) fail('revision_conflict', 'Managed Channel revision changed.')
      if (!current.externalContainerId) fail('validation_failed', 'Managed Channel has not completed initial provisioning.')
      if (!['drifted', 'failed'].includes(current.status)) {
        fail('invalid_state_transition', 'Only a drifted or failed managed Channel can be reconciled.')
      }
      const updated: StoredManagedContainer = {
        ...current,
        status: 'provisioning',
        safeErrorCode: undefined,
        revision: current.revision + 1,
        updatedAt: at
      }
      await tx.updateManagedContainer(updated, current.revision)
      await tx.insertManagedContainerJob({
        jobId: newId('mcj'), managedContainerId: updated.managedContainerId, operation: 'reconcile',
        desiredRevision: updated.revision, state: 'queued', attemptCount: 0, nextAttemptAt: at,
        createdAt: at, updatedAt: at
      })
      return { response: entityResponse('managed_container.reconciled', updated),
        resourceKind: 'managed_provider_container', resourceId: updated.managedContainerId }
    })
    return responseEntity<StoredManagedContainer>(response)
  }

  async archiveManagedContainer(actor: UserActor, input: {
    managedContainerId: string
    expectedRevision: number
    idempotencyKey: string
  }): Promise<StoredManagedContainer> {
    const response = await this.commit(actor, 'managed_container.archive', input.idempotencyKey, input, async (tx, at) => {
      const current = required(await tx.getManagedContainer(input.managedContainerId), 'Managed container')
      await requireManagedContainerOwner(tx, actor.userId, current)
      if (current.revision !== input.expectedRevision) fail('revision_conflict', 'Managed Channel revision changed.')
      if (!current.externalContainerId) fail('validation_failed', 'Managed Channel has not completed initial provisioning.')
      if (!['active', 'drifted'].includes(current.status)) {
        fail('invalid_state_transition', 'Managed Channel cannot be archived during this lifecycle state.')
      }
      const projections = await tx.listProjectionsForOwner(actor.userId)
      const notifications: Array<{ recipient: InboxRecipient; sequence: number }> = []
      for (const projection of projections) {
        if (
          projection.status === 'active' &&
          projection.locator.provider === current.provider &&
          projection.locator.realmId === current.realmId &&
          projection.locator.containerId === current.externalContainerId
        ) {
          const changed = {
            ...projection,
            status: 'paused',
            lastErrorCode: 'managed_container_archived',
            revision: projection.revision + 1,
            updatedAt: at
          } satisfies StoredProjection
          await tx.updateProjection(changed, projection.revision)
          const message = await this.appendInbox(tx, { kind: 'agent', id: projection.agentId }, 'projection.updated', {
            protocolVersion: '1.0', type: 'projection.updated', projectionId: projection.projectionId,
            revision: changed.revision
          }, at)
          notifications.push({ recipient: message.recipient, sequence: message.sequence })
        }
      }
      const updated: StoredManagedContainer = {
        ...current,
        status: 'suspended',
        safeErrorCode: undefined,
        revision: current.revision + 1,
        updatedAt: at
      }
      await tx.updateManagedContainer(updated, current.revision)
      await tx.insertManagedContainerJob({
        jobId: newId('mcj'), managedContainerId: updated.managedContainerId, operation: 'archive',
        desiredRevision: updated.revision, state: 'queued', attemptCount: 0, nextAttemptAt: at,
        createdAt: at, updatedAt: at
      })
      return { response: entityResponse('managed_container.archive_requested', updated),
        resourceKind: 'managed_provider_container', resourceId: updated.managedContainerId, notifications }
    })
    return responseEntity<StoredManagedContainer>(response)
  }

  async getReceipt(actor: AuthContext, receiptId: string): Promise<StoredReceipt | null> {
    assertText(receiptId, 'receiptId', 8, 100)
    const receipt = await this.repository.getReceiptById(receiptId)
    if (!receipt) return null
    if (receipt.actorKey !== actor.actorKey) fail('permission_denied', 'The receipt belongs to another authenticated actor.')
    return receipt
  }

  pruneExpired(): Promise<{ inboxMessages: number; receipts: number; challenges: number }> {
    return this.repository.pruneExpired(this.timestamp())
  }

  async recordRejectedBoundary(actor: AuthContext, operation: string, error: CollaborationServiceError): Promise<void> {
    if (error.auditRecorded) return
    await this.repository.transaction((tx) => tx.insertAudit({
      auditEventId: newId('audit'), actorKind: actor.kind, ...actorAuditIdentity(actor), action: operation,
      outcome: 'rejected', metadata: safeAuditMetadata({ errorCode: error.code }), createdAt: this.timestamp()
    }))
    error.auditRecorded = true
  }

  private async pauseEndpointProjections(
    repository: CollaborationTransaction,
    endpoint: StoredEndpoint,
    at: string,
    errorCode: string
  ): Promise<Array<{ recipient: InboxRecipient; sequence: number }>> {
    const notifications: Array<{ recipient: InboxRecipient; sequence: number }> = []
    for (const projection of await repository.listProjectionsForOwner(endpoint.userId)) {
      if (projection.humanEndpointId !== endpoint.humanEndpointId || projection.status !== 'active') continue
      const changed = { ...projection, status: 'paused' as const, lastErrorCode: errorCode,
        revision: projection.revision + 1, updatedAt: at }
      await repository.updateProjection(changed, projection.revision)
      const message = await this.appendInbox(
        repository,
        { kind: 'agent', id: projection.agentId },
        'projection.updated',
        { protocolVersion: '1.0', type: 'projection.updated', projectionId: projection.projectionId,
          revision: changed.revision },
        at
      )
      notifications.push({ recipient: message.recipient, sequence: message.sequence })
    }
    return notifications
  }

  private async appendInbox(
    tx: CollaborationTransaction,
    recipient: InboxRecipient,
    messageType: string,
    payload: Record<string, unknown>,
    at: string
  ): Promise<StoredInboxMessage> {
    return tx.appendInbox({ recipient, messageId: newId('ibx'), messageType, payload,
      createdAt: at, expiresAt: new Date(new Date(at).getTime() + this.inboxRetentionMs).toISOString() })
  }

  private async commit(
    actor: AuthContext,
    operation: string,
    idempotencyKey: string,
    request: unknown,
    work: (tx: CollaborationTransaction, at: string) => Promise<CommandResult<Record<string, unknown>>>
  ): Promise<Record<string, unknown>> {
    assertText(idempotencyKey, 'idempotencyKey', 8, 300)
    const requestDigest = stableDigest(request)
    const at = this.timestamp()
    let notifications: Array<{ recipient: InboxRecipient; sequence: number }> = []
    let response: Record<string, unknown>
    try {
      response = await this.repository.transaction(async (tx) => {
      await tx.lockIdempotency(actor.actorKey, idempotencyKey)
      const existing = await tx.getReceipt(actor.actorKey, idempotencyKey)
      if (existing) {
        if (existing.requestDigest !== requestDigest || existing.operation !== operation) {
          fail('idempotency_conflict', 'The idempotency key was already used for a different request.')
        }
        return existing.response
      }
      const result = await work(tx, at)
      notifications = result.notifications ?? []
      const audit: StoredAuditEvent = {
        auditEventId: newId('audit'), actorKind: actor.kind,
        ...actorAuditIdentity(actor), action: operation, resourceKind: result.resourceKind, resourceId: result.resourceId,
        outcome: 'accepted', metadata: safeAuditMetadata({ idempotencyKeyDigest: stableDigest(idempotencyKey) }), createdAt: at
      }
      await tx.insertAudit(audit)
      if (result.persistReceipt !== false) {
        const receiptResponse = result.receiptResponse ?? result.response
        const receipt: StoredReceipt = {
          receiptId: operationReceiptId(actor.actorKey, idempotencyKey), actorKey: actor.actorKey,
          idempotencyKey, requestDigest, operation, resourceKind: result.resourceKind,
          resourceId: result.resourceId, response: receiptResponse, createdAt: at,
          expiresAt: new Date(new Date(at).getTime() + this.receiptRetentionMs).toISOString()
        }
        await tx.insertReceipt(receipt)
      }
      return result.response
      })
    } catch (error) {
      const serviceError = error instanceof CollaborationServiceError ? error : undefined
      const auditRecorded = await this.repository.transaction((tx) => tx.insertAudit({
        auditEventId: newId('audit'), actorKind: actor.kind, ...actorAuditIdentity(actor), action: operation,
        outcome: 'rejected', metadata: safeAuditMetadata({ idempotencyKeyDigest: stableDigest(idempotencyKey),
          errorCode: serviceError?.code ?? 'internal_error' }), createdAt: this.timestamp()
      })).then(() => true).catch(() => false)
      if (serviceError && auditRecorded) serviceError.auditRecorded = true
      throw error
    }
    await Promise.allSettled(notifications.map((notification) => Promise.resolve().then(() => (
      this.notifier?.notifyInboxAvailable(notification.recipient, notification.sequence)
    ))))
    return response
  }

  private timestamp(): string { return this.now().toISOString() }
}

async function requireOwnedManagedLocator(
  repository: CollaborationReadRepository,
  ownerUserId: string,
  endpoint: StoredEndpoint,
  locator: ProviderLocatorValue
): Promise<void> {
  const container = await repository.getManagedContainerForOwner(
    ownerUserId,
    endpoint.provider,
    endpoint.realmId
  )
  if (
    !container ||
    container.humanEndpointId !== endpoint.humanEndpointId ||
    container.status !== 'active' ||
    !container.externalContainerId ||
    locator.containerId !== container.externalContainerId
  ) {
    fail('permission_denied', 'Projection locator must belong to the authenticated user\'s active managed Channel.')
  }
}

type ProjectListCursor = Readonly<{
  version: 1
  kind: 'project-list'
  userId: string
  afterProjectId: string
  observedAt: string
}>

type ProjectCoordinationCursor = Readonly<{
  version: 1
  kind: 'project-coordination'
  userId: string
  projectId: string
  collection: CoordinationPageRequest['collection']
  after: string
  observedAt: string
}>

function encodeScopedCursor(cursor: ProjectListCursor | ProjectCoordinationCursor): string {
  return `sc1.${Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')}`
}

function decodeProjectListCursor(input: string, actorUserId: string): ProjectListCursor {
  const cursor = decodeScopedCursor(input, [
    'afterProjectId', 'kind', 'observedAt', 'userId', 'version'
  ])
  if (
    cursor.version !== 1 ||
    cursor.kind !== 'project-list' ||
    cursor.userId !== actorUserId ||
    typeof cursor.afterProjectId !== 'string' ||
    !/^prj_[A-Za-z0-9][A-Za-z0-9_]{10,62}[A-Za-z0-9]$/u.test(cursor.afterProjectId) ||
    !isCanonicalCursorTimestamp(cursor.observedAt)
  ) {
    fail('validation_failed', 'The Project page cursor does not belong to this authenticated read scope.')
  }
  return cursor as ProjectListCursor
}

function decodeProjectCoordinationCursor(
  input: string,
  actorUserId: string,
  projectId: string,
  collection: CoordinationPageRequest['collection']
): ProjectCoordinationCursor {
  const cursor = decodeScopedCursor(input, [
    'after', 'collection', 'kind', 'observedAt', 'projectId', 'userId', 'version'
  ])
  if (
    cursor.version !== 1 ||
    cursor.kind !== 'project-coordination' ||
    cursor.userId !== actorUserId ||
    cursor.projectId !== projectId ||
    cursor.collection !== collection ||
    typeof cursor.after !== 'string' ||
    cursor.after.length === 0 ||
    cursor.after.length > 512 ||
    !isCanonicalCursorTimestamp(cursor.observedAt)
  ) {
    fail('validation_failed', 'The collection cursor does not belong to this authenticated Project read scope.')
  }
  return cursor as ProjectCoordinationCursor
}

function decodeScopedCursor(input: string, expectedKeys: readonly string[]): Record<string, unknown> {
  if (!input.startsWith('sc1.')) fail('validation_failed', 'The page cursor has an unsupported format.')
  const encoded = input.slice(4)
  let bytes: Buffer
  let parsed: unknown
  try {
    bytes = Buffer.from(encoded, 'base64url')
    if (bytes.toString('base64url') !== encoded) throw new Error('Non-canonical base64url cursor.')
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch {
    fail('validation_failed', 'The page cursor is malformed.')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('validation_failed', 'The page cursor is malformed.')
  }
  const cursor = parsed as Record<string, unknown>
  const keys = Object.keys(cursor).sort()
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    fail('validation_failed', 'The page cursor contains unsupported fields.')
  }
  return cursor
}

function isCanonicalCursorTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString() === value
}

async function buildProjectCoordinationPage(
  repository: CollaborationReadRepository,
  project: StoredProject,
  request: CoordinationPageRequest,
  actorUserId: string,
  observedAt: string,
  after: string | null
): Promise<ProjectCoordinationFactPage> {
  const memberships = async (): Promise<StoredProjectMember[]> => repository.listProjectMembers(project.projectId)
  const page = <Item>(
    rows: Item[],
    key: (item: Item) => string,
    repositoryAlreadyPaged = false
  ): ProjectCoordinationFactPage => coordinationPage(
    request,
    rows,
    key,
    { actorUserId, projectId: project.projectId, observedAt, after },
    repositoryAlreadyPaged
  )
  switch (request.collection) {
    case 'user_label_facts': {
      const rows = await Promise.all((await memberships()).map(async ({ userId }) => {
        const user = required(await repository.getUser(userId), 'Project User label')
        return { schemaVersion: 1 as const, type: 'project_user_label_fact' as const,
          projectId: project.projectId, userId: user.userId, displayName: user.displayName,
          status: user.status, revision: user.revision, observedAt }
      }))
      return page(rows, ({ userId }) => userId)
    }
    case 'agent_label_facts': {
      const rows = (await Promise.all((await memberships()).map(({ userId }) =>
        repository.listAgentsForUser(userId)))).flat().map((agent) => ({
          schemaVersion: 1 as const, type: 'project_agent_label_fact' as const,
          projectId: project.projectId, agentId: agent.agentId, ownerUserId: agent.ownerUserId,
          deviceId: agent.deviceId, displayName: agent.displayName, nodeType: agent.nodeType,
          lifecycleStatus: agent.status, revision: agent.revision, observedAt
        }))
      return page(rows, ({ agentId }) => agentId)
    }
    case 'memberships':
      return page((await memberships()).map(toProjectMembership),
        ({ userId }) => userId)
    case 'task_authorities':
      return page((await repository.listTaskAuthorities(project.projectId)).map(toTaskAuthority),
        ({ userId, scope }) => `${userId}\u0000${scope}`)
    case 'worker_availability': {
      const rows = (await Promise.all((await memberships()).map(({ userId }) =>
        repository.listWorkerAvailabilityForUser(userId, observedAt)))).flat().map(toWorkerAvailability)
      return page(rows, ({ agentId }) => agentId)
    }
    case 'provider_principal_facts': {
      const readiness = await repository.listProjectContentReadiness(project.projectId)
      if (readiness.length === 0) return page([], () => '')
      const providerInstance = readiness[0]!.providerInstance
      const userIds = [...new Set(readiness.map(({ userId }) => userId))]
      const rows = await repository.listProviderDirectoryPrincipalFacts({ userIds,
        providerInstance, includeDegraded: true, afterFactId: null, limit: Math.max(1, userIds.length) })
      return page(rows.map(toProviderDirectoryPrincipalFact),
        ({ userId }) => userId)
    }
    case 'content_readiness':
      return page(
        (await repository.listProjectContentReadiness(project.projectId)).map(toProjectContentReadiness),
        ({ userId }) => userId)
    case 'provider_membership_observations':
      return page(
        (await repository.listProjectProviderMembershipObservations(project.projectId))
          .map(toProjectProviderMembershipObservation),
        ({ providerObservationId }) => providerObservationId)
    case 'plans':
      return page((await repository.listProjectPlans(project.projectId)).map(toProjectPlan),
        ({ projectPlanId }) => projectPlanId)
    case 'tasks': {
      const rows = await repository.listTasksByProject(project.projectId, after, request.limit + 1)
      return page(rows.map(toTask), ({ taskId }) => taskId, true)
    }
    case 'executions': {
      const rows = await repository.listTaskExecutionsByProject(project.projectId, after, request.limit + 1)
      return page(rows.map(toTaskExecution), ({ executionId }) => executionId, true)
    }
    case 'offers': {
      const rows = await repository.listTaskOffersByProject(project.projectId, after, request.limit + 1)
      return page(rows.map(toTaskOffer), ({ taskOfferId }) => taskOfferId, true)
    }
    case 'result_submissions': {
      const rows = await repository.listTaskResultSubmissionsByProject(project.projectId, after, request.limit + 1)
      return page(rows.map(toTaskResultSubmission),
        ({ resultSubmissionId }) => resultSubmissionId, true)
    }
    case 'review_decisions': {
      const rows = await repository.listTaskResultReviewsByProject(project.projectId, after, request.limit + 1)
      return page(rows.map(toTaskReviewDecision), ({ reviewDecisionId }) => reviewDecisionId, true)
    }
    case 'pending_human_needed': {
      const rows = await repository.listHumanRequestsByProject(
        project.projectId, 'pending', after, request.limit + 1
      )
      return page(rows.map(toHumanNeeded), ({ humanRequestId }) => humanRequestId, true)
    }
    case 'provisioning_intents':
      return page(
        (await repository.listProjectContentProvisioningIntents(project.projectId))
          .map(toProjectContentProvisioningIntent),
        ({ provisioningIntentId }) => provisioningIntentId)
    case 'provisioning_attestations':
      return page(
        (await repository.listProjectContentProvisioningAttestations(project.projectId))
          .map(toProjectContentProvisioningAttestation),
        ({ provisioningAttestationId }) => provisioningAttestationId)
    case 'content_bindings': {
      const binding = await repository.getProjectContentSpaceBinding(project.projectId)
      return page(binding === null ? [] : [toProjectContentSpaceBinding(binding)],
        ({ projectContentBindingId }) => projectContentBindingId)
    }
    case 'external_operation_journal':
      return page(
        (await repository.listExternalOperationJournal(project.projectId))
          .map(toExternalOperationRecoveryJournalEntry),
        ({ contentRecoveryJournalEntryId }) => contentRecoveryJournalEntryId)
    case 'visible_recovery_actions':
      return page(
        (await repository.listVisibleRecoveryActionsByProject(project.projectId)).map(toVisibleRecoveryAction),
        ({ recoveryActionId }) => recoveryActionId)
    case 'project_records':
      return page(
        (await repository.listProjectRecords(project.projectId, false)).map(toProjectRecord),
        ({ projectRecordId }) => projectRecordId)
  }
}

function coordinationPage<Item>(
  request: CoordinationPageRequest,
  inputRows: Item[],
  key: (item: Item) => string,
  context: Readonly<{
    actorUserId: string
    projectId: string
    observedAt: string
    after: string | null
  }>,
  repositoryAlreadyPaged = false
): ProjectCoordinationFactPage {
  const sorted = [...inputRows].sort((left, right) => {
    const leftKey = key(left)
    const rightKey = key(right)
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
  })
  const rows = repositoryAlreadyPaged || context.after === null
    ? sorted
    : sorted.filter((item) => key(item) > context.after!)
  const items = rows.slice(0, request.limit)
  return {
    collection: request.collection,
    ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
    limit: request.limit,
    items,
    ...(rows.length > request.limit && items.length > 0
      ? { nextCursor: encodeScopedCursor({ version: 1, kind: 'project-coordination',
        userId: context.actorUserId, projectId: context.projectId, collection: request.collection,
        after: key(items.at(-1)!), observedAt: context.observedAt }) }
      : {})
  } as ProjectCoordinationFactPage
}

async function requireManagedContainerOwner(
  repository: CollaborationReadRepository,
  ownerUserId: string,
  container: StoredManagedContainer
): Promise<StoredEndpoint> {
  if (container.ownerUserId !== ownerUserId) {
    fail('permission_denied', 'Managed Channel belongs to another user.')
  }
  const endpoint = required(await repository.getEndpoint(container.humanEndpointId), 'Managed Channel endpoint')
  if (
    endpoint.userId !== ownerUserId ||
    endpoint.status !== 'active' ||
    endpoint.provider !== container.provider ||
    endpoint.realmId !== container.realmId ||
    endpoint.providerUserId !== container.ownerProviderUserId
  ) {
    fail('permission_denied', 'Managed Channel requires its active verified owner endpoint.')
  }
  return endpoint
}

function actorAuditIdentity(actor: AuthContext): Pick<StoredAuditEvent, 'actorUserId' | 'actorEndpointId' | 'actorAgentId'> {
  switch (actor.kind) {
    case 'system': return {}
    case 'user': return { actorUserId: actor.userId }
    case 'human_endpoint': return { actorUserId: actor.userId, actorEndpointId: actor.humanEndpointId }
    case 'agent_device': return { actorUserId: actor.userId, actorAgentId: actor.agentId }
  }
}

function entityResponse<T>(type: string, entity: T): Record<string, unknown> {
  return { protocolVersion: '1.0', type, entity }
}

function operationReceiptId(actorKey: string, idempotencyKey: string): string {
  return `rcp_${stableDigest({ actorKey, idempotencyKey }).slice(0, 24)}`
}

export function providerIdentityInboxId(recipient: ProviderDirectRecipient): string {
  return `pdi_${stableDigest({
    provider: recipient.provider,
    realmId: recipient.realmId,
    providerUserId: recipient.providerUserId
  })}`
}

function assertProviderIdentityInboxId(value: string): void {
  if (!/^pdi_[a-f0-9]{64}$/u.test(value)) {
    fail('validation_failed', 'A valid provider identity inbox ID is required.')
  }
}

function providerCommandResultText(
  result: 'success' | 'invalid_or_expired' | 'identity_conflict'
): string {
  switch (result) {
    case 'success': return '绑定成功，可以返回 SciForge 继续使用。'
    case 'invalid_or_expired': return '绑定码无效或已失效，请重新生成。'
    case 'identity_conflict': return '该聊天身份无法完成绑定，请在 SciForge 中检查当前绑定状态。'
  }
}

function responseEntity<T>(response: Record<string, unknown>): T {
  return response.entity as T
}

function required<T>(value: T | null, label: string): T {
  if (value === null) fail('not_found', `${label} was not found.`)
  return value
}

function expectRevision(current: number, expected: number): void {
  if (current !== expected) fail('revision_conflict', 'The resource revision is stale.', { details: { currentRevision: current } })
}

function requireBoundedObservationTime(observedAt: string, committedAt: string): void {
  const observed = Date.parse(observedAt)
  const committed = Date.parse(committedAt)
  if (!Number.isFinite(observed) || observed > committed + 5 * 60_000 || observed < committed - 24 * 60 * 60_000) {
    fail('validation_failed', 'The factual observation time is outside the accepted bounded window.')
  }
}

function requireNonFutureObservationTime(observedAt: string, committedAt: string): void {
  const observed = Date.parse(observedAt)
  const committed = Date.parse(committedAt)
  if (!Number.isFinite(observed) || observed > committed + 5 * 60_000) {
    fail('validation_failed', 'The recovered factual observation time is invalid or in the future.')
  }
}

function requireProjectOwner(project: StoredProject, actor: UserActor): void {
  if (project.ownerUserId !== actor.userId) {
    fail('permission_denied', 'Only the current Project Owner OIDC User may perform this command.')
  }
}

async function requireProjectReader(
  repository: CollaborationReadRepository,
  actor: AuthContext,
  projectId: string
): Promise<StoredProject> {
  if (actor.kind === 'system') fail('permission_denied', 'System context cannot read a Project.')
  const project = required(await repository.getProject(projectId), 'Project')
  const membership = await repository.getProjectMember(projectId, actor.userId)
  if (!canUserReadProjectCoordination(project, actor.userId, membership)) {
    fail('permission_denied', 'Only the Project Owner or a currently readable member may read this Project state.')
  }
  return project
}

async function createMembershipChangeIntent(
  tx: CollaborationTransaction,
  project: StoredProject,
  ownerUserId: string,
  at: string,
  requireCurrentFacts: boolean
): Promise<StoredProjectContentProvisioningIntent> {
  if (project.contentMode !== 'required' || project.contentOwnerUserId === null) {
    fail('invalid_state_transition', 'A membership-change intent requires Project Content.')
  }
  const previous = required(
    await tx.getLatestProjectContentProvisioningIntent(project.projectId),
    'Project Content provisioning intent'
  )
  const binding = await tx.getProjectContentSpaceBindingForUpdate(project.projectId)
  const desiredMembers: StoredProjectContentProvisioningIntent['desiredMembers'] = []
  for (const membership of (await tx.listProjectMembers(project.projectId))
    .filter(({ state }) => state === 'active' || state === 'pending_membership')
    .sort((left, right) => left.userId.localeCompare(right.userId))) {
    if (!requireCurrentFacts) {
      const previousSnapshot = required(
        previous.desiredMembers.find(({ userId }) => userId === membership.userId) ?? null,
        'Previous desired Provider member snapshot'
      )
      desiredMembers.push(previousSnapshot)
      continue
    }
    const readiness = required(
      await tx.getProjectContentReadinessForUpdate(project.projectId, membership.userId),
      'Project Content readiness'
    )
    if (
      readiness.providerPrincipalFactId === null ||
      readiness.snapshottedFactRevision === null ||
      readiness.providerPrincipal === null ||
      !sameProviderInstanceReference(readiness.providerInstance, previous.providerInstance)
    ) {
      fail('revision_conflict', 'Every desired member requires an exact Project Provider principal snapshot.')
    }
    const currentFact = required(
      await tx.getProviderDirectoryPrincipalFactForUpdate(readiness.providerPrincipalFactId),
      'Current Provider principal fact'
    )
    if (
      currentFact.userId !== membership.userId || currentFact.revision !== readiness.snapshottedFactRevision ||
      currentFact.readiness !== 'ready' ||
      stableDigest(currentFact.providerPrincipal) !== stableDigest(readiness.providerPrincipal)
    ) {
      fail('revision_conflict', 'A desired member Provider principal fact no longer matches its Project snapshot.')
    }
    desiredMembers.push({ userId: membership.userId,
      providerPrincipalFactId: readiness.providerPrincipalFactId,
      snapshottedFactRevision: readiness.snapshottedFactRevision,
      principal: readiness.providerPrincipal })
  }
  if (!desiredMembers.some(({ userId }) => userId === project.contentOwnerUserId)) {
    fail('invalid_state_transition', 'The Project Content owner must remain in the desired Provider roster.')
  }
  if (!['completed', 'superseded', 'cancelled'].includes(previous.state)) {
    await tx.updateProjectContentProvisioningIntent({ ...previous, state: 'superseded',
      revision: previous.revision + 1, updatedAt: at }, previous.revision)
  }
  const provisioningIntentId = newId('pci')
  const facts = {
    provisioningIntentId,
    projectId: project.projectId,
    provisioningRevision: previous.provisioningRevision + 1,
    kind: 'membership_change' as const,
    createdByOwnerUserId: ownerUserId,
    contentOwnerUserId: project.contentOwnerUserId,
    providerInstance: previous.providerInstance,
    desiredMembers,
    containerDisplayName: previous.containerDisplayName,
    currentRootLocator: binding?.rootLocator ?? previous.currentRootLocator,
    currentBindingRevision: binding?.revision ?? previous.currentBindingRevision
  }
  const intent: StoredProjectContentProvisioningIntent = { ...facts, state: 'pending',
    intentDigest: stableDigest(facts), revision: 1, createdAt: at, updatedAt: at }
  await tx.insertProjectContentProvisioningIntent(intent)
  if (binding?.status === 'provisioning') {
    await tx.upsertProjectContentSpaceBinding({
      ...binding,
      provisioningIntentId: intent.provisioningIntentId,
      provisioningRevision: intent.provisioningRevision,
      revision: binding.revision + 1,
      updatedAt: at
    }, binding.revision)
  }
  return intent
}

async function createOwnerRebindIntent(
  tx: CollaborationTransaction,
  project: StoredProject,
  binding: StoredProjectContentSpaceBinding,
  ownerUserId: string,
  at: string
): Promise<StoredProjectContentProvisioningIntent | null> {
  const previous = required(
    await tx.getLatestProjectContentProvisioningIntent(project.projectId),
    'Project Content provisioning intent'
  )
  if (!['completed', 'superseded', 'cancelled'].includes(previous.state)) return null
  const rootLocator = required(binding.rootLocator, 'Degraded Project Content root')
  const desiredMembers: StoredProjectContentProvisioningIntent['desiredMembers'] = []
  for (const membership of (await tx.listProjectMembers(project.projectId))
    .filter(({ state }) => state === 'active' || state === 'pending_membership')
    .sort((left, right) => left.userId.localeCompare(right.userId))) {
    const readiness = required(
      await tx.getProjectContentReadinessForUpdate(project.projectId, membership.userId),
      'Project Content readiness'
    )
    if (
      readiness.providerPrincipalFactId === null ||
      readiness.snapshottedFactRevision === null ||
      readiness.providerPrincipal === null ||
      !sameProviderInstanceReference(readiness.providerInstance, binding.providerInstance)
    ) {
      fail('revision_conflict', 'A rebind intent requires every desired member exact Provider identity snapshot.')
    }
    desiredMembers.push({
      userId: membership.userId,
      providerPrincipalFactId: readiness.providerPrincipalFactId,
      snapshottedFactRevision: readiness.snapshottedFactRevision,
      principal: readiness.providerPrincipal
    })
  }
  if (!desiredMembers.some(({ userId }) => userId === project.contentOwnerUserId)) {
    fail('invalid_state_transition', 'The Project Content Owner must remain in a rebind intent.')
  }
  const provisioningIntentId = newId('pci')
  const facts = {
    provisioningIntentId,
    projectId: project.projectId,
    provisioningRevision: previous.provisioningRevision + 1,
    kind: 'rebind' as const,
    createdByOwnerUserId: ownerUserId,
    contentOwnerUserId: binding.contentOwnerUserId,
    providerInstance: binding.providerInstance,
    desiredMembers,
    containerDisplayName: previous.containerDisplayName,
    currentRootLocator: rootLocator,
    currentBindingRevision: binding.revision
  }
  const intent: StoredProjectContentProvisioningIntent = {
    ...facts,
    state: 'pending',
    intentDigest: stableDigest(facts),
    revision: 1,
    createdAt: at,
    updatedAt: at
  }
  await tx.insertProjectContentProvisioningIntent(intent)
  return intent
}

function externalPrepareRequestFacts(
  input: CloudCommand<'external_operation.prepare'>
): Record<string, unknown> {
  return {
    scope: input.scope, logicalInvocationId: input.logicalInvocationId, projectId: input.projectId,
    taskId: input.taskId, preparedTaskRevision: input.preparedTaskRevision,
    provisioningIntentId: input.provisioningIntentId, provisioningRevision: input.provisioningRevision,
    executionId: input.executionId, preparedExecutionRevision: input.preparedExecutionRevision,
    operation: input.operation, requestDigest: input.requestDigest
  }
}

function externalJournalRequestFacts(journal: StoredExternalOperationJournal): Record<string, unknown> {
  return {
    scope: journal.scope, logicalInvocationId: journal.logicalInvocationId, projectId: journal.projectId,
    taskId: journal.taskId, preparedTaskRevision: journal.preparedTaskRevision,
    provisioningIntentId: journal.provisioningIntentId, provisioningRevision: journal.provisioningRevision,
    executionId: journal.executionId, preparedExecutionRevision: journal.preparedExecutionRevision,
    operation: journal.operation, requestDigest: journal.requestDigest
  }
}

function assertExternalOperationForScope(
  scope: StoredExternalOperationJournal['scope'],
  operation: StoredExternalOperationJournal['operation']
): void {
  const allowed: Readonly<Record<StoredExternalOperationJournal['scope'], ReadonlySet<StoredExternalOperationJournal['operation']>>> = {
    project_provisioning: new Set(['create_shared_container', 'list_members', 'add_member', 'observe_root']),
    project_membership: new Set(['list_members', 'add_member', 'remove_member']),
    task_content_transfer: new Set(['download', 'upload_new', 'observe_output'])
  }
  if (!allowed[scope].has(operation)) {
    fail('validation_failed', `The ${operation} external operation is not valid for ${scope}.`)
  }
}

function externalOperationAttestationKind(
  operation: StoredExternalOperationJournal['operation']
): string {
  return operation === 'download' ? 'download_check' : operation
}

function taskTransferProviderObservationOutcome(
  safeFailureCode: string | null
): StoredProjectProviderMembershipObservation['outcome'] | null {
  if (safeFailureCode === 'unauthorized' || safeFailureCode === 'provider_unauthorized') {
    return 'unauthorized'
  }
  if (
    safeFailureCode === 'provider_unavailable' ||
    safeFailureCode === 'source_unavailable' ||
    safeFailureCode === 'destination_unavailable'
  ) {
    return 'unavailable'
  }
  return null
}

async function authorizeExternalJournalActor(
  tx: CollaborationTransaction,
  actor: UserActor | AgentActor,
  journal: StoredExternalOperationJournal,
  at: string
): Promise<Readonly<{
  project: StoredProject
  task: StoredTask | null
  execution: StoredTaskExecution | null
  intent: StoredProjectContentProvisioningIntent | null
}>> {
  const project = required(await tx.getProjectForUpdate(journal.projectId), 'Project')
  if (journal.scope !== 'task_content_transfer') {
    if (actor.kind !== 'user') fail('permission_denied', 'Project Content administration requires the Project Owner OIDC User.')
    requireProjectOwner(project, actor)
    const intent = required(
      await tx.getProjectContentProvisioningIntentForUpdate(journal.provisioningIntentId!),
      'Project Content provisioning intent'
    )
    if (intent.projectId !== project.projectId || intent.provisioningRevision !== journal.provisioningRevision) {
      fail('revision_conflict', 'The recovery journal provisioning snapshot is stale.')
    }
    return { project, task: null, execution: null, intent }
  }
  if (actor.kind !== 'agent_device') fail('permission_denied', 'Task Content operations require the exact Worker Agent.')
  const task = required(await tx.getTaskForUpdate(journal.taskId!), 'Task')
  const execution = required(await tx.getTaskExecutionForUpdate(journal.executionId!), 'Task execution')
  if (
    task.projectId !== project.projectId || task.currentExecutionId !== execution.executionId ||
    task.revision !== journal.preparedTaskRevision || execution.revision !== journal.preparedExecutionRevision
  ) {
    fail('revision_conflict', 'The recovery journal no longer targets the exact current Task execution revisions.')
  }
  requireExactAssignee(actor, execution)
  assertOpenCurrentExecution(project, task, execution)
  await requireCurrentExecutionAuthority(tx, project, execution, at)
  return { project, task, execution, intent: null }
}

function buildVisibleRecoveryAction(
  journal: StoredExternalOperationJournal,
  at: string
): StoredVisibleRecoveryAction {
  const taskScoped = journal.scope === 'task_content_transfer'
  const action = taskScoped
    ? journal.state === 'outcome_unknown' && (journal.operation === 'upload_new' || journal.operation === 'observe_output')
      ? 'link_observed_output' as const
      : 'abandon_execution' as const
    : journal.scope === 'project_membership'
      ? 'reconcile_provider_membership' as const
      : 'resume_provisioning' as const
  return {
    recoveryActionId: newId('rca'), projectId: journal.projectId,
    taskId: journal.taskId, executionId: journal.executionId,
    journalEntryId: journal.contentRecoveryJournalEntryId,
    audience: taskScoped ? 'coordinator' : 'owner', action, status: 'available',
    requiresFreshObservation: journal.state === 'outcome_unknown',
    safeSummary: taskScoped
      ? 'The exact Task Content operation needs Human recovery before this execution can continue.'
      : 'The Project Content operation needs Owner recovery before provisioning can continue.',
    availableAt: at, completedAt: null, revision: 1, createdAt: at, updatedAt: at
  }
}

async function requireCoordinatorHuman(
  tx: CollaborationTransaction,
  project: StoredProject,
  actor: UserActor,
  expectedCoordinatorAuthorityEpoch: number
): Promise<StoredAgent> {
  expectRevision(project.coordinatorAuthorityEpoch, expectedCoordinatorAuthorityEpoch)
  const coordinator = required(await tx.getAgentForUpdate(project.coordinatorAgentId), 'Coordinator Agent')
  if (coordinator.status !== 'active' || coordinator.ownerUserId !== actor.userId) {
    fail('permission_denied', 'Only the Human owner of the current Coordinator Agent may perform Task recovery.')
  }
  return coordinator
}

function requireExactRecoveryTuple(
  action: StoredVisibleRecoveryAction,
  journal: StoredExternalOperationJournal,
  project: StoredProject,
  task: StoredTask,
  execution: StoredTaskExecution
): void {
  if (
    task.projectId !== project.projectId || task.currentExecutionId !== execution.executionId ||
    execution.taskId !== task.taskId ||
    action.projectId !== project.projectId || action.taskId !== task.taskId ||
    action.executionId !== execution.executionId || action.journalEntryId !== journal.contentRecoveryJournalEntryId ||
    journal.projectId !== project.projectId || journal.taskId !== task.taskId ||
    journal.executionId !== execution.executionId || journal.scope !== 'task_content_transfer'
  ) {
    fail('revision_conflict', 'The recovery action, journal, Task and execution do not form one exact recovery tuple.')
  }
}

function requireExactProjectRecoveryTuple(
  action: StoredVisibleRecoveryAction,
  journal: StoredExternalOperationJournal,
  project: StoredProject,
  intent: StoredProjectContentProvisioningIntent
): void {
  const projectScoped = journal.scope === 'project_provisioning' || journal.scope === 'project_membership'
  const expectedAction = journal.scope === 'project_membership'
    ? 'reconcile_provider_membership'
    : 'resume_provisioning'
  if (
    !projectScoped ||
    intent.projectId !== project.projectId ||
    action.projectId !== project.projectId ||
    action.taskId !== null ||
    action.executionId !== null ||
    action.audience !== 'owner' ||
    action.action !== expectedAction ||
    action.journalEntryId !== journal.contentRecoveryJournalEntryId ||
    action.requiresFreshObservation !== (journal.state === 'outcome_unknown') ||
    journal.projectId !== project.projectId ||
    journal.taskId !== null ||
    journal.executionId !== null ||
    journal.provisioningIntentId !== intent.provisioningIntentId ||
    journal.provisioningRevision !== intent.provisioningRevision
  ) {
    fail(
      'revision_conflict',
      'The recovery action, journal, Project and provisioning intent do not form one exact recovery tuple.'
    )
  }
}

function sameProviderInstanceReference(
  left: Readonly<{ providerInstanceRef: string }>,
  right: Readonly<{ providerInstanceRef: string }>
): boolean {
  return left.providerInstanceRef === right.providerInstanceRef
}

function deriveTaskAuthorityTransition(input: Readonly<{
  projectStatus: StoredProject['status']
  contentMode: StoredProject['contentMode']
  membership: StoredProjectMember
  scope: StoredTaskAuthority['scope']
  readiness: StoredProjectContentReadiness | null
  binding: StoredProjectContentSpaceBinding | null
}>): Pick<StoredTaskAuthority, 'state' | 'reason'> {
  if (input.projectStatus === 'completed' || input.projectStatus === 'cancelled') {
    return { state: 'fenced', reason: 'project_terminal' }
  }
  if (input.projectStatus !== 'active') return { state: 'suspended', reason: 'project_paused' }
  if (input.membership.state === 'pending_membership') return { state: 'suspended', reason: 'membership_pending' }
  if (input.membership.state === 'membership_removal_pending') {
    return { state: 'fenced', reason: 'membership_removal_pending' }
  }
  if (input.membership.state === 'removed') return { state: 'fenced', reason: 'membership_removed' }
  if (input.scope === 'text_tasks') return { state: 'eligible', reason: null }
  if (input.contentMode === 'none') return { state: 'suspended', reason: 'content_not_ready' }
  if (input.readiness?.providerPrincipalFactId === null || input.readiness === null) {
    return { state: 'suspended', reason: 'content_identity_missing' }
  }
  if (input.binding?.status === 'degraded') return { state: 'suspended', reason: 'content_binding_degraded' }
  if (
    input.readiness.state !== 'ready' ||
    input.binding?.status !== 'active' ||
    input.readiness.bindingRevision !== input.binding.revision
  ) {
    return { state: 'suspended', reason: 'content_not_ready' }
  }
  return { state: 'eligible', reason: null }
}

function requireCoordinatorCommand(
  project: StoredProject,
  actor: AgentActor,
  expectedProjectRevision: number,
  expectedCoordinatorAuthorityEpoch: number
): void {
  if (actor.agentId !== project.coordinatorAgentId) {
    fail('permission_denied', 'Only the current Coordinator Agent may perform this command.')
  }
  expectRevision(project.revision, expectedProjectRevision)
  expectRevision(project.coordinatorAuthorityEpoch, expectedCoordinatorAuthorityEpoch)
}

async function requireActiveCoordinatorAgent(
  tx: CollaborationTransaction,
  project: StoredProject,
  actor: AgentActor,
  expectedProjectRevision: number,
  expectedCoordinatorAuthorityEpoch: number
): Promise<StoredAgent> {
  requireCoordinatorCommand(
    project,
    actor,
    expectedProjectRevision,
    expectedCoordinatorAuthorityEpoch
  )
  const coordinator = required(await tx.getAgentForUpdate(actor.agentId), 'Coordinator Agent')
  if (
    coordinator.status !== 'active' ||
    coordinator.ownerUserId !== actor.userId ||
    coordinator.deviceId !== actor.deviceId
  ) {
    fail('permission_denied', 'The current Coordinator Agent authority is no longer active on this Device.')
  }
  return coordinator
}

function taskIdForPlanItem(projectPlanId: string, planItemId: string): string {
  return `tsk_${stableDigest({ projectPlanId, planItemId }).slice(0, 32)}`
}

async function requireEligibleAssignee(input: Readonly<{
  tx: CollaborationTransaction
  project: StoredProject
  assigneeAgentId: string
  expectedAvailabilityRevision: number
  fileIntent: TaskFileIntent | null
  requiredCapabilityTags: readonly string[]
  at: string
}>): Promise<Readonly<{
  agent: StoredAgent
  availability: StoredWorkerAvailability
  authority: StoredTaskAuthority
  binding: StoredProjectContentSpaceBinding | null
}>> {
  if (input.project.status !== 'active') fail('invalid_state_transition', 'The Project is not active.')
  const availability = required(
    await input.tx.getWorkerAvailabilityForUpdate(input.assigneeAgentId),
    'Worker availability'
  )
  expectRevision(availability.revision, input.expectedAvailabilityRevision)
  const agent = required(await input.tx.getAgentForUpdate(input.assigneeAgentId), 'Assignee Agent')
  const device = required(await input.tx.getDeviceForUpdate(agent.deviceId), 'Assignee Device')
  const membership = required(
    await input.tx.getProjectMemberForUpdate(input.project.projectId, agent.ownerUserId),
    'Assignee Project Membership'
  )
  const scope = input.fileIntent === null ? 'text_tasks' as const : 'file_tasks' as const
  const authority = required(
    await input.tx.getTaskAuthorityForUpdate(input.project.projectId, agent.ownerUserId, scope),
    'Assignee Task authority'
  )
  if (
    agent.status !== 'active' ||
    device.status !== 'active' ||
    device.userId !== agent.ownerUserId ||
    availability.userId !== agent.ownerUserId ||
    availability.deviceId !== agent.deviceId ||
    !availability.agentActive ||
    !availability.deviceActive ||
    availability.connectionStatus !== 'online' ||
    availability.runtimeReadiness !== 'ready' ||
    !availability.acceptsNewOffers ||
    availability.expiresAt <= input.at ||
    membership.state !== 'active' ||
    authority.state !== 'eligible'
  ) {
    fail('permission_denied', 'The exact Worker Agent, Device, Membership and Task authority are not eligible.')
  }
  if (input.requiredCapabilityTags.some((tag) => !availability.runtimeCapabilityTags.includes(tag))) {
    fail('permission_denied', 'The selected Worker Runtime lacks a required plan capability.')
  }
  if (input.fileIntent === null) return { agent, availability, authority, binding: null }
  if (input.project.contentMode !== 'required') {
    fail('permission_denied', 'A content-free Project cannot create a file Task.')
  }
  const binding = required(
    await input.tx.getProjectContentSpaceBindingForUpdate(input.project.projectId),
    'Project Content binding'
  )
  const readiness = required(
    await input.tx.getProjectContentReadinessForUpdate(input.project.projectId, agent.ownerUserId),
    'Worker Content readiness'
  )
  if (
    binding.status !== 'active' ||
    binding.rootLocator === null ||
    binding.rootLocatorDigest === null ||
    binding.revision !== input.fileIntent.bindingRevision ||
    readiness.state !== 'ready' ||
    readiness.bindingRevision !== binding.revision ||
    readiness.providerPrincipalFactId === null ||
    readiness.snapshottedFactRevision === null
  ) {
    fail('permission_denied', 'The exact Worker Content snapshot and active binding are not ready.')
  }
  const currentFact = await input.tx.getProviderDirectoryPrincipalFactForSlotForUpdate(
    agent.ownerUserId,
    readiness.providerInstance
  )
  if (
    currentFact?.providerPrincipalFactId !== readiness.providerPrincipalFactId ||
    currentFact.revision !== readiness.snapshottedFactRevision ||
    currentFact.readiness !== 'ready'
  ) {
    fail('revision_conflict', 'The Worker Provider principal fact no longer matches the Project snapshot.')
  }
  return { agent, availability, authority, binding }
}

function deriveAssignmentArtifacts(input: Readonly<{
  project: StoredProject
  taskId: string
  executionId: string
  assignmentTaskRevision: number
  fileIntent: TaskFileIntent | null
  binding: StoredProjectContentSpaceBinding | null
  at: string
}>): Readonly<{ resources: StoredCloudResourceRef[]; executionFileIntent: TaskExecutionFileIntent | null }> {
  if (input.fileIntent === null) return { resources: [], executionFileIntent: null }
  const binding = required(input.binding, 'Project Content binding')
  const rootLocator = required(binding.rootLocator, 'Project Content root locator')
  if (binding.revision !== input.fileIntent.bindingRevision || binding.status !== 'active') {
    fail('revision_conflict', 'The Project Content binding revision is stale.')
  }
  const intentDigest = stableDigest(input.fileIntent)
  const entries = [
    ...input.fileIntent.inputs.map((item, ordinal) => ({
      role: 'input-file' as const,
      ordinal,
      locator: item.locator
    })),
    { role: 'output-container' as const, ordinal: input.fileIntent.inputs.length, locator: rootLocator }
  ]
  const resources: StoredCloudResourceRef[] = entries.map((entry) => {
    const locatorDigest = stableDigest(entry.locator)
    return {
      resourceRefId: `rrf_${stableDigest({ projectId: input.project.projectId, taskId: input.taskId,
        executionId: input.executionId, intentDigest, role: entry.role,
        ordinal: entry.ordinal, locatorDigest }).slice(0, 32)}`,
      projectId: input.project.projectId,
      taskId: input.taskId,
      executionId: input.executionId,
      assignmentTaskRevision: input.assignmentTaskRevision,
      bindingRevision: binding.revision,
      intentDigest,
      role: entry.role,
      ordinal: entry.ordinal,
      locator: entry.locator,
      locatorDigest,
      status: 'available',
      invalidatedAt: null,
      revision: 1,
      createdAt: input.at,
      updatedAt: input.at
    }
  })
  const rootResource = resources.at(-1)!
  const executionFileIntent: TaskExecutionFileIntent = {
    schemaVersion: 1,
    type: 'task_execution_file_intent',
    projectId: input.project.projectId,
    taskId: input.taskId,
    executionId: input.executionId,
    assignmentTaskRevision: input.assignmentTaskRevision,
    bindingRevision: binding.revision,
    declarationDigest: intentDigest,
    inputs: input.fileIntent.inputs.map((item, ordinal) => ({
      resourceRefId: resources[ordinal]!.resourceRefId,
      destinationName: item.destinationName
    })),
    output: {
      rootResourceRefId: rootResource.resourceRefId,
      fileName: input.fileIntent.output.fileName,
      mediaType: input.fileIntent.output.mediaType,
      maxBytes: input.fileIntent.output.maxBytes
    }
  }
  return { resources, executionFileIntent }
}

async function requireNewlyNamedSuccessorFileIntent(
  tx: CollaborationTransaction,
  task: StoredTask,
  nextFileIntent: TaskFileIntent | null
): Promise<TaskFileIntent | null> {
  if (task.fileIntent === null) {
    if (nextFileIntent !== null) {
      fail('validation_failed', 'A text Task successor cannot introduce a file intent.')
    }
    return null
  }
  if (nextFileIntent === null) {
    fail('validation_failed', 'A file Task successor requires one newly named file intent.')
  }
  const currentWithoutName = {
    ...task.fileIntent,
    output: { ...task.fileIntent.output, fileName: undefined }
  }
  const nextWithoutName = {
    ...nextFileIntent,
    output: { ...nextFileIntent.output, fileName: undefined }
  }
  if (stableDigest(currentWithoutName) !== stableDigest(nextWithoutName)) {
    fail(
      'validation_failed',
      'A successor may change only the safe output name; every other file intent fact is immutable.'
    )
  }
  if (nextFileIntent.output.fileName === task.fileIntent.output.fileName) {
    fail('validation_failed', 'A file Task successor must use a new no-overwrite output name.')
  }
  const executions = await tx.listTaskExecutions(task.taskId)
  if (executions.some((execution) => (
    execution.fileIntent?.output.fileName === nextFileIntent.output.fileName
  ))) {
    fail('validation_failed', 'The successor output name was already assigned to this Task history.')
  }
  return nextFileIntent
}

async function requireTaskOfferBundle(
  tx: CollaborationTransaction,
  input: Readonly<{
    taskOfferId: string
    taskId: string
    executionId: string
    expectedTaskRevision: number
    expectedExecutionRevision: number
    expectedOfferRevision: number
  }>
): Promise<Readonly<{
  project: StoredProject
  task: StoredTask
  execution: StoredTaskExecution
  offer: StoredTaskOffer
}>> {
  const task = required(await tx.getTaskForUpdate(input.taskId), 'Task')
  expectRevision(task.revision, input.expectedTaskRevision)
  const execution = required(await tx.getTaskExecutionForUpdate(input.executionId), 'Task execution')
  expectRevision(execution.revision, input.expectedExecutionRevision)
  const offer = required(await tx.getTaskOfferForUpdate(input.taskOfferId), 'Task offer')
  expectRevision(offer.revision, input.expectedOfferRevision)
  const project = required(await tx.getProjectForUpdate(task.projectId), 'Project')
  if (
    execution.taskId !== task.taskId ||
    offer.taskId !== task.taskId ||
    offer.executionId !== execution.executionId ||
    offer.projectId !== project.projectId
  ) {
    fail('validation_failed', 'Task, execution and offer identities do not form one assignment attempt.')
  }
  return { project, task, execution, offer }
}

function requireExactAssignee(actor: AgentActor, execution: StoredTaskExecution): void {
  if (
    actor.userId !== execution.assigneeUserId ||
    actor.agentId !== execution.assigneeAgentId ||
    actor.deviceId !== execution.assigneeDeviceId
  ) {
    fail('permission_denied', 'The command does not come from the exact assigned User, Agent and Device.')
  }
}

function assertOpenCurrentExecution(
  project: StoredProject,
  task: StoredTask,
  execution: StoredTaskExecution
): void {
  if (
    task.currentExecutionId !== execution.executionId ||
    task.currentExecutionState !== execution.state ||
    execution.fence.status !== 'open' ||
    execution.fence.projectExecutionAuthorityEpoch !== project.executionAuthorityEpoch ||
    execution.fence.assignmentTaskRevision > task.revision
  ) {
    fail('revision_conflict', 'The Task execution is not the exact current open assignment fence.')
  }
}

async function requireCurrentExecutionAuthority(
  tx: CollaborationTransaction,
  project: StoredProject,
  execution: StoredTaskExecution,
  at: string
): Promise<void> {
  if (project.status !== 'active') fail('permission_denied', 'The Project execution authority is not active.')
  const [membership, agent, device, authority] = await Promise.all([
    tx.getProjectMemberForUpdate(project.projectId, execution.assigneeUserId),
    tx.getAgentForUpdate(execution.assigneeAgentId),
    tx.getDeviceForUpdate(execution.assigneeDeviceId),
    tx.getTaskAuthorityForUpdate(project.projectId, execution.assigneeUserId,
      execution.fileIntent === null ? 'text_tasks' : 'file_tasks')
  ])
  if (
    membership?.state !== 'active' ||
    agent?.status !== 'active' ||
    agent.ownerUserId !== execution.assigneeUserId ||
    agent.deviceId !== execution.assigneeDeviceId ||
    device?.status !== 'active' ||
    device.userId !== execution.assigneeUserId ||
    authority?.state !== 'eligible' ||
    authority.authorityEpoch !== execution.fence.userTaskAuthorityEpoch
  ) {
    fail('permission_denied', 'The immutable execution authority facts are no longer current.')
  }
  if (execution.fileIntent !== null) {
    const [readiness, binding] = await Promise.all([
      tx.getProjectContentReadinessForUpdate(project.projectId, execution.assigneeUserId),
      tx.getProjectContentSpaceBindingForUpdate(project.projectId)
    ])
    if (
      readiness?.state !== 'ready' ||
      binding?.status !== 'active' ||
      binding.revision !== execution.fence.bindingRevision ||
      readiness.bindingRevision !== binding.revision
    ) {
      fail('permission_denied', 'The file execution Content authority is no longer current.')
    }
  }
  void at
}

function taskOfferBundleResponse(response: Record<string, unknown>): Readonly<{
  task: StoredTask
  execution: StoredTaskExecution
  offer: StoredTaskOffer
}> {
  return { task: response.task as StoredTask, execution: response.execution as StoredTaskExecution,
    offer: response.offer as StoredTaskOffer }
}

function taskExecutionBundleResponse(response: Record<string, unknown>): Readonly<{
  task: StoredTask
  execution: StoredTaskExecution
}> {
  return { task: response.task as StoredTask, execution: response.execution as StoredTaskExecution }
}

function completeParticipant(participant: StoredParticipant): StoredParticipant {
  return { ...participant, status: participant.primaryHumanEndpointId && participant.primaryAgentId ? 'complete' : 'incomplete' }
}

async function lockProviderLocator(tx: CollaborationTransaction, locator: ProviderLocatorValue): Promise<void> {
  await tx.lockIdempotency('provider-locator', stableDigest({
    provider: locator.provider,
    realmId: locator.realmId,
    containerId: locator.containerId,
    topicId: locator.topicId
  }))
}

async function lockProviderLocators(tx: CollaborationTransaction, locators: ProviderLocatorValue[]): Promise<void> {
  const unique = [...new Map(locators.map((locator) => [stableDigest(locator), locator])).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
  for (const [, locator] of unique) await lockProviderLocator(tx, locator)
}

function bounded(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function integer(value: number, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail('validation_failed', `${label} must be an integer between ${minimum} and ${maximum}.`)
  }
  return value
}

function assertText(value: string, label: string, minimum: number, maximum: number): void {
  if (typeof value !== 'string' || value.trim().length < minimum || value.length > maximum) {
    fail('validation_failed', `${label} must contain between ${minimum} and ${maximum} characters.`)
  }
}

function uniqueTexts(values: string[], maximumItems: number, maximumLength: number): string[] {
  if (!Array.isArray(values) || values.length > maximumItems) fail('validation_failed', `At most ${maximumItems} values are allowed.`)
  const output = [...new Set(values)]
  for (const value of output) assertText(value, 'list item', 1, maximumLength)
  return output
}

function validateProjectSummary(summary: string): void {
  assertText(summary, 'summary', 1, 50_000)
  const forbidden = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
    /\b(?:api[_ -]?key|password|bearer token)\s*[:=]/i,
    /(?:^|\s)(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)/,
    /\b(?:full transcript|complete tool log)\b/i
  ]
  if (forbidden.some((pattern) => pattern.test(summary))) {
    fail('validation_failed', 'Project records accept bounded shared summaries only; credentials, local paths, transcripts, and tool logs are forbidden.')
  }
}

function toHumanNeededEntity(request: StoredHumanRequest): Record<string, unknown> {
  return { schemaVersion: 1, type: 'human_needed', humanRequestId: request.humanRequestId,
    projectId: request.projectId, context: request.context,
    targetUserId: request.targetUserId,
    requestedByAgentId: request.requestedByAgentId, requiredAssurance: request.requiredAssurance,
    prompt: request.prompt, confirmableAction: request.confirmableAction,
    status: request.status, expiresAt: request.expiresAt,
    revision: request.revision, createdAt: request.createdAt, updatedAt: request.updatedAt }
}

function humanNeededProviderText(request: StoredHumanRequest): string {
  const instruction = `\n\nProject Owner 可在已登录 OIDC 的 SciForge Desktop 中回答；已绑定的 verified Human Endpoint 可回复：sciforge-answer ${request.humanRequestId} ${request.revision} <答案>。`
  const summary = request.confirmableAction ? `\n${request.confirmableAction.safeSummary}` : ''
  return `${request.prompt.slice(0, Math.max(0, 32_000 - summary.length - instruction.length))}${summary}${instruction}`
}

function toHumanAnswerEntity(answer: StoredHumanAnswer): Record<string, unknown> {
  return { schemaVersion: 1, type: 'human_answer', humanAnswerId: answer.humanAnswerId,
    humanRequestId: answer.humanRequestId, projectId: answer.projectId, context: answer.context,
    requestRevision: answer.requestRevision, answeredByUserId: answer.answeredByUserId,
    answeredFrom: answer.answeredFrom, assurance: answer.assurance,
    answer: answer.answer, decision: answer.decision, confirmationId: answer.confirmationId,
    answeredAt: answer.answeredAt, revision: answer.revision,
    createdAt: answer.createdAt, updatedAt: answer.updatedAt }
}

function issueRemoteApprovalReference(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(20)
  let value = 'AP1-'
  for (const byte of bytes) value += alphabet[byte! & 31]
  return value
}

function sameLocator(left: ProviderLocatorValue, right: ProviderLocatorValue): boolean {
  return left.provider === right.provider
    && left.realmId === right.realmId
    && left.containerId === right.containerId
    && left.topicId === right.topicId
}

function remoteApprovalCard(
  approval: StoredRemoteCapabilityApproval,
  approvalReference: string,
  sessionDisplayName: string
): string {
  return [
    'SciForge 请求一次权限',
    '',
    `操作：${approval.safeSummary}`,
    `Session：${sessionDisplayName}`,
    `风险：${approval.effect}`,
    '有效期：5 分钟',
    '',
    '回复：',
    `1 ${approvalReference}    仅本次允许`,
    `2 ${approvalReference}    拒绝`
  ].join('\n')
}

function remoteApprovalTerminalText(status: StoredRemoteCapabilityApproval['status']): string {
  switch (status) {
    case 'approved': return '本次权限已允许。'
    case 'completed': return '本次权限审批已处理。'
    case 'denied': return '本次权限已拒绝。'
    case 'expired': return '请求已过期，未执行。'
    case 'desktop_only': return '该请求不可远程审批，请回到 Desktop 处理。'
    case 'superseded': return '该请求已失效或已被替代，未执行。'
    default: return '该请求此前已经进入终态。'
  }
}

function toRemoteApprovalEntity(approval: StoredRemoteCapabilityApproval): Record<string, unknown> {
  return {
    type: 'remote_capability_approval',
    remoteApprovalId: approval.remoteApprovalId,
    ownerUserId: approval.ownerUserId,
    agentId: approval.agentId,
    projectionId: approval.projectionId,
    locator: approval.locator,
    runtimeId: approval.runtimeId,
    threadId: approval.threadId,
    turnId: approval.turnId,
    capabilityRequestId: approval.capabilityRequestId,
    desktopApprovalId: approval.desktopApprovalId,
    safeSummary: approval.safeSummary,
    effect: approval.effect,
    remoteEligible: approval.remoteEligible,
    status: approval.status,
    expiresAt: approval.expiresAt,
    ...(approval.providerCardMessageId ? { providerCardMessageId: approval.providerCardMessageId } : {}),
    schemaVersion: 1,
    revision: approval.revision,
    createdAt: approval.createdAt,
    updatedAt: approval.updatedAt
  }
}
