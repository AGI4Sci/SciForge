import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RemoteResourcesSettingsSection } from './settings-section-remote-resources'

const labels: Record<string, string> = {
  remoteResourcesTitle: 'Remote resources',
  remoteWorkspaceSettingsTitle: 'Remote workspaces',
  remoteWorkspaceSettingsDesc:
    'Connect from the workspace selector. SSH and VPN access is managed by the Remote SSH panel.'
}

describe('RemoteResourcesSettingsSection', () => {
  it('points to the canonical Remote Workspace and Remote SSH surfaces', () => {
    const html = renderToStaticMarkup(
      createElement(RemoteResourcesSettingsSection, {
        ctx: {
          t: (key: string) => labels[key] ?? key
        }
      })
    )

    expect(html).toContain('Remote resources')
    expect(html).toContain('Remote workspaces')
    expect(html).toContain('workspace selector')
    expect(html).toContain('Remote SSH panel')
    expect(html).not.toContain('Remote Executor')
  })
})
