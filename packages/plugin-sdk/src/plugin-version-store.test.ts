import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProcessExtensionHost } from './process-extension-host.js'
import { PluginUpdateCoordinator } from './plugin-update-coordinator.js'
import { PluginVersionStore } from './plugin-version-store.js'

const manifest = (version: string) => JSON.stringify({ name: '@example/versioned-plugin', version, engines: { dsh: '^1.0.0' }, exports: { '.': './dist/main.js' }, dsh: { bundle: { patch: './cordis.patch.yml' } } })

test('version store stages, verifies, and atomically activates a plugin pointer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-version-store-'))
  const source = await mkdtemp(join(tmpdir(), 'sciforge-plugin-source-'))
  try {
    await mkdir(join(source, 'dist'))
    await writeFile(join(source, 'package.json'), manifest('1.0.0'))
    await writeFile(join(source, 'cordis.patch.yml'), '[]')
    await writeFile(join(source, 'dist', 'main.js'), 'export const version = "1.0.0"\n')
    const store = new PluginVersionStore(root)
    const staged = await store.stage(source)
    assert.equal(await store.verify(staged), true)
    const active = await store.activate(staged)
    assert.equal((await store.active('@example/versioned-plugin'))?.version, '1.0.0')
    assert.equal(active.integrity.startsWith('sha256-'), true)
    assert.deepEqual(await store.versions('@example/versioned-plugin'), ['1.0.0'])
    await assert.rejects(store.removeVersion('@example/versioned-plugin', '1.0.0'))
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(source, { recursive: true, force: true })
  }
})

test('update coordinator commits pointer and runtime together after candidate activation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-version-store-'))
  const source = await mkdtemp(join(tmpdir(), 'sciforge-plugin-source-'))
  try {
    await mkdir(join(source, 'dist'))
    const store = new PluginVersionStore(root)
    const host = new ProcessExtensionHost()
    const coordinator = new PluginUpdateCoordinator(store, host)
    await writeFile(join(source, 'package.json'), manifest('1.0.0'))
    await writeFile(join(source, 'cordis.patch.yml'), '[]')
    await writeFile(join(source, 'dist', 'main.js'), `export async function activate() {}\n`)
    const first = await coordinator.stageAndActivate(source)
    assert.equal(first.active.version, '1.0.0')
    await writeFile(join(source, 'package.json'), manifest('2.0.0'))
    await writeFile(join(source, 'dist', 'main.js'), `export async function activate() {}\n`)
    const second = await coordinator.stageAndActivate(source)
    assert.equal(second.active.version, '2.0.0')
    assert.equal(second.runtime.generation, 2)
    assert.equal((await store.active('@example/versioned-plugin'))?.version, '2.0.0')
    await host.dispose('@example/versioned-plugin')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(source, { recursive: true, force: true })
  }
})

test('update coordinator carries the Host business policy into prepared generations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-version-store-policy-'))
  const source = await mkdtemp(join(tmpdir(), 'sciforge-plugin-source-policy-'))
  try {
    await mkdir(join(source, 'dist'))
    const store = new PluginVersionStore(root)
    const host = new ProcessExtensionHost({ invokeTimeoutMs: 150 })
    const coordinator = new PluginUpdateCoordinator(store, host)
    await writeFile(join(source, 'package.json'), manifest('1.0.0'))
    await writeFile(join(source, 'cordis.patch.yml'), '[]')
    await writeFile(join(source, 'dist', 'main.js'), `const slow = async () => { await new Promise(resolve => setTimeout(resolve, 400)); return 'late' }; export const invoke = slow; export const work = slow\n`)
    await coordinator.stageAndActivate(source)
    await assert.rejects(host.runtime('@example/versioned-plugin')!.managedInvoke('work'), { code: 'request_timeout' })
    await host.dispose('@example/versioned-plugin')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(source, { recursive: true, force: true })
  }
})
test('update coordinator rolls back a prepared candidate when contribution registration fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-version-rollback-'))
  const source = await mkdtemp(join(tmpdir(), 'sciforge-plugin-rollback-src-'))
  try {
    await mkdir(join(source, 'dist'))
    const store = new PluginVersionStore(root)
    const host = new ProcessExtensionHost()
    const coordinator = new PluginUpdateCoordinator(store, host)
    await writeFile(join(source, 'package.json'), manifest('1.0.0'))
    await writeFile(join(source, 'cordis.patch.yml'), '[]')
    await writeFile(join(source, 'dist', 'main.js'), 'export async function activate() {}\n')
    await coordinator.stageAndActivate(source)
    await writeFile(join(source, 'package.json'), manifest('2.0.0'))
    await writeFile(join(source, 'dist', 'main.js'), 'export async function activate() {}\n')
    await assert.rejects(
      coordinator.stageAndActivate(source, { beforeCommit: async () => { throw new Error('contribution registration failed') } }),
      /contribution registration failed/
    )
    assert.equal((await store.active('@example/versioned-plugin'))?.version, '1.0.0')
    assert.equal(host.snapshot('@example/versioned-plugin')?.version, '1.0.0')
    await host.dispose('@example/versioned-plugin')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(source, { recursive: true, force: true })
  }
})

