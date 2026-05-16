import assert from 'node:assert/strict';
import test from 'node:test';
import { createToolClient } from '../../../contracts/tool-worker/src/index';
import { startWebWorkerServer } from './server';
import { webSearch } from './web-tools';
import { createWebWorker } from './worker';

test('web worker manifest exposes web_search and web_fetch', () => {
  const worker = createWebWorker();
  assert.deepEqual(
    worker.manifest.tools.map((tool) => tool.id),
    ['web_search', 'web_fetch'],
  );
});

test('web worker validates unknown tools through invoke', async () => {
  const response = await createWebWorker().invoke({ toolId: 'missing', input: {} });
  assert.equal(response.ok, false);
  if (!response.ok) {
    assert.equal(response.error.code, 'tool_not_found');
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
