import { createHash } from 'node:crypto'
import {
  ZOTERO_API_BASE_URL,
  ZOTERO_MAX_PAGE_SIZE,
  zoteroItemSchema,
  zoteroListItemsResultSchema,
  zoteroWriteResultSchema,
  zoteroWritableItemSchema,
  type ZoteroItem,
  type ZoteroListItemsResult,
  type ZoteroWritableItem,
  type ZoteroWriteResult
} from './contract.js'

/**
 * Zotero Web API v3 client with an injected fetch.
 *
 * The client never reaches for `globalThis.fetch` and never ships a credential:
 * the api key is passed in at construction and sent only in the Authorization
 * header. Errors are scrubbed so the key can never leak into a message, and the
 * base URL is pinned to HTTPS on api.zotero.org.
 */

export type ZoteroFetch = typeof fetch

export type ZoteroClientOptions = Readonly<{
  fetch: ZoteroFetch
  userId: string
  apiKey: string
  /** Optional override for the fixture/tests; must stay on api.zotero.org over HTTPS. */
  baseUrl?: string
}>

export class ZoteroClient {
  private readonly fetch: ZoteroFetch
  private readonly userId: string
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(options: ZoteroClientOptions) {
    if (typeof options.fetch !== 'function') throw new Error('A fetch implementation is required.')
    this.fetch = options.fetch
    this.userId = options.userId.trim()
    this.apiKey = options.apiKey.trim()
    if (!/^\d+$/u.test(this.userId) || !this.apiKey) throw new Error('A numeric Zotero userId and a non-empty api key are required.')
    this.baseUrl = assertAllowedBaseUrl(options.baseUrl ?? ZOTERO_API_BASE_URL)
  }

  /** Lists items honoring Zotero's 100-item page cap. */
  async listItems(input: { start?: number; limit?: number } = {}): Promise<ZoteroListItemsResult> {
    const start = input.start ?? 0
    const limit = input.limit ?? ZOTERO_MAX_PAGE_SIZE
    if (!Number.isInteger(start) || start < 0) throw new Error('Zotero read start must be a non-negative integer.')
    if (!Number.isInteger(limit) || limit < 1 || limit > ZOTERO_MAX_PAGE_SIZE) {
      throw new Error(`Zotero read limit must be between 1 and ${ZOTERO_MAX_PAGE_SIZE}.`)
    }

    const url = new URL(`${this.baseUrl}/users/${this.userId}/items`)
    url.searchParams.set('format', 'json')
    url.searchParams.set('include', 'data')
    url.searchParams.set('start', String(start))
    url.searchParams.set('limit', String(limit))

    const response = await this.request('GET', url.toString())
    const totalResults = parseTotalResults(response.headers.get('total-results'))
    if (!response.ok) {
      throw new Error(`Zotero read failed with HTTP ${response.status}.`)
    }
    const raw = await this.readJson(response)
    if (!Array.isArray(raw)) throw new Error('Zotero read returned a non-array payload.')
    const items = raw.flatMap((entry) => {
      const item = normalizeItem(entry)
      return item ? [item] : []
    })
    const returned = items.length
    if (raw.length === 0 && start < totalResults) throw new Error('Zotero returned an empty page before the reported end; retry this offset.')
    return zoteroListItemsResultSchema.parse({
      items,
      totalResults,
      start,
      returned,
      scanned: raw.length,
      nextStart: start + raw.length < totalResults ? start + raw.length : null,
      hasMore: start + raw.length < totalResults
    })
  }

