import { it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { workerOptions, syntheticReasoner } from './worker-fixture.js'
it('revocation during real worker reasoning cannot fall back into a durable commit', async () => {
  const { PythonEvidenceWorker } = await import('@sciforge/domain-evidence-dag/host/python-worker')
  const opts = await workerOptions()
  let current = true
  const worker = new PythonEvidenceWorker({ ...opts, reasoner: async input => { current = false; return syntheticReasoner(input) } })
  const context = { signal: new AbortController().signal, assertCurrent() { if (!current) throw new Error('principal revoked') } }
  try {
    await expect(worker.request('commitSnapshot', { threadId: 'codex:revoked', targetWatermark: '1', trace: [{ id: 't1', type: 'message', content: 'Synthetic revoked claim.' }], workspaceRoot: join(opts.root, 'workspace'), idempotencyKey: 'revoked-commit' }, context)).rejects.toThrow(/revoked|exited/)
  } finally { await worker.close() }
})

it('serializes simultaneous commands while a real Python reasoner callback is awaiting its response', async () => {
  const { PythonEvidenceWorker } = await import('@sciforge/domain-evidence-dag/host/python-worker')
  const opts = await workerOptions()
  const worker = new PythonEvidenceWorker({ ...opts, reasoner: async (input) => { await new Promise(r => setImmediate(r)); return syntheticReasoner(input) } })
  const input = { threadId: 'codex:thread-1', targetWatermark: '7', trace: [{ id: 't1', content: 'Synthetic.' }], workspaceRoot: join(opts.root, 'workspace'), idempotencyKey: 'concurrent-seal' }
  try {
    const [first, replay] = await Promise.all([worker.request('commitSnapshot', input), worker.request('commitSnapshot', input)])
    expect(first.snapshot.digest).toBe(replay.snapshot.digest)
  } finally { await worker.close() }
})

it('owns a real wheel-only Python process and reads its old committed snapshot after restart without model work', async () => {
  expect(existsSync(new URL('../../../packages/domains/evidence-dag/src/host/python-worker.ts', import.meta.url)), 'approved Python worker owner must exist').toBe(true)
  const { PythonEvidenceWorker } = await import('@sciforge/domain-evidence-dag/host/python-worker')
  const opts = await workerOptions()
  const worker = new PythonEvidenceWorker(opts)
  const input = { threadId: 'codex:thread-1', targetWatermark: '7', trace: [{ id: 't1', type: 'message', content: 'Synthetic evidence.' }], workspaceRoot: join(opts.root, 'workspace'), idempotencyKey: 'seal-1' }
  try {
    const result = await worker.request('commitSnapshot', input)
    expect(result.snapshot.digest).toMatch(/^sha256:[a-f0-9]{64}$/)
    const pid = worker.pid
    expect(pid).toBeGreaterThan(0)
    await worker.close()
    expect(() => process.kill(pid!, 0)).toThrow()
    let modelCalls = 0
    const restart = new PythonEvidenceWorker({ ...opts, reasoner: async () => { modelCalls++; throw new Error('restart must not recompile') } })
    try {
      const old = await restart.request('readSnapshot', { threadId: input.threadId, snapshotDigest: result.snapshot.digest, workspaceRoot: input.workspaceRoot })
      expect(old.snapshot.digest).toBe(result.snapshot.digest)
      expect(old.snapshot.version).toBe(result.snapshot.version)
      expect(modelCalls).toBe(0)
    } finally { await restart.close() }
  } finally { await worker.close() }
})
