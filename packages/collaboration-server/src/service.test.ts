import { describe, expect, it } from 'vitest'

import { FakeCollaborationRepository, FakeInboxNotifier } from '../../../test-fixtures/collaboration/fake-adapters.mjs'
import { AuthenticationService, type HumanEndpointActor, type UserActor } from './auth.js'
import { toInboxMessage } from './contracts.js'
import { CollaborationService, providerIdentityInboxId } from './service.js'

const at = new Date('2026-08-15T02:00:00.000Z')
const now = () => at

async function onboard(
  service: CollaborationService,
  authentication: AuthenticationService,
  label: string,
  providerUserId: string
) {
  const begun = await service.beginPairing({ provider: 'zulip', realmId: 'realm-hk', requestedDisplayName: label,
    idempotencyKey: `idem_pairing_begin_${label}` })
  await service.verifyPairingFromProvider({ provider: 'zulip', realmId: 'realm-hk', providerUserId,
    providerDisplayName: `${label} Remote`, challengeCode: String(begun.challengeCode),
    providerEventId: `provider-event-${label}-verify`, assurance: 'verified' })
  const redeemed = await service.redeemPairing({ pollSecret: String(begun.pollSecret),
    idempotencyKey: `idem_pairing_redeem_${label}` })
  const user = await authentication.resolveBearer(String(redeemed.userCredential))
  if (user.kind !== 'user') throw new Error('Expected user actor')
  const endpoint = await authentication.resolveProviderIdentity('zulip', 'realm-hk', providerUserId)
  return { user, endpoint, userId: String(redeemed.userId), endpointId: String(redeemed.humanEndpointId) }
}

async function registerAgent(service: CollaborationService, user: UserActor, label: string) {
  const result = await service.registerAgent(user, { installationId: `ins_${label.padEnd(12, '0')}`,
    displayName: `${label} desktop`, nodeType: 'desktop', capabilities: ['research.execute'],
    idempotencyKey: `idem_agent_register_${label}` })
  if (!result.deviceCredential) throw new Error('Expected one-time device credential')
  return result
}

