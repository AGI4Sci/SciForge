import { createHash } from 'node:crypto'
import {
  restRequestSchema,
  type AgentInboxMessage,
  type Task,
  type TaskOfferedPayload
} from '@sciforge/collaboration-contracts'
import type { DomainMainAgentExecutionHost } from '@sciforge/domain-sdk/main'
import { collaborationRequestId } from './cloud-client.js'
import type { CollaborationConnection } from './connection.js'
import { DurableCloudOutbox } from './outbox.js'
import { CollaborationLocalStore, type CollaborationTaskRun } from './store.js'

export type CollaborationTaskAdapterOptions = Readonly<{
  store: CollaborationLocalStore
  connection: CollaborationConnection
  outbox: DurableCloudOutbox
  agentExecution: DomainMainAgentExecutionHost
  localAgentId: () => string | undefined
  sanitizeText?: (value: string) => string
  now?: () => Date
}>

export class CollaborationTaskAdapter {
  private readonly now: () => Date
  private readonly running = new Map<string, Promise<void>>()
  private stopped = false

  constructor(private readonly options: CollaborationTaskAdapterOptions) {
    this.now = options.now ?? (() => new Date())
  }

  async recover(): Promise<void> {
    this.stopped = false
    for (const run of this.options.store.snapshot().taskRuns) {
      if (['offered', 'accepting', 'running', 'reconciling'].includes(run.state)) {
        this.schedule(run.task.taskId)
      }
    }
  }

  stop(): void {
    this.stopped = true
  }

  async waitForIdle(taskId?: string): Promise<void> {
    if (taskId) await this.running.get(taskId)
    else await Promise.all([...this.running.values()])
  }

  async handleInbox(message: AgentInboxMessage): Promise<void> {
    if (message.payload.type === 'task.offered') {
      await this.acceptOffer(message.payload, message.recipientAgentId)
      return
    }
    if (message.payload.type === 'task.cancelled') {
      const cancellation = message.payload
      await this.synchronizeTask(
        cancellation.projectId,
        cancellation.taskId,
        cancellation.revision,
        `Task was cancelled: ${cancellation.reason}`
      )
      return
    }
    if (message.payload.type === 'task.updated') {
      await this.synchronizeTask(
        message.payload.projectId,
        message.payload.taskId,
        message.payload.revision
      )
    }
  }

