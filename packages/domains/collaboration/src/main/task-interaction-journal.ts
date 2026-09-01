import { randomUUID } from 'node:crypto'
import {
  collaborationTaskCheckpointSchema,
  collaborationTaskInteractionSchema,
  type CollaborationLocalStore,
  type CollaborationTaskCheckpoint,
  type CollaborationTaskInteraction
} from './store.js'

export type TaskInteractionCreate = Readonly<{
  projectId: CollaborationTaskInteraction['projectId']
  taskId: CollaborationTaskInteraction['taskId']
  executionId?: CollaborationTaskInteraction['executionId']
  kind: CollaborationTaskInteraction['kind']
  origin?: CollaborationTaskInteraction['origin']
  text?: CollaborationTaskInteraction['text']
  clientDirectiveId?: CollaborationTaskInteraction['clientDirectiveId']
  idempotencyKey?: CollaborationTaskInteraction['idempotencyKey']
}>

export type TaskCheckpointCreate = Readonly<{
  projectId: CollaborationTaskCheckpoint['projectId']
  taskId: CollaborationTaskCheckpoint['taskId']
  executionId?: CollaborationTaskCheckpoint['executionId']
  kind: CollaborationTaskCheckpoint['kind']
  source?: CollaborationTaskCheckpoint['source']
  summary: CollaborationTaskCheckpoint['summary']
  detail?: CollaborationTaskCheckpoint['detail']
  idempotencyKey?: CollaborationTaskCheckpoint['idempotencyKey']
}>

export type TaskInteractionTransition = Readonly<{
  state: Exclude<CollaborationTaskInteraction['state'], 'queued' | 'dispatching'>
  error?: string | null
  clientDirectiveId?: string | null
}>

/**
 * Durable local journal for human intervention and Worker progress. The
 * journal never writes a Cloud task state itself. A runtime may use the
 * returned idempotency key when it invokes an existing Cloud capability.
 */
export class TaskInteractionJournal {
  private readonly now: () => Date

  constructor(
    private readonly store: CollaborationLocalStore,
    now: () => Date = () => new Date()
  ) {
    this.now = now
  }

  async enqueue(input: TaskInteractionCreate): Promise<CollaborationTaskInteraction> {
    const interactionId = localOpaqueId('int')
    const idempotencyKey = input.idempotencyKey ?? `idem_task-interaction_${interactionId}`
    const createdAt = this.now().toISOString()
    const interaction = collaborationTaskInteractionSchema.parse({
      interactionId,
      idempotencyKey,
      projectId: input.projectId,
      taskId: input.taskId,
      executionId: input.executionId ?? null,
      kind: input.kind,
      origin: input.origin ?? 'human',
      text: input.text ?? null,
      clientDirectiveId: input.clientDirectiveId ?? null,
      state: 'queued',
      attempts: 0,
      createdAt,
      updatedAt: createdAt,
      dispatchedAt: null,
      completedAt: null,
      error: null
    })
    return this.store.transact((draft) => {
      const existing = draft.taskInteractions.find((candidate) => (
        candidate.idempotencyKey === interaction.idempotencyKey
      ))
      if (existing) {
        if (!sameInteractionIntent(existing, interaction)) {
          throw new Error('Task interaction idempotency key was reused for a different intent.')
        }
        return structuredClone(existing)
      }
      draft.taskInteractions.push(interaction)
      return structuredClone(interaction)
    })
  }

  async markDispatching(interactionId: string): Promise<CollaborationTaskInteraction> {
    return this.store.transact((draft) => {
      const interaction = requiredInteraction(draft.taskInteractions, interactionId)
      ensureTransition(interaction.state, 'dispatching')
      const updatedAt = this.now().toISOString()
      interaction.state = 'dispatching'
      interaction.attempts += 1
      interaction.updatedAt = updatedAt
      interaction.dispatchedAt = updatedAt
      interaction.error = null
      return structuredClone(interaction)
    })
  }

  async transition(
    interactionId: string,
    update: TaskInteractionTransition
  ): Promise<CollaborationTaskInteraction> {
    return this.store.transact((draft) => {
      const interaction = requiredInteraction(draft.taskInteractions, interactionId)
      ensureTransition(interaction.state, update.state)
      const updatedAt = this.now().toISOString()
      interaction.state = update.state
      interaction.updatedAt = updatedAt
      if (update.clientDirectiveId !== undefined) {
        interaction.clientDirectiveId = update.clientDirectiveId
      }
      const terminal = ['applied', 'rejected', 'failed', 'superseded'].includes(update.state)
      interaction.completedAt = terminal ? updatedAt : null
      interaction.error = ['rejected', 'failed'].includes(update.state)
        ? (update.error ?? 'Task interaction was not applied.')
        : null
      return structuredClone(interaction)
    })
  }

  async markAwaitingCloud(interactionId: string): Promise<CollaborationTaskInteraction> {
    return this.transition(interactionId, { state: 'awaiting_cloud' })
  }

