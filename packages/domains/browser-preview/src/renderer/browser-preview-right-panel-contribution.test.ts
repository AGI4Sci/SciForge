import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReactElement } from 'react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  BROWSER_PREVIEW_RENDERER_RIGHT_PANEL_CONTRACT,
  BROWSER_PREVIEW_RENDERER_RIGHT_PANEL_CONTRIBUTION
} from '../definition'
import {
  createDomainRendererEntry,
  type BrowserPreviewRightPanelContribution
} from './browser-preview-right-panel-contribution'
import { browserPreviewComponentId } from './BrowserPreviewPanel'

test('publishes Browser Preview metadata in the manifest contract and only render at runtime', () => {
  const visibleContext = {
    registerComponent: () => () => undefined,
    registerVisualTarget: () => () => undefined
  }
  const host: DomainRendererHost = {
    capabilityInvoker: {
      observe: async () => {
        throw new Error('not observed')
      },
      invoke: async <TInput, TOutput>(): Promise<TOutput> => {
        throw new Error('not invoked')
      }
    },
    openExternal: () => undefined,
    visibleContext,
    workbench: { openRightPanel: () => undefined }
  }

  const entry = createDomainRendererEntry(host)
  const runtime = entry.contributions.find(({ kind }) =>
    kind === BROWSER_PREVIEW_RENDERER_RIGHT_PANEL_CONTRIBUTION.kind
  )!
  const panel = runtime.value as BrowserPreviewRightPanelContribution

  assert.deepEqual(runtime.contract, BROWSER_PREVIEW_RENDERER_RIGHT_PANEL_CONTRACT)
  assert.deepEqual(BROWSER_PREVIEW_RENDERER_RIGHT_PANEL_CONTRACT, {
    location: 'workbench.right-panel',
    title: 'Web Preview',
    resourceKind: 'browser-page'
  })
  assert.deepEqual(Object.keys(panel), ['render'])

  const rendered = panel.render({
    active: true,
    className: 'panel',
    focused: true,
    onCollapse: () => undefined,
    surfaceId: 'surface-browser-a',
    session: { id: 'session-browser', workspaceRoot: '/workspace' }
  })
  const props = (rendered as ReactElement<Record<string, unknown>>).props
  assert.equal(props.className, 'panel')
  assert.equal(props.focused, true)
  assert.equal(props.sessionId, 'session-browser')
  assert.equal(props.surfaceId, 'surface-browser-a')
  assert.equal(props.workspaceRoot, '/workspace')
  assert.equal(props.visibleContext, visibleContext)
})

test('qualifies visible-context component identity by Session and surface', () => {
  assert.notEqual(
    browserPreviewComponentId('session-browser', 'surface-a'),
    browserPreviewComponentId('session-browser', 'surface-b')
  )
  assert.notEqual(
    browserPreviewComponentId('session-a', 'surface-browser'),
    browserPreviewComponentId('session-b', 'surface-browser')
  )
  assert.notEqual(
    browserPreviewComponentId('session', 'pane.with.dots'),
    browserPreviewComponentId('session.pane', 'with.dots')
  )
})
