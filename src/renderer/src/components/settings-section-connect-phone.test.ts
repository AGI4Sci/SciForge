import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '@shared/app-settings'
import { ConnectPhoneSettingsSection, discordGuardOwnerPatch } from './settings-section-connect-phone'

const labels: Record<string, string> = {
  connectPhoneRuntime: 'Phone connection',
  connectPhoneEnabled: 'Enable phone connection',
  connectPhoneEnabledDesc: 'Enable phone connection description',
  connectPhoneDefaultWorkspace: 'Default phone workspace',
  connectPhoneDefaultWorkspaceDesc: 'Default phone workspace description',
  connectPhoneDefaultWorkspacePlaceholder: 'Inherit {{path}}',
  connectPhoneDefaultWorkspaceReset: 'Use GUI default',
  browse: 'Browse',
  connectPhoneManageAgents: 'Connected phone agents',
  connectPhoneManageAgentsEmpty: 'No phone agents',
  connectPhoneManageAgentMeta: '{{provider}} {{model}} {{workspace}}',
  connectPhoneDiscordChannelMeta: '{{server}} {{channel}}',
  connectPhoneDiscordLocalOnlineGuard: 'Guards this channel only while this computer is online.',
  connectPhoneDiscordGuardConflictState: 'Conflict',
  connectPhoneDiscordGuardConflictTitle: 'This Bot is being guarded by another device',
  connectPhoneDiscordGuardConflictDesc: 'Owner installation: {{owner}}.',
  connectPhoneDiscordGuardTakeover: 'Take over manually',
  connectPhoneManageAgentEnabled: 'Enabled',
  connectPhoneManageAgentDisabled: 'Disabled',
  connectPhoneManageAgentName: 'Agent name',
  connectPhoneManageAgentNamePlaceholder: 'Agent name placeholder',
  connectPhoneAgentModel: 'Model',
  connectPhoneWorkspaceOverride: 'Workspace override',
  connectPhoneWorkspaceInherit: 'Use default workspace: {{path}}',
  connectPhoneManageAgentDescription: 'Short description',
  connectPhoneManageAgentDescriptionPlaceholder: 'Short description placeholder',
  connectPhoneManageAgentIdentity: 'Role definition',
  connectPhoneManageAgentIdentityPlaceholder: 'Role definition placeholder',
  connectPhoneManageAgentPersonality: 'Personality',
  connectPhoneManageAgentPersonalityPlaceholder: 'Personality placeholder',
  connectPhoneManageAgentUserContext: 'User context',
  connectPhoneManageAgentUserContextPlaceholder: 'User context placeholder',
  connectPhoneManageAgentReplyRules: 'Reply rules',
  connectPhoneManageAgentReplyRulesPlaceholder: 'Reply rules placeholder'
}

function t(key: string, values?: Record<string, unknown>): string {
  let label = labels[key] ?? key
  for (const [name, value] of Object.entries(values ?? {})) {
    label = label.replace(`{{${name}}}`, String(value))
  }
  return label
}

