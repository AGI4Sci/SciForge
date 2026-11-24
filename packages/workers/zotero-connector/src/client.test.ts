import { describe, expect, it } from 'vitest'
import { ZoteroClient, normalizeItem, type ZoteroFetch } from './client.js'
import { ZOTERO_API_BASE_URL } from './contract.js'

type RecordedRequest = { url: string; init?: RequestInit }

function fixtureFetch(
  route: (request: RecordedRequest) => Response,
  requests: RecordedRequest[] = []
): ZoteroFetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const request = { url, init }
    requests.push(request)
    return route(request)
  }) as ZoteroFetch
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers }
  })
}

const item = (key: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  key,
  version: 7,
  itemType: 'journalArticle',
  title: `Paper ${key}`,
  creators: [{ creatorType: 'author', firstName: 'Ada', lastName: 'Lovelace' }],
  date: '2021',
  DOI: '10.1234/example',
  ...overrides
})

describe('ZoteroReadClient', () => {
  it('sends the api key only in the Authorization header and pins the base URL', async () => {
    const requests: RecordedRequest[] = []
    const client = new ZoteroClient({
      fetch: fixtureFetch(() => jsonResponse([{ data: item('AAAA1111') }], { 'Total-Results': '1' }), requests),
      userId: '475425',
      apiKey: 'secret-key-123'
    })
    await client.listItems({ start: 0, limit: 25 })

    expect(requests).toHaveLength(1)
    const request = requests[0]!
    expect(request.url).toContain(`${ZOTERO_API_BASE_URL}/users/475425/items`)
    expect(request.url).toContain('start=0')
    expect(request.url).toContain('limit=25')
    expect(request.url).not.toContain('secret-key-123')
    expect((request.init?.headers as Record<string, string>).Authorization).toBe('Bearer secret-key-123')
    expect(request.init?.redirect).toBe('error')
  })

  it('normalizes items and reports pagination from the Total-Results header', async () => {
    const client = new ZoteroClient({
      fetch: fixtureFetch(() => jsonResponse([
        { data: item('AAAA1111') },
        { data: item('BBBB2222', { title: '' }) } // skipped: no title
      ], { 'Total-Results': '120' })),
      userId: '475425',
      apiKey: 'k'
    })
    const result = await client.listItems({ start: 0, limit: 100 })
    expect(result.items.map((entry) => entry.key)).toEqual(['AAAA1111'])
    expect(result.totalResults).toBe(120)
    expect(result.returned).toBe(1)
    expect(result.hasMore).toBe(true)
  })

  it('returns null for a missing item and throws a scrubbed error on other failures', async () => {
    let status = 404
    const client = new ZoteroClient({
      fetch: fixtureFetch(() => new Response('{}', { status })),
      userId: '475425',
      apiKey: 'secret-key-123'
    })
    await expect(client.getItem('NOPE1234')).resolves.toBeNull()

    status = 500
    await expect(client.getItem('AAAA1111')).rejects.toThrow('HTTP 500')
    await expect(client.getItem('AAAA1111')).rejects.not.toThrow('secret-key-123')
  })

  it('rejects a non-HTTPS or non-Zotero base URL', () => {
    const make = (baseUrl: string) => new ZoteroClient({
      fetch: fixtureFetch(() => new Response('{}')), userId: '475425', apiKey: 'k', baseUrl
    })
    expect(() => make('http://api.zotero.org')).toThrow(/HTTPS/u)
    expect(() => make('https://evil.example.com')).toThrow(/api\.zotero\.org/u)
    expect(() => make(`${ZOTERO_API_BASE_URL}/`)).not.toThrow()
  })

  it('rejects an invalid page size and a missing credential', () => {
    const client = new ZoteroClient({
      fetch: fixtureFetch(() => new Response('{}')), userId: '475425', apiKey: 'k'
    })
    expect(client.listItems({ limit: 101 })).rejects.toThrow(/limit/u)
    expect(() => new ZoteroClient({
      fetch: fixtureFetch(() => new Response('{}')), userId: 'not-a-number', apiKey: 'k'
    })).toThrow(/userId/u)
  })
})

describe('normalizeItem', () => {
  it('reads the editable data wrapper and the meta parsedDate', () => {
    const normalized = normalizeItem({
      key: 'K',
      version: 1,
      data: { key: 'K', version: 1, itemType: 'book', title: 'A Book', creators: [] },
      meta: { parsedDate: '1999-01-01' }
    })
    expect(normalized).toMatchObject({ key: 'K', title: 'A Book', parsedDate: '1999-01-01' })
  })

  it('returns null for a title-less entry', () => {
    expect(normalizeItem({ data: { key: 'K', itemType: 'note', title: '' } })).toBeNull()
    expect(normalizeItem(null)).toBeNull()
  })
})

