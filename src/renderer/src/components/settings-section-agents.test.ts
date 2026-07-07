import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  defaultModelRouterSettings,
  defaultCodexRuntimeSettings,
  defaultLocalRuntimeSettings
} from '@shared/app-settings'
import { AgentsSettingsSection, codexRuntimeSettingsPatch } from './settings-section-agents'

const labels: Record<string, string> = {
  agentsQuickBase: 'Base',
  agentsQuickSkill: 'Skills',
  agentsQuickMcp: 'MCP',
  agentsQuickPermissions: 'Permissions',
  agentsQuickLocalRuntimePermissions: 'SciForge Runtime access',
  agents: 'Agents',
  agentRuntime: 'Agent runtime',
  agentRuntimeDesc: 'Choose which runtime powers Code mode and chat.',
  agentRuntimeSciForge: 'SciForge Runtime',
  agentRuntimeCodex: 'Codex app-server',
  agentRuntimeClaude: 'Claude Code CLI',
  modelRouter: 'Model Router',
  modelRouterConfigFile: 'Model Router config file',
  modelRouterConfigFileDesc: 'Edit provider members, routing rules, and upstream credentials in the local config file.',
  modelRouterOpenConfigFile: 'Open Model Router config file',
  modelRouterOpenConfigFileError: 'Could not open Model Router config file: {{message}}',
  modelRouterOpenConfigFileUnavailable: 'Model Router config file opener is unavailable.',
  codexRuntime: 'Codex app-server',
  codexRuntimeDesc: 'Codex runtime description',
  codexCommand: 'Command',
  codexCommandDesc: 'Command description',
  codexCommandPlaceholder: 'codex',
  codexHome: 'Codex home',
  codexHomeDesc: 'Codex home description',
  codexHomePlaceholder: '~/.sciforge/codex',
  codexProfile: 'Profile',
  codexProfileDesc: 'Profile description',
  codexProfilePlaceholder: 'default',
  codexExtraArgs: 'Extra arguments',
  codexExtraArgsDesc: 'Extra arguments description',
  codexExtraArgsPlaceholder: '--search',
  claudeRuntime: 'Claude Code CLI',
  claudeRuntimeDesc: 'Claude runtime description',
  claudeCommand: 'Command',
  claudeCommandDesc: 'Command description',
  claudeCommandPlaceholder: 'claude',
  claudeConfigDir: 'Claude config dir',
  claudeConfigDirDesc: 'Claude config dir description',
  claudeConfigDirPlaceholder: '~/.sciforge/claude-code',
  claudeModel: 'Model note',
  claudeModelDesc: 'Model note description',
  claudeApprovalPolicyDesc: 'Claude approval description',
  claudeSandboxModeDesc: 'Claude sandbox description',
  claudeExtraArgs: 'Extra arguments',
  claudeExtraArgsDesc: 'Extra arguments description',
  claudeExtraArgsPlaceholder: '--allowedTools Edit',
  localRuntimeServiceAdvanced: 'Local Runtime service settings',
  localRuntimeServiceAdvancedDesc: 'Local Runtime service settings description',
  autoStart: 'Auto start',
  autoStartDesc: 'Auto start description',
  port: 'Port',
  portDesc: 'Port description',
  localRuntimeBinary: 'Local Runtime binary',
  localRuntimeBinaryDesc: 'Local Runtime binary description',
  localRuntimeBinaryPlaceholder: 'Bundled Local Runtime',
  localRuntimeDataDir: 'Data dir',
  localRuntimeDataDirDesc: 'Data dir description',
  localRuntimeTokenEconomy: 'Token-saving mode',
  localRuntimeTokenEconomyDesc: 'Token-saving mode description',
  localRuntimeTokenEconomySavings: 'Saved {{tokens}} / {{cost}}',
  localRuntimeTokenEconomySavingsLoading: 'Loading savings',
  localRuntimeTokenEconomySavingsEmpty: 'Savings empty',
  localRuntimeTokenEconomyAdvanced: 'Token-saving advanced settings',
  localRuntimeTokenEconomyAdvancedDesc: 'Token-saving advanced settings description',
  localRuntimeTokenEconomyOptions: 'Token-saving options',
  localRuntimeTokenEconomyOptionsDesc: 'Token-saving options description',
  localRuntimeCompressToolDescriptions: 'Compress tool descriptions',
  localRuntimeCompressToolResults: 'Compress tool results',
  localRuntimeConciseResponses: 'Concise responses',
  localRuntimeHistoryHygiene: 'History guard',
  localRuntimeHistoryHygieneDesc: 'History guard description',
  localRuntimeHistoryMaxResultLines: 'Max result lines',
  localRuntimeHistoryMaxResultBytes: 'Max result bytes',
  localRuntimeHistoryMaxResultTokens: 'Max result tokens',
  localRuntimeHistoryMaxArgumentBytes: 'Max argument bytes',
  localRuntimeHistoryMaxArgumentTokens: 'Max argument tokens',
  localRuntimeHistoryMaxArrayItems: 'Max array items',
  runtimeToken: 'Runtime token',
  runtimeTokenDesc: 'Runtime token description',
  showSecret: 'Show',
  hideSecret: 'Hide',
  localRuntimeInsecure: 'Insecure',
  localRuntimeInsecureDesc: 'Insecure description',
  localRuntimeInsecureForcedDesc: 'Insecure forced',
  localRuntimeAdvanced: 'Advanced runtime settings',
  localRuntimeAdvancedDetails: 'Storage, model context, and tool guards',
  localRuntimeAdvancedDetailsDesc: 'Per-model context policy comes from models.profiles',
  localRuntimeStorageBackend: 'Storage backend',
  localRuntimeStorageBackendDesc: 'Storage backend description',
  localRuntimeStorageHybrid: 'Hybrid storage',
  localRuntimeStorageFile: 'Pure JSONL file storage',
  localRuntimeStorageSqlitePath: 'SQLite path',
  localRuntimeStorageSqlitePathDesc: 'SQLite path description',
  localRuntimeStorageSqlitePathPlaceholder: 'Automatic SQLite path',
  localRuntimeModelContextProfile: 'Current model context policy',
  localRuntimeModelContextProfileDesc: 'Current model context policy description',
  localRuntimeModelContextModel: 'Matched model',
  localRuntimeModelContextWindow: 'Context window',
  localRuntimeModelContextSoft: 'Model soft threshold',
  localRuntimeModelContextHard: 'Model hard threshold',
  localRuntimeModelContextSourceBuiltIn: 'Built-in model config',
  localRuntimeModelContextSourceFallback: 'Fallback model config',
  localRuntimeCompactionThresholds: 'Fallback compaction thresholds',
  localRuntimeCompactionThresholdsDesc: 'Fallback compaction thresholds description',
  localRuntimeCompactionSoftThreshold: 'Fallback soft threshold',
  localRuntimeCompactionHardThreshold: 'Fallback hard threshold',
  localRuntimeCompactionSummary: 'Compaction summary',
  localRuntimeCompactionSummaryDesc: 'Compaction summary description',
  localRuntimeCompactionSummaryMode: 'Summary mode',
  localRuntimeCompactionSummaryHeuristic: 'Heuristic summary',
  localRuntimeCompactionSummaryModel: 'Model summary',
  localRuntimeCompactionSummaryTimeout: 'Summary timeout',
  localRuntimeCompactionSummaryMaxTokens: 'Summary max tokens',
  localRuntimeCompactionSummaryInputBytes: 'Summary input bytes',
  runtimeGuardToolStorm: 'Runtime guard',
  runtimeGuardToolStormDesc: 'Runtime guard description',
  runtimeGuardToolStormLimits: 'Tool storm limits',
  runtimeGuardToolStormLimitsDesc: 'Tool storm limits description',
  runtimeGuardToolStormWindowSize: 'Tool storm window',
  runtimeGuardToolStormSoftThreshold: 'Soft threshold',
  runtimeGuardToolStormHardThreshold: 'Hard threshold',
  localRuntimeToolArgumentRepair: 'Tool argument repair',
  localRuntimeToolArgumentRepairDesc: 'Tool argument repair description',
  localRuntimeDiagnostics: 'SciForge Runtime diagnostics',
  localRuntimeDiagnosticsAdvanced: 'Detailed diagnostics',
  localRuntimeDiagnosticsAdvancedDesc: 'Detailed diagnostics description',
  localRuntimeCapabilities: 'Runtime capabilities',
  localRuntimeCapabilitiesDesc: 'Runtime capabilities description',
  localRuntimeDiagnosticsModel: 'Runtime model',
  localRuntimeDiagnosticsPid: 'Runtime PID',
  localRuntimeDiagnosticsRefresh: 'Refresh diagnostics',
  localRuntimeToolDiagnostics: 'Tool diagnostics',
  localRuntimeToolDiagnosticsDesc: 'Tool diagnostics description',
  localRuntimeDiagnosticsProviders: 'Providers',
  localRuntimeDiagnosticsMcpServers: 'MCP servers',
  localRuntimeDiagnosticsSkills: 'Discovered Skills',
  localRuntimeDiagnosticsAttachments: 'Attachments',
  localRuntimeMemoryRecords: 'Memory records',
  localRuntimeMemoryRecordsDesc: 'Memory records description',
  localRuntimeMemoryEmpty: 'No memories',
  localRuntimeMemoryDisable: 'Disable memory',
  localRuntimeMemoryDelete: 'Delete memory',
  localRuntimeMemoryDisabled: 'Disabled',
  skill: 'Skill',
  skillsLocation: 'Skill location',
  skillsLocationDesc: 'Skill location description',
  skillsPath: 'Skills path',
  skillsPathDesc: 'Skills path description',
  skillsRootUnavailable: 'Unavailable',
  skillsScanDirs: 'Scan dirs',
  skillsScanDirsDesc: 'Scan dirs description',
  skillsActions: 'Skill actions',
  skillsActionsDesc: 'Skill actions description',
  skillsOpenRoot: 'Open root',
  skillsOpenPlugins: 'Open plugins',
  mcp: 'MCP',
  mcpSearchEnabled: 'MCP search enabled',
  mcpSearchEnabledDesc: 'MCP search description',
  mcpAdvanced: 'MCP advanced settings',
  mcpAdvancedDesc: 'MCP advanced settings description',
  mcpSearchMode: 'MCP search mode',
  mcpSearchModeDesc: 'MCP search mode description',
  mcpSearchModeAuto: 'Auto mode',
  mcpSearchModeSearch: 'Search mode',
  mcpSearchModeDirect: 'Direct mode',
  mcpSearchLimits: 'MCP search limits',
  mcpSearchLimitsDesc: 'MCP search limits description',
  mcpSearchAutoThreshold: 'Auto threshold',
  mcpSearchTopKDefault: 'Default results',
  mcpSearchTopKMax: 'Max results',
  mcpSearchMinScore: 'Minimum score',
  mcpSearchDiagnostics: 'MCP search diagnostics',
  mcpSearchDiagnosticsDesc: 'MCP search diagnostics description',
  mcpSearchStatus: 'MCP search status',
  mcpSearchActive: 'Active',
  mcpSearchInactive: 'Inactive',
  mcpSearchIndexed: 'Indexed',
  mcpSearchAdvertised: 'Advertised',
  configFilePath: 'External tool config path',
  mcpPathDesc: 'MCP JSON path description',
  mcpEditor: 'MCP editor',
  mcpEditorDesc: 'Model and API credentials do not live in this MCP file',
  mcpFileStatusReady: 'MCP config ready',
  mcpFileStatusMissing: 'MCP config missing',
  loading: 'Loading',
  mcpActions: 'MCP actions',
  mcpRuntimeHint: 'MCP runtime hint',
  mcpSave: 'Save MCP config',
  mcpReload: 'Reload MCP config',
  mcpOpenDir: 'Open MCP directory',
  computerUseTitle: 'Computer use',
  computerUseHint: 'GUI-managed computer use defaults to isolated browser-cdp.',
  computerUseEnable: 'Enable computer use',
  computerUseEnableDesc: 'Expose the GUI-managed computer-use MCP server.',
  computerUseRuntimeAccess: 'Runtime access',
  computerUseRuntimeAccessDesc: 'Choose runtime access.',
  computerUseBackend: 'Backend status',
  computerUseBackendDesc: 'Shows the configured backend and latest runtime diagnostic.',
  computerUseConfiguredBackend: 'Configured',
  computerUseRuntimeBackend: 'Runtime',
  computerUsePlatform: 'Platform',
  computerUseBackendAvailable: 'available',
  computerUseBackendUnavailable: 'unavailable',
  computerUseBackendUnknown: 'not reported',
  computerUseSafetyInputSurface: 'Input surface',
  computerUseSafetyInputAgentIsolated: 'isolated browser',
  computerUseSafetyInputHostGlobal: 'host desktop',
  computerUseSafetyInputHostAppScoped: 'selected app/window',
  computerUseSafetyInputHostApproved: 'GUI approved desktop',
  computerUseSafetyInputUnknown: 'not reported',
  computerUseSafetyUserInput: 'User input',
  computerUseSafetyUserInputIsolated: 'does not affect active input',
  computerUseSafetyUserInputHost: 'can affect active input',
  computerUseSafetyHostFocus: 'Host focus',
  computerUseSafetyHostFocusNotRequired: 'not required',
  computerUseSafetyHostFocusRequired: 'required',
  computerUseSafetyClipboard: 'Clipboard',
  computerUseSafetyClipboardNotUsed: 'not used',
  computerUseSafetyClipboardUsed: 'can be used',
  computerUseRefresh: 'Refresh status',
  computerUseDisabledHint: 'Computer use is disabled in settings.',
  computerUsePermissions: 'macOS permissions',
  computerUsePermissionsDesc: 'Accessibility and Screen Recording permissions.',
  computerUseAccessibility: 'Accessibility',
  computerUseScreenRecording: 'Screen Recording',
  computerUsePermission_granted: 'granted',
  computerUsePermission_denied: 'not granted',
  computerUsePermission_unknown: 'unknown',
  computerUsePermissionNeedsRestart: 'granted, restart needed',
  computerUseRestartHint: 'Restart SciForge before using computer use.',
  computerUseGrantAccessibility: 'Open Accessibility',
  computerUseGrantScreenRecording: 'Open Screen Recording',
  computerUseActiveLeases: 'Active leases',
  computerUseActiveLeasesDesc: 'Currently held computer-use targets.',
  computerUseNoActiveLeases: 'No active computer-use leases.',
  computerUseRecentRejections: 'Recent rejections',
  computerUseRecentRejectionsDesc: 'Most recent denials.',
  computerUseNoRecentRejections: 'No recent computer-use rejections.',
  permissions: 'Permissions',
  localRuntimePermissions: 'SciForge Runtime permissions',
  approvalPolicy: 'Approval policy',
  approvalPolicyDesc: 'Approval policy description',
  approvalAuto: 'Auto',
  approvalOnRequest: 'On request',
  approvalUntrusted: 'Untrusted',
  approvalSuggest: 'Suggest',
  approvalNever: 'Never',
  sandboxMode: 'Sandbox mode',
  sandboxModeDesc: 'Sandbox description',
  sandboxWorkspaceWrite: 'Workspace write',
  sandboxReadOnly: 'Read only',
  sandboxFullAccess: 'Full access',
  sandboxExternal: 'External sandbox'
}

