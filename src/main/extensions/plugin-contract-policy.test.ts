import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { loadPluginContractPins, resolvePluginContractPinsPath, type PluginContractPinsLoadOptions } from './plugin-contract-policy'

const roots: string[] = []
afterEach(async () => {
  // Only remove exact temporary fixture roots recorded by mkdtemp.
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(isPackaged = false) {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-contract-policy-'))
  roots.push(root)
  const options = { appPath: join(root, 'app'), resourcesPath: join(root, 'release-resources'), isPackaged }
  const path = resolvePluginContractPinsPath(options)
  await mkdir(dirname(path), { recursive: true })
  return { options, path }
}

const key = '@example/extension@1.2.3'
const pin = {
  hostServices: ['example.workspace'],
  dshConfig: { transport: 'host', nested: { enabled: true, values: [1, null] } },
  uiCapabilities: ['example.read'],
  uiResourceKinds: ['example-resource']
}
const policy = { schemaVersion: 1, pins: { [key]: pin } }

describe('Host reviewed plugin contract policy', () => {
  it.each([false, true])('loads only the Host resource path and freezes nested JSON (packaged: %s)', async isPackaged => {
    const { options, path } = await fixture(isPackaged)
    await writeFile(path, JSON.stringify(policy))
    expect(path).toBe(isPackaged
      ? join(options.resourcesPath, 'extensions', 'plugin-contract-pins.json')
      : join(options.appPath, 'resources', 'extensions', 'plugin-contract-pins.json'))
    const loaded = await loadPluginContractPins(options)
    expect(loaded).toEqual(policy.pins)
    expect(loaded['@example/extension']).toBeUndefined()
    expect(loaded['@example/extension@1.2.4']).toBeUndefined()
    expect(Object.isFrozen(loaded)).toBe(true)
    expect(Object.isFrozen(loaded[key])).toBe(true)
    expect(Object.isFrozen(loaded[key].hostServices)).toBe(true)
    expect(Object.isFrozen(loaded[key].dshConfig?.nested)).toBe(true)
    expect(() => (loaded[key].hostServices as string[]).push('unreviewed.service')).toThrow()
  })

  it('rejects missing policy rather than seeking profile or plugin declarations', async () => {
    const { options } = await fixture()
    await expect(loadPluginContractPins(options)).rejects.toThrow('Could not read')
  })

  it.each([
    '@example/extension', '@example/extension@*', '@example/extension@^1.2.3',
    '@example/extension@v1.2.3', '@Example/extension@1.2.3', '@example/extension@1.2.3 ',
    '@example/extension@', 'example@1.2'
  ])('rejects non-exact identity %s', async identity => {
    const { options, path } = await fixture()
    await writeFile(path, JSON.stringify({ schemaVersion: 1, pins: { [identity]: pin } }))
    await expect(loadPluginContractPins(options)).rejects.toThrow('is invalid')
  })

  it.each([
    '{ malformed',
    { ...policy, schemaVersion: 2 },
    { ...policy, approved: [] },
    { schemaVersion: 1, pins: { [key]: { ...pin, permissions: ['write'] } } },
    { schemaVersion: 1, pins: { [key]: { ...pin, hostServices: 'all' } } },
    { schemaVersion: 1, pins: { [key]: { ...pin, hostServices: [' '] } } },
    { schemaVersion: 1, pins: { [key]: { ...pin, uiCapabilities: [42] } } },
    { schemaVersion: 1, pins: { [key]: { ...pin, dshConfig: [] } } }
  ])('rejects malformed or undeclared authority %#', async invalid => {
    const { options, path } = await fixture()
    await writeFile(path, typeof invalid === 'string' ? invalid : JSON.stringify(invalid))
    await expect(loadPluginContractPins(options)).rejects.toThrow('is invalid')
  })

  it('preserves precisely the reviewed repository grant in source and packaged resource layouts', async () => {
    const appPath = fileURLToPath(new URL('../../../', import.meta.url))
    const sourceOptions: PluginContractPinsLoadOptions = { appPath, resourcesPath: '/unused', isPackaged: false }
    const source = await loadPluginContractPins(sourceOptions)
    expect(source).toEqual({
      // Public historical installations retain their exact reviewed grants;
      // preserving these is not authority for any newer or unlisted version.
      ...Object.fromEntries(['0.3.1', '0.3.2', '0.3.3'].map(version => [
        `@sciforge/plugin-scientific-plotting@${version}`, {
          hostServices: ['artifact-versions.workspace'], dshConfig: { artifacts: 'host' },
          uiCapabilities: ['artifact-versions.list', 'artifact-versions.read', 'artifact-versions.materialize', 'artifact-versions.describe-v2'],
          uiResourceKinds: ['scientific-plot', 'scientific-plot-render-manifest']
        }
      ])),
      // Existing approved 0.2.1 installations need their release-reviewed service
      // and resource grants on startup and on failed-upgrade recovery.
      '@sciforge/plugin-anchored-comments@0.2.1': {
        hostServices: ['identity-access.authenticated-cloud'],
        uiResourceKinds: ['resource-text-selection']
      },
      '@sciforge/plugin-anchored-comments@0.2.2': {
        hostServices: ['identity-access.authenticated-cloud'],
        uiResourceKinds: ['resource-text-selection']
      },
      '@sciforge/plugin-anchored-comments@0.2.3': {
        hostServices: ['identity-access.authenticated-cloud'],
        uiResourceKinds: ['resource-text-selection']
      }
    })
    expect(source['@sciforge/plugin-anchored-comments@0.2.0']).toBeUndefined()
    expect(source['@sciforge/plugin-anchored-comments@0.2.4']).toBeUndefined()
    // Reviewed service metadata never supplies signature trust or tool approval.
    for (const reviewed of Object.values(source)) {
      expect(reviewed).not.toHaveProperty('approved')
      expect(reviewed).not.toHaveProperty('dshAuthorization')
      expect(reviewed).not.toHaveProperty('publisherId')
    }
    const { options, path } = await fixture(true)
    await copyFile(resolvePluginContractPinsPath(sourceOptions), path)
    expect(await loadPluginContractPins(options)).toEqual(source)
  })

  it('wires the same loaded pins into installed and development composition without domain pins in core', async () => {
    const source = await readFile(new URL('../index.ts', import.meta.url), 'utf8')
    expect(source).toContain("import { loadPluginContractPins } from './extensions/plugin-contract-policy'")
    expect(source).toContain('const pluginContractPins = await loadPluginContractPins({')
    expect(source.match(/pinnedContracts: pluginContractPins/g)).toHaveLength(2)
    expect(source).toContain('const pluginDshConfigs: Readonly<Record<string, Readonly<Record<string, unknown>>>> = Object.freeze({})')
    expect(source).not.toContain('@sciforge/plugin-scientific-plotting@0.3.1')
  })
})
