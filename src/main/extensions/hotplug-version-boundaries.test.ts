import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { DevelopmentExternalPluginService } from './development-external-plugins'
import { loadDevelopmentPluginOptions } from './development-plugin-options'

it('rejects same-version check and direct replace before writing candidate or active state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'same-version-live-repro-'))
  const plugins = join(root, 'plugins')
  const source = join(plugins, 'p1')
  const candidate = join(plugins, '.candidates', 'same')
  const name = '@sciforge/migration-p1-unitverse'
  await mkdir(plugins)
  await cp(resolve('test-fixtures/migration-plugins/p1-unitverse'), source, { recursive: true })
  await mkdir(join(plugins, '.candidates'))
  await cp(source, candidate, { recursive: true })
  const service = new DevelopmentExternalPluginService({ root: plugins, userDataPath: join(root, 'data'),
    hostApiVersion: '1.11.0', dshRuntimeVersion: '0.2.0-rc.2',
    adapterContracts: new Map([[name, { hostApiRange: '^1.0.0', permissions: [], approved: true }]]), allowedPermissionIds: new Set() })
  try {
    await service.initialize()
    await service.setEnabled(name, true)
    const before = await service.updateStatus(name)
    const statePath = join(root, 'data/extensions/development-external-state.json')
    const stateBefore = await readFile(statePath, 'utf8')
    await expect(service.checkCandidate(name, candidate)).rejects.toThrow(/version must change/i)
    await expect(service.replacePlugin(name, candidate)).rejects.toThrow(/version must change/i)
    expect(await readFile(statePath, 'utf8')).toBe(stateBefore)
    expect(await service.updateStatus(name)).toMatchObject({ version: before.version, generation: before.generation, status: 'active' })
    // Copying the current version for an Agent to edit remains supported.
    expect((await service.prepareAgentCandidate(name)).baseVersion).toBe(before.version)

    const changed = JSON.parse(await readFile(join(candidate, 'package.json'), 'utf8'))
    changed.version = '0.2.0'
    await writeFile(join(candidate, 'package.json'), JSON.stringify(changed))
    await service.checkCandidate(name, candidate)
    // Another trusted host operation can make a previously checked candidate active.
    await service.replacePlugin(name, candidate)
    const applied = await service.updateStatus(name)
    const stateAfterReplace = await readFile(statePath, 'utf8')
    await expect(service.applyCandidate(name)).rejects.toThrow(/version must change/i)
    expect(await service.updateStatus(name)).toMatchObject({ version: '0.2.0', generation: applied.generation, status: applied.status, activationState: applied.activationState })
    expect(await readFile(statePath, 'utf8')).toBe(stateAfterReplace)
  } finally { await service.dispose(); await rm(root, { recursive: true, force: true }) }
})

it('loads one authoritative version key so deleting approval cannot retain a hidden alias', async () => {
  const root = await mkdtemp(join(tmpdir(), 'single-approval-revocation-'))
  const plugins = join(root, 'plugins')
  await mkdir(plugins)
  const contract = { hostApiRange: '^1.0.0', permissions: [], approved: true,
    dshAuthorization: { packageName: 'ordinary-plugin', packageVersion: '1.0.0', dshRuntimeVersion: '0.2.0-rc.2' } }
  const path = join(root, 'host.json')
  await writeFile(path, JSON.stringify([contract]))
  try {
    const options = await loadDevelopmentPluginOptions({ isPackaged: false, userDataPath: root, hostApiVersion: '1.11.0',
      env: { SCIFORGE_DEV_PLUGIN_ROOT: plugins, SCIFORGE_DEV_PLUGIN_CONTRACTS: path } })
    const approvals = options!.adapterContracts as Map<string, typeof contract>
    expect([...approvals.keys()]).toEqual(['ordinary-plugin@1.0.0'])
    approvals.delete('ordinary-plugin@1.0.0')
    expect(approvals.size).toBe(0)
  } finally { await rm(root, { recursive: true, force: true }) }
})
