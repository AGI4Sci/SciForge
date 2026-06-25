import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const builderConfig = require('../../electron-builder.config.cjs')
const afterPack = require('../../scripts/after-pack.cjs')
const macNotarize = require('../../scripts/mac-notarize.cjs')
const rootPackage = require('../../package.json')

const tempRoots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'ds-gui-packaging-'))
  tempRoots.push(root)
  return root
}

function touch(path: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, '{}\n', 'utf8')
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

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('electron-builder Kun packaging', () => {
  it('includes Kun runtime dependencies in the packaged app', () => {
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

  it('includes the full Model Router worker tree in unpacked packaged app files', () => {
    const modelRouterFileSet = builderConfig.files.find((entry: unknown) => {
      return (
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { from?: string }).from === 'packages/workers/model-router'
      )
    }) as { from?: string; to?: string; filter?: string[] } | undefined

    expect(modelRouterFileSet).toMatchObject({
      from: 'packages/workers/model-router',
      to: 'packages/workers/model-router'
    })
    expect(modelRouterFileSet?.filter).toEqual(expect.arrayContaining([
      '**/*',
      '**/.*'
    ]))
    expect(builderConfig.asarUnpack).toEqual(expect.arrayContaining([
      '**/packages/workers/model-router/**/*'
    ]))
  })

  it('includes the full Computer Use worker tree in unpacked packaged app files', () => {
    const computerUseFileSet = builderConfig.files.find((entry: unknown) => {
      return (
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { from?: string }).from === 'packages/workers/computer-use'
      )
    }) as { from?: string; to?: string; filter?: string[] } | undefined

    expect(computerUseFileSet).toMatchObject({
      from: 'packages/workers/computer-use',
      to: 'packages/workers/computer-use'
    })
    expect(computerUseFileSet?.filter).toEqual(expect.arrayContaining([
      '**/*',
      '**/.*'
    ]))
    expect(builderConfig.asarUnpack).toEqual(expect.arrayContaining([
      '**/packages/workers/computer-use/**/*'
    ]))
  })

  it('includes the full Search worker tree in unpacked packaged app files', () => {
    const searchFileSet = builderConfig.files.find((entry: unknown) => {
      return (
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { from?: string }).from === 'packages/workers/search'
      )
    }) as { from?: string; to?: string; filter?: string[] } | undefined

    expect(searchFileSet).toMatchObject({
      from: 'packages/workers/search',
      to: 'packages/workers/search'
    })
    expect(searchFileSet?.filter).toEqual(expect.arrayContaining([
      '**/*',
      '**/.*'
    ]))
    expect(builderConfig.asarUnpack).toEqual(expect.arrayContaining([
      '**/packages/workers/search/**/*'
    ]))
  })

  it('includes the full Schedule worker tree in unpacked packaged app files', () => {
    const scheduleFileSet = builderConfig.files.find((entry: unknown) => {
      return (
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { from?: string }).from === 'packages/workers/schedule'
      )
    }) as { from?: string; to?: string; filter?: string[] } | undefined

    expect(scheduleFileSet).toMatchObject({
      from: 'packages/workers/schedule',
      to: 'packages/workers/schedule'
    })
    expect(scheduleFileSet?.filter).toEqual(expect.arrayContaining([
      '**/*',
      '**/.*'
    ]))
    expect(builderConfig.asarUnpack).toEqual(expect.arrayContaining([
      '**/packages/workers/schedule/**/*'
    ]))
  })

  it('includes the full Workflow worker tree in unpacked packaged app files', () => {
    const workflowFileSet = builderConfig.files.find((entry: unknown) => {
      return (
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { from?: string }).from === 'packages/workers/workflow'
      )
    }) as { from?: string; to?: string; filter?: string[] } | undefined

    expect(workflowFileSet).toMatchObject({
      from: 'packages/workers/workflow',
      to: 'packages/workers/workflow'
    })
    expect(workflowFileSet?.filter).toEqual(expect.arrayContaining([
      '**/*',
      '**/.*'
    ]))
    expect(builderConfig.asarUnpack).toEqual(expect.arrayContaining([
      '**/packages/workers/workflow/**/*'
    ]))
  })

  it('includes the full Workspace Intel worker tree in unpacked packaged app files', () => {
    const workspaceIntelFileSet = builderConfig.files.find((entry: unknown) => {
      return (
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { from?: string }).from === 'packages/workers/workspace-intel'
      )
    }) as { from?: string; to?: string; filter?: string[] } | undefined

    expect(workspaceIntelFileSet).toMatchObject({
      from: 'packages/workers/workspace-intel',
      to: 'packages/workers/workspace-intel'
    })
    expect(workspaceIntelFileSet?.filter).toEqual(expect.arrayContaining([
      '**/*',
      '**/.*'
    ]))
    expect(builderConfig.asarUnpack).toEqual(expect.arrayContaining([
      '**/packages/workers/workspace-intel/**/*'
    ]))
  })

  it('includes the full Write Assist worker tree in unpacked packaged app files', () => {
    const writeAssistFileSet = builderConfig.files.find((entry: unknown) => {
      return (
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { from?: string }).from === 'packages/workers/write-assist'
      )
    }) as { from?: string; to?: string; filter?: string[] } | undefined

    expect(writeAssistFileSet).toMatchObject({
      from: 'packages/workers/write-assist',
      to: 'packages/workers/write-assist'
    })
    expect(writeAssistFileSet?.filter).toEqual(expect.arrayContaining([
      '**/*',
      '**/.*'
    ]))
    expect(builderConfig.asarUnpack).toEqual(expect.arrayContaining([
      '**/packages/workers/write-assist/**/*'
    ]))
  })

  it('includes the full Paper Radar worker and service dependency trees in unpacked packaged app files', () => {
    const paperRadarFileSet = builderConfig.files.find((entry: unknown) => {
      return (
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { from?: string }).from === 'packages/workers/paper-radar'
      )
    }) as { from?: string; to?: string; filter?: string[] } | undefined
    const paperRadarServiceFileSet = builderConfig.files.find((entry: unknown) => {
      return (
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { from?: string }).from === 'plugins/paper-radar-service'
      )
    }) as { from?: string; to?: string; filter?: string[] } | undefined

    expect(paperRadarFileSet).toMatchObject({
      from: 'packages/workers/paper-radar',
      to: 'packages/workers/paper-radar'
    })
    expect(paperRadarServiceFileSet).toMatchObject({
      from: 'plugins/paper-radar-service',
      to: 'plugins/paper-radar-service'
    })
    expect(builderConfig.asarUnpack).toEqual(expect.arrayContaining([
      '**/packages/workers/paper-radar/**/*',
      '**/plugins/paper-radar-service/**/*'
    ]))
  })

  it('includes the full Runtime Inspector worker tree in unpacked packaged app files', () => {
    const runtimeInspectorFileSet = builderConfig.files.find((entry: unknown) => {
      return (
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { from?: string }).from === 'packages/workers/runtime-inspector'
      )
    }) as { from?: string; to?: string; filter?: string[] } | undefined

    expect(runtimeInspectorFileSet).toMatchObject({
      from: 'packages/workers/runtime-inspector',
      to: 'packages/workers/runtime-inspector'
    })
    expect(runtimeInspectorFileSet?.filter).toEqual(expect.arrayContaining([
      '**/*',
      '**/.*'
    ]))
    expect(builderConfig.asarUnpack).toEqual(expect.arrayContaining([
      '**/packages/workers/runtime-inspector/**/*'
    ]))
  })

  it('leaves top-level plugin services out of bundled app content', () => {
    const bundledDirectoryFileSets = (builderConfig.files as unknown[])
      .filter((entry: unknown): entry is { from?: string } => {
        return typeof entry === 'object' && entry !== null
      })
      .map((entry) => entry.from)

    expect(bundledDirectoryFileSets).not.toEqual(expect.arrayContaining([
      'plugins',
      'plugins/vision-router-service',
      'packages/workers/sci-modality-router'
    ]))
    expect(builderConfig.files).not.toEqual(expect.arrayContaining([
      'plugins/**/*',
      'plugins/vision-router-service/**/*',
      'packages/workers/sci-modality-router/**/*'
    ]))
    expect(builderConfig.asarUnpack).not.toEqual(expect.arrayContaining([
      '**/plugins/**/*',
      '**/plugins/vision-router-service/**/*',
      '**/packages/workers/sci-modality-router/**/*',
      '**/packages/workers/model-router/vision-router-service/**/*'
    ]))
    expect(bundledDirectoryFileSets).toEqual(expect.arrayContaining([
      'plugins/paper-radar-service'
    ]))
  })

  it('validates the unpacked Kun runtime before release artifacts are created', () => {
    const root = tempRoot()
    const context = createMacPackContext(root)
    const unpackedRoot = afterPack._internals.unpackedAppRoot(context)

    for (const relativePath of afterPack.KUN_RUNTIME_REQUIRED_PATHS) {
      touch(join(unpackedRoot, relativePath))
    }
    touch(join(unpackedRoot, 'node_modules/better-sqlite3/package.json'))

    expect(() => afterPack._internals.validateBundledKunRuntime(context)).not.toThrow()

    rmSync(join(unpackedRoot, 'kun/node_modules/zod'), { recursive: true, force: true })

    expect(() => afterPack._internals.validateBundledKunRuntime(context)).toThrow(
      /kun\/node_modules\/zod\/package\.json/
    )
  })

  it('validates the unpacked Model Router worker before release artifacts are created', () => {
    expect(afterPack.MODEL_ROUTER_RUNTIME_REQUIRED_PATHS).toEqual(expect.arrayContaining([
      'packages/workers/model-router/package.json',
      'packages/workers/model-router/src/cli.ts',
      'packages/workers/model-router/src/manifest.ts',
      'packages/workers/model-router/tools/model-router-trace-audit.ts'
    ]))
    expect(afterPack.MODEL_ROUTER_RUNTIME_REQUIRED_PATHS).not.toEqual(expect.arrayContaining([
      'packages/workers/model-router/vision-router-service/package.json',
      'packages/workers/model-router/vision-router-service/src/index.ts',
      'plugins/vision-router-service/package.json',
      'packages/workers/sci-modality-router/package.json'
    ]))

    const root = tempRoot()
    const context = createMacPackContext(root)
    const unpackedRoot = afterPack._internals.unpackedAppRoot(context)

    for (const relativePath of afterPack.MODEL_ROUTER_RUNTIME_REQUIRED_PATHS) {
      touch(join(unpackedRoot, relativePath))
    }

    expect(() => afterPack._internals.validateBundledModelRouterRuntime(context)).not.toThrow()

    rmSync(
      join(unpackedRoot, 'packages/workers/model-router/src/manifest.ts'),
      { recursive: true, force: true }
    )

    expect(() => afterPack._internals.validateBundledModelRouterRuntime(context)).toThrow(
      /packages\/workers\/model-router\/src\/manifest\.ts/
    )
  })

  it('validates the unpacked Computer Use worker before release artifacts are created', () => {
    expect(afterPack.COMPUTER_USE_RUNTIME_REQUIRED_PATHS).toEqual(expect.arrayContaining([
      'packages/workers/computer-use/package.json',
      'packages/workers/computer-use/src/mcp-server.ts',
      'packages/workers/computer-use/src/service.ts',
      'packages/workers/computer-use/src/contract.ts'
    ]))

    const root = tempRoot()
    const context = createMacPackContext(root)
    const unpackedRoot = afterPack._internals.unpackedAppRoot(context)

    for (const relativePath of afterPack.COMPUTER_USE_RUNTIME_REQUIRED_PATHS) {
      touch(join(unpackedRoot, relativePath))
    }

    expect(() => afterPack._internals.validateBundledComputerUseRuntime(context)).not.toThrow()

    rmSync(
      join(unpackedRoot, 'packages/workers/computer-use/src/mcp-server.ts'),
      { recursive: true, force: true }
    )

    expect(() => afterPack._internals.validateBundledComputerUseRuntime(context)).toThrow(
      /packages\/workers\/computer-use\/src\/mcp-server\.ts/
    )
  })

  it('validates the unpacked Search worker before release artifacts are created', () => {
    expect(afterPack.SEARCH_RUNTIME_REQUIRED_PATHS).toEqual(expect.arrayContaining([
      'packages/workers/search/package.json',
      'packages/workers/search/src/mcp-server.ts',
      'packages/workers/search/src/research-service.ts',
      'packages/workers/search/src/types.ts'
    ]))

    const root = tempRoot()
    const context = createMacPackContext(root)
    const unpackedRoot = afterPack._internals.unpackedAppRoot(context)

    for (const relativePath of afterPack.SEARCH_RUNTIME_REQUIRED_PATHS) {
      touch(join(unpackedRoot, relativePath))
    }

    expect(() => afterPack._internals.validateBundledSearchRuntime(context)).not.toThrow()

    rmSync(
      join(unpackedRoot, 'packages/workers/search/src/mcp-server.ts'),
      { recursive: true, force: true }
    )

    expect(() => afterPack._internals.validateBundledSearchRuntime(context)).toThrow(
      /packages\/workers\/search\/src\/mcp-server\.ts/
    )
  })

  it('validates the unpacked Schedule worker before release artifacts are created', () => {
    expect(afterPack.SCHEDULE_RUNTIME_REQUIRED_PATHS).toEqual(expect.arrayContaining([
      'packages/workers/schedule/package.json',
      'packages/workers/schedule/src/mcp-server.ts',
      'packages/workers/schedule/src/service.ts',
      'packages/workers/schedule/src/contract.ts'
    ]))

    const root = tempRoot()
    const context = createMacPackContext(root)
    const unpackedRoot = afterPack._internals.unpackedAppRoot(context)

    for (const relativePath of afterPack.SCHEDULE_RUNTIME_REQUIRED_PATHS) {
      touch(join(unpackedRoot, relativePath))
    }

    expect(() => afterPack._internals.validateBundledScheduleRuntime(context)).not.toThrow()

    rmSync(
      join(unpackedRoot, 'packages/workers/schedule/src/mcp-server.ts'),
      { recursive: true, force: true }
    )

    expect(() => afterPack._internals.validateBundledScheduleRuntime(context)).toThrow(
      /packages\/workers\/schedule\/src\/mcp-server\.ts/
    )
  })

  it('validates the unpacked Workflow worker before release artifacts are created', () => {
    expect(afterPack.WORKFLOW_RUNTIME_REQUIRED_PATHS).toEqual(expect.arrayContaining([
      'packages/workers/workflow/package.json',
      'packages/workers/workflow/src/mcp-server.ts',
      'packages/workers/workflow/src/service.ts',
      'packages/workers/workflow/src/contract.ts'
    ]))

    const root = tempRoot()
    const context = createMacPackContext(root)
    const unpackedRoot = afterPack._internals.unpackedAppRoot(context)

    for (const relativePath of afterPack.WORKFLOW_RUNTIME_REQUIRED_PATHS) {
      touch(join(unpackedRoot, relativePath))
    }

    expect(() => afterPack._internals.validateBundledWorkflowRuntime(context)).not.toThrow()

    rmSync(
      join(unpackedRoot, 'packages/workers/workflow/src/mcp-server.ts'),
      { recursive: true, force: true }
    )

    expect(() => afterPack._internals.validateBundledWorkflowRuntime(context)).toThrow(
      /packages\/workers\/workflow\/src\/mcp-server\.ts/
    )
  })

  it('validates the unpacked Workspace Intel worker before release artifacts are created', () => {
    expect(afterPack.WORKSPACE_INTEL_RUNTIME_REQUIRED_PATHS).toEqual(expect.arrayContaining([
      'packages/workers/workspace-intel/package.json',
      'packages/workers/workspace-intel/src/mcp-server.ts',
      'packages/workers/workspace-intel/src/service.ts',
      'packages/workers/workspace-intel/src/contract.ts'
    ]))

    const root = tempRoot()
    const context = createMacPackContext(root)
    const unpackedRoot = afterPack._internals.unpackedAppRoot(context)

    for (const relativePath of afterPack.WORKSPACE_INTEL_RUNTIME_REQUIRED_PATHS) {
      touch(join(unpackedRoot, relativePath))
    }

    expect(() => afterPack._internals.validateBundledWorkspaceIntelRuntime(context)).not.toThrow()

    rmSync(
      join(unpackedRoot, 'packages/workers/workspace-intel/src/mcp-server.ts'),
      { recursive: true, force: true }
    )

    expect(() => afterPack._internals.validateBundledWorkspaceIntelRuntime(context)).toThrow(
      /packages\/workers\/workspace-intel\/src\/mcp-server\.ts/
    )
  })

  it('validates the unpacked Write Assist worker before release artifacts are created', () => {
    expect(afterPack.WRITE_ASSIST_RUNTIME_REQUIRED_PATHS).toEqual(expect.arrayContaining([
      'packages/workers/write-assist/package.json',
      'packages/workers/write-assist/src/mcp-server.ts',
      'packages/workers/write-assist/src/service.ts',
      'packages/workers/write-assist/src/contract.ts'
    ]))

    const root = tempRoot()
    const context = createMacPackContext(root)
    const unpackedRoot = afterPack._internals.unpackedAppRoot(context)

    for (const relativePath of afterPack.WRITE_ASSIST_RUNTIME_REQUIRED_PATHS) {
      touch(join(unpackedRoot, relativePath))
    }

    expect(() => afterPack._internals.validateBundledWriteAssistRuntime(context)).not.toThrow()

    rmSync(
      join(unpackedRoot, 'packages/workers/write-assist/src/mcp-server.ts'),
      { recursive: true, force: true }
    )

    expect(() => afterPack._internals.validateBundledWriteAssistRuntime(context)).toThrow(
      /packages\/workers\/write-assist\/src\/mcp-server\.ts/
    )
  })

  it('validates the unpacked Paper Radar worker and service dependency before release artifacts are created', () => {
    expect(afterPack.PAPER_RADAR_RUNTIME_REQUIRED_PATHS).toEqual(expect.arrayContaining([
      'packages/workers/paper-radar/package.json',
      'packages/workers/paper-radar/src/mcp-server.ts',
      'packages/workers/paper-radar/src/service.ts',
      'packages/workers/paper-radar/src/contract.ts',
      'plugins/paper-radar-service/package.json',
      'plugins/paper-radar-service/src/storage.ts'
    ]))

    const root = tempRoot()
    const context = createMacPackContext(root)
    const unpackedRoot = afterPack._internals.unpackedAppRoot(context)

    for (const relativePath of afterPack.PAPER_RADAR_RUNTIME_REQUIRED_PATHS) {
      touch(join(unpackedRoot, relativePath))
    }

    expect(() => afterPack._internals.validateBundledPaperRadarRuntime(context)).not.toThrow()

    rmSync(
      join(unpackedRoot, 'plugins/paper-radar-service/src/storage.ts'),
      { recursive: true, force: true }
    )

    expect(() => afterPack._internals.validateBundledPaperRadarRuntime(context)).toThrow(
      /plugins\/paper-radar-service\/src\/storage\.ts/
    )
  })

  it('validates the unpacked Runtime Inspector worker before release artifacts are created', () => {
    expect(afterPack.RUNTIME_INSPECTOR_RUNTIME_REQUIRED_PATHS).toEqual(expect.arrayContaining([
      'packages/workers/runtime-inspector/package.json',
      'packages/workers/runtime-inspector/src/mcp-server.ts',
      'packages/workers/runtime-inspector/src/service.ts',
      'packages/workers/runtime-inspector/src/contract.ts'
    ]))

    const root = tempRoot()
    const context = createMacPackContext(root)
    const unpackedRoot = afterPack._internals.unpackedAppRoot(context)

    for (const relativePath of afterPack.RUNTIME_INSPECTOR_RUNTIME_REQUIRED_PATHS) {
      touch(join(unpackedRoot, relativePath))
    }

    expect(() => afterPack._internals.validateBundledRuntimeInspectorRuntime(context)).not.toThrow()

    rmSync(
      join(unpackedRoot, 'packages/workers/runtime-inspector/src/mcp-server.ts'),
      { recursive: true, force: true }
    )

    expect(() => afterPack._internals.validateBundledRuntimeInspectorRuntime(context)).toThrow(
      /packages\/workers\/runtime-inspector\/src\/mcp-server\.ts/
    )
  })

  it('validates built MCP node entries before release artifacts are created', () => {
    expect(afterPack.MCP_NODE_ENTRY_REQUIRED_PATHS).toEqual(expect.arrayContaining([
      'out/main/schedule-mcp-node-entry.js',
      'out/main/computer-use-mcp-node-entry.js',
      'out/main/research-search-mcp-node-entry.js',
      'out/main/workflow-mcp-node-entry.js',
      'out/main/workspace-intel-mcp-node-entry.js',
      'out/main/write-assist-mcp-node-entry.js',
      'out/main/paper-radar-mcp-node-entry.js',
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
  it('exposes bundled workers and external plugin services through npm workspaces', () => {
    expect(rootPackage.workspaces).toEqual(expect.arrayContaining([
      'packages/workers/computer-use',
      'packages/workers/model-router',
      'plugins/vision-router-service',
      'packages/workers/sci-modality-router'
    ]))
    expect(rootPackage.workspaces).not.toEqual(expect.arrayContaining([
      'packages/workers/model-router/vision-router-service'
    ]))
    expect(rootPackage.scripts).toMatchObject({
      'computer-use:start': 'npm --workspace @sciforge/computer-use run start',
      'computer-use:test': 'npm --workspace @sciforge/computer-use run test',
      'computer-use:typecheck': 'npm --workspace @sciforge/computer-use run typecheck',
      'model-router:start': 'npm --workspace @sciforge/model-router run start',
      'model-router:test': 'npm --workspace @sciforge/model-router run test',
      'vision-router:start': 'npm --workspace sciforge-vision-router-service run start',
      'vision-router:test': 'npm --workspace sciforge-vision-router-service run test',
      'vision-router:typecheck': 'npm --workspace sciforge-vision-router-service run typecheck'
    })
  })
})
