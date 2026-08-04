import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process'
import { join } from 'node:path'
import type { Readable } from 'node:stream'

export type ProcessRequest = Readonly<{
  executable: 'ssh' | 'sftp'
  args: readonly string[]
  stdin?: string
  timeoutMs: number
  maxOutputBytes: number
  signal?: AbortSignal
}>

export type ProcessResult = Readonly<{
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  truncated: boolean
  timedOut: boolean
}>

export interface RemoteSshProcessRunner {
  run(request: ProcessRequest): Promise<ProcessResult>
}

export type StreamingProcessRequest = Readonly<{
  executable: 'ssh'
  args: readonly string[]
  signal?: AbortSignal
}>

export type StreamingProcessExit = Readonly<{
  exitCode: number | null
  signal: NodeJS.Signals | null
}>

/**
 * Package-private transport primitive used by Workspace Host attachment.
 * It is intentionally not a renderer contract and never exposes a target alias.
 */
export interface RemoteSshStreamingProcess {
  readonly stdout: Readable
  readonly stderr: Readable
  readonly exit: Promise<StreamingProcessExit>
  write(data: string | Uint8Array): Promise<void>
  end(): void
  dispose(): Promise<void>
}

export interface RemoteSshStreamingProcessRunner {
  open(request: StreamingProcessRequest): RemoteSshStreamingProcess
}

export type SpawnProcess = (
  executable: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio & { stdio: ['pipe', 'pipe', 'pipe'] }
) => ChildProcessWithoutNullStreams

export class SystemOpenSshProcessRunner
implements RemoteSshProcessRunner, RemoteSshStreamingProcessRunner {
  constructor(
    private readonly spawnProcess: SpawnProcess = spawn as SpawnProcess,
    private readonly executablePaths: Readonly<Partial<Record<'ssh' | 'sftp', string>>> = {}
  ) {}

  run(request: ProcessRequest): Promise<ProcessResult> {
    if (request.signal?.aborted) return Promise.reject(abortError())

    return new Promise((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams
      try {
        child = this.spawnProcess(
          this.executablePaths[request.executable] ?? systemOpenSshExecutable(request.executable),
          request.args,
          {
            shell: false,
            windowsHide: true,
            env: openSshEnvironment(process.env),
            stdio: ['pipe', 'pipe', 'pipe']
          }
        )
      } catch (error) {
        reject(error)
        return
      }

      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let capturedBytes = 0
      let truncated = false
      let timedOut = false
      let aborted = false
      let settled = false
      let forceKill: ReturnType<typeof setTimeout> | undefined

      const capture = (bucket: Buffer[], chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        const remaining = request.maxOutputBytes - capturedBytes
        if (remaining <= 0) {
          truncated = true
          return
        }
        if (bytes.length > remaining) {
          bucket.push(bytes.subarray(0, remaining))
          capturedBytes += remaining
          truncated = true
          return
        }
        bucket.push(bytes)
        capturedBytes += bytes.length
      }
      child.stdout.on('data', (chunk: Buffer | string) => capture(stdout, chunk))
      child.stderr.on('data', (chunk: Buffer | string) => capture(stderr, chunk))
      // A peer may close before all stdin is consumed. The process close event is
      // authoritative; suppress the otherwise-unhandled stream-level EPIPE event.
      child.stdin.on('error', () => undefined)

      const terminate = () => {
        if (!child.killed) child.kill('SIGTERM')
        forceKill ??= setTimeout(() => {
          if (!settled) child.kill('SIGKILL')
        }, 1_000)
        forceKill.unref?.()
      }
      const onAbort = () => {
        aborted = true
        terminate()
      }
      request.signal?.addEventListener('abort', onAbort, { once: true })
      const timeout = setTimeout(() => {
        timedOut = true
        terminate()
      }, request.timeoutMs)
      timeout.unref?.()

      child.once('error', (error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (forceKill) clearTimeout(forceKill)
        request.signal?.removeEventListener('abort', onAbort)
        reject(error)
      })
      child.once('close', (exitCode, signal) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (forceKill) clearTimeout(forceKill)
        request.signal?.removeEventListener('abort', onAbort)
        if (aborted) {
          reject(abortError())
          return
        }
        resolve({
          exitCode,
          signal,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          truncated,
          timedOut
        })
      })

      try {
        if (request.stdin !== undefined) child.stdin.end(request.stdin)
        else child.stdin.end()
      } catch {
        // A synchronously destroyed stdin races with process shutdown. The child
        // error/close events above remain the single settlement path.
      }
    })
  }

  open(request: StreamingProcessRequest): RemoteSshStreamingProcess {
    if (request.signal?.aborted) throw abortError()

    const child = this.spawnProcess(
      this.executablePaths.ssh ?? systemOpenSshExecutable('ssh'),
      request.args,
      {
        shell: false,
        windowsHide: true,
        env: openSshEnvironment(process.env),
        stdio: ['pipe', 'pipe', 'pipe']
      }
    )
    child.stdin.on('error', () => undefined)

    let settled = false
    let disposed = false
    let forceKill: ReturnType<typeof setTimeout> | undefined
    let resolveExit!: (result: StreamingProcessExit) => void
    let rejectExit!: (error: Error) => void
    const exit = new Promise<StreamingProcessExit>((resolve, reject) => {
      resolveExit = resolve
      rejectExit = reject
    })
    // A caller may dispose before awaiting exit. Keep child failures observable
    // through `exit` without creating an unhandled rejection in that interval.
    void exit.catch(() => undefined)

    const clear = () => {
      if (forceKill) clearTimeout(forceKill)
      request.signal?.removeEventListener('abort', onAbort)
    }
    const terminate = () => {
      if (!child.killed) child.kill('SIGTERM')
      forceKill ??= setTimeout(() => {
        if (!settled) child.kill('SIGKILL')
      }, 1_000)
      forceKill.unref?.()
    }
    const onAbort = () => {
      disposed = true
      terminate()
    }
    request.signal?.addEventListener('abort', onAbort, { once: true })

    child.once('error', (error) => {
      if (settled) return
      settled = true
      clear()
      rejectExit(error)
    })
    child.once('close', (exitCode, signal) => {
      if (settled) return
      settled = true
      clear()
      resolveExit({ exitCode, signal })
    })

    return {
      stdout: child.stdout,
      stderr: child.stderr,
      exit,
      write: async (data) => {
        if (disposed || settled || child.stdin.destroyed || !child.stdin.writable) {
          throw new Error('Remote SSH streaming process is not writable.')
        }
        await new Promise<void>((resolve, reject) => {
          child.stdin.write(data, (error) => error ? reject(error) : resolve())
        })
      },
      end: () => {
        if (!child.stdin.destroyed && child.stdin.writable) child.stdin.end()
      },
      dispose: async () => {
        if (disposed) {
          await exit.catch(() => undefined)
          return
        }
        disposed = true
        if (!settled) terminate()
        await exit.catch(() => undefined)
      }
    }
  }
}

