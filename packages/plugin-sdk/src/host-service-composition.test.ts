import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as sdk from './process-extension-host.js'

function barrier() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

async function bounded(promise: Promise<unknown>, message: string) {
  let timer: ReturnType<typeof setTimeout>
  try {
    await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 1000) })])
  } finally { clearTimeout(timer!) }
}

test('provider disposal retries falsy failures and fences successful callbacks', async () => {
  let attempts = 0
  const registry = new (sdk as any).HostServiceProviderRegistry({ worker: {
    authorize: () => {},
    dispose: () => { if (++attempts === 1) throw undefined },
    operations: {},
  } })
  const owner = { connectionId: 'c', pluginId: 'p', packageName: 'pkg', version: '1', generation: 1, invocationId: 'i', authority: {} }
  await assert.rejects(registry.dispose(owner))
  await registry.dispose(owner)
  await registry.dispose(owner)
  assert.equal(attempts, 2)
})
test('concurrent invocations overlap without crossing Host authority scopes', async () => {
  const bothEntered = barrier()
  const release = barrier()
  const requests: any[] = []
  const providers = new (sdk as any).HostServiceProviderRegistry({ echo: {
    authorize: () => {}, operations: { read: async (request: any) => {
      requests.push(request)
      if (requests.length === 2) bothEntered.release()
      await release.promise
      return { workspace: request.owner.authority.workspace, invocationId: request.owner.invocationId }
    } },
  } })
  const f = await fixture(`
    await new Promise(resolve => setTimeout(resolve, input.delay))
    return await globalThis.__sciforgeHostServices.request('echo', 'read', input).result
  `, providers)
  const calls = ['a', 'b'].map((workspace, i) => (f.runtime.invoke as any)('fixture.service', { workspaceRoot: 'forged', delay: i * 10 }, undefined, undefined, undefined, undefined,
    { authority: { workspace }, services: ['echo'] }))
  try {
    await bounded(bothEntered.promise, 'both invocations must enter before either provider is released')
    assert.equal(requests.length, 2)
    release.release()
    const results = await Promise.all(calls)
    assert.deepEqual(results.map((result) => result.workspace), ['a', 'b'])
    assert.notEqual(results[0].invocationId, results[1].invocationId)
    assert.equal(requests[0].owner.connectionId, requests[1].owner.connectionId)
  } finally {
    release.release()
    await Promise.allSettled(calls)
    await f.close()
  }
})

test('cancellation ACK and quiescence wait for actual provider settlement, including repeated cancel', async () => {
  const entered = barrier(), aborted = barrier(), release = barrier()
  let providerRequest: sdk.HostServiceRequest | undefined
  const providers = new sdk.HostServiceProviderRegistry({ slow: {
    authorize: () => {}, operations: { read: async (request) => {
      providerRequest = request
      entered.release()
      request.signal.addEventListener('abort', aborted.release, { once: true })
      await release.promise // Deliberately noncooperative provider.
      return 'completed'
    } },
  } })
  const f = await fixture(`
    const handle = globalThis.__sciforgeHostServices.request('slow', 'read', {})
    await new Promise(resolve => setTimeout(resolve, 30))
    const one = handle.cancel(), two = handle.cancel()
    return { requestId: handle.requestId, outcomes: await Promise.all([one, two]),
      error: await handle.result.catch(error => error.code) }
  `, providers)
  let invocationSettled = false, quiescent = false
  const call = f.runtime.invoke('fixture.service', {}, undefined, undefined, undefined, undefined,
    { authority: { workspace: 'only-host' }, services: ['slow'] })
  void call.then(() => { invocationSettled = true })
  try {
    await bounded(entered.promise, 'provider entered')
    await bounded(aborted.promise, 'provider observed cancellation')
    const drain = f.runtime.waitForServiceQuiescence().then(() => { quiescent = true })
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(invocationSettled, false)
    assert.equal(quiescent, false)
    release.release()
    const result: any = await call
    await drain
    assert.equal(result.requestId, providerRequest!.requestId)
    assert.deepEqual(result.outcomes, [{ cancelled: true, quiescent: true }, { cancelled: true, quiescent: true }])
    assert.equal(result.error, 'cancelled')
  } finally { release.release(); await Promise.allSettled([call]); await f.close() }
})

