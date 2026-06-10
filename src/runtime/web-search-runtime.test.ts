import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createOpenSerpSearchProvider,
  createSearxngSearchProvider,
  runWebSearch,
  type SearchCandidateProvider,
  type WebSearchFetch,
} from './web-search-runtime.js';
import type { WebReadResult } from './web-read-runtime.js';
import { runWebSearchLiveDiagnostic } from '../../tools/web-search-live-diagnostic.js';

test('web_search uses SearXNG JSON provider and persists normalized refs-first candidates', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-web-search-'));
  const requestedUrls: string[] = [];
  const fetch: WebSearchFetch = async (url) => {
    requestedUrls.push(String(url));
    return jsonResponse(200, {
      results: [
        {
          title: ' Paper One ',
          url: 'https://Example.org/paper?utm_source=newsletter&b=2&a=1#abstract',
          content: ' First snippet from SearXNG. ',
          engine: 'bing',
          publishedDate: '2026-06-01',
          rawSecret: 'RAW_PROVIDER_PAYLOAD_SHOULD_NOT_LEAK',
        },
        {
          title: 'Duplicate paper',
          url: 'https://example.org/paper?a=1&b=2',
          content: 'Duplicate snippet.',
          engine: 'google',
        },
        {
          title: 'Search',
          url: 'https://search.local/search?q=agentic+rl',
          content: 'SearXNG self link.',
        },
        {
          title: 'Google Search',
          url: 'https://www.google.com/search?q=agentic+rl',
          content: 'Search engine navigation.',
        },
        {
          title: 'Unsafe local admin',
          url: 'http://127.0.0.1/admin',
          content: 'Unsafe URL.',
        },
        {
          title: 'Cloud metadata',
          url: 'http://metadata.google.internal/computeMetadata/v1',
          content: 'Unsafe metadata endpoint.',
        },
        {
          title: 'Second Paper',
          url: 'https://example.net/second?utm_medium=social',
          content: 'Second snippet.',
          engine: 'duckduckgo',
        },
      ],
    });
  };

  try {
    const result = await runWebSearch({
      query: 'agentic rl survey',
      limit: 5,
      language: 'en',
      region: 'us',
      safeSearch: 'moderate',
      timeoutMs: 1_500,
    }, {
      workspacePath,
      provider: createSearxngSearchProvider({
        env: { SCIFORGE_SEARXNG_BASE_URL: 'https://search.local' },
        fetch,
      }),
      now: () => '2026-06-10T00:00:00.000Z',
    });

    assert.equal(result.ok, true);
    assert.equal(result.tool, 'web_search');
    assert.equal(result.status, 'completed');
    assert.equal(result.provider, 'searxng');
    assert.equal(result.data?.results.length, 2);
    assert.deepEqual(result.data?.results.map((item) => ({
      rank: item.rank,
      title: item.title,
      url: item.url,
      snippet: item.snippet,
      provider: item.provider,
      source: item.source,
      publishedAt: item.publishedAt,
    })), [
      {
        rank: 1,
        title: 'Paper One',
        url: 'https://example.org/paper?a=1&b=2',
        snippet: 'First snippet from SearXNG.',
        provider: 'searxng',
        source: 'bing',
        publishedAt: '2026-06-01',
      },
      {
        rank: 2,
        title: 'Second Paper',
        url: 'https://example.net/second',
        snippet: 'Second snippet.',
        provider: 'searxng',
        source: 'duckduckgo',
        publishedAt: undefined,
      },
    ]);
    assert.match(result.refs.searchResultSetRef ?? '', /^web-search:[a-f0-9]{12}$/);
    assert.deepEqual(result.refs.discoveredPageRefs.map((item) => item.rank), [1, 2]);
    assert.ok(result.refs.discoveredPageRefs.every((item) => /^web-page:[a-f0-9]{12}$/.test(item.ref)));
    assert.equal('pageTextRef' in result.refs, false);
    assert.match(result.data?.evidenceBoundary.statement ?? '', /candidate discovery only/i);
    assert.equal(result.data?.evidenceBoundary.sourceEvidence, false);
    assert.equal(result.diagnostics.duplicateCount, 1);
    assert.equal(result.diagnostics.searchEngineSelfLinkCount, 2);
    assert.equal(result.diagnostics.unsafeUrlCount, 2);
    assert.equal(result.diagnostics.fallbackUsed, false);
    assert.equal(result.diagnostics.retryCount, 0);
    assert.ok(result.timings.providerMs >= 0);
    assert.ok(result.timings.parseMs >= 0);
    assert.equal(result.timings.optionalReadMs, 0);
    assert.ok(result.timings.totalMs >= result.timings.providerMs);
    assert.match(requestedUrls[0] ?? '', /^https:\/\/search\.local\/search\?/);
    assert.match(requestedUrls[0] ?? '', /format=json/);
    assert.match(requestedUrls[0] ?? '', /q=agentic\+rl\+survey/);

    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0]?.ref, result.refs.searchResultSetRef);
    assert.equal(result.artifacts[0]?.kind, 'web-search-result-set');
    const artifact = JSON.parse(await readFile(result.artifacts[0]!.path, 'utf8')) as {
      schemaVersion: string;
      evidenceBoundary: { sourceEvidence: boolean };
      results: unknown[];
      refs: { discoveredPageRefs: unknown[] };
    };
    assert.equal(artifact.schemaVersion, 'sciforge.web-search.result-set.v1');
    assert.equal(artifact.evidenceBoundary.sourceEvidence, false);
    assert.equal(artifact.results.length, 2);
    assert.equal(artifact.refs.discoveredPageRefs.length, 2);
    assert.doesNotMatch(JSON.stringify(result), /RAW_PROVIDER_PAYLOAD_SHOULD_NOT_LEAK/);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('SearXNG provider classifies empty, 429, 5xx, malformed JSON, and timeout results', async () => {
  const cases: Array<{
    name: string;
    fetch: WebSearchFetch;
    status: string;
    errorCode: string;
    diagnostic?: keyof NonNullable<Awaited<ReturnType<typeof runWebSearch>>['diagnostics']>;
  }> = [
    {
      name: 'empty result set',
      fetch: async () => jsonResponse(200, { results: [] }),
      status: 'no_results',
      errorCode: 'no_results',
      diagnostic: 'noResults',
    },
    {
      name: '429 rate limit',
      fetch: async () => jsonResponse(429, { error: 'too many requests' }),
      status: 'rate_limited',
      errorCode: 'rate_limited',
      diagnostic: 'rateLimited',
    },
    {
      name: '5xx unavailable',
      fetch: async () => jsonResponse(503, { error: 'upstream unavailable' }),
      status: 'provider_unavailable',
      errorCode: 'provider_unavailable',
      diagnostic: 'providerDegraded',
    },
    {
      name: 'malformed json',
      fetch: async () => ({
        ok: true,
        status: 200,
        async json() {
          throw new SyntaxError('Unexpected token <');
        },
      }),
      status: 'provider_unavailable',
      errorCode: 'provider_unavailable',
      diagnostic: 'malformedJson',
    },
    {
      name: 'timeout',
      fetch: async () => {
        throw Object.assign(new Error('operation aborted'), { name: 'AbortError' });
      },
      status: 'timeout',
      errorCode: 'timeout',
      diagnostic: 'timeout',
    },
  ];

  for (const entry of cases) {
    const workspacePath = await mkdtemp(join(tmpdir(), `sciforge-web-search-${entry.name.replace(/\W+/g, '-')}-`));
    try {
      const result = await runWebSearch({
        query: 'deterministic fixture',
        timeoutMs: 50,
      }, {
        workspacePath,
        provider: createSearxngSearchProvider({
          baseUrl: 'https://search.local',
          fetch: entry.fetch,
        }),
        now: () => '2026-06-10T00:00:00.000Z',
      });

      assert.equal(result.ok, false, entry.name);
      assert.equal(result.status, entry.status, entry.name);
      assert.equal(result.error?.code, entry.errorCode, entry.name);
      assert.equal(result.diagnostics.fallbackUsed, false, entry.name);
      assert.equal(result.diagnostics.blockedReason, entry.status, entry.name);
      if (entry.diagnostic) {
        assert.equal(result.diagnostics[entry.diagnostic], true, entry.name);
      }
      assert.equal(result.refs.searchResultSetRef, undefined, entry.name);
      assert.equal(result.refs.discoveredPageRefs.length, 0, entry.name);
      assert.equal(result.artifacts.length, 0, entry.name);
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  }
});

test('web_search supports config-injected SearXNG and keeps OpenSERP disabled until env-gated', async () => {
  const requestedUrls: string[] = [];
  const fetch: WebSearchFetch = async (url) => {
    requestedUrls.push(String(url));
    return jsonResponse(200, {
      results: [{
        title: 'Config Search Result',
        url: 'https://example.org/configured-search',
        content: 'Result discovered through config injected baseUrl.',
      }],
    });
  };

  const searxng = createSearxngSearchProvider({
    config: {
      searxng: {
        baseUrl: 'https://config.search.local',
        timeoutMs: 250,
      },
    },
    env: {},
    fetch,
  });
  const searxngResult = await searxng.search({
    query: 'configured provider',
    limit: 3,
    timeoutMs: 500,
  });
  assert.equal(searxngResult.status, 'completed');
  assert.match(requestedUrls[0] ?? '', /^https:\/\/config\.search\.local\/search\?/);

  const openserp = createOpenSerpSearchProvider({
    config: {
      openserp: {
        baseUrl: 'https://openserp.local',
      },
    },
    env: {},
    fetch,
  });
  const openserpResult = await openserp.search({
    query: 'disabled provider',
    limit: 3,
    timeoutMs: 500,
  });
  assert.equal(openserpResult.status, 'provider_unavailable');
  assert.equal(openserpResult.diagnostics.disabled, true);
});

test('SearXNG provider applies docs, science, and stable presets as provider params', async () => {
  const cases = [
    ['docs', null, 'mdn,github'],
    ['science', 'science', 'openalex,crossref,arxiv'],
    ['stable', null, 'mdn,github,openalex,crossref,arxiv'],
  ] as const;

  for (const [preset, categories, engines] of cases) {
    const requestedUrls: string[] = [];
    const provider = createSearxngSearchProvider({
      env: {
        SCIFORGE_SEARXNG_BASE_URL: 'https://search.local',
        SCIFORGE_SEARXNG_PRESET: preset,
      },
      fetch: async (url) => {
        requestedUrls.push(String(url));
        return jsonResponse(200, {
          results: [{
            title: `${preset} result`,
            url: `https://example.org/${preset}`,
            content: `Result routed through ${preset} preset.`,
          }],
        });
      },
    });

    const result = await provider.search({
      query: `${preset} provider preset`,
      limit: 1,
      timeoutMs: 500,
    });

    assert.equal(result.status, 'completed', preset);
    assert.equal(result.diagnostics.retryCount, 0, preset);
    const requestedUrl = new URL(requestedUrls[0] ?? '');
    assert.equal(requestedUrl.searchParams.get('q'), `${preset} provider preset`, preset);
    assert.equal(requestedUrl.searchParams.get('format'), 'json', preset);
    assert.equal(requestedUrl.searchParams.get('categories'), categories, preset);
    assert.equal(requestedUrl.searchParams.get('engines'), engines, preset);
  }
});

test('OpenSERP provider stays env-gated and uses the dedicated text query adapter when enabled', async () => {
  const requestedUrls: string[] = [];
  const provider = createOpenSerpSearchProvider({
    env: {
      SCIFORGE_OPENSERP_ENABLED: '1',
      SCIFORGE_OPENSERP_BASE_URL: 'https://openserp.local/api',
    },
    fetch: async (url) => {
      requestedUrls.push(String(url));
      return jsonResponse(200, {
        results: [{
          title: 'OpenSERP Result',
          link: 'https://example.org/openserp-result',
          snippet: 'Discovered through the OpenSERP text adapter.',
        }],
      });
    },
  });

  const result = await provider.search({
    query: 'openserp enabled query',
    limit: 3,
    timeoutMs: 500,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.candidates[0]?.url, 'https://example.org/openserp-result');
  const requestedUrl = new URL(requestedUrls[0] ?? '');
  assert.equal(requestedUrl.pathname, '/api/search');
  assert.equal(requestedUrl.searchParams.get('text'), 'openserp enabled query');
  assert.equal(requestedUrl.searchParams.get('q'), null);
  assert.equal(requestedUrl.searchParams.get('format'), 'json');
});

test('live diagnostic propagates SearXNG science preset to all five JSON searches', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-web-search-live-preset-'));
  const requestedUrls: string[] = [];

  try {
    const manifest = await runWebSearchLiveDiagnostic({
      workspacePath,
      out: 'manifest.json',
      env: {
        SCIFORGE_SEARXNG_BASE_URL: 'https://search.local',
        SCIFORGE_SEARXNG_PRESET: 'science',
      },
      fetchImpl: (async (url: string | URL) => {
        requestedUrls.push(String(url));
        return new Response(JSON.stringify({
          results: [{
            title: 'Science live result',
            url: 'https://example.org/science-live-result',
            content: 'SearXNG science preset live diagnostic result.',
          }],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch,
      readImpl: async () => liveReadSuccess(),
      now: () => new Date('2026-06-10T00:00:00.000Z'),
    });

    assert.equal(manifest.status, 'passed');
    assert.equal(requestedUrls.length, 5);
    assert.deepEqual(manifest.provider.configured ? manifest.provider.searxng?.searchParamNames : [], ['categories', 'engines']);
    for (const rawUrl of requestedUrls) {
      const requestedUrl = new URL(rawUrl);
      assert.equal(requestedUrl.searchParams.get('format'), 'json');
      assert.equal(requestedUrl.searchParams.get('categories'), 'science');
      assert.equal(requestedUrl.searchParams.get('engines'), 'openalex,crossref,arxiv');
    }
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('web_search keeps browser SERP fallback disabled by default and marks explicit fallback evidence', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-web-search-fallback-'));
  const primary: SearchCandidateProvider = {
    id: 'searxng',
    async search() {
      return {
        status: 'provider_unavailable',
        candidates: [],
        error: { code: 'provider_unavailable', message: 'SearXNG fixture is offline.' },
        diagnostics: { providerDegraded: true },
        timings: { fetchMs: 3, parseMs: 0 },
      };
    },
  };
  let fallbackCalls = 0;
  const fallback: SearchCandidateProvider = {
    id: 'browser-serp',
    async search() {
      fallbackCalls += 1;
      return {
        status: 'completed',
        candidates: [{
          title: 'Fallback Paper',
          url: 'https://example.org/fallback-paper',
          snippet: 'Discovered through an explicit browser SERP fallback hook.',
          source: 'browser-serp',
        }],
        diagnostics: {},
        timings: { fetchMs: 11, parseMs: 7 },
      };
    },
  };

  try {
    const defaultResult = await runWebSearch({
      query: 'fallback fixture',
    }, {
      workspacePath,
      provider: primary,
      fallbackProvider: fallback,
      now: () => '2026-06-10T00:00:00.000Z',
    });
    assert.equal(defaultResult.ok, false);
    assert.equal(defaultResult.status, 'provider_unavailable');
    assert.equal(defaultResult.diagnostics.fallbackUsed, false);
    assert.equal(fallbackCalls, 0);

    const fallbackResult = await runWebSearch({
      query: 'fallback fixture',
    }, {
      workspacePath,
      provider: primary,
      fallbackProvider: fallback,
      enableBrowserFallback: true,
      now: () => '2026-06-10T00:00:00.000Z',
    });
    assert.equal(fallbackResult.ok, true);
    assert.equal(fallbackResult.status, 'completed');
    assert.equal(fallbackResult.provider, 'browser-serp');
    assert.equal(fallbackResult.diagnostics.fallbackUsed, true);
    assert.equal(fallbackResult.diagnostics.fallbackProvider, 'browser-serp');
    assert.match(fallbackResult.diagnostics.fallbackReason ?? '', /provider_unavailable/);
    assert.ok((fallbackResult.timings.fallbackMs ?? -1) >= 0);
    assert.equal(fallbackResult.data?.results[0]?.url, 'https://example.org/fallback-paper');
    assert.equal(fallbackCalls, 1);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

function liveReadSuccess(): WebReadResult {
  return {
    ok: true,
    status: 'read',
    tool: 'web_read',
    provider: 'static-fetch',
    data: {
      requestedUrl: 'https://example.org/science-live-result',
      finalUrl: 'https://example.org/science-live-result',
      contentType: 'text/html; charset=utf-8',
      openedAt: '2026-06-10T00:00:00.000Z',
      text: 'Readable source text from the live diagnostic fixture.',
      textPreview: 'Readable source text from the live diagnostic fixture.',
      textCharCount: 58,
      textSha1: '0123456789abcdef0123456789abcdef01234567',
      sourcePageRef: 'web-source:live-fixture',
      pageTextRef: 'web-text:live-fixture',
    },
    refs: {
      sourcePageRef: 'web-source:live-fixture',
      pageTextRef: 'web-text:live-fixture',
    },
    timings: {
      totalMs: 1,
      cache: 'miss',
      cachePolicy: 'bypass',
    },
    diagnostics: {
      httpStatus: 200,
    },
    warnings: [],
  };
}

function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}
