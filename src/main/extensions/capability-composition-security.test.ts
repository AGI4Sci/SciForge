import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContributionHost } from '@sciforge/plugin-sdk'
import { z } from 'zod'
import { CapabilityRegistry, defineCapability, type CapabilityDefinition } from '../capabilities/registry'
import { DevelopmentExternalPluginService } from './development-external-plugins'

function capability(id: string, title = 'Original') {
  return defineCapability({ id, version: '1.0.0', title, description: 'Security fixture',
    audiences: ['ui'], scope: 'global', resourceKinds: [], effect: 'compute', approval: 'none',
    concurrency: { revision: 'none', idempotency: 'required' }, tags: [],
    inputSchema: z.object({ value: z.string() }), outputSchema: z.object({ source: z.string() }),
    handler: async () => ({ output: { source: title } }) })
}
const roots = new WeakMap<DevelopmentExternalPluginService, string>()
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
type PackageFixture = { name: string; definitions: CapabilityDefinition[]; claims?: string[]; tools?: Record<string, { id: string; effect: 'compute' }> }
async function writePackage(directory: string, pkg: PackageFixture, version = '1.0.0') {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: pkg.name, version, type: 'module', main: './main.mjs', dsh: { bundle: { patch: './cordis.patch.yml' } }, engines: { dsh: '0.2.0-rc.2' } }))
  await writeFile(join(directory, 'cordis.patch.yml'), '[]\n')
  await writeFile(join(directory, 'sciforge.adapter.json'), JSON.stringify({ schemaVersion: 1, kind: 'capability', namespace: pkg.name, hostApiRange: '^1.0.0', permissions: [], reloadPolicy: 'live', ...(pkg.claims ? { replacesCapabilities: pkg.claims } : {}) }))
  await writeFile(join(directory, 'main.mjs'), `export async function activate() {}\nexport function getCapabilityDefinitions() { return ${JSON.stringify(pkg.definitions.map(d => d.descriptor))}.map(descriptor => ({ descriptor, handler: async () => ({ output: { source: ${JSON.stringify(pkg.name)} } }) })) }`)
}
async function fixture(packages: PackageFixture[], registry: CapabilityRegistry) {
  const root = await mkdtemp(join(tmpdir(), 'composition-security-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  for (const pkg of packages) {
    const directory = join(root, 'plugins', pkg.name)
    await writePackage(directory, pkg)
  }
  const service = new DevelopmentExternalPluginService({ root: join(root, 'plugins'), userDataPath: join(root, 'profile'), hostApiVersion: '1.0.0', dshRuntimeVersion: '0.2.0-rc.2', adapterContracts: new Map(packages.map(pkg => [pkg.name, { hostApiRange: '^1.0.0', approved: true, permissions: [], ...(pkg.tools ? { dshAuthorization: { packageName: pkg.name, packageVersion: '1.0.0', dshRuntimeVersion: '0.2.0-rc.2', tools: pkg.tools } } : {}) }])) })
  roots.set(service, join(root, 'plugins'))
  cleanups.push(() => service.dispose())
  await service.initialize()
  await service.attachCapabilityRegistry(registry)
  return service
}

describe('trusted composition: runtime plugins cannot replace registered owners', () => {
  it.each([
    { cleanup: 'retry-dispose', failAt: 1, timing: 'before' },
    { cleanup: 'retry-dispose', failAt: 2, timing: 'before' },
    { cleanup: 'retry-dispose', failAt: 1, timing: 'after' },
    { cleanup: 'retry-dispose', failAt: 2, timing: 'after' },
    { cleanup: 'disable-retry', failAt: 2, timing: 'after' },
    { cleanup: 'dispose', failAt: 2, timing: 'after' }
  ] as const)('keeps exact old owners on dynamic transfer failure with real child: $cleanup $timing $failAt', async ({ cleanup, failAt, timing }) => {
    const registry = new CapabilityRegistry()
    const originals = ['fixture.control', 'fixture.peer'].map(id => {
      const d = capability(id, id)
      return { ...d, descriptor: { ...d.descriptor, tags: ['dsh-tool'], runtimeRevision: 1 } }
    })
    const tools = Object.fromEntries(['fixture.control', 'fixture.peer', 'fixture.leak'].map(id => [id, { id, effect: 'compute' as const }]))
    const service = await fixture([{ name: 'candidate', definitions: originals, tools }], registry)
    const directory = join(roots.get(service)!, 'candidate')
    const pidPath = join(directory, 'child-pid')
    const changed = [...originals.map(d => ({ ...d.descriptor, description: 'Changed' })), { ...capability('fixture.leak', 'fixture.leak').descriptor, tags: ['dsh-tool'], runtimeRevision: 1 }]
    await writeFile(join(directory, 'main.mjs'), `import {writeFile} from 'node:fs/promises'; let revision=1;
      export async function activate(){await writeFile(${JSON.stringify(pidPath)},String(process.pid))}
      export function getCapabilityDefinitions(){return ${JSON.stringify(originals.map(d => d.descriptor))}.map(descriptor=>({descriptor,handler:async input=>{
        if(input.value==='refresh')process.send({type:'capabilities',generation:Number(process.argv[3]),revision:++revision,descriptors:${JSON.stringify(changed)}});
        return {output:{source:'candidate'}}
      }}))}`)
    await service.setEnabled('candidate', true)
    const pid = Number(await readFile(pidPath, 'utf8'))
    expect(() => process.kill(pid, 0)).not.toThrow()
    const control = registry.require('fixture.control')
    const peer = registry.require('fixture.peer')
    const register = ContributionHost.prototype.register
    let calls = 0
    const oldContributions: ReturnType<ContributionHost['list']>[number][] = []
    let host: ContributionHost | undefined
    const fault = vi.spyOn(ContributionHost.prototype, 'register').mockImplementation(function (this: ContributionHost, input) {
      if (!host) { host = this; oldContributions.push(...this.list('candidate')) }
      expect(this.list('candidate')).toEqual(oldContributions)
      this.list('candidate').forEach((item, i) => expect(item).toBe(oldContributions[i]))
      expect(registry.require('fixture.control')).toBe(control)
      expect(registry.require('fixture.peer')).toBe(peer)
      const fails = input.kind === 'capability' && ++calls === failAt
      if (fails && timing === 'before') throw new Error('dynamic transfer failed')
      const result = register.call(this, input)
      this.list('candidate').forEach((item, i) => expect(item).toBe(oldContributions[i]))
      expect(registry.require('fixture.control')).toBe(control)
      expect(registry.require('fixture.peer')).toBe(peer)
      if (fails) throw new Error('dynamic transfer failed')
      return result
    })
    try {
      await control.handler({ value: 'refresh' }, {} as never)
      await vi.waitFor(() => expect(calls).toBe(failAt))
      await service.list()
      expect(registry.require('fixture.control')).toBe(control)
      expect(registry.require('fixture.peer')).toBe(peer)
      expect(registry.has('fixture.leak')).toBe(false)
      expect(host!.list('candidate')).toEqual(oldContributions)
      host!.list('candidate').forEach((item, i) => expect(item).toBe(oldContributions[i]))
    } finally { fault.mockRestore() }
    if (cleanup === 'dispose') {
      await service.dispose()
      expect(host!.list('candidate')).toEqual([])
      expect(registry.has('fixture.control')).toBe(false)
      expect(registry.has('fixture.peer')).toBe(false)
      expect(registry.has('fixture.leak')).toBe(false)
      await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow())
      return
    }
    if (cleanup === 'disable-retry') {
      await service.setEnabled('candidate', false)
      expect(host!.list('candidate')).toEqual([])
      expect(registry.has('fixture.control')).toBe(false)
      expect(registry.has('fixture.peer')).toBe(false)
      expect(registry.has('fixture.leak')).toBe(false)
      await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow())
      await service.setEnabled('candidate', true)
    }
    await registry.require('fixture.control').handler({ value: 'refresh' }, {} as never)
    await vi.waitFor(() => expect(registry.has('fixture.leak')).toBe(true))
    expect(registry.require('fixture.control')).not.toBe(control)
    expect((await registry.require('fixture.control').handler({ value: 'ok' }, {} as never)).output).toEqual({ source: 'candidate' })
    await service.dispose()
    expect(registry.has('fixture.control')).toBe(false)
    expect(registry.has('fixture.peer')).toBe(false)
    expect(registry.has('fixture.leak')).toBe(false)
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow())
  })
  it.each([
    { failAt: 1, timing: 'before' }, { failAt: 2, timing: 'before' },
    { failAt: 1, timing: 'after' }, { failAt: 2, timing: 'after' }
  ])('releases every initial publication if contribution transfer $failAt throws $timing registering, and retries with a real child', async ({ failAt, timing }) => {
    const registry = new CapabilityRegistry([capability('fixture.native')])
    const native = registry.require('fixture.native')
    const service = await fixture([{ name: 'candidate', definitions: [capability('fixture.leak'), capability('fixture.peer')] }], registry)
    const baseline = registry.list().map(d => d.id)
    const register = ContributionHost.prototype.register
    let calls = 0
    const fault = vi.spyOn(ContributionHost.prototype, 'register').mockImplementation(function (this: ContributionHost, input) {
      const fails = input.kind === 'capability' && ++calls === failAt
      if (fails && timing === 'before') throw new Error('contribution transfer failed')
      const result = register.call(this, input)
      if (fails) throw new Error('contribution transfer failed')
      return result
    })
    try {
      await expect(service.setEnabled('candidate', true)).rejects.toThrow('contribution transfer failed')
      expect(calls).toBe(failAt)
      expect(registry.list().map(d => d.id)).toEqual(baseline)
      expect(registry.require('fixture.native')).toBe(native)
    } finally { fault.mockRestore() }
    if (timing === 'before') {
      await service.setEnabled('candidate', false)
      expect(registry.list().map(d => d.id)).toEqual(baseline)
    }
    // Both direct retry from a failed activation and disable/re-enable are covered.
    await service.setEnabled('candidate', true)
    expect((await registry.require('fixture.leak').handler({ value: 'retry' }, {} as never)).output).toEqual({ source: 'candidate' })
    await service.dispose()
    expect(registry.list().map(d => d.id)).toEqual(['fixture.native'])
    expect(registry.require('fixture.native')).toBe(native)
  })
  it('a failed update contribution transfer rolls back to an executable old package without leaked candidate owners', async () => {
    const registry = new CapabilityRegistry()
    const service = await fixture([{ name: 'candidate', definitions: [capability('fixture.open'), capability('fixture.peer')] }], registry)
    await service.setEnabled('candidate', true)
    const candidateRoot = join(roots.get(service)!, 'update-candidate')
    await writePackage(candidateRoot, { name: 'candidate', definitions: [capability('fixture.open'), capability('fixture.leak')] }, '2.0.0')
    await service.checkCandidate('candidate', candidateRoot)
    const register = ContributionHost.prototype.register
    let failed = false
    const fault = vi.spyOn(ContributionHost.prototype, 'register').mockImplementation(function (this: ContributionHost, input) {
      const result = register.call(this, input)
      if (input.kind === 'capability' && !failed) { failed = true; throw new Error('candidate transfer rejected') }
      return result
    })
    try { await expect(service.applyCandidate('candidate')).rejects.toThrow('candidate transfer rejected') }
    finally { fault.mockRestore() }
    expect(failed).toBe(true)
    const state = (await service.list()).find(item => item.packageName === 'candidate')!
    expect(state.version).toBe('1.0.0')
    expect(state.activationState).toBe('active')
    expect(registry.has('fixture.leak')).toBe(false)
    expect(registry.has('fixture.peer')).toBe(true)
    expect((await registry.require('fixture.open').handler({ value: 'restored' }, {} as never)).output).toEqual({ source: 'candidate' })
    await service.setEnabled('candidate', false)
    expect(registry.has('fixture.open')).toBe(false)
    expect(registry.has('fixture.peer')).toBe(false)
    expect(registry.has('fixture.leak')).toBe(false)
  })
  it('rejects package self-authorization to take a native capability', async () => {
    const original = capability('fixture.open')
    const registry = new CapabilityRegistry([original])
    const owner = registry.require('fixture.open')
    const service = await fixture([{ name: 'untrusted', definitions: [original], claims: ['fixture.open'] }], registry)
    await expect(service.setEnabled('untrusted', true)).rejects.toThrow()
    expect(registry.require('fixture.open')).toBe(owner)
  })
  it.each([false, true])('rejects takeover of another plugin capability (self-claimed replacement: %s)', async (claims) => {
    const definition = capability('fixture.open')
    const registry = new CapabilityRegistry()
    const service = await fixture([{ name: 'first', definitions: [definition] }, { name: 'untrusted', definitions: [definition], ...(claims ? { claims: ['fixture.open'] } : {}) }], registry)
    await service.setEnabled('first', true)
    const owner = registry.require('fixture.open')
    await expect(service.setEnabled('untrusted', true)).rejects.toThrow()
    expect(registry.require('fixture.open')).toBe(owner)
  })
  for (const mismatch of ['equivalent', 'descriptor', 'permission', 'schema'] as const) {
    it(`fails closed on unapproved replacement (${mismatch})`, async () => {
      const original = capability('fixture.open')
      const incoming = mismatch === 'schema'
        ? defineCapability({ ...original.descriptor, inputSchema: z.object({ secret: z.string() }), outputSchema: original.outputSchema, handler: async () => ({ output: { source: 'candidate' } }) })
        : { ...original, descriptor: { ...original.descriptor, ...(mismatch === 'descriptor' ? { version: '2.0.0' } : {}), ...(mismatch === 'permission' ? { effect: 'compute' as const, approval: 'confirmation' as const } : {}) } }
      const registry = new CapabilityRegistry([original])
      const owner = registry.require('fixture.open')
      const service = await fixture([{ name: 'candidate', definitions: [incoming] }], registry)
      await expect(service.setEnabled('candidate', true)).rejects.toThrow(/already registered|duplicate|conflict/i)
      expect(registry.require('fixture.open')).toBe(owner)
    })
  }
  it('rolls back every capability when a later capability conflicts', async () => {
    const original = capability('fixture.occupied')
    const registry = new CapabilityRegistry([original])
    const owner = registry.require('fixture.occupied')
    const service = await fixture([{ name: 'candidate', definitions: [capability('fixture.first'), original] }], registry)
    await expect(service.setEnabled('candidate', true)).rejects.toThrow()
    expect(registry.has('fixture.first')).toBe(false)
    expect(registry.require('fixture.occupied')).toBe(owner)
  })
  it('disable cannot delete a different current owner', async () => {
    const registry = new CapabilityRegistry()
    const service = await fixture([{ name: 'candidate', definitions: [capability('fixture.open')] }], registry)
    await service.setEnabled('candidate', true)
    registry.unregister('fixture.open')
    registry.register(capability('fixture.open', 'Other owner'))
    const owner = registry.require('fixture.open')
    await service.setEnabled('candidate', false)
    expect(registry.require('fixture.open')).toBe(owner)
  })
  it('successful update cleanup cannot delete the new generation or resurrect the old one', async () => {
    const registry = new CapabilityRegistry()
    const pkg = { name: 'candidate', definitions: [capability('fixture.open')] }
    const service = await fixture([pkg], registry)
    await service.setEnabled(pkg.name, true)
    const previous = registry.require('fixture.open')
    const source = await mkdtemp(join(roots.get(service)!, 'composition-update-'))
    cleanups.unshift(() => rm(source, { recursive: true, force: true }))
    await writePackage(source, { ...pkg, definitions: [capability('fixture.open', 'Updated')] }, '2.0.0')
    await service.checkCandidate(pkg.name, source)
    const updated = await service.applyCandidate(pkg.name)
    expect(updated.version).toBe('2.0.0')
    expect(registry.require('fixture.open')).not.toBe(previous)
    expect(registry.require('fixture.open').descriptor.title).toBe('Updated')
    await service.setEnabled(pkg.name, false)
    expect(registry.has('fixture.open')).toBe(false)
  })
  it('update and rollback cannot replace or clean up a foreign current owner', async () => {
    const registry = new CapabilityRegistry()
    const pkg = { name: 'candidate', definitions: [capability('fixture.open'), capability('fixture.peer')] }
    const service = await fixture([pkg], registry)
    await service.setEnabled(pkg.name, true)
    const peer = registry.require('fixture.peer')
    registry.unregister('fixture.open')
    registry.register(capability('fixture.open', 'Foreign owner'))
    const foreign = registry.require('fixture.open')
    const source = await mkdtemp(join(roots.get(service)!, 'composition-stale-update-'))
    cleanups.unshift(() => rm(source, { recursive: true, force: true }))
    await writePackage(source, pkg, '2.0.0')
    await service.checkCandidate(pkg.name, source)
    await expect(service.applyCandidate(pkg.name)).rejects.toThrow(/ownership changed|stale generation/i)
    expect(registry.require('fixture.open')).toBe(foreign)
    expect(registry.require('fixture.peer')).toBe(peer)
    await service.setEnabled(pkg.name, false)
    expect(registry.require('fixture.open')).toBe(foreign)
    expect(registry.has('fixture.peer')).toBe(false)
  })
  it('retired native stays absent on plugin disable (no implicit fallback)', async () => {
    // The trusted catalog has excluded the native domain before this registry exists.
    const registry = new CapabilityRegistry()
    const service = await fixture([{ name: 'candidate', definitions: [capability('fixture.open')] }], registry)
    await service.setEnabled('candidate', true)
    expect(registry.has('fixture.open')).toBe(true)
    await service.setEnabled('candidate', false)
    expect(registry.has('fixture.open')).toBe(false)
  })
})
