import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureLogger } from './logger'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultAgentCapabilitySettings,
  defaultKeyboardShortcuts,
  DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultModelProviderSettings,
  defaultRemoteExecutorSettings,
  defaultRuntimeGuardSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import { LocalRuntimeConfigSchema } from './local-runtime-package-contract'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/tmp/sciforge-test-app',
    getPath: () => '/tmp/sciforge-test-user-data'
  }
}))

let tempRoot: string | null = null

function configuredModelRouterSettings() {
  const modelRouter = defaultModelRouterSettings()
  modelRouter.runtimeApiKey = 'local-runtime-router-key'
  modelRouter.profiles.default.textReasoner = {
    provider: 'openai-compatible',
    baseUrl: 'https://text-provider.example/v1',
    apiKey: 'text-secret',
    model: 'text-model'
  }
  return modelRouter
}

function createSettings(binaryPath: string, port = 8899): AppSettingsV1 {
  const runtimeDataDir = tempRoot ? join(tempRoot, 'runtime') : join(tmpdir(), 'sciforge-local-runtime-test')
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    modelRouter: configuredModelRouterSettings(),
    agents: {
      sciforge: {
        ...defaultLocalRuntimeSettings(port),
        dataDir: runtimeDataDir,
        binaryPath,
        autoStart: true
      }
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    remoteChannel: defaultRemoteChannelSettings(),
    connectPhone: defaultConnectPhoneSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    remoteExecutor: defaultRemoteExecutorSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function writeScript(name: string, content: string): string {
  if (!tempRoot) throw new Error('temp root not initialized')
  const path = join(tempRoot, name)
  writeFileSync(path, content, 'utf8')
  return path
}

async function readLocalRuntimeLog(): Promise<string> {
  if (!tempRoot) throw new Error('temp root not initialized')
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const logFile = readdirSync(tempRoot).find((entry) => entry.startsWith('sciforge-runtime-') && entry.endsWith('.log'))
    if (logFile) return readFileSync(join(tempRoot, logFile), 'utf8')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Expected a local runtime log file to be created')
}

async function listenOnPort(port: number): Promise<ReturnType<typeof createServer>> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })
  return server
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

async function allocateAvailablePort(): Promise<number> {
  const server = await listenOnPort(0)
  const address = server.address() as AddressInfo
  const port = address.port
  await closeServer(server)
  return port
}

async function canBindPort(port: number): Promise<boolean> {
  const server = createServer()
  return new Promise((resolve) => {
    let settled = false
    const settle = (available: boolean): void => {
      if (settled) return
      settled = true
      server.removeAllListeners('error')
      resolve(available)
    }
    server.once('error', () => settle(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => settle(true))
    })
  })
}

async function findPortWithAvailableNext(): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const server = await listenOnPort(0)
    const address = server.address() as AddressInfo
    const port = address.port
    await closeServer(server)
    if (port < 65535 && await canBindPort(port + 1)) return port
  }
  throw new Error('Expected to find a test port with an available successor')
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'local-runtime-process-'))
  configureLogger({ dir: tempRoot, enabled: true, retentionDays: 7 })
})

afterEach(async () => {
  const module = await import('./local-runtime-process')
  module.setLocalRuntimeUnexpectedExitHandler(null)
  await module.stopLocalRuntimeChildAndWait()
  configureLogger({ dir: '', enabled: true, retentionDays: 2 })
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true })
    tempRoot = null
  }
})

