import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { FigureStore, annotationGeometrySchema, sourceJsonSchema, type FigureFileSystem, type FigureConfirmation } from './index.js'

class MemoryFiles implements FigureFileSystem {
  withLock?: FigureFileSystem['withLock']
  files = new Map<string, Uint8Array>()
  failIndex = false
  writes: string[] = []
  async read(_root: string, path: string) { return this.files.has(path) ? new Uint8Array(this.files.get(path)!) : null }
  async listDirectories(_root: string, path: string) {
    return [...new Set([...this.files.keys()].filter(p => p.startsWith(`${path}/`)).map(p => p.slice(path.length + 1).split('/')[0]))]
  }
  async writeImmutable(_root: string, path: string, bytes: Uint8Array) {
    if (this.files.has(path)) throw new Error('EEXIST')
    this.writes.push(path)
    this.files.set(path, new Uint8Array(bytes))
  }
  async writeAtomic(_root: string, path: string, bytes: Uint8Array) {
    if (this.failIndex && path.endsWith('/store.json')) throw new Error('index unavailable')
    this.writes.push(path)
    this.files.set(path, new Uint8Array(bytes))
  }
}
const image = (revisionId: string, content = revisionId) => ({ revisionId, originalFilename: 'image.PNG', bytes: new TextEncoder().encode(content) })
const createInput = () => ({ documentId: 'figure', operationId: 'import', expectedDocumentRevision: 0, image: image('original') })
const approved: FigureConfirmation = async () => ({ decision: 'confirmed', confirmationId: 'native-approval' })
async function setup(confirm: FigureConfirmation = approved) {
  const fs = new MemoryFiles()
  const store = new FigureStore('/authorized', fs, confirm)
  await store.create(createInput())
  return { fs, store }
}
async function candidate(store: FigureStore, revisionId = 'candidate', operationId = 'generate') {
  const doc = await store.read('figure')
  const current = doc.revisions.find(r => r.metadata.revisionId === doc.currentRevisionId)!.metadata
  const input = { documentId: 'figure', operationId, expectedDocumentRevision: doc.documentRevision, image: image(revisionId), baselineRevisionId: current.revisionId, baselineHash: current.image.sha256 }
  return { input, result: await store.addCandidate(input) }
}
const decision = (expectedDocumentRevision = 2, operationId = 'accept', revisionId = 'candidate') => ({ documentId: 'figure', expectedDocumentRevision, operationId, revisionId })

test('exact layout, immutable snapshot, pointer acceptance, optional real generation, restart and original receipts', async () => {
  const { fs, store } = await setup()
  const { input, result } = await candidate(store)
  const before = fs.writes.filter(p => p.includes('/images/')).length
  const accepted = await store.acceptCandidate(decision())
  assert.equal(accepted.currentRevisionId, 'candidate')
  assert.equal(fs.writes.filter(p => p.includes('/images/')).length, before)
  const restart = new FigureStore('/authorized', fs, approved)
  assert.deepEqual(await restart.addCandidate(input), result)
  assert.deepEqual(await restart.create(createInput()), { documentId: 'figure', documentRevision: 1, status: 'created', revisionId: 'original', currentRevisionId: 'original' })
  assert.deepEqual(await restart.acceptCandidate(decision()), accepted)
  const doc = await restart.read('figure')
  assert.equal(doc.documentRevision, 3)
  assert.equal(doc.acceptances[0].confirmationId, 'native-approval')
  assert.equal(doc.revisions[0].metadata.generation, undefined)
  assert.deepEqual([...fs.files.keys()].sort(), [
    '.scientific-figures/documents/figure/document.json',
    '.scientific-figures/documents/figure/images/candidate.PNG',
    '.scientific-figures/documents/figure/images/original.PNG',
    '.scientific-figures/documents/figure/revisions/candidate.json',
    '.scientific-figures/documents/figure/revisions/original.json',
    '.scientific-figures/store.json'
  ])
  await assert.rejects(restart.addCandidate({ ...input, image: image('candidate', 'changed') }), /different input/)
  await assert.rejects(restart.addCandidate({ ...input, operationId: 'different', expectedDocumentRevision: 3, baselineRevisionId: 'candidate', baselineHash: doc.revisions[1].metadata.image.sha256 }), /Revision ID already/)
})

