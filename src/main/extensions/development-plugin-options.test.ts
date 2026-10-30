import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { loadDevelopmentPluginOptions } from './development-plugin-options'
import { DevelopmentExternalPluginService } from './development-external-plugins'
import { CapabilityBroker } from '../capabilities/broker'
import { CapabilityRegistry } from '../capabilities/registry'

it.each(['packageVersion', 'dshRuntimeVersion'] as const)('rejects semver-invalid exact %s before discovery', async (field) => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-invalid-exact-semver-'))
  const path = join(root, 'host.json')
  const contract = { hostApiRange: '^1.0.0', permissions: [], approved: true,
    dshAuthorization: { packageName: 'sample', packageVersion: '1.1.1', dshRuntimeVersion: '0.2.0-rc.2' } }
  try {
    await mkdir(join(root, 'plugins'))
    for (const version of ['0.2.0-01', '9007199254740992.0.0']) {
      await writeFile(path, JSON.stringify([{ ...contract, dshAuthorization: { ...contract.dshAuthorization, [field]: version } }]))
      await expect(loadDevelopmentPluginOptions({ isPackaged: false, userDataPath: root, hostApiVersion: '1.0.0',
        env: { SCIFORGE_DEV_PLUGIN_ROOT: join(root, 'plugins'), SCIFORGE_DEV_PLUGIN_CONTRACTS: path } })).rejects.toThrow()
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('rejects an invalid Host API range before development activation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-plugin-invalid-host-range-'))
  const path = join(root, 'host-contracts.json')
  try {
    await mkdir(join(root, 'plugins'))
    await writeFile(path, JSON.stringify([{ hostApiRange: 'not-a-semver-range', permissions: [], approved: true,
      dshAuthorization: { packageName: 'sample', packageVersion: '1.1.1', dshRuntimeVersion: '0.2.0-rc.2' } }]))
    await expect(loadDevelopmentPluginOptions({ isPackaged: false, userDataPath: root, hostApiVersion: '1.11.0',
      env: { SCIFORGE_DEV_PLUGIN_ROOT: join(root, 'plugins'), SCIFORGE_DEV_PLUGIN_CONTRACTS: path } })).rejects.toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})

it.skipIf(!process.env.DSH_DESKTOP_SAMPLE_ROOT)('desktop options activate real unitverse and configured ProjectionCache through the public service', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'desktop-real-plugin-profile-'))
  const options = await loadDevelopmentPluginOptions({ isPackaged: false, userDataPath: profile,
    hostApiVersion: '1.11.0', env: { SCIFORGE_DEV_PLUGIN_ROOT: process.env.DSH_DESKTOP_SAMPLE_ROOT,
      SCIFORGE_DEV_PLUGIN_CONTRACTS: process.env.DSH_DESKTOP_HOST_CONTRACTS,
      SCIFORGE_DSH_RUNTIME_VERSION: '0.2.0-rc.2' } })
  const service = new DevelopmentExternalPluginService(options!)
  const registry = new CapabilityRegistry()
  const broker = new CapabilityBroker(registry)
  const cacheName = '@sciforge/manual-projection-cache'
  try {
    await service.initialize()
    await service.attachCapabilityRegistry(registry)
    await service.setDshConfig(cacheName, { writeEveryEvents: 100, writeIntervalMs: 1000 })
    expect((await service.setEnabled(cacheName, true)).status).toBe('active')
    expect((await service.setEnabled('dsh-unitverse', true)).status).toBe('active')
    const result = await broker.invoke({ audience: 'agent', callerId: 'desktop-synthetic' }, {
      actionId: 'unitverse.convert', invocationId: 'desktop-length', input: { value: 5, from: 'ft', to: 'cm' } })
    expect(result.output).toMatchObject({ result: 152.4 })
    await service.setEnabled('dsh-unitverse', false)
    expect(broker.discover({ audience: 'agent', callerId: 'desktop-synthetic' }).map((item) => item.id)).not.toContain('unitverse.convert')
    await service.setEnabled(cacheName, false)
    console.log(JSON.stringify({ startupSeam: 'real host contracts', unitverse: result.output, projectionCache: 'activated with persisted Config; no desktop session injection API', disabled: true }))
  } finally { await service.dispose(); await rm(profile, { recursive: true, force: true }) }
})

