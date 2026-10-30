import assert from 'node:assert/strict'
import { ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProcessExtensionHost, ProcessExtensionHostError, type DshInvocationContext, type DshToolAuthorizationRequest } from './process-extension-host.js'
import { HostServiceProviderRegistry } from './host-service-provider.js'

const moduleSource = (version: string, fail = false, failDeactivate = false) => `
let active = false
const inputSchema = { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] }
const outputSchema = { type: 'object', properties: { value: { type: 'number' }, version: { type: 'string' } }, required: ['value', 'version'] }
export async function activate() { ${fail ? "throw new Error('activation failed')" : 'active = true'} }
export async function deactivate() { ${failDeactivate ? "throw new Error('deactivate failed')" : 'active = false'} }
export async function dispose() { active = false }
export function getCapabilityDefinitions() {
  return [{ descriptor: { id: 'fixture.echo', version: '${version}', inputSchema, outputSchema }, inputSchema, outputSchema,
    handler: async (input) => { if (!active) throw new Error('inactive'); return { output: { value: input.value, version: '${version}' } } } }]
}
`

test('disposeAll releases active, prepared-only and committed previous generations even when one drain fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'host-owned-resources-'))
  const host = new ProcessExtensionHost()
  const runtimes = []
  try {
    const firstPath = join(directory, 'v1.mjs')
    const secondPath = join(directory, 'v2.mjs')
    await writeFile(firstPath, moduleSource('1.0.0', false, true))
    await writeFile(secondPath, moduleSource('2.0.0'))
    await host.replace({ pluginId: 'fixture', packageName: 'fixture', version: '1.0.0', entryPath: firstPath })
    runtimes.push(host.runtime('fixture')!)
    await host.prepare({ pluginId: 'fixture', packageName: 'fixture', version: '2.0.0', entryPath: secondPath })
    runtimes.push(host.pending('fixture')!)
    await host.commit('fixture')
    await host.prepare({ pluginId: 'pending-only', packageName: 'pending-only', version: '2.0.0', entryPath: secondPath })
    runtimes.push(host.pending('pending-only')!)
    const pids = runtimes.map((runtime) => runtime.snapshot.pid!)
    assert.ok(pids.every((pid) => Number.isInteger(pid)))
    await host.disposeAll().catch(() => undefined)
    assert.deepEqual(runtimes.map((runtime) => runtime.snapshot.state), ['disposed', 'disposed', 'disposed'])
    for (const pid of pids) {
      for (let attempt = 0; attempt < 50; attempt++) {
        try { process.kill(pid, 0) } catch { break }
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      assert.throws(() => process.kill(pid, 0))
    }
    assert.equal(host.runtime('fixture'), undefined)
    assert.equal(host.pending('pending-only'), undefined)
    await host.disposeAll()
  } finally {
    await Promise.all(runtimes.map((runtime) => runtime.dispose().catch(() => undefined)))
    await rm(directory, { recursive: true, force: true })
  }
})

