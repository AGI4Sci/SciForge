import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { beforeAll, describe, expect, it } from 'vitest'
import { PythonEvidenceWorker } from '@sciforge/domain-evidence-dag/host/python-worker'
import { workerOptions } from './worker-fixture.js'

let options: Awaited<ReturnType<typeof workerOptions>>
beforeAll(async () => { options = await workerOptions() })

describe('formal wheel reasoning correlation (controlled text, not real-model acceptance)', () => {
  it('keeps parallel verifier callbacks paired when the second text result is faster', async () => {
    const counts = { extract: 0, nli: 0, review: 0 }
    const worker = new PythonEvidenceWorker({ ...options, reasoner: async (input: any) => {
      const system = input.messages[0].content as string
      if (system.includes('EDAG-TASK: extract')) {
        counts.extract++
        return JSON.stringify({ nodes: [
          { tmp_id: 'source', type: 'source_assertion', content: 'The bead is blue and round.', trace_ref: 't1' },
          { tmp_id: 'blue', type: 'claim', content: 'The bead is blue.', trace_ref: 't1' },
          { tmp_id: 'round', type: 'claim', content: 'The bead is round.', trace_ref: 't1' },
        ], edges: [
          { src: 'source', dst: 'blue', rel: 'supports' },
          { src: 'source', dst: 'round', rel: 'supports' },
          // Disputed targets are selected by the real A2 policy, so this also
          // exercises concurrent adversarial-review callers of the same port.
          { src: 'blue', dst: 'round', rel: 'contradicts' },
        ] })
      }
      if (system.includes('EDAG-TASK: nli')) {
        counts.nli++
        // Real verifier ThreadPoolExecutor + real wheel stdin. On the old
        // PortLLM the faster second reply is consumed by the first reader.
        if (counts.nli === 1) await new Promise(resolve => setTimeout(resolve, 150))
        const blue = input.messages[1].content.includes('HYPOTHESIS: The bead is blue.')
        return JSON.stringify({ entailment: blue ? 0.91 : 0.82 })
      }
      if (system.includes('EDAG-TASK: adversarial')) {
        counts.review++
        return '{"result":"passed","confidence":0.9,"rationale":"Controlled correlation regression."}'
      }
      throw new Error('Unexpected task')
    } })
    try {
      const result = await worker.request('extract', {
        threadId: 'correlation:parallel', targetWatermark: '1',
        trace: [{ id: 't1', type: 'message', content: 'The bead is blue and round.' }],
        workspaceRoot: options.root, idempotencyKey: 'parallel-correlation',
      }, { signal: new AbortController().signal, assertCurrent() {} })
      expect(result.snapshot.digest).toMatch(/^sha256:/)
      expect(counts).toEqual({ extract: 1, nli: 3, review: 2 })
      const nodes = new Map(result.graph.nodes.map((node: any) => [node.id, node.content]))
      expect(Object.fromEntries(result.graph.edges.filter((edge: any) => edge.rel === 'supports').map((edge: any) => [nodes.get(edge.dst), edge.nli_score])))
        .toEqual({ 'The bead is blue.': 0.91, 'The bead is round.': 0.82 })
    } finally {
      const pid = worker.pid
      await worker.close()
      if (pid) expect(() => process.kill(pid, 0)).toThrow()
    }
  })

  for (const kind of ['stale-id', 'prior-request', 'wrong-type'] as const) it(`rejects ${kind} rather than accepting cross-request text`, async () => {
    const child = spawn(options.executable, ['-I', '-u', '-c', `
import sys
sys.path.insert(0, sys.argv[1])
from evidence_dag.runtime_stdio import PortLLM
port = PortLLM()
if sys.argv[2] == 'prior-request':
    assert port.chat([{'role': 'user', 'content': 'first'}]) == 'first-owned-result'
try:
    port.chat([{'role': 'user', 'content': 'untrusted model text'}])
except ValueError as error:
    print(str(error), flush=True)
else:
    raise AssertionError('foreign reasoning reply was accepted')
`, options.wheelPath, kind], { cwd: options.home, env: { HOME: options.home, TMPDIR: options.tmpDir }, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    const exited = new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject) })
    const lines = createInterface({ input: child.stdout })
    lines.on('line', line => {
      output += line + '\n'
      if (!line.startsWith('{')) return
      const message = JSON.parse(line)
      if (message.type === 'reason') {
        if (kind === 'prior-request' && message.id === 'reason-1') {
          child.stdin.write(JSON.stringify({ type: 'reason-result', id: message.id, ok: true, value: 'first-owned-result' }) + '\n')
        } else {
          child.stdin.end(JSON.stringify({ type: kind === 'wrong-type' ? 'response' : 'reason-result', id: kind === 'prior-request' ? 'reason-1' : kind === 'stale-id' ? 'reason-0' : message.id, ok: true, value: 'foreign' }) + '\n')
        }
      }
    })
    try {
      expect(await exited).toBe(0)
      expect(output).toContain('Reasoner response identity mismatch')
    } finally { if (child.exitCode === null) child.kill('SIGKILL') }
  })
})
