import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  copyPlainTree, ensureManifest, inside, loadScienceAgentBenchRows, positiveInteger,
  prepareScienceAgentBenchWorkspace, readJson, scoreScienceAgentBenchWorkspace, separateRoots,
  validateRecord, writeJson
} from './scientific-benchmark-support.mjs'
import { runScienceAgentBench } from './run-scienceagentbench-verified.mjs'
import { rescoreScienceAgentBench } from './rescore-scienceagentbench-verified.mjs'
import { summarizeScienceAgentBench } from './summarize-scienceagentbench-verified.mjs'
import { runResearchClawBench } from './researchclawbench-run.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'scientific-benchmark-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const benchmarkRoot = join(root, 'benchmark'), outputRoot = join(root, 'output')
  await mkdir(join(benchmarkRoot, 'datasets/input'), { recursive: true })
  await writeFile(join(benchmarkRoot, 'datasets/input/data.csv'), 'a\n1\n')
  await mkdir(join(benchmarkRoot, 'eval_programs/gold_results'), { recursive: true })
  await writeFile(join(benchmarkRoot, 'eval_programs/gold_results/reference.txt'), 'reference')
  const row = { instance_id: '1', task_inst: 'Analyze the input.', output_fname: 'pred_results/result.txt',
    eval_script_name: 'grade.py', dataset_folder_tree: '|-- input/\n|---- data.csv' }
  const rowsPath = join(root, 'rows.json')
  await writeJson(rowsPath, { rows: [{ row }] })
  await writeFile(join(benchmarkRoot, 'eval_programs/grade.py'), `from pathlib import Path
assert __name__ == '__main__'
assert Path('benchmark/eval_programs/gold_results/reference.txt').read_text() == 'reference'
print('diagnostic')
print((int(Path('pred_results/result.txt').read_text() == 'correct'), 'artifact comparison'))
`)
  const env = { SAB_ROWS: rowsPath, SAB_BENCHMARK: benchmarkRoot, SAB_OUTPUT: outputRoot, SAB_MODEL: 'test-model', SAB_PYTHON: process.env.SAB_PYTHON || 'python3' }
  return { root, benchmarkRoot, outputRoot, row, rowsPath, env }
}

// Tests the real canonical executor; only its external runtime is a deterministic fixture.
function fakeRuntime(onTurn = async () => {}, running = false) {
  let started = false, begin
  const begun = new Promise(resolve => { begin = resolve })
  const calls = []
  return {
    calls,
    startThread: async input => { calls.push(['startThread', input]); return { id: 'thread-1', runtimeId: input.runtimeId } },
    readThreadStatus: async () => ({ id: 'thread-1', runtimeId: 'codex', latestSeq: started && !running ? 1 : 0,
      latestTurnId: started ? 'turn-1' : undefined, latestTurnStatus: started ? (running ? 'running' : 'completed') : undefined }),
    startTurn: async input => {
      calls.push(['startTurn', input]); await onTurn(input); started = true; begin()
      return { threadId: 'thread-1', turnId: 'turn-1' }
    },
    async *subscribeEvents({ signal }) {
      await begun
      if (running) { if (!signal.aborted) await once(signal, 'abort'); return }
      yield { kind: 'turn_lifecycle', runtimeId: 'codex', threadId: 'thread-1', turnId: 'turn-1', state: 'completed', seq: 1 }
    },
    interruptTurn: async input => { calls.push(['interruptTurn', input]) },
    deleteThread: async input => { calls.push(['deleteThread', input]) },
    close: async () => { calls.push(['close']) }
  }
}

async function readyWorkspace(f) {
  const workspace = await prepareScienceAgentBenchWorkspace(f.row, f.benchmarkRoot, join(f.outputRoot, 'workspaces'))
  await writeFile(join(workspace, f.row.output_fname), 'correct')
  return workspace
}

const score = (f, workspace, extra = {}) => scoreScienceAgentBenchWorkspace({
  row: f.row, workspace, benchmarkRoot: f.benchmarkRoot, outputRoot: f.outputRoot,
  python: f.env.SAB_PYTHON, timeoutMs: 3000, ...extra
})

test('rejects missing configuration before contacting a runtime', async () => {
  const unexpected = () => { throw new Error('Runtime must not start') }
  await assert.rejects(runResearchClawBench({ RCB_TASK_ID: 'a', RCB_MODEL: 'm' }, unexpected), /RCB_WORKSPACE is required/)
  await assert.rejects(runScienceAgentBench({}, unexpected), /SAB_ROWS is required/)
  await assert.rejects(rescoreScienceAgentBench({}), /SAB_OUTPUT is required/)
})

