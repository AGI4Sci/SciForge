import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildScheduleLocalRuntimeMcpServerConfig,
  buildScheduleMcpServerConfig,
  buildSyncedScheduleMcpJson,
  resolveLocalRuntimeMcpJsonPath,
  resolveScheduleMcpCommand,
  resolveScheduleMcpNodeEntryPath,
  scheduleMcpEnabledTools,
  scheduleMcpSettingsChanged,
  syncScheduleMcpConfig,
  type ScheduleMcpLaunchConfig
} from './schedule-mcp-config'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import { SCHEDULE_TOOL_SIDE_EFFECTS } from '../../packages/workers/schedule/src/contract'

function createSettings(patch: Partial<AppSettingsV1['schedule']['internal']> = {}): AppSettingsV1 {
  const remoteChannel = defaultRemoteChannelSettings()
  const schedule = defaultScheduleSettings()
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    agents: {
      sciforge: defaultLocalRuntimeSettings()
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
    schedule: {
      ...schedule,
      internal: {
        ...schedule.internal,
        ...patch
      }
    },
    workflow: defaultWorkflowSettings(),
    guiUpdate: {
      channel: 'stable'
    },
    codePromptPrefix: '',
    remoteChannel: {
      ...remoteChannel,
      enabled: true,
      im: {
        ...remoteChannel.im,
        enabled: true,
        port: 8787,
        secret: ''
      }
    },
    connectPhone: defaultConnectPhoneSettings()
  }
}

const launch: ScheduleMcpLaunchConfig = {
  appPath: '/Applications/SciForge.app',
  execPath: '/Applications/SciForge.app/Contents/MacOS/SciForge',
  isPackaged: false
}

describe('schedule MCP config', () => {
  it('uses SciForge MCP JSON by default', () => {
    expect(resolveLocalRuntimeMcpJsonPath()).toBe(join(homedir(), '.sciforge', 'mcp.json'))
  })

  it('builds the managed gui_schedule server config with the internal secret in env only', () => {
    const settings = createSettings({ port: 9787, secret: 'top-secret' })
    const server = buildScheduleMcpServerConfig(settings, launch)
    const localRuntimeServer = buildScheduleLocalRuntimeMcpServerConfig(settings, launch)

    expect(server).toMatchObject({
      command: resolveScheduleMcpCommand(launch),
      args: [
        resolveScheduleMcpNodeEntryPath(launch),
        '--gui-schedule-mcp-server',
        '--base-url',
        'http://127.0.0.1:9787'
      ],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        GUI_SCHEDULE_INTERNAL_SECRET: 'top-secret'
      },
      url: null,
      enabled: true,
      enabled_tools: Object.keys(SCHEDULE_TOOL_SIDE_EFFECTS)
    })
    expect(localRuntimeServer).toMatchObject({
      transport: 'stdio',
      trustScope: 'user',
      timeoutMs: 5000,
      command: resolveScheduleMcpCommand(launch),
      args: [
        resolveScheduleMcpNodeEntryPath(launch),
        '--gui-schedule-mcp-server',
        '--base-url',
        'http://127.0.0.1:9787'
      ],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        GUI_SCHEDULE_INTERNAL_SECRET: 'top-secret'
      },
      enabled: true
    })
    expect(JSON.stringify(server)).not.toContain('--secret')
    expect(JSON.stringify(localRuntimeServer)).not.toContain('--secret')
    expect(scheduleMcpEnabledTools()).toEqual(Object.keys(SCHEDULE_TOOL_SIDE_EFFECTS))
  })

  it('strips only the managed gui_schedule server from external local runtime MCP JSON', () => {
    const synced = buildSyncedScheduleMcpJson(
      {
        timeouts: { connect_timeout: 1 },
        servers: {
          context7: {
            command: 'npx',
            args: ['-y', '@upstash/context7-mcp'],
            env: {},
            url: null
          },
          gui_schedule: {
            command: 'old-gui'
          }
        }
      },
      createSettings({ port: 9787, secret: 'top-secret' }),
      launch
    )

    expect(synced.servers).toEqual({
      context7: {
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp'],
        env: {},
        url: null
      }
    })
    expect(JSON.stringify(synced)).not.toContain('top-secret')
    expect(synced.timeouts).toEqual({ connect_timeout: 1 })
  })

  it('uses the macOS Electron helper for real app bundle paths', () => {
    expect(resolveScheduleMcpCommand(launch, 'darwin')).toBe(
      '/Applications/SciForge.app/Contents/Frameworks/SciForge Helper.app/Contents/MacOS/SciForge Helper'
    )
    expect(resolveScheduleMcpCommand({
      appPath: '/tmp/sciforge-test-app',
      execPath: '/tmp/electron',
      isPackaged: false
    }, 'darwin')).toBe('/tmp/electron')
  })

  it('syncs external mcp.json without writing built-in schedule server config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-mcp-'))
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
          gui_schedule: {
            command: 'old-gui'
          }
        }
      }),
      'utf8'
    )

    await syncScheduleMcpConfig(createSettings(), launch, { mcpJsonPath })

    const json = JSON.parse(await readFile(mcpJsonPath, 'utf8')) as Record<string, unknown>

    expect(json).toMatchObject({
      servers: {
        existing: {
          command: '/bin/echo'
        }
      }
    })
    expect((json.servers as Record<string, unknown>).gui_schedule).toBeUndefined()
  })

  it('requests a runtime restart when the MCP launch arguments change', () => {
    expect(scheduleMcpSettingsChanged(createSettings(), createSettings())).toBe(false)
    expect(scheduleMcpSettingsChanged(createSettings(), createSettings({ port: 9876 }))).toBe(true)
    expect(scheduleMcpSettingsChanged(createSettings(), createSettings({ secret: 'abc' }))).toBe(true)
  })
})
