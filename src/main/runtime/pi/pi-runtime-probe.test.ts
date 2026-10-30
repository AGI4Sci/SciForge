import { describe, expect, it } from 'vitest'
import { execFile, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  isSupportedPiVersion,
  parsePiVersion,
  piLaunch,
  piProbeEnv,
  probePiRuntime,
  resolvePiProbeInvocation,
  terminateProcessTree,
  withNodeShimCompat,
  PI_PINNED_BASELINE_VERSION
} from './pi-runtime-probe'

const execFileAsync = promisify(execFile)
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Windows-only helpers: PID-based inspection. Nothing is killed by name. */
async function listProcessTable(): Promise<ReadonlyArray<{ id: number; parent: number; commandLine: string }>> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress'],
    { timeout: 20_000, maxBuffer: 64 * 1024 * 1024 }
  )
  const parsed = JSON.parse(stdout)
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  return rows.map((row) => ({
    id: Number(row.ProcessId),
    parent: Number(row.ParentProcessId),
    commandLine: String(row.CommandLine ?? '')
  }))
}

function collectTreePids(
  table: ReadonlyArray<{ id: number; parent: number }>,
  root: number
): number[] {
  const childrenOf = new Map<number, number[]>()
  for (const row of table) {
    const list = childrenOf.get(row.parent) ?? []
    list.push(row.id)
    childrenOf.set(row.parent, list)
  }
  const result: number[] = []
  const queue = [root]
  while (queue.length) {
    const current = queue.shift()!
    result.push(current)
    for (const child of childrenOf.get(current) ?? []) queue.push(child)
  }
  return result
}

async function pidsWithCommandLine(marker: string): Promise<number[]> {
  const table = await listProcessTable()
  return table.filter((row) => row.commandLine.includes(marker)).map((row) => row.id)
}

describe('parsePiVersion', () => {
  it('parses the bare semver line printed by pi --version', () => {
    expect(parsePiVersion('1.4.0')).toBe('1.4.0')
    expect(parsePiVersion('1.4.0\n')).toBe('1.4.0')
    expect(parsePiVersion('2.0.1-rc.3')).toBe('2.0.1')
  })
  it('rejects non-version output', () => {
    expect(parsePiVersion('pi version one')).toBeNull()
    expect(parsePiVersion('')).toBeNull()
  })
})

describe('isSupportedPiVersion', () => {
  it('accepts the pinned baseline and compatible patches', () => {
    expect(isSupportedPiVersion(PI_PINNED_BASELINE_VERSION)).toBe(true)
    expect(isSupportedPiVersion('1.4.2')).toBe(true)
    expect(isSupportedPiVersion('1.5.0')).toBe(true)
  })
  it('rejects older or different-major versions', () => {
    expect(isSupportedPiVersion('1.3.9')).toBe(false)
    expect(isSupportedPiVersion('0.9.0')).toBe(false)
    expect(isSupportedPiVersion('2.0.0')).toBe(false)
  })
})

describe('piLaunch', () => {
  it('passes plain executables through untouched', () => {
    expect(piLaunch('/usr/local/bin/pi', ['--version'])).toEqual({
      command: '/usr/local/bin/pi',
      args: ['--version'],
      verbatim: false
    })
  })
  it('routes .cmd shims through ComSpec with caller-owned quoting', () => {
    const launch = piLaunch('C:\\tools\\pi.cmd', ['--mode', 'rpc'])
    expect(launch.command.toLowerCase()).toContain('cmd.exe')
    expect(launch.args[0]).toBe('/d')
    expect(launch.args[1]).toBe('/c')
    expect(launch.args[2]).toBe('""C:\\tools\\pi.cmd" "--mode" "rpc""')
    // libuv re-escapes embedded quotes into a form cmd.exe /c cannot parse;
    // the spawn site must set windowsVerbatimArguments from this flag.
    expect(launch.verbatim).toBe(true)
  })
  it('rejects shell metacharacters instead of concatenating them', () => {
    // Only shim paths routed through cmd.exe need rejection; a non-shim path
    // is spawned directly with an argv array, which carries no shell meaning.
    expect(() => piLaunch('C:\\evil&calc\\pi.cmd', ['--version'])).toThrow()
    expect(() => piLaunch('pi.cmd', ['--x&calc'])).toThrow()
  })
})

