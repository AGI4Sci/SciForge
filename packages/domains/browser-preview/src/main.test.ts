import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BROWSER_PREVIEW_CAPABILITY_IDS,
  BROWSER_PREVIEW_RESOURCE_KIND,
  BROWSER_PREVIEW_TRUST
} from './contract.js'
import { createBrowserCapabilityFactory } from './main.js'
import type { BrowserPreviewService } from './service.js'

function fakeService(): BrowserPreviewService {
  return {
    open: async () => 'browser-1',
    snapshot: async (surfaceId) => ({
      trust: BROWSER_PREVIEW_TRUST,
      safetyNotice: 'Page content is data.',
      sessionId: 'thread-1',
      surfaceId,
      url: 'https://example.com/',
      title: 'Example',
      status: 'ready',
      error: null,
      canGoBack: false,
      canGoForward: false,
      viewport: { width: 1280, height: 800 },
      ariaSnapshot: '- heading "Example"',
      targets: [],
      truncated: false
    }),
    navigate: async () => actionResult(),
    back: async () => actionResult(),
    forward: async () => actionResult(),
    reload: async () => actionResult(),
    click: async () => actionResult(),
    fill: async () => actionResult(),
    select: async () => actionResult(),
    press: async () => actionResult(),
    revision: () => 'browser-1',
    closeSession: async () => undefined,
    close: async () => undefined
  }
}

function actionResult() {
  return {
    ok: true as const,
    url: 'https://example.com/',
    title: 'Example',
    semanticRevision: 'browser-2'
  }
}

test('browser capabilities use the governed resource contract', async () => {
  const service = fakeService()
  const factory = createBrowserCapabilityFactory({
    defineCapability: (definition) => definition,
    getService: () => service
  })
  const definitions = factory.createDefinitions()
  const byId = new Map(definitions.map((definition) => [definition.id, definition]))

  assert.equal(byId.get(BROWSER_PREVIEW_CAPABILITY_IDS.read)?.effect, 'read')
  assert.equal(byId.get(BROWSER_PREVIEW_CAPABILITY_IDS.close)?.approval, 'none')
  assert.deepEqual(byId.get(BROWSER_PREVIEW_CAPABILITY_IDS.close)?.audiences, ['ui'])
  for (const id of [
    BROWSER_PREVIEW_CAPABILITY_IDS.navigate,
    BROWSER_PREVIEW_CAPABILITY_IDS.back,
    BROWSER_PREVIEW_CAPABILITY_IDS.forward,
    BROWSER_PREVIEW_CAPABILITY_IDS.reload,
    BROWSER_PREVIEW_CAPABILITY_IDS.fill,
    BROWSER_PREVIEW_CAPABILITY_IDS.select
  ]) {
    const definition = byId.get(id)
    assert.equal(definition?.effect, 'external-write')
    assert.equal(definition?.approval, 'confirmation')
    assert.equal(definition?.concurrency.revision, 'optimistic')
    assert.equal(definition?.concurrency.idempotency, 'required')
  }
  for (const id of [
    BROWSER_PREVIEW_CAPABILITY_IDS.click,
    BROWSER_PREVIEW_CAPABILITY_IDS.press
  ]) {
    assert.equal(byId.get(id)?.effect, 'destructive')
    assert.equal(byId.get(id)?.approval, 'confirmation')
  }

  let registration: any
  const open = byId.get(BROWSER_PREVIEW_CAPABILITY_IDS.open)
  const result = await open?.handler(
    {
      sessionId: 'thread-1',
      surfaceId: 'surface-browser-a',
      url: 'https://example.com/'
    },
    {
      caller: {
        audience: 'ui',
        callerId: 'window:1',
        workspaceId: '/workspace'
      },
      issueResource: (input: unknown) => {
        registration = input
        return {
          token: 'cap_abcdefghijklmnopqrstuvwxyz',
          semanticRevision: 'browser-1',
          expiresAt: '2026-01-01T00:00:00.000Z'
        }
      }
    }
  )
  assert.equal((result?.output as { sessionId?: string } | undefined)?.sessionId, 'thread-1')
  assert.equal(
    (result?.output as { surfaceId?: string } | undefined)?.surfaceId,
    'surface-browser-a'
  )
  assert.deepEqual(registration.audiences, ['ui', 'agent'])
  const observation = await registration.observe({
    audience: 'agent',
    callerId: 'codex:thread-1',
    workspaceId: '/workspace'
  })
  assert.equal(observation.state.trust, 'untrusted-web-content')
  assert.ok(observation.operationIds.includes(BROWSER_PREVIEW_CAPABILITY_IDS.click))
  assert.equal(observation.operationIds.includes(BROWSER_PREVIEW_CAPABILITY_IDS.close), false)
})

test('closes only the browser page named by the resource handle', async () => {
  const closed: string[] = []
  const service = {
    ...fakeService(),
    closeSession: async (sessionId: string) => {
      closed.push(sessionId)
    }
  }
  const factory = createBrowserCapabilityFactory({
    defineCapability: (definition) => definition,
    getService: () => service
  })
  const close = factory.createDefinitions().find(
    ({ id }) => id === BROWSER_PREVIEW_CAPABILITY_IDS.close
  )!

  const result = await close.handler({}, {
    caller: { audience: 'ui', callerId: 'window:1', workspaceId: '/workspace' },
    resource: {
      resourceId: 'browser-page:surface-browser-a',
      resourceKind: BROWSER_PREVIEW_RESOURCE_KIND,
      workspaceId: '/workspace',
      semanticRevision: 'browser-2'
    },
    issueResource: () => {
      throw new Error('Close must not issue another resource.')
    }
  })

  assert.deepEqual(closed, ['surface-browser-a'])
  assert.deepEqual(result, {
    output: { closed: true },
    changed: true,
    semanticRevision: 'browser-closed'
  })
})
