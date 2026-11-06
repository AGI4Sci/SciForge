import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, realpathSync, readFileSync, writeFileSync, unlinkSync, readdirSync, linkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ResearchRecordStore } from './research-record-store.js'
import { EvidenceFileStorage } from './secure-storage.js'
import { recordHash, type ResearchRecordState } from './research-record-state.js'
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'record-store-'))), path = join(root, 'evidence-dag', 'record.json')
  const state: ResearchRecordState = { version: 2, workspaceRoot: root, revision: 1, paused: false, model: '', nodes: {}, jobs: {}, phaseJobs: {}, messages: {}, receipts: {}, handoffs: {}, history: [], failures: [], lastScanAt: null }
  const store = new ResearchRecordStore(path, root); store.commit(state)
  return { root, path, state, store }
}
const head = (path: string) => JSON.parse(readFileSync(path, 'utf8'))

test('workspace ownership is validated before migration or publication touches stored bytes', () => {
  const f = fixture(), foreign = { ...f.state, workspaceRoot: join(f.root, 'other') }
  const legacy = JSON.stringify(foreign)
  writeFileSync(f.path, legacy)
  const before = readdirSync(join(f.root, 'evidence-dag')).map(name => [name, readFileSync(join(f.root, 'evidence-dag', name), 'utf8')])
  assert.throws(() => new ResearchRecordStore(f.path, f.root).load(), /workspace mismatch/)
  assert.deepEqual(readdirSync(join(f.root, 'evidence-dag')).map(name => [name, readFileSync(join(f.root, 'evidence-dag', name), 'utf8')]), before)
  writeFileSync(f.path, JSON.stringify(f.state))
  const store = new ResearchRecordStore(f.path, f.root); store.load()
  const manifest = readFileSync(f.path, 'utf8')
  assert.throws(() => store.commit({ ...foreign, revision: f.state.revision + 1 }), /workspace mismatch/)
  assert.equal(readFileSync(f.path, 'utf8'), manifest)
})
test('v2 migration retains human locks, negative history, failures and request receipts', () => {
  const f = fixture()
  f.state.nodes.human = { id: 'human', parentId: 'root', kind: 'phase', title: 'human', summary: 'negative stays', origin: 'human', status: 'failed', createdAt: 'old', updatedAt: 'old', locks: { placement: true, summary: true, title: true } }
  f.state.failures.push({ nodeId: 'human', at: 'old', message: 'failure retained' })
  f.state.history.push({ nodeId: 'human', at: 'old', kind: 'human-edit', value: { negative: true } })
  f.state.receipts.edit = { digest: recordHash('edit'), output: { revision: 1 } }
  writeFileSync(f.path, JSON.stringify(f.state))
  assert.deepEqual(new ResearchRecordStore(f.path, f.root).load(), f.state)
  assert.equal(head(f.path).format, 'research-record-store-v1')
  assert.deepEqual(new ResearchRecordStore(f.path, f.root).load(), f.state)
  writeFileSync(f.path, '{broken'); assert.throws(() => new ResearchRecordStore(f.path, f.root).load())
})
test('40 transactions and checkpoint rotations recover results, coverage, cursor and receipt together with bounded files', () => {
  const f = fixture()
  for (let index = 0; index < 40; index++) {
    f.state.revision++; f.state.history.push({ nodeId: 'round', at: 'now', kind: 'result', value: index })
    f.state.receipts[String(index)] = { digest: recordHash(index), output: index }
    f.state.ingestion = { thread: { watermark: 'opaque', fingerprint: recordHash(index), turns: { turn: { status: 'completed', sources: { item: recordHash(index) } } }, missingIds: [] } }
    f.state.jobs.round = { fingerprint: recordHash(index), sourceIds: ['item'], processedIds: ['item'], assignedIds: ['item'], fullExcerptIds: ['item'], truncatedIds: [], unavailableIds: [], changedIds: [], semanticPendingIds: [], attempts: 0, nextAt: 0 }
    f.store.commit(f.state)
    assert.deepEqual(new ResearchRecordStore(f.path, f.root).load(), f.state)
    assert.ok(head(f.path).segments.length <= 16)
  }
  assert.ok(readdirSync(join(f.root, 'evidence-dag')).length <= 20)
  const manifest = head(f.path), segment = JSON.parse(readFileSync(`${f.path}.segment-${manifest.segments.at(-1).slot}`, 'utf8'))
  assert.ok(segment.operations.some((op: { op: string; path: string[] }) => op.op === 'append' && op.path[0] === 'history'))
})
test('missing segments, wrong order/base and digest/checkpoint corruption fail closed', () => {
  for (const damage of ['missing', 'order', 'base', 'digest', 'checkpoint', 'head']) {
    const f = fixture()
    for (let index = 0; index < 2; index++) { f.state.revision++; f.state.model = String(index); f.store.commit(f.state) }
    const manifest = head(f.path), segmentPath = `${f.path}.segment-${manifest.segments[0].slot}`
    if (damage === 'missing') unlinkSync(segmentPath)
    if (damage === 'head') unlinkSync(f.path)
    if (damage === 'checkpoint') writeFileSync(`${f.path}.checkpoint-${manifest.checkpoint.slot}`, '{}')
    if (damage === 'order') { manifest.segments.reverse(); writeFileSync(f.path, JSON.stringify(manifest)) }
    if (damage === 'base' || damage === 'digest') {
      const segment = JSON.parse(readFileSync(segmentPath, 'utf8'))
      if (damage === 'base') segment.baseRevision++
      else segment.operations.push({ op: 'set', path: ['model'], value: 'corrupt' })
      writeFileSync(segmentPath, JSON.stringify(segment))
    }
    assert.throws(() => new ResearchRecordStore(f.path, f.root).load(), damage)
  }
})
test('manifest failure including checkpoint rotation preserves the prior complete commit', t => {
  for (const rotation of [false, true]) {
    const f = fixture()
    if (rotation) for (let index = 0; index < 16; index++) { f.state.revision++; f.state.model = String(index); f.store.commit(f.state) }
    const before = structuredClone(f.state)
    f.state.revision++; f.state.model = 'not committed'
    const original = EvidenceFileStorage.prototype.writeText
    const mocked = t.mock.method(EvidenceFileStorage.prototype, 'writeText', function (this: EvidenceFileStorage, text: string) {
      if (JSON.parse(text).format === 'research-record-store-v1') throw new Error('injected manifest failure')
      return original.call(this, text)
    })
    assert.throws(() => f.store.commit(f.state), /injected manifest failure/); mocked.mock.restore()
    assert.deepEqual(new ResearchRecordStore(f.path, f.root).load(), before)
    f.store.commit(f.state)
    assert.deepEqual(new ResearchRecordStore(f.path, f.root).load(), f.state)
  }
})
test('checkpoint failure, stale writers and hardlinked segments cannot advance committed state', t => {
  const f = fixture(), stale = new ResearchRecordStore(f.path, f.root); stale.load()
  f.state.revision++; f.state.model = 'current'; f.store.commit(f.state)
  assert.throws(() => stale.commit(f.state), /manifest changed/)
  const before = structuredClone(f.state)
  f.state.revision++; f.state.model = 'x'.repeat(300000)
  const original = EvidenceFileStorage.prototype.writeText
  const mocked = t.mock.method(EvidenceFileStorage.prototype, 'writeText', function (this: EvidenceFileStorage, text: string) {
    if (JSON.parse(text).version === 2) throw new Error('injected checkpoint failure')
    return original.call(this, text)
  })
  assert.throws(() => f.store.commit(f.state), /injected checkpoint failure/); mocked.mock.restore()
  assert.deepEqual(new ResearchRecordStore(f.path, f.root).load(), before)
  const manifest = head(f.path), segment = `${f.path}.segment-${manifest.segments[0].slot}`
  linkSync(segment, join(f.root, 'hardlink'))
  assert.throws(() => new ResearchRecordStore(f.path, f.root).load(), /hardlink/)
})

test('interrupted legacy migration leaves the original input and permits verified recovery on the same store', t => {
  const f = fixture()
  writeFileSync(f.path, JSON.stringify(f.state))
  const store = new ResearchRecordStore(f.path, f.root)
  const original = EvidenceFileStorage.prototype.writeText
  const mocked = t.mock.method(EvidenceFileStorage.prototype, 'writeText', function (this: EvidenceFileStorage, text: string) {
    if (JSON.parse(text).format === 'research-record-store-v1') throw new Error('migration interrupted')
    return original.call(this, text)
  })
  assert.throws(() => store.load(), /migration interrupted/)
  assert.deepEqual(JSON.parse(readFileSync(f.path, 'utf8')), f.state)
  mocked.mock.restore()
  assert.deepEqual(store.load(), f.state)
  assert.deepEqual(new ResearchRecordStore(f.path, f.root).load(), f.state)
})