test('update coordinator preserves the active pointer when pointer activation fails', { skip: process.platform === 'win32' ? 'chmod-based permission failures are not portable to Windows' : false }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-pointer-failure-'))
  const source = await mkdtemp(join(tmpdir(), 'sciforge-pointer-failure-src-'))
  const activeDirectory = join(root, 'active')
  let host: ProcessExtensionHost | undefined
  try {
    await mkdir(join(source, 'dist'))
    const store = new PluginVersionStore(root)
    host = new ProcessExtensionHost()
    const coordinator = new PluginUpdateCoordinator(store, host)
    await writeFile(join(source, 'package.json'), manifest('1.0.0'))
    await writeFile(join(source, 'cordis.patch.yml'), '[]')
    await writeFile(join(source, 'dist', 'main.js'), 'export async function activate() {}\n')
    await coordinator.stageAndActivate(source)
    await writeFile(join(source, 'package.json'), manifest('2.0.0'))
    await writeFile(join(source, 'dist', 'main.js'), 'export async function activate() {}\n')
    await chmod(activeDirectory, 0o500)
    await assert.rejects(coordinator.stageAndActivate(source))
    assert.equal((await store.active('@example/versioned-plugin'))?.version, '1.0.0')
    assert.equal(host.snapshot('@example/versioned-plugin')?.version, '1.0.0')
    await host.dispose('@example/versioned-plugin')
  } finally {
    await host?.dispose('@example/versioned-plugin').catch(() => undefined)
    await chmod(activeDirectory, 0o700).catch(() => undefined)
    await rm(root, { recursive: true, force: true })
    await rm(source, { recursive: true, force: true })
  }
})

test('rejects re-staging the same plugin version with different content (immutable version)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-immutable-'))
  const source = await mkdtemp(join(tmpdir(), 'sciforge-immutable-src-'))
  try {
    await mkdir(join(source, 'dist'))
    await writeFile(join(source, 'package.json'), manifest('1.0.0'))
    await writeFile(join(source, 'cordis.patch.yml'), '[]')
    await writeFile(join(source, 'dist', 'main.js'), 'export const version = "1.0.0"\n')
    const store = new PluginVersionStore(root)
    await store.stage(source)
    // different content, same package@version -> must reject, not silently reuse
    await writeFile(join(source, 'dist', 'main.js'), 'export const version = "1.0.0 CHANGED"\n')
    await assert.rejects(() => store.stage(source), { code: 'immutable_version' })
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(source, { recursive: true, force: true })
  }
})

test('rejects staging a plugin directory containing a symbolic link', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-symlink-'))
  const source = await mkdtemp(join(tmpdir(), 'sciforge-symlink-src-'))
  const target = await mkdtemp(join(tmpdir(), 'sciforge-outside-'))
  try {
    await mkdir(join(source, 'dist'))
    await writeFile(join(source, 'package.json'), manifest('1.0.0'))
    await writeFile(join(source, 'cordis.patch.yml'), '[]')
    await writeFile(join(source, 'dist', 'main.js'), 'export const version = "1.0.0"\n')
    await writeFile(join(target, 'secret.js'), 'export const secret = 1\n')
    // symlink that escapes the plugin directory
    await symlink(join(target, 'secret.js'), join(source, 'dist', 'escaped.js'))
    const store = new PluginVersionStore(root)
    await assert.rejects(() => store.stage(source), /symbolic link/i)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(source, { recursive: true, force: true })
    await rm(target, { recursive: true, force: true })
  }
})
