import assert from 'node:assert/strict';
import test from 'node:test';
import { createToolClient } from '../../../contracts/tool-worker/src/index';
import { startWebWorkerServer } from './server';
import { setBrowserAutomationForTests, webSearch } from './web-tools';
import { createWebWorker } from './worker';

test('web worker manifest exposes fetch/search and browser-rendered tools', () => {
  const worker = createWebWorker();
  assert.deepEqual(
    worker.manifest.tools.map((tool) => tool.id),
    ['web_search', 'web_fetch', 'browser_search', 'browser_fetch'],
  );
});

test('web worker validates unknown tools through invoke', async () => {
  const response = await createWebWorker().invoke({ toolId: 'missing', input: {} });
  assert.equal(response.ok, false);
  if (!response.ok) {
    assert.equal(response.error.code, 'tool_not_found');
  }
});

test('browser tools route through the browser automation provider', async () => {
  setBrowserAutomationForTests({
    async search(input) {
      return {
        query: input.query,
        rawQuery: input.rawQuery,
        provider: 'test-browser',
        rendered: true,
        results: [{ title: 'Rendered result', url: 'https://example.test/rendered', snippet: 'from browser' }],
      };
    },
    async fetch(input) {
      return {
        url: input.url,
        finalUrl: input.url,
        status: 200,
        ok: true,
        provider: 'test-browser',
        rendered: true,
        text: 'Rendered page body',
        links: [{ text: 'Rendered link', url: 'https://example.test/link' }],
      };
    },
  });
  try {
    const worker = createWebWorker();
    const search = await worker.invoke({ toolId: 'browser_search', input: { query: 'dynamic page', limit: 1 } });
    assert.equal(search.ok, true);
    if (search.ok) {
      const output = search.output as Record<string, unknown>;
      assert.equal(output.provider, 'test-browser');
      assert.equal((output.results as Array<Record<string, unknown>>)[0]?.title, 'Rendered result');
    }

    const fetch = await worker.invoke({ toolId: 'browser_fetch', input: { url: 'https://example.test/page' } });
    assert.equal(fetch.ok, true);
    if (fetch.ok) {
      const output = fetch.output as Record<string, unknown>;
      assert.equal(output.provider, 'test-browser');
      assert.equal(output.text, 'Rendered page body');
    }
  } finally {
    setBrowserAutomationForTests(undefined);
  }
});

test('web_search uses rendered browser search before scholarly fallbacks for general web queries', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: URL | RequestInfo) => {
    const href = String(url);
    if (href.includes('duckduckgo.com/html/')) {
      return new Response('temporary search failure', { status: 503 });
    }
    throw new Error(`unexpected fetch ${href}`);
  }) as typeof fetch;
  setBrowserAutomationForTests({
    async search(input) {
      return {
        query: input.query,
        rawQuery: input.rawQuery,
        provider: 'test-browser',
        rendered: true,
        results: [{ title: 'Rendered web result', url: 'https://example.test/web', snippet: 'from browser' }],
      };
    },
    async fetch() {
      throw new Error('browser fetch should not run');
    },
  });

  try {
    const result = await webSearch({ query: 'dynamic public web research topic', limit: 1 });
    assert.equal(result.provider, 'test-browser');
    assert.equal(result.fallbackFrom, 'duckduckgo-html');
    assert.deepEqual((result.results as Array<Record<string, unknown>>)[0], {
      title: 'Rendered web result',
      url: 'https://example.test/web',
      snippet: 'from browser',
    });
  } finally {
    globalThis.fetch = originalFetch;
    setBrowserAutomationForTests(undefined);
  }
});

test('web worker can be served through the protocol SDK', async () => {
  const server = await startWebWorkerServer();
  try {
    const client = createToolClient(server.url);
    assert.equal((await client.manifest()).workerId, 'sciforge.web-worker');
    assert.equal((await client.health()).status, 'ok');
  } finally {
    await server.close();
  }
});

