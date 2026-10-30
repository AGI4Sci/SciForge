import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, type TestContext } from 'node:test'
import { randomUUID } from 'node:crypto'

import { dshOrdinarySessionIdentitySchema } from './process-extension-host.js'

const runnerPath = fileURLToPath(new URL('./process-extension-runner.mjs', import.meta.url))

function request(child: ChildProcess, command: string, payload: unknown): Promise<unknown> {
  const requestId = randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('message', onMessage)
      reject(new Error(`Runner ${command} request timed out.`))
    }, 5000)
    function onMessage(message: unknown) {
      const response = message as { type?: string; requestId?: string; ok?: boolean; result?: unknown; error?: { message: string } }
      if (response.type !== 'response' || response.requestId !== requestId) return
      clearTimeout(timer)
      child.off('message', onMessage)
      if (response.ok) resolve(response.result)
      else reject(new Error(response.error?.message ?? 'Runner request failed.'))
    }
    child.on('message', onMessage)
    child.send({ type: 'request', requestId, command, payload })
  })
}

async function raceRunner(t: TestContext, source: string, resolver?: string) {
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-runner-race-'))
  const entryPath = join(directory, 'main.mjs')
  await writeFile(entryPath, source)
  const resolverPath = join(directory, 'resolver.mjs')
  if (resolver) await writeFile(resolverPath, resolver)
  const child = spawn(process.execPath, [runnerPath, entryPath, '1'], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ELECTRON_RUN_AS_NODE: '1' },
  })
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit', { signal: AbortSignal.timeout(5000) })
      child.kill('SIGKILL')
      await exited
    }
    await rm(directory, { recursive: true, force: true })
  })
  const probes: string[] = []
  child.on('message', (message: { probe?: string }) => { if (message.probe) probes.push(message.probe) })
  await once(child, 'message', { signal: AbortSignal.timeout(5000) })
  const active = await request(child, 'activate', {
    packageName: 'example', dshToolGrants: { race: { id: 'example.race', effect: resolver ? 'read' : 'compute' } },
    ...(resolver ? { dshAgentResolver: { path: resolverPath } } : {}),
  }) as { descriptors: { runtimeRevision: number }[] }
  const invoke = () => request(child, 'invoke', {
    id: 'example.race', input: {}, revision: active.descriptors[0].runtimeRevision,
    ...(resolver ? { invocation: { caller: {}, context: {}, ordinarySession: { runtimeId: 'runtime', threadId: 'thread', sessionId: 'session' } } } : {}),
  })
  const probe = async (name: string) => {
    const deadline = AbortSignal.timeout(5000)
    while (!probes.includes(name)) {
      deadline.throwIfAborted()
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  return { child, invoke, probes, probe }
}

const raceTool = `
import { defineTool } from '@deepseek-ai/dsh-tools'
export const inject = ['tools']
export function apply(ctx) {
  ctx.effect(() => () => { process.send({ probe: 'consumer-disposed' }) })
  ctx.tools.register(defineTool({ name: 'race', description: 'race', parameters: {},
    output: { schema: { type: 'number' }, render: () => [] },
    execute: async (_args, exec) => {
      process.send({ probe: 'started' })
      if (!exec.agent) await new Promise(resolve => {
        const release = message => { if (message.type === 'release') { process.off('message', release); resolve() } }
        process.on('message', release)
      })
      process.send({ probe: 'effect' })
      return exec.agent?.instance ?? 1
    } }))
}
`

test('runner deactivate fences admission and drains effects and responses before disposal', async (t) => {
  const { child, invoke, probe, probes } = await raceRunner(t, raceTool)
  const invoked = invoke()
  await probe('started')
  let disabled = false
  const deactivate = request(child, 'deactivate', {}).then(() => { disabled = true })
  // The next request is ordered after deactivate on the actual IPC channel.
  await assert.rejects(invoke(), /deactivat|closing|disabled/i)
  assert.equal(disabled, false)
  assert.equal(probes.includes('consumer-disposed'), false)
  child.send({ type: 'release' })
  assert.deepEqual(await invoked, { output: 1 })
  await deactivate
  assert.deepEqual(probes, ['started', 'effect', 'consumer-disposed'])
  await assert.rejects(invoke(), /deactivat|closing|disabled/i)
})

const raceResolver = `
import { createScope } from '@deepseek-ai/dsh-scope'
let count = 0
export async function resolveAgent({ identity, rootContext }) {
  const instance = ++count
  process.send({ probe: 'resolving-' + instance })
  await new Promise(resolve => {
    const release = message => { if (message.type === 'release') { process.off('message', release); resolve() } }
    process.on('message', release)
  })
  const agent = { id: identity.sessionId, session: { id: identity.sessionId }, instance }
  const scope = createScope(rootContext, agent)
  agent.ctx = scope.ctx
  return { agent, dispose: async () => {
    process.send({ probe: 'agent-disposed-' + instance })
    await scope.dispose()
  } }
}
`

test('runner single-flights concurrent ordinary Agent resolution and owns it through deactivate', async (t) => {
  const { child, invoke, probes, probe } = await raceRunner(t, raceTool, raceResolver)
  const first = invoke()
  const second = invoke()
  await probe('resolving-1')
  let disabled = false
  const deactivate = request(child, 'deactivate', {}).then(() => { disabled = true })
  await assert.rejects(invoke(), /deactivat|disabled/i)
  assert.equal(disabled, false)
  assert.equal(probes.includes('consumer-disposed'), false)
  child.send({ type: 'release' })
  assert.deepEqual(await Promise.all([first, second]), [{ output: 1 }, { output: 1 }])
  await deactivate
  assert.deepEqual(probes.filter(name => name.startsWith('resolving-')), ['resolving-1'])
  assert.deepEqual(probes.filter(name => name.startsWith('agent-disposed-')), ['agent-disposed-1'])
  assert.ok(probes.indexOf('agent-disposed-1') < probes.indexOf('consumer-disposed'))
})

test('runner retries failed Agent cleanup without releasing consumer dependencies', async (t) => {
  const resolver = raceResolver.replace("process.send({ probe: 'agent-disposed-' + instance })", `
    process.send({ probe: 'dispose-attempt-' + (++attempts) })
    if (attempts === 1) throw new Error('cleanup obstruction')
    process.send({ probe: 'agent-disposed-' + instance })
  `).replace('let count = 0', 'let count = 0; let attempts = 0')
  const { child, invoke, probe, probes } = await raceRunner(t, raceTool, resolver)
  const invoked = invoke()
  await probe('resolving-1')
  child.send({ type: 'release' })
  await invoked
  await assert.rejects(request(child, 'deactivate', {}), /cleanup obstruction/)
  assert.equal(probes.includes('consumer-disposed'), false)
  await assert.rejects(invoke(), /deactivat|disabled/i)
  await request(child, 'deactivate', {})
  assert.deepEqual(probes.filter(name => name.startsWith('dispose-attempt-')), ['dispose-attempt-1', 'dispose-attempt-2'])
  assert.ok(probes.indexOf('agent-disposed-1') < probes.indexOf('consumer-disposed'))
})

test('runner releases invalid resolved Agent owners before allowing resolution retry', async (t) => {
  const resolver = raceResolver.replace("id: identity.sessionId, session:", "id: instance === 1 ? 'wrong-session' : identity.sessionId, session:")
  const { child, invoke, probe, probes } = await raceRunner(t, raceTool, resolver)
  const failed = assert.rejects(invoke(), /invalid identity binding/)
  await probe('resolving-1')
  child.send({ type: 'release' })
  await failed
  assert.deepEqual(probes.filter(name => name.startsWith('agent-disposed-')), ['agent-disposed-1'])
  const retried = invoke()
  await probe('resolving-2')
  child.send({ type: 'release' })
  assert.deepEqual(await retried, { output: 2 })
  await request(child, 'deactivate', {})
  assert.deepEqual(probes.filter(name => name.startsWith('agent-disposed-')), ['agent-disposed-1', 'agent-disposed-2'])
})

test('runner shares resolver rejection and retries the same tuple without losing later ownership', async (t) => {
  const resolver = raceResolver.replace('const agent = {', "if (instance === 1) throw new Error('resolver obstruction'); const agent = {")
  const { child, invoke, probe, probes } = await raceRunner(t, raceTool, resolver)
  const rejected = [assert.rejects(invoke(), /resolver obstruction/), assert.rejects(invoke(), /resolver obstruction/)]
  await probe('resolving-1')
  child.send({ type: 'release' })
  await Promise.all(rejected)
  const retried = invoke()
  await probe('resolving-2')
  child.send({ type: 'release' })
  assert.deepEqual(await retried, { output: 2 })
  assert.deepEqual(await invoke(), { output: 2 })
  await request(child, 'deactivate', {})
  assert.deepEqual(probes.filter(name => name.startsWith('resolving-')), ['resolving-1', 'resolving-2'])
  assert.deepEqual(probes.filter(name => name.startsWith('agent-disposed-')), ['agent-disposed-2'])
})

test('runner coalesces concurrent deactivations while retaining a failed invalid Agent owner', async (t) => {
  const resolver = raceResolver
    .replace('let count = 0', 'let count = 0; let attempts = 0')
    .replace('id: identity.sessionId, session:', "id: 'wrong-session', session:")
    .replace("process.send({ probe: 'agent-disposed-' + instance })", `
      process.send({ probe: 'dispose-attempt-' + (++attempts) })
      if (attempts === 1) throw new Error('invalid-owner cleanup obstruction')
      await new Promise(resolve => {
        const release = message => { if (message.type === 'release-cleanup') { process.off('message', release); resolve() } }
        process.on('message', release)
      })
      process.send({ probe: 'agent-disposed-' + instance })
    `)
  const { child, invoke, probe, probes } = await raceRunner(t, raceTool, resolver)
  const rejected = assert.rejects(invoke(), /invalid-owner cleanup obstruction/)
  await probe('resolving-1')
  child.send({ type: 'release' })
  await rejected
  const first = request(child, 'deactivate', {})
  const second = request(child, 'deactivate', {})
  await probe('dispose-attempt-2')
  await assert.rejects(invoke(), /deactivat|disabled/i)
  assert.equal(probes.includes('consumer-disposed'), false)
  child.send({ type: 'release-cleanup' })
  await Promise.all([first, second])
  assert.deepEqual(probes.filter(name => name.startsWith('dispose-attempt-')), ['dispose-attempt-1', 'dispose-attempt-2'])
  assert.deepEqual(probes.filter(name => name.startsWith('agent-disposed-')), ['agent-disposed-1'])
})

test('runner validates every explicit envelope at the invoke boundary, including named handlers', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-runner-envelope-'))
  let child: ChildProcess | undefined
  try {
    const entryPath = join(directory, 'main.mjs')
    await writeFile(entryPath, `
let calls = 0
export function getCapabilityDefinitions() {
  return [{ descriptor: { id: 'example.named' }, handler: async (_input, execution) => ({ calls: ++calls, invocation: execution.invocation }) }]
}
`)
    child = spawn(process.execPath, [runnerPath, entryPath, '1'], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ELECTRON_RUN_AS_NODE: '1' }, serialization: 'advanced',
    })
    await once(child, 'message', { signal: AbortSignal.timeout(5000) })
    await request(child, 'activate', {})
    const invocation = {
      caller: { callerId: 'caller-original' },
      ordinarySession: { runtimeId: 'runtime-1', threadId: 'thread-1', sessionId: 'session-1' },
      context: { nested: [null, true, 2, { marker: 'context-original' }] },
    }
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    const malformed = [
      ['caller scalar', { ...invocation, caller: 'caller' }],
      ['context scalar', { ...invocation, context: true }],
      ['caller null', { ...invocation, caller: null }],
      ['context array', { ...invocation, context: [] }],
      ['caller missing', { ordinarySession: invocation.ordinarySession, context: {} }],
      ['context missing', { caller: {}, ordinarySession: invocation.ordinarySession }],
      ['extra envelope field', { ...invocation, unexpected: true }],
      ['identity extra field', { ...invocation, ordinarySession: { ...invocation.ordinarySession, extra: true } }],
      ['identity whitespace', { ...invocation, ordinarySession: { ...invocation.ordinarySession, sessionId: ' session-1' } }],
      ['context undefined', { ...invocation, context: { invalid: undefined } }],
      ['caller non-finite number', { ...invocation, caller: { invalid: NaN } }],
      ['context Date', { ...invocation, context: { invalid: new Date(0) } }],
      ['context Map', { ...invocation, context: { invalid: new Map() } }],
      ['context sparse array', { ...invocation, context: { invalid: Array(1) } }],
      ['context cycle', { ...invocation, context: cycle }],
    ] as const
    for (const [name, envelope] of malformed) {
      await t.test(name, async () => {
        await assert.rejects(request(child!, 'invoke', { id: 'example.named', input: {}, invocation: envelope }), /invocation|envelope/i)
      })
    }
    // Validation must precede any handler, not merely localAgentFor().
    assert.deepEqual(await request(child, 'invoke', { id: 'example.named', input: {}, invocation }), { calls: 1, invocation })
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit', { signal: AbortSignal.timeout(5000) })
      child.kill('SIGKILL')
      await exited
    }
    await rm(directory, { recursive: true, force: true })
  }
})

