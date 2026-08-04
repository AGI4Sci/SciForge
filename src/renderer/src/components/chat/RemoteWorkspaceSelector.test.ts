import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import type { RemoteWorkspaceViewSummary } from '../../remote-workspace/types'
import { RemoteWorkspaceSelectorView } from './RemoteWorkspaceSelector'

const persistentWorkspace: RemoteWorkspaceViewSummary = {
  workspaceHostId: 'opaque-host-secret',
  locator: {
    contractVersion: 1,
    hostSessionId: 'opaque-session-secret',
    path: '/shared/projects/protein-design'
  },
  displayLabel: 'GPU workspace',
  workspacePathLabel: '/shared/projects/protein-design',
  lifecycleMode: 'persistent-daemon',
  phase: 'reconnecting',
  reconnectAttempt: 3,
  statusDetail: 'VPN session restored',
  egressRoutes: [
    {
      id: 'opaque-local-route-secret',
      displayLabel: 'This Mac',
      kind: 'local',
      available: true
    },
    {
      id: 'opaque-peer-route-secret',
      displayLabel: 'CPU gateway',
      kind: 'remote-target',
      available: true
    },
    {
      id: 'opaque-offline-route-secret',
      displayLabel: 'Offline gateway',
      kind: 'remote-target',
      available: false
    }
  ],
  selectedEgressRouteId: 'opaque-peer-route-secret',
  capabilities: {
    files: true,
    terminal: true,
    git: true,
    runtime: true,
    scientificPreview: true
  }
}

describe('RemoteWorkspaceSelectorView', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('shows persistent lifecycle, reconnect progress, remote path and bound egress', () => {
    const html = renderToStaticMarkup(
      createElement(RemoteWorkspaceSelectorView, {
        workspaces: [persistentWorkspace],
        selectedWorkspaceHostId: persistentWorkspace.workspaceHostId,
        onWorkspaceChange: vi.fn(),
        onReconnect: vi.fn()
      })
    )

    expect(html).toContain('Local workspace')
    expect(html).toContain('GPU workspace')
    expect(html).toContain('/shared/projects/protein-design')
    expect(html).toContain('Reconnecting 3')
    expect(html).toContain('Persistent server')
    expect(html).not.toContain('This Mac')
    expect(html).toContain('CPU gateway')
    expect(html).not.toContain('Offline gateway')
  })

  it('keeps opaque host and route handles out of rendered UI', () => {
    const html = renderToStaticMarkup(
      createElement(RemoteWorkspaceSelectorView, {
        workspaces: [persistentWorkspace],
        selectedWorkspaceHostId: persistentWorkspace.workspaceHostId,
        onWorkspaceChange: vi.fn()
      })
    )

    expect(html).not.toContain('opaque-host-secret')
    expect(html).not.toContain('opaque-session-secret')
    expect(html).not.toContain('opaque-local-route-secret')
    expect(html).not.toContain('opaque-peer-route-secret')
    expect(html).not.toContain('ssh-alias')
    expect(html).toContain('value="workspace-0"')
    expect(html).not.toContain('value="egress-1"')
  })

  it('renders a recovery action for an offline workspace', () => {
    const html = renderToStaticMarkup(
      createElement(RemoteWorkspaceSelectorView, {
        workspaces: [{
          ...persistentWorkspace,
          phase: 'offline',
          reconnectAttempt: undefined,
          egressRoutes: []
        }],
        selectedWorkspaceHostId: persistentWorkspace.workspaceHostId,
        onWorkspaceChange: vi.fn(),
        onReconnect: vi.fn()
      })
    )

    expect(html).toContain('Offline')
    expect(html).toContain('Reconnect')
  })

  it('normalizes control characters and bounds untrusted labels', () => {
    const html = renderToStaticMarkup(
      createElement(RemoteWorkspaceSelectorView, {
        workspaces: [{
          ...persistentWorkspace,
          displayLabel: `GPU\u0000 workspace ${'x'.repeat(100)}`,
          workspacePathLabel: `/shared/\n${'nested/'.repeat(30)}project`,
          phase: 'ready',
          egressRoutes: []
        }],
        selectedWorkspaceHostId: persistentWorkspace.workspaceHostId,
        onWorkspaceChange: vi.fn()
      })
    )

    expect(html).not.toContain('\u0000')
    expect(html).not.toContain('\n')
    expect(html).toContain('GPU workspace')
    expect(html).toContain('…')
    expect(html).toContain('Remote')
  })
})
