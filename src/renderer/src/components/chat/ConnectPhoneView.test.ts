import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RemoteChannelV1 } from '@shared/app-settings'
import i18n from '../../i18n'
import {
  ConnectPhoneDialog,
  DiscordBotSetupPanel,
  ConnectPhoneSidebarPanel,
  connectPhoneInstallRequestOptions,
  connectPhoneProviderForTarget,
  createConnectPhoneAgentProfile,
  createConnectPhoneChannelOptions,
  createConnectPhoneCredential,
  connectPhoneRecentMessageLabel,
  connectPhoneWorkspaceLabel,
  formatConnectPhoneUserCode,
  hasConnectPhoneChannel,
  hasEnabledConnectPhoneChannel,
  latestConnectPhoneRecentMessage,
  resolveConnectPhoneWorkspaceRoot
} from './ConnectPhoneView'

function channel(enabled: boolean, provider: RemoteChannelV1['provider'] = 'feishu'): RemoteChannelV1 {
  return {
    id: `${provider}-${enabled ? 'enabled' : 'disabled'}`,
    provider,
    label: enabled ? 'Enabled' : 'Disabled',
    enabled,
    model: 'auto',
    workspaceRoot: '',
    agentProfile: {
      name: 'SciForge',
      description: '',
      identity: '',
      personality: '',
      userContext: '',
      replyRules: ''
    },
    conversations: [],
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z'
  }
}