test('validates numeric budgets and path traversal without resolving empty input', () => {
  for (const invalid of ['0', '-1', 'NaN', '1.5', '', 'Infinity', '9007199254740992']) assert.throws(() => positiveInteger(invalid, 'budget', 100), /positive safe integer/)
  assert.equal(positiveInteger(undefined, 'budget', 100), 100)
  for (const invalid of ['../secret', '/tmp/file', 'a/../../file', 'a\\file', 'a//file']) assert.throws(() => inside('/workspace', invalid), /path|Path/)
  assert.equal(inside('/workspace', 'a/file'), '/workspace/a/file')
})

test('rejects nested roots including aliases through symlinked parents', async t => {
  const f = await fixture(t)
  await symlink(f.benchmarkRoot, join(f.root, 'alias'))
  await assert.rejects(separateRoots(f.benchmarkRoot, join(f.root, 'alias/new')), /separate/)
  await separateRoots(f.benchmarkRoot, f.outputRoot)
})

test('selects dataset IDs and rejects missing, duplicate, unknown or unsafe tasks', async t => {
  const f = await fixture(t)
  const result = await loadScienceAgentBenchRows(f.rowsPath, { SAB_INSTANCE_IDS: '1', SAB_LIMIT: '1' })
  assert.equal(result.rows.length, 1)
  await assert.rejects(loadScienceAgentBenchRows(f.rowsPath, { SAB_INSTANCE_IDS: '2' }), /Unknown requested/)
  await writeJson(f.rowsPath, { rows: [{ row: f.row }, { row: f.row }] })
  await assert.rejects(loadScienceAgentBenchRows(f.rowsPath, {}), /Duplicate/)
  await writeJson(f.rowsPath, { rows: [{ row: { ...f.row, output_fname: 'benchmark/eval_programs/grade.py' } }] })
  await assert.rejects(loadScienceAgentBenchRows(f.rowsPath, {}), /overwrite/)
})

test('keeps copied data independent and never puts grader/gold into Agent workspace', async t => {
  const f = await fixture(t)
  const workspace = await readyWorkspace(f)
  assert.deepEqual(await readdir(join(workspace, 'benchmark')), ['datasets'])
  await writeFile(join(workspace, 'benchmark/datasets/input/data.csv'), 'changed')
  assert.equal(await readFile(join(f.benchmarkRoot, 'datasets/input/data.csv'), 'utf8'), 'a\n1\n')
  await symlink(join(f.benchmarkRoot, 'datasets/input'), join(f.root, 'linked'))
  await assert.rejects(copyPlainTree(join(f.root, 'linked'), join(f.root, 'copy')), /Symlinks/)
})

test('does not overwrite a manifest with a different model, task set, or budget', async t => {
  const f = await fixture(t)
  const identity = { benchmark: 'test', benchmarkRoot: f.benchmarkRoot, datasetDigest: 'digest', runtimeId: 'codex', model: 'm', expectedIds: ['1'] }
  await ensureManifest(f.outputRoot, identity)
  await ensureManifest(f.outputRoot, identity)
  await assert.rejects(ensureManifest(f.outputRoot, { ...identity, model: 'other' }), /configuration changed/)
  await assert.rejects(ensureManifest(f.outputRoot, { ...identity, expectedIds: ['2'] }), /configuration changed/)
})

test('runs the canonical upstream __main__, retains logs, and extracts pass/fail separately from exit status', async t => {
  const f = await fixture(t), workspace = await readyWorkspace(f)
  let result = await score(f, workspace)
  assert.equal(result.executionStatus, 'completed')
  assert.deepEqual(result.metric, { status: 'reported', score: 1, reason: 'artifact comparison' })
  assert.match(await readFile(result.stdoutLog, 'utf8'), /diagnostic/)
  await writeFile(join(workspace, f.row.output_fname), 'wrong')
  result = await score(f, workspace)
  assert.equal(result.executionStatus, 'completed')
  assert.equal(result.metric.score, 0)
  assert.deepEqual(await readdir(join(workspace, 'benchmark')), ['datasets'])
  assert.ok((await readdir(join(f.outputRoot, 'scorer-logs'))).every(name => name.endsWith('.log')))
})

test('does not infer a pass from a zero exit or a printed tuple before a crash', async t => {
  const f = await fixture(t), workspace = await readyWorkspace(f)
  await writeFile(join(f.benchmarkRoot, 'eval_programs/grade.py'), "print('finished')\n")
  let result = await score(f, workspace)
  assert.equal(result.executionStatus, 'completed')
  assert.equal(result.metric.status, 'unparsed')
  assert.equal(result.metric.score, null)
  await writeFile(join(f.benchmarkRoot, 'eval_programs/grade.py'), "print((1, 'premature'))\nraise RuntimeError('grader failure')\n")
  result = await score(f, workspace)
  assert.equal(result.executionStatus, 'failed')
  assert.equal(result.metric.score, null)
  assert.match(await readFile(result.stderrLog, 'utf8'), /grader failure/)
})

