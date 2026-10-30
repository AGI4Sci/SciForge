import { expect, it } from 'vitest'
import { createPluginModelRequestService, type ModelRequestOptions } from './plugin-model-request'

const source = { sourceId: 'neutral-source', packageName: 'neutral-package', packageVersion: '1.0.0', generation: 'g1' }
const identity = { callerId: 'neutral-caller', sessionId: 's1', turnId: 't1', invocationId: 'i1', parentRequestId: 'parent-1' }
function fixture(overrides: Partial<ModelRequestOptions> = {}) {
  const parent = Object.freeze({})
  const snapshot = Object.freeze({})
  const controller = new AbortController()
  const facts = { ...source, ...identity, approved: true as boolean, signal: controller.signal, deadlineMs: Date.now() + 10000 }
  let calls = 0
  const service = createPluginModelRequestService({ maxRequests: 2, maxTokens: 20, maxAmountMicros: 200, timeoutMs: 1000,
    authenticate: (candidate: object, target: object) => candidate === parent && target === snapshot ? facts : undefined,
    confirmFinal: () => true,
    prepare: async () => ({ modelId: 'host-choice', maxTokens: 10, maxAmountMicros: 100, confirm: () => true }),
    execute: async () => { calls++; return { text: 'neutral-result' } }, ...overrides })
  const authority = service.registerSource(source)
  return { service, authority, parent, snapshot, controller, facts, calls: () => calls }
}

it('fails closed without a reliable approved parent binding', async () => {
  const f = fixture()
  await expect(f.authority.requests.request({}, f.snapshot, { text: 'neutral' })).rejects.toMatchObject({ code: 'model_denied' })
  f.facts.approved = false
  await expect(f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })).rejects.toMatchObject({ code: 'model_denied' })
})

it.each(['packageName', 'packageVersion', 'generation', 'sourceId', 'sessionId', 'turnId', 'parentRequestId', 'signal', 'deadlineMs'] as const)('rejects invalid authenticated %s before dispatch', async key => {
  const f = fixture()
  Object.assign(f.facts, { [key]: key === 'deadlineMs' ? NaN : key === 'signal' ? {} : key in source ? 'foreign' : '' })
  await expect(f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })).rejects.toMatchObject({ code: 'model_denied' })
  expect(f.calls()).toBe(0)
})

it('dispatches only the Host selected model and bounded budget', async () => {
  let received: unknown
  const f = fixture({ execute: async request => { received = request; return { text: 'neutral-result' } } })
  expect(await f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })).toEqual({ text: 'neutral-result' })
  expect(received).toMatchObject({ text: 'neutral', modelId: 'host-choice', maxTokens: 10, maxAmountMicros: 100, signal: f.controller.signal })
})
it.each(['missing', 'false', 'async', 'throws'] as const)('fails closed with %s final authorization', async kind => {
  const confirmer = kind === 'missing' ? undefined : kind === 'false' ? () => false : kind === 'async' ? () => Promise.resolve(true) : () => { throw new Error('synthetic-private') }
  const f = fixture({ confirmFinal: confirmer as never })
  await expect(f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })).rejects.toMatchObject({ code: 'model_denied' })
  expect(f.calls()).toBe(0)
})

it('rejects a thenable whose getter changes between reads before facts are observed', async () => {
  const f = fixture()
  let reads = 0
  let prepareCalls = 0
  let executeCalls = 0
  const changing = { ...f.facts } as Record<string, unknown>
  Object.defineProperty(changing, 'then', { configurable: true, get: () => reads++ === 0 ? undefined : () => undefined })
  const service = createPluginModelRequestService({ maxRequests: 2, maxTokens: 20, maxAmountMicros: 200, timeoutMs: 1000,
    authenticate: () => changing as never, confirmFinal: () => true,
    prepare: async () => { prepareCalls++; return { modelId: 'host-choice', maxTokens: 1, maxAmountMicros: 1, confirm: () => true } },
    execute: async () => { executeCalls++; return { text: 'must-not-execute' } } })
  const authority = service.registerSource(source)
  await expect(authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })).rejects.toMatchObject({ code: 'model_denied' })
  expect(reads).toBe(0)
  expect(prepareCalls).toBe(0)
  expect(executeCalls).toBe(0)
})

