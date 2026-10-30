import { it, expect } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EvidenceRuntime } from '../src/runtime.js'
function deferred<T = void>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => resolve = r); return { promise, resolve } }
const scope = { runtimeId: 'codex', threadId: 'thread-1', workspaceRoot: '/synthetic-workspace' }
it('close fences new admission, waits pre-write preparation and rejects it before durable mutation', async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), 'evidence-close-'))
  const entered = deferred(); const release = deferred(); let closeCalls = 0
  const runtime = new EvidenceRuntime({ storageRoot, identity: { pluginId: 'sciforge-evidence-dag', version: '1.0.0', profileId: 'synthetic' },
    request: async (r: any): Promise<any> => {
      if (r.operation === 'threads.read') { entered.resolve(); await release.promise; return { ...scope, watermark: '7', trace: [{ id: 'a' }] } }
      if (r.operation === 'sidecar.close') { closeCalls++; return { exited: true } }
      throw new Error(`unexpected ${r.operation}`)
    }, cancel: async () => ({ cancelled: true, quiescent: true }),
  })
  await runtime.start()
  const update = runtime.update(scope)
  const rejected = expect(update).rejects.toThrow(/closing|closed/)
  await entered.promise
  let settled = false
  const close = runtime.close().then(() => { settled = true })
  await new Promise(resolve => setImmediate(resolve))
  expect(settled, 'close must wait for already-admitted preparation').toBe(false)
  await expect(runtime.update(scope)).rejects.toThrow(/closing|closed/)
  release.resolve(); await rejected; await close; await runtime.close()
  expect(existsSync(join(storageRoot, 'deltas.json'))).toBe(false)
  expect(closeCalls).toBe(1)
})
