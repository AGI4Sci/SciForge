import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProcessExtensionHost, ProcessExtensionRuntime } from './process-extension-host.js'

const identity = { pluginId: 'deadline', packageName: 'deadline', version: '1', generation: 1, entryPath: '/not-started.mjs' }

for (const field of ['timeoutMs', 'invokeTimeoutMs'] as const) {
  test(`${field} rejects non-finite, nonpositive, fractional and overflowing Node timer delays`, () => {
    for (const value of [0, -1, NaN, Infinity, -Infinity, 0.5, 2_147_483_648]) {
      assert.throws(() => new ProcessExtensionRuntime({ ...identity, [field]: value }), {
        name: 'RangeError', message: `${field} must be an integer between 1 and 2147483647 milliseconds.`,
      })
      if (field === 'invokeTimeoutMs') assert.throws(() => new ProcessExtensionHost({ invokeTimeoutMs: value }), {
        name: 'RangeError', message: `${field} must be an integer between 1 and 2147483647 milliseconds.`,
      })
    }
    for (const value of [1, 5000, 2_147_483_647]) {
      assert.doesNotThrow(() => new ProcessExtensionRuntime({ ...identity, [field]: value }))
    }
  })
}

async function fixture(source: string, options: { hostInvokeTimeoutMs?: number; runtimeInvokeTimeoutMs?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'sdk-deadline-'))
  const entryPath = join(root, 'entry.mjs')
  const host = new ProcessExtensionHost(options.hostInvokeTimeoutMs === undefined ? {} : { invokeTimeoutMs: options.hostInvokeTimeoutMs })
  await writeFile(entryPath, source)
  try {
    await host.replace({ ...identity, entryPath, timeoutMs: 1000, ...(options.runtimeInvokeTimeoutMs === undefined ? {} : { invokeTimeoutMs: options.runtimeInvokeTimeoutMs }) })
    const runtime = host.runtime('deadline')!
    const pid = runtime.snapshot.pid!
    return { runtime, async close() {
      await host.disposeAll()
      for (let i = 0; i < 100; i++) {
        try { process.kill(pid, 0) } catch { break }
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      assert.throws(() => process.kill(pid, 0), 'real child must exit')
      await rm(root, { recursive: true, force: true })
    } }
  } catch (error) {
    await host.disposeAll()
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

test('managed and workflow business invocations use the Host policy while discovery keeps lifecycle deadline', async () => {
  const f = await fixture(`
    async function slow() { await new Promise(resolve => setTimeout(resolve, 1200)); return 'business-result' }
    export const invoke = slow
    export const work = slow
    export const discover = slow
    export const getRendererContributions = slow
  `, { hostInvokeTimeoutMs: 2000 })
  try {
    assert.equal(await f.runtime.managedInvoke('work'), 'business-result')
    assert.equal(await f.runtime.workflowInvoke('work'), 'business-result')
    await assert.rejects(f.runtime.managedDiscover(), { code: 'request_timeout' })
    await assert.rejects(f.runtime.rendererContributions(), { code: 'request_timeout' })
  } finally { await f.close() }
})

test('Host business cap cannot be expanded by a longer runtime request', async () => {
  const f = await fixture(`const slow = async () => { await new Promise(resolve => setTimeout(resolve, 400)); return 'business-result' }; export const invoke = slow; export const work = slow`, { hostInvokeTimeoutMs: 250, runtimeInvokeTimeoutMs: 1500 })
  try { await assert.rejects(f.runtime.managedInvoke('work'), { code: 'request_timeout' }) } finally { await f.close() }
})

test('without a Host cap, a finite runtime business budget is inherited', async () => {
  const f = await fixture(`const slow = async () => { await new Promise(resolve => setTimeout(resolve, 400)); return 'business-result' }; export const invoke = slow; export const work = slow`, { runtimeInvokeTimeoutMs: 1500 })
  try { assert.equal(await f.runtime.managedInvoke('work'), 'business-result') } finally { await f.close() }
})

test('a shorter runtime business budget remains effective under a longer Host cap', async () => {
  const f = await fixture(`const slow = async () => { await new Promise(resolve => setTimeout(resolve, 400)); return 'business-result' }; export const invoke = slow; export const work = slow`, { hostInvokeTimeoutMs: 1500, runtimeInvokeTimeoutMs: 250 })
  try { await assert.rejects(f.runtime.managedInvoke('work'), { code: 'request_timeout' }) } finally { await f.close() }
})
