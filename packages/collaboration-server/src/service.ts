import { randomBytes } from 'node:crypto'
import {
  providerDirectRecipientSchema,
  type ProviderDirectRecipient,
  type ProviderIdentity
} from '@sciforge/collaboration-contracts'

import { actorInboxRecipient, authorize, type AgentActor, type AuthContext, type HumanEndpointActor, type UserActor } from './auth.js'
import { digestSecret, issueSecret, newId, safeAuditMetadata, stableDigest } from './crypto.js'
import { CollaborationServiceError, fail } from './errors.js'
import type {
  InboxRecipient,
  ProviderLocatorValue,
  ProjectBudgets,
  ProjectRecordKind,
  StoredAgent,
  StoredAuditEvent,
  StoredEndpoint,
  StoredInboxMessage,
  StoredManagedContainer,
  StoredManagedContainerJob,
  StoredParticipant,
  StoredProjection,
  StoredProject,
  StoredProjectEndpointBinding,
  StoredProjectInput,
  StoredProjectMember,
  StoredProjectRecord,
  StoredReceipt,
  StoredTask,
  StoredUser,
  StoredHumanRequest,
  StoredHumanAnswer,
  StoredRemoteCapabilityApproval,
  TaskStatus
} from './model.js'
import type { CollaborationReadRepository, CollaborationRepository, CollaborationTransaction } from './repository.js'

export type InboxAvailabilityNotifier = {
  notifyInboxAvailable(recipient: InboxRecipient, latestSequence: number): void | Promise<void>
}

export type CollaborationServiceOptions = {
  repository: CollaborationRepository
  notifier?: InboxAvailabilityNotifier
  now?: () => Date
  pairingTtlMs?: number
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

const DEFAULT_BUDGETS: ProjectBudgets = {
  maxTasks: 100,
  maxTasksPerRound: 20,
  maxTaskRetries: 2,
  maxCoordinationRounds: 20
}

const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  offered: ['accepted', 'rejected'],
  accepted: ['in_progress', 'rejected'],
  rejected: [],
  in_progress: ['needs_human', 'completed', 'failed'],
  needs_human: ['in_progress', 'failed'],
  completed: [],
  failed: [],
  cancelled: []
}

export class CollaborationService {
  private readonly repository: CollaborationRepository
  private readonly notifier?: InboxAvailabilityNotifier
  private readonly now: () => Date
  private readonly pairingTtlMs: number
  private readonly inboxRetentionMs: number
  private readonly receiptRetentionMs: number
  private readonly remoteApprovalReference: () => string

