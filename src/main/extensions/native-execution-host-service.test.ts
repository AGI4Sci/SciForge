import { chmod, copyFile, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { HostServiceOwner, HostServiceProvider, HostServiceRequest } from '@sciforge/plugin-sdk'
import { HostServiceProviderRegistry } from '@sciforge/plugin-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNativeExecutionHostService, type NativeExecutionPolicy } from './native-execution-host-service'

const fixtures: { root: string; provider: HostServiceProvider; owner: HostServiceOwner }[] = []
const realNativeKill = process.kill.bind(process)
const ownedFaultGroups = new Map<HostServiceProvider, Set<number>>()
const expectedDisposeFailures = new Map<HostServiceProvider, { code?: string; message?: string }>()

async function proveRealGroupAbsent(pid: number): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) throw new Error('Unsafe test cleanup group.')
  const end = Date.now() + 5_000
  while (Date.now() < end) {
    try { realNativeKill(-pid, 0) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Test cleanup could not prove real process-group ESRCH.')
}

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks() // Real cleanup must never use an injected syscall result.
  const failures: unknown[] = []
  for (const fixture of fixtures.splice(0)) {
    let provenAbsent = false
    try {
      const expected = expectedDisposeFailures.get(fixture.provider)
      if (expected) await expect(Promise.resolve(fixture.provider.dispose?.(fixture.owner))).rejects.toMatchObject(expected)
      else { await fixture.provider.dispose?.(fixture.owner); provenAbsent = true }
    } catch (error) { failures.push(error) }
    const groups = ownedFaultGroups.get(fixture.provider)
    if (groups) {
      try {
        for (const pid of groups) {
          if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) throw new Error('Unsafe test cleanup group.')
          try { realNativeKill(-pid, 'SIGKILL') } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
          }
          await proveRealGroupAbsent(pid)
        }
        provenAbsent = true
      } catch (error) { provenAbsent = false; failures.push(error) }
    }
    ownedFaultGroups.delete(fixture.provider)
    expectedDisposeFailures.delete(fixture.provider)
    if (!fixture.root.startsWith(join(homedir(), '.sciforge-native-test-'))) {
      failures.push(new Error('Unexpected fixture cleanup target.'))
    } else if (provenAbsent) await rm(fixture.root, { force: true, recursive: true })
    // Failed/unproved cleanup retains the exact fixture directory as evidence.
  }
  if (failures.length) throw new AggregateError(failures, 'Native fixture teardown failed.')
})
async function fixture(mode: NativeExecutionPolicy['mode'] = 'danger-full-access', nodeExecutable?: string) {
  // Deliberately outside platform tmp: sandbox tmp writes must not mask workspace denial.
  const root = await realpath(await mkdtemp(join(homedir(), '.sciforge-native-test-')))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const owner: HostServiceOwner = { connectionId: 'connection', pluginId: 'plugin', packageName: '@test/plugin', version: '1', generation: 1, invocationId: 'invocation', authority: {
    capabilityId: 'test.run', effect: 'workspace-write', caller: { callerId: 'agent', workspaceId: workspace }, ordinarySession: { runtimeId: 'runtime', threadId: 'thread' }
  } }
  let bound: NativeExecutionPolicy = { mode, workspaceRoot: workspace }
  let live = true
  const provider = createNativeExecutionHostService({ resolveContext: () => ({ workspaceRoot: workspace, policy: bound }), requestApproval: () => 'allowed-once', nodeExecutable })
  fixtures.push({ root, provider, owner })
  const registry = new HostServiceProviderRegistry({ nativeExecution: provider })
  function request(operation: string, input: unknown, options: { owner?: HostServiceOwner; signal?: AbortSignal } = {}): Promise<unknown> {
    return registry.dispatch({ requestId: Math.random().toString(), serviceId: 'nativeExecution', operation, input, owner: options.owner ?? owner, signal: options.signal ?? new AbortController().signal, assertCurrent() { if (!live) throw new Error('Lease cancelled.') } })
  }
  async function confine(code: string, requested = bound): Promise<string[]> {
    return (await request('process.confine', { argv: [process.execPath, '-e', code], policy: requested }) as { argv: string[] }).argv
  }
  const io = { stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } }
  async function start(code: string, overrides: Record<string, unknown> = {}, options: { signal?: AbortSignal } = {}) {
    const argv = await confine(code)
    return await request('process.spawn', { argv, cwd: workspace, stdio: io, ...overrides }, options) as { processId: string }
  }
  return { root, workspace, owner, provider, request, confine, start, io, setPolicy: (value: NativeExecutionPolicy) => { bound = value }, cancelLease: () => { live = false } }
}