test('process extension runtime isolates execution and rejects stale generations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-process-extension-'))
  try {
    const firstPath = join(directory, 'v1.mjs')
    const secondPath = join(directory, 'v2.mjs')
    await writeFile(firstPath, moduleSource('1.0.0'))
    await writeFile(secondPath, moduleSource('2.0.0'))
    const host = new ProcessExtensionHost()
    const first = await host.replace({ pluginId: 'fixture', packageName: 'fixture', version: '1.0.0', entryPath: firstPath })
    assert.equal(first.state, 'active')
    assert.equal(first.capabilityIds[0], 'fixture.echo')
    const old = host.runtime('fixture')!
    assert.deepEqual(await old.invoke('fixture.echo', { value: 5 }), { output: { value: 5, version: '1.0.0' } })
    const second = await host.replace({ pluginId: 'fixture', packageName: 'fixture', version: '2.0.0', entryPath: secondPath })
    assert.equal(second.generation, 2)
    await assert.rejects(old.invoke('fixture.echo', { value: 5 }), (error: unknown) =>
      error instanceof ProcessExtensionHostError && error.code === 'stale_generation')
    assert.deepEqual(await host.runtime('fixture')!.invoke('fixture.echo', { value: 5 }), { output: { value: 5, version: '2.0.0' } })
    await host.dispose('fixture')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('failed prepare and rollback allocate fresh owner generations and isolate provider disposal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-owner-generation-'))
  const providersByGeneration = new Map<number, { closes: number }>()
  const host = new ProcessExtensionHost({
    resolveHostServices: (_packageName, _version, generation) => {
      const state = providersByGeneration.get(generation) ?? { closes: 0 }
      providersByGeneration.set(generation, state)
      return new HostServiceProviderRegistry({
        worker: {
          dispose: async () => { state.closes++ },
          authorize: () => {},
          operations: { read: () => generation },
        },
      })
    },
  })
  try {
    const goodPath = join(directory, 'good.mjs')
    await writeFile(goodPath, moduleSource('1.0.0'))
    const failedPath = join(directory, 'failed.mjs')
    await writeFile(failedPath, moduleSource('2.0.0', true))
    await host.replace({ pluginId: 'fixture', packageName: 'fixture', version: '1.0.0', entryPath: goodPath })
    await assert.rejects(host.prepare({ pluginId: 'fixture', packageName: 'fixture', version: '2.0.0', entryPath: failedPath }), /activation failed/)
    const firstRetry = await host.prepare({ pluginId: 'fixture', packageName: 'fixture', version: '1.0.0', entryPath: goodPath })
    assert.equal(firstRetry.generation, 3)
    await host.commit('fixture')
    await host.rollbackCommitted('fixture')
    const secondRetry = await host.prepare({ pluginId: 'fixture', packageName: 'fixture', version: '1.0.0', entryPath: goodPath })
    assert.equal(secondRetry.generation, 4)
    assert.notEqual(providersByGeneration.get(3), providersByGeneration.get(4))
    await host.rollbackPrepared('fixture')
    assert.equal(providersByGeneration.get(3)?.closes, 1)
    assert.equal(providersByGeneration.get(4)?.closes, 1)
  } finally {
    await host.disposeAll().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test('failed process replacement keeps the previous runtime active', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-process-extension-'))
  try {
    const firstPath = join(directory, 'v1.mjs')
    const failedPath = join(directory, 'failed.mjs')
    await writeFile(firstPath, moduleSource('1.0.0'))
    await writeFile(failedPath, moduleSource('3.0.0', true))
    const host = new ProcessExtensionHost()
    await host.replace({ pluginId: 'fixture', packageName: 'fixture', version: '1.0.0', entryPath: firstPath })
    await assert.rejects(
      host.replace({ pluginId: 'fixture', packageName: 'fixture', version: '3.0.0', entryPath: failedPath }),
      (error: unknown) => error instanceof ProcessExtensionHostError && error.code === 'startup_failed'
    )
    assert.equal(host.snapshot('fixture')?.version, '1.0.0')
    assert.deepEqual(await host.runtime('fixture')!.invoke('fixture.echo', { value: 7 }), { output: { value: 7, version: '1.0.0' } })
    await host.dispose('fixture')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Host rejects incomplete sensitive DSH invocations before authorization or IPC', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-process-missing-invocation-'))
  const effects = ['read', 'workspace-write', 'external-write', 'destructive'] as const
  let authorizations = 0
  const host = new ProcessExtensionHost({
    resolveDshToolGrants: () => Object.fromEntries(effects.map((effect) => [effect, { id: `example.${effect}`, effect }])),
    authorizeDshTool: () => { authorizations++ },
  })
  try {
    const entryPath = join(directory, 'main.mjs')
    await writeFile(entryPath, `
import { defineTool } from '@deepseek-ai/dsh-tools'
export const inject = ['tools']
export function apply(ctx) {
  for (const name of ${JSON.stringify(effects)}) {
    ctx.tools.register(defineTool({ name, description: name, parameters: {},
      output: { schema: { type: 'string' }, render: () => [] }, execute: async () => 'executed' }))
  }
}
`)
    const spawn = t.mock.method(ChildProcess.prototype as ChildProcess & { spawn: (...args: unknown[]) => unknown }, 'spawn')
    await host.replace({ pluginId: 'example', packageName: 'example', version: '1.0.0', entryPath })
    const child = spawn.mock.calls[0].this as ChildProcess
    const send = t.mock.method(child, 'send')
    for (const effect of effects) {
      await t.test(`${effect}: missing envelope`, async () => {
        await assert.rejects(host.runtime('example')!.invoke(`example.${effect}`, {}),
          (error: unknown) => error instanceof ProcessExtensionHostError && error.code === 'request_failed' && /ordinary Session invocation envelope is required/i.test(error.message))
      })
      await t.test(`${effect}: missing ordinary Session`, async () => {
        await assert.rejects(host.runtime('example')!.invoke(`example.${effect}`, {}, 1, undefined, undefined,
          { caller: {}, context: {} } as DshInvocationContext),
        (error: unknown) => error instanceof ProcessExtensionHostError && error.code === 'request_failed' && /invocation context/i.test(error.message))
      })
    }
    assert.equal(authorizations, 0)
    assert.equal(send.mock.callCount(), 0)
  } finally {
    t.mock.restoreAll()
    await host.disposeAll()
    await rm(directory, { recursive: true, force: true })
  }
})

