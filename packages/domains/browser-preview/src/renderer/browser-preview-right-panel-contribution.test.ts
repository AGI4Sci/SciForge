import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReactElement } from 'react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  BROWSER_PREVIEW_RENDERER_RIGHT_PANEL_CONTRACT,
  BROWSER_PREVIEW_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  BROWSER_PREVIEW_RENDERER_URL_CONTEXT_CONTRIBUTION
} from '../definition'
import {
  createDomainRendererEntry,
  type BrowserPreviewRightPanelContribution
} from './browser-preview-right-panel-contribution'
import { browserPreviewComponentId, browserPreviewVisibleContextComponent } from './BrowserPreviewPanel'

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
    title: 'Native browser',
    titleKey: 'common:browserPreviewTitle',
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

test('publishes the browser resource in the host locator shape', () => {
  const component = browserPreviewVisibleContextComponent({
    observation: {
      resource: { token: `cap_${'a'.repeat(26)}`, semanticRevision: '7', expiresAt: '2030-01-01T00:00:00.000Z' },
      resourceRef: `res_${'b'.repeat(26)}`,
      resourceKind: 'browser-page',
      semanticRevision: '7',
      observedAt: '2030-01-01T00:00:00.000Z',
      state: {
        trust: 'untrusted-web-content', safetyNotice: 'fixture', sessionId: 'session', surfaceId: 'surface',
        url: 'https://example.com', title: 'Example', status: 'ready', error: null,
        canGoBack: false, canGoForward: false, viewport: { width: 800, height: 600 }, ariaSnapshot: '', targets: [], truncated: false
      }
    },
    sessionId: 'session',
    surfaceId: 'surface',
    fallbackTitle: 'Browser'
  })
  const resource = component.resources?.[0]
  assert.deepEqual(resource?.capability, { resourceRef: `res_${'b'.repeat(26)}` })
  assert.equal('operations' in (resource?.capability ?? {}), false)
})

test('forwards an explicit activation URL to the preview panel', () => {
  const visibleContext = {
    registerComponent: () => () => undefined,
    registerVisualTarget: () => () => undefined
  }
  const host = {
    capabilityInvoker: { observe: async () => { throw new Error('unused') }, invoke: async () => { throw new Error('unused') } },
    openExternal: () => undefined,
    visibleContext,
    workbench: { openRightPanel: () => undefined }
  } as unknown as DomainRendererHost
  const entry = createDomainRendererEntry(host)
  const panel = entry.contributions.find(({ kind }) => kind === BROWSER_PREVIEW_RENDERER_RIGHT_PANEL_CONTRIBUTION.kind)!.value as BrowserPreviewRightPanelContribution
  const rendered = panel.render({ active: true, className: '', focused: false, onCollapse: () => undefined, surfaceId: 's', session: { id: 'x', workspaceRoot: '' }, activation: { revision: 1, payload: { url: 'https://example.com/path' } } })
  assert.equal((rendered as ReactElement<Record<string, unknown>>).props.initialUrl, 'https://example.com/path')
})

test('composer URL context describes the URL-first browser handoff', () => {
  const visibleContext = {
    registerComponent: () => () => undefined,
    registerVisualTarget: () => () => undefined
  }
  const host = {
    capabilityInvoker: { observe: async () => { throw new Error('unused') }, invoke: async () => { throw new Error('unused') } },
    openExternal: () => undefined,
    visibleContext,
    workbench: { openRightPanel: () => undefined }
  } as unknown as DomainRendererHost
  const entry = createDomainRendererEntry(host)
  const provider = entry.contributions.find(({ kind }) => kind === BROWSER_PREVIEW_RENDERER_URL_CONTEXT_CONTRIBUTION.kind)!.value as {
    provide: (input: { draftText: string }) => { items: Array<{ content: string }> }
  }
  const result = provider.provide({ draftText: 'Please inspect https://example.com/login.' })
  assert.equal(result.items.length, 1)
  assert.match(result.items[0]!.content, /browser-preview\.read-url/)
  assert.match(result.items[0]!.content, /needsBrowser=true/)
  assert.match(result.items[0]!.content, /browser-preview\.open/)
  assert.match(result.items[0]!.content, /untrusted web data/)
})
