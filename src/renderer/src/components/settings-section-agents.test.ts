import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  defaultClaudeRuntimeSettings,
  defaultCodexRuntimeSettings,
  defaultComputerUseSettings,
  defaultDshRuntimeSettings,
  permissionLevelFromRuntime,
  runtimePatchForPermissionLevel,
  type AgentRuntimeId
} from '@shared/app-settings'
import {
  AgentsSettingsSection,
  claudeRuntimeSettingsPatch,
  codexRuntimeSettingsPatch,
  dshRuntimeSettingsPatch,
  chooseCodexRuntimeExecutable,
  chooseDshRuntimeExecutable,
  probeCodexRuntimeCandidate,
  probeDshRuntimeCandidate,
  runLatestCodexRuntimeProbe,
  runLatestDshRuntimeProbe
} from './settings-section-agents'
import enSettings from '../locales/en/settings.json'
import zhSettings from '../locales/zh/settings.json'

const labels: Record<string, string> = {
  agents: 'Agents',
  agentsQuickBase: 'Assistant',
  agentsQuickSkill: 'Skills',
  agentsQuickMcp: 'External tools',
  agentsQuickPermissions: 'Access',
  codexRuntime: 'Codex app-server',
  codexRuntimeDesc: 'Configure Codex.',
  codexCommand: 'Executable',
  codexCommandDesc:
    'SciForge detects Codex automatically. Enter an absolute executable path to override detection.',
  codexCommandPlaceholder: 'codex',
  codexDefaultModel: 'Default model',
  codexDefaultModelDesc: 'Used when a new conversation is created.',
  codexDefaultReasoningEffort: 'Default reasoning effort',
  codexDefaultReasoningEffortDesc: 'Used when a new conversation is created.',
  codexDefaultServiceTier: 'Default speed',
  codexDefaultServiceTierDesc: 'Used when a new conversation is created.',
  codexModelAuto: 'Automatic (Codex/Profile default)',
  codexServiceTierAuto: 'Standard speed',
  codexModelCatalogUnavailable: 'Model discovery is unavailable.',
  codexReasoningUnsupported: 'This reasoning effort is unavailable for the selected model.',
  codexManagedHomeDesc:
    'Codex state is kept in an app-managed directory. This location is not configurable here.',
  codexDiscoveryAvailable: 'Codex is ready',
  codexDiscoveryUnavailable: 'Codex is unavailable',
  codexDiscoverySource_application_bundle: 'Application bundle',
  codexDiscoveryVersion: 'Version',
  codexDiscoveryAppServer: 'App-server support',
  codexDiscoverySupported: 'Supported',
  codexDiscoveryRedetect: 'Detect again',
  codexDiscoveryChoose: 'Choose local app',
  codexDiscoveryInstall: 'Installation guide',
  codexExtraArgs: 'Extra arguments',
  codexExtraArgsDesc: 'Codex argument explanation.',
  codexExtraArgsPlaceholder: '--search',
  runtimeDetails: 'Runtime details',
  runtimeDiscoveryDetectedFrom: 'Detected from',
  runtimeDiscoverySource_process_path: 'system application paths',
  runtimeDeploymentIntegrityPinned: 'Pinned artifact with a locked safety patch',
  runtimeDeploymentIntegrityDerived: 'Derived safety patch from the install config',
  runtimePermissionReconnectHint: 'Permission changes apply after reconnecting.',
  claudeRuntime: 'Claude Code CLI',
  claudeRuntimeDesc: 'Configure Claude Code.',
  claudeCommand: 'Executable',
  claudeCommandDesc:
    'SciForge detects Claude Code automatically. Enter an absolute executable path to override detection.',
  claudeCommandPlaceholder: 'claude',
  claudeManagedConfigDesc:
    'Claude Code configuration is kept in an app-managed directory. This location is not configurable here.',
  claudeModel: 'Model',
  claudeModelDesc: 'Optional Claude Code model override.',
  runtimeModelAutoPlaceholder: 'Automatic',
  claudeExtraArgs: 'Extra arguments',
  claudeExtraArgsDesc: 'Claude argument explanation.',
  claudeExtraArgsPlaceholder: '--allowedTools Edit',
  dshRuntime: 'DeepSeek Harness',
  dshRuntimeDesc: 'Configure DSH.',
  dshExecutablePath: 'Executable',
  dshExecutablePathPlaceholder: 'dsh',
  dshManagedConfigDesc: 'DSH is launched as a local ACP executable.',
  dshSelectedModel: 'Default model',
  dshModelAuto: 'Automatic (session default)',
  dshReasoningEffort: 'Reasoning effort',
  dshReasoningAuto: 'Automatic',
  dshCommandExecution: 'Shell command execution',
  dshCommandExecutionDesc: 'Enables the DSH native shell tools.',
  dshDiscoveryAvailable: 'DSH is ready',
  dshDiscoveryUnavailable: 'DSH is unavailable',
  dshDiscoveryRedetect: 'Detect again',
  dshDiscoveryChoose: 'Choose local app',
  dshDiscoveryInstall: 'Installation guide',
  dshDiscoveryApplications: 'Applications',
  dshDiscoveryAllFiles: 'All files',
  dshDiscoveryVersion: 'Version',
  dshDiscoverySession: 'ACP session',
  dshDiscoverySupported: 'Supported',
  dshDiscoveryUnsupported: 'Not supported',
  dshDiscoveryUnknown: 'Not detected',
  agentRuntimeDsh: 'DeepSeek Harness',
  codePromptPrefix: 'Code prompt prefix',
  codePromptPrefixDesc: 'Persistent instructions.',
  codePromptPrefixPlaceholder: 'Always run tests.',
  approvalPolicy: 'Approval policy',
  approvalPolicyDesc: 'Approval policy description',
  approvalFullAccessDesc: 'Full access approval description',
  claudeApprovalPolicyDesc: 'Claude approval description',
  approvalOnRequest: 'On request',
  approvalUntrusted: 'Untrusted',
  approvalNever: 'Never',
  permissionLevel: 'Permission level',
  permissionRequestApproval: 'Request approval',
  permissionAssistedApproval: 'Help approve',
  permissionFullAccess: 'Full access',
  approvalAuto: 'Auto',
  sandboxMode: 'Sandbox mode',
  sandboxModeDesc: 'Sandbox description',
  claudeSandboxModeDesc: 'Claude sandbox description',
  sandboxWorkspaceWrite: 'Workspace write',
  sandboxReadOnly: 'Read only',
  sandboxFullAccess: 'Full access',
  skill: 'Skills',
  skillsLocation: 'Skill location',
  skillsLocationDesc: 'Choose a skill root.',
  skillsPath: 'Skills path',
  skillsPathDesc: 'Selected skill root.',
  skillsRootUnavailable: 'Unavailable',
  skillsScanDirs: 'Additional skill directories',
  skillsScanDirsDesc: 'One per line.',
  skillsActions: 'Skill actions',
  skillsActionsDesc: 'Open skills or plugins.',
  skillsOpenRoot: 'Open root',
  skillsOpenPlugins: 'Open plugins',
  computerUseTitle: 'Computer use',
  computerUseHint:
    'GUI-managed computer use connects Codex or Claude Code to GUI-Owl.',
  computerUseEnable: 'Enable computer use',
  computerUseEnableDesc: 'Enable the service.',
  computerUseRuntimeAccess: 'Runtime access',
  computerUseRuntimeAccessDesc: 'Choose runtimes.',
  agentRuntimeSciForge: 'SciForge Runtime',
  agentRuntimeCodex: 'Codex app-server',
  agentRuntimeClaude: 'Claude Code CLI',
  computerUseBackend: 'Backend status',
  computerUseBackendDesc: 'Backend description',
  computerUseConfiguredBackend: 'Configured',
  computerUseRuntimeBackend: 'Runtime',
  computerUsePlatform: 'Platform',
  computerUseBackendAvailable: 'available',
  computerUseBackendUnavailable: 'unavailable',
  computerUseBackendUnknown: 'not reported',
  computerUseRefresh: 'Refresh status',
  computerUseDisabledHint: 'Computer use is disabled.',
  computerUseSafetyInputSurface: 'Input surface',
  computerUseSafetyInputHostApproved: 'GUI approved desktop',
  computerUseSafetyUserInput: 'User input',
  computerUseSafetyUserInputHost: 'can affect active input',
  computerUseSafetyHostFocus: 'Host focus',
  computerUseSafetyHostFocusRequired: 'required',
  computerUseSafetyClipboard: 'Clipboard',
  computerUseSafetyClipboardNotUsed: 'not used',
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
  computerUseActiveLeasesDesc: 'Active targets.',
  computerUseNoActiveLeases: 'No active leases.',
  computerUseRecentRejections: 'Recent rejections',
  computerUseRecentRejectionsDesc: 'Recent denials.',
  computerUseNoRecentRejections: 'No recent rejections.'
}

