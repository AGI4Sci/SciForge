import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, opendir, rename } from 'node:fs/promises'
import path from 'node:path'
import { collectWorkflowSecretValues } from './rerun.js'

import { processIdentitySchema, type ProcessIdentity, type ProcessReceiptCoverage, type ProcessReceiptView } from './contract.js'

export const PROCESS_STREAM_LIMIT = 1024 * 1024
const DECLARED_LIMIT = 4 * 1024 * 1024
const METADATA_LIMIT = 256 * 1024
const SNAPSHOT_READ_LIMIT = 16 * 1024 * 1024
const SNAPSHOT_ENTRY_LIMIT = 128
type ReadBudget = { remaining: number; exhausted?: boolean }
async function assertDirectory(directory: string): Promise<void> {
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('receipt_directory_invalid')
}
async function boundedRead(file: string, limit: number, budget?: ReadBudget): Promise<Buffer> {
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('receipt_file_invalid')
  const handle = await open(file, 'r')
  try {
    const stats = await handle.stat()
    if (budget && stats.size > budget.remaining) { budget.exhausted = true; throw new Error('receipt_read_limit') }
    if (!stats.isFile() || stats.size > limit) throw new Error('receipt_read_limit')
    if (budget) budget.remaining -= stats.size
    const bytes = Buffer.alloc(stats.size)
    let offset = 0
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (!read.bytesRead) throw new Error('receipt_truncated')
      offset += read.bytesRead
    }
    if ((await handle.stat()).size !== bytes.length) throw new Error('receipt_changed')
    return bytes
  } finally { await handle.close() }
}
type BytesRef = { digest: string; size: number }
type Prepared = {
  schema: 'sciforge.create-loop.process.v1'; identity: ProcessIdentity; executionId: string; preparedAt: string
  command: string; args: string[]; cwd: string
  environment: { platform: string; architecture: string; nodeVersion: string; inheritedEnvironment: 'unrecorded' }
  input: BytesRef; script: BytesRef
}
type Terminal = {
  executionId: string; preparedDigest: string; finishedAt: string; exitCode: number | null
  signal: string | null; error: string; outcome: 'known' | 'unknown'; stdout: BytesRef; stderr: BytesRef
}
export class ProcessReceiptError extends Error {
  constructor(message: string, readonly unknown: boolean,
    readonly deliveryFailed = false) { super(message) }
}
export function byteDigest(bytes: string | Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}
const ref = (bytes: Buffer): BytesRef => ({ digest: byteDigest(bytes), size: bytes.length })
export function processReceiptRoot(statePath: string): string { return `${statePath}.processes` }
function executionIdFor(identity: ProcessIdentity): string {
  return byteDigest(JSON.stringify(processIdentitySchema.parse(identity))).slice(7)
}
export async function readProcessReceipt(statePath: string, identity: ProcessIdentity): Promise<ProcessReceiptView> {
  const canonical = processIdentitySchema.parse(identity)
  const checked = await reconcile(path.join(processReceiptRoot(statePath), executionIdFor(canonical)))
  return { ...checked.view, ...canonical }
}
async function durableWrite(file: string, bytes: string | Buffer): Promise<void> {
  await assertDirectory(path.dirname(file))
  try {
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('receipt_file_invalid')
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const temp = `${file}.${randomUUID()}.tmp`
  const handle = await open(temp, 'wx', 0o600)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  await rename(temp, file)
  if (process.platform !== 'win32') {
    const directory = await open(path.dirname(file), 'r')
    try { await directory.sync() } finally { await directory.close() }
  }
}
async function verifyBytes(directory: string, name: string, expected: BytesRef, budget?: ReadBudget): Promise<Buffer> {
  if (!expected || !Number.isSafeInteger(expected.size) || expected.size < 0) throw new Error('invalid_byte_ref')
  const bytes = await boundedRead(path.join(directory, name), name === 'stdout' || name === 'stderr' ? PROCESS_STREAM_LIMIT : DECLARED_LIMIT, budget)
  if (bytes.length !== expected.size || byteDigest(bytes) !== expected.digest) throw new Error(`${name} bytes do not match producer receipt`)
  return bytes
}
async function reconcile(directory: string, budget?: ReadBudget): Promise<{ view: ProcessReceiptView; terminal?: Terminal; stdout?: Buffer }> {
  const executionId = path.basename(directory)
  let identity: ProcessIdentity = { workflowId: '', runId: '', nodeId: '', invocationId: '', attempt: 0 }
  let phase: ProcessReceiptView['phase'] = 'unknown'
  try {
    await assertDirectory(path.dirname(directory))
    await assertDirectory(directory)
    const preparedBytes = await boundedRead(path.join(directory, 'prepared.json'), METADATA_LIMIT, budget)
    const prepared = JSON.parse(preparedBytes.toString('utf8')) as Prepared
    if (prepared.schema !== 'sciforge.create-loop.process.v1' || prepared.executionId !== executionId ||
      executionIdFor(prepared.identity) !== executionId) throw new Error('Invalid prepared identity')
    identity = processIdentitySchema.parse(prepared.identity)
    phase = 'prepared'
    await verifyBytes(directory, 'input.json', prepared.input, budget)
    await verifyBytes(directory, 'script', prepared.script, budget)
    try {
      const started = JSON.parse((await boundedRead(path.join(directory, 'started.json'), METADATA_LIMIT, budget)).toString('utf8'))
      if (started.executionId !== executionId) throw new Error('Invalid started identity')
      phase = 'started'
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const terminalBytes = await boundedRead(path.join(directory, 'terminal.json'), METADATA_LIMIT, budget)
    const terminal = JSON.parse(terminalBytes.toString('utf8')) as Terminal
    if (terminal.executionId !== executionId || terminal.preparedDigest !== byteDigest(preparedBytes) ||
      !(terminal.exitCode === null || Number.isInteger(terminal.exitCode)) ||
      !['', 'process_error', 'stdin_error', 'process_aborted', 'process_timed_out', 'output_limit'].includes(terminal.error) || !['known', 'unknown'].includes(terminal.outcome) || typeof terminal.finishedAt !== 'string') throw new Error('Invalid terminal binding')
    const stdout = await verifyBytes(directory, 'stdout', terminal.stdout, budget)
    await verifyBytes(directory, 'stderr', terminal.stderr, budget)
    return { view: { ...identity, executionId, directory, phase: 'finished', verification: 'verified', outcome: terminal.outcome, reason: terminal.error,
      preparedDigest: byteDigest(preparedBytes), terminalDigest: byteDigest(terminalBytes) }, terminal, stdout }
  } catch {
    return { view: { ...identity, executionId, directory, phase, verification: 'unknown', outcome: 'unknown', reason: 'receipt_unavailable_or_invalid' } }
  }
}
export async function readProcessReceipts(statePath: string): Promise<{ receipts: ProcessReceiptView[]; coverage: ProcessReceiptCoverage }> {
  const views: ProcessReceiptView[] = []
  const budget: ReadBudget = { remaining: SNAPSHOT_READ_LIMIT }
  const coverage: ProcessReceiptCoverage = { status: 'complete', reason: '', scannedEntries: 0 }
  try {
    await assertDirectory(processReceiptRoot(statePath))
    const entries = await opendir(processReceiptRoot(statePath))
    for await (const entry of entries) {
      if (coverage.scannedEntries >= SNAPSHOT_ENTRY_LIMIT || budget.remaining <= 0 || budget.exhausted) {
        coverage.status = 'partial'
        coverage.reason = coverage.scannedEntries >= SNAPSHOT_ENTRY_LIMIT ? 'entry_limit' : 'byte_limit'
        break
      }
      coverage.scannedEntries += 1
      if (entry.isDirectory() && /^[a-f0-9]{64}$/u.test(entry.name)) {
        views.push((await reconcile(path.join(processReceiptRoot(statePath), entry.name), budget)).view)
        if (budget.exhausted) { coverage.status = 'partial'; coverage.reason = 'byte_limit' }
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      coverage.status = 'unavailable'; coverage.reason = 'journal_unavailable'
    }
  }
  return { receipts: views, coverage }
}
export async function executeReceiptedProcess(options: {
  statePath: string; identity: ProcessIdentity; command: string; script: string
  payload: { json: unknown; text: string }; cwd: string; signal: AbortSignal; timeoutMs: number; knownSecretValues?: readonly string[]
}): Promise<{ text: string; receipt: ProcessReceiptView }> {
  const { signal } = options
  const identity = processIdentitySchema.parse(options.identity)
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 2_147_483_647) throw new Error('Invalid process timeout')
  if (Buffer.byteLength(options.script) > DECLARED_LIMIT || Buffer.byteLength(JSON.stringify(options.payload)) > DECLARED_LIMIT) throw new Error('Declared process bytes exceed limit')
  const secrets = [...(options.knownSecretValues ?? []), ...collectWorkflowSecretValues(options.payload, options.script)]
  const declaredBytes = JSON.stringify({ payload: options.payload, script: options.script })
  if (collectWorkflowSecretValues(options.payload, options.script).length || secrets.some((secret) => secret && (declaredBytes.includes(secret) || declaredBytes.includes(JSON.stringify(secret).slice(1, -1))))) {
    throw new Error('Code receipt refused: declared input/script contains a recognized credential.')
  }
  const executionId = executionIdFor(identity)
  const root = processReceiptRoot(options.statePath), directory = path.join(root, executionId)
  const input = Buffer.from(JSON.stringify(options.payload)), script = Buffer.from(options.script)
  const prepared: Prepared = {
    schema: 'sciforge.create-loop.process.v1', identity, executionId, preparedAt: new Date().toISOString(),
    command: options.command, args: ['-c', options.script], cwd: path.resolve(options.cwd),
    environment: { platform: process.platform, architecture: process.arch, nodeVersion: process.version, inheritedEnvironment: 'unrecorded' },
    input: ref(input), script: ref(script)
  }
  const preparedBytes = JSON.stringify(prepared)
  if (Buffer.byteLength(preparedBytes) > METADATA_LIMIT) throw new Error('Declared process metadata exceeds limit')
  await mkdir(root, { recursive: true, mode: 0o700 })
  await assertDirectory(root)
  try { await mkdir(directory, { mode: 0o700 }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const existing = await reconcile(directory)
    if (existing.view.verification === 'verified') {
      const prepared = JSON.parse((await boundedRead(path.join(directory, 'prepared.json'), METADATA_LIMIT)).toString('utf8')) as Prepared
      if (prepared.command !== options.command || prepared.cwd !== path.resolve(options.cwd) ||
        prepared.script.digest !== byteDigest(options.script) || prepared.input.digest !== byteDigest(JSON.stringify(options.payload))) {
        throw new ProcessReceiptError(`Execution ${executionId} identity conflicts with frozen request`, true)
      }
    }
    if (existing.terminal && existing.stdout) return result(existing.view, existing.terminal, existing.stdout)
    throw new ProcessReceiptError(`Execution ${executionId} unknown: ${existing.view.reason}`, true)
  }
  // A directory is a permanent exclusive launch claim, even if preparation is interrupted.
  try {
    await assertDirectory(directory)
    await durableWrite(path.join(directory, 'input.json'), input)
    await durableWrite(path.join(directory, 'script'), script)
    await durableWrite(path.join(directory, 'prepared.json'), preparedBytes)
    if (signal.aborted) throw new ProcessReceiptError('Aborted before spawn; permanent launch claim retained.', true)
    const observed = await new Promise<{ stdout: Buffer; stderr: Buffer; exitCode: number | null; signal: string | null; error: string; outcome: 'known' | 'unknown' }>((resolve, reject) => {
      const stdout = Buffer.alloc(PROCESS_STREAM_LIMIT), stderr = Buffer.alloc(PROCESS_STREAM_LIMIT)
      let stdoutSize = 0, stderrSize = 0, forced = false
      let error = '', timedOut = false
      const child = spawn(prepared.command, prepared.args, { cwd: prepared.cwd,
        env: { ...process.env, WORKFLOW_JSON: JSON.stringify(options.payload.json), WORKFLOW_TEXT: options.payload.text },
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      let closeDeadline: ReturnType<typeof setTimeout> | undefined
      const stop = (terminationSignal: 'SIGKILL' | 'SIGTERM'): void => {
        forced = true
        child.kill(terminationSignal)
        closeDeadline ??= setTimeout(() => {
          clearTimeout(timer); signal.removeEventListener('abort', abort)
          child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy()
          finish(null, null)
        }, 2000)
      }
      const timer = setTimeout(() => { timedOut = true; error = 'process_timed_out'; stop('SIGKILL') }, options.timeoutMs)
      const abort = (): void => { error = 'process_aborted'; stop('SIGTERM') }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      let startedWrite: Promise<void> = Promise.resolve()
      child.once('spawn', () => {
        startedWrite = durableWrite(path.join(directory, 'started.json'), JSON.stringify({ executionId, pid: child.pid, startedAt: new Date().toISOString() }))
        void startedWrite.catch(() => undefined)
      })
      const capture = (bytes: Buffer, stream: 'stdout' | 'stderr'): void => {
        const buffer = stream === 'stdout' ? stdout : stderr
        const size = stream === 'stdout' ? stdoutSize : stderrSize
        const count = Math.min(bytes.length, PROCESS_STREAM_LIMIT - size)
        bytes.copy(buffer, size, 0, count)
        if (stream === 'stdout') stdoutSize += count
        else stderrSize += count
        if (count < bytes.length && !forced) { error = 'output_limit'; stop('SIGKILL') }
      }
      child.stdout.on('data', (bytes: Buffer) => capture(bytes, 'stdout'))
      child.stderr.on('data', (bytes: Buffer) => capture(bytes, 'stderr'))
      child.once('error', () => { error = 'process_error' })
      child.stdin.on('error', () => { if (!forced) error = 'stdin_error' })
      let settled = false
      const finish = (exitCode: number | null, exitSignal: string | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer); clearTimeout(closeDeadline); signal.removeEventListener('abort', abort)
        void startedWrite.then(() => resolve({ stdout: stdout.subarray(0, stdoutSize), stderr: stderr.subarray(0, stderrSize), exitCode, signal: exitSignal,
          error, outcome: forced || timedOut || exitSignal ? 'unknown' : 'known' }), reject)
      }
      child.once('close', finish)
      child.stdin.end(JSON.stringify(options.payload.json))
    })
    const logText = observed.stdout.toString('utf8') + '\n' + observed.stderr.toString('utf8')
    let outputJson: unknown
    try { outputJson = JSON.parse(observed.stdout.toString('utf8')) } catch { outputJson = null }
    if (collectWorkflowSecretValues(logText, outputJson).length || secrets.some((secret) => secret && logText.includes(secret))) {
      throw new ProcessReceiptError(`Execution ${executionId} unknown: raw logs contain a recognized credential; logs withheld`, true)
    }
    await durableWrite(path.join(directory, 'stdout'), observed.stdout)
    await durableWrite(path.join(directory, 'stderr'), observed.stderr)
    const terminal: Terminal = { executionId, preparedDigest: byteDigest(preparedBytes), finishedAt: new Date().toISOString(),
      exitCode: observed.exitCode, signal: observed.signal, error: observed.error, outcome: observed.outcome, stdout: ref(observed.stdout), stderr: ref(observed.stderr) }
    await durableWrite(path.join(directory, 'terminal.json'), JSON.stringify(terminal))
    const checked = await reconcile(directory)
    if (!checked.terminal || !checked.stdout) throw new ProcessReceiptError(`Execution ${executionId} terminal verification failed`, true)
    return result(checked.view, checked.terminal, checked.stdout)
  } catch (error) {
    if (error instanceof ProcessReceiptError) throw error
    throw new ProcessReceiptError(`Execution ${executionId} unknown: receipt_io_failed`, true)
  }
}
function result(receipt: ProcessReceiptView, terminal: Terminal, stdout: Buffer): { text: string; receipt: ProcessReceiptView } {
  if (terminal.outcome === 'unknown') throw new ProcessReceiptError(`Execution ${receipt.executionId} unknown: ${terminal.error || 'process_scope_unresolved'}`, true)
  if (terminal.error || terminal.exitCode !== 0 || terminal.signal) {
    throw new ProcessReceiptError(`Execution ${receipt.executionId}: ${terminal.error || `process exited ${terminal.exitCode} (${terminal.signal ?? 'no signal'})`}`, false)
  }
  return { text: stdout.toString('utf8').trim(), receipt }
}