test('runner rejects non-lossless array own fields before named handler execution over real child IPC', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-runner-array-extra-'))
  let child: ChildProcess | undefined
  try {
    const entryPath = join(directory, 'main.mjs')
    await writeFile(entryPath, `
let calls = 0
let getterCalls = 0
// Advanced IPC cannot transport descriptors or symbols. Materialize those
// shapes inside the real child before its canonical message handler runs.
process.prependListener('message', message => {
  if (message?.command !== 'invoke' || !message.payload.input.shape) return
  const array = message.payload.invocation.context.array
  switch (message.payload.input.shape) {
    case 'accessor extra': Object.defineProperty(array, 'extra', { enumerable: true, get() { getterCalls++; return true } }); break
    case 'accessor index': Object.defineProperty(array, '0', { enumerable: true, get() { getterCalls++; return true } }); break
    case 'symbol extra': array[Symbol('extra')] = true; break
    case 'non-enumerable extra': Object.defineProperty(array, 'extra', { value: true }); break
    case 'custom array prototype': Object.setPrototypeOf(array, Object.create(Array.prototype)); break
    case 'identity accessor': Object.defineProperty(message.payload.invocation.ordinarySession, 'runtimeId', { enumerable: true, get() { getterCalls++; return 'runtime' } }); break
    case 'identity symbol extra': message.payload.invocation.ordinarySession[Symbol('extra')] = true; break
    case 'identity non-enumerable extra': Object.defineProperty(message.payload.invocation.ordinarySession, 'extra', { value: true }); break
  }
})
export function getCapabilityDefinitions() {
  return [{ descriptor: { id: 'example.named' }, handler: async (_input, execution) => ({ calls: ++calls, getterCalls, invocation: execution.invocation }) }]
}
`)
    child = spawn(process.execPath, [runnerPath, entryPath, '1'], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ELECTRON_RUN_AS_NODE: '1' }, serialization: 'advanced',
    })
    const [ready] = await once(child, 'message', { signal: AbortSignal.timeout(5000) })
    assert.equal(ready.type, 'ready')
    await request(child, 'activate', {})
    const ordinarySession = { runtimeId: 'runtime', threadId: 'thread', sessionId: 'session' }
    let invalidCases = 0
    let unexpectedlyExecuted = 0
    const rejectEnvelope = async (name: string, invocation: unknown, input = {}) => {
      invalidCases++
      await t.test(name, async () => {
        await assert.rejects(request(child!, 'invoke', { id: 'example.named', input, invocation }).then(result => {
          unexpectedlyExecuted++
          return result
        }), /lossless JSON envelope/i)
      })
    }
    for (const field of ['caller', 'context']) {
      for (const key of ['extra', '__proto__']) {
        for (const [name, value] of [['Date', new Date(0)], ['undefined', undefined], ['NaN', NaN], ['Map', new Map([['key', 'value']])]] as const) {
          const array = ['valid']
          Object.defineProperty(array, key, { enumerable: true, value: { nested: value } })
          await rejectEnvelope(`${field} array own ${key}: ${name}`, {
            caller: {}, ordinarySession, context: {}, [field]: { array },
          })
        }
      }
    }
    for (const shape of ['accessor extra', 'accessor index', 'symbol extra', 'non-enumerable extra', 'custom array prototype',
      'identity accessor', 'identity symbol extra', 'identity non-enumerable extra']) {
      await rejectEnvelope(shape, { caller: {}, ordinarySession, context: { array: ['valid'] } }, { shape })
    }
    await rejectEnvelope('sparse array', { caller: {}, ordinarySession, context: { array: Array(1) } })
    const shared = { marker: 'shared-valid' }
    const array = [shared, shared]
    Object.defineProperty(array, 'extra', { enumerable: true, value: { nested: [null, true, 2, 'valid'] } })
    Object.defineProperty(array, '__proto__', { enumerable: true, value: { marker: 'own-proto' } })
    const invocation = { caller: { array }, ordinarySession, context: { array } }
    const result = await request(child, 'invoke', { id: 'example.named', input: {}, invocation }) as { calls: number; getterCalls: number; invocation: typeof invocation }
    t.diagnostic(`invalidCases=${invalidCases}; unexpectedlyExecuted=${unexpectedlyExecuted}; handlerCalls=${result.calls}; getterCalls=${result.getterCalls}`)
    assert.equal(result.calls, 1, 'No rejected envelope may reach the handler')
    assert.equal(result.getterCalls, 0, 'Validation must inspect descriptors without invoking getters')
    assert.deepEqual(result.invocation, invocation)
    assert.ok(Object.hasOwn(result.invocation.context.array, 'extra'))
    assert.ok(Object.hasOwn(result.invocation.context.array, '__proto__'))
    assert.equal(Object.getPrototypeOf(result.invocation.context.array), Array.prototype)
    const exited = once(child, 'exit', { signal: AbortSignal.timeout(5000) })
    await request(child, 'deactivate', {})
    await request(child, 'dispose', {})
    assert.deepEqual(await exited, [0, null])
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit', { signal: AbortSignal.timeout(5000) })
      child.kill('SIGKILL')
      await exited
    }
    await rm(directory, { recursive: true, force: true })
  }
})

