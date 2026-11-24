import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { EvidenceDagServiceClient } from './client.js'
import { readHumanReviews } from './human-review-read.js'

const digest = 'sha256:' + 'a'.repeat(64)
const bindings = { scopes: [{ runtimeId: 'codex', threadId: 'fixture', engineThreadId: 'codex:fixture', snapshotDigest: digest }], reasons: [] }

test('unavailable or unauthorized review source is explicit and never starts another operation', async () => {
  let calls = 0
  const result = await readHumanReviews({ bindings, subject: { threadId: 'codex:fixture' },
    authorize: async () => { throw new Error('restricted') },
    client: { humanReviews: async () => { calls++; throw new Error('must not call') } } })
  assert.equal(calls, 0)
  assert.equal(result.status, 'unavailable')
  assert.deepEqual(result.reasons, ['review_source_unavailable'])
})

test('actual TS client reads Python snapshot binding and decision journal over local HTTP', { timeout: 30000 }, async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const script = `
import sys, os, json, tempfile, threading
sys.path[:0] = [os.path.join(${JSON.stringify(root)}, 'python'), os.path.join(${JSON.stringify(root)}, 'tests')]
from test_human_review import committed_engine
from test_audit_read_binding import publish, REF
from evidence_dag.server import Handler, EvidenceDagHTTPServer
with tempfile.TemporaryDirectory() as directory:
    engine, first, packet = committed_engine(os.path.realpath(directory))
    pinned = publish(engine, 2, 'Pinned material', REF)
    event = engine.record_review_decision('thread', packet, action='approve', expected_snapshot_digest=pinned,
        actor='fixture-label', rationale='Exact material review', idempotency_key='fixture-one')['event']
    publish(engine, 3, 'Later publication', REF)
    class FixtureHandler(Handler): pass
    FixtureHandler.engine = engine
    FixtureHandler.api_token = 'isolated-fixture'
    server = EvidenceDagHTTPServer(('127.0.0.1', 0), FixtureHandler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    before = len(engine._event_store.read())
    print(json.dumps({'port': server.server_port, 'digest': pinned, 'ref': REF, 'event': event}), flush=True)
    command = sys.stdin.readline().strip()
    if command == 'restrict':
        engine.require('thread').meta['scope'] = {'accessPolicy': {'read': False}}
        print('restricted', flush=True)
        sys.stdin.readline()
    server.shutdown()
    server.server_close()
    worker.join()
    assert len(engine._event_store.read()) == before, 'read appended events'
`
  const child = spawn(process.platform === 'win32' ? 'python' : 'python3', ['-X', 'utf8', '-u', '-c', script], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += String(chunk) })
  const exited = once(child, 'exit')
  const lines = createInterface({ input: child.stdout })
  try {
    const first = await Promise.race([once(lines, 'line').then(([line]) => JSON.parse(line)), exited.then(() => { throw new Error(stderr || 'Python fixture exited early') })])
    const client = new EvidenceDagServiceClient({ endpoint: () => ({ baseUrl: `http://127.0.0.1:${first.port}`, apiKey: 'isolated-fixture' }) })
    for (const selector of ['snapshotDigest=', 'artifactVersionRef=null', 'snapshotDigest=' + first.digest + '&snapshotDigest=' + digest]) {
      const response = await fetch(`http://127.0.0.1:${first.port}/threads/thread/graph?${selector}`, { headers: { authorization: 'Bearer isolated-fixture' } })
      assert.equal(response.status, 400)
    }
    const binding = await client.graphBinding('thread', { artifactVersionRef: first.ref })
    assert.equal(binding.binding.snapshotDigest, first.digest)
    const reviews = await client.humanReviews('thread', first.digest, first.ref)
    assert.equal(reviews.status, 'available')
    assert.equal(reviews.records[0].eventId, first.event.eventId)
    assert.equal(reviews.records[0].reviewReceipt.identity.status, 'unverified')
    assert.equal(reviews.records[0].reviewReceipt.timing.status, 'unknown')
    assert.deepEqual((await client.humanReviews('thread', first.digest, first.ref, '2000-01-01T00:00:00Z')).records, [])
    await assert.rejects(client.graphBinding('thread', { snapshotDigest: digest }))
    await assert.rejects(client.graphBinding('thread', { snapshotDigest: first.digest, artifactVersionRef: { ...first.ref, byteLength: 999 } }))
    const restricted = once(lines, 'line')
    child.stdin.write('restrict\n')
    assert.equal((await restricted)[0], 'restricted')
    await assert.rejects(client.graphBinding('thread', { snapshotDigest: first.digest }))
    await assert.rejects(client.humanReviews('thread', first.digest))
  } finally {
    child.stdin.end('done\n')
    const [code] = await exited
    lines.close()
    assert.equal(code, 0, stderr)
  }
})


test('review reads deduplicate exact snapshots and obey one concurrent wall-clock budget', async () => {
  const many = Array.from({ length: 32 }, (_, index) => ({ ...bindings.scopes[0], snapshotDigest: 'sha256:' + index.toString(16).padStart(64, '0') }))
  let calls = 0, running = 0, peak = 0
  const started = Date.now()
  const bounded = await readHumanReviews({ bindings: { scopes: [...many, ...many], reasons: [] }, subject: { threadId: 'codex:fixture' }, budgetMs: 40,
    authorize: async () => {}, client: { humanReviews: async () => { calls++; running++; peak = Math.max(peak, running); return new Promise(() => {}) } } })
  assert.ok(Date.now() - started < 500)
  assert.equal(calls, 4)
  assert.equal(peak, 4)
  assert.equal(bounded.status, 'unavailable')
  assert.ok(bounded.reasons.includes('review_read_time_bounded'))
  calls = 0
  const repeated = await readHumanReviews({ bindings: { scopes: [...bindings.scopes, ...bindings.scopes], reasons: [] }, subject: { threadId: 'codex:fixture' },
    authorize: async () => {}, client: { humanReviews: async () => { calls++; return {status:'available',records:[],reasons:[]} } } })
  assert.equal(calls, 1)
  assert.equal(repeated.status, 'available')
})


test('authorization timing out cannot start late sidecar reads', async () => {
  let release!: () => void, calls = 0
  const waiting = new Promise<void>(resolve => { release = resolve })
  const result = await readHumanReviews({ bindings, subject: { threadId: 'codex:fixture' }, budgetMs: 20,
    authorize: () => waiting, client: { humanReviews: async () => { calls++; return { status: 'available', records: [], reasons: [] } } } })
  assert.equal(result.status, 'unavailable')
  release()
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(calls, 0)
  assert.deepEqual(result.records, [])
})
