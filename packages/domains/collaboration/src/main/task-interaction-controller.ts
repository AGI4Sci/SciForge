import {
  CollaborationLocalStore,
  type CollaborationTaskCheckpoint,
  type CollaborationTaskInteraction,
  type CollaborationTaskRun
} from './store.js'
import type { TaskExecutionState } from '@sciforge/collaboration-contracts'
import {
  TaskInteractionJournal,
  type TaskCheckpointCreate
} from './task-interaction-journal.js'
import type { LocalTaskInteractionState } from './task-interaction-contract.js'

/**
 * A local-only observation of a Task's interaction lifecycle.  The value is
 * intentionally derived from the local Worker journal and is never written
 * back as a Cloud Task state.  Consumers must reconcile it with the latest
 * Cloud Task/Execution snapshot before displaying a terminal result.
 */
export type TaskInteractionDispatchRequest = Readonly<{
  interaction: CollaborationTaskInteraction
  run: CollaborationTaskRun
  /** The exact Runtime Session binding; no retargeting is allowed. */
  session: Readonly<{ runtimeId: string; threadId: string }>
  signal: AbortSignal
}>

export type TaskInteractionDispatchResult = Readonly<{
  outcome: 'applied' | 'awaiting_cloud' | 'rejected'
  /** The Runtime turn produced by a successful guidance dispatch. */
  turnId?: string
  /** The stable directive identity used by the Agent Host. */
  clientDirectiveId?: string
  error?: string
}>

export type TaskInteractionControllerOptions = Readonly<{
  store: CollaborationLocalStore
  journal?: TaskInteractionJournal
  /**
   * Optional bridge to the canonical Agent/Cloud path.  Keeping this bridge
   * optional is what makes local queueing useful while offline: an interaction
   * is durably recorded and can be flushed once the Runtime/Cloud is ready.
   */
  dispatch?: (request: TaskInteractionDispatchRequest) =>
    Promise<TaskInteractionDispatchResult>
  /** Return false while the canonical adapter is already inside a Runtime turn. */
  canDispatch?: (executionId: string) => boolean
  /** Return false once result finalization has begun; do not leave stale intents queued. */
  canSubmit?: (executionId: string) => boolean
  now?: () => Date
}>

export type TaskInteractionSubmit = Readonly<{
  projectId: string
  taskId: string
  executionId?: string
  kind: CollaborationTaskInteraction['kind']
  text?: string
  idempotencyKey?: string
  clientDirectiveId?: string
  origin?: CollaborationTaskInteraction['origin']
}>

export type LocalTaskInteractionView = Readonly<{
  projectId: string
  taskId: string
  executionId?: string
  state: LocalTaskInteractionState
  pending: readonly CollaborationTaskInteraction[]
  interactions: readonly CollaborationTaskInteraction[]
  latestInteraction?: CollaborationTaskInteraction
  checkpoints: readonly CollaborationTaskCheckpoint[]
  /** Cloud state is retained as an observation, never replaced locally. */
  cloudExecutionState?: TaskExecutionState
  cloudTaskRevision?: number
  localUpdatedAt?: string
}>

/**
 * Local interaction coordinator for a Worker Task.  It provides durable
 * human guidance/pause/resume/cancel/retry intents and append-only progress
 * checkpoints without introducing a parallel Cloud command path.
 */
export class TaskInteractionController {
  private readonly journal: TaskInteractionJournal
  private readonly now: () => Date
  private readonly controllers = new Map<string, AbortController>()
  private readonly flushing = new Map<string, Promise<void>>()

  constructor(private readonly options: TaskInteractionControllerOptions) {
    this.now = options.now ?? (() => new Date())
    this.journal = options.journal ?? new TaskInteractionJournal(options.store, this.now)
  }

