import { chmod, copyFile, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { HostServiceOwner, HostServiceProvider, HostServiceRequest } from '@sciforge/plugin-sdk'
import { HostServiceProviderRegistry } from '@sciforge/plugin-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNativeExecutionHostService, type NativeExecutionPolicy } from './native-execution-host-service'

const fixtures: { root: string; provider: HostServiceProvider; owner: HostServiceOwner }[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  for (const fixture of fixtures.splice(0)) {
    await fixture.provider.dispose?.(fixture.owner)
    if (!fixture.root.startsWith(join(homedir(), '.sciforge-native-test-'))) throw new Error('Unexpected fixture cleanup target.')
    await rm(fixture.root, { force: true, recursive: true })
  }
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
    for (let attempt = 0; attempt < 100; attempt++) {
      try { pid = Number(await readFile(marker, 'utf8')); break } catch { await new Promise(resolve => setTimeout(resolve, 10)) }
    }
    expect(pid).toBeGreaterThan(0)
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
