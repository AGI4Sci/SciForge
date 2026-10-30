import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProcessExtensionHost } from './process-extension-host.js'

test('plugin processes receive no ambient credentials or Node injection settings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-process-environment-'))
  const host = new ProcessExtensionHost()
  const keys = ['DSH_TEST_MODEL_KEY', 'NODE_OPTIONS', 'NODE_PATH', 'HTTPS_PROXY', 'HOME', 'PATH']
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  try {
    // Synthetic markers only; never read or print actual credentials.
    process.env.DSH_TEST_MODEL_KEY = 'synthetic-secret'
    process.env.NODE_OPTIONS = '--no-warnings'
    process.env.NODE_PATH = directory
    process.env.HTTPS_PROXY = 'http://127.0.0.1:1'
    process.env.HOME = directory
    process.env.PATH = directory
    const entryPath = join(directory, 'environment.mjs')
    await writeFile(entryPath, `
export function getCapabilityDefinitions() {
  return [{ descriptor: { id: 'environment.inspect' }, handler: () => ({
    leaked: ['DSH_TEST_MODEL_KEY', 'NODE_OPTIONS', 'NODE_PATH', 'HTTPS_PROXY', 'HOME', 'PATH'].filter(key => key in process.env),
    electronMode: process.env.ELECTRON_RUN_AS_NODE
  }) }]
}
`)
    await host.replace({ pluginId: 'environment', packageName: 'environment', version: '1.0.0', entryPath })
    const result = await host.runtime('environment')!.invoke('environment.inspect', {}) as { leaked: string[]; electronMode: string }
    assert.deepEqual(result, { leaked: process.platform === 'win32' ? ['PATH'] : [], electronMode: '1' })
  } finally {
    for (const key of keys) {
      if (prior[key] === undefined) delete process.env[key]
      else process.env[key] = prior[key]
    }
    await host.dispose('environment')
    await rm(directory, { recursive: true, force: true })
  }
})