test('trusted render request replay survives nondeterministic output and rejects changed request', async () => {
  const fs = new MemoryFiles()
  const store = new FigureStore('/authorized', fs)
  const requestKey = createHash('sha256').update('full-action-request-and-data').digest('hex')
  assert.equal(await store.replayOperation('figure', 'import', requestKey), undefined)
  const input = { ...createInput(), requestKey }
  const result = await store.create(input)
  assert.deepEqual(await store.create({ ...input, image: image('original', 'different-render-timestamp') }), result)
  await store.saveAnnotations({ documentId: 'figure', operationId: 'annotations', expectedDocumentRevision: 1, annotations: [] })
  assert.deepEqual(await new FigureStore('/authorized', fs).replayOperation('figure', 'import', requestKey), result)
  await assert.rejects(store.replayOperation('figure', 'import', '0'.repeat(64)), /different request/)
  await assert.rejects(store.create({ ...input, requestKey: '0'.repeat(64) }), /different input/)
  assert.equal((await store.read('figure')).revisions[0].metadata.format, 'png')
})

test('serialized writes across instances enforce optimistic revisions', async () => {
  const { fs, store } = await setup()
  const second = new FigureStore('/authorized', fs)
  const attempts = await Promise.allSettled([
    store.saveAnnotations({ documentId: 'figure', operationId: 'a', expectedDocumentRevision: 1, annotations: [] }),
    second.saveAnnotations({ documentId: 'figure', operationId: 'b', expectedDocumentRevision: 1, annotations: [] })
  ])
  assert.equal(attempts.filter(a => a.status === 'fulfilled').length, 1)
  assert.equal(attempts.filter(a => a.status === 'rejected').length, 1)
  assert.equal((await store.read('figure')).documentRevision, 2)
})

test('confirmation awaits outside lock and rechecks revision/baseline after other writes', async () => {
  let entered!: () => void
  let release!: () => void
  const enteredPromise = new Promise<void>(r => { entered = r })
  const releasePromise = new Promise<void>(r => { release = r })
  const { fs, store } = await setup(async () => { entered(); await releasePromise; return { decision: 'confirmed', confirmationId: 'approval' } })
  await candidate(store)
  const pending = store.acceptCandidate(decision())
  await enteredPromise
  const other = new FigureStore('/authorized', fs, approved)
  await other.acceptCandidate(decision(2, 'other-accept'))
  release()
  await assert.rejects(pending, /Stale document revision/)
  assert.equal((await store.read('figure')).acceptances.length, 1)
})

test('candidate corruption while awaiting confirmation prevents acceptance', async () => {
  const fs = new MemoryFiles()
  const store = new FigureStore('/authorized', fs, async () => {
    fs.files.set('.scientific-figures/documents/figure/images/candidate.PNG', new Uint8Array([0]))
    return { decision: 'confirmed', confirmationId: 'approval' }
  })
  await store.create(createInput())
  await candidate(store)
  await assert.rejects(store.acceptCandidate(decision()), /corrupt/)
  const raw = JSON.parse(new TextDecoder().decode(fs.files.get('.scientific-figures/documents/figure/document.json')))
  assert.equal(raw.currentRevisionId, 'original')
  assert.equal(raw.documentRevision, 2)
  assert.deepEqual(raw.acceptances, [])
})