describe('native execution Host service', () => {
  async function prepared(f: Awaited<ReturnType<typeof fixture>>, executable: string, mode: NativeExecutionPolicy['mode'] = 'danger-full-access') {
    const pending = f.request('process.confine', { argv: [executable], policy: { mode, workspaceRoot: f.workspace } })
    if (process.platform === 'win32') await expect(pending).rejects.toThrow('Native process groups are unsupported on Windows.')
    else if (mode !== 'danger-full-access' && process.platform !== 'darwin') await expect(pending).rejects.toThrow('Full native confinement is unavailable on this platform.')
    else expect(await pending).toMatchObject({ enforcement: 'full' })
  }

  it('trusted PATH resolves a plain executable through directories with spaces before platform checks', async () => {
    const f = await fixture()
    const directory = join(f.root, 'trusted tools')
    await mkdir(directory)
    const executable = join(directory, process.platform === 'win32' ? 'fixture-tool.exe' : 'fixture-tool')
    await writeFile(executable, 'fixture'); await chmod(executable, 0o755)
    vi.stubEnv('PATH', directory)
    await prepared(f, 'fixture-tool')
    // Missing targets fail at preparation rather than creating an unusable plan.
    await rm(executable)
    await expect(f.request('process.confine', { argv: ['fixture-tool'], policy: { mode: 'danger-full-access', workspaceRoot: f.workspace } })).rejects.toThrow('trusted Host PATH')
  })

  it('trusted PATH ignores relative entries, cwd, and child-env spoofing', async () => {
    const f = await fixture()
    const command = 'sciforge-absent-fixture-tool'
    await writeFile(join(f.workspace, command), 'fixture')
    vi.stubEnv('PATH', '.;relative tools')
    for (const executable of [command, './tool', '../tool', 'dir/tool', 'dir\\tool', 'C:tool', 'tool --flag']) {
      await expect(f.request('process.confine', { argv: [executable], policy: { mode: 'danger-full-access', workspaceRoot: f.workspace } })).rejects.toThrow(/trusted Host PATH|plain executable/)
    }
    await expect(f.request('process.confine', { argv: [command], env: { PATH: f.workspace }, cwd: f.workspace, policy: { mode: 'danger-full-access', workspaceRoot: f.workspace } })).rejects.toThrow('Unexpected input field')
    await expect(f.request('process.spawn', { argv: [command], env: { PATH: f.workspace }, cwd: f.workspace, stdio: f.io })).rejects.toThrow('Unknown execution plan')
  })

  it.skipIf(process.platform === 'darwin')('trusted PATH retains unsupported confined-mode errors for a valid executable', async () => {
    const f = await fixture('read-only')
    await prepared(f, process.execPath, 'read-only')
  })

  it.skipIf(process.platform === 'win32')('trusted PATH rejects nonexecutable files on POSIX', async () => {
    const f = await fixture()
    const executable = join(f.workspace, 'fixture-tool')
    await writeFile(executable, 'fixture'); await chmod(executable, 0o644)
    vi.stubEnv('PATH', f.workspace)
    await expect(f.request('process.confine', { argv: ['fixture-tool'], policy: { mode: 'danger-full-access', workspaceRoot: f.workspace } })).rejects.toThrow('trusted Host PATH')
    await expect(f.request('process.confine', { argv: [executable], policy: { mode: 'danger-full-access', workspaceRoot: f.workspace } })).rejects.toThrow('executable file')
  })

  it.skipIf(process.platform === 'win32')('trusted PATH binds the executable before child PATH or cwd can spoof it', async () => {
    const f = await fixture()
    const directory = join(f.root, 'trusted tools')
    await mkdir(directory)
    await symlink(process.execPath, join(directory, 'fixture-tool'))
    await writeFile(join(f.workspace, 'fixture-tool'), 'untrusted cwd executable')
    vi.stubEnv('PATH', directory)
    const plan = await f.request('process.confine', { argv: ['fixture-tool', '-e', 'console.log("trusted")'], policy: { mode: 'danger-full-access', workspaceRoot: f.workspace } }) as { argv: string[] }
    const handle = await f.request('process.spawn', { argv: plan.argv, cwd: f.workspace, env: { PATH: f.workspace }, stdio: f.io })
    expect(await f.request('process.wait', handle)).toMatchObject({ exitCode: 0, stdout: { text: 'trusted\n' } })
  })

  it.skipIf(process.platform === 'win32')('preserves the invoked symlink path for environment-sensitive interpreters', async () => {
    const f = await fixture()
    const target = join(f.root, 'interpreter')
    await writeFile(target, '#!/bin/sh\nprintf "%s" "$0"\n')
    await chmod(target, 0o755)
    const alias = join(f.workspace, 'environment-python')
    await symlink(target, alias)
    const plan = await f.request('process.confine', { argv: [alias], policy: { mode: 'danger-full-access', workspaceRoot: f.workspace } }) as { argv: string[] }
    const handle = await f.request('process.spawn', { argv: plan.argv, cwd: f.workspace, stdio: f.io })
    expect(await f.request('process.wait', handle)).toMatchObject({ exitCode: 0, stdout: { text: alias } })
  })

  it('trusted PATH preserves the explicit Electron Node configuration requirement', async () => {
    const original = Object.getOwnPropertyDescriptor(process.versions, 'electron')
    Object.defineProperty(process.versions, 'electron', { value: 'fixture', configurable: true })
    try {
      const f = await fixture()
      await expect(f.confine('')).rejects.toThrow('approved Node executable')
      const configured = await fixture('danger-full-access', process.execPath)
      await prepared(configured, process.execPath)
    } finally {
      if (original) Object.defineProperty(process.versions, 'electron', original)
      else Reflect.deleteProperty(process.versions, 'electron')
    }
  })

  it('runs argv with explicit stdin/environment and drains bounded stdout/stderr', async () => {
    const f = await fixture()
    const secretName = 'SCIFORGE_NATIVE_TEST_SECRET'
    process.env[secretName] = 'must-not-inherit'
    try {
      const handle = await f.start(`process.stdin.resume();process.stdin.on('end',()=>{console.error(process.env.${secretName}||'clean');process.stdout.write('é'.repeat(100000))})`, {
        stdio: { stdout: { maxBytes: 7 }, stderr: { maxBytes: 1024 }, stdin: { data: 'payload' } }
      })
      expect(await f.request('process.wait', handle)).toMatchObject({ exitCode: 0, stdout: { lossy: true }, stderr: { text: 'clean\n', lossy: false } })
      expect((await f.request('process.wait', handle) as { stdout: { text: string } }).stdout.text.length).toBeLessThanOrEqual(7)
    } finally { delete process.env[secretName] }
  })

  it('rejects authority loss, unknown fields, and approval correlation spoofing has no authority', async () => {
    const f = await fixture()
    expect(await f.request('approval.request', { reason: 'Run worker' })).toBe('allowed-once')
    await expect(f.request('context.resolve', { workspaceRoot: f.root })).rejects.toThrow('Unexpected')
    await expect(f.request('context.resolve', {}, { owner: { ...f.owner, authority: { ...f.owner.authority, effect: 'read' } } })).rejects.toThrow('authority')
    await expect(f.request('context.resolve', {}, { owner: { ...f.owner, authority: { ...f.owner.authority, capabilityId: undefined } } })).rejects.toThrow()
    f.cancelLease()
    await expect(f.request('context.resolve', {})).rejects.toThrow('Lease cancelled')
  })

  it('uses one-use invocation-bound plans and process handles', async () => {
    const f = await fixture()
    const argv = await f.confine('console.log("ok")')
    const other = { ...f.owner, invocationId: 'other' }
    await expect(f.request('process.spawn', { argv, cwd: f.workspace, stdio: f.io }, { owner: other })).rejects.toThrow('Unknown execution plan')
    const handle = await f.request('process.spawn', { argv, cwd: f.workspace, stdio: f.io })
    await expect(f.request('process.spawn', { argv, cwd: f.workspace, stdio: f.io })).rejects.toThrow('Unknown execution plan')
    await expect(f.request('process.wait', handle, { owner: other })).rejects.toThrow('Unknown native process')
    await expect(f.request('process.wait', handle, { owner: { ...f.owner, connectionId: 'other' } })).rejects.toThrow('Unknown native process')
    expect(await f.request('process.wait', handle)).toMatchObject({ exitCode: 0 })
  })

  it('rejects widened policy, changed Host policy, and symlink cwd escapes', async () => {
    const f = await fixture()
    await expect(f.confine('', { mode: 'danger-full-access', workspaceRoot: f.root })).rejects.toThrow('widens')
    const argv = await f.confine('')
    f.setPolicy({ mode: 'read-only', workspaceRoot: f.workspace })
    await expect(f.request('process.spawn', { argv, cwd: f.workspace, stdio: f.io })).rejects.toThrow('changed')
    f.setPolicy({ mode: 'danger-full-access', workspaceRoot: f.workspace })
    await symlink(f.root, join(f.workspace, 'escape'))
    await expect(f.start('', { cwd: join(f.workspace, 'escape') })).rejects.toThrow('escapes')
  })

  it('stops the process group and closes inherited streams when root exits', async () => {
    const f = await fixture()
    const handle = await f.start(`const{spawn}=require('child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',process.stdout,process.stderr]});console.log(c.pid);setTimeout(()=>process.exit(0),100)`)
    const result = await f.request('process.wait', handle) as { exitCode: number; stdout: { text: string } }
    expect(result.exitCode).toBe(0)
    const pid = Number(result.stdout.text.trim())
    expect(pid).toBeGreaterThan(0)
    expect(() => process.kill(pid, 0)).toThrow()
    expect(await f.request('process.stop', handle)).toMatchObject({ quiescent: true, exitCode: 0 })
  })

  it('cancellation waits for descendants and denies further cancelled requests', async () => {
    const f = await fixture()
    const marker = join(f.workspace, 'pid')
    const controller = new AbortController()
    const handle = await f.start(`const{spawn}=require('child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',process.stdout,process.stderr]});require('fs').writeFileSync(${JSON.stringify(marker)},String(c.pid));setInterval(()=>{},1000)`, {}, { signal: controller.signal })
    // Read readiness through ordinary Host execution, avoiding a timing-only assumption.
    let pid = 0
    await vi.waitFor(async () => {
      pid = Number(await readFile(marker, 'utf8'))
      expect(pid).toBeGreaterThan(0)
    }, { timeout: 10_000, interval: 25 })
    const waiting = f.request('process.wait', handle, { signal: controller.signal })
    controller.abort()
    await expect(waiting).rejects.toThrow()
    // stop is a separate live request and can only report after group teardown.
    expect(await f.request('process.stop', handle)).toMatchObject({ quiescent: true })
    expect(() => process.kill(pid, 0)).toThrow()
    f.cancelLease()
    await expect(f.request('process.wait', handle)).rejects.toThrow('Lease cancelled')
  })

  it('handles executable launch failure without leaving resources or unhandled rejections', async () => {
    const f = await fixture()
    const executable = join(f.workspace, process.platform === 'win32' ? 'removed-executable.exe' : 'removed-executable')
    // Prepare a valid executable, then exercise the spawn-time removal race.
    await copyFile(process.execPath, executable)
    if (process.platform !== 'win32') await chmod(executable, 0o755)
    const plan = await f.request('process.confine', { argv: [executable], policy: { mode: 'danger-full-access', workspaceRoot: f.workspace } }) as { argv: string[] }
    await rm(executable)
    await expect(f.request('process.spawn', { argv: plan.argv, cwd: f.workspace, stdio: f.io })).rejects.toThrow('ENOENT')
    await expect(f.request('process.spawn', { argv: plan.argv, cwd: f.workspace, stdio: f.io })).rejects.toThrow('Unknown execution plan')
  })

  it.skipIf(process.platform !== 'darwin')('allows a narrowed real workspace stage and denies sibling writes', async () => {
    const f = await fixture('workspace-write')
    const stage = join(f.workspace, 'stage')
    await mkdir(stage)
    const denied = join(f.workspace, 'sibling')
    const argv = await f.confine(`try{require('fs').writeFileSync(${JSON.stringify(denied)},'bad');process.exit(7)}catch(e){console.log(e.code)}`, { mode: 'workspace-write', workspaceRoot: stage })
    const handle = await f.request('process.spawn', { argv, cwd: stage, stdio: f.io })
    expect(await f.request('process.wait', handle)).toMatchObject({ exitCode: 0, stdout: { text: 'EPERM\n' } })
  })

  it('disposal terminates the generation and removes plans', async () => {
    const f = await fixture()
    const argv = await f.confine('')
    await f.start('setInterval(()=>{},1000)')
    await f.provider.dispose?.(f.owner)
    await expect(f.request('process.spawn', { argv, cwd: f.workspace, stdio: f.io })).rejects.toThrow('authority')
  })

  it.skipIf(process.platform !== 'darwin')('enforces actual sandbox denial and workspace writes', async () => {
    const f = await fixture('workspace-write')
    const inside = join(f.workspace, 'inside'), outside = join(f.root, 'outside')
    const handle = await f.start(`const fs=require('fs');fs.writeFileSync(${JSON.stringify(inside)},'ok');try{fs.writeFileSync(${JSON.stringify(outside)},'bad');process.exit(7)}catch(e){console.log(e.code)}`)
    expect(await f.request('process.wait', handle)).toMatchObject({ exitCode: 0, stdout: { text: 'EPERM\n' } })
    expect(await readFile(inside, 'utf8')).toBe('ok')
    f.setPolicy({ mode: 'read-only', workspaceRoot: f.workspace })
    const denied = await f.start(`require('fs').writeFileSync(${JSON.stringify(inside)},'bad')`)
    expect(await f.request('process.wait', denied)).toMatchObject({ exitCode: 1 })
    expect(await readFile(inside, 'utf8')).toBe('ok')
  })
})


