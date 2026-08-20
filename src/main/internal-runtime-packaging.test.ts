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

type InternalRuntimeComposition = Readonly<{
  mainBundlePackageNames: readonly string[]
  buildPackageNames: readonly string[]
  extraResources: readonly Readonly<{ from: string; to: string }>[]
  packagedRuntimes: readonly Readonly<{
    packageName: string
    assets: readonly Readonly<{
      sourceRoot: string
      packagedResourcesPath: string
      requiredPaths: readonly string[]
      smoke?: Readonly<{
        entrypoint: string
        args: readonly string[]
        stdoutEquals: string
        timeoutMs: number
      }>
    }>[]
  }>[]
}>

type InternalRuntimePackaging = Readonly<{
  createInternalRuntimeComposition: (root?: string) => InternalRuntimeComposition
  validatePackagedInternalRuntimes: (
    resourcesPath: string,
    composition?: InternalRuntimeComposition
  ) => void
  buildInternalRuntimes: (
    composition: InternalRuntimeComposition,
    options: Readonly<{
      npmExecutable: string
      spawnSync: (
        executable: string,
        args: readonly string[],
        options: Readonly<{ cwd: string; stdio: string }>
      ) => Readonly<{ status: number; error?: Error }>
      projectRoot: string
    }>
  ) => void
}>

const require = createRequire(import.meta.url)
const internalRuntimePackaging = require(
  '../../scripts/internal-runtime-packaging.cjs'
) as InternalRuntimePackaging
const tempRoots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sciforge-internal-runtime-packaging-'))
  tempRoots.push(root)
  return root
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

