import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

type InventoryFile = Readonly<{
  path: string
  sha256: string
  size: number
}>

type InternalRuntimeComposition = Readonly<{
  extraResources: readonly Readonly<{ from: string; to: string }>[]
  packagedRuntimes: readonly Readonly<{
    packageName: string
    packageDir: string
    installationEvidence: Readonly<{
      archiveSha256: string
      overlayId: string
      overlayRoot: string
      version: string
    }>
    assets: readonly Readonly<{
      sourceRoot: string
      packagedResourcesPath: string
      requiredPaths: readonly string[]
      inventory: readonly InventoryFile[]
    }>[]
  }>[]
}>

type InternalRuntimePackaging = Readonly<{
  createInternalRuntimeComposition: (root?: string) => InternalRuntimeComposition
  verifyPackagedInternalRuntimes: (
    resourcesPath: string,
    composition?: InternalRuntimeComposition
  ) => void
}>

type InternalOverlayIntegrity = Readonly<{
  canonicalJson: (value: unknown) => string
  createStaticFileInventory: (options: Readonly<{
    label: string
    rootPath: string
    rootPrefix: string
  }>) => readonly InventoryFile[]
  digestInventory: (manifest: Readonly<{
    files: readonly InventoryFile[]
    overlayId: string
    overlayRoot: string
    version: string
  }>) => string
}>

const require = createRequire(import.meta.url)
const internalRuntimePackaging = require(
  '../../scripts/internal-runtime-packaging.cjs'
) as InternalRuntimePackaging
const internalOverlayIntegrity = require(
  '@sciforge/internal-runtime-integrity'
) as InternalOverlayIntegrity
const tempRoots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sciforge-internal-runtime-packaging-'))
  tempRoots.push(root)
  return root
}

function write(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
}

function writeRuntimeFixture(
  root: string,
  overlay: string,
  packageDir: string,
  options: Readonly<{ includeEvidence?: boolean; includeSmoke?: boolean }> = {}
): void {
  const overlayId = `${overlay}-overlay`
  const overlayRoot = `internal/${overlay}`
  const runtimeRoot = join(root, overlayRoot, 'packages', packageDir)
  write(join(runtimeRoot, 'assets/runtime-v1/package.json'), '{"type":"commonjs"}\n')
  write(join(runtimeRoot, 'assets/runtime-v1/bin/runtime.cjs'), 'console.log("1.2.3")\n')
  write(join(runtimeRoot, 'assets/runtime-v1/scripts/helper.cjs'), 'module.exports = {}\n')
  const asset: Record<string, unknown> = {
    root: 'assets/runtime-v1',
    packagedResourcesPath: `internal-runtimes/${packageDir}/runtime-v1`,
    requiredPaths: [
      'package.json',
      'bin/runtime.cjs',
      'scripts/helper.cjs'
    ]
  }
  if (options.includeSmoke) {
    asset.smoke = {
      entrypoint: 'bin/runtime.cjs',
      args: ['--version'],
      stdoutEquals: '1.2.3'
    }
  }
  write(join(runtimeRoot, 'package.json'), `${JSON.stringify({
    name: `@fixture-internal/${packageDir}`,
    version: '1.0.0',
    private: true,
    sciforgeInternal: {
      distribution: 'internal-only',
      ...(options.includeEvidence === false
        ? {}
        : { installationEvidence: { overlayId, overlayRoot } }),
      packaging: { assets: [asset] }
    }
  }, null, 2)}\n`)
  writeOverlayReceipt(root, overlayId, overlayRoot)
  writeOverlayTrust(root, overlayId, overlayRoot, 'a'.repeat(64), packageDir)
}

function writeOverlayReceipt(root: string, overlayId: string, overlayRoot: string): void {
  const version = '1.0.0'
  const files = internalOverlayIntegrity.createStaticFileInventory({
    label: 'fixture overlay',
    rootPath: join(root, overlayRoot),
    rootPrefix: overlayRoot
  })
  const receipt = {
    archiveRoot: `sciforge-internal-overlay-${overlayId}-${version}`,
    archiveSha256: 'a'.repeat(64),
    files,
    inventorySha256: internalOverlayIntegrity.digestInventory({
      files,
      overlayId,
      overlayRoot,
      version
    }),
    overlayId,
    overlayRoot,
    schemaVersion: 2,
    version
  }
  write(
    join(root, '.sciforge', 'internal-overlays', `${overlayId}.json`),
    internalOverlayIntegrity.canonicalJson(receipt)
  )
}

