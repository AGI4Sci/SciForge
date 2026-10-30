import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as sdk from './process-extension-host.js'

function barrier() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

async function bounded(promise: Promise<unknown>, message: string, ms = 1000) {
  let timer: ReturnType<typeof setTimeout>
  try {
    await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms) })])
  } finally { clearTimeout(timer!) }
}

async function fixture(providers: sdk.HostServiceProviderRegistry) {
  const directory = await mkdtemp(join(tmpdir(), 'sdk-cancel-quiescence-'))
  const entryPath = join(directory, 'entry.mjs')
  const host = new sdk.ProcessExtensionHost({ hostServices: providers })
  await writeFile(entryPath, `export function getCapabilityDefinitions() { return [{
    descriptor: { id: 'fixture.reader' }, handler: async () => {
      return await globalThis.__sciforgeHostServices.request('reader', 'read', {}).result
    }
  }] }`)
  await host.replace({ pluginId: 'fixture-id', packageName: 'fixture-package', version: '1', entryPath })
  const pid = host.snapshot('fixture-package')?.pid
  return { host, runtime: host.runtime('fixture-package')!, pid, async close() {
    await host.disposeAll()
    if (pid) {
      await bounded((async () => {
        while (true) {
          try { process.kill(pid, 0) } catch { return }
          await new Promise(resolve => setTimeout(resolve, 10))
        }
      })(), 'reader child did not exit')
    }
    await rm(directory, { recursive: true, force: true })
  } }
}

test('outer SDK cancellation waits for a held cross-process reader/provider to settle', async () => {
  const entered = barrier(), aborted = barrier(), release = barrier()
  let providerSettled = false
  const providers = new sdk.HostServiceProviderRegistry({ reader: {
    authorize: () => {},
    operations: { read: async (request) => {
      entered.release()
      request.signal.addEventListener('abort', aborted.release, { once: true })
      await release.promise // The producer is deliberately noncooperative.
      providerSettled = true
      return 'reader-result'
    } },
  } })
  const f = await fixture(providers)
  const controller = new AbortController()
  const call = f.runtime.invoke('fixture.reader', {}, undefined, controller.signal, undefined, undefined,
    { authority: { workspace: 'host-owned' }, services: ['reader'] })
  let outerSettled = false
  void call.then(() => { outerSettled = true }, () => { outerSettled = true })
  try {
    await bounded(entered.promise, 'reader provider did not enter')
    controller.abort()
    await bounded(aborted.promise, 'reader provider did not observe cancellation')
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(outerSettled, false, 'outer SDK cancellation must not return before provider settlement')
    assert.equal(providerSettled, false)
    release.release()
    await assert.rejects(call, { code: 'request_cancelled' })
    assert.equal(providerSettled, true, 'outer rejection must follow real provider settlement')
  } finally {
    release.release()
    await Promise.allSettled([call])
    await f.close()
  }
})