function t(key: string): string {
  return labels[key] ?? key
}

function baseCtx(): Record<string, unknown> {
  const noop = () => undefined
  const asyncNoop = async () => undefined
  const ref = { current: null }
  const codex = {
    ...defaultCodexRuntimeSettings(),
    command: '/opt/tools/codex',
    codexHome: '/tmp/hidden-codex-home',
    profile: 'hidden-profile',
    model: 'hidden-codex-model',
    extraArgs: ['--search', '--quiet']
  }
  const claude = {
    ...defaultClaudeRuntimeSettings(),
    command: '/opt/tools/claude',
    configDir: '/tmp/hidden-claude-config',
    model: 'sonnet',
    extraArgs: ['--allowedTools', 'Edit']
  }
  const dsh = {
    ...defaultDshRuntimeSettings(),
    executablePath: '/opt/tools/dsh',
    selectedModel: 'v4-flash',
    reasoningEffort: 'low'
  }
  return {
    t,
    tCommon: t,
    form: {
      agents: { codex, claude, dsh },
      computerUse: defaultComputerUseSettings(),
      codePromptPrefix: 'Prefer pnpm.',
      skills: { extraDirs: ['/tmp/project/.agents/skills'] }
    },
    codex,
    claude,
    dsh,
    update: noop,
    updateCodex: noop,
    updateClaude: noop,
    updateDsh: noop,
    selectControlClass: 'select',
    scrollToAgentSection: noop,
    agentsSectionRef: ref,
    skillSectionRef: ref,
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
    splitSettingsList: (value: string) => value.split('\n').filter(Boolean),
    listSettingsText: (value: string[]) => value.join('\n')
  }
}