type NativeFault = 'pre-kill-probe' | 'post-kill-probe' | 'persistent-probe' | 'SIGTERM' | 'SIGKILL'
type NativeSignalEvent = { signal: string | number; result: string }

async function heldNativeGroup() {
  const f = await fixture()
  const rootMarker = join(f.workspace, 'root-pid')
  const childMarker = join(f.workspace, 'child-pid')
  const release = join(f.workspace, 'release-root')
  const child = `process.on('SIGTERM',()=>{});require('fs').writeFileSync(${JSON.stringify(childMarker)},String(process.pid));console.log(process.pid);setInterval(()=>{},1000)`
  const code = `const fs=require('fs');require('child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:['ignore',process.stdout,process.stderr]});fs.writeFileSync(${JSON.stringify(rootMarker)},String(process.pid));const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(childMarker)})&&fs.existsSync(${JSON.stringify(release)})){clearInterval(t);process.exit(0)}},5)`
  const handle = await f.start(code, { graceMs: 25 })
  let rootPid = 0, childPid = 0
  await vi.waitFor(async () => {
    rootPid = Number(await readFile(rootMarker, 'utf8'))
    childPid = Number(await readFile(childMarker, 'utf8'))
    expect(Number.isSafeInteger(rootPid) && rootPid > 0 && rootPid !== process.pid).toBe(true)
    expect(Number.isSafeInteger(childPid) && childPid > 0 && childPid !== rootPid).toBe(true)
  }, { timeout: 5_000, interval: 10 })
  // Only a PGID supplied by this real, held fixture is ever intercepted or cleaned.
  ownedFaultGroups.set(f.provider, new Set([rootPid]))
  realNativeKill(-rootPid, 0)
  return { ...f, handle, rootPid, childPid, release: () => writeFile(release, 'release') }
}

