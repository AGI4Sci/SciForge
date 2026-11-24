import { afterEach, expect, it, vi } from 'vitest'
import type { Session, WebContents } from 'electron'
import { attachNativeAiSession, localAiConfig } from './native-ai-session.js'
import { forwardNativeRequest, nativeRequestHeaders } from './native-network.js'

vi.mock('./native-network.js', async importOriginal => ({
  ...await importOriginal<typeof import('./native-network.js')>(), forwardNativeRequest: vi.fn()
}))

const url = 'https://notes.test/'
const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).reverse().forEach(fn => fn()); vi.unstubAllGlobals() })
function fixture() {
  const frame = { url }
  const page = { id: 7, mainFrame: frame, isDestroyed: () => false } as unknown as WebContents
  let handler!: (request: Request) => Promise<Response>
  let gate!: (details: Record<string, unknown>, callback: (result: unknown) => void) => void
  const fetcher = vi.fn(async () => Response.json({ code: 0, data: { conf: { ai: {
    providers: [{ apiKey: 'server-private-key' }], editing: { maxHistoryMessages: 4 }
  }, appearance: 'untouched' } } }))
  const protocol = { handle: vi.fn((_scheme, fn) => { handler = fn }), unhandle: vi.fn() }
  const webRequest = { onBeforeRequest: vi.fn((_filter, fn) => { if (fn) gate = fn }) }
  const session = { protocol, webRequest, fetch: fetcher } as unknown as Session
  vi.mocked(forwardNativeRequest).mockImplementation((_session, request, origin) =>
    _session.fetch(request, { headers: nativeRequestHeaders(request, origin), bypassCustomProtocolHandlers: true, redirect: 'manual', credentials: 'include' }))
  let authorized = true
  const attach = (otherPage = page) => {
    const detach = attachNativeAiSession(session, url, { page: otherPage, authorized: () => authorized,
      access: { textReasoner: async () => null, readBlock: async () => 'block' } })
    cleanups.push(detach)
    return detach
  }
  const detach = attach()
  return { frame, page, fetcher, protocol, webRequest, attach, detach,
    logout: () => { authorized = false },
    response: (path: string, method = 'POST', init: RequestInit = {}) => handler(new Request(new URL(path, url), { ...init, method })),
    gate: (details: Record<string, unknown>) => {
      const cb = vi.fn(); gate(details, cb); return cb.mock.calls[0][0]
    } }
}

it('accepts only the owning main frame for model requests, including encoded AI paths', () => {
  const f = fixture()
  const details = { url: url + 'api/ai/editor/chat', webContentsId: 7, frame: f.frame }
  expect(f.gate(details)).toEqual({})
  expect(f.gate({ ...details, frame: { url } })).toEqual({ cancel: true })
  expect(f.gate({ ...details, frame: undefined })).toEqual({ cancel: true })
  expect(f.gate({ ...details, webContentsId: 8 })).toEqual({ cancel: true })
  expect(f.gate({ ...details, url: 'https://other.test/api/ai/editor/chat' })).toEqual({ cancel: true })
  expect(f.gate({ ...details, url: url + 'api/%61i/editor/chat', frame: undefined })).toEqual({ cancel: true })
  expect(f.gate({ url: url + 'ordinary' })).toEqual({})
  // Host-side forwarding of non-model template management has no sender frame.
  expect(f.gate({ url: url + 'api/ai/editor/lsActions' })).toEqual({})
})

it('virtualizes only the local config response and removes all provider credentials', async () => {
  const f = fixture()
  const response = await f.response('/api/system/getConf')
  const text = await response.text()
  expect(text).not.toContain('server-private-key')
  expect(JSON.parse(text)).toMatchObject({ data: { conf: { appearance: 'untouched',
    ai: { editing: { maxHistoryMessages: 4, modelId: 'sciforge-local-text' },
      providers: [{ apiKey: '', displayName: 'SciForge 本机模型' }] } } } })
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(f.fetcher).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({ bypassCustomProtocolHandlers: true, redirect: 'manual', credentials: 'include' }))
})

