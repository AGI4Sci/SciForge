import { expect, it } from 'vitest'
import type { PluginContextMaterial } from './context-contribution-service'
import { createContextContributionService } from './context-contribution-service'

const source = { sourceId: 'neutral-source', packageVersion: '1.0.0', generation: 'g1' }
const identity = { callerId: 'neutral-caller', sessionId: 's1', turnId: 't1', invocationId: 'i1' }
function fixture() {
  const invocation = Object.freeze({ context: { topic: 'neutral' } })
  const controller = new AbortController()
  const facts = { ...identity, ...source, snapshot: invocation, signal: controller.signal, deadlineMs: Date.now() + 10000 }
  const service = createContextContributionService({ maxItemBytes: 4, maxInvocationBytes: 6, timeoutMs: 1000,
    authenticate: (candidate: object) => candidate === invocation ? facts : undefined })
  const authority = service.registerSource(source)
  return { service, authority, invocation, controller, facts }
}

it.each(['forged', 'copied', 'foreign', 'equal-snapshot', 'stale-generation'] as const)('rejects %s authority before invoking a producer', async (kind) => {
  const { authority, invocation, facts } = fixture()
  const grant = authority.issueGrant(invocation)
  const other = fixture()
  const candidate = kind === 'forged' ? {} : kind === 'copied' ? { ...grant } : kind === 'foreign'
    ? other.authority.issueGrant(other.invocation) : grant
  const target = kind === 'equal-snapshot' ? structuredClone(invocation) : invocation
  if (kind === 'stale-generation') facts.generation = 'g2'
  let calls = 0
  await expect(authority.contributions.collect(candidate, target, async () => { calls++; return { kind: 'plugin-material', text: 'x' } }))
    .rejects.toMatchObject({ code: 'context_denied' })
  expect(calls).toBe(0)
})

it.each(['forged', 'copied', 'foreign', 'equal-snapshot', 'session', 'turn', 'invocation'] as const)('rejects %s contribution tokens at the Host seam', async (kind) => {
  const { service, authority, invocation, facts } = fixture()
  const token = await authority.contributions.collect(authority.issueGrant(invocation), invocation, async () => ({ kind: 'plugin-material', text: 'x' }))
  const other = fixture()
  const foreign = await other.authority.contributions.collect(other.authority.issueGrant(other.invocation), other.invocation, async () => ({ kind: 'plugin-material', text: 'x' }))
  if (kind === 'session') facts.sessionId = 'foreign'
  if (kind === 'turn') facts.turnId = 'foreign'
  if (kind === 'invocation') facts.invocationId = 'foreign'
  expect(() => service.hostAdapterSeam.read(kind === 'forged' ? {} : kind === 'copied' ? { ...token } : kind === 'foreign' ? foreign : token,
    kind === 'equal-snapshot' ? structuredClone(invocation) : invocation)).toThrowError(expect.objectContaining({ code: 'context_denied' }))
})

it.each(['user-instruction', 'extra-authority', 'getter', 'proxy', 'producer-error'] as const)('rejects %s without exposing private errors', async (kind) => {
  const { authority, invocation } = fixture()
  const material = kind === 'getter' ? { kind: 'plugin-material', get text() { throw new Error('private-detail') } }
    : kind === 'proxy' ? new Proxy({}, { ownKeys() { throw new Error('private-detail') } })
      : kind === 'extra-authority' ? { kind: 'plugin-material', text: 'x', sourceId: 'fake' }
        : { kind: 'user-instruction', text: 'x' }
  let caught: unknown
  try { await authority.contributions.collect(authority.issueGrant(invocation), invocation, async () => {
    if (kind === 'producer-error') throw new Error('private-detail')
    return material as never
  }) } catch (error) { caught = error }
  expect(caught).toMatchObject({ code: kind === 'producer-error' ? 'context_producer_failed' : 'context_invalid' })
  expect(caught).not.toHaveProperty('stack')
  expect(JSON.stringify(caught)).not.toContain('private-detail')
})