test('Host invocation abort fences authority immediately but does not claim provider quiescence', async () => {
  const entered = barrier(), aborted = barrier(), release = barrier()
  let executions = 0
  const providers = new sdk.HostServiceProviderRegistry({ slow: {
    authorize: async (request) => {
      entered.release()
      request.signal.addEventListener('abort', aborted.release, { once: true })
      await release.promise
    }, operations: { read: () => { executions++; return null } },
  } })
  const f = await fixture(`return await globalThis.__sciforgeHostServices.request('slow', 'read', {}).result`, providers)
  const controller = new AbortController()
  const call = f.runtime.invoke('fixture.service', {}, undefined, controller.signal, undefined, undefined,
    { authority: {}, services: ['slow'] })
  let invocationSettled = false
  void call.then(() => { invocationSettled = true }, () => { invocationSettled = true })
  const rejected = assert.rejects(call, { code: 'request_cancelled' })
  try {
    await bounded(entered.promise, 'authorization entered')
    controller.abort()
    await bounded(aborted.promise, 'authorization aborted')
    let quiescent = false
    const drain = f.runtime.waitForServiceQuiescence().then(() => { quiescent = true })
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(quiescent, false)
    assert.equal(invocationSettled, false, 'outer abort must await held authorization settlement')
    release.release()
    await rejected
    await drain
    assert.equal(invocationSettled, true)
    assert.equal(executions, 0, 'authorization completing after abort cannot execute provider')
  } finally { release.release(); await rejected; await f.close() }
})

test('committing a new generation revokes old service authorization before async admission resumes', async () => {
  const entered = barrier(), aborted = barrier(), release = barrier()
  let executions = 0
  const providers = new sdk.HostServiceProviderRegistry({ slow: {
    authorize: async (request) => {
      entered.release()
      request.signal.addEventListener('abort', aborted.release, { once: true })
      await release.promise
    }, operations: { read: () => { executions++; return null } },
  } })
  const f = await fixture(`return await globalThis.__sciforgeHostServices.request('slow', 'read', {}).result`, providers)
  const call = f.runtime.invoke('fixture.service', {}, undefined, undefined, undefined, undefined,
    { authority: {}, services: ['slow'] })
  const rejected = assert.rejects(call, /closed|cancelled/)
  try {
    await bounded(entered.promise, 'old authorization entered')
    await f.host.prepare({ pluginId: 'fixture-id', packageName: 'fixture-package', version: '2', entryPath: f.entryPath })
    await f.host.commit('fixture-package')
    await bounded(aborted.promise, 'commit must revoke old generation service authority')
    release.release()
    await rejected
    assert.equal(executions, 0)
  } finally {
    release.release()
    await Promise.allSettled([rejected])
    await f.host.finalizeCommit('fixture-package')
    await f.close()
  }
})

test('a malformed duplicate cannot spoof settlement of an already admitted request ID', async () => {
  const entered = barrier(), release = barrier()
  let executions = 0
  const providers = new sdk.HostServiceProviderRegistry({ slow: {
    authorize: () => {}, operations: { read: async () => {
      executions++; entered.release(); await release.promise; return 'real-result'
    } },
  } })
  const f = await fixture(`
    const handle = globalThis.__sciforgeHostServices.request('slow', 'read', {})
    process.send({ type: 'service-request', requestId: handle.requestId, authority: { admin: true } })
    return await handle.result.catch(error => error.code)
  `, providers)
  let completed = false
  const call = f.runtime.invoke('fixture.service', {}, undefined, undefined, undefined, undefined,
    { authority: {}, services: ['slow'] })
  void call.then(() => { completed = true })
  try {
    await bounded(entered.promise, 'real provider entered')
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(completed, false, 'duplicate validation errors must not settle the real request')
    assert.equal(executions, 1)
    release.release()
    assert.equal(await call, 'real-result')
  } finally { release.release(); await Promise.allSettled([call]); await f.close() }
})