describe('startLocalRuntimeChild', () => {
  it('rejects before starting when the text reasoner is incomplete', async () => {
    const script = writeScript(
      'text-reasoner-missing-child.js',
      [
        "process.stdout.write('should not start\\n')",
        "setInterval(() => {}, 1_000)"
      ].join('\n')
    )
    const current = createSettings(script)
    current.modelRouter!.profiles.default.textReasoner.apiKey = ''

    const module = await import('./local-runtime-process')
    await expect(module.startLocalRuntimeChild(current)).rejects.toThrow('text reasoner')
    expect(module.isLocalRuntimeChildRunning()).toBe(false)
  })

  it('waits for the explicit local runtime ready marker before resolving', async () => {
    const script = writeScript(
      'ready-child.js',
      [
        "setTimeout(() => {",
        "  process.stdout.write('KUN_READY ' + JSON.stringify({ service: 'kun', mode: 'serve', port: 8899 }) + '\\n')",
        "}, 50)",
        "setInterval(() => {}, 1_000)"
      ].join('\n')
    )
    const module = await import('./local-runtime-process')
    await expect(module.startLocalRuntimeChild(createSettings(script))).resolves.toBeUndefined()
    expect(module.isLocalRuntimeChildRunning()).toBe(true)
    if (!tempRoot) throw new Error('temp root not initialized')
    expect(existsSync(join(tempRoot, 'runtime', 'config.json'))).toBe(true)
    await module.stopLocalRuntimeChildAndWait()
    const logText = await readLocalRuntimeLog()
    expect(logText).toContain('KUN_READY')
    expect(logText).toContain('ready marker received on port 8899')
  })

  it('resolves from /health when the stdout ready marker is delayed', async () => {
    const port = await allocateAvailablePort()
    const script = writeScript(
      'health-child.js',
      [
        "const http = require('node:http')",
        "const portIndex = process.argv.indexOf('--port')",
        "const port = Number(process.argv[portIndex + 1])",
        "const server = http.createServer((req, res) => {",
        "  if (req.url === '/health') {",
        "    res.setHeader('content-type', 'application/json')",
        "    res.end(JSON.stringify({ status: 'ok', service: 'kun', mode: 'serve' }))",
        '    return',
        '  }',
        '  res.statusCode = 404',
        "  res.end('{}')",
        '})',
        "server.listen(port, '127.0.0.1')",
        "setTimeout(() => {",
        "  process.stdout.write('KUN_READY ' + JSON.stringify({ service: 'kun', mode: 'serve', port }) + '\\n')",
        "}, 10_000)",
        "setInterval(() => {}, 1_000)"
      ].join('\n')
    )
    const module = await import('./local-runtime-process')
    await expect(module.startLocalRuntimeChild(createSettings(script, port))).resolves.toBeUndefined()
    expect(module.isLocalRuntimeChildRunning()).toBe(true)
    await module.stopLocalRuntimeChildAndWait()
    const logText = await readLocalRuntimeLog()
    expect(logText).toContain(`health probe confirmed ready on port ${port}`)
  })

  it('coalesces concurrent startup requests into one child process', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const counterPath = join(tempRoot, 'spawn-count.txt')
    const script = writeScript(
      'concurrent-child.js',
      [
        "const fs = require('node:fs')",
        `fs.appendFileSync(${JSON.stringify(counterPath)}, 'x')`,
        "setTimeout(() => {",
        "  process.stdout.write('KUN_READY ' + JSON.stringify({ service: 'kun', mode: 'serve', port: 8899 }) + '\\n')",
        "}, 100)",
        "setInterval(() => {}, 1_000)"
      ].join('\n')
    )
    const module = await import('./local-runtime-process')
    await expect(Promise.all([
      module.startLocalRuntimeChild(createSettings(script)),
      module.startLocalRuntimeChild(createSettings(script))
    ])).resolves.toEqual([undefined, undefined])

    expect(readFileSync(counterPath, 'utf8')).toBe('x')
    await module.stopLocalRuntimeChildAndWait()
  })

  it('notifies when a ready child exits unexpectedly', async () => {
    const script = writeScript(
      'crash-child.js',
      [
        "process.stdout.write('KUN_READY ' + JSON.stringify({ service: 'kun', mode: 'serve', port: 8899 }) + '\\n')",
        "setTimeout(() => {",
        "  process.stderr.write('runtime exploded\\n')",
        '  process.exit(34)',
        '}, 80)'
      ].join('\n')
    )
    const module = await import('./local-runtime-process')
    const unexpectedExit = new Promise<import('./local-runtime-process').LocalRuntimeUnexpectedExitInfo>((resolve) => {
      module.setLocalRuntimeUnexpectedExitHandler(resolve)
    })

    await expect(module.startLocalRuntimeChild(createSettings(script))).resolves.toBeUndefined()
    const info = await unexpectedExit
    expect(info).toMatchObject({ code: 34, signal: null })
    expect(info.stderrTail).toContain('runtime exploded')
    expect(module.isLocalRuntimeChildRunning()).toBe(false)
  })

  it('does not notify unexpected exit handlers for intentional stops', async () => {
    const script = writeScript(
      'intentional-stop-child.js',
      [
        "process.stdout.write('KUN_READY ' + JSON.stringify({ service: 'kun', mode: 'serve', port: 8899 }) + '\\n')",
        "setInterval(() => {}, 1_000)"
      ].join('\n')
    )
    const module = await import('./local-runtime-process')
    const handler = vi.fn()
    module.setLocalRuntimeUnexpectedExitHandler(handler)

    await expect(module.startLocalRuntimeChild(createSettings(script))).resolves.toBeUndefined()
    await module.stopLocalRuntimeChildAndWait()
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects when the child exits before reporting ready', async () => {
    const script = writeScript(
      'exit-child.js',
      [
        "process.stderr.write('bind failed on port 8899\\n')",
        'setTimeout(() => process.exit(23), 20)'
      ].join('\n')
    )
    const module = await import('./local-runtime-process')
    await expect(module.startLocalRuntimeChild(createSettings(script))).rejects.toThrow(
      /SciForge Runtime exited during startup with code 23[\s\S]*bind failed on port 8899/
    )
    expect(module.isLocalRuntimeChildRunning()).toBe(false)
    await module.stopLocalRuntimeChildAndWait()
    const logText = await readLocalRuntimeLog()
    expect(logText).toContain('bind failed on port 8899')
    expect(logText).toContain('exited with code 23')
  })

  it('passes only the local Model Router env to the local runtime', async () => {
    const blockedParentEnv = {
      DEEPSEEK_API_KEY: 'outer-upstream-secret',
      ANTHROPIC_AUTH_TOKEN: 'outer-anthropic-token',
      GEMINI_API_KEY: 'outer-gemini-secret',
      OPENROUTER_API_KEY: 'outer-openrouter-secret',
      TOGETHER_API_KEY: 'outer-together-secret',
      TOGETHER_BASE_URL: 'https://api.together.example/v1',
      FIREWORKS_API_KEY: 'outer-fireworks-secret',
      XAI_API_KEY: 'outer-xai-secret',
      PERPLEXITY_API_KEY: 'outer-perplexity-secret',
      MOONSHOT_API_KEY: 'outer-moonshot-secret',
      ZHIPU_API_KEY: 'outer-zhipu-secret',
      SILICONFLOW_API_KEY: 'outer-siliconflow-secret',
      ARK_API_KEY: 'outer-ark-secret',
      DEEPSEEK_BASE_URL: 'https://direct-provider.example/v1',
      KUN_BASE_URL: 'https://direct-local-runtime-provider.example/v1',
      MODEL_PROVIDER: 'direct-provider',
      EDAG_LLM_BASE_URL: 'https://direct-evidence-dag-provider.example/v1',
      EDAG_LLM_API_KEY: 'outer-evidence-dag-key',
      EDAG_LLM_MODEL: 'outer-evidence-dag-model',
      SCIFORGE_IMAGE_API_KEY: 'outer-image-key',
      SCIFORGE_IMAGE_BASE_URL: 'https://direct-image-provider.example/v1',
      SCIFORGE_IMAGE_MODEL: 'outer-image-model',
      SCIFORGE_IMAGE_ALLOW_PLACEHOLDER: '1',
      SCIFORGE_SCIMODALITY_SERVICE_URL: 'http://127.0.0.1:3898',
      SCIFORGE_SCIMODALITY_SERVICE_TOKEN: 'outer-sci-modality-token',
      SCIFORGE_SCIMODALITY_SERVICE_TIMEOUT_MS: '12345',
      SCIFORGE_MODEL_ROUTER_SCIENTIFIC_TRANSLATOR_TOKEN: 'outer-model-router-scientific-token',
      KUN_MODEL_ROUTER_API_KEY: 'old-router-key',
      KUN_MODEL_ROUTER_BASE_URL: 'http://127.0.0.1:4888/v1',
      KUN_MODEL_ROUTER_MODEL: 'old-router-model',
      MODEL_ROUTER_API_KEY: 'generic-router-key',
      MODEL_ROUTER_RUNTIME_API_KEY: 'generic-runtime-router-key',
      MODEL_ROUTER_BASE_URL: 'http://127.0.0.1:4999/v1',
      MODEL_ROUTER_MODEL: 'generic-router-model',
      EXPERT_PROVIDER_BASE_URL: 'http://127.0.0.1:8001/v1',
      EXPERT_PROVIDER_API_KEY: 'outer-expert-token',
      SCIMODALITY_ROUTER_PORT: '3898',
      SCIMODALITY_ROUTER_RUNTIME_TOKEN: 'outer-router-token'
    }
    const previousParentEnv = Object.fromEntries(
      Object.keys(blockedParentEnv).map((name) => [name, process.env[name]])
    )
    Object.assign(process.env, blockedParentEnv)
    const script = writeScript(
      'env-child.js',
      [
        `const blockedParentEnvNames = ${JSON.stringify(Object.keys(blockedParentEnv))}`,
        'for (const name of blockedParentEnvNames) {',
        '  if (process.env[name] !== undefined) {',
        "    process.stderr.write('leaked parent env ' + name + '=' + String(process.env[name]) + '\\n')",
        '    process.exit(24)',
        '  }',
        '}',
        "if (process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY !== 'local-runtime-router-key') {",
        "  process.stderr.write('unexpected sciforge router key ' + String(process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY) + '\\n')",
        '  process.exit(24)',
        '}',
        "if (process.env.SCIFORGE_MODEL_ROUTER_BASE_URL !== 'http://127.0.0.1:3892/v1') {",
        "  process.stderr.write('unexpected sciforge router base URL ' + String(process.env.SCIFORGE_MODEL_ROUTER_BASE_URL) + '\\n')",
        '  process.exit(24)',
        '}',
        "if (process.env.SCIFORGE_MODEL_ROUTER_MODEL !== 'sciforge-router') {",
        "  process.stderr.write('unexpected sciforge router model ' + String(process.env.SCIFORGE_MODEL_ROUTER_MODEL) + '\\n')",
        '  process.exit(24)',
        '}',
        "process.stdout.write('KUN_READY ' + JSON.stringify({ service: 'kun', mode: 'serve', port: 8899 }) + '\\n')",
        "setInterval(() => {}, 1_000)"
      ].join('\n')
    )
    try {
      const module = await import('./local-runtime-process')
      await expect(module.startLocalRuntimeChild(createSettings(script))).resolves.toBeUndefined()
      await module.stopLocalRuntimeChildAndWait()
    } finally {
      for (const [name, value] of Object.entries(previousParentEnv)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })

  it('fails closed when the Model Router runtime API key is missing', async () => {
    const script = writeScript(
      'unused-child.js',
      [
        "process.stdout.write('KUN_READY ' + JSON.stringify({ service: 'kun', mode: 'serve', port: 8899 }) + '\\n')",
        "setInterval(() => {}, 1_000)"
      ].join('\n')
    )
    const settings = createSettings(script)
    settings.modelRouter = {
      ...defaultModelRouterSettings(),
      ...settings.modelRouter,
      runtimeApiKey: ''
    }
    const module = await import('./local-runtime-process')

    await expect(module.startLocalRuntimeChild(settings)).rejects.toThrow(/Model Router runtime API key is required/)
    expect(module.isLocalRuntimeChildRunning()).toBe(false)
  })
})

describe('reclaimLocalRuntimePort', () => {
  it('reports a port as unavailable when another listener owns it', async () => {
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    try {
      const address = server.address() as AddressInfo
      const module = await import('./local-runtime-process')

      await expect(module.reclaimLocalRuntimePort(address.port)).resolves.toEqual({
        ok: false,
        message: `port ${address.port} is in use`
      })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('allows non-positive ports so the local runtime can request an ephemeral port', async () => {
    const module = await import('./local-runtime-process')

    await expect(module.reclaimLocalRuntimePort(0)).resolves.toEqual({ ok: true })
  })
})

describe('resolveAvailableLocalRuntimePort', () => {
  it('uses the next bindable port after the preferred port is occupied', async () => {
    const preferredPort = await findPortWithAvailableNext()
    const server = await listenOnPort(preferredPort)
    try {
      const module = await import('./local-runtime-process')

      await expect(module.resolveAvailableLocalRuntimePort(preferredPort)).resolves.toEqual({
        port: preferredPort + 1,
        changed: true,
        message: `port ${preferredPort} is in use`
      })
    } finally {
      await closeServer(server)
    }
  })

  it('falls back to an ephemeral port for non-positive preferences', async () => {
    const module = await import('./local-runtime-process')

    const resolved = await module.resolveAvailableLocalRuntimePort(0)
    expect(resolved.changed).toBe(true)
    expect(resolved.port).toBeGreaterThan(0)
  })
})

describe('resolveLocalRuntimeDataDir', () => {
  it('expands Windows-style home-relative data directories', async () => {
    const module = await import('./local-runtime-process')

    expect(module.resolveLocalRuntimeDataDir({ dataDir: '~\\deepseek\\local-runtime' })).toBe(join(homedir(), 'deepseek', 'local-runtime'))
  })

  it('does not expand non-home tilde prefixes', async () => {
    const module = await import('./local-runtime-process')

    expect(module.resolveLocalRuntimeDataDir({ dataDir: '~other\\local-runtime' })).toBe('~other\\local-runtime')
  })
})

describe('syncGuiManagedLocalRuntimeConfig', () => {
  it('creates GUI-managed config with attachments enabled for image paste/upload', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./local-runtime-process')

    await module.syncGuiManagedLocalRuntimeConfig(tempRoot, defaultLocalRuntimeSettings())

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.serve.storage).toMatchObject({ backend: 'hybrid' })
    expect(parsed.serve.tokenEconomy).toMatchObject({
      enabled: false,
      compressToolDescriptions: true,
      compressToolResults: true,
      conciseResponses: true,
      historyHygiene: {
        maxToolResultLines: 320,
        maxToolResultBytes: 32768,
        maxToolResultTokens: 8000,
        maxToolArgumentStringBytes: 8192,
        maxToolArgumentStringTokens: 2000,
        maxArrayItems: 80
      }
    })
    expect(parsed.contextCompaction).toMatchObject({
      defaultSoftThreshold: 16000,
      defaultHardThreshold: 24000,
      summaryMode: 'heuristic'
    })
    expect(parsed.models.profiles['deepseek-v4-pro']).toMatchObject({
      contextWindowTokens: 1_000_000,
      contextCompaction: {
        softThreshold: 980_000,
        hardThreshold: 990_000
      }
    })
    expect(parsed.models.profiles['deepseek-v4-flash']).toMatchObject({
      aliases: [
        'deepseek-chat',
        'deepseek-reasoner',
        DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
      ],
      contextWindowTokens: 1_000_000,
      contextCompaction: {
        softThreshold: 980_000,
        hardThreshold: 990_000
      }
    })
    expect(parsed.runtime.toolStorm).toMatchObject({ enabled: true, windowSize: 8, threshold: 3 })
    expect(parsed.runtime.modelStreamIdleTimeoutMs).toBe(600000)
    expect(parsed.runtime.toolArgumentRepair).toMatchObject({ maxStringBytes: 524288 })
    expect(parsed.capabilities.attachments).toMatchObject({ enabled: true })
    expect(parsed.capabilities.web).toMatchObject({ enabled: true, fetchEnabled: true })
    expect(parsed.capabilities.subagents).toMatchObject({
      enabled: true,
      maxParallel: 2,
      maxChildRuns: 4
    })
    expect(parsed.capabilities.mcp.search).toMatchObject({ enabled: false, mode: 'auto' })
  })

  it('derives local runtime subagent capability config from shared agent settings', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./local-runtime-process')

    await module.syncGuiManagedLocalRuntimeConfig(tempRoot, defaultLocalRuntimeSettings(), {
      agentCapabilities: {
        ...defaultAgentCapabilitySettings(),
        subagents: {
          enabled: false,
          maxParallel: 3,
          maxChildRuns: 7
        }
      }
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.subagents).toMatchObject({
      enabled: false,
      maxParallel: 3,
      maxChildRuns: 4
    })
  })

  it('adds the built-in schedule MCP server to the local runtime capabilities', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./local-runtime-process')
    const settings = createSettings('/tmp/fake-local-runtime-child.js')
    settings.schedule.internal.port = 9788
    settings.schedule.internal.secret = 'top-secret'

    await module.syncGuiManagedLocalRuntimeConfig(tempRoot, defaultLocalRuntimeSettings(), {
      scheduleMcp: {
        settings,
        launch: {
          appPath: '/tmp/sciforge-test-app',
          execPath: '/tmp/electron',
          isPackaged: false
        }
      }
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.mcp.enabled).toBe(true)
    expect(parsed.capabilities.mcp.servers.gui_schedule).toMatchObject({
      enabled: true,
      transport: 'stdio',
      command: '/tmp/electron',
      args: [
        '/tmp/sciforge-test-app/out/main/schedule-mcp-node-entry.js',
        '--gui-schedule-mcp-server',
        '--base-url',
        'http://127.0.0.1:9788'
      ],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        GUI_SCHEDULE_INTERNAL_SECRET: 'top-secret'
      },
      trustScope: 'user'
    })
  })

  it('adds the shared research MCP server to the local runtime capabilities', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./local-runtime-process')

    await module.syncGuiManagedLocalRuntimeConfig(tempRoot, defaultLocalRuntimeSettings(), {
      researchMcp: {
        launch: {
          appPath: '/tmp/sciforge-test-app',
          execPath: '/tmp/electron',
          isPackaged: false
        }
      }
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.mcp.enabled).toBe(true)
    expect(parsed.capabilities.mcp.servers.gui_research).toMatchObject({
      enabled: true,
      transport: 'stdio',
      command: '/tmp/electron',
      args: [
        '/tmp/sciforge-test-app/out/main/research-search-mcp-node-entry.js',
        '--gui-research-mcp-server'
      ],
      env: {
        ELECTRON_RUN_AS_NODE: '1'
      },
      trustScope: 'user',
      timeoutMs: 30000
    })
  })

  it('drops stale GUI-managed MCP servers from existing local runtime config', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      capabilities: {
        mcp: {
          enabled: true,
          servers: {
            gui_research: {
              enabled: true,
              transport: 'stdio',
              command: '/tmp/old-node',
              args: ['/tmp/sciforge-test-app/out/main/research-search-mcp-node-entry.js']
            },
            user_server: {
              enabled: true,
              transport: 'stdio',
              command: 'node',
              args: ['user-server.js'],
              trustScope: 'user'
            }
          }
        }
      }
    }), 'utf8')
    const module = await import('./local-runtime-process')

    await module.syncGuiManagedLocalRuntimeConfig(tempRoot, defaultLocalRuntimeSettings())

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.mcp.servers.user_server).toMatchObject({
      command: 'node',
      args: ['user-server.js']
    })
    expect(parsed.capabilities.mcp.servers.gui_research).toBeUndefined()
  })

  it('adds the shared workflow MCP server to the local runtime capabilities', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./local-runtime-process')
    const settings = {
      ...createSettings('/tmp/fake-local-runtime-child.js'),
      workflow: {
        ...defaultWorkflowSettings(),
        enabled: true,
        webhookPort: 9898,
        webhookSecret: 'workflow-secret'
      }
    }

    await module.syncGuiManagedLocalRuntimeConfig(tempRoot, defaultLocalRuntimeSettings(), {
      workflowMcp: {
        settings,
        launch: {
          appPath: '/tmp/sciforge-test-app',
          execPath: '/tmp/electron',
          isPackaged: false
        }
      }
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.mcp.enabled).toBe(true)
    expect(parsed.capabilities.mcp.servers.gui_workflow).toMatchObject({
      enabled: true,
      transport: 'stdio',
      command: '/tmp/electron',
      args: [
        '/tmp/sciforge-test-app/out/main/workflow-mcp-node-entry.js',
        '--gui-workflow-mcp-server',
        '--base-url',
        'http://127.0.0.1:9898'
      ],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        GUI_WORKFLOW_INTERNAL_SECRET: 'workflow-secret'
      },
      trustScope: 'user',
      timeoutMs: 30000
    })
  })

  it('adds the image generation MCP server to the local runtime capabilities', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./local-runtime-process')
    const modelRouter = configuredModelRouterSettings()
    const settings = {
      ...createSettings('/tmp/fake-local-runtime-child.js'),
      modelRouter: {
        ...modelRouter,
        profiles: {
          default: {
            ...modelRouter.profiles.default,
            imageGenerator: {
              ...modelRouter.profiles.default.imageGenerator,
              baseUrl: 'http://127.0.0.1:4321/v1',
              apiKey: 'test-image-key',
              model: 'test-image-model'
            }
          }
        }
      }
    }

    await module.syncGuiManagedLocalRuntimeConfig(tempRoot, defaultLocalRuntimeSettings(), {
      imageGenerationMcp: {
        settings,
        launch: {
          appPath: '/tmp/sciforge-test-app',
          execPath: '/tmp/electron',
          isPackaged: false
        }
      }
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.mcp.enabled).toBe(true)
    expect(parsed.capabilities.mcp.servers.image_generation).toMatchObject({
      enabled: true,
      transport: 'stdio',
      command: '/tmp/electron',
      args: [
        '/tmp/sciforge-test-app/out/main/image-generation-mcp-node-entry.js',
        '--image-generation-mcp-server',
        '--workspace-root',
        '/tmp/workspace'
      ],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        SCIFORGE_MODEL_ROUTER_BASE_URL: 'http://127.0.0.1:3892/v1',
        SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY: 'local-runtime-router-key',
        SCIFORGE_MODEL_ROUTER_IMAGE_MODEL: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
      },
      trustScope: 'user',
      timeoutMs: 120000
    })
  })

  it('adds the shared workspace intel MCP server to the local runtime capabilities', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./local-runtime-process')
    const settings = {
      ...createSettings('/tmp/fake-local-runtime-child.js'),
      workspaceRoot: '/tmp/workspace-intel-root'
    }

    await module.syncGuiManagedLocalRuntimeConfig(tempRoot, defaultLocalRuntimeSettings(), {
      workspaceIntelMcp: {
        settings,
        launch: {
          appPath: '/tmp/sciforge-test-app',
          execPath: '/tmp/electron',
          isPackaged: false
        }
      }
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.mcp.enabled).toBe(true)
    expect(parsed.capabilities.mcp.servers.gui_workspace_intel).toMatchObject({
      enabled: true,
      transport: 'stdio',
      command: '/tmp/electron',
      args: [
        '/tmp/sciforge-test-app/out/main/workspace-intel-mcp-node-entry.js',
        '--gui-workspace-intel-mcp-server',
        '--include-global-skills'
      ],
      env: {
        ELECTRON_RUN_AS_NODE: '1'
      },
      trustScope: 'user',
      timeoutMs: 30000
    })
  })

  it('adds the first-party remote executor MCP server to the local runtime capabilities', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./local-runtime-process')

    await module.syncGuiManagedLocalRuntimeConfig(tempRoot, defaultLocalRuntimeSettings(), {
      remoteExecutorMcp: {
        launch: {
          appPath: '/tmp/sciforge-test-app',
          execPath: '/tmp/electron',
          isPackaged: false
        }
      }
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.mcp.enabled).toBe(true)
    expect(parsed.capabilities.mcp.servers.remote_executor).toMatchObject({
      enabled: true,
      transport: 'stdio',
      command: '/tmp/electron',
      args: [
        '/tmp/sciforge-test-app/out/main/remote-executor-mcp-node-entry.js',
        '--gui-remote-executor-mcp-server'
      ],
      env: {
        ELECTRON_RUN_AS_NODE: '1'
      },
      trustScope: 'user',
      timeoutMs: 30000
    })
  })

  it('does not add the retired computer-use MCP server to local runtime capabilities', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./local-runtime-process')

    await module.syncGuiManagedLocalRuntimeConfig(tempRoot, defaultLocalRuntimeSettings())

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.mcp.servers.gui_computer_use).toBeUndefined()
  })

  it('passes an allowed GUI-Owl sidecar URL to the local runtime child without adding the retired MCP', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const observedEnvPath = join(tempRoot, 'cua-allowed-child-env.json')
    const script = writeScript(
      'cua-env-guard-child.js',
      [
        "const fs = require('node:fs')",
        `fs.writeFileSync(${JSON.stringify(observedEnvPath)}, JSON.stringify({`,
        "  url: process.env.SCIFORGE_CUA_SERVICE_URL ?? null",
        '}))',
        "process.stdout.write('KUN_READY ' + JSON.stringify({ service: 'kun', mode: 'serve', port: 8899 }) + '\\n')",
        "setInterval(() => {}, 1_000)"
      ].join('\n')
    )
    const module = await import('./local-runtime-process')
    const previousSidecarUrl = process.env.SCIFORGE_CUA_SERVICE_URL
    process.env.SCIFORGE_CUA_SERVICE_URL = 'http://127.0.0.1:3900'

    try {
      const settings = createSettings(script)
      settings.agents.sciforge.dataDir = tempRoot

      await expect(module.startLocalRuntimeChild(settings)).resolves.toBeUndefined()
      await module.stopLocalRuntimeChildAndWait()

      const parsed = JSON.parse(readFileSync(join(tempRoot, 'config.json'), 'utf8')) as any
      expect(parsed.capabilities.mcp.servers.gui_computer_use).toBeUndefined()
      expect(JSON.parse(readFileSync(observedEnvPath, 'utf8'))).toEqual({
        url: 'http://127.0.0.1:3900'
      })
    } finally {
      if (previousSidecarUrl === undefined) delete process.env.SCIFORGE_CUA_SERVICE_URL
      else process.env.SCIFORGE_CUA_SERVICE_URL = previousSidecarUrl
      await module.stopLocalRuntimeChildAndWait()
    }
  })

  it('strips unsafe external computer-use service URLs without falling back to the retired MCP', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const observedEnvPath = join(tempRoot, 'cua-child-env.json')
    const script = writeScript(
      'cua-unsafe-env-child.js',
      [
        "const fs = require('node:fs')",
        `fs.writeFileSync(${JSON.stringify(observedEnvPath)}, JSON.stringify({`,
        "  url: process.env.SCIFORGE_CUA_SERVICE_URL ?? null,",
        "  token: process.env.SCIFORGE_CUA_SERVICE_TOKEN ?? null,",
        "  legacyToken: process.env.CUA_SERVICE_TOKEN ?? null",
        '}))',
        "process.stdout.write('KUN_READY ' + JSON.stringify({ service: 'kun', mode: 'serve', port: 8899 }) + '\\n')",
        "setInterval(() => {}, 1_000)"
      ].join('\n')
    )
    const module = await import('./local-runtime-process')
    const previousSidecarUrl = process.env.SCIFORGE_CUA_SERVICE_URL
    const previousSidecarToken = process.env.SCIFORGE_CUA_SERVICE_TOKEN
    const previousLegacyToken = process.env.CUA_SERVICE_TOKEN
    process.env.SCIFORGE_CUA_SERVICE_URL = 'http://devbox.local:3900'
    process.env.SCIFORGE_CUA_SERVICE_TOKEN = 'unsafe-token'
    process.env.CUA_SERVICE_TOKEN = 'legacy-unsafe-token'

    try {
      const settings = createSettings(script)
      settings.agents.sciforge.dataDir = tempRoot

      await expect(module.startLocalRuntimeChild(settings)).resolves.toBeUndefined()
      await module.stopLocalRuntimeChildAndWait()

      const parsed = JSON.parse(readFileSync(join(tempRoot, 'config.json'), 'utf8')) as any
      expect(parsed.capabilities.mcp.servers.gui_computer_use).toBeUndefined()
      expect(JSON.parse(readFileSync(observedEnvPath, 'utf8'))).toEqual({
        url: null,
        token: null,
        legacyToken: null
      })
    } finally {
      if (previousSidecarUrl === undefined) delete process.env.SCIFORGE_CUA_SERVICE_URL
      else process.env.SCIFORGE_CUA_SERVICE_URL = previousSidecarUrl
      if (previousSidecarToken === undefined) delete process.env.SCIFORGE_CUA_SERVICE_TOKEN
      else process.env.SCIFORGE_CUA_SERVICE_TOKEN = previousSidecarToken
      if (previousLegacyToken === undefined) delete process.env.CUA_SERVICE_TOKEN
      else process.env.CUA_SERVICE_TOKEN = previousLegacyToken
      await module.stopLocalRuntimeChildAndWait()
    }
  })

  it('classifies external computer-use service URLs by loopback and explicit allowlist', async () => {
    const module = await import('./local-runtime-process')

    expect(module.externalComputerUseServiceUrlPolicy({
      SCIFORGE_CUA_SERVICE_URL: 'http://127.0.0.1:3900'
    })).toMatchObject({ configured: true, allowed: true, host: '127.0.0.1' })
    expect(module.externalComputerUseServiceUrlPolicy({
      SCIFORGE_CUA_SERVICE_URL: 'http://[::1]:3900'
    })).toMatchObject({ configured: true, allowed: true, host: '::1' })
    expect(module.externalComputerUseServiceUrlPolicy({
      SCIFORGE_CUA_SERVICE_URL: 'http://devbox.local:3900'
    })).toMatchObject({
      configured: true,
      allowed: false,
      host: 'devbox.local',
      reason: 'non_loopback_without_allowlist'
    })
    expect(module.externalComputerUseServiceUrlPolicy({
      SCIFORGE_CUA_SERVICE_URL: 'http://devbox.local:3900',
      SCIFORGE_CUA_ALLOWED_HOSTS: 'devbox.local'
    })).toMatchObject({ configured: true, allowed: true, host: 'devbox.local' })
  })

  it('keeps the retired computer-use MCP server absent when computer use is turned off', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./local-runtime-process')

    const runtime = defaultLocalRuntimeSettings()
    await module.syncGuiManagedLocalRuntimeConfig(tempRoot, {
      ...runtime,
      mcpSearch: {
        ...runtime.mcpSearch,
        enabled: false
      }
    }, {
      mcpConfigPath: join(tempRoot, 'empty-mcp.json')
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.mcp.enabled).toBeUndefined()
    expect(parsed.capabilities.mcp.servers.gui_computer_use).toBeUndefined()
  })

  it('adds GUI project and configured global skill roots to the local runtime capabilities', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./local-runtime-process')
    const settings = createSettings('/tmp/fake-local-runtime-child.js')
    const workspaceRoot = join(tempRoot, 'workspace')
    const extraRoot = join(tempRoot, 'extra-skills')
    settings.workspaceRoot = workspaceRoot
    settings.remoteChannel.skills.extraDirs = [extraRoot]
    mkdirSync(join(workspaceRoot, '.codex', 'skills'), { recursive: true })

    await module.syncGuiManagedLocalRuntimeConfig(tempRoot, defaultLocalRuntimeSettings(), {
      scheduleMcp: {
        settings,
        launch: {
          appPath: '/tmp/sciforge-test-app',
          execPath: '/tmp/electron',
          isPackaged: false
        }
      }
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.skills.enabled).toBe(true)
    expect(parsed.capabilities.skills).not.toHaveProperty('legacySkillMd')
    expect(parsed.capabilities.skills.roots).toEqual(expect.arrayContaining([
      join(workspaceRoot, '.codex', 'skills'),
      extraRoot
    ]))
  })

  it('writes GUI-managed MCP search settings without removing existing servers', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      legacyTopLevelFlag: true,
      contextCompaction: {
        modelProfiles: {
          'custom-model': {
            contextWindowTokens: 128000
          }
        }
      },
      models: {
        profiles: {
          'user-model': {
            contextWindowTokens: 96000,
            softThreshold: 82000,
            contextCompaction: {
              softThreshold: 86000
            }
          },
          'deepseek-v4-pro': {
            contextCompaction: {
              softThreshold: 970000
            }
          }
        }
      },
      runtime: {
        customRuntimeFlag: true,
        modelStreamIdleTimeoutMs: 180000,
        toolStorm: {
          customStormFlag: 'keep'
        }
      },
      serve: {
        legacyServeFlag: true,
        apiKey: 'sk-legacy-direct-provider',
        baseUrl: 'https://api.deepseek.com/beta',
        endpointFormat: 'chat_completions',
        model: 'deepseek-chat',
        tokenEconomy: {
          customTokenEconomyFlag: 'keep',
          historyHygiene: {
            customHistoryFlag: true
          }
        }
      },
      capabilities: {
        mcp: {
          enabled: true,
          servers: {
            github: {
              transport: 'stdio',
              command: 'github-mcp',
              trustScope: 'user'
            }
          }
        },
        web: {
          enabled: true,
          fetchEnabled: true
        }
      }
    }), 'utf8')
    const module = await import('./local-runtime-process')

    await module.syncGuiManagedLocalRuntimeConfig(tempRoot, {
      ...defaultLocalRuntimeSettings(),
      storage: {
        backend: 'hybrid',
        sqlitePath: '/tmp/local-runtime-index.sqlite3'
      },
      contextCompaction: {
        defaultSoftThreshold: 32000,
        defaultHardThreshold: 64000,
        summaryMode: 'model',
        summaryTimeoutMs: 30000,
        summaryMaxTokens: 1600,
        summaryInputMaxBytes: 131072
      },
      runtimeTuning: {
        toolArgumentRepair: {
          maxStringBytes: 262144
        }
      },
      mcpSearch: {
        enabled: true,
        mode: 'search',
        autoThresholdToolCount: 12,
        topKDefault: 4,
        topKMax: 9,
        minScore: 0.2
      },
      tokenEconomy: {
        enabled: true,
        compressToolDescriptions: false,
        compressToolResults: true,
        conciseResponses: false,
        historyHygiene: {
          maxToolResultLines: 100,
          maxToolResultBytes: 16384,
          maxToolResultTokens: 4000,
          maxToolArgumentStringBytes: 4096,
          maxToolArgumentStringTokens: 1000,
          maxArrayItems: 40
        }
      }
    }, {
      runtimeGuards: {
        ...defaultRuntimeGuardSettings(),
        toolStorm: {
          enabled: false,
          windowSize: 12,
          threshold: 4
        }
      }
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(LocalRuntimeConfigSchema.safeParse(parsed).success).toBe(true)
    expect(parsed.legacyTopLevelFlag).toBeUndefined()
    expect(parsed.serve.legacyServeFlag).toBeUndefined()
    expect(parsed.serve.apiKey).toBeUndefined()
    expect(parsed.serve.baseUrl).toBeUndefined()
    expect(parsed.serve.endpointFormat).toBeUndefined()
    expect(parsed.serve.model).toBeUndefined()
    expect(parsed.serve.storage).toMatchObject({
      backend: 'hybrid',
      sqlitePath: '/tmp/local-runtime-index.sqlite3'
    })
    expect(parsed.serve.tokenEconomy).toMatchObject({
      enabled: true,
      compressToolDescriptions: false,
      compressToolResults: true,
      conciseResponses: false,
      historyHygiene: {
        maxToolResultLines: 100,
        maxToolResultBytes: 16384,
        maxToolResultTokens: 4000,
        maxToolArgumentStringBytes: 4096,
        maxToolArgumentStringTokens: 1000,
        maxArrayItems: 40
      }
    })
    expect(parsed.serve.tokenEconomy.customTokenEconomyFlag).toBeUndefined()
    expect(parsed.serve.tokenEconomy.historyHygiene.customHistoryFlag).toBeUndefined()
    expect(parsed.contextCompaction).toMatchObject({
      defaultSoftThreshold: 32000,
      defaultHardThreshold: 64000,
      summaryMode: 'model',
      summaryTimeoutMs: 30000,
      summaryMaxTokens: 1600,
      summaryInputMaxBytes: 131072
    })
    expect(parsed.contextCompaction.modelProfiles).toBeUndefined()
    expect(parsed.models.profiles['user-model']).toMatchObject({
      contextWindowTokens: 96000,
      contextCompaction: {
        softThreshold: 86000
      }
    })
    expect(parsed.models.profiles['user-model'].softThreshold).toBeUndefined()
    expect(parsed.models.profiles['deepseek-v4-pro']).toMatchObject({
      contextWindowTokens: 1_000_000,
      contextCompaction: {
        softThreshold: 970_000,
        hardThreshold: 990_000
      }
    })
    expect(parsed.runtime.toolStorm).toMatchObject({
      enabled: false,
      windowSize: 12,
      threshold: 4
    })
    expect(parsed.runtime.toolStorm.customStormFlag).toBeUndefined()
    expect(parsed.runtime.customRuntimeFlag).toBeUndefined()
    expect(parsed.runtime.modelStreamIdleTimeoutMs).toBe(180000)
    expect(parsed.runtime.toolArgumentRepair).toMatchObject({ maxStringBytes: 262144 })
    expect(parsed.capabilities.attachments).toMatchObject({ enabled: true })
    expect(parsed.capabilities.subagents).toMatchObject({
      enabled: true,
      maxParallel: 2,
      maxChildRuns: 4
    })
    expect(parsed.capabilities.mcp.servers.github.command).toBe('github-mcp')
    expect(parsed.capabilities.web.fetchEnabled).toBe(true)
    expect(parsed.capabilities.mcp.search).toMatchObject({
      enabled: true,
      mode: 'search',
      autoThresholdToolCount: 12,
      topKDefault: 4,
      topKMax: 9,
      minScore: 0.2
    })
  })

  it('imports GUI-managed MCP servers into runtime capabilities', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const mcpConfigPath = join(tempRoot, 'mcp.json')
    writeFileSync(mcpConfigPath, JSON.stringify({
      servers: {
        'stata-mcp': {
          command: 'uvx',
          args: ['stata-mcp'],
          env: {
            STATA_CLI: 'D:\\stata\\StataMP-64.exe'
          },
          enabled: true,
          disabled: false
        },
        'docs-mcp': {
          url: 'https://mcp.example.test/mcp',
          headers: {
            Authorization: 'Bearer docs-token'
          }
        }
      }
    }), 'utf8')
    const module = await import('./local-runtime-process')

    await module.syncGuiManagedLocalRuntimeConfig(tempRoot, defaultLocalRuntimeSettings(), {
      mcpConfigPath
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.mcp.enabled).toBe(true)
    expect(parsed.capabilities.mcp.servers['stata-mcp']).toMatchObject({
      enabled: true,
      transport: 'stdio',
      command: 'uvx',
      args: ['stata-mcp'],
      env: {
        STATA_CLI: 'D:\\stata\\StataMP-64.exe'
      },
      trustScope: 'user'
    })
    expect(parsed.capabilities.mcp.servers['docs-mcp']).toMatchObject({
      enabled: true,
      transport: 'streamable-http',
      url: 'https://mcp.example.test/mcp',
      headers: {
        Authorization: 'Bearer docs-token'
      },
      trustScope: 'user'
    })
  })

  it('replaces unparsable historical local runtime config with a valid GUI-managed config', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    writeFileSync(configPath, '{ legacy config', 'utf8')
    const module = await import('./local-runtime-process')

    await module.syncGuiManagedLocalRuntimeConfig(tempRoot, defaultLocalRuntimeSettings())

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown
    expect(LocalRuntimeConfigSchema.safeParse(parsed).success).toBe(true)
  })

  it('does not enable MCP when the capability is explicitly disabled', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      capabilities: {
        mcp: {
          enabled: false
        }
      }
    }), 'utf8')
    const module = await import('./local-runtime-process')

    await module.syncGuiManagedLocalRuntimeConfig(tempRoot, defaultLocalRuntimeSettings(), {
      scheduleMcp: {
        settings: createSettings('/tmp/fake-local-runtime-child.js'),
        launch: {
          appPath: '/tmp/sciforge-test-app',
          execPath: '/tmp/electron',
          isPackaged: false
        }
      }
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.mcp.enabled).toBe(false)
    expect(parsed.capabilities.mcp.servers.gui_schedule).toMatchObject({
      transport: 'stdio',
      command: '/tmp/electron',
      args: [
        '/tmp/sciforge-test-app/out/main/schedule-mcp-node-entry.js',
        '--gui-schedule-mcp-server',
        '--base-url',
        'http://127.0.0.1:8788'
      ],
      env: {
        ELECTRON_RUN_AS_NODE: '1'
      }
    })
  })

  it('does not override an explicitly disabled attachment capability', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      capabilities: {
        attachments: {
          enabled: false,
          maxImageBytes: 1024
        }
      }
    }), 'utf8')
    const module = await import('./local-runtime-process')

    await module.syncGuiManagedLocalRuntimeConfig(tempRoot, defaultLocalRuntimeSettings())

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.attachments).toMatchObject({
      enabled: false,
      maxImageBytes: 1024
    })
  })

  it('does not override explicitly disabled web fetch capability', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      capabilities: {
        web: {
          enabled: false,
          fetchEnabled: false,
          searchEnabled: true,
          provider: 'custom-search'
        }
      }
    }), 'utf8')
    const module = await import('./local-runtime-process')

    await module.syncGuiManagedLocalRuntimeConfig(tempRoot, defaultLocalRuntimeSettings())

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.web).toMatchObject({
      enabled: false,
      fetchEnabled: false,
      searchEnabled: true,
      provider: 'custom-search'
    })
  })
})
