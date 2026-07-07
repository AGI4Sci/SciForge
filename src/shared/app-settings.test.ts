import { describe, expect, it } from 'vitest'
import * as appSettingsExports from './app-settings'
import {
  applyLocalRuntimePatch,
  applyCodexRuntimePatch,
  codexSettingsPatch,
  agentRuntimeSettingsEnvelope,
  localRuntimeSettingsPatch,
  DEFAULT_CODEX_DATA_DIR,
  DEFAULT_CLAUDE_CONFIG_DIR,
  DEFAULT_LOCAL_RUNTIME_DATA_DIR,
  DEFAULT_LOCAL_RUNTIME_MODEL,
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_SANDBOX_MODE,
  DEFAULT_WEIXIN_BRIDGE_RPC_URL,
  DEFAULT_SCHEDULE_INTERNAL_PORT,
  buildRemoteChannelRuntimePrompt,
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultModelRouterSettings,
  defaultModelProviderSettings,
  defaultSpeechToTextSettings,
  defaultRuntimeGuardSettings,
  defaultAgentCapabilitySettings,
  defaultComputerUseSettings,
  mergeLocalRuntimeSettings,
  mergeRuntimeGuardSettings,
  mergeAgentCapabilitySettings,
  mergeComputerUseSettings,
  mergeScheduleSettings,
  mergeSpeechToTextSettings,
  defaultCodexRuntimeSettings,
  defaultClaudeRuntimeSettings,
  defaultLocalRuntimeSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultRemoteExecutorSettings,
  defaultWriteSettings,
  defaultKeyboardShortcuts,
  getActiveAgentRuntime,
  getActiveAgentApiKey,
  getCodexRuntimeSettings,
  getClaudeRuntimeSettings,
  getComputerUseSettings,
  isComputerUseEnabledForRuntime,
  getAgentCapabilitySettings,
  isLocalRuntimeInsecure,
  mergeRemoteChannelSettings,
  normalizeRemoteExecutorSettings,
  remoteExecutorWorkspaceMatchesTrust,
  isRemoteExecutorTargetTrustedForWorkspace,
  normalizeAppSettings,
  normalizeRuntimeGuardSettings,
  parseRemoteChannelUserPromptForDisplay,
  normalizeScheduleSettings,
  resolveLocalRuntimeSettings,
  resolveSpeechToTextSettings,
  resolveWriteInlineCompletionApiKey,
  resolveWriteInlineCompletionBaseUrl,
  resolveWriteInlineCompletionModel,
  type AppSettingsV1,
  type RemoteChannelV1,
  type RemoteChannelProvider
} from './app-settings'

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    modelRouter: defaultModelRouterSettings(),
    activeAgentRuntime: 'sciforge',
    agents: {
      sciforge: defaultLocalRuntimeSettings(),
      codex: defaultCodexRuntimeSettings()
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

function clawChannel(provider: RemoteChannelProvider, label: string, name = label): RemoteChannelV1 {
  const now = '2026-06-01T00:00:00.000Z'
  return {
    id: `${provider}-${label}`,
    provider,
    label,
    enabled: true,
    model: 'auto',
    runtimeId: 'sciforge',
    agentThreadIds: {},
    workspaceRoot: '',
    agentProfile: {
      name,
      description: '',
      identity: '',
      personality: '',
      userContext: '',
      replyRules: ''
    },
    conversations: [],
    createdAt: now,
    updatedAt: now
  }
}

describe('remote channel public surface', () => {
  it('does not re-export legacy Claw runtime helper names', () => {
    expect(appSettingsExports).not.toHaveProperty('DEFAULT_CLAW_MODEL')
    expect(appSettingsExports).not.toHaveProperty('CLAW_MODEL_IDS')
    expect(appSettingsExports).not.toHaveProperty('CLAW_MANAGED_INSTRUCTIONS_HEADING')
    expect(appSettingsExports).not.toHaveProperty('buildClawRuntimePrompt')
    expect(appSettingsExports).not.toHaveProperty('parseClawUserPromptForDisplay')
  })
})

describe('local runtime defaults', () => {
  it('keeps a single shared default data directory source', () => {
    expect(defaultLocalRuntimeSettings().dataDir).toBe(DEFAULT_LOCAL_RUNTIME_DATA_DIR)
  })

  it('defaults the assistant model to v4 pro', () => {
    expect(defaultLocalRuntimeSettings().model).toBe(DEFAULT_LOCAL_RUNTIME_MODEL)
  })

  it('defaults approval policy to auto', () => {
    expect(defaultLocalRuntimeSettings().approvalPolicy).toBe(DEFAULT_APPROVAL_POLICY)
    expect(defaultLocalRuntimeSettings().approvalPolicy).toBe('auto')
  })

  it('defaults sandbox mode to full access', () => {
    expect(defaultLocalRuntimeSettings().sandboxMode).toBe(DEFAULT_SANDBOX_MODE)
    expect(defaultLocalRuntimeSettings().sandboxMode).toBe('danger-full-access')
  })

  it('defaults token economy mode to off', () => {
    expect(defaultLocalRuntimeSettings().tokenEconomyMode).toBe(false)
    expect(defaultLocalRuntimeSettings().tokenEconomy).toMatchObject({
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
  })

  it('defaults shared agent subagent capabilities on', () => {
    expect(defaultAgentCapabilitySettings()).toEqual({
      subagents: {
        enabled: true,
        maxParallel: 2,
        maxChildRuns: 4
      }
    })
  })

  it('normalizes shared agent capability settings', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      agentCapabilities: {
        subagents: {
          enabled: false,
          maxParallel: 99,
          maxChildRuns: 0
        }
      }
    })

    expect(getAgentCapabilitySettings(normalized)).toEqual({
      subagents: {
        enabled: false,
        maxParallel: 16,
        maxChildRuns: 4
      }
    })

    const highChildBudget = normalizeAppSettings({
      ...settings(),
      agentCapabilities: {
        subagents: {
          enabled: true,
          maxParallel: 2,
          maxChildRuns: 3
        }
      }
    })

    expect(getAgentCapabilitySettings(highChildBudget).subagents.maxChildRuns).toBe(3)

    const cappedChildBudget = normalizeAppSettings({
      ...settings(),
      agentCapabilities: {
        subagents: {
          enabled: true,
          maxParallel: 2,
          maxChildRuns: 9999
        }
      }
    })

    expect(getAgentCapabilitySettings(cappedChildBudget).subagents.maxChildRuns).toBe(4)
  })

  it('merges shared agent capability patches', () => {
    expect(mergeAgentCapabilitySettings(defaultAgentCapabilitySettings(), {
      subagents: { maxParallel: 3 }
    })).toEqual({
      subagents: {
        enabled: true,
        maxParallel: 3,
        maxChildRuns: 4
      }
    })
  })

  it('defaults MCP search discovery to off', () => {
    expect(defaultLocalRuntimeSettings().mcpSearch).toMatchObject({
      enabled: false,
      mode: 'auto',
      autoThresholdToolCount: 24,
      topKDefault: 5,
      topKMax: 10
    })
  })

  it('defaults advanced local runtime tuning to conservative values', () => {
    expect(defaultLocalRuntimeSettings()).toMatchObject({
      storage: {
        backend: 'hybrid',
        sqlitePath: ''
      },
      contextCompaction: {
        defaultSoftThreshold: 16000,
        defaultHardThreshold: 24000,
        summaryMode: 'heuristic',
        summaryTimeoutMs: 15000,
        summaryMaxTokens: 1200,
        summaryInputMaxBytes: 98304
      },
      runtimeTuning: {
        toolArgumentRepair: {
          maxStringBytes: 524288
        }
      }
    })
  })

  it('defaults runtime guard settings to runtime-neutral tool storm limits', () => {
    expect(defaultRuntimeGuardSettings()).toMatchObject({
      toolStorm: {
        enabled: true,
        windowSize: 8,
        threshold: 3
      }
    })
  })

  it('defaults computer use to the GUI-Owl sidecar path', () => {
    expect(defaultComputerUseSettings()).toEqual({
      enabled: true,
      runtimeEnabled: {
        sciforge: true,
        codex: true,
        claude: true
      }
    })
  })

  it('normalizes computer-use settings and drops legacy backend preferences', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      computerUse: {
        enabled: false,
        runtimeEnabled: {
          sciforge: true,
          codex: false,
          claude: true
        },
        // Legacy host-input settings are ignored by the normalized app state.
        backend: 'mac-app-scoped',
        experimentalAppScopedBackend: false
      } as never
    })

    expect(getComputerUseSettings(normalized)).toEqual({
      enabled: false,
      runtimeEnabled: {
        sciforge: true,
        codex: false,
        claude: true
      }
    })
    expect(isComputerUseEnabledForRuntime(normalized, 'codex')).toBe(false)
    expect(isComputerUseEnabledForRuntime(normalized, 'sciforge')).toBe(false)

    const legacyExperimental = normalizeAppSettings({
      ...settings(),
      computerUse: {
        enabled: true,
        runtimeEnabled: {
          sciforge: true,
          codex: true,
          claude: true
        },
        backend: 'mac-app-scoped',
        experimentalAppScopedBackend: true
      } as never
    })

    expect(getComputerUseSettings(legacyExperimental)).toEqual({
      enabled: true,
      runtimeEnabled: {
        sciforge: true,
        codex: true,
        claude: true
      }
    })
  })

  it('normalizes runtime guard tool storm settings', () => {
    expect(normalizeRuntimeGuardSettings({
      toolStorm: {
        enabled: false,
        windowSize: 10,
        threshold: 5
      }
    }).toolStorm).toMatchObject({
      enabled: false,
      windowSize: 10,
      threshold: 5
    })
  })

  it('drops legacy runtime guard soft and hard thresholds', () => {
    expect(normalizeRuntimeGuardSettings({
      toolStorm: {
        softThreshold: 5,
        hardThreshold: 7
      }
    } as never).toolStorm).toMatchObject({
      enabled: true,
      windowSize: 8,
      threshold: 3
    })
  })
})

