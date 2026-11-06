import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { delimiter } from 'node:path'
import { createInterface } from 'node:readline'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8')
const apiSource = html.match(/async function api\(path,options=\{\}\)\{[\s\S]*?\n\}/)?.[0]
const refreshSource = html.match(/async function refresh\(\)\{[\s\S]*?\n\}/)?.[0]
assert.ok(apiSource)
assert.ok(refreshSource)

// Actual Handler + Engine + disposable DB. No model or installed npm modules.
const fixture = String.raw`
import json, pathlib, sys, tempfile, threading
from http.server import ThreadingHTTPServer
from project_dag.server import Handler, RuntimeActors
with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp) / '\u5de5\u4f5c\u533a space'
    root.mkdir()
    evidence = root / 'evidence'; evidence.mkdir()
    actors = RuntimeActors.create(str(root / 'project.db'), str(evidence))
    class LocalHandler(Handler):
        engine = actors.api
        api_token = 'test-token'
    server = ThreadingHTTPServer(('127.0.0.1', 0), LocalHandler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    print(json.dumps({'base': 'http://127.0.0.1:'+str(server.server_port), 'root': str(root)}), flush=True)
    try:
        sys.stdin.buffer.read()
    finally:
        server.shutdown(); server.server_close(); worker.join()
        for engine in (actors.api, actors.update, actors.audit): engine.store.close()
`
let child: ReturnType<typeof spawn>
let base: string, root: string
let exited: Promise<unknown[]>
before(async () => {
  const pythonPaths = ['../python', '../../evidence-dag/python'].map(path => fileURLToPath(new URL(path, import.meta.url)))
  child = spawn(process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3'), ['-u', '-c', fixture], {
    env: { ...process.env, PYTHONPATH: pythonPaths.join(delimiter), PYTHONDONTWRITEBYTECODE: '1' },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  exited = once(child, 'exit')
  let stderr = ''
  child.stderr!.on('data', chunk => { stderr += chunk })
  const lines = createInterface({ input: child.stdout! })
  const timer = setTimeout(() => child.kill(), 10000)
  try {
    const first = await Promise.race([once(lines, 'line'), exited.then(() => { throw new Error(stderr || 'Fixture exited') })])
    ;({ base, root } = JSON.parse(String(first[0])))
  } finally { clearTimeout(timer); lines.close() }
})
after(async () => {
  if (!child) return
  child.stdin!.end()
  const timer = setTimeout(() => child.kill(), 5000)
  try { await exited } finally { clearTimeout(timer) }
})

function client(fields: Record<string, string>) {
  const query = new URLSearchParams(fields)
  const wire: { status: number; path: string }[] = []
  const context = {
    query, URL, token: 'test-token', location: new URL(base), object: (value: unknown) => value || {},
    fetch: async (path: string, options: RequestInit) => {
      const response = await fetch(new URL(path, base), { ...options, signal: AbortSignal.timeout(5000) })
      wire.push({ status: response.status, path })
      return response
    }
  }
  const api = runInNewContext(`${apiSource};api`, context)
  return { api, wire }
}

test('UI sends workspace identity for GET and preserves snapshot parameters', async () => {
  const { api, wire } = client({ workspaceRoot: root })
  await api('/updates/status?snapshot=sha256%3Atest')
  assert.equal(wire[0].status, 200)
  const url = new URL(wire[0].path, base)
  assert.equal(url.searchParams.get('workspaceRoot'), root)
  assert.equal(url.searchParams.get('snapshot'), 'sha256:test')
})

test('UI accepts projectRoot and passes JSON writes without changing payload', async () => {
  const { api, wire } = client({ projectRoot: root })
  await api('/goals/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectRoot: root, title: '合成 Goal' }) })
  const draft = await api('/goals/draft')
  assert.equal(draft.title, '合成 Goal')
  assert.deepEqual(wire.map(row => row.status), [200, 200])
})

test('UI rejects missing root and conflicting route before sending credentials', async () => {
  const missing = client({ projectKey: `path:${root}` })
  await assert.rejects(missing.api('/updates/status'), /workspaceRoot/)
  assert.equal(missing.wire.length, 0)
  const bound = client({ workspaceRoot: root })
  await assert.rejects(bound.api('/updates/status?workspaceRoot=other'), /不一致/)
  await assert.rejects(bound.api('https://example.invalid/updates/status'), /当前服务/)
  assert.equal(bound.wire.length, 0)
})

test('server still rejects mismatched key and body workspace', async () => {
  const badKey = client({ workspaceRoot: root, projectKey: `path:${root}/other` })
  await assert.rejects(badKey.api('/updates/status'), /does not match/)
  assert.equal(badKey.wire[0].status, 400)
  const badBody = client({ workspaceRoot: root })
  await assert.rejects(badBody.api('/goals/draft', { method: 'POST',
    body: JSON.stringify({ workspaceRoot: `${root}/other`, title: 'Must not write' }) }), /differs/)
  assert.equal(badBody.wire[0].status, 400)
})

test('refresh overlaps independent reads and binds attention to returned graph digest', async () => {
  const pending = new Map<string, (value: unknown) => void>()
  const state: Record<string, unknown> = {}
  const button = { disabled: false }
  const noop = () => {}
  const context = {
    state, document: { getElementById: () => button },
    api: (path: string) => new Promise(resolve => pending.set(path, resolve)),
    renderError: (error: unknown) => { if (error) throw error },
    requestedGraphNodeId: '', requestedClaimId: '', graphModel: () => ({ nodes: [] }),
    list: (value: unknown) => value || [], object: (value: unknown) => value || {},
    renderSummary: noop, renderEvidenceVector: noop, renderClaims: noop, renderGraph: noop,
    renderSidechains: noop, renderGraphInspector: noop, scheduleStatusPoll: noop
  }
  const refresh = runInNewContext(`${refreshSource};refresh`, context)
  const done = refresh()
  assert.deepEqual([...pending.keys()].sort(), ['/findings', '/graph', '/updates/status'])
  pending.get('/graph')!({ snapshot: { digest: 'sha256:one' }, claims: [] })
  await Promise.resolve(); await Promise.resolve()
  assert.ok(pending.has('/attention?snapshotDigest=sha256%3Aone'))
  assert.equal(state.graph, undefined) // No partial render before all reads complete.
  pending.get('/updates/status')!({ state: 'idle' })
  pending.get('/findings')!([])
  pending.get('/attention?snapshotDigest=sha256%3Aone')!([])
  await done
  assert.deepEqual(state.graph, { snapshot: { digest: 'sha256:one' }, claims: [] })
  assert.equal(button.disabled, false)
})

test('review retry reuses its idempotency key until a successful response', async () => {
  const source = html.match(/async function submitHumanReviewDecision\(packetId,action\)\{[\s\S]*?\n\}/)?.[0]
  assert.ok(source)
  let sequence = 0
  const payloads: Record<string, unknown>[] = []
  const submit = runInNewContext(`${source};submitHumanReviewDecision`, {
    state: { graph: { snapshot: { digest: 'snapshot:1' } } },
    document: { querySelectorAll: () => [] }, crypto: { randomUUID: () => `retry-${++sequence}` },
    api: async (_path: string, options: { body: string }) => {
      payloads.push(JSON.parse(options.body))
      if (payloads.length === 1) throw new Error('response lost after commit')
    }, refresh: async () => {}, renderError: () => {}
  })
  await submit('packet:1', 'request_evidence')
  await submit('packet:1', 'request_evidence')
  await submit('packet:1', 'request_evidence')
  assert.equal(payloads[0].idempotencyKey, payloads[1].idempotencyKey)
  assert.notEqual(payloads[1].idempotencyKey, payloads[2].idempotencyKey)
})