test('web_search falls back to the arXiv API for arXiv queries', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: URL | RequestInfo) => {
    const href = String(url);
    calls.push(href);
    if (href.includes('duckduckgo.com/html/')) {
      return new Response('temporary search failure', { status: 503 });
    }
    if (href.includes('export.arxiv.org/api/query')) {
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <id>http://arxiv.org/abs/2505.01234v1</id>
            <updated>2025-05-12T18:01:00Z</updated>
            <published>2025-05-12T18:01:00Z</published>
            <title>Credit Assignment for Cooperative Multi-Agent Reinforcement Learning</title>
            <summary>We introduce a cooperative credit assignment method and evaluate it on multi-agent tasks.</summary>
            <author><name>Ada Lovelace</name></author>
            <author><name>Grace Hopper</name></author>
            <link href="http://arxiv.org/abs/2505.01234v1" rel="alternate" type="text/html"/>
            <link title="pdf" href="http://arxiv.org/pdf/2505.01234v1" rel="related" type="application/pdf"/>
          </entry>
        </feed>`, {
        status: 200,
        headers: { 'content-type': 'application/atom+xml' },
      });
    }
    throw new Error(`unexpected fetch ${href}`);
  }) as typeof fetch;

  try {
    const result = await webSearch({
      query: 'latest arxiv papers about multi-agent reinforcement learning credit assignment',
      limit: 2,
    });
    assert.equal(result.provider, 'arxiv-api');
    assert.deepEqual(result.fallbackFrom, 'duckduckgo-html');
    assert.ok(calls.some((href) => href.includes('duckduckgo.com/html/')));
    const arxivCall = calls.find((href) => href.includes('export.arxiv.org/api/query'));
    assert.ok(arxivCall);
    const arxivQuery = new URL(arxivCall).searchParams.get('search_query') ?? '';
    assert.equal(result.providerQuery, arxivQuery);
    assert.match(arxivQuery, /all:multi/);
    assert.match(arxivQuery, /all:agent/);
    assert.match(arxivQuery, /all:credit/);
    assert.doesNotMatch(arxivQuery, /provider|must|authors/i);
    const rows = result.results as Array<Record<string, unknown>>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.title, 'Credit Assignment for Cooperative Multi-Agent Reinforcement Learning');
    assert.equal(rows[0]?.url, 'https://arxiv.org/abs/2505.01234v1');
    assert.equal(rows[0]?.arxivId, '2505.01234v1');
    assert.equal(rows[0]?.pdfUrl, 'http://arxiv.org/pdf/2505.01234v1');
    assert.deepEqual(rows[0]?.authors, ['Ada Lovelace', 'Grace Hopper']);
    assert.match(String(rows[0]?.snippet), /pdf:http:\/\/arxiv\.org\/pdf\/2505\.01234v1/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('web_search applies arXiv submitted-date windows from recent-time prompts', async () => {
  const originalFetch = globalThis.fetch;
  let arxivQuery = '';
  globalThis.fetch = (async (url: URL | RequestInfo) => {
    const href = String(url);
    if (href.includes('duckduckgo.com/html/')) {
      return new Response('temporary search failure', { status: 503 });
    }
    if (href.includes('export.arxiv.org/api/query')) {
      arxivQuery = new URL(href).searchParams.get('search_query') ?? '';
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <id>http://arxiv.org/abs/2605.14558v1</id>
            <updated>2026-05-14T08:33:02Z</updated>
            <published>2026-05-14T08:33:02Z</published>
            <title>Resolving Action Bottleneck</title>
            <summary>Token-level credit assignment for agentic reinforcement learning.</summary>
            <author><name>Langzhou He</name></author>
            <link href="https://arxiv.org/abs/2605.14558v1" rel="alternate" type="text/html"/>
            <link title="pdf" href="https://arxiv.org/pdf/2605.14558v1" rel="related" type="application/pdf"/>
          </entry>
        </feed>`, {
        status: 200,
        headers: { 'content-type': 'application/atom+xml' },
      });
    }
    throw new Error(`unexpected fetch ${href}`);
  }) as typeof fetch;

  try {
    const result = await webSearch({
      query: 'today is 2026-05-17. latest arxiv papers from last 30 days about multi-agent reinforcement learning credit assignment',
      limit: 2,
      now: '2026-05-17T00:00:00Z',
    });
    assert.equal(result.provider, 'arxiv-api');
    assert.equal(result.providerQuery, arxivQuery);
    assert.match(arxivQuery, /submittedDate:\[202604180000 TO 202605172359\]/);
    assert.doesNotMatch(arxivQuery, /all:2026|all:05|all:17/);
    assert.deepEqual(result.dateRange, {
      from: '202604180000',
      to: '202605172359',
      fromDate: '2026-04-18',
      toDate: '2026-05-17',
    });
    const rows = result.results as Array<Record<string, unknown>>;
    assert.equal(rows[0]?.arxivId, '2605.14558v1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('web_search fails closed for explicit arXiv queries when the arXiv API has no records', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: URL | RequestInfo) => {
    const href = String(url);
    calls.push(href);
    if (href.includes('duckduckgo.com/html/')) {
      return new Response('temporary search failure', { status: 503 });
    }
    if (href.includes('export.arxiv.org/api/query')) {
      return new Response('<feed xmlns="http://www.w3.org/2005/Atom"></feed>', {
        status: 200,
        headers: { 'content-type': 'application/atom+xml' },
      });
    }
    throw new Error(`unexpected fetch ${href}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => webSearch({ query: 'arxiv multi-agent reinforcement learning credit assignment', limit: 2 }),
      /arxiv-api could not satisfy explicit arXiv query/,
    );
    assert.ok(calls.some((href) => href.includes('duckduckgo.com/html/')));
    assert.ok(calls.some((href) => href.includes('export.arxiv.org/api/query')));
    assert.equal(calls.some((href) => href.includes('api.crossref.org') || href.includes('europepmc')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