function buildSettings(): AppSettingsV1 {
  const settings: AppSettingsV1 = {
    version: 1,
    installationId: 'sciforge-local',
    locale: 'en',
    theme: 'system',
    uiFontScale: 'medium',
    modelRouter: defaultModelRouterSettings(),
    agents: { sciforge: defaultLocalRuntimeSettings() },
    workspaceRoot: '/tmp/workspace',
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
  settings.remoteChannel.enabled = true
  settings.remoteChannel.im.workspaceRoot = '/tmp/phone-workspace'
  settings.remoteChannel.channels = [
    {
      id: 'channel_1',
      provider: 'feishu',
      label: 'Team helper',
      enabled: true,
      model: 'auto',
      agentThreadIds: { sciforge: 'thr_1' },
      workspaceRoot: '',
      agentProfile: {
        name: 'Team helper',
        description: 'Handles team chat requests',
        identity: 'You are the project assistant.',
        personality: 'Concise and practical.',
        userContext: 'The user coordinates product and engineering.',
        replyRules: 'Start with the conclusion.'
      },
      conversations: [],
      createdAt: '2026-06-03T00:00:00.000Z',
      updatedAt: '2026-06-03T00:00:00.000Z'
    }
  ]
  return settings
}

describe('ConnectPhoneSettingsSection', () => {
  it('renders connected phone agent management fields', () => {
    const html = renderToStaticMarkup(
      createElement(ConnectPhoneSettingsSection, {
        ctx: {
          t,
          form: buildSettings(),
          update: vi.fn(),
          selectControlClass: 'select-control',
          pickConnectPhoneWorkspace: async () => undefined,
          resetConnectPhoneWorkspaceToDefault: () => undefined,
          connectPhoneWorkspacePickerError: null
        }
      })
    )

    expect(html).toContain('Connected phone agents')
    expect(html).toContain('Team helper')
    expect(html).toContain('Role definition')
    expect(html).toContain('You are the project assistant.')
    expect(html).toContain('Personality')
    expect(html).toContain('Reply rules')
    expect(html).toContain('Start with the conclusion.')
    expect(html).toContain('<option value="deepseek-v4-pro"')
  })

  it('surfaces Discord local-online guard state and takeover placeholder', () => {
    const form = buildSettings()
    form.remoteChannel.channels = [
      {
        id: 'discord-1',
        provider: 'discord',
        label: '#support',
        enabled: true,
        model: 'deepseek-v4-flash',
        workspaceRoot: '/tmp/support',
        agentProfile: {
          name: 'Support bot',
          description: '',
          identity: '',
          personality: '',
          userContext: '',
          replyRules: ''
        },
        platformCredential: {
          kind: 'discord',
          applicationId: 'client-1',
          botId: 'bot-1',
          botUsername: 'SciForge Bot',
          guildId: 'guild-1',
          guildName: 'Support server',
          channelId: 'channel-1',
          channelName: 'support',
          installationId: 'sciforge-other',
          guardOwnerInstallationId: 'sciforge-other',
          guardOwnerUpdatedAt: '2026-06-03T00:00:00.000Z',
          createdAt: '2026-06-03T00:00:00.000Z'
        },
        conversations: [],
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z'
      }
    ]

    const html = renderToStaticMarkup(
      createElement(ConnectPhoneSettingsSection, {
        ctx: {
          t,
          form,
          update: vi.fn(),
          selectControlClass: 'select-control',
          pickConnectPhoneWorkspace: async () => undefined,
          resetConnectPhoneWorkspaceToDefault: () => undefined,
          connectPhoneWorkspacePickerError: null
        }
      })
    )

    expect(html).toContain('Support server #support')
    expect(html).toContain('Guards this channel only while this computer is online.')
    expect(html).toContain('This Bot is being guarded by another device')
    expect(html).toContain('Take over manually')
  })

  it('enables all Discord channel messages when restoring local guard ownership', () => {
    const form = buildSettings()
    form.remoteChannel.channels = [
      {
        id: 'discord-1',
        provider: 'discord',
        label: '#support',
        enabled: false,
        guardMode: 'only_mention',
        model: 'deepseek-v4-flash',
        workspaceRoot: '/tmp/support',
        agentProfile: {
          name: 'Support bot',
          description: '',
          identity: '',
          personality: '',
          userContext: '',
          replyRules: ''
        },
        platformCredential: {
          kind: 'discord',
          applicationId: 'client-1',
          botId: 'bot-1',
          botUsername: 'SciForge Bot',
          guildId: 'guild-1',
          guildName: 'Support server',
          channelId: 'channel-1',
          channelName: 'support',
          installationId: 'sciforge-local',
          createdAt: '2026-06-03T00:00:00.000Z'
        },
        conversations: [],
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z'
      }
    ]

    expect(discordGuardOwnerPatch(form, form.remoteChannel.channels[0], true)).toMatchObject({
      enabled: true,
      guardMode: 'all_messages',
      platformCredential: {
          guardOwnerInstallationId: 'sciforge-local'
      }
    })
  })
})
