import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join, win32 } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  DEFAULT_MODEL_ROUTER_PROVIDER_ID,
  DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultSkillsSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../../shared/app-settings'
import type { AgentRuntimeDiscoveryResult } from '../../../shared/agent-runtime-contract'
import {
  CODEX_PLAN_GATEWAY_PROVIDER_ID,
  codexAppServerLaunchArgs,
  codexRuntimeEnv,
  expandHome,
  probeCodexRuntime,
  prepareCodexAppServerLaunch,
  resolveCodexProbeInvocation
} from './codex-config'

const catalogFetch = vi.fn<typeof fetch>()

beforeEach(() => {
  catalogFetch.mockReset().mockImplementation(async () => Response.json({
    models: [{ slug: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS, default_reasoning_level: null, supported_reasoning_levels: [] }]
  }))
  vi.stubGlobal('fetch', catalogFetch)
})

afterEach(() => vi.unstubAllGlobals())

function settings(codexHome: string): AppSettingsV1 {
  const modelRouter = defaultModelRouterSettings()
  modelRouter.baseUrl = 'http://127.0.0.1:49876/v1'
  modelRouter.publicModelAlias = DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
  modelRouter.runtimeApiKey = 'local-runtime-router-key'
  modelRouter.profiles.default.textReasoner = {
    baseUrl: 'https://text-provider.example/v1',
    apiKey: 'text-secret',
    model: 'text-model'
  }

  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    activeAgentRuntime: 'codex',
    modelAccess: { mode: 'api', planAdapterId: '' },
    agents: {
      sciforge: defaultLocalRuntimeSettings(),
      codex: {
        ...defaultCodexRuntimeSettings(),
        codexHome,
        extraArgs: ['--profile', 'sciforge']
      }
    },
    modelRouter,
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    skills: defaultSkillsSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function availableRuntimeDiscovery(
  executablePath = process.execPath
): AgentRuntimeDiscoveryResult {
  return {
    runtimeId: 'codex',
    available: true,
    executablePath,
    source: 'user-configured',
    version: 'test-transport',
    protocol: { id: 'app-server', supported: true }
  }
}

async function resolvedCodexCommand(
  raw: string,
  options?: Parameters<typeof probeCodexRuntime>[1]
): Promise<string> {
  const discovery = await probeCodexRuntime(raw, {
    ...options,
    runProbeCommand: options?.runProbeCommand ?? (async (_command, args) => ({
      exitCode: 0,
      stdout: args[0] === '--version'
        ? 'codex-cli 0.154.0\n'
        : 'Usage: codex app-server\n',
      stderr: ''
    }))
  })
  if (!discovery.available || !discovery.executablePath) {
    throw new Error(discovery.failure?.code ?? 'runtime_probe_failed')
  }
  return discovery.executablePath
}

async function prepareTestCodexAppServerLaunch(
  options: Omit<Parameters<typeof prepareCodexAppServerLaunch>[0], 'runtimeDiscovery'> & {
    runtimeDiscovery?: AgentRuntimeDiscoveryResult
  }
) {
  return prepareCodexAppServerLaunch({
    ...options,
    runtimeDiscovery: options.runtimeDiscovery ?? availableRuntimeDiscovery()
  })
}

describe('structured Codex runtime discovery', () => {
  it('probes Windows npm shims through the same shell mode used by the launcher', async () => {
    await expect(resolveCodexProbeInvocation(
      'C:\\Users\\Ada Lovelace\\AppData\\Roaming\\npm\\codex.cmd',
      ['--version'],
      'win32'
    )).resolves.toEqual({
      command: process.env.ComSpec || 'cmd.exe',
      args: [
        '/d',
        '/c',
        '""C:\\Users\\Ada Lovelace\\AppData\\Roaming\\npm\\codex.cmd" "--version""'
      ],
      shell: false,
      // Node re-escapes the quotes inside this argument unless the spawn is told
      // to pass it verbatim, which turns the launcher into an unknown command.
      windowsVerbatimArguments: true
    })
  })

  it('probes real launcher executables without the Windows command processor', async () => {
    await expect(resolveCodexProbeInvocation(
      'C:\\Program Files\\Codex\\codex.exe',
      ['--version'],
      'win32'
    )).resolves.toEqual({
      command: 'C:\\Program Files\\Codex\\codex.exe',
      args: ['--version'],
      shell: false,
      windowsVerbatimArguments: false
    })
  })

  it('rejects Windows shim paths containing command-shell metacharacters', async () => {
    await expect(resolveCodexProbeInvocation(
      'C:\\Users\\Ada & calc\\codex.cmd',
      ['--version'],
      'win32'
    )).rejects.toThrow('runtime_path_invalid')
  })

  it('rejects shell metacharacters in Windows shim launch arguments', () => {
    expect(() => codexAppServerLaunchArgs(
      'C:\\Users\\Ada Lovelace\\AppData\\Roaming\\npm\\codex.cmd',
      ['--config', 'safe=value', '& calc.exe']
    )).toThrow('runtime_start_failed')
  })

  it('launches Windows npm shims through the command processor with verbatim arguments', async () => {
    if (process.platform !== 'win32') return
    const shimDir = await mkdtemp(join(tmpdir(), 'codex-shim-'))
    const shim = join(shimDir, 'codex.cmd')
    await writeFile(shim, '@echo off\r\n', 'utf8')
    const managedCodexHome = await mkdtemp(join(tmpdir(), 'managed-codex-home-'))

    const launch = await prepareTestCodexAppServerLaunch({
      settings: settings(managedCodexHome),
      managedCodexHome,
      runtimeDiscovery: availableRuntimeDiscovery(shim)
    })

    expect(launch.command).toBe(process.env.ComSpec || 'cmd.exe')
    expect(launch.args.slice(0, 2)).toEqual(['/d', '/c'])
    expect(launch.args[2]).toContain('app-server')
    // Without this the spawn re-escapes the quoted launcher and cmd.exe reports
    // the whole command line as an unknown command.
    expect(launch.windowsVerbatimArguments).toBe(true)
  })

  it('launches real launcher executables without the command processor', async () => {
    const managedCodexHome = await mkdtemp(join(tmpdir(), 'managed-codex-home-'))
    const launch = await prepareTestCodexAppServerLaunch({
      settings: settings(managedCodexHome),
      managedCodexHome
    })
    expect(launch.windowsVerbatimArguments).toBe(false)
  })

  const supportedProbe = async (_command: string, args: readonly string[]) =>
    args[0] === '--version'
      ? { exitCode: 0, stdout: 'codex-cli 0.154.0-alpha.6.2\n', stderr: '' }
      : { exitCode: 0, stdout: 'Usage: codex app-server\n', stderr: '' }

  it('returns a structured result and honors explicit, process, login shell, common, then ChatGPT app priority', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-codex-priority-'))
    const explicit = join(home, 'explicit', 'codex')
    const processCommand = join(home, 'process', 'codex')
    const loginCommand = join(home, 'login', 'codex')
    const commonCommand = join(home, '.local', 'bin', 'codex')
    const systemChatGptCommand = join(home, 'SystemApplications', 'ChatGPT.app', 'Contents', 'Resources', 'codex')
    const chatGptCommand = join(home, 'Applications', 'ChatGPT.app', 'Contents', 'Resources', 'codex')
    const executableCommands = new Set([explicit, processCommand, loginCommand, commonCommand, systemChatGptCommand, chatGptCommand])
    for (const command of executableCommands) {
      await mkdir(join(command, '..'), { recursive: true })
      await writeFile(command, '#!/bin/sh\n', 'utf8')
      await chmod(command, 0o755)
    }

    const baseOptions = {
      env: { PATH: join(home, 'process') },
      homeDir: home,
      isExecutable: async (candidate: string) => executableCommands.has(candidate),
      fileExists: async (candidate: string) => candidate.startsWith(home) && await stat(candidate).then(info => info.isFile()).catch(() => false),
      platform: 'darwin' as const,
      getLoginShellPath: async () => join(home, 'login'),
      systemApplicationsDir: join(home, 'SystemApplications'),
      runProbeCommand: supportedProbe
    }

    await expect(probeCodexRuntime(explicit, baseOptions)).resolves.toMatchObject({
      available: true,
      executablePath: explicit,
      source: 'user-configured',
      version: '0.154.0-alpha.6.2',
      protocol: { id: 'app-server', supported: true }
    })
    await expect(probeCodexRuntime('codex', baseOptions)).resolves.toMatchObject({
      available: true,
      executablePath: processCommand,
      source: 'process-path'
    })
    await expect(probeCodexRuntime('codex', {
      ...baseOptions,
      env: { PATH: join(home, 'empty') }
    })).resolves.toMatchObject({
      available: true,
      executablePath: loginCommand,
      source: 'login-shell-path'
    })
    await expect(probeCodexRuntime('codex', {
      ...baseOptions,
      env: { PATH: join(home, 'empty') },
      getLoginShellPath: async () => ''
    })).resolves.toMatchObject({
      available: true,
      executablePath: commonCommand,
      source: 'common-install-location'
    })
    executableCommands.delete(commonCommand)
    await expect(probeCodexRuntime('codex', {
      ...baseOptions,
      env: { PATH: join(home, 'empty') },
      getLoginShellPath: async () => ''
    })).resolves.toMatchObject({
      available: true,
      executablePath: systemChatGptCommand,
      source: 'application-bundle'
    })
    executableCommands.delete(systemChatGptCommand)
    await expect(probeCodexRuntime('codex', {
      ...baseOptions,
      env: { PATH: join(home, 'empty') },
      getLoginShellPath: async () => ''
    })).resolves.toMatchObject({
      available: true,
      executablePath: chatGptCommand,
      source: 'application-bundle'
    })
  })

  it('reports no installation and distinguishes invalid or non-executable explicit paths', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-codex-unavailable-'))
    const missing = join(home, 'missing', 'codex')
    const nonExecutable = join(home, 'custom', 'codex')
    await mkdir(join(nonExecutable, '..'), { recursive: true })
    await writeFile(nonExecutable, 'not executable', 'utf8')

    const options = {
      env: { PATH: join(home, 'empty') },
      homeDir: home,
      isExecutable: async () => false,
      fileExists: async (candidate: string) => candidate.startsWith(home) && await stat(candidate).then(info => info.isFile()).catch(() => false),
      platform: 'darwin' as const,
      getLoginShellPath: async () => '',
      systemApplicationsDir: join(home, 'SystemApplications'),
      runProbeCommand: supportedProbe
    }
    await expect(probeCodexRuntime('codex', options)).resolves.toMatchObject({
      available: false,
      executablePath: null,
      source: null,
      failure: { code: 'runtime_not_found' }
    })
    await expect(probeCodexRuntime(missing, options)).resolves.toMatchObject({
      available: false,
      failure: { code: 'runtime_path_invalid' }
    })
    await expect(probeCodexRuntime(nonExecutable, options)).resolves.toMatchObject({
      available: false,
      failure: { code: 'runtime_not_executable' }
    })
  })

  it('distinguishes architecture, version, and app-server capability failures before spawn', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-codex-capability-'))
    const command = join(home, 'codex')
    await writeFile(command, '#!/bin/sh\n', 'utf8')
    await chmod(command, 0o755)
    const baseOptions = {
      env: { PATH: '' },
      homeDir: home,
      platform: 'darwin' as const,
      getLoginShellPath: async () => '',
      systemApplicationsDir: join(home, 'SystemApplications')
    }

    await expect(probeCodexRuntime(command, {
      ...baseOptions,
      runProbeCommand: async () => {
        throw Object.assign(new Error('Bad CPU type in executable'), { code: 'EBADARCH' })
      }
    })).resolves.toMatchObject({
      available: false,
      failure: { code: 'runtime_architecture_incompatible' }
    })
    await expect(probeCodexRuntime(command, {
      ...baseOptions,
      runProbeCommand: async () => ({ exitCode: 0, stdout: 'Codex development build', stderr: '' })
    })).resolves.toMatchObject({
      available: false,
      failure: { code: 'runtime_version_unsupported' }
    })
    await expect(probeCodexRuntime(command, {
      ...baseOptions,
      runProbeCommand: async () => ({ exitCode: 0, stdout: 'codex-cli 0.140.9', stderr: '' })
    })).resolves.toMatchObject({
      available: false,
      version: '0.140.9',
      failure: { code: 'runtime_version_unsupported' }
    })
    await expect(probeCodexRuntime(command, {
      ...baseOptions,
      runProbeCommand: async (_path: string, args: readonly string[]) => args[0] === '--version'
        ? { exitCode: 0, stdout: 'codex-cli 0.154.0\n', stderr: '' }
        : { exitCode: 2, stdout: '', stderr: 'unknown subcommand app-server' }
    })).resolves.toMatchObject({
      available: false,
      version: '0.154.0',
      protocol: { id: 'app-server', supported: false },
      failure: { code: 'runtime_capability_unsupported' }
    })
  })

  it('returns a structured probe failure when candidate inspection fails', async () => {
    await expect(probeCodexRuntime('codex', {
      env: { PATH: '/restricted' },
      homeDir: '/Users/example',
      platform: 'darwin',
      getLoginShellPath: async () => '',
      isExecutable: async () => {
        throw new Error('permission denied while inspecting candidate')
      }
    })).resolves.toMatchObject({
      available: false,
      failure: {
        code: 'runtime_probe_failed',
        technicalDetail: 'permission denied while inspecting candidate'
      }
    })
  })
})

