import { lookup as nodeDnsLookup } from 'node:dns/promises'
import * as http from 'node:http'
import * as https from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { Readable } from 'node:stream'
import type { LocalRuntimeCapabilitiesConfig, WebCapabilityConfig } from '../../contracts/capabilities.js'
import type { WebFetchResult, WebProvider, WebSearchResult } from '../../ports/web-provider.js'
import { sourceIdFor, UnavailableWebProvider } from '../../ports/web-provider.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'

const DEFAULT_WEB_TIMEOUT_MS = 15_000
const DEFAULT_WEB_MAX_BYTES = 1_000_000
const DEFAULT_SEARCH_LIMIT = 5
const MAX_SEARCH_LIMIT = 10
const MAX_PUBLIC_SEARCH_CANDIDATES = 30
const DEFAULT_WEB_SEARCH_RESPONSE_MAX_BYTES = 1_000_000
const MAX_WEB_REDIRECTS = 5
const PUBLIC_WEB_PROVIDER_ID = 'public-rss'
const PUBLIC_WEB_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 SciForge/0.1'
const REPUTABLE_WEB_HOST_SUFFIXES = [
  'apnews.com',
  'arstechnica.com',
  'bbc.com',
  'bbc.co.uk',
  'bloomberg.com',
  'cnbc.com',
  'ft.com',
  'nature.com',
  'nytimes.com',
  'reuters.com',
  'science.org',
  'techcrunch.com',
  'theverge.com',
  'wired.com',
  'wsj.com',
  'xinhuanet.com'
] as const
const GENERIC_SEARCH_TERMS = new Set([
  'a', 'about', 'an', 'and', 'announcement', 'current', 'find', 'for', 'latest',
  'launch', 'launched', 'model', 'new', 'news', 'of', 'official', 'on', 'release',
  'released', 'research', 'the', 'update', 'with'
])

export type WebProviderDiagnostic = {
  id: string
  enabled: boolean
  available: boolean
  fetchAvailable: boolean
  searchAvailable: boolean
  provider?: string
  reason?: string
}

export type WebToolProviderBuildResult = {
  providers: CapabilityToolProvider[]
  diagnostics: WebProviderDiagnostic[]
  fetchAvailable: boolean
  searchAvailable: boolean
  provider?: string
}

export type WebToolProviderOptions = {
  provider?: WebProvider
  nowIso?: () => string
  dnsLookup?: WebDnsLookup
  httpRequest?: WebHttpRequest
}

export type WebDnsLookup = (hostname: string) => Promise<ReadonlyArray<{
  address: string
  family: number
}>>

export type WebHttpRequest = (
  url: URL,
  addresses: ReadonlyArray<{ address: string; family: number }>,
  signal: AbortSignal,
  headers: Record<string, string>
) => Promise<WebHttpResponse>

export type WebHttpResponse = {
  status: number
  headers: { get(name: string): string | null }
  body: ReadableStream<Uint8Array> | null
}

export function buildWebToolProviders(
  config: LocalRuntimeCapabilitiesConfig['web'] | undefined,
  options: WebToolProviderOptions = {}
): WebToolProviderBuildResult {
  const web = config
  if (!web?.enabled) {
    return {
      providers: [],
      diagnostics: [],
      fetchAvailable: false,
      searchAvailable: false
    }
  }

  const provider: WebProvider = options.provider ?? defaultWebProvider(web, options)
  const tools = []
  if (web.fetchEnabled) {
    tools.push(createFetchTool(web, provider))
  }
  if (web.searchEnabled) {
    tools.push(createSearchTool(web, provider))
  }
  const fetchAvailable = Boolean(web.fetchEnabled && provider.fetch)
  const searchAvailable = Boolean(web.searchEnabled && provider.search)
  const reason = !tools.length
    ? 'web tools are disabled by config'
    : !fetchAvailable && !searchAvailable
      ? 'web provider is unavailable'
      : undefined

  return {
    providers: tools.length
      ? [{
          id: 'web',
          kind: 'web',
          enabled: true,
          available: true,
          ...(reason ? { reason } : {}),
          tools
        }]
      : [],
    diagnostics: [{
      id: 'web',
      enabled: true,
      available: fetchAvailable || searchAvailable,
      fetchAvailable,
      searchAvailable,
      provider: provider.id,
      ...(reason ? { reason } : {})
    }],
    fetchAvailable,
    searchAvailable,
    provider: provider.id
  }
}

