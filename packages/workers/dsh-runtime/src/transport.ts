import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
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
): { command: string; args: readonly string[] } {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(command)) return { command, args }
  if (/[&|<>^%!"\r\n]/.test(command)) throw new DshRuntimeError('runtime_path_invalid')
  const safeArgs = args.map((arg) => {
    if (/[&|<>^%!"\r\n]/.test(arg)) throw new DshRuntimeError('runtime_start_failed')
    return `"${arg}"`
  })
  // `/s` changes cmd.exe's quote-stripping rules and breaks quoted shims.
  return { command: comSpec, args: ['/d', '/c', `""${command}" ${safeArgs.join(' ')}"`] }
}
/** ACP is newline-delimited JSON-RPC, not LSP Content-Length framing. */
export class AcpTransport {
  private child: ChildProcessWithoutNullStreams
  private nextId = 0
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
  private dead = false
  private stopping?: Promise<void>
  readonly exited: Promise<void>
  constructor(command: string, args: string[], env: NodeJS.ProcessEnv, cwd: string, private timeout: number,
    private onMessage: (message: Wire) => void, private onFailure: (error: Error) => void) {
    const launch = resolveDshLaunchInvocation(command, args)
    this.child = spawn(launch.command, [...launch.args], { env, cwd, shell: false, stdio: 'pipe' })
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
          if (value.method) this.onMessage(value)
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
  request(method: string, params: unknown, timeoutMs = this.timeout): Promise<any> {
    if (this.dead) return Promise.reject(new DshRuntimeError('runtime_disconnected'))
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new DshRuntimeError('runtime_request_timeout')), timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try { this.send({ id, method, params }) } catch (error) { this.fail(error as Error) }
    })
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