it('rejects a cross-realm native Promise with a hidden then before dispatch', async () => {
  const vm = await import('node:vm')
  const f = fixture()
  let prepareCalls = 0
  let executeCalls = 0
  const foreignPromise = vm.runInNewContext('Promise.resolve({})') as object
  Object.assign(foreignPromise, f.facts)
  Object.defineProperty(foreignPromise, 'then', { value: undefined, configurable: true, writable: true })
  const service = createPluginModelRequestService({ maxRequests: 2, maxTokens: 20, maxAmountMicros: 200, timeoutMs: 1000,
    authenticate: () => foreignPromise as never, confirmFinal: () => true,
    prepare: async () => { prepareCalls++; return { modelId: 'host-choice', maxTokens: 1, maxAmountMicros: 1, confirm: () => true } },
    execute: async () => { executeCalls++; return { text: 'must-not-execute' } } })
  const authority = service.registerSource(source)
  await expect(authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })).rejects.toMatchObject({ code: 'model_denied' })
  expect(prepareCalls).toBe(0)
  expect(executeCalls).toBe(0)
})
it('rechecks the parent after asynchronous Host budget admission', async () => {
  let release!: (lease: { modelId: string; maxTokens: number; maxAmountMicros: number; confirm(): boolean }) => void
  const f = fixture({ prepare: () => new Promise(resolve => { release = resolve }) })
  const pending = f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })
  f.facts.approved = false
  release({ modelId: 'host-choice', maxTokens: 1, maxAmountMicros: 1, confirm: () => true })
  await expect(pending).rejects.toMatchObject({ code: 'model_denied' })
  expect(f.calls()).toBe(0)
})

it.each(['model', 'endpoint', 'credential', 'maxTokens', 'sourceId', 'signal'] as const)('rejects plugin supplied %s authority', async key => {
  const f = fixture()
  await expect(f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral', [key]: 'forged' })).rejects.toMatchObject({ code: 'model_invalid' })
  expect(f.calls()).toBe(0)
})
it.each(['getter', 'proxy', 'symbol'] as const)('rejects hostile %s input without leaking errors', async kind => {
  const input = kind === 'getter' ? { get text() { throw new Error('synthetic-private') } } : kind === 'proxy'
    ? new Proxy({}, { ownKeys() { throw new Error('synthetic-private') } }) : { text: 'neutral', [Symbol('authority')]: true }
  const f = fixture()
  await expect(f.authority.requests.request(f.parent, f.snapshot, input as never)).rejects.toMatchObject({ code: 'model_invalid' })
})
it('captures request text before Host admission awaits', async () => {
  let release!: (lease: { modelId: string; maxTokens: number; maxAmountMicros: number; confirm(): boolean }) => void
  let received: unknown
  const f = fixture({ prepare: () => new Promise(resolve => { release = resolve }), execute: async request => { received = request.text; return { text: 'result' } } })
  const input = { text: 'original' }
  const pending = f.authority.requests.request(f.parent, f.snapshot, input)
  input.text = 'changed'
  release({ modelId: 'host-choice', maxTokens: 1, maxAmountMicros: 1, confirm: () => true })
  await pending
  expect(received).toBe('original')
})

it.each(['maxRequests', 'maxTokens', 'maxAmountMicros'] as const)('atomically shares aggregate %s across concurrent requests and grants', async key => {
  const f = fixture({ [key]: key === 'maxRequests' ? 1 : key === 'maxTokens' ? 10 : 100 })
  const outcomes = await Promise.allSettled([f.authority.requests.request(f.parent, f.snapshot, { text: 'a' }), f.authority.requests.request(f.parent, f.snapshot, { text: 'b' })])
  expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1)
  expect(outcomes.find(item => item.status === 'rejected')).toMatchObject({ reason: { code: 'model_limit' } })
  expect(f.calls()).toBe(1)
})
it.each(['missing', 'false', 'async'] as const)('rejects %s synchronous budget confirmation', async kind => {
  const confirm = kind === 'missing' ? undefined : kind === 'false' ? () => false : () => Promise.resolve(true)
  const f = fixture({ prepare: async () => ({ modelId: 'host-choice', maxTokens: 1, maxAmountMicros: 1, confirm: confirm as never }) })
  await expect(f.authority.requests.request(f.parent, f.snapshot, { text: 'a' })).rejects.toMatchObject({ code: 'model_denied' })
  expect(f.calls()).toBe(0)
})
it.each([NaN, Infinity, -1, 0, 1.5] as const)('rejects unsafe Host budget bounds %s', value => {
  expect(() => fixture({ maxAmountMicros: value })).toThrowError(expect.objectContaining({ code: 'model_invalid' }))
})
it.each([NaN, Infinity, -1, 0, 1.5] as const)('rejects unreliable amount admission %s', value => {
  const f = fixture({ prepare: async () => ({ modelId: 'host-choice', maxTokens: 1, maxAmountMicros: value, confirm: () => true }) })
  return expect(f.authority.requests.request(f.parent, f.snapshot, { text: 'a' })).rejects.toMatchObject({ code: 'model_denied' })
})
it('rejects parent revocation inside budget confirmation immediately before dispatch', async () => {
  const f = fixture({ prepare: async () => ({ modelId: 'host-choice', maxTokens: 1, maxAmountMicros: 1, confirm: () => { f.facts.approved = false; return true } }) })
  await expect(f.authority.requests.request(f.parent, f.snapshot, { text: 'a' })).rejects.toMatchObject({ code: 'model_denied' })
  expect(f.calls()).toBe(0)
})