test('confirmation cancellation and explicit reject/cancel preserve current; replay never confirms twice', async () => {
  let calls = 0
  const { store } = await setup(async () => { calls++; return { decision: 'cancelled' } })
  await candidate(store)
  const cancelled = await store.acceptCandidate(decision())
  assert.equal(cancelled.status, 'cancelled')
  assert.deepEqual(await store.acceptCandidate(decision()), cancelled)
  assert.equal(calls, 1)
  assert.equal((await store.read('figure')).revisions[1].status, 'candidate')
  await store.rejectCandidate(decision(3, 'reject'))
  await candidate(store, 'candidate2', 'generate2')
  await store.cancelCandidate(decision(5, 'cancel', 'candidate2'))
  const doc = await store.read('figure')
  assert.equal(doc.currentRevisionId, 'original')
  assert.equal(doc.revisions[1].status, 'rejected')
  assert.equal(doc.revisions[2].status, 'cancelled')
  assert.equal(doc.acceptances.length, 0)
})

test('stale candidate rejected after another acceptance, and no caller boolean confirmation', async () => {
  const { fs, store } = await setup()
  await candidate(store)
  await candidate(store, 'second', 'second-op')
  await store.acceptCandidate(decision(3))
  await assert.rejects(store.acceptCandidate(decision(4, 'accept-second', 'second')), /Stale candidate baseline/)
  const untrusted = new FigureStore('/authorized', fs)
  await candidate(untrusted, 'third', 'third-op')
  await assert.rejects(untrusted.acceptCandidate({ ...decision(5, 'accept-third', 'third'), confirmed: true } as never), /unrecognized|Unrecognized/)
  await assert.rejects(untrusted.acceptCandidate(decision(5, 'accept-third', 'third')), /Trusted confirmation/)
})

test('every referenced image including rejected revisions and metadata fails closed', async () => {
  for (const mode of ['missing-original', 'hash', 'length', 'metadata', 'missing-rejected']) {
    const { fs, store } = await setup()
    await candidate(store)
    await store.rejectCandidate(decision(2, 'reject'))
    const prefix = '.scientific-figures/documents/figure/'
    if (mode === 'missing-original') fs.files.delete(`${prefix}images/original.PNG`)
    if (mode === 'missing-rejected') fs.files.delete(`${prefix}images/candidate.PNG`)
    if (mode === 'hash') fs.files.set(`${prefix}images/original.PNG`, new TextEncoder().encode('XXXXXXXX'))
    if (mode === 'length') fs.files.set(`${prefix}images/original.PNG`, new Uint8Array([1]))
    if (mode === 'metadata') fs.files.set(`${prefix}revisions/candidate.json`, new TextEncoder().encode('{}'))
    await assert.rejects(new FigureStore('/authorized', fs).read('figure'), Error, mode)
    await assert.rejects(store.create(createInput()), Error, `replay verifies ${mode}`)
  }
})

test('interrupted index update recovers committed document, skips partial dirs, fails corrupt index', async () => {
  const fs = new MemoryFiles()
  fs.failIndex = true
  const store = new FigureStore('/authorized', fs)
  await assert.rejects(store.create(createInput()), /index unavailable/)
  assert.equal((await store.read('figure')).documentRevision, 1)
  fs.failIndex = false
  fs.files.set('.scientific-figures/documents/partial/images/orphan.PNG', new Uint8Array([1]))
  const restart = new FigureStore('/authorized', fs)
  assert.deepEqual(await restart.list(), [{ documentId: 'figure', path: 'documents/figure/document.json' }])
  assert.equal((await restart.create(createInput())).documentRevision, 1)
  fs.files.delete('.scientific-figures/documents/figure/document.json')
  await assert.rejects(restart.list(), /Document not found/)
  fs.files.set('.scientific-figures/store.json', new TextEncoder().encode('broken'))
  await assert.rejects(restart.list())
})