describe('ConnectPhoneView', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('maps scan targets to the matching install API provider', () => {
    expect(connectPhoneProviderForTarget('feishu')).toBe('feishu')
    expect(connectPhoneProviderForTarget('lark')).toBe('feishu')
    expect(connectPhoneProviderForTarget('weixin')).toBe('weixin')
    expect(connectPhoneInstallRequestOptions('feishu')).toEqual({
      provider: 'feishu',
      options: { isLark: false }
    })
    expect(connectPhoneInstallRequestOptions('lark')).toEqual({
      provider: 'feishu',
      options: { isLark: true }
    })
    expect(connectPhoneInstallRequestOptions('weixin')).toEqual({
      provider: 'weixin'
    })
  })

  it('formats the official user code instead of the opaque device code', () => {
    expect(formatConnectPhoneUserCode('YWAZ-ZZ8P', 'v1:opaque-device-code')).toBe('YWAZ-ZZ8P')
    expect(formatConnectPhoneUserCode('', 'abcd1234-rest-of-token')).toBe('ABCD-1234')
  })

  it('builds the default local runtime channel payload after a successful scan', () => {
    expect(createConnectPhoneAgentProfile()).toEqual({
      name: 'SciForge',
      description: '',
      identity: '',
      personality: '',
      userContext: '',
      replyRules: ''
    })
    expect(createConnectPhoneChannelOptions()).toEqual({
      model: 'auto',
      enabled: true,
      im: {
        enabled: true,
        provider: 'feishu'
      }
    })
    expect(createConnectPhoneChannelOptions('weixin')).toEqual({
      model: 'auto',
      enabled: true,
      im: {
        enabled: true,
        provider: 'weixin'
      }
    })
    expect(createConnectPhoneChannelOptions('weixin', ' /repo/app ')).toEqual({
      model: 'auto',
      enabled: true,
      workspaceRoot: '/repo/app',
      im: {
        enabled: true,
        provider: 'weixin'
      }
    })
    expect(
      createConnectPhoneCredential(
        {
          done: true,
          kind: 'feishu',
          appId: 'cli_a',
          appSecret: 'secret',
          domain: 'lark'
        },
        '2026-06-03T01:02:03.000Z'
      )
    ).toEqual({
      kind: 'feishu',
      appId: 'cli_a',
      appSecret: 'secret',
      domain: 'lark',
      createdAt: '2026-06-03T01:02:03.000Z'
    })
    expect(
      createConnectPhoneCredential(
        {
          done: true,
          kind: 'weixin',
          accountId: 'wx_account',
          sessionKey: 'session-key'
        },
        '2026-06-03T01:02:03.000Z'
      )
    ).toEqual({
      kind: 'weixin',
      accountId: 'wx_account',
      sessionKey: 'session-key',
      createdAt: '2026-06-03T01:02:03.000Z'
    })
  })

  it('uses one workspace rule for phone and Discord bindings', () => {
    const legacyClawWorkspaceRoot = '/Users/zxy/.sciforge/claw/discord/server/channel'

    expect(resolveConnectPhoneWorkspaceRoot('', '/repo/current')).toBe('/repo/current')
    expect(resolveConnectPhoneWorkspaceRoot('/repo/custom', '/repo/current')).toBe('/repo/custom')
    expect(
      resolveConnectPhoneWorkspaceRoot(
        '/Users/zxy/.sciforge/remote-channel/discord/server/channel',
        '/repo/current'
      )
    ).toBe('/repo/current')
    expect(
      connectPhoneWorkspaceLabel(
        '/Users/zxy/.sciforge/remote-channel/discord/server/channel',
        'default workspace'
      )
    ).toBe('default workspace')
    expect(resolveConnectPhoneWorkspaceRoot(legacyClawWorkspaceRoot, '/repo/current')).toBe(
      legacyClawWorkspaceRoot
    )
    expect(
      connectPhoneWorkspaceLabel(
        legacyClawWorkspaceRoot,
        'default workspace'
      )
    ).toBe('channel')
    expect(connectPhoneWorkspaceLabel('/repo/SciForge', 'default workspace')).toBe('SciForge')
  })

  it('uses the latest remote message as the Discord channel activity label', () => {
    const recentChannel: RemoteChannelV1 = {
      ...channel(true, 'discord'),
      recentMessages: [
        {
          provider: 'discord',
          channelId: 'discord-channel',
          messageId: 'message-1',
          chatId: 'channel-1',
          remoteThreadId: '',
          senderName: 'Alice',
          text: 'Q1',
          receivedAt: '2026-06-13T01:00:00.000Z'
        },
        {
          provider: 'discord',
          channelId: 'discord-channel',
          messageId: 'message-2',
          chatId: 'channel-1',
          remoteThreadId: '',
          senderName: 'Alice',
          text: 'Q2',
          receivedAt: '2026-06-13T01:01:00.000Z'
        }
      ]
    }

    const latest = latestConnectPhoneRecentMessage(recentChannel)

    expect(latest?.text).toBe('Q2')
    expect(latest ? connectPhoneRecentMessageLabel(latest) : '').toBe('Alice: Q2')
  })

  it('treats only enabled channels for the selected provider as connected phone channels', () => {
    expect(hasEnabledConnectPhoneChannel([])).toBe(false)
    expect(hasEnabledConnectPhoneChannel([channel(false)])).toBe(false)
    expect(hasEnabledConnectPhoneChannel([channel(false), channel(true)])).toBe(true)
    expect(hasEnabledConnectPhoneChannel([channel(true, 'weixin')], 'feishu')).toBe(false)
    expect(hasEnabledConnectPhoneChannel([channel(true, 'weixin')], 'weixin')).toBe(true)
  })

  it('reserves only the selected provider slot once a channel exists', () => {
    expect(hasConnectPhoneChannel([])).toBe(false)
    expect(hasConnectPhoneChannel([channel(false)])).toBe(true)
    expect(hasConnectPhoneChannel([channel(true)])).toBe(true)
    expect(hasConnectPhoneChannel([channel(true, 'feishu')], 'weixin')).toBe(false)
    expect(hasConnectPhoneChannel([channel(true, 'weixin')], 'weixin')).toBe(true)
  })

  it('shows settings and disconnect actions for an existing phone connection', () => {
    const html = renderToStaticMarkup(
      createElement(ConnectPhoneSidebarPanel, {
        channels: [channel(true)],
        onAddProvider: async () => undefined,
        onDisconnect: async () => undefined,
        onOpenSettings: () => undefined
      })
    )

    expect(html).toContain('Phone connection settings')
    expect(html).toContain('Disconnect phone')
  })

  it('renders phone connection in a dedicated dialog surface', () => {
    const html = renderToStaticMarkup(
      createElement(ConnectPhoneDialog, {
        channels: [],
        onAddProvider: async () => undefined,
        onDisconnect: async () => undefined,
        onOpenSettings: () => undefined,
        onClose: () => undefined
      })
    )

    expect(html).toContain('role="dialog"')
    expect(html).toContain('Use your phone to connect the local runtime')
    expect(html).toContain('Generate authorization QR')
    expect(html).toContain('Discord')
  })

  it('renders Discord bot setup with Client ID, Bot Token, and local-online guard copy', () => {
    const html = renderToStaticMarkup(
      createElement(DiscordBotSetupPanel, {
        t: i18n.t.bind(i18n),
        channels: []
      })
    )

    expect(html).toContain('Client ID')
    expect(html).toContain('Bot Token')
    expect(html).toContain('Test send / enable receive')
    expect(html).toContain('This channel is guarded only while this computer is online.')
  })
})
