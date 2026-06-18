import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  packager: { appInfo: { productFilename: string } }
} {
  return {
    appOutDir: join(root, 'mac-arm64'),
    electronPlatformName: 'darwin',
    packager: {
      appInfo: {
        productFilename: 'DeepSeek GUI'
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
      '**/kun/node_modules/**/*'
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

  it('leaves top-level plugin services out of bundled app content', () => {
    const bundledDirectoryFileSets = (builderConfig.files as unknown[])
      .filter((entry: unknown): entry is { from?: string } => {
        return typeof entry === 'object' && entry !== null
      })
      .map((entry) => entry.from)

    expect(bundledDirectoryFileSets).not.toEqual(expect.arrayContaining([
      'plugins',
      'plugins/vision-router-service',
      'plugins/sci-modality-router-service',
      'plugins/paper-radar-service'
    ]))
    expect(builderConfig.files).not.toEqual(expect.arrayContaining([
      'plugins/**/*',
      'plugins/vision-router-service/**/*',
      'plugins/sci-modality-router-service/**/*',
      'plugins/paper-radar-service/**/*'
    ]))
    expect(builderConfig.asarUnpack).not.toEqual(expect.arrayContaining([
      '**/plugins/**/*',
      '**/plugins/vision-router-service/**/*',
      '**/plugins/sci-modality-router-service/**/*',
      '**/plugins/paper-radar-service/**/*',
      '**/packages/workers/model-router/vision-router-service/**/*'
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
      'plugins/sci-modality-router-service/package.json'
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
    const appBundle = join(root, 'DeepSeek GUI.app')
    const mainExecutable = join(appBundle, 'Contents/MacOS/DeepSeek GUI')
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
      'packages/workers/model-router',
      'plugins/paper-radar-service',
      'plugins/vision-router-service',
      'plugins/sci-modality-router-service'
    ]))
    expect(rootPackage.workspaces).not.toEqual(expect.arrayContaining([
      'packages/workers/model-router/vision-router-service'
    ]))
    expect(rootPackage.scripts).toMatchObject({
      'model-router:start': 'npm --workspace @sciforge/model-router run start',
      'model-router:test': 'npm --workspace @sciforge/model-router run test',
      'vision-router:start': 'npm --workspace sciforge-vision-router-service run start',
      'vision-router:test': 'npm --workspace sciforge-vision-router-service run test',
      'vision-router:typecheck': 'npm --workspace sciforge-vision-router-service run typecheck',
      'paper-radar:start': 'npm --workspace sciforge-paper-radar-service run start',
      'paper-radar:test': 'npm --workspace sciforge-paper-radar-service run test',
      'paper-radar:typecheck': 'npm --workspace sciforge-paper-radar-service run typecheck'
    })
  })
})
