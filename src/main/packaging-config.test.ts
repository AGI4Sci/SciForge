import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

type BuilderFileSet = {
  from?: string
  to?: string
  filter?: string[]
}

type RuntimeEntry = {
  id: string
  packageIds: string[]
  requiredPathsExport: string
  requiredPaths: string[]
  executableNodeEntryPaths?: string[]
}

type BundledDomainPackage = {
  packageName: string
  moduleId: string
  displayName: string
  packageDir: string
  bundleTo: string
  dependencies: string[]
  requiredRelativePaths: string[]
}

type DomainReleaseComposition = {
  packages: BundledDomainPackage[]
  packageDirs: string[]
  bundleTargets: string[]
  runtimeEntries: RuntimeEntry[]
  bundledFileSets: BuilderFileSet[]
  asarUnpackGlobs: string[]
}

type ReleaseWorkerManifest = {
  BUNDLED_FILE_FILTER: string[]
  BUILT_RUNTIME_UNPACK_GLOBS: string[]
  PACKAGE_DEFINITIONS: Record<string, { dir: string; bundleTo?: string; filter?: string[] }>
  workspacePackageDirs: string[]
  bundledPackageDirs: string[]
  bundledPackageTargets: string[]
  nonBundledPackageDirs: string[]
  runtimeEntries: RuntimeEntry[]
  packagedExecutableNodeEntryRequiredPaths: string[]
  runtimeRequiredPathExports: Record<string, string[]>
  discoverBundledDomainPackages: (root?: string) => BundledDomainPackage[]
  createDomainReleaseComposition: (root?: string) => DomainReleaseComposition
  createAsarUnpackGlobs: () => string[]
  createBundledFileSets: () => BuilderFileSet[]
}

type RootPackageJson = {
  workspaces: string[]
  scripts: Record<string, string>
}

const workspacePreviewWorkerPackageDirs = [
  'packages/workers/workspace-bioimaging',
  'packages/workers/workspace-deck',
  'packages/workers/workspace-molecular',
  'packages/workers/workspace-omics',
  'packages/workers/workspace-sequence',
  'packages/workers/workspace-spectra',
  'packages/workers/workspace-tabular'
]

const require = createRequire(import.meta.url)
const builderConfig = require('../../electron-builder.config.cjs')
const afterPack = require('../../scripts/after-pack.cjs')
const macNotarize = require('../../scripts/mac-notarize.cjs')
const releaseWorkerManifest = require(
  '../../scripts/release-worker-manifest.cjs'
) as ReleaseWorkerManifest
const rootPackage = require('../../package.json') as RootPackageJson
const projectRoot = dirname(require.resolve('../../package.json'))

const tempRoots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sciforge-packaging-'))
  tempRoots.push(root)
  return root
}

function touch(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '{}\n', 'utf8')
}

function createBundledDomainFixture(
  root: string,
  directoryName: string,
  packageName: string,
  dependencies: string[] = []
): void {
  const packageRoot = join(root, 'packages', 'domains', directoryName)
  const runtimeModule = directoryName.replace(/-/g, '_')
  const runtimePath = `python/${runtimeModule}/server.py`
  mkdirSync(join(packageRoot, 'python', runtimeModule), { recursive: true })
  mkdirSync(join(packageRoot, 'src'), { recursive: true })
  writeFileSync(join(packageRoot, runtimePath), '# fixture\n', 'utf8')
  writeFileSync(
    join(packageRoot, 'src', 'definition.ts'),
    'export const domainPackageDefinition = {}\n',
    'utf8'
  )
  writeFileSync(
    join(packageRoot, 'src', 'main.ts'),
    'export function createDomainMainEntry() { return {} }\n',
    'utf8'
  )
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
    name: packageName,
    version: '1.0.0',
    type: 'module',
    exports: {
      './definition': './src/definition.ts',
      './main': './src/main.ts'
    },
    scripts: {
      test: 'node --test',
      typecheck: 'tsc --noEmit'
    }
  }), 'utf8')
  writeFileSync(join(packageRoot, 'sciforge.domain.json'), JSON.stringify({
    contractVersion: 1,
    kind: 'trusted-compile-time',
    packageName,
    module: {
      id: `fixture.${directoryName}`,
      displayName: directoryName,
      version: '1.0.0',
      hostApi: {
        minimum: '1.0.0',
        maximumExclusive: '2.0.0'
      }
    },
    entrypoints: [{
      process: 'main',
      export: './main',
      contributions: []
    }],
    packaging: {
      bundled: true,
      runtime: {
        requiredPaths: [runtimePath],
        dependencies
      }
    }
  }), 'utf8')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function loadBuilderConfigWithEnv(env: Record<string, string | undefined>): typeof builderConfig {
  const configPath = require.resolve('../../electron-builder.config.cjs')
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key])
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  delete require.cache[configPath]
  try {
    return require(configPath)
  } finally {
    delete require.cache[configPath]
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    require(configPath)
  }
}

