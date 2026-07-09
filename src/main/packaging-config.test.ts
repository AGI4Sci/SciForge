import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

type BuilderFileSet = {
  from?: string
  to?: string
  filter?: string[]
}

type RuntimeEntry = {
  id: string
  requiredPathsExport: string
  requiredPaths: string[]
  mcpNodeEntryPaths?: string[]
}

type ReleaseWorkerManifest = {
  BUNDLED_FILE_FILTER: string[]
  PACKAGE_DEFINITIONS: Record<string, { dir: string }>
  workspacePackageDirs: string[]
  bundledPackageDirs: string[]
  nonBundledPackageDirs: string[]
  runtimeEntries: RuntimeEntry[]
  mcpNodeEntryRequiredPaths: string[]
  runtimeRequiredPathExports: Record<string, string[]>
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
const localRuntimePackage = require('../../scripts/local-runtime-package.cjs')
const macNotarize = require('../../scripts/mac-notarize.cjs')
const releaseWorkerManifest = require(
  '../../scripts/release-worker-manifest.cjs'
) as ReleaseWorkerManifest
const rootPackage = require('../../package.json') as RootPackageJson

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

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('electron-builder local runtime packaging', () => {
  it('keeps local runtime install/build decisions in one package script', () => {
    const root = tempRoot()

    expect(localRuntimePackage.hasProjectLocalRuntimeInstall(root)).toBe(false)
    for (const relativePath of localRuntimePackage.LOCAL_RUNTIME_INSTALL_REQUIRED_PATHS) {
      touch(join(root, relativePath))
    }
    expect(localRuntimePackage.hasProjectLocalRuntimeInstall(root)).toBe(true)

    const sqliteModule = join(root, 'kun/node_modules/better-sqlite3')
    touch(join(sqliteModule, 'package.json'))
    localRuntimePackage.removeProjectLocalRuntimeSqlite(root)

    expect(existsSync(sqliteModule)).toBe(false)
  })

  it('includes local runtime dependencies in the packaged app', () => {
    expect(builderConfig.files).toEqual(expect.arrayContaining([
      'kun/dist/**/*',
      'kun/package.json',
      'kun/package-lock.json',
      'kun/node_modules/**/*'
    ]))
    expect(builderConfig.asarUnpack).toEqual(expect.arrayContaining([
      '**/kun/dist/**/*',
      '**/kun/package*.json',
      '**/kun/node_modules/**/*',
      '**/node_modules/node-pty/**/*'
    ]))
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

    expect(releaseWorkerManifest.createBundledFileSets()).toEqual(
      releaseWorkerManifest.bundledPackageDirs.map((packageDir) => ({
        from: packageDir,
        to: packageDir,
        filter: releaseWorkerManifest.BUNDLED_FILE_FILTER
      }))
    )
    expect(fileSets.map((entry) => entry.from)).toEqual(releaseWorkerManifest.bundledPackageDirs)
    expect(builderConfig.asarUnpack).toEqual(expect.arrayContaining(
      releaseWorkerManifest.createAsarUnpackGlobs()
    ))

    for (const packageDir of releaseWorkerManifest.bundledPackageDirs) {
      const fileSet = fileSets.find((entry) => entry.from === packageDir)

      expect(fileSet).toMatchObject({
        from: packageDir,
        to: packageDir
      })
      expect(fileSet?.filter).toEqual(releaseWorkerManifest.BUNDLED_FILE_FILTER)
    }
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

  it('validates the unpacked local runtime before release artifacts are created', () => {
    expect(afterPack.LOCAL_RUNTIME_REQUIRED_PATHS).toEqual(
      localRuntimePackage.LOCAL_RUNTIME_REQUIRED_PATHS
    )

    const root = tempRoot()
    const context = createMacPackContext(root)
    const unpackedRoot = afterPack._internals.unpackedAppRoot(context)

    for (const relativePath of afterPack.LOCAL_RUNTIME_REQUIRED_PATHS) {
      touch(join(unpackedRoot, relativePath))
    }
    touch(join(unpackedRoot, 'node_modules/better-sqlite3/package.json'))

    expect(() => afterPack._internals.validateBundledLocalRuntime(context)).not.toThrow()

    rmSync(join(unpackedRoot, 'kun/node_modules/zod'), { recursive: true, force: true })

    expect(() => afterPack._internals.validateBundledLocalRuntime(context)).toThrow(
      /kun\/node_modules\/zod\/package\.json/
    )
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

  it('keeps Paper Radar bundled as a worker-owned core without a plug-in service dependency', () => {
    const paperRadar = releaseWorkerManifest.runtimeEntries.find((entry) => entry.id === 'paper-radar')

    expect(paperRadar?.requiredPaths).toEqual(expect.arrayContaining([
      'packages/workers/paper-radar/package.json',
      'packages/workers/paper-radar/src/mcp-server.ts',
      'packages/workers/paper-radar/src/core/service.ts',
      'packages/workers/paper-radar/src/core/storage.ts'
    ]))
    expect(releaseWorkerManifest.bundledPackageDirs).toEqual(expect.arrayContaining([
      'packages/workers/paper-radar'
    ]))
    expect(releaseWorkerManifest.bundledPackageDirs.some((dir) => dir.startsWith('plugins/'))).toBe(false)
    expect(releaseWorkerManifest.nonBundledPackageDirs).toEqual(expect.arrayContaining([
      'packages/workers/sci-modality-router',
      'packages/workers/evidence-dag',
      'packages/workers/gui-owl-computer-use'
    ]))
  })

  it('keeps Model Router release requirements independent of Sci Modality', () => {
    const modelRouter = releaseWorkerManifest.runtimeEntries.find((entry) => entry.id === 'model-router')

    expect(modelRouter?.requiredPaths).toEqual(expect.arrayContaining([
      'packages/workers/model-router/package.json',
      'packages/workers/model-router/src/cli.ts',
      'packages/workers/model-router/src/manifest.ts',
      'packages/workers/model-router/tools/model-router-trace-audit.ts'
    ]))
    expect(modelRouter?.requiredPaths).not.toEqual(expect.arrayContaining([
      'packages/workers/sci-modality-router/package.json'
    ]))
  })

  it('validates built MCP node entries before release artifacts are created', () => {
    expect(afterPack.MCP_NODE_ENTRY_REQUIRED_PATHS).toEqual(
      releaseWorkerManifest.mcpNodeEntryRequiredPaths
    )
    expect(afterPack.MCP_NODE_ENTRY_REQUIRED_PATHS).toEqual(expect.arrayContaining([
      'out/main/schedule-mcp-node-entry.js',
      'out/main/research-search-mcp-node-entry.js',
      'out/main/workflow-mcp-node-entry.js',
      'out/main/runtime-inspector-mcp-node-entry.js'
    ]))

    const root = tempRoot()
    const context = createMacPackContext(root)

    for (const relativePath of afterPack.MCP_NODE_ENTRY_REQUIRED_PATHS) {
      touch(join(root, relativePath))
    }

    expect(() => afterPack._internals.validateBuiltMcpNodeEntries(context)).not.toThrow()

    rmSync(join(root, 'out/main/research-search-mcp-node-entry.js'), { recursive: true, force: true })

    expect(() => afterPack._internals.validateBuiltMcpNodeEntries(context)).toThrow(
      /out\/main\/research-search-mcp-node-entry\.js/
    )
  })

  it('runs npm through cmd.exe during Windows afterPack hooks', () => {
    expect(afterPack._internals.npmCommand(['prune'], 'win32')).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm', 'prune']
    })
    expect(afterPack._internals.npmCommand(['prune'], 'darwin')).toEqual({
      command: 'npm',
      args: ['prune']
    })
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
      'Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node'
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
    expect(rootPackage.workspaces).toEqual(expect.arrayContaining(releaseWorkerManifest.workspacePackageDirs))
    expect(rootPackage.workspaces).toEqual(expect.arrayContaining([
      'packages/workers/model-router',
      'packages/workers/sci-modality-router',
      'packages/workers/evidence-dag',
      'packages/workers/paper-radar',
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
      'build:local-runtime': 'node ./scripts/local-runtime-package.cjs build',
      'model-router:start': 'npm --workspace @sciforge/model-router run start',
      'model-router:test': 'npm --workspace @sciforge/model-router run test',
      'paper-radar:start': 'npm --workspace @sciforge/paper-radar run start',
      'paper-radar:test': 'npm --workspace @sciforge/paper-radar run test',
      'paper-radar:typecheck': 'npm --workspace @sciforge/paper-radar run typecheck'
    })
  })
})