describe('remote executor settings', () => {
  it('defaults and normalizes the top-level domain', () => {
    expect(defaultRemoteExecutorSettings()).toEqual({
      enabled: false,
      defaultTargetId: '',
      targets: []
    })

    const normalized = normalizeAppSettings({
      ...settings(),
      remoteExecutor: undefined
    } as unknown as AppSettingsV1)

    expect(normalized.remoteExecutor).toEqual(defaultRemoteExecutorSettings())
  })

  it('normalizes SSH and Slurm target fields while preserving trust fingerprints', () => {
    const fingerprint = 'SHA256:remote-host/+abc='
    const normalized = normalizeRemoteExecutorSettings({
      enabled: true,
      defaultTargetId: ' gpu-login ',
      targets: [{
        id: ' gpu-login ',
        label: ' GPU Login ',
        enabled: false,
        kind: 'slurm',
        ssh: {
          host: ' login.example.edu ',
          user: ' researcher ',
          port: '2222' as unknown as number,
          pythonPath: ' /opt/conda/bin/python ',
          identityFile: ' ~/.ssh/gpu '
        },
        remoteWorkspaceRoot: ' /scratch/project ',
        slurm: {
          defaults: {
            partition: ' gpu ',
            account: ' lab ',
            nodes: 2.8,
            cpusPerTask: 8,
            extraArgs: [' --gres=gpu:1 ', '', ' --gres=gpu:1 ']
          }
        },
        trustedWorkspaces: [{
          workspaceRoot: ' /repo/project ',
          targetFingerprint: fingerprint,
          trustedAt: '2026-06-01T00:00:00.000Z',
          trustedBy: ' zxy ',
          approvalBypass: true
        }]
      }]
    })

    expect(normalized.enabled).toBe(true)
    expect(normalized.defaultTargetId).toBe('gpu-login')
    expect(normalized.targets[0]).toMatchObject({
      id: 'gpu-login',
      label: 'GPU Login',
      enabled: false,
      kind: 'slurm',
      remoteWorkspaceRoot: '/scratch/project',
      ssh: {
        host: 'login.example.edu',
        user: 'researcher',
        port: 2222,
        pythonPath: '/opt/conda/bin/python',
        identityFile: '~/.ssh/gpu'
      },
      slurm: {
        defaults: {
          partition: 'gpu',
          account: 'lab',
          nodes: 2,
          cpusPerTask: 8,
          extraArgs: ['--gres=gpu:1']
        }
      }
    })
    expect(normalized.targets[0].trustedWorkspaces[0]).toEqual({
      workspaceRoot: '/repo/project',
      targetFingerprint: fingerprint,
      trustedAt: '2026-06-01T00:00:00.000Z',
      trustedBy: 'zxy',
      approvalBypass: true
    })
  })

  it('deduplicates repeated target ids with stable suffixes', () => {
    const normalized = normalizeRemoteExecutorSettings({
      defaultTargetId: 'gpu',
      targets: [
        { id: 'gpu', label: 'A' },
        { id: 'gpu', label: 'B' },
        { id: 'gpu', label: 'C' }
      ]
    })

    expect(normalized.defaultTargetId).toBe('gpu')
    expect(normalized.targets.map((target) => target.id)).toEqual(['gpu', 'gpu-2', 'gpu-3'])
    expect(normalized.targets.map((target) => target.label)).toEqual(['A', 'B', 'C'])
  })

  it('matches trusted workspaces exactly or by subpath for a target fingerprint', () => {
    const target = normalizeRemoteExecutorSettings({
      targets: [{
        id: 'gpu',
        label: 'GPU',
        trustedWorkspaces: [{
          workspaceRoot: '/repo/project',
          targetFingerprint: 'fp-1',
          trustedAt: '2026-06-01T00:00:00.000Z',
          trustedBy: 'zxy',
          approvalBypass: true
        }]
      }]
    }).targets[0]

    expect(remoteExecutorWorkspaceMatchesTrust('/repo/project', '/repo/project')).toBe(true)
    expect(remoteExecutorWorkspaceMatchesTrust('/repo/project', '/repo/project/subdir')).toBe(true)
    expect(remoteExecutorWorkspaceMatchesTrust('/repo/project', '/repo/project-other')).toBe(false)
    expect(isRemoteExecutorTargetTrustedForWorkspace(target, '/repo/project/subdir', 'fp-1')).toBe(true)
    expect(isRemoteExecutorTargetTrustedForWorkspace(target, '/repo/project/subdir', 'fp-2')).toBe(false)
  })
})

