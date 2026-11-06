import { randomUUID } from 'node:crypto'
import {
  userInputRequestSchema, validateUserInputAnswers,
  type DomainUserInputRequest, type DomainUserInputResult
} from '@sciforge/domain-sdk/user-input'
import type { AgentRuntimeEvent, AgentRuntimeId, AgentRuntimeTurn } from '../../../shared/agent-runtime-contract'

type Scope = { runtimeId: AgentRuntimeId; threadId: string; turnId: string }
type RecordEntry = {
  scope: Scope
  request: DomainUserInputRequest
  publish(event: AgentRuntimeEvent): Promise<unknown>
  ready: Promise<unknown>
  resolve(result: DomainUserInputResult): void
  reject(error: unknown): void
  release(): void
  settlement?: Promise<void>
  result?: DomainUserInputResult
}

/** Holds the original tool call; the answer returns through that same call. */
export class RuntimeUserInputService {
  private readonly requests = new Map<string, RecordEntry>()
  private disposed = false

  async request(scope: Scope, raw: DomainUserInputRequest,
    publish: RecordEntry['publish'], signal?: AbortSignal): Promise<DomainUserInputResult> {
    if (this.disposed || signal?.aborted) return { status: 'cancelled', answers: [] }
    const request = userInputRequestSchema.parse(raw)
    if ([...this.requests.values()].filter((entry) => !entry.result).length >= 64) {
      throw new Error('Too many pending user input requests.')
    }
    const requestId = `host-input-${randomUUID()}`
    let resolve!: RecordEntry['resolve']
    let reject!: RecordEntry['reject']
    const result = new Promise<DomainUserInputResult>((yes, no) => { resolve = yes; reject = no })
    const abort = (): void => { void this.cancel(scope, requestId).catch(reject) }
    const entry: RecordEntry = {
      scope, request, publish, resolve, reject,
      ready: Promise.resolve(),
      release: () => signal?.removeEventListener('abort', abort)
    }
    this.requests.set(requestId, entry)
    entry.ready = this.publish(entry, requestId, { ...scope, kind: 'user_input_requested', requestId,
      questions: request.questions, createdAt: new Date().toISOString() })
    // Observe publication failure before exposing the waiter, without an unhandled rejection.
    void entry.ready.then(() => {
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted || this.disposed) abort()
    }, (error) => { this.requests.delete(requestId); reject(error) })
    return result
  }

  owns(requestId: string): boolean { return requestId.startsWith('host-input-') }

  async submit(scope: Pick<Scope, 'runtimeId' | 'threadId'>, requestId: string, answers: unknown): Promise<void> {
    const entry = this.require(scope, requestId)
    const result: DomainUserInputResult = {
      status: 'submitted', answers: validateUserInputAnswers(entry.request, answers)
    }
    await this.settle(requestId, entry, result)
  }

  async cancel(scope: Pick<Scope, 'runtimeId' | 'threadId'>, requestId: string): Promise<void> {
    const entry = this.require(scope, requestId)
    await this.settle(requestId, entry, { status: 'cancelled', answers: [] })
  }

  private require(scope: Pick<Scope, 'runtimeId' | 'threadId'>, requestId: string): RecordEntry {
    const entry = this.requests.get(requestId)
    if (!entry || entry.scope.runtimeId !== scope.runtimeId || entry.scope.threadId !== scope.threadId) {
      throw new Error('User input request expired or belongs to another session.')
    }
    return entry
  }

  private async settle(requestId: string, entry: RecordEntry, result: DomainUserInputResult): Promise<void> {
    if (entry.settlement) {
      await entry.settlement
      if (JSON.stringify(entry.result) !== JSON.stringify(result)) throw new Error('User input was already resolved.')
      return
    }
    entry.settlement = (async () => {
      await entry.ready
      await this.publish(entry, requestId, { ...entry.scope, kind: 'user_input_resolved', requestId,
        ...result, createdAt: new Date().toISOString() })
      entry.result = result
      entry.release()
      entry.resolve(result)
      // Retain a bounded set of receipts for idempotent UI retries.
      const settled = [...this.requests].filter(([, value]) => value.result)
      for (const [id] of settled.slice(0, Math.max(0, settled.length - 256))) this.requests.delete(id)
    })()
    try { await entry.settlement } catch (error) { entry.settlement = undefined; throw error }
  }

  reconcileTurns(turns: AgentRuntimeTurn[]): AgentRuntimeTurn[] {
    return turns.map((turn) => ({ ...turn, items: turn.items?.map((item) => {
      if (item.kind !== 'user_input' || !this.owns(item.id) || item.meta?.userInputStatus || this.requests.has(item.id)) return item
      return { ...item, status: 'aborted', meta: { ...item.meta, userInputStatus: 'cancelled', answers: [] } }
    }) }))
  }

  private async publish(entry: RecordEntry, requestId: string, event: AgentRuntimeEvent): Promise<void> {
    await entry.publish(event)
    const result = event.kind === 'user_input_resolved' ? event : undefined
    await entry.publish({ ...entry.scope, kind: 'item_snapshot', createdAt: event.createdAt,
      item: { id: requestId, turnId: entry.scope.turnId, kind: 'user_input',
        status: result ? result.status === 'submitted' ? 'success' : 'aborted' : 'running',
        text: entry.request.questions.map((question) => question.question).join('\n'),
        meta: { requestId, questions: entry.request.questions,
          ...(result ? { userInputStatus: result.status, answers: result.answers } : {}) }
      }
    })
  }

  dispose(): void {
    this.disposed = true
    for (const entry of this.requests.values()) {
      entry.release()
      if (!entry.result) entry.resolve({ status: 'cancelled', answers: [] })
    }
    this.requests.clear()
  }
}
