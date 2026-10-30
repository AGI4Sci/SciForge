import { spawn, type ChildProcess } from 'node:child_process'
import { piLaunch, terminateProcessTree } from './pi-runtime-probe'

/**
 * Minimal JSONL RPC client for Pi's custom `--mode rpc` protocol.
 *
 * Verified wire facts against @earendil-works/pi-coding-agent@1.4.0:
 * - Records are LF-framed JSON (one optional CR stripped). This is NOT
 *   JSON-RPC 2.0: no initialize handshake, no jsonrpc member.
 * - Commands are id-correlated: the caller sets `id`, the peer answers with
 *   `{type:"response", id, command, success, data|error}`.
 * - Agent records stream as `{type:"agent_start" | "turn_start" |
 *   "message_start" | "message_update" | "message_end" | "turn_end" |
 *   "agent_end" | "agent_settled" | "error", ...}`.
 * - There is no close/shutdown command: closing ends stdin and tree-kills.
 *
 * Every parsed record is stamped with a monotonically increasing arrival
 * index. Waiters only match records arriving AFTER a caller-provided mark,
 * so a record belonging to a previous turn can never satisfy a new turn's
 * wait (observed failure mode in naive buffered-first harnesses).
 */

export type PiRpcRecord = Readonly<Record<string, unknown>> & { type?: string }

export type PiRpcResponse = Readonly<{
  id: string
  type: 'response'
  command?: string
  success: boolean
  data?: unknown
  error?: string
}>

export type PiRpcStampedRecord = Readonly<{
  arrival: number
  record: PiRpcRecord
}>

export type PiRpcClientOptions = Readonly<{
  executablePath: string
  args: readonly string[]
  cwd: string
  env?: NodeJS.ProcessEnv
}>

const COMMAND_TIMEOUT_MS = 30_000