test('runner keeps distinct schema-valid NUL identities in separate ordinary Agent cache entries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-runner-identity-'))
  let child: ChildProcess | undefined
  try {
    const entryPath = join(directory, 'main.mjs')
    const resolverPath = join(directory, 'agent-resolver.mjs')
    await writeFile(resolverPath, `
import { createScope } from '@deepseek-ai/dsh-scope'
let resolutions = 0
export function resolveAgent({ identity, rootContext }) {
  const agent = { id: identity.sessionId, session: { id: identity.sessionId },
    identity, resolution: ++resolutions }
  const scope = createScope(rootContext, agent)
  agent.ctx = scope.ctx
  return { agent, dispose: scope.dispose }
}
`)
    await writeFile(entryPath, `
import { defineTool } from '@deepseek-ai/dsh-tools'
export const inject = ['tools']
export function apply(ctx) {
  ctx.tools.register(defineTool({ name: 'identity', description: 'identity', parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [] },
    execute: async (_args, exec) => ({ identity: exec.agent.identity,
      sessionId: exec.agent.session.id, resolution: exec.agent.resolution }) }))
}
`)
    child = spawn(process.execPath, [runnerPath, entryPath, '1'], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ELECTRON_RUN_AS_NODE: '1' },
    })
    const [ready] = await once(child, 'message', { signal: AbortSignal.timeout(5000) })
    assert.equal(ready.type, 'ready')
    const activated = await request(child, 'activate', {
      packageName: 'example', dshAgentResolver: { path: resolverPath },
      dshToolGrants: { identity: { id: 'example.identity', effect: 'read' } },
    }) as { descriptors: { id: string; runtimeRevision: number }[] }
    const identities = [
      { runtimeId: 'codex', threadId: 'x', sessionId: 'y\u0000z' },
      { runtimeId: 'codex', threadId: 'x\u0000y', sessionId: 'z' },
      { runtimeId: 'codex\u0000x', threadId: 'y', sessionId: 'z' },
    ]
    for (const identity of identities) {
      assert.deepEqual(dshOrdinarySessionIdentitySchema.parse(identity), identity)
    }
    const payload = { id: 'example.identity', input: {}, revision: activated.descriptors[0].runtimeRevision }
    // Repeat with fresh envelopes to prove equal tuples still reuse their Agent.
    for (const index of [0, 1, 2, 0, 1, 2]) {
      const identity = identities[index]
      assert.deepEqual(await request(child, 'invoke', {
        ...payload, invocation: { caller: { callerId: 'caller' }, ordinarySession: { ...identity }, context: {} },
      }), { output: { identity, sessionId: identity.sessionId, resolution: index + 1 } })
    }
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit', { signal: AbortSignal.timeout(5000) })
      child.kill('SIGKILL')
      await exited
    }
    await rm(directory, { recursive: true, force: true })
  }
})