describe('app behavior settings', () => {
  it('defaults desktop behavior to off', () => {
    const raw = {
      ...settings(),
      appBehavior: undefined
    } as unknown as AppSettingsV1

    expect(normalizeAppSettings(raw).appBehavior).toEqual({
      openAtLogin: false,
      startMinimized: false,
      closeToTray: false
    })
  })

  it('only keeps start minimized when open at login is enabled', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      appBehavior: {
        openAtLogin: false,
        startMinimized: true,
        closeToTray: true
      }
    })

    expect(normalized.appBehavior).toEqual({
      openAtLogin: false,
      startMinimized: false,
      closeToTray: true
    })
  })
})

describe('keyboard shortcut settings', () => {
  it('defaults shortcut overrides to empty', () => {
    const raw = {
      ...settings(),
      keyboardShortcuts: undefined
    } as unknown as AppSettingsV1

    expect(normalizeAppSettings(raw).keyboardShortcuts).toEqual({
      bindings: {}
    })
  })
})

describe('speech-to-text settings', () => {
  it('defaults voice input settings to disabled', () => {
    const raw = {
      ...settings(),
      speechToText: undefined
    } as AppSettingsV1

    expect(normalizeAppSettings(raw).speechToText).toEqual(defaultSpeechToTextSettings())
  })

  it('normalizes router-backed transcription settings and drops legacy provider fields', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      speechToText: {
        enabled: true,
        protocol: 'mimo-asr',
        baseUrl: '  https://speech.example/v1  ',
        apiKey: '  sk-speech  ',
        model: '  whisper-large-v3  ',
        language: '  ZH-CN  ',
        timeoutMs: 900_000
      }
    })

    expect(normalized.speechToText).toEqual({
      enabled: true,
      protocol: 'mimo-asr',
      baseUrl: '',
      apiKey: '',
      model: 'whisper-large-v3',
      language: 'zh-cn',
      timeoutMs: 600_000
    })
  })

  it('falls back to router-backed transcription and clamps tiny timeouts', () => {
    const merged = mergeSpeechToTextSettings(defaultSpeechToTextSettings(), {
      enabled: true,
      protocol: 'bogus' as never,
      timeoutMs: 100
    })

    expect(merged.protocol).toBe('mimo-asr')
    expect(merged.timeoutMs).toBe(5_000)
  })

  it('resolves normalized settings from the app config', () => {
    const resolved = resolveSpeechToTextSettings({
      ...settings(),
      speechToText: {
        ...defaultSpeechToTextSettings(),
        enabled: true,
        baseUrl: ' https://speech.example/v1 ',
        apiKey: ' sk-speech ',
        model: ' whisper-1 '
      }
    })

    expect(resolved).toMatchObject({
      enabled: true,
      protocol: 'mimo-asr',
      baseUrl: '',
      apiKey: '',
      model: 'whisper-1'
    })
  })
})