function createMacPackContext(root: string): {
  appOutDir: string
  electronPlatformName: string
  packager: { appInfo: { productFilename: string }; projectDir: string }
} {
  return {
    appOutDir: join(root, 'mac-arm64'),
    electronPlatformName: 'darwin',
    packager: {
      projectDir: root,
      appInfo: {
        productFilename: 'SciForge'
      }
    }
  }
}

function bundledDirectoryFileSets(): BuilderFileSet[] {
  return (builderConfig.files as unknown[]).filter((entry): entry is BuilderFileSet => {
    return typeof entry === 'object' && entry !== null
  })
}

function stringEntries(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function isPathInside(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`)
}

function workspaceCoversPackage(workspace: string, packageDir: string): boolean {
  if (workspace === packageDir) return true
  return workspace.endsWith('/*') &&
    dirname(packageDir) === workspace.slice(0, -2)
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('electron-builder release packaging', () => {
  it('embeds an explicitly configured host-owned extension public keyring', () => {
    const root = tempRoot()
    const keyringPath = join(root, 'official-keys.json')
    touch(keyringPath)
    const configured = loadBuilderConfigWithEnv({
      SCIFORGE_OFFICIAL_EXTENSION_KEYS_FILE: keyringPath
    })

    expect(configured.extraResources).toContainEqual({
      from: keyringPath,
      to: 'extensions/official-keys.json'
    })
    expect(() => loadBuilderConfigWithEnv({
      SCIFORGE_OFFICIAL_EXTENSION_KEYS_FILE: join(root, 'missing.json')
    })).toThrow('does not exist')
  })

  it('packages shared agent support without the retired Kun runtime', () => {
    expect(builderConfig.npmRebuild).toBe(true)
    expect(builderConfig.files).toEqual(expect.arrayContaining([
      'node_modules/zod/**/*'
    ]))
    expect(builderConfig.asarUnpack).toEqual(expect.arrayContaining([
      '**/node_modules/node-pty/**/*',
      '**/node_modules/proxy-from-env/**/*',
      '**/node_modules/zod/**/*'
    ]))
    expect(stringEntries(builderConfig.files).some((entry) => entry.includes('kun/'))).toBe(false)
    expect(stringEntries(builderConfig.asarUnpack).some((entry) => entry.includes('/kun/'))).toBe(false)
    expect(stringEntries(builderConfig.asarUnpack).some((entry) => entry.includes('better-sqlite3'))).toBe(false)
    expect(builderConfig.asarUnpack).not.toEqual(expect.arrayContaining([
      '**/node_modules/node-bin-darwin-*/*',
      '**/node_modules/node-bin-linux-*/*',
      '**/node_modules/node-bin-win-*/*',
      '**/node_modules/openclaw/**/*',
      '**/node_modules/@tencent-weixin/openclaw-weixin/**/*'
    ]))
    expect(builderConfig.files).toEqual(expect.arrayContaining([
      '!**/node_modules/openclaw/**/*'
    ]))
  })

  it('derives release worker file sets and unpack globs from the shared manifest', () => {
    const fileSets = bundledDirectoryFileSets()

    expect(fileSets).toEqual(releaseWorkerManifest.createBundledFileSets())
    expect(fileSets.map((entry) => entry.from)).toEqual(releaseWorkerManifest.bundledPackageDirs)
    expect(builderConfig.asarUnpack).toEqual(expect.arrayContaining(
      releaseWorkerManifest.createAsarUnpackGlobs()
    ))
    expect(releaseWorkerManifest.BUILT_RUNTIME_UNPACK_GLOBS).toEqual(['**/out/main/**/*'])
    expect(builderConfig.asarUnpack).toContain('**/out/main/**/*')
    expect(builderConfig.asarUnpack).toContain('**/packages/full-trace/**/*')
    expect(builderConfig.asarUnpack).toContain('**/node_modules/@sciforge/full-trace/**/*')
    for (const domainPackage of releaseWorkerManifest.discoverBundledDomainPackages(projectRoot)) {
      expect(builderConfig.asarUnpack).toContain(`**/${domainPackage.packageDir}/**/*`)
      expect(builderConfig.asarUnpack).toContain(`**/${domainPackage.bundleTo}/**/*`)
    }
    expect(fileSets.map((entry) => entry.to)).toEqual(releaseWorkerManifest.bundledPackageTargets)
  })

  it('keeps pending release-strategy packages out of bundled app content', () => {
    const bundledDirectoryFileSetDirs = bundledDirectoryFileSets()
      .map((entry) => entry.from)
      .filter((entry): entry is string => typeof entry === 'string')
    const unpackGlobs = (builderConfig.asarUnpack as unknown[])
      .filter((entry): entry is string => typeof entry === 'string')

    for (const packageDir of releaseWorkerManifest.nonBundledPackageDirs) {
      expect(bundledDirectoryFileSetDirs).not.toContain(packageDir)
      expect(unpackGlobs).not.toContain(`**/${packageDir}/**/*`)
    }

    expect(bundledDirectoryFileSetDirs.filter((entry) => entry.startsWith('plugins/'))).toEqual([])
    expect(unpackGlobs.filter((entry) => entry.includes('/plugins/'))).toEqual([])
    for (const rawGlob of [
      'plugins/**/*',
      'packages/workers/sci-modality-router/**/*',
      'packages/workers/evidence-dag/**/*',
      'packages/workers/project-dag/**/*',
      'packages/workers/gui-owl-computer-use/**/*'
    ]) {
      expect(builderConfig.files).not.toContain(rawGlob)
    }
  })

  it('keeps GUI-Owl sidecar secrets and model weights out of release packaging candidates', () => {
    const deniedCandidates = [
      'packages/workers/gui-owl-computer-use/package.json',
      'packages/workers/gui-owl-computer-use/server/serve-gui-owl-32b.sh',
      'packages/workers/gui-owl-computer-use/启动-secrets.local.ps1',
      'packages/workers/gui-owl-computer-use/models/gui-owl.safetensors',
      'packages/workers/gui-owl-computer-use/models/gui-owl.pt',
      'packages/workers/gui-owl-computer-use/models/gui-owl.pth',
      'packages/workers/gui-owl-computer-use/models/gui-owl.gguf'
    ]
    const bundledDirectoryFileSetDirs = bundledDirectoryFileSets()
      .map((entry) => entry.from)
      .filter((entry): entry is string => typeof entry === 'string')
    const unpackGlobs = stringEntries(builderConfig.asarUnpack)
    const fileStringEntries = stringEntries(builderConfig.files)
    const extraResourceSources = (builderConfig.extraResources as unknown[])
      .map((entry) => typeof entry === 'object' && entry !== null
        ? (entry as { from?: unknown }).from
        : entry)
      .filter((entry): entry is string => typeof entry === 'string')
    const runtimeRequiredPaths = releaseWorkerManifest.runtimeEntries
      .flatMap((entry) => entry.requiredPaths)

    for (const candidate of deniedCandidates) {
      expect(bundledDirectoryFileSetDirs.some((dir) => isPathInside(candidate, dir))).toBe(false)
      expect(unpackGlobs).not.toContain(`**/${candidate}`)
      expect(unpackGlobs.some((glob) =>
        glob.startsWith('**/') && glob.endsWith('/**/*') &&
        isPathInside(candidate, glob.slice(3, -5))
      )).toBe(false)
      expect(fileStringEntries).not.toContain(candidate)
      expect(fileStringEntries).not.toContain(`${candidate}/**/*`)
      expect(fileStringEntries).not.toContain(`${candidate}/**`)
      expect(extraResourceSources.some((source) => isPathInside(candidate, source))).toBe(false)
      expect(runtimeRequiredPaths).not.toContain(candidate)
    }
  })

  it('loads the packaged multi-agent contract with zod at the worker resolution root', () => {
    const root = tempRoot()
    const context = createMacPackContext(root)
    const packagedRoot = afterPack._internals.unpackedAppRoot(context)
    const packagedWorker = join(packagedRoot, 'packages/workers/multi-agent')
    const rootZod = join(packagedRoot, 'node_modules/zod')

    mkdirSync(join(packagedWorker, 'dist'), { recursive: true })
    cpSync(
      join(projectRoot, 'packages/workers/multi-agent/package.json'),
      join(packagedWorker, 'package.json')
    )
    cpSync(
      join(projectRoot, 'packages/workers/multi-agent/dist/contract.js'),
      join(packagedWorker, 'dist/contract.js')
    )
    cpSync(join(projectRoot, 'node_modules/zod'), rootZod, { recursive: true })

    expect(() => {
      afterPack._internals.verifyBundledMultiAgentContract(context)
    }).not.toThrow()

    rmSync(rootZod, { recursive: true, force: true })

    expect(() => {
      afterPack._internals.verifyBundledMultiAgentContract(context)
    }).toThrow(/root zod dependency/)
  })

  it('exports and validates release worker runtime requirements from the shared manifest', () => {
    for (const runtimeEntry of releaseWorkerManifest.runtimeEntries) {
      expect(afterPack[runtimeEntry.requiredPathsExport]).toEqual(runtimeEntry.requiredPaths)

      const root = tempRoot()
      const context = createMacPackContext(root)
      const unpackedRoot = afterPack._internals.unpackedAppRoot(context)

      for (const relativePath of runtimeEntry.requiredPaths) {
        touch(join(unpackedRoot, relativePath))
      }

      expect(() => {
        afterPack._internals.validateBundledReleaseRuntime(context, runtimeEntry)
      }).not.toThrow()

      const missingPath = runtimeEntry.requiredPaths[Math.min(1, runtimeEntry.requiredPaths.length - 1)]
      rmSync(join(unpackedRoot, missingPath), { recursive: true, force: true })

      expect(() => {
        afterPack._internals.validateBundledReleaseRuntime(context, runtimeEntry)
      }).toThrow(new RegExp(escapeRegExp(missingPath)))
    }
  })

  it('bundles package-owned domain runtimes from source to app.asar.unpacked', () => {
    const domainPackages = releaseWorkerManifest.discoverBundledDomainPackages(projectRoot)
    const fileSets = releaseWorkerManifest.createBundledFileSets()
    const root = tempRoot()
    const unpackedRoot = afterPack._internals.unpackedAppRoot(createMacPackContext(root))

    expect(domainPackages.map(({ packageName }) => packageName)).toEqual(expect.arrayContaining([
      '@sciforge/domain-evidence-dag',
      '@sciforge/domain-project-dag'
    ]))
    expect(
      domainPackages.find(({ packageName }) =>
        packageName === '@sciforge/domain-project-dag'
      )?.dependencies
    ).toContain('@sciforge/domain-evidence-dag')

    for (const domainPackage of domainPackages) {
      const entry = releaseWorkerManifest.runtimeEntries.find(
        ({ id }) => id === domainPackage.moduleId
      )
      const requiredPaths = domainPackage.requiredRelativePaths.map(
        (relativePath) => `${domainPackage.bundleTo}/${relativePath}`
      )
      if (!entry) throw new Error(`Missing ${domainPackage.moduleId} release runtime entry.`)

      expect(entry).toMatchObject({
        id: domainPackage.moduleId,
        packageIds: [domainPackage.packageName, ...domainPackage.dependencies],
        requiredPaths
      })
      expect(fileSets).toContainEqual({
        from: domainPackage.packageDir,
        to: domainPackage.bundleTo,
        filter: releaseWorkerManifest.BUNDLED_FILE_FILTER
      })
      expect(releaseWorkerManifest.nonBundledPackageDirs).not.toContain(domainPackage.packageDir)
      for (const relativePath of domainPackage.requiredRelativePaths) {
        expect(() => statSync(
          join(projectRoot, domainPackage.packageDir, relativePath)
        )).not.toThrow()
      }
      for (const relativePath of requiredPaths) {
        touch(join(unpackedRoot, relativePath))
      }
      expect(() => {
        afterPack._internals.validateBundledReleaseRuntime(
          createMacPackContext(root),
          entry
        )
      }).not.toThrow()
    }
  })

  it('recomposes bundled domains when a fixture package is added or removed', () => {
    const root = tempRoot()
    mkdirSync(join(root, 'packages', 'domains'), { recursive: true })

    expect(releaseWorkerManifest.createDomainReleaseComposition(root).packages).toEqual([])

    createBundledDomainFixture(root, 'runtime-base', '@fixture/runtime-base')
    const baseOnly = releaseWorkerManifest.createDomainReleaseComposition(root)
    expect(baseOnly.packageDirs).toEqual(['packages/domains/runtime-base'])
    expect(baseOnly.bundleTargets).toEqual(['node_modules/@fixture/runtime-base'])
    expect(baseOnly.asarUnpackGlobs).toEqual([
      '**/packages/domains/runtime-base/**/*',
      '**/node_modules/@fixture/runtime-base/**/*'
    ])

    createBundledDomainFixture(
      root,
      'runtime-consumer',
      '@fixture/runtime-consumer',
      ['@fixture/runtime-base']
    )
    const withConsumer = releaseWorkerManifest.createDomainReleaseComposition(root)
    expect(withConsumer.packages.map(({ packageName }) => packageName)).toEqual([
      '@fixture/runtime-base',
      '@fixture/runtime-consumer'
    ])
    expect(withConsumer.runtimeEntries[1]?.packageIds).toEqual([
      '@fixture/runtime-consumer',
      '@fixture/runtime-base'
    ])
    expect(withConsumer.bundledFileSets).toHaveLength(2)

    rmSync(join(root, 'packages', 'domains', 'runtime-consumer'), {
      recursive: true,
      force: true
    })
    expect(
      releaseWorkerManifest.createDomainReleaseComposition(root).packages.map(
        ({ packageName }) => packageName
      )
    ).toEqual(['@fixture/runtime-base'])

    rmSync(join(root, 'packages', 'domains', 'runtime-base'), {
      recursive: true,
      force: true
    })
    expect(releaseWorkerManifest.createDomainReleaseComposition(root).packages).toEqual([])
  })

  it('loads packaged DAG Python entrypoints without global site packages on the host architecture', () => {
    const root = tempRoot()
    const context = createMacPackContext(root)
    const unpackedRoot = afterPack._internals.unpackedAppRoot(context)
    const packageNames = [
      '@sciforge/domain-evidence-dag',
      '@sciforge/domain-project-dag'
    ]
    const domainPackages = releaseWorkerManifest.discoverBundledDomainPackages(projectRoot)
      .filter(({ packageName }) => packageNames.includes(packageName))

    expect(domainPackages.map(({ packageName }) => packageName)).toEqual(packageNames)
    const pythonPaths = domainPackages.map((domainPackage) => {
      const source = join(projectRoot, domainPackage.packageDir, 'python')
      const target = join(unpackedRoot, domainPackage.bundleTo, 'python')
      cpSync(source, target, { recursive: true })
      return target
    })
    const output = execFileSync(
      process.platform === 'win32' ? 'python.exe' : 'python3',
      [
        '-S',
        '-c',
        [
          'import platform',
          'import evidence_dag.server',
          'import project_dag.server',
          'print(platform.machine())'
        ].join(';')
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PYTHONPATH: pythonPaths.join(delimiter)
        }
      }
    ).trim()

    if (process.platform === 'darwin') {
      expect(output.toLowerCase()).toBe(process.arch === 'arm64' ? 'arm64' : 'x86_64')
    } else {
      expect(output).not.toBe('')
    }
  })

  it('keeps UI-only compile-time domains out of the release runtime manifest', () => {
    expect(releaseWorkerManifest.runtimeEntries.map((entry) => entry.id)).not.toContain('paper-radar')
    expect(releaseWorkerManifest.workspacePackageDirs).not.toContain('packages/workers/paper-radar')
    expect(releaseWorkerManifest.bundledPackageDirs).not.toContain('packages/workers/paper-radar')
    expect(releaseWorkerManifest.bundledPackageDirs.some((dir) => dir.startsWith('plugins/'))).toBe(false)
    expect(releaseWorkerManifest.nonBundledPackageDirs).toEqual(expect.arrayContaining([
      'packages/workers/sci-modality-router',
      'packages/workers/gui-owl-computer-use'
    ]))
    expect(releaseWorkerManifest.bundledPackageDirs).toEqual(expect.arrayContaining([
      'packages/domains/evidence-dag',
      'packages/domains/project-dag'
    ]))
  })

  it('keeps Model Router release requirements independent of Sci Modality', () => {
    const modelRouter = releaseWorkerManifest.runtimeEntries.find((entry) => entry.id === 'model-router')

    expect(modelRouter?.requiredPaths).toEqual(expect.arrayContaining([
      'packages/workers/model-router/package.json',
      'packages/workers/model-router/src/full-trace-recorder.ts',
      'packages/workers/model-router/src/cli.ts',
      'packages/workers/model-router/src/manifest.ts',
      'packages/workers/model-router/src/trace-correlation.ts',
      'packages/workers/model-router/src/trace-correlation/codex.ts',
      'packages/workers/model-router/src/upstream-drivers.ts'
    ]))
    expect(modelRouter?.executableNodeEntryPaths).toEqual([
      'out/main/model-router-sidecar-node-entry.js'
    ])
    expect(modelRouter?.packageIds).toEqual(['modelRouter', 'fullTrace'])
    expect(modelRouter?.requiredPaths).not.toEqual(expect.arrayContaining([
      'packages/workers/sci-modality-router/package.json'
    ]))
  })

  it('bundles Plan Gateway as its own release runtime', () => {
    const planGateway = releaseWorkerManifest.runtimeEntries.find((entry) => entry.id === 'plan-gateway')

    expect(planGateway?.requiredPaths).toEqual(expect.arrayContaining([
      'packages/workers/plan-gateway/package.json',
      'packages/workers/plan-gateway/src/cli.ts',
      'packages/workers/plan-gateway/src/gateway.ts',
      'packages/workers/plan-gateway/src/adapters/codex.ts',
      'packages/workers/plan-gateway/src/manifest.ts',
      'packages/workers/plan-gateway/src/trace-sink.ts',
      'node_modules/proxy-from-env/package.json'
    ]))
    expect(planGateway?.executableNodeEntryPaths).toEqual([
      'out/main/plan-gateway-sidecar-node-entry.js'
    ])
    expect(planGateway?.packageIds).toEqual(['planGateway', 'fullTrace'])
    expect(releaseWorkerManifest.bundledPackageDirs).toContain('packages/workers/plan-gateway')
  })

  it('installs the built Full Trace package at the workers runtime resolution path', () => {
    const fullTrace = releaseWorkerManifest.runtimeEntries.find((entry) => entry.id === 'full-trace')
    const fullTraceFileSet = releaseWorkerManifest.createBundledFileSets()
      .find((entry) => entry.from === 'packages/full-trace')

    expect(fullTraceFileSet).toEqual({
      from: 'packages/full-trace',
      to: 'node_modules/@sciforge/full-trace',
      filter: ['package.json', 'dist/*.js']
    })
    expect(fullTrace?.requiredPaths).toEqual([
      'node_modules/@sciforge/full-trace/package.json',
      'node_modules/@sciforge/full-trace/dist/index.js',
      'node_modules/@sciforge/full-trace/dist/redaction.js',
      'node_modules/@sciforge/full-trace/dist/schema.js',
      'node_modules/@sciforge/full-trace/dist/store.js'
    ])

    const packagedRoot = tempRoot()
    const installedPackage = join(packagedRoot, 'node_modules/@sciforge/full-trace')
    mkdirSync(installedPackage, { recursive: true })
    cpSync(join(projectRoot, 'packages/full-trace/package.json'), join(installedPackage, 'package.json'))
    cpSync(join(projectRoot, 'packages/full-trace/dist'), join(installedPackage, 'dist'), {
      recursive: true
    })

    expect(execFileSync(process.execPath, [
      '--input-type=module',
      '--eval',
      'const trace = await import("@sciforge/full-trace"); process.stdout.write(typeof trace.LocalTraceStore);'
    ], { cwd: packagedRoot, encoding: 'utf8' })).toBe('function')
  })

  it('validates executable node entries from the physical unpacked application', () => {
    expect(afterPack.PACKAGED_EXECUTABLE_NODE_ENTRY_REQUIRED_PATHS).toEqual(
      releaseWorkerManifest.packagedExecutableNodeEntryRequiredPaths
    )
    expect(afterPack.PACKAGED_EXECUTABLE_NODE_ENTRY_REQUIRED_PATHS).toEqual(expect.arrayContaining([
      'out/main/codex-pre-tool-use-governance-node-entry.js',
      'out/main/model-router-sidecar-node-entry.js',
      'out/main/plan-gateway-sidecar-node-entry.js',
      'out/main/schedule-mcp-node-entry.js',
      'out/main/research-search-mcp-node-entry.js',
      'out/main/runtime-inspector-mcp-node-entry.js'
    ]))

    const root = tempRoot()
    const context = createMacPackContext(root)
    const unpackedRoot = afterPack._internals.unpackedAppRoot(context)
    const hookEntry = 'out/main/codex-pre-tool-use-governance-node-entry.js'

    touch(join(root, hookEntry))
    expect(() => {
      afterPack._internals.validatePackagedExecutableNodeEntries(context)
    }).toThrow(/out\/main\/codex-pre-tool-use-governance-node-entry\.js/)

    for (const relativePath of afterPack.PACKAGED_EXECUTABLE_NODE_ENTRY_REQUIRED_PATHS) {
      touch(join(unpackedRoot, relativePath))
    }

    expect(() => {
      afterPack._internals.validatePackagedExecutableNodeEntries(context)
    }).not.toThrow()

    rmSync(join(unpackedRoot, hookEntry), { recursive: true, force: true })

    expect(() => {
      afterPack._internals.validatePackagedExecutableNodeEntries(context)
    }).toThrow(/out\/main\/codex-pre-tool-use-governance-node-entry\.js/)
  })

  it('repairs node-pty spawn-helper execute bits in unpacked packages', () => {
    const root = tempRoot()
    const context = createMacPackContext(root)
    const unpackedRoot = afterPack._internals.unpackedAppRoot(context)
    const helper = join(unpackedRoot, 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper')
    touch(helper)
    chmodSync(helper, 0o644)

    afterPack._internals.ensureNodePtyHelpersExecutable(context)

    expect(statSync(helper).mode & 0o111).not.toBe(0)
  })

  it('requires Apple secure timestamps when Developer ID signing is enabled', () => {
    const signedConfig = loadBuilderConfigWithEnv({
      MAC_SIGN: '1'
    })

    expect(signedConfig.mac.identity).toBeUndefined()
    expect(signedConfig.mac.hardenedRuntime).toBe(true)
    expect(signedConfig.mac.forceCodeSigning).toBe(true)
    expect(signedConfig.mac.timestamp).toBe('http://timestamp.apple.com/ts01')
  })

  it('checks timestamp candidates across nested macOS signed code', () => {
    const root = tempRoot()
    const appBundle = join(root, 'SciForge.app')
    const mainExecutable = join(appBundle, 'Contents/MacOS/SciForge')
    const framework = join(appBundle, 'Contents/Frameworks/Electron Framework.framework')
    const nativeAddon = join(
      appBundle,
      'Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/pty.node'
    )
    const resourceScript = join(appBundle, 'Contents/Resources/postinstall.sh')

    touch(mainExecutable)
    touch(join(framework, 'Versions/A/Electron Framework'))
    touch(nativeAddon)
    touch(resourceScript)
    chmodSync(mainExecutable, 0o755)
    chmodSync(resourceScript, 0o755)

    expect(macNotarize._internals.collectSignedCodeCandidates(appBundle)).toEqual([
      appBundle,
      framework,
      mainExecutable,
      nativeAddon
    ])
  })
})

