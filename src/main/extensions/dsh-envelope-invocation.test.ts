import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import { ContributionHost, ProcessExtensionHost, ProcessExtensionRuntime, type PluginAdapterContract } from '@sciforge/plugin-sdk'
import { CapabilityBroker } from '../capabilities/broker.js'
import { CapabilityRegistry } from '../capabilities/registry.js'
import { DevelopmentExternalPluginService } from './development-external-plugins.js'
import { DshSessionEnvelopeCache } from './dsh-session-envelope.js'

/**
 * G9 integration: a non-compute DSH tool invoked through the real Broker with
 * an ordinary Session must receive a complete invocation envelope. Before G9
 * this failed with "DSH ordinary Session invocation envelope is required.".
 */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-envelope-'))
  const name = 'neutral-envelope'
  const plugin = join(root, 'plugins', name)
  await mkdir(plugin, { recursive: true })
  await writeFile(join(plugin, 'package.json'), JSON.stringify({
    name, version: '1.0.0', type: 'module', exports: { '.': './main.mjs' }, dsh: { bundle: { patch: './patch.yml' } }
  }))
  await writeFile(join(plugin, 'patch.yml'), '[]')
  await writeFile(join(plugin, 'main.mjs'), `
import { defineTool } from '@deepseek-ai/dsh-tools'
export const inject = ['tools']
export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'echo',
    description: 'Echo the value back.',
    parameters: { value: { type: 'string' } },
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [] },
    execute: (args) => ({ value: args.value ?? null })
  }))
}
`)
  const contract: PluginAdapterContract = {
    hostApiRange: '^1', permissions: [], approved: true,
    dshAuthorization: {
      packageName: name,
      packageVersion: '1.0.0',
      dshRuntimeVersion: '0.2.0-rc.2',
      hostServices: 'none',
      tools: { echo: { id: 'neutral.echo', effect: 'read' } }
    }
  }
  const resolverPath = join(root, 'agent-resolver.mjs')
  await writeFile(resolverPath, `
import { createScope } from '@deepseek-ai/dsh-scope'
export function resolveAgent({ identity, rootContext }) {
  const agent = { id: identity.sessionId, session: { id: identity.sessionId } }
  const scope = createScope(rootContext, agent)
  agent.ctx = scope.ctx
  return { agent, dispose: scope.dispose }
}
`)
  const service = new DevelopmentExternalPluginService({
    root: join(root, 'plugins'),
    dshAgentResolver: { path: resolverPath },
    userDataPath: join(root, 'profile'),
    hostApiVersion: '1.11.0',
    dshRuntimeVersion: '0.2.0-rc.2',
    adapterContracts: new Map([[`${name}@1.0.0`, contract]])
  })
  const registry = new CapabilityRegistry()
  const broker = new CapabilityBroker(registry)
  const caller = { audience: 'agent' as const, callerId: 'canonical-caller', workspaceId: root }
  const session = { runtimeId: 'canonical-runtime', threadId: 'canonical-thread' }
  type ResourceHandle = { token: string; semanticRevision: string; expiresAt: string }
  const open = async (): Promise<ResourceHandle> => (await broker.invokeOrdinarySession(
    caller,
    { actionId: 'neutral-envelope.dsh-session.open', input: {} },
    session
  )).output as unknown as ResourceHandle
  return {
    root, name, service, registry, broker, caller, session, open,
    start: async () => { await service.initialize(); await service.attachCapabilityRegistry(registry) },
    close: async () => { await service.dispose(); await rm(root, { recursive: true, force: true }) }
  }
}

test('real Broker invocation carries the ordinary Session envelope', { timeout: 60_000 }, async () => {
  const f = await fixture()
  try {
    await f.start()
    await f.service.setEnabled(f.name, true)
    const resource = await f.open()
    const [first, concurrent] = await Promise.all(['first', 'concurrent'].map(value => f.broker.invokeOrdinarySession(f.caller, {
      actionId: 'neutral.echo', input: { value }, resource
    }, f.session)))
    expect(first.output).toEqual({ value: 'first' })
    expect(concurrent.output).toEqual({ value: 'concurrent' })

    // Same thread: the Host reuses the synthetic session and the call still works.
    await f.service.setEnabled(f.name, true)
    const second = await f.broker.invokeOrdinarySession(f.caller, {
      actionId: 'neutral.echo', input: { value: 'second' }, resource
    }, f.session)
    expect(second.output).toEqual({ value: 'second' })
  } finally {
    await f.close()
  }
})

