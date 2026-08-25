import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testRoot = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(testRoot, '../../../../../..')
const nativeRoot = join(testRoot, 'native')
const buildScript = join(nativeRoot, 'build-addon.mjs')
const stageScript = join(nativeRoot, 'stage-addon.mjs')
const binaryName = 'opencontent_native_enrollment.node'
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

describe('OpenContent native fresh-build wiring', () => {
  it('keeps compile before electron-vite and stage after it with explicit non-macOS skip', async () => {
    const packageJson = JSON.parse(
      await readFile(join(workspaceRoot, 'package.json'), 'utf8')
    ) as Readonly<{ scripts?: Readonly<Record<string, string>> }>
    const scripts = packageJson.scripts ?? {}

    expect(scripts['build:opencontent-native']).toBe(
      'node ./packages/domains/opencontent-connector/src/main/native-enrollment/native/build-addon.mjs --skip-unsupported'
    )
    expect(scripts['stage:opencontent-native']).toBe(
      'node ./packages/domains/opencontent-connector/src/main/native-enrollment/native/stage-addon.mjs --skip-unsupported'
    )
    expect(scripts.build).toBe(
      'npm run build:agent-support && npm run build:opencontent-native && electron-vite build && npm run stage:opencontent-native'
    )

    const [buildSource, stageSource] = await Promise.all([
      readFile(buildScript, 'utf8'),
      readFile(stageScript, 'utf8')
    ])
    for (const source of [buildSource, stageSource]) {
      expect(source).toContain("process.platform !== 'darwin'")
      expect(source).toContain("includes('--skip-unsupported')")
    }
  })

  it('compiles and stages one universal addon on macOS, or no-ops only with the skip flag', async () => {
    if (process.platform !== 'darwin') {
      expect(runNodeScript(buildScript, ['--skip-unsupported']).status).toBe(0)
      expect(runNodeScript(stageScript, ['--skip-unsupported']).status).toBe(0)
      expect(runNodeScript(buildScript).status).not.toBe(0)
      expect(runNodeScript(stageScript).status).not.toBe(0)
      return
    }

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
      hasSecret(vaultKey: string): boolean
    }>
    expect(binding.isAvailable()).toBe(true)
    expect(binding.hasSecret('0'.repeat(64))).toBe(false)
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
