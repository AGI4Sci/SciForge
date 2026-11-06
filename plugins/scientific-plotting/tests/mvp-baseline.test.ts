import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'
import { createCanvas } from '@napi-rs/canvas'
import { dispatch } from '../src/figure-store/worker.js'
import { FigureStore, type FigureDocument, type FigureOperationResult } from '../src/figure-store/index.js'
import { ConfinedFigureFiles } from '../src/figure-store/node-files.js'
import type { CodeRevision, CodeRevisionSummary, HistoryPage } from '../src/figure-store/code-runs.js'

async function fixture(t: TestContext) {
  const tempRoot = await realpath(tmpdir())
  const root = await mkdtemp(join(tempRoot, 'scientific-baseline-test-'))
  t.after(async () => {
    assert.equal(await realpath(root), resolve(root))
    assert.ok(root.startsWith(join(tempRoot, 'scientific-baseline-test-')))
    await rm(root, { recursive: true, force: true })
  })
  const canvas = createCanvas(3, 2)
  const bytes = canvas.toBuffer('image/png')
  await writeFile(join(root, 'provided.png'), bytes)
  await writeFile(join(root, 'data.csv'), 'x\n1\n')
  const call = (action: string, input: Record<string, unknown> = {}) => dispatch({ action, input, workspaceRoot: root })
  const save = { codeRevisionId: 'code-one', entrypoint: 'main.py', files: [{ path: 'main.py', content: 'raise RuntimeError("not executed")' }], inputPaths: ['data.csv'] }
  const code = await call('saveCode', save) as CodeRevision
  const input = { documentId: 'figure', operationId: 'import-baseline', expectedDocumentRevision: 0, path: 'provided.png', codeRevisionId: code.codeRevisionId }
  const read = async () => await call('read', { documentId: 'figure' }) as FigureDocument
  return { root, bytes, call, code, save, input, read }
}

test('actual importBaseline preserves exact provided bytes and frozen code/data without claiming execution', async t => {
  const f = await fixture(t)
  const result = await f.call('importBaseline', f.input) as FigureOperationResult
  const doc = await f.read()
  const metadata = doc.revisions[0]!.metadata
  const codeBytes = await readFile(join(f.root, '.scientific-figures/codes/code-one/code.json'))
  assert.equal(result.status, 'created')
  assert.equal(doc.originalRevisionId, result.revisionId)
  assert.deepEqual(await readFile(join(f.root, '.scientific-figures', metadata.image.path)), f.bytes)
  assert.deepEqual(metadata.sourceCode, {
    codeRevisionId: 'code-one',
    code: { path: 'codes/code-one/code.json', sha256: createHash('sha256').update(codeBytes).digest('hex'), byteLength: codeBytes.length },
    provenance: 'supplied', verification: 'unverified'
  })
  assert.equal(metadata.execution, undefined)
  assert.equal(metadata.generation, undefined)
  assert.deepEqual(await f.call('listRuns'), { items: [], nextCursor: null, errors: [] })
  await writeFile(join(f.root, 'data.csv'), 'x\n999\n')
  assert.equal((await f.read()).revisions[0]!.metadata.sourceCode!.code.sha256, metadata.sourceCode!.code.sha256)
  assert.equal((await readFile(join(f.root, '.scientific-figures', f.code.inputs[0]!.snapshot.path))).toString(), 'x\n1\n')
  // Later candidates and code revisions retain every original immutable version.
  await f.call('saveCode', { ...f.save, codeRevisionId: 'code-two', parentCodeRevisionId: 'code-one' })
  await f.call('addCandidate', { documentId: 'figure', operationId: 'candidate', expectedDocumentRevision: 1, path: 'provided.png', baselineRevisionId: metadata.revisionId, baselineHash: metadata.image.sha256 })
  const later = await f.read()
  assert.equal(later.revisions.length, 2)
  assert.deepEqual(later.revisions[0]!.metadata, metadata)
  assert.equal((await f.call('listCodes') as HistoryPage<CodeRevisionSummary>).items.length, 2)
  assert.deepEqual(await f.call('importBaseline', f.input), result)
  await assert.rejects(f.call('importOriginal', f.input), /different input/)
  await assert.rejects(f.call('importBaseline', { ...f.input, codeRevisionId: 'code-two' }), /different input/)
  await writeFile(join(f.root, 'provided.png'), createCanvas(4, 4).toBuffer('image/png'))
  await assert.rejects(f.call('importBaseline', f.input), /different input/)
})

test('actual importBaseline requires a saved valid revision and revision zero before committing', async t => {
  const f = await fixture(t)
  await assert.rejects(f.call('importBaseline', { ...f.input, codeRevisionId: 'missing' }), /Missing snapshot/)
  await assert.rejects(f.call('importBaseline', { ...f.input, expectedDocumentRevision: 1 }), /revision zero/)
  assert.deepEqual(await f.call('list'), [])
  await writeFile(join(f.root, '.scientific-figures', f.code.inputs[0]!.snapshot.path), 'corrupt')
  await assert.rejects(f.call('importBaseline', f.input), /Corrupt snapshot/)
  assert.deepEqual(await f.call('list'), [])
})

