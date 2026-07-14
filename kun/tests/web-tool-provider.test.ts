import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapabilityRegistry } from '../src/adapters/tool/capability-registry.js'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
import { buildWebToolProviders } from '../src/adapters/tool/web-tool-provider.js'
import type { WebHttpRequest } from '../src/adapters/tool/web-tool-provider.js'
import {
  buildRuntimeCapabilityManifest,
  LocalRuntimeCapabilitiesConfig
} from '../src/contracts/capabilities.js'
import { modelCapabilitiesForModel } from '../src/loop/model-context-profile.js'
import { DeterministicWebProvider } from '../src/ports/web-provider.js'
import type { ToolHostContext } from '../src/ports/tool-host.js'

function buildContext(abortSignal = new AbortController().signal): ToolHostContext {
  return {
    threadId: 'thr_1',
    turnId: 'turn_1',
    workspace: '/tmp/project',
    threadMode: 'agent',
    approvalPolicy: 'auto',
    abortSignal,
    awaitApproval: async () => 'allow'
  }
}

const publicDnsLookup = async () => [{ address: '93.184.216.34', family: 4 }]
const stubbedHttpRequest: WebHttpRequest = (url, _addresses, signal, headers) => fetch(url, {
  signal,
  redirect: 'manual',
  headers
})

function deterministicProvider() {
  return new DeterministicWebProvider({
    id: 'test-search',
    nowIso: () => '2026-06-03T00:00:00.000Z',
    pages: {
      'https://docs.example.test/page': {
        url: 'https://docs.example.test/page',
        finalUrl: 'https://docs.example.test/page',
        title: 'Docs Page',
        contentType: 'text/plain',
        text: 'Current docs content'
      }
    },
    searchResults: {
      'local runtime web': [
        {
          url: 'https://docs.example.test/page',
          title: 'SciForge Runtime Web Docs',
          snippet: 'How SciForge Runtime web access works.'
        }
      ]
    }
  })
}