test('runner independently fences incomplete Session invocations and retains approved global compute', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-runner-invocation-'))
  const effects = ['read', 'workspace-write', 'external-write', 'destructive', 'compute']
  let child: ChildProcess | undefined
  try {
    const entryPath = join(directory, 'main.mjs')
    await writeFile(entryPath, `
import { defineTool } from '@deepseek-ai/dsh-tools'
export const inject = ['tools']
export function apply(ctx) {
  let calls = 0
  for (const name of ${JSON.stringify(effects)}) {
    ctx.tools.register(defineTool({ name, description: name, parameters: {},
      output: { schema: { type: 'number' }, render: () => [] }, execute: async () => ++calls }))
  }
}
`)
    child = spawn(process.execPath, [runnerPath, entryPath, '1'], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ELECTRON_RUN_AS_NODE: '1' },
    })
    const [ready] = await once(child, 'message', { signal: AbortSignal.timeout(5000) })
    assert.equal(ready.type, 'ready')
    const activated = await request(child, 'activate', {
      packageName: 'example', dshToolGrants: Object.fromEntries(effects.map((effect) => [effect, { id: `example.${effect}`, effect }])),
    }) as { descriptors: { id: string; runtimeRevision: number }[] }
    for (const effect of effects.filter((effect) => effect !== 'compute')) {
      const payload = { id: `example.${effect}`, input: {}, revision: activated.descriptors.find(({ id }) => id === `example.${effect}`)!.runtimeRevision }
      await t.test(`${effect}: missing envelope`, async () => {
        await assert.rejects(request(child!, 'invoke', payload), /ordinary Session invocation envelope is required/i)
      })
      await t.test(`${effect}: missing ordinary Session`, async () => {
        await assert.rejects(request(child!, 'invoke', { ...payload, invocation: { caller: {}, context: {} } }), /ordinary Session identity/i)
      })
    }
    const ordinarySession = { runtimeId: 'runtime-1', threadId: 'thread-1', sessionId: 'session-1' }
    for (const effect of ['read', 'compute']) {
      const payload = { id: `example.${effect}`, input: {}, revision: activated.descriptors.find(({ id }) => id === `example.${effect}`)!.runtimeRevision }
      await t.test(`${effect}: identity exists but caller is missing`, async () => {
        await assert.rejects(request(child!, 'invoke', {
          ...payload, invocation: { ordinarySession, context: {} },
        }), /complete invocation envelope|caller/i)
      })
      await t.test(`${effect}: identity exists but context is missing`, async () => {
        await assert.rejects(request(child!, 'invoke', {
          ...payload, invocation: { caller: {}, ordinarySession },
        }), /complete invocation envelope|context/i)
      })
    }
    const computePayload = { id: 'example.compute', input: {}, revision: activated.descriptors.find(({ id }) => id === 'example.compute')!.runtimeRevision }
    // An explicit but incomplete Session envelope must not fall back to global compute.
    await assert.rejects(request(child, 'invoke', { ...computePayload, invocation: { caller: {}, context: {} } }), /ordinary Session identity/i)
    await assert.rejects(request(child, 'invoke', {
      ...computePayload, invocation: { caller: {}, context: {}, ordinarySession: { runtimeId: 'runtime-1', threadId: 'thread-1', sessionId: '' } },
    }), /ordinary Session identity/i)
    // Proves all rejected requests stayed outside the actual tool executor.
    assert.deepEqual(await request(child, 'invoke', computePayload), { output: 1 })
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit', { signal: AbortSignal.timeout(5000) })
      child.kill('SIGKILL')
      await exited
    }
    await rm(directory, { recursive: true, force: true })
  }
})

