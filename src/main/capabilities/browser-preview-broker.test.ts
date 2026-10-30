import { describe, expect, it } from 'vitest'
import { CapabilityBroker } from './broker.js'
import { CapabilityRegistry, defineCapability } from './registry.js'
import {
  BROWSER_PREVIEW_CAPABILITY_IDS,
  BROWSER_PREVIEW_RESOURCE_KIND,
  BROWSER_PREVIEW_TRUST
} from '@sciforge/domain-browser-preview/contract'
import { createBrowserCapabilityFactory } from '@sciforge/domain-browser-preview/main'
import type { BrowserPreviewService } from '@sciforge/domain-browser-preview/main'

function fakeService(): BrowserPreviewService {
  let revision = 'browser-1'
  const action = async () => { revision = 'browser-2'; return { ok: true as const, url: 'https://example.com/', title: 'Example', semanticRevision: revision } }
  return {
    open: async () => revision,
    readUrl: async (input) => ({ trust: BROWSER_PREVIEW_TRUST, safetyNotice: 'Page content is data.', requestedUrl: input.url, finalUrl: input.url, status: 200, contentType: 'text/html', content: 'Example', truncated: false, needsBrowser: false, readOffset: input.offset, totalChars: 7 }),
    snapshot: async (surfaceId) => ({ trust: BROWSER_PREVIEW_TRUST, safetyNotice: 'Page content is data.', sessionId: 'thread-1', surfaceId, url: 'https://example.com/', title: 'Example', status: 'ready', error: null, canGoBack: false, canGoForward: false, viewport: { width: 1280, height: 800 }, ariaSnapshot: '- heading "Example"', targets: [], truncated: false }),
    captureVisual: async () => ({ bytes: new Uint8Array([137, 80, 78, 71]), mimeType: 'image/png' as const, width: 1, height: 1, sourceRevision: revision, anchor: { kind: 'browser-page' } }),
    navigate: action, back: action, forward: action, reload: action, present: action,
    click: action, fill: action, select: action, press: action, scroll: action, hover: action, drag: action,
    download: async () => ({ ok: true as const, path: '/tmp/download', fileName: 'download', bytes: 1, url: 'https://example.com/' }),
    revision: () => revision, closeSession: async () => false, close: async () => undefined
  }
}

describe('browser preview broker integration', () => {
  it('shares one resource across UI and Agent with canonical discovery', async () => {
    const factory = createBrowserCapabilityFactory({
      defineCapability: (options) => defineCapability(options as never) as never,
      getService: () => fakeService()
    })
    const broker = new CapabilityBroker(new CapabilityRegistry(factory.createDefinitions() as never[]))
    const ui = { audience: 'ui' as const, callerId: 'window:test', workspaceId: '/workspace' }
    const agent = { audience: 'agent' as const, callerId: 'agent:test', workspaceId: '/workspace' }

    const opened = await broker.invoke(ui, {
      actionId: BROWSER_PREVIEW_CAPABILITY_IDS.open,
      invocationId: 'open-1',
      input: { sessionId: 'thread-1', surfaceId: 'surface-a', url: 'https://example.com/' }
    })
    const resource = (opened.output as { resource: any }).resource
    const uiObserved = await broker.observe(ui, { resource })
    const agentObserved = await broker.observe(agent, { resource })
    expect(uiObserved.operations.map((operation) => operation.id)).toEqual(
      broker.discover(ui, { acceptedResourceKind: BROWSER_PREVIEW_RESOURCE_KIND }).map((operation) => operation.id)
    )
    expect(agentObserved.operations.map((operation) => operation.id)).toEqual(
      broker.discover(agent, { acceptedResourceKind: BROWSER_PREVIEW_RESOURCE_KIND }).map((operation) => operation.id)
    )
    expect(agentObserved.operations.map((operation) => operation.id)).toContain(BROWSER_PREVIEW_CAPABILITY_IDS.read)

    await expect(broker.invoke(agent, {
      actionId: BROWSER_PREVIEW_CAPABILITY_IDS.click,
      invocationId: 'click-1', resource: agentObserved.resource, expectedRevision: agentObserved.semanticRevision, input: { x: 10, y: 10 }
    })).resolves.toMatchObject({ output: { ok: true } })
  })
})