test('cross-process ordinary Session invocations preserve caller context, authorize effect, and create a local Agent scope', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-process-session-'))
  const rawContext = Object.freeze({ requestId: 'req-1', runtimeId: 'runtime-1', threadId: 'thread-1', turnId: 'turn-1', callId: 'call-1', marker: 'do-not-overwrite' })
  const ordinarySession = Object.freeze({ runtimeId: 'runtime-1', threadId: 'thread-1', sessionId: 'session-1' })
  const caller = Object.freeze({ audience: 'agent', callerId: 'principal-1', workspaceId: 'workspace-1' })
  const seen: DshToolAuthorizationRequest[] = []
  const host = new ProcessExtensionHost({
    resolveDshToolGrants: () => ({
      list: { id: 'example.consumer.list', effect: 'read' },
      create: { id: 'example.consumer.create', effect: 'workspace-write' },
      compute: { id: 'example.consumer.compute', effect: 'compute' },
    }),
    authorizeDshTool: (request) => {
      seen.push(request)
      assert.deepEqual(request.context, rawContext)
      assert.deepEqual(request.ordinarySession, ordinarySession)
      assert.deepEqual(request.caller, caller)
      assert.ok(request.effect === 'read' || request.effect === 'workspace-write' || request.effect === 'compute')
    },
  })
  try {
    const entryPath = join(directory, 'consumer.mjs')
    const resolverPath = join(directory, 'agent-resolver.mjs')
    await writeFile(resolverPath, `
import { createScope } from '@deepseek-ai/dsh-scope'
export function resolveAgent({ identity, rootContext }) {
  const agent = { id: identity.sessionId, session: { id: identity.sessionId } }
  const scope = createScope(rootContext, agent)
  agent.ctx = scope.ctx
  return { agent, dispose: scope.dispose }
}
`)
    await writeFile(entryPath, `
import { defineTool, ToolRuntime } from '@deepseek-ai/dsh-tools'
export const inject = ['tools']
export function apply(ctx) {
  if (!(ctx.tools instanceof ToolRuntime)) throw new Error('tools identity mismatch')
  const register = (name) => ctx.tools.register(defineTool({ name, description: name, parameters: {},
    output: { schema: { type: 'object', properties: { agentId: { type: 'string' }, sessionId: { type: 'string' } }, additionalProperties: false }, render: () => [] },
    execute: async (_args, exec) => ({ agentId: exec.agent?.id, sessionId: exec.agent?.session.id }) }));
  register('list')
  register('create')
  register('compute')
}
`)
    const state = await host.replace({ pluginId: 'consumer', packageName: 'example', version: '1.0.0', entryPath, dshAgentResolver: { path: resolverPath } })
    const runtime = host.runtime('example')!
    assert.deepEqual(state.capabilityIds, ['example.consumer.list', 'example.consumer.create', 'example.consumer.compute'])
    assert.deepEqual(await runtime.invoke('example.consumer.list', {}, state.generation, undefined, undefined, { caller, ordinarySession, context: rawContext }), {
      output: { agentId: 'session-1', sessionId: 'session-1' },
    })
    assert.deepEqual(await runtime.invoke('example.consumer.create', {}, state.generation, undefined, undefined, { caller, ordinarySession, context: rawContext }), {
      output: { agentId: 'session-1', sessionId: 'session-1' },
    })
    assert.deepEqual(await runtime.invoke('example.consumer.compute', {}, state.generation, undefined, undefined, { caller, ordinarySession, context: rawContext }), {
      output: { agentId: 'session-1', sessionId: 'session-1' },
    })
    assert.equal(seen.length, 3)
    assert.deepEqual(seen.map((request) => request.effect), ['read', 'workspace-write', 'compute'])

    const missingResolverHost = new ProcessExtensionHost({
      resolveDshToolGrants: () => ({
        list: { id: 'example.consumer.list', effect: 'read' },
        create: { id: 'example.consumer.create', effect: 'workspace-write' },
        compute: { id: 'example.consumer.compute', effect: 'compute' },
      }),
      authorizeDshTool: () => undefined,
    })
    try {
      await missingResolverHost.replace({ pluginId: 'consumer-missing-resolver', packageName: 'example-missing-resolver', version: '1.0.0', entryPath })
      await assert.rejects(
        missingResolverHost.runtime('example-missing-resolver')!.invoke('example.consumer.list', {}, 1, undefined, undefined, { caller, ordinarySession, context: rawContext }),
        (error: unknown) => error instanceof ProcessExtensionHostError && error.code === 'request_failed' && /child-local ordinary Agent resolver/i.test(error.message)
      )
    } finally {
      await missingResolverHost.disposeAll()
    }
  } finally {
    await host.disposeAll()
    await rm(directory, { recursive: true, force: true })
  }
})

