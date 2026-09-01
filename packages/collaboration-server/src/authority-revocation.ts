import { fail } from './errors.js'
import type {
  InboxRecipient,
  StoredAgent,
  StoredInboxMessage,
  StoredTaskExecution
} from './model.js'
import type { CollaborationTransaction } from './repository.js'

export type AuthorityRevocationReason = 'agent_revoked' | 'device_revoked'

type AppendAuthorityInbox = (
  recipient: InboxRecipient,
  messageType: string,
  payload: Record<string, unknown>,
  at: string
) => Promise<StoredInboxMessage>

export type AuthorityNotification = Readonly<{
  recipient: InboxRecipient
  sequence: number
}>

/**
 * Canonical Agent authority revocation used by both Agent and owning Device
 * commands. Every database mutation and durable Inbox fact stays inside the
 * caller's existing transaction.
 */
export async function revokeAgentAuthorityInTransaction(input: Readonly<{
  tx: CollaborationTransaction
  agent: StoredAgent
  reason: AuthorityRevocationReason
  at: string
  appendInbox: AppendAuthorityInbox
  revokeCredentials?: boolean
}>): Promise<Readonly<{
  agent: StoredAgent
  notifications: AuthorityNotification[]
}>> {
  const { tx, agent, reason, at, appendInbox } = input
  const updated: StoredAgent = {
    ...agent,
    status: 'revoked',
    connectionStatus: 'offline',
    revokedAt: at,
    revision: agent.revision + 1,
    updatedAt: at
  }
  await tx.updateAgent(updated, agent.revision)
  if (input.revokeCredentials !== false) await tx.revokeAgentCredentials(agent.agentId, at)

  const availability = await tx.getWorkerAvailabilityForUpdate(agent.agentId)
  if (availability) {
    await tx.upsertWorkerAvailability({
      ...availability,
      agentActive: false,
      deviceActive: reason === 'device_revoked' ? false : availability.deviceActive,
      connectionStatus: 'offline',
      runtimeReadiness: 'unavailable',
      acceptsNewOffers: false,
      revision: availability.revision + 1,
      updatedAt: at
    }, availability.revision)
  }

  const notifications: AuthorityNotification[] = []
  const ownerMessage = await appendInbox(
    { kind: 'user', id: agent.ownerUserId },
    'collaboration.important_failure',
    {
      protocolVersion: '1.0',
      type: 'collaboration.important_failure',
      safeMessage: 'A collaboration Agent was revoked and its pending work requires review.'
    },
    at
  )
  notifications.push({ recipient: ownerMessage.recipient, sequence: ownerMessage.sequence })

  for (const execution of await tx.listCurrentTaskExecutionsForAgentForUpdate(agent.agentId)) {
    const task = required(await tx.getTaskForUpdate(execution.taskId), 'Assigned Task')
    const project = required(await tx.getProjectForUpdate(task.projectId), 'Project')
    if (task.currentExecutionId !== execution.executionId || execution.fence.status === 'fenced') continue
    const fenced = fenceTaskExecution(execution, 'revoked', reason, at)
    const updatedTask = {
      ...task,
      status: 'revision_requested' as const,
      currentExecutionState: 'revoked' as const,
      revision: task.revision + 1,
      updatedAt: at
    }
    await tx.updateTaskExecution(fenced, execution.revision)
    await tx.updateTask(updatedTask, task.revision)
    if (execution.fileIntent !== null) {
      await tx.invalidateCloudResourceRefs(task.taskId, execution.executionId, at)
    }
    const message = await appendInbox(
      { kind: 'agent', id: project.coordinatorAgentId },
      'task.updated',
      {
        protocolVersion: '1.0',
        type: 'task.updated',
        projectId: project.projectId,
        taskId: task.taskId,
        executionId: execution.executionId,
        revision: updatedTask.revision,
        status: 'revision_requested',
        safeFailureCode: reason
      },
      at
    )
    notifications.push({ recipient: message.recipient, sequence: message.sequence })
  }

  for (const listedProject of await tx.listActiveProjectsForCoordinator(agent.agentId)) {
    const project = required(await tx.getProjectForUpdate(listedProject.projectId), 'Coordinated Project')
    if (project.status === 'completed' || project.status === 'cancelled') continue
    for (const execution of await tx.listCurrentTaskExecutionsForProjectForUpdate(project.projectId)) {
      if (execution.fence.status === 'fenced') continue
      const task = required(await tx.getTaskForUpdate(execution.taskId), 'Project Task')
      if (task.currentExecutionId !== execution.executionId) continue
      await tx.updateTaskExecution(
        fenceTaskExecution(execution, 'cancelled', 'project_paused', at),
        execution.revision
      )
      await tx.updateTask({
        ...task,
        status: 'revision_requested',
        currentExecutionState: 'cancelled',
        revision: task.revision + 1,
        updatedAt: at
      }, task.revision)
    }
    for (const member of await tx.listProjectMembers(project.projectId)) {
      for (const scope of ['text_tasks', 'file_tasks'] as const) {
        const authority = await tx.getTaskAuthorityForUpdate(project.projectId, member.userId, scope)
        if (!authority) continue
        await tx.upsertTaskAuthority({
          ...authority,
          state: 'suspended',
          reason: 'project_paused',
          authorityEpoch: authority.authorityEpoch + 1,
          effectiveAt: at,
          revision: authority.revision + 1,
          updatedAt: at
        }, authority.revision)
      }
    }
    const paused = {
      ...project,
      status: 'paused' as const,
      executionAuthorityEpoch: project.executionAuthorityEpoch + 1,
      revision: project.revision + 1,
      updatedAt: at
    }
    await tx.updateProject(paused, project.revision)
    const message = await appendInbox(
      { kind: 'user', id: project.ownerUserId },
      'collaboration.important_failure',
      {
        protocolVersion: '1.0',
        type: 'collaboration.important_failure',
        projectId: project.projectId,
        safeMessage: 'The Coordinator Agent was revoked; the Project was paused and requires explicit transfer.'
      },
      at
    )
    notifications.push({ recipient: message.recipient, sequence: message.sequence })
  }

  const participant = await tx.getParticipant(agent.ownerUserId)
  if (participant?.primaryAgentId === agent.agentId) {
    const changed = {
      ...participant,
      primaryAgentId: undefined,
      status: 'incomplete' as const,
      revision: participant.revision + 1,
      updatedAt: at
    }
    await tx.upsertParticipant(changed, participant.revision)
  }
  return { agent: updated, notifications }
}

export function fenceTaskExecution(
  execution: StoredTaskExecution,
  state: StoredTaskExecution['state'],
  reason: NonNullable<StoredTaskExecution['fence']['reason']>,
  at: string
): StoredTaskExecution {
  return {
    ...execution,
    state,
    stateRevision: execution.stateRevision + 1,
    fence: { ...execution.fence, status: 'fenced', reason, fencedAt: at },
    terminalAt: at,
    revision: execution.revision + 1,
    updatedAt: at
  }
}

function required<T>(value: T | null, label: string): T {
  if (value === null) fail('not_found', `${label} was not found.`)
  return value
}