describe('claw settings', () => {
  it('defaults remote channel webhooks to the canonical path', () => {
    const defaults = defaultRemoteChannelSettings()
    expect(defaults.im.path).toBe('/remote-channel/webhook')

    const normalized = normalizeAppSettings({
      ...settings(),
      remoteChannel: {
        ...defaults,
        im: {
          ...defaults.im,
          path: ''
        }
      }
    })

    expect(normalized.remoteChannel.im.path).toBe('/remote-channel/webhook')
  })

  it('stores the WeChat bridge URL in connect phone settings', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      connectPhone: {
        weixinBridgeUrl: '  http://127.0.0.1:8787/rpc  '
      }
    })

    expect(defaultConnectPhoneSettings().weixinBridgeUrl).toBe(DEFAULT_WEIXIN_BRIDGE_RPC_URL)
    expect(normalized.connectPhone.weixinBridgeUrl).toBe('http://127.0.0.1:8787/rpc')
  })

  it('does not read legacy OpenClaw Gateway URL from remote channel settings', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      remoteChannel: {
        ...defaultRemoteChannelSettings(),
        im: {
          ...defaultRemoteChannelSettings().im,
          openClawGatewayUrl: '  http://127.0.0.1:8787/rpc  '
        } as ReturnType<typeof defaultRemoteChannelSettings>['im'] & { openClawGatewayUrl: string }
      }
    })

    expect(normalized.connectPhone.weixinBridgeUrl).toBe(DEFAULT_WEIXIN_BRIDGE_RPC_URL)
    expect('weixinBridgeUrl' in normalized.remoteChannel.im).toBe(false)
  })

  it('preserves Codex-only remote-channel conversations without a legacy local runtime thread id', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      remoteChannel: {
        ...defaultRemoteChannelSettings(),
        channels: [{
          ...clawChannel('feishu', 'team'),
          runtimeId: 'codex',
          agentThreadIds: { codex: 'codex-channel-thread' },
          conversations: [{
            id: 'conversation-1',
            chatId: 'chat-1',
            remoteThreadId: 'remote-1',
            latestMessageId: 'message-1',
            senderId: 'sender-1',
            senderName: 'Ada',
            runtimeId: 'codex',
            agentThreadIds: { codex: 'codex-conversation-thread' },
            workspaceRoot: '/tmp/workspace',
            createdAt: '2026-06-11T00:00:00.000Z',
            updatedAt: '2026-06-11T00:00:01.000Z'
          }]
        }]
      }
    })

    expect(normalized.remoteChannel.channels[0]).toMatchObject({
      runtimeId: 'codex',
      agentThreadIds: { codex: 'codex-channel-thread' }
    })
    expect(normalized.remoteChannel.channels[0]).not.toHaveProperty('threadId')
    expect(normalized.remoteChannel.channels[0]?.conversations).toEqual([
      expect.objectContaining({
        id: 'conversation-1',
        runtimeId: 'codex',
        agentThreadIds: { codex: 'codex-conversation-thread' }
      })
    ])
    expect(normalized.remoteChannel.channels[0]?.conversations[0]).not.toHaveProperty('localThreadId')
  })

  it('preserves Claude remote-channel thread mappings', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      remoteChannel: {
        ...defaultRemoteChannelSettings(),
        channels: [{
          ...clawChannel('feishu', 'Claude Channel'),
          runtimeId: 'claude',
          agentThreadIds: { claude: 'claude-channel-thread' },
          conversations: [{
            id: 'conversation-1',
            chatId: 'chat-1',
            remoteThreadId: '',
            latestMessageId: 'message-1',
            senderId: '',
            senderName: '',
            runtimeId: 'claude',
            agentThreadIds: { claude: 'claude-conversation-thread' },
            workspaceRoot: '/tmp/workspace',
            createdAt: '2026-06-11T00:00:00.000Z',
            updatedAt: '2026-06-11T00:00:01.000Z'
          }]
        }]
      }
    })

    const channel = normalized.remoteChannel.channels[0]
    expect(channel.runtimeId).toBe('claude')
    expect(channel.agentThreadIds).toEqual({ claude: 'claude-channel-thread' })
    expect(channel.conversations[0]).toMatchObject({
      runtimeId: 'claude',
      agentThreadIds: { claude: 'claude-conversation-thread' }
    })
  })

  it('normalizes remote-channel guard mode with an only_mention default', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      remoteChannel: {
        ...defaultRemoteChannelSettings(),
        channels: [
          clawChannel('feishu', 'Default Guard'),
          {
            ...clawChannel('feishu', 'All Messages'),
            guardMode: 'all_messages'
          },
          {
            ...clawChannel('feishu', 'Bad Guard'),
            guardMode: 'bogus' as never
          }
        ]
      }
    })

    expect(normalized.remoteChannel.channels.map((channel) => channel.guardMode)).toEqual([
      'only_mention',
      'all_messages',
      'only_mention'
    ])
  })

  it('normalizes phone agent default names without touching custom names', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      remoteChannel: {
        ...defaultRemoteChannelSettings(),
        channels: [
          clawChannel('weixin', 'WeChat Agent', 'WeChat Agent'),
          clawChannel('feishu', 'Feishu / Lark', 'Feishu Agent'),
          clawChannel('weixin', 'Support Bot', '')
        ]
      }
    })

    expect(normalized.remoteChannel.channels.map((channel) => ({
      label: channel.label,
      name: channel.agentProfile.name
    }))).toEqual([
      { label: 'weixin agent', name: 'weixin agent' },
      { label: 'feishu agent', name: 'feishu agent' },
      { label: 'Support Bot', name: 'Support Bot' }
    ])
  })

  it('ignores legacy Claw thread fields instead of seeding SciForge mappings', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      remoteChannel: {
        ...defaultRemoteChannelSettings(),
        channels: [{
          id: 'channel-1',
          provider: 'weixin',
          label: 'WeChat Agent',
          enabled: true,
          model: 'auto',
          threadId: ' legacy-channel-thread ',
          agentThreadIds: {
            codewhale: ' legacy-codewhale-channel ',
            reasonix: ' legacy-reasonix-channel '
          },
          workspaceRoot: '',
          agentProfile: {
            name: 'WeChat Agent',
            description: '',
            identity: '',
            personality: '',
            userContext: '',
            replyRules: ''
          },
          conversations: [{
            id: 'conversation-1',
            chatId: 'chat-1',
            remoteThreadId: '',
            latestMessageId: 'message-1',
            senderId: '',
            senderName: '',
            agentThreadIds: {
              reasonix: ' legacy-reasonix-conversation '
            },
            workspaceRoot: '',
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z'
          }],
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z'
        }]
      }
    } as unknown as AppSettingsV1)

    const channel = normalized.remoteChannel.channels[0]
    expect(channel.runtimeId).toBe('sciforge')
    expect(channel).not.toHaveProperty('threadId')
    expect(channel.agentThreadIds).toEqual({})
    expect(channel.agentThreadIds?.codex).toBeUndefined()

    expect(channel.conversations).toEqual([])
  })

  it('round-trips Codex claw thread mappings while keeping SciForge mappings', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      remoteChannel: {
        ...defaultRemoteChannelSettings(),
        channels: [{
          ...clawChannel('feishu', 'Codex Channel'),
          runtimeId: 'codex',
          agentThreadIds: {
            sciforge: 'sciforge-channel-thread',
            codex: 'codex-channel-thread'
          },
          conversations: [{
            id: 'conversation-1',
            chatId: 'chat-1',
            remoteThreadId: '',
            latestMessageId: 'message-1',
            senderId: '',
            senderName: '',
            runtimeId: 'codex',
            agentThreadIds: {
              sciforge: 'sciforge-conversation-thread',
              codex: 'codex-conversation-thread'
            },
            workspaceRoot: '',
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z'
          }]
        }]
      }
    })

    const channel = normalized.remoteChannel.channels[0]
    expect(channel.runtimeId).toBe('codex')
    expect(channel).not.toHaveProperty('threadId')
    expect(channel.agentThreadIds).toEqual({
      sciforge: 'sciforge-channel-thread',
      codex: 'codex-channel-thread'
    })

    const conversation = channel.conversations[0]
    expect(conversation.runtimeId).toBe('codex')
    expect(conversation).not.toHaveProperty('localThreadId')
    expect(conversation.agentThreadIds).toEqual({
      sciforge: 'sciforge-conversation-thread',
      codex: 'codex-conversation-thread'
    })
  })

  it('merges claw settings without dropping SciForge or Codex thread mappings', () => {
    const current = normalizeAppSettings({
      ...settings(),
      remoteChannel: {
        ...defaultRemoteChannelSettings(),
        channels: [{
          ...clawChannel('feishu', 'Merged Channel'),
          runtimeId: 'codex',
          agentThreadIds: {
            sciforge: 'sciforge-channel-thread',
            codex: 'codex-channel-thread'
          }
        }]
      }
    }).remoteChannel

    const merged = mergeRemoteChannelSettings(current, {
      channels: [{
        ...current.channels[0],
        label: 'Merged Channel Renamed'
      }]
    })

    expect(merged.channels[0].runtimeId).toBe('codex')
    expect(merged.channels[0]).not.toHaveProperty('threadId')
    expect(merged.channels[0].agentThreadIds).toEqual({
      sciforge: 'sciforge-channel-thread',
      codex: 'codex-channel-thread'
    })
  })
})