function systemOpenSshExecutable(tool: 'ssh' | 'sftp'): string {
  if (process.platform === 'win32') {
    return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'OpenSSH', `${tool}.exe`)
  }
  return `/usr/bin/${tool}`
}

function openSshEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const keys = process.platform === 'win32'
    ? [
        'SystemRoot', 'WINDIR', 'USERPROFILE', 'USERNAME', 'TEMP', 'TMP',
        'PATH', 'SSH_AUTH_SOCK', 'LANG', 'LC_ALL'
      ]
    : [
        'HOME', 'USER', 'LOGNAME', 'SHELL', 'PATH', 'TMPDIR',
        'SSH_AUTH_SOCK', 'LANG', 'LC_ALL'
      ]
  const environment = Object.fromEntries(
    keys.flatMap((key) => source[key] === undefined ? [] : [[key, source[key]]])
  )
  environment.PATH = dockerAwarePath(environment.PATH, process.platform, source)
  environment.ELECTRON_RUN_AS_NODE = '1'
  return environment
}

function dockerAwarePath(
  current: string | undefined,
  platform: NodeJS.Platform,
  source: NodeJS.ProcessEnv
): string {
  const separator = platform === 'win32' ? ';' : ':'
  const additions = platform === 'win32'
    ? [join(source.ProgramFiles ?? 'C:\\Program Files', 'Docker', 'Docker', 'resources', 'bin')]
    : platform === 'darwin'
      ? ['/Applications/Docker.app/Contents/Resources/bin', '/opt/homebrew/bin', '/usr/local/bin']
      : ['/usr/bin', '/usr/local/bin']
  return [...new Set([...(current?.split(separator) ?? []), ...additions].filter(Boolean))].join(separator)
}

function abortError(): Error {
  const error = new Error('The operation was cancelled.')
  error.name = 'AbortError'
  return error
}