function injectOwnedNativeFault(rootPid: number, fault: NativeFault) {
  const events: NativeSignalEvent[] = []
  let injected = false, killed = false
  vi.spyOn(process, 'kill').mockImplementation((pid, signal: string | number = 'SIGTERM') => {
    if (pid !== -rootPid) return realNativeKill(pid, signal)
    const shouldDeny = fault === 'persistent-probe' && signal === 0 ||
      (fault === 'SIGTERM' || fault === 'SIGKILL') && signal === fault ||
      fault === 'pre-kill-probe' && signal === 0 && !injected ||
      fault === 'post-kill-probe' && signal === 0 && killed && !injected
    if (signal === 'SIGKILL') killed = true
    if (shouldDeny) {
      injected = true
      events.push({ signal, result: 'injected-EPERM' })
      throw Object.assign(new Error('Injected owned-group signal denial.'), { code: 'EPERM' })
    }
    try {
      const result = realNativeKill(pid, signal)
      events.push({ signal, result: 'success' })
      return result
    } catch (error) {
      events.push({ signal, result: (error as NodeJS.ErrnoException).code ?? 'unknown' })
      throw error
    }
  })
  return events
}

function expectRealDescendantAbsent(pid: number): void {
  try { realNativeKill(pid, 0) } catch (error) {
    expect(error).toMatchObject({ code: 'ESRCH' })
    return
  }
  throw new Error('Real native descendant is still present.')
}