describe('isLocalRuntimeInsecure', () => {
  it('treats an empty runtime token as effectively insecure', () => {
    expect(
      isLocalRuntimeInsecure({
        ...defaultLocalRuntimeSettings(),
        insecure: false,
        runtimeToken: ''
      })
    ).toBe(true)
  })

  it('keeps auth enabled when a token exists and insecure is false', () => {
    expect(
      isLocalRuntimeInsecure({
        ...defaultLocalRuntimeSettings(),
        insecure: false,
        runtimeToken: 'tok-1'
      })
    ).toBe(false)
  })
})

describe('mergeComputerUseSettings', () => {
  it('merges partial patches while dropping legacy backend settings', () => {
    const current = mergeComputerUseSettings(defaultComputerUseSettings(), {
      backend: 'mac-app-scoped',
      experimentalAppScopedBackend: true
    } as never)

    expect(current).toEqual({
      enabled: true,
      runtimeEnabled: {
        sciforge: true,
        codex: true,
        claude: true
      }
    })

    const disabled = mergeComputerUseSettings(current, {
      enabled: false,
      experimentalAppScopedBackend: false
    } as never)

    expect(disabled).toEqual({
      enabled: false,
      runtimeEnabled: {
        sciforge: true,
        codex: true,
        claude: true
      }
    })
  })

  it('merges runtime-level computer-use toggles without resetting siblings', () => {
    const current = mergeComputerUseSettings(defaultComputerUseSettings(), {
      runtimeEnabled: { codex: false }
    })
    const next = mergeComputerUseSettings(current, {
      runtimeEnabled: { claude: false }
    })

    expect(next.runtimeEnabled).toEqual({
      sciforge: true,
      codex: false,
      claude: false
    })
  })
})

describe('mergeLocalRuntimeSettings', () => {
  it('merges a direct local runtime patch without the envelope wrapper', () => {
    const current = defaultLocalRuntimeSettings()
    const next = mergeLocalRuntimeSettings(current, {
      model: 'deepseek-reasoner',
      port: 9000,
      tokenEconomyMode: true
    })
    expect(next.model).toBe('deepseek-reasoner')
    expect(next.port).toBe(9000)
    expect(next.tokenEconomyMode).toBe(true)
    expect(next.tokenEconomy.enabled).toBe(true)
    expect(next.providerId).toBe(current.providerId)
  })

  it('drops legacy local runtime credential patches', () => {
    const next = mergeLocalRuntimeSettings(defaultLocalRuntimeSettings(), {
      apiKey: 'sk-local',
      baseUrl: 'https://local-runtime.example/v1',
      model: 'deepseek-reasoner'
    } as unknown as Parameters<typeof mergeLocalRuntimeSettings>[1])

    expect(next.model).toBe('deepseek-reasoner')
    expect('apiKey' in next).toBe(false)
    expect('baseUrl' in next).toBe(false)
  })

  it('deep-merges token economy settings and keeps the legacy switch synced', () => {
    const current = defaultLocalRuntimeSettings()
    const next = mergeLocalRuntimeSettings(current, {
      tokenEconomy: {
        enabled: true,
        compressToolResults: false,
        historyHygiene: {
          maxToolResultLines: 120
        }
      }
    })

    expect(next.tokenEconomyMode).toBe(true)
    expect(next.tokenEconomy.enabled).toBe(true)
    expect(next.tokenEconomy.compressToolDescriptions).toBe(true)
    expect(next.tokenEconomy.compressToolResults).toBe(false)
    expect(next.tokenEconomy.historyHygiene.maxToolResultLines).toBe(120)
    expect(next.tokenEconomy.historyHygiene.maxToolResultBytes).toBe(
      current.tokenEconomy.historyHygiene.maxToolResultBytes
    )

    const legacySwitch = mergeLocalRuntimeSettings(next, { tokenEconomyMode: false })
    expect(legacySwitch.tokenEconomyMode).toBe(false)
    expect(legacySwitch.tokenEconomy.enabled).toBe(false)
  })

  it('deep-merges MCP search settings', () => {
    const current = defaultLocalRuntimeSettings()
    const next = mergeLocalRuntimeSettings(current, {
      mcpSearch: {
        enabled: true,
        mode: 'search',
        topKDefault: 3
      }
    })

    expect(next.mcpSearch.enabled).toBe(true)
    expect(next.mcpSearch.mode).toBe('search')
    expect(next.mcpSearch.topKDefault).toBe(3)
    expect(next.mcpSearch.topKMax).toBe(current.mcpSearch.topKMax)
  })

  it('deep-merges advanced local runtime settings', () => {
    const current = defaultLocalRuntimeSettings()
    const next = mergeLocalRuntimeSettings(current, {
      storage: {
        sqlitePath: ' /tmp/sciforge.sqlite3 '
      },
      contextCompaction: {
        defaultSoftThreshold: 64000
      },
      runtimeTuning: {
        toolArgumentRepair: {
          maxStringBytes: 262144
        }
      }
    })

    expect(next.storage.backend).toBe('hybrid')
    expect(next.storage.sqlitePath).toBe('/tmp/sciforge.sqlite3')
    expect(next.contextCompaction.defaultSoftThreshold).toBe(64000)
    expect(next.contextCompaction.defaultHardThreshold).toBe(64000)
    expect(next.contextCompaction.summaryMode).toBe('heuristic')
    expect(next.runtimeTuning.toolArgumentRepair).toEqual({
      maxStringBytes: 262144
    })
  })

  it('deep-merges runtime guard settings through the new config model', () => {
    const next = mergeRuntimeGuardSettings(defaultRuntimeGuardSettings(), {
      toolStorm: {
        threshold: 5
      }
    })

    expect(next.toolStorm).toMatchObject({
      enabled: true,
      windowSize: 8,
      threshold: 5
    })
  })
})

describe('local runtime envelope helpers', () => {
  it('wraps runtime settings and patches into the compatibility shell', () => {
    const runtime = defaultLocalRuntimeSettings()
    expect(agentRuntimeSettingsEnvelope(runtime)).toEqual({ sciforge: runtime })
    expect(localRuntimeSettingsPatch({ model: 'deepseek-reasoner' })).toEqual({
      sciforge: { model: 'deepseek-reasoner' }
    })
  })

  it('applies a local runtime patch onto full app settings', () => {
    const current = settings()
    const next = applyLocalRuntimePatch(current, { model: 'deepseek-reasoner' })
    expect(next.agents.sciforge.model).toBe('deepseek-reasoner')
    expect(getCodexRuntimeSettings(next)).toEqual(getCodexRuntimeSettings(current))
    expect(next.write).toEqual(current.write)
  })
})

