export type WorkspaceHostJournalEvent<TPayload = unknown> = Readonly<{
  seq: number
  emittedAt: string
  type: string
  payload: TPayload
}>

export type WorkspaceHostJournalReplay<TPayload = unknown> =
  | Readonly<{
      status: 'ok'
      events: readonly WorkspaceHostJournalEvent<TPayload>[]
      earliestSeq: number
      latestSeq: number
    }>
  | Readonly<{
      status: 'gap'
      events: readonly []
      earliestSeq: number
      latestSeq: number
    }>

export type WorkspaceHostEventListener<TPayload = unknown> = (
  event: WorkspaceHostJournalEvent<TPayload>
) => void

/**
 * An in-memory, bounded event journal for one logical Workspace Host session.
 *
 * A persistent daemon may persist/restore these records outside this class. The
 * protocol semantics do not depend on persistence: callers either receive all
 * events after a sequence or an explicit replay gap.
 */
export class BoundedWorkspaceHostJournal<TPayload = unknown> {
  readonly #capacity: number
  readonly #now: () => Date
  readonly #events: WorkspaceHostJournalEvent<TPayload>[] = []
  readonly #listeners = new Set<WorkspaceHostEventListener<TPayload>>()
  #latestSeq: number

  constructor(options: {
    capacity?: number
    initialSeq?: number
    now?: () => Date
  } = {}) {
    const capacity = options.capacity ?? 2_048
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100_000) {
      throw new RangeError('Journal capacity must be an integer between 1 and 100000.')
    }
    const initialSeq = options.initialSeq ?? 0
    if (!Number.isSafeInteger(initialSeq) || initialSeq < 0) {
      throw new RangeError('Initial sequence must be a non-negative safe integer.')
    }
    this.#capacity = capacity
    this.#latestSeq = initialSeq
    this.#now = options.now ?? (() => new Date())
  }

  get earliestSeq(): number {
    return this.#events[0]?.seq ?? this.#latestSeq + 1
  }

  get latestSeq(): number {
    return this.#latestSeq
  }

  get capacity(): number {
    return this.#capacity
  }

  append(type: string, payload: TPayload): WorkspaceHostJournalEvent<TPayload> {
    if (!type.trim() || type.length > 128) {
      throw new TypeError('Event type must contain 1 to 128 characters.')
    }
    if (this.#latestSeq >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError('Workspace Host event sequence is exhausted.')
    }
    const event = Object.freeze({
      seq: this.#latestSeq + 1,
      emittedAt: this.#now().toISOString(),
      type,
      payload
    })
    this.#latestSeq = event.seq
    this.#events.push(event)
    if (this.#events.length > this.#capacity) {
      this.#events.splice(0, this.#events.length - this.#capacity)
    }
    for (const listener of this.#listeners) listener(event)
    return event
  }

  replay(afterSeq: number): WorkspaceHostJournalReplay<TPayload> {
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
      throw new RangeError('Replay sequence must be a non-negative safe integer.')
    }
    const earliestSeq = this.earliestSeq
    const latestSeq = this.latestSeq
    if (afterSeq < earliestSeq - 1) {
      return {
        status: 'gap',
        events: [],
        earliestSeq,
        latestSeq
      }
    }
    return {
      status: 'ok',
      events: this.#events.filter((event) => event.seq > afterSeq),
      earliestSeq,
      latestSeq
    }
  }

  subscribe(listener: WorkspaceHostEventListener<TPayload>): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  clearListeners(): void {
    this.#listeners.clear()
  }
}
