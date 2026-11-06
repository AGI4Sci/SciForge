import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, realpath, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodeRunStore } from '../src/figure-store/code-runs.js'
import { ConfinedFigureFiles } from '../src/figure-store/node-files.js'

async function fixture(t: any) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'scientific-history-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const files = new ConfinedFigureFiles()
  const store = new CodeRunStore(root, files)
  const saved = await store.save({ codeRevisionId: 'code-A', entrypoint: 'main.py', files: [{ path: 'main.py', content: 'source secret' }], parameters: { secret: 'parameter secret' } })
  const run = await store.execute('run-A', 'code-A', async () => ({ status: 'completed', exitCode: 0, stdout: 'log secret', stderr: '', environment: { secret: 'environment secret' }, outputs: [{ path: 'figure.png', bytes: new Uint8Array([1]) }] }))
  return { root, files, store, saved, run }
}

test('history scans bounded metadata pages in deterministic ID order, isolates corrupt records and returns compact summaries', async t => {
  const f = await fixture(t)
  for (const value of ['b', 'z', 'Y', '0', 'm']) {
    const codeRevisionId = `code-${value}`, runId = `run-${value}`
    await mkdir(join(f.root, '.scientific-figures/codes', codeRevisionId), { recursive: true })
    await writeFile(join(f.root, '.scientific-figures/codes', codeRevisionId, 'code.json'), JSON.stringify({ ...f.saved, codeRevisionId, createdAt: value === 'z' ? '2020-01-01T00:00:00Z' : f.saved.createdAt }))
    await mkdir(join(f.root, '.scientific-figures/runs', runId), { recursive: true })
    await writeFile(join(f.root, '.scientific-figures/runs', runId, 'run.json'), value === 'm' ? '{broken' : JSON.stringify({ ...f.run, runId }))
  }
  await writeFile(join(f.root, '.scientific-figures/codes/code-m/code.json'), '{broken')
  await writeFile(join(f.root, '.scientific-figures/codes/code-A/files/main.py'), 'corrupt source')
  await writeFile(join(f.root, '.scientific-figures/runs/run-A/outputs/figure.png'), 'corrupt output')
  const original = f.files.read.bind(f.files)
  const reads: string[] = []
  f.files.read = async (root, path) => {
    reads.push(path)
    assert.match(path, /\/(?:code|run)\.json$/, 'lists only read record metadata, never source/input/output bytes')
    return original(root, path)
  }
  for (const kind of ['Codes', 'Runs'] as const) {
    reads.length = 0
    const list = (input: { limit?: number; cursor?: string }) => kind === 'Codes' ? f.store.listCodes(input) : f.store.listRuns(input)
    const prefix = kind === 'Codes' ? 'code' : 'run'
    const first = await list({ limit: 2 })
    assert.equal(reads.length, 2)
    assert.equal(first.nextCursor, `${prefix}-m`)
    assert.equal(first.items.length, 1)
    assert.equal(first.errors[0]!.id, `${prefix}-m`)
    assert.ok(first.errors[0]!.error.length <= 1024)
    const second = await list({ limit: 2, cursor: first.nextCursor! })
    assert.equal(second.nextCursor, `${prefix}-Y`)
    const third = await list({ limit: 2, cursor: second.nextCursor! })
    assert.equal(third.nextCursor, null)
    const items = [...first.items, ...second.items, ...third.items]
    assert.deepEqual(items.map(item => 'runId' in item ? item.runId : item.codeRevisionId), ['z', 'b', 'Y', 'A', '0'].map(id => `${prefix}-${id}`))
    for (const item of items) {
      for (const field of ['files', 'inputs', 'parameters', 'stdout', 'stderr', 'environment', 'outputs', 'sourceFiles']) assert.equal(field in item, false)
    }
  }
  f.files.read = original
  await assert.rejects(f.store.code('code-A'), /Corrupt snapshot/)
  await assert.rejects(f.store.run('run-A'), /Corrupt snapshot/)
})

test('history rejects unbounded limits and unsafe cursors; deleted cursors still advance deterministically', async t => {
  const f = await fixture(t)
  for (const limit of [0, -1, 51, 1.5, Infinity]) {
    await assert.rejects(f.store.listCodes({ limit }))
    await assert.rejects(f.store.listRuns({ limit }))
  }
  await assert.rejects(f.store.listCodes({ cursor: '../escape' }))
  await assert.rejects(f.store.listRuns({ cursor: '' }))
  assert.equal((await f.store.listCodes({ limit: 50, cursor: 'code-B' })).items[0]!.codeRevisionId, 'code-A')
  assert.deepEqual(await f.store.listRuns({ cursor: 'run-0' }), { items: [], nextCursor: null, errors: [] })
})