describe('agent runtime settings', () => {
  it('defaults to SciForge while normalizing a Codex runtime settings slot', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      agents: {
        sciforge: defaultLocalRuntimeSettings()
      }
    })

    expect(getActiveAgentRuntime(normalized)).toBe('sciforge')
    expect(getCodexRuntimeSettings(normalized)).toEqual(expect.objectContaining({
      command: 'codex',
      codexHome: DEFAULT_CODEX_DATA_DIR,
      autoStart: true
    }))
  })

  it('normalizes invalid runtime ids back to SciForge', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      activeAgentRuntime: 'mystery-runtime'
    } as unknown as AppSettingsV1)

    expect(getActiveAgentRuntime(normalized)).toBe('sciforge')
  })

  it('preserves Claude Code as an active runtime with default settings', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      activeAgentRuntime: 'claude',
      agents: {
        sciforge: defaultLocalRuntimeSettings(),
        codex: defaultCodexRuntimeSettings(),
        claude: {
          ...defaultClaudeRuntimeSettings(),
          command: 'claude',
          configDir: DEFAULT_CLAUDE_CONFIG_DIR
        }
      }
    })

    expect(getActiveAgentRuntime(normalized)).toBe('claude')
    expect(getClaudeRuntimeSettings(normalized)).toEqual(expect.objectContaining({
      command: 'claude',
      configDir: DEFAULT_CLAUDE_CONFIG_DIR,
      sandboxMode: 'workspace-write'
    }))
  })

  it('does not require a local runtime API key when Codex is the active runtime', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      activeAgentRuntime: 'codex',
      provider: {
        ...defaultModelProviderSettings(),
        apiKey: ''
      }
    })

    expect(getActiveAgentApiKey(normalized)).toBe('')
  })

  it('uses the Model Router runtime API key while Codex is the active runtime', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      activeAgentRuntime: 'codex',
      provider: {
        ...defaultModelProviderSettings(),
        apiKey: 'sk-codex-shared'
      },
      modelRouter: {
        ...defaultModelRouterSettings(),
        runtimeApiKey: 'sk-router-runtime'
      }
    })

    expect(getActiveAgentApiKey(normalized)).toBe('sk-router-runtime')
  })

  it('normalizes runtime-facing Model Router base URLs to local HTTP only', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      modelRouter: {
        ...defaultModelRouterSettings(),
        baseUrl: 'https://remote-router.example/v1/responses'
      }
    })

    expect(normalized.modelRouter).toBeDefined()
    const modelRouter = normalized.modelRouter!
    expect(modelRouter.baseUrl).toBe('http://127.0.0.1:3892/v1')
    expect(resolveLocalRuntimeSettings(normalized).baseUrl).toBe('http://127.0.0.1:3892/v1')
    expect(resolveWriteInlineCompletionBaseUrl(normalized)).toBe('http://127.0.0.1:3892/v1')
  })

  it('normalizes local Model Router endpoint URLs back to the local v1 root', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      modelRouter: {
        ...defaultModelRouterSettings(),
        baseUrl: 'http://localhost:49876/v1/responses'
      }
    })

    expect(normalized.modelRouter).toBeDefined()
    const modelRouter = normalized.modelRouter!
    expect(modelRouter.baseUrl).toBe('http://localhost:49876/v1')
  })

  it('preserves Model Router vision supplement rounds when configured', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      modelRouter: {
        ...defaultModelRouterSettings(),
        profiles: {
          default: {
            textReasoner: defaultModelRouterSettings().profiles.default.textReasoner,
            imageGenerator: defaultModelRouterSettings().profiles.default.imageGenerator,
            translators: {
              vision: {
                provider: 'openai-compatible',
                baseUrl: 'https://vision.example/v1',
                apiKey: 'vision-key',
                model: 'vision-model',
                maxSupplementRounds: 1.9
              },
              scientific: defaultModelRouterSettings().profiles.default.translators.scientific
            }
          }
        }
      }
    })

    expect(normalized.modelRouter?.profiles.default.translators.vision.maxSupplementRounds).toBe(1)
  })

  it('wraps codex runtime patches into the shared agents envelope', () => {
    expect(codexSettingsPatch({ codexHome: '/tmp/codex-home' })).toEqual({
      codex: { codexHome: '/tmp/codex-home' }
    })
  })

  it('applies a codex patch without changing SciForge settings', () => {
    const current = settings()
    const next = applyCodexRuntimePatch(current, {
      codexHome: '/tmp/codex-home',
      approvalPolicy: 'never'
    })

    expect(next.agents.sciforge).toEqual(current.agents.sciforge)
    expect(getCodexRuntimeSettings(next)).toEqual(expect.objectContaining({
      codexHome: '/tmp/codex-home',
      approvalPolicy: 'never'
    }))
  })

  it('normalizes persisted Codex permission values to app-server-supported values', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      agents: {
        ...settings().agents,
        codex: {
          ...defaultCodexRuntimeSettings(),
          approvalPolicy: 'suggest',
          sandboxMode: 'external-sandbox'
        }
      }
    })

    expect(getCodexRuntimeSettings(normalized)).toEqual(expect.objectContaining({
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write'
    }))
  })
})

describe('local runtime settings normalization', () => {
  it('drops local runtime credential fields without mutating provider settings', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      agents: {
        sciforge: {
          ...defaultLocalRuntimeSettings(),
          apiKey: 'sk-runtime-old',
          baseUrl: 'https://runtime-old.example/v1'
        } as unknown as AppSettingsV1['agents']['sciforge']
      }
    })

    expect(normalized.provider).toEqual(expect.objectContaining({
      apiKey: settings().provider.apiKey,
      baseUrl: settings().provider.baseUrl
    }))
    expect('apiKey' in normalized.agents.sciforge).toBe(false)
    expect('baseUrl' in normalized.agents.sciforge).toBe(false)
  })

  it('preserves local runtime model and data directory overrides', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      agents: {
        sciforge: {
          ...defaultLocalRuntimeSettings(),
          dataDir: '/tmp/custom-sciforge',
          model: 'deepseek-v4-flash'
        }
      }
    } as AppSettingsV1)

    expect(normalized.agents.sciforge).toEqual(expect.objectContaining({
      dataDir: '/tmp/custom-sciforge',
      model: 'deepseek-v4-flash'
    }))
  })

  it('preserves custom model providers without runtime credential migration', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      provider: {
        apiKey: 'sk-default',
        baseUrl: 'https://api.deepseek.com',
        providers: [
          ...defaultModelProviderSettings().providers,
          {
            id: 'custom-provider-2',
            name: 'Custom Provider',
            apiKey: 'sk-custom',
            baseUrl: 'https://custom.example/v1',
            endpointFormat: 'responses',
            models: ['custom-model']
          }
        ]
      },
      agents: {
        sciforge: {
          ...defaultLocalRuntimeSettings(),
          providerId: 'custom-provider-2',
          model: 'custom-model'
        }
      }
    } as unknown as AppSettingsV1)

    expect(normalized.provider.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'custom-provider-2',
          name: 'Custom Provider',
          apiKey: 'sk-custom',
          baseUrl: 'https://custom.example/v1',
          models: ['custom-model']
        })
      ])
    )
    expect(
      normalized.provider.providers.find((provider) => provider.id === 'custom-provider-2')
    ).not.toHaveProperty('endpointFormat')
    expect(normalized.agents.sciforge.providerId).toBe('custom-provider-2')
    expect(resolveLocalRuntimeSettings(normalized)).toEqual(
      expect.objectContaining({
        apiKey: '',
        baseUrl: 'http://127.0.0.1:3892/v1',
        model: 'sciforge-router'
      })
    )
  })
})

