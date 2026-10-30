import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import type { Json } from './ports.js'
import { awaitQuiescence } from './quiescence.js'

export type PythonWorkerOptions = Readonly<{
  executable: string; wheelPath: string; wheelSha256: string; storageRoot: string; home: string; tmpDir: string
  reasoner(input: Json, signal: AbortSignal, assertCurrent?: () => void): Promise<string>
  closeTimeoutMs?: number
}>
/** Host-approved executor component. It is NOT the SciForge controlled-process bridge.
 * No ambient environment is inherited; the exact wheel is verified before spawn.
 */
export class PythonEvidenceWorker {
  private activeContext?: { assertCurrent(): void; signal: AbortSignal }
  private child: ChildProcessWithoutNullStreams | undefined
  private started: Promise<void> | undefined
  private stopping: Promise<void> | undefined
  private processStop: Promise<void> | undefined
  private closed = false
  private exited: Promise<void> | undefined
  private readonly reasoning = new Set<Promise<void>>()
  private readonly abort = new AbortController()
  private readonly pending = new Map<string, { resolve(value: any): void; reject(error: unknown): void }>()
  constructor(private readonly options: PythonWorkerOptions) {}
  get pid() { return this.child?.pid }
  private start(writable: boolean) {
    return this.started ??= this.startOnce(writable)
  }
  private async startOnce(writable: boolean) {
    const assertCurrent = () => {
      if (this.closed) throw new Error('Evidence Python worker is closed.')
      this.activeContext?.signal.throwIfAborted()
      this.activeContext?.assertCurrent()
    }
    assertCurrent()
    const bytes = await readFile(this.options.wheelPath)
    if (!/^[a-f0-9]{64}$/.test(this.options.wheelSha256) || createHash('sha256').update(bytes).digest('hex') !== this.options.wheelSha256) throw new Error('Evidence Python wheel integrity mismatch.')
    assertCurrent()
    // Only an admitted writer bootstraps its executor environment. Existing
    // directories are not chmodded; activation and committed readers stay inert.
    if (writable) {
      for (const path of [this.options.home, this.options.tmpDir]) {
        await mkdir(path, { recursive: true, mode: 0o700 })
        assertCurrent()
      }
    }
    const child = spawn(this.options.executable, ['-I', '-u', '-c', 'import sys;sys.path.insert(0,sys.argv[1]);from evidence_dag.runtime_stdio import main;main()', this.options.wheelPath, this.options.storageRoot], {
      cwd: this.options.home, env: { HOME: this.options.home, TMPDIR: this.options.tmpDir, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    })
    this.child = child
    this.exited = new Promise<void>((resolve) => {
      const finish = () => { for (const item of this.pending.values()) item.reject(new Error('Evidence Python worker exited before the request settled.')); this.pending.clear(); resolve() }
      child.once('exit', finish)
      child.once('error', finish)
    })
    child.stderr.on('data', () => {}) // no raw stderr or user data is forwarded
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      try {
        if (Buffer.byteLength(line) > 64 * 1024 * 1024) throw new Error('Evidence response exceeds protocol limit.')
        const message = JSON.parse(line)
        if (message.type === 'reason') {
          const task = this.reason(message).finally(() => this.reasoning.delete(task))
          this.reasoning.add(task)
        } else if (message.type === 'response') {
          const pending = this.pending.get(message.id)
          if (!pending) return
          this.pending.delete(message.id)
          if (message.ok) pending.resolve(message.value)
          else pending.reject(Object.assign(new Error(message.error?.message ?? 'Evidence worker failed.'), { code: message.error?.code }))
        } else throw new Error('Invalid Evidence worker message.')
      } catch (error) {
        for (const item of this.pending.values()) item.reject(error)
        this.pending.clear()
        child.kill('SIGTERM')
      }
    })
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
  }
  private async reason(message: { id: string; input: Json }) {
    let response
    try { this.activeContext?.assertCurrent(); const value = await this.options.reasoner(message.input, this.abort.signal, () => this.activeContext?.assertCurrent()); this.activeContext?.assertCurrent(); response = { type: 'reason-result', id: message.id, ok: true, value } }
    catch (error) { response = { type: 'reason-result', id: message.id, ok: false, error: { message: error instanceof Error ? error.message : String(error) } } }
    if (!this.closed && this.child?.stdin.writable) this.child.stdin.write(JSON.stringify(response) + '\n')
  }
  private tail: Promise<unknown> = Promise.resolve()
  request(operation: 'extract' | 'commitSnapshot' | 'readSnapshot' | 'snapshotProducts', input: Json, context?: { assertCurrent(): void; signal: AbortSignal }): Promise<any> {
    // PortLLM temporarily owns stdin while reasoning: never interleave another
    // command with its response. Keep failures local so recovery reads still run.
    const work = this.tail.then(() => this.requestOnce(operation, input, context))
    this.tail = work.then(() => undefined, () => undefined)
    return work
  }
  private async requestOnce(operation: 'extract' | 'commitSnapshot' | 'readSnapshot' | 'snapshotProducts', input: Json, context?: { assertCurrent(): void; signal: AbortSignal }): Promise<any> {
    if (this.closed) throw new Error('Evidence Python worker is closed.')
    context?.assertCurrent()
    this.activeContext = context
    await this.start(operation === 'extract' || operation === 'commitSnapshot')
    context?.assertCurrent()
    if (this.closed || !this.child?.stdin.writable || this.child.exitCode !== null || this.child.signalCode !== null) throw new Error('Evidence Python worker is not live.')
    const id = randomUUID()
    return await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child!.stdin.write(JSON.stringify({ type: 'request', id, operation, input }) + '\n', (error) => { if (error) { this.pending.delete(id); reject(error) } })
    })
  }
  /** Actual producer settlement, without turning a caller deadline into quiescence. */
  async waitForQuiescence(): Promise<void> {
    if (!this.closed) throw new Error('Stop the Evidence worker before awaiting quiescence.')
    await this.processStop
    await Promise.all(this.reasoning)
  }
  close(): Promise<void> {
    if (this.stopping) return this.stopping
    const attempt = this.closeOnce()
    this.stopping = attempt
    attempt.catch(() => { if (this.stopping === attempt) this.stopping = undefined })
    return attempt
  }
  private async closeOnce() {
    this.closed = true
    this.abort.abort()
    const timeout = this.options.closeTimeoutMs ?? 5_000
    // The stop owner outlives a caller's deadline. Retrying close joins it;
    // it never resets the escalation clock or reports a timeout as exit.
    this.processStop ??= this.stopProcess()
    await awaitQuiescence(this.processStop, timeout, 'worker OS exit')
    await awaitQuiescence(Promise.all(this.reasoning), timeout, 'reasoner')
  }
  private async stopProcess() {
    await this.started?.catch(() => undefined)
    const child = this.child
    if (child && child.exitCode === null && child.signalCode === null) {
      const timer = setTimeout(() => child.kill('SIGKILL'), 2_000)
      child.kill('SIGTERM')
      try { await this.exited! } finally { clearTimeout(timer) }
    }
  }
}