describe('CollaborationService canonical transactions', () => {
  it('queues idempotent provider command results without exposing challenge details', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const identity = {
      type: 'provider_identity' as const,
      provider: 'zulip',
      realmId: 'realm-hk',
      providerUserId: 'provider-direct-user'
    }
    const input = { identity, providerEventId: 'provider-event-direct-result-1', result: 'invalid_or_expired' as const }

    await service.enqueueProviderCommandResult(input)
    await service.enqueueProviderCommandResult(input)

    const recipient = {
      kind: 'provider_identity' as const,
      id: providerIdentityInboxId({
        type: 'provider_direct_recipient',
        provider: identity.provider,
        realmId: identity.realmId,
        providerUserId: identity.providerUserId
      })
    }
    const messages = await repository.pullInbox(recipient, 0, 20, at.toISOString())
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      recipient,
      messageType: 'provider.command.result.outbound',
      payload: {
        type: 'provider.command.result.outbound',
        result: 'invalid_or_expired',
        text: '绑定码无效或已失效，请重新生成。',
        recipient: {
          type: 'provider_direct_recipient',
          provider: 'zulip',
          realmId: 'realm-hk',
          providerUserId: 'provider-direct-user'
        }
      }
    })
    expect(JSON.stringify(messages)).not.toContain('challenge')
  })

  it('pairs a provider identity exactly once without persisting plaintext secrets', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const authentication = new AuthenticationService(repository, now)
    const identity = await onboard(service, authentication, 'alice', 'provider-alice')

    expect(identity.userId).toMatch(/^usr_/)
    expect(identity.endpointId).toMatch(/^hep_/)
    const serialized = JSON.stringify(repository.state)
    expect(serialized).not.toContain('pairing_poll.')
    expect(serialized).not.toContain('user.')
    const endpoint = await repository.getEndpoint(identity.endpointId)
    expect(endpoint).toMatchObject({ userId: identity.userId, providerUserId: 'provider-alice', status: 'active' })
    const additional = await service.beginPairing({ provider: 'zulip', realmId: 'realm-hk',
      requestedDisplayName: 'alice', requestedBy: identity.user, expectedProviderUserId: 'provider-alice-secondary',
      idempotencyKey: 'idem_pairing_expected_identity' })
    await expect(service.verifyPairingFromProvider({ provider: 'zulip', realmId: 'realm-hk',
      providerUserId: 'provider-attacker', providerDisplayName: 'Attacker', challengeId: String(additional.challengeId),
      challengeCode: String(additional.challengeCode), providerEventId: 'provider-event-wrong-identity',
      assurance: 'verified' })).rejects.toMatchObject({ code: 'identity_conflict' })
    await expect(service.redeemPairing({ pollSecret: 'pairing_poll.invalid-but-long-enough-to-check',
      idempotencyKey: 'idem_invalid_pairing_poll' })).rejects.toMatchObject({ code: 'authentication_required' })
  })

  it('does not cache a pending pairing redeem and redacts the terminal replay for the same key', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const begun = await service.beginPairing({ provider: 'zulip', realmId: 'realm-hk',
      requestedDisplayName: 'Pending pairing user', idempotencyKey: 'idem_pairing_pending_begin_01' })
    const receiptsAfterBegin = repository.state.receipts.size
    const redeemInput = { pollSecret: String(begun.pollSecret), idempotencyKey: 'idem_pairing_pending_redeem_01' }

    const pending = await service.redeemPairing(redeemInput)
    expect(pending).toMatchObject({ type: 'pairing.pending', challengeId: begun.challengeId })
    expect(repository.state.receipts.size).toBe(receiptsAfterBegin)
    expect(repository.state.auditEvents).toContainEqual(expect.objectContaining({
      action: 'pairing.redeem', outcome: 'accepted' }))

    await service.verifyPairingFromProvider({ provider: 'zulip', realmId: 'realm-hk',
      providerUserId: 'provider-pending-user', providerDisplayName: 'Pending Remote User',
      challengeId: String(begun.challengeId), challengeCode: String(begun.challengeCode),
      providerEventId: 'provider-event-pending-verify', assurance: 'verified' })
    expect(repository.state.challenges.get(String(begun.challengeId))?.consumedAt).toBeUndefined()

    const redeemed = await service.redeemPairing(redeemInput)
    expect(redeemed).toMatchObject({ type: 'pairing.redeemed' })
    expect(typeof redeemed.userCredential).toBe('string')
    expect(repository.state.challenges.get(String(begun.challengeId))?.consumedAt).toBe(at.toISOString())
    const credentialCount = repository.state.credentials.size
    const terminalReceiptCount = repository.state.receipts.size

    const replayed = await service.redeemPairing(redeemInput)
    expect(replayed).toMatchObject({ type: 'pairing.redeemed', replayed: true })
    expect(replayed).not.toHaveProperty('userCredential')
    expect(repository.state.credentials.size).toBe(credentialCount)
    expect(repository.state.receipts.size).toBe(terminalReceiptCount)
  })

  it('isolates Agent registration idempotency from every stable intent field', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const authentication = new AuthenticationService(repository, now)
    const alice = await onboard(service, authentication, 'agent-idem-alice', 'provider-agent-idem-alice')
    const bob = await onboard(service, authentication, 'agent-idem-bob', 'provider-agent-idem-bob')
    const installationId = 'ins_agentidem0000001'
    const baseline = {
      installationId,
      displayName: 'Desktop',
      nodeType: 'desktop',
      capabilities: ['agent.execute', 'workspace.read'],
      idempotencyKey: 'idem_agent_register_matrix_baseline'
    }

    const registered = await service.registerAgent(alice.user, baseline)
    expect(registered.deviceCredential).toBeTypeOf('string')

    const replayed = await service.registerAgent(alice.user, baseline)
    expect(replayed).toMatchObject({ agent: { agentId: registered.agent.agentId }, replayed: true })
    expect(replayed).not.toHaveProperty('deviceCredential')
    expect(repository.state.agents.size).toBe(1)

    await expect(service.registerAgent(alice.user, {
      ...baseline,
      displayName: 'Different body with reused key'
    })).rejects.toMatchObject({ code: 'idempotency_conflict' })

    const changedIntents = [
      { ...baseline, displayName: 'Desktop Two', idempotencyKey: 'idem_agent_register_matrix_display' },
      { ...baseline, nodeType: 'server', idempotencyKey: 'idem_agent_register_matrix_node' },
      { ...baseline, capabilities: ['agent.execute'], idempotencyKey: 'idem_agent_register_matrix_capability' }
    ]
    for (const intent of changedIntents) {
      const result = await service.registerAgent(alice.user, intent)
      expect(result).toMatchObject({ agent: { agentId: registered.agent.agentId }, replayed: true })
      expect(result).not.toHaveProperty('deviceCredential')
    }
    expect(repository.state.agents.size).toBe(1)

    await expect(service.registerAgent(bob.user, {
      ...baseline,
      idempotencyKey: 'idem_agent_register_matrix_owner'
    })).rejects.toMatchObject({ code: 'identity_conflict' })
    expect(repository.state.agents.size).toBe(1)
  })

  it('keeps Project task writes star-shaped, idempotent, ordered, and restart-recoverable', async () => {
    const repository = new FakeCollaborationRepository()
    const notifier = new FakeInboxNotifier()
    const service = new CollaborationService({ repository, notifier, now })
    const authentication = new AuthenticationService(repository, now)
    const alice = await onboard(service, authentication, 'alice', 'provider-alice')
    const bob = await onboard(service, authentication, 'bob', 'provider-bob')
    const aliceAgent = await registerAgent(service, alice.user, 'aliceagent01')
    const bobAgent = await registerAgent(service, bob.user, 'bobagent0001')
    const aliceDevice = await authentication.resolveBearer(aliceAgent.deviceCredential!)
    const bobDevice = await authentication.resolveBearer(bobAgent.deviceCredential!)
    if (aliceDevice.kind !== 'agent_device' || bobDevice.kind !== 'agent_device') throw new Error('Expected Agent actors')

    const project = await service.createProject(alice.user, { displayName: '共同研究', goal: '验证协作内核',
      memberUserIds: [alice.userId, bob.userId], coordinatorAgentId: aliceAgent.agent.agentId,
      budgets: { maxTasks: 4, maxTasksPerRound: 2, maxTaskRetries: 1, maxCoordinationRounds: 2 },
      idempotencyKey: 'idem_project_create_shared' })
    const task = await service.createTask(aliceDevice, { projectId: project.projectId,
      assigneeAgentId: bobAgent.agent.agentId, title: '分析数据', objective: '返回有界结果摘要',
      completionCriteria: ['结果可复核'], dependencyTaskIds: [], expectedProjectRevision: project.revision,
      idempotencyKey: 'idem_task_create_bob_01' })
    const repeated = await service.createTask(aliceDevice, { projectId: project.projectId,
      assigneeAgentId: bobAgent.agent.agentId, title: '分析数据', objective: '返回有界结果摘要',
      completionCriteria: ['结果可复核'], dependencyTaskIds: [], expectedProjectRevision: project.revision,
      idempotencyKey: 'idem_task_create_bob_01' })
    expect(repeated.taskId).toBe(task.taskId)
    expect((await repository.pullInbox({ kind: 'agent', id: bobAgent.agent.agentId }, 0, 20, at.toISOString())))
      .toHaveLength(1)
    await expect(service.transitionTask(aliceDevice, { taskId: task.taskId, status: 'accepted',
      expectedRevision: 1, idempotencyKey: 'idem_wrong_agent_accept' })).rejects.toMatchObject({ code: 'permission_denied' })

    const restarted = new CollaborationService({ repository, notifier, now })
    const accepted = await restarted.transitionTask(bobDevice, { taskId: task.taskId, status: 'accepted',
      expectedRevision: 1, idempotencyKey: 'idem_bob_accept_task_01' })
    const running = await restarted.transitionTask(bobDevice, { taskId: task.taskId, status: 'in_progress',
      expectedRevision: accepted.revision, idempotencyKey: 'idem_bob_run_task_01' })
    const completed = await restarted.transitionTask(bobDevice, { taskId: task.taskId, status: 'completed',
      expectedRevision: running.revision, resultSummary: '分析完成，结果可复核。',
      idempotencyKey: 'idem_bob_complete_task_01' })
    expect(completed.status).toBe('completed')
    const coordinatorInbox = await restarted.pullInbox(aliceDevice, { afterSequence: 0, limit: 20 })
    expect(() => coordinatorInbox.messages.map(toInboxMessage)).not.toThrow()
    expect(coordinatorInbox.messages.map((message) => message.sequence)).toEqual(
      coordinatorInbox.messages.map((_, index) => index + 1)
    )
  })

  it('routes a shared personal topic to its fixed Agent once and targets HumanNeeded answers', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const authentication = new AuthenticationService(repository, now)
    const alice = await onboard(service, authentication, 'alice', 'provider-alice')
    const bob = await onboard(service, authentication, 'bob', 'provider-bob')
    const aliceAgent = await registerAgent(service, alice.user, 'aliceagent02')
    const bobAgent = await registerAgent(service, bob.user, 'bobagent0002')
    const aliceDevice = await authentication.resolveBearer(aliceAgent.deviceCredential!)
    const bobDevice = await authentication.resolveBearer(bobAgent.deviceCredential!)
    if (aliceDevice.kind !== 'agent_device' || bobDevice.kind !== 'agent_device') throw new Error('Expected Agent actors')
    const locator = { type: 'provider_locator' as const, provider: 'zulip', realmId: 'realm-hk',
      containerId: 'stream-research', topicId: 'topic-fixed', topicDisplayName: '固定会话' }
    const projection = await service.createProjection(alice.user, { agentId: aliceAgent.agent.agentId,
      humanEndpointId: alice.endpointId, locator, displayName: '固定会话', allowedSenderUserIds: [alice.userId, bob.userId],
      idempotencyKey: 'idem_projection_create_alice' })
    const first = await service.acceptPersonalProviderMessage(bob.endpoint, { locator,
      providerMessageId: 'zulip-message-100', providerEventId: 'zulip-event-100', text: '请继续分析',
      occurredAt: at.toISOString() })
    const duplicate = await service.acceptPersonalProviderMessage(bob.endpoint, { locator,
      providerMessageId: 'zulip-message-100', providerEventId: 'zulip-event-100', text: '请继续分析',
      occurredAt: at.toISOString() })
    expect(duplicate).toEqual(first)
    expect(await repository.pullInbox({ kind: 'agent', id: aliceAgent.agent.agentId }, 0, 20, at.toISOString())).toHaveLength(1)
    expect(await repository.pullInbox({ kind: 'agent', id: bobAgent.agent.agentId }, 0, 20, at.toISOString())).toHaveLength(0)
    expect(projection.agentId).toBe(aliceAgent.agent.agentId)
    const movedLocator = { ...locator, containerId: 'stream-research-renamed',
      containerDisplayName: '研究（新）', topicDisplayName: '固定会话（新）' }
    const moved = await service.applyProviderLocatorChange({ previousLocator: locator, currentLocator: movedLocator,
      providerEventId: 'zulip-event-locator-moved-100' })
    expect(moved).toEqual({ kind: 'personal_projection', resourceId: projection.projectionId })
    const updatedProjection = await service.getProjection(alice.user, projection.projectionId)
    expect(updatedProjection).toMatchObject({ projectionId: projection.projectionId,
      agentId: aliceAgent.agent.agentId, displayName: '固定会话', locator: movedLocator,
      locatorRevision: 2, revision: 2 })
    const replayedMove = await service.applyProviderLocatorChange({ previousLocator: locator,
      currentLocator: movedLocator, providerEventId: 'zulip-event-locator-moved-replay-100' })
    expect(replayedMove).toEqual({ kind: 'personal_projection', resourceId: projection.projectionId })
    expect(await service.getProjection(alice.user, projection.projectionId)).toMatchObject({
      projectionId: projection.projectionId, locatorRevision: 2, revision: 2 })
    await service.acceptPersonalProviderMessage(bob.endpoint, { locator: movedLocator,
      providerMessageId: 'zulip-message-101', providerEventId: 'zulip-event-101', text: '在新 Topic 继续',
      occurredAt: at.toISOString() })
    const movedSessionInbox = await repository.pullInbox(
      { kind: 'agent', id: aliceAgent.agent.agentId }, 0, 20, at.toISOString())
    expect(movedSessionInbox.map((message) => message.messageType)).toEqual([
      'personal.message.received', 'projection.updated', 'personal.message.received'
    ])
    expect(movedSessionInbox[1]?.payload).toMatchObject({
      type: 'projection.updated', projectionId: projection.projectionId, revision: 2 })
    expect(movedSessionInbox[2]?.payload).toMatchObject({
      type: 'personal.message.received', projectionId: projection.projectionId, projectionRevision: 2 })
    await expect(service.acceptPersonalProviderMessage(bob.endpoint, { locator,
      providerMessageId: 'zulip-message-102', providerEventId: 'zulip-event-102', text: '旧 Topic 不应路由',
      occurredAt: at.toISOString() })).rejects.toMatchObject({ code: 'not_found' })

    const project = await service.createProject(alice.user, { displayName: 'Human loop', goal: '定向提问',
      memberUserIds: [alice.userId, bob.userId], coordinatorAgentId: aliceAgent.agent.agentId,
      idempotencyKey: 'idem_project_human_loop' })
    const projectLocator = { ...locator, topicId: 'topic-project', topicDisplayName: '项目协作' }
    const projectBinding = await service.bindProjectEndpoint(alice.user, { projectId: project.projectId,
      locator: projectLocator, expectedRevision: null, idempotencyKey: 'idem_project_endpoint_bind' })
    const movedProjectLocator = { ...projectLocator, containerId: 'stream-project-renamed',
      containerDisplayName: '项目（新）', topicDisplayName: '项目协作（新）' }
    const movedProject = await service.applyProviderLocatorChange({ previousLocator: projectLocator,
      currentLocator: movedProjectLocator, providerEventId: 'zulip-event-project-locator-moved-100' })
    expect(movedProject).toEqual({ kind: 'project', resourceId: project.projectId })
    expect(await service.getProjectEndpointBinding(alice.user, project.projectId)).toMatchObject({
      projectEndpointBindingId: projectBinding.projectEndpointBindingId, projectId: project.projectId,
      locator: movedProjectLocator, locatorRevision: 2, revision: 2 })
    const replayedProjectMove = await service.applyProviderLocatorChange({ previousLocator: projectLocator,
      currentLocator: movedProjectLocator, providerEventId: 'zulip-event-project-locator-moved-replay-100' })
    expect(replayedProjectMove).toEqual({ kind: 'project', resourceId: project.projectId })
    expect(await service.getProjectEndpointBinding(alice.user, project.projectId)).toMatchObject({
      projectEndpointBindingId: projectBinding.projectEndpointBindingId, locatorRevision: 2, revision: 2 })
    const projectInput = await service.acceptProjectInput(bob.endpoint, { locator: movedProjectLocator,
      providerMessageId: 'zulip-project-message-101', providerEventId: 'zulip-project-event-101',
      text: '在新项目 Topic 继续', occurredAt: at.toISOString() })
    expect(projectInput).toMatchObject({ projectId: project.projectId, senderUserId: bob.userId })
    const movedProjectInbox = await repository.pullInbox(
      { kind: 'agent', id: aliceAgent.agent.agentId }, 0, 50, at.toISOString())
    const endpointUpdateIndex = movedProjectInbox.findIndex((message) =>
      message.messageType === 'project.endpoint.updated' && message.payload.projectId === project.projectId)
    const projectInputIndex = movedProjectInbox.findIndex((message) =>
      message.messageType === 'project.input.received' && message.payload.projectInputId === projectInput.projectInputId)
    expect(endpointUpdateIndex).toBeGreaterThanOrEqual(0)
    expect(projectInputIndex).toBeGreaterThan(endpointUpdateIndex)
    await expect(service.acceptProjectInput(bob.endpoint, { locator: projectLocator,
      providerMessageId: 'zulip-project-message-102', providerEventId: 'zulip-project-event-102',
      text: '旧项目 Topic 不应路由', occurredAt: at.toISOString() }))
      .rejects.toMatchObject({ code: 'not_found' })
    const task = await service.createTask(aliceDevice, { projectId: project.projectId,
      assigneeAgentId: bobAgent.agent.agentId, title: '需确认', objective: '等待 Bob 决策',
      completionCriteria: ['收到回答'], dependencyTaskIds: [], expectedProjectRevision: project.revision,
      idempotencyKey: 'idem_task_human_loop' })
    const accepted = await service.transitionTask(bobDevice, { taskId: task.taskId, status: 'accepted', expectedRevision: 1,
      idempotencyKey: 'idem_task_human_accept' })
    const running = await service.transitionTask(bobDevice, { taskId: task.taskId, status: 'in_progress',
      expectedRevision: accepted.revision, idempotencyKey: 'idem_task_human_running' })
    const request = await service.createHumanNeeded(bobDevice, { projectId: project.projectId, taskId: task.taskId,
      expectedTaskRevision: running.revision, targetUserId: bob.userId, requiredAssurance: 'verified',
      prompt: '是否继续？', expiresAt: '2026-08-15T03:00:00.000Z', idempotencyKey: 'idem_human_needed_bob' })
    const providerNotifications = await repository.pullInbox(
      { kind: 'human_endpoint', id: bob.endpointId }, 0, 20, at.toISOString())
    expect(providerNotifications).toContainEqual(expect.objectContaining({
      messageType: 'provider.notification.outbound',
      payload: expect.objectContaining({
        resourceId: request.humanRequestId,
        text: `是否继续？\n\n回复命令：sciforge-answer ${request.humanRequestId} ${request.revision} <answer>`
      })
    }))
    await expect(service.answerHumanNeeded(alice.endpoint as HumanEndpointActor, { humanRequestId: request.humanRequestId,
      requestRevision: request.revision, answer: '代答', idempotencyKey: 'idem_human_wrong_user' }))
      .rejects.toMatchObject({ code: 'permission_denied' })
    const otherProject = await service.createProject(alice.user, { displayName: 'Other project', goal: '错误 Topic 验证',
      memberUserIds: [alice.userId, bob.userId], coordinatorAgentId: aliceAgent.agent.agentId,
      idempotencyKey: 'idem_project_other_human_loop' })
    const otherProjectLocator = { ...locator, topicId: 'topic-other-project', topicDisplayName: '其他项目' }
    await service.bindProjectEndpoint(alice.user, { projectId: otherProject.projectId,
      locator: otherProjectLocator, expectedRevision: null, idempotencyKey: 'idem_project_other_endpoint_bind' })
    await expect(service.answerHumanNeeded(bob.endpoint, { humanRequestId: request.humanRequestId,
      requestRevision: request.revision, answer: '从错误项目回答', sourceLocator: otherProjectLocator,
      idempotencyKey: 'idem_human_wrong_project_locator' })).rejects.toMatchObject({ code: 'not_found' })
    const answer = await service.answerHumanNeeded(bob.endpoint, { humanRequestId: request.humanRequestId,
      requestRevision: request.revision, answer: '继续', sourceLocator: movedProjectLocator,
      idempotencyKey: 'idem_human_answer_bob' })
    expect(answer).toMatchObject({ answeredByUserId: bob.userId, answeredFromHumanEndpointId: bob.endpointId })
    const repeatedAnswer = await service.answerHumanNeeded(bob.endpoint, { humanRequestId: request.humanRequestId,
      requestRevision: request.revision, answer: '继续', sourceLocator: movedProjectLocator,
      idempotencyKey: 'idem_human_answer_bob' })
    expect(repeatedAnswer.humanAnswerId).toBe(answer.humanAnswerId)
    const expiringRequest = await service.createHumanNeeded(bobDevice, { projectId: project.projectId, taskId: task.taskId,
      expectedTaskRevision: running.revision + 1, targetUserId: bob.userId, requiredAssurance: 'verified',
      prompt: '过期后不可回答', expiresAt: '2026-08-15T03:30:00.000Z',
      idempotencyKey: 'idem_human_needed_expiring_bob' })
    const laterService = new CollaborationService({ repository, now: () => new Date('2026-08-15T04:00:00.000Z') })
    await expect(laterService.answerHumanNeeded(bob.endpoint, { humanRequestId: expiringRequest.humanRequestId,
      requestRevision: expiringRequest.revision, answer: '迟到回答', sourceLocator: movedProjectLocator,
      idempotencyKey: 'idem_human_expired_answer_bob' })).rejects.toMatchObject({ code: 'request_expired' })
    const bobInbox = await service.pullInbox(bob.user, { afterSequence: 0, limit: 20 })
    expect(() => bobInbox.messages.map(toInboxMessage)).not.toThrow()
    const aliceAgentInbox = await service.pullInbox(aliceDevice, { afterSequence: 0, limit: 50 })
    expect(() => aliceAgentInbox.messages.map(toInboxMessage)).not.toThrow()
  })
})
