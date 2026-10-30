import { syntheticWorkerOwner } from './worker-fixture.js'
import type { Json } from '@sciforge/domain-evidence-dag/host/ports'
import { it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const scope = { runtimeId: 'codex', threadId: 'thread-1', workspaceRoot: '/synthetic-workspace' }
const projection = { ...scope, watermark: '7', trace: [{ id: 'answer-1', kind: 'assistant_message', text: 'Evidence.' }] }
const stamp = '2026-07-26T06:00:00.000Z'
export async function runtimeModule() {
  expect(existsSync(new URL('../src/runtime.ts', import.meta.url)), 'Evidence port-driven runtime must exist').toBe(true)
  return import('../src/runtime.js')
}
export async function options() {
  const root = await mkdtemp(join(tmpdir(), 'evidence-runtime-'))
  const calls: any[] = []
  const extractor = syntheticWorkerOwner('answer-1')
  return {
    root, calls,
    ports: {
      identity: { pluginId: 'sciforge-evidence-dag', version: '1.0.0', profileId: 'synthetic-profile' },
      storageRoot: root,
      request: async (request: any): Promise<Json> => {
        calls.push(request)
        if (request.operation === 'threads.read') return structuredClone(projection)
        if (request.operation === 'threads.list') return [scope]
        if (request.operation === 'artifacts.listEvents') return { ok: true, value: { events: [], lastSequence: 0 } }
        if (request.operation === 'sidecar.extract') return extractor.request('extract', request.input)
        if (request.operation === 'sidecar.close') { await extractor.close(); return { exited: true } }
        throw new Error(`No synthetic implementation for ${request.operation}`)
      },
      cancel: async (_requestId: string) => ({ cancelled: true, quiescent: true }),
    },
  }
}
it('update persists the canonical native delta and restart reads it before replay', async () => {
  const { EvidenceRuntime } = await runtimeModule()
  const opts = await options()
  const runtime = new EvidenceRuntime(opts.ports, { now: () => new Date(stamp) })
  await runtime.start()
  const receipt = await runtime.update(scope)
  expect(receipt.idempotent).toBe(false)
  const disk = JSON.parse(await readFile(join(opts.root, 'deltas.json'), 'utf8'))
  expect(disk.chains[0].records[0].deltaDigest).toBe(receipt.deltaDigest)
  await runtime.close()
  const before = await readFile(join(opts.root, 'deltas.json'), 'utf8')
  const restart = new EvidenceRuntime(opts.ports, { now: () => new Date(stamp) })
  await restart.start()
  expect((await restart.snapshotStatus(scope)).authoritativeHead!.headDigest).toBe(receipt.deltaDigest)
  expect(await readFile(join(opts.root, 'deltas.json'), 'utf8')).toBe(before)
  const replay = await restart.update(scope)
  expect(replay.idempotent).toBe(true)
  expect(replay.deltaDigest).toBe(receipt.deltaDigest)
  await restart.close()
})
