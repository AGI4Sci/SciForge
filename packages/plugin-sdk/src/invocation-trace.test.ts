import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProcessExtensionHost, type ProcessExtensionInvocationTrace } from './process-extension-host.js'

test('IPC provenance correlates dispatch and terminal settlement without invocation payloads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'invocation-provenance-'))
  const traces: ProcessExtensionInvocationTrace[] = []
  const host = new ProcessExtensionHost({ onInvocationTrace: trace => { traces.push(trace) } })
  try {
    const entryPath = join(directory, 'plugin.mjs')
    await writeFile(entryPath, `
export function getCapabilityDefinitions() { return [{ descriptor: { id: 'trace.echo', version: '1.2.3', inputSchema: {}, outputSchema: {} }, inputSchema: {}, outputSchema: {}, handler: async input => { if(input.mode === 'throw') throw Error('SECRET_FAILURE'); if(input.mode === 'wait') await new Promise(resolve => setTimeout(resolve, 200)); return { output: input }; } }] }
`)
    await host.replace({ pluginId: 'trace-plugin', packageName: '@test/trace', version: '1.2.3', entryPath, invokeTimeoutMs: 60 })
    const runtime = host.runtime('@test/trace')!
    const authority = { authority: { invocationId: 'broker-original-42', originalContext: { callId: 'runtime-call-original', requestId: 17, privateInput: 'SECRET_CONTEXT' } }, services: [] }
    await runtime.invoke('trace.echo', { secret: 'SECRET_ARGUMENT' }, undefined, undefined, undefined, undefined, authority)
    await assert.rejects(runtime.invoke('trace.echo', { mode: 'throw' }), /SECRET_FAILURE/)
    await assert.rejects(runtime.invoke('trace.echo', { mode: 'wait' }), /timed out/)
    const abort = new AbortController()
    const pending = runtime.invoke('trace.echo', { mode: 'wait' }, undefined, abort.signal)
    abort.abort()
    await assert.rejects(pending, /cancelled/)
    assert.deepEqual(traces.map(trace => trace.phase), ['dispatch', 'succeeded', 'dispatch', 'failed', 'dispatch', 'failed', 'dispatch', 'failed'])
    for (let index = 0; index < traces.length; index += 2) {
      const { phase: _start, ...start } = traces[index]!
      const { phase: _end, ...end } = traces[index + 1]!
      assert.deepEqual(start, end)
      assert.equal(start.packageName, '@test/trace')
      assert.equal(start.version, '1.2.3')
      assert.equal(start.generation, 1)
      assert.equal(start.capabilityId, 'trace.echo')
      assert.ok(start.connectionId)
      assert.ok(start.transportRequestId)
    }
    assert.equal(traces[0]!.brokerInvocationId, 'broker-original-42')
    assert.equal(traces[0]!.hostCallId, 'runtime-call-original')
    assert.equal(traces[0]!.hostRequestId, 17)
    assert.equal(traces[2]!.brokerInvocationId, undefined)
    assert.equal(traces[2]!.hostCallId, undefined)
    assert.equal(traces[2]!.hostRequestId, undefined)
    assert.equal(new Set(traces.map(trace => trace.connectionId)).size, 1)
    assert.equal(new Set(traces.map(trace => trace.transportRequestId)).size, 4)
    assert.ok(!JSON.stringify(traces).includes('SECRET_'))
  } finally {
    await host.disposeAll()
    await rm(directory, { recursive: true, force: true })
  }
})

test('a throwing provenance observer cannot affect IPC execution', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'invocation-observer-'))
  const host = new ProcessExtensionHost({ onInvocationTrace: () => { throw Error('observer failure') } })
  try {
    const entryPath = join(directory, 'plugin.mjs')
    await writeFile(entryPath, `export function getCapabilityDefinitions() { return [{ descriptor: { id: 'trace.echo', version: '1', inputSchema: {}, outputSchema: {} }, inputSchema: {}, outputSchema: {}, handler: async () => ({ output: 'executed' }) }] }`)
    await host.replace({ pluginId: 'trace', packageName: 'trace', version: '1', entryPath })
    assert.deepEqual(await host.runtime('trace')!.invoke('trace.echo', {}), { output: 'executed' })
  } finally {
    await host.disposeAll()
    await rm(directory, { recursive: true, force: true })
  }
})
