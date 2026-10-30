import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import type { AppCapabilityDependencies } from '../capabilities/app-registry'
import type { CapabilityHandlerContext } from '../capabilities/registry'
import { DevelopmentExternalPluginService } from './development-external-plugins'

// Explicit package acceptance, independent of unit tests: point at an npm-installed tarball.
const packageDirectory = process.env.SCIFORGE_VISUAL_PACKAGE_DIRECTORY
it.skipIf(!packageDirectory)('installed Visual Review: trusted composition -> real child activate/definitions/invoke/disable, no native fallback', async () => {
  // Do not make skipped package acceptance pull built domain/canvas dependencies into unit tests.
  const [
    { createCanvas },
    { createApplicationCapabilityRegistry, createApplicationDomainCatalog },
    { createNonSecretPackageStorageForTest },
    { createUnavailablePortableResourcesForTest }
  ] = await Promise.all([
    import('@napi-rs/canvas'),
    import('../modules/application-composition'),
    import('../modules/domain-package-storage.test-helper'),
    import('../modules/domain-main-host.test-helper')
  ])
  const directory = resolve(packageDirectory!)
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  expect(manifest.private).toBe(true)
  const adapter = JSON.parse(await readFile(join(directory, 'sciforge.adapter.json'), 'utf8'))
  expect(adapter.replacesCapabilities).toBeUndefined()
  expect((await readFile(join(directory, 'dist/main.js'), 'utf8')).length).toBeGreaterThan(1000)
  const root = await mkdtemp(join(tmpdir(), 'visual-package-acceptance-'))
  const catalog = createApplicationDomainCatalog({
    getUserDataDir: () => root,
    getDeviceId: () => 'isolated-package-acceptance',
    portableResourcesFor: createUnavailablePortableResourcesForTest(),
    packageStorageFor: createNonSecretPackageStorageForTest(),
    capabilityInvokerFor: () => ({ invoke: async () => { throw new Error('No system capability grant in package acceptance') }, createApprovedBatch: () => { throw new Error('No system capability grant in package acceptance') } })
  }, { excludedPackageNames: ['@sciforge/domain-visual-review'] })
  const registry = createApplicationCapabilityRegistry(catalog, new Proxy({}, { get: () => () => undefined }) as AppCapabilityDependencies)
  const initial = registry.list().map(({ id }) => id)
  expect(initial.filter(id => id.startsWith('visual-review.'))).toEqual([])
  expect(catalog.listPackages().map(p => p.packageName)).not.toContain('@sciforge/domain-visual-review')
  const service = new DevelopmentExternalPluginService({ root: dirname(directory), userDataPath: join(root, 'profile'), hostApiVersion: '1.0.0', dshRuntimeVersion: '0.2.0-rc.2' })
  try {
    await service.initialize()
    await service.attachCapabilityRegistry(registry)
    const baseline = registry.list().map(({ id }) => id)
    const enabled = await service.setEnabled(manifest.name, true)
    expect(enabled.activationState).toBe('active')
    expect(enabled.generation).toBeGreaterThan(0)
    const ids = registry.list().map(({ id }) => id).filter(id => id.startsWith('visual-review.'))
    expect(ids).toHaveLength(10)
    const context = { caller: { workspaceId: root } } as CapabilityHandlerContext
    const canvas = createCanvas(16, 16)
    canvas.getContext('2d').fillRect(0, 0, 16, 16)
    await writeFile(join(root, 'figure.png'), await canvas.encode('png'))
    const open = registry.require('visual-review.open')
    const opened = await open.handler({ documentId: 'packed-child', artifact: { kind: 'generated_image', sourcePath: 'figure.png' } }, context)
    expect((opened.output as { status: string }).status).toBe('created')
    const read = registry.require('visual-review.read-document')
    expect((await read.handler({ documentId: 'packed-child' }, context)).output).toMatchObject({ status: 'opened' })
    await expect(registry.require('visual-review.export-review-packet').handler({ documentId: 'packed-child' }, context)).rejects.toThrow(/Host port operation artifacts.commit is not approved/)
    const disabled = await service.setEnabled(manifest.name, false)
    expect(disabled.enabled).toBe(false)
    expect(registry.list().map(({ id }) => id)).toEqual(baseline)
    await expect(read.handler({ documentId: 'packed-child' }, context)).rejects.toThrow()
    console.info(JSON.stringify({ package: manifest.name, version: manifest.version, childActive: enabled.activationState, generation: enabled.generation, definitions: ids, opened: (opened.output as { status: string }).status, disabled: !disabled.enabled, nativeFallback: false }))
  } finally {
    await service.dispose()
    catalog.dispose()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