it.each(['abort', 'deadline', 'timeout', 'deactivate', 'revoke', 'replacement'] as const)('settles a stalled adapter on %s and refuses late success', async kind => {
  let release!: (value: { text: string }) => void
  let started!: () => void
  const ready = new Promise<void>(resolve => { started = resolve })
  const f = fixture({ timeoutMs: 40, execute: () => { started(); return new Promise(resolve => { release = resolve }) } })
  if (kind === 'deadline') f.facts.deadlineMs = Date.now() + 20
  const pending = f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })
  const observed = pending.then(() => 'accepted', (error: { code: string }) => error.code)
  await ready
  if (kind === 'abort') f.controller.abort()
  if (kind === 'deactivate') f.authority.deactivate()
  if (kind === 'revoke') f.authority.revoke(f.parent)
  if (kind === 'replacement') f.service.registerSource({ ...source, generation: 'g2' })
  const expected = kind === 'abort' ? 'model_cancelled' : kind === 'deadline' || kind === 'timeout' ? 'model_deadline' : 'model_revoked'
  let watchdog: ReturnType<typeof setTimeout> | undefined
  try {
    expect(await Promise.race([observed, new Promise(resolve => { watchdog = setTimeout(() => resolve('still-pending'), 120) })])).toBe(expected)
  } finally { clearTimeout(watchdog); release({ text: 'late' }) }
  expect(await observed).toBe(expected)
})
it('bounds nonresponsive Host admission by the parent deadline', async () => {
  const f = fixture({ timeoutMs: 20, prepare: () => new Promise(() => {}) })
  const pending = f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })
  const observed = pending.then(() => 'accepted', (error: { code: string }) => error.code)
  let watchdog: ReturnType<typeof setTimeout> | undefined
  try { expect(await Promise.race([observed, new Promise(resolve => { watchdog = setTimeout(() => resolve('still-pending'), 80) })])).toBe('model_deadline') }
  finally { clearTimeout(watchdog); f.controller.abort() }
})
it.each(['sessionId', 'turnId', 'invocationId', 'parentRequestId', 'generation', 'signal'] as const)('fences changed parent %s after adapter await', async key => {
  let release!: (value: { text: string }) => void
  let started!: () => void
  const ready = new Promise<void>(resolve => { started = resolve })
  const f = fixture({ execute: () => { started(); return new Promise(resolve => { release = resolve }) } })
  const pending = f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })
  await ready
  Object.assign(f.facts, { [key]: key === 'signal' ? new AbortController().signal : 'foreign' })
  release({ text: 'late' })
  await expect(pending).rejects.toMatchObject({ code: 'model_denied' })
})
it('rejects an expired parent before Host admission', async () => {
  const f = fixture()
  f.facts.deadlineMs = Date.now() - 1
  await expect(f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })).rejects.toMatchObject({ code: 'model_deadline' })
  expect(f.calls()).toBe(0)
})