  /**
   * Add an interaction intent.  A queued intent is safe to create while
   * disconnected; `flush` is best-effort and remains explicitly local when
   * no canonical dispatch bridge is available.
   */
  async submit(input: TaskInteractionSubmit): Promise<CollaborationTaskInteraction> {
    const run = this.findRun(input.executionId, input.taskId)
    if (run && run.offer.projectId !== input.projectId) {
      throw new Error('Task interaction Project identity does not match the local Worker execution.')
    }
    const executionId = input.executionId ?? run?.offer.executionId
    const interaction = await this.journal.enqueue({
      projectId: input.projectId,
      taskId: input.taskId,
      ...(executionId ? { executionId } : {}),
      kind: input.kind,
      ...(input.origin ? { origin: input.origin } : {}),
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(input.clientDirectiveId ? { clientDirectiveId: input.clientDirectiveId } : {}),
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {})
    })
    if (executionId && this.options.canSubmit && !this.options.canSubmit(executionId)) {
      await this.journal.markRejected(
        interaction.interactionId,
        'Cloud result submission is already in progress; this execution cannot accept another intervention.'
      )
      return this.requireInteraction(interaction.interactionId)
    }
    // A missing/terminal execution cannot be acted on by the local Worker.
    // Keep the intent for the human timeline but make the outcome explicit.
    if (!run || isTerminalRun(run) || run.state === 'needs-human' || run.state === 'submitting') {
      await this.journal.markRejected(
        interaction.interactionId,
        !run
          ? 'No local Worker execution is bound to this Task.'
          : run.state === 'needs-human'
            ? 'This execution is waiting for its canonical HumanNeeded answer; answer that request instead.'
            : run.state === 'submitting'
              ? 'Cloud result submission is already in progress; this execution cannot accept another intervention.'
            : 'Cloud execution is terminal; use the existing Task reassign/retry operation.'
      )
      return this.requireInteraction(interaction.interactionId)
    }
    await this.flush(run.offer.executionId)
    return this.requireInteraction(interaction.interactionId)
  }

  submitGuidance(input: Omit<TaskInteractionSubmit, 'kind'>): Promise<CollaborationTaskInteraction> {
    return this.submit({ ...input, kind: 'guidance' })
  }

  submitPause(input: Omit<TaskInteractionSubmit, 'kind' | 'text'>): Promise<CollaborationTaskInteraction> {
    return this.submit({ ...input, kind: 'pause' })
  }

  submitResume(input: Omit<TaskInteractionSubmit, 'kind' | 'text'>): Promise<CollaborationTaskInteraction> {
    return this.submit({ ...input, kind: 'resume' })
  }

  submitCancel(input: Omit<TaskInteractionSubmit, 'kind' | 'text'>): Promise<CollaborationTaskInteraction> {
    return this.submit({ ...input, kind: 'cancel' })
  }

  submitRetry(input: Omit<TaskInteractionSubmit, 'kind' | 'text'>): Promise<CollaborationTaskInteraction> {
    return this.submit({ ...input, kind: 'retry' })
  }

  async appendCheckpoint(input: TaskCheckpointCreate): Promise<CollaborationTaskCheckpoint> {
    return this.journal.appendCheckpoint(input)
  }

  /** Flush one execution's queued intents through the canonical bridge. */
  async flush(executionId: string): Promise<void> {
    const existing = this.flushing.get(executionId)
    if (existing) return existing
    const work = this.flushExecution(executionId).finally(() => {
      if (this.flushing.get(executionId) === work) this.flushing.delete(executionId)
    })
    this.flushing.set(executionId, work)
    return work
  }

  /**
   * Recover intents left in dispatching/awaiting_cloud after a Desktop
   * restart.  The stable interaction idempotency key lets the bridge safely
   * reconcile a request instead of blindly sending a duplicate turn.
   */
  async recover(): Promise<void> {
    const executionIds = new Set(this.options.store.snapshot().taskInteractions
      .filter((interaction) => interaction.executionId && (
        interaction.state === 'queued' || interaction.state === 'dispatching' ||
        interaction.state === 'awaiting_cloud'
      ))
      .map((interaction) => interaction.executionId!))
    await Promise.all([...executionIds].map((executionId) => this.flush(executionId)))
  }

  /** Stop active local dispatches without deleting durable intents. */
  stop(): void {
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
  }

  listInteractions(projectId: string, taskId?: string): readonly CollaborationTaskInteraction[] {
    return Object.freeze(this.journal.listInteractions(projectId, taskId))
  }

  listCheckpoints(projectId: string, taskId?: string): readonly CollaborationTaskCheckpoint[] {
    return Object.freeze(this.journal.listCheckpoints(projectId, taskId))
  }

  view(projectId: string, taskId: string, executionId?: string): LocalTaskInteractionView {
    const state = this.options.store.snapshot()
    const run = selectTaskRun(
      state.taskRuns.filter((candidate) => (
        candidate.offer.projectId === projectId && candidate.offer.taskId === taskId &&
        (!executionId || candidate.offer.executionId === executionId)
      )),
      executionId
    )
    const resolvedExecutionId = executionId ?? run?.offer.executionId
    const interactions = this.journal.listInteractions(projectId, taskId)
      .filter((interaction) => !resolvedExecutionId || interaction.executionId === resolvedExecutionId)
      .slice(-20_000)
    const pending = interactions.filter((interaction) => (
      ['queued', 'dispatching', 'awaiting_cloud'].includes(interaction.state)
    )).slice(-10_000)
    const checkpoints = this.journal.listCheckpoints(projectId, taskId)
      .filter((checkpoint) => !resolvedExecutionId || checkpoint.executionId === resolvedExecutionId)
      .slice(-20_000)
    const latestInteraction = interactions.at(-1)
    return Object.freeze({
      projectId,
      taskId,
      ...(run ? { executionId: run.offer.executionId } : executionId ? { executionId } : {}),
      state: deriveLocalState(run, pending, latestInteraction),
      interactions: Object.freeze(interactions),
      pending: Object.freeze(pending),
      ...(latestInteraction ? { latestInteraction } : {}),
      checkpoints: Object.freeze(checkpoints),
      ...(run?.execution ? { cloudExecutionState: run.execution.state } : {}),
      ...(run?.task ? { cloudTaskRevision: run.task.revision } : {}),
      ...(run || latestInteraction ? {
        localUpdatedAt: run?.updatedAt ?? latestInteraction?.updatedAt
      } : {})
    })
  }

  private async flushExecution(executionId: string): Promise<void> {
    if (!this.options.dispatch) return
    if (this.options.canDispatch && !this.options.canDispatch(executionId)) return
    const run = this.findRun(executionId)
    if (!run || isTerminalRun(run)) return
    if (!run.runtimeId || !run.threadId) return
    const controller = this.controllers.get(executionId) ?? new AbortController()
    this.controllers.set(executionId, controller)
    try {
      // Read the queue again after every dispatch. A human can submit another
      // intent while a guidance turn is in flight; that intent must be consumed
      // before the adapter submits the Worker result rather than being stranded
      // behind a stale snapshot. A local pause remains an explicit barrier.
      while (true) {
        const intents = this.options.store.snapshot().taskInteractions.filter((interaction) => (
          interaction.executionId === executionId && interaction.state === 'queued'
        ))
        if (intents.length === 0) return
        for (const intent of intents) {
          if (controller.signal.aborted) return
          await this.journal.markDispatching(intent.interactionId)
          let result: TaskInteractionDispatchResult
          try {
            const currentRun = this.requireRun(executionId)
            if (isTerminalRun(currentRun) || currentRun.state === 'needs-human' || currentRun.state === 'submitting') {
              await this.journal.markRejected(
                intent.interactionId,
                'The Worker execution is no longer accepting local interactions.'
              )
              continue
            }
            if (!currentRun.runtimeId || !currentRun.threadId) {
              await this.journal.markRejected(
                intent.interactionId,
                'The Worker Runtime Session binding is unavailable for this interaction.'
              )
              continue
            }
            result = await this.options.dispatch({
              interaction: this.requireInteraction(intent.interactionId),
              run: currentRun,
              // Resolve the binding for every turn. Guidance is allowed to
              // update the durable Session receipt, but never to retarget a
              // queued intent to an unrelated execution.
              session: { runtimeId: currentRun.runtimeId, threadId: currentRun.threadId },
              signal: controller.signal
            })
          } catch (error) {
            await this.journal.markFailed(intent.interactionId, boundedError(error))
            continue
          }
          if (result.outcome === 'applied') {
            await this.journal.markApplied(intent.interactionId, result.clientDirectiveId)
            // A local pause is a barrier: preserve later queued guidance until
            // the human explicitly submits resume.
            if (intent.kind === 'pause') return
          } else if (result.outcome === 'awaiting_cloud') {
            await this.journal.markAwaitingCloud(intent.interactionId)
          } else {
            await this.journal.markRejected(intent.interactionId, result.error ?? 'Canonical dispatch rejected the interaction.')
          }
        }
      }
    } finally {
      if (this.controllers.get(executionId) === controller) this.controllers.delete(executionId)
    }
  }

  private findRun(executionId?: string, taskId?: string): CollaborationTaskRun | undefined {
    const candidates = this.options.store.snapshot().taskRuns.filter((run) => (
      (!executionId || run.offer.executionId === executionId) &&
      (!taskId || run.offer.taskId === taskId)
    ))
    return selectTaskRun(candidates, executionId)
  }

  private requireRun(executionId: string): CollaborationTaskRun {
    const run = this.findRun(executionId)
    if (!run) throw new Error('Local Worker execution journal was not found.')
    return run
  }

  private requireInteraction(interactionId: string): CollaborationTaskInteraction {
    const interaction = this.options.store.snapshot().taskInteractions.find((candidate) => (
      candidate.interactionId === interactionId
    ))
    if (!interaction) throw new Error('Local Task interaction was not found.')
    return interaction
  }
}

