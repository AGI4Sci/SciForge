import { it, expect } from 'vitest'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { PythonEvidenceWorker } from '@sciforge/domain-evidence-dag/host/python-worker'
import { workerOptions } from './worker-fixture.js'
it('real wheel assigns 1,2 then restart 3 to unpublished closures for independent threads', async () => {
  const opts = await workerOptions()
  for (const threadId of ['codex:alpha', 'research:beta']) {
    let worker = new PythonEvidenceWorker(opts)
    const snapshots: any[] = []
    const input = (n: number) => ({ threadId, targetWatermark: String(n), trace: [{ id: 't1', content: 'Synthetic' }], workspaceRoot: join(opts.root, 'workspace'), idempotencyKey: `${threadId}:seal:${n}` })
    try {
      for (const n of [1, 2]) { const result = await worker.request('commitSnapshot', input(n)); expect(result.snapshot.version).toBe(n); snapshots.push(result.snapshot) }
      const old = snapshots[0]
      const pid = worker.pid; await worker.close(); expect(() => process.kill(pid!, 0)).toThrow()
      worker = new PythonEvidenceWorker({ ...opts, reasoner: async () => { throw Error('read-only recovery must not reason') } })
      expect((await worker.request('readSnapshot', { threadId, snapshotDigest: old.digest, workspaceRoot: input(1).workspaceRoot })).snapshot.digest).toBe(old.digest)
      await worker.close()
      worker = new PythonEvidenceWorker(opts)
      const third = await worker.request('commitSnapshot', input(3)); expect(third.snapshot.version).toBe(3)
      expect((await readdir(opts.storageRoot)).filter(p => p.endsWith('.prov.json'))).toEqual([])
      expect(new Set([...snapshots, third.snapshot].map(s => s.digest)).size).toBe(3)
    } finally { const pid = worker.pid; await worker.close(); expect(() => process.kill(pid!, 0)).toThrow() }
  }
})