  constructor(options: CollaborationServiceOptions) {
    this.repository = options.repository
    this.notifier = options.notifier
    this.now = options.now ?? (() => new Date())
    this.pairingTtlMs = bounded(options.pairingTtlMs ?? 10 * 60_000, 60_000, 30 * 60_000)
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

  async beginPairing(input: {
    provider: string
    realmId: string
    requestedDisplayName: string
    idempotencyKey: string
    requestedBy?: UserActor
    expectedProviderUserId?: string
  }): Promise<Record<string, unknown>> {
    assertText(input.provider, 'provider', 1, 100)
    assertText(input.realmId, 'realmId', 1, 300)
    assertText(input.requestedDisplayName, 'requestedDisplayName', 1, 200)
    const challengeCode = randomBytes(9).toString('base64url')
    const pollSecret = issueSecret('pairing_poll')
    const actor: AuthContext = input.requestedBy ?? { kind: 'system', actorKey: `anonymous-pairing:${stableDigest(input.idempotencyKey).slice(0, 24)}` }
    const result = await this.commit(actor, 'pairing.begin', input.idempotencyKey, {
      provider: input.provider,
      realmId: input.realmId,
      requestedDisplayName: input.requestedDisplayName,
      requestedUserId: input.requestedBy?.userId,
      expectedProviderUserId: input.expectedProviderUserId
    }, async (tx, at) => {
      const challengeId = newId('chl')
      const expiresAt = new Date(new Date(at).getTime() + this.pairingTtlMs).toISOString()
      await tx.insertChallenge({
        challengeId,
        requestedUserId: input.requestedBy?.userId,
        provider: input.provider,
        realmId: input.realmId,
        expectedProviderUserId: input.expectedProviderUserId,
        challengeDigest: digestSecret(challengeCode),
        pollSecretDigest: digestSecret(pollSecret),
        requestedDisplayName: input.requestedDisplayName,
        expiresAt,
        createdAt: at
      })
      return {
        response: { protocolVersion: '1.0', type: 'pairing.begun', challengeId, challengeCode, pollSecret, expiresAt },
        receiptResponse: { protocolVersion: '1.0', type: 'pairing.begun', challengeId, expiresAt, replayed: true },
        resourceKind: 'endpoint_challenge',
        resourceId: challengeId
      }
    })
    return result
  }

  async verifyPairingFromProvider(input: {
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
    return this.commit(actor, 'pairing.verify', input.providerEventId, {
      provider: input.provider,
      realmId: input.realmId,
      providerUserId: input.providerUserId,
      providerEventId: input.providerEventId
    }, async (tx, at) => {
      const challengeCodeDigest = digestSecret(input.challengeCode)
      const challenge = input.challengeId
        ? await tx.getChallenge(input.challengeId)
        : await tx.getChallengeByCodeDigest(challengeCodeDigest)
      if (!challenge || challenge.challengeDigest !== challengeCodeDigest ||
          challenge.provider !== input.provider || challenge.realmId !== input.realmId) {
        fail('not_found', 'The pairing challenge is not valid for this provider realm.')
      }
      if (challenge.expectedProviderUserId && challenge.expectedProviderUserId !== input.providerUserId) {
        fail('identity_conflict', 'The challenge response came from a different provider identity.')
      }
      if (challenge.expiresAt <= at) fail('request_expired', 'The pairing challenge has expired.')
      if (challenge.consumedAt) fail('request_expired', 'The pairing challenge was already consumed.')
      if (challenge.verifiedAt && challenge.verifiedUserId && challenge.verifiedEndpointId) {
        return {
          response: { protocolVersion: '1.0', type: 'pairing.verified', challengeId: challenge.challengeId,
            userId: challenge.verifiedUserId, humanEndpointId: challenge.verifiedEndpointId },
          resourceKind: 'human_endpoint', resourceId: challenge.verifiedEndpointId
        }
      }
      const existing = await tx.getEndpointByProviderIdentity(input.provider, input.realmId, input.providerUserId)
      if (existing && challenge.requestedUserId && existing.userId !== challenge.requestedUserId && existing.status !== 'revoked') {
        fail('identity_conflict', 'This provider identity belongs to another active user and must be explicitly transferred.')
      }
      let user: StoredUser
      if (existing) {
        const found = await tx.getUser(existing.userId)
        if (!found) fail('not_found', 'The endpoint owner no longer exists.')
        user = found
      } else if (challenge.requestedUserId) {
        const found = await tx.getUser(challenge.requestedUserId)
        if (!found || found.status !== 'active') fail('credential_revoked', 'The requesting user is not active.')
        user = found
      } else {
        user = {
          userId: newId('usr'),
          displayName: challenge.requestedDisplayName,
          status: 'active',
          revision: 1,
          createdAt: at,
          updatedAt: at
        }
        await tx.insertUser(user)
      }
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
        fail('revision_conflict', 'The pairing challenge changed while it was being verified.')
      }
      return {
        response: { protocolVersion: '1.0', type: 'pairing.verified', challengeId: challenge.challengeId,
          userId: user.userId, humanEndpointId: endpoint.humanEndpointId },
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

  async redeemPairing(input: { pollSecret: string; idempotencyKey: string }): Promise<Record<string, unknown>> {
    assertText(input.pollSecret, 'pollSecret', 24, 512)
    const pollDigest = digestSecret(input.pollSecret)
    const actor: AuthContext = { kind: 'system', actorKey: `pairing-poll:${pollDigest}` }
    return this.commit(actor, 'pairing.redeem', input.idempotencyKey, { pollDigest }, async (tx, at) => {
      const challenge = await tx.getChallengeByPollDigest(pollDigest)
      if (!challenge) fail('authentication_required', 'The pairing poll credential is not recognized.')
      if (challenge.expiresAt <= at) fail('request_expired', 'The pairing request expired.')
      if (!challenge.verifiedAt || !challenge.verifiedUserId || !challenge.verifiedEndpointId) {
        return {
          response: { protocolVersion: '1.0', type: 'pairing.pending', challengeId: challenge.challengeId, expiresAt: challenge.expiresAt },
          resourceKind: 'endpoint_challenge', resourceId: challenge.challengeId,
          persistReceipt: false
        }
      }
      if (challenge.consumedAt) fail('request_expired', 'The pairing credential was already redeemed.')
      const endpoint = required(await tx.getEndpoint(challenge.verifiedEndpointId), 'Verified human endpoint')
      if (endpoint.userId !== challenge.verifiedUserId || endpoint.status !== 'active') {
        fail('credential_revoked', 'The verified human endpoint is no longer active for this user.')
      }
      const userCredential = issueSecret('user')
      await tx.insertCredential({
        credentialId: newId('credential'),
        kind: 'user',
        subjectUserId: challenge.verifiedUserId,
        tokenDigest: digestSecret(userCredential),
        assurance: endpoint.assurance === 'strong' ? 'strong' : 'verified',
        generation: 1,
        createdAt: at
      })
      if (!await tx.consumeChallenge(challenge.challengeId, at)) fail('revision_conflict', 'The pairing request was redeemed concurrently.')
      return {
        response: { protocolVersion: '1.0', type: 'pairing.redeemed', userId: challenge.verifiedUserId,
          humanEndpointId: challenge.verifiedEndpointId, userCredential },
        receiptResponse: { protocolVersion: '1.0', type: 'pairing.redeemed', userId: challenge.verifiedUserId,
          humanEndpointId: challenge.verifiedEndpointId, replayed: true },
        resourceKind: 'user', resourceId: challenge.verifiedUserId
      }
    })
  }

  async setUserStatus(actor: AuthContext, input: {
    userId: string
    status: 'active' | 'suspended' | 'revoked'
    expectedRevision: number
    idempotencyKey: string
  }): Promise<StoredUser> {
    if (actor.kind !== 'system' && (actor.kind !== 'user' || actor.userId !== input.userId || actor.assurance !== 'strong')) {
      fail('permission_denied', 'Changing user lifecycle requires system authority or the same strong user credential.')
    }
    return this.commit(actor, 'user.status.set', input.idempotencyKey, input, async (tx, at) => {
      const user = required(await tx.getUser(input.userId), 'User')
      expectRevision(user.revision, input.expectedRevision)
      if (user.status === 'revoked' && input.status !== 'revoked') fail('invalid_state_transition', 'A revoked user cannot be reactivated.')
      const updated: StoredUser = { ...user, status: input.status, revision: user.revision + 1, updatedAt: at,
        revokedAt: input.status === 'revoked' ? at : user.revokedAt }
      await tx.updateUser(updated, user.revision)
      if (input.status !== 'active') await tx.revokeCredentials('user', user.userId, at)
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
      if (status !== 'active') await tx.revokeCredentials('user', user.userId, at)
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
    installationId: string
    displayName: string
    nodeType: string
    capabilities: string[]
    idempotencyKey: string
  }): Promise<{ agent: StoredAgent; deviceCredential?: string; replayed?: boolean }> {
    assertText(input.installationId, 'installationId', 8, 300)
    assertText(input.displayName, 'displayName', 1, 200)
    assertText(input.nodeType, 'nodeType', 1, 100)
    const capabilities = uniqueTexts(input.capabilities, 100, 200)
    const deviceCredential = issueSecret('agent')
    return this.commit(actor, 'agent.register', input.idempotencyKey, { ...input, capabilities }, async (tx, at) => {
      const existing = await tx.getAgentByInstallation(input.installationId)
      if (existing) {
        if (existing.ownerUserId !== actor.userId) fail('identity_conflict', 'This installation belongs to another user.')
        return { response: { protocolVersion: '1.0', type: 'agent.registered', agent: existing, replayed: true },
          resourceKind: 'agent', resourceId: existing.agentId }
      }
      const agent: StoredAgent = {
        agentId: newId('agt'), installationId: input.installationId, ownerUserId: actor.userId,
        displayName: input.displayName, nodeType: input.nodeType, capabilities, status: 'active',
        connectionStatus: 'offline', credentialGeneration: 1, revision: 1, updatedAt: at
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
        response: { protocolVersion: '1.0', type: 'agent.registered', agent, deviceCredential },
        receiptResponse: { protocolVersion: '1.0', type: 'agent.registered', agent, replayed: true },
        resourceKind: 'agent', resourceId: agent.agentId
      }
    }).then((response) => ({
      agent: response.agent as StoredAgent,
      ...(typeof response.deviceCredential === 'string' ? { deviceCredential: response.deviceCredential } : {}),
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
    idempotencyKey: string
  }): Promise<{ agent: StoredAgent; deviceCredential?: string; replayed?: boolean }> {
    const deviceCredential = issueSecret('agent')
    return this.commit(actor, 'agent.credential.rotate', input.idempotencyKey, input, async (tx, at) => {
      const agent = required(await tx.getAgent(input.agentId), 'Agent')
      if (agent.ownerUserId !== actor.userId) fail('permission_denied', 'The Agent belongs to another user.')
      expectRevision(agent.revision, input.expectedRevision)
      await tx.revokeCredentials('agent_device', agent.agentId, at)
      const updated: StoredAgent = { ...agent, credentialGeneration: agent.credentialGeneration + 1,
        connectionStatus: 'offline', revision: agent.revision + 1, updatedAt: at }
      await tx.updateAgent(updated, agent.revision)
      await tx.insertCredential({ credentialId: newId('credential'), kind: 'agent_device', subjectUserId: actor.userId,
        subjectAgentId: agent.agentId, tokenDigest: digestSecret(deviceCredential), assurance: 'device',
        generation: updated.credentialGeneration, createdAt: at })
      return { response: { protocolVersion: '1.0', type: 'agent.credential_rotated', agent: updated, deviceCredential },
        receiptResponse: { protocolVersion: '1.0', type: 'agent.credential_rotated', agent: updated, replayed: true },
        resourceKind: 'agent', resourceId: agent.agentId }
    }).then((response) => ({ agent: response.agent as StoredAgent,
      ...(typeof response.deviceCredential === 'string' ? { deviceCredential: response.deviceCredential } : {}),
      ...(response.replayed === true ? { replayed: true } : {}) }))
  }

  async revokeAgent(actor: UserActor, input: {
    agentId: string
    expectedRevision: number
    idempotencyKey: string
  }): Promise<StoredAgent> {
    return this.commit(actor, 'agent.revoke', input.idempotencyKey, input, async (tx, at) => {
      const agent = required(await tx.getAgent(input.agentId), 'Agent')
      if (agent.ownerUserId !== actor.userId) fail('permission_denied', 'The Agent belongs to another user.')
      expectRevision(agent.revision, input.expectedRevision)
      const updated: StoredAgent = { ...agent, status: 'revoked', connectionStatus: 'offline', revokedAt: at,
        revision: agent.revision + 1, updatedAt: at }
      await tx.updateAgent(updated, agent.revision)
      await tx.revokeCredentials('agent_device', agent.agentId, at)
      const notifications: Array<{ recipient: InboxRecipient; sequence: number }> = []
      const ownerMessage = await this.appendInbox(tx, { kind: 'user', id: actor.userId }, 'collaboration.important_failure',
        { protocolVersion: '1.0', type: 'collaboration.important_failure', safeMessage: 'A collaboration Agent was revoked and its pending work requires review.' }, at)
      notifications.push({ recipient: ownerMessage.recipient, sequence: ownerMessage.sequence })
      for (const task of await tx.listOpenTasksForAgent(agent.agentId)) {
        const project = await tx.getProject(task.projectId)
        if (!project) continue
        const message = await this.appendInbox(tx, { kind: 'agent', id: project.coordinatorAgentId }, 'task.updated',
          { protocolVersion: '1.0', type: 'task.updated', projectId: project.projectId, taskId: task.taskId,
            revision: task.revision, status: contractTaskStatus(task.status), safeFailureCode: 'assignee_revoked' }, at)
        notifications.push({ recipient: message.recipient, sequence: message.sequence })
      }
      for (const project of await tx.listActiveProjectsForCoordinator(agent.agentId)) {
        const paused = { ...project, status: 'paused' as const, revision: project.revision + 1, updatedAt: at }
        await tx.updateProject(paused, project.revision)
        const message = await this.appendInbox(tx, { kind: 'user', id: project.ownerUserId },
          'collaboration.important_failure', { protocolVersion: '1.0', type: 'collaboration.important_failure',
            projectId: project.projectId, safeMessage: 'The Coordinator Agent was revoked; the Project was paused and requires explicit transfer.' }, at)
        notifications.push({ recipient: message.recipient, sequence: message.sequence })
      }
      const participant = await tx.getParticipant(actor.userId)
      if (participant?.primaryAgentId === agent.agentId) {
        const changed = completeParticipant({ ...participant, primaryAgentId: undefined,
          revision: participant.revision + 1, updatedAt: at })
        await tx.upsertParticipant(changed, participant.revision)
      }
      return { response: entityResponse('agent.revoked', updated), resourceKind: 'agent', resourceId: agent.agentId, notifications }
    }).then(responseEntity<StoredAgent>)
  }

  async transferAgentOwnership(actor: UserActor, input: {
    agentId: string
    targetUserId: string
    expectedRevision: number
    idempotencyKey: string
  }): Promise<{ agent: StoredAgent; deviceCredential?: string; replayed?: boolean }> {
    if (actor.assurance !== 'strong') fail('assurance_insufficient', 'Agent ownership transfer requires strong assurance.')
    const deviceCredential = issueSecret('agent')
    return this.commit(actor, 'agent.owner.transfer', input.idempotencyKey, input, async (tx, at) => {
      const agent = required(await tx.getAgent(input.agentId), 'Agent')
      if (agent.ownerUserId !== actor.userId) fail('permission_denied', 'Only the current Agent owner may transfer it.')
      expectRevision(agent.revision, input.expectedRevision)
      const target = required(await tx.getUser(input.targetUserId), 'Target user')
      if (target.status !== 'active') fail('credential_revoked', 'The target user is not active.')
      const affectedProjectIds = new Set((await tx.listActiveProjectsForCoordinator(agent.agentId)).map((project) => project.projectId))
      for (const task of await tx.listOpenTasksForAgent(agent.agentId)) affectedProjectIds.add(task.projectId)
      for (const projectId of affectedProjectIds) {
        const membership = await tx.getProjectMember(projectId, target.userId)
        if (!membership?.active || membership.role === 'observer') {
          fail('permission_denied', 'The target owner must already be an executable member of every active Project assigned to this Agent.')
        }
      }
      await tx.revokeCredentials('agent_device', agent.agentId, at)
      const updated: StoredAgent = { ...agent, ownerUserId: target.userId,
        credentialGeneration: agent.credentialGeneration + 1, connectionStatus: 'offline',
        revision: agent.revision + 1, updatedAt: at }
      await tx.updateAgent(updated, agent.revision)
      await tx.insertCredential({ credentialId: newId('credential'), kind: 'agent_device',
        subjectUserId: target.userId, subjectAgentId: agent.agentId, tokenDigest: digestSecret(deviceCredential),
        assurance: 'device', generation: updated.credentialGeneration, createdAt: at })
      for (const userId of [actor.userId, target.userId]) {
        const participant = await tx.getParticipant(userId)
        if (!participant) continue
        const changed = completeParticipant({ ...participant,
          primaryAgentId: userId === target.userId
            ? participant.primaryAgentId ?? agent.agentId
            : participant.primaryAgentId === agent.agentId ? undefined : participant.primaryAgentId,
          revision: participant.revision + 1, updatedAt: at })
        await tx.upsertParticipant(changed, participant.revision)
      }
      return { response: { protocolVersion: '1.0', type: 'agent.owner_transferred', agent: updated, deviceCredential },
        receiptResponse: { protocolVersion: '1.0', type: 'agent.owner_transferred', agent: updated, replayed: true },
        resourceKind: 'agent', resourceId: agent.agentId }
    }).then((response) => ({ agent: response.agent as StoredAgent,
      ...(typeof response.deviceCredential === 'string' ? { deviceCredential: response.deviceCredential } : {}),
      ...(response.replayed === true ? { replayed: true } : {}) }))
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
      const member = await tx.getProjectMember(project.projectId, actor.userId)
      authorize({ actor, operation: 'project_admin', projectRole: member?.role })
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
    authorize({ actor, operation: 'project_read', projectMember: Boolean(member?.active) })
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
      const member = await tx.getProjectMember(binding.projectId, actor.userId)
      authorize({ actor, operation: 'project_admin', projectRole: member?.role })
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
      authorize({ actor, operation: 'project_input', projectMember: Boolean(member?.active) })
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

  async createHumanNeeded(actor: AgentActor, input: {
    projectId: string
    taskId: string
    expectedTaskRevision: number
    targetUserId: string
    requiredAssurance: 'basic' | 'verified' | 'strong'
    prompt: string
    expiresAt: string
    idempotencyKey: string
  }): Promise<StoredHumanRequest> {
    assertText(input.prompt, 'prompt', 1, 32_000)
    return this.commit(actor, 'human.needed.create', input.idempotencyKey, input, async (tx, at) => {
      const task = required(await tx.getTask(input.taskId), 'Task')
      const project = required(await tx.getProject(input.projectId), 'Project')
      if (task.projectId !== project.projectId) fail('validation_failed', 'The Task belongs to another Project.')
      expectRevision(task.revision, input.expectedTaskRevision)
      const member = await tx.getProjectMember(project.projectId, input.targetUserId)
      authorize({ actor, operation: 'human_needed', assigneeAgentId: task.assigneeAgentId, projectMember: Boolean(member?.active) })
      if (new Date(input.expiresAt).getTime() <= new Date(at).getTime()) fail('request_expired', 'HumanNeeded expiry must be in the future.')
      if (task.status !== 'in_progress' && task.status !== 'needs_human') fail('invalid_state_transition', 'HumanNeeded requires a running Task.')
      const request: StoredHumanRequest = { humanRequestId: newId('hrq'), projectId: project.projectId,
        taskId: task.taskId, targetUserId: input.targetUserId, requestedByAgentId: actor.agentId,
        requiredAssurance: input.requiredAssurance, prompt: input.prompt, status: 'pending', revision: 1,
        expiresAt: input.expiresAt, createdAt: at, updatedAt: at }
      await tx.insertHumanRequest(request)
      let taskRevision = task.revision
      if (task.status !== 'needs_human') {
        const updatedTask: StoredTask = { ...task, status: 'needs_human', revision: task.revision + 1, updatedAt: at }
        await tx.updateTask(updatedTask, task.revision)
        taskRevision = updatedTask.revision
      }
      const message = await this.appendInbox(tx, { kind: 'user', id: input.targetUserId }, 'human.needed', {
        protocolVersion: '1.0', type: 'human.needed', request: toHumanNeededEntity(request)
      }, at)
      const notifications = [{ recipient: message.recipient, sequence: message.sequence }]
      const coordinatorMessage = await this.appendInbox(tx, { kind: 'agent', id: project.coordinatorAgentId }, 'task.updated', {
        protocolVersion: '1.0', type: 'task.updated', projectId: project.projectId, taskId: task.taskId,
        revision: taskRevision, status: 'needs_human', humanRequestId: request.humanRequestId
      }, at)
      notifications.push({ recipient: coordinatorMessage.recipient, sequence: coordinatorMessage.sequence })
      const [participant, binding] = await Promise.all([
        tx.getParticipant(input.targetUserId),
        tx.getProjectEndpointBinding(project.projectId)
      ])
      if (participant?.primaryHumanEndpointId && binding?.status === 'active') {
        const endpoint = await tx.getEndpoint(participant.primaryHumanEndpointId)
        if (endpoint?.status === 'active' && endpoint.userId === input.targetUserId &&
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

  async answerHumanNeeded(actor: HumanEndpointActor, input: {
    humanRequestId: string
    requestRevision: number
    answer: string
    sourceLocator?: ProviderLocatorValue
    idempotencyKey: string
  }): Promise<StoredHumanAnswer> {
    assertText(input.answer, 'answer', 1, 32_000)
    return this.commit(actor, 'human.answer', input.idempotencyKey, input, async (tx, at) => {
      const request = required(await tx.getHumanRequest(input.humanRequestId), 'HumanNeeded request')
      authorize({ actor, operation: 'human_answer', targetUserId: request.targetUserId,
        requiredAssurance: request.requiredAssurance })
      if (input.sourceLocator) {
        const [endpoint, binding] = await Promise.all([
          tx.getEndpoint(actor.humanEndpointId),
          tx.getProjectBindingByLocator(input.sourceLocator.provider, input.sourceLocator.realmId,
            input.sourceLocator.containerId, input.sourceLocator.topicId)
        ])
        if (!endpoint || endpoint.status !== 'active' || endpoint.userId !== actor.userId ||
            endpoint.provider !== input.sourceLocator.provider || endpoint.realmId !== input.sourceLocator.realmId ||
            !binding || binding.status !== 'active' || binding.projectId !== request.projectId) {
          fail('not_found', 'The provider answer does not originate from the active Project endpoint binding.')
        }
      }
      expectRevision(request.revision, input.requestRevision)
      if (request.status !== 'pending' || request.expiresAt <= at) fail('request_expired', 'The HumanNeeded request is no longer current.')
      const existing = await tx.getHumanAnswerForRequest(request.humanRequestId)
      if (existing) return { response: entityResponse('human_answer.created', existing), resourceKind: 'human_answer',
        resourceId: existing.humanAnswerId }
      const answer: StoredHumanAnswer = { humanAnswerId: newId('han'), humanRequestId: request.humanRequestId,
        projectId: request.projectId, taskId: request.taskId, requestRevision: request.revision,
        answeredByUserId: actor.userId, answeredFromHumanEndpointId: actor.humanEndpointId,
        assurance: actor.assurance, answer: input.answer, revision: 1, answeredAt: at, createdAt: at, updatedAt: at }
      await tx.insertHumanAnswer(answer)
      await tx.updateHumanRequest({ ...request, status: 'answered', revision: request.revision + 1, updatedAt: at }, request.revision)
      const project = required(await tx.getProject(request.projectId), 'Project')
      const notifications: Array<{ recipient: InboxRecipient; sequence: number }> = []
      for (const agentId of new Set([request.requestedByAgentId, project.coordinatorAgentId])) {
        const message = await this.appendInbox(tx, { kind: 'agent', id: agentId }, 'human.answer.received', {
          protocolVersion: '1.0', type: 'human.answer.received', answer: toHumanAnswerEntity(answer)
        }, at)
        notifications.push({ recipient: message.recipient, sequence: message.sequence })
      }
      return { response: entityResponse('human_answer.created', answer), resourceKind: 'human_answer',
        resourceId: answer.humanAnswerId, notifications }
    }).then(responseEntity<StoredHumanAnswer>)
  }

  async createProject(actor: UserActor, input: {
    displayName: string
    goal: string
    memberUserIds: string[]
    coordinatorAgentId: string
    budgets?: Partial<ProjectBudgets>
    idempotencyKey: string
  }): Promise<StoredProject> {
    assertText(input.displayName, 'displayName', 1, 200)
    assertText(input.goal, 'goal', 1, 20_000)
    const memberUserIds = [...new Set([actor.userId, ...input.memberUserIds])]
    if (memberUserIds.length > 1_000) fail('validation_failed', 'A Project may have at most 1000 members.')
    const budgets = normalizeBudgets(input.budgets)
    return this.commit(actor, 'project.create', input.idempotencyKey, { ...input, memberUserIds, budgets }, async (tx, at) => {
      for (const userId of memberUserIds) {
        const user = required(await tx.getUser(userId), 'Project member')
        if (user.status !== 'active') fail('credential_revoked', 'Every Project member must be active.')
      }
      const coordinator = required(await tx.getAgent(input.coordinatorAgentId), 'Coordinator Agent')
      if (coordinator.status !== 'active' || !memberUserIds.includes(coordinator.ownerUserId)) {
        fail('permission_denied', 'Coordinator ownership must resolve to an active Project member.')
      }
      const projectId = newId('prj')
      const project: StoredProject = { projectId, ownerUserId: actor.userId, displayName: input.displayName,
        goal: input.goal, status: 'active',
        coordinatorAgentId: coordinator.agentId, budgets, coordinationRound: 1, revision: 1, createdAt: at, updatedAt: at }
      const members: StoredProjectMember[] = memberUserIds.map((userId) => ({ projectId, userId,
        role: userId === actor.userId ? 'owner' : 'member', active: true, createdAt: at }))
      await tx.insertProject(project, members)
      const message = await this.appendInbox(tx, { kind: 'agent', id: coordinator.agentId }, 'project.started',
        { protocolVersion: '1.0', type: 'project.started', projectId, revision: project.revision }, at)
      return { response: entityResponse('project.created', project), resourceKind: 'project', resourceId: projectId,
        notifications: [{ recipient: message.recipient, sequence: message.sequence }] }
    }).then(responseEntity<StoredProject>)
  }

  async transferCoordinator(actor: UserActor, input: {
    projectId: string
    coordinatorAgentId: string
    expectedRevision: number
    idempotencyKey: string
  }): Promise<StoredProject> {
    return this.commit(actor, 'project.coordinator.transfer', input.idempotencyKey, input, async (tx, at) => {
      const project = required(await tx.getProject(input.projectId), 'Project')
      const member = await tx.getProjectMember(project.projectId, actor.userId)
      authorize({ actor, operation: 'project_admin', projectRole: member?.role })
      expectRevision(project.revision, input.expectedRevision)
      const coordinator = required(await tx.getAgent(input.coordinatorAgentId), 'Coordinator Agent')
      const coordinatorMember = await tx.getProjectMember(project.projectId, coordinator.ownerUserId)
      if (coordinator.status !== 'active' || !coordinatorMember?.active) {
        fail('permission_denied', 'The new Coordinator must belong to an active Project member.')
      }
      const oldCoordinatorAgentId = project.coordinatorAgentId
      const updated: StoredProject = { ...project, coordinatorAgentId: coordinator.agentId,
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
            revision: updated.revision }, at)
        notifications.push({ recipient: message.recipient, sequence: message.sequence })
      }
      return { response: entityResponse('project.updated', updated), resourceKind: 'project', resourceId: project.projectId, notifications }
    }).then(responseEntity<StoredProject>)
  }

  async transitionProject(actor: UserActor, input: {
    projectId: string
    status: 'active' | 'paused' | 'completed' | 'cancelled'
    expectedRevision: number
    idempotencyKey: string
  }): Promise<StoredProject> {
    return this.commit(actor, 'project.transition', input.idempotencyKey, input, async (tx, at) => {
      const project = required(await tx.getProject(input.projectId), 'Project')
      const member = await tx.getProjectMember(project.projectId, actor.userId)
      authorize({ actor, operation: 'project_admin', projectRole: member?.role })
      expectRevision(project.revision, input.expectedRevision)
      if (['completed', 'cancelled'].includes(project.status)) fail('invalid_state_transition', 'A terminal Project cannot transition again.')
      const updated: StoredProject = { ...project, status: input.status, revision: project.revision + 1, updatedAt: at }
      await tx.updateProject(updated, project.revision)
      return { response: entityResponse('project.updated', updated), resourceKind: 'project', resourceId: project.projectId }
    }).then(responseEntity<StoredProject>)
  }

  async createTask(actor: AgentActor, input: {
    projectId: string
    assigneeAgentId: string
    title: string
    objective: string
    completionCriteria: string[]
    dependencyTaskIds: string[]
    expectedProjectRevision: number
    idempotencyKey: string
  }): Promise<StoredTask> {
    assertText(input.title, 'title', 1, 200)
    assertText(input.objective, 'objective', 1, 20_000)
    const criteria = uniqueTexts(input.completionCriteria, 100, 1_000)
    const dependencies = uniqueTexts(input.dependencyTaskIds, 1_000, 100)
    return this.commit(actor, 'task.create', input.idempotencyKey, { ...input, completionCriteria: criteria,
      dependencyTaskIds: dependencies }, async (tx, at) => {
      const project = required(await tx.getProject(input.projectId), 'Project')
      if (project.status !== 'active') fail('invalid_state_transition', 'Tasks may only be created for an active Project.')
      authorize({ actor, operation: 'task_create', coordinatorAgentId: project.coordinatorAgentId })
      expectRevision(project.revision, input.expectedProjectRevision)
      const assignee = required(await tx.getAgent(input.assigneeAgentId), 'Assignee Agent')
      const member = await tx.getProjectMember(project.projectId, assignee.ownerUserId)
      if (assignee.status !== 'active' || !member?.active || member.role === 'observer') {
        fail('permission_denied', 'The assignee Agent owner is not an executable Project member.')
      }
      const totalTasks = await tx.countProjectTasks(project.projectId)
      const roundTasks = await tx.countProjectTasks(project.projectId, project.coordinationRound)
      if (totalTasks >= project.budgets.maxTasks || roundTasks >= project.budgets.maxTasksPerRound) {
        fail('budget_exhausted', 'The Project task budget for this Project or coordination round is exhausted.')
      }
      for (const dependencyTaskId of dependencies) {
        const dependency = required(await tx.getTask(dependencyTaskId), 'Dependency Task')
        if (dependency.projectId !== project.projectId) fail('validation_failed', 'Dependencies must belong to the same Project.')
      }
      const task: StoredTask = { taskId: newId('tsk'), projectId: project.projectId, assigneeAgentId: assignee.agentId,
        createdByAgentId: actor.agentId, title: input.title, objective: input.objective, completionCriteria: criteria,
        dependencyTaskIds: dependencies, status: 'offered', retryCount: 0, maxRetries: project.budgets.maxTaskRetries,
        coordinationRound: project.coordinationRound, revision: 1, createdAt: at, updatedAt: at }
      await tx.insertTask(task)
      const updatedProject: StoredProject = { ...project, revision: project.revision + 1, updatedAt: at }
      await tx.updateProject(updatedProject, project.revision)
      const message = await this.appendInbox(tx, { kind: 'agent', id: assignee.agentId }, 'task.offered',
        { protocolVersion: '1.0', type: 'task.offered', projectId: project.projectId,
          taskId: task.taskId, revision: task.revision }, at)
      return { response: entityResponse('task.created', task), resourceKind: 'task', resourceId: task.taskId,
        notifications: [{ recipient: message.recipient, sequence: message.sequence }] }
    }).then(responseEntity<StoredTask>)
  }

  async transitionTask(actor: AgentActor, input: {
    taskId: string
    status: 'accepted' | 'rejected' | 'in_progress' | 'needs_human' | 'completed' | 'failed'
    expectedRevision: number
    resultSummary?: string
    failureSummary?: string
    targetUserId?: string
    idempotencyKey: string
  }): Promise<StoredTask> {
    if (input.resultSummary) validateProjectSummary(input.resultSummary)
    if (input.failureSummary) validateProjectSummary(input.failureSummary)
    if (input.status === 'needs_human') {
      fail('invalid_state_transition', 'Use human.needed.create to enter needs_human with a bounded request and explicit target.')
    }
    return this.commit(actor, `task.${input.status}`, input.idempotencyKey, input, async (tx, at) => {
      const task = required(await tx.getTask(input.taskId), 'Task')
      const project = required(await tx.getProject(task.projectId), 'Project')
      authorize({ actor, operation: 'task_update', assigneeAgentId: task.assigneeAgentId })
      expectRevision(task.revision, input.expectedRevision)
      if (!TASK_TRANSITIONS[task.status].includes(input.status)) {
        fail('invalid_state_transition', `Task cannot transition from ${task.status} to ${input.status}.`)
      }
      if (input.status === 'completed' && !input.resultSummary) fail('validation_failed', 'Completed tasks require a bounded result summary.')
      if (input.status === 'failed' && !input.failureSummary) fail('validation_failed', 'Failed tasks require a bounded failure summary.')
      const updated: StoredTask = { ...task, status: input.status, resultSummary: input.resultSummary ?? task.resultSummary,
        failureSummary: input.failureSummary ?? task.failureSummary, revision: task.revision + 1, updatedAt: at,
        completedAt: ['completed', 'failed', 'rejected'].includes(input.status) ? at : undefined }
      await tx.updateTask(updated, task.revision)
      const notifications: Array<{ recipient: InboxRecipient; sequence: number }> = []
      const coordinatorMessage = await this.appendInbox(tx, { kind: 'agent', id: project.coordinatorAgentId }, 'task.updated',
        { protocolVersion: '1.0', type: 'task.updated', projectId: project.projectId, taskId: task.taskId,
          revision: updated.revision, status: contractTaskStatus(updated.status),
          ...(input.failureSummary ? { safeFailureCode: 'task_failed' } : {}) }, at)
      notifications.push({ recipient: coordinatorMessage.recipient, sequence: coordinatorMessage.sequence })
      return { response: entityResponse('task.updated', updated), resourceKind: 'task', resourceId: task.taskId, notifications }
    }).then(responseEntity<StoredTask>)
  }

  async getTask(actor: AuthContext, taskId: string): Promise<StoredTask> {
    if (actor.kind === 'system') fail('permission_denied', 'System context cannot read Project Tasks.')
    const task = required(await this.repository.getTask(taskId), 'Task')
    const member = await this.repository.getProjectMember(task.projectId, actor.userId)
    authorize({ actor, operation: 'project_read', projectMember: Boolean(member?.active) })
    return task
  }

  async retryOrReassignTask(actor: AgentActor, input: {
    taskId: string
    assigneeAgentId: string
    expectedRevision: number
    idempotencyKey: string
  }): Promise<StoredTask> {
    return this.commit(actor, 'task.retry', input.idempotencyKey, input, async (tx, at) => {
      const task = required(await tx.getTask(input.taskId), 'Task')
      const project = required(await tx.getProject(task.projectId), 'Project')
      authorize({ actor, operation: 'task_create', coordinatorAgentId: project.coordinatorAgentId })
      expectRevision(task.revision, input.expectedRevision)
      if (task.status !== 'failed' && task.status !== 'rejected') fail('invalid_state_transition', 'Only rejected or failed tasks may be retried.')
      if (task.retryCount >= project.budgets.maxTaskRetries) fail('budget_exhausted', 'The task automatic retry budget is exhausted.')
      const assignee = required(await tx.getAgent(input.assigneeAgentId), 'Assignee Agent')
      const member = await tx.getProjectMember(project.projectId, assignee.ownerUserId)
      if (assignee.status !== 'active' || !member?.active || member.role === 'observer') fail('permission_denied', 'The assignee is not authorized for this Project.')
      const updated: StoredTask = { ...task, assigneeAgentId: assignee.agentId, status: 'offered',
        retryCount: task.retryCount + 1, resultSummary: undefined, failureSummary: undefined,
        completedAt: undefined, revision: task.revision + 1, updatedAt: at }
      await tx.updateTask(updated, task.revision)
      const message = await this.appendInbox(tx, { kind: 'agent', id: assignee.agentId }, 'task.offered',
        { protocolVersion: '1.0', type: 'task.offered', projectId: project.projectId,
          taskId: task.taskId, revision: updated.revision }, at)
      return { response: entityResponse('task.updated', updated), resourceKind: 'task', resourceId: task.taskId,
        notifications: [{ recipient: message.recipient, sequence: message.sequence }] }
    }).then(responseEntity<StoredTask>)
  }

  async cancelTask(actor: AgentActor, input: {
    taskId: string
    expectedRevision: number
    idempotencyKey: string
  }): Promise<StoredTask> {
    return this.commit(actor, 'task.cancel', input.idempotencyKey, input, async (tx, at) => {
      const task = required(await tx.getTask(input.taskId), 'Task')
      const project = required(await tx.getProject(task.projectId), 'Project')
      authorize({ actor, operation: 'task_create', coordinatorAgentId: project.coordinatorAgentId })
      expectRevision(task.revision, input.expectedRevision)
      if (['completed', 'cancelled'].includes(task.status)) fail('invalid_state_transition', 'The task is already terminal.')
      const updated: StoredTask = { ...task, status: 'cancelled', completedAt: at,
        revision: task.revision + 1, updatedAt: at }
      await tx.updateTask(updated, task.revision)
      const message = await this.appendInbox(tx, { kind: 'agent', id: task.assigneeAgentId }, 'task.cancelled',
        { protocolVersion: '1.0', type: 'task.cancelled', projectId: project.projectId,
          taskId: task.taskId, revision: updated.revision, reason: 'Cancelled by the active Coordinator.' }, at)
      return { response: entityResponse('task.updated', updated), resourceKind: 'task', resourceId: task.taskId,
        notifications: [{ recipient: message.recipient, sequence: message.sequence }] }
    }).then(responseEntity<StoredTask>)
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
      if (project.coordinationRound >= project.budgets.maxCoordinationRounds) {
        fail('budget_exhausted', 'The Project coordination-round budget is exhausted.')
      }
      const updated: StoredProject = { ...project, coordinationRound: project.coordinationRound + 1,
        revision: project.revision + 1, updatedAt: at }
      await tx.updateProject(updated, project.revision)
      return { response: entityResponse('project.updated', updated), resourceKind: 'project', resourceId: project.projectId }
    }).then(responseEntity<StoredProject>)
  }

  async submitProjectRecord(actor: UserActor | AgentActor, input: {
    projectId: string
    kind: ProjectRecordKind
    summary: string
    sourceTaskId?: string
    sourceRevision?: number
    idempotencyKey: string
  }): Promise<StoredProjectRecord> {
    validateProjectSummary(input.summary)
    return this.commit(actor, 'project_record.submit', input.idempotencyKey, input, async (tx, at) => {
      const project = required(await tx.getProject(input.projectId), 'Project')
      const member = await tx.getProjectMember(project.projectId, actor.userId)
      authorize({ actor, operation: 'record_submit', projectMember: Boolean(member?.active) })
      if (input.sourceTaskId) {
        const task = required(await tx.getTask(input.sourceTaskId), 'Source task')
        if (task.projectId !== project.projectId) fail('validation_failed', 'The source task belongs to another Project.')
        if (input.sourceRevision !== task.revision) fail('revision_conflict', 'The source task revision is stale.')
        if (actor.kind === 'agent_device' && actor.agentId !== task.assigneeAgentId && actor.agentId !== project.coordinatorAgentId) {
          fail('permission_denied', 'An Agent may only cite its assigned Task or a Task it coordinates.')
        }
      } else if (actor.kind === 'agent_device' && actor.agentId !== project.coordinatorAgentId) {
        fail('permission_denied', 'Worker records require explicit Task provenance.')
      }
      if ((input.kind === 'decision' || input.kind === 'summary') &&
          !(actor.kind === 'agent_device' && actor.agentId === project.coordinatorAgentId)) {
        fail('permission_denied', 'Formal decisions and summaries must be accepted, not directly authored by a Worker or member.')
      }
      const record: StoredProjectRecord = {
        projectRecordId: newId('rec'), projectId: project.projectId, kind: input.kind,
        status: 'candidate', summary: input.summary,
        ...(actor.kind === 'agent_device' ? { authorAgentId: actor.agentId, authorUserId: actor.userId } : { authorUserId: actor.userId }),
        ...(input.sourceTaskId ? { sourceTaskId: input.sourceTaskId, sourceRevision: input.sourceRevision } : {}),
        revision: 1, createdAt: at, updatedAt: at
      }
      await tx.insertProjectRecord(record)
      const message = await this.appendInbox(tx, { kind: 'agent', id: project.coordinatorAgentId }, 'project_record.submitted',
        { protocolVersion: '1.0', type: 'project_record.submitted', projectId: project.projectId,
          projectRecordId: record.projectRecordId, revision: record.revision }, at)
      return { response: entityResponse('project_record.created', record), resourceKind: 'project_record',
        resourceId: record.projectRecordId, notifications: [{ recipient: message.recipient, sequence: message.sequence }] }
    }).then(responseEntity<StoredProjectRecord>)
  }

  async acceptProjectRecord(actor: UserActor | AgentActor, input: {
    projectRecordId: string
    decision?: 'accepted' | 'rejected'
    acceptedKind?: 'observation' | 'decision' | 'summary' | 'task_result'
    expectedRevision: number
    idempotencyKey: string
  }): Promise<StoredProjectRecord> {
    return this.commit(actor, 'project_record.accept', input.idempotencyKey, input, async (tx, at) => {
      const record = required(await tx.getProjectRecord(input.projectRecordId), 'Project record')
      const project = required(await tx.getProject(record.projectId), 'Project')
      const member = await tx.getProjectMember(project.projectId, actor.userId)
      authorize({ actor, operation: 'record_accept', projectRole: member?.role, coordinatorAgentId: project.coordinatorAgentId })
      expectRevision(record.revision, input.expectedRevision)
      if (record.status !== 'candidate') fail('invalid_state_transition', 'Only a candidate Project record may be accepted.')
      const decision = input.decision ?? 'accepted'
      const kind = input.acceptedKind ?? (record.kind === 'proposal' && decision === 'accepted' ? 'decision' : record.kind)
      const updated: StoredProjectRecord = { ...record, kind, status: decision,
        ...(decision === 'accepted'
          ? actor.kind === 'agent_device' ? { acceptedByAgentId: actor.agentId } : { acceptedByUserId: actor.userId }
          : {}),
        ...(decision === 'accepted' ? { acceptedAt: at } : {}), revision: record.revision + 1, updatedAt: at }
      await tx.updateProjectRecord(updated, record.revision)
      return { response: entityResponse('project_record.updated', updated), resourceKind: 'project_record',
        resourceId: record.projectRecordId }
    }).then(responseEntity<StoredProjectRecord>)
  }

  async getProject(actor: AuthContext, projectId: string): Promise<{
    project: StoredProject
    members: StoredProjectMember[]
    records: StoredProjectRecord[]
  }> {
    if (actor.kind === 'system') fail('permission_denied', 'System context is not an interactive Project member.')
    const project = required(await this.repository.getProject(projectId), 'Project')
    const member = await this.repository.getProjectMember(projectId, actor.userId)
    authorize({ actor, operation: 'project_read', projectMember: Boolean(member?.active) })
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
    for (const notification of notifications) {
      await this.notifier?.notifyInboxAvailable(notification.recipient, notification.sequence)
    }
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

function completeParticipant(participant: StoredParticipant): StoredParticipant {
  return { ...participant, status: participant.primaryHumanEndpointId && participant.primaryAgentId ? 'complete' : 'incomplete' }
}

function contractTaskStatus(status: TaskStatus):
  'offered' | 'accepted' | 'rejected' | 'running' | 'needs_human' | 'succeeded' | 'failed' | 'cancelled' {
  if (status === 'in_progress') return 'running'
  if (status === 'completed') return 'succeeded'
  return status
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

function normalizeBudgets(input: Partial<ProjectBudgets> | undefined): ProjectBudgets {
  return {
    maxTasks: integer(input?.maxTasks ?? DEFAULT_BUDGETS.maxTasks, 'maxTasks', 1, 10_000),
    maxTasksPerRound: integer(input?.maxTasksPerRound ?? DEFAULT_BUDGETS.maxTasksPerRound, 'maxTasksPerRound', 1, 1_000),
    maxTaskRetries: integer(input?.maxTaskRetries ?? DEFAULT_BUDGETS.maxTaskRetries, 'maxTaskRetries', 0, 100),
    maxCoordinationRounds: integer(input?.maxCoordinationRounds ?? DEFAULT_BUDGETS.maxCoordinationRounds, 'maxCoordinationRounds', 1, 1_000)
  }
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
    projectId: request.projectId, taskId: request.taskId, targetUserId: request.targetUserId,
    requestedByAgentId: request.requestedByAgentId, requiredAssurance: request.requiredAssurance,
    prompt: request.prompt, status: request.status, expiresAt: request.expiresAt,
    revision: request.revision, createdAt: request.createdAt, updatedAt: request.updatedAt }
}

function humanNeededProviderText(request: StoredHumanRequest): string {
  const replyInstruction = `\n\n回复命令：sciforge-answer ${request.humanRequestId} ${request.revision} <answer>`
  return `${request.prompt.slice(0, Math.max(0, 32_000 - replyInstruction.length))}${replyInstruction}`
}

function toHumanAnswerEntity(answer: StoredHumanAnswer): Record<string, unknown> {
  return { schemaVersion: 1, type: 'human_answer', humanAnswerId: answer.humanAnswerId,
    humanRequestId: answer.humanRequestId, projectId: answer.projectId, taskId: answer.taskId,
    requestRevision: answer.requestRevision, answeredByUserId: answer.answeredByUserId,
    answeredFromHumanEndpointId: answer.answeredFromHumanEndpointId, assurance: answer.assurance,
    answer: answer.answer, answeredAt: answer.answeredAt, revision: answer.revision,
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