it('blocks server-side AI configuration and unsupported endpoints instead of falling back', async () => {
  const f = fixture()
  for (const path of ['/api/setting/setAI', '/api/ai/agent/chat', '/api/ai/chatGPT', '/api/ai/testModel']) {
    expect((await f.response(path)).status).toBe(400)
  }
  expect((await f.response('/api/ai/editor/chat', 'GET')).status).toBe(400)
  expect((await f.response('https://other.test/api/ai/editor/chat')).status).toBe(403)
  f.logout()
  expect((await f.response('/api/ai/editor/chat')).status).toBe(403)
  expect(f.fetcher).not.toHaveBeenCalled()
})

it('shares a handler between same-account windows and releases it with the final view', () => {
  const f = fixture()
  const other = { ...f.page, id: 8, mainFrame: { url } } as unknown as WebContents
  const detach = f.attach(other)
  expect(f.protocol.handle).toHaveBeenCalledTimes(1)
  f.detach(); f.detach()
  expect(f.protocol.unhandle).not.toHaveBeenCalled()
  expect(f.gate({ url: url + 'api/ai/editor/chat', webContentsId: 7, frame: f.frame })).toEqual({ cancel: true })
  expect(f.gate({ url: url + 'api/ai/editor/chat', webContentsId: 8, frame: other.mainFrame })).toEqual({})
  detach()
  expect(f.protocol.unhandle).toHaveBeenCalledWith('https')
  expect(f.webRequest.onBeforeRequest).toHaveBeenLastCalledWith(null)
  f.attach()
  expect(f.protocol.handle).toHaveBeenCalledTimes(2)
})

it('does not mutate the server config object used as input', () => {
  const original = { providers: [{ apiKey: 'server-private-key' }], editing: { modelId: 'server' } }
  const modified = localAiConfig(original)
  expect(modified).not.toBe(original)
  expect(original.editing.modelId).toBe('server')
  expect(original.providers[0].apiKey).toBe('server-private-key')
})


it('passes upstream redirects back to Chromium so relative assets resolve at the redirected document URL', async () => {
  const f = fixture()
  const redirect = new Response(null, { status: 302, headers: { location: '/stage/build/desktop/' } })
  f.fetcher.mockResolvedValueOnce(redirect)
  const response = await f.response('/', 'GET')
  expect(response).toBe(redirect)
  expect(response.headers.get('location')).toBe('/stage/build/desktop/')
  expect(f.fetcher).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({ redirect: 'manual', credentials: 'include' }))
})

it('forwards same-origin POST body and cookie credentials with the editor Origin without granting it to other frames or origins', async () => {
  const f = fixture()
  const body = JSON.stringify({ notebook: 'example' })
  await f.response('/api/notebook/lsNotebooks', 'POST', { body, headers: { 'content-type': 'text/plain;charset=UTF-8' } })
  const [request, init] = f.fetcher.mock.calls[0] as unknown as [Request, RequestInit]
  expect(await request.text()).toBe(body)
  expect(new Headers(init.headers).get('Origin')).toBe('https://notes.test')
  expect(new Headers(init.headers).get('content-type')).toBe('text/plain;charset=UTF-8')
  expect(init.credentials).toBe('include')
  expect(f.gate({ url: url + 'api/notebook/lsNotebooks', method: 'POST', webContentsId: 7, frame: f.frame })).toEqual({})
  for (const path of ['_sciforge/session', 'api/query/sql']) {
    expect(f.gate({ url: url + path, method: 'POST', webContentsId: -1 })).toEqual({})
  }
  expect(f.gate({ url: url + 'api/notebook/lsNotebooks', method: 'POST', webContentsId: 7, frame: { url: 'https://other.test/' } })).toEqual({ cancel: true })
  await f.response('https://other.test/api/notebook/lsNotebooks', 'POST')
  expect(new Headers((f.fetcher.mock.calls.at(-1) as unknown as [Request, RequestInit])[1].headers).has('Origin')).toBe(false)
  await f.response('/api/notebook/lsNotebooks', 'POST', { headers: { Origin: 'https://other.test' } })
  expect(new Headers((f.fetcher.mock.calls.at(-1) as unknown as [Request, RequestInit])[1].headers).get('Origin')).toBe('https://other.test')
})
