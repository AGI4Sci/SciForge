import { spawn } from 'node:child_process'

export const BIOGYM_CLI_MAX_OUTPUT_BYTES = 4 * 1024 * 1024
export const BIOGYM_CLI_DEFAULT_TIMEOUT_MS = 90_000

export type BioGymCliExecution = {
  argv: string[]
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
  timedOut: boolean
}

export type BioGymCliFailure = {
  status: 'error'
  message?: string
  code?: string
  outcomeUnknown?: boolean
  requestId?: string
}

export class BioGymCliError extends Error {
  readonly code: string
  readonly execution?: BioGymCliExecution
  readonly failure?: BioGymCliFailure

  constructor(
    code: string,
    message: string,
    execution?: BioGymCliExecution,
    failure?: BioGymCliFailure
  ) {
    super(message)
    this.name = 'BioGymCliError'
    this.code = code
    this.execution = execution
    this.failure = failure
  }
}

export async function executeBioGymCli(
  executable: string,
  args: readonly string[],
  options: {
    cwd: string
    timeoutMs?: number
    env?: NodeJS.ProcessEnv
    maxOutputBytes?: number
  }
): Promise<BioGymCliExecution> {
  const startedAt = Date.now()
  const timeoutMs = options.timeoutMs ?? BIOGYM_CLI_DEFAULT_TIMEOUT_MS
  const maxOutputBytes = options.maxOutputBytes ?? BIOGYM_CLI_MAX_OUTPUT_BYTES

  return new Promise((resolve, reject) => {
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    let settled = false
    let timedOut = false
    let outputExceeded = false
    let timer: NodeJS.Timeout
    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true
    })

    const finish = (
      error: Error | null,
      exitCode: number | null
    ): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const execution: BioGymCliExecution = {
        argv: [executable, ...args],
        exitCode: exitCode ?? -1,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        durationMs: Date.now() - startedAt,
        timedOut
      }
      if (error) {
        reject(new BioGymCliError('biogym_cli_spawn_failed', error.message, execution))
        return
      }
      if (outputExceeded) {
        reject(new BioGymCliError(
          'biogym_cli_output_limit',
          `BioGym CLI output exceeded ${maxOutputBytes} bytes.`,
          execution
        ))
        return
      }
      if (timedOut) {
        reject(new BioGymCliError(
          'biogym_cli_timeout',
          `BioGym CLI timed out after ${timeoutMs} ms.`,
          execution
        ))
        return
      }
      if (execution.exitCode !== 0) {
        const failure = parseStructuredFailure(execution.stderr) ?? parseStructuredFailure(execution.stdout)
        const detail = boundedErrorText(failure?.message || execution.stderr || execution.stdout)
        reject(new BioGymCliError(
          'biogym_cli_failed',
          `BioGym CLI exited with code ${execution.exitCode}${detail ? `: ${detail}` : '.'}`,
          execution,
          failure
        ))
        return
      }
      resolve(execution)
    }

    const append = (current: Buffer, chunk: Buffer | string): Buffer => {
      if (outputExceeded) return current
      const next = Buffer.concat([current, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
      if (next.byteLength > maxOutputBytes) {
        outputExceeded = true
        terminateProcessTree(child.pid)
        return next.subarray(0, maxOutputBytes)
      }
      return next
    }

    child.stdout?.on('data', (chunk) => { stdout = append(stdout, chunk) })
    child.stderr?.on('data', (chunk) => { stderr = append(stderr, chunk) })
    child.once('error', (error) => finish(error, null))
    child.once('close', (code) => finish(null, code))

    timer = setTimeout(() => {
      timedOut = true
      terminateProcessTree(child.pid)
      setTimeout(() => terminateProcessTree(child.pid, true), 2_000).unref()
    }, timeoutMs)
    timer.unref()
  })
}

export function parseBioGymCliJson(execution: BioGymCliExecution): unknown {
  const text = execution.stdout.trim()
  if (!text) {
    throw new BioGymCliError('biogym_cli_protocol_error', 'BioGym CLI returned no JSON output.', execution)
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new BioGymCliError(
      'biogym_cli_protocol_error',
      'BioGym CLI returned malformed JSON output.',
      execution
    )
  }
}

function terminateProcessTree(pid: number | undefined, force = false): void {
  if (!pid) return
  const signal: NodeJS.Signals = force ? 'SIGKILL' : 'SIGTERM'
  try {
    if (process.platform !== 'win32') process.kill(-pid, signal)
    else process.kill(pid, signal)
  } catch {
    // The child may already have exited between the timer and this signal.
  }
}

function boundedErrorText(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(?:api[_-]?key|token|secret)\s*[=:]\s*\S+/gi, '$1=[redacted]')
    .trim()
    .slice(0, 2_000)
}

function parseStructuredFailure(value: string): BioGymCliFailure | undefined {
  try {
    const parsed = JSON.parse(value.trim()) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const row = parsed as Record<string, unknown>
    if (row.status !== 'error') return undefined
    return {
      status: 'error',
      ...(typeof row.message === 'string' ? { message: boundedErrorText(row.message) } : {}),
      ...(typeof row.code === 'string' ? { code: row.code.slice(0, 128) } : {}),
      ...(typeof row.outcome_unknown === 'boolean' ? { outcomeUnknown: row.outcome_unknown } : {}),
      ...(typeof row.request_id === 'string' ? { requestId: row.request_id.slice(0, 256) } : {})
    }
  } catch {
    return undefined
  }
}
