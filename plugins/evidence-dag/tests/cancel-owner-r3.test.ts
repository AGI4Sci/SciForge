import { it, expect } from 'vitest'
import { EvidenceRuntime } from '../src/runtime.js'
import { artifactFixture } from './artifact-fixture.js'

const observe = <T>(work: Promise<T>, ms = 300) => Promise.race([
  work.then(value => ({ settled: true, value }), error => ({ settled: true, error })),
  new Promise<{ settled: false }>(resolve => setTimeout(() => resolve({ settled: false }), ms)),
])

it('ED-R3-01 retains nonquiescent cancellation after original work settles until confirmed retry', async () => {
  const f = await artifactFixture()
  let enter!: () => void, release!: () => void, cancels = 0, confirmed = false
  const entered = new Promise<void>(r => { enter = r }), held = new Promise<void>(r => { release = r })
  const runtime = new EvidenceRuntime({ ...f.ports, request: async r => {
    if (r.operation === 'threads.read') { enter(); await held }
    return f.ports.request(r)
  }, cancel: async () => { cancels++; release(); return { cancelled: true, quiescent: confirmed } } }, { closeTimeoutMs: 30 })
  await runtime.start()
  const work = observe(runtime.update(f.scope))
  await entered
  try {
    const first = runtime.close(); expect(runtime.close()).toBe(first)
    await expect(first).rejects.toThrow('close failed')
    expect((await work).settled).toBe(true)
    const second = runtime.close(); expect(runtime.close()).toBe(second)
    await expect(second).rejects.toThrow('close failed')
    expect(cancels).toBe(2)
    confirmed = true
    const retry = runtime.close(); expect(runtime.close()).toBe(retry); await retry
    expect(cancels).toBe(3)
    await runtime.close(); expect(cancels).toBe(3)
  } finally { confirmed = true; release(); await work; await runtime.close().catch(() => undefined) }
})

it.each([undefined, null, false, new Error('cancel denied')])('ED-R3-01 retains rejected cancellation reason %s after request settlement', async reason => {
  const f = await artifactFixture()
  let enter!: () => void, release!: () => void, authorized = false, cancels = 0
  const entered = new Promise<void>(r => { enter = r }), held = new Promise<void>(r => { release = r })
  const runtime = new EvidenceRuntime({ ...f.ports, request: async r => {
    if (r.operation === 'threads.read') { enter(); await held }
    return f.ports.request(r)
  }, cancel: async () => { cancels++; release(); if (!authorized) throw reason; return { cancelled: true, quiescent: true } } }, { closeTimeoutMs: 30 })
  await runtime.start(); const work = observe(runtime.update(f.scope)); await entered
  try {
    await expect(runtime.close()).rejects.toThrow('close failed')
    expect((await work).settled).toBe(true)
    await expect(runtime.close()).rejects.toThrow('close failed'); expect(cancels).toBe(2)
    authorized = true; await runtime.close(); expect(cancels).toBe(3)
  } finally { authorized = true; release(); await work; await runtime.close().catch(() => undefined) }
})

it('ED-R3-01 cancellation timeout settles original work and fences late confirmation across retries', async () => {
  const f = await artifactFixture()
  let enter!: () => void, release!: () => void, late!: (v: { cancelled: boolean; quiescent: boolean }) => void
  let cancels = 0, authorized = false
  const entered = new Promise<void>(r => { enter = r }), held = new Promise<void>(r => { release = r })
  const oldCancel = new Promise<{ cancelled: boolean; quiescent: boolean }>(r => { late = r })
  const runtime = new EvidenceRuntime({ ...f.ports, request: async r => {
    if (r.operation === 'threads.read') { enter(); await held }
    return f.ports.request(r)
  }, cancel: async () => {
    cancels++; release()
    if (cancels === 1) return oldCancel
    // A stale true arrives while the current retry is running. It cannot
    // release that retry's owner or override its explicit false receipt.
    late({ cancelled: true, quiescent: true }); await Promise.resolve()
    return { cancelled: true, quiescent: authorized }
  } }, { closeTimeoutMs: 30 })
  await runtime.start(); const work = observe(runtime.update(f.scope)); await entered
  try {
    await expect(runtime.close()).rejects.toThrow('close failed')
    expect((await work).settled, 'cancel timeout must not strand request settlement').toBe(true)
    await expect(runtime.close()).rejects.toThrow('close failed')
    await expect(runtime.close()).rejects.toThrow('close failed'); expect(cancels).toBe(3)
    authorized = true; await runtime.close(); expect(cancels).toBe(4)
  } finally { authorized = true; late({ cancelled: true, quiescent: true }); release(); await work; await runtime.close().catch(() => undefined) }
})

it('ED-R3-01 normally settled requests release owners without cancellation', async () => {
  const f = await artifactFixture(); let cancels = 0
  const runtime = new EvidenceRuntime({ ...f.ports, cancel: async () => { cancels++; return { cancelled: true, quiescent: true } } })
  await runtime.start()
  for (let n = 0; n < 20; n++) await runtime.snapshotStatus(f.scope)
  expect((runtime as unknown as { activeRequests: Map<string, unknown> }).activeRequests.size).toBe(0)
  await runtime.close(); expect(cancels).toBe(0)
})

it('ED-R3-01 request settlement still rejects a cancellation failure that preceded its response', async () => {
  const f = await artifactFixture(); let enter!: () => void, release!: () => void, authorized = false
  const entered = new Promise<void>(r => { enter = r }), held = new Promise<void>(r => { release = r })
  const runtime = new EvidenceRuntime({ ...f.ports, request: async r => {
    if (r.operation === 'threads.read') { enter(); await held }
    return f.ports.request(r)
  }, cancel: async () => ({ cancelled: true, quiescent: authorized }) }, { closeTimeoutMs: 30 })
  await runtime.start()
  // Exercise the canonical request seam directly: downstream close fences
  // must not hide a successful late value from a failed cancellation.
  const request = (runtime as unknown as { request(operation: 'threads.read', input: {}, scope: typeof f.scope): Promise<unknown> }).request('threads.read', {}, f.scope)
  const outcome = request.then(() => ({ rejected: false }), error => ({ rejected: true, error }))
  await entered
  try {
    await expect(runtime.close()).rejects.toThrow('close failed'); release()
    expect(await outcome).toMatchObject({ rejected: true, error: { code: 'CANCEL_NOT_QUIESCENT' } })
    authorized = true; await runtime.close()
  } finally { authorized = true; release(); await outcome; await runtime.close().catch(() => undefined) }
})

it('ED-R3-01 successful invocation cancel is cleaned once even when close follows', async () => {
  const f = await artifactFixture(); let enter!: () => void, release!: () => void, cancels = 0
  const entered = new Promise<void>(r => { enter = r }), held = new Promise<void>(r => { release = r })
  const runtime = new EvidenceRuntime({ ...f.ports, request: async r => {
    if (r.operation === 'threads.read') { enter(); await held }
    return f.ports.request(r)
  }, cancel: async () => { cancels++; return { cancelled: true, quiescent: true } } })
  await runtime.start(); const controller = new AbortController()
  const work = observe(runtime.withInvocation({ callId: 'synthetic' }, controller.signal, () => runtime.update(f.scope)))
  await entered; controller.abort(); await new Promise(r => setTimeout(r, 0))
  const closing = runtime.close(); expect(runtime.close()).toBe(closing); release()
  await closing; await work; await runtime.close(); expect(cancels).toBe(1)
  expect((runtime as unknown as { activeRequests: Map<string, unknown> }).activeRequests.size).toBe(0)
})
