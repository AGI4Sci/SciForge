import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import type { PluginAdapterContract } from '@sciforge/plugin-sdk'
import type { CapabilityResourceHandle } from '../../shared/capability-broker'
import { CapabilityBroker } from '../capabilities/broker'
import { CapabilityRegistry } from '../capabilities/registry'
import { DevelopmentExternalPluginService } from './development-external-plugins'
import { createWorkspaceAuthority } from './workspace-authority'

const NAME = 'example-workspace-reader'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture(options: { missing?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'workspace-resource-authorization-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, 'plugins', NAME)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: NAME, version: '1.0.0', type: 'module', exports: { '.': './main.mjs' }, dsh: { bundle: { patch: './patch.yml' } } }))
  await writeFile(join(directory, 'patch.yml'), '[]')
  const helper = await readFile(new URL('../../../packages/plugin-sdk/src/contract-tool.ts', import.meta.url), 'utf8')
  await writeFile(join(directory, 'contract-tool.mjs'), ts.transpileModule(helper, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
  await writeFile(join(directory, 'main.mjs'), `
import { defineContractTool } from './contract-tool.mjs'
export const inject = ['tools']
export function apply(ctx) {
  let calls = 0
  for (const name of ['read', 'status']) {
    ctx.tools.register(defineContractTool({ name, description: 'Neutral workspace resource read.',
      inputSchema: { type: 'object', additionalProperties: false, properties: name === 'read' ? { workspaceRoot: { type: 'string' } } : {} },
      output: { schema: { type: 'object', additionalProperties: false, required: ['workspaceRoot', 'keys', 'pid', 'calls'], properties: {
        workspaceRoot: { anyOf: [{ type: 'string' }, { type: 'null' }] }, keys: { type: 'array', items: { type: 'string' } }, pid: { type: 'integer' }, calls: { type: 'integer' }
      } }, render: () => [] },
      execute: args => ({ workspaceRoot: args.workspaceRoot ?? null, keys: Object.keys(args), pid: process.pid, calls: ++calls })
    }))
  }
}`)
  const resolverPath = join(root, 'resolver.mjs')
  await writeFile(resolverPath, `
import { createScope } from '@deepseek-ai/dsh-scope'
export function resolveAgent({ identity, rootContext }) {
  const agent = { id: identity.sessionId, session: { id: identity.sessionId } }
  const scope = createScope(rootContext, agent)
  agent.ctx = scope.ctx
  return { agent, dispose: scope.dispose }
}`)
  const contract: PluginAdapterContract = { hostApiRange: '^1', permissions: [], approved: true,
    dshAuthorization: { packageName: NAME, packageVersion: '1.0.0', dshRuntimeVersion: '0.2.0-rc.2', hostServices: 'none', tools: {
      read: { id: 'example.read', effect: 'read', readResource: 'workspace' },
      status: { id: 'example.status', effect: 'read', readResource: 'workspace' }
    } } }
  const contracts = new Map([[NAME, contract]])
  const trustedAuthority = createWorkspaceAuthority({ readTrustedRoots: () => [root] })
  const decisions: Array<{ caller: Record<string, unknown>; workspaceId: string }> = []
  let authority = trustedAuthority
  const service = new DevelopmentExternalPluginService({ root: join(root, 'plugins'), userDataPath: join(root, 'profile'), hostApiVersion: '1.11.0', dshRuntimeVersion: '0.2.0-rc.2', adapterContracts: contracts,
    dshAgentResolver: { path: resolverPath },
    ...(options.missing ? {} : { authorizeWorkspace: async input => { decisions.push(input); return authority(input) } }) })
  cleanups.push(() => service.dispose())
  const registry = new CapabilityRegistry()
  let identityVersion = 1
  const broker = new CapabilityBroker(registry, { resolveCurrentPrincipalContext: () => ({ identityVersion, principal: null }) })
  await service.initialize()
  await service.attachCapabilityRegistry(registry)
  await service.setEnabled(NAME, true)
  const caller = { audience: 'agent' as const, callerId: 'workspace-reader', workspaceId: root }
  const session = { runtimeId: 'example-runtime', threadId: 'example-thread' }
  const open = async (id = 'example.read', who = caller) => (await broker.invokeOrdinarySession(who, { actionId: `${id}.open`, input: {} }, session)).output as CapabilityResourceHandle
  const invoke = (resource: CapabilityResourceHandle, input = {}, id = 'example.read', who = caller) => broker.invokeOrdinarySession(who, { actionId: id, resource, input }, session)
  return { root, broker, caller, service, contracts, contract, open, invoke, decisions, changePrincipal: () => { identityVersion += 1 }, setAuthority: (next: typeof authority) => { authority = next } }
}

function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

describe('workspace resource authorization through Broker and real child', () => {
  it('binds declared workspace arguments and authorizes strict parameterless reads', async () => {
    const f = await fixture()
    const handle = await f.open()
    expect((await f.broker.observe(f.caller, { resource: handle })).operations.map(operation => operation.id)).toEqual(['example.read'])
    await expect(f.invoke(handle, { workspaceRoot: '/foreign' })).rejects.toThrow('rejects a workspaceRoot outside the authenticated caller workspace')
    const bound = await f.invoke(handle, { workspaceRoot: f.root })
    expect(bound.output).toMatchObject({ workspaceRoot: f.root, keys: ['workspaceRoot'], calls: 1 })
    expect((bound.output as { pid: number }).pid).not.toBe(process.pid)
    expect((await f.invoke(handle)).output).toMatchObject({ workspaceRoot: f.root, calls: 2 })
    const status = await f.open('example.status')
    expect((await f.invoke(status, {}, 'example.status')).output).toMatchObject({ workspaceRoot: null, keys: [], calls: 3 })
    expect(f.decisions).toHaveLength(7)
    expect(f.decisions.every(decision => decision.workspaceId === f.root && decision.caller.callerId === f.caller.callerId)).toBe(true)
  })

  it.each(['missing', 'denied', 'untrusted'] as const)('rejects opening with %s Host authority', async mode => {
    const f = await fixture({ missing: mode === 'missing' })
    if (mode === 'denied') f.setAuthority(async () => false)
    const caller = mode === 'untrusted' ? { ...f.caller, workspaceId: tmpdir() } : f.caller
    await expect(f.open('example.read', caller)).rejects.toMatchObject({ code: 'handler_failed' })
    await expect(f.open('example.status', caller)).rejects.toMatchObject({ code: 'handler_failed' })
  })

  it('rechecks authority at observation and invocation without dispatching denied reads', async () => {
    const f = await fixture()
    const handle = await f.open()
    f.setAuthority(async () => false)
    await expect(f.broker.observe(f.caller, { resource: handle })).rejects.toMatchObject({ code: 'observation_failed' })
    await expect(f.invoke(handle)).rejects.toMatchObject({ code: 'handler_failed' })
    f.setAuthority(async () => true)
    expect((await f.invoke(handle)).output).toMatchObject({ calls: 1 })
    await expect(f.invoke(handle, {}, 'example.read', { ...f.caller, callerId: 'other' })).rejects.toThrow()
    await expect(f.invoke(handle, {}, 'example.read', { ...f.caller, workspaceId: '/other' })).rejects.toMatchObject({ code: 'resource_scope_mismatch' })
    f.contracts.set(NAME, { ...f.contract, dshAuthorization: { ...f.contract.dshAuthorization!, tools: {} } })
    await expect(f.invoke(handle)).rejects.toMatchObject({ code: 'handler_failed' })
  })

  it.each(['open', 'observe', 'invoke'] as const)('fences delayed %s authorization after grant revocation', async operation => {
    const f = await fixture()
    const handle = await f.open()
    const entered = gate(), resume = gate()
    f.setAuthority(async () => { entered.release(); await resume.promise; return true })
    const pending = (operation === 'open' ? f.open() : operation === 'observe' ? f.broker.observe(f.caller, { resource: handle }) : f.invoke(handle)).then(() => null, (error: unknown) => error)
    try {
      await entered.promise
      f.contracts.set(NAME, { ...f.contract, dshAuthorization: { ...f.contract.dshAuthorization!, tools: {} } })
      resume.release()
      expect(await pending).toMatchObject({ code: operation === 'observe' ? 'observation_failed' : 'handler_failed' })
      f.contracts.set(NAME, f.contract)
      f.setAuthority(async () => true)
      expect((await f.invoke(handle)).output).toMatchObject({ calls: 1 })
    } finally { resume.release(); await pending }
  })

  it.each(['open', 'observe', 'invoke'] as const)('fences delayed %s authorization after a Principal change', async operation => {
    const f = await fixture()
    const handle = await f.open()
    const entered = gate(), resume = gate()
    f.setAuthority(async () => { entered.release(); await resume.promise; return true })
    const pending = (operation === 'open' ? f.open() : operation === 'observe' ? f.broker.observe(f.caller, { resource: handle }) : f.invoke(handle)).then(() => null, (error: unknown) => error)
    try {
      await entered.promise
      f.changePrincipal()
      resume.release()
      expect(await pending).toMatchObject({ code: 'principal_changed' })
      f.setAuthority(async () => true)
      const current = await f.open()
      expect((await f.invoke(current)).output).toMatchObject({ calls: 1 })
    } finally { resume.release(); await pending }
  })

  it('fences delayed read authorization after disable', async () => {
    const f = await fixture()
    const handle = await f.open()
    const entered = gate(), resume = gate()
    f.setAuthority(async () => { entered.release(); await resume.promise; return true })
    const pending = f.invoke(handle).then(() => null, (error: unknown) => error)
    try {
      await entered.promise
      await f.service.setEnabled(NAME, false)
      resume.release()
      expect(await pending).toMatchObject({ code: 'handler_failed' })
    } finally { resume.release(); await pending }
  })
})