  async acceptOffer(payload: TaskOfferedPayload, recipientAgentId: string): Promise<void> {
    const localAgentId = this.options.localAgentId()
    if (!localAgentId || recipientAgentId !== localAgentId) {
      throw new Error('Task offer recipient does not match this Agent.')
    }
    const response = await this.options.connection.executeAsDevice(restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'task.get',
      taskId: payload.taskId
    }))
    if (response.type === 'rest.error') throw new Error(response.error.message)
    if (response.type !== 'rest.entity' || response.entity.type !== 'task') {
      throw new Error(`Task query returned unexpected ${response.type}.`)
    }
    const task = response.entity
    if (
      task.projectId !== payload.projectId ||
      task.revision !== payload.revision ||
      task.assigneeAgentId !== localAgentId ||
      task.status !== 'offered'
    ) {
      throw new Error('Task offer does not match the current canonical Task.')
    }
    await this.options.store.transact((draft) => {
      const existing = draft.taskRuns.find((candidate) => candidate.task.taskId === task.taskId)
      if (existing) {
        if (existing.task.revision > task.revision) return
        if (existing.task.revision === task.revision) return
        existing.state = 'stale'
        existing.updatedAt = this.now().toISOString()
      }
      draft.tasks = replaceTask(draft.tasks, task)
      draft.taskRuns = [
        ...draft.taskRuns.filter((candidate) => candidate.task.taskId !== task.taskId),
        {
          task,
          state: 'offered',
          clientDirectiveId: taskDirectiveId(task),
          updatedAt: this.now().toISOString()
        }
      ]
    })
    this.schedule(task.taskId)
  }

  private schedule(taskId: string): void {
    if (this.stopped || this.running.has(taskId)) return
    const promise = this.process(taskId).finally(() => {
      if (this.running.get(taskId) === promise) this.running.delete(taskId)
    })
    this.running.set(taskId, promise)
  }

  private async process(taskId: string): Promise<void> {
    if (this.stopped) return
    let run = this.requireRun(taskId)
    const current = await this.readTask(taskId)
    if (
      current.assigneeAgentId !== this.options.localAgentId() ||
      current.revision < run.task.revision ||
      ['rejected', 'cancelled', 'succeeded', 'failed'].includes(current.status)
    ) {
      await this.markStale(taskId, current, 'Task is no longer executable by this Agent.')
      return
    }
    if (run.state === 'offered' || run.state === 'accepting') {
      await this.updateRun(taskId, { state: 'accepting', task: current })
      if (current.status === 'offered') await this.transition(current, 'accepted')
      const accepted = current.status === 'offered' ? await this.readTask(taskId) : current
      if (accepted.assigneeAgentId !== this.options.localAgentId() || accepted.status !== 'accepted') {
        if (accepted.status !== 'running') {
          await this.markStale(taskId, accepted, 'Task acceptance was not confirmed by the cloud service.')
          return
        }
      }
      if (accepted.status === 'accepted') await this.transition(accepted, 'running')
      const running = accepted.status === 'accepted' ? await this.readTask(taskId) : accepted
      if (running.assigneeAgentId !== this.options.localAgentId() || running.status !== 'running') {
        await this.markStale(taskId, running, 'Task running state was not confirmed by the cloud service.')
        return
      }
      await this.updateRun(taskId, {
        state: 'running',
        task: running,
        startedAt: this.now().toISOString()
      })
      run = this.requireRun(taskId)
    } else if (run.state === 'reconciling') {
      if (current.status !== 'running' && current.status !== 'accepted') {
        await this.markStale(taskId, current, 'Recovered Task revision is no longer running.')
        return
      }
      let running = current
      if (current.status === 'accepted') {
        await this.transition(current, 'running')
        running = await this.readTask(taskId)
      }
      if (running.assigneeAgentId !== this.options.localAgentId() || running.status !== 'running') {
        await this.markStale(taskId, running, 'Recovered Task running state was not confirmed by the cloud service.')
        return
      }
      run = await this.updateRun(taskId, {
        task: running,
        state: 'running',
        startedAt: run.startedAt ?? this.now().toISOString()
      })
    }

    try {
      const result = await this.options.agentExecution.run({
        ...(run.runtimeId ? { runtimeId: run.runtimeId } : {}),
        ...(run.threadId ? { threadId: run.threadId } : {}),
        ...(run.workspaceRoot ? { workspaceRoot: run.workspaceRoot } : {}),
        clientDirectiveId: run.clientDirectiveId,
        prompt: taskPrompt(run.task),
        metadata: {
          source: 'collaboration.project-task',
          projectId: run.task.projectId,
          taskId: run.task.taskId,
          taskRevision: run.task.revision
        },
        interaction: 'reviewable',
        mode: 'agent'
      })
      const latest = await this.readTask(taskId)
      if (
        latest.assigneeAgentId !== this.options.localAgentId() ||
        latest.status !== 'running' ||
        latest.revision !== run.task.revision
      ) {
        await this.markStale(taskId, latest, 'Task changed while the local turn was executing.')
        return
      }
      await this.updateRun(taskId, {
        runtimeId: result.runtimeId,
        threadId: result.threadId,
        localTurnId: result.turnId,
        resultText: result.text.slice(0, 32_000)
      })
      if (result.state !== 'completed') {
        await this.transition(latest, 'failed', undefined, `agent_${result.state}`)
        await this.updateRun(taskId, {
          state: 'failed',
          completedAt: this.now().toISOString(),
          error: `Agent turn ended in ${result.state}.`
        })
        return
      }
      await this.transition(latest, 'succeeded', result.text.slice(0, 32_000))
      const completed = await this.readTask(taskId)
      await this.updateRun(taskId, {
        task: completed,
        state: completed.status === 'succeeded' ? 'completed' : 'stale',
        completedAt: this.now().toISOString()
      })
    } catch (error) {
      await this.updateRun(taskId, {
        state: 'reconciling',
        completedAt: undefined,
        error: safeError(error, this.options.sanitizeText)
      })
    }
  }

  private async transition(
    task: Task,
    status: 'accepted' | 'running' | 'succeeded' | 'failed',
    resultSummary?: string,
    safeFailureCode?: string
  ): Promise<void> {
    const idempotencyKey = `idem_task.${status}.${digest(`${task.taskId}\u0000${task.revision}`).slice(0, 48)}`
    const outboxKind = status === 'accepted'
      ? 'task.accepted'
      : status === 'succeeded'
        ? 'task.result'
        : status === 'failed'
          ? 'task.failed'
          : 'task.progress'
    await this.options.outbox.enqueue(outboxKind, restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'task.transition',
      idempotencyKey,
      taskId: task.taskId,
      executionId: task.executionFence.executionId,
      expectedRevision: task.revision,
      status,
      ...(resultSummary?.trim() ? { resultSummary: resultSummary.slice(0, 32_000) } : {}),
      ...(safeFailureCode ? { safeFailureCode } : {})
    }))
    await this.options.outbox.waitForIdle()
    const entry = this.options.store.snapshot().outbox.find((candidate) => (
      candidate.idempotencyKey === idempotencyKey
    ))
    if (!entry || entry.state !== 'delivered') {
      throw new Error(entry?.error ?? 'Task transition is pending cloud delivery.')
    }
  }

  private async readTask(taskId: string): Promise<Task> {
    const response = await this.options.connection.executeAsDevice(restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'task.get',
      taskId
    }))
    if (response.type === 'rest.error') throw new Error(response.error.message)
    if (response.type !== 'rest.entity' || response.entity.type !== 'task') {
      throw new Error(`Task query returned unexpected ${response.type}.`)
    }
    return response.entity
  }

  private async synchronizeTask(
    projectId: string,
    taskId: string,
    notifiedRevision: number,
    notificationError?: string
  ): Promise<void> {
    const current = await this.readTask(taskId)
    if (current.projectId !== projectId || current.revision < notifiedRevision) {
      throw new Error('Task notification does not match the current canonical Task.')
    }
    const updatedAt = this.now().toISOString()
    let recover = false
    await this.options.store.transact((draft) => {
      draft.tasks = replaceTask(draft.tasks, current)
      const run = draft.taskRuns.find((candidate) => candidate.task.taskId === taskId)
      if (!run || current.revision < run.task.revision) return
      run.task = current
      run.updatedAt = updatedAt
      run.completedAt = current.completedAt
      if (current.assigneeAgentId !== this.options.localAgentId()) {
        run.state = 'stale'
        run.error = 'Task was reassigned to another Agent.'
        return
      }
      if (current.status === 'succeeded') {
        run.state = 'completed'
        run.error = undefined
        return
      }
      if (current.status === 'failed') {
        run.state = 'failed'
        run.error = notificationError ?? current.status
        return
      }
      if (current.status === 'cancelled' || current.status === 'rejected') {
        run.state = 'stale'
        run.error = notificationError ?? `Task is ${current.status}.`
        return
      }
      if (current.status === 'needs_human') {
        run.state = 'needs-human'
        run.error = notificationError
        return
      }
      if (current.status === 'accepted' || current.status === 'running') {
        run.state = 'reconciling'
        run.error = notificationError
        recover = true
      }
    })
    if (recover) this.schedule(taskId)
  }

  private requireRun(taskId: string): CollaborationTaskRun {
    const run = this.options.store.snapshot().taskRuns.find((candidate) => (
      candidate.task.taskId === taskId
    ))
    if (!run) throw new Error('Local Task run was not found.')
    return run
  }

  private async updateRun(
    taskId: string,
    update: Partial<CollaborationTaskRun>
  ): Promise<CollaborationTaskRun> {
    return this.options.store.transact((draft) => {
      const run = draft.taskRuns.find((candidate) => candidate.task.taskId === taskId)
      if (!run) throw new Error('Local Task run was not found.')
      Object.assign(run, update, { updatedAt: this.now().toISOString() })
      draft.tasks = replaceTask(draft.tasks, run.task)
      return structuredClone(run)
    })
  }

  private async markStale(taskId: string, task: Task, error: string): Promise<void> {
    await this.updateRun(taskId, {
      task,
      state: 'stale',
      completedAt: this.now().toISOString(),
      error
    })
  }
}

function replaceTask(tasks: readonly Task[], task: Task): Task[] {
  return [...tasks.filter((candidate) => candidate.taskId !== task.taskId), task]
}

function taskDirectiveId(task: Task): string {
  return `collab-task-${digest(`${task.taskId}\u0000${task.revision}`).slice(0, 48)}`
}

function taskPrompt(task: Task): string {
  return [
    `Project Task: ${task.title}`,
    '',
    task.objective,
    '',
    'Completion criteria:',
    ...task.completionCriteria.map((criterion, index) => `${index + 1}. ${criterion}`)
  ].join('\n')
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function safeError(error: unknown, sanitizeText?: (value: string) => string): string {
  const value = error instanceof Error ? error.message : 'Task execution failed.'
  return (sanitizeText?.(value) ?? value)
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/giu, '[REDACTED]')
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gu, '[REDACTED]')
    .slice(0, 4_000)
}