function t(key: string): string {
  return labels[key] ?? key
}

function baseCtx(): Record<string, unknown> {
  const noop = () => undefined
  const asyncNoop = async () => undefined
  const ref = { current: null }
  const localRuntime = {
    ...defaultLocalRuntimeSettings(),
    autoStart: true,
    runtimeToken: '',
    insecure: true
  }
  const codex = {
    ...defaultCodexRuntimeSettings(),
    command: 'codex-dev',
    codexHome: '/tmp/codex-home',
    profile: 'work',
    model: 'gpt-5-codex',
    modelProvider: 'openai',
    extraArgs: ['--search', '--quiet']
  }
  return {
    t,
    tCommon: t,
    form: {
      activeAgentRuntime: 'sciforge',
      agents: { sciforge: localRuntime, codex },
      remoteChannel: { skills: { extraDirs: ['/tmp/project/.agents/skills'] } }
    },
    localRuntime,
    codex,
    activeAgentRuntime: 'sciforge',
    update: noop,
    updateLocalRuntime: noop,
    updateCodex: noop,
    updateActiveAgentRuntime: noop,
    showRuntimeToken: false,
    setShowRuntimeToken: noop,
    portError: '',
    selectControlClass: 'select',
    openOnboardingPreview: noop,
    pickWorkspace: asyncNoop,
    resetWorkspaceToDefault: noop,
    workspacePickerError: '',
    guiUpdateInfo: null,
    checkingGuiUpdate: false,
    downloadingGuiUpdate: false,
    installingGuiUpdate: false,
    guiUpdateDownloaded: false,
    guiUpdateProgress: null,
    guiUpdateError: null,
    checkGuiUpdate: asyncNoop,
    downloadGuiUpdate: asyncNoop,
    installGuiUpdate: asyncNoop,
    logPath: '',
    logDirOpenError: '',
    setLogDirOpenError: noop,
    pickWriteWorkspace: asyncNoop,
    resetWriteWorkspaceToDefault: noop,
    writeWorkspacePickerError: '',
    writeInlineBaseUrlInherited: false,
    effectiveWriteInlineBaseUrl: '',
    writeInlineModelInherited: false,
    effectiveWriteInlineModel: '',
    setWriteDebugModalOpen: noop,
    loadWriteDebugEntries: asyncNoop,
    scrollToAgentSection: noop,
    agentsSectionRef: ref,
    skillSectionRef: ref,
    mcpSectionRef: ref,
    permissionsSectionRef: ref,
    selectedSkillRoot: {
      id: 'workspace',
      label: 'Workspace',
      path: '/tmp/project/.agents/skills',
      available: true
    },
    skillRootOptions: [
      {
        id: 'workspace',
        label: 'Workspace',
        path: '/tmp/project/.agents/skills',
        available: true
      }
    ],
    skillRootId: 'workspace',
    setSkillRootId: noop,
    skillNotice: null,
    openSkillRoot: asyncNoop,
    openPlugins: noop,
    mcpConfigPath: '/tmp/project/.sciforge/mcp.json',
    mcpConfigExists: true,
    mcpConfigText: '{"mcpServers":{}}',
    setMcpConfigText: noop,
    mcpLoading: false,
    mcpBusy: false,
    mcpNotice: null,
    saveMcpConfig: asyncNoop,
    loadMcpConfig: asyncNoop,
    openMcpConfigDir: asyncNoop,
    runtimeInfo: null,
    toolDiagnostics: null,
    memoryRecords: [],
    runtimeDiagnosticsBusy: false,
    runtimeDiagnosticsNotice: null,
    refreshLocalRuntimeDiagnostics: asyncNoop,
    disableMemoryRecord: asyncNoop,
    deleteMemoryRecord: asyncNoop,
    pickConnectPhoneWorkspace: asyncNoop,
    resetConnectPhoneWorkspaceToDefault: noop,
    connectPhoneWorkspacePickerError: '',
    splitSettingsList: (value: string) => value.split('\n').filter(Boolean),
    listSettingsText: (value: string[]) => value.join('\n')
  }
}

