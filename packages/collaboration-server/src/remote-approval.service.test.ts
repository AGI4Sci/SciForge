import { describe, expect, it } from 'vitest'

import { FakeCollaborationRepository } from '../../../test-fixtures/collaboration/fake-adapters.mjs'
import type { UserActor } from './actor.js'
import { AuthenticationService } from './auth.js'
import { stableDigest } from './crypto.js'
import { CollaborationService } from './service.js'
import { createAgentCredentialBootstrap, seedOidcUserDevice } from './test-fixtures/collaboration-identity.js'

const at = new Date('2026-08-15T02:00:00.000Z')
const now = () => at

class SerialFakeCollaborationRepository extends FakeCollaborationRepository {
  private tail: Promise<unknown> = Promise.resolve()

  override transaction<T>(work: (repository: this) => Promise<T>): Promise<T> {
    const result = this.tail.then(() => super.transaction(work))
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }
}

async function onboard(
  repository: SerialFakeCollaborationRepository,
  service: CollaborationService,
  authentication: AuthenticationService,
  label: string,
  providerUserId: string
) {
  const identity = await seedOidcUserDevice(repository, label, at)
  const pairing = await service.createEndpointChallenge(identity.user, {
    provider: 'zulip',
    realmId: 'realm-fixture',
    expectedProviderUserId: providerUserId,
    idempotencyKey: `idem_pairing_begin_${label}`
  })
  await service.verifyEndpointChallengeFromProvider({
    provider: 'zulip',
    realmId: 'realm-fixture',
    providerUserId,
    providerDisplayName: `${label} Remote`,
    challengeCode: String(pairing.challengeCode),
    providerEventId: `provider-event-${label}-verify`,
    assurance: 'verified'
  })
  const verified = await service.getEndpointChallenge(identity.user, String(pairing.challengeId))
  const endpoint = await authentication.resolveProviderIdentity(
    'zulip',
    'realm-fixture',
    providerUserId
  )
  return {
    user: identity.user,
    endpoint,
    userId: identity.userId,
    endpointId: String(verified.humanEndpointId)
  }
}

async function registerAgent(
  service: CollaborationService,
  user: UserActor,
  label: string
) {
  const bootstrap = createAgentCredentialBootstrap()
  const registered = await service.registerAgent(user, {
    deviceId: `dev_${user.userId.slice(4)}`,
    displayName: `${label} desktop`,
    nodeType: 'desktop',
    capabilities: ['research.execute'],
    credentialBootstrapPublicKey: bootstrap.publicKey,
    idempotencyKey: `idem_agent_register_${label}`
  })
  if (!registered.sealedCredential) throw new Error('Expected one-time sealed Agent credential')
  return { ...registered, openedCredential: bootstrap.open(registered.sealedCredential) }
}

async function activateManagedContainer(
  repository: FakeCollaborationRepository,
  owner: Awaited<ReturnType<typeof onboard>>,
  containerId: string
) {
  const endpoint = (await repository.getEndpoint(owner.endpointId))!
  await repository.insertManagedContainer({
    managedContainerId: `mco_${stableDigest(`${owner.userId}\u0000${containerId}`).slice(0, 12)}`,
    ownerUserId: owner.userId,
    humanEndpointId: owner.endpointId,
    provider: 'zulip',
    realmId: 'realm-fixture',
    ownerProviderUserId: endpoint.providerUserId,
    stableKey: `managed-${stableDigest(owner.userId)}`,
    displayName: `sciforge-${stableDigest(owner.userId).slice(0, 12)}`,
    externalContainerId: containerId,
    policy: {
      version: 1,
      visibility: 'private',
      history: 'protected',
      membership: 'owner_and_message_bot',
      memberManagement: 'provisioning_service_only',
      channelManagement: 'provisioning_service_only',
      ownerCanSend: true,
      ownerCanCreateTopics: true,
      messageBotCanSend: true,
      messageBotCreatesProjectTopics: false
    },
    status: 'active',
    revision: 1,
    createdAt: at.toISOString(),
    updatedAt: at.toISOString()
  })
}

