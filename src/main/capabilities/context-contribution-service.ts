import { freezeInvocationSnapshot, isLosslessJsonValue } from './invocation-snapshot'

export interface ContextSourceIdentity { sourceId: string; packageVersion: string; generation: string }
export interface ContextInvocationIdentity { callerId: string; sessionId: string; turnId: string; invocationId: string }
export interface AuthenticatedContextInvocation extends ContextSourceIdentity, ContextInvocationIdentity {
  snapshot: object
  signal: AbortSignal
  deadlineMs: number
}
export interface PluginContextMaterial { kind: 'plugin-material'; text: string }
// User instructions belong to the existing Host turn input, never a plugin contribution.
export interface HostUserInstruction { kind: 'user-instruction'; text: string }
export interface ContextContributionOptions {
  maxItemBytes: number
  maxInvocationBytes: number
  timeoutMs: number
  authenticate(snapshot: object): AuthenticatedContextInvocation | undefined
}
export interface ContextContributionRecord extends PluginContextMaterial {
  source: Readonly<ContextSourceIdentity>
  invocation: Readonly<ContextInvocationIdentity>
  snapshot: object
}

export interface ContextContributionAuthority {
  issueGrant(snapshot: object): object
  revoke(grant: object): void
  deactivate(): void
  readonly contributions: {
    collect(grant: object, snapshot: object, producer: (context: { snapshot: object; signal: AbortSignal; deadlineMs: number }) => Promise<PluginContextMaterial>): Promise<object>
  }
}
export type ContextContributionErrorCode = 'context_denied' | 'context_invalid' | 'context_limit' | 'context_revoked' | 'context_cancelled' | 'context_deadline' | 'context_producer_failed'
export class ContextContributionError extends Error {
  readonly code: ContextContributionErrorCode
  constructor(code: ContextContributionErrorCode) {
    super('Context contribution rejected.')
    this.name = 'ContextContributionError'
    this.code = code
    delete this.stack
  }
}
function denied(): never { throw new ContextContributionError('context_denied') }
const identityKeys = ['callerId', 'sessionId', 'turnId', 'invocationId', 'sourceId', 'packageVersion', 'generation'] as const

/** Trusted Host factory. Never expose registerSource, authenticate, lifecycle,
 * or hostAdapterSeam to a plugin. Pass only the source-bound contributions port
 * and Host-issued grants. Quotas cover admitted UTF-8 text across all sources
 * for one authenticated invocation, not producer CPU/memory or IPC overhead.
 * Scope one instance to a Host preparation lifetime; do not recreate it to retry
 * the same invocation. Cancellation fences delivery, not producer execution.
 */