describe('schedule settings', () => {
  it('provides independent top-level schedule defaults', () => {
    const defaults = defaultScheduleSettings()

    expect(defaults.enabled).toBe(false)
    expect(defaults.keepAwake).toBe(false)
    expect(defaults.internal.port).toBe(DEFAULT_SCHEDULE_INTERNAL_PORT)
    expect(defaults.tasks).toEqual([])
  })

  it('normalizes and merges schedule patches without reading legacy claw tasks', () => {
    const legacyTask = {
      id: 'legacy-claw-task',
      title: 'Legacy task',
      enabled: true,
      prompt: 'Old Claw task',
      workspaceRoot: '/tmp/workspace',
      model: 'auto',
      reasoningEffort: 'medium' as const,
      mode: 'agent' as const,
      schedule: { kind: 'daily' as const, everyMinutes: 60, timeOfDay: '08:00', atTime: '' },
      createdAt: '2026-06-02T00:00:00.000Z',
      updatedAt: '2026-06-02T00:00:00.000Z',
      lastRunAt: '',
      nextRunAt: '',
      lastStatus: 'idle' as const,
      lastMessage: '',
      runtimeId: 'sciforge' as const,
      agentThreadIds: {}
    }
    const normalized = normalizeAppSettings({
      ...settings(),
      remoteChannel: {
        ...defaultRemoteChannelSettings(),
        tasks: [legacyTask]
      } as unknown as AppSettingsV1['remoteChannel'],
      schedule: undefined as unknown as AppSettingsV1['schedule']
    })

    expect('tasks' in normalized.remoteChannel).toBe(false)
    expect(normalized.schedule.tasks).toEqual([])

    const merged = mergeScheduleSettings(normalizeScheduleSettings(undefined), {
      enabled: true,
      defaultWorkspaceRoot: ' /tmp/schedule ',
      internal: { port: 99, secret: ' secret ' },
      tasks: [{
        title: 'Daily',
        prompt: 'Run',
        schedule: { kind: 'daily', everyMinutes: 0, timeOfDay: 'bad', atTime: 'not-a-date' }
      }]
    })

    expect(merged.enabled).toBe(true)
    expect(merged.defaultWorkspaceRoot).toBe('/tmp/schedule')
    expect(merged.internal.port).toBe(1024)
    expect(merged.internal.secret).toBe('secret')
    expect(merged.tasks[0].schedule.everyMinutes).toBe(1)
    expect(merged.tasks[0].schedule.timeOfDay).toBe('09:00')
    expect(merged.tasks[0].schedule.atTime).toBe('')
    expect(merged.tasks[0].reasoningEffort).toBe('medium')
  })

  it('ignores legacy scheduled task thread fields without canonical agent mappings', () => {
    const normalized = normalizeScheduleSettings({
      tasks: [{
        id: 'task-1',
        title: 'Legacy task',
        prompt: 'Run',
        lastThreadId: ' legacy-task-thread ',
        agentThreadIds: {
          codewhale: ' legacy-codewhale-task '
        }
      }]
    } as unknown as AppSettingsV1['schedule'])

    expect(normalized.tasks[0]).toMatchObject({
      runtimeId: 'sciforge',
      agentThreadIds: {}
    })
    expect(normalized.tasks[0]).not.toHaveProperty('lastThreadId')
    expect(normalized.tasks[0].agentThreadIds?.codex).toBeUndefined()
  })

  it('round-trips Codex scheduled task mappings while keeping SciForge mappings', () => {
    const current = normalizeScheduleSettings({
      tasks: [{
        id: 'task-1',
        title: 'Codex task',
        prompt: 'Run',
        runtimeId: 'codex',
        agentThreadIds: {
          sciforge: 'sciforge-task-thread',
          codex: 'codex-task-thread'
        }
      }]
    } as unknown as AppSettingsV1['schedule'])

    expect(current.tasks[0]).toMatchObject({
      runtimeId: 'codex',
      agentThreadIds: {
        sciforge: 'sciforge-task-thread',
        codex: 'codex-task-thread'
      }
    })
    expect(current.tasks[0]).not.toHaveProperty('lastThreadId')

    const merged = mergeScheduleSettings(current, {
      tasks: [{
        ...current.tasks[0],
        title: 'Codex task renamed'
      }]
    })

    expect(merged.tasks[0].runtimeId).toBe('codex')
    expect(merged.tasks[0]).not.toHaveProperty('lastThreadId')
    expect(merged.tasks[0].agentThreadIds).toEqual({
      sciforge: 'sciforge-task-thread',
      codex: 'codex-task-thread'
    })
  })

  it('round-trips Claude scheduled task mappings', () => {
    const current = normalizeScheduleSettings({
      tasks: [{
        id: 'task-1',
        title: 'Claude task',
        prompt: 'Run',
        runtimeId: 'claude',
        agentThreadIds: {
          claude: 'claude-task-thread'
        }
      }]
    } as unknown as AppSettingsV1['schedule'])

    expect(current.tasks[0]).toMatchObject({
      runtimeId: 'claude',
      agentThreadIds: {
        claude: 'claude-task-thread'
      }
    })
  })
})