describe('Web tool provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not advertise web tools when web access is disabled', async () => {
    const config = LocalRuntimeCapabilitiesConfig.parse({})
    const built = buildWebToolProviders(config.web, { provider: deterministicProvider() })

    expect(built.providers).toEqual([])
    expect(built.fetchAvailable).toBe(false)
    expect(built.searchAvailable).toBe(false)
  })

  it('fetches allowed URLs with source metadata and telemetry', async () => {
    const config = LocalRuntimeCapabilitiesConfig.parse({
      web: {
        enabled: true,
        fetchEnabled: true,
        allowDomains: ['docs.example.test']
      }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, {
        provider: deterministicProvider()
      }).providers)
    })

    const tools = await host.listTools(buildContext())
    expect(tools.map((tool) => tool.name)).toEqual(['web_fetch'])

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'web_fetch',
      arguments: { url: 'https://docs.example.test/page' }
    }, buildContext())

    expect(result.item.kind).toBe('tool_result')
    if (result.item.kind === 'tool_result') {
      expect(result.item.isError).toBe(false)
      const output = result.item.output as {
        sourceId: string
        text: string
        sources: Array<{ sourceId: string; url: string; retrievedAt: string }>
        citations: Array<{ sourceId: string }>
        telemetry: { policy: string; provider: string; byteCount: number }
      }
      expect(output.text).toBe('Current docs content')
      expect(output.sources[0]).toMatchObject({
        sourceId: output.sourceId,
        url: 'https://docs.example.test/page',
        retrievedAt: '2026-06-03T00:00:00.000Z'
      })
      expect(output.citations[0]?.sourceId).toBe(output.sourceId)
      expect(output.telemetry).toMatchObject({
        policy: 'allowed',
        provider: 'test-search',
        byteCount: 20
      })
    }
  })

  it('truncates instead of failing when content-length exceeds max_bytes', async () => {
    vi.stubGlobal('fetch', async () => new Response('abcdefghijklmnopqrstuvwxyz', {
      headers: {
        'content-length': '26',
        'content-type': 'text/plain'
      }
    }))
    const config = LocalRuntimeCapabilitiesConfig.parse({
      web: {
        enabled: true,
        fetchEnabled: true,
        allowDomains: ['docs.example.test']
      }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, {
        dnsLookup: publicDnsLookup,
        httpRequest: stubbedHttpRequest
      }).providers)
    })

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'web_fetch',
      arguments: { url: 'https://docs.example.test/large', max_bytes: 10 }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    if (result.item.kind === 'tool_result') {
      expect(result.item.output).toMatchObject({
        text: 'abcdefghij',
        byteCount: 10,
        truncated: true,
        telemetry: {
          policy: 'allowed',
          provider: 'public-rss',
          byteCount: 10
        }
      })
    }
  })

  it('truncates oversized fetch responses via streaming when content-length is unknown', async () => {
    vi.stubGlobal('fetch', async () => new Response('abcdefghijklmnopqrstuvwxyz', {
      headers: {
        'content-type': 'text/plain'
      }
    }))
    const config = LocalRuntimeCapabilitiesConfig.parse({
      web: {
        enabled: true,
        fetchEnabled: true,
        allowDomains: ['docs.example.test']
      }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, {
        dnsLookup: publicDnsLookup,
        httpRequest: stubbedHttpRequest
      }).providers)
    })

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'web_fetch',
      arguments: { url: 'https://docs.example.test/large', max_bytes: 10 }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    if (result.item.kind === 'tool_result') {
      expect(result.item.output).toMatchObject({
        text: 'abcdefghij',
        byteCount: 10,
        truncated: true,
        telemetry: {
          policy: 'allowed',
          provider: 'public-rss',
          byteCount: 10
        }
      })
    }
  })

  it('extracts HTML text without script, style, comment, or attribute noise', async () => {
    vi.stubGlobal('fetch', async () => new Response([
      '<!doctype html>',
      '<title>Docs &amp; Safety &#x2713;</title>',
      '<body data-leak="attribute-secret">',
      '<!-- comment-secret -->',
      '<script>if (a < b) { window.secretScript = "nope" }</script>',
      '<style>.secretStyle{display:none}</style>',
      '<noscript>noscript-secret</noscript>',
      '<svg><text>svg-secret</text></svg>',
      '<h1 title="attribute-title-secret">Hello&nbsp;World</h1>',
      '<p>Tom &amp; Jerry &quot;quote&quot; &apos;apos&apos;.</p>',
      '<div>Caf&#233; &#x2603; &copy;</div>',
      '<p>Escaped &lt;script&gt; remains visible text.</p>',
      '</body>'
    ].join(''), {
      headers: {
        'content-type': 'text/html; charset=utf-8'
      }
    }))
    const config = LocalRuntimeCapabilitiesConfig.parse({
      web: {
        enabled: true,
        fetchEnabled: true,
        allowDomains: ['docs.example.test']
      }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, {
        dnsLookup: publicDnsLookup,
        httpRequest: stubbedHttpRequest
      }).providers)
    })

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'web_fetch',
      arguments: { url: 'https://docs.example.test/html' }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    if (result.item.kind === 'tool_result') {
      const output = result.item.output as { title?: string; text: string }
      expect(output.title).toBe('Docs & Safety \u2713')
      expect(output.text).toContain('Hello World')
      expect(output.text).toContain('Tom & Jerry "quote" \'apos\'.')
      expect(output.text).toContain('Caf\u00e9 \u2603 \u00a9')
      expect(output.text).toContain('Escaped <script> remains visible text.')
      expect(output.text).not.toContain('secretScript')
      expect(output.text).not.toContain('secretStyle')
      expect(output.text).not.toContain('noscript-secret')
      expect(output.text).not.toContain('svg-secret')
      expect(output.text).not.toContain('comment-secret')
      expect(output.text).not.toContain('attribute-secret')
      expect(output.text).not.toContain('attribute-title-secret')
    }
  })

  it('rejects disallowed fetch URLs before contacting the provider', async () => {
    let contacted = false
    const config = LocalRuntimeCapabilitiesConfig.parse({
      web: {
        enabled: true,
        fetchEnabled: true,
        denyDomains: ['blocked.example.test']
      }
    })
    const provider = new DeterministicWebProvider({
      pages: {
        'https://blocked.example.test/page': {
          url: 'https://blocked.example.test/page',
          finalUrl: 'https://blocked.example.test/page',
          text: 'secret'
        }
      }
    })
    provider.fetch = async (request) => {
      contacted = true
      return DeterministicWebProvider.prototype.fetch.call(provider, request)
    }
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, { provider }).providers)
    })

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'web_fetch',
      arguments: { url: 'https://blocked.example.test/page' }
    }, buildContext())

    expect(contacted).toBe(false)
    expect(result.item).toMatchObject({ kind: 'tool_result', isError: true })
    if (result.item.kind === 'tool_result') {
      expect(result.item.output).toMatchObject({
        error: { code: 'policy_blocked' },
        telemetry: { policy: 'blocked' }
      })
    }
  })

  it.each([
    'http://127.0.0.1/admin',
    'http://10.0.0.1/admin',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/admin',
    'http://[fe80::1]/admin',
    'http://localhost./admin',
    'http://metadata.google.internal/computeMetadata/v1/'
  ])('blocks non-public and metadata target %s before network access', async (url) => {
    const fetchSpy = vi.fn()
    const dnsLookup = vi.fn(publicDnsLookup)
    vi.stubGlobal('fetch', fetchSpy)
    const config = LocalRuntimeCapabilitiesConfig.parse({
      web: { enabled: true, fetchEnabled: true }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, { dnsLookup, httpRequest: stubbedHttpRequest }).providers)
    })

    const result = await host.execute({
      callId: 'call_private_target',
      toolName: 'web_fetch',
      arguments: { url }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: true })
    if (result.item.kind === 'tool_result') {
      expect(result.item.output).toMatchObject({ error: { code: 'policy_blocked' } })
    }
    expect(dnsLookup).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects a hostname when any DNS answer is non-public', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const dnsLookup = vi.fn(async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '192.168.1.20', family: 4 }
    ])
    const config = LocalRuntimeCapabilitiesConfig.parse({
      web: { enabled: true, fetchEnabled: true }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, { dnsLookup, httpRequest: stubbedHttpRequest }).providers)
    })

    const result = await host.execute({
      callId: 'call_dns_rebinding',
      toolName: 'web_fetch',
      arguments: { url: 'https://mixed.example.test/page' }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: true })
    if (result.item.kind === 'tool_result') {
      expect(result.item.output).toMatchObject({
        error: { code: 'policy_blocked' },
        telemetry: { policy: 'blocked' }
      })
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('passes only vetted DNS addresses to the actual connection on every redirect hop', async () => {
    const dnsLookup = vi.fn(async (hostname: string) => hostname === 'origin.example.test'
      ? [{ address: '93.184.216.34', family: 4 }]
      : [{ address: '151.101.1.69', family: 4 }])
    const httpRequest = vi.fn<WebHttpRequest>(async (url) => url.hostname === 'origin.example.test'
      ? new Response(null, {
          status: 302,
          headers: { location: 'https://final.example.test/article' }
        })
      : new Response('verified public content', {
          status: 200,
          headers: { 'content-type': 'text/plain' }
        }))
    const config = LocalRuntimeCapabilitiesConfig.parse({
      web: { enabled: true, fetchEnabled: true }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, { dnsLookup, httpRequest }).providers)
    })

    const result = await host.execute({
      callId: 'call_pinned_redirect',
      toolName: 'web_fetch',
      arguments: { url: 'https://origin.example.test/start' }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    expect(dnsLookup.mock.calls).toEqual([
      ['origin.example.test'],
      ['final.example.test']
    ])
    expect(httpRequest.mock.calls[0]?.[1]).toEqual([{ address: '93.184.216.34', family: 4 }])
    expect(httpRequest.mock.calls[1]?.[1]).toEqual([{ address: '151.101.1.69', family: 4 }])
  })

  it('revalidates DNS and domain policy at every manual redirect hop', async () => {
    const fetchSpy = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(null, {
      status: 302,
      headers: { location: 'http://private.example.test/secret' }
    }))
    vi.stubGlobal('fetch', fetchSpy)
    const dnsLookup = vi.fn(async (hostname: string) => hostname === 'private.example.test'
      ? [{ address: '10.0.0.8', family: 4 }]
      : [{ address: '93.184.216.34', family: 4 }])
    const config = LocalRuntimeCapabilitiesConfig.parse({
      web: { enabled: true, fetchEnabled: true }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, { dnsLookup, httpRequest: stubbedHttpRequest }).providers)
    })

    const result = await host.execute({
      callId: 'call_redirect_private',
      toolName: 'web_fetch',
      arguments: { url: 'https://public.example.test/start' }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: true })
    if (result.item.kind === 'tool_result') {
      expect(result.item.output).toMatchObject({ error: { code: 'policy_blocked' } })
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' })
    expect(dnsLookup).toHaveBeenCalledWith('public.example.test')
    expect(dnsLookup).toHaveBeenCalledWith('private.example.test')
  })

  it('does not let a redirect escape allowDomains', async () => {
    const fetchSpy = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://outside.example.test/secret' }
    }))
    vi.stubGlobal('fetch', fetchSpy)
    const dnsLookup = vi.fn(publicDnsLookup)
    const config = LocalRuntimeCapabilitiesConfig.parse({
      web: {
        enabled: true,
        fetchEnabled: true,
        allowDomains: ['allowed.example.test']
      }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, { dnsLookup, httpRequest: stubbedHttpRequest }).providers)
    })

    const result = await host.execute({
      callId: 'call_redirect_domain',
      toolName: 'web_fetch',
      arguments: { url: 'https://allowed.example.test/start' }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: true })
    if (result.item.kind === 'tool_result') {
      expect(result.item.output).toMatchObject({ error: { code: 'policy_blocked' } })
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(dnsLookup).toHaveBeenCalledTimes(1)
  })

  it('immediately stops an already-aborted public fetch before DNS or network work', async () => {
    const fetchSpy = vi.fn()
    const dnsLookup = vi.fn(publicDnsLookup)
    vi.stubGlobal('fetch', fetchSpy)
    const controller = new AbortController()
    controller.abort(new Error('cancelled before execution'))
    const config = LocalRuntimeCapabilitiesConfig.parse({
      web: { enabled: true, fetchEnabled: true }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, { dnsLookup, httpRequest: stubbedHttpRequest }).providers)
    })

    await expect(host.execute({
      callId: 'call_aborted',
      toolName: 'web_fetch',
      arguments: { url: 'https://public.example.test/page' }
    }, buildContext(controller.signal))).rejects.toThrow('tool call aborted before start')
    expect(dnsLookup).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns unavailable-provider errors for search without a search provider', async () => {
    const config = LocalRuntimeCapabilitiesConfig.parse({
      web: {
        enabled: true,
        searchEnabled: true,
        provider: 'missing'
      }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, {
        dnsLookup: publicDnsLookup,
        httpRequest: stubbedHttpRequest
      }).providers)
    })

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'web_search',
      arguments: { query: 'local runtime web' }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: true })
    if (result.item.kind === 'tool_result') {
      expect(result.item.output).toMatchObject({
        error: {
          code: 'provider_unavailable',
          message: 'web search provider is unavailable'
        }
      })
    }
  })

  it('uses zero-config public RSS search with bounded results and citations', async () => {
    let requestUrl = ''
    let requestHeaders: Headers | undefined
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(input)
      requestHeaders = new Headers(init?.headers)
      return new Response(`
        <rss><channel>
          <item>
            <title>SciForge &amp; current release</title>
            <link>https://docs.example.test/current#section</link>
            <description>Official current documentation.</description>
          </item>
        </channel></rss>
      `, { headers: { 'content-type': 'application/rss+xml' } })
    })
    const config = LocalRuntimeCapabilitiesConfig.parse({
      web: {
        enabled: true,
        searchEnabled: true,
        provider: 'public-rss'
      }
    })
    const built = buildWebToolProviders(config.web, {
      nowIso: () => '2028-02-03T00:00:00.000Z'
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(built.providers)
    })

    const result = await host.execute({
      callId: 'call_public_search',
      toolName: 'web_search',
      arguments: { query: 'SciForge current release', limit: 2 }
    }, buildContext())

    expect(built.provider).toBe('public-rss')
    expect(built.searchAvailable).toBe(true)
    expect(requestUrl).toContain('format=rss')
    expect(requestUrl).toContain('setlang=en-us')
    expect(requestUrl).toContain('cc=us')
    expect(requestHeaders?.get('user-agent')).toContain('Mozilla/5.0')
    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    if (result.item.kind === 'tool_result') {
      const output = result.item.output as {
        provider: string
        results: Array<{ title: string; url: string; provider: string }>
        citations: Array<{ url: string }>
      }
      expect(output.provider).toBe('public-rss')
      expect(output.results[0]).toMatchObject({
        title: 'SciForge & current release',
        url: 'https://docs.example.test/current',
        provider: 'bing-rss'
      })
      expect(output.citations[0]?.url).toBe('https://docs.example.test/current')
    }
  })

  it('promotes a relevant reputable report above an equally relevant SEO guide', async () => {
    vi.stubGlobal('fetch', async () => new Response(`
      <rss><channel>
        <item>
          <title>GPT-5.6 release guide 2026</title>
          <link>https://www.gemini-cnblog.com/chatgpt/guides/gpt-5.6-release-guide.html</link>
          <description>OpenAI GPT-5.6 release details for 2026.</description>
        </item>
        <item>
          <title>OpenAI launches its new family of models with GPT-5.6</title>
          <link>https://techcrunch.com/2026/07/09/openai-gpt-5-6/</link>
          <description>Independent reporting on the GPT-5.6 release in 2026.</description>
        </item>
      </channel></rss>
    `, { headers: { 'content-type': 'application/rss+xml' } }))
    const config = LocalRuntimeCapabilitiesConfig.parse({
      web: { enabled: true, searchEnabled: true, provider: 'public-rss' }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web).providers)
    })

    const result = await host.execute({
      callId: 'call_quality_rank',
      toolName: 'web_search',
      arguments: { query: 'GPT-5.6 release 2026', limit: 2 }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    if (result.item.kind === 'tool_result') {
      const output = result.item.output as { results: Array<{ url: string; rank: number }> }
      expect(output.results.map((entry) => entry.url)).toEqual([
        'https://techcrunch.com/2026/07/09/openai-gpt-5-6/',
        'https://www.gemini-cnblog.com/chatgpt/guides/gpt-5.6-release-guide.html'
      ])
      expect(output.results.map((entry) => entry.rank)).toEqual([1, 2])
    }
  })

  it('does not let an irrelevant reputable domain outrank a directly relevant result', async () => {
    vi.stubGlobal('fetch', async () => new Response(`
      <rss><channel>
        <item>
          <title>Gardening startup raises a new round</title>
          <link>https://techcrunch.com/2026/07/09/gardening-startup/</link>
          <description>Funding news about garden tools.</description>
        </item>
        <item>
          <title>Quantum Compiler v7.2 release notes</title>
          <link>https://docs.example.test/quantum-compiler-v7-2</link>
          <description>Quantum Compiler v7.2 was released in 2026.</description>
        </item>
      </channel></rss>
    `, { headers: { 'content-type': 'application/rss+xml' } }))
    const config = LocalRuntimeCapabilitiesConfig.parse({
      web: { enabled: true, searchEnabled: true, provider: 'public-rss' }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web).providers)
    })

    const result = await host.execute({
      callId: 'call_relevance_gate',
      toolName: 'web_search',
      arguments: { query: 'Quantum Compiler v7.2 release 2026', limit: 2 }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    if (result.item.kind === 'tool_result') {
      const output = result.item.output as { results: Array<{ url: string }> }
      expect(output.results[0]?.url).toBe('https://docs.example.test/quantum-compiler-v7-2')
    }
  })

  it('drops zero-overlap and neighboring-version results for an exact-version query', async () => {
    vi.stubGlobal('fetch', async () => new Response(`
      <rss><channel>
        <item>
          <title>OpenAI GPT-5.5 release notes</title>
          <link>https://openai.com/index/gpt-5-5/</link>
          <description>Documentation for the earlier GPT-5.5 release.</description>
        </item>
        <item>
          <title>Gardening tools for summer</title>
          <link>https://www.nytimes.com/gardening/tools</link>
          <description>An unrelated gardening article.</description>
        </item>
        <item>
          <title>OpenAI launches GPT-5.6 in 2026</title>
          <link>https://techcrunch.com/2026/07/09/openai-gpt-5-6/</link>
          <description>Current reporting about the exact GPT-5.6 release.</description>
        </item>
      </channel></rss>
    `, { headers: { 'content-type': 'application/rss+xml' } }))
    const config = LocalRuntimeCapabilitiesConfig.parse({
      web: { enabled: true, searchEnabled: true, provider: 'public-rss' }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web).providers)
    })

    const result = await host.execute({
      callId: 'call_exact_version_filter',
      toolName: 'web_search',
      arguments: { query: 'OpenAI GPT-5.6 release 2026', limit: 5 }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    if (result.item.kind === 'tool_result') {
      const output = result.item.output as { results: Array<{ url: string }> }
      expect(output.results.map((entry) => entry.url)).toEqual([
        'https://techcrunch.com/2026/07/09/openai-gpt-5-6/'
      ])
    }
  })

  it('sends browser-compatible headers for raw fetch without bypass headers', async () => {
    let headers: Headers | undefined
    vi.stubGlobal('fetch', async (_input: string | URL | Request, init?: RequestInit) => {
      headers = new Headers(init?.headers)
      return new Response('<article><h1>Readable</h1><p>Current content.</p></article>', {
        headers: { 'content-type': 'text/html' }
      })
    })
    const config = LocalRuntimeCapabilitiesConfig.parse({
      web: { enabled: true, fetchEnabled: true }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, {
        dnsLookup: publicDnsLookup,
        httpRequest: stubbedHttpRequest
      }).providers)
    })

    const result = await host.execute({
      callId: 'call_headers',
      toolName: 'web_fetch',
      arguments: { url: 'https://docs.example.test/current' }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    expect(headers?.get('user-agent')).toContain('Mozilla/5.0')
    expect(headers?.get('accept')).toContain('text/html')
    expect(headers?.get('accept-language')).toBe('en-US,en;q=0.9')
    expect(headers?.has('authorization')).toBe(false)
    expect(headers?.has('cookie')).toBe(false)
  })

  it('searches through a configured provider with citations and telemetry', async () => {
    const config = LocalRuntimeCapabilitiesConfig.parse({
      web: {
        enabled: true,
        searchEnabled: true,
        provider: 'test-search'
      }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildWebToolProviders(config.web, {
        provider: deterministicProvider()
      }).providers)
    })

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'web_search',
      arguments: { query: 'local runtime web', limit: 3 }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    if (result.item.kind === 'tool_result') {
      const output = result.item.output as {
        results: Array<{ sourceId: string; url: string; provider: string; rank: number }>
        sources: Array<{ sourceId: string }>
        telemetry: { resultCount: number; provider: string }
      }
      expect(output.results[0]).toMatchObject({
        url: 'https://docs.example.test/page',
        provider: 'test-search',
        rank: 1
      })
      expect(output.sources[0]?.sourceId).toBe(output.results[0]?.sourceId)
      expect(output.telemetry).toMatchObject({
        resultCount: 1,
        provider: 'test-search'
      })
    }
  })

  it('reports web availability in the runtime capability manifest', () => {
    const config = LocalRuntimeCapabilitiesConfig.parse({
      web: {
        enabled: true,
        fetchEnabled: true,
        searchEnabled: true,
        provider: 'test-search'
      }
    })
    const built = buildWebToolProviders(config.web, { provider: deterministicProvider() })
    const manifest = buildRuntimeCapabilityManifest({
      config,
      model: modelCapabilitiesForModel('deepseek-chat'),
      web: {
        fetchAvailable: built.fetchAvailable,
        searchAvailable: built.searchAvailable,
        provider: built.provider
      }
    })

    expect(manifest.web.available).toBe(true)
    expect(manifest.web.fetch.available).toBe(true)
    expect(manifest.web.search.available).toBe(true)
    expect(manifest.web.provider).toBe('test-search')
  })
})