test('source preservation exact files and validation; normalized geometry instructions', async () => {
  const fs = new MemoryFiles()
  const store = new FigureStore('/authorized', fs)
  await store.create({ ...createInput(), generation: { generationId: 'g1', recipe: { data: 'inputs/table.csv' }, code: 'print(1)\n', inputs: [1, true, null] } })
  const doc = await store.read('figure')
  assert.equal(doc.revisions[0].metadata.generation?.code.path, 'documents/figure/sources/g1/code.py')
  assert.equal(new TextDecoder().decode(fs.files.get('.scientific-figures/documents/figure/sources/g1/code.py')), 'print(1)\n')
  for (const path of ['/tmp/private.csv', 'C:\\private.csv', '\\server\\private', 'file:///tmp/private']) assert.equal(sourceJsonSchema.safeParse({ source: path }).success, false)
  assert.equal(sourceJsonSchema.safeParse({ source: 'data/input.csv' }).success, true)
  assert.equal(annotationGeometrySchema.safeParse({ kind: 'box', bounds: { x: 0.8, y: 0, width: 0.3, height: 0.5 } }).success, false)
  assert.equal(annotationGeometrySchema.safeParse({ kind: 'pin', point: { x: -0.1, y: 0 } }).success, false)
  const annotation = { id: 'a1', kind: 'pin' as const, geometry: { kind: 'pin' as const, point: { x: 0.5, y: 0.5 } }, instruction: 'Increase label contrast', targetNodeIds: [], status: 'open' as const, createdAt: '2026-11-04T00:00:00.000Z', updatedAt: '2026-11-04T00:00:00.000Z' }
  const input = { documentId: 'figure', operationId: 'annotate', expectedDocumentRevision: 1, annotations: [annotation] }
  const saved = await store.saveAnnotations(input)
  assert.deepEqual((await store.read('figure')).annotations, [annotation])
  await assert.rejects(store.saveAnnotations({ ...input, annotations: [{ ...annotation, instruction: 'Changed' }] }), /different input/)
  assert.deepEqual(await store.saveAnnotations(input), saved)
  fs.files.set('.scientific-figures/documents/figure/sources/g1/inputs.json', new TextEncoder().encode('[]'))
  await assert.rejects(store.read('figure'), /corrupt/)
})

test('immutable files precede document commit; failed commit can be retried exactly', async () => {
  const { fs, store } = await setup()
  const originalAtomic = fs.writeAtomic.bind(fs)
  let fail = true
  fs.writeAtomic = async (root, path, bytes) => { if (fail && path.endsWith('document.json')) throw new Error('commit failed'); await originalAtomic(root, path, bytes) }
  const doc = await store.read('figure')
  const input = { documentId: 'figure', operationId: 'generate', expectedDocumentRevision: 1, image: image('candidate'), baselineRevisionId: 'original', baselineHash: doc.revisions[0].metadata.image.sha256 }
  await assert.rejects(store.addCandidate(input), /commit failed/)
  assert.equal((await store.read('figure')).documentRevision, 1)
  await assert.rejects(store.addCandidate({ ...input, image: image('candidate', 'different') }), /Immutable content conflict/)
  fail = false
  assert.equal((await store.addCandidate(input)).documentRevision, 2)
  const writes = fs.writes
  assert.ok(writes.indexOf('.scientific-figures/documents/figure/images/candidate.PNG') < writes.lastIndexOf('.scientific-figures/documents/figure/document.json'))
})

test('permission errors propagate with no fallback and adapter lock wraps each IO phase', async () => {
  const fs = new MemoryFiles()
  let held = false
  let locks = 0
  fs.withLock = async (_root, _key, run) => { assert.equal(held, false); held = true; locks++; try { return await run() } finally { held = false } }
  const read = fs.read.bind(fs)
  fs.read = async (root, path) => { assert.equal(held, true); return read(root, path) }
  const store = new FigureStore('/authorized', fs, async () => { assert.equal(held, false); return { decision: 'confirmed', confirmationId: 'approved' } })
  await store.create(createInput())
  await candidate(store)
  await store.acceptCandidate(decision())
  assert.ok(locks >= 6)
  fs.read = async () => { throw new Error('DSH denied') }
  await assert.rejects(store.read('figure'), /DSH denied/)
})
