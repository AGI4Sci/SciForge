import { describe, expect, it, vi } from 'vitest'

import { OpenContentConnectorError } from '../contract.js'
import {
  requestOpenContentProviderJson
} from './provider-json-transport.js'

const baseUrl = new URL('https://opencontent.invalid')

describe('OpenContent package-private Provider JSON transport', () => {
  it('revalidates the Principal and applies the pinned request policy before dispatch', async () => {
    const order: string[] = []
    const assertPrincipalCurrent = vi.fn(async () => { order.push('principal') })
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      order.push('fetch')
      expect(String(input)).toBe('https://opencontent.invalid/provider/read?token=opaque')
      expect(init).toMatchObject({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"value":1}',
        redirect: 'error',
        credentials: 'omit',
        referrerPolicy: 'no-referrer'
      })
      return jsonResponse({ ok: true })
    })

    await expect(requestOpenContentProviderJson({
      baseUrl,
      fetchImplementation: fetch,
      path: '/provider/read',
      method: 'POST',
      query: { token: 'opaque' },
      headers: { 'content-type': 'application/json' },
      body: '{"value":1}',
      assertPrincipalCurrent,
      errorFactory: connectorError
    })).resolves.toEqual({ ok: true })
    expect(order).toEqual(['principal', 'fetch'])
  })

  it('keeps HTTP conflict classification opt-in for Team-specific writes', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 409 }))

    await expect(requestOpenContentProviderJson({
      baseUrl,
      fetchImplementation: fetch,
      path: '/provider/read',
      errorFactory: connectorError
    })).rejects.toMatchObject({ code: 'provider_unavailable' })
    await expect(requestOpenContentProviderJson({
      baseUrl,
      fetchImplementation: fetch,
      path: '/provider/team-write',
      http409IsConflict: true,
      errorFactory: connectorError
    })).rejects.toMatchObject({ code: 'conflict' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('cancels a streamed JSON response once the shared one-megabyte bound is exceeded', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(600_000))
        controller.enqueue(new Uint8Array(600_000))
      },
      cancel: () => { cancelled = true }
    })

    await expect(requestOpenContentProviderJson({
      baseUrl,
      fetchImplementation: vi.fn(async () => new Response(body, { status: 200 })),
      path: '/provider/oversized',
      errorFactory: connectorError
    })).rejects.toMatchObject({ code: 'provider_contract_violation' })
    expect(cancelled).toBe(true)
  })

  it('preserves caller cancellation while reading a dispatched response body', async () => {
    const controller = new AbortController()
    const body = new ReadableStream<Uint8Array>({
      pull(stream) {
        controller.abort()
        stream.error(new DOMException('The response read was cancelled.', 'AbortError'))
      }
    })

    await expect(requestOpenContentProviderJson({
      baseUrl,
      fetchImplementation: vi.fn(async () => new Response(body, { status: 200 })),
      path: '/provider/cancelled-body',
      signal: controller.signal,
      errorFactory: connectorError
    })).rejects.toMatchObject({ code: 'cancelled' })
  })
})

function connectorError(
  code: ConstructorParameters<typeof OpenContentConnectorError>[0]
): OpenContentConnectorError {
  return new OpenContentConnectorError(code, `Synthetic transport error: ${code}`)
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}
