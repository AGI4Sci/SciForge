import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import {
  buildModelRouterSidecarLaunch,
  ensureModelRouterSidecar,
  ensureModelRouterConfigFile,
  modelRouterConfigPath
} from './model-router-sidecar'

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    modelRouter: {
      ...defaultModelRouterSettings(),
      baseUrl: 'http://127.0.0.1:4567/v1',
      publicModelAlias: 'deepseek-gui-router',
      runtimeApiKey: 'local-runtime-key',
      profiles: {
        default: {
          textReasoner: {
            provider: 'openai-compatible',
            baseUrl: 'https://text-provider.example/v1',
            apiKey: 'text-secret',
            model: 'text-model'
          },
          translators: {
            vision: {
              provider: 'qwen-compatible',
              baseUrl: 'https://vision-provider.example/v1',
              apiKey: 'vision-secret',
              model: 'vision-model'
            }
          }
        }
      }
    },
    activeAgentRuntime: 'kun',
    agents: {
      kun: defaultKunRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

describe('buildModelRouterSidecarLaunch', () => {
  it('builds a dev workspace launch without writing provider secrets into config', () => {
    const userDataDir = '/tmp/deepseek-gui-user-data'
    const expectedConfigPath = join(userDataDir, 'model-router', 'config.json')
    const result = buildModelRouterSidecarLaunch(settings(), {
      userDataDir,
      appRoot: '/repo/deepseek-gui',
      env: {},
      npmCommand: 'npm'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.launch.command).toBe('npm')
    expect(result.launch.cwd).toBe('/repo/deepseek-gui')
    expect(result.launch.args).toEqual([
      '--workspace',
      '@sciforge/model-router',
      'run',
      'start',
      '--',
      '--host',
      '127.0.0.1',
      '--port',
      '4567',
      '--config',
      expectedConfigPath,
      '--workspace-root',
      '/tmp/workspace',
      '--quiet'
    ])
    expect(result.launch.env.DEEPSEEK_GUI_MODEL_ROUTER_RUNTIME_API_KEY).toBe('local-runtime-key')
    expect(result.launch.env.DEEPSEEK_GUI_MODEL_ROUTER_TEXT_API_KEY).toBe('text-secret')
    expect(result.launch.env.DEEPSEEK_GUI_MODEL_ROUTER_VISION_API_KEY).toBe('vision-secret')
    expect(result.launch.config).toBeUndefined()
  })

  it('builds a launch when the text reasoner member is incomplete in UI settings', () => {
    const current = settings()
    current.modelRouter!.profiles.default.textReasoner.apiKey = ''
    current.modelRouter!.profiles.default.textReasoner.baseUrl = ''
    current.modelRouter!.profiles.default.textReasoner.model = ''

    const result = buildModelRouterSidecarLaunch(current, {
      userDataDir: '/tmp/deepseek-gui-user-data',
      env: {},
      npmCommand: 'npm'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.launch.configPath).toBe(join('/tmp/deepseek-gui-user-data', 'model-router', 'config.json'))
    expect(result.launch.env.DEEPSEEK_GUI_MODEL_ROUTER_RUNTIME_API_KEY).toBe('local-runtime-key')
  })

  it('builds a launch against the local config file without requiring member settings in the UI', () => {
    const current = settings()
    current.modelRouter!.profiles.default.textReasoner = {
      provider: 'openai-compatible',
      baseUrl: '',
      apiKey: '',
      model: ''
    }

    const result = buildModelRouterSidecarLaunch(current, {
      userDataDir: '/tmp/deepseek-gui-user-data',
      env: {},
      npmCommand: 'npm'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const expectedConfigPath = join('/tmp/deepseek-gui-user-data', 'model-router', 'config.json')
    expect(result.launch.configPath).toBe(expectedConfigPath)
    expect(result.launch.config).toBeUndefined()
    expect(result.launch.env.DEEPSEEK_GUI_MODEL_ROUTER_TEXT_API_KEY).toBe('')
    expect(result.launch.args).toContain(expectedConfigPath)
  })

  it('passes npm script path arguments raw when paths contain spaces', () => {
    const userDataDir = 'C:\\Temp\\DeepSeek GUI Data'
    const expectedConfigPath = join(userDataDir, 'model-router', 'config.json')
    const current = settings()
    current.workspaceRoot = 'C:\\Temp\\Workspace With Spaces'
    const result = buildModelRouterSidecarLaunch(current, {
      userDataDir,
      env: {},
      npmCommand: 'npm.cmd'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const configIndex = result.launch.args.indexOf('--config')
    const workspaceIndex = result.launch.args.indexOf('--workspace-root')
    expect(result.launch.args[configIndex + 1]).toBe(expectedConfigPath)
    expect(result.launch.args[workspaceIndex + 1]).toBe('C:\\Temp\\Workspace With Spaces')
  })

  it('creates a local Model Router config template without overwriting an existing file', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'deepseek-gui-router-config-'))
    try {
      const current = settings()
      current.provider.apiKey = 'text-secret'
      current.provider.baseUrl = 'https://text.example/v1'
      current.agents.kun.model = 'deepseek-v4-pro'

      const created = await ensureModelRouterConfigFile(current, { userDataDir })
      const content = await readFile(created.path, 'utf8')

      expect(created.created).toBe(true)
      expect(created.path).toBe(modelRouterConfigPath(userDataDir))
      expect(content).toContain('"publicModelAlias": "deepseek-gui-router"')
      expect(content).toContain('"baseUrl": "https://text.example/v1"')
      expect(content).toContain('"apiKeyEnv": "DEEPSEEK_GUI_MODEL_ROUTER_TEXT_API_KEY"')
      expect(content).toContain('"model": "deepseek-v4-pro"')
      expect(content).not.toContain('text-secret')

      await ensureModelRouterConfigFile(current, { userDataDir })
      const afterSecondEnsure = await readFile(created.path, 'utf8')
      expect(afterSecondEnsure).toBe(content)
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  it('spawns from the explicit app root and logs sidecar output and unexpected exits', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'deepseek-gui-router-sidecar-'))
    const current = settings()
    current.modelRouter!.baseUrl = 'http://127.0.0.1:45987/v1'
    const child = fakeChildProcess()
    const spawnImpl = vi.fn(() => child) as unknown as typeof spawn
    const log = vi.fn()

    try {
      await ensureModelRouterSidecar(current, {
        userDataDir,
        appRoot: '/repo/deepseek-gui',
        env: {},
        spawnImpl,
        log
      })

      expect(spawnImpl).toHaveBeenCalledWith(
        process.platform === 'win32' ? 'cmd.exe' : 'npm',
        expect.arrayContaining(['--workspace', '@sciforge/model-router']),
        expect.objectContaining({
          cwd: '/repo/deepseek-gui',
          stdio: ['ignore', 'pipe', 'pipe']
        })
      )

      child.stderr?.emit('data', Buffer.from('router boot failed\n'))
      child.emit('exit', 1, null)

      expect(log).toHaveBeenCalledWith('Starting Model Router sidecar from /repo/deepseek-gui.')
      expect(log).toHaveBeenCalledWith('Model Router sidecar stderr: router boot failed')
      expect(log).toHaveBeenCalledWith('Model Router sidecar exited unexpectedly (code=1, signal=null).')
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  it('reuses matching sidecars and restarts when managed launch settings change', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'deepseek-gui-router-sidecar-restart-'))
    const firstChild = fakeChildProcess()
    const secondChild = fakeChildProcess()
    const children = [firstChild, secondChild]
    const spawnImpl = vi.fn(() => children.shift() ?? fakeChildProcess()) as unknown as typeof spawn
    const log = vi.fn()

    try {
      const firstSettings = settings()
      firstSettings.modelRouter!.baseUrl = 'http://127.0.0.1:45988/v1'
      await ensureModelRouterSidecar(firstSettings, {
        userDataDir,
        appRoot: '/repo/deepseek-gui',
        env: {},
        spawnImpl,
        log
      })
      await ensureModelRouterSidecar(firstSettings, {
        userDataDir,
        appRoot: '/repo/deepseek-gui',
        env: {},
        spawnImpl,
        log
      })

      const secondSettings = settings()
      secondSettings.modelRouter!.baseUrl = 'http://127.0.0.1:45988/v1'
      secondSettings.modelRouter!.runtimeApiKey = 'local-runtime-key-2'
      await ensureModelRouterSidecar(secondSettings, {
        userDataDir,
        appRoot: '/repo/deepseek-gui',
        env: {},
        spawnImpl,
        log
      })

      expect(spawnImpl).toHaveBeenCalledTimes(2)
      expect(firstChild.kill).toHaveBeenCalledWith('SIGTERM')
      expect(log).toHaveBeenCalledWith('Model Router sidecar launch settings changed; restarting sidecar.')
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })
})

function fakeChildProcess(): ChildProcess {
  const child = new EventEmitter() as ChildProcess & {
    stdout: NonNullable<ChildProcess['stdout']>
    stderr: NonNullable<ChildProcess['stderr']>
    exitCode: number | null
    signalCode: NodeJS.Signals | null
  }
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.exitCode = null
  child.signalCode = null
  child.kill = vi.fn((signal?: NodeJS.Signals | number) => {
    child.exitCode = 0
    child.signalCode = typeof signal === 'string' ? signal : null
    child.emit('exit', child.exitCode, child.signalCode)
    return true
  }) as unknown as ChildProcess['kill']
  return child
}
