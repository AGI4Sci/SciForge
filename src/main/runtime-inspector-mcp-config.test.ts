import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildSyncedRuntimeInspectorMcpJson,
  GUI_RUNTIME_INSPECTOR_MCP_SERVER_NAME,
  runtimeInspectorMcpEnabledTools,
  runtimeInspectorMcpEnv,
  syncRuntimeInspectorMcpConfig,
  type RuntimeInspectorMcpLaunchConfig
} from './runtime-inspector-mcp-config'
import {
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultSkillsSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import { RuntimeInspectorToolNames } from '../../packages/workers/runtime-inspector/src/contract'

const launch: RuntimeInspectorMcpLaunchConfig = {
  appPath: '/Applications/SciForge.app',
  execPath: '/Applications/SciForge.app/Contents/MacOS/SciForge',
  isPackaged: false
}

function createSettings(): AppSettingsV1 {
  const sciforge = defaultLocalRuntimeSettings(9876)
  const modelRouter = defaultModelRouterSettings()
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    modelRouter: {
      ...modelRouter,
      baseUrl: 'http://127.0.0.1:4567/v1'
    },
    agents: {
      sciforge
    },
    workspaceRoot: '/tmp/workspace',
    log: {
      enabled: true,
      retentionDays: 2
    },
    notifications: {
      turnComplete: true
    },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: {
      channel: 'stable'
    },
    codePromptPrefix: '',
    skills: defaultSkillsSettings()
  }
}

describe('runtime inspector MCP config', () => {
  it('derives enabled tools from the worker contract', () => {
    expect(runtimeInspectorMcpEnabledTools()).toEqual([...RuntimeInspectorToolNames])
  })

  it('removes GUI-managed runtime inspector servers from external local runtime mcp.json', () => {
    const settings = createSettings()
    const synced = buildSyncedRuntimeInspectorMcpJson(
      {
        timeouts: { connect_timeout: 1 },
        servers: {
          context7: {
            command: 'npx',
            args: ['-y', '@upstash/context7-mcp'],
            env: {},
            url: null
          },
          [GUI_RUNTIME_INSPECTOR_MCP_SERVER_NAME]: {
            command: 'old',
            env: {
              GUI_RUNTIME_TOKEN: 'do-not-persist',
              SCIFORGE_RUNTIME_INSPECTOR_RUNTIME_TOKEN: 'do-not-persist',
              PATH: '/usr/bin'
            }
          }
        }
      },
      settings,
      launch
    )

    expect(synced.servers).toMatchObject({
      context7: {
        command: 'npx'
      }
    })
    expect(JSON.stringify(synced.servers)).not.toContain('do-not-persist')
    expect((synced.servers as Record<string, unknown>)[GUI_RUNTIME_INSPECTOR_MCP_SERVER_NAME]).toBeUndefined()
    expect(synced.timeouts).toEqual({ connect_timeout: 1 })
  })

  it('preserves only allowlisted non-secret env while forcing Electron node mode', () => {
    expect(runtimeInspectorMcpEnv({
      CUSTOM_ENV: 'drop',
      GUI_RUNTIME_TOKEN: 'drop',
      SCIFORGE_RUNTIME_INSPECTOR_RUNTIME_TOKEN: 'drop',
      SCIFORGE_RUNTIME_INSPECTOR_TIMEOUT_MS: '1234',
      PATH: '/usr/local/bin',
      ELECTRON_RUN_AS_NODE: '0'
    })).toEqual({
      SCIFORGE_RUNTIME_INSPECTOR_TIMEOUT_MS: '1234',
      PATH: '/usr/local/bin',
      ELECTRON_RUN_AS_NODE: '1'
    })
  })

  it('syncs mcp.json on disk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-runtime-inspector-mcp-'))
    const runtimeDir = join(root, '.sciforge')
    const mcpJsonPath = join(runtimeDir, 'mcp.json')
    await mkdir(runtimeDir, { recursive: true })
    await writeFile(
      mcpJsonPath,
      JSON.stringify({
        servers: {
        existing: {
          command: '/bin/echo',
          args: ['ok'],
          env: {},
          url: null
        },
        [GUI_RUNTIME_INSPECTOR_MCP_SERVER_NAME]: {
          command: 'old-gui-managed'
        }
      }
    }),
      'utf8'
    )

    await syncRuntimeInspectorMcpConfig(createSettings(), launch, { mcpJsonPath })

    const json = JSON.parse(await readFile(mcpJsonPath, 'utf8')) as Record<string, unknown>
    expect(json).toMatchObject({
      servers: {
        existing: {
          command: '/bin/echo'
        }
      }
    })
    expect((json.servers as Record<string, unknown>)[GUI_RUNTIME_INSPECTOR_MCP_SERVER_NAME]).toBeUndefined()
  })
})
