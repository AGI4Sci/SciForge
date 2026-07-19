import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_CODEX_DATA_DIR,
  defaultAgentCapabilitySettings,
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultClaudeRuntimeSettings,
  defaultCodexRuntimeSettings,
  defaultComputerUseSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultRuntimeGuardSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  getCodexRuntimeSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import { localRuntimeAdapter } from './runtime/local-runtime-adapter'
import { JsonSettingsStore } from './settings-store'

describe('Local runtime single-agent regression', () => {
  it('local runtime adapter reports base url and id', () => {
    const settings: AppSettingsV1 = {
      version: 1,
      installationId: 'test-installation',
      locale: 'en',
      theme: 'system',
      uiFontScale: 'small',
      modelRouter: defaultModelRouterSettings(),
      agentCapabilities: defaultAgentCapabilitySettings(),
      computerUse: defaultComputerUseSettings(),
      runtimeGuards: defaultRuntimeGuardSettings(),
      activeAgentRuntime: 'sciforge',
      agents: {
        sciforge: defaultLocalRuntimeSettings(9000),
        codex: defaultCodexRuntimeSettings(),
        claude: defaultClaudeRuntimeSettings()
      },
      workspaceRoot: '/tmp',
      log: { enabled: true, retentionDays: 7 },
      notifications: { turnComplete: true },
      appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
      keyboardShortcuts: defaultKeyboardShortcuts(),
      write: defaultWriteSettings(),
      remoteChannel: defaultRemoteChannelSettings(),
    connectPhone: defaultConnectPhoneSettings(),
      schedule: defaultScheduleSettings(),
      workflow: defaultWorkflowSettings(),
      guiUpdate: { channel: 'stable' },
      codePromptPrefix: ''
    }

    expect(localRuntimeAdapter.id).toBe('sciforge')
    expect(localRuntimeAdapter.getBaseUrl(settings)).toBe('http://127.0.0.1:9000')
  })

  it('JsonSettingsStore saves current local runtime plus Codex defaults', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))
    await writeFile(
      join(userDataDir, 'sciforge-settings.json'),
      JSON.stringify({
        version: 1,
        agents: {
          sciforge: {
            port: 8787
          }
        }
      }),
      'utf-8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.activeAgentRuntime).toBe('sciforge')
    expect(loaded.agents.sciforge).toEqual(expect.objectContaining({ port: 8787 }))
    expect(getCodexRuntimeSettings(loaded).codexHome).toBe(DEFAULT_CODEX_DATA_DIR)
    await rm(userDataDir, { recursive: true, force: true })
  })
})