for (const reason of ['undefined', 'null', 'false', '0', "''"]) {
  test(`runner rejects falsy invalid Agent disposal and retains its retry owner (${reason})`, async (t) => {
    const resolver = raceResolver
      .replace('let count = 0', 'let count = 0; let attempts = 0')
      .replace('id: identity.sessionId, session:', "id: 'wrong-session', session:")
      .replace("process.send({ probe: 'agent-disposed-' + instance })", `
        process.send({ probe: 'dispose-attempt-' + (++attempts) })
        if (attempts === 1) throw ${reason}
        process.send({ probe: 'agent-disposed-' + instance })
      `)
    const { child, invoke, probe, probes } = await raceRunner(t, raceTool, resolver)
    const rejected = assert.rejects(invoke())
    await probe('resolving-1')
    child.send({ type: 'release' })
    await rejected
    await assert.rejects(invoke())
    assert.deepEqual(probes.filter(name => name.startsWith('resolving-')), ['resolving-1'])
    assert.deepEqual(probes.filter(name => name.startsWith('dispose-attempt-')), ['dispose-attempt-1'])
    assert.equal(probes.includes('effect'), false)
    assert.equal(probes.includes('consumer-disposed'), false)
    await request(child, 'deactivate', {})
    assert.deepEqual(probes.filter(name => name.startsWith('dispose-attempt-')), ['dispose-attempt-1', 'dispose-attempt-2'])
    assert.ok(probes.indexOf('agent-disposed-1') < probes.indexOf('consumer-disposed'))
    await assert.rejects(invoke(), /deactivat|disabled/i)
  })
}

