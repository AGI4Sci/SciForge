/**
 * Real upstream catalog observation contract.
 *
 *  - successful observations cache ~24h and force bypasses the TTL;
 *  - a listing without capability fields is `unknown` (never “unsupported”);
 *  - failures keep the last valid observation, back off per key, and never
 *    block the caller;
 *  - cache keys isolate by endpoint + model + credential fingerprint; the raw
 *    key never becomes a cache key, is never logged, and never hits disk.
 */
import { describe, expect, it, vi } from 'vitest'

import type { AppSettingsV1 } from '../../shared/app-settings'
import { upstreamOpenAiModelsUrl } from '../../shared/openai-compat-url'
import {
  UpstreamCatalogObserver,
  reasoningDeclarationFromCatalogPayload
} from './upstream-catalog'

function settingsWith(textReasoner: Record<string, unknown> = {}): AppSettingsV1 {
  return {
    modelRouter: {
      profiles: {
        default: {
          textReasoner: {
            baseUrl: 'https://up.example/v1',
            apiKey: 'test-key-1',
            model: 'up-model',
            protocol: 'auto',
            ...textReasoner
          }
        }
      }
    }
  } as unknown as AppSettingsV1
}

const QUERY = { provider: 'model-router', model: 'up-model', protocol: 'auto', endpoint: null }

function catalogResponse(payload: unknown): Response {
  return Response.json(payload)
}

describe('reasoningDeclarationFromCatalogPayload', () => {
  it('reads declared levels and the default from an explicit listing', () => {
    const declaration = reasoningDeclarationFromCatalogPayload(
      {
        data: [
          {
            id: 'up-model',
            supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }],
            default_reasoning_level: 'high'
          }
        ]
      },
      'up-model',
      '2026-10-26T00:00:00.000Z'
    )
    expect(declaration).toEqual({
      kind: 'declared',
      levels: [{ id: 'low' }, { id: 'high', isDefault: true }],
      observedAt: '2026-10-26T00:00:00.000Z'
    })
  })

  it('treats absent, empty, or unmatched fields as unknown — never unsupported', () => {
    expect(reasoningDeclarationFromCatalogPayload({ data: [{ id: 'up-model' }] }, 'up-model', 't')).toEqual({ kind: 'unknown' })
    expect(
      reasoningDeclarationFromCatalogPayload({ data: [{ id: 'up-model', supported_reasoning_levels: [] }] }, 'up-model', 't')
    ).toEqual({ kind: 'unknown' })
    expect(
      reasoningDeclarationFromCatalogPayload({ data: [{ id: 'other-model' }] }, 'up-model', 't')
    ).toEqual({ kind: 'unknown' })
    expect(reasoningDeclarationFromCatalogPayload({}, 'up-model', 't')).toEqual({ kind: 'unknown' })
  })

  it('accepts only explicit negative markers as declared-unsupported', () => {
    expect(
      reasoningDeclarationFromCatalogPayload(
        { data: [{ id: 'up-model', supports_reasoning: false }] },
        'up-model',
        't'
      )
    ).toEqual({ kind: 'declared-unsupported', observedAt: 't' })
    expect(
      reasoningDeclarationFromCatalogPayload(
        { data: [{ id: 'up-model', reasoning_supported: false }] },
        'up-model',
        't'
      )
    ).toEqual({ kind: 'declared-unsupported', observedAt: 't' })
    expect(
      reasoningDeclarationFromCatalogPayload(
        { data: [{ id: 'up-model', declared_unsupported: true }] },
        'up-model',
        't'
      )
    ).toEqual({ kind: 'declared-unsupported', observedAt: 't' })
  })
})