function writeRuntimeFixture(root: string, overlay: string, packageDir: string): void {
  const runtimeRoot = join(root, 'internal', overlay, 'packages', packageDir)
  write(join(runtimeRoot, 'assets/runtime-v1/package.json'), '{"type":"commonjs"}\n')
  write(join(runtimeRoot, 'assets/runtime-v1/bin/runtime.cjs'), 'console.log("1.2.3")\n')
  write(join(runtimeRoot, 'assets/runtime-v1/scripts/helper.cjs'), 'module.exports = {}\n')
  write(join(runtimeRoot, 'package.json'), `${JSON.stringify({
    name: `@fixture-internal/${packageDir}`,
    version: '1.0.0',
    private: true,
    scripts: { build: 'node scripts/build.mjs' },
    sciforgeInternal: {
      distribution: 'internal-only',
      activation: { process: 'main' },
      packaging: {
        bundleMain: true,
        assets: [{
          root: 'assets/runtime-v1',
          packagedResourcesPath: `internal-runtimes/${packageDir}/runtime-v1`,
          requiredPaths: [
            'package.json',
            'bin/runtime.cjs',
            'scripts/helper.cjs'
          ],
          smoke: {
            entrypoint: 'bin/runtime.cjs',
            args: ['--version'],
            stdoutEquals: '1.2.3',
            timeoutMs: 1_000
          }
        }]
      }
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
  it('keeps composition, build, and packaged validation as no-ops without an internal overlay', () => {
    const root = tempRoot()
    const resourcesPath = join(root, 'packaged-resources')
    const composition = internalRuntimePackaging.createInternalRuntimeComposition(root)
    let buildProcessCount = 0

    expect(composition).toEqual({
      mainBundlePackageNames: [],
      buildPackageNames: [],
      extraResources: [],
      packagedRuntimes: []
    })
    expect(() => internalRuntimePackaging.buildInternalRuntimes(composition, {
      projectRoot: root,
      npmExecutable: 'fixture-npm',
      spawnSync: () => {
        buildProcessCount += 1
        return { status: 0 }
      }
    })).not.toThrow()
    expect(buildProcessCount).toBe(0)
    expect(() => internalRuntimePackaging.validatePackagedInternalRuntimes(
      resourcesPath,
      composition
    )).not.toThrow()
  })

  it('recomposes main bundles, builds, resources, and required paths as packages are added or removed', () => {
    const root = tempRoot()

    writeRuntimeFixture(root, 'vendor-a', 'runtime-a')
    writeRuntimeFixture(root, 'vendor-b', 'runtime-b')
    const composition = internalRuntimePackaging.createInternalRuntimeComposition(root)

    expect(composition.mainBundlePackageNames).toEqual([
      '@fixture-internal/runtime-a',
      '@fixture-internal/runtime-b'
    ])
    expect(composition.buildPackageNames).toEqual(composition.mainBundlePackageNames)
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
      assets: [{
        packagedResourcesPath: 'internal-runtimes/runtime-a/runtime-v1',
        requiredPaths: [
          'package.json',
          'bin/runtime.cjs',
          'scripts/helper.cjs'
        ]
      }]
    })

    rmSync(join(root, 'internal/vendor-a'), { recursive: true, force: true })
    expect(
      internalRuntimePackaging.createInternalRuntimeComposition(root).mainBundlePackageNames
    ).toEqual(['@fixture-internal/runtime-b'])
  })

  it('validates required files and executes manifest-declared smokes from packaged resources', () => {
    const root = tempRoot()
    const resourcesPath = join(root, 'packaged-resources')
    writeRuntimeFixture(root, 'vendor-a', 'runtime-a')
    const composition = internalRuntimePackaging.createInternalRuntimeComposition(root)
    const [asset] = composition.packagedRuntimes[0]?.assets ?? []
    if (!asset) throw new Error('Missing fixture asset.')
    cpSync(
      join(root, asset.sourceRoot),
      join(resourcesPath, asset.packagedResourcesPath),
      { recursive: true }
    )

    expect(() => internalRuntimePackaging.validatePackagedInternalRuntimes(
      resourcesPath,
      composition
    )).not.toThrow()

    rmSync(join(resourcesPath, asset.packagedResourcesPath, 'scripts/helper.cjs'))
    expect(() => internalRuntimePackaging.validatePackagedInternalRuntimes(
      resourcesPath,
      composition
    )).toThrow(/scripts\/helper\.cjs/u)
  })

  it('builds every discovered runtime through its npm workspace name', () => {
    const root = tempRoot()
    writeRuntimeFixture(root, 'vendor-a', 'runtime-a')
    writeRuntimeFixture(root, 'vendor-b', 'runtime-b')
    const composition = internalRuntimePackaging.createInternalRuntimeComposition(root)
    const calls: Array<Readonly<{ executable: string; args: readonly string[]; cwd: string }>> = []

    internalRuntimePackaging.buildInternalRuntimes(composition, {
      projectRoot: root,
      npmExecutable: 'fixture-npm',
      spawnSync: (executable, args, options) => {
        calls.push({ executable, args, cwd: options.cwd })
        return { status: 0 }
      }
    })

    expect(calls).toEqual([
      {
        executable: 'fixture-npm',
        args: ['--workspace', '@fixture-internal/runtime-a', 'run', 'build'],
        cwd: root
      },
      {
        executable: 'fixture-npm',
        args: ['--workspace', '@fixture-internal/runtime-b', 'run', 'build'],
        cwd: root
      }
    ])
  })

  it('rejects a required asset symlink that escapes its package-owned root', () => {
    const root = tempRoot()
    writeRuntimeFixture(root, 'vendor-a', 'runtime-a')
    const assetRoot = join(
      root,
      'internal/vendor-a/packages/runtime-a/assets/runtime-v1'
    )
    const outside = join(root, 'outside-helper.cjs')
    write(outside, 'module.exports = {}\n')
    rmSync(join(assetRoot, 'scripts/helper.cjs'))
    symlinkSync(outside, join(assetRoot, 'scripts/helper.cjs'))

    expect(() => internalRuntimePackaging.createInternalRuntimeComposition(root))
      .toThrow(/escapes its asset root/u)
  })
})
