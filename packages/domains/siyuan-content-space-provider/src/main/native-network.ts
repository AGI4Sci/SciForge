import { createRequire } from 'node:module'
import type { Session } from 'electron'

const electron = () => createRequire(import.meta.url)('electron') as typeof import('electron')
const headersFrom = (values: Record<string, string | string[]>): Headers => {
  const headers = new Headers()
  for (const [name, value] of Object.entries(values)) for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item)
  // Chromium's network stack decodes the body before delivering data events.
  for (const name of ['content-length', 'content-encoding', 'transfer-encoding']) headers.delete(name)
  return headers
}

export function nativeRequestHeaders(request: Request, editorOrigin: string): Headers {
  const headers = new Headers(request.headers)
  if (new URL(request.url).origin === editorOrigin && !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !headers.has('Origin')) headers.set('Origin', editorOrigin)
  return headers
}

/** Electron fetch rejects manual redirects. ClientRequest exposes the original
 * redirect event, which must be returned to Chromium without following it. */
export function forwardNativeRequest(session: Session, request: Request, editorOrigin: string): Promise<Response> {
  const headers = nativeRequestHeaders(request, editorOrigin)
  const requestHeaders: Record<string, string> = {}
  headers.forEach((value, name) => { requestHeaders[name] = value })
  return new Promise((resolve, reject) => {
    const outgoing = electron().net.request({ url: request.url, method: request.method, session,
      headers: requestHeaders, credentials: 'include', redirect: 'manual', bypassCustomProtocolHandlers: true })
    let settled = false
    let closed = false
    let body: ReadableStreamDefaultController<Uint8Array> | undefined
    const abort = () => {
      outgoing.abort()
      if (!settled) { settled = true; reject(request.signal.reason ?? new Error('Request cancelled')) }
      if (body && !closed) { closed = true; body.error(request.signal.reason) }
      cleanup()
    }
    const cleanup = () => request.signal.removeEventListener('abort', abort)
    outgoing.on('redirect', (status, _method, target, rawHeaders) => {
      if (settled) return
      settled = true
      const headers = headersFrom(rawHeaders)
      headers.set('Location', target)
      cleanup()
      resolve(new Response(null, { status, headers }))
      // Not calling followRedirect cancels the request. Its subsequent error
      // belongs to this completed redirect, not to the browser navigation.
    })
    outgoing.on('response', response => {
      if (settled) return
      settled = true
      const stream = new ReadableStream<Uint8Array>({
        start(controller) { body = controller },
        cancel() { closed = true; cleanup(); outgoing.abort() }
      })
      response.on('data', chunk => { if (!closed) body?.enqueue(Uint8Array.from(chunk)) })
      response.on('end', () => { if (!closed) { closed = true; body?.close() }; cleanup() })
      response.on('error', error => { if (!closed) { closed = true; body?.error(error) }; cleanup() })
      const empty = request.method === 'HEAD' || [204, 205, 304].includes(response.statusCode)
      resolve(new Response(empty ? null : stream, { status: response.statusCode, headers: headersFrom(response.headers) }))
    })
    outgoing.on('error', error => {
      cleanup()
      if (!settled) { settled = true; reject(error) }
      else if (body && !closed) { closed = true; body.error(error) }
    })
    request.signal.addEventListener('abort', abort, { once: true })
    if (request.signal.aborted) { outgoing.abort(); reject(request.signal.reason); return }
    void (async () => {
      if (request.body) {
        const reader = request.body.getReader()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            outgoing.write(Buffer.from(value))
          }
        } finally { reader.releaseLock() }
      }
      outgoing.end()
    })().catch(error => { outgoing.abort(); if (!settled) { settled = true; reject(error) } })
  })
}