  /** Reads one item by its Zotero key, or null when absent or not a bibliography item. */
  async getItem(key: string): Promise<ZoteroItem | null> {
    const trimmed = key.trim()
    if (!trimmed) throw new Error('A Zotero item key is required.')
    const url = new URL(`${this.baseUrl}/users/${this.userId}/items/${encodeURIComponent(trimmed)}`)
    url.searchParams.set('format', 'json')
    url.searchParams.set('include', 'data')
    const response = await this.request('GET', url.toString())
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Zotero read failed with HTTP ${response.status}.`)
    return normalizeItem(await this.readJson(response))
  }

  /** Creates new bibliography items and returns Zotero's per-index write report. */
  async createItems(items: readonly ZoteroWritableItem[], operationId: string): Promise<ZoteroWriteResult> {
    if (typeof operationId !== 'string' || operationId.trim().length < 8 || operationId.length > 200) {
      throw new Error('A Zotero write operationId of 8–200 characters is required.')
    }
    if (items.length > 50) throw new Error('Zotero writes support at most 50 items per operation.')
    if (items.length === 0) return { successful: {}, unchanged: {}, failed: {} }
    const body = items.map((item, index) => {
      const parsed = zoteroWritableItemSchema.safeParse(item)
      if (!parsed.success) throw new Error('Invalid Zotero write item.')
      const digest = createHash('sha256').update(JSON.stringify(['sciforge-zotero-create-v1', this.userId, operationId.trim(), index])).digest()
      const alphabet = '23456789ABCDEFGHIJKLMNPQRSTUVWXYZ'
      let bits = BigInt(`0x${digest.subarray(0, 5).toString('hex')}`)
      let key = ''
      for (let i = 0; i < 8; i++) { key = alphabet[Number(bits & 31n)] + key; bits >>= 5n }
      return { ...parsed.data, key, version: 0 }
    })
    const url = new URL(`${this.baseUrl}/users/${this.userId}/items`)
    const response = await this.request('POST', url.toString(), body)
    if (!response.ok) throw new Error(`Zotero write failed with HTTP ${response.status}.`)
    const raw = await this.readJson(response, false)
    // Server error prose is untrusted and can echo credentials or request data.
    if (raw && typeof raw === 'object' && 'failed' in raw && raw.failed && typeof raw.failed === 'object') {
      for (const failure of Object.values(raw.failed)) {
        if (failure && typeof failure === 'object' && 'message' in failure) failure.message = 'Zotero rejected this item.'
      }
    }
    const parsed = zoteroWriteResultSchema.safeParse(raw)
    if (!parsed.success || containsCredential(parsed.data, this.apiKey)) throw new Error('Invalid Zotero write response.')
    return parsed.data
  }

  private async readJson(response: Response, rejectCredential = true): Promise<unknown> {
    let value: unknown
    try { value = await response.json() } catch { throw new Error('Invalid Zotero JSON response.') }
    if (rejectCredential && containsCredential(value, this.apiKey)) throw new Error('Unsafe Zotero response.')
    return value
  }

  private async request(method: 'GET' | 'POST', url: string, body?: unknown): Promise<Response> {
    try { return await this.fetch(url, {
      method,
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Zotero-API-Version': '3',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    }) } catch { throw new Error('Zotero network request failed; remote write outcome may be unknown. Retry with the same operationId.') }
  }
}

function containsCredential(value: unknown, credential: string): boolean {
  if (typeof value === 'string') return value.includes(credential)
  if (value && typeof value === 'object') return Object.values(value).some((entry) => containsCredential(entry, credential))
  return false
}

function assertAllowedBaseUrl(baseUrl: string): string {
  const value = baseUrl.trim().replace(/\/+$/u, '')
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('The Zotero base URL is invalid.')
  }
  if (parsed.protocol !== 'https:') throw new Error('The Zotero base URL must use HTTPS.')
  if (parsed.host !== 'api.zotero.org') throw new Error('The Zotero base URL must target api.zotero.org.')
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('The Zotero base URL must be an origin.')
  return value
}

function parseTotalResults(header: string | null): number {
  if (!header) return 0
  const value = Number.parseInt(header, 10)
  return Number.isFinite(value) && value >= 0 ? value : 0
}

/** Defensively normalizes a raw Zotero item; null when it has no usable title. */
export function normalizeItem(value: unknown): ZoteroItem | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const entry = value as { data?: Record<string, unknown>; meta?: { parsedDate?: unknown } }
  const data = (entry.data ?? entry) as Record<string, unknown>
  const title = typeof data.title === 'string' ? data.title.trim() : ''
  if (data.itemType === 'attachment' || data.itemType === 'note' || data.itemType === 'annotation') return null
  if (!title) return null
  const parsed = zoteroItemSchema.safeParse({
    key: data.key,
    version: data.version,
    itemType: data.itemType,
    title,
    creators: Array.isArray(data.creators) ? data.creators : [],
    date: typeof data.date === 'string' ? data.date : undefined,
    parsedDate: typeof entry.meta?.parsedDate === 'string' ? entry.meta.parsedDate : undefined,
    doi: typeof data.DOI === 'string' ? data.DOI : undefined,
    publicationTitle: typeof data.publicationTitle === 'string' ? data.publicationTitle : undefined,
    abstractNote: typeof data.abstractNote === 'string' ? data.abstractNote : undefined
  })
  return parsed.success ? parsed.data : null
}