test('cyclic raw IPC input is rejected without crashing the Host or executing a provider', async () => {
  let executions = 0
  const providers = new sdk.HostServiceProviderRegistry({ echo: {
    authorize: () => {}, operations: { read: (request) => { executions++; return request.owner.invocationId } },
  } })
  const f = await fixture(`
    const invocationId = await globalThis.__sciforgeHostServices.request('echo', 'read', {}).result
    const requestId = (await import('node:crypto')).randomUUID()
    const cyclic = {}; cyclic.self = cyclic
    return await new Promise(resolve => {
      const listener = message => {
        if (message.type === 'service-response' && message.requestId === requestId) {
          process.off('message', listener); resolve(message.error.code)
        }
      }
      process.on('message', listener)
      process.send({ type: 'service-request', requestId, invocationId, serviceId: 'echo', operation: 'read', input: cyclic })
    })
  `, providers)
  try {
    assert.equal(await f.runtime.invoke('fixture.service', {}, undefined, undefined, undefined, undefined,
      { authority: {}, services: ['echo'] }), 'invalid_request')
    assert.equal(executions, 1, 'only the seed request executes')
  } finally { await f.close() }
})

test('service grants fail closed and child authority, stale and foreign owners never authorize effects', async () => {
  let executions = 0
  const providers = new sdk.HostServiceProviderRegistry({ echo: {
    authorize: request => { if (request.owner.authority.allow !== true) throw new Error('Host denied') },
    operations: { read: request => { executions++; return request.owner } },
  } })
  const body = `
    if (input.raw) {
      const requestId = (await import('node:crypto')).randomUUID()
      const response = new Promise(resolve => {
        const listener = message => { if (message.type === 'service-response' && message.requestId === requestId) {
          process.off('message', listener); resolve(message)
        } }
        process.on('message', listener)
      })
      process.send({ type: 'service-request', requestId, invocationId: input.invocationId,
        serviceId: 'echo', operation: 'read', input: {}, ...input.extra })
      return await response
    }
    return await globalThis.__sciforgeHostServices.request(input.serviceId ?? 'echo', input.operation ?? 'read', input).result
  `
  const f = await fixture(body, providers)
  const other = await fixture(body, providers)
  const grant = { authority: { allow: true }, services: ['echo'] }
  try {
    await assert.rejects(f.runtime.invoke('fixture.service', {}), /No live Host service invocation grant/)
    await assert.rejects(f.runtime.invoke('fixture.service', { serviceId: 'missing' }, undefined, undefined, undefined, undefined, grant), /No live Host service invocation grant/)
    await assert.rejects(f.runtime.invoke('fixture.service', { operation: 'missing' }, undefined, undefined, undefined, undefined, grant), /unavailable/)
    await assert.rejects(f.runtime.invoke('fixture.service', { authority: { allow: true } }, undefined, undefined, undefined, undefined,
      { authority: { allow: false }, services: ['echo'] }), /Host denied/)
    assert.equal(executions, 0)
    const owner: any = await f.runtime.invoke('fixture.service', {}, undefined, undefined, undefined, undefined, grant)
    assert.equal(executions, 1)
    const stale: any = await f.runtime.invoke('fixture.service', { raw: true, invocationId: owner.invocationId }, undefined, undefined, undefined, undefined, grant)
    assert.equal(stale.error.code, 'service_denied')
    const foreign: any = await other.runtime.invoke('fixture.service', { raw: true, invocationId: owner.invocationId }, undefined, undefined, undefined, undefined, grant)
    assert.equal(foreign.error.code, 'service_denied')
    for (const extra of [{ authority: { allow: true } }, { generation: 1 }, { caller: { admin: true } }, { scope: { workspace: 'forged' } }]) {
      const denied: any = await f.runtime.invoke('fixture.service', { raw: true, invocationId: owner.invocationId, extra }, undefined, undefined, undefined, undefined, grant)
      assert.equal(denied.error.code, 'invalid_request')
    }
    const otherOwner: any = await other.runtime.invoke('fixture.service', {}, undefined, undefined, undefined, undefined, grant)
    assert.equal(owner.generation, otherOwner.generation)
    assert.notEqual(owner.connectionId, otherOwner.connectionId)
    assert.equal(executions, 2)
  } finally { await Promise.all([f.close(), other.close()]) }
})