describe('native process-group syscall uncertainty stays fail-closed', () => {
  it('pre-KILL probe EPERM is presence: real SIGKILL and ESRCH are still required', async () => {
    const f = await heldNativeGroup()
    const events = injectOwnedNativeFault(f.rootPid, 'pre-kill-probe')
    await f.release()
    expect(await f.request('process.wait', f.handle)).toMatchObject({ exitCode: 0 })
    expect(events).toContainEqual({ signal: 0, result: 'injected-EPERM' })
    expect(events.some(event => event.signal === 'SIGKILL' && ['success', 'ESRCH'].includes(event.result))).toBe(true)
    expect(events.at(-1)).toEqual({ signal: 0, result: 'ESRCH' })
    expectRealDescendantAbsent(f.childPid)
    expect(await f.request('process.stop', f.handle)).toMatchObject({ quiescent: true, exitCode: 0 })
  })

  it('post-KILL probe EPERM waits for later real ESRCH before quiescence', async () => {
    const f = await heldNativeGroup()
    const events = injectOwnedNativeFault(f.rootPid, 'post-kill-probe')
    await f.release()
    expect(await f.request('process.wait', f.handle)).toMatchObject({ exitCode: 0 })
    expect(events).toContainEqual({ signal: 0, result: 'injected-EPERM' })
    expect(events.at(-1)).toEqual({ signal: 0, result: 'ESRCH' })
    expectRealDescendantAbsent(f.childPid)
    expect(await f.request('process.stop', f.handle)).toMatchObject({ quiescent: true, exitCode: 0 })
  })

  it('persistent probe EPERM rejects wait and stop at the unchanged five-second deadline', async () => {
    const f = await heldNativeGroup()
    const events = injectOwnedNativeFault(f.rootPid, 'persistent-probe')
    const started = Date.now()
    await f.release()
    const failure = { message: 'Cannot prove native process group teardown.' }
    await expect(f.request('process.wait', f.handle)).rejects.toMatchObject(failure)
    expect(Date.now() - started).toBeGreaterThanOrEqual(5_000)
    await expect(f.request('process.stop', f.handle)).rejects.toMatchObject(failure)
    expectedDisposeFailures.set(f.provider, failure)
    expect(events.some(event => event.signal === 'SIGKILL' && ['success', 'ESRCH'].includes(event.result))).toBe(true)
  }, 15_000)

  for (const signal of ['SIGTERM', 'SIGKILL'] as const) it(`${signal} EPERM rejects wait, stop and disposal instead of certifying quiescence`, async () => {
    const f = await heldNativeGroup()
    const events = injectOwnedNativeFault(f.rootPid, signal)
    await f.release()
    await expect(f.request('process.wait', f.handle)).rejects.toMatchObject({ code: 'EPERM' })
    await expect(f.request('process.stop', f.handle)).rejects.toMatchObject({ code: 'EPERM' })
    expectedDisposeFailures.set(f.provider, { code: 'EPERM' })
    expect(events).toContainEqual({ signal, result: 'injected-EPERM' })
  })
})
