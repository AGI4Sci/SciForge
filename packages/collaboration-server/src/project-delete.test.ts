import { describe, expect, it } from 'vitest'

import {
  FakeCollaborationRepository,
  FakeInboxNotifier
} from '../../../test-fixtures/collaboration/fake-adapters.mjs'
import type { AgentActor } from './actor.js'
import { CollaborationService } from './service.js'
import {
  createAgentCredentialBootstrap,
  seedOidcUserDevice
} from './test-fixtures/collaboration-identity.js'

const at = new Date('2026-08-30T08:00:00.000Z')
const now = () => at

async function registerAgent(
  service: CollaborationService,
  identity: Awaited<ReturnType<typeof seedOidcUserDevice>>,
  label: string
): Promise<AgentActor> {
  const created = await service.ensureAgent(identity.user, {
    deviceId: identity.deviceId,
    capabilities: ['project.coordinate', 'research.execute'],
    credentialBootstrapPublicKey: createAgentCredentialBootstrap().publicKey,
    idempotencyKey: `idem_delete_agent_${label}`
  })
  return {
    kind: 'agent_device',
    actorKey: `agent:${created.agent.agentId}:delete-test`,
    userId: identity.userId,
    agentId: created.agent.agentId,
    deviceId: identity.deviceId,
    credentialId: `credential_delete_${label}`,
    credentialGeneration: created.agent.credentialGeneration,
    assurance: 'device'
  }
}

async function projectDeletionFixture(label: string) {
  const repository = new FakeCollaborationRepository()
  const notifier = new FakeInboxNotifier()
  const service = new CollaborationService({ repository, notifier, now })
  const owner = await seedOidcUserDevice(repository, `${label}-owner`, at)
  const worker = await seedOidcUserDevice(repository, `${label}-worker`, at)
  const coordinator = await registerAgent(service, owner, `${label}_coordinator`)
  const workerAgent = await registerAgent(service, worker, `${label}_worker`)
  const created = await service.createProject(coordinator, {
    protocolVersion: '1.0',
    type: 'project.create',
    requestId: `req_DeleteProject${label.padEnd(8, '0')}`,
    idempotencyKey: `idem_delete_project_create_${label}`,
    createIntentId: `pct_DeleteProject${label.padEnd(6, '0')}`,
    displayName: `${label} Project`,
    goal: 'Verify canonical cloud Project deletion.',
    budget: { maxTasks: 5, maxTasksPerRound: 5, maxTaskRetries: 1, maxCoordinationRounds: 2 }
  })
  await repository.insertProjectMember({
    projectMembershipId: `pmb_DeleteWorker${label.padEnd(4, '0')}`,
    projectId: created.project.projectId,
    userId: worker.userId,
    state: 'active',
    authorityEpoch: 1,
    activatedAt: at.toISOString(),
    removalRequestedAt: null,
    removalRequestedByUserId: null,
    removedAt: null,
    revision: 1,
    createdAt: at.toISOString(),
    updatedAt: at.toISOString()
  })
  const command = {
    protocolVersion: '1.0' as const,
    type: 'project.delete' as const,
    requestId: `req_DeleteCommand${label.padEnd(8, '0')}`,
    idempotencyKey: `idem_delete_project_command_${label}`,
    projectId: created.project.projectId,
    expectedRevision: created.project.revision,
    expectedCoordinatorAuthorityEpoch: created.project.coordinatorAuthorityEpoch,
    expectedExecutionAuthorityEpoch: created.project.executionAuthorityEpoch
  }
  return { repository, notifier, service, owner, worker, coordinator, workerAgent, created, command }
}