describe('UpstreamCatalogObserver', () => {
  it('fetches the upstream /models URL once, caches the observation, and force bypasses the TTL', async () => {
    let now = 1_000
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      catalogResponse({ data: [{ id: 'up-model', supported_reasoning_levels: [{ effort: 'high' }] }] })
    )
    const observer = new UpstreamCatalogObserver({
      loadSettings: () => settingsWith(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
      ttlMs: 60_000
    })

    const first = await observer.observe(QUERY)
    expect(first?.kind).toBe('declared')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(upstreamOpenAiModelsUrl('https://up.example/v1'))
    const headers = (fetchImpl.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>
    expect(headers.Authorization).toBe('Bearer test-key-1')

    now += 30_000
    await observer.observe(QUERY)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    await observer.observe(QUERY, { force: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    now += 61_000
    await observer.observe(QUERY)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('keeps the last valid observation after a failure and backs off per key', async () => {
    let now = 1_000
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        catalogResponse({ data: [{ id: 'up-model', supported_reasoning_levels: [{ effort: 'high' }] }] })
      )
      .mockRejectedValue(new Error('network down'))
    const observer = new UpstreamCatalogObserver({
      loadSettings: () => settingsWith(),
      fetchImpl,
      now: () => now,
      ttlMs: 60_000,
      backoffBaseMs: 10_000,
      backoffMaxMs: 40_000
    })

    const first = await observer.observe(QUERY)
    expect(first?.kind).toBe('declared')

    now += 61_000
    const stale = await observer.observe(QUERY)
    // The failed re-check never erases good data — it labels it stale instead.
    expect(stale?.kind).toBe('declared')
    expect(stale && 'levels' in stale ? stale.levels : null).toEqual(
      first && 'levels' in first ? first.levels : null
    )
    expect(stale?.stale).toBe(true)
    expect(String(stale?.refreshError)).toContain('network down')
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    // Backed off: no wire call while the backoff window is open.
    now += 5_000
    await observer.observe(QUERY)
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    // The window closes: the next check retries.
    now += 6_000
    await observer.observe(QUERY)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('dedupes concurrent observations into one request', async () => {
    const gateControl: { release?: () => void } = {}
    const gate = new Promise<void>((resolve) => {
      gateControl.release = resolve
    })
    let calls = 0
    const observer = new UpstreamCatalogObserver({
      loadSettings: () => settingsWith(),
      fetchImpl: (async () => {
        calls += 1
        await gate
        return catalogResponse({ data: [{ id: 'up-model' }] })
      }) as unknown as typeof fetch
    })
    const first = observer.observe(QUERY)
    const second = observer.observe(QUERY)
    // Let the first attempt register as in-flight before releasing the gate.
    await new Promise((resolve) => setTimeout(resolve, 0))
    gateControl.release?.()
    const [a, b] = await Promise.all([first, second])
    expect(calls).toBe(1)
    expect(a).toEqual(b)
  })

  it('never shares one conclusion across credentials for the same endpoint', async () => {
    let apiKey = 'test-key-1'
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      catalogResponse({ data: [{ id: 'up-model' }] })
    )
    const observer = new UpstreamCatalogObserver({
      loadSettings: () => settingsWith({ apiKey }),
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    await observer.observe(QUERY)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    apiKey = 'test-key-2'
    await observer.observe(QUERY)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('bounds a request with a timeout and stays quiet while the failure is recent', async () => {
    const fetchImpl = (_url: URL | RequestInfo, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    const observer = new UpstreamCatalogObserver({
      loadSettings: () => settingsWith(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 20,
      backoffBaseMs: 60_000
    })
    expect(await observer.observe(QUERY)).toBeNull()
    let calls = 0
    const counting = new UpstreamCatalogObserver({
      loadSettings: () => settingsWith(),
      fetchImpl: (async () => {
        calls += 1
        throw new Error('down')
      }) as unknown as typeof fetch
    })
    await counting.observe(QUERY)
    await counting.observe(QUERY)
    expect(calls).toBe(1)
  })

  it('clear() forces the next observation to hit the wire again', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      catalogResponse({ data: [{ id: 'up-model' }] })
    )
    const observer = new UpstreamCatalogObserver({
      loadSettings: () => settingsWith(),
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    await observer.observe(QUERY)
    observer.clear()
    await observer.observe(QUERY)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('labels an expired last-valid observation as stale with the refresh failure reason', async () => {
    let now = 1_000
    const fetchImpl = vi.fn(async () =>
      catalogResponse({ data: [{ id: 'up-model', supported_reasoning_levels: [{ effort: 'high' }] }] })
    )
    const observer = new UpstreamCatalogObserver({
      loadSettings: () => settingsWith(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
      ttlMs: 60_000,
      backoffBaseMs: 5_000
    })

    const fresh = await observer.observe(QUERY)
    expect(fresh?.kind).toBe('declared')
    expect(fresh?.stale).toBeUndefined()

    // The entry expires and the re-check fails: the last valid observation is
    // served, but labeled stale with the failure reason — never as fresh.
    now += 61_000
    fetchImpl.mockImplementationOnce(async () => new Response('nope', { status: 503 }))
    const stale = await observer.observe(QUERY)
    expect(stale?.kind).toBe('declared')
    expect(stale?.stale).toBe(true)
    expect(String(stale?.refreshError)).toContain('upstream catalog request failed (503)')
    expect(String(stale?.refreshError)).toContain('last valid observation')

    // Inside the backoff window the wire is not touched again and the stale
    // labeling persists (no busy re-polling).
    const calls = fetchImpl.mock.calls.length
    now += 1_000
    const stillStale = await observer.observe(QUERY)
    expect(fetchImpl.mock.calls.length).toBe(calls)
    expect(stillStale?.stale).toBe(true)
  })
})