it('enforces UTF-8 item size before minting a token', async () => {
  const { authority, invocation } = fixture()
  await expect(authority.contributions.collect(authority.issueGrant(invocation), invocation,
    async () => ({ kind: 'plugin-material', text: '中中' }))).rejects.toMatchObject({ code: 'context_limit' })
})
it('shares aggregate quota across grants and equivalent authenticated snapshots', async () => {
  const { service, authority, invocation, facts } = fixture()
  await authority.contributions.collect(authority.issueGrant(invocation), invocation, async () => ({ kind: 'plugin-material', text: 'four' }))
  await expect(authority.contributions.collect(authority.issueGrant(invocation), invocation,
    async () => ({ kind: 'plugin-material', text: 'tri' }))).rejects.toMatchObject({ code: 'context_limit' })
  const equal = structuredClone(invocation)
  const shared = createContextContributionService({ maxItemBytes: 4, maxInvocationBytes: 6, timeoutMs: 1000,
    authenticate: (candidate: object) => ({ ...facts, snapshot: candidate }) })
  const first = shared.registerSource(source)
  await first.contributions.collect(first.issueGrant(invocation), invocation, async () => ({ kind: 'plugin-material', text: 'four' }))
  const second = shared.registerSource({ ...source })
  await expect(second.contributions.collect(second.issueGrant(equal), equal, async () => ({ kind: 'plugin-material', text: 'tri' })))
    .rejects.toMatchObject({ code: 'context_limit' })
  expect(service.hostAdapterSeam.connected).toBe(false)
})

it.each(['deactivate', 'revoke'] as const)('fences in-flight and issued tokens on %s', async (kind) => {
  const { authority, invocation, service } = fixture()
  const grant = authority.issueGrant(invocation)
  const token = await authority.contributions.collect(grant, invocation, async () => ({ kind: 'plugin-material', text: 'x' }))
  let release!: (value: { kind: 'plugin-material'; text: string }) => void
  const pending = authority.contributions.collect(grant, invocation, () => new Promise<PluginContextMaterial>(resolve => { release = resolve }))
  const result = expect(pending).rejects.toMatchObject({ code: 'context_revoked' })
  if (kind === 'deactivate') authority.deactivate()
  else authority.revoke(grant)
  release({ kind: 'plugin-material', text: 'x' })
  await result
  expect(() => service.hostAdapterSeam.read(token, invocation)).toThrowError(expect.objectContaining({ code: 'context_revoked' }))
  await expect(authority.contributions.collect(grant, invocation, async () => ({ kind: 'plugin-material', text: 'x' })))
    .rejects.toMatchObject({ code: 'context_revoked' })
})

it.each(['abort', 'deadline', 'timeout'] as const)('settles a stalled producer on %s and rejects late delivery', async (kind) => {
  const { authority, invocation, facts, controller, service } = fixture()
  if (kind === 'deadline') facts.deadlineMs = Date.now() + 15
  let release!: (value: { kind: 'plugin-material'; text: string }) => void
  const grant = authority.issueGrant(invocation)
  const pending = authority.contributions.collect(grant, invocation, () => new Promise<PluginContextMaterial>(resolve => { release = resolve }))
  const observed = pending.then(() => 'accepted', (error: { code: string }) => error.code)
  if (kind === 'abort') controller.abort()
  expect(await observed).toBe(kind === 'abort' ? 'context_cancelled' : 'context_deadline')
  release({ kind: 'plugin-material', text: 'late' })
  await Promise.resolve()
  await expect(authority.contributions.collect(grant, invocation, async () => ({ kind: 'plugin-material', text: 'x' })))
    .rejects.toMatchObject({ code: kind === 'abort' ? 'context_cancelled' : 'context_deadline' })
  expect(service.hostAdapterSeam.connected).toBe(false)
}, 1500)

it('settles a stalled producer at the authenticated deadline shortened after grant issuance', async () => {
  const { authority, invocation, facts } = fixture()
  const grant = authority.issueGrant(invocation)
  facts.deadlineMs = Date.now() + 40
  const deadlineMs = facts.deadlineMs
  let producerDeadline: number | undefined
  let watchdog: ReturnType<typeof setTimeout> | undefined
  try {
    const pending = authority.contributions.collect(grant, invocation, (context: { snapshot: object; signal: AbortSignal; deadlineMs: number }) => {
      producerDeadline = context.deadlineMs
      return new Promise<PluginContextMaterial>(() => {})
    })
    const observed = pending.then(() => 'accepted', (error: { code: string }) => error.code)
    const outcome = await Promise.race([
      observed,
      new Promise<string>(resolve => { watchdog = setTimeout(() => resolve('still-pending'), 120) })
    ])
    expect.soft(outcome).toBe('context_deadline')
    expect.soft(producerDeadline).toBe(deadlineMs)
  } finally {
    clearTimeout(watchdog)
    authority.revoke(grant)
  }
})