test('Host snapshots the invocation before authorization and sends that same immutable context to the child', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-process-invocation-snapshot-'))
  let releaseAuthorization!: () => void
  let signalAuthorizationStarted!: () => void
  const authorizationStarted = new Promise<void>((resolve) => { signalAuthorizationStarted = resolve })
  const authorizationRelease = new Promise<void>((resolve) => { releaseAuthorization = resolve })
  let authorized: DshToolAuthorizationRequest | undefined
  const host = new ProcessExtensionHost({
    resolveDshToolGrants: () => ({
      execute: { id: 'example.consumer.execute', effect: 'workspace-write' },
    }),
    authorizeDshTool: async (request) => {
      authorized = request
      signalAuthorizationStarted()
      await authorizationRelease
    },
  })
  const invocation = {
    caller: { callerId: 'caller-original' },
    ordinarySession: { runtimeId: 'runtime-original', threadId: 'thread-original', sessionId: 'session-original' },
    context: { marker: 'context-original', runtimeId: 'raw-context-runtime', nested: [{ marker: 'nested-original' }] },
  }
  try {
    const resolverPath = join(directory, 'agent-resolver.mjs')
    const entryPath = join(directory, 'consumer.mjs')
    await writeFile(resolverPath, `
export function resolveAgent({ identity, invocation }) {
  return { agent: {
    id: identity.sessionId,
    session: { id: identity.sessionId },
    ctx: {},
    observed: { callerId: invocation.caller.callerId, marker: invocation.context.marker, nestedMarker: invocation.context.nested[0].marker },
  } }
}
`)
    await writeFile(entryPath, `
import { defineTool } from '@deepseek-ai/dsh-tools'
export const inject = ['tools']
export function apply(ctx) {
  ctx.tools.register(defineTool({ name: 'execute', description: 'execute', parameters: {},
    output: { schema: { type: 'object', properties: { sessionId: { type: 'string' }, callerId: { type: 'string' }, marker: { type: 'string' }, nestedMarker: { type: 'string' } }, additionalProperties: false }, render: () => [] },
    execute: async (_args, exec) => ({ sessionId: exec.agent.id, callerId: exec.agent.observed.callerId, marker: exec.agent.observed.marker, nestedMarker: exec.agent.observed.nestedMarker }) }))
}
`)
    const spawn = t.mock.method(ChildProcess.prototype as ChildProcess & { spawn: (...args: unknown[]) => unknown }, 'spawn')
    const state = await host.replace({ pluginId: 'consumer', packageName: 'example', version: '1.0.0', entryPath, dshAgentResolver: { path: resolverPath } })
    const child = spawn.mock.calls[0].this as ChildProcess
    const send = t.mock.method(child, 'send')
    const invoke = host.runtime('example')!.invoke('example.consumer.execute', {}, state.generation, undefined, undefined, invocation)
    await authorizationStarted
    assert.equal(send.mock.callCount(), 0)
    invocation.caller.callerId = 'caller-mutated'
    invocation.ordinarySession.runtimeId = 'runtime-mutated'
    invocation.ordinarySession.threadId = 'thread-mutated'
    invocation.ordinarySession.sessionId = 'session-mutated'
    invocation.context.marker = 'context-mutated'
    invocation.context.nested[0].marker = 'nested-mutated'
    invocation.caller = { callerId: 'caller-replaced' }
    invocation.ordinarySession = { runtimeId: 'runtime-replaced', threadId: 'thread-replaced', sessionId: 'session-replaced' }
    invocation.context = { marker: 'context-replaced', runtimeId: 'runtime-replaced', nested: [] }
    releaseAuthorization()

    assert.deepEqual(await invoke, {
      output: { sessionId: 'session-original', callerId: 'caller-original', marker: 'context-original', nestedMarker: 'nested-original' },
    })
    assert.deepEqual(authorized, {
      packageName: 'example', version: '1.0.0', generation: state.generation,
      capabilityId: 'example.consumer.execute', effect: 'workspace-write',
      caller: { callerId: 'caller-original' },
      ordinarySession: { runtimeId: 'runtime-original', threadId: 'thread-original', sessionId: 'session-original' },
      context: { marker: 'context-original', runtimeId: 'raw-context-runtime', nested: [{ marker: 'nested-original' }] },
    })
    assert.equal(Object.isFrozen(authorized), true)
    assert.equal(Object.isFrozen(authorized?.caller), true)
    assert.equal(Object.isFrozen(authorized?.ordinarySession), true)
    assert.equal(Object.isFrozen(authorized?.context), true)
    assert.equal(Object.isFrozen(authorized?.context.nested), true)
    assert.equal(Object.isFrozen((authorized?.context.nested as object[])[0]), true)
    const dispatched = send.mock.calls[0].arguments[0] as unknown as { payload: { invocation: DshInvocationContext } }
    assert.equal(send.mock.callCount(), 1)
    assert.equal(Object.isFrozen(dispatched.payload.invocation), true)
    assert.equal(dispatched.payload.invocation.caller, authorized?.caller)
    assert.equal(dispatched.payload.invocation.ordinarySession, authorized?.ordinarySession)
    assert.equal(dispatched.payload.invocation.context, authorized?.context)
  } finally {
    releaseAuthorization()
    t.mock.restoreAll()
    await host.disposeAll()
    await rm(directory, { recursive: true, force: true })
  }
})