describe('root package workspace contracts', () => {
  it('keeps package.json workspaces aligned with the release worker manifest', () => {
    for (const packageDir of releaseWorkerManifest.workspacePackageDirs) {
      expect(
        rootPackage.workspaces.some((workspace) => workspaceCoversPackage(workspace, packageDir))
      ).toBe(true)
    }
    expect(rootPackage.workspaces).toEqual(expect.arrayContaining([
      'packages/workers/model-router',
      'packages/workers/sci-modality-router',
      'packages/workers/paper-radar',
      'packages/domains/*',
      ...workspacePreviewWorkerPackageDirs
    ]))
    for (const workspacePreviewWorkerPackageDir of workspacePreviewWorkerPackageDirs) {
      expect(releaseWorkerManifest.workspacePackageDirs).not.toContain(workspacePreviewWorkerPackageDir)
      expect(releaseWorkerManifest.bundledPackageDirs).not.toContain(workspacePreviewWorkerPackageDir)
    }
    expect(rootPackage.workspaces.some((workspace) => workspace.startsWith('plugins/'))).toBe(false)
    expect(rootPackage.workspaces).not.toContain('kun')
    expect(rootPackage.workspaces).not.toContain('packages/workers/gui-owl-computer-use')
    expect(rootPackage.scripts).toMatchObject({
      'build:execution-governance': 'npm --workspace @sciforge/execution-governance run build',
      'build:full-trace': 'npm --workspace @sciforge/full-trace run build',
      'build:multi-agent': 'npm --workspace @sciforge/multi-agent run build',
      'build:agent-support': 'npm run build:execution-governance && npm run build:full-trace && npm run build:multi-agent',
      'model-router:start': 'npm --workspace @sciforge/model-router run start',
      'model-router:test': 'npm --workspace @sciforge/model-router run test',
      'plan-gateway:start': 'npm --workspace @sciforge/plan-gateway run start',
      'plan-gateway:test': 'npm --workspace @sciforge/plan-gateway run test',
      'plan-gateway:typecheck': 'npm --workspace @sciforge/plan-gateway run typecheck',
      'paper-radar:test': 'npm --workspace @sciforge/paper-radar run test',
      'paper-radar:typecheck': 'npm --workspace @sciforge/paper-radar run typecheck'
    })
    expect(rootPackage.scripts).not.toHaveProperty('paper-radar:start')
    expect(rootPackage.scripts).not.toHaveProperty('paper-radar-mcp:start')
    expect(rootPackage.scripts).not.toHaveProperty('paper-radar-mcp:test')
    expect(rootPackage.scripts).not.toHaveProperty('paper-radar-mcp:typecheck')
    expect(rootPackage.scripts).not.toHaveProperty('build:local-runtime')
    expect(rootPackage.scripts).not.toHaveProperty('local-runtime:test')
  })
})
