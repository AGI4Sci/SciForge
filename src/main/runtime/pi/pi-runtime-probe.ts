import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import type {
  AgentRuntimeDiscoveryResult,
  AgentRuntimeDiscoverySource
} from '../../../shared/agent-runtime-contract'

/**
 * Pi (earendil-works/pi) detection-stage probe.
 *
 * Verified against the pinned release @earendil-works/pi-coding-agent@1.4.0:
 * - `pi --version` prints a bare semver line on stdout, exit 0.
 * - `pi --mode rpc --no-session` speaks custom JSONL records (NOT JSON-RPC 2.0,
 *   no initialize handshake); a `get_state` command answers with an id-correlated
 *   response record. See the repository research notes for the wire captures.
 * - Config resolution: `PI_CODING_AGENT_DIR` / `PI_CODING_AGENT_SESSION_DIR`
 *   override the agent/session directories; otherwise they fall back to
 *   `os.homedir()/.pi/...` (USERPROFILE/HOME on Windows). The probe therefore
 *   inherits process.env — the repository-wide convention that keeps managed
 *   Node launchers working — and redirects exactly those four variables into a
 *   per-probe temporary directory, applied identically to `--version` and RPC.
 *
 * The probe stages are ordered so each failure maps to exactly one stable code:
 * not found/path -> version unsupported -> launch failure -> RPC unresponsive.
 */

export const PI_PINNED_BASELINE_VERSION = '1.4.0'
export const PI_RPC_PROTOCOL_ID = 'pi-rpc-jsonl'

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)/
const VERSION_TIMEOUT_MS = 15_000
const RPC_SMOKE_TIMEOUT_MS = 15_000

export type PiProbeInvocation = Readonly<{
  executablePath: string
  source: AgentRuntimeDiscoverySource
}>

export type PiProbeOptions = Readonly<{
  /** Test hook: replace process spawning. */
  runCommand?: (
    command: string,
    args: readonly string[],
    options: { timeoutMs: number; env?: NodeJS.ProcessEnv; cwd?: string }
  ) => Promise<{ exitCode: number | null; stdout: string; stderr: string }>
  /** Test hook: replace the RPC smoke check. */
  rpcSmoke?: (executablePath: string) => Promise<void>
  env?: NodeJS.ProcessEnv
}> 

export function parsePiVersion(output: string): string | null {
  const match = VERSION_PATTERN.exec(output.trim())
  return match ? match[0] : null
}

/** Pinned policy: same major as the verified baseline, not older than it. */
export function isSupportedPiVersion(version: string): boolean {
  const parsed = VERSION_PATTERN.exec(version)
  const baseline = VERSION_PATTERN.exec(PI_PINNED_BASELINE_VERSION)
  if (!parsed || !baseline) return false
  const [major, minor, patch] = [Number(parsed[1]), Number(parsed[2]), Number(parsed[3])]
  const [baseMajor, baseMinor, basePatch] = [Number(baseline[1]), Number(baseline[2]), Number(baseline[3])]
  if (major !== baseMajor) return false
  if (minor !== baseMinor) return minor > baseMinor
  return patch >= basePatch
}

function unavailable(
  code: NonNullable<AgentRuntimeDiscoveryResult['failure']>['code'],
  technicalDetail = '',
  partial: Partial<AgentRuntimeDiscoveryResult> = {}
): AgentRuntimeDiscoveryResult {
  return Object.freeze({
    runtimeId: 'pi',
    available: false,
    executablePath: partial.executablePath ?? null,
    source: partial.source ?? null,
    version: partial.version ?? null,
    protocol: null,
    failure: Object.freeze({ code, ...(technicalDetail ? { technicalDetail } : {}) })
  })
}

function looksLikePath(command: string): boolean {
  return /[\\/]/.test(command) || /^[a-zA-Z]:/.test(command)
}

function isExecutableFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile()
  } catch {
    return false
  }
}