it.each(['authenticate', 'prepare', 'execute'] as const)('redacts unknown %s exceptions as structured errors', async key => {
  const f = fixture({ [key]: () => { throw new Error('synthetic-private-credential') } })
  const error = await f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' }).catch(error => error)
  expect(error).toMatchObject({ code: key === 'authenticate' ? 'model_denied' : 'model_host_failed', message: 'Model request rejected.' })
  expect(error).not.toHaveProperty('stack')
  expect(JSON.stringify(error)).not.toContain('synthetic-private')
})
it.each(['credential', 'getter', 'nontext'] as const)('rejects unsafe adapter %s response', async kind => {
  const result = kind === 'credential' ? { text: 'result', credential: 'synthetic-private' } : kind === 'getter'
    ? { get text() { throw new Error('synthetic-private') } } : { text: 1 }
  const f = fixture({ execute: async () => result as never })
  await expect(f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })).rejects.toMatchObject({ code: 'model_host_failed' })
})
it('records Host provenance without prompts, credentials or raw results at an explicitly unwired seam', async () => {
  let received: unknown
  const f = fixture({ execute: async request => { received = request; return { text: 'private-result' } } })
  await f.authority.requests.request(f.parent, f.snapshot, { text: 'private-prompt' })
  expect(f.service.hostAdapterSeam.connected).toBe(false)
  const records = f.service.hostAdapterSeam.auditRecords()
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({ ...identity, ...source, status: 'accepted', reservedTokens: 10, reservedAmountMicros: 100 })
  expect(received).toMatchObject({ requestId: records[0].requestId, ...identity, ...source })
  expect(JSON.stringify(records)).not.toMatch(/private-prompt|private-result|credential|signal/)
  expect(Object.isFrozen(records[0])).toBe(true)
})
it('retains cancellation audit and worst-case reservation rather than refunding uncertain dispatch', async () => {
  let started!: () => void
  const ready = new Promise<void>(resolve => { started = resolve })
  const f = fixture({ maxRequests: 1, execute: () => { started(); return new Promise(() => {}) } })
  const pending = f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })
  const observed = pending.catch(error => error)
  await ready
  f.authority.revoke(f.parent)
  expect(await observed).toMatchObject({ code: 'model_revoked' })
  expect(f.service.hostAdapterSeam.auditRecords()[0]).toMatchObject({ status: 'rejected', code: 'model_revoked', reservedTokens: 10, reservedAmountMicros: 100 })
})

it.each(['revocation', 'deactivate', 'deadline'] as const)('fences %s during final Host confirmation', async kind => {
  const f = fixture({ confirmFinal: () => {
    if (kind === 'revocation') f.facts.approved = false
    if (kind === 'deactivate') f.authority.deactivate()
    if (kind === 'deadline') f.facts.deadlineMs = Date.now() - 1
    return true
  } })
  await expect(f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })).rejects.toMatchObject({ code: kind === 'revocation' ? 'model_denied' : kind === 'deactivate' ? 'model_revoked' : 'model_deadline' })
  expect(f.calls()).toBe(0)
})
it('does not allow a parent grant to be rebound to another turn after a successful request', async () => {
  const f = fixture()
  await f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })
  f.facts.turnId = 'another-turn'
  await expect(f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })).rejects.toMatchObject({ code: 'model_denied' })
  expect(f.calls()).toBe(1)
})
it.each(['empty', 'getter', 'proxy'] as const)('sanitizes invalid Host source %s', kind => {
  const f = fixture()
  const candidate = kind === 'empty' ? { ...source, sourceId: '' } : kind === 'getter' ? { ...source, get sourceId() { throw new Error('synthetic-private') } }
    : new Proxy({}, { ownKeys() { throw new Error('synthetic-private') } })
  expect(() => f.service.registerSource(candidate as never)).toThrowError(expect.objectContaining({ code: 'model_invalid' }))
})
it('whitelists exact source provenance instead of exposing extra Host fields', async () => {
  const f = fixture()
  const authority = f.service.registerSource({ ...source, sourceId: 'other', credential: 'synthetic-private' } as never)
  f.facts.sourceId = 'other'
  await authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })
  expect(JSON.stringify(f.service.hostAdapterSeam.auditRecords())).not.toContain('synthetic-private')
})
it('shares invocation budget across distinct approved parents and independent sources', async () => {
  const a = Object.freeze({})
  const b = Object.freeze({})
  const snapshot = Object.freeze({})
  const second = { ...source, sourceId: 'second', packageName: 'second-package' }
  const signal = new AbortController().signal
  let calls = 0
  const service = createPluginModelRequestService({ maxRequests: 1, maxTokens: 10, maxAmountMicros: 100, timeoutMs: 1000,
    authenticate: parent => ({ ...identity, ...(parent === a ? source : second), parentRequestId: parent === a ? 'parent-a' : 'parent-b', approved: true, signal, deadlineMs: Date.now() + 10000 }),
    confirmFinal: () => true,
    prepare: async () => ({ modelId: 'host-choice', maxTokens: 10, maxAmountMicros: 100, confirm: () => true }),
    execute: async () => { calls++; return { text: 'neutral' } } })
  const outcomes = await Promise.allSettled([
    service.registerSource(source).requests.request(a, snapshot, { text: 'a' }),
    service.registerSource(second).requests.request(b, snapshot, { text: 'b' })
  ])
  expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1)
  expect(outcomes.find(item => item.status === 'rejected')).toMatchObject({ reason: { code: 'model_limit' } })
  expect(calls).toBe(1)
})