describe('claw runtime prompts', () => {
  it('does not duplicate default Schedule MCP tool instructions in managed prompts', () => {
    const state = settings()
    state.remoteChannel.channels = [{
      id: 'channel-1',
      provider: 'feishu',
      label: 'sciforge',
      enabled: true,
      model: 'auto',
      workspaceRoot: '',
      conversations: [],
      agentProfile: {
        name: 'sciforge',
        description: '',
        identity: '',
        personality: '',
        userContext: '',
        replyRules: ''
      },
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z'
    }]

    const prompt = buildRemoteChannelRuntimePrompt(state, 'hi', { channel: state.remoteChannel.channels[0] })

    expect(prompt).toContain('[Remote channel managed instructions]')
    expect(prompt).toContain('[Agent name]\nsciforge')
    expect(prompt).not.toContain('gui_schedule')
    expect(prompt).not.toContain('scheduled-task tools')
  })

  it('parses managed IM prompts into compact display text', () => {
    const parsed = parseRemoteChannelUserPromptForDisplay([
      '[Remote channel managed instructions]',
      '',
      '[Remote channel agent instructions]',
      '',
      '[Agent name]',
      'sciforge',
      '',
      '---',
      '[Current user request]',
      '[Feishu / Lark inbound message]',
      'Chat type: p2p',
      'Sender: user-1',
      '',
      'hi'
    ].join('\n'))

    expect(parsed).toMatchObject({
      text: 'hi',
      managed: true,
      inbound: true,
      sender: 'user-1',
      chatType: 'p2p'
    })
  })

  it('parses Discord inbound prompts with the current remote-channel display logic', () => {
    const parsed = parseRemoteChannelUserPromptForDisplay([
      '[Remote channel managed instructions]',
      '',
      '[Remote channel agent instructions]',
      '',
      '[Agent name]',
      'discord agent',
      '',
      '---',
      '[Current user request]',
      '[Discord inbound message]',
      'Guild: gzy的服务器',
      'Channel: #debug',
      'Sender: gzy',
      '',
      '你想我吗'
    ].join('\n'))

    expect(parsed).toMatchObject({
      text: '你想我吗',
      managed: true,
      inbound: true,
      sourceLabel: 'Discord',
      sender: 'gzy'
    })
  })

  it('does not unwrap legacy Claw managed prompt prefixes for display', () => {
    const legacyPrefixes = [
      '[Claw managed instructions]',
      '[Claw IM agent instructions]\n\n[Agent name]\nlegacy',
      'Claw skill policy: prefer these configured skills when relevant: old-skill.'
    ]

    for (const prefix of legacyPrefixes) {
      const prompt = [
        prefix,
        '',
        '---',
        '[Current user request]',
        '[Discord inbound message]',
        'Guild: gzy的服务器',
        'Channel: #debug',
        'Sender: gzy',
        '',
        '你想我吗'
      ].join('\n')

      expect(parseRemoteChannelUserPromptForDisplay(prompt)).toEqual({
        text: prompt,
        managed: false,
        inbound: false
      })
    }
  })

  it('does not parse inbound prompts that omit the canonical blank separator', () => {
    const parsed = parseRemoteChannelUserPromptForDisplay([
      '[Remote channel managed instructions]',
      '',
      '---',
      '[Current user request]',
      '[Discord inbound message]',
      'Guild: gzy的服务器',
      'Channel: #debug',
      'Sender: gzy',
      '你想我吗'
    ].join('\n'))

    expect(parsed).toEqual({
      text: [
        '[Discord inbound message]',
        'Guild: gzy的服务器',
        'Channel: #debug',
        'Sender: gzy',
        '你想我吗'
      ].join('\n'),
      managed: true,
      inbound: false
    })
  })
})

describe('write inline completion runtime config', () => {
  it('uses the Model Router base URL instead of the General provider URL', () => {
    const state = settings()
    state.provider.baseUrl = 'https://general.example/v1'
    expect(resolveWriteInlineCompletionBaseUrl(state)).toBe('http://127.0.0.1:3892/v1')
  })

  it('drops legacy write-only baseUrl overrides from runtime-facing calls', () => {
    const state = settings()
    state.provider.baseUrl = 'https://general.example/v1'
    state.write.inlineCompletion = {
      ...state.write.inlineCompletion,
      baseUrl: 'https://write-only.example/v1'
    } as AppSettingsV1['write']['inlineCompletion']
    expect(resolveWriteInlineCompletionBaseUrl(state)).toBe('http://127.0.0.1:3892/v1')
  })

  it('uses the Model Router public alias instead of the local runtime model', () => {
    const state = settings()
    state.agents.sciforge.model = 'deepseek-chat'
    expect(resolveWriteInlineCompletionModel(state)).toBe('sciforge-router')
  })

  it('drops legacy write model overrides from runtime-facing calls', () => {
    const state = settings()
    state.agents.sciforge.model = 'deepseek-chat'
    state.write.inlineCompletion = {
      ...state.write.inlineCompletion,
      inheritModel: false,
      model: 'deepseek-v4-flash'
    } as AppSettingsV1['write']['inlineCompletion']

    expect(resolveWriteInlineCompletionModel(state)).toBe('sciforge-router')
  })

  it('tolerates legacy write inline settings without new override fields', () => {
    const state = settings()
    state.provider.apiKey = 'general-key'
    state.provider.baseUrl = 'https://general.example/v1'
    state.modelRouter = {
      ...defaultModelRouterSettings(),
      ...state.modelRouter,
      runtimeApiKey: 'local-runtime-router-key'
    }
    state.agents.sciforge.model = 'deepseek-chat'
    const legacyInlineCompletion = { ...state.write.inlineCompletion } as Partial<AppSettingsV1['write']['inlineCompletion']> & {
      apiKey?: string
      baseUrl?: string
      inheritModel?: boolean
      model?: string
    }
    delete legacyInlineCompletion.apiKey
    delete legacyInlineCompletion.baseUrl
    delete legacyInlineCompletion.inheritModel
    delete legacyInlineCompletion.model
    state.write.inlineCompletion = legacyInlineCompletion as AppSettingsV1['write']['inlineCompletion']

    expect(resolveWriteInlineCompletionApiKey(state)).toBe('local-runtime-router-key')
    expect(resolveWriteInlineCompletionBaseUrl(state)).toBe('http://127.0.0.1:3892/v1')
    expect(resolveWriteInlineCompletionModel(state)).toBe('sciforge-router')
  })

  it('keeps legacy flash defaults behind the Model Router public alias', () => {
    const state = settings()
    state.agents.sciforge.model = 'deepseek-chat'
    const legacyInlineCompletion = {
      ...state.write.inlineCompletion,
      model: 'deepseek-v4-flash'
    } as Partial<AppSettingsV1['write']['inlineCompletion']> & {
      inheritModel?: boolean
      model?: string
    }
    delete legacyInlineCompletion.inheritModel
    state.write.inlineCompletion = legacyInlineCompletion as AppSettingsV1['write']['inlineCompletion']

    expect(resolveWriteInlineCompletionModel(state)).toBe('sciforge-router')
  })
})