test('bounds grader execution and retains failure logs', async t => {
  const f = await fixture(t), workspace = await readyWorkspace(f)
  await writeFile(join(f.benchmarkRoot, 'eval_programs/grade.py'), 'import time\ntime.sleep(30)\n')
  const result = await score(f, workspace, { timeoutMs: 80 })
  assert.equal(result.executionStatus, 'timed-out')
  assert.equal(result.metric.score, null)
  assert.ok(await readFile(result.stderrLog, 'utf8'))
})

test('rejects output symlinks, including links hidden in parent directories', async t => {
  const f = await fixture(t), workspace = await readyWorkspace(f)
  await rm(join(workspace, 'pred_results'), { recursive: true })
  await symlink(join(f.benchmarkRoot, 'eval_programs/gold_results'), join(workspace, 'pred_results'))
  const result = await score(f, workspace)
  assert.equal(result.executionStatus, 'failed')
  assert.match(await readFile(result.stderrLog, 'utf8'), /Symlinks/)
  assert.throws(() => validateRecord({ schemaVersion: 1, instance_id: '1', model: 'm', runtimeId: 'codex', datasetDigest: 'd', workspace: f.root },
    { model: 'm', runtimeId: 'codex', datasetDigest: 'd' }, f.outputRoot, '1'), /Path|path/)
})

test('ScienceAgentBench uses the real executor and rescore does not create a runtime', async t => {
  const f = await fixture(t)
  const runtime = fakeRuntime(async input => {
    assert.equal(input.permissionLevel, undefined)
    assert.deepEqual(await readdir(join(input.workspace, 'benchmark')), ['datasets'])
    await writeFile(join(input.workspace, f.row.output_fname), 'correct')
  })
  await runScienceAgentBench(f.env, async options => {
    assert.equal(options.instanceId, undefined)
    return runtime
  })
  const path = join(f.outputRoot, 'results/1.json')
  let record = await readJson(path)
  assert.equal(record.agent.executionStatus, 'completed')
  assert.equal(record.score.metric.score, 1)
  assert.equal(runtime.calls.at(-1)[0], 'close')
  assert.equal(runtime.calls.at(-2)[0], 'deleteThread')
  await writeFile(join(record.workspace, f.row.output_fname), 'wrong')
  await rescoreScienceAgentBench({ SAB_OUTPUT: f.outputRoot, SAB_PYTHON: f.env.SAB_PYTHON }, ['1'])
  record = await readJson(path)
  assert.equal(record.score.metric.score, 0)
  assert.equal(record.model, 'test-model')
  await assert.rejects(rescoreScienceAgentBench({ SAB_OUTPUT: f.outputRoot, SAB_PYTHON: f.env.SAB_PYTHON }, ['../outside']), /Invalid task ID/)
  await assert.rejects(rescoreScienceAgentBench({ SAB_OUTPUT: f.outputRoot, SAB_PYTHON: f.env.SAB_PYTHON }, ['2']), /Unknown task ID/)
})

test('a timed-out Agent is cancelled before thread cleanup and is never scored', async t => {
  const f = await fixture(t)
  const runtime = fakeRuntime(async input => writeFile(join(input.workspace, f.row.output_fname), 'correct'), true)
  await runScienceAgentBench({ ...f.env, SAB_TIMEOUT_MS: '30' }, async () => runtime)
  const record = await readJson(join(f.outputRoot, 'results/1.json'))
  assert.equal(record.agent.executionStatus, 'timed-out')
  assert.equal(record.score.executionStatus, 'not-run')
  const names = runtime.calls.map(call => call[0])
  assert.ok(names.indexOf('interruptTurn') >= 0)
  assert.ok(names.indexOf('interruptTurn') < names.indexOf('deleteThread'))
  assert.equal(names.at(-1), 'close')
})

test('summary checks task identity, not just counts; incomplete scoring has no full-run pass rate', async t => {
  const f = await fixture(t)
  const runtime = fakeRuntime(async input => writeFile(join(input.workspace, f.row.output_fname), 'correct'))
  await runScienceAgentBench(f.env, async () => runtime)
  let summary = await summarizeScienceAgentBench({ SAB_OUTPUT: f.outputRoot })
  assert.equal(summary.expectedCount, 1)
  assert.equal(summary.fullRunPassRate, 1)
  assert.equal(summary.model, 'test-model')
  const record = await readJson(join(f.outputRoot, 'results/1.json'))
  await rm(join(f.outputRoot, 'results/1.json'))
  await writeJson(join(f.outputRoot, 'results/2.json'), { ...record, instance_id: '2' })
  summary = await summarizeScienceAgentBench({ SAB_OUTPUT: f.outputRoot })
  assert.deepEqual(summary.missingIds, ['1'])
  assert.deepEqual(summary.unexpectedIds, ['2'])
  assert.equal(summary.completeRowCoverage, false)
  assert.equal(summary.fullRunPassRate, null)
  await writeFile(join(f.outputRoot, 'results/broken.json'), '{')
  summary = await summarizeScienceAgentBench({ SAB_OUTPUT: f.outputRoot })
  assert.equal(summary.invalidRecords.length, 1)
})