it('captures snapshot bytes at issuance before a producer await', async () => {
  const { authority, invocation, facts, service } = fixture()
  const grant = authority.issueGrant(invocation)
  let release!: (value: { kind: 'plugin-material'; text: string }) => void
  const pending = authority.contributions.collect(grant, invocation, () => new Promise<PluginContextMaterial>(resolve => { release = resolve }))
  invocation.context.topic = 'changed'
  release({ kind: 'plugin-material', text: 'x' })
  const token = await pending
  expect(service.hostAdapterSeam.read(token, invocation).snapshot).toEqual({ context: { topic: 'neutral' } })
  facts.snapshot = { context: { topic: 'foreign' } } as typeof invocation
  expect(() => service.hostAdapterSeam.read(token, invocation)).toThrowError(expect.objectContaining({ code: 'context_denied' }))
})

it.each([NaN, Infinity, -1, 0, 1.5] as const)('rejects unsafe Host bounds %s', value => {
  expect(() => createContextContributionService({ maxItemBytes: value, maxInvocationBytes: 6, timeoutMs: 1000, authenticate: () => undefined }))
    .toThrowError(expect.objectContaining({ code: 'context_invalid' }))
})
it.each(['deadline', 'signal', 'snapshot', 'authenticate'] as const)('rejects invalid authenticated %s facts without leaking exceptions', kind => {
  const { facts, invocation } = fixture()
  const service = createContextContributionService({ maxItemBytes: 4, maxInvocationBytes: 6, timeoutMs: 1000,
    authenticate: () => {
      if (kind === 'authenticate') throw new Error('private-detail')
      return { ...facts, ...(kind === 'deadline' ? { deadlineMs: NaN } : kind === 'signal' ? { signal: {} }
        : { snapshot: { context: new Date() } }) } as never
    } })
  expect(() => service.registerSource(source).issueGrant(invocation)).toThrowError(expect.objectContaining({ code: 'context_denied' }))
})

it('does not let re-registration reactivate a deactivated generation', () => {
  const { service, authority, invocation } = fixture()
  authority.deactivate()
  expect(() => service.registerSource({ ...source }).issueGrant(invocation)).toThrowError(expect.objectContaining({ code: 'context_revoked' }))
})
it('a new generation fences previously issued contribution tokens', async () => {
  const { service, authority, invocation, facts } = fixture()
  const token = await authority.contributions.collect(authority.issueGrant(invocation), invocation, async () => ({ kind: 'plugin-material', text: 'x' }))
  service.registerSource({ ...source, generation: 'g2' })
  expect(() => service.hostAdapterSeam.read(token, invocation)).toThrowError(expect.objectContaining({ code: 'context_revoked' }))
  expect(() => authority.issueGrant(invocation)).toThrowError(expect.objectContaining({ code: 'context_revoked' }))
  facts.generation = 'g2'
})

it('rejects simultaneous aggregate overflow across independent sources', async () => {
  const { facts, invocation } = fixture()
  const otherSource = { ...source, sourceId: 'other-source' }
  const otherInvocation = Object.freeze({ other: true })
  const service = createContextContributionService({ maxItemBytes: 4, maxInvocationBytes: 6, timeoutMs: 1000,
    authenticate: (candidate: object) => ({ ...facts, ...(candidate === otherInvocation ? otherSource : source), snapshot: candidate }) })
  const a = service.registerSource(source)
  const b = service.registerSource(otherSource)
  const outcomes = await Promise.allSettled([
    a.contributions.collect(a.issueGrant(invocation), invocation, async () => ({ kind: 'plugin-material', text: 'four' })),
    b.contributions.collect(b.issueGrant(otherInvocation), otherInvocation, async () => ({ kind: 'plugin-material', text: 'four' }))
  ])
  expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1)
  expect(outcomes.find(item => item.status === 'rejected')).toMatchObject({ reason: { code: 'context_limit' } })
})
it('returns a cooperative live signal and frozen snapshot to the producer', async () => {
  const { authority, invocation, service, controller } = fixture()
  let observed: unknown
  const token = await authority.contributions.collect(authority.issueGrant(invocation), invocation, async (context: { snapshot: object; signal: AbortSignal; deadlineMs: number }) => {
    observed = context
    return { kind: 'plugin-material', text: 'x' }
  })
  expect(observed).toMatchObject({ snapshot: invocation, signal: controller.signal })
  controller.abort()
  expect(() => service.hostAdapterSeam.read(token, invocation)).toThrowError(expect.objectContaining({ code: 'context_cancelled' }))
})