export function createContextContributionService(inputOptions: ContextContributionOptions) {
  let options: ContextContributionOptions
  try {
    options = { ...inputOptions }
    if ([options.maxItemBytes, options.maxInvocationBytes, options.timeoutMs].some(value => !Number.isSafeInteger(value) || value <= 0)
      || options.timeoutMs > 2147483647 || typeof options.authenticate !== 'function') throw 0
  } catch { throw new ContextContributionError('context_invalid') }
  const sources = new Map<string, ContextContributionAuthority>()
  const generations = new Map<string, string>()
  const usage = new Map<string, number>()
  const tokens = new WeakMap<object, { record: ContextContributionRecord; validate(snapshot: object): void }>()
  return Object.freeze({
    registerSource(identity: ContextSourceIdentity): ContextContributionAuthority {
      let source: Readonly<ContextSourceIdentity>
      try {
        source = Object.freeze({ sourceId: identity.sourceId, packageVersion: identity.packageVersion, generation: identity.generation })
        if (Object.values(source).some(value => typeof value !== 'string' || !value || value.trim() !== value)) throw 0
      } catch { throw new ContextContributionError('context_invalid') }
      const key = JSON.stringify([source.sourceId, source.packageVersion, source.generation])
      const existing = sources.get(key)
      if (existing) return existing
      const previous = generations.get(source.sourceId)
      if (previous) sources.get(previous)?.deactivate()
      generations.set(source.sourceId, key)
      let active = true
      const revoked = new WeakSet<object>()
      const pending = new Set<{ grant: object; cancel(): void }>()
      const grants = new WeakMap<object, { snapshot: object; facts: AuthenticatedContextInvocation; capturedSnapshot: object; expiresAt: number }>()
      function authenticate(snapshot: object): AuthenticatedContextInvocation {
        try {
          const facts = options.authenticate(snapshot)
          if (!facts || identityKeys.some(key => typeof facts[key] !== 'string' || !facts[key].trim())
            || facts.sourceId !== source.sourceId || facts.packageVersion !== source.packageVersion
            || facts.generation !== source.generation || !Number.isSafeInteger(facts.deadlineMs)
            || !(facts.signal instanceof AbortSignal) || facts.snapshot === null || typeof facts.snapshot !== 'object'
            || !isLosslessJsonValue(facts.snapshot)) return denied()
          return facts
        } catch { return denied() }
      }
      function check(grant: object, snapshot: object) {
        if (!active || generations.get(source.sourceId) !== key || revoked.has(grant)) throw new ContextContributionError('context_revoked')
        const entry = grants.get(grant)
        if (!entry || entry.snapshot !== snapshot) return denied()
        const current = authenticate(snapshot)
        if (current.signal !== entry.facts.signal || current.snapshot !== entry.facts.snapshot || identityKeys.some(key => current[key] !== entry.facts[key])) return denied()
        if (entry.facts.signal.aborted) throw new ContextContributionError('context_cancelled')
        const deadlineMs = Math.min(entry.expiresAt, current.deadlineMs)
        if (Date.now() >= deadlineMs) throw new ContextContributionError('context_deadline')
        return { ...entry.facts, deadlineMs }
      }
      const authority: ContextContributionAuthority = Object.freeze({
        deactivate() { active = false; for (const operation of pending) operation.cancel() },
        revoke(grant: object) {
          if (!grants.has(grant)) return denied()
          revoked.add(grant)
          for (const operation of pending) if (operation.grant === grant) operation.cancel()
        },
        issueGrant(snapshot: object) {
          if (!active || generations.get(source.sourceId) !== key) throw new ContextContributionError('context_revoked')
          const facts = authenticate(snapshot)
          const grant = Object.freeze({})
          try {
            grants.set(grant, { snapshot, facts: { ...facts }, capturedSnapshot: freezeInvocationSnapshot(structuredClone(facts.snapshot)), expiresAt: Math.min(facts.deadlineMs, Date.now() + options.timeoutMs) })
          } catch { return denied() }
          return grant
        },
        contributions: Object.freeze({
          async collect(grant: object, snapshot: object, producer: (context: { snapshot: object; signal: AbortSignal; deadlineMs: number }) => Promise<PluginContextMaterial>) {
            const facts = check(grant, snapshot)
            let result: unknown
            const entry = grants.get(grant)!
            result = await new Promise<unknown>((resolve, reject) => {
              let settled = false
              const finish = (success: boolean, value: unknown) => {
                if (settled) return
                settled = true
                pending.delete(operation)
                clearTimeout(timer)
                facts.signal.removeEventListener('abort', abort)
                if (success) resolve(value)
                else reject(value)
              }
              const operation = { grant, cancel: () => finish(false, new ContextContributionError('context_revoked')) }
              pending.add(operation)
              const abort = () => finish(false, new ContextContributionError('context_cancelled'))
              const timer = setTimeout(() => finish(false, new ContextContributionError('context_deadline')), Math.max(0, facts.deadlineMs - Date.now()))
              facts.signal.addEventListener('abort', abort, { once: true })
              try {
                Promise.resolve(producer({ snapshot: entry.capturedSnapshot, signal: facts.signal, deadlineMs: facts.deadlineMs })).then(value => finish(true, value), () => finish(false, new ContextContributionError('context_producer_failed')))
              } catch { finish(false, new ContextContributionError('context_producer_failed')) }
            })
            let material: PluginContextMaterial
            try {
              if (!result || typeof result !== 'object') throw 0
              const keys = Reflect.ownKeys(result)
              const descriptors = Object.getOwnPropertyDescriptors(result)
              if (keys.length !== 2 || !keys.includes('kind') || !keys.includes('text')
                || !descriptors.kind || !descriptors.text || !('value' in descriptors.kind) || !('value' in descriptors.text)
                || descriptors.kind.value !== 'plugin-material' || typeof descriptors.text.value !== 'string') throw 0
              material = { kind: 'plugin-material', text: descriptors.text.value }
            } catch { throw new ContextContributionError('context_invalid') }
            check(grant, snapshot)
            const bytes = Buffer.byteLength(material.text, 'utf8')
            const key = JSON.stringify([facts.callerId, facts.sessionId, facts.turnId, facts.invocationId])
            const used = usage.get(key) ?? 0
            if (bytes > options.maxItemBytes || bytes > options.maxInvocationBytes - used) throw new ContextContributionError('context_limit')
            usage.set(key, used + bytes)
            const token = Object.freeze({})
            tokens.set(token, { validate: target => { check(grant, target) }, record: freezeInvocationSnapshot({ kind: material.kind, text: material.text, source,
              invocation: { callerId: facts.callerId, sessionId: facts.sessionId, turnId: facts.turnId, invocationId: facts.invocationId },
              snapshot: entry.capturedSnapshot }) })
            return token
          }
        })
      })
      sources.set(key, authority)
      return authority
    },
    // Contract only. No runtime registration or dispatch: the existing Host turn
    // preparation adapter is the sole future consumer of these typed records.
    hostAdapterSeam: Object.freeze({ connected: false as const,
      read(token: object, snapshot: object): ContextContributionRecord {
        const entry = tokens.get(token)
        if (!entry) return denied()
        entry.validate(snapshot)
        return entry.record
      }
    })
  })
}