describe('codex config launch helpers', () => {
  it('refuses to launch without the canonical validated discovery result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-codex-discovery-required-'))
    const executable = join(root, 'codex')
    await writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    const current = settings(root)
    current.agents.codex!.command = executable

    await expect(prepareCodexAppServerLaunch({
      settings: current
    } as Parameters<typeof prepareCodexAppServerLaunch>[0])).rejects.toThrow('runtime_discovery_required')
  })

  it('launches the exact executable path returned by the runtime probe', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-codex-probed-path-'))
    const executable = join(root, 'probed-codex')
    await writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    const launch = await prepareTestCodexAppServerLaunch({
      settings: settings(root),
      runtimeDiscovery: {
        runtimeId: 'codex',
        available: true,
        executablePath: executable,
        source: 'user-configured',
        version: '0.154.0',
        protocol: { id: 'app-server', supported: true }
      },
      env: { PATH: join(root, 'unrelated') }
    })

    expect(launch.command).toBe(executable)

    await rm(executable)
    await expect(prepareTestCodexAppServerLaunch({
      settings: settings(root),
      runtimeDiscovery: {
        runtimeId: 'codex',
        available: true,
        executablePath: executable,
        source: 'user-configured',
        version: '0.154.0',
        protocol: { id: 'app-server', supported: true }
      }
    })).rejects.toThrow('runtime_path_invalid')
  })

  it('finds a Codex standalone install when a Finder launch omits the user bin directory', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-codex-command-'))
    const command = join(home, '.local', 'bin', 'codex')
    await mkdir(join(home, '.local', 'bin'), { recursive: true })
    await writeFile(command, '#!/bin/sh\n', 'utf8')
    await chmod(command, 0o755)

    await expect(resolvedCodexCommand('codex', {
      env: { PATH: '/usr/bin:/bin' },
      homeDir: home,
      platform: 'darwin',
      getLoginShellPath: async () => '',
      systemApplicationsDir: join(home, 'SystemApplications')
    })).resolves.toBe(command)
  })

  it('finds the nested Codex CLI shipped inside ChatGPT on macOS', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-codex-chatgpt-cli-'))
    const command = join(
      home,
      'Applications',
      'ChatGPT.app',
      'Contents',
      'Resources',
      'codex-cli',
      'bin',
      'codex'
    )
    await mkdir(join(command, '..'), { recursive: true })
    await writeFile(command, '#!/bin/sh\n', 'utf8')
    await chmod(command, 0o755)

    await expect(resolvedCodexCommand('codex', {
      env: { PATH: '/usr/bin:/bin' },
      homeDir: home,
      platform: 'darwin',
      getLoginShellPath: async () => '',
      systemApplicationsDir: join(home, 'SystemApplications'),
      isExecutable: async (candidate) => candidate === command
    })).resolves.toBe(command)
  })

  it.skipIf(process.platform === 'win32')('uses the interactive login shell PATH when Finder supplies only the system PATH', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-codex-login-shell-'))
    const shellBin = join(home, 'shell-managed', 'bin')
    const command = join(shellBin, 'codex')
    const fakeShell = join(home, 'test-login-shell')
    await mkdir(shellBin, { recursive: true })
    await writeFile(command, '#!/bin/sh\n', 'utf8')
    await chmod(command, 0o755)
    await writeFile(
      fakeShell,
      '#!/bin/sh\nprintf \'\\036%s\\037\' "$SCIFORGE_TEST_LOGIN_PATH"\n',
      'utf8'
    )
    await chmod(fakeShell, 0o755)

    await expect(resolvedCodexCommand('codex', {
      env: {
        PATH: '/usr/bin:/bin',
        SHELL: fakeShell,
        SCIFORGE_TEST_LOGIN_PATH: `/usr/bin:${shellBin}`
      },
      homeDir: home,
      platform: 'darwin'
    })).resolves.toBe(command)
  })

  it.each([
    ['asdf', ['.asdf', 'shims']],
    ['Volta', ['.volta', 'bin']],
    ['pnpm', ['Library', 'pnpm']],
    ['Bun', ['.bun', 'bin']]
  ])('finds a Codex install managed by %s outside the inherited PATH', async (_manager, parts) => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-codex-manager-'))
    const binDir = join(home, ...parts)
    const command = join(binDir, 'codex')
    await mkdir(binDir, { recursive: true })
    await writeFile(command, '#!/bin/sh\n', 'utf8')
    await chmod(command, 0o755)

    await expect(resolvedCodexCommand('codex', {
      env: { PATH: '/usr/bin:/bin' },
      homeDir: home,
      platform: 'darwin',
      getLoginShellPath: async () => ''
    })).resolves.toBe(command)
  })

  it('searches installed nvm Node versions when no version is activated in Finder', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-codex-nvm-'))
    const olderBin = join(home, '.nvm', 'versions', 'node', 'v20.19.0', 'bin')
    const newerBin = join(home, '.nvm', 'versions', 'node', 'v22.17.0', 'bin')
    await mkdir(olderBin, { recursive: true })
    await mkdir(newerBin, { recursive: true })
    await writeFile(join(olderBin, 'codex'), '#!/bin/sh\n', 'utf8')
    await writeFile(join(newerBin, 'codex'), '#!/bin/sh\n', 'utf8')
    await chmod(join(olderBin, 'codex'), 0o755)
    await chmod(join(newerBin, 'codex'), 0o755)

    await expect(resolvedCodexCommand('codex', {
      env: { PATH: '/usr/bin:/bin' },
      homeDir: home,
      platform: 'darwin',
      getLoginShellPath: async () => ''
    })).resolves.toBe(join(newerBin, 'codex'))
  })

  it('skips the extensionless Windows npm shim and resolves its cmd wrapper', async () => {
    const home = 'C:\\Users\\Ada Lovelace'
    const npmBin = win32.join(home, 'AppData', 'Roaming', 'npm')
    const command = win32.join(npmBin, 'codex.cmd')
    const executableCommands = new Set([win32.join(npmBin, 'codex'), command])

    await expect(resolvedCodexCommand('codex', {
      env: {
        Path: 'C:\\Windows\\System32',
        APPDATA: win32.join(home, 'AppData', 'Roaming')
      },
      homeDir: home,
      platform: 'win32',
      isExecutable: async (candidate) => executableCommands.has(candidate),
      getLoginShellPath: async () => {
        throw new Error('must not inspect a Unix shell on Windows')
      }
    })).resolves.toBe(command)
  })

  it('resolves an explicitly configured Windows cmd wrapper outside Explorer Path', async () => {
    const home = 'C:\\Users\\Ada Lovelace'
    const npmBin = win32.join(home, 'AppData', 'Roaming', 'npm')
    const command = win32.join(npmBin, 'codex.cmd')

    await expect(resolvedCodexCommand('codex.cmd', {
      env: {
        Path: 'C:\\Windows\\System32',
        APPDATA: win32.join(home, 'AppData', 'Roaming')
      },
      homeDir: home,
      platform: 'win32',
      isExecutable: async (candidate) => candidate === command
    })).resolves.toBe(command)
  })

  it('prefers and materializes a native Windows app executable over an extensionless companion', async () => {
    const windowsBin = 'C:\\Users\\Ada Lovelace\\AppData\\Local\\Programs\\Codex'
    const windowsExecutable = win32.join(windowsBin, 'codex.exe')
    const executableCommands = new Set([win32.join(windowsBin, 'codex'), windowsExecutable])
    await expect(resolvedCodexCommand('codex', {
      env: { PATH: windowsBin },
      homeDir: 'C:\\Users\\Ada Lovelace',
      platform: 'win32',
      isExecutable: async (candidate) => executableCommands.has(candidate)
    })).resolves.toBe(windowsExecutable)

    // Copy real fixture bytes through packaged discovery using native filesystem paths.
    const home = await mkdtemp(join(tmpdir(), 'sciforge-codex-windows-native-'))
    const bin = join(
      home,
      'Program Files',
      'WindowsApps',
      'OpenAI.Codex_26.810.7004.0_x64__test',
      'app',
      'resources'
    )
    const nativeCommand = join(bin, 'codex.exe')
    await mkdir(bin, { recursive: true })
    await writeFile(join(bin, 'codex'), 'platform-neutral binary', 'utf8')
    await writeFile(nativeCommand, 'native Windows binary', 'utf8')
    await writeFile(join(bin, 'codex-code-mode-host.exe'), 'code mode host', 'utf8')

    await expect(resolvedCodexCommand('codex', {
      env: { Path: 'C:\\Windows\\System32', ProgramFiles: join(home, 'Program Files') },
      homeDir: home,
      platform: 'win32'
    })).resolves.toBe(join(home, '.sciforge', 'codex-runtime', 'codex.exe'))
    await expect(readFile(
      join(home, '.sciforge', 'codex-runtime', 'codex.exe'),
      'utf8'
    )).resolves.toBe('native Windows binary')
    await expect(readFile(
      join(home, '.sciforge', 'codex-runtime', 'codex-code-mode-host.exe'),
      'utf8'
    )).resolves.toBe('code mode host')
  })

  it('materializes the runtime bundled with the Windows Codex app', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-codex-msix-'))
    const programFiles = join(home, 'Program Files')
    const source = join(
      programFiles,
      'WindowsApps',
      'OpenAI.Codex_26.715.4045.0_x64__test',
      'app',
      'resources',
      'codex.exe'
    )
    await mkdir(join(source, '..'), { recursive: true })
    await writeFile(source, 'packaged-codex-runtime', 'utf8')
    await writeFile(
      join(source, '..', 'codex-code-mode-host.exe'),
      'packaged-code-mode-host',
      'utf8'
    )

    const resolved = await resolvedCodexCommand('codex', {
      env: { Path: 'C:\\Windows\\System32', ProgramFiles: programFiles },
      homeDir: home,
      platform: 'win32'
    })

    expect(resolved).toBe(join(home, '.sciforge', 'codex-runtime', 'codex.exe'))
    await expect(readFile(resolved, 'utf8')).resolves.toBe('packaged-codex-runtime')
    await expect(readFile(
      join(home, '.sciforge', 'codex-runtime', 'codex-code-mode-host.exe'),
      'utf8'
    )).resolves.toBe('packaged-code-mode-host')
  })

  it('repairs a missing code-mode companion when the managed Codex exe is current', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-codex-companion-repair-'))
    const programFiles = join(home, 'Program Files')
    const resources = join(
      programFiles,
      'WindowsApps',
      'OpenAI.Codex_26.818.5229.0_x64__test',
      'app',
      'resources'
    )
    const source = join(resources, 'codex.exe')
    const managedDirectory = join(home, '.sciforge', 'codex-runtime')
    await mkdir(resources, { recursive: true })
    await mkdir(managedDirectory, { recursive: true })
    await writeFile(source, 'same-runtime', 'utf8')
    await writeFile(join(resources, 'codex-code-mode-host.exe'), 'repaired-host', 'utf8')
    await writeFile(join(managedDirectory, 'codex.exe'), 'same-runtime', 'utf8')

    await expect(resolvedCodexCommand('codex', {
      env: { Path: 'C:\\Windows\\System32', ProgramFiles: programFiles },
      homeDir: home,
      platform: 'win32'
    })).resolves.toBe(join(managedDirectory, 'codex.exe'))
    await expect(readFile(
      join(managedDirectory, 'codex-code-mode-host.exe'),
      'utf8'
    )).resolves.toBe('repaired-host')
  })

  it('expands and validates an explicit Codex executable path', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-explicit-codex-'))
    const command = join(home, 'custom', 'codex')
    await mkdir(join(home, 'custom'), { recursive: true })
    await writeFile(command, '#!/bin/sh\n', 'utf8')
    await chmod(command, 0o755)

    await expect(resolvedCodexCommand('~/custom/codex', {
      homeDir: home,
      platform: 'darwin',
      getLoginShellPath: async () => {
        throw new Error('must not inspect the shell for an explicit path')
      }
    })).resolves.toBe(command)

    const windowsCommand = 'C:\\Tools\\Codex\\codex.exe'
    await expect(resolvedCodexCommand(windowsCommand, {
      homeDir: 'C:\\Users\\example',
      platform: 'win32',
      isExecutable: async (path) => path === windowsCommand
    })).resolves.toBe(windowsCommand)
  })

  it('rejects missing and relative explicit Codex paths with actionable errors', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-invalid-codex-'))

    await expect(resolvedCodexCommand('~/missing/codex', {
      homeDir: home,
      platform: 'darwin'
    })).rejects.toThrow('runtime_path_invalid')

    await expect(resolvedCodexCommand('./tools/codex', {
      homeDir: home,
      platform: 'darwin',
      isExecutable: async () => {
        throw new Error('must not inspect a relative explicit path')
      }
    })).rejects.toThrow('runtime_path_invalid')
  })

  it('prefers the supplied PATH for a bare Codex command', async () => {
    await expect(resolvedCodexCommand('codex', {
      env: { PATH: '/custom/bin:/usr/bin' },
      homeDir: '/Users/example',
      platform: 'darwin',
      isExecutable: async (path) => path === '/custom/bin/codex',
      getLoginShellPath: async () => {
        throw new Error('must not inspect the shell after PATH resolves the command')
      }
    })).resolves.toBe('/custom/bin/codex')
  })

  it('prepares app-server stdio launch config and creates CODEX_HOME', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'sciforge-codex-home-'))
    const managedHome = join(codexHome, 'nested')
    await mkdir(managedHome, { recursive: true })
    await writeFile(
      join(managedHome, 'config.toml'),
      [
        'model = "gpt-5"',
        'model_provider = "openai"',
        '[model_providers.openai_proxy]',
        'base_url = "https://api.openai.com/v1"',
        'env_key = "OPENAI_API_KEY"'
      ].join('\n')
    )

    const launch = await prepareTestCodexAppServerLaunch({
      settings: settings(managedHome),
      workspace: '~/project',
      env: {
        OPENAI_API_KEY: 'sk-openai',
        DEEPSEEK_API_KEY: 'sk-deepseek',
        ANTHROPIC_API_KEY: 'sk-anthropic',
        ANTHROPIC_AUTH_TOKEN: 'anthropic-token',
        QWEN_API_KEY: 'sk-qwen',
        DASHSCOPE_API_KEY: 'sk-dashscope',
        GEMINI_API_KEY: 'sk-gemini',
        GOOGLE_API_KEY: 'sk-google',
        GROQ_API_KEY: 'sk-groq',
        MISTRAL_API_KEY: 'sk-mistral',
        COHERE_API_KEY: 'sk-cohere',
        OPENROUTER_API_KEY: 'sk-openrouter',
        AZURE_OPENAI_API_KEY: 'sk-azure',
        TOGETHER_API_KEY: 'sk-together',
        FIREWORKS_API_KEY: 'sk-fireworks',
        XAI_API_KEY: 'sk-xai',
        PERPLEXITY_API_KEY: 'sk-perplexity',
        MOONSHOT_API_KEY: 'sk-moonshot',
        ZHIPU_API_KEY: 'sk-zhipu',
        SILICONFLOW_API_KEY: 'sk-siliconflow',
        ARK_API_KEY: 'sk-ark',
        OPENAI_MODEL: 'gpt-5',
        TOGETHER_MODEL: 'together-model',
        DEEPSEEK_MODEL: 'deepseek-chat',
        ANTHROPIC_MODEL: 'opus',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'bailian/deepseek-v4-flash',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'bailian/deepseek-v4-flash',
        MODEL_PROVIDER: 'anthropic',
        KUN_BASE_URL: 'https://old-runtime-provider.example/v1',
        SCIFORGE_IMAGE_API_KEY: 'outer-image-key',
        SCIFORGE_IMAGE_BASE_URL: 'https://direct-image-provider.example/v1',
        SCIFORGE_IMAGE_MODEL: 'outer-image-model',
        SCIFORGE_IMAGE_ALLOW_PLACEHOLDER: '1',
        SCIFORGE_SCIMODALITY_SERVICE_URL: 'http://127.0.0.1:3898',
        SCIFORGE_SCIMODALITY_SERVICE_TOKEN: 'outer-sci-modality-token',
        SCIFORGE_SCIMODALITY_SERVICE_TIMEOUT_MS: '12345',
        SCIFORGE_MODEL_ROUTER_SCIENTIFIC_TRANSLATOR_TOKEN: 'outer-model-router-scientific-token',
        EXPERT_PROVIDER_BASE_URL: 'http://127.0.0.1:8001/v1',
        EXPERT_PROVIDER_API_KEY: 'outer-expert-token',
        SCIMODALITY_ROUTER_PORT: '3898',
        SCIMODALITY_ROUTER_RUNTIME_TOKEN: 'outer-router-token',
        SCIFORGE_RUNTIME_API_KEY: 'stale-runtime-key',
        PATH: '/bin',
        CODEX_USER_HOME: '/old',
        CODEX_CONFIG_HOME: '/old-config',
        NO_PROXY: 'example.com'
      }
    })

    expect(launch.command).toBe(process.execPath)
    if (launch.command.includes('/')) {
      expect(launch.env.PATH?.split(':')).toContain(join(launch.command, '..'))
    }
    expect(launch.args).toEqual(['app-server', '--listen', 'stdio://'])
    expect(launch.cwd).toContain('project')
    expect(launch.env.CODEX_HOME).toBe(managedHome)
    expect(launch.env.CODEX_USER_HOME).toBeUndefined()
    expect(launch.env.CODEX_CONFIG_HOME).toBeUndefined()
    expect(launch.env.OPENAI_API_KEY).toBeUndefined()
    expect(launch.env.DEEPSEEK_API_KEY).toBeUndefined()
    expect(launch.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(launch.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(launch.env.QWEN_API_KEY).toBeUndefined()
    expect(launch.env.DASHSCOPE_API_KEY).toBeUndefined()
    expect(launch.env.GEMINI_API_KEY).toBeUndefined()
    expect(launch.env.GOOGLE_API_KEY).toBeUndefined()
    expect(launch.env.GROQ_API_KEY).toBeUndefined()
    expect(launch.env.MISTRAL_API_KEY).toBeUndefined()
    expect(launch.env.COHERE_API_KEY).toBeUndefined()
    expect(launch.env.OPENROUTER_API_KEY).toBeUndefined()
    expect(launch.env.AZURE_OPENAI_API_KEY).toBeUndefined()
    expect(launch.env.TOGETHER_API_KEY).toBeUndefined()
    expect(launch.env.FIREWORKS_API_KEY).toBeUndefined()
    expect(launch.env.XAI_API_KEY).toBeUndefined()
    expect(launch.env.PERPLEXITY_API_KEY).toBeUndefined()
    expect(launch.env.MOONSHOT_API_KEY).toBeUndefined()
    expect(launch.env.ZHIPU_API_KEY).toBeUndefined()
    expect(launch.env.SILICONFLOW_API_KEY).toBeUndefined()
    expect(launch.env.ARK_API_KEY).toBeUndefined()
    expect(launch.env.OPENAI_MODEL).toBeUndefined()
    expect(launch.env.TOGETHER_MODEL).toBeUndefined()
    expect(launch.env.DEEPSEEK_MODEL).toBeUndefined()
    expect(launch.env.ANTHROPIC_MODEL).toBeUndefined()
    expect(launch.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined()
    expect(launch.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined()
    expect(launch.env.MODEL_PROVIDER).toBeUndefined()
    expect(launch.env.KUN_BASE_URL).toBeUndefined()
    expect(launch.env.SCIFORGE_IMAGE_API_KEY).toBeUndefined()
    expect(launch.env.SCIFORGE_IMAGE_BASE_URL).toBeUndefined()
    expect(launch.env.SCIFORGE_IMAGE_MODEL).toBeUndefined()
    expect(launch.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER).toBeUndefined()
    expect(launch.env.SCIFORGE_SCIMODALITY_SERVICE_URL).toBeUndefined()
    expect(launch.env.SCIFORGE_SCIMODALITY_SERVICE_TOKEN).toBeUndefined()
    expect(launch.env.SCIFORGE_SCIMODALITY_SERVICE_TIMEOUT_MS).toBeUndefined()
    expect(launch.env.SCIFORGE_MODEL_ROUTER_SCIENTIFIC_TRANSLATOR_TOKEN).toBeUndefined()
    expect(launch.env.EXPERT_PROVIDER_BASE_URL).toBeUndefined()
    expect(launch.env.EXPERT_PROVIDER_API_KEY).toBeUndefined()
    expect(launch.env.SCIMODALITY_ROUTER_PORT).toBeUndefined()
    expect(launch.env.SCIMODALITY_ROUTER_RUNTIME_TOKEN).toBeUndefined()
    expect(launch.env.SCIFORGE_RUNTIME_API_KEY).toBe('local-runtime-router-key')
    expect(launch.env.SCIFORGE_RUNTIME_API_KEY).toBe('local-runtime-router-key')
    expect(launch.env.NO_PROXY).toContain('127.0.0.1')
    await expect(stat(managedHome)).resolves.toMatchObject({})
    await expect(stat(join(managedHome, 'sessions'))).resolves.toMatchObject({})
    await expect(stat(join(managedHome, 'memories'))).resolves.toMatchObject({})
    await expect(stat(join(managedHome, 'logs'))).resolves.toMatchObject({})

    const config = await readFile(join(managedHome, 'config.toml'), 'utf8')
    expect(config).toContain(`model = "${DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS}"`)
    expect(config).toContain(`model_provider = "${DEFAULT_MODEL_ROUTER_PROVIDER_ID}"`)
    expect(config).toContain('hide_agent_reasoning = false')
    expect(config).toContain('show_raw_agent_reasoning = true')
    expect(config).toContain('model_reasoning_summary = "detailed"')
    expect(config).not.toContain('model_supports_reasoning_summaries = true')
    expect(config).toContain(`[model_providers.${DEFAULT_MODEL_ROUTER_PROVIDER_ID}]`)
    expect(config).toContain('name = "SciForge Model Router"')
    expect(config).toContain('base_url = "http://127.0.0.1:49876/v1"')
    expect(config).toContain('env_key = "SCIFORGE_RUNTIME_API_KEY"')
    expect(config).toContain('wire_api = "responses"')
    expect(config).not.toContain('api.openai.com')
    expect(config).not.toContain('sk-')
    expect(config).not.toContain('OPENAI_API_KEY')
  }, 15_000)

  it('materializes the canonical app-owned PreToolUse hook in the isolated Codex home', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-codex-hook-home-'))
    const codexHome = join(root, 'codex-home')
    const appPath = join(root, 'SciForge App')
    const launch = await prepareTestCodexAppServerLaunch({
      settings: settings(codexHome),
      preToolUseHookLaunch: {
        appPath,
        execPath: process.execPath,
        isPackaged: false
      }
    })

    expect(launch.preToolUseHook).toMatchObject({
      sourcePath: join(codexHome, 'hooks.json')
    })
    await expect(readFile(join(codexHome, 'config.toml'), 'utf8')).resolves.toContain(
      '[features]\nhooks = true'
    )
    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    expect(config.indexOf('model_provider = "sciforge-plan-gateway"'))
      .toBeLessThan(config.indexOf('[features]'))
    const hooks = JSON.parse(await readFile(join(codexHome, 'hooks.json'), 'utf8'))
    expect(hooks).toEqual({
      hooks: {
        PreToolUse: [{
          hooks: [{
            type: 'command',
            command: launch.preToolUseHook?.command,
            commandWindows: launch.preToolUseHook?.commandWindows,
            timeout: 10,
            async: false,
            statusMessage: 'Checking SciForge visual execution policy'
          }]
        }]
      }
    })
  })

  it('keeps the Coding Plan provider at the TOML root when hooks are enabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-codex-plan-hook-home-'))
    const codexHome = join(root, 'codex-home')
    const current = settings(codexHome)
    current.modelAccess = { mode: 'coding-plan', planAdapterId: 'codex' }

    await prepareTestCodexAppServerLaunch({
      settings: current,
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1/' },
      preToolUseHookLaunch: {
        appPath: join(root, 'SciForge App'),
        execPath: process.execPath,
        isPackaged: false
      }
    })

    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    const provider = `model_provider = "${CODEX_PLAN_GATEWAY_PROVIDER_ID}"`
    const providerIndex = config.indexOf(provider)
    const featuresIndex = config.indexOf('[features]')

    expect(providerIndex).toBeGreaterThanOrEqual(0)
    expect(featuresIndex).toBeGreaterThanOrEqual(0)
    expect(providerIndex).toBeLessThan(featuresIndex)
  })

  it('drops Codex runtime-only profile args before launching app-server', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'sciforge-codex-home-'))
    const launch = await prepareTestCodexAppServerLaunch({
      settings: {
        ...settings(codexHome),
        agents: {
          ...settings(codexHome).agents,
          codex: {
            ...defaultCodexRuntimeSettings(),
            codexHome,
            extraArgs: [
              '--profile-v2',
              '--profile',
              'sciforge',
              '-p',
              'legacy-profile',
              '--config',
              'features.experimental=true'
            ]
          }
        }
      },
      env: {}
    })

    expect(launch.args).toEqual([
      'app-server',
      '--listen',
      'stdio://',
      '--config',
      'features.experimental=true'
    ])
  })

  it('does not write managed MCP servers into Codex config', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'sciforge-codex-home-'))
    const launch = await prepareTestCodexAppServerLaunch({
      settings: settings(codexHome)
    })

    expect(launch.codexHome).toBe(codexHome)
    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    expect(config).not.toContain('[mcp_servers.')
    expect(config).not.toContain('computer-use-mcp-node-entry')
  })

  it('uses the managed Codex home instead of a persisted global Codex home', async () => {
    const settingsCodexHome = await mkdtemp(join(tmpdir(), 'global-codex-home-'))
    const managedCodexHome = await mkdtemp(join(tmpdir(), 'project-codex-home-'))
    await writeFile(
      join(settingsCodexHome, 'config.toml'),
      [
        'model = "gpt-5"',
        'model_provider = "openai"',
        '[model_providers.openai]',
        'base_url = "https://api.openai.com/v1"',
        'env_key = "OPENAI_API_KEY"'
      ].join('\n')
    )

    const launch = await prepareTestCodexAppServerLaunch({
      settings: settings(settingsCodexHome),
      managedCodexHome,
      env: {
        OPENAI_API_KEY: 'sk-global',
        SCIFORGE_RUNTIME_API_KEY: 'stale-runtime-key'
      }
    })

    expect(launch.codexHome).toBe(managedCodexHome)
    expect(launch.env.CODEX_HOME).toBe(managedCodexHome)
    expect(launch.env.OPENAI_API_KEY).toBeUndefined()
    expect(launch.env.SCIFORGE_RUNTIME_API_KEY).toBe('local-runtime-router-key')
    expect(launch.env.SCIFORGE_RUNTIME_API_KEY).toBe('local-runtime-router-key')

    const managedConfig = await readFile(join(managedCodexHome, 'config.toml'), 'utf8')
    expect(managedConfig).toContain(`model_provider = "${DEFAULT_MODEL_ROUTER_PROVIDER_ID}"`)
    expect(managedConfig).toContain('base_url = "http://127.0.0.1:49876/v1"')

    const persistedGlobalConfig = await readFile(join(settingsCodexHome, 'config.toml'), 'utf8')
    expect(persistedGlobalConfig).toContain('api.openai.com')
    expect(persistedGlobalConfig).not.toContain(DEFAULT_MODEL_ROUTER_PROVIDER_ID)
  })

  it('does not import auth credentials from an external CODEX_HOME', async () => {
    const externalCodexHome = await mkdtemp(join(tmpdir(), 'external-codex-home-'))
    const managedCodexHome = await mkdtemp(join(tmpdir(), 'managed-codex-home-'))
    await writeFile(join(externalCodexHome, 'config.toml'), 'model_provider = "external"\n')
    await writeFile(join(externalCodexHome, 'auth.json'), '{"auth":"external-only"}\n', { mode: 0o600 })

    const launch = await prepareTestCodexAppServerLaunch({
      settings: {
        ...settings(externalCodexHome),
        modelAccess: { mode: 'coding-plan', planAdapterId: 'codex' }
      },
      managedCodexHome,
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1/' },
      env: {
        SCIFORGE_RUNTIME_API_KEY: 'stale-api-path-key',
        OPENAI_API_KEY: 'stale-openai-key'
      }
    })

    expect(launch.accessMode).toBe('coding-plan')
    expect(launch.env.CODEX_HOME).toBe(managedCodexHome)
    expect(launch.env.SCIFORGE_RUNTIME_API_KEY).toBeUndefined()
    expect(launch.env.OPENAI_API_KEY).toBeUndefined()

    const config = await readFile(join(managedCodexHome, 'config.toml'), 'utf8')
    expect(config).toContain(`model_provider = "${CODEX_PLAN_GATEWAY_PROVIDER_ID}"`)
    expect(config).toContain(`[model_providers.${CODEX_PLAN_GATEWAY_PROVIDER_ID}]`)
    expect(config).toContain('base_url = "http://127.0.0.1:47931/v1"')
    expect(config).toContain('wire_api = "responses"')
    expect(config).toContain('requires_openai_auth = true')
    expect(config).toContain('supports_websockets = false')
    expect(config).not.toContain('env_key')
    expect(config).not.toContain('model =')
    await expect(readFile(join(externalCodexHome, 'config.toml'), 'utf8'))
      .resolves.toBe('model_provider = "external"\n')
    await expect(readFile(join(externalCodexHome, 'auth.json'), 'utf8'))
      .resolves.toBe('{"auth":"external-only"}\n')
    await expect(readFile(join(managedCodexHome, 'auth.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('imports explicitly trusted standard Codex auth without overwriting runtime config', async () => {
    const externalCodexHome = await mkdtemp(join(tmpdir(), 'external-codex-home-'))
    const managedCodexHome = await mkdtemp(join(tmpdir(), 'managed-codex-home-'))
    const standardCodexHome = await mkdtemp(join(tmpdir(), 'standard-codex-home-'))
    const standardAuthPath = join(standardCodexHome, 'auth.json')
    await writeFile(standardAuthPath, '{"auth":"standard-login"}\n', { mode: 0o600 })

    await prepareTestCodexAppServerLaunch({
      settings: {
        ...settings(externalCodexHome),
        modelAccess: { mode: 'coding-plan', planAdapterId: 'codex' }
      },
      managedCodexHome,
      standardCodexAuthPath: standardAuthPath,
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1/' }
    })

    await expect(readFile(join(managedCodexHome, 'auth.json'), 'utf8'))
      .resolves.toBe('{"auth":"standard-login"}\n')
    if (process.platform !== 'win32') {
      expect((await stat(join(managedCodexHome, 'auth.json'))).mode & 0o777).toBe(0o600)
    }
  })

  it('does not overwrite an existing managed Codex login', async () => {
    const externalCodexHome = await mkdtemp(join(tmpdir(), 'external-codex-home-'))
    const managedCodexHome = await mkdtemp(join(tmpdir(), 'managed-codex-home-'))
    await writeFile(join(externalCodexHome, 'auth.json'), '{"auth":"external"}\n')
    await writeFile(join(managedCodexHome, 'auth.json'), '{"auth":"managed"}\n', { mode: 0o600 })

    await prepareTestCodexAppServerLaunch({
      settings: {
        ...settings(externalCodexHome),
        modelAccess: { mode: 'coding-plan', planAdapterId: 'codex' }
      },
      managedCodexHome,
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1/' }
    })

    await expect(readFile(join(managedCodexHome, 'auth.json'), 'utf8'))
      .resolves.toBe('{"auth":"managed"}\n')
    if (process.platform !== 'win32') {
      expect((await stat(join(managedCodexHome, 'auth.json'))).mode & 0o777).toBe(0o600)
    }
  })

  it.skipIf(process.platform === 'win32')('rejects a managed Codex auth symlink', async () => {
    const externalCodexHome = await mkdtemp(join(tmpdir(), 'external-codex-home-'))
    const managedCodexHome = await mkdtemp(join(tmpdir(), 'managed-codex-home-'))
    await writeFile(join(externalCodexHome, 'auth.json'), '{"auth":"external"}\n', { mode: 0o600 })
    await symlink(join(externalCodexHome, 'auth.json'), join(managedCodexHome, 'auth.json'))

    await expect(prepareTestCodexAppServerLaunch({
      settings: {
        ...settings(externalCodexHome),
        modelAccess: { mode: 'coding-plan', planAdapterId: 'codex' }
      },
      managedCodexHome,
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1/' }
    })).rejects.toThrow('managed auth.json must not be a symbolic link')
  })

  it.skipIf(process.platform === 'win32')('rejects a broadly accessible managed Codex auth file', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'codex-home-'))
    const managedCodexHome = await mkdtemp(join(tmpdir(), 'managed-codex-home-'))
    await writeFile(join(managedCodexHome, 'auth.json'), '{"auth":"managed"}\n', { mode: 0o644 })

    await expect(prepareTestCodexAppServerLaunch({
      settings: {
        ...settings(codexHome),
        modelAccess: { mode: 'coding-plan', planAdapterId: 'codex' }
      },
      managedCodexHome,
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1/' }
    })).rejects.toThrow('managed auth.json must not be group or world accessible')
  })

  it('fails closed when coding-plan mode has no local gateway or selects another adapter', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'sciforge-codex-home-'))
    await expect(prepareTestCodexAppServerLaunch({
      settings: {
        ...settings(codexHome),
        modelAccess: { mode: 'coding-plan', planAdapterId: 'codex' }
      }
    })).rejects.toThrow('Plan Gateway base URL is required')

    await expect(prepareTestCodexAppServerLaunch({
      settings: {
        ...settings(codexHome),
        modelAccess: { mode: 'coding-plan', planAdapterId: 'other-plan' }
      },
      planGateway: { baseUrl: 'http://127.0.0.1:47931/v1' }
    })).rejects.toThrow('does not support coding plan adapter')
  })

  it('rejects non-local Model Router URLs', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'sciforge-codex-home-'))
    const current = settings(codexHome)

    await expect(prepareTestCodexAppServerLaunch({
      settings: {
        ...current,
        modelRouter: {
          ...current.modelRouter!,
          baseUrl: 'https://router.example.com/v1'
        }
      },
      env: {}
    })).rejects.toThrow('Model Router base URL must be local')
  })

  it('rejects launch config when the text reasoner is incomplete', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'sciforge-codex-home-'))
    const current = settings(codexHome)
    current.modelRouter!.profiles.default.textReasoner.model = ''

    await expect(prepareTestCodexAppServerLaunch({
      settings: current,
      env: {}
    })).rejects.toThrow('text reasoner')
  })

  it('keeps external env clean and appends loopback no_proxy entries', () => {
    const env = codexRuntimeEnv({
      CODEX_CONFIG_HOME: '/old',
      no_proxy: 'localhost'
    }, '/tmp/codex-home')

    expect(env.CODEX_HOME).toBe('/tmp/codex-home')
    expect(env.CODEX_CONFIG_HOME).toBeUndefined()
    expect(env.no_proxy).toContain('localhost')
    expect(env.no_proxy).toContain('127.0.0.1')
    expect(env.no_proxy).toContain('::1')
  })

  it('expands home paths without rewriting non-home paths', () => {
    expect(expandHome('/tmp/codex')).toBe('/tmp/codex')
    expect(expandHome('')).toBe('')
    expect(expandHome('~/codex')).toContain('codex')
  })
})