test('invocation timeout revokes authority and waits for actual provider quiescence before rejecting', async () => {
  const entered = barrier(), aborted = barrier(), release = barrier()
  const providers = new sdk.HostServiceProviderRegistry({ slow: {
    authorize: () => {}, operations: { read: async request => {
      entered.release(); request.signal.addEventListener('abort', aborted.release, { once: true })
      await release.promise; return null
    } },
  } })
  const f = await fixture(`return await globalThis.__sciforgeHostServices.request('slow', 'read', {}).result`, providers, 1000, 250)
  const call = f.runtime.invoke('fixture.service', {}, undefined, undefined, undefined, undefined,
    { authority: {}, services: ['slow'] })
  let settled = false
  void call.then(() => { settled = true }, () => { settled = true })
  const rejected = assert.rejects(call, { code: 'request_timeout' })
  try {
    await bounded(entered.promise, 'provider entered')
    await bounded(aborted.promise, 'timeout abort reached provider')
    let quiescent = false
    const drain = f.runtime.waitForServiceQuiescence().then(() => { quiescent = true })
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(quiescent, false)
    assert.equal(settled, false, 'timeout rejection must wait for real provider settlement')
    release.release(); await drain; await rejected
  } finally { release.release(); await rejected; await f.close() }
})

test('child exit revokes authority but cannot certify Host provider settlement', async () => {
  const entered = barrier(), aborted = barrier(), release = barrier()
  const providers = new sdk.HostServiceProviderRegistry({ slow: {
    authorize: () => {}, operations: { read: async request => {
      entered.release(); request.signal.addEventListener('abort', aborted.release, { once: true })
      await release.promise; return null
    } },
  } })
  const f = await fixture(`
    const handle = globalThis.__sciforgeHostServices.request('slow', 'read', {})
    setTimeout(() => process.exit(0), 50)
    return await handle.result
  `, providers)
  const call = f.runtime.invoke('fixture.service', {}, undefined, undefined, undefined, undefined,
    { authority: {}, services: ['slow'] })
  const rejected = assert.rejects(call, { code: 'runtime_crashed' })
  try {
    await bounded(entered.promise, 'provider entered')
    await rejected; await bounded(aborted.promise, 'exit abort reached provider')
    let quiescent = false
    const drain = f.runtime.waitForServiceQuiescence().then(() => { quiescent = true })
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(quiescent, false)
    release.release(); await drain
  } finally { release.release(); await rejected; await f.close() }
})

test('deactivate after child exit still waits for admitted provider settlement', async () => {
  const entered = barrier(), release = barrier()
  const providers = new sdk.HostServiceProviderRegistry({ slow: {
    authorize: () => {}, operations: { read: async () => {
      entered.release(); await release.promise; return null
    } },
  } })
  const f = await fixture(`
    const handle = globalThis.__sciforgeHostServices.request('slow', 'read', {})
    setTimeout(() => process.exit(0), 50)
    return await handle.result
  `, providers)
  const call = f.runtime.invoke('fixture.service', {}, undefined, undefined, undefined, undefined,
    { authority: {}, services: ['slow'] })
  const rejected = assert.rejects(call, { code: 'runtime_crashed' })
  try {
    await bounded(entered.promise, 'provider entered')
    await rejected
    let deactivated = false
    const close = f.runtime.deactivate().then(() => { deactivated = true })
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(deactivated, false, 'dead child does not mean Host provider stopped')
    release.release()
    await close
  } finally { release.release(); await rejected; await f.close() }
})