it.each(['falsy', 'proxy', 'forged-error', 'rejecting-promise'] as const)('sanitizes %s adapter rejection without trusting exception shape', async kind => {
  const f = fixture({ execute: () => {
    if (kind === 'rejecting-promise') return Promise.reject(new Error('synthetic-private'))
    if (kind === 'proxy') throw new Proxy({}, { getPrototypeOf() { throw new Error('synthetic-private') } })
    if (kind === 'forged-error') throw { name: 'PluginModelRequestError', code: 'synthetic-private', stack: 'synthetic-private' }
    throw undefined
  } })
  const error = await f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' }).catch(error => error)
  expect(error).toMatchObject({ code: 'model_host_failed' })
  expect(error).not.toHaveProperty('stack')
  expect(JSON.stringify(error)).not.toContain('synthetic-private')
})
it('audits invalid plugin authority under the authenticated parent without retaining the payload', async () => {
  const f = fixture()
  await expect(f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral', credential: 'synthetic-private' } as never)).rejects.toMatchObject({ code: 'model_invalid' })
  expect(f.service.hostAdapterSeam.auditRecords()[0]).toMatchObject({ parentRequestId: identity.parentRequestId, status: 'rejected', code: 'model_invalid', reservedTokens: 0 })
  expect(JSON.stringify(f.service.hostAdapterSeam.auditRecords())).not.toContain('synthetic-private')
})
it('does not forward extra authenticated Host metadata to budget admission', async () => {
  let received: unknown
  const f = fixture({ prepare: async facts => { received = facts; return { modelId: 'host-choice', maxTokens: 1, maxAmountMicros: 1, confirm: () => true } } })
  Object.assign(f.facts, { credential: 'synthetic-private' })
  await f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })
  expect(JSON.stringify(received)).not.toContain('synthetic-private')
})

it('confirms the budget after final authorization has changed budget state', async () => {
  let allowed = true
  const f = fixture({
    prepare: async () => ({ modelId: 'host-choice', maxTokens: 1, maxAmountMicros: 1, confirm: () => allowed }),
    confirmFinal: () => { allowed = false; return true }
  })
  await expect(f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })).rejects.toMatchObject({ code: 'model_denied' })
  expect(f.calls()).toBe(0)
})
it.each(['authorization', 'budget'] as const)('denies rejecting asynchronous %s confirmation without unhandled rejection', async kind => {
  const f = fixture(kind === 'authorization' ? { confirmFinal: (() => Promise.reject(new Error('synthetic-private'))) as never }
    : { prepare: async () => ({ modelId: 'host-choice', maxTokens: 1, maxAmountMicros: 1, confirm: (() => Promise.reject(new Error('synthetic-private'))) as never }) })
  await expect(f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })).rejects.toMatchObject({ code: 'model_denied' })
  expect(f.calls()).toBe(0)
})

