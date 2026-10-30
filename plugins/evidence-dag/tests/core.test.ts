import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

async function core() {
  expect(existsSync(new URL('../src/core.ts', import.meta.url)), 'independent Evidence core must exist').toBe(true)
  return import('../src/core.js')
}
export const time = '2026-07-26T06:00:00.000Z'
export const append = {
  runtimeId: 'codex', threadId: 'codex:thread-1', workspaceRoot: '/synthetic-workspace',
  operationId: 'turn-1', kind: 'turn' as const, requestedWatermark: '7',
  idempotencyKey: 'artifact-event:turn-completed:codex:thread-1:turn-1',
  eventKind: 'turn-completed', createdAt: time,
  trace: [{ id: 'answer-1', kind: 'assistant_message', text: 'Evidence.' }]
}
describe('independent Evidence core', () => {
  it('reads the old durable delta before idempotent replay without a new write', async () => {
    const { EvidenceDagDeltaStore, evidenceDagDeltaInputFromTrace } = await core()
    const root = await mkdtemp(join(tmpdir(), 'evidence-core-'))
    const file = join(root, 'deltas.json')
    const first = await new EvidenceDagDeltaStore(file).append(evidenceDagDeltaInputFromTrace(append))
    const before = await readFile(file, 'utf8')
    const restarted = new EvidenceDagDeltaStore(file)
    expect((await restarted.head(append.threadId)).headDigest).toBe(first.delta.deltaDigest)
    const replay = await restarted.append(evidenceDagDeltaInputFromTrace(append))
    expect(replay).toEqual({ delta: first.delta, idempotent: true })
    expect(await readFile(file, 'utf8')).toBe(before)
  })
})
