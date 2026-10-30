import { randomUUID } from 'node:crypto'

export interface ModelSourceIdentity { sourceId: string; packageName: string; packageVersion: string; generation: string }
export interface ModelParentFacts extends ModelSourceIdentity {
  callerId: string; sessionId: string; turnId: string; invocationId: string; parentRequestId: string
  approved: boolean; signal: AbortSignal; deadlineMs: number
}
export interface ModelBudgetLease { modelId: string; maxTokens: number; maxAmountMicros: number; confirm(): boolean }
export interface ModelAuditIdentity extends ModelSourceIdentity {
  callerId: string; sessionId: string; turnId: string; invocationId: string; parentRequestId: string; requestId: string
}
export type ModelRequestErrorCode = 'model_denied' | 'model_invalid' | 'model_limit' | 'model_revoked' | 'model_cancelled' | 'model_deadline' | 'model_host_failed'
export interface ModelRequestAudit extends ModelAuditIdentity {
  status: 'pending' | 'accepted' | 'rejected'; code?: ModelRequestErrorCode
  reservedTokens: number; reservedAmountMicros: number
}
export interface ModelRequestOptions {
  maxRequests: number; maxTokens: number; maxAmountMicros: number; timeoutMs: number
  authenticate(parent: object, snapshot: object): ModelParentFacts | undefined
  confirmFinal(parent: object, snapshot: object): boolean
  prepare(facts: Readonly<ModelParentFacts>): Promise<ModelBudgetLease>
  execute(request: ModelAuditIdentity & { text: string; modelId: string; maxTokens: number; maxAmountMicros: number; signal: AbortSignal; deadlineMs: number }): Promise<{ text: string }>
}
export interface ModelRequestAuthority {
  deactivate(): void
  revoke(parent: object): void
  readonly requests: { request(parent: object, snapshot: object, input: { text: string }): Promise<{ text: string }> }
}
const errorCodes = new WeakMap<object, ModelRequestErrorCode>()
export class PluginModelRequestError extends Error {
  constructor(readonly code: ModelRequestErrorCode) { super('Model request rejected.'); this.name = 'PluginModelRequestError'; errorCodes.set(this, code); delete this.stack }
}
function requireSynchronousTrue(value: unknown): void {
  if (value === true) return
  // Reject asynchronous confirmation, but observe its failure without awaiting it.
  void Promise.resolve(value).catch(() => {})
  throw new PluginModelRequestError('model_denied')
}
const intrinsicPromiseThen = Promise.prototype.then
function isNativePromise(value: unknown): boolean {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false
  try {
    intrinsicPromiseThen.call(value, () => undefined, () => undefined)
    return true
  } catch {
    return false
  }
}
function hasAsynchronousMarker(value: unknown): boolean {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false
  if (isNativePromise(value)) return true
  try {
    let cursor: object | null = value
    while (cursor) {
      const descriptor = Object.getOwnPropertyDescriptor(cursor, 'then')
      if (descriptor) return 'get' in descriptor || 'set' in descriptor || typeof descriptor.value === 'function'
      cursor = Object.getPrototypeOf(cursor)
    }
    return false
  } catch {
    return true
  }
}
const sourceKeys = ['sourceId', 'packageName', 'packageVersion', 'generation'] as const
const identityKeys = [...sourceKeys, 'callerId', 'sessionId', 'turnId', 'invocationId', 'parentRequestId'] as const
/** Standalone trusted-Host contract, NOT connected to a Model Router.
 * Expose only authority.requests to a plugin, with the existing Host-issued
 * approved parent grant and canonical immutable invocation snapshot. Source
 * registration, authentication, final confirmation, lifecycle and audit stay
 * Host-only; none is a plugin-supplied callback or self-reported identity.
 *
 * Scope one service to the Host task/accounting lifetime. Aggregate limits are
 * shared by authenticated invocation across sources and parent grants, not by
 * object identity, version or grant. Do not recreate a service to reset quotas.
 * prepare is side-effect-free admission/model selection: it MUST NOT dispatch.
 * Each execute represents one bounded upstream request, without hidden retry,
 * continuation or auxiliary calls. Those require separate port admissions.
 *
 * maxTokens includes prompt and completion; maxAmountMicros is an integer in
 * one Host-approved currency/tariff domain. prepare must reserve a reliable
 * worst-case bound (or provider-side prepaid cap); unavailable accounting must
 * deny admission. execute must enforce both bounds, deadlineMs and live signal
 * and keep endpoint/credentials private. This contract cannot measure provider
 * spend, stop a noncooperative adapter, or undo an already dispatched effect.
 * Reservations are never refunded on uncertain failure/cancellation.
 *
 * Host revocation must invoke revoke/deactivate (or abort the retained parent
 * signal) to settle stalled work immediately. Deadline shortening is rechecked
 * at admission/dispatch/delivery; mid-flight policy changes must also revoke.
 * Audits are detached in-memory metadata only, not durable audit acceptance;
 * an unauthenticated parent is denied without fabricating its provenance.
 * The sole future provider connection is options.execute through a trusted
 * adapter to the canonical Host model path; no SDK, IPC, startup or Router is
 * connected here. Neutral test adapters are not real-model execution evidence.
 */
