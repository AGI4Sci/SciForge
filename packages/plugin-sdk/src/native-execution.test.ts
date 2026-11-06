import test from 'node:test'
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createNativeExecutionClients, getNativeExecutionCommandRegistry, type NativeExecutionResult } from './native-execution.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const result = (text: string): NativeExecutionResult => ({ exitCode: 0, stdout: { text, lossy: false }, stderr: { text: '', lossy: false } })
function fixture() {
  let invocationId: string | undefined = 'invocation-1'
  const tokens = new Map<string, object>([['invocation-1', {}]])
  const calls: { serviceId: string; operation: string; input: unknown }[] = []
  const handlers: Record<string, (input: any) => unknown> = {
    'context.resolve': () => ({ workspaceRoot: '/workspace', policy: { workspaceRoot: '/workspace', mode: 'workspace-write', sessionId: 'session' } }),
    'process.spawn': () => ({ processId: 'process-1' }),
    'process.wait': () => result('wait'),
    'process.stop': () => result('stop'),
    'approval.request': () => 'rejected',
    'process.confine': () => ({ argv: ['opaque-plan'], enforcement: 'full' }),
  }
  const cancellation = deferred<{ cancelled: boolean; quiescent: boolean }>()
  let cancels = 0
  const bridge = {
    get invocationId() { return invocationId },
    get invocationToken() { return invocationId ? tokens.get(invocationId) : undefined },
    request(serviceId: string, operation: string, input: unknown) {
      if (!invocationId) throw new Error('No live invocation')
      calls.push({ serviceId, operation, input })
      return { requestId: String(calls.length), result: Promise.resolve(handlers[operation](input)), cancel: () => { cancels++; return cancellation.promise } }
    },
  }
  return { clients: createNativeExecutionClients(bridge), calls, handlers, cancellation, get cancels() { return cancels }, setInvocation(id?: string) { invocationId = id; if (id && !tokens.has(id)) tokens.set(id, {}) } }
}
const agent = { session: { id: 'session' } }
const spawnRequest = (signal: AbortSignal) => ({ argv: ['opaque-plan'], cwd: '/workspace', env: {}, stdio: { stdin: { data: '' }, stdout: { maxBytes: 64 }, stderr: { maxBytes: 64 } }, graceMs: 100, signal })

test('context cache requires ensure and a live matching invocation and signal', async () => {
  const f = fixture(), controller = new AbortController()
  assert.throws(() => f.clients.sandboxPolicy.resolve({ session: agent.session }), /ensure/)
  assert.equal(await f.clients.workingDirectory.ensure(agent, controller.signal), '/workspace')
  assert.equal(f.clients.sandboxPolicy.resolve({ session: { id: 'session' } }).mode, 'workspace-write')
  assert.deepEqual(f.calls[0], { serviceId: 'nativeExecution', operation: 'context.resolve', input: {} })
  f.setInvocation('invocation-2')
  assert.throws(() => f.clients.sandboxPolicy.resolve({ session: agent.session }), /ensure/)
  await f.clients.workingDirectory.ensure(agent, controller.signal)
  controller.abort()
  assert.throws(() => f.clients.sandboxPolicy.resolve({ session: agent.session }), /ensure/)
  await assert.rejects(f.clients.workingDirectory.ensure(agent, controller.signal))
})

test('stale async context response cannot authorize a new invocation', async () => {
  const f = fixture(), pending = deferred<unknown>()
  f.handlers['context.resolve'] = () => pending.promise
  const ensured = f.clients.workingDirectory.ensure(agent, new AbortController().signal)
  f.setInvocation('invocation-2')
  pending.resolve({ workspaceRoot: '/workspace', policy: { workspaceRoot: '/workspace', mode: 'workspace-write' } })
  await assert.rejects(ensured, /stale/)
})

test('overlapping invocations in one session retain independent policy caches', async () => {
  const scope = new AsyncLocalStorage<{ id: string; token: object; mode: string }>()
  const firstResolved = deferred<void>(), secondResolved = deferred<void>()
  const bridge = {
    get invocationId() { return scope.getStore()?.id },
    get invocationToken() { return scope.getStore()?.token },
    request() {
      const invocation = scope.getStore()!
      return { requestId: invocation.id, result: Promise.resolve({ workspaceRoot: '/workspace', policy: { workspaceRoot: '/workspace', mode: invocation.mode, sessionId: 'session' } }), cancel: async () => ({ cancelled: false, quiescent: true }) }
    },
  }
  const clients = createNativeExecutionClients(bridge)
  const first = scope.run({ id: 'first', token: {}, mode: 'read-only' }, async () => {
    await clients.workingDirectory.ensure(agent, new AbortController().signal)
    firstResolved.resolve()
    await secondResolved.promise
    assert.equal(clients.sandboxPolicy.resolve({ session: agent.session }).mode, 'read-only')
  })
  const second = scope.run({ id: 'second', token: {}, mode: 'workspace-write' }, async () => {
    await firstResolved.promise
    await clients.workingDirectory.ensure(agent, new AbortController().signal)
    secondResolved.resolve()
    assert.equal(clients.sandboxPolicy.resolve({ session: agent.session }).mode, 'workspace-write')
  })
  await Promise.all([first, second])
  assert.throws(() => clients.sandboxPolicy.resolve({ session: agent.session }), /ensure/)
  await scope.run({ id: 'first', token: {}, mode: 'workspace-write' }, async () => {
    assert.throws(() => clients.sandboxPolicy.resolve({ session: agent.session }), /ensure/)
  })
})