test('Host lossless retention preserves own JSON fields through authorization and real child Tool execution', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-host-lossless-retention-'))
  let releaseAuthorization!: () => void
  let signalAuthorizationStarted!: () => void
  const authorizationStarted = new Promise<void>((resolve) => { signalAuthorizationStarted = resolve })
  const authorizationRelease = new Promise<void>((resolve) => { releaseAuthorization = resolve })
  let authorized: DshToolAuthorizationRequest | undefined
  const host = new ProcessExtensionHost({
    resolveDshToolGrants: () => ({ echo: { id: 'neutral.echo', effect: 'workspace-write' } }),
    authorizeDshTool: async (request) => {
      authorized = request
      signalAuthorizationStarted()
      await authorizationRelease
    },
  })
  const describe = (value: unknown): unknown => value !== null && typeof value === 'object'
    ? { kind: Array.isArray(value) ? 'array' : 'object', entries: Object.entries(value).map(([key, child]) => [key, describe(child)]) }
    : value
  const caller = JSON.parse('{"__proto__":{"marker":"caller-own-proto"},"nested":{"__proto__":{"marker":"caller-nested-proto"}}}')
  const array = Object.assign([JSON.parse('{"__proto__":{"marker":"array-element-proto"}}')], {
    extra: { nested: Object.assign(['nested-element'], { extra: { marker: 'nested-array-extra' } }) },
  })
  Object.defineProperty(array, '__proto__', { value: { marker: 'array-own-proto' }, enumerable: true, writable: true, configurable: true })
  const context = JSON.parse('{"__proto__":{"marker":"context-own-proto"},"metadata":{"__proto__":{"marker":"context-nested-proto"}}}')
  context.array = array
  const invocation = { caller, context, ordinarySession: { runtimeId: 'runtime', threadId: 'thread', sessionId: 'session' } }
  const expected = describe(invocation)
  try {
    const entryPath = join(directory, 'entry.mjs')
    const resolverPath = join(directory, 'resolver.mjs')
    await writeFile(resolverPath, `
export function resolveAgent({ identity, invocation }) {
  const describe = ${describe.toString()}
  return { agent: { id: identity.sessionId, session: { id: identity.sessionId }, ctx: {}, observed: { pid: process.pid, facts: describe(invocation) } } }
}
`)
    await writeFile(entryPath, `
import { defineTool } from '@deepseek-ai/dsh-tools'
export const inject = ['tools']
export function apply(ctx) {
  ctx.tools.register(defineTool({ name: 'echo', description: 'echo', parameters: {},
    output: { schema: { type: 'string' }, render: () => [] },
    execute: async (_args, exec) => JSON.stringify(exec.agent.observed) }))
}
`)
    const spawn = t.mock.method(ChildProcess.prototype as ChildProcess & { spawn: (...args: unknown[]) => unknown }, 'spawn')
    const state = await host.replace({ pluginId: 'neutral', packageName: 'neutral', version: '1.0.0', entryPath, dshAgentResolver: { path: resolverPath } })
    const child = spawn.mock.calls[0].this as ChildProcess
    const send = t.mock.method(child, 'send')
    const invoke = host.runtime('neutral')!.invoke('neutral.echo', {}, state.generation, undefined, undefined, invocation)
    await authorizationStarted
    assert.equal(send.mock.callCount(), 0)
    // Change both existing own fields and nested array extras while authorization awaits.
    caller.__proto__.marker = 'mutated'
    caller.nested.__proto__.marker = 'mutated'
    context.__proto__.marker = 'mutated'
    context.metadata.__proto__.marker = 'mutated'
    array.extra.nested.extra.marker = 'mutated'
    Object.defineProperty(array, '__proto__', { value: { marker: 'mutated' }, enumerable: true })
    invocation.caller = {}
    invocation.context = {}
    invocation.ordinarySession.sessionId = 'mutated'
    releaseAuthorization()
    const result = await invoke as { output: string }
    const observed = JSON.parse(result.output)
    await t.test('own __proto__ survives without prototype pollution', () => {
      assert.ok(Object.hasOwn(authorized!.caller, '__proto__'))
      assert.ok(Object.hasOwn(authorized!.context, '__proto__'))
      assert.equal(Object.getPrototypeOf(authorized!.caller), Object.prototype)
      assert.equal(Object.getPrototypeOf(authorized!.context), Object.prototype)
      assert.equal(Object.hasOwn(Object.prototype, 'marker'), false)
    })
    await t.test('nested objects and array own extras are retained in immutable detached facts', () => {
      assert.deepEqual(describe({ caller: authorized!.caller, context: authorized!.context, ordinarySession: authorized!.ordinarySession }), expected)
      const assertFrozen = (value: unknown): void => {
        if (value !== null && typeof value === 'object') {
          assert.equal(Object.isFrozen(value), true)
          for (const child of Object.values(value)) assertFrozen(child)
        }
      }
      assertFrozen(authorized)
      const admittedArray = authorized!.context.array as typeof array
      assert.notEqual(admittedArray, array)
      assert.throws(() => { admittedArray.extra.nested.extra.marker = 'tampered' }, TypeError)
      assert.throws(() => Object.defineProperty(admittedArray, '__proto__', { value: {} }), TypeError)
    })
    await t.test('authorization and IPC share the same snapshot and the actual child Tool returns all facts', () => {
      assert.equal(send.mock.callCount(), 1)
      const dispatched = send.mock.calls[0].arguments[0] as unknown as { payload: { invocation: DshInvocationContext } }
      assert.equal(dispatched.payload.invocation.caller, authorized!.caller)
      assert.equal(dispatched.payload.invocation.context, authorized!.context)
      assert.equal(dispatched.payload.invocation.ordinarySession, authorized!.ordinarySession)
      assert.equal(Object.isFrozen(dispatched.payload.invocation), true)
      assert.equal(observed.pid, state.pid)
      assert.notEqual(observed.pid, process.pid)
      assert.deepEqual(observed.facts, expected)
    })
  } finally {
    releaseAuthorization()
    t.mock.restoreAll()
    await host.disposeAll()
    await rm(directory, { recursive: true, force: true })
  }
})