async function namedRunner(t: TestContext, source: string) {
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-runner-ports-'))
  const entryPath = join(directory, 'main.mjs')
  await writeFile(entryPath, source)
  const child = spawn(process.execPath, [runnerPath, entryPath, '1'], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ELECTRON_RUN_AS_NODE: '1' },
  })
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit', { signal: AbortSignal.timeout(5000) })
      child.kill('SIGKILL')
      await exited
    }
    await rm(directory, { recursive: true, force: true })
  })
  await once(child, 'message', { signal: AbortSignal.timeout(5000) })
  const activate = await request(child, 'activate', {}) as { descriptors: { id: string }[] }
  return { child, activate }
}

test('runner installs host ports before activate and round-trips bound workspace envelopes', async (t) => {
  const { child } = await namedRunner(t, `
let activateSawPorts
export async function activate() { activateSawPorts = typeof globalThis.__sciforgeHostPorts?.request }
export async function deactivate() {}
export async function dispose() {}
export function getCapabilityDefinitions() {
  const descriptor = { contractVersion: 3, id: 'probe.ports', version: '1.0.0', title: 'Ports probe', description: 'Host ports envelope probe.', audiences: ['agent'], scope: 'workspace', resourceKinds: [], effect: 'read', approval: 'none', concurrency: { revision: 'none', idempotency: 'none' }, inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, tags: ['probe'] }
  return [
    { descriptor, handler: async (input) => {
      try {
        const value = await globalThis.__sciforgeHostPorts.request({ operation: input.operation, input: input.payload ?? {}, scope: input.scope })
        return { output: { ok: true, value } }
      } catch (error) {
        return { output: { ok: false, code: error?.code ?? 'unknown', message: error?.message } }
      }
    } },
    { descriptor: { ...descriptor, id: 'probe.state' }, handler: async () => ({ output: { activateSawPorts } }) }
  ]
}
`)
  const envelopes: { request: Record<string, unknown>; boundWorkspace?: string }[] = []
  child.on('message', (message: { type?: string; requestId?: string; request: Record<string, unknown>; boundWorkspace?: string }) => {
    if (message.type === 'ports-request') {
      envelopes.push({ request: message.request, boundWorkspace: message.boundWorkspace })
      child.send({ type: 'ports-response', requestId: message.requestId, ok: true, value: { operation: message.request.operation, bound: message.boundWorkspace ?? null } })
    }
  })
  const state = await request(child, 'invoke', { id: 'probe.state', input: {} }) as { output: { activateSawPorts: string } }
  assert.equal(state.output.activateSawPorts, 'function')
  const result = await request(child, 'invoke', { id: 'probe.ports', input: {
    operation: 'artifacts.read', payload: { n: 2 }, scope: { workspaceRoot: '/ws/runner' }, workspaceRoot: '/ws/runner'
  } }) as { output: { ok: boolean; value: { operation: string; bound: string } } }
  assert.equal(result.output.ok, true)
  assert.deepEqual(result.output.value, { operation: 'artifacts.read', bound: '/ws/runner' })
  assert.equal(envelopes.length, 1)
  assert.equal(envelopes[0].request.protocol, 'sciforge-host-ports.v1')
  assert.equal(typeof envelopes[0].request.requestId, 'string')
  assert.equal(envelopes[0].boundWorkspace, '/ws/runner')
})