  async markApplied(
    interactionId: string,
    clientDirectiveId?: string | null
  ): Promise<CollaborationTaskInteraction> {
    return this.transition(interactionId, {
      state: 'applied',
      ...(clientDirectiveId !== undefined ? { clientDirectiveId } : {})
    })
  }

  async markRejected(interactionId: string, error: string): Promise<CollaborationTaskInteraction> {
    return this.transition(interactionId, { state: 'rejected', error })
  }

  async markFailed(interactionId: string, error: string): Promise<CollaborationTaskInteraction> {
    return this.transition(interactionId, { state: 'failed', error })
  }

  async supersede(interactionId: string, reason?: string): Promise<CollaborationTaskInteraction> {
    return this.transition(interactionId, {
      state: 'superseded',
      ...(reason ? { error: reason } : {})
    })
  }

  async appendCheckpoint(input: TaskCheckpointCreate): Promise<CollaborationTaskCheckpoint> {
    const checkpointId = localOpaqueId('chk')
    const idempotencyKey = input.idempotencyKey ?? `idem_task-checkpoint_${checkpointId}`
    return this.store.transact((draft) => {
      const existing = draft.taskCheckpoints.find((candidate) => (
        candidate.idempotencyKey === idempotencyKey
      ))
      if (existing) {
        if (!sameCheckpointIntent(existing, input)) {
          throw new Error('Task checkpoint idempotency key was reused for different content.')
        }
        return structuredClone(existing)
      }
      const sequence = draft.taskCheckpoints
        .filter((candidate) => (
          candidate.projectId === input.projectId &&
          candidate.taskId === input.taskId &&
          (candidate.executionId ?? null) === (input.executionId ?? null)
        ))
        .reduce((max, candidate) => Math.max(max, candidate.sequence), 0) + 1
      const checkpoint = collaborationTaskCheckpointSchema.parse({
        checkpointId,
        idempotencyKey,
        projectId: input.projectId,
        taskId: input.taskId,
        executionId: input.executionId ?? null,
        sequence,
        kind: input.kind,
        source: input.source ?? 'agent',
        summary: input.summary,
        detail: input.detail ?? null,
        createdAt: this.now().toISOString()
      })
      draft.taskCheckpoints.push(checkpoint)
      return structuredClone(checkpoint)
    })
  }

  listInteractions(
    projectId: CollaborationTaskInteraction['projectId'],
    taskId?: CollaborationTaskInteraction['taskId']
  ): CollaborationTaskInteraction[] {
    return this.store.snapshot().taskInteractions
      .filter((interaction) => interaction.projectId === projectId && (!taskId || interaction.taskId === taskId))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  listCheckpoints(
    projectId: CollaborationTaskCheckpoint['projectId'],
    taskId?: CollaborationTaskCheckpoint['taskId']
  ): CollaborationTaskCheckpoint[] {
    return this.store.snapshot().taskCheckpoints
      .filter((checkpoint) => checkpoint.projectId === projectId && (!taskId || checkpoint.taskId === taskId))
      .sort((left, right) => (
        left.createdAt.localeCompare(right.createdAt) || left.sequence - right.sequence
      ))
  }
}

function ensureTransition(
  current: CollaborationTaskInteraction['state'],
  next: CollaborationTaskInteraction['state']
): void {
  if (current === next) return
  const allowed: Record<CollaborationTaskInteraction['state'], readonly CollaborationTaskInteraction['state'][]> = {
    queued: ['dispatching', 'rejected', 'failed', 'superseded'],
    dispatching: ['awaiting_cloud', 'applied', 'rejected', 'failed', 'superseded'],
    awaiting_cloud: ['applied', 'rejected', 'failed', 'superseded'],
    applied: [],
    rejected: [],
    failed: [],
    superseded: []
  }
  if (!allowed[current].includes(next)) {
    throw new Error(`Task interaction cannot transition from ${current} to ${next}.`)
  }
}

function requiredInteraction(
  interactions: CollaborationTaskInteraction[],
  interactionId: string
): CollaborationTaskInteraction {
  const interaction = interactions.find((candidate) => candidate.interactionId === interactionId)
  if (!interaction) throw new Error(`Unknown local task interaction: ${interactionId}`)
  return interaction
}

function sameInteractionIntent(
  left: CollaborationTaskInteraction,
  right: CollaborationTaskInteraction
): boolean {
  return left.projectId === right.projectId &&
    left.taskId === right.taskId &&
    left.executionId === right.executionId &&
    left.kind === right.kind &&
    left.origin === right.origin &&
    left.text === right.text &&
    left.clientDirectiveId === right.clientDirectiveId
}

function sameCheckpointIntent(
  existing: CollaborationTaskCheckpoint,
  input: TaskCheckpointCreate
): boolean {
  return existing.projectId === input.projectId &&
    existing.taskId === input.taskId &&
    existing.executionId === (input.executionId ?? null) &&
    existing.kind === input.kind &&
    existing.source === (input.source ?? 'agent') &&
    existing.summary === input.summary &&
    existing.detail === (input.detail ?? null)
}

function localOpaqueId(prefix: 'int' | 'chk'): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`
}