export function createPluginModelRequestService(inputOptions: ModelRequestOptions) {
  let options: ModelRequestOptions
  const positive = (value: number) => Number.isSafeInteger(value) && value > 0
  try {
    options = { ...inputOptions }
    if (![options.maxRequests, options.maxTokens, options.maxAmountMicros, options.timeoutMs].every(positive) || options.timeoutMs > 2147483647) throw 0
  } catch { throw new PluginModelRequestError('model_invalid') }
  const usage = new Map<string, { requests: number; tokens: number; amount: number }>()
  const audits: ModelRequestAudit[] = []
  const sources = new Map<string, ModelRequestAuthority>()
  const generations = new Map<string, string>()
  return { hostAdapterSeam: Object.freeze({ connected: false as const,
    auditRecords(): readonly Readonly<ModelRequestAudit>[] { return Object.freeze(audits.map(record => Object.freeze({ ...record }))) }
  }), registerSource(inputSource: ModelSourceIdentity): ModelRequestAuthority {
    let source: Readonly<ModelSourceIdentity>
    try {
      source = Object.freeze({ sourceId: inputSource.sourceId, packageName: inputSource.packageName, packageVersion: inputSource.packageVersion, generation: inputSource.generation })
      if (sourceKeys.some(key => typeof source[key] !== 'string' || !source[key] || source[key].trim() !== source[key])) throw 0
    } catch { throw new PluginModelRequestError('model_invalid') }
    const key = JSON.stringify(sourceKeys.map(key => source[key]))
    const existing = sources.get(key)
    if (existing) return existing
    const old = generations.get(source.sourceId)
    if (old) sources.get(old)?.deactivate()
    generations.set(source.sourceId, key)
    let active = true
    const revoked = new WeakSet<object>()
    const bindings = new WeakMap<object, { snapshot: object; facts: ModelParentFacts }>()
    const pending = new Set<{ parent: object; cancel(): void }>()
    function check(parent: object, snapshot: object, captured?: ModelParentFacts): ModelParentFacts {
      if (!parent || typeof parent !== 'object' || !snapshot || typeof snapshot !== 'object') throw new PluginModelRequestError('model_denied')
      if (!active || revoked.has(parent) || generations.get(source.sourceId) !== key) throw new PluginModelRequestError('model_revoked')
      let facts: ModelParentFacts
      const binding = bindings.get(parent)
      const previous = captured ?? binding?.facts
      try {
        if (binding && binding.snapshot !== snapshot) throw 0
        const current = options.authenticate(parent, snapshot)
        // Authentication is synchronous by contract. Never assimilate the result,
        // because doing so can re-read a mutable then property or cross realms.
        if (hasAsynchronousMarker(current)) throw 0
        if (!current || current.approved !== true || identityKeys.some(key => typeof current[key] !== 'string' || !current[key] || current[key].trim() !== current[key])
          || sourceKeys.some(key => current[key] !== source[key]) || !(current.signal instanceof AbortSignal) || !Number.isSafeInteger(current.deadlineMs)) throw 0
        facts = { sourceId: current.sourceId, packageName: current.packageName, packageVersion: current.packageVersion, generation: current.generation,
          callerId: current.callerId, sessionId: current.sessionId, turnId: current.turnId, invocationId: current.invocationId, parentRequestId: current.parentRequestId,
          approved: true, signal: current.signal, deadlineMs: current.deadlineMs }
        if (previous && (identityKeys.some(key => facts[key] !== previous[key]) || facts.signal !== previous.signal)) throw 0
      } catch { throw new PluginModelRequestError('model_denied') }
      if (facts.signal.aborted) throw new PluginModelRequestError('model_cancelled')
      facts.deadlineMs = Math.min(facts.deadlineMs, previous?.deadlineMs ?? Infinity)
      if (Date.now() >= facts.deadlineMs) throw new PluginModelRequestError('model_deadline')
      if (!binding) bindings.set(parent, { snapshot, facts: { ...facts } })
      return facts
    }
    const authority: ModelRequestAuthority = Object.freeze({
      deactivate() { active = false; for (const operation of pending) operation.cancel() },
      revoke(parent: object) { revoked.add(parent); for (const operation of pending) if (operation.parent === parent) operation.cancel() },
      requests: Object.freeze({ async request(parent: object, snapshot: object, input: { text: string }) {
        const facts = check(parent, snapshot)
        facts.deadlineMs = Math.min(facts.deadlineMs, Date.now() + options.timeoutMs)
        const auditIdentity: ModelAuditIdentity = { ...source, callerId: facts.callerId, sessionId: facts.sessionId, turnId: facts.turnId,
          invocationId: facts.invocationId, parentRequestId: facts.parentRequestId, requestId: randomUUID() }
        const audit: ModelRequestAudit = { ...auditIdentity, status: 'pending', reservedTokens: 0, reservedAmountMicros: 0 }
        audits.push(audit)
        let text: string
        try {
          const keys = Reflect.ownKeys(input)
          const descriptor = Object.getOwnPropertyDescriptor(input, 'text')
          if (keys.length !== 1 || keys[0] !== 'text' || !descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string') throw 0
          text = descriptor.value
        } catch { audit.status = 'rejected'; audit.code = 'model_invalid'; throw new PluginModelRequestError('model_invalid') }
        return new Promise<{ text: string }>((resolve, reject) => {
          let settled = false
          let timer: ReturnType<typeof setTimeout>
          const finish = (success: boolean, value: { text: string } | unknown) => {
            if (settled) return
            settled = true
            pending.delete(operation)
            clearTimeout(timer)
            facts.signal.removeEventListener('abort', abort)
            audit.status = success ? 'accepted' : 'rejected'
            if (success) resolve(value as { text: string })
            else {
              const error = new PluginModelRequestError(errorCodes.get(value as object) ?? 'model_host_failed')
              audit.code = error.code
              reject(error)
            }
          }
          const operation = { parent, cancel: () => finish(false, new PluginModelRequestError('model_revoked')) }
          const abort = () => finish(false, new PluginModelRequestError('model_cancelled'))
          const arm = (deadlineMs: number) => { clearTimeout(timer); timer = setTimeout(() => finish(false, new PluginModelRequestError('model_deadline')), Math.max(0, deadlineMs - Date.now())) }
          pending.add(operation)
          facts.signal.addEventListener('abort', abort, { once: true })
          arm(facts.deadlineMs)
          const run = async () => {
            check(parent, snapshot, facts)
            if (settled) return
            let rawLease: ModelBudgetLease
            try { rawLease = await options.prepare(Object.freeze(facts)) } catch { throw new PluginModelRequestError('model_host_failed') }
            if (settled) return
            let lease: ModelBudgetLease
            try {
              lease = { modelId: rawLease.modelId, maxTokens: rawLease.maxTokens, maxAmountMicros: rawLease.maxAmountMicros, confirm: () => rawLease.confirm() }
              if (typeof lease.modelId !== 'string' || !lease.modelId.trim() || !positive(lease.maxTokens) || !positive(lease.maxAmountMicros)) throw 0
            } catch { throw new PluginModelRequestError('model_denied') }
            check(parent, snapshot, facts)
            try { requireSynchronousTrue(options.confirmFinal(parent, snapshot)); requireSynchronousTrue(lease.confirm()) } catch { throw new PluginModelRequestError('model_denied') }
            const current = check(parent, snapshot, facts)
            if (settled) return
            arm(current.deadlineMs)
            const key = JSON.stringify([facts.callerId, facts.sessionId, facts.turnId, facts.invocationId])
            const used = usage.get(key) ?? { requests: 0, tokens: 0, amount: 0 }
            if (used.requests >= options.maxRequests || lease.maxTokens > options.maxTokens - used.tokens || lease.maxAmountMicros > options.maxAmountMicros - used.amount) throw new PluginModelRequestError('model_limit')
            usage.set(key, { requests: used.requests + 1, tokens: used.tokens + lease.maxTokens, amount: used.amount + lease.maxAmountMicros })
            audit.reservedTokens = lease.maxTokens
            audit.reservedAmountMicros = lease.maxAmountMicros
            let result: { text: string }
            try { result = await options.execute({ ...auditIdentity, text, modelId: lease.modelId, maxTokens: lease.maxTokens, maxAmountMicros: lease.maxAmountMicros, signal: facts.signal, deadlineMs: current.deadlineMs }) }
            catch { throw new PluginModelRequestError('model_host_failed') }
            if (settled) return
            check(parent, snapshot, facts)
            let resultText: string
            try {
              const keys = Reflect.ownKeys(result)
              const descriptor = Object.getOwnPropertyDescriptor(result, 'text')
              if (keys.length !== 1 || keys[0] !== 'text' || !descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string') throw 0
              resultText = descriptor.value
            } catch { throw new PluginModelRequestError('model_host_failed') }
            check(parent, snapshot, facts)
            finish(true, Object.freeze({ text: resultText }))
          }
          run().catch(error => finish(false, error))
        })
      } })
    })
    sources.set(key, authority)
    return authority
  } }
}