test('ResearchClawBench reuses canonical execution, records metadata outside workspace, and does not claim a grade', async t => {
  const f = await fixture(t), workspace = join(f.root, 'research-task')
  await mkdir(workspace)
  await writeFile(join(workspace, 'INSTRUCTIONS.md'), 'Produce a report.')
  const runtime = fakeRuntime(async input => {
    await mkdir(join(input.workspace, 'report'))
    await writeFile(join(input.workspace, 'report/report.md'), '# Result')
  })
  const result = await runResearchClawBench({ RCB_TASK_ID: 'task-a', RCB_WORKSPACE: workspace, RCB_MODEL: 'model', RCB_OUTPUT: f.outputRoot }, async () => runtime)
  assert.equal(result.executionStatus, 'completed')
  assert.equal(result.reportExists, true)
  assert.equal(result.benchmarkScore, null)
  assert.equal(runtime.calls.at(-1)[0], 'close')
  assert.ok((await readdir(workspace)).every(name => !name.startsWith('_sciforge')))
})

test('ResearchClawBench missing reports fail visibly after cleanup with trace evidence retained', async t => {
  const f = await fixture(t), workspace = join(f.root, 'task')
  await mkdir(workspace)
  await writeFile(join(workspace, 'INSTRUCTIONS.md'), 'Produce a report.')
  const runtime = fakeRuntime()
  await assert.rejects(runResearchClawBench({ RCB_TASK_ID: 'a', RCB_WORKSPACE: workspace, RCB_MODEL: 'm', RCB_OUTPUT: f.outputRoot }, async () => runtime), /reportExists=false/)
  assert.ok((await readdir(f.outputRoot)).some(name => name.endsWith('.trace.json')))
  assert.equal(runtime.calls.at(-1)[0], 'close')
})

test('ResearchClawBench rejects an unchanged report from a previous run', async t => {
  const f = await fixture(t), workspace = join(f.root, 'task')
  await mkdir(join(workspace, 'report'), { recursive: true })
  await writeFile(join(workspace, 'INSTRUCTIONS.md'), 'Produce a fresh report.')
  await writeFile(join(workspace, 'report/report.md'), '# Previous run')
  const runtime = fakeRuntime()
  await assert.rejects(runResearchClawBench({ RCB_TASK_ID: 'a', RCB_WORKSPACE: workspace, RCB_MODEL: 'm', RCB_OUTPUT: f.outputRoot }, async () => runtime), /reportChanged=false/)
})

test('missing dataset inputs and changed result configurations fail closed', async t => {
  const f = await fixture(t)
  await assert.rejects(prepareScienceAgentBenchWorkspace({ ...f.row, dataset_folder_tree: '|-- absent/' }, f.benchmarkRoot, join(f.outputRoot, 'workspaces')), /ENOENT/)
  await writeJson(f.rowsPath, { rows: [{ row: { ...f.row, instance_id: undefined } }] })
  await assert.rejects(loadScienceAgentBenchRows(f.rowsPath, {}), /Invalid task ID/)
  const manifest = { model: 'm', runtimeId: 'codex', datasetDigest: 'd' }
  assert.throws(() => validateRecord({ schemaVersion: 1, instance_id: '1', model: 'other', runtimeId: 'codex', datasetDigest: 'd' }, manifest, f.outputRoot, '1'), /does not match/)
})

test('an explicit successful Python exit preserves metrics; a missing interpreter does not', async t => {
  const f = await fixture(t), workspace = await readyWorkspace(f)
  await writeFile(join(f.benchmarkRoot, 'eval_programs/grade.py'), "import sys\nprint((1, 'passed'))\nsys.exit(0)\n")
  let result = await score(f, workspace)
  assert.equal(result.executionStatus, 'completed')
  assert.equal(result.metric.score, 1)
  assert.ok(result.pythonVersion)
  result = await score(f, workspace, { python: join(f.root, 'absent-python') })
  assert.equal(result.executionStatus, 'failed')
  assert.equal(result.metric.score, null)
  assert.match(await readFile(result.stderrLog, 'utf8'), /ENOENT/)
})

test('an invalid scoring interpreter is rejected before connecting to the live runtime', async t => {
  const f = await fixture(t)
  await assert.rejects(runScienceAgentBench({ ...f.env, SAB_PYTHON: join(f.root, 'no-python') }, () => {
    throw new Error('Runtime must not start')
  }), /ENOENT/)
})