function createFetchTool(config: WebCapabilityConfig, provider: WebProvider) {
  return LocalToolHost.defineTool({
    name: 'web_fetch',
    description: 'Fetch an allowed HTTP or HTTPS URL and return extracted text with source metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        max_bytes: { type: 'number' },
        timeout_ms: { type: 'number' }
      },
      required: ['url'],
      additionalProperties: false
    },
    policy: 'untrusted',
    execute: async (args, context) => {
      const startedAt = Date.now()
      const rawUrl = pickString(args.url)
      if (!rawUrl) return toolError('invalid_url', 'url is required')
      const policy = validateUrlPolicy(rawUrl, config)
      if (!policy.ok) return toolError('policy_blocked', policy.reason, telemetry({ startedAt, policy: 'blocked', url: rawUrl }))
      if (!provider.fetch) return toolError('provider_unavailable', 'web fetch provider is unavailable')
      const maxBytes = boundedInt(args.max_bytes, DEFAULT_WEB_MAX_BYTES, 1, DEFAULT_WEB_MAX_BYTES)
      const timeoutMs = boundedInt(args.timeout_ms, DEFAULT_WEB_TIMEOUT_MS, 1, DEFAULT_WEB_TIMEOUT_MS)
      try {
        const result = await provider.fetch({
          url: policy.url.href,
          maxBytes,
          timeoutMs,
          signal: context.abortSignal
        })
        return {
          output: fetchOutput(result, telemetry({
            startedAt,
            policy: 'allowed',
            url: policy.url.href,
            provider: provider.id,
            byteCount: result.byteCount
          }))
        }
      } catch (error) {
        const policyBlocked = error instanceof WebPolicyError
        return toolError(policyBlocked ? 'policy_blocked' : 'fetch_failed', errorMessage(error), telemetry({
          startedAt,
          policy: policyBlocked ? 'blocked' : 'allowed',
          url: policy.url.href,
          provider: provider.id
        }))
      }
    }
  })
}

function createSearchTool(config: WebCapabilityConfig, provider: WebProvider) {
  return LocalToolHost.defineTool({
    name: 'web_search',
    description: 'Search the web through the configured provider and return ranked results with source metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' },
        timeout_ms: { type: 'number' }
      },
      required: ['query'],
      additionalProperties: false
    },
    policy: 'untrusted',
    execute: async (args, context) => {
      const startedAt = Date.now()
      const query = pickString(args.query)
      if (!query) return toolError('invalid_query', 'query is required')
      if (!provider.search) return toolError('provider_unavailable', 'web search provider is unavailable')
      const limit = boundedInt(args.limit, DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT)
      const timeoutMs = boundedInt(args.timeout_ms, DEFAULT_WEB_TIMEOUT_MS, 1, DEFAULT_WEB_TIMEOUT_MS)
      try {
        const results = await provider.search({
          query,
          limit,
          timeoutMs,
          signal: context.abortSignal
        })
        return {
          output: searchOutput(query, provider.id, results, telemetry({
            startedAt,
            policy: 'allowed',
            provider: provider.id,
            query,
            resultCount: results.length
          }))
        }
      } catch (error) {
        return toolError('search_failed', errorMessage(error), telemetry({
          startedAt,
          policy: 'allowed',
          provider: provider.id,
          query
        }))
      }
    }
  })
}

function defaultWebProvider(web: WebCapabilityConfig, options: WebToolProviderOptions): WebProvider {
  if (!web.fetchEnabled && !web.searchEnabled) return new UnavailableWebProvider(web.provider)
  if (web.provider && web.provider !== PUBLIC_WEB_PROVIDER_ID && web.provider !== 'fetch') {
    return new UnavailableWebProvider(web.provider)
  }
  return new PublicRssWebProvider(web, options.nowIso, options.dnsLookup, options.httpRequest)
}

class PublicRssWebProvider implements WebProvider {
  readonly id = PUBLIC_WEB_PROVIDER_ID
  private readonly nowIso: () => string
  private readonly dnsLookup: WebDnsLookup
  private readonly httpRequest: WebHttpRequest

  constructor(
    private readonly config: WebCapabilityConfig,
    nowIso: (() => string) | undefined,
    dnsLookup: WebDnsLookup | undefined,
    httpRequest: WebHttpRequest | undefined
  ) {
    this.nowIso = nowIso ?? (() => new Date().toISOString())
    this.dnsLookup = dnsLookup ?? defaultDnsLookup
    this.httpRequest = httpRequest ?? pinnedNodeHttpRequest
  }

  async fetch(request: {
    url: string
    maxBytes: number
    timeoutMs: number
    signal: AbortSignal
  }): Promise<WebFetchResult> {
    throwIfAborted(request.signal)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs)
    const onAbort = () => controller.abort(request.signal.reason)
    request.signal.addEventListener('abort', onAbort, { once: true })
    try {
      // The input signal can become aborted between the first check and
      // listener registration. Re-check before any DNS or network work.
      throwIfAborted(request.signal)
      const { response, finalUrl } = await fetchWithPolicyRedirects(
        request.url,
        this.config,
        this.dnsLookup,
        this.httpRequest,
        controller.signal
      )
      if (response.status < 200 || response.status >= 300) throw new Error(httpFailureMessage(response.status))

      // Oversized pages are still useful: read up to maxBytes and report
      // truncation instead of failing on a declared content-length.
      const reader = response.body?.getReader()
      if (!reader) throw new Error('response body is not readable')

      const chunks: Uint8Array[] = []
      let totalBytes = 0
      let truncated = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const remaining = request.maxBytes - totalBytes
        if (remaining <= 0) {
          truncated = true
          reader.cancel()
          break
        }

        if (value.length > remaining) {
          chunks.push(value.subarray(0, remaining))
          totalBytes += remaining
          truncated = true
          reader.cancel()
          break
        }

        chunks.push(value)
        totalBytes += value.length
      }

