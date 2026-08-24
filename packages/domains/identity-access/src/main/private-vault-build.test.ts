import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testRoot = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(testRoot, '../../../../..')
const nativeRoot = join(testRoot, 'private-vault', 'native')
const buildScript = join(nativeRoot, 'build-addon.mjs')
const stageScript = join(nativeRoot, 'stage-addon.mjs')
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
    const [buildSource, stageSource] = await Promise.all([
      readFile(buildScript, 'utf8'),
      readFile(stageScript, 'utf8')
    ])
    for (const source of [buildSource, stageSource]) {
      expect(source).toContain("process.platform !== 'darwin'")
      expect(source).toContain("includes('--skip-unsupported')")
    }

    if (process.platform === 'darwin') return
    expect(runNodeScript(buildScript, ['--skip-unsupported']).status).toBe(0)
    expect(runNodeScript(stageScript, ['--skip-unsupported']).status).toBe(0)
    expect(runNodeScript(buildScript).status).not.toBe(0)
    expect(runNodeScript(stageScript).status).not.toBe(0)
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

    expect(runNodeScript(stageScript, ['--skip-unsupported']).status).toBe(0)
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
