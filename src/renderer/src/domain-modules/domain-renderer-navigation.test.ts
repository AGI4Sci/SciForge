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
  domainRendererNavigationHost
} from './domain-renderer-navigation'

afterEach(() => vi.unstubAllGlobals())

describe('domain renderer navigation host', () => {
  it('routes workspace previews and right-panel activations through generic events', () => {
    const targetWindow = new EventTarget()
    vi.stubGlobal('window', targetWindow)
    let preview: DomainWorkspacePreviewTarget | undefined
    let panel: DomainWorkbenchOpenRightPanelInput | undefined
    let bottomPanel: DomainWorkbenchOpenSurfaceInput | undefined
    targetWindow.addEventListener(WORKSPACE_FILE_PREVIEW_EVENT, (event) => {
      preview = (event as CustomEvent<DomainWorkspacePreviewTarget>).detail
    })
    targetWindow.addEventListener(DOMAIN_WORKBENCH_OPEN_RIGHT_PANEL_EVENT, (event) => {
      panel = (event as CustomEvent<DomainWorkbenchOpenRightPanelInput>).detail
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
    expect(panel).toEqual({
      contributionId: 'fixture.panel',
      sessionId: 'session-1',
      activation
    })
    expect(bottomPanel).toEqual({
      contributionId: 'fixture.bottom-panel',
      sessionId: 'session-1',
      activation
    })
  })
})
