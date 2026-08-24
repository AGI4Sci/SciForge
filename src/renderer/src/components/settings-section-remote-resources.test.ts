import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RemoteResourcesSettingsSection } from './settings-section-remote-resources'

const labels: Record<string, string> = {
  remoteResourcesTitle: 'Remote resources',
  remoteWorkspaceSettingsTitle: 'Remote workspaces',
  remoteWorkspaceSettingsDesc:
    'Connect from the workspace selector. SSH and VPN access is managed by the Remote SSH panel.',
  remoteResourcesOpenTargets: 'Open Remote Targets'
}

describe('RemoteResourcesSettingsSection', () => {
  it('points to the canonical Remote Workspace and Remote SSH surfaces', () => {
    const html = renderToStaticMarkup(
      createElement(RemoteResourcesSettingsSection, {
        ctx: {
          t: (key: string) => labels[key] ?? key,
          openRemoteTargets: () => undefined,
          canOpenRemoteTargets: true
        }
      })
    )

    expect(html).toContain('Remote resources')
    expect(html).toContain('Remote workspaces')
    expect(html).toContain('workspace selector')
    expect(html).toContain('Remote SSH panel')
    expect(html).toContain('Open Remote Targets')
    expect(html).not.toContain('disabled=""')
    expect(html).not.toContain('Remote Executor')
  })
})