it.each(['promise', 'thenable'] as const)('rejects decorated %s authentication before prepare or execute', async kind => {
  let prepareCalls = 0
  const f = fixture({
    authenticate: (parent, snapshot) => parent === f.parent && snapshot === f.snapshot
      ? Object.assign(kind === 'promise' ? Promise.resolve(undefined) : { then: (resolve: (value: undefined) => void) => resolve(undefined) }, f.facts) as never
      : undefined,
    prepare: async () => { prepareCalls++; return { modelId: 'host-choice', maxTokens: 10, maxAmountMicros: 100, confirm: () => true } }
  })
  const outcome = await f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' }).then(
    value => ({ status: 'accepted', value }), error => ({ status: 'rejected', code: error.code, message: error.message }))
  expect({ outcome, prepareCalls, executeCalls: f.calls() }).toEqual({
    outcome: { status: 'rejected', code: 'model_denied', message: 'Model request rejected.' }, prepareCalls: 0, executeCalls: 0
  })
  expect(f.service.hostAdapterSeam.auditRecords()).toEqual([])
})

it('rejects a native Promise authenticator even when decorators hide then', async () => {
  let prepareCalls = 0
  const f = fixture({
    authenticate: () => Object.assign(Promise.resolve(undefined), f.facts, { then: undefined, catch: () => {} }) as never,
    prepare: async () => { prepareCalls++; return { modelId: 'host-choice', maxTokens: 10, maxAmountMicros: 100, confirm: () => true } }
  })
  const outcome = await f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' }).then(
    () => 'accepted', error => error.code)
  expect({ outcome, prepareCalls, executeCalls: f.calls() }).toEqual({ outcome: 'model_denied', prepareCalls: 0, executeCalls: 0 })
})

it('rejects thenable authentication before a changing then getter can hide it', async () => {
  let thenReads = 0
  let prepareCalls = 0
  const f = fixture({
    authenticate: () => Object.assign({ get then() { return thenReads++ === 0 ? (resolve: (value: undefined) => void) => resolve(undefined) : undefined } }, f.facts) as never,
    prepare: async () => { prepareCalls++; return { modelId: 'host-choice', maxTokens: 10, maxAmountMicros: 100, confirm: () => true } }
  })
  const outcome = await f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' }).then(
    () => 'accepted', error => error.code)
  expect({ outcome, prepareCalls, executeCalls: f.calls() }).toEqual({ outcome: 'model_denied', prepareCalls: 0, executeCalls: 0 })
})

// Controls for immediate denial and no decorated-fact inspection; no new production behavior.
it.each(['promise', 'thenable'] as const)('denies nonsettling %s authentication without reading decorated facts', async kind => {
  let factReads = 0
  let prepareCalls = 0
  const asynchronous = kind === 'promise' ? new Promise(() => {}) : { then: () => {} }
  Object.defineProperty(asynchronous, 'approved', { get() { factReads++; throw new Error('synthetic-private-credential') } })
  const f = fixture({
    authenticate: (() => asynchronous) as never,
    prepare: async () => { prepareCalls++; return { modelId: 'host-choice', maxTokens: 10, maxAmountMicros: 100, confirm: () => true } }
  })
  const error = await f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' }).catch(error => error)
  expect(error).toMatchObject({ code: 'model_denied', message: 'Model request rejected.' })
  expect(error).not.toHaveProperty('stack')
  expect(JSON.stringify(error)).not.toContain('synthetic-private')
  expect({ factReads, prepareCalls, executeCalls: f.calls() }).toEqual({ factReads: 0, prepareCalls: 0, executeCalls: 0 })
})

it('denies rejecting asynchronous authentication without unhandled rejection', async () => {
  const f = fixture({ authenticate: (() => Promise.reject(new Error('synthetic-private'))) as never })
  await expect(f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })).rejects.toMatchObject({ code: 'model_denied' })
})
it.each(['parent', 'snapshot'] as const)('rejects primitive %s authority even if an invalid Host authenticator accepts it', async kind => {
  const f = fixture()
  const other = fixture({ authenticate: () => f.facts })
  await expect(other.authority.requests.request(kind === 'parent' ? 'primitive' as never : other.parent, kind === 'snapshot' ? null as never : other.snapshot, { text: 'neutral' })).rejects.toMatchObject({ code: 'model_denied' })
})

