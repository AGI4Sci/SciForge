import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { win32 } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

export class DshRuntimeError extends Error {
  get recoverable(): boolean { return this.code.startsWith('runtime_model_route_') }
  constructor(readonly code: string) { super(code); this.name = 'DshRuntimeError' }
}
export type Wire = { jsonrpc?: string; id?: string | number; method?: string; params?: any; result?: any; error?: unknown }
/** Windows command processors cannot be exec'd directly; route .cmd/.bat shims
 * (the common npm global install form) through the command processor with
 * metacharacter-safe quoting, matching the Host's reviewed codex pattern. */
export function resolveDshLaunchInvocation(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  comSpec: string = process.env.ComSpec || 'cmd.exe'
): { command: string; args: readonly string[]; windowsVerbatimArguments?: boolean } {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(command)) return { command, args }
  if (/[&|<>^%!"\r\n]/.test(command)) throw new DshRuntimeError('runtime_path_invalid')
  const safeArgs = args.map((arg) => {
    if (/[&|<>^%!"\r\n]/.test(arg)) throw new DshRuntimeError('runtime_start_failed')
    return `"${arg}"`
  })
  // `/s` changes cmd.exe's quote-stripping rules and breaks quoted shims.
  return { command: comSpec, args: ['/d', '/c', `""${command}" ${safeArgs.join(' ')}"`], windowsVerbatimArguments: true }
}
/**
 * Resolve an npm-style Windows shim into the interpreter + entry script it wraps.
 *
 * `npm -g` installs `<prefix>\dsh.cmd`, whose whole body is
 * `"%dp0%\node.exe" "%dp0%\node_modules\@deepseek-ai\dsh\lib\bin.js" %*` with a
 * `node`-from-PATH fallback. The audited child environment deliberately carries
 * a minimal PATH, so that fallback cannot resolve and every probe failed with a
 * generic "deployment unapproved". Launching the shim's real entry with an
 * absolute interpreter removes the PATH dependency entirely while keeping the
 * audited environment minimal.
 */
export type DshShimLaunch = {
  /** Absolute interpreter path. */
  command: string
  /** Arguments the shim would have passed after the interpreter. */
  args: string[]
  /** The interpreter is this Electron binary, so it needs ELECTRON_RUN_AS_NODE. */
  electronRunAsNode: boolean
}
export function resolveDshShimLaunch(
  executable: string,
  args: readonly string[],
  options: {
    platform?: NodeJS.Platform
    parentPath?: string | undefined
    execPath?: string
    exists?: (path: string) => boolean
    readText?: (path: string) => string
  } = {}
): DshShimLaunch | undefined {
  const platform = options.platform ?? process.platform
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(executable)) return undefined
  const exists = options.exists ?? existsSync
  const readText = options.readText ?? ((path: string) => readFileSync(path, 'utf8'))
  let shim: string
  try {
    shim = readText(executable)
  } catch {
    return undefined
  }
  const entryMatch = shim.match(/%dp0%\\(node_modules\\[^"\r\n]+?\.(?:js|mjs|cjs))/i)
  if (!entryMatch) return undefined
  const entry = win32.join(win32.dirname(executable), entryMatch[1]!)
  if (!exists(entry)) return undefined
  const interpreter = resolveShimInterpreter(win32.dirname(executable), options.parentPath, options.execPath ?? process.execPath, exists)
  if (!interpreter) throw new DshRuntimeError('runtime_interpreter_missing')
  return { command: interpreter.command, args: [entry, ...args], electronRunAsNode: interpreter.electronRunAsNode }
}
function resolveShimInterpreter(
  shimDir: string,
  parentPath: string | undefined,
  execPath: string,
  exists: (path: string) => boolean
): { command: string; electronRunAsNode: boolean } | undefined {
  const beside = win32.join(shimDir, 'node.exe')
  if (exists(beside)) return { command: beside, electronRunAsNode: false }
  const pathValue = parentPath ?? process.env.PATH ?? ''
  for (const dir of pathValue.split(win32.delimiter)) {
    if (!dir || !win32.isAbsolute(dir)) continue
    const candidate = win32.join(dir, 'node.exe')
    if (exists(candidate)) return { command: candidate, electronRunAsNode: false }
  }
  // A packaged build ships Node inside Electron itself; it is a last-resort
  // interpreter that needs no install on the machine.
  if (/^node(?:\.exe)?$/i.test(win32.basename(execPath))) {
    return { command: execPath, electronRunAsNode: false }
  }
  return exists(execPath) ? { command: execPath, electronRunAsNode: true } : undefined
}
/** Budget semantics for one outbound request.
 *
 * `timeoutMs` alone is a maximum duration: the runtime must answer within it.
 * Lifecycle requests (initialize, session/new, resume, close, list) are bounded
 * that way because their completion never spans a turn.
 *
 * A request whose expected duration is the work itself — currently only
 * `session/prompt` — instead opts into `idle: true`: `timeoutMs` becomes the
 * maximum period of *silence*. Every inbound notification accepted by `matches`
 * re-arms the timer, so a runtime that keeps reporting progress stays pending
 * for as long as it keeps reporting, while one that emits nothing for
 * `timeoutMs` is treated as stuck.
 *
 * An idle expiry reports `runtime_request_idle_timeout` (distinct from the
 * `runtime_request_timeout` duration expiry and from protocol errors) and, like
 * every other transport failure, terminates the owned child. That is safe for
 * the prompt path because ACP session state is durable: the adapter keeps the
 * thread/session identity and resumes it on the next turn. */
export interface AcpRequestOptions {
  /** Budget for this request; defaults to the transport's lifecycle budget.
   * Interpreted as maximum duration unless `idle` is set. */
  timeoutMs?: number
  /** Treat `timeoutMs` as maximum silence instead of maximum duration. */
  idle?: boolean
  /** Selects the inbound notifications that count as activity for an idle
   * request. Defaults to every notification. Ignored when `idle` is unset. */
  matches?: (message: Wire) => boolean
}
type PendingRequest = {
  resolve: (value: any) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
  /** Set only for idle requests: maximum allowed gap between activities. */
  idleMs?: number
  matches?: (message: Wire) => boolean
}
/** ACP is newline-delimited JSON-RPC, not LSP Content-Length framing. */
export class AcpTransport {
  private child: ChildProcessWithoutNullStreams
  private nextId = 0
  private pending = new Map<number, PendingRequest>()
  private dead = false
  private stopping?: Promise<void>
  readonly exited: Promise<void>
  constructor(command: string, args: string[], env: NodeJS.ProcessEnv, cwd: string, private timeout: number,
    private onMessage: (message: Wire) => void, private onFailure: (error: Error) => void) {
    const launch = resolveDshLaunchInvocation(command, args)
    this.child = spawn(launch.command, [...launch.args], { env, cwd, shell: false, stdio: 'pipe', windowsHide: true, windowsVerbatimArguments: launch.windowsVerbatimArguments })
    this.exited = new Promise(resolve => this.child.once('close', () => { this.fail(new DshRuntimeError('runtime_disconnected')); resolve() }))
    this.child.on('error', () => this.fail(new DshRuntimeError('runtime_start_failed')))
    this.child.stdin.on('error', () => this.fail(new DshRuntimeError('runtime_disconnected')))
    // Deliberately discard stderr: never forward provider credentials/prompt/config to UI or logs.
    this.child.stderr.resume()
    const decoder = new StringDecoder('utf8')
    let buffer = ''
    this.child.stdout.on('data', chunk => {
      if (this.dead) return
      buffer += decoder.write(chunk)
      if (Buffer.byteLength(buffer) > 4 * 1024 * 1024) { this.fail(new DshRuntimeError('runtime_frame_limit')); return }
      for (;;) {
        const index = buffer.indexOf('\n')
        if (index < 0) break
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1)
        if (!line.trim()) continue
        try {
          const value = JSON.parse(line) as Wire
          if (!value || typeof value !== 'object' || value.jsonrpc !== '2.0') throw new Error()
          if (value.method) { this.onMessage(value); this.touch(value) }
          else if (typeof value.id === 'number') {
            const entry = this.pending.get(value.id)
            if (!entry) continue
            if (!('result' in value) && value.error === undefined) throw new Error()
            this.pending.delete(value.id); clearTimeout(entry.timer)
            if (value.error !== undefined) entry.reject(new DshRuntimeError('runtime_request_failed'))
            else if ('result' in value) entry.resolve(value.result)
            else throw new Error()
          }
        } catch { this.fail(new DshRuntimeError('runtime_protocol_invalid')); return }
      }
    })
  }
  get pid() { return this.child.pid }
  send(value: Wire) {
    if (this.dead) throw new DshRuntimeError('runtime_disconnected')
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n')
  }
  request(method: string, params: unknown, options: AcpRequestOptions = {}): Promise<any> {
    if (this.dead) return Promise.reject(new DshRuntimeError('runtime_disconnected'))
    const timeoutMs = options.timeoutMs ?? this.timeout
    const idle = options.idle === true
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new DshRuntimeError(idle ? 'runtime_request_idle_timeout' : 'runtime_request_timeout')), timeoutMs)
      this.pending.set(id, { resolve, reject, timer, idleMs: idle ? timeoutMs : undefined, matches: idle ? options.matches : undefined })
      try { this.send({ id, method, params }) } catch (error) { this.fail(error as Error) }
    })
  }
  /** Re-arm every idle request that this notification counts as activity for. */
  private touch(message: Wire) {
    for (const entry of this.pending.values()) {
      if (entry.idleMs === undefined || !(entry.matches?.(message) ?? true)) continue
      clearTimeout(entry.timer)
      entry.timer = setTimeout(() => this.fail(new DshRuntimeError('runtime_request_idle_timeout')), entry.idleMs)
    }
  }
  notify(method: string, params: unknown) { this.send({ method, params }) }
  private fail(error: Error) {
    if (this.dead) return
    this.dead = true
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error) }
    this.pending.clear()
    this.onFailure(error)
    void this.close()
  }
  close(): Promise<void> {
    if (this.stopping) return this.stopping
    this.stopping = (async () => {
      this.fail(new DshRuntimeError('runtime_closed'))
      if (this.child.exitCode !== null || this.child.signalCode !== null) { await this.exited; return }
      this.child.stdin.end()
      this.child.kill('SIGTERM')
      const timer = setTimeout(() => this.child.kill('SIGKILL'), 300)
      try { await this.exited } finally { clearTimeout(timer) }
    })()
    return this.stopping
  }
}