test('a new generation opens a new synthetic session and still invokes', { timeout: 60_000 }, async () => {
  const f = await fixture()
  try {
    await f.start()
    await f.service.setEnabled(f.name, true)
    await f.broker.invokeOrdinarySession(f.caller, {
      actionId: 'neutral.echo', input: { value: 'gen-1' }, resource: await f.open()
    }, f.session)

    await f.service.setEnabled(f.name, false)
    await f.service.setEnabled(f.name, true)
    const resource = await f.open()
    const result = await f.broker.invokeOrdinarySession(f.caller, {
      actionId: 'neutral.echo', input: { value: 'gen-2' }, resource
    }, f.session)
    expect(result.output).toEqual({ value: 'gen-2' })
  } finally {
    await f.close()
  }
})

function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

for (const fails of [false, true]) {
  test(`Host disposal clears teardown-era sessions even when disposal ${fails ? 'fails' : 'succeeds'}`, { timeout: 60_000 }, async () => {
    const f = await fixture()
    const unregisterEntered = gate()
    const resumeUnregister = gate()
    const sessionOpened = gate()
    const returnSession = gate()
    const failure = new Error('runtime disposal failed after cleanup')
    let cache: DshSessionEnvelopeCache | undefined
    const spies: Array<{ mockRestore(): void }> = []
    try {
      await f.start()
      await f.service.setEnabled(f.name, true)
      await f.broker.invokeOrdinarySession(f.caller, {
        actionId: 'neutral.echo', input: { value: 'before-disposal' }, resource: await f.open()
      }, f.session)

      const clear = DshSessionEnvelopeCache.prototype.clear
      spies.push(vi.spyOn(DshSessionEnvelopeCache.prototype, 'clear').mockImplementation(function (this: DshSessionEnvelopeCache) {
        cache = this
        clear.call(this)
      }))
      const unregister = ContributionHost.prototype.unregisterPlugin
      spies.push(vi.spyOn(ContributionHost.prototype, 'unregisterPlugin').mockImplementationOnce(async function (this: ContributionHost, ...args) {
        unregisterEntered.release()
        await resumeUnregister.promise
        await unregister.apply(this, args)
      }))
      const open = ProcessExtensionRuntime.prototype.syntheticSession
      spies.push(vi.spyOn(ProcessExtensionRuntime.prototype, 'syntheticSession').mockImplementationOnce(async function (this: ProcessExtensionRuntime, ...args) {
        const result = await open.apply(this, args)
        sessionOpened.release()
        await returnSession.promise
        return result
      }))
      if (fails) {
        const dispose = ProcessExtensionHost.prototype.disposeAll
        spies.push(vi.spyOn(ProcessExtensionHost.prototype, 'disposeAll').mockImplementationOnce(async function (this: ProcessExtensionHost) {
          await dispose.call(this)
          throw failure
        }))
      }

      const disposed = f.service.dispose().then(() => undefined, (error: unknown) => error)
      await unregisterEntered.promise
      expect(cache?.size).toBe(0)
      // Exercise the public thin-layer path while runtime teardown is paused.
      const invocation = f.service.invokeTool(f.name, 'echo', { value: 'during-disposal' }, {
        caller: f.caller,
        ordinarySession: { ...f.session, threadId: 'teardown-thread', sessionId: 'host-placeholder' },
        context: {}
      })
      const result = Promise.allSettled([invocation])
      await sessionOpened.promise
      expect(cache?.size).toBe(1)
      resumeUnregister.release()
      expect(await disposed).toBe(fails ? failure : undefined)
      expect(cache?.size).toBe(0)
      returnSession.release()
      expect(await result).toEqual([{ status: 'rejected', reason: expect.objectContaining({ message: 'DSH session creation was invalidated.' }) }])
      expect(cache?.size).toBe(0)
    } finally {
      resumeUnregister.release()
      returnSession.release()
      for (const spy of spies.reverse()) spy.mockRestore()
      await f.close()
    }
  })
}