describe('Project deletion', () => {
  it('lets only the Owner delete and notifies every active member Agent exactly once', async () => {
    const fixture = await projectDeletionFixture('owner')
    const workerAgent = (await fixture.repository.getAgent(fixture.workerAgent.agentId))!
    const inactiveAgentId = 'agt_DeleteInactive01'
    await fixture.repository.insertAgent({
      ...workerAgent,
      agentId: inactiveAgentId,
      status: 'revoked',
      connectionStatus: 'offline',
      revision: 2
    })
    const notificationsBeforeDelete = fixture.notifier.notifications.length

    await expect(fixture.service.deleteProject(fixture.worker.user, fixture.command))
      .rejects.toMatchObject({ code: 'permission_denied' })
    await expect(fixture.repository.getProject(fixture.created.project.projectId))
      .resolves.toMatchObject({ projectId: fixture.created.project.projectId })

    await expect(fixture.service.deleteProject(fixture.owner.user, fixture.command)).resolves.toBeUndefined()
    await expect(fixture.repository.getProject(fixture.created.project.projectId)).resolves.toBeNull()
    await expect(fixture.repository.listProjectsForUser(fixture.owner.userId, null, 10)).resolves.toEqual([])
    await expect(fixture.repository.listProjectsForUser(fixture.worker.userId, null, 10)).resolves.toEqual([])
    expect([...fixture.repository.state.taskAuthorities.values()].filter(({ projectId }) => (
      projectId === fixture.created.project.projectId
    ))).toEqual([])
    await expect(fixture.repository.getAgent(fixture.coordinator.agentId)).resolves.not.toBeNull()
    await expect(fixture.repository.getAgent(fixture.workerAgent.agentId)).resolves.not.toBeNull()
    await expect(fixture.repository.pullInbox(
      { kind: 'agent', id: inactiveAgentId },
      0,
      100,
      at.toISOString()
    )).resolves.toEqual([])

    const recipients = [fixture.coordinator.agentId, fixture.workerAgent.agentId]
    for (const agentId of recipients) {
      const messages = await fixture.repository.pullInbox(
        { kind: 'agent', id: agentId },
        0,
        100,
        at.toISOString()
      )
      expect(messages.filter(({ messageType }) => messageType === 'project.deleted')).toEqual([
        expect.objectContaining({
          payload: {
            protocolVersion: '1.0',
            type: 'project.deleted',
            projectId: fixture.created.project.projectId,
            deletedAt: at.toISOString()
          }
        })
      ])
    }
    expect(fixture.notifier.notifications.slice(notificationsBeforeDelete).filter(({ recipient }) => (
      recipient.kind === 'agent' && recipients.includes(recipient.id)
    ))).toHaveLength(2)

    await expect(fixture.service.deleteProject(fixture.owner.user, fixture.command)).resolves.toBeUndefined()
    expect(fixture.notifier.notifications.slice(notificationsBeforeDelete).filter(({ recipient }) => (
      recipient.kind === 'agent' && recipients.includes(recipient.id)
    ))).toHaveLength(2)
  })

  it.each([
    ['revision', 'expectedRevision'],
    ['coordinator', 'expectedCoordinatorAuthorityEpoch'],
    ['execution', 'expectedExecutionAuthorityEpoch']
  ] as const)('rejects a stale %s CAS without deleting or notifying', async (label, field) => {
    const fixture = await projectDeletionFixture(label)
    const notificationsBefore = fixture.notifier.notifications.length

    await expect(fixture.service.deleteProject(fixture.owner.user, {
      ...fixture.command,
      [field]: fixture.command[field] + 1
    })).rejects.toMatchObject({ code: 'revision_conflict' })

    await expect(fixture.repository.getProject(fixture.created.project.projectId))
      .resolves.toMatchObject({ projectId: fixture.created.project.projectId })
    expect(fixture.notifier.notifications).toHaveLength(notificationsBefore)
  })

  it.each(['dispatched', 'outcome_unknown'] as const)(
    'refuses to erase evidence while an external operation is %s',
    async (state) => {
      const fixture = await projectDeletionFixture(state)
      const notificationsBefore = fixture.notifier.notifications.length
      fixture.repository.state.externalOperationJournal.set('delete-test-journal', {
        projectId: fixture.created.project.projectId,
        state
      })

      await expect(fixture.service.deleteProject(fixture.owner.user, fixture.command))
        .rejects.toMatchObject({ code: 'invalid_state_transition' })

      await expect(fixture.repository.getProject(fixture.created.project.projectId))
        .resolves.toMatchObject({ projectId: fixture.created.project.projectId })
      expect(fixture.notifier.notifications).toHaveLength(notificationsBefore)
    }
  )
})
