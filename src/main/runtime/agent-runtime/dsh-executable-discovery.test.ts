import { describe, expect, it, vi } from 'vitest'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DshRuntimeError, type DshDeploymentTarget } from '@sciforge/dsh-runtime'
import { createDshDeploymentTargetResolver } from './dsh-executable-discovery'
import { createDshHostRuntimeAdapter } from './dsh-agent-runtime-adapter'

function fakeResolver(overrides: {
  platform?: NodeJS.Platform
  arch?: string
  env?: NodeJS.ProcessEnv
  homeDir?: string
  executablePaths?: readonly string[]
  existingPaths?: readonly string[]
  loginShellPath?: string
  resourcesDirectory?: string
  isExecutable?: (path: string) => Promise<boolean>
}) {
  const executables = new Set(overrides.executablePaths ?? [])
  const existing = new Set([...executables, ...(overrides.existingPaths ?? [])])
  const probed: string[] = []
  const resolver = createDshDeploymentTargetResolver({
    resourcesDirectory: overrides.resourcesDirectory ?? '/nonexistent-resources',
    platform: overrides.platform ?? 'linux',
    arch: overrides.arch,
    env: overrides.env ?? {},
    homeDir: overrides.homeDir ?? '/home/user',
    isExecutable: overrides.isExecutable ?? (async path => { probed.push(path); return executables.has(path) }),
    fileExists: async path => existing.has(path),
    getLoginShellPath: async () => overrides.loginShellPath ?? ''
  })
  return { resolver, probed }
}