test('runner serializes invokes so ports scopes never interleave', async (t) => {
  const { child } = await namedRunner(t, `
export async function activate() {}
export async function deactivate() {}
export async function dispose() {}
export function getCapabilityDefinitions() {
  return [{ descriptor: { contractVersion: 3, id: 'probe.serialize', version: '1.0.0', title: 'Serialize probe', description: 'Invoke serialization probe.', audiences: ['agent'], scope: 'workspace', resourceKinds: [], effect: 'read', approval: 'none', concurrency: { revision: 'none', idempotency: 'none' }, inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, tags: ['probe'] },
    handler: async (input) => {
      const order = globalThis.__order = globalThis.__order ?? []
      order.push('start:' + input.name)
      if (input.ports) {
        const value = await globalThis.__sciforgeHostPorts.request({ operation: 'probe.op', input: { name: input.name } })
        order.push('ports:' + input.name + ':' + String(value))
      } else {
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      order.push('end:' + input.name)
      return { output: [...order] }
    } }]
}
`)
  let pendingResponse: { requestId?: string } | undefined
  child.on('message', (message: { type?: string; requestId?: string; request?: { operation?: string } }) => {
    if (message.type === 'ports-request' && message.request?.operation === 'probe.op') pendingResponse = message
  })
  const first = request(child, 'invoke', { id: 'probe.serialize', input: { name: 'A', ports: true, workspaceRoot: '/ws/serialize' } }) as Promise<{ output: string[] }>
  while (!pendingResponse) await new Promise((resolve) => setTimeout(resolve, 5))
  const second = request(child, 'invoke', { id: 'probe.serialize', input: { name: 'B', workspaceRoot: '/ws/serialize' } }) as Promise<{ output: string[] }>
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(pendingResponse !== undefined, true)
  child.send({ type: 'ports-response', requestId: pendingResponse!.requestId, ok: true, value: 'done' })
  const [firstResult, secondResult] = await Promise.all([first, second])
  assert.deepEqual(firstResult.output, ['start:A', 'ports:A:done', 'end:A'])
  assert.ok(secondResult.output.indexOf('start:B') > secondResult.output.indexOf('end:A'))
  assert.ok(!firstResult.output.includes('start:B'))
})