test('synchronous facade collects wait output and stop output and stop is idempotent', async () => {
  const f = fixture(), handle = f.clients.subprocess.spawn(spawnRequest(new AbortController().signal))
  assert.equal(f.calls[0].operation, 'process.spawn')
  assert.deepEqual(await handle.done, { exitCode: 0, signal: null })
  assert.deepEqual(handle.collected.stdout.readFrom(0), { text: 'wait', lossy: false })
  const stopping = handle.terminate()
  assert.equal(handle.terminate(), stopping)
  await stopping
  await handle.waitForExit()
  assert.equal(handle.collected.stdout.readFrom(0).text, 'stop')
  assert.throws(() => handle.collected.stdout.readFrom(1), /offset 0/)
  assert.deepEqual(f.calls.map(call => call.operation), ['process.spawn', 'process.wait', 'process.stop'])
})

test('stop result remains authoritative when wait settles after process-group stop', async () => {
  const f = fixture(), pending = deferred<NativeExecutionResult>()
  f.handlers['process.wait'] = () => pending.promise
  const handle = f.clients.subprocess.spawn(spawnRequest(new AbortController().signal))
  await Promise.resolve()
  await handle.terminate()
  pending.resolve(result('late wait'))
  await handle.done
  assert.equal(handle.collected.stdout.readFrom(0).text, 'stop')
})

test('abort waits for cancellation acknowledgement and creates no fresh request', async () => {
  const f = fixture(), pending = deferred<NativeExecutionResult>(), controller = new AbortController()
  f.handlers['process.wait'] = () => pending.promise
  const handle = f.clients.subprocess.spawn(spawnRequest(controller.signal))
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(f.calls.at(-1)?.operation, 'process.wait')
  controller.abort(new Error('cancelled'))
  let settled = false
  const done = handle.done.catch(error => { settled = true; throw error })
  const rejected = assert.rejects(done, /cancelled/)
  await Promise.resolve()
  assert.equal(settled, false)
  assert.equal(f.cancels, 1)
  f.cancellation.resolve({ cancelled: true, quiescent: true })
  await rejected
  await assert.rejects(handle.terminate(), /cancelled/)
  assert.deepEqual(f.calls.map(call => call.operation), ['process.spawn', 'process.wait'])
  pending.reject(new Error('host cancelled'))
})

test('unconfirmed cancellation rejects quiescence and closed invocation cannot spawn', async () => {
  const f = fixture(), pending = deferred<unknown>(), controller = new AbortController()
  f.handlers['context.resolve'] = () => pending.promise
  const ensuring = f.clients.workingDirectory.ensure(agent, controller.signal)
  controller.abort()
  f.cancellation.resolve({ cancelled: false, quiescent: false })
  await assert.rejects(ensuring, /did not establish quiescence/)
  pending.reject(new Error('host unavailable'))
  f.setInvocation(undefined)
  assert.throws(() => f.clients.subprocess.spawn(spawnRequest(new AbortController().signal)), /No live invocation/)
})

test('approval transmits only reason, commands stay runner-local and dispose cleanly', async () => {
  const f = fixture(), signal = new AbortController().signal
  await f.clients.approval.request({ agent, toolName: 'untrusted', callId: 'untrusted', reason: 'Please approve', signal })
  assert.deepEqual(f.calls[0].input, { reason: 'Please approve' })
  const registry = getNativeExecutionCommandRegistry(f.clients)
  const definition = { name: 'example', description: 'Example', input: { hint: '' }, recordInput: false, async handler() { return { kind: 'success' as const, text: 'ok' } } }
  const dispose = registry.register(definition)
  assert.throws(() => registry.register(definition), /already registered/)
  assert.deepEqual(await registry.invoke('example', { agent, signal, rawInput: '' }), { kind: 'success', text: 'ok' })
  dispose(); dispose()
  await assert.rejects(registry.invoke('example', { agent, signal, rawInput: '' }), /Unknown command/)
  assert.equal(f.calls.length, 1)
})