describe('DSH executable discovery', () => {
  it('resolves the default configured command name on the inherited PATH', async () => {
    const { resolver } = fakeResolver({
      env: { PATH: '/opt/dsh/bin:/usr/bin' },
      executablePaths: ['/opt/dsh/bin/dsh']
    })
    const target = await resolver({ settings: {} })
    expect(target).toMatchObject({ executable: '/opt/dsh/bin/dsh', source: 'process-path' })
    // Discovered user installs are not version-pinned and derive the safety
    // patch from their own entry list, keeping their own default route.
    expect(target.expectedVersion).toBeUndefined()
    expect(target.defaultAcpRoute).toBeNull()
    expect(target.safetyPatch).toBe('derived')
    expect(target.verifyDeployment).toBeInstanceOf(Function)
  })

  it('prefers an explicit probe command over the configured command', async () => {
    const { resolver } = fakeResolver({
      env: { PATH: '/opt/bin' },
      executablePaths: ['/opt/bin/dsh', '/opt/bin/other-dsh']
    })
    const settings = { agents: { dsh: { command: 'other-dsh' } } }
    const target = await resolver({ command: 'dsh', settings })
    expect(target).toMatchObject({ executable: '/opt/bin/dsh', source: 'process-path' })
    await expect(resolver({ settings })).resolves.toMatchObject({ executable: '/opt/bin/other-dsh' })
  })

  it('accepts an explicit absolute executable path as user-configured', async () => {
    const { resolver } = fakeResolver({ executablePaths: ['/opt/tools/dsh'] })
    await expect(resolver({ command: '/opt/tools/dsh' })).resolves.toMatchObject({
      executable: '/opt/tools/dsh', source: 'user-configured', defaultAcpRoute: null
    })
  })

  it('rejects a relative path with a separator instead of searching for it', async () => {
    const { resolver } = fakeResolver({ executablePaths: ['tools/dsh'] })
    await expect(resolver({ command: 'tools/dsh' })).rejects.toThrow('runtime_path_invalid')
  })

  it('rejects a missing explicit path and a non-executable explicit path', async () => {
    const { resolver } = fakeResolver({ existingPaths: ['/opt/dsh/not-executable'] })
    await expect(resolver({ command: '/opt/dsh/missing' })).rejects.toThrow('runtime_path_invalid')
    await expect(resolver({ command: '/opt/dsh/not-executable' })).rejects.toThrow('runtime_not_executable')
  })

  it('expands a leading home-directory shortcut before validating an explicit path', async () => {
    const { resolver } = fakeResolver({
      platform: 'darwin', homeDir: '/Users/test', executablePaths: ['/Users/test/bin/dsh']
    })
    await expect(resolver({ command: '~/bin/dsh' })).resolves.toMatchObject({
      executable: '/Users/test/bin/dsh', source: 'user-configured'
    })
  })

  it('uses the macOS login shell PATH when the inherited PATH misses', async () => {
    const { resolver } = fakeResolver({
      platform: 'darwin', env: { PATH: '/usr/bin' }, loginShellPath: '/login/bin:/usr/bin',
      executablePaths: ['/login/bin/dsh']
    })
    await expect(resolver({ settings: {} })).resolves.toMatchObject({
      executable: '/login/bin/dsh', source: 'login-shell-path'
    })
  })

  it('searches macOS common install locations after the login shell PATH', async () => {
    const { resolver } = fakeResolver({
      platform: 'darwin', homeDir: '/Users/test', executablePaths: ['/Users/test/.local/bin/dsh']
    })
    await expect(resolver({ settings: {} })).resolves.toMatchObject({
      executable: '/Users/test/.local/bin/dsh', source: 'common-install-location'
    })
  })

  it('probes only native executable and shim names on Windows PATH entries', async () => {
    const { resolver, probed } = fakeResolver({
      platform: 'win32', env: { PATH: 'C:\\Tools' }, executablePaths: ['C:\\Tools\\dsh.exe']
    })
    await expect(resolver({ settings: {} })).resolves.toMatchObject({
      executable: 'C:\\Tools\\dsh.exe', source: 'process-path'
    })
    expect(probed).toEqual(['C:\\Tools\\dsh.exe'])
    expect(probed).not.toContain('C:\\Tools\\dsh')
  })

  it('searches Windows common install locations beyond the inherited PATH', async () => {
    const { resolver } = fakeResolver({
      platform: 'win32', homeDir: 'C:\\Users\\test',
      isExecutable: async path => path.includes('.local') && path.endsWith('dsh.exe')
    })
    const target = await resolver({ settings: {} })
    expect(target.source).toBe('common-install-location')
    expect(target.executable).toContain('dsh.exe')
  })

  it('searches unix common install locations beyond the inherited PATH', async () => {
    const { resolver } = fakeResolver({ executablePaths: ['/usr/local/bin/dsh'] })
    await expect(resolver({ settings: {} })).resolves.toMatchObject({
      executable: '/usr/local/bin/dsh', source: 'common-install-location'
    })
  })

  it('falls back to the packaged pinned artifact and fails closed when its pin is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-discovery-packaged-'))
    try {
      const artifactDirectory = join(root, 'agent-runtimes', 'dsh', '0.2.0-rc.2', 'linux-x64')
      await mkdir(artifactDirectory, { recursive: true })
      const executable = join(artifactDirectory, 'dsh')
      await writeFile(executable, '#!/bin/sh\n')
      await chmod(executable, 0o755)
      const { resolver } = fakeResolver({ resourcesDirectory: root, arch: 'x64' })
      const target = await resolver({ settings: {} })
      expect(target).toMatchObject({ executable, artifactRoot: artifactDirectory, source: 'packaged-application' })
      expect(target.expectedVersion).toBe('0.2.0-rc.2')
      expect(target.defaultAcpRoute).toBeUndefined()
      expect(target.safetyPatch).toBeUndefined()
      // Only darwin-arm64 ships a reviewed pin; every other closure fails closed.
      await expect(target.verifyExecutable!()).rejects.toThrow('runtime_deployment_pin_missing')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it.runIf(process.platform === 'darwin' && process.arch === 'arm64')('binds the reviewed darwin-arm64 pin to the packaged fallback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-discovery-pinned-'))
    try {
      const artifactDirectory = join(root, 'agent-runtimes', 'dsh', '0.2.0-rc.2', 'darwin-arm64')
      await mkdir(artifactDirectory, { recursive: true })
      const executable = join(artifactDirectory, 'dsh')
      await writeFile(executable, '#!/bin/sh\n')
      await chmod(executable, 0o755)
      const { resolver } = fakeResolver({ platform: 'darwin', resourcesDirectory: root })
      const target = await resolver({ settings: {} })
      expect(target).toMatchObject({ executable, artifactRoot: artifactDirectory, source: 'packaged-application' })
      await expect(target.verifyExecutable!()).rejects.toThrow('runtime_deployment_artifact_unapproved')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('fails closed with runtime_not_found when no location yields an executable', async () => {
    const { resolver } = fakeResolver({})
    await expect(resolver({ settings: {} })).rejects.toThrow('runtime_not_found')
    await expect(resolver({ settings: { agents: { dsh: { command: 'custom-dsh' } } } })).rejects.toThrow('runtime_not_found')
  })
})