      const buffer = Buffer.concat(chunks)
      const contentType = response.headers.get('content-type') ?? undefined
      const raw = buffer.toString('utf8')
      const extracted = extractReadableText(raw, contentType)
      return {
        sourceId: sourceIdFor('fetch', finalUrl),
        url: request.url,
        finalUrl,
        title: extracted.title,
        contentType,
        text: extracted.text,
        retrievedAt: this.nowIso(),
        byteCount: totalBytes,
        truncated
      }
    } finally {
      clearTimeout(timeout)
      request.signal.removeEventListener('abort', onAbort)
    }
  }

  async search(request: {
    query: string
    limit: number
    timeoutMs: number
    signal: AbortSignal
  }): Promise<WebSearchResult[]> {
    throwIfAborted(request.signal)
    const deadline = Date.now() + request.timeoutMs
    const failures: string[] = []
    try {
      const url = new URL('https://www.bing.com/search')
      url.searchParams.set('format', 'rss')
      url.searchParams.set('q', request.query)
      url.searchParams.set('setlang', 'en-us')
      url.searchParams.set('cc', 'us')
      const xml = await fetchBoundedSearchText(
        url.href,
        Math.max(1, Math.floor(request.timeoutMs * 0.6)),
        request.signal,
        'application/rss+xml, application/xml;q=0.9, text/html;q=0.8'
      )
      const candidates = parseBingSearchResults(xml, MAX_PUBLIC_SEARCH_CANDIDATES, this.nowIso)
      const results = rankPublicSearchResults(candidates, request.query, request.limit)
      if (results.length > 0) return results
      failures.push('Bing RSS returned no parseable results')
    } catch (error) {
      if (request.signal.aborted) throwIfAborted(request.signal)
      failures.push(`Bing RSS: ${errorMessage(error)}`)
    }

    try {
      const url = new URL('https://html.duckduckgo.com/html/')
      url.searchParams.set('q', request.query)
      const html = await fetchBoundedSearchText(
        url.href,
        remainingTimeout(deadline),
        request.signal,
        'text/html, application/xhtml+xml;q=0.9'
      )
      const candidates = parseDuckDuckGoSearchResults(html, MAX_PUBLIC_SEARCH_CANDIDATES, this.nowIso)
      const results = rankPublicSearchResults(candidates, request.query, request.limit)
      if (results.length > 0) return results
      failures.push('DuckDuckGo HTML returned no parseable results')
    } catch (error) {
      if (request.signal.aborted) throwIfAborted(request.signal)
      failures.push(`DuckDuckGo HTML: ${errorMessage(error)}`)
    }

    throw new Error(failures.join('; '))
  }
}

class WebPolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebPolicyError'
  }
}

async function defaultDnsLookup(hostname: string) {
  return nodeDnsLookup(hostname, { all: true, verbatim: true })
}

async function pinnedNodeHttpRequest(
  url: URL,
  addresses: ReadonlyArray<{ address: string; family: number }>,
  signal: AbortSignal,
  headers: Record<string, string>
): Promise<WebHttpResponse> {
  const failures: string[] = []
  for (const address of addresses) {
    throwIfAborted(signal)
    try {
      return await requestPinnedAddress(url, address, signal, headers)
    } catch (error) {
      if (signal.aborted) throwIfAborted(signal)
      failures.push(errorMessage(error))
    }
  }
  throw new Error(`network connection failed for validated target: ${failures.join('; ')}`)
}

function requestPinnedAddress(
  url: URL,
  address: { address: string; family: number },
  signal: AbortSignal,
  headers: Record<string, string>
): Promise<WebHttpResponse> {
  throwIfAborted(signal)
  return new Promise<WebHttpResponse>((resolve, reject) => {
    const lookup: LookupFunction = (_hostname, _options, callback) => {
      // Bind the connection to the exact address that passed policy checks.
      // The HTTP client must never perform a second DNS lookup here.
      if (_options.all) callback(null, [{ address: address.address, family: address.family }])
      else callback(null, address.address, address.family)
    }
    const transport = url.protocol === 'https:' ? https : http
    const request = transport.request(url, {
      method: 'GET',
      headers,
      signal,
      agent: false,
      family: address.family,
      lookup
    }, (response) => {
      resolve({
        status: response.statusCode ?? 0,
        headers: {
          get(name: string) {
            const value = response.headers[name.toLowerCase()]
            if (Array.isArray(value)) return value.join(', ')
            return value ?? null
          }
        },
        body: Readable.toWeb(response) as unknown as ReadableStream<Uint8Array>
      })
    })
    request.once('error', reject)
    request.end()
  })
}