/** PATH lookup honoring PATHEXT on Windows. Returns an absolute path or null. */
export function resolveCommandOnPath(command: string, env: NodeJS.ProcessEnv): string | null {
  const pathEnv = env.PATH ?? env.Path ?? ''
  const exts = process.platform === 'win32'
    ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase())
    : ['']
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, process.platform === 'win32' && !ext && !/\.[^.]+$/.test(command) ? command : command + ext)
      if (isExecutableFile(candidate)) return candidate
    }
  }
  return null
}

export async function resolvePiProbeInvocation(
  raw: string,
  env: NodeJS.ProcessEnv
): Promise<PiProbeInvocation | AgentRuntimeDiscoveryResult> {
  const command = raw.trim() || 'pi'
  if (/[&|<>^%!"\r\n]/.test(command)) return unavailable('runtime_path_invalid')
  if (looksLikePath(command)) {
    return isExecutableFile(command)
      ? { executablePath: command, source: 'user-configured' }
      : unavailable('runtime_path_invalid', 'configured path does not exist or is not a file')
  }
  const onPath = resolveCommandOnPath(command, env)
  return onPath
    ? { executablePath: onPath, source: raw.trim() ? 'user-configured' : 'process-path' }
    : unavailable('runtime_not_found', `command not found on PATH: ${command}`)
}

/**
 * Controlled invocation for Windows .cmd/.bat shims: route through ComSpec with
 * metacharacter rejection, never `shell: true` string concatenation.
 *
 * `verbatim: true` means the caller must spawn with `windowsVerbatimArguments`:
 * libuv's default escaping turns embedded quotes into `\"`, which cmd.exe's /c
 * parser reads literally, so every pre-quoted form fails on real shims
 * (verified locally against @earendil-works/pi-coding-agent@1.4.0's pi.cmd).
 * With verbatim arguments we own the quoting ourselves; every element above is
 * individually quoted and metacharacter-rejected before it reaches the string.
 */
export function piLaunch(
  executablePath: string,
  args: readonly string[]
): { command: string; args: string[]; verbatim: boolean } {
  if (!/\.(?:cmd|bat)$/i.test(executablePath)) return { command: executablePath, args: [...args], verbatim: false }
  if (/[&|<>^%!"\r\n]/.test(executablePath)) throw Object.assign(new Error('invalid shim path'), { code: 'runtime_path_invalid' })
  const safeArgs = args.map((arg) => {
    if (/[&|<>^%!"\r\n]/.test(arg)) throw Object.assign(new Error('unsafe argument'), { code: 'runtime_start_failed' })
    return `"${arg}"`
  })
  // With more than two quote characters cmd.exe /c strips the first and last
  // quote of the whole string, so the quoted shim path must sit inside one
  // extra wrapping pair (verified locally against the real pi.cmd shim).
  return {
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/c', `""${executablePath}" ${safeArgs.join(' ')}"`],
    verbatim: true
  }
}

/**
 * Electron-based Node shims (managed desktop launchers ship `node` as an
 * Electron binary on PATH) only behave as Node when this variable is set;
 * real Node.js ignores it entirely. Same mechanism the repository already
 * uses for its own sidecar entries (ELECTRON_RUN_AS_NODE_ENV), applied to
 * the third-party shim chain so a GUI-launched host can still spawn Pi.
 */
export function withNodeShimCompat(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, ELECTRON_RUN_AS_NODE: '1' }
}

/**
 * Per-probe environment: inherit process.env (repository convention; keeps
 * managed Node launchers and user toolchain resolution working) and redirect
 * exactly the variables Pi 1.4.0 uses to locate user-level configuration, so
 * detection never reads or executes the user's real Pi config/extensions.
 */
export function piProbeEnv(probeHome: string): NodeJS.ProcessEnv {
  return withNodeShimCompat({
    ...process.env,
    HOME: probeHome,
    USERPROFILE: probeHome,
    PI_CODING_AGENT_DIR: join(probeHome, '.pi', 'agent'),
    PI_CODING_AGENT_SESSION_DIR: join(probeHome, '.pi', 'sessions')
  })
}

/**
 * Kill the whole spawned tree, Windows-first: shim launches are a process
 * chain (cmd.exe -> node.cmd -> managed runner -> Pi), and terminating the
 * direct child alone orphans the grandchildren. `taskkill /PID /T /F` targets
 * exactly our PID tree — never a process-name match, so other Node or host
 * tasks are unaffected. Best-effort: a vanished process still resolves.
 */
export function terminateProcessTree(child: ChildProcess): Promise<void> {
  const pid = child.pid
  if (pid == null) return Promise.resolve()
  if (process.platform !== 'win32') {
    try {
      child.kill('SIGKILL')
    } catch {
      // Already exited.
    }
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    let killer: ChildProcess
    try {
      killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    } catch {
      resolve()
      return
    }
    killer.on('error', () => resolve())
    killer.on('close', () => resolve())
  })
}

type PiProbeProcess = Readonly<{
  child: ChildProcess
  probeHome: string
  /** Kill the process tree, then remove the isolated config directory. */
  dispose: () => Promise<void>
}>

function spawnPiProbeProcess(
  executablePath: string,
  args: readonly string[],
  stdio: { stdin: 'pipe' | 'ignore'; stderr: 'pipe' | 'ignore' }
): PiProbeProcess {
  const probeHome = mkdtempSync(join(tmpdir(), 'sciforge-pi-probe-'))
  const launch = piLaunch(executablePath, args)
  const child = spawn(launch.command, launch.args, {
    env: piProbeEnv(probeHome),
    cwd: probeHome,
    stdio: [stdio.stdin, 'pipe', stdio.stderr],
    windowsHide: true,
    windowsVerbatimArguments: launch.verbatim
  })
  const dispose = async (): Promise<void> => {
    await terminateProcessTree(child)
    rmSync(probeHome, { recursive: true, force: true })
  }
  return Object.freeze({ child, probeHome, dispose })
}

async function defaultRunCommand(
  command: string,
  args: readonly string[],
  options: { timeoutMs: number; env?: NodeJS.ProcessEnv; cwd?: string }
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const probe = spawnPiProbeProcess(command, args, { stdin: 'ignore', stderr: 'pipe' })
  const { child } = probe
  const stdoutStream = child.stdout
  const stderrStream = child.stderr
  if (!stdoutStream || !stderrStream) {
    await probe.dispose()
    throw Object.assign(new Error('pi probe stdio pipes unavailable'), { code: 'runtime_start_failed' })
  }
  return new Promise((resolve, reject) => {
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    stdoutStream.on('data', (c) => stdout.push(c))
    stderrStream.on('data', (c) => stderr.push(c))
    const finish = (action: () => void): void => {
      clearTimeout(timer)
      void probe.dispose().finally(action)
    }
    const timer = setTimeout(() => {
      finish(() => reject(Object.assign(new Error('probe command timed out'), { code: 'runtime_probe_failed' })))
    }, options.timeoutMs)
    child.on('error', (error) => finish(() => reject(error)))
    child.on('close', (exitCode) => {
      finish(() =>
        resolve({
          exitCode,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8')
        })
      )
    })
  })
}

/**
 * RPC smoke: launch `pi --mode rpc --no-session --no-approve` with the isolated
 * per-probe config directories and require an id-correlated `get_state`
 * response. Every exit path — answer, failure, timeout, spawn error — goes
 * through `dispose`, which tree-kills the shim chain before returning.
 */
async function defaultRpcSmoke(executablePath: string): Promise<void> {
  const probe = spawnPiProbeProcess(executablePath, ['--mode', 'rpc', '--no-session', '--no-approve'], {
    stdin: 'pipe',
    stderr: 'pipe'
  })
  const { child } = probe
  const stdoutStream = child.stdout
  const stderrStream = child.stderr
  const stdinStream = child.stdin
  if (!stdoutStream || !stderrStream || !stdinStream) {
    await probe.dispose()
    throw Object.assign(new Error('pi RPC stdio pipes unavailable'), { code: 'runtime_start_failed' })
  }
  const stderr: Buffer[] = []
  stderrStream.on('data', (c) => stderr.push(c))
  const stderrTail = (): string => Buffer.concat(stderr).toString('utf8').trim().slice(-400)
  try {
    await new Promise<void>((resolve, reject) => {
      let buffer = Buffer.alloc(0)
      const timer = setTimeout(() => {
        reject(Object.assign(new Error('RPC smoke timed out'), { code: 'runtime_probe_failed' }))
      }, RPC_SMOKE_TIMEOUT_MS)
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(Object.assign(error, { code: 'runtime_start_failed' }))
      })
      child.on('exit', (code) => {
        clearTimeout(timer)
        const detail = stderrTail()
        reject(Object.assign(new Error(`pi exited before answering get_state (${code})${detail ? `: ${detail}` : ''}`), { code: 'runtime_start_failed' }))
      })
      stdoutStream.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk])
        let index
        // Strict LF framing; strip one optional CR. Never split on U+2028/U+2029.
        while ((index = buffer.indexOf(0x0a)) !== -1) {
          let line = buffer.subarray(0, index)
          buffer = buffer.subarray(index + 1)
          if (line.length && line[line.length - 1] === 0x0d) line = line.subarray(0, line.length - 1)
          if (!line.length) continue
          try {
            const record = JSON.parse(line.toString('utf8'))
            if (record?.type === 'response' && record?.id === 'sciforge-probe') {
              clearTimeout(timer)
              record.success === true
                ? resolve()
                : reject(Object.assign(new Error(String(record.error ?? 'probe rejected')), { code: 'runtime_probe_failed' }))
              return
            }
          } catch {
            // Non-JSON diagnostics on stdout are a protocol violation worth reporting.
            clearTimeout(timer)
            reject(Object.assign(new Error('non-JSON record on RPC stdout'), { code: 'runtime_probe_failed' }))
            return
          }
        }
      })
      stdinStream.write(JSON.stringify({ id: 'sciforge-probe', type: 'get_state' }) + '\n')
    })
  } finally {
    await probe.dispose()
  }
}