describe('AgentsSettingsSection SciForge Runtime diagnostics smoke', () => {
  it('wraps Codex runtime changes in agents.codex without touching SciForge Runtime settings', () => {
    const patch = codexRuntimeSettingsPatch({
      command: 'codex-dev',
      codexHome: '/tmp/codex-home',
      extraArgs: ['--search']
    })

    expect(patch).toEqual({
      agents: {
        codex: {
          command: 'codex-dev',
          codexHome: '/tmp/codex-home',
          extraArgs: ['--search']
        }
      }
    })
    expect(patch.agents?.sciforge).toBeUndefined()
  })

  it('renders Codex and Claude settings forms without the runtime selector', () => {
    const ctx = {
      ...baseCtx(),
      activeAgentRuntime: 'codex'
    }
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx }))

    expect(html).not.toContain('Agent runtime')
    expect(html).not.toContain('<option value="sciforge" selected="">SciForge Runtime</option>')
    expect(html).not.toContain('<option value="codex" selected="">Codex app-server</option>')
    expect(html).not.toContain('<option value="claude">Claude Code CLI</option>')
    expect(html).toContain('Codex app-server')
    expect(html).toContain('Claude Code CLI')
    expect(html).toContain('Command')
    expect(html).toContain('value="codex-dev"')
    expect(html).toContain('Codex home')
    expect(html).toContain('value="/tmp/codex-home"')
    expect(html).toContain('Profile')
    expect(html).toContain('value="work"')
    expect(html).not.toContain('value="gpt-5-codex"')
    expect(html).not.toContain('Model provider')
    expect(html).not.toContain('value="openai"')
    expect(html).toContain('Approval policy')
    expect(html).toContain('Sandbox mode')
    expect(html).toContain('Extra arguments')
    expect(html).toContain('--search')
    expect(html).toContain('--quiet')
  })

  it('omits Model Router service settings and member provider forms from Agents', () => {
    const ctx = baseCtx() as Record<string, any>
    const router = defaultModelRouterSettings()
    ctx.form = {
      ...ctx.form,
      modelRouter: {
        ...router,
        runtimeApiKey: 'local-runtime-key',
        profiles: {
          default: {
            textReasoner: {
              provider: 'openai-compatible',
              baseUrl: 'https://text-member.example/v1',
              apiKey: 'text-key',
              model: 'text-model'
            },
            imageGenerator: {
              provider: 'openai-compatible',
              baseUrl: 'https://image-member.example/v1',
              apiKey: 'image-key',
              model: 'image-model'
            },
            translators: {
              vision: {
                provider: 'qwen-compatible',
                baseUrl: 'https://vision-member.example/v1',
                apiKey: 'vision-key',
                model: 'vision-model'
              },
              scientific: {
                baseUrl: 'http://127.0.0.1:3898',
                apiKey: 'scientific-key',
                model: 'scientific-model'
              }
            }
          }
        }
      }
    }

    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx }))

    expect(html).not.toContain('Model Router')
    expect(html).not.toContain('Local router base URL')
    expect(html).not.toContain('Auto-start Model Router')
    expect(html).not.toContain('Runtime API key')
    expect(html).not.toContain('Public model alias')
    expect(html).not.toContain('Model Router config file')
    expect(html).not.toContain('Open Model Router config file')
    expect(html).not.toContain('Text member provider')
    expect(html).not.toContain('Vision member provider')
    expect(html).not.toContain('Provider member ID')
    expect(html).not.toContain('Provider member URL')
    expect(html).not.toContain('Provider member API key')
    expect(html).not.toContain('Provider member model')
    expect(html).not.toContain('Provider API key')
    expect(html).not.toContain('Provider description')
    expect(html).not.toContain('value="openai-compatible"')
    expect(html).not.toContain('value="qwen-compatible"')
    expect(html).not.toMatch(/direct upstream provider/i)
  })

  it('does not render Local Runtime credential override fields', () => {
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx: baseCtx() }))

    expect(html).not.toContain('Provider API key')
    expect(html).not.toContain('Provider description')
    expect(html).not.toContain('Local Runtime API key')
    expect(html).not.toContain('Local Runtime base URL')
    expect(html).not.toContain('Override API key')
    expect(html).not.toContain('Override base URL')
  })

  it('labels the bottom permissions section as runtime-specific when Codex is active', () => {
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, {
      ctx: {
        ...baseCtx(),
        activeAgentRuntime: 'codex'
      }
    }))

    expect(html).toContain('SciForge Runtime access')
    expect(html).toContain('SciForge Runtime permissions')
  })

  it('renders computer-use status, macOS restart guidance, active leases, and recent rejections', () => {
    const ctx = {
      ...baseCtx(),
      computerUseStatus: {
        settings: {
          enabled: true,
          runtimeEnabled: {
            sciforge: true,
            codex: true,
            claude: true
          }
        },
        permissions: {
          platform: 'darwin',
          supported: true,
          needsPermission: true,
          accessibility: 'denied',
          screenRecording: 'granted',
          accessibilityNeedsRestart: true
        },
        runtime: {
          updatedAt: '2026-06-23T00:00:00.000Z',
          servers: [],
          backend: {
            backend: 'gui-owl',
            available: true,
            platform: 'darwin',
            reason: 'GUI-Owl sidecar ready',
            inputIsolation: 'host-approved',
            affectsUserInput: true,
            requiresHostFocus: true,
            usesHostClipboard: false,
            activeLeases: [],
            recentRejections: []
          },
          activeLeases: [
            {
              leaseId: 'lease-1',
              computerUseSessionId: 'session-1',
              agentId: 'agent-main',
              threadId: 'thread-1',
              targetId: 'gui-owl:desktop',
              backend: 'gui-owl',
              inputIsolation: 'host-approved',
              affectsUserInput: true,
              acquiredAt: '2026-06-23T00:00:00.000Z',
              updatedAt: '2026-06-23T00:00:01.000Z'
            }
          ],
          recentRejections: [
            {
              code: 'target_in_use',
              message: 'main-desktop is already leased',
              targetId: 'main-desktop'
            }
          ]
        }
      }
    }

    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx }))

    expect(html).toContain('Computer use')
    expect(html).toContain('Enable computer use')
    expect(html).toContain('Runtime access')
    expect(html).toContain('Codex app-server')
    expect(html).toContain('Configured')
    expect(html).toContain('gui-owl')
    expect(html).toContain('available')
    expect(html).toContain('Input surface')
    expect(html).toContain('GUI approved desktop')
    expect(html).toContain('User input')
    expect(html).toContain('can affect active input')
    expect(html).toContain('Host focus')
    expect(html).toContain('required')
    expect(html).toContain('Clipboard')
    expect(html).toContain('not used')
    expect(html).not.toContain('inputIsolation')
    expect(html).not.toContain('host-approved')
    expect(html).not.toContain('affectsUserInput')
    expect(html).not.toContain('requiresHostFocus')
    expect(html).not.toContain('usesHostClipboard')
    expect(html).toContain('GUI-Owl sidecar ready')
    expect(html).toContain('macOS permissions')
    expect(html).toContain('Accessibility')
    expect(html).toContain('granted, restart needed')
    expect(html).toContain('Restart SciForge before using computer use.')
    expect(html).toContain('Screen Recording')
    expect(html).toContain('Active leases')
    expect(html).toContain('gui-owl:desktop')
    expect(html).toContain('agent-main')
    expect(html).toContain('Recent rejections')
    expect(html).toContain('target_in_use')
    expect(html).toContain('main-desktop is already leased')
  })

  it('does not expose default-runtime-specific permission choices in the Codex runtime form', () => {
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, {
      ctx: {
        ...baseCtx(),
        activeAgentRuntime: 'codex'
      }
    }))

    expect(html.match(/value="suggest"/g)).toHaveLength(1)
    expect(html.match(/value="external-sandbox"/g)).toHaveLength(1)
  })

  it('keeps advanced agent controls behind collapsed disclosures', () => {
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx: baseCtx() }))

    expect(html).toContain('Local Runtime service settings')
    expect(html).toContain('Token-saving advanced settings')
    expect(html).toContain('MCP advanced settings')
    expect(html).not.toContain('<details open')
  })

  it('renders the supported tool storm threshold without a hard-threshold control', () => {
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx: baseCtx() }))

    expect(html).toContain('Tool storm window')
    expect(html).toContain('Tool storm limits')
    expect(html).not.toContain('Hard threshold')
  })

  it('renders pure JSONL as a selectable storage backend', () => {
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx: baseCtx() }))

    expect(html).toContain('Storage backend')
    expect(html).toContain('<option value="hybrid"')
    expect(html).toContain('Hybrid storage')
    expect(html).toContain('<option value="file"')
    expect(html).toContain('Pure JSONL file storage')
  })

  it('shows public router alias compaction thresholds from the built-in model profile', () => {
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx: baseCtx() }))

    expect(html).toContain('Current model context policy')
    expect(html).toContain('sciforge-router')
    expect(html).toContain('Built-in model config')
    expect(html).toContain('1,000,000')
    expect(html).toContain('980,000')
    expect(html).toContain('990,000')
    expect(html).toContain('Fallback compaction thresholds')
  })

  it('renders MCP, Skill, web, attachment, and memory diagnostics', () => {
    const ctx = {
      ...baseCtx(),
      runtimeInfo: {
        pid: 123,
        capabilities: {
          model: { id: 'deepseek-chat' },
          mcp: { status: 'available', configuredServers: 2, connectedServers: 2 },
          web: { status: 'available', provider: 'brave-search' },
          skills: { status: 'available' },
          subagents: { status: 'available' },
          attachments: { status: 'available' },
          memory: { status: 'available' }
        }
      },
      toolDiagnostics: {
        providers: [{ id: 'builtin' }, { id: 'mcp' }, { id: 'web' }, { id: 'memory' }],
        mcpServers: [{ id: 'github' }],
        skills: { skills: [{ id: 'skill_docs' }] },
        attachments: { count: 1 }
      },
      memoryRecords: [
        {
          id: 'mem_1',
          content: 'Prefer pnpm for this workspace',
          scope: 'workspace',
          tags: ['tooling']
        }
      ]
    }

    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx }))

    expect(html).toContain('SciForge Runtime diagnostics')
    expect(html).toContain('MCP')
    expect(html).toContain('available')
    expect(html).toContain('2/2')
    expect(html).toContain('brave-search')
    expect(html).toContain('Providers')
    expect(html).toContain('MCP servers')
    expect(html).toContain('Discovered Skills')
    expect(html).toContain('Prefer pnpm for this workspace')
    expect(html).toContain('mem_1')
    expect(html).toContain('Disable memory')
    expect(html).toContain('Delete memory')
  })

  it('describes MCP config as an external-tool JSON file instead of model credentials', () => {
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx: baseCtx() }))

    expect(html).toContain('External tool config path')
    expect(html).toContain('/tmp/project/.sciforge/mcp.json')
    expect(html).toContain('Model and API credentials do not live in this MCP file')
    expect(html).not.toContain('DeepSeek auth')
    expect(html).not.toContain('Base URL are stored in this file')
    expect(html).not.toContain('config.toml')
  })
})