it.each(['abort', 'deactivate'] as const)('fences %s during plugin input inspection before even starting budget admission', async kind => {
  let prepared = 0
  const f = fixture({ timeoutMs: 20, prepare: () => { prepared++; return new Promise(() => {}) } })
  const input = new Proxy({ text: 'neutral' }, { ownKeys(target) { if (kind === 'abort') f.controller.abort(); else f.authority.deactivate(); return Reflect.ownKeys(target) } })
  await expect(f.authority.requests.request(f.parent, f.snapshot, input)).rejects.toMatchObject({ code: kind === 'abort' ? 'model_cancelled' : 'model_revoked' })
  expect(prepared).toBe(0)
})

it('rejects authorization revoked during adapter result inspection before final delivery', async () => {
  const f = fixture({ execute: async () => new Proxy({ text: 'late' }, { ownKeys(target) { f.facts.approved = false; return Reflect.ownKeys(target) } }) })
  await expect(f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })).rejects.toMatchObject({ code: 'model_denied' })
  expect(f.service.hostAdapterSeam.auditRecords()[0]).toMatchObject({ status: 'rejected', code: 'model_denied' })
})

// Positive and already-covered negative controls; not counted as new feature REDs.
it.each(['copied-parent', 'foreign-parent', 'copied-snapshot'] as const)('rejects %s with the canonical Host authenticator', async kind => {
  const f = fixture()
  const foreign = fixture()
  await expect(f.authority.requests.request(kind === 'copied-parent' ? { ...f.parent } : kind === 'foreign-parent' ? foreign.parent : f.parent,
    kind === 'copied-snapshot' ? { ...f.snapshot } : f.snapshot, { text: 'neutral' })).rejects.toMatchObject({ code: 'model_denied' })
  expect(f.calls()).toBe(0)
})
it.each(['revoke', 'deactivate', 'abort'] as const)('keeps %s authority unavailable on later requests', async kind => {
  const f = fixture()
  if (kind === 'revoke') f.authority.revoke(f.parent)
  if (kind === 'deactivate') f.authority.deactivate()
  if (kind === 'abort') f.controller.abort()
  const authority = f.service.registerSource({ ...source })
  expect(authority).toBe(f.authority)
  await expect(authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })).rejects.toMatchObject({ code: kind === 'abort' ? 'model_cancelled' : 'model_revoked' })
  expect(f.calls()).toBe(0)
})
it('uses the shortened authenticated deadline after admission', async () => {
  let release!: (lease: { modelId: string; maxTokens: number; maxAmountMicros: number; confirm(): boolean }) => void
  let received: number | undefined
  const f = fixture({ prepare: () => new Promise(resolve => { release = resolve }), execute: async request => { received = request.deadlineMs; return { text: 'neutral' } } })
  const pending = f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })
  f.facts.deadlineMs = Date.now() + 200
  release({ modelId: 'host-choice', maxTokens: 1, maxAmountMicros: 1, confirm: () => true })
  await pending
  expect(received).toBe(f.facts.deadlineMs)
})
it('does not extend a parent grant deadline authenticated on its first request', async () => {
  const deadlines: number[] = []
  const f = fixture({ execute: async request => { deadlines.push(request.deadlineMs); return { text: 'neutral' } } })
  f.facts.deadlineMs = Date.now() + 500
  const original = f.facts.deadlineMs
  await f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })
  f.facts.deadlineMs = Date.now() + 10000
  await f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })
  expect(deadlines).toEqual([original, original])
})

it('retains a failed dispatch reservation for a later request', async () => {
  const f = fixture({ maxRequests: 1, execute: async () => { throw new Error('synthetic-private') } })
  await expect(f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })).rejects.toMatchObject({ code: 'model_host_failed' })
  await expect(f.authority.requests.request(f.parent, f.snapshot, { text: 'neutral' })).rejects.toMatchObject({ code: 'model_limit' })
  expect(f.service.hostAdapterSeam.auditRecords().map(record => record.code)).toEqual(['model_host_failed', 'model_limit'])
})
