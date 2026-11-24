import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { byteDigest, executeReceiptedProcess, PROCESS_STREAM_LIMIT, readProcessReceipts } from './process-receipts.js'
import { collectWorkflowSecretValues } from './rerun.js'

import type { ProcessIdentity } from './contract.js'

const command = process.platform === 'win32' ? 'python.exe' : 'python3'
const identity: ProcessIdentity = { workflowId: 'workflow', runId: 'run', nodeId: 'node', invocationId: 'invocation', attempt: 0 }
async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!await check()) {
    if (Date.now() > deadline) throw new Error('Test observation timed out')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
test('real producer: frozen bytes before side effect, concurrent claim, late receipt and read-only reconciliation', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'create-loop-receipt-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const statePath = path.join(root, 'state.json')
  const script = `import pathlib,json,sys,time,hashlib\np=next(pathlib.Path(${JSON.stringify(statePath + '.processes')}).glob('*/prepared.json'))\na=json.loads(p.read_text())\nassert 'sha256:'+hashlib.sha256((p.parent/'script').read_bytes()).hexdigest()==a['script']['digest']\nassert 'sha256:'+hashlib.sha256((p.parent/'input.json').read_bytes()).hexdigest()==a['input']['digest']\nassert json.loads((p.parent/'input.json').read_text())['text']=='declared text'\npathlib.Path('count').open('a').write('1')\ntime.sleep(0.3)\nsys.stdout.buffer.write(b' \\xff\\r\\n')\nsys.stderr.buffer.write(b'err\\x00\\r\\n')`
  const options = { statePath, identity, command, script, payload: { json: { label: 'same-output' }, text: 'declared text' }, cwd: root, signal: new AbortController().signal, timeoutMs: 5000 }
  const running = executeReceiptedProcess(options)
  await waitUntil(async () => { try { return (await readFile(path.join(root, 'count'), 'utf8')) === '1' } catch { return false } })
  const before = (await readProcessReceipts(statePath)).receipts
  assert.equal(before[0].verification, 'unknown')
  await assert.rejects(executeReceiptedProcess(options), /unknown/)
  assert.deepEqual((await readProcessReceipts(statePath)).receipts, before)
  const finished = await running
  assert.equal(finished.receipt.verification, 'verified')
  const directory = finished.receipt.directory
  const prepared = JSON.parse(await readFile(path.join(directory, 'prepared.json'), 'utf8'))
  assert.equal(prepared.script.digest, byteDigest(script))
  assert.equal(prepared.cwd, root)
  assert.equal(prepared.environment.inheritedEnvironment, 'unrecorded')
  const terminalBytes = await readFile(path.join(directory, 'terminal.json'))
  const terminal = JSON.parse(terminalBytes.toString())
  assert.equal(terminal.stdout.digest, byteDigest(Buffer.from([32, 255, 13, 10])))
  assert.equal(terminal.stderr.digest, byteDigest(Buffer.from('err\x00\r\n')))
  assert.equal(terminal.preparedDigest, byteDigest(await readFile(path.join(directory, 'prepared.json'))))
  assert.equal((await executeReceiptedProcess(options)).receipt.executionId, finished.receipt.executionId)
  await assert.rejects(executeReceiptedProcess({ ...options, script: 'print(2)' }), /conflicts/)
  for (const fault of ['tampered', 'corrupt', 'missing'] as const) {
    if (fault === 'tampered') await writeFile(path.join(directory, 'stdout'), 'tampered')
    if (fault === 'corrupt') await writeFile(path.join(directory, 'terminal.json'), '{')
    if (fault === 'missing') await rm(path.join(directory, 'terminal.json'))
    assert.equal(((await readProcessReceipts(statePath)).receipts)[0].verification, 'unknown')
    await assert.rejects(executeReceiptedProcess(options), /unknown/)
  }
  assert.equal(await readFile(path.join(root, 'count'), 'utf8'), '1')
})

