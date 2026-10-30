/**
 * Catalog observation against a REAL local HTTP server — no fetch mocking.
 * The server records the actual requests, so caching, forced refresh,
 * concurrent dedupe, failure backoff (no busy polling) and timeout behaviour
 * are verified at the wire level, exactly as production sees them.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AppSettingsV1 } from '../../shared/app-settings'
import { UpstreamCatalogObserver } from './upstream-catalog'

const QUERY = { provider: 'model-router', model: 'up-model', protocol: 'auto', endpoint: null }

let hits: Array<{ method: string; url: string; authorization: string | undefined }> = []
let mode: 'ok' | 'fail' | 'hang' = 'ok'
let server: ReturnType<typeof createServer>
let baseUrl = ''

beforeEach(async () => {
  hits = []
  mode = 'ok'
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    hits.push({
      method: req.method ?? 'GET',
      url: req.url ?? '',
      authorization: req.headers.authorization
    })
    if (mode === 'hang') return // never respond: the timeout/abort must end it
    if (mode === 'fail') {
      res.writeHead(503, { 'content-type': 'text/plain' })
      res.end('nope')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'up-model', supported_reasoning_levels: [{ effort: 'high' }] }] }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  baseUrl = `http://127.0.0.1:${port}/v1`
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function settings(): AppSettingsV1 {
  return {
    modelRouter: {
      profiles: {
        default: {
          textReasoner: {
            baseUrl,
            apiKey: 'sk-http-test-1',
            model: 'up-model',
            protocol: 'auto'
          }
        }
      }
    }
  } as unknown as AppSettingsV1
}

describe('UpstreamCatalogObserver over real HTTP', () => {
  it('caches one HTTP observation, refetches on force, and dedupes concurrent calls', async () => {
    const observer = new UpstreamCatalogObserver({
      loadSettings: async () => settings(),
      now: () => 5_000,
      ttlMs: 60_000
    })

    const first = await observer.observe(QUERY)
    expect(first?.kind).toBe('declared')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.url).toContain('/models')
    expect(hits[0]?.authorization).toBe('Bearer sk-http-test-1')

    await observer.observe(QUERY)
    expect(hits).toHaveLength(1) // fresh cache: no new HTTP request

    await observer.observe(QUERY, { force: true })
    expect(hits).toHaveLength(2)

    await Promise.all([
      observer.observe(QUERY, { force: true }),
      observer.observe(QUERY, { force: true })
    ])
    expect(hits).toHaveLength(3) // concurrent force queries share one request
  })

  it('keeps serving a still-fresh observation when a forced refresh fails, then labels the expired one stale and stops re-polling', async () => {
    let now = 5_000
    const observer = new UpstreamCatalogObserver({
      loadSettings: async () => settings(),
      now: () => now,
      ttlMs: 60_000,
      backoffBaseMs: 10_000
    })

    await observer.observe(QUERY)
    expect(hits).toHaveLength(1)

    // A forced re-check fails while the cached window is still open: the
    // observation is returned as-is (it is genuinely fresh).
    mode = 'fail'
    const stillFresh = await observer.observe(QUERY, { force: true })
    expect(stillFresh?.kind).toBe('declared')
    expect(stillFresh?.stale).toBeUndefined()
    expect(hits).toHaveLength(2)

    // Past the TTL with the upstream still failing: the last valid observation
    // is labeled stale with the HTTP failure reason.
    now += 61_000
    const stale = await observer.observe(QUERY)
    expect(stale?.kind).toBe('declared')
    expect(stale?.stale).toBe(true)
    expect(String(stale?.refreshError)).toContain('503')
    expect(hits).toHaveLength(3)

    // Inside the backoff window nothing is re-polled (no busy requests).
    now += 1_000
    const stillStale = await observer.observe(QUERY)
    expect(stillStale?.stale).toBe(true)
    expect(hits).toHaveLength(3)
  })

  it('bounds a hanging request with its timeout and stays quiet during backoff', async () => {
    const observer = new UpstreamCatalogObserver({
      loadSettings: async () => settings(),
      ttlMs: 60_000,
      timeoutMs: 150,
      backoffBaseMs: 60_000
    })

    mode = 'hang'
    const result = await observer.observe(QUERY)
    expect(result).toBeNull() // nothing cached yet, request timed out
    expect(hits).toHaveLength(1)

    // Backoff keeps the hanging upstream from being hammered.
    const second = await observer.observe(QUERY)
    expect(second).toBeNull()
    expect(hits).toHaveLength(1)
  })

  it('propagates an explicit abort signal to the wire request', async () => {
    const observer = new UpstreamCatalogObserver({
      loadSettings: async () => settings(),
      ttlMs: 60_000,
      timeoutMs: 30_000,
      backoffBaseMs: 60_000
    })

    mode = 'hang'
    const controller = new AbortController()
    const pending = observer.observe(QUERY, { signal: controller.signal })
    setTimeout(() => controller.abort(), 50)
    const result = await pending
    expect(result).toBeNull()
    expect(hits).toHaveLength(1)
  })
})