describe('Codex startup model catalog', () => {
  it('loads the published catalog without auth or a private Codex cache and preserves empty declarations', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'codex-catalog-'))
    const published = { models: [{ slug: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
      default_reasoning_level: null, supported_reasoning_levels: [], custom_metadata: 'preserved' }] }
    catalogFetch.mockImplementation(async () => Response.json(published))
    await prepareTestCodexAppServerLaunch({ settings: settings(codexHome) })
    expect(catalogFetch).toHaveBeenCalledWith('http://127.0.0.1:49876/v1/models', expect.objectContaining({
      headers: { Authorization: 'Bearer local-runtime-router-key' }, redirect: 'error'
    }))
    expect(JSON.parse(await readFile(join(codexHome, 'model-catalog.json'), 'utf8'))).toEqual(published)
    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    expect(config).toContain(`model_catalog_json = "${join(codexHome, 'model-catalog.json')}"`)
    expect(config).not.toContain('model_supports_reasoning_summaries')
    await expect(stat(join(codexHome, 'auth.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(codexHome, 'models_cache.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([Response.json({ models: [] }), Response.json({ models: [{ slug: 'another-model' }] }),
    Response.json({ error: 'unavailable' }, { status: 503 })])('fails startup instead of using stale metadata: %s', async (response) => {
    const codexHome = await mkdtemp(join(tmpdir(), 'codex-catalog-failure-'))
    await writeFile(join(codexHome, 'model-catalog.json'), '{"models":[{"slug":"stale"}]}')
    catalogFetch.mockResolvedValue(response)
    await expect(prepareTestCodexAppServerLaunch({ settings: settings(codexHome) }))
      .rejects.toMatchObject({ name: 'runtime_model_catalog_unavailable' })
  })
})