async function fetchWithPolicyRedirects(
  rawUrl: string,
  config: WebCapabilityConfig,
  dnsLookup: WebDnsLookup,
  httpRequest: WebHttpRequest,
  signal: AbortSignal
): Promise<{ response: WebHttpResponse; finalUrl: string }> {
  let currentUrl = rawUrl
  for (let redirectCount = 0; redirectCount <= MAX_WEB_REDIRECTS; redirectCount += 1) {
    throwIfAborted(signal)
    const policy = validateUrlPolicy(currentUrl, config)
    if (!policy.ok) throw new WebPolicyError(policy.reason)
    const addresses = await resolvePublicDnsTarget(policy.url, dnsLookup, signal)
    const response = await httpRequest(policy.url, addresses, signal, rawFetchHeaders())
    if (!isRedirectStatus(response.status)) {
      return { response, finalUrl: policy.url.href }
    }

    const location = response.headers.get('location')
    await response.body?.cancel()
    if (!location) throw new Error(`HTTP ${response.status} redirect is missing a location`)
    if (redirectCount === MAX_WEB_REDIRECTS) throw new Error('too many redirects')
    try {
      currentUrl = new URL(location, policy.url).href
    } catch {
      throw new WebPolicyError('redirect location is not a valid URL')
    }
  }
  throw new Error('too many redirects')
}

async function resolvePublicDnsTarget(
  url: URL,
  dnsLookup: WebDnsLookup,
  signal: AbortSignal
): Promise<ReadonlyArray<{ address: string; family: number }>> {
  const hostname = canonicalHostname(url.hostname)
  const literalFamily = isIP(hostname)
  if (literalFamily) return [{ address: hostname, family: literalFamily }]

  let addresses: ReadonlyArray<{ address: string; family: number }>
  try {
    addresses = await awaitWithAbort(dnsLookup(hostname), signal)
  } catch (error) {
    if (signal.aborted) throwIfAborted(signal)
    throw new WebPolicyError(`DNS resolution failed for ${hostname}: ${errorMessage(error)}`)
  }
  if (addresses.length === 0) throw new WebPolicyError(`DNS resolution returned no addresses for ${hostname}`)
  const validated: Array<{ address: string; family: number }> = []
  for (const result of addresses) {
    const reason = nonPublicIpReason(result.address)
    if (reason) throw new WebPolicyError(`DNS target for ${hostname} is blocked: ${reason}`)
    const address = canonicalHostname(result.address)
    validated.push({ address, family: isIP(address) })
  }
  return validated
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) signal.throwIfAborted()
}

function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason)
      return
    }
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

