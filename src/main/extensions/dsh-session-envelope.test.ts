import { test } from 'vitest'
import { expect } from 'vitest'
import { DshSessionEnvelopeCache } from './dsh-session-envelope.js'

const base = {
  packageName: '@sciforge/plugin-test',
  generation: 1,
  caller: { audience: 'agent', callerId: 'caller-1' },
  ordinarySession: { runtimeId: 'runtime-1', threadId: 'thread-1' },
  context: { origin: 'agent' }
}

function fixture() {
  const opened: string[] = []
  const cache = new DshSessionEnvelopeCache(async (input) => {
    const id = `session-${input.packageName}-${input.generation}-${input.runtimeId}-${input.threadId}`
    opened.push(id)
    return id
  })
  return { cache, opened }
}

test('opens one synthetic session per thread and reuses its id', async () => {
  const { cache, opened } = fixture()
  const first = await cache.envelopeFor(base)
  const second = await cache.envelopeFor(base)
  expect(opened.length).toBe(1)
  expect(first.ordinarySession.sessionId).toBe(second.ordinarySession.sessionId)
  expect(first.caller).toEqual(base.caller)
  expect(first.context).toEqual(base.context)
  expect(first.ordinarySession.runtimeId).toBe('runtime-1')
  expect(first.ordinarySession.threadId).toBe('thread-1')
})

test('a different thread or generation gets its own session', async () => {
  const { cache, opened } = fixture()
  const first = await cache.envelopeFor(base)
  const otherThread = await cache.envelopeFor({
    ...base,
    ordinarySession: { runtimeId: 'runtime-1', threadId: 'thread-2' }
  })
  const nextGeneration = await cache.envelopeFor({ ...base, generation: 2 })
  expect(opened.length).toBe(3)
  expect(first.ordinarySession.sessionId).not.toBe(otherThread.ordinarySession.sessionId)
  expect(first.ordinarySession.sessionId).not.toBe(nextGeneration.ordinarySession.sessionId)
})

test('dropPackage only forgets that plugin', async () => {
  const { cache, opened } = fixture()
  await cache.envelopeFor(base)
  await cache.envelopeFor({ ...base, packageName: '@sciforge/plugin-other' })
  cache.dropPackage('@sciforge/plugin-test')
  await cache.envelopeFor(base)
  expect(opened.length).toBe(3)
  expect(cache.size).toBe(2)
})

test('a failed open propagates and is never downgraded to a session-less call', async () => {
  const cache = new DshSessionEnvelopeCache(async () => {
    throw new Error('synthetic session unavailable')
  })
  await expect(cache.envelopeFor(base)).rejects.toThrow(/synthetic session unavailable/)
  expect(cache.size).toBe(0)
})

test('an empty session id is rejected', async () => {
  const cache = new DshSessionEnvelopeCache(async () => '')
  await expect(cache.envelopeFor(base)).rejects.toThrow(/returned no session id/)
  expect(cache.size).toBe(0)
})

test('capacity rejects new threads without forgetting live child sessions', async () => {
  const opened: string[] = []
  const cache = new DshSessionEnvelopeCache(async (input) => {
    const id = `session-${input.threadId}`
    opened.push(id)
    return id
  }, 2)
  await cache.envelopeFor({ ...base, ordinarySession: { runtimeId: 'r', threadId: 't1' } })
  await cache.envelopeFor({ ...base, ordinarySession: { runtimeId: 'r', threadId: 't2' } })
  await expect(cache.envelopeFor({ ...base, ordinarySession: { runtimeId: 'r', threadId: 't3' } })).rejects.toThrow(/capacity/)
  expect(cache.size).toBe(2)
  await cache.envelopeFor({ ...base, ordinarySession: { runtimeId: 'r', threadId: 't1' } })
  expect(opened.length).toBe(2)
})

function deferred() {
  let resolve!: (value: string) => void
  let reject!: (error: Error) => void
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('concurrent callers share one pending open but retain their own context', async () => {
  const open = deferred()
  let calls = 0
  const cache = new DshSessionEnvelopeCache(() => { calls++; return open.promise })
  const first = cache.envelopeFor(base)
  const second = cache.envelopeFor({ ...base, context: { origin: 'other' } })
  await Promise.resolve()
  expect(calls).toBe(1)
  open.resolve('shared')
  expect((await first).context).toEqual(base.context)
  expect((await second).context).toEqual({ origin: 'other' })
})

for (const action of ['dropPackage', 'clear'] as const) {
  test(`${action} invalidates all waiters and late completion cannot refill the cache`, async () => {
    const open = deferred()
    const cache = new DshSessionEnvelopeCache(() => open.promise)
    const first = cache.envelopeFor(base)
    const second = cache.envelopeFor(base)
    const results = Promise.allSettled([first, second])
    await Promise.resolve()
    if (action === 'clear') cache.clear()
    else cache.dropPackage(base.packageName)
    open.resolve('stale')
    expect((await results).map(result => result.status)).toEqual(['rejected', 'rejected'])
    expect(cache.size).toBe(0)
  })
}

test('a stale rejection cannot remove the replacement entry', async () => {
  const old = deferred()
  let calls = 0
  const cache = new DshSessionEnvelopeCache(() => ++calls === 1 ? old.promise : Promise.resolve('new'))
  const first = cache.envelopeFor(base)
  const rejected = expect(first).rejects.toThrow('old failure')
  await Promise.resolve()
  cache.dropPackage(base.packageName)
  expect((await cache.envelopeFor(base)).ordinarySession.sessionId).toBe('new')
  old.reject(new Error('old failure'))
  await rejected
  expect((await cache.envelopeFor(base)).ordinarySession.sessionId).toBe('new')
  expect(calls).toBe(2)
})

test('failed concurrent creation can be retried and pending opens count toward capacity', async () => {
  const open = deferred()
  let calls = 0
  const cache = new DshSessionEnvelopeCache(() => ++calls === 1 ? open.promise : Promise.resolve('retry'), 1)
  const results = Promise.allSettled([cache.envelopeFor(base), cache.envelopeFor(base)])
  await Promise.resolve()
  await expect(cache.envelopeFor({ ...base, generation: 2 })).rejects.toThrow(/capacity/)
  open.reject(new Error('failed'))
  expect((await results).map(result => result.status)).toEqual(['rejected', 'rejected'])
  expect(cache.size).toBe(0)
  expect((await cache.envelopeFor(base)).ordinarySession.sessionId).toBe('retry')
})
