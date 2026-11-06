import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, realpath, rm, stat, writeFile, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { dispatch } from '../src/figure-store/worker.js'
import { ConfinedFigureFiles } from '../src/figure-store/node-files.js'
import type { PreparedPythonSnapshot } from '../src/execution/index.js'
import { CodeRunStore, type CodeRun } from '../src/figure-store/code-runs.js'

async function fixture(t: any) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'scientific-recovery-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const input = { runId: 'run-one', codeRevisionId: 'code-one' }
  const call = (action: string, execution?: Record<string, any>) => dispatch({ action, input, workspaceRoot: root, ...(execution ? { execution } : {}) })
  await dispatch({ action: 'saveCode', input: { codeRevisionId: input.codeRevisionId, entrypoint: 'main.py', files: [{ path: 'main.py', content: 'print(1)' }] }, workspaceRoot: root })
  const { prepared } = await call('preparePython') as { prepared: PreparedPythonSnapshot }
  await writeFile(join(prepared.stageRoot, 'environment.json'), JSON.stringify({ pythonVersion: '3.test', platform: 'test-platform', implementation: 'CPython', machine: 'test-machine', packages: [] }))
  const png = createCanvas(2, 2).toBuffer('image/png')
  await writeFile(join(prepared.stageRoot, 'outputs/figure.png'), png)
  const execution = { prepared, outcome: { exitCode: 0, stdout: 'original process log', stderr: '' } }
  return { root, input, call, prepared, execution, png }
}

for (const failAt of ['output', 'commit']) {
  test(`actual finalization retains stage and immutable outcome after ${failAt} failure; same ID safely retries`, async t => {
    const f = await fixture(t)
    const original = ConfinedFigureFiles.prototype.writeImmutable
    let failures = 0
    ConfinedFigureFiles.prototype.writeImmutable = async function(root, path, bytes) {
      if (!failures && (failAt === 'commit' ? path.endsWith('/run.json') : path.endsWith('/outputs/figure.png'))) { failures++; throw new Error('Injected durable write failure') }
      return original.call(this, root, path, bytes)
    }
    t.after(() => { ConfinedFigureFiles.prototype.writeImmutable = original })
    await assert.rejects(f.call('finalizePython', f.execution), /Injected durable write failure/)
    assert.equal(failures, 1)
    assert.ok((await stat(f.prepared.stageRoot)).isDirectory(), 'stage survives failed durable commit')
    const outcomePath = join(f.root, '.scientific-figures/runs/run-one/outcome.json')
    const outcomeBefore = await readFile(outcomePath)
    assert.deepEqual(JSON.parse(outcomeBefore.toString()), f.execution)
    const pending = await f.call('listPendingRuns') as Array<{ runId: string; recoverable: boolean }>
    assert.deepEqual(pending.map(p => [p.runId, p.recoverable]), [['run-one', true]])
    const recovery = await f.call('preparePython') as { recovery: boolean; prepared: PreparedPythonSnapshot; outcome: unknown }
    assert.equal(recovery.recovery, true)
    assert.deepEqual(recovery.prepared, f.prepared)
    const run = await f.call('finalizePython', { prepared: recovery.prepared, outcome: recovery.outcome }) as CodeRun
    assert.equal(run.status, 'completed', run.error)
    assert.equal(run.stdout, 'original process log')
    const output = run.outputs.find(output => output.path.endsWith('/figure.png'))!
    assert.deepEqual(await readFile(join(f.root, '.scientific-figures', output.path)), f.png)
    await assert.rejects(stat(f.prepared.stageRoot), { code: 'ENOENT' })
    assert.deepEqual(await readFile(outcomePath), outcomeBefore)
    assert.deepEqual(await f.call('readRun'), run)
    assert.deepEqual(await f.call('listPendingRuns'), [])
    assert.deepEqual(await f.call('preparePython'), { completed: run })
  })
}

test('pending run without outcome never reruns, removes staging or invents a terminal result', async t => {
  const f = await fixture(t)
  await assert.rejects(f.call('preparePython'), /without a durable process outcome/)
  assert.ok((await stat(f.prepared.stageRoot)).isDirectory())
  const pending = await f.call('listPendingRuns') as Array<{ recoverable: boolean }>
  assert.equal(pending[0]!.recoverable, false)
  await assert.rejects(f.call('readRun'), /Missing snapshot/)
})

test('uncertain process range preserves staging and cannot become a recovery candidate', async t => {
  const f = await fixture(t)
  const run = await f.call('finalizePython', { ...f.execution, outcome: { ...f.execution.outcome, quiescent: false, error: 'still live' } }) as CodeRun
  assert.equal(run.status, 'failed')
  assert.match(run.error!, /staging retained/)
  assert.ok((await stat(f.prepared.stageRoot)).isDirectory())
  assert.deepEqual(run.outputs, [])
})

test('changed stage identity prevents recovery and preserves the replacement for inspection', async t => {
  const f = await fixture(t)
  const store = new CodeRunStore(f.root, new ConfinedFigureFiles())
  await store.recordOutcome(f.input.runId, f.execution)
  // The stored identity must not authorize any other staging object.
  await writeFile(join(f.root, '.scientific-figures/runs/run-one/stage.json'), JSON.stringify({ path: '.runs-temp/python-other', identity: f.prepared.identity }))
  const pending = await f.call('listPendingRuns') as Array<{ recoverable: boolean; recoveryError?: string }>
  assert.equal(pending[0]!.recoverable, false)
  assert.match(pending[0]!.recoveryError!, /identity mismatch/)
  await assert.rejects(f.call('preparePython'), /identity mismatch/)
  assert.ok((await stat(f.prepared.stageRoot)).isDirectory())
})

test('publishRun clearly rejects analysis files without creating a figure', async t => {
  const f = await fixture(t)
  const store = new CodeRunStore(f.root, new ConfinedFigureFiles())
  const run = await store.execute(f.input.runId, f.input.codeRevisionId, async () => ({ status: 'completed', exitCode: 0, stdout: '', stderr: '', environment: {}, outputs: [{ path: 'analysis.csv', bytes: Buffer.from('x\\n1\\n') }] }))
  await assert.rejects(dispatch({ action: 'publishRun', workspaceRoot: f.root, input: { runId: run.runId, outputPath: run.outputs[0]!.path, documentId: 'figure', operationId: 'publish', expectedDocumentRevision: 0 } }), /Only PNG run outputs/)
  assert.deepEqual(await dispatch({ action: 'list', workspaceRoot: f.root, input: {} }), [])
})

test('surviving run lock is never stolen and stage remains intact', async t => {
  const f = await fixture(t)
  const lock = join(f.root, '.scientific-figures/.run-run-one.lock')
  await mkdir(lock)
  await assert.rejects(f.call('preparePython'), /busy.*manual inspection/)
  assert.ok((await stat(lock)).isDirectory())
  assert.ok((await stat(f.prepared.stageRoot)).isDirectory())
})
