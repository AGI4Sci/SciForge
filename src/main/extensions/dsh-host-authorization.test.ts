import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { PluginVersionStore, type PluginAdapterContract } from '@sciforge/plugin-sdk'
import { DevelopmentExternalPluginService } from './development-external-plugins'
import { loadDevelopmentPluginOptions } from './development-plugin-options'
import { CapabilityRegistry } from '../capabilities/registry'

async function updatedHostFixture(reloadPolicy: 'live' | 'restart' = 'live') {
  const root = await mkdtemp(join(tmpdir(), 'effective-host-contract-'))
  const plugins = join(root, 'plugins')
  const source = join(plugins, 'plugin')
  const candidate = join(plugins, '.candidates', 'candidate')
  const marker = join(root, 'v2-executed')
  const name = 'ordinary-dsh-plugin'
  const contract = (version: string): PluginAdapterContract => ({ hostApiRange: '^1.0.0', permissions: [], approved: true,
    dshAuthorization: { packageName: name, packageVersion: version, dshRuntimeVersion: '0.2.0-rc.2' } })
  const contracts = new Map([[name, contract('1.0.0')]])
  for (const [directory, version] of [[source, '1.0.0'], [candidate, '2.0.0']]) {
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version, type: 'module', exports: { '.': './main.js' }, dsh: { bundle: { patch: './patch.yml' } } }))
    await writeFile(join(directory, 'patch.yml'), '[]')
    await writeFile(join(directory, 'main.js'), version === '1.0.0' ? 'export async function activate() {}' :
      `import {appendFile} from 'node:fs/promises'; export async function activate() { await appendFile(${JSON.stringify(marker)}, 'v2\\n') }`)
    if (reloadPolicy === 'restart') await writeFile(join(directory, 'sciforge.adapter.json'), JSON.stringify({ schemaVersion: 1, kind: 'capability', namespace: 'ordinary', hostApiRange: '^1.0.0', permissions: [], reloadPolicy }))
  }
  const options = { root: plugins, userDataPath: join(root, 'data'), hostApiVersion: '1.0.0', dshRuntimeVersion: '0.2.0-rc.2', adapterContracts: contracts }
  const service = new DevelopmentExternalPluginService(options)
  await service.initialize()
  await service.setEnabled(name, true)
  contracts.set(name, contract('2.0.0'))
  await service.checkCandidate(name, candidate)
  await service.applyCandidate(name)
  await service.dispose()
  await rm(marker, { force: true })
  return { root, marker, name, contracts, options, source, candidate }
}

it('dispose stops a committed pending runtime invisible to discovery after the installation disappears', async () => {
  const fixture = await updatedHostFixture('restart')
  const statePath = join(fixture.root, 'data/extensions/development-external-state.json')
  const state = JSON.parse(await readFile(statePath, 'utf8'))
  const staged = state.pendingRestart[fixture.name].stagedDirectory
  const pidFile = join(fixture.root, 'candidate-pid')
  await writeFile(join(staged, 'main.js'), `import {writeFile} from 'node:fs/promises'; export async function activate() { await writeFile(${JSON.stringify(pidFile)}, String(process.pid)) }`)
  await rm(fixture.source, { recursive: true, force: true })
  const restarted = new DevelopmentExternalPluginService(fixture.options)
  let pid: number | undefined
  try {
    await restarted.initialize()
    await restarted.attachCapabilityRegistry(new CapabilityRegistry())
    expect(await restarted.list()).toEqual([])
    pid = await readFile(pidFile, 'utf8').then(Number).catch(() => undefined)
    await restarted.dispose()
    const isAlive = () => pid !== undefined && (() => { try { process.kill(pid!, 0); return true } catch { return false } })()
    await expect.poll(isAlive, { timeout: 1000 }).toBe(false)
    console.log({ candidateExecuted: pid !== undefined, discovered: 0, childAliveAfterDispose: isAlive() })
  } finally {
    await restarted.dispose()
    if (pid !== undefined) { try { process.kill(pid, 'SIGKILL') } catch { /* already stopped */ } }
    await rm(fixture.root, { recursive: true, force: true })
  }
})

