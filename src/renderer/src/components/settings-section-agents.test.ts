import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  defaultClaudeRuntimeSettings,
  defaultCodexRuntimeSettings,
  defaultComputerUseSettings
} from '@shared/app-settings'
import {
  AgentsSettingsSection,
  claudeRuntimeSettingsPatch,
  codexRuntimeSettingsPatch
} from './settings-section-agents'

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
  codexManagedHomeDesc:
    'Codex state is kept in an app-managed directory. This location is not configurable here.',
  codexExtraArgs: 'Extra arguments',
  codexExtraArgsDesc: 'One per line.',
  codexExtraArgsPlaceholder: '--search',
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
  claudeExtraArgsDesc: 'One per line.',
  claudeExtraArgsPlaceholder: '--allowedTools Edit',
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
  return {
    t,
    tCommon: t,
    form: {
      agents: { codex, claude },
      computerUse: defaultComputerUseSettings(),
      codePromptPrefix: 'Prefer pnpm.',
      remoteChannel: { skills: { extraDirs: ['/tmp/project/.agents/skills'] } }
    },
    codex,
    claude,
    update: noop,
    updateCodex: noop,
    updateClaude: noop,
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
  it('wraps runtime patches without touching the removed custom runtime', () => {
    expect(codexRuntimeSettingsPatch({ command: '/opt/tools/codex' })).toEqual({
      agents: { codex: { command: '/opt/tools/codex' } }
    })
    expect(
      claudeRuntimeSettingsPatch({ command: '/opt/tools/claude' })
    ).toEqual({
      agents: { claude: { command: '/opt/tools/claude' } }
    })
  })

  it('renders executable detection and only settings consumed by Codex and Claude Code', () => {
    const html = renderToStaticMarkup(
      createElement(AgentsSettingsSection, { ctx: baseCtx() })
    )

    expect(html).toContain('SciForge detects Codex automatically')
    expect(html).toContain('SciForge detects Claude Code automatically')
    expect(html).toContain('absolute executable path')
    expect(html).toContain('value="/opt/tools/codex"')
    expect(html).toContain('value="/opt/tools/claude"')
    expect(html).toContain('value="sonnet"')
    expect(html).toContain('Approval policy')
    expect(html).toContain('Sandbox mode')
    expect(html).toContain('--search')
    expect(html).toContain('--allowedTools')

    expect(html).not.toContain('/tmp/hidden-codex-home')
    expect(html).not.toContain('/tmp/hidden-claude-config')
    expect(html).not.toContain('hidden-profile')
    expect(html).not.toContain('hidden-codex-model')
    expect(html).not.toContain('Auto start')
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

  it('keeps Skills and generic computer use for Codex and Claude Code only', () => {
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
    expect(html).not.toContain('SciForge Runtime')
    expect(html).toContain('GUI-Owl ready')
    expect(html).toContain('macOS permissions')
  })
})