it('rejects malformed, broader and plugin-owned approvals before discovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-plugin-invalid-'))
  const plugins = join(root, 'plugins')
  const path = join(root, 'host.json')
  const contract = { hostApiRange: '^1.0.0', permissions: [], approved: true,
    dshAuthorization: { packageName: 'sample', packageVersion: '1.1.1', dshRuntimeVersion: '0.2.0-rc.2' } }
  const input = { isPackaged: false, userDataPath: root, hostApiVersion: '1.11.0', env: {
    SCIFORGE_DEV_PLUGIN_ROOT: plugins, SCIFORGE_DEV_PLUGIN_CONTRACTS: path } }
  try {
    await mkdir(plugins)
    for (const invalid of [
      [contract, contract],
      [{ ...contract, hostApiRange: '>=1.0.0 garbage' }],
      [{ ...contract, hostApiRange: 'latest' }],
      [{ ...contract, hostApiRange: ' ' }],
      [{ ...contract, dshAuthorization: { ...contract.dshAuthorization, packageName: ' Sample ' } }],
      [{ ...contract, dshAuthorization: { ...contract.dshAuthorization, packageName: '../sample' } }],
      [{ ...contract, permissions: ['filesystem.write'] }],
      [{ ...contract, unexpected: true }],
      [{ ...contract, dshAuthorization: { ...contract.dshAuthorization, packageVersion: '^1.1.1' } }],
      [{ ...contract, dshAuthorization: { ...contract.dshAuthorization, tools: { unsafe: { id: 'unsafe', effect: 'write' } } } }]
    ]) {
      await writeFile(path, JSON.stringify(invalid))
      await expect(loadDevelopmentPluginOptions(input)).rejects.toThrow()
    }
    await writeFile(join(plugins, 'self-approved.json'), JSON.stringify([contract]))
    await symlink(join(plugins, 'self-approved.json'), join(root, 'alias.json'))
    for (const owned of [join(plugins, 'self-approved.json'), join(root, 'alias.json'), 'relative.json']) {
      await expect(loadDevelopmentPluginOptions({ ...input, env: { ...input.env, SCIFORGE_DEV_PLUGIN_CONTRACTS: owned } })).rejects.toThrow()
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('loads host-owned exact approval through the desktop startup seam, never in packaged mode', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-plugin-options-'))
  const path = join(root, 'host-contracts.json')
  const contract = { hostApiRange: '^1.0.0', permissions: [], approved: true,
    dshAuthorization: { packageName: 'sample', packageVersion: '1.1.1', dshRuntimeVersion: '0.2.0-rc.2',
      tools: { list: { id: 'sample.list', effect: 'read' }, create: { id: 'sample.create', effect: 'workspace-write' } } } }
  try {
    await mkdir(join(root, 'plugins'))
    await writeFile(path, JSON.stringify([contract]))
    const input = { isPackaged: false, userDataPath: root, hostApiVersion: '1.11.0', env: {
      SCIFORGE_DEV_PLUGIN_ROOT: join(root, 'plugins'), SCIFORGE_DSH_RUNTIME_VERSION: '0.2.0-rc.2',
      SCIFORGE_DEV_PLUGIN_CONTRACTS: path } }
    const options = await loadDevelopmentPluginOptions(input)
    expect(options?.adapterContracts?.get('sample@1.1.1')).toEqual(contract)
    expect(options?.adapterContracts?.has('sample')).toBe(false)
    expect(options?.allowedPermissionIds?.size).toBe(0)
    expect(await loadDevelopmentPluginOptions({ ...input, isPackaged: true, env: { ...input.env, SCIFORGE_DEV_PLUGIN_CONTRACTS: '/nonexistent' } })).toBeUndefined()
    expect(await loadDevelopmentPluginOptions({ ...input, env: {} })).toBeUndefined()
    expect((await loadDevelopmentPluginOptions({ ...input, env: { SCIFORGE_DEV_PLUGIN_ROOT: join(root, 'plugins') } }))?.adapterContracts?.size).toBe(0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('loads approved host ports allowlists and rejects malformed declarations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-plugin-ports-'))
  const path = join(root, 'host-contracts.json')
  const contract = { hostApiRange: '^1.0.0', permissions: [], approved: true,
    dshAuthorization: { packageName: 'sample', packageVersion: '1.1.1', dshRuntimeVersion: '0.2.0-rc.2',
      ports: ['artifacts.commit', 'artifacts.read'] } }
  const input = { isPackaged: false, userDataPath: root, hostApiVersion: '1.11.0', env: {
    SCIFORGE_DEV_PLUGIN_ROOT: join(root, 'plugins'), SCIFORGE_DSH_RUNTIME_VERSION: '0.2.0-rc.2',
    SCIFORGE_DEV_PLUGIN_CONTRACTS: path } }
  try {
    await mkdir(join(root, 'plugins'))
    await writeFile(path, JSON.stringify([contract]))
    const options = await loadDevelopmentPluginOptions(input)
    expect(options?.adapterContracts?.get('sample@1.1.1')?.dshAuthorization?.ports).toEqual(['artifacts.commit', 'artifacts.read'])
    for (const malformed of [
      { ...contract, dshAuthorization: { ...contract.dshAuthorization, ports: 'artifacts.commit' } },
      { ...contract, dshAuthorization: { ...contract.dshAuthorization, ports: [''] } },
      { ...contract, dshAuthorization: { ...contract.dshAuthorization, ports: ['  '] } },
      { ...contract, dshAuthorization: { ...contract.dshAuthorization, ports: ['ok', 1] } },
      { ...contract, dshAuthorization: { ...contract.dshAuthorization, ports: Array.from({ length: 33 }, (_, index) => `op.${index}`) } },
      { ...contract, dshAuthorization: { ...contract.dshAuthorization, ports: { operation: 'artifacts.commit' } } }
    ]) {
      await writeFile(path, JSON.stringify([malformed]))
      await expect(loadDevelopmentPluginOptions(input)).rejects.toThrow()
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
