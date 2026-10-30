import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { CapabilityRegistry } from '../capabilities/registry'
import { DevelopmentExternalPluginService } from './development-external-plugins'

const packageName = '@sciforge/migration-p1-unitverse'
const exactApproval = { packageName, packageVersion: '0.1.0', dshRuntimeVersion: '0.2.0-rc.2' }

it.each([
  { dsh: '*', hostApiVersion: '1.0.0', approvedRuntime: true },
  { dsh: '^0.2.0', hostApiVersion: '1.0.0', approvedRuntime: true },
  { dsh: 'garbage', hostApiVersion: '1.0.0', approvedRuntime: true },
  { dsh: '>=0.2.0-rc.2 <0.3.0', hostApiVersion: '1.0.0-rc.2', approvedRuntime: false },
  { dsh: '>=0.2.0-rc.2 <0.3.0', hostApiVersion: '1.0', approvedRuntime: false }
])('host service fails closed before publication for $dsh / $hostApiVersion / exact=$approvedRuntime', async ({ dsh, hostApiVersion, approvedRuntime }) => {
  const directory = await mkdtemp(join(tmpdir(), 'host-semver-rejection-'))
  const registry = new CapabilityRegistry()
  const service = new DevelopmentExternalPluginService({
    root: join(directory, 'plugins'), userDataPath: join(directory, 'user-data'),
    hostApiVersion, dshRuntimeVersion: '0.2.0-rc.2',
    adapterContracts: new Map([[packageName, { hostApiRange: '*', permissions: [], approved: true,
      ...(approvedRuntime ? { dshAuthorization: exactApproval } : {}) }]])
  })
  try {
    const plugin = join(directory, 'plugins', 'plugin')
    await cp(resolve('test-fixtures/migration-plugins/p1-unitverse'), plugin, { recursive: true })
    const manifest = JSON.parse(await readFile(join(plugin, 'package.json'), 'utf8'))
    await writeFile(join(plugin, 'package.json'), JSON.stringify({ ...manifest, engines: { dsh } }))
    await service.initialize()
    await service.attachCapabilityRegistry(registry)
    expect(await service.list()).toMatchObject([{ packageName, status: 'invalid', activationState: 'discovered' }])
    await expect(service.setEnabled(packageName, true)).rejects.toThrow(/requires/)
    expect(registry.has('unitverse.convert')).toBe(false)
    expect(await service.list()).toMatchObject([{ activationState: 'discovered' }])
  } finally { await service.dispose(); await rm(directory, { recursive: true, force: true }) }
})

it('host service accepts explicit DSH prerelease support and standard Host API OR syntax', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'host-semver-acceptance-'))
  const registry = new CapabilityRegistry()
  const service = new DevelopmentExternalPluginService({
    root: join(directory, 'plugins'), userDataPath: join(directory, 'user-data'),
    hostApiVersion: '1.0.0', dshRuntimeVersion: '0.2.0-rc.2',
    adapterContracts: new Map([[packageName, { hostApiRange: '^1.0.0 || ^2.0.0', permissions: [], approved: true }]])
  })
  try {
    await cp(resolve('test-fixtures/migration-plugins/p1-unitverse'), join(directory, 'plugins', 'plugin'), { recursive: true })
    await service.initialize()
    await service.attachCapabilityRegistry(registry)
    expect(await service.setEnabled(packageName, true)).toMatchObject({ status: 'active', activationState: 'active' })
    expect(registry.has('unitverse.convert')).toBe(true)
    await service.setEnabled(packageName, false)
    expect(registry.has('unitverse.convert')).toBe(false)
  } finally { await service.dispose(); await rm(directory, { recursive: true, force: true }) }
})