test('actual read, image and retry reject corrupt linked code metadata, files and frozen inputs', async t => {
  for (const target of ['code.json', 'files/main.py', 'inputs/data.csv']) {
    await t.test(target, async t => {
      const f = await fixture(t)
      const result = await f.call('importBaseline', f.input) as FigureOperationResult
      await writeFile(join(f.root, '.scientific-figures/codes/code-one', target), target === 'code.json' ? JSON.stringify({ ...f.code, parameters: { changed: true } }) : 'corrupt')
      await assert.rejects(f.read(), /Corrupt snapshot/)
      await assert.rejects(f.call('image', { documentId: 'figure', revisionId: result.revisionId }), /Corrupt snapshot/)
      await assert.rejects(f.call('importBaseline', f.input), /Corrupt snapshot/)
    })
  }
})

test('store rejects forged supplied code references and provenance labels', async t => {
  const f = await fixture(t)
  await f.call('importBaseline', f.input)
  const metadata = (await f.read()).revisions[0]!.metadata
  const sourceCode = metadata.sourceCode!
  const store = new FigureStore(f.root, new ConfinedFigureFiles())
  const create = { documentId: 'other', operationId: 'import', expectedDocumentRevision: 0, image: { revisionId: 'original', originalFilename: 'provided.png', bytes: Uint8Array.from(f.bytes) } }
  await assert.rejects(store.create({ ...create, sourceCode: { ...sourceCode, codeRevisionId: 'different' } }), /Source code path mismatch/)
  await assert.rejects(store.create({ ...create, sourceCode: { ...sourceCode, code: { ...sourceCode.code, sha256: '0'.repeat(64) } } }), /Corrupt snapshot/)
  await assert.rejects(store.create({ ...create, sourceCode: { ...sourceCode, verification: 'verified' } } as never))
})

test('actual saveCode child omission inherits frozen inputs; explicit paths refresh and [] clears', async t => {
  const f = await fixture(t)
  await writeFile(join(f.root, 'data.csv'), 'x\n2\n')
  const { inputPaths: _inputPaths, ...source } = f.save
  const childRequest = { ...source, codeRevisionId: 'child', parentCodeRevisionId: 'code-one' }
  const child = await f.call('saveCode', childRequest) as CodeRevision
  assert.equal(child.inputs.length, 1)
  assert.equal(child.inputs[0]!.snapshot.path, 'codes/child/inputs/data.csv')
  assert.notEqual(child.inputs[0]!.snapshot.path, f.code.inputs[0]!.snapshot.path)
  assert.equal(child.inputs[0]!.snapshot.sha256, f.code.inputs[0]!.snapshot.sha256)
  assert.equal((await readFile(join(f.root, '.scientific-figures', child.inputs[0]!.snapshot.path))).toString(), 'x\n1\n')
  const refreshed = await f.call('saveCode', { ...childRequest, codeRevisionId: 'refreshed', inputPaths: ['data.csv'] }) as CodeRevision
  assert.equal((await readFile(join(f.root, '.scientific-figures', refreshed.inputs[0]!.snapshot.path))).toString(), 'x\n2\n')
  const cleared = await f.call('saveCode', { ...childRequest, codeRevisionId: 'cleared', inputPaths: [] }) as CodeRevision
  assert.deepEqual(cleared.inputs, [])
  await rm(join(f.root, 'data.csv'))
  assert.deepEqual(await f.call('saveCode', childRequest), child)
  await assert.rejects(f.call('saveCode', { ...childRequest, inputPaths: [] }), /different request/)
  await assert.rejects(f.call('saveCode', { ...childRequest, inputPaths: ['data.csv'] }), /different request/)
  await assert.rejects(f.call('saveCode', { ...childRequest, codeRevisionId: 'cleared' }), /different request/)
  const grandchild = await f.call('saveCode', { ...source, codeRevisionId: 'grandchild', parentCodeRevisionId: 'child' }) as CodeRevision
  assert.equal(grandchild.inputs[0]!.snapshot.sha256, child.inputs[0]!.snapshot.sha256)
  assert.notEqual(grandchild.inputs[0]!.snapshot.path, child.inputs[0]!.snapshot.path)
  for (const code of [f.code, child, grandchild]) {
    const verified = await f.call('readCode', { codeRevisionId: code.codeRevisionId }) as CodeRevision
    assert.deepEqual(verified.inputs, code.inputs, 'every frozen version verifies after original data deletion')
    const bytes = await readFile(join(f.root, '.scientific-figures', verified.inputs[0]!.snapshot.path))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), code.inputs[0]!.snapshot.sha256)
  }
  assert.equal((await f.call('listCodes') as HistoryPage<CodeRevisionSummary>).items.length, 5)
  await writeFile(join(f.root, '.scientific-figures', child.inputs[0]!.snapshot.path), 'corrupt')
  await assert.rejects(f.call('saveCode', { ...source, codeRevisionId: 'invalid-child', parentCodeRevisionId: 'child' }), /Corrupt snapshot/)
})
