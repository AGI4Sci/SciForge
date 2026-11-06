import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodeRunStore } from '../src/figure-store/code-runs.js'
import { ConfinedFigureFiles } from '../src/figure-store/node-files.js'
import { FigureStore } from '../src/figure-store/index.js'

const code = { codeRevisionId: 'code-one', entrypoint: 'main.py', files: [{ path: 'main.py', content: 'print(1)' }, { path: 'helpers/util.py', content: 'x=1' }], parameters: { n: 1 }, inputPaths: [] }
const success = { status: 'completed' as const, exitCode: 0, stdout: 'ok', stderr: '', environment: { language: 'python', pythonVersion: 'test' }, outputs: [{ path: 'plot.png', bytes: new Uint8Array([1, 2, 3]) }] }
async function fixture(t: any) { const root = await mkdtemp(join(tmpdir(), 'scientific-code-test-')); t.after(() => rm(root, { recursive: true, force: true })); return { root, store: new CodeRunStore(root, new ConfinedFigureFiles()) } }

test('code revisions freeze multiple files, explicit inputs and parent relation; retries do not resnapshot', async t => {
 const { root, store } = await fixture(t); await writeFile(join(root, 'data.csv'), 'a\n1')
 const first = await store.save({ ...code, inputPaths: ['data.csv'] }); await writeFile(join(root, 'data.csv'), 'a\n2')
 assert.deepEqual(await store.save({ ...code, inputPaths: ['data.csv'] }), first)
 assert.equal(Buffer.from(await store.verify(first.inputs[0]!.snapshot)).toString(), 'a\n1')
 const second = await store.save({ ...code, codeRevisionId: 'code-two', parentCodeRevisionId: first.codeRevisionId })
 assert.equal(second.parentCodeRevisionId, first.codeRevisionId); assert.equal((await store.source(first.codeRevisionId)).sourceFiles.length, 2)
 await assert.rejects(store.save({ ...code, inputPaths: ['data.csv'], files: [{ path: 'main.py', content: 'changed' }] }), /different request/)
})
test('code snapshots reject escaping paths, duplicate files and absent parents', async t => {
 const { store } = await fixture(t)
 await assert.rejects(store.save({ ...code, entrypoint: '../main.py' }))
 await assert.rejects(store.save({ ...code, files: [code.files[0], code.files[0]] }), /Duplicate/)
 await assert.rejects(store.save({ ...code, parentCodeRevisionId: 'missing' }), /Missing/)
})
test('runs preserve original result, reject identity mismatch and persist failures without outputs', async t => {
 const { store } = await fixture(t); await store.save(code); let count = 0
 const a = await store.execute('run-one', 'code-one', async () => { count++; return success })
 assert.deepEqual(await store.execute('run-one', 'code-one', async () => { throw Error('should not execute') }), a); assert.equal(count, 1)
 await store.save({ ...code, codeRevisionId: 'code-two' }); await assert.rejects(store.execute('run-one', 'code-two', async () => success), /different code/)
 const failed = await store.execute('run-failed', 'code-one', async () => ({ ...success, status: 'failed', exitCode: 1, stderr: 'error', outputs: [] }))
 assert.equal(failed.status, 'failed'); assert.equal(failed.outputs.length, 0); assert.equal((await store.listRuns()).items.length, 2)
})
test('long prefixed refs and pending reservations retain valid identities and interrupted inventory', async t => {
 const { store } = await fixture(t)
 const codeRevisionId = 'c'.repeat(128)
 const filePath = 'helpers/' + 'm'.repeat(180) + '.py'
 await store.save({ ...code, codeRevisionId, files: [...code.files, { path: filePath, content: 'x=1' }] })
 assert.equal((await store.code(codeRevisionId)).files.length, 3)
 await store.reserveRun('pending-run', codeRevisionId)
 await store.recordStage('pending-run', '.runs-temp/python-abc', { dev: 1, ino: 2 })
 assert.equal((await store.listPending())[0]!.runId, 'pending-run')
 await assert.rejects(store.reserveRun('pending-run', codeRevisionId), /reserved/)
 await assert.rejects(store.save({ ...code, codeRevisionId: 'missing-input', inputPaths: ['missing.csv'] }), /Input missing/)
 assert.equal((await store.listCodes()).items.length, 1)
 const run = await store.execute('pending-run', codeRevisionId, async () => ({ ...success, outputs: [{ path: 'nested/' + 'x'.repeat(180) + '.png', bytes: new Uint8Array([1]) }] }))
 assert.equal(run.outputs.length, 1)
 assert.equal((await store.listPending()).length, 0)
})

test('figure publication binds exact successful run output and rechecks linked snapshots on read', async t => {
 const { root, store } = await fixture(t); await store.save(code); const run = await store.execute('run-one', 'code-one', async () => success)
 const figures = new FigureStore(root, new ConfinedFigureFiles())
 const execution = { codeRevisionId: 'code-one', runId: 'run-one', run: await store.reference('runs/run-one/run.json'), output: run.outputs[0]! }
 await figures.create({ documentId: 'doc', operationId: 'publish', expectedDocumentRevision: 0, image: { revisionId: 'r-one', originalFilename: 'plot.png', bytes: success.outputs[0]!.bytes }, execution })
 assert.equal((await figures.read('doc')).revisions[0]!.metadata.execution!.runId, 'run-one')
 await assert.rejects(figures.create({ documentId: 'bad', operationId: 'bad', expectedDocumentRevision: 0, image: { revisionId: 'r-bad', originalFilename: 'plot.png', bytes: new Uint8Array([9]) }, execution }), /link mismatch/)
 await writeFile(join(root, '.scientific-figures/codes/code-one/files/main.py'), 'tampered')
 await assert.rejects(figures.read('doc'), /Corrupt snapshot/)
})
