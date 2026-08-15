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
  DEFAULT_SCHEDULE_INTERNAL_PORT,
  defaultModelRouterSettings,
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
  defaultSkillsSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  defaultKeyboardShortcuts,
  getActiveAgentRuntime,
  getActiveAgentApiKey,
  getCodexRuntimeSettings,
  getClaudeRuntimeSettings,
  getComputerUseSettings,
  getModelAccessSettings,
  isComputerUseEnabledForRuntime,
  getAgentCapabilitySettings,
  isLocalRuntimeInsecure,
  listModelRouterModelIds,
  mergeSkillsSettings,
  normalizeAppSettings,
  normalizeModelAccessSettings,
  normalizeModelRouterSettings,
  normalizeRuntimeGuardSettings,
  normalizeScheduleSettings,
  resolveLocalRuntimeSettings,
  resolveSpeechToTextSettings,
  resolveWriteInlineCompletionApiKey,
  resolveWriteInlineCompletionBaseUrl,
  resolveWriteInlineCompletionModel,
  type AppSettingsV1
} from './app-settings'

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
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
    skills: defaultSkillsSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

describe('skills settings', () => {
  it('normalizes and merges generic extra directories', () => {
    expect(defaultSkillsSettings()).toEqual({ extraDirs: [] })
    expect(mergeSkillsSettings(defaultSkillsSettings(), {
      extraDirs: [' /tmp/skills ', '/tmp/skills', '', '/tmp/other']
    })).toEqual({ extraDirs: ['/tmp/skills', '/tmp/other'] })
    expect(appSettingsExports).toHaveProperty('defaultSkillsSettings')
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
        maxParallel: 2
      }
    })
  })

  it('normalizes shared agent capability settings', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      agentCapabilities: {
        subagents: {
          enabled: false,
          maxParallel: 99
        }
      }
    })

    expect(getAgentCapabilitySettings(normalized)).toEqual({
      subagents: {
        enabled: false,
        maxParallel: 64
      }
    })
  })

  it('merges shared agent capability patches', () => {
    expect(mergeAgentCapabilitySettings(defaultAgentCapabilitySettings(), {
      subagents: { maxParallel: 3 }
    })).toEqual({
      subagents: {
        enabled: true,
        maxParallel: 3
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

  it('defaults advanced local runtime settings to conservative values', () => {
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
      }
    })
  })

  it('defaults runtime guard settings to runtime-neutral execution governance limits', () => {
    expect(defaultRuntimeGuardSettings()).toMatchObject({
      execution: {
        enabled: true,
        windowSize: 8,
        exactRepeatThreshold: 3
      }
    })
  })

  it('defaults computer use to the GUI-Owl sidecar path', () => {
    expect(defaultComputerUseSettings()).toEqual({
      enabled: true,
      runtimeEnabled: {
        sciforge: false,
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
        sciforge: false,
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
        sciforge: false,
        codex: true,
        claude: true
      }
    })
  })

  it('normalizes runtime guard execution governance settings', () => {
    expect(normalizeRuntimeGuardSettings({
      execution: {
        enabled: false,
        windowSize: 10,
        exactRepeatThreshold: 5
      }
    }).execution).toMatchObject({
      enabled: false,
      windowSize: 10,
      exactRepeatThreshold: 5
    })
  })

  it('drops legacy runtime guard soft and hard thresholds', () => {
    expect(normalizeRuntimeGuardSettings({
      execution: {
        softThreshold: 5,
        hardThreshold: 7
      }
    } as never).execution).toMatchObject({
      enabled: true,
      windowSize: 8,
      exactRepeatThreshold: 3
    })
  })

  it('does not interpret obsolete ambiguous or semantic failure thresholds', () => {
    expect(normalizeRuntimeGuardSettings({
      execution: { threshold: 7, semanticFailureThreshold: 9 }
    } as never).execution).toMatchObject({
      exactRepeatThreshold: 3
    })
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

describe('obsolete settings fields', () => {
  it('ignores legacy domain-owned fields without retaining them in normalized settings', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      evidenceDag: { enabled: false }
    } as AppSettingsV1)

    expect('evidenceDag' in normalized).toBe(false)
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
        sciforge: false,
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
        sciforge: false,
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
      sciforge: false,
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
      }
    })

    expect(next.storage.backend).toBe('hybrid')
    expect(next.storage.sqlitePath).toBe('/tmp/sciforge.sqlite3')
    expect(next.contextCompaction.defaultSoftThreshold).toBe(64000)
    expect(next.contextCompaction.defaultHardThreshold).toBe(64000)
    expect(next.contextCompaction.summaryMode).toBe('heuristic')
  })

  it('deep-merges runtime guard settings through the new config model', () => {
    const next = mergeRuntimeGuardSettings(defaultRuntimeGuardSettings(), {
      execution: {
        exactRepeatThreshold: 5
      }
    })

    expect(next.execution).toMatchObject({
      enabled: true,
      windowSize: 8,
      exactRepeatThreshold: 5
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
  it('migrates the legacy SciForge selection to Codex', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      agents: {
        sciforge: defaultLocalRuntimeSettings()
      }
    })

    expect(getActiveAgentRuntime(normalized)).toBe('codex')
    expect(getCodexRuntimeSettings(normalized)).toEqual(expect.objectContaining({
      command: 'codex',
      codexHome: DEFAULT_CODEX_DATA_DIR,
      autoStart: true
    }))
  })

  it('normalizes invalid runtime ids to Codex', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      activeAgentRuntime: 'mystery-runtime'
    } as unknown as AppSettingsV1)

    expect(getActiveAgentRuntime(normalized)).toBe('codex')
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
      activeAgentRuntime: 'codex'
    })

    expect(getActiveAgentApiKey(normalized)).toBe('')
  })

  it('uses the Model Router runtime API key while Codex is the active runtime', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      activeAgentRuntime: 'codex',
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

  it('normalizes an explicit generic model access mode and adapter id', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      modelAccess: {
        mode: 'coding-plan',
        planAdapterId: 'example-plan'
      }
    })

    expect(getModelAccessSettings(normalized)).toEqual({
      mode: 'coding-plan',
      planAdapterId: 'example-plan'
    })
    expect(normalizeModelAccessSettings({ mode: 'invalid' as never })).toBeUndefined()
  })

  it('keeps an unconfigured Model Router image generator generic', () => {
    expect(defaultModelRouterSettings().profiles.default.imageGenerator.model).toBe('')

    const normalized = normalizeAppSettings({
      ...settings(),
      modelRouter: {
        ...defaultModelRouterSettings(),
        profiles: {
          default: {
            ...defaultModelRouterSettings().profiles.default,
            imageGenerator: {
              baseUrl: 'https://image.example/v1',
              apiKey: 'image-key',
              model: ''
            }
          }
        }
      }
    })

    expect(normalized.modelRouter?.profiles.default.imageGenerator.model).toBe('')
  })

  it('preserves an explicitly configured Model Router image generator model', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      modelRouter: {
        ...defaultModelRouterSettings(),
        profiles: {
          default: {
            ...defaultModelRouterSettings().profiles.default,
            imageGenerator: {
              baseUrl: 'https://legacy-image.example/v1',
              apiKey: 'legacy-image-key',
              model: 'legacy-image-model'
            }
          }
        }
      }
    })

    expect(normalized.modelRouter?.profiles.default.imageGenerator.model).toBe('legacy-image-model')
  })

  it('normalizes Model Router protocol preferences without provider inference', () => {
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
                baseUrl: 'https://vision.example/v1',
                apiKey: 'vision-key',
                model: 'vision-model',
                protocol: 'anthropic-messages'
              },
              scientific: defaultModelRouterSettings().profiles.default.translators.scientific
            }
          }
        }
      }
    })

    expect(normalized.modelRouter?.profiles.default.translators.vision).toEqual({
      baseUrl: 'https://vision.example/v1',
      apiKey: 'vision-key',
      model: 'vision-model',
      protocol: 'anthropic-messages'
    })
    expect(listModelRouterModelIds(normalized)).toEqual(['sciforge-router'])
  })

  it('does not preserve a legacy Model Router provider field', () => {
    const normalized = normalizeModelRouterSettings({
      profiles: {
        default: {
          textReasoner: {
            provider: 'legacy-provider',
            baseUrl: 'https://text.example/v1',
            apiKey: 'text-key',
            model: 'text-model'
          } as never
        }
      }
    })

    expect(normalized.profiles.default.textReasoner).toEqual({
      baseUrl: 'https://text.example/v1',
      apiKey: 'text-key',
      model: 'text-model',
      protocol: 'auto'
    })
    expect(normalized.profiles.default.textReasoner).not.toHaveProperty('provider')
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

  it('normalizes full-access runtimes to automatic approval policies', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      agents: {
        sciforge: {
          ...defaultLocalRuntimeSettings(),
          sandboxMode: 'danger-full-access',
          approvalPolicy: 'on-request'
        },
        codex: {
          ...defaultCodexRuntimeSettings(),
          sandboxMode: 'danger-full-access',
          approvalPolicy: 'on-request'
        },
        claude: {
          ...defaultClaudeRuntimeSettings(),
          sandboxMode: 'danger-full-access',
          approvalPolicy: 'on-request'
        }
      }
    })

    expect(normalized.agents.sciforge).toEqual(expect.objectContaining({
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'auto'
    }))
    expect(getCodexRuntimeSettings(normalized)).toEqual(expect.objectContaining({
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'never'
    }))
    expect(getClaudeRuntimeSettings(normalized)).toEqual(expect.objectContaining({
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'auto'
    }))
  })
})

describe('local runtime settings normalization', () => {
  it('drops the removed top-level provider credential chain', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      provider: {
        apiKey: 'sk-legacy',
        baseUrl: 'https://legacy.example/v1',
        providers: []
      }
    } as unknown as AppSettingsV1)

    expect(normalized).not.toHaveProperty('provider')
  })

  it('drops local runtime credential fields', () => {
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

  it('drops the removed local runtime provider selection', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      agents: {
        sciforge: {
          ...defaultLocalRuntimeSettings(),
          providerId: 'custom-provider-2',
          model: 'custom-model'
        }
      }
    } as unknown as AppSettingsV1)

    expect(normalized.agents.sciforge).not.toHaveProperty('providerId')
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

  it('normalizes and merges schedule patches independently', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      schedule: undefined as unknown as AppSettingsV1['schedule']
    })

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
      runtimeId: 'codex',
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

describe('write inline completion runtime config', () => {
  it('uses the Model Router base URL', () => {
    const state = settings()
    expect(resolveWriteInlineCompletionBaseUrl(state)).toBe('http://127.0.0.1:3892/v1')
  })

  it('drops legacy write-only baseUrl overrides from runtime-facing calls', () => {
    const state = settings()
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