function writeOverlayTrust(
  root: string,
  overlayId: string,
  overlayRoot: string,
  archiveSha256: string,
  packageDir: string
): void {
  const runtimeRoot = join(root, overlayRoot, 'packages', packageDir, 'assets/runtime-v1')
  const trustedRuntimeFiles = internalOverlayIntegrity.createStaticFileInventory({
    label: 'fixture runtime trust',
    rootPath: runtimeRoot,
    rootPrefix: ''
  }).map((file, index) => ({
    role: `fixture-runtime-file-${index + 1}`,
    relativePath: file.path,
    sha256: file.sha256,
    size: file.size
  }))
  write(join(root, 'packages', `trust-${overlayId}`, 'package.json'), `${JSON.stringify({
    name: `@fixture/${overlayId}-trust`,
    version: '1.0.0',
    private: false,
    sciforgeInternalRuntimeTrust: {
      contractVersion: 1,
      installations: [{
        archiveSha256,
        overlayId,
        overlayRoot,
        version: '1.0.0',
        assets: [{
          packagedResourcesPath: `internal-runtimes/${packageDir}/runtime-v1`,
          trustedRuntimeFiles
        }]
      }]
    }
  }, null, 2)}\n`)
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('manifest-driven internal runtime packaging', () => {
  it('keeps composition and packaged validation as no-ops without an internal overlay', () => {
    const root = tempRoot()
    const composition = internalRuntimePackaging.createInternalRuntimeComposition(root)

    expect(composition).toEqual({ extraResources: [], packagedRuntimes: [] })
    expect(() => internalRuntimePackaging.verifyPackagedInternalRuntimes(
      join(root, 'missing-packaged-resources'),
      composition
    )).not.toThrow()
  })

  it('recomposes only receipt-verified package directories and resources', () => {
    const root = tempRoot()
    writeRuntimeFixture(root, 'vendor-a', 'runtime-a')
    writeRuntimeFixture(root, 'vendor-b', 'runtime-b')

    const composition = internalRuntimePackaging.createInternalRuntimeComposition(root)
    expect(composition.extraResources).toEqual([
      {
        from: 'internal/vendor-a/packages/runtime-a/assets/runtime-v1',
        to: 'internal-runtimes/runtime-a/runtime-v1'
      },
      {
        from: 'internal/vendor-b/packages/runtime-b/assets/runtime-v1',
        to: 'internal-runtimes/runtime-b/runtime-v1'
      }
    ])
    expect(composition.packagedRuntimes[0]).toMatchObject({
      packageName: '@fixture-internal/runtime-a',
      packageDir: 'internal/vendor-a/packages/runtime-a',
      installationEvidence: {
        archiveSha256: 'a'.repeat(64),
        overlayId: 'vendor-a-overlay',
        overlayRoot: 'internal/vendor-a',
        version: '1.0.0'
      },
      assets: [{
        packagedResourcesPath: 'internal-runtimes/runtime-a/runtime-v1',
        requiredPaths: [
          'package.json',
          'bin/runtime.cjs',
          'scripts/helper.cjs'
        ],
        inventory: expect.arrayContaining([
          expect.objectContaining({ path: 'bin/runtime.cjs' }),
          expect.objectContaining({ path: 'package.json' })
        ])
      }]
    })

    rmSync(join(root, 'internal/vendor-a'), { recursive: true })
    rmSync(join(
      root,
      '.sciforge/internal-overlays/vendor-a-overlay.json'
    ))
    expect(
      internalRuntimePackaging.createInternalRuntimeComposition(root).packagedRuntimes
    ).toEqual([
      expect.objectContaining({ packageName: '@fixture-internal/runtime-b' })
    ])
  })

  it('rejects an installation receipt whose runtime payload was removed', () => {
    const root = tempRoot()
    writeRuntimeFixture(root, 'vendor-orphaned', 'runtime-orphaned')
    rmSync(join(root, 'internal/vendor-orphaned'), { recursive: true })

    expect(() => internalRuntimePackaging.createInternalRuntimeComposition(root))
      .toThrow(/missing file/u)
  })

  it('rejects a self-consistent receipt that does not match package-owned provenance', () => {
    const root = tempRoot()
    const overlayId = 'vendor-forged-overlay'
    const overlayRoot = 'internal/vendor-forged'
    writeRuntimeFixture(root, 'vendor-forged', 'runtime-forged')
    writeOverlayTrust(root, overlayId, overlayRoot, 'b'.repeat(64), 'runtime-forged')

    expect(() => internalRuntimePackaging.createInternalRuntimeComposition(root))
      .toThrow(/provenance/u)
  })

  it('validates complete packaged inventories with SciForge-owned static reads', () => {
    for (const corruption of [
      'none',
      'changed',
      'missing',
      'extra',
      'symlink',
      'ancestor-symlink'
    ] as const) {
      const root = tempRoot()
      const resourcesPath = join(root, 'packaged-resources')
      writeRuntimeFixture(root, `vendor-${corruption}`, `runtime-${corruption}`)
      const composition = internalRuntimePackaging.createInternalRuntimeComposition(root)
      const asset = composition.packagedRuntimes[0]?.assets[0]
      if (!asset) throw new Error('Missing fixture asset.')
      const packagedRoot = join(resourcesPath, asset.packagedResourcesPath)
      if (corruption === 'ancestor-symlink') {
        const realParent = join(resourcesPath, 'verified-asset-target')
        cpSync(join(root, asset.sourceRoot), join(realParent, 'runtime-v1'), {
          recursive: true
        })
        mkdirSync(dirname(dirname(packagedRoot)), { recursive: true })
        symlinkSync(realParent, dirname(packagedRoot), 'dir')
      } else {
        cpSync(join(root, asset.sourceRoot), packagedRoot, { recursive: true })
      }
      const helper = join(packagedRoot, 'scripts/helper.cjs')
      if (corruption === 'changed') write(helper, 'changed\n')
      if (corruption === 'missing') rmSync(helper)
      if (corruption === 'extra') write(join(packagedRoot, 'extra.cjs'), 'extra\n')
      if (corruption === 'symlink') {
        rmSync(helper)
        symlinkSync(join(root, asset.sourceRoot, 'scripts/helper.cjs'), helper)
      }

      const verify = (): void => internalRuntimePackaging.verifyPackagedInternalRuntimes(
        resourcesPath,
        composition
      )
      if (corruption === 'none') expect(verify).not.toThrow()
      else expect(verify).toThrow(/changed file|missing file|unreceipted file|symbolic link/u)
    }
  })

  it('rejects changed, missing, extra, and unreceipted source overlays before composition', () => {
    for (const corruption of ['changed', 'missing', 'extra', 'unreceipted'] as const) {
      const root = tempRoot()
      writeRuntimeFixture(root, `vendor-${corruption}`, `runtime-${corruption}`)
      const overlayRoot = join(root, 'internal', `vendor-${corruption}`)
      const helper = join(
        overlayRoot,
        'packages',
        `runtime-${corruption}`,
        'assets/runtime-v1/scripts/helper.cjs'
      )
      if (corruption === 'changed') write(helper, 'changed\n')
      if (corruption === 'missing') rmSync(helper)
      if (corruption === 'extra') write(join(overlayRoot, 'extra.txt'), 'extra\n')
      if (corruption === 'unreceipted') rmSync(join(root, '.sciforge'), { recursive: true })

      expect(() => internalRuntimePackaging.createInternalRuntimeComposition(root))
        .toThrow(/changed file|missing file|unreceipted file|receipt is missing/u)
    }
  })

  it('rejects missing evidence, executable smoke schema, and escaping source symlinks', () => {
    const missingEvidenceRoot = tempRoot()
    writeRuntimeFixture(missingEvidenceRoot, 'vendor-no-evidence', 'runtime-a', {
      includeEvidence: false
    })
    expect(() => internalRuntimePackaging.createInternalRuntimeComposition(missingEvidenceRoot))
      .toThrow(/installationEvidence must be an object/u)

    const smokeRoot = tempRoot()
    writeRuntimeFixture(smokeRoot, 'vendor-smoke', 'runtime-a', { includeSmoke: true })
    expect(() => internalRuntimePackaging.createInternalRuntimeComposition(smokeRoot))
      .toThrow(/unexpected or missing fields/u)

    const symlinkRoot = tempRoot()
    writeRuntimeFixture(symlinkRoot, 'vendor-symlink', 'runtime-a')
    const assetRoot = join(
      symlinkRoot,
      'internal/vendor-symlink/packages/runtime-a/assets/runtime-v1'
    )
    const outside = join(symlinkRoot, 'outside-helper.cjs')
    write(outside, 'module.exports = {}\n')
    rmSync(join(assetRoot, 'scripts/helper.cjs'))
    symlinkSync(outside, join(assetRoot, 'scripts/helper.cjs'))
    expect(() => internalRuntimePackaging.createInternalRuntimeComposition(symlinkRoot))
      .toThrow(/symbolic link/u)
  })
})