describe('DSH adapter probe discovery wiring', () => {
  it('forwards the probe command to the deployment target resolver', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-probe-forward-'))
    const resolveDeploymentTarget = vi.fn(async (_input?: { command?: string; settings?: unknown }): Promise<DshDeploymentTarget> => {
      throw new DshRuntimeError('runtime_not_found')
    })
    const adapter = createDshHostRuntimeAdapter({
      stateDirectory: root, resolveDeploymentTarget,
      toolSurface: { tools: () => [], call: vi.fn(), abortTurn: vi.fn() }
    })
    try {
      const result = await adapter.probe({ settings: {} as never }, { command: '/opt/x/dsh' })
      expect(resolveDeploymentTarget).toHaveBeenCalledWith({ command: '/opt/x/dsh', settings: {}, refresh: true })
      expect(result).toMatchObject({
        available: false, executablePath: null, source: null,
        failure: { code: 'runtime_not_found', technicalDetail: 'runtime_not_found' }
      })
    } finally { await adapter.close(); await rm(root, { recursive: true, force: true }) }
  })

  it('reports the resolved executable and source when a later deployment check fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-probe-target-'))
    const resolveDeploymentTarget = vi.fn(async (): Promise<DshDeploymentTarget> => ({
      executable: '/nonexistent/dsh', source: 'process-path',
      verifyDeployment: async () => {}
    }))
    const adapter = createDshHostRuntimeAdapter({
      stateDirectory: root, resolveDeploymentTarget, requestTimeoutMs: 2000,
      toolSurface: { tools: () => [], call: vi.fn(), abortTurn: vi.fn() }
    })
    try {
      const result = await adapter.probe({ settings: {} as never })
      expect(resolveDeploymentTarget).toHaveBeenCalled()
      expect(result).toMatchObject({
        available: false, executablePath: '/nonexistent/dsh', source: 'process-path',
        deploymentIntegrity: 'pinned',
        failure: { code: 'runtime_probe_failed' }
      })
    } finally { await adapter.close(); await rm(root, { recursive: true, force: true }) }
  })
})

describe('DSH discovery cache', () => {
  it('reuses a resolved target and re-reads the disk for an explicit refresh', async () => {
    const { resolver, probed } = fakeResolver({
      env: { PATH: '/opt/dsh/bin' },
      executablePaths: ['/opt/dsh/bin/dsh']
    })
    const first = await resolver({ command: 'dsh' })
    expect(probed.length).toBeGreaterThan(0)
    const probesAfterFirst = probed.length
    await expect(resolver({ command: 'dsh' })).resolves.toBe(first)
    expect(probed.length).toBe(probesAfterFirst)
    await expect(resolver({ command: 'dsh', refresh: true })).resolves.toMatchObject({
      executable: '/opt/dsh/bin/dsh', source: 'process-path'
    })
    expect(probed.length).toBeGreaterThan(probesAfterFirst)
  })

  it('keys the cache by the resolved command so a settings change re-resolves', async () => {
    const { resolver, probed } = fakeResolver({
      env: { PATH: '/opt/bin' },
      executablePaths: ['/opt/bin/dsh', '/opt/bin/other-dsh']
    })
    await expect(resolver({ command: 'dsh' })).resolves.toMatchObject({ executable: '/opt/bin/dsh' })
    const probesAfterFirst = probed.length
    await expect(resolver({ command: 'other-dsh' })).resolves.toMatchObject({ executable: '/opt/bin/other-dsh' })
    expect(probed.length).toBeGreaterThan(probesAfterFirst)
  })

  it('never caches a failed lookup, so a later install is discovered', async () => {
    let installed = false
    const { resolver } = fakeResolver({
      env: { PATH: '/opt/dsh/bin' },
      isExecutable: async (path: string) => installed && path === '/opt/dsh/bin/dsh'
    })
    await expect(resolver({ command: 'dsh' })).rejects.toThrow('runtime_not_found')
    installed = true
    await expect(resolver({ command: 'dsh' })).resolves.toMatchObject({
      executable: '/opt/dsh/bin/dsh', source: 'process-path'
    })
  })
})

