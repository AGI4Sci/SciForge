import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { PluginAdapterContract } from '@sciforge/plugin-sdk'
import { CapabilityBroker } from '../capabilities/broker'
import { CapabilityRegistry } from '../capabilities/registry'
import { DevelopmentExternalPluginService } from './development-external-plugins'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-backend-'))
  const contracts = new Map<string, PluginAdapterContract>()
  for (const name of ['config-one', 'config-two']) {
    const dir = join(root, 'plugins', name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module', exports: { '.': './main.js' }, dsh: { bundle: { patch: './patch.yml' } } }))
    await writeFile(join(dir, 'patch.yml'), '[]')
    await writeFile(join(dir, 'main.js'), `
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
export const Config = z.object({ label: z.string().default('default') })
export const inject = ['tools']
export function apply(ctx, config) {
 ctx.tools.register(defineTool({ name: 'config', description: 'Read configuration', parameters: {},
 output: { schema: {type:'string'}, render: (_args,v)=>[{type:'text',text:v}] },
 execute: async ()=>config.label }))
}
`)
    contracts.set(name, { approved: true, permissions: [], hostApiRange: '^1.0.0', dshAuthorization: { packageName: name, packageVersion: '1.0.0', dshRuntimeVersion: '0.2.0-rc.2', tools: { config: { id: `${name}.config`, effect: 'compute' } } } })
  }
  const create = (profile = 'data') => new DevelopmentExternalPluginService({ root: join(root, 'plugins'), userDataPath: join(root, profile), hostApiVersion: '1.0.0', dshRuntimeVersion: '0.2.0-rc.2', adapterContracts: contracts })
  return { root, create, contracts }
}

it('official Config reaches apply after process restart and stays isolated by package and profile', async () => {
  const f = await fixture()
  const first = f.create()
  const restarted = f.create()
  const otherProfile = f.create('other-data')
  try {
    await first.initialize()
    await first.setDshConfig('config-one', { label: 'persisted' })
    await first.setEnabled('config-one', true)
    await first.setEnabled('config-two', true)
    await first.dispose()
    const registry = new CapabilityRegistry()
    await restarted.initialize()
    await restarted.attachCapabilityRegistry(registry)
    const broker = new CapabilityBroker(registry)
    const caller = { audience: 'agent' as const, callerId: 'synthetic' }
    expect((await broker.invoke(caller, { actionId: 'config-one.config', invocationId: 'one', input: {} })).output).toBe('persisted')
    expect((await broker.invoke(caller, { actionId: 'config-two.config', invocationId: 'two', input: {} })).output).toBe('default')
    const otherRegistry = new CapabilityRegistry()
    await otherProfile.initialize()
    await otherProfile.attachCapabilityRegistry(otherRegistry)
    await otherProfile.setEnabled('config-one', true)
    expect((await new CapabilityBroker(otherRegistry).invoke(caller, { actionId: 'config-one.config', invocationId: 'other', input: {} })).output).toBe('default')
  } finally {
    await Promise.all([first.dispose(), restarted.dispose(), otherProfile.dispose()])
    await rm(f.root, { recursive: true, force: true })
  }
})

// Additional negative regressions: these exercise existing validation after the positive RED→GREEN slice.
it('invalid official Config never activates or registers a capability', async () => {
  const f = await fixture()
  const service = f.create()
  const registry = new CapabilityRegistry()
  try {
    await service.initialize()
    await service.attachCapabilityRegistry(registry)
    const broker = new CapabilityBroker(registry)
    const caller = { audience: 'agent' as const, callerId: 'synthetic' }
    // Host-owned development tools remain discoverable when plugin activation
    // is rejected. Compare the complete set, not a filtered plugin-only view.
    const hostBaseline = broker.discover(caller)
    expect(hostBaseline.map(({ id }) => id)).toEqual([
      'plugin.dev.check', 'plugin.dev.prepare', 'plugin.dev.submit',
      'plugin.update.request', 'plugin.update.status'
    ])
    await service.setDshConfig('config-one', { label: 123 })
    await expect(service.setEnabled('config-one', true)).rejects.toThrow()
    expect(broker.discover(caller)).toEqual(hostBaseline)
  } finally {
    await service.dispose()
    await rm(f.root, { recursive: true, force: true })
  }
})

it('configuration writes reject active plugins and non-JSON values', async () => {
  const f = await fixture()
  const service = f.create()
  try {
    await service.initialize()
    await expect(service.setDshConfig('config-one', { invalid: () => undefined })).rejects.toThrow()
    await service.setEnabled('config-one', true)
    await expect(service.setDshConfig('config-one', { label: 'changed' })).rejects.toThrow(/Stop/)
  } finally {
    await service.dispose()
    await rm(f.root, { recursive: true, force: true })
  }
})

it('Broker cancellation reaches child Tool signal rather than only suppressing the host result', async () => {
  const f = await fixture()
  const marker = join(f.root, 'abort-marker')
  await writeFile(join(f.root, 'plugins/config-one/main.js'), `
import { writeFileSync } from 'node:fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
export const inject = ['tools']
export function apply(ctx) {
 ctx.tools.register(defineTool({name:'config',description:'Wait for cancellation',parameters:{},
 output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},
 execute:async (_args,exec)=>{
  writeFileSync(${JSON.stringify(marker)},'started')
  await new Promise(resolve=>exec.signal.addEventListener('abort',()=>{writeFileSync(${JSON.stringify(marker)},'aborted');resolve()},{once:true}))
  return 'late'
 }}))
}
`)
  const service = f.create()
  const registry = new CapabilityRegistry()
  const broker = new CapabilityBroker(registry)
  try {
    await service.initialize()
    await service.attachCapabilityRegistry(registry)
    await service.setEnabled('config-one', true)
    const controller = new AbortController()
    const call = broker.invoke({ audience: 'agent', callerId: 'synthetic' }, { actionId: 'config-one.config', invocationId: 'cancel', input: {} }, { signal: controller.signal })
    const outcome = call.then(() => ({ code: 'unexpected_success' }), (error: unknown) => error)
    await expect.poll(() => readFile(marker, 'utf8').catch(() => ''), { timeout: 2000 }).toBe('started')
    controller.abort()
    await expect.poll(() => readFile(marker, 'utf8'), { timeout: 1000 }).toBe('aborted')
    expect(await outcome).toMatchObject({ code: 'invocation_cancelled' })
  } finally {
    await service.dispose()
    await rm(f.root, { recursive: true, force: true })
  }
})
