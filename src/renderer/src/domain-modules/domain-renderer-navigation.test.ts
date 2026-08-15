import type {
  DomainWorkbenchOpenRightPanelInput,
  DomainWorkbenchOpenSurfaceInput,
  DomainWorkspacePreviewTarget
} from '@sciforge/domain-sdk/host'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WORKSPACE_FILE_PREVIEW_EVENT } from '../lib/workspace-file-preview'
import {
  DOMAIN_WORKBENCH_OPEN_RIGHT_PANEL_EVENT,
  DOMAIN_WORKBENCH_OPEN_BOTTOM_PANEL_EVENT,
  domainRendererNavigationHost,
  setDomainWorkbenchResourceNavigationProvider
} from './domain-renderer-navigation'

afterEach(() => vi.unstubAllGlobals())

describe('domain renderer navigation host', () => {
  it('routes workspace previews and right-panel activations through generic events', () => {
    const targetWindow = new EventTarget()
    vi.stubGlobal('window', targetWindow)
    let preview: DomainWorkspacePreviewTarget | undefined
    const panels: DomainWorkbenchOpenRightPanelInput[] = []
    let bottomPanel: DomainWorkbenchOpenSurfaceInput | undefined
    targetWindow.addEventListener(WORKSPACE_FILE_PREVIEW_EVENT, (event) => {
      preview = (event as CustomEvent<DomainWorkspacePreviewTarget>).detail
    })
    targetWindow.addEventListener(DOMAIN_WORKBENCH_OPEN_RIGHT_PANEL_EVENT, (event) => {
      panels.push((event as CustomEvent<DomainWorkbenchOpenRightPanelInput>).detail)
    })
    targetWindow.addEventListener(DOMAIN_WORKBENCH_OPEN_BOTTOM_PANEL_EVENT, (event) => {
      bottomPanel = (event as CustomEvent<DomainWorkbenchOpenSurfaceInput>).detail
    })
    const activation = {
      contributionId: 'fixture.panel',
      revision: 4,
      payload: { nodeId: 'node-4' }
    } as const

    domainRendererNavigationHost.workspacePreview.open({
      path: 'paper.pdf',
      sessionId: 'session-1',
      workspaceRoot: '/workspace',
      returnTo: {
        contributionId: 'fixture.panel',
        activation
      }
    })
    domainRendererNavigationHost.workbench.openRightPanel({
      contributionId: 'fixture.panel',
      sessionId: 'session-1',
      activation
    })
    expect(domainRendererNavigationHost.workbench.canOpenResource?.('artifact-version')).toBe(false)
    expect(domainRendererNavigationHost.workbench.openResource?.({
      sessionId: 'session-1',
      resource: {
        resourceKind: 'artifact-version',
        resourceId: 'artifact-version:figure:2',
        integrity: {
          algorithm: 'sha256',
          expectedDigest: `sha256:${'a'.repeat(64)}`
        }
      }
    })).toBe(false)
    const disposeResourceProvider = setDomainWorkbenchResourceNavigationProvider({
      canOpen: (resourceKind) => resourceKind === 'artifact-version',
      resolve: (input) => ({
        contributionId: 'fixture.resource-panel',
        sessionId: input.sessionId,
        activation: {
          contributionId: 'fixture.resource-panel',
          revision: 1,
          payload: { resourceId: input.resource.resourceId }
        }
      })
    })
    expect(domainRendererNavigationHost.workbench.canOpenResource?.('artifact-version')).toBe(true)
    expect(domainRendererNavigationHost.workbench.canOpenResource?.('compute-run')).toBe(false)
    expect(domainRendererNavigationHost.workbench.openResource?.({
      sessionId: 'session-1',
      resource: {
        resourceKind: 'artifact-version',
        resourceId: 'artifact-version:figure:2',
        integrity: {
          algorithm: 'sha256',
          expectedDigest: `sha256:${'a'.repeat(64)}`
        }
      }
    })).toBe(true)
    disposeResourceProvider()
    domainRendererNavigationHost.workbench.openBottomPanel?.({
      contributionId: 'fixture.bottom-panel',
      sessionId: 'session-1',
      activation
    })

    expect(preview).toMatchObject({
      path: 'paper.pdf',
      sessionId: 'session-1',
      returnTo: {
        kind: 'domain-right-panel',
        contributionId: 'fixture.panel',
        activation
      }
    })
    expect(panels[0]).toEqual({
      contributionId: 'fixture.panel',
      sessionId: 'session-1',
      activation
    })
    expect(panels[1]).toEqual({
      contributionId: 'fixture.resource-panel',
      sessionId: 'session-1',
      activation: {
        contributionId: 'fixture.resource-panel',
        revision: 1,
        payload: {
          resourceId: 'artifact-version:figure:2'
        }
      }
    })
    expect(bottomPanel).toEqual({
      contributionId: 'fixture.bottom-panel',
      sessionId: 'session-1',
      activation
    })
  })
})