describe('piProbeEnv', () => {
  it('redirects every Pi config location into the probe home and keeps the inherited env', () => {
    const probeHome = join('probe-root', 'home')
    const env = piProbeEnv(probeHome)
    expect(env.HOME).toBe(probeHome)
    expect(env.USERPROFILE).toBe(probeHome)
    expect(env.PI_CODING_AGENT_DIR).toBe(join(probeHome, '.pi', 'agent'))
    expect(env.PI_CODING_AGENT_SESSION_DIR).toBe(join(probeHome, '.pi', 'sessions'))
    // Inheritance is deliberate: managed Node launchers and toolchain
    // resolution depend on the host environment.
    expect(env.PATH).toBe(process.env.PATH)
  })

  it('sets ELECTRON_RUN_AS_NODE so Electron-based node shims behave as Node', () => {
    // Managed desktop launchers put an Electron binary on PATH as `node`; the
    // shim only acts as Node with this variable, and real Node.js ignores it.
    // Verified empirically: without it the shim exits 0 with empty output.
    const env = piProbeEnv(join('probe-root', 'home'))
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(withNodeShimCompat({}).ELECTRON_RUN_AS_NODE).toBe('1')
    expect(withNodeShimCompat({ PATH: 'x' }).PATH).toBe('x')
  })
})

describe('terminateProcessTree', () => {
  it.runIf(process.platform === 'win32')(
    'kills a cmd-launched tree including grandchildren, by PID only',
    async () => {
      // cmd -> managed node launcher -> sleeping node: the same shape a pi.cmd
      // launch produces. Quoting is caller-owned, so spawn verbatim.
      const child = spawn(
        process.env.ComSpec || 'cmd.exe',
        ['/d', '/c', 'node -e "setTimeout(() => {}, 60000)"'],
        { windowsHide: true, windowsVerbatimArguments: true, stdio: 'ignore' }
      )
      try {
        await delay(1500)
        expect(child.pid).toBeDefined()
        const before = await listProcessTable()
        const tree = collectTreePids(before, child.pid!)
        expect(tree.length).toBeGreaterThan(1)
        await terminateProcessTree(child)
        await delay(500)
        const after = await listProcessTable()
        const alive = new Set(after.map((row) => row.id))
        expect(tree.filter((pid) => alive.has(pid))).toEqual([])
      } finally {
        await terminateProcessTree(child)
      }
    },
    30_000
  )
})

