import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { stageDomainMainNativeAddons } from '../../../../../scripts/domain-main-native-addons.mjs'

const testRoot = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(testRoot, '../../../../..')
const nativeRoot = join(testRoot, 'private-vault', 'native')
const buildScript = join(nativeRoot, 'build-addon.mjs')
const binaryName = 'identity_private_vault.node'
const sourceBinary = join(nativeRoot, 'build', 'Release', binaryName)
const stagedBinary = join(
  workspaceRoot,
  'out',
  'main',
  'native',
  'build',
  'Release',
  binaryName
)

describe('Identity native private-vault fresh build', () => {
  it('requires an explicit skip on unsupported platforms', async () => {
    const buildSource = await readFile(buildScript, 'utf8')
    expect(buildSource).toContain("process.platform !== 'darwin'")
    expect(buildSource).toContain("includes('--skip-unsupported')")

    if (process.platform === 'darwin') return
    expect(runNodeScript(buildScript, ['--skip-unsupported']).status).toBe(0)
    expect(runNodeScript(buildScript).status).not.toBe(0)
  })

  it('compiles, stages, loads, and completes an exact Keychain round-trip on macOS', async () => {
    if (process.platform !== 'darwin') return

    expect(runNodeScript(buildScript, ['--skip-unsupported']).status).toBe(0)
    const sourceMetadata = await stat(sourceBinary)
    expect(sourceMetadata.isFile()).toBe(true)
    expect(sourceMetadata.size).toBeGreaterThan(0)
    expect(spawnSync('lipo', [
      sourceBinary,
      '-verify_arch',
      'arm64',
      'x86_64'
    ], {
      cwd: workspaceRoot,
      stdio: ['ignore', 'pipe', 'pipe']
    }).status).toBe(0)

    await expect(stageDomainMainNativeAddons({
      repositoryRoot: workspaceRoot,
      mainOutputDirectory: join(workspaceRoot, 'out', 'main'),
      platform: process.platform
    })).resolves.toEqual([{
      packageName: '@sciforge/domain-identity-access',
      bundleRelativePath: 'native/build/Release/identity_private_vault.node'
    }])
    const [sourceDigest, stagedDigest] = await Promise.all([
      fileDigest(sourceBinary),
      fileDigest(stagedBinary)
    ])
    expect(stagedDigest).toBe(sourceDigest)

    const require = createRequire(import.meta.url)
    const binding = require(stagedBinary) as Readonly<{
      isAvailable(): boolean
      storeSecret(vaultKey: string, value: string): void
      hasSecret(vaultKey: string): boolean
      readSecret(vaultKey: string): string | null
      deleteSecret(vaultKey: string): void
    }>
    const key = randomBytes(32).toString('hex')
    const value = `identity-native-round-trip-${randomBytes(16).toString('hex')}`
    expect(binding.isAvailable()).toBe(true)
    expect(binding.hasSecret(key)).toBe(false)
    try {
      binding.storeSecret(key, value)
      expect(binding.hasSecret(key)).toBe(true)
      expect(binding.readSecret(key)).toBe(value)
    } finally {
      binding.deleteSecret(key)
    }
    expect(binding.hasSecret(key)).toBe(false)
  }, 20_000)

  it('keeps the staged main binary inside Electron Builder include and unpack rules', () => {
    const require = createRequire(import.meta.url)
    const builder = require(join(workspaceRoot, 'electron-builder.config.cjs')) as Readonly<{
      files: readonly unknown[]
      asarUnpack: readonly unknown[]
    }>

    expect(builder.files).toContain('out/**/*')
    expect(builder.asarUnpack).toContain('**/out/main/**/*')
  })

  it('uses package metadata and electron-vite as the only native-addon staging path', async () => {
    const rootPackage = JSON.parse(await readFile(
      join(workspaceRoot, 'package.json'),
      'utf8'
    )) as Readonly<{ scripts: Readonly<Record<string, string>> }>
    const identityPackage = JSON.parse(await readFile(
      join(workspaceRoot, 'packages', 'domains', 'identity-access', 'package.json'),
      'utf8'
    )) as Readonly<{ sciforgeMainNativeAddons?: unknown }>

    expect(rootPackage.scripts.build).toBe(
      'npm run build:agent-support && npm run build:domain-native-addons && electron-vite build'
    )
    expect(rootPackage.scripts['build:domain-native-addons']).toBe(
      'node ./packages/domains/identity-access/src/main/private-vault/native/build-addon.mjs --skip-unsupported'
    )
    expect(rootPackage.scripts['stage:domain-native-addons']).toBeUndefined()
    expect(rootPackage.scripts['build:domain-native-addons']).not.toContain('opencontent-connector')
    expect(rootPackage.scripts['build:opencontent-native']).toBeUndefined()
    expect(rootPackage.scripts['stage:opencontent-native']).toBeUndefined()
    expect(identityPackage.sciforgeMainNativeAddons).toEqual({
      contractVersion: 1,
      artifacts: [{
        platforms: ['darwin'],
        sourceRelativePath:
          'src/main/private-vault/native/build/Release/identity_private_vault.node',
        bundleRelativePath: 'native/build/Release/identity_private_vault.node'
      }]
    })
    await expect(stat(join(nativeRoot, 'stage-addon.mjs'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })
})

function runNodeScript(script: string, args: readonly string[] = []) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: workspaceRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

async function fileDigest(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}