export async function probePiRuntime(
  rawCommand?: string,
  options: PiProbeOptions = {}
): Promise<AgentRuntimeDiscoveryResult> {
  const env = options.env ?? process.env
  const resolved = await resolvePiProbeInvocation(rawCommand ?? '', env)
  if ('available' in resolved) return resolved
  const { executablePath, source } = resolved

  const runCommand = options.runCommand ?? defaultRunCommand
  let versionOutput = ''
  try {
    const result = await runCommand(executablePath, ['--version'], { timeoutMs: VERSION_TIMEOUT_MS })
    versionOutput = result.stdout
    const version = parsePiVersion(`${result.stdout}\n${result.stderr}`)
    if (result.exitCode !== 0 || !version) {
      return unavailable('runtime_start_failed', [result.stdout, result.stderr].filter(Boolean).join('\n'), { executablePath, source })
    }
    if (!isSupportedPiVersion(version)) {
      return unavailable('runtime_version_unsupported', `reported ${version}, baseline ${PI_PINNED_BASELINE_VERSION}`, { executablePath, source, version })
    }
    const rpcSmoke = options.rpcSmoke ?? defaultRpcSmoke
    await rpcSmoke(executablePath)
    return Object.freeze({
      runtimeId: 'pi',
      available: true,
      executablePath,
      source,
      version,
      protocol: Object.freeze({ id: PI_RPC_PROTOCOL_ID, supported: true })
    })
  } catch (error) {
    const code = (error as { code?: string }).code
    return unavailable(
      code === 'runtime_start_failed' || code === 'runtime_path_invalid' ? code : 'runtime_probe_failed',
      error instanceof Error ? error.message : String(error),
      { executablePath, source, version: parsePiVersion(versionOutput) }
    )
  }
}