describe('DSH command-execution switch', () => {
  const settings = (commandExecution: boolean) => ({ agents: { dsh: { commandExecution } } })
  const deployment = (composedConfig: unknown[], executable = '/opt/dsh/bin/dsh') => ({
    version: '0.2.0-rc.2', configDigest: '0'.repeat(64), composedConfig: JSON.stringify(composedConfig), executable
  })
  const shellEnabled = [
    { id: 'acp', config: { provider: 'p', model: 'm' } },
    { id: 'approval', config: { policy: 'ask' } },
    { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
    { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs', disabled: true }
  ]

  it('carries the switch into the resolved target and never reuses the other mode', async () => {
    const { resolver } = fakeResolver({ env: { PATH: '/opt/dsh/bin' }, executablePaths: ['/opt/dsh/bin/dsh'] })
    const off = await resolver({ settings: settings(false) })
    const on = await resolver({ settings: settings(true) })
    expect(off.commandExecution).toBe(false)
    expect(on.commandExecution).toBe(true)
    // The mode is part of the cache key: a target approved under one mode is
    // never handed back for the other.
    expect(on).not.toBe(off)
    await expect(resolver({ settings: settings(false) })).resolves.toBe(off)
    await expect(resolver({ settings: settings(true) })).resolves.toBe(on)
  })

  it('verifies each discovered deployment against the mode it was approved for', async () => {
    const { resolver } = fakeResolver({ env: { PATH: '/opt/dsh/bin' }, executablePaths: ['/opt/dsh/bin/dsh'] })
    const on = await resolver({ settings: settings(true) })
    const off = await resolver({ settings: settings(false) })
    // The enabled shell is approvable exactly when the switch asked for it.
    await expect(on.verifyDeployment(deployment(shellEnabled))).resolves.toBeUndefined()
    await expect(off.verifyDeployment(deployment(shellEnabled))).rejects.toThrow('runtime_config_unsafe')
    // An unrequested family is rejected in both modes.
    const widened = shellEnabled.map(row => row.id === 'tool-fs' ? { ...row, disabled: false } : row)
    await expect(on.verifyDeployment(deployment(widened))).rejects.toThrow('runtime_config_unsafe')
    await expect(off.verifyDeployment(deployment(widened))).rejects.toThrow('runtime_config_unsafe')
  })

  it('keeps the packaged pinned artifact on the audited composition even with the switch on', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-discovery-switch-'))
    try {
      const artifactDirectory = join(root, 'agent-runtimes', 'dsh', '0.2.0-rc.2', 'linux-x64')
      await mkdir(artifactDirectory, { recursive: true })
      const executable = join(artifactDirectory, 'dsh')
      await writeFile(executable, '#!/bin/sh\n')
      await chmod(executable, 0o755)
      const { resolver } = fakeResolver({ resourcesDirectory: root, arch: 'x64' })
      const target = await resolver({ settings: settings(true) })
      // The pin's digested composition is the release review's, so the packaged
      // artifact can never run an unreviewed enabled shell.
      expect(target).toMatchObject({ executable, source: 'packaged-application', commandExecution: false })
      expect(target.expectedVersion).toBe('0.2.0-rc.2')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