describe('AgentsSettingsSection', () => {
  it('keeps English and Chinese Codex settings translation keys aligned', () => {
    const codexKeys = (value: Record<string, string>): string[] =>
      Object.keys(value).filter((key) => key.startsWith('codex')).sort()
    expect(codexKeys(enSettings)).toEqual(codexKeys(zhSettings))
    expect(codexKeys(enSettings).length).toBeGreaterThan(0)
  })

  it('keeps English and Chinese DSH settings translation keys aligned', () => {
    const dshKeys = (value: Record<string, string>): string[] =>
      Object.keys(value).filter((key) => key.startsWith('dsh')).sort()
    expect(dshKeys(enSettings)).toEqual(dshKeys(zhSettings))
    expect(dshKeys(enSettings).length).toBeGreaterThan(0)
  })

  it('wraps runtime patches without touching the removed custom runtime', () => {
    expect(codexRuntimeSettingsPatch({ command: '/opt/tools/codex' })).toEqual({
      agents: { codex: { command: '/opt/tools/codex' } }
    })
    expect(
      claudeRuntimeSettingsPatch({ command: '/opt/tools/claude' })
    ).toEqual({
      agents: { claude: { command: '/opt/tools/claude' } }
    })
    expect(
      dshRuntimeSettingsPatch({ executablePath: '/opt/tools/dsh' })
    ).toEqual({
      agents: { dsh: { executablePath: '/opt/tools/dsh' } }
    })
  })

  it('maps the three product permission levels to canonical runtime settings', () => {
    expect(runtimePatchForPermissionLevel('request-approval')).toEqual({
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write'
    })
    expect(runtimePatchForPermissionLevel('assisted-approval')).toEqual({
      approvalPolicy: 'untrusted',
      sandboxMode: 'workspace-write'
    })
    expect(runtimePatchForPermissionLevel('full-access')).toEqual({
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access'
    })
    expect(runtimePatchForPermissionLevel('full-access', 'auto')).toEqual({
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access'
    })
    expect(permissionLevelFromRuntime('on-request', 'workspace-write')).toBe('request-approval')
    expect(permissionLevelFromRuntime('untrusted', 'workspace-write')).toBe('assisted-approval')
    expect(permissionLevelFromRuntime('never', 'danger-full-access')).toBe('full-access')
  })

  it('keeps runtime settings focused on labels, values, actions, and folded technical details', () => {
    const html = renderToStaticMarkup(
      createElement(AgentsSettingsSection, { ctx: baseCtx() })
    )

    expect(html).toContain('value="/opt/tools/codex"')
    expect(html).toContain('value="/opt/tools/claude"')
    expect(html).toContain('value="sonnet"')
    expect(html).toContain('Approval policy')
    expect(html).toContain('Permission level')
    expect(html).toContain('Request approval')
    expect(html).toContain('Help approve')
    expect(html).toContain('Full access')
    expect(html).toContain('Sandbox mode')
    expect(html).toContain('--search')
    expect(html).toContain('--allowedTools')
    expect(html).toContain('data-runtime-details="codex"')
    expect(html).toContain('Runtime details')
    expect(html.match(/Permission changes apply after reconnecting\./gu)).toHaveLength(2)

    expect(html).not.toContain('Configure Codex.')
    expect(html).not.toContain('Configure Claude Code.')
    expect(html).not.toContain('SciForge detects Codex automatically')
    expect(html).not.toContain('SciForge detects Claude Code automatically')
    expect(html).not.toContain('Used when a new conversation is created.')
    expect(html).not.toContain('Approval policy description')
    expect(html).not.toContain('Sandbox description')
    expect(html).not.toContain('Claude approval description')
    expect(html).not.toContain('Claude sandbox description')
    expect(html).not.toContain('Codex argument explanation.')
    expect(html).not.toContain('Claude argument explanation.')

    expect(html).not.toContain('/tmp/hidden-codex-home')
    expect(html).not.toContain('/tmp/hidden-claude-config')
    expect(html).not.toContain('hidden-profile')
    expect(html).toContain('hidden-codex-model')
    expect(html).not.toContain('Auto start')
  })

  it('renders the DSH runtime block with static model and reasoning options', () => {
    const html = renderToStaticMarkup(
      createElement(AgentsSettingsSection, { ctx: baseCtx() })
    )

    expect(html).toContain('data-runtime-details="dsh"')
    expect(html).toContain('value="/opt/tools/dsh"')
    expect(html).toContain('Default model')
    expect(html).toContain('Automatic (session default)')
    expect(html).toContain('Reasoning effort')
    expect(html).toContain('value="v4-flash" selected="">')
    expect(html).toContain('value="v4-pro"')
    expect(html).toContain('value="low" selected="">')
    expect(html).toContain('value="off"')
    expect(html).toContain('value="max"')
    expect(html).toContain('DSH is unavailable')
  })

  it('shows structured DSH discovery status reported by the neutral probe', () => {
    const ctx = {
      ...baseCtx(),
      dshDiscovery: {
        runtimeId: 'dsh',
        available: true,
        executablePath: '/opt/tools/dsh',
        source: 'process-path',
        version: '0.9.0',
        protocol: { id: 'acp', supported: true },
        deploymentIntegrity: 'derived'
      }
    }
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx }))

    expect(html).toContain('DSH is ready')
    expect(html).toContain('0.9.0')
    expect(html).toContain('ACP session')
    expect(html).toContain('Supported')
    expect(html).toContain('/opt/tools/dsh')
    // Diagnostics name where the executable came from and how its deployment
    // closure is proven, so a discovered install is never mistaken for the pin.
    expect(html).toContain('Detected from')
    expect(html).toContain('system application paths')
    expect(html).toContain('Derived safety patch from the install config')

    const packaged = renderToStaticMarkup(createElement(AgentsSettingsSection, {
      ctx: {
        ...ctx,
        dshDiscovery: {
          runtimeId: 'dsh', available: true, executablePath: '/Applications/SciForge.app/dsh',
          source: 'packaged-application', version: '0.2.0-rc.2',
          protocol: { id: 'acp', supported: true }, deploymentIntegrity: 'pinned'
        }
      }
    }))
    expect(packaged).toContain('Pinned artifact with a locked safety patch')
  })

  it('shows the reviewed shell switch off by default and reflects an opted-in setting', () => {
    const render = (commandExecution: boolean) => renderToStaticMarkup(createElement(AgentsSettingsSection, {
      ctx: {
        ...baseCtx(),
        dsh: { ...defaultDshRuntimeSettings(), commandExecution }
      }
    }))
    // Fail-closed is visible: the switch renders unchecked until the user opts in.
    const off = render(false)
    expect(off).toContain('Shell command execution')
    expect(off).toContain('aria-checked="false"')
    const on = render(true)
    expect(on).toContain('Shell command execution')
    expect(on).toContain('aria-checked="true"')
  })

  it('renders runtime-discovered model, reasoning, and fast-mode options without model-name constants', () => {
    const ctx = {
      ...baseCtx(),
      codex: {
        ...defaultCodexRuntimeSettings(),
        command: '/opt/tools/codex',
        model: 'runtime-balanced'
      },
      codexModelCatalog: {
        available: true,
        complete: true,
        defaultModelId: 'runtime-frontier',
        models: [
          {
            id: 'runtime-frontier',
            displayName: 'Runtime Frontier',
            description: 'Discovered default',
            isDefault: true,
            inputModalities: ['text'],
            reasoningEfforts: [
              { id: 'medium', description: 'Balanced', isDefault: true },
              { id: 'ultra', description: 'Deepest', isDefault: false }
            ],
            serviceTiers: [
              { id: 'priority', displayName: 'Fast', description: 'Faster', isDefault: false }
            ]
          },
          {
            id: 'runtime-balanced',
            displayName: 'Runtime Balanced',
            description: 'Discovered alternative',
            isDefault: false,
            inputModalities: ['text'],
            reasoningEfforts: [
              { id: 'medium', description: 'Balanced', isDefault: true }
            ],
            serviceTiers: []
          }
        ]
      }
    }

    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx }))

    expect(html).toContain('Automatic (Codex/Profile default)')
    expect(html).toContain('Runtime Frontier')
    expect(html).toContain('Runtime Balanced')
    expect(html).toContain('Default reasoning effort')
    expect(html).toContain('ultra')
    expect(html).toContain('value="ultra" disabled=""')
    expect(html).toContain('Default speed')
    expect(html).toContain('value="" selected="">Standard speed</option>')
    expect(html).toContain('Fast')
  })

  it('shows structured discovery status and recovery actions without requiring PATH knowledge', () => {
    const ctx = {
      ...baseCtx(),
      codexDiscovery: {
        runtimeId: 'codex',
        available: true,
        executablePath: '/Applications/ChatGPT.app/Contents/Resources/codex',
        source: 'application-bundle',
        version: '0.154.0-alpha.6.2',
        protocol: { id: 'app-server', supported: true }
      }
    }
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx }))

    expect(html).toContain('Codex is ready')
    expect(html).toContain('Application bundle')
    expect(html).toContain('0.154.0-alpha.6.2')
    expect(html).toContain('App-server support')
    expect(html).toContain('Supported')
    expect(html).toContain('Detect again')
    expect(html).toContain('Choose local app')
    expect(html).toContain('Installation guide')
  })

  it('probes the current unsaved command instead of the stale persisted setting', async () => {
    const probe = vi.fn().mockResolvedValue({ runtimeId: 'codex', available: false })

    await probeCodexRuntimeCandidate(probe, '/Applications/ChatGPT.app/Contents/Resources/codex')

    expect(probe).toHaveBeenCalledWith(
      'codex',
      '/Applications/ChatGPT.app/Contents/Resources/codex'
    )
  })

  it('probes the DSH candidate through the neutral runtime id', async () => {
    const probe = vi.fn().mockResolvedValue({ runtimeId: 'dsh', available: false })

    await probeDshRuntimeCandidate(probe, '/opt/tools/dsh')

    expect(probe).toHaveBeenCalledWith('dsh', '/opt/tools/dsh')
  })

  it('ignores an older settings probe that resolves after a newer command', async () => {
    const resolvers = new Map<string, (value: { runtimeId: 'codex'; available: boolean }) => void>()
    const probe = vi.fn((_: AgentRuntimeId | undefined, command?: string) => new Promise<{
      runtimeId: 'codex'
      available: boolean
    }>((resolve) => resolvers.set(command ?? '', resolve)))
    const sequence = { current: 0 }

    const older = runLatestCodexRuntimeProbe(probe, '/old/codex', sequence)
    const newer = runLatestCodexRuntimeProbe(probe, '/new/codex', sequence)
    resolvers.get('/new/codex')?.({ runtimeId: 'codex', available: true })
    await expect(newer).resolves.toMatchObject({ status: 'current' })
    resolvers.get('/old/codex')?.({ runtimeId: 'codex', available: false })
    await expect(older).resolves.toEqual({ status: 'stale' })
  })

  it('ignores an older DSH probe that resolves after a newer executable path', async () => {
    const resolvers = new Map<string, (value: { runtimeId: 'dsh'; available: boolean }) => void>()
    const probe = vi.fn((_: AgentRuntimeId | undefined, command?: string) => new Promise<{
      runtimeId: 'dsh'
      available: boolean
    }>((resolve) => resolvers.set(command ?? '', resolve)))
    const sequence = { current: 0 }

    const older = runLatestDshRuntimeProbe(probe, '/old/dsh', sequence)
    const newer = runLatestDshRuntimeProbe(probe, '/new/dsh', sequence)
    resolvers.get('/new/dsh')?.({ runtimeId: 'dsh', available: true })
    await expect(newer).resolves.toMatchObject({ status: 'current' })
    resolvers.get('/old/dsh')?.({ runtimeId: 'dsh', available: false })
    await expect(older).resolves.toEqual({ status: 'stale' })
  })

  it('persists only a path explicitly selected by the user', async () => {
    const update = vi.fn()
    await chooseCodexRuntimeExecutable(
      async () => ({ canceled: true, path: null }),
      update
    )
    expect(update).not.toHaveBeenCalled()

    await chooseCodexRuntimeExecutable(
      async () => ({ canceled: false, path: '/Applications/ChatGPT.app/Contents/Resources/codex' }),
      update
    )
    expect(update).toHaveBeenCalledWith({
      command: '/Applications/ChatGPT.app/Contents/Resources/codex'
    })
  })

  it('persists only a DSH path explicitly selected by the user', async () => {
    const update = vi.fn()
    await chooseDshRuntimeExecutable(
      async () => ({ canceled: true, path: null }),
      update
    )
    expect(update).not.toHaveBeenCalled()

    await chooseDshRuntimeExecutable(
      async () => ({ canceled: false, path: '/opt/tools/dsh' }),
      update
    )
    expect(update).toHaveBeenCalledWith({
      executablePath: '/opt/tools/dsh'
    })
  })

  it('explains app-managed runtime directories without exposing editable directory fields', () => {
    const html = renderToStaticMarkup(
      createElement(AgentsSettingsSection, { ctx: baseCtx() })
    )

    expect(html).toContain('Codex state is kept in an app-managed directory')
    expect(html).toContain(
      'Claude Code configuration is kept in an app-managed directory'
    )
    expect(html).toContain('not configurable here')
  })

  it('removes Kun runtime and its non-functional MCP editor from the settings UI', () => {
    const html = renderToStaticMarkup(
      createElement(AgentsSettingsSection, { ctx: baseCtx() })
    )

    expect(html).not.toContain('SciForge Runtime')
    expect(html).not.toContain('Local Runtime')
    expect(html).not.toContain('Runtime token')
    expect(html).not.toContain('Storage backend')
    expect(html).not.toContain('Token-saving')
    expect(html).not.toContain('External tools')
    expect(html).not.toContain('MCP editor')
  })

  it('keeps Skills and generic computer use for every selectable runtime', () => {
    const ctx = {
      ...baseCtx(),
      computerUseStatus: {
        settings: defaultComputerUseSettings(),
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
            reason: 'GUI-Owl ready',
            inputIsolation: 'host-approved',
            affectsUserInput: true,
            requiresHostFocus: true,
            usesHostClipboard: false
          },
          activeLeases: [],
          recentRejections: []
        }
      }
    }
    const html = renderToStaticMarkup(
      createElement(AgentsSettingsSection, { ctx })
    )

    expect(html).toContain('Skills')
    expect(html).toContain('/tmp/project/.agents/skills')
    expect(html).toContain('Computer use')
    expect(html).toContain('Codex app-server')
    expect(html).toContain('Claude Code CLI')
    expect(html).toContain('DeepSeek Harness')
    expect(html).not.toContain('SciForge Runtime')
    expect(html).toContain('GUI-Owl ready')
    expect(html).toContain('macOS permissions')
  })
})
