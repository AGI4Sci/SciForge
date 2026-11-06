import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import type { HostServiceOwner, HostServiceProvider, HostServiceRequest } from '@sciforge/plugin-sdk'
import { executableFileExists, findExecutableCommand, splitCommandSearchPath } from '../runtime/command-discovery'

export type NativeExecutionPolicy = Readonly<{
  mode: 'read-only' | 'workspace-write' | 'danger-full-access'
  workspaceRoot: string
  sessionId?: string
}>
export type NativeExecutionContext = Readonly<{ workspaceRoot: string; policy: NativeExecutionPolicy }>
export type NativeExecutionApprovalDecision = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
export type NativeExecutionHostServiceOptions = Readonly<{
  resolveContext: (request: HostServiceRequest) => NativeExecutionContext | Promise<NativeExecutionContext>
  requestApproval: (request: HostServiceRequest, input: { reason: string; toolName?: string; callId?: string }) => NativeExecutionApprovalDecision | Promise<NativeExecutionApprovalDecision>
  /** Exact Host-approved Node runtime, used only for an Electron execPath. */
  nodeExecutable?: string
}>
type Output = { text: string; lossy: boolean }
type Result = { exitCode: number | null; signal?: string; stdout: Output; stderr: Output }
type Plan = { owner: string; generation: string; argv: string[]; context: NativeExecutionContext; policy: NativeExecutionPolicy }
type Running = { owner: string; generation: string; child: ChildProcess; done: Promise<Result>; terminate: () => Promise<void> }
const execute = promisify(execFile)
const MAX_LOG = 16 * 1024 * 1024

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.')
  return value as Record<string, unknown>
}
function fields(value: unknown, keys: string[]): Record<string, unknown> {
  const item = record(value)
  if (Object.keys(item).some(key => !keys.includes(key))) throw new Error('Unexpected input field.')
  return item
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error('Expected a nonempty string without NUL.')
  return value
}
function integer(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) throw new Error('Invalid integer limit.')
  return value as number
}
function policy(value: unknown): NativeExecutionPolicy {
  const item = fields(value, ['mode', 'workspaceRoot', 'sessionId'])
  if (!['read-only', 'workspace-write', 'danger-full-access'].includes(item.mode as string)) throw new Error('Invalid execution policy mode.')
  return { mode: item.mode as NativeExecutionPolicy['mode'], workspaceRoot: text(item.workspaceRoot), ...(item.sessionId === undefined ? {} : { sessionId: text(item.sessionId) }) }
}
function generation(owner: HostServiceOwner): string {
  return JSON.stringify([owner.connectionId, owner.pluginId, owner.packageName, owner.version, owner.generation])
}
function identity(owner: HostServiceOwner): string { return JSON.stringify([generation(owner), owner.invocationId, owner.authority]) }
function contained(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}
async function canonical(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error('An absolute workspace path is required.')
  return realpath(path)
}
function current(request: HostServiceRequest): void {
  request.signal.throwIfAborted()
  request.assertCurrent?.()
}
function capture(stream: NodeJS.ReadableStream, maxBytes: number): () => Output {
  const chunks: Buffer[] = []
  let kept = 0, total = 0
  stream.on('data', (data: Buffer) => {
    const bytes = Buffer.from(data)
    total += bytes.length
    if (kept < maxBytes) {
      const part = bytes.subarray(0, maxBytes - kept)
      chunks.push(part)
      kept += part.length
    }
  })
  return () => {
    const bytes = Buffer.concat(chunks)
    const decoded = bytes.toString('utf8')
    return { text: decoded, lossy: total > kept || !Buffer.from(decoded).equals(bytes) }
  }
}
function groupExists(pid: number): boolean {
  try { process.kill(-pid, 0); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}
function killGroup(pid: number, signal: NodeJS.Signals): void {
  try { process.kill(-pid, signal) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}
function deadline<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Cannot prove native process teardown.')), milliseconds)
    promise.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
}
async function absent(pid: number): Promise<void> {
  const end = Date.now() + 5000
  while (groupExists(pid)) {
    if (Date.now() >= end) throw new Error('Cannot prove native process group teardown.')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

/** Generic Host boundary: the resolver authenticates the live workspace and caller. */
export function createNativeExecutionHostService(options: NativeExecutionHostServiceOptions): HostServiceProvider {
  const plans = new Map<string, Plan>()
  const processes = new Map<string, Running>()
  const disposed = new Set<string>()
  const active = (request: HostServiceRequest): void => {
    current(request)
    if (disposed.has(generation(request.owner))) throw new Error('Native execution authority is unavailable.')
  }
  const baseline = () => ({ PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin', HOME: homedir(), TMPDIR: tmpdir() })
  const authorize = async (request: HostServiceRequest): Promise<void> => {
    current(request)
    const authority = record(request.owner.authority)
    const caller = record(authority.caller)
    const session = record(authority.ordinarySession)
    text(authority.capabilityId); text(caller.callerId); text(caller.workspaceId)
    text(session.runtimeId); text(session.threadId)
    if (request.serviceId !== 'nativeExecution' || authority.effect !== 'workspace-write' || !request.owner.invocationId || disposed.has(generation(request.owner))) throw new Error('Native execution authority is unavailable.')
    await options.resolveContext(request)
    current(request)
  }
  const context = async (request: HostServiceRequest): Promise<NativeExecutionContext> => {
    await authorize(request)
    const resolved = await options.resolveContext(request)
    const root = await canonical(text(resolved.workspaceRoot))
    const bound = policy(resolved.policy)
    const policyRoot = await canonical(bound.workspaceRoot)
    if (!contained(root, policyRoot)) throw new Error('Policy workspace escapes authenticated workspace.')
    current(request)
    return { workspaceRoot: root, policy: { ...bound, workspaceRoot: policyRoot } }
  }
  const effective = async (bound: NativeExecutionContext, requested: NativeExecutionPolicy): Promise<NativeExecutionPolicy> => {
    const root = await canonical(requested.workspaceRoot)
    const ranks = { 'read-only': 0, 'workspace-write': 1, 'danger-full-access': 2 }
    if (!contained(bound.workspaceRoot, root) || !contained(bound.policy.workspaceRoot, root) || ranks[requested.mode] > ranks[bound.policy.mode] || requested.sessionId !== bound.policy.sessionId) throw new Error('Execution policy widens authenticated authority.')
    return { ...requested, workspaceRoot: root }
  }
  const sandbox = async (requested: NativeExecutionPolicy, argv: string[]): Promise<string[]> => {
    if (process.platform === 'win32') throw new Error('Native process groups are unsupported on Windows.')
    if (requested.mode === 'danger-full-access') return argv
    if (process.platform !== 'darwin') throw new Error('Full native confinement is unavailable on this platform.')
    const writable = ['/dev/null']
    if (requested.mode === 'workspace-write') writable.push(requested.workspaceRoot, await realpath(tmpdir()))
    const rules = writable.map(path => path === '/dev/null' ? `(literal ${JSON.stringify(path)})` : `(subpath ${JSON.stringify(path)})`).join(' ')
    const profile = `(version 1) (allow default) (deny file-write*) (allow file-write* ${rules})`
    // Probe the real backend; the existence of sandbox-exec alone is insufficient.
    await execute('/usr/bin/sandbox-exec', ['-p', profile, '/usr/bin/true'], { env: baseline(), timeout: 5000 })
    return ['/usr/bin/sandbox-exec', '-p', profile, ...argv]
  }
  const lookup = (request: HostServiceRequest, processId: unknown): Running => {
    const running = processes.get(text(processId))
    if (!running || running.owner !== identity(request.owner)) throw new Error('Unknown native process handle for this invocation.')
    return running
  }
  const awaitResult = async (request: HostServiceRequest, running: Running): Promise<Result> => {
    const abort = () => { void running.terminate().catch(() => undefined) }
    request.signal.addEventListener('abort', abort, { once: true })
    try {
      if (request.signal.aborted) await running.terminate()
      const result = await running.done
      current(request)
      return result
    } finally { request.signal.removeEventListener('abort', abort) }
  }
  return {
    authorize,
    async dispose(owner) {
      const key = generation(owner)
      disposed.add(key)
      for (const [id, plan] of plans) if (plan.generation === key) plans.delete(id)
      const owned = [...processes.entries()].filter(([, item]) => item.generation === key)
      await Promise.all(owned.map(async ([id, running]) => { await running.terminate(); await running.done; processes.delete(id) }))
    },
    operations: {
      async 'context.resolve'(request) {
        fields(request.input, [])
        return context(request)
      },
      async 'approval.request'(request) {
        await context(request)
        const input = fields(request.input, ['reason', 'toolName', 'callId'])
        const decision = await options.requestApproval(request, { reason: text(input.reason), ...(input.toolName === undefined ? {} : { toolName: text(input.toolName) }), ...(input.callId === undefined ? {} : { callId: text(input.callId) }) })
        current(request)
        if (!['allowed-once', 'rejected', 'cancelled', 'unavailable'].includes(decision)) throw new Error('Invalid Host approval decision.')
        return decision
      },
      async 'process.confine'(request) {
        const bound = await context(request)
        const input = fields(request.input, ['argv', 'policy'])
        if (!Array.isArray(input.argv) || !input.argv.length || input.argv.length > 4096) throw new Error('Invalid argv.')
        const argv = input.argv.map(value => {
          if (typeof value !== 'string' || value.includes('\0') || value.length > 1024 * 1024) throw new Error('Invalid argv entry.')
          return value
        })
        text(argv[0])
        if (!isAbsolute(argv[0])) {
          if (!/^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/.test(argv[0])) throw new Error('A plain executable name or absolute path is required.')
          // Only the Host's PATH participates, never cwd or process.spawn's child env.
          const directories = splitCommandSearchPath(baseline().PATH, process.platform).filter(isAbsolute)
          const executable = await findExecutableCommand(argv[0], directories, process.platform, path => executableFileExists(path, process.platform))
          if (!executable) throw new Error('Executable was not found in the trusted Host PATH.')
          argv[0] = executable
        }
        argv[0] = await realpath(argv[0])
        if (process.versions.electron && argv[0] === await realpath(process.execPath)) {
          if (!options.nodeExecutable) throw new Error('The Host must configure an approved Node executable.')
          argv[0] = await canonical(options.nodeExecutable)
        }
        if (!await executableFileExists(argv[0], process.platform)) throw new Error('An executable file is required.')
        const requested = await effective(bound, policy(input.policy))
        const confined = await sandbox(requested, argv)
        active(request)
        const id = randomUUID()
        plans.set(id, { owner: identity(request.owner), generation: generation(request.owner), argv: confined, context: bound, policy: requested })
        return { argv: [id], enforcement: 'full' }
      },
      async 'process.spawn'(request) {
        const bound = await context(request)
        const input = fields(request.input, ['argv', 'cwd', 'env', 'stdio', 'graceMs'])
        if (!Array.isArray(input.argv) || input.argv.length !== 1) throw new Error('A single opaque execution plan is required.')
        const id = text(input.argv[0]), plan = plans.get(id)
        if (!plan || plan.owner !== identity(request.owner)) throw new Error('Unknown execution plan for this invocation.')
        // Plans are one-use, including failed attempts, and never authorize changed policy.
        plans.delete(id)
        if (JSON.stringify(bound) !== JSON.stringify(plan.context)) throw new Error('Authenticated execution context changed.')
        await effective(bound, plan.policy)
        const cwd = await canonical(text(input.cwd))
        if (!contained(bound.workspaceRoot, cwd) || !contained(plan.policy.workspaceRoot, cwd)) throw new Error('Process cwd escapes the execution workspace.')
        const env: NodeJS.ProcessEnv = baseline()
        if (input.env !== undefined) for (const [key, value] of Object.entries(record(input.env))) {
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || (key === 'ELECTRON_RUN_AS_NODE' && value !== '1')) throw new Error('Invalid environment key.')
          if (typeof value !== 'string' || value.includes('\0')) throw new Error('Invalid environment value.')
          env[key] = value
        }
        const io = fields(input.stdio, ['stdout', 'stderr', 'stdin'])
        const stdoutLimit = integer(fields(io.stdout, ['maxBytes']).maxBytes, 1024 * 1024, MAX_LOG)
        const stderrLimit = integer(fields(io.stderr, ['maxBytes']).maxBytes, 1024 * 1024, MAX_LOG)
        let stdin = ''
        if (io.stdin !== undefined) {
          const data = fields(io.stdin, ['data']).data
          if (typeof data !== 'string' || Buffer.byteLength(data) > MAX_LOG) throw new Error('Invalid stdin data.')
          stdin = data
        }
        const graceMs = integer(input.graceMs, 100, 5000)
        active(request)
        const child = spawn(plan.argv[0], plan.argv.slice(1), { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false })
        const output = capture(child.stdout!, stdoutLimit), errors = capture(child.stderr!, stderrLimit)
        child.stdin!.on('error', () => undefined)
        child.stdin!.end(stdin)
        let terminatePromise: Promise<void> | undefined
        const terminate = (): Promise<void> => terminatePromise ??= (async () => {
          if (!child.pid) return
          killGroup(child.pid, 'SIGTERM')
          if (graceMs && groupExists(child.pid)) await new Promise(resolve => setTimeout(resolve, graceMs))
          killGroup(child.pid, 'SIGKILL')
          await absent(child.pid)
        })()
        const closed = new Promise<{ exitCode: number | null; signal: string | null }>((resolve, reject) => {
          child.once('error', reject)
          child.once('close', (exitCode, signal) => resolve({ exitCode, signal }))
        })
        closed.catch(() => undefined)
        // A root can exit while descendants still hold pipes or keep writing.
        const exited = new Promise<void>((resolve, reject) => {
          child.once('error', reject)
          child.once('exit', () => { void terminate().catch(() => undefined); resolve() })
        })
        const abort = () => { void terminate().catch(() => undefined) }
        request.signal.addEventListener('abort', abort, { once: true })
        const done = (async (): Promise<Result> => {
          try {
            await exited
            await terminate()
            const status = await deadline(closed, 5000)
            return { exitCode: status.exitCode, ...(status.signal ? { signal: status.signal } : {}), stdout: output(), stderr: errors() }
          } finally { request.signal.removeEventListener('abort', abort) }
        })()
        done.catch(() => undefined)
        const processId = randomUUID()
        processes.set(processId, { owner: identity(request.owner), generation: generation(request.owner), child, done, terminate })
        // Let spawn errors settle before returning an unusable handle.
        try {
          await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
          if (request.signal.aborted) { await terminate(); await done }
          current(request)
          return { processId }
        } catch (error) {
          await terminate()
          await done.catch(() => undefined)
          processes.delete(processId)
          throw error
        }
      },
      async 'process.wait'(request) {
        await context(request)
        const input = fields(request.input, ['processId'])
        return awaitResult(request, lookup(request, input.processId))
      },
      async 'process.stop'(request) {
        await context(request)
        const input = fields(request.input, ['processId'])
        const running = lookup(request, input.processId)
        await running.terminate()
        const result = await awaitResult(request, running)
        return { ...result, quiescent: true }
      }
    }
  }
}
