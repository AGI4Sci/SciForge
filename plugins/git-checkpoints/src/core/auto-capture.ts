import type { GitCheckpointService } from './service.js'

/**
 * Automatic capture decision logic, migrated from the static module's
 * runtime.ts. The host's turn lifecycle events cannot reach a plugin process
 * yet (see plugins/GAPS.md, G2); this class is the pure, testable core that a
 * future host bridge feeds with serialized turn boundary events. Enablement
 * gating stays with the event source (an active plugin is enabled).
 */
export type GitCheckpointTurnEvent = Readonly<{
  kind: 'before-turn' | 'after-turn' | 'after-persistent-child-turn'
  state?: string
  runtimeId: string
  threadId: string
  turnId?: string
  workspaceRoot?: string
  occurredAt: string
}>

export type GitCheckpointAutoCaptureOutcome = Readonly<
  | { captured: true; checkpointId: string }
  | {
      captured: false
      reason: 'skipped' | 'duplicate' | 'unsupported-workspace' | 'failed'
      failureReason?: string
      message?: string
    }
>

export class GitCheckpointAutoCapture {
  readonly #seen = new Set<string>()
  readonly #unsupportedWorkspaces = new Set<string>()

  async captureForEvent(
    service: GitCheckpointService,
    event: GitCheckpointTurnEvent
  ): Promise<GitCheckpointAutoCaptureOutcome> {
    if (!shouldCaptureTurnEvent(event)) return { captured: false, reason: 'skipped' }
    const workspaceRoot = event.workspaceRoot?.trim()
    if (!workspaceRoot) return { captured: false, reason: 'skipped' }
    if (this.#unsupportedWorkspaces.has(workspaceRoot)) {
      return { captured: false, reason: 'unsupported-workspace' }
    }
    const key = turnEventKey(event)
    if (this.#seen.has(key)) return { captured: false, reason: 'duplicate' }
    this.#remember(key)
    const turnId = event.kind === 'after-turn' && event.state !== 'rejected'
      ? event.turnId
      : undefined
    const result = await service.create({
      runtimeId: event.runtimeId,
      threadId: event.threadId,
      ...(turnId ? { turnId } : {}),
      workspaceRoot,
      phase: event.kind === 'before-turn' ? 'before-turn' : 'after-turn'
    })
    if (!result.ok) {
      if (result.reason === 'not_git_repo' || result.reason === 'git_unavailable') {
        // Automatic checkpoints cannot succeed for this workspace. Avoid
        // starting the same failing provider path for every turn boundary;
        // manual checkpoint capabilities remain available if the workspace
        // later becomes a Git repository or Git is restored after reload.
        this.#unsupportedWorkspaces.add(workspaceRoot)
      }
      return {
        captured: false,
        reason: 'failed',
        failureReason: result.reason,
        message: result.message
      }
    }
    return { captured: true, checkpointId: result.value.checkpointId }
  }

  reset(): void {
    this.#seen.clear()
    this.#unsupportedWorkspaces.clear()
  }

  #remember(key: string): void {
    this.#seen.add(key)
    if (this.#seen.size <= 10_000) return
    const oldest = this.#seen.values().next().value
    if (oldest) this.#seen.delete(oldest)
  }
}

export function shouldCaptureTurnEvent(event: GitCheckpointTurnEvent): boolean {
  if (event.kind === 'after-persistent-child-turn') return false
  if (!event.runtimeId.trim() || !event.threadId.trim() || !event.workspaceRoot?.trim()) {
    return false
  }
  if (event.kind === 'before-turn') return true
  return event.state === 'completed' ||
    event.state === 'failed' ||
    event.state === 'cancelled'
}

export function turnEventKey(event: GitCheckpointTurnEvent): string {
  if (event.kind === 'after-persistent-child-turn') {
    return [event.kind, event.runtimeId, event.threadId, event.turnId, event.occurredAt].join('\u0000')
  }
  const turnId = event.kind === 'after-turn' && event.state !== 'rejected'
    ? event.turnId
    : ''
  return [
    event.kind,
    event.runtimeId,
    event.threadId,
    turnId,
    event.occurredAt
  ].join('\u0000')
}
