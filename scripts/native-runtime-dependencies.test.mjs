import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const {
  canvasPackagesForTarget,
  packagedNativeBindingRelativePaths
} = require('./native-runtime-dependencies.cjs')
const { _internals: afterPackInternals } = require('./after-pack.cjs')

test('selects Canvas native packages from the packaging target', () => {
  assert.deepEqual(canvasPackagesForTarget('win32', 1), [
    '@napi-rs/canvas-win32-x64-msvc'
  ])
  assert.deepEqual(canvasPackagesForTarget('darwin', 'universal'), [
    '@napi-rs/canvas-darwin-arm64',
    '@napi-rs/canvas-darwin-x64'
  ])
  assert.deepEqual(canvasPackagesForTarget('linux', 'x64'), [
    '@napi-rs/canvas-linux-x64-gnu'
  ])
})

test('rejects targets without a supported native runtime contract', () => {
  assert.throws(
    () => canvasPackagesForTarget('win32', 'ia32'),
    /Unsupported packaging target: win32\/ia32/
  )
})

test('describes the binding paths that after-pack validation must find', () => {
  assert.deepEqual(packagedNativeBindingRelativePaths('win', 'x64'), [
    'node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node'
  ])
})

test('packaged output retains only the target Canvas binding', () => {
  const root = mkdtempSync(join(tmpdir(), 'sciforge-after-pack-test-'))
  const appOutDir = join(root, 'app-out')
  const nativeModules = join(
    appOutDir,
    'resources',
    'app.asar.unpacked',
    'node_modules',
    '@napi-rs'
  )
  const winPackage = join(nativeModules, 'canvas-win32-x64-msvc')
  const macPackage = join(nativeModules, 'canvas-darwin-arm64')
  try {
    mkdirSync(winPackage, { recursive: true })
    mkdirSync(macPackage, { recursive: true })
    writeFileSync(join(winPackage, 'skia.win32-x64-msvc.node'), '')
    writeFileSync(join(macPackage, 'skia.darwin-arm64.node'), '')
    const context = {
      appOutDir,
      arch: 'x64',
      electronPlatformName: 'win32',
      packager: { appInfo: { productFilename: 'SciForge' } }
    }

    afterPackInternals.pruneUnrelatedNativeRuntimeDependencies(context)
    afterPackInternals.validateNativeRuntimeDependencies(context)

    assert.equal(existsSync(winPackage), true)
    assert.equal(existsSync(macPackage), false)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})