function rawFetchHeaders(): Record<string, string> {
  return {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,application/json;q=0.7,*/*;q=0.5',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'User-Agent': PUBLIC_WEB_USER_AGENT
  }
}

function searchHeaders(accept: string): Record<string, string> {
  return {
    Accept: accept,
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'User-Agent': PUBLIC_WEB_USER_AGENT
  }
}

async function fetchBoundedSearchText(
  url: string,
  timeoutMs: number,
  signal: AbortSignal,
  accept: string
): Promise<string> {
  throwIfAborted(signal)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    throwIfAborted(signal)
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: searchHeaders(accept)
    })
    if (!response.ok) throw new Error(httpFailureMessage(response.status))
    const reader = response.body?.getReader()
    if (!reader) throw new Error('response body is not readable')
    const chunks: Uint8Array[] = []
    let totalBytes = 0
    while (totalBytes < DEFAULT_WEB_SEARCH_RESPONSE_MAX_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      const remaining = DEFAULT_WEB_SEARCH_RESPONSE_MAX_BYTES - totalBytes
      chunks.push(value.length > remaining ? value.subarray(0, remaining) : value)
      totalBytes += Math.min(value.length, remaining)
      if (value.length > remaining || totalBytes >= DEFAULT_WEB_SEARCH_RESPONSE_MAX_BYTES) {
        await reader.cancel()
        break
      }
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', onAbort)
  }
}

function parseBingSearchResults(
  xml: string,
  limit: number,
  nowIso: () => string
): WebSearchResult[] {
  const results: WebSearchResult[] = []
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? []
  for (const item of items.slice(0, 50)) {
    const title = normalizeSearchText(xmlElementText(item, 'title'))
    const url = normalizeSearchResultUrl(xmlElementText(item, 'link'))
    const snippet = normalizeSearchText(xmlElementText(item, 'description'))
    if (!title || !url || results.some((result) => result.url === url)) continue
    results.push({
      sourceId: sourceIdFor('search', url),
      url,
      title,
      snippet,
      retrievedAt: nowIso(),
      provider: 'bing-rss',
      rank: results.length + 1
    })
    if (results.length >= limit) break
  }
  return results
}

function parseDuckDuckGoSearchResults(
  html: string,
  limit: number,
  nowIso: () => string
): WebSearchResult[] {
  const results: WebSearchResult[] = []
  const blocks = html.match(/<div\b[^>]*class=["'][^"']*\bresult\b[^"']*["'][^>]*>[\s\S]*?(?=<div\b[^>]*class=["'][^"']*\bresult\b|<\/body>|$)/gi) ?? []
  for (const block of blocks.slice(0, 50)) {
    const anchor = block.match(/<a\b[^>]*class=["'][^"']*\bresult__a\b[^"']*["'][^>]*>[\s\S]*?<\/a>/i)?.[0]
    if (!anchor) continue
    const title = normalizeSearchText(anchor)
    const url = normalizeSearchResultUrl(decodeDuckDuckGoRedirect(htmlAttribute(anchor, 'href')))
    const snippetTag = block.match(/<(?:a|div)\b[^>]*class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>[\s\S]*?<\/(?:a|div)>/i)?.[0]
    const snippet = normalizeSearchText(snippetTag ?? '')
    if (!title || !url || results.some((result) => result.url === url)) continue
    results.push({
      sourceId: sourceIdFor('search', url),
      url,
      title,
      snippet,
      retrievedAt: nowIso(),
      provider: 'duckduckgo-html',
      rank: results.length + 1
    })
    if (results.length >= limit) break
  }
  return results
}

/**
 * Public endpoints can return a locally biased raw order. Re-rank only the
 * bounded candidate set, keeping lexical/version relevance as the gate for
 * any source-quality boost so an unrelated well-known site cannot outrank a
 * directly relevant result.
 */
function rankPublicSearchResults(
  results: readonly WebSearchResult[],
  query: string,
  limit: number
): WebSearchResult[] {
  const queryTerms = meaningfulSearchTerms(query)
  const queryVersions = versionIdentifiers(query)
  const queryEntities = queryTerms.filter((term) => term.length >= 4)
  const scored = results.map((result, index) => {
    const corpus = `${result.title} ${result.snippet ?? ''} ${result.url}`.toLowerCase()
    const corpusTerms = new Set(tokenizeSearchText(corpus))
    const matchedTerms = queryTerms.filter((term) => corpusTerms.has(term)).length
    const versionMatches = queryVersions.filter((version) => compactSearchToken(corpus).includes(version)).length
    const relevance = matchedTerms + versionMatches * 4
    const hostname = safeHostname(result.url)
    const registrableLabel = registrableDomainLabel(hostname)
    const firstParty = Boolean(
      registrableLabel &&
      queryEntities.some((entity) => compactSearchToken(entity) === compactSearchToken(registrableLabel))
    )
    const reputable = isReputableWebHost(hostname)
    const qualityBoost = relevance > 0
      ? firstParty ? 12 : reputable ? 8 : 0
      : 0
    const qualityPenalty = lowQualitySearchPenalty(hostname, result.url)
    return {
      result,
      index,
      matchedTerms,
      versionMatches,
      score: relevance * 3 + qualityBoost - qualityPenalty - index * 0.08
    }
  }).filter((candidate) => {
    // For version-specific research, a result about a neighboring release is
    // actively misleading, not merely lower-ranked. Likewise, discard
    // zero-overlap results when the query contains a discriminative term.
    if (queryVersions.length > 0 && candidate.versionMatches < queryVersions.length) return false
    if (queryTerms.length > 0 && candidate.matchedTerms === 0 && candidate.versionMatches === 0) return false
    return true
  })

  const domainCounts = new Map<string, number>()
  const ranked: WebSearchResult[] = []
  for (const candidate of scored.sort((left, right) => right.score - left.score || left.index - right.index)) {
    const hostname = safeHostname(candidate.result.url)
    const count = domainCounts.get(hostname) ?? 0
    if (hostname && count >= 2) continue
    if (hostname) domainCounts.set(hostname, count + 1)
    ranked.push({ ...candidate.result, rank: ranked.length + 1 })
    if (ranked.length >= limit) break
  }
  return ranked
}

function meaningfulSearchTerms(value: string): string[] {
  return [...new Set(tokenizeSearchText(value).filter((term) =>
    term.length >= 3 && !GENERIC_SEARCH_TERMS.has(term)
  ))]
}

function tokenizeSearchText(value: string): string[] {
  return value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

function versionIdentifiers(value: string): string[] {
  const matches = value.toLowerCase().match(/(?:\b[a-z][a-z0-9]{1,16}[- ]?)?\d+(?:\.\d+)+\b/giu) ?? []
  return [...new Set(matches.map(compactSearchToken).filter(Boolean))]
}

function compactSearchToken(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function safeHostname(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase().replace(/\.+$/, '')
  } catch {
    return ''
  }
}

function registrableDomainLabel(hostname: string): string {
  const parts = hostname.split('.').filter(Boolean)
  if (parts.length < 2) return parts[0] ?? ''
  const commonSecondLevelSuffix = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org'])
  const labelIndex = parts.length >= 3 && parts.at(-1)?.length === 2 && commonSecondLevelSuffix.has(parts.at(-2) ?? '')
    ? parts.length - 3
    : parts.length - 2
  return parts[labelIndex] ?? ''
}

function isReputableWebHost(hostname: string): boolean {
  if (!hostname) return false
  if (REPUTABLE_WEB_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))) {
    return true
  }
  return /(?:^|\.)gov(?:\.[a-z]{2})?$/.test(hostname) || /(?:^|\.)edu(?:\.[a-z]{2})?$/.test(hostname)
}

function lowQualitySearchPenalty(hostname: string, rawUrl: string): number {
  let penalty = 0
  if (/(?:aitool|toolly)|(?:^|[.-])(?:ai[-]?news|aiproduct|chatgpt|cnblog|gemini|gpt[-]?gate)(?:[.-]|$)/i.test(hostname)) {
    penalty += 4
  }
  if (/(?:\/|^)(?:guides?|newsflash|private)(?:\/|$)/i.test(rawUrl)) penalty += 2
  if (hostname === 'zhihu.com' || hostname.endsWith('.zhihu.com') || hostname === 'baidu.com' || hostname.endsWith('.baidu.com')) {
    penalty += 1.5
  }
  return penalty
}

function xmlElementText(xml: string, tag: string): string {
  return xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] ?? ''
}

