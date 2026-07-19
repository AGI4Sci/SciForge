import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  defaultConnectPhoneSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultRemoteChannelSettings,
  defaultRemoteExecutorSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '@shared/app-settings'
import { RemoteResourcesSettingsSection } from './settings-section-remote-resources'

const labels: Record<string, string> = {
  remoteResourcesTitle: 'Remote resources',
  remoteExecutorEnabled: 'Enable remote executor targets',
  remoteExecutorEnabledDesc: 'Show configured SSH and Slurm targets.',
  remoteExecutorDefaultTarget: 'Default target',
  remoteExecutorDefaultTargetDesc: 'Default target description',
  remoteExecutorDefaultLocal: 'Local',
  remoteExecutorTargets: 'Targets',
  remoteExecutorNoTargets: 'No remote targets',
  remoteExecutorAddTarget: 'Add target',
  remoteExecutorRemoveTarget: 'Remove target',
  remoteTargetDefaultLabel: 'Remote target {{index}}',
  remoteTargetTrusted: 'Trusted',
  remoteTargetUntrusted: 'Untrusted',
  remoteTargetLabel: 'Label',
  remoteTargetKind: 'Kind',
  remoteTargetKindSsh: 'SSH',
  remoteTargetKindSlurm: 'Slurm',
  remoteTargetSshHost: 'SSH host',
  remoteTargetSshUser: 'SSH user',
  remoteTargetSshPort: 'SSH port',
  remoteTargetWorkspaceRoot: 'Remote workspace root',
  remoteTargetSlurmPartition: 'Slurm partition',
  remoteTargetSlurmAccount: 'Slurm account',
  remoteTargetSlurmTime: 'Slurm time limit',
  remoteTargetSlurmGpus: 'Slurm GPUs',
  remoteTargetWorkspaceTrust: 'Trust current workspace',
  remoteTargetWorkspaceTrustDesc: 'Trust {{workspace}}',
  remoteTargetWorkspaceTrustNoWorkspace: 'No workspace'
}

function t(key: string, values?: Record<string, unknown>): string {
  let label = labels[key] ?? key
  for (const [name, value] of Object.entries(values ?? {})) {
    label = label.replace(`{{${name}}}`, String(value))
  }
  return label
}

function buildSettings(): AppSettingsV1 {
  return {
    version: 1,
    installationId: 'sciforge-test',
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
    remoteExecutor: {
      ...defaultRemoteExecutorSettings(),
      enabled: true,
      defaultTargetId: 'gpu-lab',
      targets: [
        {
          id: 'gpu-lab',
          label: 'GPU Lab',
          enabled: true,
          kind: 'slurm',
          ssh: { host: 'login.gpu.example', user: 'alice', port: 2222 },
          remoteWorkspaceRoot: '/remote/workspace',
          slurm: { defaults: { partition: 'gpu', account: 'research', timeLimit: '02:00:00', gpus: 2 } },
          trustedWorkspaces: [
            {
              workspaceRoot: '/tmp/workspace',
              targetFingerprint: 'settings-ui:gpu-lab',
              trustedAt: '2026-06-30T00:00:00.000Z',
              trustedBy: 'settings-ui',
              approvalBypass: true
            }
          ]
        }
      ]
    },
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

describe('RemoteResourcesSettingsSection', () => {
  it('renders editable remote executor target fields', () => {
    const html = renderToStaticMarkup(
      createElement(RemoteResourcesSettingsSection, {
        ctx: {
          t,
          form: buildSettings(),
          update: vi.fn(),
          selectControlClass: 'select-control'
        }
      })
    )

    expect(html).toContain('Remote resources')
    expect(html).toContain('GPU Lab')
    expect(html).toContain('login.gpu.example')
    expect(html).toContain('alice')
    expect(html).toContain('/remote/workspace')
    expect(html).toContain('gpu')
    expect(html).toContain('research')
    expect(html).toContain('02:00:00')
    expect(html).toContain('Trusted')
  })
})
