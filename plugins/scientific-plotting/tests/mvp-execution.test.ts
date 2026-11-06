import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, realpath, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'
import { EXECUTION_LIMITS, preparePythonSnapshot, collectPythonSnapshot, cleanupPythonSnapshot, runPythonSnapshot, type PythonSnapshotRequest } from '../src/execution/index.js'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64')
const ENVIRONMENT = { pythonVersion: '3.12.1', matplotlibVersion: '3.9.2', platform: 'test-platform', machine: 'test-machine', implementation: 'CPython', executable: 'python3', packages: [{ name: 'Matplotlib', version: '3.9.2' }, { name: 'example_pkg', version: '1!2.3rc1.post2.dev3+local.1' }] }
const userOutputs = (result: Awaited<ReturnType<typeof runPythonSnapshot>>) => result.outputs.filter(file => !file.path.startsWith('_environment/'))

async function fixture(t: TestContext) {
  const parent = await realpath(tmpdir())
  const root = await mkdtemp(join(parent, 'scientific-python-test-'))
  t.after(async () => {
    assert.equal(await realpath(root), resolve(root))
    assert.ok(root.startsWith(join(parent, 'scientific-python-test-')))
    await rm(root, { recursive: true, force: true })
  })
  // Deliberate subprocess simulation, not a Python or matplotlib integration test.
  const executable = join(root, 'simulated-python')
  await writeFile(executable, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const mode = JSON.parse(fs.readFileSync(process.argv.at(-1), 'utf8'));
const metadata = process.argv.at(-2);
const output = process.env.SCIENTIFIC_FIGURES_OUTPUT_DIR;
fs.writeFileSync(metadata, JSON.stringify(${JSON.stringify(ENVIRONMENT)}));
const png = Buffer.from('${PNG.toString('base64')}', 'base64');
if (mode === 'success') {
  fs.mkdirSync(path.join(output, 'nested'));
  fs.writeFileSync(path.join(output, 'nested', 'plot.PNG'), png);
  fs.writeFileSync(path.join(output, 'ignore.bin'), 'ignored');
  console.log(JSON.stringify({parameters:JSON.parse(process.env.SCIENTIFIC_FIGURES_PARAMETERS_JSON),input:fs.readFileSync(path.join(process.env.SCIENTIFIC_FIGURES_INPUT_DIR,'data.csv'),'utf8'),source:fs.readFileSync('helper.py','utf8'),backend:process.env.MPLBACKEND,argv:process.argv.slice(2,4)}));
} else if (mode === 'logs') {
  process.stdout.write('a'.repeat(400000));
  process.stderr.write('b'.repeat(400000));
} else if (mode === 'binarylogs') {
  process.stdout.write(Buffer.alloc(400000,255));
  process.stderr.write(Buffer.alloc(400000,255));
} else if (mode === 'failure') {
  console.error('simulated traceback'); process.exitCode = 3;
} else if (mode === 'wait') {
  setInterval(() => {}, 1000);
} else if (mode === 'descendant') {
  const child = require('node:child_process').spawn(process.execPath, ['-e','setInterval(() => {}, 1000)'], {stdio:'inherit'});
  child.unref();
  console.log(child.pid);
} else if (mode === 'symlink') {
  fs.symlinkSync(process.argv.at(-1), path.join(output, 'escape.png'));
} else if (mode === 'hardlink') {
  fs.linkSync(process.argv.at(-1), path.join(output, 'escape.png'));
} else if (mode === 'invalid') {
  fs.writeFileSync(path.join(output, 'fake.png'), 'not png');
} else if (mode === 'count') {
  for (let i=0;i<17;i++) fs.writeFileSync(path.join(output, i+'.png'), png);
} else if (mode === 'oversize') {
  const fd=fs.openSync(path.join(output,'large.png'),'w'); fs.ftruncateSync(fd,${EXECUTION_LIMITS.outputFileBytes + 1}); fs.closeSync(fd);
} else if (mode === 'missing') {
  fs.writeFileSync(metadata,JSON.stringify({pythonVersion:'simulated-python',error:'missing-matplotlib'})); process.exitCode=78;
}
`)
  await chmod(executable, 0o700)
  const request = (mode = 'success'): PythonSnapshotRequest => ({
    pythonCommand: executable, workspaceRoot: root,
    files: [{ path: 'main.py', content: JSON.stringify(mode) }, { path: 'helper.py', content: 'snapshot helper' }],
    entrypoint: 'main.py', parameters: { alpha: 0.5, nested: [true, null, 'text'] },
    inputFiles: [{ path: 'data.csv', bytes: new TextEncoder().encode('x,y\n1,2') }],
    timeoutMs: 5000,
  })
  async function clean() {
    assert.deepEqual(await readdir(join(root, '.scientific-figures', '.runs-temp')), [])
  }
  return { root, request, clean }
}

test('simulated executable receives immutable snapshot, inputs, JSON, Agg; returns exact explicit PNG', async t => {
  const f = await fixture(t)
  const request = f.request()
  const running = runPythonSnapshot(request)
  request.files[1].content = 'mutated after call'
  request.inputFiles[0].bytes.fill(0)
  const result = await running
  assert.equal(result.status, 'completed', result.stderr)
  assert.equal(result.exitCode, 0)
  assert.deepEqual(result.environment, { language: 'python', ...ENVIRONMENT })
  const receipt = JSON.parse(result.stdout)
  assert.deepEqual(receipt.parameters, { alpha: 0.5, nested: [true, null, 'text'] })
  assert.equal(receipt.source, 'snapshot helper')
  assert.equal(receipt.input, 'x,y\n1,2')
  assert.equal(receipt.backend, 'Agg')
  assert.deepEqual(receipt.argv, ['-I', '-u'])
  assert.equal(result.outputs.length, 4)
  assert.equal(userOutputs(result)[0].path, 'nested/plot.PNG')
  assert.deepEqual(Buffer.from(userOutputs(result)[0].bytes), PNG)
  await f.clean()
})

test('real Python nested entrypoint imports siblings before root while retaining isolated snapshot imports', async t => {
  const pythonCommand = process.env.SCIENTIFIC_FIGURES_TEST_PYTHON ?? 'python3'
  const probe = spawnSync(pythonCommand, ['-I', '-c', 'import matplotlib'], { encoding: 'utf8', timeout: 10_000 })
  if (!process.env.SCIENTIFIC_FIGURES_TEST_PYTHON && probe.status !== 0) {
    t.skip('Set SCIENTIFIC_FIGURES_TEST_PYTHON to a Python executable with Matplotlib installed.')
    return
  }
  assert.equal(probe.status, 0, probe.error?.message ?? probe.stderr)
  const f = await fixture(t)
  // This workspace file must never become importable through either snapshot path.
  await writeFile(join(f.root, 'workspace_only.py'), 'raise AssertionError("workspace leaked into sys.path")')
  const result = await runPythonSnapshot({
    ...f.request(), pythonCommand, entrypoint: 'analysis/main.py', timeoutMs: 20_000,
    files: [
      { path: 'analysis/main.py', content: `import importlib.util, json, os, pathlib, sys
import helper
import root_helper
root = pathlib.Path.cwd().resolve()
assert pathlib.Path(helper.__file__).resolve().parent == root / "analysis"
assert pathlib.Path(root_helper.__file__).resolve().parent == root
assert [pathlib.Path(p).resolve() for p in sys.path[:2]] == [root / "analysis", root]
assert sys.flags.isolated == 1 and sys.flags.ignore_environment == 1 and sys.flags.no_user_site == 1
assert "" not in sys.path
assert importlib.util.find_spec("workspace_only") is None
assert sys.argv == [str(root / "analysis" / "main.py")]
pathlib.Path(os.environ["SCIENTIFIC_FIGURES_OUTPUT_DIR"], "nested.png").write_bytes(helper.PNG)
print(json.dumps({"helper": helper.VALUE, "root": root_helper.VALUE}))
` },
      { path: 'analysis/helper.py', content: `import base64\nVALUE = "sibling"\nPNG = base64.b64decode("${PNG.toString('base64')}")\n` },
      { path: 'helper.py', content: 'raise AssertionError("root helper shadowed the entrypoint sibling")' },
      { path: 'root_helper.py', content: 'VALUE = "snapshot root"' },
    ],
  })
  assert.equal(result.status, 'completed', result.stderr)
  assert.equal(result.exitCode, 0)
  assert.deepEqual(JSON.parse(result.stdout), { helper: 'sibling', root: 'snapshot root' })
  assert.equal(result.outputs.length, 4)
  assert.equal(userOutputs(result)[0].path, 'nested.png')
  assert.deepEqual(Buffer.from(userOutputs(result)[0].bytes), PNG)
  await f.clean()
})

test('missing executable is a structured logged failure, with staging cleaned', async t => {
  const f = await fixture(t)
  const result = await runPythonSnapshot({ ...f.request(), pythonCommand: join(f.root, 'not-installed') })
  assert.equal(result.status, 'failed')
  assert.equal(result.error?.code, 'runtime-unavailable')
  assert.equal(result.exitCode, null)
  assert.match(result.stderr, /Unable to start/)
  await f.clean()
})

test('simulated missing matplotlib does not install anything and records Python version', async t => {
  const f = await fixture(t)
  const result = await runPythonSnapshot(f.request('missing'))
  assert.equal(result.error?.code, 'missing-matplotlib')
  assert.equal(result.exitCode, 78)
  assert.equal(result.environment.pythonVersion, 'simulated-python')
  assert.match(result.stderr, /No packages were installed/)
  await f.clean()
})

test('simulated large stdout and stderr keep draining with bounded buffers', async t => {
  const f = await fixture(t)
  const result = await runPythonSnapshot(f.request('logs'))
  assert.equal(result.status, 'completed', result.stderr)
  assert.equal(Buffer.byteLength(result.stdout), EXECUTION_LIMITS.logBytes)
  assert.equal(Buffer.byteLength(result.stderr), EXECUTION_LIMITS.logBytes)
  assert.equal(result.stdoutTruncated, true)
  assert.equal(result.stderrTruncated, true)
  await f.clean()
})

test('simulated nonzero script retains logs and exit code without outputs', async t => {
  const f = await fixture(t)
  const result = await runPythonSnapshot(f.request('failure'))
  assert.equal(result.status, 'failed')
  assert.equal(result.exitCode, 3)
  assert.equal(result.error?.code, 'python-failed')
  assert.match(result.stderr, /simulated traceback/)
  assert.deepEqual(result.outputs, [])
  await f.clean()
})

test('simulated timeout and abort kill subprocess and clean staging', async t => {
  const f = await fixture(t)
  const timeout = await runPythonSnapshot({ ...f.request('wait'), timeoutMs: 120 })
  assert.equal(timeout.error?.code, 'timeout')
  assert.equal(timeout.status, 'failed')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120)
  const cancelled = await runPythonSnapshot({ ...f.request('wait'), signal: controller.signal })
  clearTimeout(timer)
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.error?.code, 'cancelled')
  await f.clean()
})

test('POSIX process group cleanup prevents descendants retaining output pipes', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t)
  const result = await runPythonSnapshot(f.request('descendant'))
  assert.equal(result.status, 'completed', result.stderr)
  const pid = Number(result.stdout.trim())
  assert.ok(Number.isSafeInteger(pid) && pid > 0)
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
  await f.clean()
})

test('unsafe paths, entrypoints, duplicate files and non-JSON parameters fail before execution', async t => {
  const f = await fixture(t)
  for (const path of ['../escape.py', '/tmp/escape.py', 'a/../escape.py', 'a\\escape.py', 'C:escape.py', 'a//b.py', './a.py']) {
    const result = await runPythonSnapshot({ ...f.request(), files: [{ path, content: '' }] })
    assert.equal(result.error?.code, 'invalid-path', path)
  }
  const duplicate = f.request()
  duplicate.files.push({ ...duplicate.files[0] })
  assert.equal((await runPythonSnapshot(duplicate)).error?.code, 'invalid-snapshot')
  assert.equal((await runPythonSnapshot({ ...f.request(), entrypoint: 'missing.py' })).error?.code, 'invalid-entrypoint')
  assert.equal((await runPythonSnapshot({ ...f.request(), parameters: Number.NaN })).error?.code, 'invalid-parameters')
})

test('symlink staging directory is rejected without touching its target', async t => {
  const f = await fixture(t)
  const outside = join(f.root, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'sentinel'), 'untouched')
  await symlink(outside, join(f.root, '.scientific-figures'))
  const result = await runPythonSnapshot(f.request())
  assert.equal(result.error?.code, 'unsafe-directory')
  assert.equal(await readFile(join(outside, 'sentinel'), 'utf8'), 'untouched')
  assert.deepEqual(await readdir(outside), ['sentinel'])
})

test('simulated symlink, hardlink, invalid PNG, count and byte excess fail closed', async t => {
  const f = await fixture(t)
  for (const [mode, code] of [['symlink', 'unsafe-output'], ['hardlink', 'unsafe-output'], ['invalid', 'invalid-output'], ['count', 'output-limit'], ['oversize', 'unsafe-output']]) {
    const result = await runPythonSnapshot(f.request(mode))
    assert.equal(result.status, 'failed', mode)
    assert.equal(result.error?.code, code, result.stderr)
    assert.deepEqual(result.outputs, [])
    await f.clean()
  }
})

test('already cancelled request creates no run and succeeds at cancellation', async t => {
  const f = await fixture(t)
  const controller = new AbortController()
  controller.abort()
  const result = await runPythonSnapshot({ ...f.request(), signal: controller.signal })
  assert.equal(result.status, 'cancelled')
  assert.equal(result.error?.code, 'cancelled')
})


test('prepared lifecycle serializes safely and collects a managed process outcome', async t => {
  const f = await fixture(t)
  const prepared = await preparePythonSnapshot(f.request())
  const transported = JSON.parse(JSON.stringify(prepared)) as typeof prepared
  assert.equal(prepared.cwd, join(prepared.stageRoot, 'snapshot'))
  assert.deepEqual(prepared.argv.slice(1, 4), ['-I', '-u', '-c'])
  assert.equal(prepared.env.MPLBACKEND, 'Agg')
  assert.equal(await readFile(join(prepared.cwd, 'helper.py'), 'utf8'), 'snapshot helper')
  await writeFile(join(prepared.stageRoot, 'environment.json'), JSON.stringify(ENVIRONMENT))
  await writeFile(join(prepared.stageRoot, 'outputs', 'managed.png'), PNG)
  const result = await collectPythonSnapshot(transported, {exitCode: 0, stdout: 'managed log', stderr: '', stdoutTruncated: true})
  assert.equal(result.status, 'completed', result.stderr)
  assert.equal(result.stdout, 'managed log')
  assert.equal(result.stdoutTruncated, true)
  assert.equal(userOutputs(result)[0].path, 'managed.png')
  await f.clean()
})

test('managed cancellation finalizes without metadata and cleanup rejects changed identity', async t => {
  const f = await fixture(t)
  const prepared = await preparePythonSnapshot(f.request())
  await assert.rejects(cleanupPythonSnapshot({ ...prepared, identity: { ...prepared.identity, ino: -1 } }), /identity changed/)
  assert.equal(await realpath(prepared.stageRoot), prepared.stageRoot)
  const result = await collectPythonSnapshot(prepared, {exitCode:null,stdout:'',stderr:'',status:'cancelled'})
  assert.equal(result.status, 'cancelled')
  assert.equal(result.error?.code, 'cancelled')
  await f.clean()
})

async function managedFixture(t: TestContext, metadata: unknown = ENVIRONMENT) {
  const f = await fixture(t)
  const prepared = await preparePythonSnapshot(f.request())
  await writeFile(join(prepared.stageRoot, 'environment.json'), JSON.stringify(metadata))
  return { ...f, prepared, output: join(prepared.stageRoot, 'outputs') }
}

function outputText(result: Awaited<ReturnType<typeof runPythonSnapshot>>, path: string): string {
  const output = result.outputs.find(file => file.path === path)
  assert.ok(output, path)
  return Buffer.from(output.bytes).toString('utf8')
}

test('durable environment files have deterministic validated pins and honest reconstruction instructions', async t => {
  const f = await fixture(t)
  const first = await runPythonSnapshot(f.request())
  const second = await runPythonSnapshot(f.request())
  assert.equal(first.status, 'completed', first.stderr)
  assert.deepEqual(first.outputs, second.outputs)
  assert.deepEqual(first.outputs.map(file => file.path), ['_environment/REBUILD.md', '_environment/environment.json', '_environment/requirements.txt', 'nested/plot.PNG'])
  assert.equal(outputText(first, '_environment/requirements.txt'), '# Captured installed inventory; exact versions, not a hash lock.\nexample-pkg==1!2.3rc1.post2.dev3+local.1\nmatplotlib==3.9.2\n')
  assert.deepEqual(JSON.parse(outputText(first, '_environment/environment.json')), first.environment)
  const rebuild = outputText(first, '_environment/REBUILD.md')
  assert.match(rebuild, /python -m pip install -r requirements.txt/)
  assert.match(rebuild, /Python version, implementation, platform and machine/)
  assert.match(rebuild, /not a hash lock/)
  assert.match(rebuild, /did not run it or install any packages/)
  assert.match(rebuild, /does not bundle package binaries/)
  await f.clean()
})

test('analysis collector preserves exact CSV TSV JSON TXT bytes alongside the full PNG budget', async t => {
  const f = await managedFixture(t)
  const files = { 'z.csv': 'x,y\r\n1,2\r\n', 'a.tsv': 'x\ty\nα\t2\n', 'middle.JSON': '{"rows":[1,2]}\n', 'readme.txt': 'analysis notes\n' }
  for (const [path, text] of Object.entries(files)) await writeFile(join(f.output, path), text)
  for (let i = 0; i < EXECUTION_LIMITS.outputFiles; i++) await writeFile(join(f.output, `${i}.png`), PNG)
  const result = await collectPythonSnapshot(f.prepared, { exitCode: 0, stdout: '', stderr: '' })
  assert.equal(result.status, 'completed', result.stderr)
  assert.equal(result.outputs.length, EXECUTION_LIMITS.outputFiles + 7)
  for (const [path, text] of Object.entries(files)) assert.equal(outputText(result, path), text)
  await f.clean()
})

test('malformed UTF-8, NUL and malformed JSON analysis outputs fail closed', async t => {
  const cases = [
    ['bad.csv', Buffer.from([0xc3, 0x28])], ['bad.tsv', Buffer.from([0xff])],
    ['bad.txt', Buffer.from('a\u0000b')], ['bad.json', Buffer.from('{"x":NaN}')],
    ['bad.json', Buffer.from('{"x":1} trailing')], ['bad.json', Buffer.from([0x22, 0xff, 0x22])],
    ['bad.json', Buffer.from('\ufeff{}')],
  ] as const
  for (const [name, bytes] of cases) {
    const f = await managedFixture(t)
    await writeFile(join(f.output, name), bytes)
    const result = await collectPythonSnapshot(f.prepared, { exitCode: 0, stdout: '', stderr: '' })
    assert.equal(result.error?.code, 'invalid-output', result.stderr)
    assert.deepEqual(result.outputs, [])
    await f.clean()
  }
})

test('analysis count, individual size and aggregate size are separately bounded', async t => {
  for (const mode of ['count', 'file', 'total']) {
    const f = await managedFixture(t)
    const count = mode === 'count' ? EXECUTION_LIMITS.analysisFiles + 1 : mode === 'total' ? 5 : 1
    const size = mode === 'file' ? EXECUTION_LIMITS.analysisFileBytes + 1 : mode === 'total' ? EXECUTION_LIMITS.analysisFileBytes : 0
    for (let i = 0; i < count; i++) await writeFile(join(f.output, `${i}.txt`), Buffer.alloc(size, 97))
    const result = await collectPythonSnapshot(f.prepared, { exitCode: 0, stdout: '', stderr: '' })
    assert.equal(result.error?.code, mode === 'count' ? 'output-limit' : 'unsafe-output', result.stderr)
    assert.deepEqual(result.outputs, [])
    await f.clean()
  }
})

test('reserved environment collisions and analysis links cannot enter durable outputs', async t => {
  for (const mode of ['_environment', '_ENVIRONMENT', 'symlink', 'hardlink']) {
    const f = await managedFixture(t)
    if (mode === 'symlink') await symlink(join(f.prepared.cwd, 'main.py'), join(f.output, 'linked.csv'))
    else if (mode === 'hardlink') {
      const { link } = await import('node:fs/promises')
      await link(join(f.prepared.cwd, 'main.py'), join(f.output, 'linked.json'))
    } else await mkdir(join(f.output, mode))
    const result = await collectPythonSnapshot(f.prepared, { exitCode: 0, stdout: '', stderr: '' })
    assert.equal(result.error?.code, mode.startsWith('_') ? 'reserved-output' : 'unsafe-output', result.stderr)
    assert.deepEqual(result.outputs, [])
    await f.clean()
  }
})

test('requirements inventory rejects options URLs markers malformed versions and conflicting normalized names', async t => {
  const cases = [
    [{ name: '--index-url', version: '1.0' }], [{ name: 'safe\nevil', version: '1.0' }],
    [{ name: 'safe\n', version: '1.0' }], [{ name: 'safe', version: '1.0\n' }],
    [{ name: 'safe', version: '1.0\n--extra-index-url=https://example.test' }],
    [{ name: 'safe', version: 'https://example.test/pkg' }], [{ name: 'safe', version: '1.*' }],
    [{ name: 'safe;python_version', version: '1.0' }], [{ name: 'safe', version: 'latest' }],
    [{ name: 'Example_pkg', version: '1.0' }, { name: 'example-pkg', version: '2.0' }],
  ]
  for (const packages of cases) {
    const f = await managedFixture(t, { ...ENVIRONMENT, packages })
    const result = await collectPythonSnapshot(f.prepared, { exitCode: 0, stdout: '', stderr: '' })
    assert.equal(result.error?.code, 'invalid-environment', JSON.stringify(packages))
    assert.deepEqual(result.outputs, [])
    await f.clean()
  }
})

test('invalid metadata UTF-8 and missing captured inventory fail closed', async t => {
  for (const bytes of [Buffer.from([0x7b, 0x22, 0xff]), Buffer.from(JSON.stringify({ pythonVersion: '3.12.1' }))]) {
    const f = await managedFixture(t)
    await writeFile(join(f.prepared.stageRoot, 'environment.json'), bytes)
    const result = await collectPythonSnapshot(f.prepared, { exitCode: 0, stdout: '', stderr: '' })
    assert.equal(result.error?.code, 'invalid-environment', result.stderr)
    assert.deepEqual(result.outputs, [])
    await f.clean()
  }
})

test('managed collection can retain staging until its caller commits durable outputs', async t => {
  const f = await managedFixture(t)
  await writeFile(join(f.output, 'result.csv'), 'x\n1\n')
  const outcome = { exitCode: 0, stdout: '', stderr: '' }
  const first = await collectPythonSnapshot(f.prepared, outcome, { cleanup: false })
  assert.equal(first.status, 'completed', first.stderr)
  assert.equal(await realpath(f.prepared.stageRoot), f.prepared.stageRoot)
  const retry = await collectPythonSnapshot(f.prepared, outcome, { cleanup: false })
  assert.deepEqual(first.outputs, retry.outputs)
  await cleanupPythonSnapshot(f.prepared)
  await f.clean()
})

test('real Python produces durable analysis and environment reconstruction artifacts', async t => {
  const pythonCommand = process.env.SCIENTIFIC_FIGURES_TEST_PYTHON ?? 'python3'
  const probe = spawnSync(pythonCommand, ['-I', '-c', 'import matplotlib'], { encoding: 'utf8', timeout: 10_000 })
  if (!process.env.SCIENTIFIC_FIGURES_TEST_PYTHON && probe.status !== 0) {
    t.skip('Set SCIENTIFIC_FIGURES_TEST_PYTHON to a Python executable with Matplotlib installed.')
    return
  }
  assert.equal(probe.status, 0, probe.error?.message ?? probe.stderr)
  const f = await fixture(t)
  const result = await runPythonSnapshot({ ...f.request(), pythonCommand, files: [{ path: 'main.py', content: `import csv, json, os, pathlib
out = pathlib.Path(os.environ["SCIENTIFIC_FIGURES_OUTPUT_DIR"])
with (out / "analysis.csv").open("w", encoding="utf-8", newline="") as stream:
    writer = csv.writer(stream)
    writer.writerow(["sample", "value"])
    writer.writerow(["α", 3])
(out / "summary.json").write_text(json.dumps({"count": 1, "total": 3}) + "\\n", encoding="utf-8")
` }], timeoutMs: 20_000 })
  assert.equal(result.status, 'completed', result.stderr)
  assert.equal(outputText(result, 'analysis.csv'), 'sample,value\r\nα,3\r\n')
  assert.deepEqual(JSON.parse(outputText(result, 'summary.json')), { count: 1, total: 3 })
  assert.ok(result.environment.packages?.some(item => item.name.toLowerCase() === 'matplotlib'))
  assert.match(outputText(result, '_environment/requirements.txt'), /^matplotlib==[0-9]/m)
  assert.deepEqual(JSON.parse(outputText(result, '_environment/environment.json')), result.environment)
  assert.equal(result.outputs.length, 5)
  await f.clean()
})

test('real Python malformed analysis files are rejected', async t => {
  const pythonCommand = process.env.SCIENTIFIC_FIGURES_TEST_PYTHON ?? 'python3'
  const probe = spawnSync(pythonCommand, ['-I', '-c', 'import matplotlib'], { encoding: 'utf8', timeout: 10_000 })
  if (!process.env.SCIENTIFIC_FIGURES_TEST_PYTHON && probe.status !== 0) {
    t.skip('Set SCIENTIFIC_FIGURES_TEST_PYTHON to a Python executable with Matplotlib installed.')
    return
  }
  assert.equal(probe.status, 0, probe.error?.message ?? probe.stderr)
  const f = await fixture(t)
  for (const [path, content] of [['bad.csv', 'bytes([255])'], ['bad.json', 'b\'{"broken":]\'']]) {
    const result = await runPythonSnapshot({ ...f.request(), pythonCommand, files: [{ path: 'main.py', content: `import os, pathlib\npathlib.Path(os.environ["SCIENTIFIC_FIGURES_OUTPUT_DIR"], "${path}").write_bytes(${content})\n` }], timeoutMs: 20_000 })
    assert.equal(result.error?.code, 'invalid-output', result.stderr)
    assert.deepEqual(result.outputs, [])
    await f.clean()
  }
})

test('invalid UTF-8 logs remain bounded after decoding', async t => {
  const f = await fixture(t)
  const result = await runPythonSnapshot(f.request('binarylogs'))
  assert.equal(result.status, 'completed', result.stderr)
  assert.ok(Buffer.byteLength(result.stdout) <= EXECUTION_LIMITS.logBytes)
  assert.ok(Buffer.byteLength(result.stderr) <= EXECUTION_LIMITS.logBytes)
  assert.equal(result.stdoutTruncated, true)
  assert.equal(result.stderrTruncated, true)
  await f.clean()
})