test('Host retains failed disposal ownership for public retry without readmitting services', async () => {
  const providers = new sdk.HostServiceProviderRegistry({ echo: {
    authorize: () => {}, operations: { read: () => null },
  } })
  const f = await fixture(`return await globalThis.__sciforgeHostServices.request('echo', 'read', {}).result`, providers)
  const originalDispose = f.runtime.dispose.bind(f.runtime)
  let attempts = 0
  f.runtime.dispose = async () => {
    attempts++
    if (attempts === 1) throw new Error('injected cleanup failure')
    return originalDispose()
  }
  try {
    await assert.rejects(f.host.dispose('fixture-package'), /injected cleanup failure/)
    assert.equal(f.host.runtime('fixture-package'), undefined)
    await assert.rejects(f.host.prepare({ pluginId: 'fixture-id', packageName: 'fixture-package', version: '2', entryPath: f.entryPath }),
      /disposal in progress/)
    await assert.rejects(f.runtime.invoke('fixture.service', {}, undefined, undefined, undefined, undefined,
      { authority: {}, services: ['echo'] }), { code: 'stale_generation' })
    await f.host.disposeAll()
    assert.equal(attempts, 2, 'disposeAll must retry the failed runtime owner')
  } finally {
    f.runtime.dispose = originalDispose
    await originalDispose()
    await f.close()
  }
})

test('lifecycle deactivation retains Host service correlation for package-owned cleanup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'host-service-deactivate-'))
  const entryPath = join(directory, 'entry.mjs')
  const factoryPath = join(directory, 'factory.mjs')
  let cleanupCalls = 0
  const providers = new sdk.HostServiceProviderRegistry({ cleanup: {
    authorize: () => {}, operations: { close: () => { cleanupCalls++; return { closed: true } } },
  } })
  const host = new sdk.ProcessExtensionHost({ hostServices: providers })
  try {
    await writeFile(factoryPath, 'export function createHostServiceClient() { return {} }')
    await writeFile(entryPath, `export function getCapabilityDefinitions() { return [] }
export async function deactivate() {
  await globalThis.__sciforgeHostServices.request('cleanup', 'close', {}).result
}`)
    await host.replace({ pluginId: 'cleanup-id', packageName: 'cleanup-package', version: '1', entryPath,
      serviceClients: [{ serviceId: 'cleanup', modulePath: factoryPath, exportName: 'createHostServiceClient', config: {} }] })
    await host.runtime('cleanup-package')!.deactivate()
    assert.equal(cleanupCalls, 1)
  } finally {
    await host.disposeAll().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})
test('Host disposes provider-owned resources after an extension child exits before package cleanup', async () => {
  let disposed = 0
  const providers = new sdk.HostServiceProviderRegistry({ worker: {
    authorize: () => {},
    dispose: () => { disposed++ },
    operations: { read: () => null },
  } })
  const f = await fixture(`setTimeout(() => process.exit(0), 40); await new Promise(() => {})`, providers)
  try {
    await assert.rejects(f.runtime.invoke('fixture.service', {}), { code: 'runtime_crashed' })
    await f.runtime.deactivate()
    assert.equal(disposed, 1)
  } finally { await f.close() }
})
test('Host resolves provider ownership per runtime generation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'host-service-generation-'))
  const entryPath = join(directory, 'entry.mjs')
  const attempts: number[] = []
  const host = new sdk.ProcessExtensionHost({
    resolveHostServices: (_packageName, _version, generation) => new sdk.HostServiceProviderRegistry({ worker: {
      authorize: () => {},
      dispose: () => { attempts.push(generation) },
      operations: { read: () => generation },
    } })
  })
  try {
    await writeFile(entryPath, `export function getCapabilityDefinitions() { return [{ descriptor: { id: 'fixture.service' }, handler: async () => await globalThis.__sciforgeHostServices.request('worker', 'read', {}).result }] }`)
    await host.replace({ pluginId: 'fixture-id', packageName: 'fixture-package', version: '1', entryPath })
    await host.replace({ pluginId: 'fixture-id', packageName: 'fixture-package', version: '2', entryPath })
    const runtime = host.runtime('fixture-package')!
    const result = await runtime.invoke('fixture.service', {}, undefined, undefined, undefined, undefined, { authority: {}, services: ['worker'] })
    assert.equal(result, 2)
    assert.deepEqual(attempts, [1])
  } finally {
    await host.disposeAll().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})