function htmlAttribute(tag: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return tag.match(new RegExp(`\\s${escaped}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] ?? ''
}

function decodeDuckDuckGoRedirect(value: string): string {
  const decoded = decodeHtmlTextEntities(value).trim()
  if (!decoded) return ''
  const absolute = decoded.startsWith('//') ? `https:${decoded}` : decoded
  try {
    const url = new URL(absolute, 'https://duckduckgo.com')
    if (url.hostname === 'duckduckgo.com' || url.hostname.endsWith('.duckduckgo.com')) {
      return url.searchParams.get('uddg') ?? url.href
    }
    return url.href
  } catch {
    return ''
  }
}

function normalizeSearchResultUrl(value: string): string {
  const decoded = decodeHtmlTextEntities(value).trim()
  if (!decoded) return ''
  try {
    const url = new URL(decoded)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    url.hash = ''
    return url.href
  } catch {
    return ''
  }
}

function normalizeSearchText(value: string): string {
  return normalizeWhitespace(decodeHtmlTextEntities(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
}

function remainingTimeout(deadline: number): number {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new Error('search timeout exceeded')
  return remaining
}

function httpFailureMessage(status: number): string {
  if (status === 401 || status === 403) {
    return `HTTP ${status} (the origin requires authentication or denied automated access)`
  }
  return `HTTP ${status}`
}

function fetchOutput(result: WebFetchResult, toolTelemetry: Record<string, unknown>) {
  const source = {
    sourceId: result.sourceId,
    url: result.finalUrl,
    title: result.title,
    retrievedAt: result.retrievedAt
  }
  return {
    sourceId: result.sourceId,
    url: result.url,
    finalUrl: result.finalUrl,
    title: result.title,
    retrievedAt: result.retrievedAt,
    contentType: result.contentType,
    text: result.text,
    byteCount: result.byteCount,
    truncated: result.truncated,
    sources: [source],
    citations: [{ ...source }],
    telemetry: toolTelemetry
  }
}

function searchOutput(
  query: string,
  provider: string,
  results: WebSearchResult[],
  toolTelemetry: Record<string, unknown>
) {
  const sources = results.map((result) => ({
    sourceId: result.sourceId,
    url: result.url,
    title: result.title,
    retrievedAt: result.retrievedAt
  }))
  return {
    query,
    provider,
    results,
    sources,
    citations: sources.map((source) => ({ ...source })),
    telemetry: toolTelemetry
  }
}

function validateUrlPolicy(rawUrl: string, config: WebCapabilityConfig): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'URL must be absolute' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'only http and https URLs are allowed' }
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'URLs containing credentials are not allowed' }
  }
  const hostname = canonicalHostname(url.hostname)
  const targetReason = nonPublicHostReason(hostname)
  if (targetReason) return { ok: false, reason: targetReason }
  if (config.denyDomains.some((domain) => domainMatches(hostname, domain))) {
    return { ok: false, reason: `domain is denied: ${hostname}` }
  }
  if (config.allowDomains.length > 0 && !config.allowDomains.some((domain) => domainMatches(hostname, domain))) {
    return { ok: false, reason: `domain is not allowed: ${hostname}` }
  }
  return { ok: true, url }
}

function domainMatches(hostname: string, domain: string): boolean {
  const normalizedHostname = canonicalHostname(hostname)
  const normalizedDomain = canonicalHostname(domain.replace(/^\./, ''))
  return normalizedHostname === normalizedDomain || normalizedHostname.endsWith(`.${normalizedDomain}`)
}

function canonicalHostname(hostname: string): string {
  const withoutBrackets = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
  return withoutBrackets.toLowerCase().replace(/\.+$/, '')
}

function nonPublicHostReason(hostname: string): string | undefined {
  if (!hostname) return 'URL hostname is required'
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'localhost.localdomain' ||
    hostname === 'ip6-localhost' ||
    hostname === 'ip6-loopback'
  ) {
    return `local hostname is blocked: ${hostname}`
  }
  if (
    hostname === 'metadata' ||
    hostname === 'instance-data' ||
    hostname === 'metadata.google.internal' ||
    hostname.endsWith('.metadata.google.internal') ||
    hostname === 'metadata.azure.internal'
  ) {
    return `metadata hostname is blocked: ${hostname}`
  }
  return isIP(hostname) ? nonPublicIpReason(hostname) : undefined
}

function nonPublicIpReason(address: string): string | undefined {
  const normalized = canonicalHostname(address)
  const family = isIP(normalized)
  if (family === 4) return isPublicIpv4(normalized) ? undefined : `non-public IPv4 address ${normalized}`
  if (family === 6) return isPublicIpv6(normalized) ? undefined : `non-public IPv6 address ${normalized}`
  return `invalid DNS address ${normalized}`
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split('.').map((part) => Number(part))
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b, c, d] = octets as [number, number, number, number]
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 192 && b === 0 && c === 0 && !(d === 9 || d === 10)) return false
  if (a === 192 && b === 0 && c === 2) return false
  if (a === 192 && b === 88 && c === 99) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if (a === 198 && b === 51 && c === 100) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}

function isPublicIpv6(address: string): boolean {
  const value = parseIpv6(address)
  if (value == null) return false
  // Public IPv6 targets are global unicast (2000::/3), excluding the
  // documentation, transition, benchmarking, and ORCHID allocations below.
  if (!ipv6Matches(value, 0x1n, 3)) return false
  if (ipv6Matches(value, 0x20010000n, 32)) return false // Teredo
  if (ipv6Matches(value, 0x200100020000n, 48)) return false // benchmarking
  if (ipv6Matches(value, 0x2001001n, 28)) return false // ORCHIDv1
  if (ipv6Matches(value, 0x2001002n, 28)) return false // ORCHIDv2
  if (ipv6Matches(value, 0x20010db8n, 32)) return false // documentation
  if (ipv6Matches(value, 0x2002n, 16)) return false // 6to4 can encode private IPv4
  if (ipv6Matches(value, 0x3fff0n, 20)) return false // documentation
  return true
}

function ipv6Matches(value: bigint, prefix: bigint, prefixLength: number): boolean {
  const shift = BigInt(128 - prefixLength)
  return value >> shift === prefix
}

function parseIpv6(address: string): bigint | undefined {
  let input = address.toLowerCase()
  if (input.includes('%')) return undefined
  if (input.includes('.')) {
    const separator = input.lastIndexOf(':')
    if (separator < 0) return undefined
    const ipv4 = input.slice(separator + 1)
    if (!isPublicOrNonPublicIpv4Syntax(ipv4)) return undefined
    const octets = ipv4.split('.').map(Number)
    input = `${input.slice(0, separator)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`
  }
  const halves = input.split('::')
  if (halves.length > 2) return undefined
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  if (halves.length === 1 && left.length !== 8) return undefined
  const missing = 8 - left.length - right.length
  if (missing < 0 || (halves.length === 2 && missing < 1)) return undefined
  const groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right]
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return undefined
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n)
}

function isPublicOrNonPublicIpv4Syntax(address: string): boolean {
  const parts = address.split('.')
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function extractReadableText(raw: string, contentType: string | undefined): { title?: string; text: string } {
  if (!contentType?.toLowerCase().includes('html')) {
    return { text: normalizeWhitespace(raw) }
  }
  const extracted = extractHtmlText(raw)
  const title = normalizeWhitespace(decodeHtmlTextEntities(extracted.title))
  const text = normalizeWhitespace(decodeHtmlTextEntities(extracted.text))
  return {
    ...(title ? { title } : {}),
    text
  }
}

function extractHtmlText(raw: string): { title: string; text: string } {
  const titleParts: string[] = []
  const textParts: string[] = []
  let index = 0
  let inTitle = false
  let skipTag: SkippedHtmlTag | null = null

  while (index < raw.length) {
    if (skipTag) {
      const closeStart = findClosingHtmlTagStart(raw, index, skipTag)
      if (closeStart < 0) break
      const tagEnd = findHtmlTagEnd(raw, closeStart + 1)
      if (tagEnd < 0) break
      index = tagEnd + 1
      skipTag = null
      continue
    }

    if (raw[index] !== '<') {
      if (inTitle) titleParts.push(raw[index])
      else textParts.push(raw[index])
      index += 1
      continue
    }

    if (raw.startsWith('<!--', index)) {
      const commentEnd = raw.indexOf('-->', index + 4)
      index = commentEnd >= 0 ? commentEnd + 3 : raw.length
      continue
    }

    const tagEnd = findHtmlTagEnd(raw, index + 1)
    if (tagEnd < 0) {
      if (!skipTag) {
        if (inTitle) titleParts.push(raw[index])
        else textParts.push(raw[index])
      }
      index += 1
      continue
    }

    const tag = parseHtmlTag(raw.slice(index + 1, tagEnd))
    index = tagEnd + 1
    if (!tag) continue

    if (isSkippedHtmlTag(tag.name)) {
      if (!tag.closing && !tag.selfClosing) skipTag = tag.name
      continue
    }

    if (tag.name === 'title') {
      inTitle = !tag.closing && !tag.selfClosing
      continue
    }

    if (inTitle) continue
    if (tag.name === 'br' || (tag.closing && isHtmlBlockTag(tag.name))) {
      textParts.push('\n')
    } else {
      textParts.push(' ')
    }
  }

  return {
    title: titleParts.join(''),
    text: textParts.join('')
  }
}

type SkippedHtmlTag = 'script' | 'style' | 'noscript' | 'template' | 'svg' | 'iframe'

function isSkippedHtmlTag(name: string): name is SkippedHtmlTag {
  return name === 'script' ||
    name === 'style' ||
    name === 'noscript' ||
    name === 'template' ||
    name === 'svg' ||
    name === 'iframe'
}

function findClosingHtmlTagStart(raw: string, start: number, name: SkippedHtmlTag): number {
  for (let index = start; index < raw.length; index += 1) {
    if (raw[index] !== '<' || raw[index + 1] !== '/') continue
    const nameStart = index + 2
    const nameEnd = nameStart + name.length
    if (raw.slice(nameStart, nameEnd).toLowerCase() !== name) continue
    if (!isHtmlNameChar(raw[nameEnd])) return index
  }
  return -1
}

function findHtmlTagEnd(raw: string, start: number): number {
  let quote: string | null = null
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index]
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
    } else if (char === '>') {
      return index
    }
  }
  return -1
}

function parseHtmlTag(content: string): {
  name: string
  closing: boolean
  selfClosing: boolean
} | null {
  let index = 0
  while (index < content.length && isHtmlWhitespace(content[index])) index += 1
  const closing = content[index] === '/'
  if (closing) {
    index += 1
    while (index < content.length && isHtmlWhitespace(content[index])) index += 1
  }

  const nameStart = index
  while (index < content.length && isHtmlNameChar(content[index])) index += 1
  if (index === nameStart) return null

  let end = content.length
  while (end > index && isHtmlWhitespace(content[end - 1])) end -= 1
  return {
    name: content.slice(nameStart, index).toLowerCase(),
    closing,
    selfClosing: end > index && content[end - 1] === '/'
  }
}

function decodeHtmlTextEntities(value: string): string {
  let out = ''
  let index = 0
  while (index < value.length) {
    if (value[index] !== '&') {
      out += value[index]
      index += 1
      continue
    }
    const semicolon = value.indexOf(';', index + 1)
    if (semicolon < 0 || semicolon - index > 32) {
      out += value[index]
      index += 1
      continue
    }
    const entity = value.slice(index + 1, semicolon)
    const decoded = decodeHtmlTextEntity(entity)
    if (decoded == null) {
      out += value.slice(index, semicolon + 1)
    } else {
      out += decoded
    }
    index = semicolon + 1
  }
  return out
}

function decodeHtmlTextEntity(entity: string): string | null {
  const lower = entity.toLowerCase()
  switch (lower) {
    case 'nbsp':
      return ' '
    case 'amp':
      return '&'
    case 'lt':
      return '<'
    case 'gt':
      return '>'
    case 'quot':
      return '"'
    case 'apos':
      return "'"
    case 'copy':
      return '\u00a9'
    case 'reg':
      return '\u00ae'
    case 'trade':
      return '\u2122'
    case 'hellip':
      return '\u2026'
    case 'ndash':
      return '\u2013'
    case 'mdash':
      return '\u2014'
    case 'lsquo':
      return '\u2018'
    case 'rsquo':
      return '\u2019'
    case 'ldquo':
      return '\u201c'
    case 'rdquo':
      return '\u201d'
    default:
      return decodeNumericHtmlTextEntity(lower)
  }
}

function decodeNumericHtmlTextEntity(entity: string): string | null {
  if (!entity.startsWith('#')) return null
  const hex = entity[1] === 'x'
  const digits = entity.slice(hex ? 2 : 1)
  if (!digits) return null
  const codePoint = htmlEntityCodePoint(digits, hex)
  if (codePoint == null || codePoint <= 0) return null
  try {
    return String.fromCodePoint(codePoint)
  } catch {
    return null
  }
}

function htmlEntityCodePoint(digits: string, hex: boolean): number | null {
  let out = 0
  for (const char of digits) {
    const digit = htmlEntityDigitValue(char)
    if (digit == null || digit >= (hex ? 16 : 10)) return null
    out = out * (hex ? 16 : 10) + digit
    if (out > 0x10ffff) return null
  }
  return out
}

function htmlEntityDigitValue(char: string): number | null {
  const code = char.charCodeAt(0)
  if (code >= 48 && code <= 57) return code - 48
  if (code >= 97 && code <= 102) return code - 87
  return null
}

function isHtmlBlockTag(name: string): boolean {
  return (
    name === 'p' ||
    name === 'div' ||
    name === 'li' ||
    name === 'section' ||
    name === 'article' ||
    name === 'header' ||
    name === 'footer' ||
    name === 'tr' ||
    name === 'table' ||
    name === 'blockquote' ||
    (name.length === 2 && name[0] === 'h' && name[1] >= '1' && name[1] <= '6')
  )
}

function isHtmlWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\n' || char === '\t' || char === '\r' || char === '\f'
}

function isHtmlNameChar(char: string | undefined): boolean {
  if (!char) return false
  return !isHtmlWhitespace(char) && char !== '/' && char !== '>'
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

function telemetry(input: {
  startedAt: number
  policy: 'allowed' | 'blocked'
  provider?: string
  url?: string
  query?: string
  byteCount?: number
  resultCount?: number
}): Record<string, unknown> {
  return {
    provider: input.provider,
    url: input.url,
    query: input.query,
    byteCount: input.byteCount,
    resultCount: input.resultCount,
    durationMs: Date.now() - input.startedAt,
    cacheStatus: 'miss',
    policy: input.policy
  }
}

function toolError(code: string, message: string, toolTelemetry?: Record<string, unknown>) {
  return {
    output: {
      error: {
        code,
        message
      },
      ...(toolTelemetry ? { telemetry: toolTelemetry } : {})
    },
    isError: true
  }
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.floor(value), min), max)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
