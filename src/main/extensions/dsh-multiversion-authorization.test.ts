import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { loadDevelopmentPluginOptions } from './development-plugin-options'

it('loads multiple exact approvals for one package without falling back to a version', async () => {
  const root = await mkdtemp(join(tmpdir(), 'host-multiversion-'))
  try {
    const plugins = join(root, 'plugins'); await mkdir(plugins)
    const path = join(root, 'host.json')
    const contract = (packageVersion: string) => ({ hostApiRange: '^1.0.0', permissions: [], approved: true,
      dshAuthorization: { packageName: 'ordinary-versioned-plugin', packageVersion, dshRuntimeVersion: '0.2.0-rc.2' } })
    await writeFile(path, JSON.stringify([contract('1.0.0'), contract('2.0.0'), contract('3.0.0')]))
    const options = await loadDevelopmentPluginOptions({ isPackaged: false, userDataPath: join(root, 'data'), hostApiVersion: '1.0.0', env: {
      SCIFORGE_DEV_PLUGIN_ROOT: plugins, SCIFORGE_DEV_PLUGIN_CONTRACTS: path, SCIFORGE_DSH_RUNTIME_VERSION: '0.2.0-rc.2' } })
    expect(options?.adapterContracts?.get('ordinary-versioned-plugin@1.0.0')?.dshAuthorization?.packageVersion).toBe('1.0.0')
    expect(options?.adapterContracts?.get('ordinary-versioned-plugin@2.0.0')?.dshAuthorization?.packageVersion).toBe('2.0.0')
    expect(options?.adapterContracts?.get('ordinary-versioned-plugin')).toBeUndefined()
    await writeFile(path, JSON.stringify([contract('1.0.0'), contract('1.0.0')]))
    await expect(loadDevelopmentPluginOptions({ isPackaged: false, userDataPath: join(root, 'data'), hostApiVersion: '1.0.0', env: {
      SCIFORGE_DEV_PLUGIN_ROOT: plugins, SCIFORGE_DEV_PLUGIN_CONTRACTS: path } })).rejects.toThrow(/Duplicate/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