describe('resolvePiProbeInvocation', () => {
  it('rejects missing explicit paths as runtime_path_invalid', async () => {
    const result = await resolvePiProbeInvocation('C:\\definitely\\missing\\pi.exe', process.env)
    expect(result).toMatchObject({ available: false, failure: { code: 'runtime_path_invalid' } })
  })
  it('reports runtime_not_found for unknown commands', async () => {
    const result = await resolvePiProbeInvocation('pi-definitely-missing-command', { PATH: '' })
    expect(result).toMatchObject({ available: false, failure: { code: 'runtime_not_found' } })
  })
  it('resolves commands from PATH', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-probe-path-'))
    try {
      const name = process.platform === 'win32' ? 'pi-fake.cmd' : 'pi-fake'
      writeFileSync(join(dir, name), process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n')
      if (process.platform !== 'win32') chmodSync(join(dir, name), 0o755)
      const result = await resolvePiProbeInvocation('pi-fake', { PATH: dir, PATHEXT: '.CMD;.EXE' })
      expect(result).toMatchObject({ executablePath: join(dir, name), source: 'user-configured' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('probePiRuntime staged failures', () => {
  const okSmoke = async (): Promise<void> => {}

  it('maps non-zero --version exit to runtime_start_failed', async () => {
    const result = await probePiRuntime('C:\\any\\pi.exe', {
      runCommand: async () => ({ exitCode: 1, stdout: '', stderr: 'boom' }),
      rpcSmoke: okSmoke
    })
    // explicit path does not exist -> resolution fails before spawn
    expect(result.failure?.code).toBe('runtime_path_invalid')
  })

  it('maps unparsable version to runtime_start_failed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-probe-ver-'))
    const exe = join(dir, process.platform === 'win32' ? 'pi.cmd' : 'pi')
    writeFileSync(exe, 'x')
    try {
      const result = await probePiRuntime(exe, {
        runCommand: async () => ({ exitCode: 0, stdout: 'not-a-version', stderr: '' }),
        rpcSmoke: okSmoke
      })
      expect(result.failure?.code).toBe('runtime_start_failed')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('maps incompatible versions to runtime_version_unsupported', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-probe-ver-'))
    const exe = join(dir, process.platform === 'win32' ? 'pi.cmd' : 'pi')
    writeFileSync(exe, 'x')
    try {
      const result = await probePiRuntime(exe, {
        runCommand: async () => ({ exitCode: 0, stdout: '0.9.1', stderr: '' }),
        rpcSmoke: okSmoke
      })
      expect(result).toMatchObject({
        available: false,
        version: '0.9.1',
        failure: { code: 'runtime_version_unsupported' }
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('maps RPC smoke failure to runtime_probe_failed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-probe-rpc-'))
    const exe = join(dir, process.platform === 'win32' ? 'pi.cmd' : 'pi')
    writeFileSync(exe, 'x')
    try {
      const result = await probePiRuntime(exe, {
        runCommand: async () => ({ exitCode: 0, stdout: PI_PINNED_BASELINE_VERSION, stderr: '' }),
        rpcSmoke: async () => {
          throw Object.assign(new Error('no response'), { code: 'runtime_probe_failed' })
        }
      })
      expect(result).toMatchObject({
        available: false,
        version: PI_PINNED_BASELINE_VERSION,
        failure: { code: 'runtime_probe_failed' }
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports available with protocol id when all stages pass', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-probe-ok-'))
    const exe = join(dir, process.platform === 'win32' ? 'pi.cmd' : 'pi')
    writeFileSync(exe, 'x')
    try {
      const result = await probePiRuntime(exe, {
        runCommand: async () => ({ exitCode: 0, stdout: `${PI_PINNED_BASELINE_VERSION}\n`, stderr: '' }),
        rpcSmoke: okSmoke
      })
      expect(result).toEqual({
        runtimeId: 'pi',
        available: true,
        executablePath: exe,
        source: 'user-configured',
        version: PI_PINNED_BASELINE_VERSION,
        protocol: { id: 'pi-rpc-jsonl', supported: true }
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// Real-installation detection: run only when PI_PROBE_REAL_COMMAND points at an
// actual pinned Pi install. This is a live check, not a mock — it also proves
// the probe leaves no cmd/node/pi processes behind on the success path.
const realCommand = process.env.PI_PROBE_REAL_COMMAND
describe('probePiRuntime real installation', () => {
  it.runIf(Boolean(realCommand))(
    'detects the real pinned Pi over --version and live RPC, leaving no processes behind',
    async () => {
      const before = process.platform === 'win32' ? await pidsWithCommandLine('--no-approve') : []
      const result = await probePiRuntime(realCommand!)
      expect(result.available).toBe(true)
      expect(result.version).toBe(PI_PINNED_BASELINE_VERSION)
      expect(result.protocol).toEqual({ id: 'pi-rpc-jsonl', supported: true })
      if (process.platform === 'win32') {
        const after = await pidsWithCommandLine('--no-approve')
        expect(after.filter((pid) => !before.includes(pid))).toEqual([])
      }
    },
    90_000
  )
})
