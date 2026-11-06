/**
 * G9: bridge the Broker's ordinary Session identity into the DSH invocation
 * envelope the runner requires.
 *
 * The Broker knows `{ runtimeId, threadId }`; the runner requires
 * `{ runtimeId, threadId, sessionId }` for every non-compute DSH tool. The host
 * opens one synthetic DSH session per (plugin, generation, runtime, thread) and
 * reuses its id, so a call is never downgraded to a session-less invocation.
 */
import type { DshInvocationContext } from '@sciforge/plugin-sdk'

export type DshSessionOpenInput = Readonly<{
  packageName: string
  generation: number
  runtimeId: string
  threadId: string
}>

export type DshEnvelopeRequest = Readonly<{
  packageName: string
  generation: number
  caller: Readonly<Record<string, unknown>>
  ordinarySession: Readonly<{ runtimeId: string; threadId: string }>
  context: Readonly<Record<string, unknown>>
}>

type SessionEntry = { packageName: string; session: Promise<string> }

export class DshSessionEnvelopeCache {
  readonly #open: (input: DshSessionOpenInput) => Promise<string>
  readonly #limit: number
  readonly #sessions = new Map<string, SessionEntry>()

  constructor(open: (input: DshSessionOpenInput) => Promise<string>, limit = 512) {
    this.#open = open
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Session capacity must be a positive integer.')
    this.#limit = limit
  }

  get size(): number {
    return this.#sessions.size
  }

  async envelopeFor(request: DshEnvelopeRequest): Promise<DshInvocationContext> {
    const key = JSON.stringify([
      request.packageName,
      String(request.generation),
      request.ordinarySession.runtimeId,
      request.ordinarySession.threadId
    ])
    let entry = this.#sessions.get(key)
    if (entry === undefined) {
      // The child owns live sessions until runtime teardown. Forgetting an id
      // here would leak that session and later reopen the same deterministic id.
      if (this.#sessions.size >= this.#limit) throw new Error('DSH session capacity reached; restart the plugin before opening another session.')
      const input = {
        packageName: request.packageName,
        generation: request.generation,
        runtimeId: request.ordinarySession.runtimeId,
        threadId: request.ordinarySession.threadId
      }
      const created: SessionEntry = { packageName: request.packageName, session: Promise.resolve().then(async () => {
        if (this.#sessions.get(key) !== created) throw new Error('DSH session creation was invalidated.')
        const sessionId = await this.#open(input)
        if (typeof sessionId !== 'string' || sessionId.length === 0) throw new Error('Host synthetic DSH session returned no session id.')
        return sessionId
      }).catch((error: unknown) => {
        if (this.#sessions.get(key) === created) this.#sessions.delete(key)
        throw error
      }) }
      this.#sessions.set(key, created)
      entry = created
    }
    const sessionId = await entry.session
    if (this.#sessions.get(key) !== entry) throw new Error('DSH session creation was invalidated.')
    return Object.freeze({
      caller: Object.freeze({ ...request.caller }),
      ordinarySession: Object.freeze({ ...request.ordinarySession, sessionId }),
      context: Object.freeze({ ...request.context })
    })
  }

  /** Drops every cached session of one plugin, across generations and threads. */
  dropPackage(packageName: string): void {
    for (const [key, entry] of this.#sessions) {
      if (entry.packageName === packageName) this.#sessions.delete(key)
    }
  }

  clear(): void {
    this.#sessions.clear()
  }
}