test('runner cancel resolves only at real quiescence reported by the Host', async (t) => {
  const { child } = await namedRunner(t, `
export async function activate() {}
export async function deactivate() {}
export async function dispose() {}
export function getCapabilityDefinitions() {
  return [{ descriptor: { contractVersion: 3, id: 'probe.cancel', version: '1.0.0', title: 'Cancel probe', description: 'Host ports cancel probe.', audiences: ['agent'], scope: 'workspace', resourceKinds: [], effect: 'read', approval: 'none', concurrency: { revision: 'none', idempotency: 'none' }, inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, tags: ['probe'] },
    handler: async (input) => {
      if (input.cancelMissing) return { output: await globalThis.__sciforgeHostPorts.cancel('no-such-request') }
      const originalSend = process.send.bind(process)
      let requestId
      process.send = (message, callback) => {
        if (message?.type === 'ports-request') requestId = message.request.requestId
        return originalSend(message, callback)
      }
      try {
        globalThis.__sciforgeHostPorts.request({ operation: 'slow.op', input: {} }).catch(() => {})
        await new Promise((resolve) => setTimeout(resolve, 10))
        return { output: await globalThis.__sciforgeHostPorts.cancel(requestId) }
      } finally {
        process.send = originalSend
      }
    } }]
}
`)
  const slowRequests: { requestId?: string }[] = []
  child.on('message', (message: { type?: string; requestId?: string; request?: { operation?: string } }) => {
    if (message.type === 'ports-request' && message.request?.operation === 'slow.op') {
      slowRequests.push(message)
      return
    }
    if (message.type === 'ports-cancel') {
      const target = slowRequests.find((candidate) => candidate.requestId === (message as { requestId?: string }).requestId)
      setTimeout(() => child.send({ type: 'ports-response', requestId: (message as { requestId?: string }).requestId, ok: false, error: { code: 'cancelled', message: 'cancelled at real quiescence' } }), 10)
      assert.equal(target !== undefined, true)
    }
  })
  const missing = await request(child, 'invoke', { id: 'probe.cancel', input: { cancelMissing: true, workspaceRoot: '/ws/cancel' } }) as { output: { cancelled: boolean; quiescent: boolean } }
  assert.deepEqual(missing.output, { cancelled: false, quiescent: true })
  const cancelled = await request(child, 'invoke', { id: 'probe.cancel', input: { workspaceRoot: '/ws/cancel' } }) as { output: { cancelled: boolean; quiescent: boolean } }
  assert.deepEqual(cancelled.output, { cancelled: true, quiescent: true })
})