async function fixture(body: string, providers: sdk.HostServiceProviderRegistry, timeoutMs?: number, invokeTimeoutMs?: number) {
  const directory = await mkdtemp(join(tmpdir(), 'host-service-composition-'))
  const entryPath = join(directory, 'entry.mjs')
  const host = new sdk.ProcessExtensionHost({ hostServices: providers })
  try {
    await writeFile(entryPath, `export function getCapabilityDefinitions() { return [{
      descriptor: { id: 'fixture.service' }, handler: async (input, execution) => { ${body} }
    }] }`)
    await host.replace({ pluginId: 'fixture-id', packageName: 'fixture-package', version: '1', entryPath, timeoutMs, invokeTimeoutMs })
    const initialPid = host.snapshot('fixture-package')?.pid
    return { host, entryPath, runtime: host.runtime('fixture-package')!, async close() {
      const pids = new Set([initialPid, host.snapshot('fixture-package')?.pid])
      await host.disposeAll()
      for (const pid of pids) {
        if (!pid) continue
        for (let i = 0; i < 100; i++) {
          try { process.kill(pid, 0) } catch { break }
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        assert.throws(() => process.kill(pid, 0))
      }
      await rm(directory, { recursive: true, force: true })
    } }
  } catch (error) {
    await host.disposeAll()
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

test('configured business invocation deadline can exceed the short lifecycle deadline', async () => {
  const providers = new sdk.HostServiceProviderRegistry({ slow: {
    authorize: () => {}, operations: { read: async () => {
      await new Promise(resolve => setTimeout(resolve, 400))
      return 'legitimate-long-result'
    } },
  } })
  const f = await fixture(`return await globalThis.__sciforgeHostServices.request('slow', 'read', {}).result`, providers, 1000, 1500)
  try {
    assert.equal(await f.runtime.invoke('fixture.service', {}, undefined, undefined, undefined, undefined,
      { authority: {}, services: ['slow'] }), 'legitimate-long-result')
  } finally { await f.close() }
})

test('timeout owns rejection across late child success, later explicit abort and concurrent disposal', async () => {
  const entered = barrier(), aborted = barrier(), release = barrier()
  let executions = 0
  const providers = new sdk.HostServiceProviderRegistry({ slow: {
    authorize: () => {}, operations: { read: async request => {
      executions++; entered.release()
      request.signal.addEventListener('abort', aborted.release, { once: true })
      await release.promise
      return 'late-provider-success'
    } },
  } })
  const f = await fixture(`
    process.once('message', message => {
      if (message.type !== 'cancel') return
      process.send({ type: 'response', requestId: message.requestId, ok: true, result: 'late-child-success' }, async () => {
        await (await import('node:fs/promises')).writeFile(input.marker, 'late-response-sent')
      })
    })
    return await globalThis.__sciforgeHostServices.request('slow', 'read', {}).result
  `, providers, 1000, 150)
  const marker = join(f.entryPath, '..', 'late-response')
  const controller = new AbortController()
  const call = f.runtime.invoke('fixture.service', { marker }, undefined, controller.signal, undefined, undefined,
    { authority: {}, services: ['slow'] })
  let settled = false, disposed = false
  void call.then(() => { settled = true }, () => { settled = true })
  const rejected = assert.rejects(call, { code: 'request_timeout' })
  let close: Promise<unknown> | undefined
  try {
    await bounded(entered.promise, 'provider entered before finite business deadline')
    await bounded(aborted.promise, 'business deadline aborted provider')
    await bounded((async () => {
      while (true) {
        try { assert.equal(await readFile(marker, 'utf8'), 'late-response-sent'); return } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        await new Promise(resolve => setTimeout(resolve, 5))
      }
    })(), 'late child success must really reach IPC')
    controller.abort(); controller.abort()
    close = f.runtime.dispose().then(() => { disposed = true })
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(settled, false, 'late success and repeated abort cannot settle held timeout')
    assert.equal(disposed, false, 'dispose must retain provider quiescence obligation')
    assert.equal(executions, 1)
    release.release()
    await rejected
    await close
  } finally { release.release(); await Promise.allSettled([rejected, close]); await f.close() }
})

test('Host composes service providers with stable request ID and immutable connection/invocation authority', async () => {
  const seen: any[] = []
  const Registry = (sdk as any).HostServiceProviderRegistry
  assert.equal(typeof Registry, 'function', 'Host-owned provider registry is available')
  const providers = new Registry({ echo: {
    authorize: (request: any) => { seen.push(request) },
    operations: { read: (request: any) => ({ authority: request.owner.authority, requestId: request.requestId }) },
  } })
  const f = await fixture(`
    const handle = globalThis.__sciforgeHostServices.request('echo', 'read', input)
    return { requestId: handle.requestId, value: await handle.result }
  `, providers)
  try {
    const authority = { workspace: 'host-workspace', nested: { role: 'reader' } }
    const result: any = await (f.runtime.invoke as any)('fixture.service', { authority: { workspace: 'forged' } }, undefined, undefined, undefined, undefined,
      { authority, services: ['echo'] })
    assert.equal(result.requestId, result.value.requestId)
    assert.deepEqual(result.value.authority, authority)
    assert.equal(seen.length, 1)
    assert.equal(seen[0].requestId, result.requestId)
    assert.equal(seen[0].owner.packageName, 'fixture-package')
    assert.equal(seen[0].owner.pluginId, 'fixture-id')
    assert.equal(seen[0].owner.generation, 1)
    assert.ok(seen[0].owner.connectionId)
    assert.ok(seen[0].owner.invocationId)
    assert.ok(Object.isFrozen(seen[0].owner.authority.nested))
    assert.notEqual(seen[0].owner.authority, authority)
  } finally { await f.close() }
})


test('Host service live principal is retained outside JSON and rechecked after authorization', async () => {
  const entered = barrier(), release = barrier()
  let current = true, effects = 0, checks = 0
  const providers = new sdk.HostServiceProviderRegistry({ guarded: {
    authorize: async () => { entered.release(); await release.promise },
    operations: { read: () => { effects++; return 'effect' } },
  } })
  const f = await fixture(`return await globalThis.__sciforgeHostServices.request('guarded', 'read', {}).result`, providers)
  const call = f.runtime.invoke('fixture.service', {}, undefined, undefined, undefined, undefined, {
    authority: { caller: { principalId: 'host-principal' }, ordinarySession: { runtimeId: 'r', threadId: 't' } },
    services: ['guarded'],
    assertCurrent: () => { checks++; if (!current) throw new Error('principal revoked') },
  } as any)
  const rejected = assert.rejects(call, /principal revoked/)
  try {
    await bounded(entered.promise, 'live guard must reach authorization without serializing its function')
    current = false
    release.release()
    await rejected
    assert.equal(effects, 0)
    assert.ok(checks >= 2)
  } finally { release.release(); await Promise.allSettled([call, rejected]); await f.close() }
})