describe('remote capability approval security boundary', () => {
  it('binds one use to the owner, exact Topic and Desktop request while failing closed and expiring safely', async () => {
    const repository = new SerialFakeCollaborationRepository()
    const reference = `AP1-${'A'.repeat(20)}`
    const service = new CollaborationService({ repository, now, remoteApprovalReference: () => reference })
    const authentication = new AuthenticationService(repository, now)
    const owner = await onboard(repository, service, authentication, 'approval-owner', 'provider-owner')
    const intruder = await onboard(repository, service, authentication, 'approval-intruder', 'provider-intruder')
    const registered = await registerAgent(service, owner.user, 'approvalagent')
    await activateManagedContainer(repository, owner, 'private-channel')
    const device = await authentication.resolveBearer(registered.openedCredential)
    if (device.kind !== 'agent_device') throw new Error('Expected Agent actor')
    const locator = {
      type: 'provider_locator' as const,
      provider: 'zulip',
      realmId: 'realm-fixture',
      containerId: 'private-channel',
      topicId: 'topic-approval',
      topicDisplayName: '审批'
    }
    const projection = await service.createProjection(owner.user, {
      agentId: registered.agent.agentId,
      humanEndpointId: owner.endpointId,
      locator,
      displayName: '固定审批 Session',
      allowedSenderUserIds: [owner.userId],
      idempotencyKey: 'idem_projection_remote_approval'
    })
    await service.createRemoteCapabilityApproval(device, {
      projectionId: projection.projectionId,
      runtimeId: 'codex',
      threadId: 'thread-fixed',
      turnId: 'turn-fixed',
      capabilityRequestId: 'capability-request-fixture',
      desktopApprovalId: 'desktop-approval-fixture',
      safeSummary: '写入工作区中的测试结果',
      effect: 'workspace-write',
      remoteEligible: true,
      expiresAt: new Date(at.getTime() + 300_000).toISOString(),
      idempotencyKey: 'idem_remote_approval_create'
    })

    const cards = await repository.pullInbox(
      { kind: 'human_endpoint', id: owner.endpointId }, 0, 10, at.toISOString()
    )
    expect(cards).toHaveLength(1)
    expect(cards[0]?.payload.text).toContain(reference)
    expect(JSON.stringify(repository.state.auditEvents)).not.toContain(reference)

    await expect(service.decideRemoteCapabilityApproval(intruder.endpoint, {
      approvalReference: reference,
      decision: 'deny_once',
      sourceLocator: locator,
      providerEventId: 'provider-event-intruder'
    })).rejects.toMatchObject({ code: 'permission_denied' })
    await expect(service.decideRemoteCapabilityApproval(owner.endpoint, {
      approvalReference: reference,
      decision: 'allow_once',
      sourceLocator: { ...locator, topicId: 'different-topic' },
      providerEventId: 'provider-event-cross-topic'
    })).rejects.toMatchObject({ code: 'permission_denied' })

    const race = await Promise.allSettled([
      service.decideRemoteCapabilityApproval(owner.endpoint, {
        approvalReference: reference,
        decision: 'allow_once',
        sourceLocator: locator,
        providerEventId: 'provider-event-allow'
      }),
      service.decideRemoteCapabilityApproval(owner.endpoint, {
        approvalReference: reference,
        decision: 'deny_once',
        sourceLocator: locator,
        providerEventId: 'provider-event-deny'
      })
    ])
    expect(race.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(race.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const decisions = await repository.pullInbox(
      { kind: 'agent', id: registered.agent.agentId }, 0, 10, at.toISOString()
    )
    expect(decisions).toHaveLength(1)
    expect(decisions[0]?.payload).toMatchObject({
      type: 'capability.approval.decision',
      runtimeId: 'codex',
      threadId: 'thread-fixed',
      turnId: 'turn-fixed',
      capabilityRequestId: 'capability-request-fixture'
    })

    const closedReference = `AP1-${'B'.repeat(20)}`
    const closedService = new CollaborationService({
      repository,
      now,
      remoteApprovalReference: () => closedReference
    })
    await closedService.createRemoteCapabilityApproval(device, {
      projectionId: projection.projectionId,
      runtimeId: 'codex',
      threadId: 'thread-fixed',
      turnId: 'turn-destructive',
      capabilityRequestId: 'capability-request-destructive',
      desktopApprovalId: 'desktop-approval-destructive',
      safeSummary: '不可远程批准的测试操作',
      effect: 'destructive',
      remoteEligible: false,
      expiresAt: new Date(at.getTime() + 300_000).toISOString(),
      idempotencyKey: 'idem_remote_approval_closed'
    })
    await expect(closedService.decideRemoteCapabilityApproval(owner.endpoint, {
      approvalReference: closedReference,
      decision: 'allow_once',
      sourceLocator: locator,
      providerEventId: 'provider-event-closed'
    })).rejects.toMatchObject({ code: 'permission_denied' })

    const replyExpiredReference = `AP1-${'C'.repeat(20)}`
    const replyExpiredService = new CollaborationService({
      repository,
      now,
      remoteApprovalReference: () => replyExpiredReference
    })
    const replyExpired = await replyExpiredService.createRemoteCapabilityApproval(device, {
      projectionId: projection.projectionId,
      runtimeId: 'codex',
      threadId: 'thread-fixed',
      turnId: 'turn-reply-expired',
      capabilityRequestId: 'capability-request-reply-expired',
      desktopApprovalId: 'desktop-approval-reply-expired',
      safeSummary: '回复时已经过期的测试操作',
      effect: 'workspace-write',
      remoteEligible: true,
      expiresAt: new Date(at.getTime() + 60_000).toISOString(),
      idempotencyKey: 'idem_remote_approval_reply_expired'
    })
    const replyExpiredId = String((replyExpired.approval as Record<string, unknown>).remoteApprovalId)
    await replyExpiredService.confirmRemoteApprovalCard(replyExpiredId, 'provider-message-reply-expired')
    const afterReplyExpiry = new CollaborationService({
      repository,
      now: () => new Date(at.getTime() + 61_000),
      remoteApprovalReference: () => `AP1-${'D'.repeat(20)}`
    })
    const expiredDecision = await afterReplyExpiry.decideRemoteCapabilityApproval(owner.endpoint, {
      approvalReference: replyExpiredReference,
      decision: 'deny_once',
      sourceLocator: locator,
      providerEventId: 'provider-event-reply-expired'
    })
    expect(expiredDecision.entity).toMatchObject({ status: 'expired' })

    const expiringReference = `AP1-${'E'.repeat(20)}`
    const expiringService = new CollaborationService({
      repository,
      now,
      remoteApprovalReference: () => expiringReference
    })
    const expiring = await expiringService.createRemoteCapabilityApproval(device, {
      projectionId: projection.projectionId,
      runtimeId: 'codex',
      threadId: 'thread-fixed',
      turnId: 'turn-expiring',
      capabilityRequestId: 'capability-request-expiring',
      desktopApprovalId: 'desktop-approval-expiring',
      safeSummary: '即将过期的测试操作',
      effect: 'workspace-write',
      remoteEligible: true,
      expiresAt: new Date(at.getTime() + 60_000).toISOString(),
      idempotencyKey: 'idem_remote_approval_expiring'
    })
    const expiringId = String((expiring.approval as Record<string, unknown>).remoteApprovalId)
    await expiringService.confirmRemoteApprovalCard(expiringId, 'provider-message-fixture')
    const later = new CollaborationService({
      repository,
      now: () => new Date(at.getTime() + 61_000),
      remoteApprovalReference: () => `AP1-${'F'.repeat(20)}`
    })
    expect(await later.expireRemoteCapabilityApprovals()).toBe(1)
    expect(repository.state.remoteApprovals.get(expiringId)).toMatchObject({ status: 'expired' })
    const updates = await repository.pullInbox(
      { kind: 'human_endpoint', id: owner.endpointId },
      0,
      30,
      new Date(at.getTime() + 61_000).toISOString()
    )
    expect(updates).toContainEqual(expect.objectContaining({
      messageType: 'provider.message.update.outbound',
      payload: expect.objectContaining({ providerMessageId: 'provider-message-fixture' })
    }))
    expect(updates).toContainEqual(expect.objectContaining({
      messageType: 'provider.message.update.outbound',
      payload: expect.objectContaining({ providerMessageId: 'provider-message-reply-expired' })
    }))
    const fallbackInput = {
      remoteApprovalId: expiringId,
      locator,
      text: '本次权限审批已过期。',
      idempotencyKey: 'idem_remote_fallback_fixture'
    }
    await later.enqueueRemoteApprovalFallback(fallbackInput)
    await later.enqueueRemoteApprovalFallback(fallbackInput)
    const afterFallback = await repository.pullInbox(
      { kind: 'human_endpoint', id: owner.endpointId },
      0,
      50,
      new Date(at.getTime() + 61_000).toISOString()
    )
    expect(afterFallback.filter((message) => (
      message.payload.notificationKind === 'remote_capability_approval_terminal_fallback'
    ))).toHaveLength(1)
  })
})