test('canonical identity cannot duplicate effects and metadata/read coverage are explicit', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'receipt-identity-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const statePath = path.join(root, 'state')
  const options = { statePath, identity, command, script: "import pathlib; pathlib.Path('effect').open('a').write('1'); print('ok')", payload: { json: {}, text: '' }, cwd: root, signal: new AbortController().signal, timeoutMs: 5000 }
  const first = await executeReceiptedProcess(options)
  const reordered = { attempt: 0, invocationId: identity.invocationId, nodeId: identity.nodeId, runId: identity.runId, workflowId: identity.workflowId }
  assert.equal((await executeReceiptedProcess({ ...options, identity: reordered })).receipt.executionId, first.receipt.executionId)
  assert.equal(await readFile(path.join(root, 'effect'), 'utf8'), '1')
  await assert.rejects(executeReceiptedProcess({ ...options, identity: { ...identity, attempt: 1 }, script: '#'.repeat(270_000) }), /metadata exceeds limit/)
  assert.equal((await readProcessReceipts(statePath)).receipts.length, 1)
  for (let index = 0; index < 130; index += 1) await mkdir(path.join(`${statePath}.processes`, `old-${index}`))
  assert.equal((await readProcessReceipts(statePath)).coverage.status, 'partial')
  const inaccessible = path.join(root, 'invalid')
  await writeFile(`${inaccessible}.processes`, 'not-directory')
  assert.equal((await readProcessReceipts(inaccessible)).coverage.status, 'unavailable')
  assert.equal((await readProcessReceipts(path.join(root, 'missing'))).coverage.status, 'complete')
  await writeFile(path.join(first.receipt.directory, 'terminal.json'), '{"private":"secret-sentinel"')
  assert.equal(JSON.stringify(await readProcessReceipts(statePath)).includes('secret-sentinel'), false)
})

test('bounded binary output and forced descendant stop preserve unknown without replay', { timeout: 15_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'receipt-bounds-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const statePath = path.join(root, 'state')
  const options = { statePath, identity, command, script: `import sys; sys.stdout.buffer.write(b'\\x00' * ${PROCESS_STREAM_LIMIT + 1000})`, payload: { json: {}, text: '' }, cwd: root, signal: new AbortController().signal, timeoutMs: 5000 }
  await assert.rejects(executeReceiptedProcess(options), /unknown: output_limit/)
  const receipt = (await readProcessReceipts(statePath)).receipts[0]
  assert.equal(receipt.outcome, 'unknown')
  assert.equal((await readFile(path.join(receipt.directory, 'stdout'))).length, PROCESS_STREAM_LIMIT)
  await assert.rejects(executeReceiptedProcess(options), /unknown: output_limit/)
  const descendant = { ...options, identity: { ...identity, attempt: 1 }, script: "import subprocess,sys,pathlib,time; subprocess.Popen([sys.executable,'-c',\"import pathlib,time; time.sleep(.5); pathlib.Path('descendant').write_text('alive')\"],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); pathlib.Path('parent').open('a').write('1'); time.sleep(10)", timeoutMs: 250 }
  await assert.rejects(executeReceiptedProcess(descendant), /unknown: process_timed_out/)
  await waitUntil(async () => { try { return await readFile(path.join(root, 'descendant'), 'utf8') === 'alive' } catch { return false } })
  await assert.rejects(executeReceiptedProcess(descendant), /unknown/)
  assert.equal(await readFile(path.join(root, 'parent'), 'utf8'), '1')
  assert.equal(collectWorkflowSecretValues('x'.repeat(PROCESS_STREAM_LIMIT)).length, 0)
  assert.ok(collectWorkflowSecretValues('prefix https://user:password@example.test/path').includes('password'))
})