test('post-commit drain failure restores ownership but keeps ordinary invocation fenced', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-process-drain-'))
  const host = new ProcessExtensionHost()
  try {
    const firstPath = join(directory, 'v1.mjs')
    const secondPath = join(directory, 'v2.mjs')
    await writeFile(firstPath, moduleSource('1.0.0', false, true))
    await writeFile(secondPath, moduleSource('2.0.0'))
    await host.replace({ pluginId: 'fixture', packageName: 'fixture', version: '1.0.0', entryPath: firstPath })
    await host.prepare({ pluginId: 'fixture', packageName: 'fixture', version: '2.0.0', entryPath: secondPath })
    await host.commit('fixture')
    await assert.rejects(host.finalizeCommit('fixture'), /deactivate failed/)
    const restored = await host.rollbackCommitted('fixture')
    assert.equal(restored?.version, '1.0.0')
    assert.equal(restored?.state, 'failed')
    assert.equal(host.runtime('fixture')!.snapshot.error, 'deactivate failed')
    // Host restores the generation owner for retry, not permission to resume
    // effects after teardown has already begun inside the child.
    await assert.rejects(host.runtime('fixture')!.invoke('fixture.echo', { value: 9 }), /stale/)
    await assert.rejects(host.runtime('fixture')!.deactivate(), /deactivate failed/)
  } finally {
    await host.disposeAll().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

for (const reason of ['new Error("cleanup obstruction")', 'undefined', 'null', 'false', '0', "''"]) {
  test(`failed deactivate retains fenced cleanup ownership and retries (${reason})`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sciforge-cleanup-retry-'))
    const host = new ProcessExtensionHost()
    const marker = join(directory, 'attempts')
    try {
      const entryPath = join(directory, 'main.mjs')
      await writeFile(marker, '')
      await writeFile(entryPath, moduleSource('1.0.0').replace(
        'export async function deactivate() { active = false }',
        `let attempts = 0
import { appendFile } from 'node:fs/promises'
export async function deactivate() {
  await appendFile(${JSON.stringify(marker)}, 'attempt\\n')
  if (++attempts === 1) throw ${reason}
  active = false
}`))
      await host.replace({ pluginId: 'fixture', packageName: 'fixture', version: '1.0.0', entryPath })
      const runtime = host.runtime('fixture')!
      assert.deepEqual(await runtime.invoke('fixture.echo', { value: 9 }), { output: { value: 9, version: '1.0.0' } })
      await assert.rejects(runtime.deactivate())
      assert.equal(runtime.snapshot.state, 'failed')
      assert.equal(typeof runtime.snapshot.error, 'string')
      assert.equal(host.runtime('fixture'), runtime)
      await assert.rejects(runtime.invoke('fixture.echo', { value: 9 }), /stale/)
      assert.equal((await runtime.deactivate()).state, 'disabled')
      assert.equal((await readFile(marker, 'utf8')).trim().split('\n').length, 2)
      assert.equal(runtime.snapshot.error, undefined)
      await assert.rejects(runtime.invoke('fixture.echo', { value: 9 }), /stale/)
    } finally {
      await host.disposeAll().catch(() => undefined)
      await rm(directory, { recursive: true, force: true })
    }
  })
}

const portsModuleSource = `
export async function activate() {}
export async function deactivate() {}
export async function dispose() {}
export function getCapabilityDefinitions() {
  const inputSchema = { type: 'object', properties: { operation: { type: 'string' }, input: { type: 'object' }, scope: { type: 'object' }, workspaceRoot: { type: 'string' } } }
  const outputSchema = { type: 'object' }
  return [{ descriptor: { contractVersion: 3, id: 'fixture.ports', version: '1.0.0', title: 'Ports probe', description: 'Host ports bridge probe.', audiences: ['agent'], scope: 'workspace', resourceKinds: [], effect: 'read', approval: 'none', concurrency: { revision: 'none', idempotency: 'none' }, inputSchema, outputSchema, tags: ['fixture', 'ports'] },
    handler: async (input) => {
      try {
        const value = await globalThis.__sciforgeHostPorts.request({
          operation: input.operation, input: input.input ?? {}, ...(input.scope ? { scope: input.scope } : {}),
          // Deliberately hostile identity; the Host must overwrite it.
          identity: { pluginId: 'spoofed', version: '9.9.9', profileId: 'spoofed' }
        })
        return { output: { ok: true, value } }
      } catch (error) {
        return { output: { ok: false, code: error?.code ?? 'unknown', message: error?.message } }
      }
    } }]
}
`

test('Host ports bridge binds connection identity and round-trips structured results', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-host-ports-bridge-'))
  const seen: Array<{ request: import('./process-extension-host.js').HostPortsRequest; boundWorkspace: string | undefined }> = []
  const host = new ProcessExtensionHost()
  try {
    const entryPath = join(directory, 'main.mjs')
    await writeFile(entryPath, portsModuleSource)
    await host.replace({
      pluginId: 'fixture', packageName: 'fixture', version: '2.3.4', entryPath,
      onPortsRequest: async (request, boundWorkspace) => {
        seen.push({ request, boundWorkspace })
        if (request.operation === 'boom') return { ok: false, error: { code: 'execution_failed', message: 'structured boom' } }
        return { ok: true, value: { operation: request.operation, workspaceBound: boundWorkspace, identity: request.identity } }
      }
    })
    const runtime = host.runtime('fixture')!
    const okResult = await runtime.invoke('fixture.ports', { operation: 'artifacts.read', input: { a: 1 }, workspaceRoot: '/ws/one' }) as { output: Record<string, unknown> }
    assert.equal(okResult.output.ok, true)
    assert.deepEqual(okResult.output.value, { operation: 'artifacts.read', workspaceBound: '/ws/one', identity: { pluginId: 'fixture', version: '2.3.4' } })
    assert.equal(seen.length, 1)
    // Layer 2: the plugin-supplied identity never reaches Host authorization.
    assert.deepEqual(seen[0].request.identity, { pluginId: 'fixture', version: '2.3.4' })
    assert.equal(seen[0].boundWorkspace, '/ws/one')
    assert.equal(seen[0].request.input && (seen[0].request.input as { a: number }).a, 1)
    const errorResult = await runtime.invoke('fixture.ports', { operation: 'boom', input: {}, workspaceRoot: '/ws/one' }) as { output: Record<string, unknown> }
    assert.deepEqual(errorResult.output, { ok: false, code: 'execution_failed', message: 'structured boom' })
    // Without an in-flight workspace binding the runner omits boundWorkspace.
    const unboundResult = await runtime.invoke('fixture.ports', { operation: 'artifacts.read', input: {} }) as { output: Record<string, unknown> }
    assert.equal(unboundResult.output.ok, true)
    assert.equal(seen.length, 3)
    assert.equal(seen[2].boundWorkspace, undefined)
    await host.dispose('fixture')
  } finally {
    await host.disposeAll().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

test('Host ports bridge fails closed when no handler is configured', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-host-ports-unavailable-'))
  const host = new ProcessExtensionHost()
  try {
    const entryPath = join(directory, 'main.mjs')
    await writeFile(entryPath, portsModuleSource)
    await host.replace({ pluginId: 'fixture', packageName: 'fixture', version: '1.0.0', entryPath })
    const runtime = host.runtime('fixture')!
    const result = await runtime.invoke('fixture.ports', { operation: 'artifacts.read', input: {}, workspaceRoot: '/ws/one' }) as { output: Record<string, unknown> }
    assert.deepEqual(result.output, { ok: false, code: 'ports_unavailable', message: 'Host ports bridge is not available for this extension.' })
    await host.dispose('fixture')
  } finally {
    await host.disposeAll().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})