it.each(['empty', 'whitespace', 'getter', 'proxy'] as const)('rejects invalid Host source %s without an exception leak', kind => {
  const { service } = fixture()
  const candidate = kind === 'proxy' ? new Proxy({}, { ownKeys() { throw new Error('private-source') } })
    : kind === 'getter' ? { ...source, get sourceId() { throw new Error('private-source') } }
      : { ...source, sourceId: kind === 'empty' ? '' : ' neutral ' }
  expect(() => service.registerSource(candidate as never)).toThrowError(expect.objectContaining({ code: 'context_invalid' }))
})
it('settles a stalled producer immediately on revocation', async () => {
  const { authority, invocation } = fixture()
  const grant = authority.issueGrant(invocation)
  const pending = authority.contributions.collect(grant, invocation, () => new Promise<PluginContextMaterial>(() => {}))
  const observed = pending.then(() => 'accepted', (error: { code: string }) => error.code)
  authority.revoke(grant)
  expect(await observed).toBe('context_revoked')
}, 100)

it('fences a shortened authenticated deadline at the Host seam', async () => {
  const { service, authority, invocation, facts } = fixture()
  const token = await authority.contributions.collect(authority.issueGrant(invocation), invocation, async () => ({ kind: 'plugin-material', text: 'x' }))
  facts.deadlineMs = Date.now() - 1
  expect(() => service.hostAdapterSeam.read(token, invocation)).toThrowError(expect.objectContaining({ code: 'context_deadline' }))
})
it('settles an old stalled generation when a replacement is registered', async () => {
  const { service, authority, invocation } = fixture()
  const pending = authority.contributions.collect(authority.issueGrant(invocation), invocation, () => new Promise<PluginContextMaterial>(() => {}))
  const observed = pending.then(() => 'accepted', (error: { code: string }) => error.code)
  service.registerSource({ ...source, generation: 'g2' })
  expect(await observed).toBe('context_revoked')
}, 100)

it('rejects replacement of the live authenticated AbortSignal', async () => {
  const { service, authority, invocation, facts } = fixture()
  const token = await authority.contributions.collect(authority.issueGrant(invocation), invocation, async () => ({ kind: 'plugin-material', text: 'x' }))
  facts.signal = new AbortController().signal
  expect(() => service.hostAdapterSeam.read(token, invocation)).toThrowError(expect.objectContaining({ code: 'context_denied' }))
})

it('maps an uncloneable authenticated snapshot to a safe denial', () => {
  const { invocation, facts } = fixture()
  const service = createContextContributionService({ maxItemBytes: 4, maxInvocationBytes: 6, timeoutMs: 1000,
    authenticate: () => ({ ...facts, snapshot: new Proxy({ neutral: true }, {}) }) })
  expect(() => service.registerSource(source).issueGrant(invocation)).toThrowError(expect.objectContaining({ code: 'context_denied' }))
})

it('returns detached plugin material with fixed Host provenance through an explicitly unwired seam', async () => {
  const { service, authority, invocation } = fixture()
  const grant = authority.issueGrant(invocation)
  const token = await authority.contributions.collect(grant, invocation, async () => ({ kind: 'plugin-material', text: 'fact' }))
  expect(service.hostAdapterSeam.connected).toBe(false)
  expect(service.hostAdapterSeam.read(token, invocation)).toEqual({
    kind: 'plugin-material', source, invocation: identity, snapshot: invocation, text: 'fact'
  })
  expect(Object.isFrozen((service.hostAdapterSeam.read(token, invocation).snapshot as typeof invocation).context)).toBe(true)
})