test('actual host death before terminal receipt reconciles read-only after restart', { timeout: 15_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'receipt-host-loss-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const statePath = path.join(root, 'state')
  const options = { statePath, identity, command, script: "import pathlib,time; pathlib.Path('effect').open('a').write('1'); time.sleep(.5); print('finished')", payload: { json: {}, text: '' }, cwd: root, timeoutMs: 5000 }
  const fixture = path.join(root, 'host.mts')
  const moduleUrl = new URL('./process-receipts.ts', import.meta.url).href
  await writeFile(fixture, `import {executeReceiptedProcess} from ${JSON.stringify(moduleUrl)}; await executeReceiptedProcess({...${JSON.stringify(options)},signal:new AbortController().signal});`)
  const host = spawn(process.execPath, ['--import', 'tsx', fixture], { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..'), stdio: 'ignore', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  const closed = once(host, 'close')
  t.after(() => { if (host.exitCode === null) host.kill('SIGKILL') })
  await waitUntil(async () => { try { return await readFile(path.join(root, 'effect'), 'utf8') === '1' } catch { return false } })
  host.kill('SIGKILL')
  await closed
  await new Promise((resolve) => setTimeout(resolve, 700))
  const before = await readProcessReceipts(statePath)
  assert.equal(before.receipts[0].outcome, 'unknown')
  assert.equal(before.receipts[0].verification, 'unknown')
  assert.deepEqual(await readProcessReceipts(statePath), before)
  await assert.rejects(executeReceiptedProcess({ ...options, signal: new AbortController().signal }), /unknown/)
  assert.equal(await readFile(path.join(root, 'effect'), 'utf8'), '1')
})

test('journal directory links and receipt-file symlinks cannot become trusted claims', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'receipt-links-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const external = path.join(root, 'external'); await mkdir(external)
  const statePath = path.join(root, 'state')
  try { await symlink(external, `${statePath}.processes`, process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('OS denied creating test link'); return } throw error }
  assert.equal((await readProcessReceipts(statePath)).coverage.status, 'unavailable')
  await assert.rejects(executeReceiptedProcess({ statePath, identity, command, script: 'print(1)', payload: { json: {}, text: '' }, cwd: root, signal: new AbortController().signal, timeoutMs: 1000 }), /directory_invalid/)
  if (process.platform !== 'win32') {
    const cleanState = path.join(root, 'clean')
    const result = await executeReceiptedProcess({ statePath: cleanState, identity, command, script: 'print(1)', payload: { json: {}, text: '' }, cwd: root, signal: new AbortController().signal, timeoutMs: 1000 })
    const stdout = path.join(result.receipt.directory, 'stdout')
    const externalBytes = path.join(external, 'stdout'); await writeFile(externalBytes, '1\n')
    await rm(stdout); await symlink(externalBytes, stdout)
    assert.equal((await readProcessReceipts(cleanState)).receipts[0].verification, 'unknown')
  }
})
test('pre-aborted, launch failure, timeout and early stdin close retain observable outcomes', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'create-loop-receipt-errors-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const statePath = path.join(root, 'state.json')
  const base = { statePath, command, script: 'print(1)', payload: { json: {}, text: '' }, cwd: root, signal: new AbortController().signal, timeoutMs: 5000 }
  const aborted = new AbortController(); aborted.abort()
  await assert.rejects(executeReceiptedProcess({ ...base, identity, signal: aborted.signal }), /before spawn/)
  assert.equal(((await readProcessReceipts(statePath)).receipts)[0].verification, 'unknown')
  await assert.rejects(executeReceiptedProcess({ ...base, identity: { ...identity, attempt: 1 }, command: 'nonexistent-create-loop-command' }), /Execution/)
  await assert.rejects(executeReceiptedProcess({ ...base, identity: { ...identity, attempt: 2 }, script: 'import time; time.sleep(10)', timeoutMs: 100 }), /process_timed_out/)
  // A large stdin and immediate close exercises the EPIPE handler without an uncaught stream error.
  await executeReceiptedProcess({ ...base, identity: { ...identity, attempt: 3 }, script: 'import sys; sys.stdin.close()', payload: { json: 'x'.repeat(50000), text: '' } }).catch((error) => assert.match(String(error), /stdin|Execution/))
  const receipts = (await readProcessReceipts(statePath)).receipts
  assert.equal(receipts.length, 4)
  assert.equal(receipts.filter((receipt) => receipt.verification === 'verified').length, 3)
})

test('credential-bearing declared inputs are refused and recognized raw output is withheld', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'create-loop-private-receipt-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const statePath = path.join(root, 'state.json')
  const options = { statePath, identity, command, script: 'print(1)', payload: { json: { apiKey: 'receipt-secret-sentinel' }, text: '' }, cwd: root, signal: new AbortController().signal, timeoutMs: 5000 }
  await assert.rejects(executeReceiptedProcess(options), /recognized credential/)
  assert.deepEqual((await readProcessReceipts(statePath)).receipts, [])
  await assert.rejects(executeReceiptedProcess({ ...options, payload: { json: {}, text: '' }, script: `import json; print(json.dumps({'apiKey':'receipt-secret-sentinel'}))` }), /logs contain a recognized credential/)
  const receipts = (await readProcessReceipts(statePath)).receipts
  assert.equal(receipts[0].verification, 'unknown')
  await assert.rejects(readFile(path.join(receipts[0].directory, 'stdout')), /ENOENT/)
})