/** Strip credential-shaped fragments before stderr is surfaced in errors/journals. */
function redactStderr(text: string): string {
  return text
    .replace(/(bearer\s+)[a-z0-9._~+/=-]+/gi, '$1<redacted>')
    .replace(/\b(sk|key|token|apikey|api_key|authorization)[-_]?([a-z]{0,10})[=:]\s*["']?[^\s"']{6,}/gi, '$1$2=<redacted>')
}

export class PiRpcClient {
  private readonly child: ChildProcess
  private readonly records: PiRpcRecord[] = []
  private readonly waiters: Array<{
    after: number
    predicate: (record: PiRpcRecord) => boolean
    resolve: (record: PiRpcRecord) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
    signal?: AbortSignal
    onAbort?: () => void
  }> = []
  private readonly listeners = new Set<(record: PiRpcRecord) => void>()
  private readonly exitPromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  private stderrTail = ''
  private exited = false
  private seq = 0
  private disposed = false

  private constructor(child: ChildProcess) {
    this.child = child
    // Drain stderr into a capped tail buffer: a child whose stderr pipe
    // fills would block indefinitely, and crash diagnostics must survive
    // the exit for the service to surface.
    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString('utf8')).slice(-8192)
    })
    let buffer = Buffer.alloc(0)
    const stdout = child.stdout
    if (!stdout) throw new Error('pi RPC stdout pipe unavailable')
    stdout.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      let index
      // Strict LF framing; strip one optional CR. Never split on U+2028/U+2029.
      while ((index = buffer.indexOf(0x0a)) !== -1) {
        let line = buffer.subarray(0, index)
        buffer = buffer.subarray(index + 1)
        if (line.length && line[line.length - 1] === 0x0d) line = line.subarray(0, line.length - 1)
        if (!line.length) continue
        try {
          this.accept(JSON.parse(line.toString('utf8')) as PiRpcRecord)
        } catch {
          // Non-JSON diagnostics on stdout are a protocol violation; surface
          // them as an error record instead of corrupting the stream.
          this.accept({ type: 'error', reason: 'protocol_violation', error: 'non-JSON record on RPC stdout' })
        }
      }
    })
    this.exitPromise = new Promise((resolve) => {
      let settledExit = false
      const settle = (code: number | null, signal: NodeJS.Signals | null): void => {
        if (settledExit) return
        settledExit = true
        this.exited = true
        const failure = new Error(`pi process exited before answering (code ${code}, signal ${signal ?? 'none'})`)
        for (const waiter of this.waiters.splice(0)) {
          clearTimeout(waiter.timer)
          waiter.reject(failure)
        }
        resolve({ code, signal })
      }
      child.on('exit', (code, signal) => settle(code, signal))
      // A failed spawn (missing executable, EACCES) raises 'error' and may
      // never raise 'exit'; without this the client would hang forever.
      child.on('error', (error) => settle(null, null))
    })
  }

  static spawn(options: PiRpcClientOptions): PiRpcClient {
    const launch = piLaunch(options.executablePath, options.args)
    const child = spawn(launch.command, launch.args, {
      env: options.env ?? process.env,
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: launch.verbatim
    })
    return new PiRpcClient(child)
  }

  /** Wrap an already-spawned child (test harnesses spawn a scripted fake). */
  static fromChild(child: ChildProcess): PiRpcClient {
    return new PiRpcClient(child)
  }

  /** Arrival count watermark: waiters with `after: mark` skip earlier records. */
  mark(): number {
    return this.records.length
  }

  get hasExited(): boolean {
    return this.exited
  }

  /** Tail of the child's stderr (capped, redacted); crash diagnostics only. */
  get stderrText(): string {
    return redactStderr(this.stderrTail)
  }

  /** Resolves when the process exits; never rejects. */
  exit(): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    return this.exitPromise
  }

  /** Subscribe to every record as it arrives. Returns an unsubscribe function. */
  onRecord(listener: (record: PiRpcRecord) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private accept(record: PiRpcRecord): void {
    this.records.push(record)
    for (const listener of [...this.listeners]) listener(record)
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const waiter = this.waiters[i]
      const arrival = this.records.length // index of the record just pushed
      if (arrival <= waiter.after) continue
      if (!waiter.predicate(record)) continue
      this.waiters.splice(i, 1)
      clearTimeout(waiter.timer)
      waiter.signal?.removeEventListener('abort', waiter.onAbort!)
      waiter.resolve(record)
    }
  }

  /** Send a command and await its id-correlated response. */
  command<TData = unknown>(
    cmd: Readonly<Record<string, unknown>> & { type: string },
    options: { timeoutMs?: number; signal?: AbortSignal } = {}
  ): Promise<PiRpcResponse & { data?: TData }> {
    if (this.exited) return Promise.reject(new Error('pi process has exited'))
    const id = cmd.id ? String(cmd.id) : `c${++this.seq}`
    const payload = { ...cmd, id }
    const mark = this.mark()
    const promise = this.waitFor(
      (record) => record.type === 'response' && record.id === id,
      { after: mark, timeoutMs: options.timeoutMs ?? COMMAND_TIMEOUT_MS, signal: options.signal, label: `response to ${cmd.type}` }
    ) as Promise<PiRpcResponse & { data?: TData }>
    const stdin = this.child.stdin
    if (!stdin) {
      return Promise.reject(new Error('pi RPC stdin pipe unavailable'))
    }
    stdin.write(JSON.stringify(payload) + '\n')
    return promise
  }

  /** Await the first record matching `predicate` that arrives after `after`. */
  waitFor(
    predicate: (record: PiRpcRecord) => boolean,
    options: { after?: number; timeoutMs: number; signal?: AbortSignal; label?: string }
  ): Promise<PiRpcRecord> {
    if (this.exited) return Promise.reject(new Error('pi process has exited'))
    const after = options.after ?? 0
    return new Promise((resolve, reject) => {
      const waiter: (typeof this.waiters)[number] = {
        after,
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter)
          if (index !== -1) this.waiters.splice(index, 1)
          reject(new Error(`timeout waiting for ${options.label ?? 'pi record'}`))
        }, options.timeoutMs),
        signal: options.signal
      }
      if (options.signal) {
        const onAbort = (): void => {
          const index = this.waiters.indexOf(waiter)
          if (index !== -1) this.waiters.splice(index, 1)
          clearTimeout(waiter.timer)
          reject(new Error('wait aborted'))
        }
        waiter.onAbort = onAbort
        if (options.signal.aborted) {
          onAbort()
          return
        }
        options.signal.addEventListener('abort', onAbort, { once: true })
      }
      this.waiters.push(waiter)
    })
  }

  /** End stdin, then tree-kill the whole shim chain (never by name). */
  async close(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    try {
      this.child.stdin?.end()
    } catch {
      // Already closed.
    }
    await Promise.race([this.exitPromise, new Promise((r) => setTimeout(r, 5_000))])
    await terminateProcessTree(this.child)
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error('pi client closed'))
    }
  }
}

/**
 * Verified-safe launch arguments for a text-only conversation session.
 * Session persistence is deliberately NOT decided here: the service appends
 * `--session-dir <host-managed dir>` (persistent) or `--no-session`
 * (ephemeral fallback when no storage root is configured).
 */
export const PI_CONVERSATION_ARGS = [
  '--mode', 'rpc',
  '--no-approve',
  '--no-tools',
  '--no-mcp',
  '--no-extensions',
  '--no-skills',
  '--no-context-files'
] as const

/**
 * Verified-safe launch base for a tool-enabled session (host extension
 * bridge). Differs from PI_CONVERSATION_ARGS exactly as probe-verified on
 * 1.4.0: `--no-tools`/`--no-mcp` are dropped because the host extension
 * replaces built-in MCP support (pi never reads mcp.json) and the exact
 * `--tools <names>` whitelist (appended by the service together with
 * `-e <host extension>`) gates every tool the model can call. Approvals stay
 * disabled (`--no-approve`): tool governance is enforced host-side at the
 * lease endpoint, not by pi's own prompts.
 */
export const PI_TOOL_SESSION_BASE_ARGS = [
  '--mode', 'rpc',
  '--no-approve',
  '--no-extensions',
  '--no-skills',
  '--no-context-files'
] as const