it('loader-keyed exact approvals reject a governed package candidate of an unapproved version', async () => {
  const root = await mkdtemp(join(tmpdir(), 'loader-governed-candidate-'))
  const plugins = join(root, 'plugins')
  const source = join(plugins, 'plugin')
  const candidate = join(plugins, '.candidates', 'candidate')
  const name = 'ordinary-dsh-plugin'
  try {
    for (const [directory, version] of [[source, '1.0.0'], [candidate, '2.0.0']] as const) {
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version, type: 'module',
        engines: { dsh: '>=0.2.0-rc.2 <0.3.0' },
        exports: { '.': './main.js' }, dsh: { bundle: { patch: './patch.yml' } } }))
      await writeFile(join(directory, 'patch.yml'), '[]')
      await writeFile(join(directory, 'main.js'), 'export async function activate() {}\n')
      // The plugin ships a self-declared adapter; without the host contract override an
      // unapproved version would validate through its own declaration instead of failing closed.
      await writeFile(join(directory, 'sciforge.adapter.json'), JSON.stringify({
        schemaVersion: 1, kind: 'capability', namespace: 'ordinary', hostApiRange: '^1.0.0', permissions: [], reloadPolicy: 'live' }))
    }
    const contract = (packageVersion: string) => ({ hostApiRange: '^1.0.0', permissions: [], approved: true,
      dshAuthorization: { packageName: name, packageVersion, dshRuntimeVersion: '0.2.0-rc.2' } })
    const contractPath = join(root, 'host.json')
    const loadOptions = async () => await loadDevelopmentPluginOptions({ isPackaged: false,
      userDataPath: join(root, 'data'), hostApiVersion: '1.0.0', env: {
        SCIFORGE_DEV_PLUGIN_ROOT: plugins, SCIFORGE_DEV_PLUGIN_CONTRACTS: contractPath,
        SCIFORGE_DSH_RUNTIME_VERSION: '0.2.0-rc.2' } })
    // Production seam keys approvals by exact name@version; only 1.0.0 is approved.
    await writeFile(contractPath, JSON.stringify([contract('1.0.0')]))
    const service = new DevelopmentExternalPluginService((await loadOptions())!)
    try {
      await service.initialize()
      expect((await service.setEnabled(name, true)).status).toBe('active')
      await expect(service.checkCandidate(name, candidate)).rejects.toThrow(/exact package version/)
      expect(await service.updateStatus(name)).toMatchObject({ version: '1.0.0', status: 'active' })
      expect((await service.updateStatus(name)).candidateVersion).toBeUndefined()
    } finally {
      await service.dispose()
    }
    // Positive control: once the host approves 2.0.0 exactly, the same candidate is accepted.
    await writeFile(contractPath, JSON.stringify([contract('1.0.0'), contract('2.0.0')]))
    const governed = new DevelopmentExternalPluginService((await loadOptions())!)
    try {
      await governed.initialize()
      expect((await governed.checkCandidate(name, candidate)).candidateVersion).toBe('2.0.0')
    } finally {
      await governed.dispose()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('pending restart rejects invalid patch before candidate execution and preserves the previous pointer with a diagnostic', async () => {
  const fixture = await updatedHostFixture('restart')
  const state = JSON.parse(await readFile(join(fixture.root, 'data/extensions/development-external-state.json'), 'utf8'))
  const staged = state.pendingRestart[fixture.name].stagedDirectory
  await writeFile(join(staged, 'patch.yml'), '{"invalid":true}')
  const restarted = new DevelopmentExternalPluginService(fixture.options)
  try {
    await restarted.initialize()
    await restarted.attachCapabilityRegistry(new CapabilityRegistry())
    await expect(access(fixture.marker)).rejects.toThrow()
    expect((await restarted.list())[0]).toMatchObject({ version: '1.0.0', status: 'invalid', restartRequired: false })
    expect((await restarted.list())[0].diagnostic).toMatch(/patch.*array/i)
  } finally {
    await restarted.dispose()
    await rm(fixture.root, { recursive: true, force: true })
  }
})

it('pending restart never executes after the original installation directory disappears', async () => {
  const fixture = await updatedHostFixture('restart')
  const store = new PluginVersionStore(join(fixture.root, 'data/extensions/plugin-versions'))
  const previous = await store.active(fixture.name)
  await rm(fixture.source, { recursive: true, force: true })
  const restarted = new DevelopmentExternalPluginService(fixture.options)
  try {
    await restarted.initialize()
    await restarted.attachCapabilityRegistry(new CapabilityRegistry())
    await expect(access(fixture.marker)).rejects.toThrow()
    expect(await store.active(fixture.name)).toEqual(previous)
    expect(await restarted.list()).toEqual([])
  } finally {
    await restarted.dispose()
    await rm(fixture.root, { recursive: true, force: true })
  }
})

it.each(['invalid patch', 'missing client', 'invalid adapter'] as const)('all candidate entrypoints reject %s without executing the candidate', async (failure) => {
  const fixture = await updatedHostFixture('restart')
  const service = new DevelopmentExternalPluginService(fixture.options)
  const corrupt = async (directory: string) => {
    if (failure === 'invalid patch') await writeFile(join(directory, 'patch.yml'), '{"invalid":true}')
    if (failure === 'invalid adapter') await writeFile(join(directory, 'sciforge.adapter.json'), '{"schemaVersion":999}')
    if (failure === 'missing client') {
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
      manifest.exports['./client'] = './missing-client.js'
      manifest.dsh.client = { platform: 'web' }
      await writeFile(join(directory, 'package.json'), JSON.stringify(manifest))
    }
  }
  try {
    const statePath = join(fixture.root, 'data/extensions/development-external-state.json')
    const state = JSON.parse(await readFile(statePath, 'utf8'))
    state.pendingRestart = {}
    await writeFile(statePath, JSON.stringify(state))
    const v2Contract = fixture.contracts.get(fixture.name)!
    fixture.contracts.set(fixture.name, { ...v2Contract, dshAuthorization: { ...v2Contract.dshAuthorization!, packageVersion: '1.0.0' } })
    await service.initialize()
    await service.attachCapabilityRegistry(new CapabilityRegistry())
    fixture.contracts.set(fixture.name, v2Contract)
    await service.checkCandidate(fixture.name, fixture.candidate)
    const checkedState = JSON.parse(await readFile(statePath, 'utf8'))
    await corrupt(checkedState.candidates[fixture.name].stagedDirectory)
    await expect(service.applyCandidate(fixture.name)).rejects.toThrow()
    await corrupt(fixture.candidate)
    await expect(service.checkCandidate(fixture.name, fixture.candidate)).rejects.toThrow()
    await expect(service.replacePlugin(fixture.name, fixture.candidate)).rejects.toThrow()
    const pointer = await new PluginVersionStore(join(fixture.root, 'data/extensions/plugin-versions')).active(fixture.name)
    await corrupt(pointer!.directory)
    await expect(service.attachCapabilityRegistry(new CapabilityRegistry())).rejects.toThrow()
    await expect(access(fixture.marker)).rejects.toThrow()
  } finally {
    await service.dispose()
    await rm(fixture.root, { recursive: true, force: true })
  }
})

it('pending restart rejects missing client before execution and retains the previous pointer diagnostic', async () => {
  const fixture = await updatedHostFixture('restart')
  const store = new PluginVersionStore(join(fixture.root, 'data/extensions/plugin-versions'))
  const previous = await store.active(fixture.name)
  const state = JSON.parse(await readFile(join(fixture.root, 'data/extensions/development-external-state.json'), 'utf8'))
  const staged = state.pendingRestart[fixture.name].stagedDirectory
  const manifest = JSON.parse(await readFile(join(staged, 'package.json'), 'utf8'))
  manifest.exports['./client'] = './missing-client.js'
  manifest.dsh.client = { platform: 'web' }
  await writeFile(join(staged, 'package.json'), JSON.stringify(manifest))
  const restarted = new DevelopmentExternalPluginService(fixture.options)
  try {
    await restarted.initialize()
    await restarted.attachCapabilityRegistry(new CapabilityRegistry())
    await expect(access(fixture.marker)).rejects.toThrow()
    expect(await store.active(fixture.name)).toEqual(previous)
    expect((await restarted.list())[0].diagnostic).toMatch(/missing-client/)
    expect((await restarted.list())[0]).toMatchObject({ version: '1.0.0', status: 'invalid', restartRequired: false })
  } finally {
    await restarted.dispose()
    await rm(fixture.root, { recursive: true, force: true })
  }
})

it('initialize then attach never executes an active version after deleting its host contract', async () => {
  const fixture = await updatedHostFixture()
  fixture.contracts.delete(fixture.name)
  const restarted = new DevelopmentExternalPluginService(fixture.options)
  try {
    await restarted.initialize()
    expect((await restarted.list())[0].status).toBe('invalid')
    await restarted.attachCapabilityRegistry(new CapabilityRegistry())
    await expect(access(fixture.marker)).rejects.toThrow()
    expect((await restarted.list())[0].activationState).not.toBe('active')
  } finally {
    await restarted.dispose()
    await rm(fixture.root, { recursive: true, force: true })
  }
})

it('initialize then attach reports the exactly authorized active v2 as active after restart', async () => {
  const fixture = await updatedHostFixture()
  const restarted = new DevelopmentExternalPluginService(fixture.options)
  try {
    await restarted.initialize()
    await restarted.attachCapabilityRegistry(new CapabilityRegistry())
    expect(await readFile(fixture.marker, 'utf8')).toBe('v2\n')
    expect((await restarted.list())[0]).toMatchObject({ version: '2.0.0', status: 'active', activationState: 'active', permissionAllowed: true })
    expect((await restarted.list())[0].diagnostic).toBeUndefined()
  } finally {
    await restarted.dispose()
    await rm(fixture.root, { recursive: true, force: true })
  }
})

it('initialize then attach applies a valid exactly authorized pending restart candidate', async () => {
  const fixture = await updatedHostFixture('restart')
  const restarted = new DevelopmentExternalPluginService(fixture.options)
  try {
    await restarted.initialize()
    await restarted.attachCapabilityRegistry(new CapabilityRegistry())
    expect((await restarted.list())[0]).toMatchObject({ version: '2.0.0', status: 'active', activationState: 'active', restartRequired: false })
    expect(await readFile(fixture.marker, 'utf8')).toBe('v2\n')
    expect((await restarted.list())[0].diagnostic).toBeUndefined()
  } finally {
    await restarted.dispose()
    await rm(fixture.root, { recursive: true, force: true })
  }
})

it('native unscoped candidates without engines or sidecars require exact host version approval', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-host-contract-'))
  const plugins = join(root, 'plugins')
  const plugin = join(plugins, 'ordinary-dsh-plugin')
  const candidate = join(plugins, '.candidates', 'candidate')
  const name = 'ordinary-dsh-plugin'
  const authorization = (version: string): PluginAdapterContract => ({
    hostApiRange: '^1.0.0', permissions: [], approved: true,
    dshAuthorization: { packageName: name, packageVersion: version, dshRuntimeVersion: '0.2.0-rc.2' }
  })
  const contracts = new Map([[name, authorization('1.0.0')]])
  const build = async (directory: string, version: string) => {
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version, type: 'module',
      exports: { '.': './main.js' }, dsh: { bundle: { patch: './patch.yml' } } }))
    await writeFile(join(directory, 'patch.yml'), '[]')
    // Existing named runner contract exercises host governance, not native Cordis compatibility.
    await writeFile(join(directory, 'main.js'), 'export async function activate() {}\n')
  }
  await build(plugin, '1.0.0')
  await build(candidate, '2.0.0')
  const service = new DevelopmentExternalPluginService({ root: plugins, userDataPath: join(root, 'data'),
    hostApiVersion: '1.0.0', dshRuntimeVersion: '0.2.0-rc.2', adapterContracts: contracts })
  try {
    await service.initialize()
    expect((await service.list())[0].status).toBe('disabled')
    expect((await service.setEnabled(name, true)).status).toBe('active')
    expect(JSON.parse(await readFile(join(plugin, 'package.json'), 'utf8')).engines).toBeUndefined()
    contracts.set(name, authorization('2.0.0'))
    const checked = await service.checkCandidate(name, candidate)
    expect(checked.candidateVersion).toBe('2.0.0')
    expect(checked.version).toBe('1.0.0')
    contracts.set(name, authorization('1.0.0'))
    await expect(service.applyCandidate(name)).rejects.toThrow(/exact package version/)
    expect((await service.updateStatus(name)).version).toBe('1.0.0')
    await service.cancelCandidate(name)
    contracts.set(name, authorization('1.0.0'))
    await expect(service.checkCandidate(name, candidate)).rejects.toThrow(/exact package version/)
    contracts.set(name, { ...authorization('2.0.0'), approved: false })
    await expect(service.checkCandidate(name, candidate)).rejects.toThrow(/exact package version/)
    contracts.set(name, { ...authorization('2.0.0'), permissions: ['network.http'] })
    await expect(service.checkCandidate(name, candidate)).rejects.toThrow(/permission not approved/)
    contracts.set(name, authorization('2.0.0'))
    await service.checkCandidate(name, candidate)
    expect((await service.applyCandidate(name)).version).toBe('2.0.0')
    await service.dispose()
    contracts.set(name, authorization('1.0.0'))
    const restarted = new DevelopmentExternalPluginService({ root: plugins, userDataPath: join(root, 'data'),
      hostApiVersion: '1.0.0', dshRuntimeVersion: '0.2.0-rc.2', adapterContracts: contracts })
    try {
      await restarted.initialize()
      expect((await restarted.list())[0].activationState).not.toBe('active')
    } finally {
      await restarted.dispose()
    }
  } finally {
    await service.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

it('restart never executes a pending version after its host authorization is revoked', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-restart-contract-'))
  const plugins = join(root, 'plugins')
  const source = join(plugins, 'plugin')
  const candidate = join(plugins, '.candidates', 'candidate')
  const marker = join(root, 'unapproved-executed')
  const name = 'ordinary-dsh-plugin'
  const contract = (version: string): PluginAdapterContract => ({ hostApiRange: '^1.0.0', permissions: [], approved: true,
    dshAuthorization: { packageName: name, packageVersion: version, dshRuntimeVersion: '0.2.0-rc.2' } })
  const contracts = new Map([[name, contract('1.0.0')]])
  const make = async (dir: string, version: string, code: string) => {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version, type: 'module', exports: { '.': './main.js' }, dsh: { bundle: { patch: './patch.yml' } } }))
    await writeFile(join(dir, 'patch.yml'), '[]')
    await writeFile(join(dir, 'main.js'), code)
    await writeFile(join(dir, 'sciforge.adapter.json'), JSON.stringify({ schemaVersion: 1, kind: 'capability', namespace: 'ordinary', hostApiRange: '^1.0.0', permissions: [], reloadPolicy: 'restart' }))
  }
  await make(source, '1.0.0', 'export async function activate() {}')
  await make(candidate, '2.0.0', `import {writeFile} from 'node:fs/promises'; export async function activate() { await writeFile(${JSON.stringify(marker)}, 'executed') }`)
  const options = { root: plugins, userDataPath: join(root, 'data'), hostApiVersion: '1.0.0', dshRuntimeVersion: '0.2.0-rc.2', adapterContracts: contracts }
  const service = new DevelopmentExternalPluginService(options)
  let restarted: DevelopmentExternalPluginService | undefined
  try {
    await service.initialize()
    await service.setEnabled(name, true)
    contracts.set(name, contract('2.0.0'))
    await service.checkCandidate(name, candidate)
    expect((await service.applyCandidate(name)).restartRequired).toBe(true)
    await service.dispose()
    contracts.set(name, contract('1.0.0'))
    restarted = new DevelopmentExternalPluginService(options)
    await restarted.initialize()
    await expect(access(marker)).rejects.toThrow()
    expect((await restarted.list())[0].version).toBe('1.0.0')
  } finally {
    await restarted?.dispose()
    await service.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