function selectTaskRun(
  candidates: readonly CollaborationTaskRun[],
  executionId?: string
): CollaborationTaskRun | undefined {
  if (executionId) return candidates.find((run) => run.offer.executionId === executionId)
  return candidates.find((run) => run.task?.currentExecutionId === run.offer.executionId) ??
    [...candidates].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)).at(-1)
}

function isTerminalRun(run: CollaborationTaskRun): boolean {
  return ['completed', 'failed', 'fenced', 'manual-recovery'].includes(run.state)
}

function deriveLocalState(
  run: CollaborationTaskRun | undefined,
  pending: readonly CollaborationTaskInteraction[],
  latest: CollaborationTaskInteraction | undefined
): LocalTaskInteractionState {
  if (run?.state === 'completed') return 'completed'
  if (run?.state === 'needs-human') return 'waiting_human'
  if (run?.state === 'failed' || run?.state === 'fenced' || run?.state === 'manual-recovery') {
    return 'blocked_cloud'
  }
  if (latest?.kind === 'pause' && latest.state === 'applied') return 'paused_local'
  if (latest?.state === 'awaiting_cloud') return 'awaiting_cloud'
  if (pending.length > 0) return 'intervention_queued'
  if (run?.state === 'running' || run?.state === 'accepting' || run?.state === 'submitting') {
    return 'running'
  }
  return 'idle'
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.trim().slice(0, 4_000) || 'Local Task interaction dispatch failed.'
}