describe('ZoteroClient.createItems', () => {
  it('POSTs the items and parses the per-index write report', async () => {
    const requests: RecordedRequest[] = []
    const client = new ZoteroClient({
      fetch: fixtureFetch(() => new Response(JSON.stringify({
        successful: { '0': { key: 'NEWKEY1', version: 1 } },
        unchanged: {},
        failed: { '1': { code: 409, message: 'Duplicate' } }
      }), { status: 201 }), requests),
      userId: '475425',
      apiKey: 'k'
    })
    const result = await client.createItems([
      { itemType: 'journalArticle', title: 'Alpha', creators: [] },
      { itemType: 'journalArticle', title: 'Beta', creators: [] }
    ], 'operation-create-1')
    expect(result.successful['0']).toMatchObject({ key: 'NEWKEY1', version: 1 })
    expect(result.failed['1']).toMatchObject({ message: 'Zotero rejected this item.' })

    expect(requests).toHaveLength(1)
    expect(requests[0]!.init?.method).toBe('POST')
    expect((requests[0]!.init?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(requests[0]!.init?.body as string)).toHaveLength(2)
  })

  it('short-circuits an empty write without a request', async () => {
    const requests: RecordedRequest[] = []
    const client = new ZoteroClient({
      fetch: fixtureFetch(() => new Response('{}'), requests), userId: '475425', apiKey: 'k'
    })
    await expect(client.createItems([], 'operation-empty')).resolves.toEqual({ successful: {}, unchanged: {}, failed: {} })
    expect(requests).toHaveLength(0)
  })
})

describe('retry and error boundaries', () => {
  it('rejects missing operation ids, oversized writes and non-origin base URLs', async () => {
    const requests: RecordedRequest[] = []
    const client = new ZoteroClient({ userId: '1', apiKey: 'k', fetch: fixtureFetch(() => jsonResponse({}), requests) })
    await expect(client.createItems([], '')).rejects.toThrow('operationId')
    await expect(client.createItems(Array.from({ length: 51 }, () => ({ itemType: 'book', title: 'A', creators: [] })), 'operation-large')).rejects.toThrow('50')
    expect(requests).toHaveLength(0)
    for (const baseUrl of ['https://x:secret@api.zotero.org', 'https://api.zotero.org/?key=secret', 'https://api.zotero.org/path']) {
      expect(() => new ZoteroClient({ userId: '1', apiKey: 'k', fetch: fixtureFetch(() => jsonResponse({})), baseUrl })).toThrow('origin')
    }
  })

  it('fails a prematurely empty raw page rather than returning a looping offset', async () => {
    const client = new ZoteroClient({ userId: '1', apiKey: 'k', fetch: fixtureFetch(() => jsonResponse([], { 'Total-Results': '5' })) })
    await expect(client.listItems({ start: 2 })).rejects.toThrow('empty page')
  })

  it('advances through mixed and entirely filtered pages using raw counts', async () => {
    for (const title of ['', 'Usable']) {
      const client = new ZoteroClient({ userId: '1', apiKey: 'k', fetch: fixtureFetch(() =>
        jsonResponse([{ data: item('A', { title: '' }) }, { data: item('B', { title }) }], { 'Total-Results': '4' })) })
      expect(await client.listItems({ start: 2 })).toMatchObject({ scanned: 2, nextStart: null, hasMore: false })
    }
  })

  it('reuses create-only keys after a lost response and a new client', async () => {
    const stored = new Set<string>()
    const bodies: any[] = []
    const fetcher = (async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      bodies.push(body)
      expect(body[0].version).toBe(0)
      expect(body[0].key).toMatch(/^[23456789ABCDEFGHIJKLMNPQRSTUVWXYZ]{8}$/u)
      if (stored.has(body[0].key)) return new Response('{}', { status: 412 })
      stored.add(body[0].key)
      throw new Error('response lost')
    }) as ZoteroFetch
    const make = () => new ZoteroClient({ userId: '1', apiKey: 'k', fetch: fetcher })
    const entries = [{ itemType: 'book', title: 'A', creators: [] }]
    await expect(make().createItems(entries, 'operation-123')).rejects.toThrow()
    await expect(make().createItems(entries, 'operation-123')).rejects.toThrow('412')
    expect(bodies[0]).toEqual(bodies[1])
    expect(stored.size).toBe(1)
    await expect(make().createItems([{ ...entries[0]!, title: 'Changed' }], 'operation-123')).rejects.toThrow('412')
    expect(stored.size).toBe(1)
    await expect(make().createItems(entries, 'operation-456')).rejects.toThrow()
    expect(stored.size).toBe(2)
  })

  it('does not expose network, JSON, schema or per-item server error text', async () => {
    const secret = 'SENTINEL-credential'
    const routes = [
      () => { throw new Error(secret) },
      () => new Response(secret),
      () => jsonResponse({ successful: { '0': { key: secret, version: secret } } })
    ]
    for (const route of routes) {
      const client = new ZoteroClient({ userId: '1', apiKey: secret, fetch: fixtureFetch(route) })
      try { await client.createItems([{ itemType: 'book', title: 'A', creators: [] }], 'operation-error'); expect.fail('expected rejection') }
      catch (error) { expect(String(error)).not.toContain(secret); expect((error as Error).cause).toBeUndefined() }
    }
    const client = new ZoteroClient({ userId: '1', apiKey: secret, fetch: fixtureFetch(() => jsonResponse({
      successful: {}, unchanged: {}, failed: { '0': { code: 400, message: secret } }
    })) })
    expect(JSON.stringify(await client.createItems([{ itemType: 'book', title: 'A', creators: [] }], 'operation-error'))).not.toContain(secret)
    for (const route of routes.slice(0, 2)) {
      const reader = new ZoteroClient({ userId: '1', apiKey: secret, fetch: fixtureFetch(route) })
      await expect(reader.listItems()).rejects.not.toThrow(secret)
      await expect(reader.getItem('KEY')).rejects.not.toThrow(secret)
    }
  })
})
