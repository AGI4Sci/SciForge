import type {
  DomainMainRuntimeDisposer,
  DomainMainRuntimeLifecycleContext,
  DomainMainSystemCapabilityInvoker,
  DomainMainTurnLifecycleEvent
} from '@sciforge/domain-sdk/host'
import {
  GitCheckpointService,
  type GitCheckpointServiceOptions
} from './service.js'

export type GitCheckpointRuntimeOptions = Readonly<{
  createService: (
    options: Pick<GitCheckpointServiceOptions, 'userDataDir'> & Readonly<{
      capabilities: DomainMainSystemCapabilityInvoker
    }>
  ) => GitCheckpointService
}>

export class GitCheckpointRuntime {
  readonly #createService: GitCheckpointRuntimeOptions['createService']
  #service: GitCheckpointService | null = null
  #deactivate: DomainMainRuntimeDisposer | null = null
  readonly #seen = new Set<string>()

  constructor(options: GitCheckpointRuntimeOptions) {
    this.#createService = options.createService
  }

  service(): GitCheckpointService {
    if (!this.#service) throw new Error('Git Checkpoints runtime is not active.')
    return this.#service
  }

  async activate(
    context: DomainMainRuntimeLifecycleContext
  ): Promise<DomainMainRuntimeDisposer> {
    if (this.#service || this.#deactivate) {
      throw new Error('Git Checkpoints runtime is already active.')
    }
    if (!context.turnEvents) {
      throw new Error('Git Checkpoints requires the host turn lifecycle event source.')
    }
    const service = this.#createService({
      userDataDir: context.userDataDir,
      capabilities: context.capabilities
    })
    this.#service = service
    let enabled = await context.enablement.isEnabled()
    const disposeEnablement = context.enablement.subscribe((next) => {
      enabled = next
    })
    const disposeTurns = context.turnEvents.subscribe(async (event) => {
      if (!enabled || context.signal.aborted) return
      if (event.kind === 'after-persistent-child-turn') return
      if (!shouldCaptureEvent(event)) return
      const key = eventKey(event)
      if (this.#seen.has(key)) return
      this.#remember(key)
      const turnId = event.kind === 'after-turn' && event.state !== 'rejected'
        ? event.turnId
        : undefined
      const result = await service.create({
        runtimeId: event.runtimeId,
        threadId: event.threadId,
        ...(turnId ? { turnId } : {}),
        workspaceRoot: event.workspaceRoot!,
        phase: event.kind
      })
      if (!result.ok) {
        context.log({
          level: 'warn',
          message: `Git checkpoint ${event.kind} capture failed.`,
          detail: {
            reason: result.reason,
            message: result.message,
            runtimeId: event.runtimeId,
            threadId: event.threadId,
            turnId
          }
        })
      }
    })

    let disposed = false
    const deactivate = async () => {
      if (disposed) return
      disposed = true
      await Promise.allSettled([
        Promise.resolve(disposeTurns()),
        Promise.resolve(disposeEnablement())
      ])
      this.#seen.clear()
      this.#service = null
      this.#deactivate = null
    }
    this.#deactivate = deactivate
    return deactivate
  }

  async dispose(): Promise<void> {
    await this.#deactivate?.()
  }

  #remember(key: string): void {
    this.#seen.add(key)
    if (this.#seen.size <= 10_000) return
    const oldest = this.#seen.values().next().value
    if (oldest) this.#seen.delete(oldest)
  }
}

function shouldCaptureEvent(event: DomainMainTurnLifecycleEvent): boolean {
  if (event.kind === 'after-persistent-child-turn') return false
  if (!event.runtimeId.trim() || !event.threadId.trim() || !event.workspaceRoot?.trim()) {
    return false
  }
  if (event.kind === 'before-turn') return true
  return event.state === 'completed' ||
    event.state === 'failed' ||
    event.state === 'cancelled'
}

function eventKey(event: DomainMainTurnLifecycleEvent): string {
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
